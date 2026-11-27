import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CAMPAIGN_MISSING_GLB_ENTRIES,
  CAMPAIGN_READY_GLB_ENTRIES,
  CAMPAIGN_UNIT_ASSET_MANIFEST,
  CAMPAIGN_VISUAL_LOD_THRESHOLDS,
  CampaignRenderLodMode,
  CampaignUnitVisualEntry,
  CampaignVisualFaction,
  CampaignVisualLod,
  resolveCampaignUnitVisual,
  selectVisualLodForZoom,
} from '../content/campaignAssetManifest';
import { CampaignUnitKey } from '../contracts';

export interface RenderableUnitInput {
  readonly id: string | number;
  readonly key: CampaignUnitKey;
  readonly faction: CampaignVisualFaction;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly moving: boolean;
  readonly selected: boolean;
  readonly inCombat: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly stackCount: number;
  readonly learned: readonly string[];
}

export interface CapturePulseInput {
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  readonly friendly: boolean;
}

export interface VisualPerformanceMetrics {
  rendererMode: 'webgl-3d' | 'fallback-2d';
  enabled: boolean;
  webglContextLost: boolean;
  activeLod: CampaignRenderLodMode;
  zoom: number;
  fps: number;
  avgFrameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  visibleUnits: number;
  rendered3dInstances: number;
  loadedGlbCount: number;
  totalGlbCount: number;
  missingGlbSlots: number;
  initialLod2LoadMs: number | null;
  portraitsCached: number;
}

interface PrimitiveBatch {
  mesh: THREE.InstancedMesh;
  count: number;
}

interface LoadedModelTemplate {
  entryId: string;
  lod: CampaignVisualLod;
  normalizeScale: number;
  batches: PrimitiveBatch[];
  rawParts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
}

const MAX_INSTANCES = 320;
const ISO_TILT_X = 0.68; // ~39° 2.5D tactical military isometric overhead angle
const INFANTRY_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.34],
  [-0.36, -0.24],
  [0.36, -0.24],
];

function hashUnitSeed(id: string | number): number {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function buildProceduralFallbackParts(
  unitKey: CampaignUnitKey,
  faction: CampaignVisualFaction
): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const hullColor = faction === 'NORTH' ? 0x4f6343 : 0x5c6649;
  const trimColor = faction === 'NORTH' ? 0xc83e32 : 0xd4a438;
  const darkMetal = 0x2d3336;
  const navalHull = faction === 'NORTH' ? 0x455866 : 0x556878;
  const subHull = faction === 'NORTH' ? 0x26323a : 0x313e47;
  const airBody = faction === 'NORTH' ? 0x8d9aa0 : 0x76858f;

  const makeMat = (color: number, metalness = 0.25, roughness = 0.62) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });

  const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  const pushBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx = 0,
    ry = 0,
    rz = 0
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    parts.push({ geometry: g, material: mat });
  };
  const pushCyl = (
    rt: number,
    rb: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx = 0
  ) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 8);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    parts.push({ geometry: g, material: mat });
  };

  const mHull = makeMat(hullColor, 0.2, 0.72);
  const mTrim = makeMat(trimColor, 0.15, 0.55);
  const mDark = makeMat(darkMetal, 0.45, 0.45);

  if (unitKey === 'sam') {
    // Tracked/wheeled SAM launcher chassis + angled twin missiles + radar mast
    pushBox(2.4, 0.9, 5.8, 0, 0.7, 0, mHull);
    pushBox(2.6, 0.5, 5.4, 0, 0.35, 0, mDark);
    pushBox(1.8, 0.7, 1.8, 0, 1.35, 1.4, mHull);
    pushCyl(0.24, 0.28, 3.6, -0.5, 2.2, -0.6, mTrim, 0.85);
    pushCyl(0.24, 0.28, 3.6, 0.5, 2.2, -0.6, mTrim, 0.85);
    pushBox(1.2, 0.55, 0.18, 0, 2.65, -2.0, mDark);
  } else if (unitKey === 'fighter') {
    const mAir = makeMat(airBody, 0.5, 0.38);
    // Fuselage + swept delta wings + tail fin + canopy
    pushCyl(0.42, 0.55, 8.6, 0, 1.1, 0, mAir, Math.PI / 2);
    pushBox(7.2, 0.16, 2.4, 0, 1.05, -0.5, mAir);
    pushBox(2.6, 0.14, 1.1, 0, 1.15, -3.5, mAir);
    pushBox(0.18, 1.6, 1.5, 0, 1.85, -3.3, mTrim);
    pushBox(0.65, 0.45, 1.8, 0, 1.52, 1.2, mDark);
  } else if (unitKey === 'corvette') {
    const mNav = makeMat(navalHull, 0.3, 0.55);
    pushBox(2.8, 1.2, 11.0, 0, 0.65, 0, mNav);
    pushBox(2.0, 1.4, 3.6, 0, 1.75, -0.4, mNav);
    pushBox(0.9, 0.7, 1.1, 0, 1.55, 3.2, mDark);
    pushCyl(0.12, 0.12, 2.2, 0, 1.7, 4.3, mDark, Math.PI / 2);
    pushBox(0.35, 1.8, 0.35, 0, 3.1, -0.6, mTrim);
  } else if (unitKey === 'submarine') {
    const mSub = makeMat(subHull, 0.35, 0.42);
    pushCyl(0.95, 0.95, 10.6, 0, 0.75, 0, mSub, Math.PI / 2);
    pushBox(0.9, 1.45, 2.4, 0, 1.65, 0.6, mSub);
    pushBox(2.4, 0.14, 0.7, 0, 1.85, 0.8, mTrim);
    pushBox(0.14, 1.2, 0.8, 0, 1.05, -4.8, mDark);
  } else {
    pushBox(2.2, 1.4, 3.8, 0, 0.7, 0, mHull);
    pushBox(1.2, 0.6, 1.4, 0, 1.55, 0, mTrim);
  }

  return parts;
}

export class CampaignUnit3DOverlay {
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1280, 720, 0, -600, 600);
  private readonly loader = new GLTFLoader();

  private readonly templates = new Map<string, LoadedModelTemplate>();
  private readonly pendingLoads = new Set<string>();
  private readonly portraitCache = new Map<string, string>();
  private readonly smoothedYaw = new Map<string, number>();

  // Shared GPU overlay meshes (1 draw call each across all 200+ units!)
  private shadowMesh: THREE.InstancedMesh | null = null;
  private ringMesh: THREE.InstancedMesh | null = null;
  private flashMesh: THREE.InstancedMesh | null = null;
  private smokeMesh: THREE.InstancedMesh | null = null;
  private pulseMesh: THREE.InstancedMesh | null = null;

  private readonly dummyObj = new THREE.Object3D();
  private readonly tempColor = new THREE.Color();
  private readonly tempMat = new THREE.Matrix4();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempPos = new THREE.Vector3();
  private readonly tempScale = new THREE.Vector3();
  private readonly tiltQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(ISO_TILT_X, 0, 0)
  );
  private readonly yawQuat = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  private width = 1280;
  private height = 720;
  private dpr = 1;
  private enabled = true;
  private contextLost = false;
  private lod2StartTime = performance.now();
  private lod2LoadedCount = 0;
  private initialLod2LoadMs: number | null = null;

  private readonly frameTimes: number[] = [];
  private lastRenderTs = 0;
  private onPortraitReadyCb: ((entryId: string, dataUrl: string) => void) | null = null;
  private onFallbackChangeCb: ((mode: 'webgl-3d' | 'fallback-2d') => void) | null = null;

  public readonly metrics: VisualPerformanceMetrics = {
    rendererMode: 'fallback-2d',
    enabled: true,
    webglContextLost: false,
    activeLod: 'SYMBOL',
    zoom: 1,
    fps: 0,
    avgFrameMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    visibleUnits: 0,
    rendered3dInstances: 0,
    loadedGlbCount: 0,
    totalGlbCount: CAMPAIGN_READY_GLB_ENTRIES.length * 3,
    missingGlbSlots: CAMPAIGN_MISSING_GLB_ENTRIES.length,
    initialLod2LoadMs: null,
    portraitsCached: 0,
  };

  constructor(
    canvas: HTMLCanvasElement,
    options?: {
      onPortraitReady?: (entryId: string, dataUrl: string) => void;
      onFallbackChange?: (mode: 'webgl-3d' | 'fallback-2d') => void;
      forceNoWebGL?: boolean;
    }
  ) {
    this.canvas = canvas;
    this.onPortraitReadyCb = options?.onPortraitReady ?? null;
    this.onFallbackChangeCb = options?.onFallbackChange ?? null;

    this.camera.position.set(0, 0, 320);
    this.camera.lookAt(0, 0, 0);
    this.setupLighting();

    if (!options?.forceNoWebGL) {
      this.initWebGL();
    }
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xfffbe8, 0x5c6d56, 2.25);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6dc, 2.55);
    sun.position.set(160, 260, 300);
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xaad4f0, 1.2);
    rim.position.set(-180, 140, 120);
    this.scene.add(rim);
  }

  private initWebGL(): boolean {
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.32;
      renderer.setClearColor(0x000000, 0);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = envTex;
      pmrem.dispose();
      this.renderer = renderer;
      this.contextLost = false;
      this.metrics.rendererMode = 'webgl-3d';
      this.metrics.webglContextLost = false;

      this.setupSharedOverlayMeshes();
      this.registerProceduralFallbacks();

      this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
      this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

      this.onFallbackChangeCb?.('webgl-3d');
      this.preloadLod2Assets();
      return true;
    } catch {
      this.renderer = null;
      this.metrics.rendererMode = 'fallback-2d';
      this.onFallbackChangeCb?.('fallback-2d');
      return false;
    }
  }

  private readonly handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.metrics.webglContextLost = true;
    this.metrics.rendererMode = 'fallback-2d';
    this.onFallbackChangeCb?.('fallback-2d');
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.metrics.webglContextLost = false;
    if (this.renderer) {
      this.metrics.rendererMode = 'webgl-3d';
      this.resize(this.width, this.height, this.dpr);
      this.onFallbackChangeCb?.('webgl-3d');
    }
  };

  private setupSharedOverlayMeshes(): void {
    const shadowGeo = new THREE.CircleGeometry(1, 18);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0b120d,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_INSTANCES);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.count = 0;
    this.scene.add(this.shadowMesh);

    const ringGeo = new THREE.RingGeometry(0.82, 1.06, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_INSTANCES);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.count = 0;
    this.scene.add(this.ringMesh);

    const flashGeo = new THREE.IcosahedronGeometry(1, 0);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.flashMesh = new THREE.InstancedMesh(flashGeo, flashMat, MAX_INSTANCES);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.count = 0;
    this.scene.add(this.flashMesh);

    const smokeGeo = new THREE.CircleGeometry(1, 10);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x222628,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_INSTANCES);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.count = 0;
    this.scene.add(this.smokeMesh);

    const pulseGeo = new THREE.RingGeometry(0.75, 1.0, 32);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    this.pulseMesh = new THREE.InstancedMesh(pulseGeo, pulseMat, 32);
    this.pulseMesh.frustumCulled = false;
    this.pulseMesh.count = 0;
    this.scene.add(this.pulseMesh);
  }

  private registerProceduralFallbacks(): void {
    for (const entry of CAMPAIGN_MISSING_GLB_ENTRIES) {
      const rawParts = buildProceduralFallbackParts(entry.unitKey, entry.faction);
      const maxDim = Math.max(entry.bboxSizeXYZ[0], entry.bboxSizeXYZ[1], entry.bboxSizeXYZ[2], 1);
      const normalizeScale = entry.mapVisualScale / maxDim;
      const batches: PrimitiveBatch[] = rawParts.map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.scene.add(mesh);
        return { mesh, count: 0 };
      });
      for (const lod of ['lod0', 'lod1', 'lod2'] as const) {
        this.templates.set(`${entry.id}:${lod}`, {
          entryId: entry.id,
          lod,
          normalizeScale,
          batches,
          rawParts,
        });
      }
    }
  }

  private preloadLod2Assets(): void {
    this.lod2StartTime = performance.now();
    for (const entry of CAMPAIGN_READY_GLB_ENTRIES) {
      this.ensureLoaded(entry, 'lod2');
    }
  }

  private ensureLoaded(entry: CampaignUnitVisualEntry, lod: CampaignVisualLod): void {
    if (!this.renderer || this.contextLost || entry.glbStatus !== 'READY' || !entry.lods) return;
    const cacheKey = `${entry.id}:${lod}`;
    if (this.templates.has(cacheKey) || this.pendingLoads.has(cacheKey)) return;
    this.pendingLoads.add(cacheKey);

    const lodMeta = entry.lods[lod];
    this.loader.load(
      lodMeta.url,
      (gltf) => {
        this.pendingLoads.delete(cacheKey);
        if (!this.renderer) return;

        gltf.scene.updateMatrixWorld(true);
        const rawParts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
        const box = new THREE.Box3();

        gltf.scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
          const geom = obj.geometry.clone();
          geom.applyMatrix4(obj.matrixWorld);
          geom.computeBoundingBox();
          if (geom.boundingBox) box.union(geom.boundingBox);

          const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          if (mat) {
            rawParts.push({ geometry: geom, material: mat });
          }
        });

        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 0.5);
        // Normalize every model to a clean 1.0 unit visual diameter scaled by mapVisualScale
        const normalizeScale = entry.mapVisualScale / maxDim;

        const batches: PrimitiveBatch[] = rawParts.map(({ geometry, material }) => {
          const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
          mesh.frustumCulled = false;
          mesh.count = 0;
          this.scene.add(mesh);
          return { mesh, count: 0 };
        });

        const tpl: LoadedModelTemplate = {
          entryId: entry.id,
          lod,
          normalizeScale,
          batches,
          rawParts,
        };
        this.templates.set(cacheKey, tpl);
        this.metrics.loadedGlbCount = Array.from(this.templates.keys()).filter((k) =>
          CAMPAIGN_READY_GLB_ENTRIES.some((e) => k.startsWith(`${e.id}:`))
        ).length;

        if (lod === 'lod2') {
          this.lod2LoadedCount += 1;
          if (this.lod2LoadedCount === CAMPAIGN_READY_GLB_ENTRIES.length) {
            this.initialLod2LoadMs = Math.round((performance.now() - this.lod2StartTime) * 10) / 10;
            this.metrics.initialLod2LoadMs = this.initialLod2LoadMs;
          }
        }

        // Bake a studio-lit 3/4 portrait from the first loaded LOD (upgrades cleanly on lod1!)
        if (!this.portraitCache.has(entry.id) || lod === 'lod1') {
          this.bakePortrait(entry, tpl);
        }
      },
      undefined,
      () => {
        this.pendingLoads.delete(cacheKey);
      }
    );
  }

  private bakePortrait(entry: CampaignUnitVisualEntry, tpl: LoadedModelTemplate): void {
    if (!this.renderer || this.contextLost) return;
    const pw = 144;
    const ph = 96;
    const target = new THREE.WebGLRenderTarget(pw, ph, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    const pScene = new THREE.Scene();
    pScene.environment = this.scene.environment;
    pScene.add(new THREE.AmbientLight(0xfffef2, 1.15));
    pScene.add(new THREE.HemisphereLight(0xfffbe8, 0x6c7d66, 2.45));
    const pSun = new THREE.DirectionalLight(0xfff6dc, 3.0);
    pSun.position.set(4, 6.5, 5.5);
    pScene.add(pSun);
    const pRim = new THREE.DirectionalLight(0xbbe0f8, 1.55);
    pRim.position.set(-5, 3.5, 3);
    pScene.add(pRim);

    const group = new THREE.Group();
    const box = new THREE.Box3();
    for (const part of tpl.rawParts) {
      const m = new THREE.Mesh(part.geometry, part.material);
      group.add(m);
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
    }
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.5);
    const s = 1.95 / maxDim;
    group.scale.setScalar(s);
    group.position.set(-center.x * s, -center.y * s - 0.08, -center.z * s);
    group.rotation.y = entry.faction === 'NORTH' ? 0.62 : -0.62;
    pScene.add(group);

    // Subtle ground disc
    const baseRing = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 24),
      new THREE.MeshBasicMaterial({
        color: entry.faction === 'NORTH' ? 0x5c2c24 : 0x244057,
        transparent: true,
        opacity: 0.48,
      })
    );
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = -center.y * s - 0.08;
    pScene.add(baseRing);

    const pCam = new THREE.PerspectiveCamera(32, pw / ph, 0.1, 30);
    pCam.position.set(0, 1.55, 3.65);
    pCam.lookAt(0, -0.04, 0);

    const prevTarget = this.renderer.getRenderTarget();
    const prevClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(pScene, pCam);

    const pixels = new Uint8Array(pw * ph * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, pw, ph, pixels);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearAlpha(prevClearAlpha);
    target.dispose();

    const c2d = document.createElement('canvas');
    c2d.width = pw;
    c2d.height = ph;
    const ctx2d = c2d.getContext('2d');
    if (ctx2d) {
      const imgData = ctx2d.createImageData(pw, ph);
      // Flip Y from WebGL bottom-left to Canvas top-left
      for (let row = 0; row < ph; row += 1) {
        const srcOff = (ph - 1 - row) * pw * 4;
        const dstOff = row * pw * 4;
        imgData.data.set(pixels.subarray(srcOff, srcOff + pw * 4), dstOff);
      }
      ctx2d.putImageData(imgData, 0, 0);
      const dataUrl = c2d.toDataURL('image/png');
      this.portraitCache.set(entry.id, dataUrl);
      this.metrics.portraitsCached = this.portraitCache.size;
      this.onPortraitReadyCb?.(entry.id, dataUrl);
    }
  }

  public getPortraitUrl(
    faction: CampaignVisualFaction,
    unitKey: CampaignUnitKey,
    learned: readonly string[] = []
  ): string | null {
    const entry = resolveCampaignUnitVisual(faction, unitKey, learned);
    return this.portraitCache.get(entry.id) ?? null;
  }

  public isWebGLActive(): boolean {
    return Boolean(this.renderer && !this.contextLost && this.enabled);
  }

  public setEnabled(flag: boolean): void {
    this.enabled = Boolean(flag);
    this.metrics.enabled = this.enabled;
    this.canvas.style.display = this.enabled && this.isWebGLActive() ? 'block' : 'none';
    if (!this.enabled && this.renderer && !this.contextLost) {
      this.renderer.clear();
    }
  }

  public simulateContextLossForTest(): boolean {
    if (!this.renderer) return false;
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (ext) {
      ext.loseContext();
      return true;
    }
    this.handleContextLost(new Event('webglcontextlost'));
    return true;
  }

  public simulateContextRestoreForTest(): boolean {
    if (!this.renderer) return false;
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (ext) {
      ext.restoreContext();
      return true;
    }
    this.handleContextRestored();
    return true;
  }

  public resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.min(2, Math.max(1, dpr || 1));

    this.camera.left = 0;
    this.camera.right = this.width;
    this.camera.top = this.height;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();

    if (this.renderer && !this.contextLost) {
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
    }
  }

  public renderFrame(
    units: readonly RenderableUnitInput[],
    zoom: number,
    nowMs: number,
    capturePulses: readonly CapturePulseInput[] = []
  ): VisualPerformanceMetrics {
    const activeLod = selectVisualLodForZoom(zoom);
    this.metrics.zoom = Math.round(zoom * 100) / 100;
    this.metrics.activeLod = activeLod;
    this.metrics.visibleUnits = units.length;

    const nowPerf = performance.now();
    if (this.lastRenderTs > 0) {
      const dt = nowPerf - this.lastRenderTs;
      if (dt > 0 && dt < 2000) {
        this.frameTimes.push(dt);
        if (this.frameTimes.length > 45) this.frameTimes.shift();
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.metrics.avgFrameMs = Math.round(avg * 10) / 10;
        this.metrics.fps = avg > 0 ? Math.min(240, Math.round(1000 / avg)) : 60;
      }
    }
    this.lastRenderTs = nowPerf;

    if (!this.renderer || this.contextLost || !this.enabled) {
      this.canvas.style.display = 'none';
      this.metrics.drawCalls = 0;
      this.metrics.triangles = 0;
      this.metrics.rendered3dInstances = 0;
      return this.metrics;
    }

    if (activeLod === 'SYMBOL') {
      this.canvas.style.display = 'none';
      this.metrics.drawCalls = 0;
      this.metrics.triangles = 0;
      this.metrics.rendered3dInstances = 0;
      return this.metrics;
    }

    this.canvas.style.display = 'block';

    // Reset all instance counters cleanly (zero allocations!)
    for (const tpl of this.templates.values()) {
      for (const b of tpl.batches) b.count = 0;
    }
    let shadowCount = 0;
    let ringCount = 0;
    let flashCount = 0;
    let smokeCount = 0;
    let pulseCount = 0;
    let total3dInstances = 0;

    const targetLod: CampaignVisualLod =
      activeLod === 'LOD0' ? 'lod0' : activeLod === 'LOD1' ? 'lod1' : 'lod2';
    // Scale 3D military figures gracefully with map zoom (clamped for sharp readability)
    const basePxSize = Math.max(26, Math.min(58, 17 + zoom * 10.5));
    const tSec = nowMs * 0.001;

    for (const u of units) {
      if (u.x < -55 || u.x > this.width + 55 || u.y < -55 || u.y > this.height + 55) {
        continue;
      }

      const entry = resolveCampaignUnitVisual(u.faction, u.key, u.learned);
      if (entry.glbStatus === 'READY') {
        this.ensureLoaded(entry, targetLod);
        if (targetLod !== 'lod2') this.ensureLoaded(entry, 'lod2');
      }

      // Select best already-loaded LOD without pop-out flicker
      const tpl =
        this.templates.get(`${entry.id}:${targetLod}`) ??
        this.templates.get(`${entry.id}:lod1`) ??
        this.templates.get(`${entry.id}:lod2`) ??
        this.templates.get(`${entry.id}:lod0`);
      if (!tpl) continue;

      const seed = hashUnitSeed(u.id);
      const defaultYaw = u.faction === 'NORTH' ? 0.45 : -2.65;
      const targetYaw =
        u.moving && (Math.abs(u.dx) > 0.001 || Math.abs(u.dy) > 0.001)
          ? Math.atan2(u.dx, u.dy)
          : defaultYaw;

      const yawKey = String(u.id);
      const prevYaw = this.smoothedYaw.get(yawKey) ?? targetYaw;
      let deltaYaw = targetYaw - prevYaw;
      while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
      while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
      const yaw = prevYaw + deltaYaw * 0.25;
      this.smoothedYaw.set(yawKey, yaw);

      const screenY = this.height - u.y;
      const depthZ = (u.y / Math.max(1, this.height)) * 120 - 60;
      const unitScale = basePxSize * tpl.normalizeScale;
      const isAir = u.key === 'fighter';
      const airLiftY = isAir ? 15 + Math.sin(tSec * 3.4 + seed * 10) * 2.2 : 0;

      // Ground contact shadow disc
      if (this.shadowMesh && shadowCount < MAX_INSTANCES) {
        const sRad = basePxSize * (u.key === 'tank' ? 0.56 : isAir ? 0.42 : 0.48);
        this.dummyObj.position.set(u.x, screenY - 2, depthZ - 14);
        this.dummyObj.rotation.set(0, 0, 0);
        this.dummyObj.scale.set(sRad, sRad * 0.58, 1);
        this.dummyObj.updateMatrix();
        this.shadowMesh.setMatrixAt(shadowCount, this.dummyObj.matrix);
        shadowCount += 1;
      }

      // Selection / Faction / Combat base ring
      if (this.ringMesh && ringCount < MAX_INSTANCES) {
        const pulse = u.selected
          ? 1.06 + Math.sin(tSec * 6.0) * 0.08
          : u.inCombat
            ? 1.04 + Math.sin(tSec * 10.0 + seed * 6) * 0.1
            : 1.0;
        const rRad = basePxSize * (u.selected ? 0.62 : 0.48) * pulse;
        this.dummyObj.position.set(u.x, screenY - 1.5, depthZ - 12);
        this.dummyObj.rotation.set(0, 0, 0);
        this.dummyObj.scale.set(rRad, rRad * 0.58, 1);
        this.dummyObj.updateMatrix();
        this.ringMesh.setMatrixAt(ringCount, this.dummyObj.matrix);
        if (u.selected) this.tempColor.setHex(0xffdf6b);
        else if (u.inCombat) this.tempColor.setHex(0xff5a36);
        else if (u.faction === 'NORTH') this.tempColor.setHex(0xd9483b);
        else this.tempColor.setHex(0x3a95d8);
        this.ringMesh.setColorAt(ringCount, this.tempColor);
        ringCount += 1;
      }

      // Render 3D unit formation (3 soldiers for infantry squad, 1 hero model for vehicles)
      const count = entry.formationCount > 1 && activeLod !== 'LOD2' ? entry.formationCount : entry.formationCount > 1 ? 2 : 1;
      const recoil = u.inCombat ? Math.max(0, Math.sin(tSec * 11 + seed * 12)) * 2.6 : 0;

      for (let f = 0; f < count; f += 1) {
        const off = count > 1 ? INFANTRY_OFFSETS[f % INFANTRY_OFFSETS.length] : [0, 0];
        const strideBob = u.moving
          ? Math.abs(Math.sin(tSec * (entry.formationCount > 1 ? 9.5 : 13.0) + seed * 9 + f * 2.1)) *
            (entry.formationCount > 1 ? 2.4 : 1.1)
          : 0;
        const fx = u.x + off[0] * basePxSize * 0.52 - Math.sin(yaw) * recoil;
        const fy = screenY + off[1] * basePxSize * 0.32 + strideBob + airLiftY + Math.cos(yaw) * recoil * 0.5;
        const fScale = count > 1 ? unitScale * 0.68 : unitScale;

        this.yawQuat.setFromAxisAngle(this.yAxis, yaw);
        this.tempQuat.copy(this.tiltQuat).multiply(this.yawQuat);
        this.tempPos.set(fx, fy, depthZ + f * 0.2);
        this.tempScale.set(fScale, fScale, fScale);
        this.tempMat.compose(this.tempPos, this.tempQuat, this.tempScale);

        for (const batch of tpl.batches) {
          if (batch.count >= MAX_INSTANCES) continue;
          batch.mesh.setMatrixAt(batch.count, this.tempMat);
          batch.count += 1;
        }
        total3dInstances += 1;
      }

      // Combat muzzle flash / explosion burst
      if (u.inCombat && this.flashMesh && flashCount < MAX_INSTANCES) {
        const burst = Math.sin(tSec * 14 + seed * 20);
        if (burst > 0.1) {
          const fSize = (3.5 + burst * 4.8) * (basePxSize / 34);
          this.dummyObj.position.set(
            u.x + Math.sin(yaw) * basePxSize * 0.42,
            screenY + 8 + airLiftY - Math.cos(yaw) * basePxSize * 0.22,
            depthZ + 18
          );
          this.dummyObj.rotation.set(tSec * 4, tSec * 6, 0);
          this.dummyObj.scale.setScalar(fSize);
          this.dummyObj.updateMatrix();
          this.flashMesh.setMatrixAt(flashCount, this.dummyObj.matrix);
          this.tempColor.setHex(burst > 0.65 ? 0xfff0a6 : 0xff7326);
          this.flashMesh.setColorAt(flashCount, this.tempColor);
          flashCount += 1;
        }
      }

      // Damaged smoke puff when HP < 65%
      if (u.maxHp > 0 && u.hp / u.maxHp < 0.65 && this.smokeMesh && smokeCount < MAX_INSTANCES) {
        const cycle = (tSec * 0.85 + seed * 5) % 1;
        const sRad = (3.2 + cycle * 4.5) * (basePxSize / 36);
        this.dummyObj.position.set(
          u.x + Math.sin(tSec * 2 + seed * 8) * 3.5,
          screenY + 8 + cycle * 16 + airLiftY,
          depthZ + 16
        );
        this.dummyObj.rotation.set(0, 0, 0);
        this.dummyObj.scale.setScalar(sRad);
        this.dummyObj.updateMatrix();
        this.smokeMesh.setMatrixAt(smokeCount, this.dummyObj.matrix);
        smokeCount += 1;
      }
    }

    // City capture shockwave pulses
    if (this.pulseMesh) {
      for (const p of capturePulses) {
        if (pulseCount >= 32) break;
        const age = (nowMs - p.startedAt) / 1400;
        if (age < 0 || age > 1) continue;
        const radius = 10 + age * 46;
        this.dummyObj.position.set(p.x, this.height - p.y, 85);
        this.dummyObj.rotation.set(0, 0, 0);
        this.dummyObj.scale.set(radius, radius * 0.68, 1);
        this.dummyObj.updateMatrix();
        this.pulseMesh.setMatrixAt(pulseCount, this.dummyObj.matrix);
        this.tempColor.setHex(p.friendly ? 0xffe066 : 0xff5442);
        this.pulseMesh.setColorAt(pulseCount, this.tempColor);
        pulseCount += 1;
      }
      this.pulseMesh.count = pulseCount;
      this.pulseMesh.instanceMatrix.needsUpdate = true;
      if (this.pulseMesh.instanceColor) this.pulseMesh.instanceColor.needsUpdate = true;
    }

    // Flush dirty instance buffers
    for (const tpl of this.templates.values()) {
      for (const b of tpl.batches) {
        b.mesh.count = b.count;
        if (b.count > 0) b.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.shadowMesh) {
      this.shadowMesh.count = shadowCount;
      if (shadowCount > 0) this.shadowMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.ringMesh) {
      this.ringMesh.count = ringCount;
      if (ringCount > 0) {
        this.ringMesh.instanceMatrix.needsUpdate = true;
        if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
      }
    }
    if (this.flashMesh) {
      this.flashMesh.count = flashCount;
      if (flashCount > 0) {
        this.flashMesh.instanceMatrix.needsUpdate = true;
        if (this.flashMesh.instanceColor) this.flashMesh.instanceColor.needsUpdate = true;
      }
    }
    if (this.smokeMesh) {
      this.smokeMesh.count = smokeCount;
      if (smokeCount > 0) this.smokeMesh.instanceMatrix.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);

    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.triangles = this.renderer.info.render.triangles;
    this.metrics.geometries = this.renderer.info.memory.geometries;
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.rendered3dInstances = total3dInstances;
    return this.metrics;
  }

  public dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.renderer?.dispose();
    this.renderer = null;
  }
}

// Expose global factory for the campaign map bridge script
declare global {
  interface Window {
    VDNUnit3DEngine?: {
      CampaignUnit3DOverlay: typeof CampaignUnit3DOverlay;
      manifest: typeof CAMPAIGN_UNIT_ASSET_MANIFEST;
      lodThresholds: typeof CAMPAIGN_VISUAL_LOD_THRESHOLDS;
      resolveUnitVisual: typeof resolveCampaignUnitVisual;
      selectVisualLodForZoom: typeof selectVisualLodForZoom;
    };
  }
}

if (typeof window !== 'undefined') {
  window.VDNUnit3DEngine = {
    CampaignUnit3DOverlay,
    manifest: CAMPAIGN_UNIT_ASSET_MANIFEST,
    lodThresholds: CAMPAIGN_VISUAL_LOD_THRESHOLDS,
    resolveUnitVisual: resolveCampaignUnitVisual,
    selectVisualLodForZoom,
  };
}
