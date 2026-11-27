import fs from 'node:fs';
import path from 'node:path';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
}

interface GltfJson {
  asset?: { version?: string; generator?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
      metallicFactor?: number;
      roughnessFactor?: number;
      metallicRoughnessTexture?: { index: number };
    };
    normalTexture?: { index: number };
  }>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ mimeType?: string; name?: string; bufferView?: number; uri?: string }>;
  animations?: Array<{ name?: string; channels?: unknown[]; samplers?: unknown[] }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface GlbAuditItem {
  readonly relativePath: string;
  readonly faction: 'NORTH' | 'SOUTH';
  readonly modelSlug: string;
  readonly lod: 'lod0' | 'lod1' | 'lod2';
  readonly sizeBytes: number;
  readonly glbVersion: number;
  readonly generator: string;
  readonly meshCount: number;
  readonly primitiveCount: number;
  readonly nodeCount: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly imageCount: number;
  readonly imageMimeTypes: string[];
  readonly animationCount: number;
  readonly animationNames: string[];
  readonly bboxMin: [number, number, number];
  readonly bboxMax: [number, number, number];
  readonly sizeXYZ: [number, number, number];
  readonly pivotMinY: number;
  readonly centerXZ: [number, number];
  readonly primaryHorizontalAxis: 'Z' | 'X' | 'BALANCED';
  readonly groundedOk: boolean;
  readonly centeredOk: boolean;
  readonly extensionsRequired: string[];
  readonly issues: string[];
}

function mulMat4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function trsToMat4(node: GltfNode): number[] {
  if (node.matrix && node.matrix.length === 16) return [...node.matrix];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(m: number[], p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function auditSingleGlb(absPath: string, rootDir: string): GlbAuditItem {
  const buf = fs.readFileSync(absPath);
  const rel = path.relative(rootDir, absPath).replace(/\\/g, '/');
  const parts = rel.split('/');
  const faction = parts[1] === 'north' ? 'NORTH' : 'SOUTH';
  const modelSlug = parts[2] ?? 'unknown';
  const lodMatch = /_(lod[012])\.glb$/i.exec(parts[parts.length - 1] ?? '');
  const lod = (lodMatch?.[1]?.toLowerCase() ?? 'lod0') as 'lod0' | 'lod1' | 'lod2';

  const issues: string[] = [];
  if (buf.length < 20) throw new Error(`${rel}: GLB too small (${buf.length} bytes)`);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`${rel}: invalid GLB magic 0x${magic.toString(16)}`);
  const glbVersion = buf.readUInt32LE(4);
  const declaredLen = buf.readUInt32LE(8);
  if (declaredLen !== buf.length) {
    issues.push(`Declared length ${declaredLen} != file size ${buf.length}`);
  }

  let offset = 12;
  let gltf: GltfJson | null = null;
  let hasBin = false;
  while (offset + 8 <= buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkType === 0x4e4f534a) {
      gltf = JSON.parse(buf.subarray(offset, offset + chunkLen).toString('utf8')) as GltfJson;
    } else if (chunkType === 0x004e4942) {
      hasBin = true;
    }
    offset += chunkLen;
  }
  if (!gltf) throw new Error(`${rel}: missing JSON chunk`);
  if (!hasBin) issues.push('Missing BIN chunk');

  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const nodes = gltf.nodes ?? [];
  let primitiveCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;

  // Compute per-mesh local AABB from POSITION accessor min/max
  const meshBounds = meshes.map((mesh) => {
    const mn: [number, number, number] = [Infinity, Infinity, Infinity];
    const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const prim of mesh.primitives) {
      primitiveCount += 1;
      const posIdx = prim.attributes?.POSITION;
      if (posIdx !== undefined) {
        const acc = accessors[posIdx];
        if (acc) {
          vertexCount += acc.count;
          if (acc.min && acc.max && acc.min.length >= 3 && acc.max.length >= 3) {
            for (let k = 0; k < 3; k += 1) {
              if (acc.min[k] < mn[k]) mn[k] = acc.min[k];
              if (acc.max[k] > mx[k]) mx[k] = acc.max[k];
            }
          }
        }
      }
      const mode = prim.mode ?? 4; // TRIANGLES
      if (prim.indices !== undefined) {
        const idxAcc = accessors[prim.indices];
        if (idxAcc && mode === 4) triangleCount += Math.floor(idxAcc.count / 3);
      } else if (posIdx !== undefined) {
        const acc = accessors[posIdx];
        if (acc && mode === 4) triangleCount += Math.floor(acc.count / 3);
      }
    }
    return { mn, mx };
  });

  // Traverse scene graph to transform mesh bounds into world space
  const worldMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const worldMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  const visit = (nodeIdx: number, parentMat: number[]): void => {
    const node = nodes[nodeIdx];
    if (!node) return;
    const worldMat = mulMat4(parentMat, trsToMat4(node));
    if (node.mesh !== undefined) {
      const b = meshBounds[node.mesh];
      if (b && Number.isFinite(b.mn[0])) {
        const xs = [b.mn[0], b.mx[0]];
        const ys = [b.mn[1], b.mx[1]];
        const zs = [b.mn[2], b.mx[2]];
        for (const x of xs) {
          for (const y of ys) {
            for (const z of zs) {
              const tp = transformPoint(worldMat, [x, y, z]);
              for (let k = 0; k < 3; k += 1) {
                if (tp[k] < worldMin[k]) worldMin[k] = tp[k];
                if (tp[k] > worldMax[k]) worldMax[k] = tp[k];
              }
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) {
      visit(child, worldMat);
    }
  };

  const sceneRoots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const rootIdx of sceneRoots) visit(rootIdx, identity);

  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const bboxMin: [number, number, number] = [round3(worldMin[0]), round3(worldMin[1]), round3(worldMin[2])];
  const bboxMax: [number, number, number] = [round3(worldMax[0]), round3(worldMax[1]), round3(worldMax[2])];
  const sizeXYZ: [number, number, number] = [
    round3(worldMax[0] - worldMin[0]),
    round3(worldMax[1] - worldMin[1]),
    round3(worldMax[2] - worldMin[2]),
  ];
  const centerXZ: [number, number] = [
    round3((worldMin[0] + worldMax[0]) / 2),
    round3((worldMin[2] + worldMax[2]) / 2),
  ];
  const pivotMinY = bboxMin[1];
  const maxHoriz = Math.max(sizeXYZ[0], sizeXYZ[2], 0.001);
  const groundedOk = Math.abs(pivotMinY) <= Math.max(0.15, sizeXYZ[1] * 0.08);
  const centeredOk = Math.abs(centerXZ[0]) <= maxHoriz * 0.25 && Math.abs(centerXZ[1]) <= maxHoriz * 0.25;

  const primaryHorizontalAxis: 'Z' | 'X' | 'BALANCED' =
    sizeXYZ[2] > sizeXYZ[0] * 1.12 ? 'Z' : sizeXYZ[0] > sizeXYZ[2] * 1.12 ? 'X' : 'BALANCED';

  if (!groundedOk) issues.push(`Pivot Y not at ground (minY=${pivotMinY})`);
  if (!centeredOk) issues.push(`Horizontal pivot offset (${centerXZ[0]}, ${centerXZ[1]})`);
  if (triangleCount === 0) issues.push('Zero triangles');

  return {
    relativePath: rel,
    faction,
    modelSlug,
    lod,
    sizeBytes: buf.length,
    glbVersion,
    generator: gltf.asset?.generator ?? 'unknown',
    meshCount: meshes.length,
    primitiveCount,
    nodeCount: nodes.length,
    vertexCount,
    triangleCount,
    materialCount: (gltf.materials ?? []).length,
    textureCount: (gltf.textures ?? []).length,
    imageCount: (gltf.images ?? []).length,
    imageMimeTypes: Array.from(new Set((gltf.images ?? []).map((im) => im.mimeType ?? 'unknown'))),
    animationCount: (gltf.animations ?? []).length,
    animationNames: (gltf.animations ?? []).map((a, i) => a.name ?? `anim_${i}`),
    bboxMin,
    bboxMax,
    sizeXYZ,
    pivotMinY,
    centerXZ,
    primaryHorizontalAxis,
    groundedOk,
    centeredOk,
    extensionsRequired: gltf.extensionsRequired ?? [],
    issues,
  };
}

export function auditAllUnits(rootDir: string): GlbAuditItem[] {
  const results: GlbAuditItem[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.glb')) {
        results.push(auditSingleGlb(full, rootDir));
      }
    }
  };
  walk(path.join(rootDir, 'models'));
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('audit-glb-assets.mts')) {
  const unitsRoot = path.resolve(process.cwd(), 'public/assets/units');
  const items = auditAllUnits(unitsRoot);
  const totalBytes = items.reduce((s, it) => s + it.sizeBytes, 0);
  const totalIssues = items.flatMap((it) => it.issues.map((msg) => `${it.relativePath}: ${msg}`));
  console.log(
    JSON.stringify(
      {
        auditedGlbCount: items.length,
        totalSizeKb: Math.round((totalBytes / 1024) * 10) / 10,
        issueCount: totalIssues.length,
        issues: totalIssues,
        models: items,
      },
      null,
      2
    )
  );
}
