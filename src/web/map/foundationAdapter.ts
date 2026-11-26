import {
  asFixedPoint,
  ClientMatchView,
  FilteredClientMatchView,
  Region,
  RegionId,
  Unit,
} from '../../contracts';
import { WorldMapFeature } from '../roomApi';

/**
 * Foundation Match Adapter (P02-06 / StrategicMap).
 * Pure helper that integrates live authoritative `foundationMatch` (`ClientMatchView`)
 * with the 72-region MapLibre GL strategic map when no multiplayer room match is active,
 * while giving strict precedence to an active multiplayer room (`FilteredClientMatchView`).
 */

export type MatchDataSourceKind = 'ROOM_LIVE' | 'FOUNDATION_LIVE' | 'STATIC_GEO';

export type StrategicZoneKey =
  | 'NORTH_SECTOR'
  | 'CENTRAL_FRONTIER'
  | 'HIGHLAND_NEUTRAL'
  | 'SOUTH_SECTOR';

/** Canonical mapping from 72-region strategic zones to the 4 P01 foundation macro-regions */
export const FOUNDATION_ZONE_TO_REGION_ID: Readonly<Record<StrategicZoneKey, string>> = {
  NORTH_SECTOR: 'reg_north_delta',
  CENTRAL_FRONTIER: 'reg_central_pass',
  HIGHLAND_NEUTRAL: 'reg_highland_plateau',
  SOUTH_SECTOR: 'reg_south_basin',
};

/** Canonical 72-region anchor for each P01 foundation macro-region (for live unit placement) */
export const FOUNDATION_REGION_TO_ANCHOR_72: Readonly<Record<string, string>> = {
  reg_north_delta: 'reg_vn_11',       // Hà Nội — Trung Tâm Châu Thổ Hồng
  reg_central_pass: 'reg_vn_31',      // Đồng Hới — Vịnh Nhật Lệ
  reg_highland_plateau: 'reg_vn_42',  // Pleiku — Cao Nguyên Gia Lai
  reg_south_basin: 'reg_vn_59',       // Sài Gòn — Đô Thành Nam Bộ
};

const FOUNDATION_BASELINE_FP: Readonly<
  Record<string, { readonly infraFp: number; readonly supplyFp: number; readonly owner: string }>
> = {
  reg_north_delta: { infraFp: 60_000, supplyFp: 100_000, owner: 'nat_north_dir' },
  reg_central_pass: { infraFp: 45_000, supplyFp: 70_000, owner: 'nat_north_dir' },
  reg_highland_plateau: { infraFp: 40_000, supplyFp: 60_000, owner: 'nat_npc_highland' },
  reg_south_basin: { infraFp: 62_000, supplyFp: 105_000, owner: 'nat_south_rep' },
};

export interface ResolvedMapMatch {
  readonly effectiveMatch: FilteredClientMatchView | null;
  readonly sourceKind: MatchDataSourceKind;
  readonly foundationRegionMap: ReadonlyMap<string, Region>;
}

function clampNonNegativeFp(value: number) {
  return asFixedPoint(Math.max(0, Math.round(value)));
}

/**
 * Resolves the authoritative match state consumed by StrategicMap (MapLibre GL & SVG fallback).
 * Priority:
 *  1. Active Multiplayer Room (`roomMatch` — `ROOM_LIVE`)
 *  2. Live Server Foundation Match (`foundationMatch` — `FOUNDATION_LIVE`)
 *     - Direct 1:1 region projection if `foundationMatch` already uses 72 `reg_vn_*` IDs
 *     - Sector-level projection + delta overlay + unit anchoring if `foundationMatch` is the 4-region P01 fixture
 *  3. Static 1955 geographic baseline (`STATIC_GEO`)
 */
export function resolveMapMatchData(
  roomMatch: FilteredClientMatchView | null | undefined,
  foundationMatch: ClientMatchView | null | undefined,
  features: readonly WorldMapFeature[]
): ResolvedMapMatch {
  if (roomMatch) {
    return {
      effectiveMatch: roomMatch,
      sourceKind: 'ROOM_LIVE',
      foundationRegionMap: new Map(),
    };
  }

  if (!foundationMatch || features.length === 0) {
    return {
      effectiveMatch: null,
      sourceKind: 'STATIC_GEO',
      foundationRegionMap: new Map(),
    };
  }

  const foundationRegionMap = new Map<string, Region>();

  // Case 1: Direct 1:1 region ID match (e.g., foundationMatch already contains reg_vn_* regions)
  const hasDirectWorldRegions = features.some((f) =>
    Boolean(foundationMatch.regions[f.properties.regionId])
  );
  if (hasDirectWorldRegions) {
    for (const f of features) {
      const r = foundationMatch.regions[f.properties.regionId];
      if (r) foundationRegionMap.set(f.properties.regionId, r);
    }
    return {
      effectiveMatch: {
        ...foundationMatch,
        viewerSlot: null,
        viewerNationId: null,
        redactedUnitIds: [],
      },
      sourceKind: 'FOUNDATION_LIVE',
      foundationRegionMap,
    };
  }

  // Case 2: 4-sector P01 foundation fixture (`reg_north_delta`, `reg_central_pass`, etc.)
  const projectedRegions: Record<string, Region> = {};
  for (const f of features) {
    const p = f.properties;
    const mappedSectorId = FOUNDATION_ZONE_TO_REGION_ID[p.zone as StrategicZoneKey];
    const sourceRegion = mappedSectorId ? foundationMatch.regions[mappedSectorId] : undefined;

    if (sourceRegion) {
      foundationRegionMap.set(p.regionId, sourceRegion);
      const baseline = FOUNDATION_BASELINE_FP[mappedSectorId];
      const ownerChangedInFoundation =
        baseline !== undefined && sourceRegion.controllerNationId !== baseline.owner;

      // Preserve distinct 4-faction 1955 geography at initial state, while immediately reflecting
      // any live controller change from foundationMatch commands.
      const effectiveController = ownerChangedInFoundation
        ? sourceRegion.controllerNationId
        : p.initialControllerNationId === 'nat_npc_border' ||
            (p.zone === 'CENTRAL_FRONTIER' && p.initialControllerNationId !== 'nat_north_dir')
          ? (p.initialControllerNationId as Region['controllerNationId'])
          : sourceRegion.controllerNationId;

      const infraDelta = baseline ? (sourceRegion.infrastructureFp as number) - baseline.infraFp : 0;
      const supplyDelta = baseline ? (sourceRegion.supplyCapacityFp as number) - baseline.supplyFp : 0;

      projectedRegions[p.regionId] = {
        regionId: p.regionId as RegionId,
        code: p.code,
        name: p.name,
        controllerNationId: effectiveController,
        adjacentRegionIds: p.adjacentRegionIds as RegionId[],
        supplyCapacityFp: clampNonNegativeFp((p.supplyCapacityFp as number) + supplyDelta),
        influenceFp: sourceRegion.influenceFp,
        infrastructureFp: clampNonNegativeFp((p.infrastructureFp as number) + infraDelta),
      };
    }
  }

  // Project live foundation units onto their geographically anchored 72-region IDs
  const projectedUnits: Record<string, Unit> = {};
  for (const [unitId, unit] of Object.entries(foundationMatch.units)) {
    const anchoredRegionId =
      (FOUNDATION_REGION_TO_ANCHOR_72[unit.regionId] as RegionId | undefined) ?? unit.regionId;
    projectedUnits[unitId] = {
      ...unit,
      regionId: anchoredRegionId,
    };
  }

  return {
    effectiveMatch: {
      ...foundationMatch,
      regions: projectedRegions,
      units: projectedUnits,
      viewerSlot: null,
      viewerNationId: null,
      redactedUnitIds: [],
    },
    sourceKind: 'FOUNDATION_LIVE',
    foundationRegionMap,
  };
}
