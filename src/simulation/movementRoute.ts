import mapData from "../content/geo/vietnam72WorldData.json";
import { RegionId, Region } from '../contracts';

const BASE_EDGE_DURATION_MS = 10 * 60_000;
const FP_SCALE = 1000;
const terrainCosts = new Map(mapData.regions.map(r=>[r.regionId,r.movementCostFp]));
const network = mapData.transportCorridors;
export function scenarioRoute(regions: Readonly<Record<string,Region>>,origin:RegionId,destination:RegionId,owner:Region['controllerNationId']){
  return planMovementRoute(regions,terrainCosts,network,origin,destination,owner);
}

export interface MovementRoute {
  readonly regionIds: readonly RegionId[];
  readonly durationMs: number;
  readonly arrivalsMs: readonly number[];
}

/** Route exclusively over the scenario's own, friendly land graph. No coordinates or unit intel. */
export function planMovementRoute(
  regions: Readonly<Record<string, Region>>,
  terrainCostByRegion: ReadonlyMap<string, number>,
  corridors: ReadonlyArray<{fromRegionId:string;toRegionId:string;movementModifierFp:number}>,
  originId: RegionId,
  destinationId: RegionId,
  ownerNationId: Region['controllerNationId']
): MovementRoute | null {
  if (
    originId === destinationId ||
    regions[originId]?.controllerNationId !== ownerNationId ||
    regions[destinationId]?.controllerNationId !== ownerNationId
  ) return null;

  const edgeKey = (a: string, b: string) => a < b ? `${a}/${b}` : `${b}/${a}`;
  const modifiers = new Map<string, number>();
  for (const corridor of corridors) {
    const key = edgeKey(corridor.fromRegionId, corridor.toRegionId);
    modifiers.set(key, Math.min(modifiers.get(key) ?? Infinity, corridor.movementModifierFp));
  }

  const pending = Object.keys(regions)
    .map((id) => regions[id])
    .filter((region) => region.controllerNationId === ownerNationId)
    .map((region) => region.regionId)
    .sort();
  const best = new Map<RegionId, MovementRoute>([[originId, { regionIds: [originId], durationMs: 0, arrivalsMs: [] }]]);
  const visited = new Set<RegionId>();

  while (pending.length > 0) {
    let index = -1;
    let lowest = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const cost = best.get(pending[i])?.durationMs ?? Infinity;
      if (cost < lowest) {
        index = i;
        lowest = cost;
      }
    }
    if (index < 0) break;
    const [currentId] = pending.splice(index, 1);
    const current = best.get(currentId)!;
    if (currentId === destinationId) return current;
    visited.add(currentId);

    for (const neighborId of regions[currentId].adjacentRegionIds) {
      if (visited.has(neighborId) || regions[neighborId]?.controllerNationId !== ownerNationId) continue;
      const terrain = terrainCostByRegion.get(neighborId) ?? FP_SCALE;
      const modifier = modifiers.get(edgeKey(currentId, neighborId)) ?? FP_SCALE;
      const durationMs = current.durationMs +
        Math.ceil(BASE_EDGE_DURATION_MS * terrain * modifier / FP_SCALE ** 2);
      if (durationMs < (best.get(neighborId)?.durationMs ?? Infinity)) {
        best.set(neighborId, { regionIds: [...current.regionIds, neighborId], durationMs, arrivalsMs: [...current.arrivalsMs,durationMs] });
      }
    }
  }
  return null;
}
