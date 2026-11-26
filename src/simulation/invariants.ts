import {
  DomainEvent,
  MatchState,
  REALTIME_SECONDS_PER_GAME_DAY,
  ResourceLedger,
  ResourceType,
} from '../contracts';
import { EXTENDED_RESOURCE_TYPES } from './phase03Catalog';

const RESOURCE_KEYS: readonly ResourceType[] = [
  'food',
  'industrial',
  'treasury',
  'manpower',
  'politicalCapital',
];

export class SimulationInvariantError extends Error {
  public readonly code = 'SIMULATION_INVARIANT_VIOLATION' as const;
  public readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Simulation invariant violation(s): ${violations.join('; ')}`);
    this.name = 'SimulationInvariantError';
    this.violations = violations;
  }
}

export function sumResourceLedgers(ledgers: readonly ResourceLedger[]): Record<ResourceType, number> {
  const totals: Record<ResourceType, number> = {
    food: 0,
    industrial: 0,
    treasury: 0,
    manpower: 0,
    politicalCapital: 0,
  };
  for (const ledger of ledgers) {
    for (const key of RESOURCE_KEYS) {
      totals[key] += ledger[key] as number;
    }
  }
  return totals;
}

export function compareEventsDeterministically(a: DomainEvent, b: DomainEvent): number {
  const timeDiff = (a.occurredAtUtc as number) - (b.occurredAtUtc as number);
  if (timeDiff !== 0) return timeDiff;

  const prioDiff = a.tieBreakPriority - b.tieBreakPriority;
  if (prioDiff !== 0) return prioDiff;

  const seqDiff = a.sequence - b.sequence;
  if (seqDiff !== 0) return seqDiff;

  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * Verifies every project invariant on MatchState.
 * Throws SimulationInvariantError if any invariant is violated.
 */
export function assertSimulationInvariants(state: MatchState): void {
  const violations: string[] = [];

  // 1. Time invariants: strictly 24 real hours per in-game day, no fast-forward
  if (state.config.secondsPerGameDay !== REALTIME_SECONDS_PER_GAME_DAY) {
    violations.push(`secondsPerGameDay must be ${REALTIME_SECONDS_PER_GAME_DAY}`);
  }
  if (state.config.allowFastForward !== false) {
    violations.push('allowFastForward must be false');
  }
  if ((state.currentUtc as number) < (state.createdAtUtc as number)) {
    violations.push('currentUtc cannot precede createdAtUtc');
  }

  // 2. Exact two human slots (NORTH and SOUTH) + independent NPCs
  const actors = Object.values(state.actors);
  const humanActors = actors.filter((a) => a.role === 'HUMAN_PLAYER');
  if (humanActors.length !== 2) {
    violations.push(`Expected exactly 2 HUMAN_PLAYER actors, found ${humanActors.length}`);
  }
  const humanSlots = new Set(humanActors.map((a) => a.slot));
  if (!humanSlots.has('NORTH') || !humanSlots.has('SOUTH')) {
    violations.push('HUMAN_PLAYER actors must occupy exactly NORTH and SOUTH slots');
  }

  const nations = Object.values(state.nations);
  const northNations = nations.filter((n) => n.slot === 'NORTH');
  const southNations = nations.filter((n) => n.slot === 'SOUTH');
  if (northNations.length !== 1 || southNations.length !== 1) {
    violations.push('Match must have exactly 1 NORTH nation and 1 SOUTH nation');
  }

  for (const actor of actors) {
    if (actor.role === 'INDEPENDENT_NPC' && actor.slot !== 'NPC') {
      violations.push(`NPC actor ${actor.actorId} must have slot NPC`);
    }
    if (actor.nationId !== null && !state.nations[actor.nationId]) {
      violations.push(`Actor ${actor.actorId} references unknown nation ${actor.nationId}`);
    }
  }

  // 3. Referential integrity for regions and units
  for (const nation of nations) {
    if (!state.regions[nation.capitalRegionId]) {
      violations.push(`Nation ${nation.nationId} capital ${nation.capitalRegionId} missing`);
    }
  }
  for (const region of Object.values(state.regions)) {
    if (!state.nations[region.controllerNationId]) {
      violations.push(`Region ${region.regionId} controller ${region.controllerNationId} missing`);
    }
    for (const adj of region.adjacentRegionIds) {
      if (!state.regions[adj]) {
        violations.push(`Region ${region.regionId} adjacency ${adj} missing`);
      }
    }
  }
  for (const unit of Object.values(state.units)) {
    if (!state.nations[unit.ownerNationId]) {
      violations.push(`Unit ${unit.unitId} owner ${unit.ownerNationId} missing`);
    }
    if (!state.regions[unit.regionId]) {
      violations.push(`Unit ${unit.unitId} region ${unit.regionId} missing`);
    }
  }

  // 4. Resource conservation across all nations + reserved scheduled jobs + burned audit == initial + minted
  const activeLedgers: ResourceLedger[] = nations.map((n) => n.resources);
  for (const job of Object.values(state.jobs)) {
    if (job.status === 'SCHEDULED') {
      activeLedgers.push(job.reservedCost);
    }
  }
  const activeTotals = sumResourceLedgers(activeLedgers);

  for (const key of RESOURCE_KEYS) {
    const lhs = activeTotals[key] + (state.resourceAudit.burnedTotal[key] as number);
    const rhs =
      (state.resourceAudit.initialTotal[key] as number) +
      (state.resourceAudit.mintedTotal[key] as number);
    if (lhs !== rhs) {
      violations.push(
        `Resource conservation violated for "${key}": active+burned (${lhs}) !== initial+minted (${rhs})`
      );
    }
  }

  // 5. Event log deterministic ordering and sequence monotonicity
  for (let i = 0; i < state.events.length; i += 1) {
    const current = state.events[i];
    if (current.sequence !== i + 1) {
      violations.push(`Event ${current.eventId} sequence ${current.sequence} expected ${i + 1}`);
    }
    if (i > 0) {
      const prev = state.events[i - 1];
      if ((current.occurredAtUtc as number) < (prev.occurredAtUtc as number)) {
        violations.push(
          `Event ${current.eventId} timestamp ${current.occurredAtUtc} precedes ${prev.occurredAtUtc}`
        );
      }
      if (
        (current.occurredAtUtc as number) === (prev.occurredAtUtc as number) &&
        current.causedByCommandId === prev.causedByCommandId &&
        compareEventsDeterministically(prev, current) > 0
      ) {
        violations.push(
          `Simultaneous events ${prev.eventId} and ${current.eventId} out of deterministic order`
        );
      }
    }
  }

  if (state.eventSequence !== state.events.length) {
    violations.push(
      `eventSequence (${state.eventSequence}) does not match events.length (${state.events.length})`
    );
  }

  // 6. P03-01 Economic state & traceable ledger integrity (when initialized)
  if (state.economicState) {
    if ((state.economicState.lastSettlementUtc as number) > (state.currentUtc as number)) {
      violations.push(
        `economicState.lastSettlementUtc (${state.economicState.lastSettlementUtc}) exceeds currentUtc (${state.currentUtc})`
      );
    }
    for (const [nationId, rate] of Object.entries(state.economicState.taxRateBpsByNation)) {
      if (!state.nations[nationId]) {
        violations.push(`taxRateBpsByNation references unknown nation "${nationId}"`);
      }
      if (!Number.isInteger(rate) || rate < 1000 || rate > 4000) {
        violations.push(`taxRateBps for "${nationId}" out of valid range [1000, 4000]: ${rate}`);
      }
    }
  }

  if (state.economicLedger) {
    const seenTxnIds = new Set<string>();
    for (const entry of state.economicLedger) {
      if (seenTxnIds.has(entry.transactionId)) {
        violations.push(`Duplicate economic ledger transactionId "${entry.transactionId}"`);
      }
      seenTxnIds.add(entry.transactionId);
      if (!state.nations[entry.nationId]) {
        violations.push(
          `Economic ledger entry "${entry.transactionId}" references unknown nation "${entry.nationId}"`
        );
      }
    }
  }

  // 7. Phase 03 (P03-01 / P03-02 / P03-03) 8-resource conservation, bounded credit, reservations & facilities
  if (state.phase03Economy) {
    const p03 = state.phase03Economy;
    if ((p03.lastSettlementUtc as number) > (state.currentUtc as number)) {
      violations.push(
        `phase03Economy.lastSettlementUtc (${p03.lastSettlementUtc}) exceeds currentUtc (${state.currentUtc})`
      );
    }

    // 7a. Bounded debt & budget allocations per nation
    for (const [nationId, stock] of Object.entries(p03.stocksByNation)) {
      if (!state.nations[nationId]) {
        violations.push(`phase03Economy.stocksByNation references unknown nation "${nationId}"`);
      }
      const budget = p03.budgetsByNation[nationId];
      if (!budget) {
        violations.push(`phase03Economy.budgetsByNation missing for nation "${nationId}"`);
      } else {
        if ((stock.debtMoneyFp as number) > (budget.creditLimitFp as number)) {
          violations.push(
            `Nation "${nationId}" debt (${stock.debtMoneyFp}) exceeds creditLimitFp (${budget.creditLimitFp})`
          );
        }
        const allocSum =
          budget.allocations.defenseBps +
          budget.allocations.civilianBps +
          budget.allocations.scienceBps +
          budget.allocations.industryBps;
        if (allocSum !== 10000) {
          violations.push(`Nation "${nationId}" budget allocations sum to ${allocSum}, expected 10000`);
        }
      }
    }

    // 7b. Exact 8-resource conservation: sum(available + reserved) + burned === initial + minted + sum(debt)
    const stocks = Object.values(p03.stocksByNation);
    for (const r of EXTENDED_RESOURCE_TYPES) {
      let avail = 0;
      let resv = 0;
      let debt = 0;
      for (const s of stocks) {
        avail += s.available[r] as number;
        resv += s.reserved[r] as number;
        if (r === 'money') {
          debt += s.debtMoneyFp as number;
        }
      }
      const burned = p03.resourceAudit.burnedTotal[r] as number;
      const initial = p03.resourceAudit.initialTotal[r] as number;
      const minted = p03.resourceAudit.mintedTotal[r] as number;
      if (avail + resv + burned !== initial + minted + debt) {
        violations.push(
          `Phase 03 conservation violated for "${r}": avail+resv+burned (${avail + resv + burned}) !== initial+minted+debt (${initial + minted + debt})`
        );
      }
    }

    // 7c. Active reservations sum matches stocksByNation[n].reserved for every nation & resource
    for (const [nationId, stock] of Object.entries(p03.stocksByNation)) {
      for (const r of EXTENDED_RESOURCE_TYPES) {
        let activeResSum = 0;
        for (const res of Object.values(p03.reservations)) {
          if (res.ownerNationId === nationId && res.status === 'ACTIVE') {
            activeResSum += res.remainingReserved[r] as number;
          }
        }
        if (activeResSum !== (stock.reserved[r] as number)) {
          violations.push(
            `Nation "${nationId}" reserved mismatch for "${r}": stock.reserved (${stock.reserved[r]}) !== active reservations (${activeResSum})`
          );
        }
      }
    }

    // 7d. Facility & queue referential integrity
    for (const fac of Object.values(p03.facilities)) {
      if (!state.nations[fac.ownerNationId]) {
        violations.push(`Facility "${fac.facilityId}" references unknown nation "${fac.ownerNationId}"`);
      }
      if (!state.regions[fac.regionId]) {
        violations.push(`Facility "${fac.facilityId}" references unknown region "${fac.regionId}"`);
      }
    }
    const seenP03Txns = new Set<string>();
    for (const entry of p03.ledger) {
      if (seenP03Txns.has(entry.transactionId)) {
        violations.push(`Duplicate phase03 ledger transactionId "${entry.transactionId}"`);
      }
      seenP03Txns.add(entry.transactionId);
    }
  }

  if (violations.length > 0) {
    throw new SimulationInvariantError(violations);
  }
}
