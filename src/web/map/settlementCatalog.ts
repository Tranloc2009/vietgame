import { TransportCorridor, WorldCity } from '../../contracts';
import { WorldMapFeature } from '../roomApi';

/**
 * Hierarchical City & Settlement Catalog, Priority Collision Engine & Search (P02-06E).
 * Upgrades the existing 24 authoritative cities without altering IDs, coordinates,
 * or fabricating population/infrastructure statistics.
 */

export type SettlementCategory =
  | 'NATIONAL_CAPITAL'
  | 'MAJOR_CITY'
  | 'PORT_CITY'
  | 'TRANSPORT_HUB'
  | 'REGIONAL_CITY'
  | 'STRATEGIC_SETTLEMENT';

export interface EnrichedCity {
  readonly city: WorldCity;
  readonly category: SettlementCategory;
  readonly categoryLabelVi: string;
  readonly priority: number;
  readonly corridorCount: number;
  readonly hasRail: boolean;
  readonly regionName: string;
  readonly regionCode: string;
}

export const SETTLEMENT_CATEGORY_LABELS: Readonly<Record<SettlementCategory, string>> = {
  NATIONAL_CAPITAL: 'Thủ đô Quốc gia',
  MAJOR_CITY: 'Đô thị Trọng điểm',
  PORT_CITY: 'Thành phố Cảng',
  TRANSPORT_HUB: 'Đầu mối Giao thông',
  REGIONAL_CITY: 'Đô thị Cấp vùng',
  STRATEGIC_SETTLEMENT: 'Điểm dân cư Chiến lược',
};

/**
 * Deterministically classifies the 24 authoritative cities from existing fields
 * (`tier`, `port`, and connectivity in the authoritative 98-corridor graph).
 */
export function enrichSettlementCatalog(
  cities: readonly WorldCity[],
  corridors: readonly TransportCorridor[],
  featuresById: ReadonlyMap<string, WorldMapFeature>
): readonly EnrichedCity[] {
  const corridorCountByRegion = new Map<string, number>();
  const railRegions = new Set<string>();

  for (const c of corridors) {
    corridorCountByRegion.set(c.fromRegionId, (corridorCountByRegion.get(c.fromRegionId) ?? 0) + 1);
    corridorCountByRegion.set(c.toRegionId, (corridorCountByRegion.get(c.toRegionId) ?? 0) + 1);
    if (c.kind === 'RAILWAY') {
      railRegions.add(c.fromRegionId);
      railRegions.add(c.toRegionId);
    }
  }

  return cities.map((city) => {
    const corridorCount = corridorCountByRegion.get(city.regionId) ?? 0;
    const hasRail = railRegions.has(city.regionId);
    const feat = featuresById.get(city.regionId);

    let category: SettlementCategory;
    let priority: number;

    if (city.tier === 'CAPITAL') {
      category = 'NATIONAL_CAPITAL';
      priority = 100;
    } else if (city.port && city.tier === 'MAJOR') {
      category = 'PORT_CITY';
      priority = 86;
    } else if (city.tier === 'MAJOR') {
      category = 'MAJOR_CITY';
      priority = 82;
    } else if (city.port) {
      category = 'PORT_CITY';
      priority = 68;
    } else if (hasRail && corridorCount >= 4) {
      category = 'TRANSPORT_HUB';
      priority = 66;
    } else if (corridorCount >= 4) {
      category = 'REGIONAL_CITY';
      priority = 60;
    } else {
      category = 'STRATEGIC_SETTLEMENT';
      priority = 52;
    }

    return {
      city,
      category,
      categoryLabelVi: SETTLEMENT_CATEGORY_LABELS[category],
      priority,
      corridorCount,
      hasRail,
      regionName: feat?.properties.name ?? city.regionId,
      regionCode: feat?.properties.code ?? '',
    };
  });
}

export interface LabelCandidate {
  readonly key: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly priority: number;
  readonly kind: 'sea' | 'country' | 'capital' | 'port' | 'major-city' | 'town' | 'peak' | 'code';
  readonly cityId?: string;
  readonly regionId?: string;
  readonly selected?: boolean;
}

/**
 * Pure priority-ordered bounding-box collision resolver for crisp non-overlapping cartographic labels.
 */
export function resolveLabelCollisions(
  candidates: readonly LabelCandidate[],
  maxLabels: number
): readonly LabelCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.selected && !b.selected) return -1;
    if (!a.selected && b.selected) return 1;
    return b.priority - a.priority;
  });

  const placed: LabelCandidate[] = [];
  const boxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  for (const item of sorted) {
    if (placed.length >= maxLabels && !item.selected && item.kind !== 'capital') {
      continue;
    }
    const padX = item.kind === 'capital' ? 6 : 4;
    const padY = item.kind === 'capital' ? 4 : 3;
    const box = {
      x1: item.x - item.width / 2 - padX,
      y1: item.y - item.height / 2 - padY,
      x2: item.x + item.width / 2 + padX,
      y2: item.y + item.height / 2 + padY,
    };

    const overlaps = boxes.some(
      (b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2)
    );

    if (!overlaps || item.selected) {
      placed.push(item);
      boxes.push(box);
    }
  }

  return placed;
}

/**
 * Vietnamese diacritic-insensitive normalizer for searching cities and regions.
 */
export function normalizeVietnameseQuery(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

export interface MapSearchResult {
  readonly kind: 'city' | 'region';
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly regionId: string;
  readonly cityId?: string;
  readonly coords: readonly [number, number];
}

export function searchMapEntities(
  query: string,
  features: readonly WorldMapFeature[],
  cities: readonly EnrichedCity[],
  limit = 12
): readonly MapSearchResult[] {
  const q = normalizeVietnameseQuery(query);
  const results: Array<MapSearchResult & { score: number }> = [];

  for (const ec of cities) {
    const normName = normalizeVietnameseQuery(ec.city.name);
    const normCat = normalizeVietnameseQuery(ec.categoryLabelVi);
    const normCode = normalizeVietnameseQuery(ec.regionCode);
    if (!q || normName.includes(q) || normCat.includes(q) || normCode === q) {
      const exactPrefix = q && normName.startsWith(q) ? 50 : 0;
      results.push({
        kind: 'city',
        id: ec.city.id,
        title: ec.city.name,
        subtitle: `${ec.categoryLabelVi} · ${ec.regionCode}`,
        regionId: ec.city.regionId,
        cityId: ec.city.id,
        coords: ec.city.coords,
        score: ec.priority + exactPrefix + 20,
      });
    }
  }

  for (const f of features) {
    const p = f.properties;
    const normName = normalizeVietnameseQuery(p.name);
    const normCode = normalizeVietnameseQuery(p.code);
    const normId = normalizeVietnameseQuery(p.regionId);
    if (!q || normName.includes(q) || normCode.includes(q) || normId.includes(q)) {
      const exactCode = q && (normCode === q || normId === q) ? 120 : 0;
      const prefixBoost = q && normName.startsWith(q) ? 40 : 0;
      results.push({
        kind: 'region',
        id: p.regionId,
        title: `${p.code} · ${p.name}`,
        subtitle: `${p.regionId} · ${p.elevationMeters}m`,
        regionId: p.regionId,
        coords: p.centroid,
        score: 40 + exactCode + prefixBoost,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _s, ...rest }) => rest);
}
