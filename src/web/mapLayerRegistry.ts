import {
  FilteredClientMatchView,
  MapLayerMode,
  PlannedFutureLayerMode,
  TerrainFeatureTag,
  TerrainKind,
  TransportKind,
} from '../contracts';
import { getFactionVisual, MAP_TOKENS } from './map/designTokens';
import { WorldMapFeature } from './roomApi';

/**
 * Map Mode Registry 2.0 (P02-06G).
 * Preserves 100% backwards compatibility with P02-04 & P02-05 exports while adding
 * formal mode metadata (data requirements, visibility, authorization, color scale,
 * zoom behavior, layer ordering, fallback behavior, and update strategy).
 */

export interface LegendItem {
  readonly label: string;
  readonly color: string;
}

export interface ActiveLayerDescriptor {
  readonly id: MapLayerMode;
  readonly label: string;
  readonly shortLabel: string;
  readonly shortcutKey: '1' | '2' | '3' | '4';
  readonly shortDesc: string;
  readonly implemented: true;
  readonly dataRequirements: readonly string[];
  readonly visibilityRules: string;
  readonly authorizationRules: 'PUBLIC_WORLD_OR_FILTERED_MATCH' | 'PUBLIC_WORLD_GEOGRAPHY';
  readonly terrainBlendOpacity: number;
  readonly zoomBehavior: string;
  readonly layerOrdering: readonly string[];
  readonly fallbackBehavior: string;
  readonly updateStrategy: 'INCREMENTAL_MATCH_DELTA' | 'STATIC_GEO_CACHE';
  readonly colorScale: readonly LegendItem[];
}

export type ExtendedFutureMapMode =
  | PlannedFutureLayerMode
  | 'POPULATION'
  | 'INTELLIGENCE'
  | 'DIPLOMATIC_RELATIONS'
  | 'SUPPLY'
  | 'CONSTRUCTION';

export interface PlannedLayerDescriptor {
  readonly id: PlannedFutureLayerMode;
  readonly label: string;
  readonly targetPhase: string;
  readonly implemented: false;
}

export interface FutureMapModeSpec {
  readonly id: ExtendedFutureMapMode;
  readonly label: string;
  readonly targetPhase: string;
  readonly dataRequirements: readonly string[];
  readonly authorizationRules: 'SERVER_FILTERED_FOG_OF_WAR' | 'SERVER_AUTHORITATIVE_ENGINE';
  readonly implemented: false;
}

export const ACTIVE_MAP_LAYERS: readonly ActiveLayerDescriptor[] = [
  {
    id: 'POLITICAL',
    label: 'Chính trị',
    shortLabel: 'Chính trị',
    shortcutKey: '1',
    shortDesc: 'Chủ quyền lãnh thổ 2 phe Bắc/Nam & 2 chính quyền NPC độc lập (để lộ địa hình nền)',
    implemented: true,
    dataRequirements: ['worldMap72.geojson', 'match.regions[].controllerNationId'],
    visibilityRules: 'Hiển thị ở mọi cấp zoom L1–L5; phủ bán trong suốt để giữ nguyên khối địa hình SRTM',
    authorizationRules: 'PUBLIC_WORLD_OR_FILTERED_MATCH',
    terrainBlendOpacity: 0.62,
    zoomBehavior: 'L1–L2 ưu tiên biên giới quốc gia; L3–L5 hiện rõ ranh giới nội vùng và mã vùng',
    layerOrdering: [
      'ocean',
      'context-countries',
      'terrain-base',
      'political-fill',
      'srtm-hillshade',
      'internal-borders',
      'national-borders',
      'rivers',
      'transport',
      'cities',
    ],
    fallbackBehavior: 'SVG vector sử dụng cùng bảng màu chủ quyền và ranh giới quốc gia động',
    updateStrategy: 'INCREMENTAL_MATCH_DELTA',
    colorScale: [
      { label: 'Phương Bắc (Human)', color: MAP_TOKENS.factions.nat_north_dir.fill },
      { label: 'Phương Nam (Human)', color: MAP_TOKENS.factions.nat_south_rep.fill },
      { label: 'Cao Nguyên (NPC)', color: MAP_TOKENS.factions.nat_npc_highland.fill },
      { label: 'Biên Giới (NPC)', color: MAP_TOKENS.factions.nat_npc_border.fill },
      { label: 'Lãnh thổ lân cận', color: MAP_TOKENS.context.landFill },
    ],
  },
  {
    id: 'TERRAIN',
    label: 'Địa hình & Độ cao',
    shortLabel: 'Địa hình',
    shortcutKey: '2',
    shortDesc: 'Phân loại địa hình tự nhiên & bóng đổ địa hình nội suy từ NASA SRTM 90m',
    implemented: true,
    dataRequirements: [
      'worldMap72.geojson',
      'region.terrain',
      'region.elevationMeters',
      'layers.peaks',
    ],
    visibilityRules: 'Hiển thị địa hình thuần khiết, bật nổi bật bóng đổ SRTM và 6 đỉnh núi tiêu biểu',
    authorizationRules: 'PUBLIC_WORLD_GEOGRAPHY',
    terrainBlendOpacity: 0.94,
    zoomBehavior: 'L1–L2 tổng quan dãy núi và đồng bằng; L3–L5 hiển thị đỉnh núi và địa thế 2.5D tùy chọn',
    layerOrdering: [
      'ocean',
      'context-countries',
      'terrain-base',
      'srtm-hillshade',
      'internal-borders',
      'rivers',
      'transport',
      'cities',
      'peaks',
    ],
    fallbackBehavior: 'SVG vector hiển thị phân tầng màu độ cao địa hình không cần WebGL',
    updateStrategy: 'STATIC_GEO_CACHE',
    colorScale: [
      { label: 'Núi cao (>= 900m)', color: MAP_TOKENS.terrain.mountainHigh },
      { label: 'Cao nguyên / Đồi (220–899m)', color: MAP_TOKENS.terrain.highlands },
      { label: 'Rừng rậm / Hành lang', color: MAP_TOKENS.terrain.forestCorridor },
      { label: 'Đồng bằng / Châu thổ', color: MAP_TOKENS.terrain.riverBasin },
      { label: 'Ven biển / Đầm lầy', color: MAP_TOKENS.terrain.coastalDelta },
      { label: 'Đô thị trọng điểm', color: MAP_TOKENS.terrain.urbanCore },
    ],
  },
  {
    id: 'ECONOMY',
    label: 'Kinh tế',
    shortLabel: 'Kinh tế',
    shortcutKey: '3',
    shortDesc: 'Sản lượng kinh tế trừu tượng theo 72 vùng (số nguyên cố định scale 1000)',
    implemented: true,
    dataRequirements: ['worldMap72.geojson', 'region.economicOutputFp'],
    visibilityRules: 'Tô phân cấp sản lượng kinh tế kèm bóng đổ địa hình nhẹ và ranh giới quốc gia',
    authorizationRules: 'PUBLIC_WORLD_OR_FILTERED_MATCH',
    terrainBlendOpacity: 0.78,
    zoomBehavior: 'Hiển thị đồng nhất L1–L5, nhấn mạnh trung tâm công-nông nghiệp ở L3+',
    layerOrdering: [
      'ocean',
      'context-countries',
      'economy-fill',
      'srtm-hillshade',
      'internal-borders',
      'national-borders',
      'rivers',
      'cities',
    ],
    fallbackBehavior: 'SVG vector áp dụng thang màu sản lượng kinh tế đồng bộ',
    updateStrategy: 'INCREMENTAL_MATCH_DELTA',
    colorScale: [
      { label: 'Cao (>= 80)', color: MAP_TOKENS.economy.tierHigh },
      { label: 'Khá (65–79)', color: MAP_TOKENS.economy.tierGood },
      { label: 'Trung bình (45–64)', color: MAP_TOKENS.economy.tierMedium },
      { label: 'Thấp (< 45)', color: MAP_TOKENS.economy.tierLow },
    ],
  },
  {
    id: 'INFRASTRUCTURE',
    label: 'Hạ tầng',
    shortLabel: 'Hạ tầng',
    shortcutKey: '4',
    shortDesc: 'Năng lực hạ tầng vùng & mạng 98 hành lang giao thông 4 cấp (hư cấu 1955)',
    implemented: true,
    dataRequirements: [
      'worldMap72.geojson',
      'match.regions[].infrastructureFp',
      'layers.transportCorridors',
    ],
    visibilityRules: 'Ưu tiên nổi bật 98 tuyến đường sắt, quốc lộ, đường phụ và kết nối vượt sông',
    authorizationRules: 'PUBLIC_WORLD_OR_FILTERED_MATCH',
    terrainBlendOpacity: 0.76,
    zoomBehavior: 'L2 hiện đường sắt & trục chính; L3–L5 mở toàn bộ đường phụ và vượt sông',
    layerOrdering: [
      'ocean',
      'context-countries',
      'infrastructure-fill',
      'srtm-hillshade',
      'internal-borders',
      'rivers',
      'transport-emphasized',
      'cities',
    ],
    fallbackBehavior: 'SVG vector hiển thị phân cấp hạ tầng và 4 kiểu nét giao thông tương đương',
    updateStrategy: 'INCREMENTAL_MATCH_DELTA',
    colorScale: [
      { label: 'Phát triển (>= 70)', color: MAP_TOKENS.infrastructure.tierHigh },
      { label: 'Khá (55–69)', color: MAP_TOKENS.infrastructure.tierGood },
      { label: 'Cơ bản (40–54)', color: MAP_TOKENS.infrastructure.tierMedium },
      { label: 'Hạn chế (< 40)', color: MAP_TOKENS.infrastructure.tierLow },
    ],
  },
];

/**
 * Preserved P02-05 export for compatibility.
 */
export const PLANNED_FUTURE_MAP_LAYERS: readonly PlannedLayerDescriptor[] = [
  { id: 'MILITARY', label: 'Quân sự', targetPhase: 'Giai đoạn 04 · Military Genesis', implemented: false },
  { id: 'WEATHER', label: 'Thời tiết', targetPhase: 'Giai đoạn 09 · Living Nation', implemented: false },
  {
    id: 'POLITICAL_INFLUENCE',
    label: 'Ảnh hưởng chính trị',
    targetPhase: 'Giai đoạn 05 · Political Awakening',
    implemented: false,
  },
];

/**
 * Full Map Mode Registry 2.0 roadmap catalog (Section 13).
 * Explicitly marked unavailable (`implemented: false`) until their authoritative server engines exist.
 */
export const FUTURE_MAP_MODES_REGISTRY: readonly FutureMapModeSpec[] = [
  {
    id: 'MILITARY',
    label: 'Quân sự',
    targetPhase: 'P04 · Military Genesis',
    dataRequirements: ['match.units', 'military.frontlines'],
    authorizationRules: 'SERVER_FILTERED_FOG_OF_WAR',
    implemented: false,
  },
  {
    id: 'SUPPLY',
    label: 'Hậu cần & Tiếp tế',
    targetPhase: 'P04 · Military Genesis',
    dataRequirements: ['supply.network', 'region.supplyCapacityFp'],
    authorizationRules: 'SERVER_FILTERED_FOG_OF_WAR',
    implemented: false,
  },
  {
    id: 'CONSTRUCTION',
    label: 'Xây dựng & Công trình',
    targetPhase: 'P03 · Economic Foundation',
    dataRequirements: ['match.jobs', 'construction.queue'],
    authorizationRules: 'SERVER_FILTERED_FOG_OF_WAR',
    implemented: false,
  },
  {
    id: 'POLITICAL_INFLUENCE',
    label: 'Ảnh hưởng chính trị',
    targetPhase: 'P05 · Political Awakening',
    dataRequirements: ['politics.influenceByFaction'],
    authorizationRules: 'SERVER_FILTERED_FOG_OF_WAR',
    implemented: false,
  },
  {
    id: 'DIPLOMATIC_RELATIONS',
    label: 'Quan hệ Ngoại giao',
    targetPhase: 'P07 · Cold War Diplomacy',
    dataRequirements: ['diplomacy.relations', 'match.treaties'],
    authorizationRules: 'SERVER_AUTHORITATIVE_ENGINE',
    implemented: false,
  },
  {
    id: 'INTELLIGENCE',
    label: 'Tình báo & Sương mù chiến tranh',
    targetPhase: 'P08 · Shadow Politics',
    dataRequirements: ['intel.visibilityMatrix'],
    authorizationRules: 'SERVER_FILTERED_FOG_OF_WAR',
    implemented: false,
  },
  {
    id: 'POPULATION',
    label: 'Dân cư & Nhân khẩu',
    targetPhase: 'P09 · Living Nation',
    dataRequirements: ['population.demographics'],
    authorizationRules: 'SERVER_AUTHORITATIVE_ENGINE',
    implemented: false,
  },
  {
    id: 'WEATHER',
    label: 'Thời tiết chiến trường',
    targetPhase: 'P09 · Living Nation',
    dataRequirements: ['weather.cells'],
    authorizationRules: 'SERVER_AUTHORITATIVE_ENGINE',
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
  nat_north_dir: MAP_TOKENS.factions.nat_north_dir.name,
  nat_south_rep: MAP_TOKENS.factions.nat_south_rep.name,
  nat_npc_highland: MAP_TOKENS.factions.nat_npc_highland.name,
  nat_npc_border: MAP_TOKENS.factions.nat_npc_border.name,
};

export function getActiveMapLayerDescriptor(layer: MapLayerMode): ActiveLayerDescriptor {
  return ACTIVE_MAP_LAYERS.find((l) => l.id === layer) ?? ACTIVE_MAP_LAYERS[0];
}

export function computeTerrainBaseColor(feature: WorldMapFeature): string {
  const elev = feature.properties.elevationMeters;
  if (feature.properties.terrain === 'URBAN_CORE') return MAP_TOKENS.terrain.urbanCore;
  if (elev >= 900) return MAP_TOKENS.terrain.mountainHigh;
  if (elev >= 550) return MAP_TOKENS.terrain.mountainSlope;
  if (elev >= 220) {
    return feature.properties.terrain === 'JUNGLE_CORRIDOR'
      ? MAP_TOKENS.terrain.forestCorridor
      : MAP_TOKENS.terrain.highlands;
  }
  if (feature.properties.terrain === 'JUNGLE_CORRIDOR') return MAP_TOKENS.terrain.forestCorridor;
  if (feature.properties.terrain === 'COASTAL_DELTA') {
    return feature.properties.forestCoverFp >= 350
      ? MAP_TOKENS.terrain.wetlandCoast
      : MAP_TOKENS.terrain.coastalDelta;
  }
  return feature.properties.hasMajorRiver
    ? MAP_TOKENS.terrain.riverBasin
    : MAP_TOKENS.terrain.agriculturalPlain;
}

export function computeRegionFillColor(
  feature: WorldMapFeature,
  layer: MapLayerMode,
  match: FilteredClientMatchView | null
): string {
  const liveRegion = match?.regions[feature.properties.regionId];
  const controller = liveRegion?.controllerNationId ?? feature.properties.initialControllerNationId;
  const infraVal = (liveRegion?.infrastructureFp ?? feature.properties.infrastructureFp) / 1000;
  const econVal = feature.properties.economicOutputFp / 1000;

  if (layer === 'POLITICAL') {
    return getFactionVisual(controller).fill;
  }

  if (layer === 'TERRAIN') {
    return computeTerrainBaseColor(feature);
  }

  if (layer === 'ECONOMY') {
    if (econVal >= 80) return MAP_TOKENS.economy.tierHigh;
    if (econVal >= 65) return MAP_TOKENS.economy.tierGood;
    if (econVal >= 45) return MAP_TOKENS.economy.tierMedium;
    return MAP_TOKENS.economy.tierLow;
  }

  // INFRASTRUCTURE
  if (infraVal >= 70) return MAP_TOKENS.infrastructure.tierHigh;
  if (infraVal >= 55) return MAP_TOKENS.infrastructure.tierGood;
  if (infraVal >= 40) return MAP_TOKENS.infrastructure.tierMedium;
  return MAP_TOKENS.infrastructure.tierLow;
}

export function buildLegendItems(layer: MapLayerMode): readonly LegendItem[] {
  return getActiveMapLayerDescriptor(layer).colorScale;
}
