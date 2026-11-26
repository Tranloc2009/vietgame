import { FilteredClientMatchView, WorldPeak } from '../../contracts';
import { WorldMapFeature, WorldMapGeoJson } from '../roomApi';

/**
 * Cartographic Terrain Relief & Dynamic Political Boundary Engine (P02-06D & P02-06F).
 *
 * IMPORTANT TRANSPARENCY NOTE (Section 06):
 * Because continuous 30m raster DEM tile pyramids are not bundled in this offline-first
 * hermetic runtime, this module synthesizes a 2D cartographic hillshade visual approximation
 * from the verified NASA SRTM 90m elevation samples (72 regional anchor points + 6 mountain peaks)
 * using inverse-distance interpolation and Horn NW-315° slope illumination.
 * It is explicitly labeled as a cartographic visual approximation derived from SRTM 90m anchors,
 * never presented as a raw continuous DEM elevation model.
 */

export const HILLSHADE_BOUNDS: readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
] = [
  [101.6, 23.6], // Top-Left [lon, lat]
  [110.2, 23.6], // Top-Right
  [110.2, 8.2],  // Bottom-Right
  [101.6, 8.2],  // Bottom-Left
];

export const HILLSHADE_PROVENANCE_NOTICE =
  'Bóng đổ địa hình 2D (Cartographic Hillshade Approximation) được nội suy từ 72 điểm độ cao vùng & 6 đỉnh núi NASA SRTM 90m Public Domain — không thay thế mô hình DEM liên tục độ phân giải cao.';

interface ElevationSample {
  readonly lon: number;
  readonly lat: number;
  readonly elev: number;
  readonly weight: number;
}

/**
 * Generates an offscreen Canvas PNG Data URL representing NW-315° cartographic shaded relief
 * interpolated from the verified SRTM 90m region & peak anchors.
 * Returns null safely in non-DOM/Node environments.
 */
export function generateSrtmHillshadeDataUrl(
  geojson: WorldMapGeoJson,
  peaks: readonly WorldPeak[],
  width = 220,
  height = 380
): string | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const samples: ElevationSample[] = [
    ...geojson.features.map((f) => ({
      lon: f.properties.centroid[0],
      lat: f.properties.centroid[1],
      elev: f.properties.elevationMeters * 0.72 + f.properties.elevationPeakMeters * 0.28,
      weight: 1.0,
    })),
    ...peaks.map((pk) => ({
      lon: pk.coords[0],
      lat: pk.coords[1],
      elev: pk.elevationMeters,
      weight: 1.6,
    })),
  ];

  const minLon = HILLSHADE_BOUNDS[0][0];
  const maxLon = HILLSHADE_BOUNDS[1][0];
  const maxLat = HILLSHADE_BOUNDS[0][1];
  const minLat = HILLSHADE_BOUNDS[2][1];

  const grid = new Float32Array(width * height);
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;

  // IDW interpolation (power 2.4) over verified SRTM anchors
  for (let y = 0; y < height; y += 1) {
    const lat = maxLat - (y / (height - 1)) * latSpan;
    for (let x = 0; x < width; x += 1) {
      const lon = minLon + (x / (width - 1)) * lonSpan;
      let num = 0;
      let den = 0;
      let minDistSq = Infinity;

      for (let i = 0; i < samples.length; i += 1) {
        const s = samples[i];
        const dx = lon - s.lon;
        const dy = lat - s.lat;
        const distSq = dx * dx + dy * dy + 0.018;
        if (distSq < minDistSq) minDistSq = distSq;
        const w = s.weight / (distSq * Math.sqrt(distSq));
        num += s.elev * w;
        den += w;
      }

      // Gently fade relief far away from Vietnam anchor points
      const falloff = minDistSq > 1.2 ? Math.max(0.25, 1.4 - minDistSq * 0.45) : 1.0;
      grid[y * width + x] = (den > 0 ? num / den : 0) * falloff;
    }
  }

  // Compute NW-315° hillshade using Sobel/Horn kernel
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const azimuthRad = (315 * Math.PI) / 180;
  const altitudeRad = (44 * Math.PI) / 180;
  const zenithRad = Math.PI / 2 - altitudeRad;
  const zFactor = 0.0022; // Restrained vertical exaggeration (never cartoonish)

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const tl = grid[(y - 1) * width + (x - 1)];
      const tc = grid[(y - 1) * width + x];
      const tr = grid[(y - 1) * width + (x + 1)];
      const ml = grid[y * width + (x - 1)];
      const mr = grid[y * width + (x + 1)];
      const bl = grid[(y + 1) * width + (x - 1)];
      const bc = grid[(y + 1) * width + x];
      const br = grid[(y + 1) * width + (x + 1)];

      const dzdx = ((tr + 2 * mr + br) - (tl + 2 * ml + bl)) * zFactor;
      const dzdy = ((bl + 2 * bc + br) - (tl + 2 * tc + tr)) * zFactor;

      const slopeRad = Math.atan(Math.hypot(dzdx, dzdy));
      const aspectRad = Math.atan2(dzdy, -dzdx);

      const shade =
        Math.cos(zenithRad) * Math.cos(slopeRad) +
        Math.sin(zenithRad) * Math.sin(slopeRad) * Math.cos(azimuthRad - aspectRad);

      const clamped = Math.max(0, Math.min(1, shade));
      // Warm sunlit ridge highlights + cool umber shadow slopes
      const idx = (y * width + x) * 4;
      const centerElev = grid[y * width + x];
      const reliefStrength = Math.min(1, centerElev / 520);

      if (clamped >= 0.56) {
        // Sunlit warm highlight
        const alpha = Math.min(82, Math.round((clamped - 0.56) * 190 * reliefStrength));
        data[idx] = 248;
        data[idx + 1] = 238;
        data[idx + 2] = 214;
        data[idx + 3] = alpha;
      } else {
        // Shadowed topographic umber slope
        const alpha = Math.min(126, Math.round((0.56 - clamped) * 240 * (0.35 + reliefStrength * 0.65)));
        data[idx] = 26;
        data[idx + 1] = 23;
        data[idx + 2] = 19;
        data[idx + 3] = alpha;
      }
    }
  }

  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = width;
  shadeCanvas.height = height;
  const shadeCtx = shadeCanvas.getContext('2d');
  if (!shadeCtx) return null;
  shadeCtx.putImageData(img, 0, 0);

  // Strictly mask shaded relief to Vietnam's 72 verified Natural Earth region polygons
  // so zero hillshade bleeds onto the East Sea or neighboring countries.
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  for (const feature of geojson.features) {
    for (const ring of feature.geometry.coordinates) {
      for (let i = 0; i < ring.length; i += 1) {
        const px = ((ring[i][0] - minLon) / lonSpan) * (width - 1);
        const py = ((maxLat - ring[i][1]) / latSpan) * (height - 1);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
  ctx.fill();

  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(shadeCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Dynamic Political Boundary Extractor (Section 09).
 * Computes national borders strictly from authoritative match state (`match.regions` controllerNationId)
 * rather than hardcoding faction borders into static geometry!
 * Separates:
 *  - Internal regional boundaries (shared edge between two regions with SAME controller)
 *  - National / Faction boundaries (shared edge between two regions with DIFFERENT controllers)
 */
export interface PoliticalBorderSegmentFeature {
  readonly type: 'Feature';
  readonly properties: {
    readonly borderKind: 'NATIONAL_FACTION_BORDER' | 'NPC_FRONTIER_BORDER';
    readonly nationA: string;
    readonly nationB: string;
  };
  readonly geometry: {
    readonly type: 'LineString';
    readonly coordinates: readonly [readonly [number, number], readonly [number, number]];
  };
}

export interface PoliticalBordersGeoJson {
  readonly type: 'FeatureCollection';
  readonly features: readonly PoliticalBorderSegmentFeature[];
}

function quantizeCoord(c: readonly [number, number]): string {
  return `${Math.round(c[0] * 10000)},${Math.round(c[1] * 10000)}`;
}

function edgeKey(a: readonly [number, number], b: readonly [number, number]): string {
  const ka = quantizeCoord(a);
  const kb = quantizeCoord(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export function extractDynamicNationalBorders(
  features: readonly WorldMapFeature[],
  match: FilteredClientMatchView | null
): PoliticalBordersGeoJson {
  const seenEdges = new Map<
    string,
    {
      controller: string;
      a: readonly [number, number];
      b: readonly [number, number];
    }
  >();

  const borderSegments: PoliticalBorderSegmentFeature[] = [];

  for (const f of features) {
    const controller =
      match?.regions[f.properties.regionId]?.controllerNationId ??
      f.properties.initialControllerNationId;
    const ring = f.geometry.coordinates[0];
    if (!ring || ring.length < 2) continue;

    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      const key = edgeKey(a, b);
      const existing = seenEdges.get(key);
      if (!existing) {
        seenEdges.set(key, { controller, a, b });
      } else if (existing.controller !== controller) {
        const isHumanVsHuman =
          (existing.controller === 'nat_north_dir' && controller === 'nat_south_rep') ||
          (existing.controller === 'nat_south_rep' && controller === 'nat_north_dir');

        borderSegments.push({
          type: 'Feature',
          properties: {
            borderKind: isHumanVsHuman ? 'NATIONAL_FACTION_BORDER' : 'NPC_FRONTIER_BORDER',
            nationA: existing.controller,
            nationB: controller,
          },
          geometry: {
            type: 'LineString',
            coordinates: [a, b],
          },
        });
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features: borderSegments,
  };
}
