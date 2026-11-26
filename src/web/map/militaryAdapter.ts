import { FilteredClientMatchView } from '../../contracts';

/**
 * Future Military Rendering Foundation (Section 14).
 * Extensible visualization contract & original SVG icon descriptors for future phases.
 *
 * STRICT INVARIANT:
 * - Zero combat calculations or military AI logic.
 * - Zero fake live units in production.
 * - Strictly consumes authorized server projections (`FilteredClientMatchView`)
 *   and respects `redactedUnitIds` fog-of-war redaction.
 */

export type MilitaryUnitVisualClass =
  | 'INFANTRY'
  | 'ARMORED'
  | 'MECHANIZED'
  | 'ARTILLERY'
  | 'AIRCRAFT'
  | 'NAVAL'
  | 'HEADQUARTERS'
  | 'LOGISTICS'
  | 'UNIT_GROUP';

export interface ProjectedMilitaryEntity {
  readonly unitId: string;
  readonly ownerNationId: string;
  readonly regionId: string;
  readonly visualClass: MilitaryUnitVisualClass;
  readonly isRedactedByFogOfWar: boolean;
  readonly strengthDisplay: string | null;
  readonly movementArrow: {
    readonly targetRegionId: string;
    readonly estimatedArrivalUtc: number;
  } | null;
}

export interface MilitaryIconDescriptor {
  readonly visualClass: MilitaryUnitVisualClass;
  readonly labelVi: string;
  /** Original geometric SVG path data inside a 24x16 tactical counter viewBox */
  readonly svgSymbolPath: string;
}

export const MILITARY_ICON_REGISTRY: Readonly<Record<MilitaryUnitVisualClass, MilitaryIconDescriptor>> = {
  INFANTRY: {
    visualClass: 'INFANTRY',
    labelVi: 'Bộ binh',
    svgSymbolPath: 'M3 3 L21 13 M21 3 L3 13',
  },
  ARMORED: {
    visualClass: 'ARMORED',
    labelVi: 'Thiết giáp',
    svgSymbolPath: 'M7 5 H17 A3 3 0 0 1 17 11 H7 A3 3 0 0 1 7 5 Z',
  },
  MECHANIZED: {
    visualClass: 'MECHANIZED',
    labelVi: 'Cơ giới hóa',
    svgSymbolPath: 'M3 3 L21 13 M21 3 L3 13 M8 5 H16 A2.5 2.5 0 0 1 16 11 H8 A2.5 2.5 0 0 1 8 5 Z',
  },
  ARTILLERY: {
    visualClass: 'ARTILLERY',
    labelVi: 'Pháo binh',
    svgSymbolPath: 'M12 5.5 A2.5 2.5 0 1 0 12 10.5 A2.5 2.5 0 1 0 12 5.5 Z',
  },
  AIRCRAFT: {
    visualClass: 'AIRCRAFT',
    labelVi: 'Không quân',
    svgSymbolPath: 'M5 5 L12 8 L19 5 L12 11 Z',
  },
  NAVAL: {
    visualClass: 'NAVAL',
    labelVi: 'Hải quân',
    svgSymbolPath: 'M12 3 V12 M8 9 C8 12 16 12 16 9 M9 5 H15',
  },
  HEADQUARTERS: {
    visualClass: 'HEADQUARTERS',
    labelVi: 'Bộ chỉ huy',
    svgSymbolPath: 'M6 3 V13 M6 3 H17 L14 6.5 L17 10 H6',
  },
  LOGISTICS: {
    visualClass: 'LOGISTICS',
    labelVi: 'Hậu cần trừu tượng',
    svgSymbolPath: 'M5 8 H19 M12 4 V12',
  },
  UNIT_GROUP: {
    visualClass: 'UNIT_GROUP',
    labelVi: 'Cụm đơn vị',
    svgSymbolPath: 'M4 5 H18 V12 H4 Z M7 3 H20 V10',
  },
};

/**
 * Projects authorized server units into safe rendering descriptors.
 * Never fabricates units when `match` is null; never exposes redacted enemy stats.
 */
export function projectAuthorizedMilitaryEntities(
  match: FilteredClientMatchView | null
): readonly ProjectedMilitaryEntity[] {
  if (!match) return [];
  const redactedSet = new Set(match.redactedUnitIds);

  return Object.values(match.units).map((u) => {
    const isRedacted = redactedSet.has(u.unitId);
    const visualClass: MilitaryUnitVisualClass =
      u.category === 'LOGISTICS_ABSTRACT' ? 'HEADQUARTERS' : 'LOGISTICS';

    return {
      unitId: u.unitId,
      ownerNationId: u.ownerNationId,
      regionId: u.regionId,
      visualClass,
      isRedactedByFogOfWar: isRedacted,
      strengthDisplay: isRedacted ? null : `${Math.round((u.strengthFp as number) / 1000)}`,
      movementArrow: null,
    };
  });
}
