import { MAP_TOKENS } from './designTokens';

/**
 * Multi-Level Camera System (P02-06E).
 * Pure semantic zoom classification, theater presets, bounds protection,
 * and session camera persistence helpers.
 */

export type SemanticZoomLevel = 1 | 2 | 3 | 4 | 5;

export interface SemanticZoomDescriptor {
  readonly level: SemanticZoomLevel;
  readonly code: `L${SemanticZoomLevel}`;
  readonly labelVi: string;
  readonly summaryVi: string;
  readonly showSecondaryRoads: boolean;
  readonly showMinorRivers: boolean;
  readonly showTownLabels: boolean;
  readonly showRegionCodes: boolean;
  readonly showPeaks: boolean;
  readonly enableDetailedCities: boolean;
  readonly enableTerrainInspectionPitch: boolean;
}

export interface CameraSnapshot {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export type CameraPresetId =
  | 'INDOCHINA_OVERVIEW'
  | 'VIETNAM_NATIONAL'
  | 'NORTH_VIETNAM'
  | 'CENTRAL_VIETNAM'
  | 'SOUTH_VIETNAM'
  | 'CAPITAL_NORTH'
  | 'CAPITAL_SOUTH';

export interface CameraPreset {
  readonly id: CameraPresetId;
  readonly labelVi: string;
  readonly shortLabel: string;
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly pitch: number;
  readonly bearing: number;
}

/** Playable geographic bounding box preventing the camera from ever losing the theater */
export const PLAYABLE_MAX_BOUNDS: readonly [readonly [number, number], readonly [number, number]] = [
  [88.0, 3.0],
  [124.0, 29.0],
];

export const VIETNAM_THEATER_BOUNDS: readonly [readonly [number, number], readonly [number, number]] = [
  [101.6, 8.35],
  [110.2, 23.45],
];

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    id: 'INDOCHINA_OVERVIEW',
    labelVi: 'Toàn cảnh Đông Dương (L1)',
    shortLabel: 'Đông Dương',
    center: [105.6, 15.8],
    zoom: 4.55,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'VIETNAM_NATIONAL',
    labelVi: 'Toàn quốc 72 vùng (L2)',
    shortLabel: 'Toàn quốc',
    center: [106.1, 16.05],
    zoom: 5.25,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'NORTH_VIETNAM',
    labelVi: 'Miền Bắc & Đồng bằng Sông Hồng',
    shortLabel: 'Miền Bắc',
    center: [105.6, 21.15],
    zoom: 7.05,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'CENTRAL_VIETNAM',
    labelVi: 'Miền Trung & Tây Nguyên',
    shortLabel: 'Miền Trung',
    center: [107.65, 15.65],
    zoom: 7.0,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'SOUTH_VIETNAM',
    labelVi: 'Miền Nam & Châu thổ Cửu Long',
    shortLabel: 'Miền Nam',
    center: [106.25, 10.65],
    zoom: 7.25,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'CAPITAL_NORTH',
    labelVi: 'Thủ đô Phương Bắc — Hà Nội',
    shortLabel: 'Hà Nội',
    center: [105.85, 21.03],
    zoom: 7.75,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'CAPITAL_SOUTH',
    labelVi: 'Thủ đô Phương Nam — Sài Gòn',
    shortLabel: 'Sài Gòn',
    center: [106.7, 10.78],
    zoom: 7.75,
    pitch: 0,
    bearing: 0,
  },
];

export const SEMANTIC_ZOOM_SPECS: Readonly<Record<SemanticZoomLevel, SemanticZoomDescriptor>> = {
  1: {
    level: 1,
    code: 'L1',
    labelVi: 'Cấp 1 · Toàn cảnh Khu vực',
    summaryVi: 'Toàn Đông Dương, tên quốc gia, biên giới lớn, đô thị trọng yếu',
    showSecondaryRoads: false,
    showMinorRivers: false,
    showTownLabels: false,
    showRegionCodes: false,
    showPeaks: false,
    enableDetailedCities: false,
    enableTerrainInspectionPitch: false,
  },
  2: {
    level: 2,
    code: 'L2',
    labelVi: 'Cấp 2 · Toàn cảnh Quốc gia',
    summaryVi: '72 vùng chiến lược, kiểm soát chính trị, trục đường chính & sông lớn',
    showSecondaryRoads: false,
    showMinorRivers: false,
    showTownLabels: false,
    showRegionCodes: false,
    showPeaks: false,
    enableDetailedCities: false,
    enableTerrainInspectionPitch: false,
  },
  3: {
    level: 3,
    code: 'L3',
    labelVi: 'Cấp 3 · Tầm nhìn Cấp vùng',
    summaryVi: 'Địa hình chi tiết, mã vùng, tuyến giao thông phụ & đặc điểm địa lý',
    showSecondaryRoads: true,
    showMinorRivers: true,
    showTownLabels: true,
    showRegionCodes: true,
    showPeaks: true,
    enableDetailedCities: false,
    enableTerrainInspectionPitch: false,
  },
  4: {
    level: 4,
    code: 'L4',
    labelVi: 'Cấp 4 · Tầm nhìn Chiến thuật Địa phương',
    summaryVi: 'Biểu tượng đô thị chi tiết, chỉ dấu hạ tầng & lớp hiển thị quân sự tương lai',
    showSecondaryRoads: true,
    showMinorRivers: true,
    showTownLabels: true,
    showRegionCodes: true,
    showPeaks: true,
    enableDetailedCities: true,
    enableTerrainInspectionPitch: false,
  },
  5: {
    level: 5,
    code: 'L5',
    labelVi: 'Cấp 5 · Kiểm định Địa hình',
    summaryVi: 'Độ nghiêng camera tùy chọn, bóng đổ địa hình chi tiết & địa thế nổi 2.5D',
    showSecondaryRoads: true,
    showMinorRivers: true,
    showTownLabels: true,
    showRegionCodes: true,
    showPeaks: true,
    enableDetailedCities: true,
    enableTerrainInspectionPitch: true,
  },
};

export function classifySemanticZoom(zoom: number): SemanticZoomDescriptor {
  if (zoom <= MAP_TOKENS.zoom.level1Max) return SEMANTIC_ZOOM_SPECS[1];
  if (zoom <= MAP_TOKENS.zoom.level2Max) return SEMANTIC_ZOOM_SPECS[2];
  if (zoom <= MAP_TOKENS.zoom.level3Max) return SEMANTIC_ZOOM_SPECS[3];
  if (zoom <= MAP_TOKENS.zoom.level4Max) return SEMANTIC_ZOOM_SPECS[4];
  return SEMANTIC_ZOOM_SPECS[5];
}

export function clampCameraSnapshot(
  camera: CameraSnapshot,
  maxPitch = 42
): CameraSnapshot {
  const [minLon, minLat] = PLAYABLE_MAX_BOUNDS[0];
  const [maxLon, maxLat] = PLAYABLE_MAX_BOUNDS[1];
  const lon = Math.min(maxLon, Math.max(minLon, Number.isFinite(camera.center[0]) ? camera.center[0] : 106.1));
  const lat = Math.min(maxLat, Math.max(minLat, Number.isFinite(camera.center[1]) ? camera.center[1] : 16.05));
  const zoom = Math.min(
    MAP_TOKENS.zoom.max,
    Math.max(MAP_TOKENS.zoom.min, Number.isFinite(camera.zoom) ? camera.zoom : 5.45)
  );
  const pitch = Math.min(
    maxPitch,
    Math.max(0, Number.isFinite(camera.pitch) ? camera.pitch : 0)
  );
  const rawBearing = Number.isFinite(camera.bearing) ? camera.bearing : 0;
  const bearing = ((rawBearing + 180) % 360 + 360) % 360 - 180;

  return {
    center: [Number(lon.toFixed(4)), Number(lat.toFixed(4))],
    zoom: Number(zoom.toFixed(2)),
    bearing: Number(bearing.toFixed(1)),
    pitch: Number(pitch.toFixed(1)),
  };
}

/**
 * In-memory session camera cache (survives React remounts during current browser session
 * without touching persistent storage or leaking auth data).
 */
let sessionCameraCache: CameraSnapshot | null = null;

export function saveSessionCamera(camera: CameraSnapshot, maxPitch = 42): CameraSnapshot {
  sessionCameraCache = clampCameraSnapshot(camera, maxPitch);
  return sessionCameraCache;
}

export function loadSessionCamera(): CameraSnapshot | null {
  return sessionCameraCache;
}

export function clearSessionCamera(): void {
  sessionCameraCache = null;
}

export function getCameraPresetById(id: CameraPresetId): CameraPreset {
  return CAMERA_PRESETS.find((p) => p.id === id) ?? CAMERA_PRESETS[1];
}
