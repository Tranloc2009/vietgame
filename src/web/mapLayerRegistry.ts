import {
  FilteredClientMatchView,
  MapLayerMode,
  PlannedFutureLayerMode,
  TerrainFeatureTag,
  TerrainKind,
  TransportKind,
} from '../contracts';
import { WorldMapFeature } from './roomApi';

export interface ActiveLayerDescriptor {
  readonly id: MapLayerMode;
  readonly label: string;
  readonly shortDesc: string;
  readonly implemented: true;
}

export interface PlannedLayerDescriptor {
  readonly id: PlannedFutureLayerMode;
  readonly label: string;
  readonly targetPhase: string;
  readonly implemented: false;
}

export const ACTIVE_MAP_LAYERS: readonly ActiveLayerDescriptor[] = [
  {
    id: 'POLITICAL',
    label: 'Chính trị',
    shortDesc: 'Kiểm soát lãnh thổ 2 phe Bắc/Nam & 2 chính quyền NPC độc lập',
    implemented: true,
  },
  {
    id: 'TERRAIN',
    label: 'Địa hình & Độ cao',
    shortDesc: 'Địa hình tự nhiên & độ cao thực NASA SRTM 90m',
    implemented: true,
  },
  {
    id: 'ECONOMY',
    label: 'Kinh tế',
    shortDesc: 'Sản lượng kinh tế trừu tượng theo vùng',
    implemented: true,
  },
  {
    id: 'INFRASTRUCTURE',
    label: 'Hạ tầng',
    shortDesc: 'Năng lực hạ tầng & mạng giao thông hư cấu 1955',
    implemented: true,
  },
];

/**
 * Extensible layer slots prepared for future roadmap phases (P02-05 architecture prep).
 * Exposed strictly as non-interactive architectural metadata — zero premature combat/weather logic.
 */
export const PLANNED_FUTURE_MAP_LAYERS: readonly PlannedLayerDescriptor[] = [
  { id: 'MILITARY', label: 'Quân sự', targetPhase: 'Roadmap sau P03', implemented: false },
  { id: 'WEATHER', label: 'Thời tiết', targetPhase: 'Roadmap sau P03', implemented: false },
  {
    id: 'POLITICAL_INFLUENCE',
    label: 'Ảnh hưởng chính trị',
    targetPhase: 'Roadmap sau P03',
    implemented: false,
  },
];

export const TERRAIN_LABELS: Readonly<Record<TerrainKind, string>> = {
  URBAN_CORE: 'Đô thị trọng điểm',
  COASTAL_DELTA: 'Đồng bằng ven biển',
  RIVER_BASIN: 'Đồng bằng châu thổ / Sông',
  JUNGLE_CORRIDOR: 'Rừng rậm / Hành lang',
  HIGHLANDS: 'Cao nguyên / Đồi núi',
  MOUNTAIN_PASS: 'Núi cao / Đèo hiểm trở',
};

export const TERRAIN_FEATURE_LABELS: Readonly<Record<TerrainFeatureTag, string>> = {
  MOUNTAIN: 'Núi',
  HILLS: 'Đồi',
  PLAIN: 'Đồng bằng',
  FOREST: 'Rừng',
  RIVER: 'Sông',
  COAST: 'Bờ biển',
  URBAN: 'Đô thị',
};

export const TRANSPORT_LABELS: Readonly<Record<TransportKind, string>> = {
  PRIMARY_ROAD: 'Đường chính (1955 hư cấu)',
  SECONDARY_ROAD: 'Đường phụ địa hình',
  RAILWAY: 'Đường sắt trục',
  RIVER_CROSSING: 'Kết nối vượt sông / Phà',
};

export const NATION_LABELS: Readonly<Record<string, string>> = {
  nat_north_dir: 'Liên Minh Phương Bắc (Bắc)',
  nat_south_rep: 'Cộng Hòa Phương Nam (Nam)',
  nat_npc_highland: 'Hội Đồng Cao Nguyên (NPC)',
  nat_npc_border: 'Liên Minh Biên Giới (NPC)',
};

export function computeRegionFillColor(
  feature: WorldMapFeature,
  layer: MapLayerMode,
  match: FilteredClientMatchView | null
): string {
  const liveRegion = match?.regions[feature.properties.regionId];
  const controller = liveRegion?.controllerNationId ?? feature.properties.initialControllerNationId;
  const infraVal = (liveRegion?.infrastructureFp ?? feature.properties.infrastructureFp) / 1000;
  const econVal = feature.properties.economicOutputFp / 1000;
  const elev = feature.properties.elevationMeters;

  if (layer === 'POLITICAL') {
    switch (controller) {
      case 'nat_north_dir':
        return '#A64B3C';
      case 'nat_south_rep':
        return '#335D7E';
      case 'nat_npc_highland':
        return '#A88A4E';
      case 'nat_npc_border':
        return '#6C7D63';
      default:
        return '#8D99AE';
    }
  }

  if (layer === 'TERRAIN') {
    if (feature.properties.terrain === 'URBAN_CORE') return '#666B75';
    if (elev >= 900) return '#7E644E';
    if (elev >= 550) return '#9A8261';
    if (elev >= 220) {
      return feature.properties.terrain === 'JUNGLE_CORRIDOR' ? '#6D8860' : '#B5A178';
    }
    if (feature.properties.terrain === 'JUNGLE_CORRIDOR') return '#769168';
    if (feature.properties.terrain === 'COASTAL_DELTA') return '#B3C69E';
    return '#C6D4A7';
  }

  if (layer === 'ECONOMY') {
    if (econVal >= 80) return '#22543D';
    if (econVal >= 65) return '#4C8B6C';
    if (econVal >= 45) return '#93BDA5';
    return '#D5E4DA';
  }

  // INFRASTRUCTURE
  if (infraVal >= 70) return '#58442E';
  if (infraVal >= 55) return '#8F7756';
  if (infraVal >= 40) return '#C3B398';
  return '#E4DDD0';
}

export function buildLegendItems(layer: MapLayerMode): readonly { label: string; color: string }[] {
  if (layer === 'POLITICAL') {
    return [
      { label: 'Phương Bắc (Human)', color: '#A64B3C' },
      { label: 'Phương Nam (Human)', color: '#335D7E' },
      { label: 'Cao Nguyên (NPC)', color: '#A88A4E' },
      { label: 'Biên Giới (NPC)', color: '#6C7D63' },
      { label: 'Lãnh thổ lân cận', color: '#DCD7CA' },
    ];
  }
  if (layer === 'TERRAIN') {
    return [
      { label: 'Núi cao (>=900m)', color: '#7E644E' },
      { label: 'Đồi núi (220–899m)', color: '#B5A178' },
      { label: 'Rừng rậm', color: '#6D8860' },
      { label: 'Đồng bằng / Sông', color: '#C6D4A7' },
      { label: 'Ven biển', color: '#B3C69E' },
      { label: 'Đô thị', color: '#666B75' },
    ];
  }
  if (layer === 'ECONOMY') {
    return [
      { label: 'Cao (>= 80)', color: '#22543D' },
      { label: 'Khá (65–79)', color: '#4C8B6C' },
      { label: 'Trung bình (45–64)', color: '#93BDA5' },
      { label: 'Thấp (< 45)', color: '#D5E4DA' },
    ];
  }
  return [
    { label: 'Phát triển (>= 70)', color: '#58442E' },
    { label: 'Khá (55–69)', color: '#8F7756' },
    { label: 'Cơ bản (40–54)', color: '#C3B398' },
    { label: 'Hạn chế (< 40)', color: '#E4DDD0' },
  ];
}
