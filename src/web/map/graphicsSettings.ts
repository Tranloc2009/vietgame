/**
 * Graphics Quality Presets & Cosmetic Weather/Atmosphere Adapter (P02-06H).
 * Strictly visual — graphics settings and cosmetic atmosphere NEVER alter
 * authoritative gameplay state or simulation outcomes.
 */

export type GraphicsQualityPreset = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface GraphicsQualityConfig {
  readonly preset: GraphicsQualityPreset;
  readonly labelVi: string;
  readonly descriptionVi: string;
  readonly hillshadeEnabled: boolean;
  readonly reliefContourTint: boolean;
  readonly coastalShadingRings: boolean;
  readonly graticuleEnabled: boolean;
  readonly allowPitch: boolean;
  readonly maxPitch: number;
  readonly relief25DExtrusion: boolean;
  readonly labelDensity: 'minimal' | 'standard' | 'detailed' | 'full';
  readonly riverDetail: 'major-only' | 'all';
  readonly cosmeticAtmosphereAllowed: boolean;
  readonly maxLabelCount: number;
}

export const GRAPHICS_PRESETS: Readonly<Record<GraphicsQualityPreset, GraphicsQualityConfig>> = {
  LOW: {
    preset: 'LOW',
    labelVi: 'Thấp (LOW)',
    descriptionVi: 'Địa hình giản lược 2D, giảm mật độ nhãn, tắt bóng đổ để ưu tiên tốc độ di động',
    hillshadeEnabled: false,
    reliefContourTint: false,
    coastalShadingRings: false,
    graticuleEnabled: false,
    allowPitch: false,
    maxPitch: 0,
    relief25DExtrusion: false,
    labelDensity: 'minimal',
    riverDetail: 'major-only',
    cosmeticAtmosphereAllowed: false,
    maxLabelCount: 24,
  },
  MEDIUM: {
    preset: 'MEDIUM',
    labelVi: 'Trung bình (MEDIUM)',
    descriptionVi: 'Địa hình tiêu chuẩn, bóng đổ SRTM 2D cân bằng, mật độ nhãn đầy đủ',
    hillshadeEnabled: true,
    reliefContourTint: true,
    coastalShadingRings: true,
    graticuleEnabled: true,
    allowPitch: false,
    maxPitch: 0,
    relief25DExtrusion: false,
    labelDensity: 'standard',
    riverDetail: 'all',
    cosmeticAtmosphereAllowed: true,
    maxLabelCount: 52,
  },
  HIGH: {
    preset: 'HIGH',
    labelVi: 'Cao (HIGH)',
    descriptionVi: 'Bóng đổ SRTM tăng cường, dải ven biển nhiều lớp, cho phép nghiêng camera 2.5D',
    hillshadeEnabled: true,
    reliefContourTint: true,
    coastalShadingRings: true,
    graticuleEnabled: true,
    allowPitch: true,
    maxPitch: 36,
    relief25DExtrusion: false,
    labelDensity: 'detailed',
    riverDetail: 'all',
    cosmeticAtmosphereAllowed: true,
    maxLabelCount: 84,
  },
  ULTRA: {
    preset: 'ULTRA',
    labelVi: 'Tối đa (ULTRA)',
    descriptionVi: 'Dành cho máy tính bàn: bóng đổ SRTM chi tiết, nghiêng 2.5D có nổi địa hình nhẹ',
    hillshadeEnabled: true,
    reliefContourTint: true,
    coastalShadingRings: true,
    graticuleEnabled: true,
    allowPitch: true,
    maxPitch: 42,
    relief25DExtrusion: true,
    labelDensity: 'full',
    riverDetail: 'all',
    cosmeticAtmosphereAllowed: true,
    maxLabelCount: 110,
  },
};

export interface DeviceCapabilityHints {
  readonly viewportWidth: number;
  readonly coarsePointer: boolean;
  readonly hardwareConcurrency?: number;
  readonly deviceMemoryGb?: number;
  readonly prefersReducedMotion?: boolean;
}

/**
 * Pure deterministic auto-selection of a sensible initial graphics preset.
 * Uses responsive dimensions and pointer capability rather than user-agent sniffing.
 */
export function selectInitialGraphicsPreset(hints: DeviceCapabilityHints): GraphicsQualityPreset {
  if (hints.prefersReducedMotion) return 'LOW';

  const cores = hints.hardwareConcurrency ?? 4;
  const mem = hints.deviceMemoryGb ?? 4;

  if (hints.coarsePointer || hints.viewportWidth < 768) {
    if (cores <= 2 || mem <= 2) return 'LOW';
    return 'MEDIUM';
  }

  if (hints.viewportWidth < 1100 || cores <= 4 || mem <= 4) {
    return 'MEDIUM';
  }

  return 'HIGH';
}

export function detectBrowserGraphicsPreset(): GraphicsQualityPreset {
  if (typeof window === 'undefined') return 'MEDIUM';
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const prefersReducedMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return selectInitialGraphicsPreset({
    viewportWidth: window.innerWidth,
    coarsePointer,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory,
    prefersReducedMotion,
  });
}

/**
 * Weather & Atmosphere Visual Adapter Foundation (Section 18).
 * Cosmetic-only foundation; actual weather simulation belongs to a future roadmap phase.
 */
export type CosmeticWeatherVisualState = 'CLEAR' | 'CLOUD_COVER' | 'FOG' | 'RAIN' | 'STORM';

export interface WeatherAtmosphereAdapterConfig {
  readonly enabled: boolean;
  readonly visualState: CosmeticWeatherVisualState;
  readonly simulationImplemented: false;
  readonly gameplayEffect: 'NONE_COSMETIC_ONLY';
}

export const DEFAULT_WEATHER_ADAPTER_CONFIG: WeatherAtmosphereAdapterConfig = {
  enabled: false,
  visualState: 'CLEAR',
  simulationImplemented: false,
  gameplayEffect: 'NONE_COSMETIC_ONLY',
};

export const WEATHER_VISUAL_LABELS: Readonly<Record<CosmeticWeatherVisualState, string>> = {
  CLEAR: 'Quang đãng (Mặc định)',
  CLOUD_COVER: 'Mây cao (Minh họa bề mặt)',
  FOG: 'Sương mù vùng núi (Minh họa bề mặt)',
  RAIN: 'Mưa nhẹ (Minh họa bề mặt)',
  STORM: 'Áp thấp nhiệt đới (Minh họa bề mặt)',
};
