import {
  asFixedPoint,
  asUtcEpochMs,
  assertCompatibleSchemaVersion,
  Command,
  CONTRACT_SCHEMA_VERSION,
  DomainEvent,
  DomainEventPayload,
  EconomicLedgerEntry,
  EconomicMatchState,
  EventId,
  EventIdSchema,
  FixedPointInt,
  fpAdd,
  fpSub,
  IdempotencyReceipt,
  MatchState,
  Nation,
  Phase03EconomyState,
  ResourceLedger,
  ResourceType,
  UtcEpochMs,
} from '../contracts';
import { SimulationClock } from './clock';
import {
  appendEconomicLedgerEntry,
  computeJobCancellationSplit,
  DEFAULT_TAX_RATE_BPS,
  RESOURCE_TYPES,
  settleDueEconomicCycles,
} from './economy';
import {
  FACILITY_CATALOG,
  TAX_CHANGE_COOLDOWN_MS,
  TAX_POLICY_DELAY_MS,
} from './phase03Catalog';
import {
  appendExtendedLedgerEntry,
  buildOrderReservationId,
  computeProRataCancellationSplit,
  isZeroExtendedBasket,
  reserveNationResources,
  scaleExtendedBasket,
  settleNationReservation,
  settlePhase03OnRealtimeTick,
} from './phase03Engine';
import { computePayloadDigest, computeStateHash } from './hash';
import { assertSimulationInvariants, compareEventsDeterministically } from './invariants';
import { nextSeededInt } from './rng';

export const UNIT_MOVE_SUPPLY_COST_FP = asFixedPoint(500); // 0.500 supply per regional move
export const MAX_STABILITY_FP = 100_000; // 100.000 max stability

export type RejectionCode =
  | 'INCOMPATIBLE_SCHEMA_VERSION'
  | 'MATCH_ID_MISMATCH'
  | 'UNAUTHORIZED_ACTOR'
  | 'FORBIDDEN_ACTION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'INVALID_SEQUENCE'
  | 'INSUFFICIENT_RESOURCES'
  | 'INVALID_TARGET'
  | 'DUPLICATE_ENTITY'
  | 'INVALID_TIME_PROGRESSION';

export interface ReduceSuccess {
  readonly ok: true;
  readonly idempotentDuplicate: boolean;
  readonly nextState: MatchState;
  readonly emittedEvents: readonly DomainEvent[];
  readonly receipt: IdempotencyReceipt;
  readonly stateHash: string;
}

export interface ReduceRejection {
  readonly ok: false;
  readonly code: RejectionCode;
  readonly reason: string;
  readonly currentVersion: number;
  readonly stateHash: string;
}

export type ReduceResult = ReduceSuccess | ReduceRejection;

function emptyResourceLedger(): ResourceLedger {
  return {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };
}

function makeSingleResourceLedger(resource: ResourceType, amount: FixedPointInt): ResourceLedger {
  return {
    ...emptyResourceLedger(),
    [resource]: amount,
  };
}

function addResourceToLedger(
  ledger: ResourceLedger,
  resource: ResourceType,
  amount: FixedPointInt
): ResourceLedger {
  return {
    ...ledger,
    [resource]: fpAdd(ledger[resource], amount),
  };
}

function addLedgers(a: ResourceLedger, b: ResourceLedger): ResourceLedger {
  return {
    food: fpAdd(a.food, b.food),
    industrial: fpAdd(a.industrial, b.industrial),
    treasury: fpAdd(a.treasury, b.treasury),
    manpower: fpAdd(a.manpower, b.manpower),
    politicalCapital: fpAdd(a.politicalCapital, b.politicalCapital),
  };
}

function reject(
  state: MatchState,
  code: RejectionCode,
  reason: string
): ReduceRejection {
  return {
    ok: false,
    code,
    reason,
    currentVersion: state.version,
    stateHash: computeStateHash(state),
  };
}

interface PendingEventDraft {
  readonly occurredAtUtc: UtcEpochMs;
  readonly tieBreakPriority: number;
  readonly tieBreakKey: string;
  readonly payload: DomainEventPayload;
}

/**
 * Sorts drafts deterministically when multiple events share the same UTC timestamp:
 * 1. occurredAtUtc ascending
 * 2. tieBreakPriority ascending (lower runs first)
 * 3. tieBreakKey lexical ascending (e.g. jobId / entityId)
 */
function sortPendingEventDrafts(drafts: readonly PendingEventDraft[]): PendingEventDraft[] {
  return [...drafts].sort((a, b) => {
    const timeDiff = (a.occurredAtUtc as number) - (b.occurredAtUtc as number);
    if (timeDiff !== 0) return timeDiff;

    const prioDiff = a.tieBreakPriority - b.tieBreakPriority;
    if (prioDiff !== 0) return prioDiff;

    return a.tieBreakKey < b.tieBreakKey ? -1 : a.tieBreakKey > b.tieBreakKey ? 1 : 0;
  });
}

function buildEventId(matchVersion: number, sequence: number): EventId {
  const paddedSeq = String(sequence).padStart(6, '0');
  return EventIdSchema.parse(`evt_v${matchVersion}_s${paddedSeq}`);
}

/**
 * Pure deterministic reducer for VIETNAM: THE DIVIDED NATION.
 *
 * Guarantees:
 * - Never mutates input `state`
 * - Never reads Date.now() or Math.random()
 * - Enforces schema version, match ID, actor permissions, idempotency key, expectedVersion, and sequence
 * - Preserves all project invariants (2 human slots, independent NPCs, resource conservation, event ordering)
 */
export function reduceCommand(
  state: MatchState,
  command: Command,
  clock: SimulationClock
): ReduceResult {
  try {
    assertCompatibleSchemaVersion(command.schemaVersion, state.schemaVersion);
  } catch (err) {
    return reject(
      state,
      'INCOMPATIBLE_SCHEMA_VERSION',
      err instanceof Error ? err.message : 'Incompatible schema version'
    );
  }

  if (command.matchId !== state.matchId) {
    return reject(
      state,
      'MATCH_ID_MISMATCH',
      `Command matchId "${command.matchId}" does not match target "${state.matchId}".`
    );
  }

  const actor = state.actors[command.actorId];
  if (!actor || !actor.active) {
    return reject(
      state,
      'UNAUTHORIZED_ACTOR',
      `Actor "${command.actorId}" is not registered or inactive in this match.`
    );
  }

  // Idempotency check BEFORE version/sequence checks so retries succeed cleanly!
  const payloadDigest = computePayloadDigest(command.payload);
  const existingReceipt = state.idempotencyReceipts[command.idempotencyKey];
  if (existingReceipt) {
    if (
      existingReceipt.payloadDigest === payloadDigest &&
      existingReceipt.actorId === command.actorId
    ) {
      return {
        ok: true,
        idempotentDuplicate: true,
        nextState: state,
        emittedEvents: [],
        receipt: existingReceipt,
        stateHash: computeStateHash(state),
      };
    }
    return reject(
      state,
      'IDEMPOTENCY_CONFLICT',
      `Idempotency key "${command.idempotencyKey}" was already used for a different actor or payload.`
    );
  }

  // Optimistic concurrency check
  if (command.expectedVersion !== state.version) {
    return reject(
      state,
      'VERSION_CONFLICT',
      `Expected state version ${command.expectedVersion}, but authoritative version is ${state.version}.`
    );
  }

  // Per-actor monotonic sequence check
  const expectedSequence = actor.lastSequence + 1;
  if (command.sequence !== expectedSequence) {
    return reject(
      state,
      'INVALID_SEQUENCE',
      `Actor "${command.actorId}" expected sequence ${expectedSequence}, received ${command.sequence}.`
    );
  }

  const nowUtc = clock.nowUtc();
  if ((nowUtc as number) < (state.currentUtc as number)) {
    return reject(
      state,
      'INVALID_TIME_PROGRESSION',
      `Clock timestamp ${nowUtc} precedes authoritative match time ${state.currentUtc}.`
    );
  }

  // Clone mutable working slices immutably (shallow copies of records we may update)
  const nextVersion = state.version + 1;
  let nations = { ...state.nations };
  const units = { ...state.units };
  const jobs = { ...state.jobs };
  const policies = { ...state.policies };
  const treaties = { ...state.treaties };
  let resourceAudit = state.resourceAudit;
  let economicState: EconomicMatchState | undefined = state.economicState
    ? {
        ...state.economicState,
        taxRateBpsByNation: { ...state.economicState.taxRateBpsByNation },
      }
    : undefined;
  let economicLedger: EconomicLedgerEntry[] | undefined = state.economicLedger
    ? [...state.economicLedger]
    : state.economicState
      ? []
      : undefined;
  let phase03Economy: Phase03EconomyState | undefined = state.phase03Economy;
  let nextUtc: UtcEpochMs = nowUtc;
  let nextRngState = state.serverPrivate.rngState;
  const drafts: PendingEventDraft[] = [];

  const recordLedger = (entry: Omit<Parameters<typeof appendEconomicLedgerEntry>[2], 'matchVersion' | 'causedByCommandId'>): void => {
    if (!economicState || !economicLedger) return;
    if ((entry.amountFp as number) <= 0) return;
    const appended = appendEconomicLedgerEntry(economicState, economicLedger, {
      ...entry,
      matchVersion: nextVersion,
      causedByCommandId: command.commandId,
    });
    economicState = appended.economicState;
    economicLedger = appended.ledger;
  };

  const payload = command.payload;

  switch (payload.type) {
    case 'TRANSFER_RESOURCE': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.fromNationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" cannot transfer resources from nation "${payload.fromNationId}".`
        );
      }
      if (payload.fromNationId === payload.toNationId) {
        return reject(
          state,
          'INVALID_TARGET',
          'Source and destination nations must be different.'
        );
      }
      const fromNation = nations[payload.fromNationId];
      const toNation = nations[payload.toNationId];
      if (!fromNation || !toNation) {
        return reject(state, 'INVALID_TARGET', 'Source or destination nation does not exist.');
      }

      const currentBalance = fromNation.resources[payload.resource];
      if ((currentBalance as number) < (payload.amountFp as number)) {
        return reject(
          state,
          'INSUFFICIENT_RESOURCES',
          `Nation "${fromNation.nationId}" has insufficient "${payload.resource}": balance ${currentBalance}, required ${payload.amountFp}.`
        );
      }

      const updatedFrom: Nation = {
        ...fromNation,
        resources: {
          ...fromNation.resources,
          [payload.resource]: fpSub(currentBalance, payload.amountFp),
        },
      };
      const updatedTo: Nation = {
        ...toNation,
        resources: {
          ...toNation.resources,
          [payload.resource]: fpAdd(toNation.resources[payload.resource], payload.amountFp),
        },
      };
      nations[updatedFrom.nationId] = updatedFrom;
      nations[updatedTo.nationId] = updatedTo;

      recordLedger({
        occurredAtUtc: nowUtc,
        kind: 'TRANSFER_DEBIT',
        nationId: updatedFrom.nationId,
        resource: payload.resource,
        direction: 'DEBIT',
        amountFp: payload.amountFp,
        balanceAfterFp: updatedFrom.resources[payload.resource],
        source: updatedFrom.nationId,
        destination: updatedTo.nationId,
        note: payload.reason,
      });
      recordLedger({
        occurredAtUtc: nowUtc,
        kind: 'TRANSFER_CREDIT',
        nationId: updatedTo.nationId,
        resource: payload.resource,
        direction: 'CREDIT',
        amountFp: payload.amountFp,
        balanceAfterFp: updatedTo.resources[payload.resource],
        source: updatedFrom.nationId,
        destination: updatedTo.nationId,
        note: payload.reason,
      });

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 20,
        tieBreakKey: `${payload.fromNationId}:${payload.toNationId}:${payload.resource}`,
        payload: {
          type: 'RESOURCE_TRANSFERRED',
          fromNationId: payload.fromNationId,
          toNationId: payload.toNationId,
          resource: payload.resource,
          amountFp: payload.amountFp,
          reason: payload.reason,
        },
      });
      break;
    }

    case 'MOVE_UNIT': {
      const unit = units[payload.unitId];
      if (!unit) {
        return reject(state, 'INVALID_TARGET', `Unit "${payload.unitId}" does not exist.`);
      }
      if (actor.role !== 'SYSTEM' && actor.nationId !== unit.ownerNationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" does not control unit "${unit.unitId}".`
        );
      }
      const currentRegion = state.regions[unit.regionId];
      const targetRegion = state.regions[payload.targetRegionId];
      if (!currentRegion || !targetRegion) {
        return reject(state, 'INVALID_TARGET', `Target region "${payload.targetRegionId}" does not exist.`);
      }
      if (!currentRegion.adjacentRegionIds.includes(payload.targetRegionId)) {
        return reject(
          state,
          'INVALID_TARGET',
          `Region "${payload.targetRegionId}" is not adjacent to "${unit.regionId}".`
        );
      }
      if ((unit.supplyFp as number) < (UNIT_MOVE_SUPPLY_COST_FP as number)) {
        return reject(
          state,
          'INSUFFICIENT_RESOURCES',
          `Unit "${unit.unitId}" lacks supply (${unit.supplyFp} < ${UNIT_MOVE_SUPPLY_COST_FP}).`
        );
      }

      units[unit.unitId] = {
        ...unit,
        regionId: payload.targetRegionId,
        supplyFp: fpSub(unit.supplyFp, UNIT_MOVE_SUPPLY_COST_FP),
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 30,
        tieBreakKey: unit.unitId,
        payload: {
          type: 'UNIT_MOVED',
          unitId: unit.unitId,
          fromRegionId: unit.regionId,
          toRegionId: payload.targetRegionId,
          supplySpentFp: UNIT_MOVE_SUPPLY_COST_FP,
        },
      });
      break;
    }

    case 'ENACT_POLICY': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" cannot enact policy for nation "${payload.nationId}".`
        );
      }
      if (policies[payload.policyId]) {
        return reject(state, 'DUPLICATE_ENTITY', `Policy "${payload.policyId}" already exists.`);
      }
      const nation = nations[payload.nationId];
      if (!nation) {
        return reject(state, 'INVALID_TARGET', `Nation "${payload.nationId}" does not exist.`);
      }
      if ((nation.resources.politicalCapital as number) < (payload.enactmentCostFp as number)) {
        return reject(
          state,
          'INSUFFICIENT_RESOURCES',
          `Nation "${nation.nationId}" lacks politicalCapital (${nation.resources.politicalCapital} < ${payload.enactmentCostFp}).`
        );
      }

      const rawStability = (nation.stabilityFp as number) + (payload.stabilityDeltaFp as number);
      const clampedStability = asFixedPoint(Math.max(0, Math.min(MAX_STABILITY_FP, rawStability)));

      nations[nation.nationId] = {
        ...nation,
        resources: {
          ...nation.resources,
          politicalCapital: fpSub(nation.resources.politicalCapital, payload.enactmentCostFp),
        },
        stabilityFp: clampedStability,
      };

      resourceAudit = {
        ...resourceAudit,
        burnedTotal: addResourceToLedger(
          resourceAudit.burnedTotal,
          'politicalCapital',
          payload.enactmentCostFp
        ),
      };

      policies[payload.policyId] = {
        policyId: payload.policyId,
        ownerNationId: payload.nationId,
        code: payload.code,
        title: payload.title,
        status: 'ACTIVE',
        enactedAtUtc: nowUtc,
        upkeepPerDay: emptyResourceLedger(),
        stabilityDeltaFp: payload.stabilityDeltaFp,
      };

      recordLedger({
        occurredAtUtc: nowUtc,
        kind: 'POLICY_ENACT',
        nationId: nation.nationId,
        resource: 'politicalCapital',
        direction: 'DEBIT',
        amountFp: payload.enactmentCostFp,
        balanceAfterFp: nations[nation.nationId].resources.politicalCapital,
        source: nation.nationId,
        destination: `POLICY:${payload.code}`,
        note: `Ban hành chính sách ${payload.title}`,
      });

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 40,
        tieBreakKey: payload.policyId,
        payload: {
          type: 'POLICY_ENACTED',
          policyId: payload.policyId,
          nationId: payload.nationId,
          code: payload.code,
          enactmentCostFp: payload.enactmentCostFp,
          stabilityDeltaFp: payload.stabilityDeltaFp,
        },
      });
      break;
    }

    case 'PROPOSE_TREATY': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.proposerNationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" cannot propose treaty for nation "${payload.proposerNationId}".`
        );
      }
      if (payload.proposerNationId === payload.targetNationId) {
        return reject(state, 'INVALID_TARGET', 'Treaty target must be a different nation.');
      }
      if (!nations[payload.proposerNationId] || !nations[payload.targetNationId]) {
        return reject(state, 'INVALID_TARGET', 'Proposer or target nation does not exist.');
      }
      if (treaties[payload.treatyId]) {
        return reject(state, 'DUPLICATE_ENTITY', `Treaty "${payload.treatyId}" already exists.`);
      }

      const expiresAtUtc = asUtcEpochMs(
        (nowUtc as number) + payload.durationDays * state.config.secondsPerGameDay * 1000
      );

      treaties[payload.treatyId] = {
        treatyId: payload.treatyId,
        proposerNationId: payload.proposerNationId,
        targetNationId: payload.targetNationId,
        kind: payload.kind,
        status: 'PROPOSED',
        createdAtUtc: nowUtc,
        expiresAtUtc,
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 50,
        tieBreakKey: payload.treatyId,
        payload: {
          type: 'TREATY_PROPOSED',
          treatyId: payload.treatyId,
          proposerNationId: payload.proposerNationId,
          targetNationId: payload.targetNationId,
          kind: payload.kind,
        },
      });
      break;
    }

    case 'SCHEDULE_JOB': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" cannot schedule job for nation "${payload.nationId}".`
        );
      }
      if (jobs[payload.jobId]) {
        return reject(state, 'DUPLICATE_ENTITY', `Job "${payload.jobId}" already exists.`);
      }
      const nation = nations[payload.nationId];
      if (!nation) {
        return reject(state, 'INVALID_TARGET', `Nation "${payload.nationId}" does not exist.`);
      }
      const balance = nation.resources[payload.costResource];
      if ((balance as number) < (payload.costAmountFp as number)) {
        return reject(
          state,
          'INSUFFICIENT_RESOURCES',
          `Nation "${nation.nationId}" lacks "${payload.costResource}" (${balance} < ${payload.costAmountFp}).`
        );
      }

      const completesAtUtc = asUtcEpochMs((nowUtc as number) + payload.durationMs);
      const reservedCost = makeSingleResourceLedger(payload.costResource, payload.costAmountFp);

      nations[nation.nationId] = {
        ...nation,
        resources: {
          ...nation.resources,
          [payload.costResource]: fpSub(balance, payload.costAmountFp),
        },
      };

      jobs[payload.jobId] = {
        jobId: payload.jobId,
        ownerNationId: payload.nationId,
        kind: payload.kind,
        startsAtUtc: nowUtc,
        completesAtUtc,
        status: 'SCHEDULED',
        reservedCost,
      };

      recordLedger({
        occurredAtUtc: nowUtc,
        kind: 'JOB_RESERVE',
        nationId: nation.nationId,
        resource: payload.costResource,
        direction: 'DEBIT',
        amountFp: payload.costAmountFp,
        balanceAfterFp: nations[nation.nationId].resources[payload.costResource],
        source: nation.nationId,
        destination: `ESCROW:${payload.jobId}`,
        note: `Tạm giữ tài nguyên cho tác vụ ${payload.kind}`,
      });

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 60,
        tieBreakKey: payload.jobId,
        payload: {
          type: 'JOB_SCHEDULED',
          jobId: payload.jobId,
          nationId: payload.nationId,
          kind: payload.kind,
          completesAtUtc,
          costResource: payload.costResource,
          costAmountFp: payload.costAmountFp,
        },
      });
      break;
    }

    case 'ADVANCE_REALTIME_TICK': {
      if (actor.role !== 'SYSTEM') {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          'Only SYSTEM actor may execute ADVANCE_REALTIME_TICK.'
        );
      }
      if ((payload.targetUtc as number) < (state.currentUtc as number)) {
        return reject(
          state,
          'INVALID_TIME_PROGRESSION',
          `targetUtc (${payload.targetUtc}) cannot be earlier than currentUtc (${state.currentUtc}).`
        );
      }
      if ((payload.targetUtc as number) > (nowUtc as number)) {
        return reject(
          state,
          'INVALID_TIME_PROGRESSION',
          `Cannot fast-forward targetUtc (${payload.targetUtc}) beyond authoritative clock (${nowUtc}).`
        );
      }

      const dueJobs = Object.values(jobs)
        .filter(
          (j) =>
            j.status === 'SCHEDULED' &&
            (j.completesAtUtc as number) <= (payload.targetUtc as number)
        )
        .sort((a, b) => {
          const timeDiff = (a.completesAtUtc as number) - (b.completesAtUtc as number);
          if (timeDiff !== 0) return timeDiff;
          return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
        });

      for (const job of dueJobs) {
        const rollStep = nextSeededInt(nextRngState, 10_000);
        nextRngState = rollStep.nextState;

        jobs[job.jobId] = {
          ...job,
          status: 'COMPLETED',
        };

        // Reserved job cost transitions atomically into burned audit total upon completion
        resourceAudit = {
          ...resourceAudit,
          burnedTotal: addLedgers(resourceAudit.burnedTotal, job.reservedCost),
        };

        const ownerNation = nations[job.ownerNationId];
        if (ownerNation) {
          for (const key of RESOURCE_TYPES) {
            const spent = job.reservedCost[key];
            if ((spent as number) > 0) {
              recordLedger({
                occurredAtUtc: job.completesAtUtc,
                kind: 'JOB_COMPLETE_SETTLE',
                nationId: job.ownerNationId,
                resource: key,
                direction: 'DEBIT',
                amountFp: spent,
                balanceAfterFp: ownerNation.resources[key],
                source: `ESCROW:${job.jobId}`,
                destination: 'JOB_COMPLETE_BURN',
                note: `Tất toán chi phí hoàn tất tác vụ ${job.kind}`,
              });
            }
          }
        }

        drafts.push({
          occurredAtUtc: job.completesAtUtc,
          tieBreakPriority: 10,
          tieBreakKey: job.jobId,
          payload: {
            type: 'JOB_COMPLETED',
            jobId: job.jobId,
            nationId: job.ownerNationId,
            kind: job.kind,
            deterministicRoll: rollStep.value,
          },
        });
      }

      // P03-01: Settle any complete hourly economic cycles elapsed up to targetUtc
      if (economicState && economicLedger) {
        const settled = settleDueEconomicCycles({
          matchVersion: nextVersion,
          targetUtc: payload.targetUtc,
          commandId: command.commandId,
          regions: state.regions,
          units,
          policies,
          nations,
          resourceAudit,
          economicState,
          economicLedger,
        });
        nations = settled.nations;
        resourceAudit = settled.resourceAudit;
        economicState = settled.economicState;
        economicLedger = settled.economicLedger;

        if (settled.settledEvent) {
          drafts.push({
            occurredAtUtc: settled.settledEvent.cycleUtc,
            tieBreakPriority: 15,
            tieBreakKey: 'economy_settlement',
            payload: settled.settledEvent,
          });
        }
      }

      // Phase 03: Settle due construction/production queues & hourly 8-resource/fiscal/facility cycles
      if (phase03Economy) {
        const p03Tick = settlePhase03OnRealtimeTick({
          matchVersion: nextVersion,
          previousUtc: state.currentUtc,
          targetUtc: payload.targetUtc,
          commandId: command.commandId,
          regions: state.regions,
          units,
          nations,
          phase03Economy,
        });
        phase03Economy = p03Tick.phase03Economy;
        nations = p03Tick.nations;
        for (const ev of p03Tick.events) {
          drafts.push(ev);
        }
      }

      nextUtc = payload.targetUtc;
      drafts.push({
        occurredAtUtc: payload.targetUtc,
        tieBreakPriority: 90,
        tieBreakKey: 'clock_advance',
        payload: {
          type: 'CLOCK_ADVANCED',
          previousUtc: state.currentUtc,
          currentUtc: payload.targetUtc,
          elapsedMs: (payload.targetUtc as number) - (state.currentUtc as number),
        },
      });
      break;
    }

    case 'SET_TAX_RATE': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" cannot change tax rate for nation "${payload.nationId}".`
        );
      }
      if (!economicState) {
        return reject(
          state,
          'INVALID_TARGET',
          'Economic fiscal state is not initialized for this match.'
        );
      }
      if (!nations[payload.nationId]) {
        return reject(state, 'INVALID_TARGET', `Nation "${payload.nationId}" does not exist.`);
      }

      const previousTaxRateBps =
        economicState.taxRateBpsByNation[payload.nationId] ?? DEFAULT_TAX_RATE_BPS;

      economicState = {
        ...economicState,
        taxRateBpsByNation: {
          ...economicState.taxRateBpsByNation,
          [payload.nationId]: payload.taxRateBps,
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 25,
        tieBreakKey: payload.nationId,
        payload: {
          type: 'TAX_RATE_UPDATED',
          nationId: payload.nationId,
          previousTaxRateBps,
          newTaxRateBps: payload.taxRateBps,
        },
      });
      break;
    }

    case 'CANCEL_JOB': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Actor "${actor.actorId}" cannot cancel job for nation "${payload.nationId}".`
        );
      }
      const job = jobs[payload.jobId];
      if (!job) {
        return reject(state, 'INVALID_TARGET', `Job "${payload.jobId}" does not exist.`);
      }
      if (job.ownerNationId !== payload.nationId) {
        return reject(
          state,
          'FORBIDDEN_ACTION',
          `Nation "${payload.nationId}" does not own job "${job.jobId}".`
        );
      }
      if (job.status !== 'SCHEDULED') {
        return reject(
          state,
          'INVALID_TARGET',
          `Job "${job.jobId}" is already ${job.status} and cannot be cancelled.`
        );
      }
      const nation = nations[payload.nationId];
      if (!nation) {
        return reject(state, 'INVALID_TARGET', `Nation "${payload.nationId}" does not exist.`);
      }

      const { refunded, burnedOverhead } = computeJobCancellationSplit(job.reservedCost);

      const updatedNation: Nation = {
        ...nation,
        resources: addLedgers(nation.resources, refunded),
      };
      nations[nation.nationId] = updatedNation;

      jobs[job.jobId] = {
        ...job,
        status: 'CANCELLED',
      };

      resourceAudit = {
        ...resourceAudit,
        burnedTotal: addLedgers(resourceAudit.burnedTotal, burnedOverhead),
      };

      for (const key of RESOURCE_TYPES) {
        const refundedAmount = refunded[key];
        const burnedAmount = burnedOverhead[key];
        if ((refundedAmount as number) > 0) {
          recordLedger({
            occurredAtUtc: nowUtc,
            kind: 'JOB_REFUND',
            nationId: nation.nationId,
            resource: key,
            direction: 'CREDIT',
            amountFp: refundedAmount,
            balanceAfterFp: updatedNation.resources[key],
            source: `ESCROW:${job.jobId}`,
            destination: nation.nationId,
            note: `Hoàn trả 80% chi phí khi hủy tác vụ ${job.kind}`,
          });
        }
        if ((burnedAmount as number) > 0) {
          recordLedger({
            occurredAtUtc: nowUtc,
            kind: 'JOB_CANCEL_OVERHEAD',
            nationId: nation.nationId,
            resource: key,
            direction: 'DEBIT',
            amountFp: burnedAmount,
            balanceAfterFp: updatedNation.resources[key],
            source: `ESCROW:${job.jobId}`,
            destination: 'CANCEL_OVERHEAD_BURN',
            note: `Khấu trừ 20% phí hủy tác vụ ${job.kind}`,
          });
        }
      }

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 65,
        tieBreakKey: job.jobId,
        payload: {
          type: 'JOB_CANCELLED',
          jobId: job.jobId,
          nationId: nation.nationId,
          refunded,
          burnedOverhead,
        },
      });
      break;
    }

    // =========================================================================
    // Phase 03 — P03-01 (Reservation/Commit/Release), P03-02 (Budget/Credit), P03-03 (Facilities/Queues)
    // =========================================================================

    case 'RESERVE_RESOURCES': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot reserve resources for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 economic ledger is not initialized for this match.');
      }
      if (isZeroExtendedBasket(payload.basket)) {
        return reject(state, 'INVALID_TARGET', 'Cần tạm giữ ít nhất một tài nguyên lớn hơn 0.');
      }
      const resOutcome = reserveNationResources(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId: payload.reservationId,
        nationId: payload.nationId,
        refType: 'MANUAL',
        refId: payload.refId,
        basket: payload.basket,
        note: payload.note,
      });
      if (!resOutcome.ok) {
        return reject(state, resOutcome.code, resOutcome.reason);
      }
      phase03Economy = resOutcome.state;
      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 22,
        tieBreakKey: payload.reservationId,
        payload: {
          type: 'RESOURCES_RESERVED',
          reservationId: payload.reservationId,
          nationId: payload.nationId,
          refId: payload.refId,
          basket: payload.basket,
        },
      });
      break;
    }

    case 'COMMIT_RESERVATION': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot commit reservation for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 economic ledger is not initialized for this match.');
      }
      const existingRes = phase03Economy.reservations[payload.reservationId];
      if (!existingRes) {
        return reject(state, 'INVALID_TARGET', `Reservation "${payload.reservationId}" does not exist.`);
      }
      const consumed = payload.consumedBasket ?? existingRes.remainingReserved;
      const settled = settleNationReservation(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId: payload.reservationId,
        nationId: payload.nationId,
        consumed,
        mode: 'COMMIT',
        note: `Tất toán reservation ${payload.reservationId}`,
      });
      if (!settled.ok) {
        return reject(state, settled.code, settled.reason);
      }
      phase03Economy = settled.state;
      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 23,
        tieBreakKey: payload.reservationId,
        payload: {
          type: 'RESERVATION_SETTLED',
          reservationId: payload.reservationId,
          nationId: payload.nationId,
          outcome: settled.outcome,
          consumed: settled.consumed,
          released: settled.released,
        },
      });
      break;
    }

    case 'RELEASE_RESERVATION': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot release reservation for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 economic ledger is not initialized for this match.');
      }
      const consumed = payload.consumedBeforeCancel ?? {
        money: asFixedPoint(0),
        foreignExchange: asFixedPoint(0),
        manpower: asFixedPoint(0),
        food: asFixedPoint(0),
        fuel: asFixedPoint(0),
        supplies: asFixedPoint(0),
        equipment: asFixedPoint(0),
        medical: asFixedPoint(0),
      };
      const settled = settleNationReservation(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId: payload.reservationId,
        nationId: payload.nationId,
        consumed,
        mode: 'RELEASE',
        note: `Hủy và hoàn trả phần chưa tiêu (${payload.reservationId})`,
      });
      if (!settled.ok) {
        return reject(state, settled.code, settled.reason);
      }
      phase03Economy = settled.state;
      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 24,
        tieBreakKey: payload.reservationId,
        payload: {
          type: 'RESERVATION_SETTLED',
          reservationId: payload.reservationId,
          nationId: payload.nationId,
          outcome: settled.outcome,
          consumed: settled.consumed,
          released: settled.released,
        },
      });
      break;
    }

    case 'UPDATE_BUDGET_POLICY': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot update budget for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 budget state is not initialized for this match.');
      }
      const currentBudget = phase03Economy.budgetsByNation[payload.nationId];
      if (!currentBudget) {
        return reject(state, 'INVALID_TARGET', `Nation "${payload.nationId}" has no budget state.`);
      }

      const taxChanged = payload.targetTaxRateBps !== currentBudget.targetTaxRateBps;
      if (
        taxChanged &&
        currentBudget.taxCooldownUntilUtc !== null &&
        (nowUtc as number) < (currentBudget.taxCooldownUntilUtc as number)
      ) {
        return reject(
          state,
          'INVALID_TIME_PROGRESSION',
          `Thuế suất đang trong thời gian chờ điều chỉnh (hết hạn lúc ${new Date(currentBudget.taxCooldownUntilUtc as number).toISOString()}).`
        );
      }

      const nextTaxEffectiveAt = taxChanged
        ? asUtcEpochMs((nowUtc as number) + TAX_POLICY_DELAY_MS)
        : currentBudget.taxChangeEffectiveAtUtc;
      const nextCooldown = taxChanged
        ? asUtcEpochMs((nowUtc as number) + TAX_CHANGE_COOLDOWN_MS)
        : currentBudget.taxCooldownUntilUtc;

      phase03Economy = {
        ...phase03Economy,
        budgetsByNation: {
          ...phase03Economy.budgetsByNation,
          [payload.nationId]: {
            ...currentBudget,
            targetTaxRateBps: payload.targetTaxRateBps,
            taxChangeEffectiveAtUtc: nextTaxEffectiveAt,
            taxCooldownUntilUtc: nextCooldown,
            allocations: payload.allocations,
          },
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 26,
        tieBreakKey: payload.nationId,
        payload: {
          type: 'BUDGET_POLICY_UPDATED',
          nationId: payload.nationId,
          effectiveTaxRateBps: currentBudget.effectiveTaxRateBps,
          targetTaxRateBps: payload.targetTaxRateBps,
          taxChangeEffectiveAtUtc: nextTaxEffectiveAt,
          allocations: payload.allocations,
        },
      });
      break;
    }

    case 'MANAGE_CREDIT': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot manage credit for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 credit facility is not initialized for this match.');
      }
      const stock = phase03Economy.stocksByNation[payload.nationId];
      const budget = phase03Economy.budgetsByNation[payload.nationId];
      if (!stock || !budget) {
        return reject(state, 'INVALID_TARGET', `Nation "${payload.nationId}" does not exist in Phase 03 economy.`);
      }

      if (payload.action === 'DRAW') {
        const headroom = (budget.creditLimitFp as number) - (stock.debtMoneyFp as number);
        if ((payload.amountFp as number) > headroom) {
          return reject(
            state,
            'INSUFFICIENT_RESOURCES',
            `Vượt trần tín dụng hợp lệ: hạn mức còn lại ${headroom / 1000}, yêu cầu vay ${(payload.amountFp as number) / 1000}.`
          );
        }
        const nextDebt = fpAdd(stock.debtMoneyFp, payload.amountFp);
        const nextMoney = fpAdd(stock.available.money, payload.amountFp);
        phase03Economy = {
          ...phase03Economy,
          stocksByNation: {
            ...phase03Economy.stocksByNation,
            [payload.nationId]: {
              ...stock,
              available: { ...stock.available, money: nextMoney },
              debtMoneyFp: nextDebt,
            },
          },
        };
        phase03Economy = appendExtendedLedgerEntry(phase03Economy, {
          matchVersion: nextVersion,
          occurredAtUtc: nowUtc,
          nationId: payload.nationId,
          resource: 'money',
          kind: 'DEBT_DRAW',
          direction: 'CREDIT',
          amountFp: payload.amountFp,
          sourceAccount: 'CREDIT_FACILITY',
          destinationAccount: `STOCK:${payload.nationId}`,
          reservationId: null,
          causedByCommandId: command.commandId,
          note: 'Vay tín dụng ngân khố trong hạn mức cho phép',
        });
        drafts.push({
          occurredAtUtc: nowUtc,
          tieBreakPriority: 27,
          tieBreakKey: payload.nationId,
          payload: {
            type: 'CREDIT_UPDATED',
            nationId: payload.nationId,
            action: 'DRAW',
            amountFp: payload.amountFp,
            debtAfterFp: nextDebt,
            creditLimitFp: budget.creditLimitFp,
          },
        });
      } else {
        if ((stock.debtMoneyFp as number) <= 0) {
          return reject(state, 'INVALID_TARGET', 'Quốc gia hiện không có khoản nợ công nào cần trả.');
        }
        if ((payload.amountFp as number) > (stock.debtMoneyFp as number)) {
          return reject(
            state,
            'INVALID_TARGET',
            `Số tiền trả nợ (${(payload.amountFp as number) / 1000}) lớn hơn dư nợ hiện tại (${(stock.debtMoneyFp as number) / 1000}).`
          );
        }
        if ((payload.amountFp as number) > (stock.available.money as number)) {
          return reject(
            state,
            'INSUFFICIENT_RESOURCES',
            `Không đủ tiền mặt khả dụng để trả nợ (có ${(stock.available.money as number) / 1000}, cần ${(payload.amountFp as number) / 1000}).`
          );
        }
        const nextDebt = fpSub(stock.debtMoneyFp, payload.amountFp);
        const nextMoney = fpSub(stock.available.money, payload.amountFp);
        phase03Economy = {
          ...phase03Economy,
          stocksByNation: {
            ...phase03Economy.stocksByNation,
            [payload.nationId]: {
              ...stock,
              available: { ...stock.available, money: nextMoney },
              debtMoneyFp: nextDebt,
            },
          },
        };
        phase03Economy = appendExtendedLedgerEntry(phase03Economy, {
          matchVersion: nextVersion,
          occurredAtUtc: nowUtc,
          nationId: payload.nationId,
          resource: 'money',
          kind: 'DEBT_REPAY',
          direction: 'DEBIT',
          amountFp: payload.amountFp,
          sourceAccount: `STOCK:${payload.nationId}`,
          destinationAccount: 'CREDIT_FACILITY',
          reservationId: null,
          causedByCommandId: command.commandId,
          note: 'Thanh toán gốc nợ công ngân khố',
        });
        drafts.push({
          occurredAtUtc: nowUtc,
          tieBreakPriority: 27,
          tieBreakKey: payload.nationId,
          payload: {
            type: 'CREDIT_UPDATED',
            nationId: payload.nationId,
            action: 'REPAY',
            amountFp: payload.amountFp,
            debtAfterFp: nextDebt,
            creditLimitFp: budget.creditLimitFp,
          },
        });
      }
      break;
    }

    case 'QUEUE_CONSTRUCTION': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot queue construction for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 construction module is not initialized.');
      }
      if (phase03Economy.constructionQueue[payload.orderId]) {
        return reject(state, 'DUPLICATE_ENTITY', `Construction order "${payload.orderId}" already exists.`);
      }
      const region = state.regions[payload.regionId];
      if (!region) {
        return reject(state, 'INVALID_TARGET', `Region "${payload.regionId}" does not exist.`);
      }
      if (region.controllerNationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Quốc gia "${payload.nationId}" không kiểm soát vùng "${payload.regionId}".`);
      }

      let targetTier: 1 | 2 | 3 = 1;
      if (payload.targetFacilityId !== null) {
        const fac = phase03Economy.facilities[payload.targetFacilityId];
        if (!fac) {
          return reject(state, 'INVALID_TARGET', `Facility "${payload.targetFacilityId}" does not exist.`);
        }
        if (fac.ownerNationId !== payload.nationId) {
          return reject(state, 'FORBIDDEN_ACTION', `Quốc gia "${payload.nationId}" không sở hữu công trình "${fac.facilityId}".`);
        }
        if (fac.type !== payload.facilityType) {
          return reject(state, 'INVALID_TARGET', `Loại công trình nâng cấp không khớp (${fac.type} !== ${payload.facilityType}).`);
        }
        if (fac.tier >= 3) {
          return reject(state, 'INVALID_TARGET', `Công trình "${fac.facilityId}" đã đạt cấp tối đa (Cấp III).`);
        }
        const alreadyUpgrading = Object.values(phase03Economy.constructionQueue).some(
          (c) =>
            c.targetFacilityId === fac.facilityId &&
            (c.status === 'QUEUED' || c.status === 'IN_PROGRESS' || c.status === 'PAUSED')
        );
        if (alreadyUpgrading) {
          return reject(state, 'DUPLICATE_ENTITY', `Công trình "${fac.facilityId}" đang có lệnh nâng cấp trong hàng chờ.`);
        }
        targetTier = (fac.tier + 1) as 2 | 3;
      }

      const spec = FACILITY_CATALOG[payload.facilityType].tiers[targetTier];
      const reservationId = buildOrderReservationId('con', payload.orderId);
      const resOutcome = reserveNationResources(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId,
        nationId: payload.nationId,
        refType: 'CONSTRUCTION',
        refId: payload.orderId,
        basket: spec.buildCost,
        note: `Tạm giữ chi phí xây/nâng cấp ${FACILITY_CATALOG[payload.facilityType].nameVi} cấp ${targetTier}`,
      });
      if (!resOutcome.ok) {
        return reject(state, resOutcome.code, resOutcome.reason);
      }

      const completesAtUtc = asUtcEpochMs((nowUtc as number) + spec.buildDurationMs);
      phase03Economy = {
        ...resOutcome.state,
        constructionQueue: {
          ...resOutcome.state.constructionQueue,
          [payload.orderId]: {
            orderId: payload.orderId,
            ownerNationId: payload.nationId,
            regionId: payload.regionId,
            targetFacilityId: payload.targetFacilityId,
            facilityType: payload.facilityType,
            targetTier,
            reservationId,
            startsAtUtc: nowUtc,
            durationMs: spec.buildDurationMs,
            elapsedActiveMs: 0,
            completesAtUtc,
            status: 'IN_PROGRESS',
            pauseReason: null,
            completedAtUtc: null,
          },
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 61,
        tieBreakKey: payload.orderId,
        payload: {
          type: 'CONSTRUCTION_QUEUED',
          orderId: payload.orderId,
          nationId: payload.nationId,
          regionId: payload.regionId,
          facilityType: payload.facilityType,
          targetTier,
          completesAtUtc,
        },
      });
      break;
    }

    case 'CANCEL_CONSTRUCTION': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot cancel construction for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 construction module is not initialized.');
      }
      const order = phase03Economy.constructionQueue[payload.orderId];
      if (!order) {
        return reject(state, 'INVALID_TARGET', `Construction order "${payload.orderId}" does not exist.`);
      }
      if (order.ownerNationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Quốc gia "${payload.nationId}" không sở hữu lệnh xây dựng "${order.orderId}".`);
      }
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        return reject(state, 'INVALID_TARGET', `Lệnh xây dựng "${order.orderId}" đã ${order.status}.`);
      }
      const res = phase03Economy.reservations[order.reservationId];
      if (!res || res.status !== 'ACTIVE') {
        return reject(state, 'INVALID_TARGET', `Reservation "${order.reservationId}" không còn hiệu lực.`);
      }

      const elapsedMs = Math.max(
        order.elapsedActiveMs,
        Math.min(order.durationMs, (nowUtc as number) - (order.startsAtUtc as number))
      );
      const { consumed } = computeProRataCancellationSplit(
        res.remainingReserved,
        elapsedMs,
        order.durationMs
      );
      const settled = settleNationReservation(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId: order.reservationId,
        nationId: payload.nationId,
        consumed,
        mode: 'RELEASE',
        note: `Hủy xây dựng ${FACILITY_CATALOG[order.facilityType].nameVi} cấp ${order.targetTier}`,
      });
      if (!settled.ok) {
        return reject(state, settled.code, settled.reason);
      }
      phase03Economy = {
        ...settled.state,
        constructionQueue: {
          ...settled.state.constructionQueue,
          [order.orderId]: {
            ...order,
            status: 'CANCELLED',
            pauseReason: 'Đã hủy bởi người chơi',
          },
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 62,
        tieBreakKey: order.orderId,
        payload: {
          type: 'CONSTRUCTION_CANCELLED',
          orderId: order.orderId,
          nationId: payload.nationId,
          consumed: settled.consumed,
          refunded: settled.released,
        },
      });
      break;
    }

    case 'QUEUE_PRODUCTION': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot queue production for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 production module is not initialized.');
      }
      if (phase03Economy.productionQueue[payload.orderId]) {
        return reject(state, 'DUPLICATE_ENTITY', `Production order "${payload.orderId}" already exists.`);
      }
      const fac = phase03Economy.facilities[payload.facilityId];
      if (!fac) {
        return reject(state, 'INVALID_TARGET', `Facility "${payload.facilityId}" does not exist.`);
      }
      if (fac.ownerNationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Quốc gia "${payload.nationId}" không sở hữu nhà máy "${fac.facilityId}".`);
      }
      const spec = FACILITY_CATALOG[fac.type].tiers[fac.tier];
      if (!spec.productionRecipe) {
        return reject(
          state,
          'INVALID_TARGET',
          `${FACILITY_CATALOG[fac.type].nameVi} là công trình cung cấp công suất nền, không có công thức đặt lô sản xuất.`
        );
      }

      const recipe = spec.productionRecipe;
      const inputCost = scaleExtendedBasket(recipe.inputPerBatch, payload.batchCount);
      const outputAmountFp = asFixedPoint((recipe.outputPerBatchFp as number) * payload.batchCount);
      const durationMs = recipe.durationPerBatchMs * payload.batchCount;
      const reservationId = buildOrderReservationId('prd', payload.orderId);

      const resOutcome = reserveNationResources(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId,
        nationId: payload.nationId,
        refType: 'PRODUCTION',
        refId: payload.orderId,
        basket: inputCost,
        note: `Tạm giữ nguyên liệu sản xuất ${payload.batchCount} lô tại ${FACILITY_CATALOG[fac.type].nameVi}`,
      });
      if (!resOutcome.ok) {
        return reject(state, resOutcome.code, resOutcome.reason);
      }

      const completesAtUtc = asUtcEpochMs((nowUtc as number) + durationMs);
      const isPaused = fac.operationalStatus !== 'ACTIVE';
      phase03Economy = {
        ...resOutcome.state,
        productionQueue: {
          ...resOutcome.state.productionQueue,
          [payload.orderId]: {
            orderId: payload.orderId,
            ownerNationId: payload.nationId,
            facilityId: fac.facilityId,
            regionId: fac.regionId,
            outputResource: recipe.outputResource,
            outputAmountFp,
            inputCost,
            reservationId,
            batchCount: payload.batchCount,
            startsAtUtc: nowUtc,
            durationMs,
            elapsedActiveMs: 0,
            completesAtUtc,
            status: isPaused ? 'PAUSED' : 'IN_PROGRESS',
            pauseReason: isPaused ? (fac.pauseReason ?? `Nhà máy đang ${fac.operationalStatus}`) : null,
            completedAtUtc: null,
          },
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 63,
        tieBreakKey: payload.orderId,
        payload: {
          type: 'PRODUCTION_QUEUED',
          orderId: payload.orderId,
          nationId: payload.nationId,
          facilityId: fac.facilityId,
          outputResource: recipe.outputResource,
          outputAmountFp,
          completesAtUtc,
        },
      });
      break;
    }

    case 'CANCEL_PRODUCTION': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot cancel production for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 production module is not initialized.');
      }
      const order = phase03Economy.productionQueue[payload.orderId];
      if (!order) {
        return reject(state, 'INVALID_TARGET', `Production order "${payload.orderId}" does not exist.`);
      }
      if (order.ownerNationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Quốc gia "${payload.nationId}" không sở hữu lệnh sản xuất "${order.orderId}".`);
      }
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        return reject(state, 'INVALID_TARGET', `Lệnh sản xuất "${order.orderId}" đã ${order.status}.`);
      }
      const res = phase03Economy.reservations[order.reservationId];
      if (!res || res.status !== 'ACTIVE') {
        return reject(state, 'INVALID_TARGET', `Reservation "${order.reservationId}" không còn hiệu lực.`);
      }

      const elapsedMs = Math.max(
        order.elapsedActiveMs,
        order.status === 'PAUSED'
          ? order.elapsedActiveMs
          : Math.min(order.durationMs, (nowUtc as number) - (order.startsAtUtc as number))
      );
      const { consumed } = computeProRataCancellationSplit(
        res.remainingReserved,
        elapsedMs,
        order.durationMs
      );
      const settled = settleNationReservation(phase03Economy, {
        matchVersion: nextVersion,
        occurredAtUtc: nowUtc,
        commandId: command.commandId,
        reservationId: order.reservationId,
        nationId: payload.nationId,
        consumed,
        mode: 'RELEASE',
        note: `Hủy lô sản xuất ${order.orderId}`,
      });
      if (!settled.ok) {
        return reject(state, settled.code, settled.reason);
      }
      phase03Economy = {
        ...settled.state,
        productionQueue: {
          ...settled.state.productionQueue,
          [order.orderId]: {
            ...order,
            status: 'CANCELLED',
            pauseReason: 'Đã hủy bởi người chơi',
          },
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 64,
        tieBreakKey: order.orderId,
        payload: {
          type: 'PRODUCTION_CANCELLED',
          orderId: order.orderId,
          nationId: payload.nationId,
          consumed: settled.consumed,
          refunded: settled.released,
        },
      });
      break;
    }

    case 'TOGGLE_FACILITY_PAUSE': {
      if (actor.role !== 'SYSTEM' && actor.nationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Actor "${actor.actorId}" cannot toggle facility for "${payload.nationId}".`);
      }
      if (!phase03Economy) {
        return reject(state, 'INVALID_TARGET', 'Phase 03 facility module is not initialized.');
      }
      const fac = phase03Economy.facilities[payload.facilityId];
      if (!fac) {
        return reject(state, 'INVALID_TARGET', `Facility "${payload.facilityId}" does not exist.`);
      }
      if (fac.ownerNationId !== payload.nationId) {
        return reject(state, 'FORBIDDEN_ACTION', `Quốc gia "${payload.nationId}" không sở hữu công trình "${fac.facilityId}".`);
      }

      const nextStatus = payload.paused ? 'PAUSED_MANUAL' : 'ACTIVE';
      const nextReason = payload.paused ? 'Tạm dừng thủ công bởi người chơi' : null;
      phase03Economy = {
        ...phase03Economy,
        facilities: {
          ...phase03Economy.facilities,
          [fac.facilityId]: {
            ...fac,
            manualPaused: payload.paused,
            operationalStatus: nextStatus,
            efficiencyBps: payload.paused ? 0 : 10000,
            pauseReason: nextReason,
          },
        },
      };

      drafts.push({
        occurredAtUtc: nowUtc,
        tieBreakPriority: 66,
        tieBreakKey: fac.facilityId,
        payload: {
          type: 'FACILITY_STATUS_CHANGED',
          facilityId: fac.facilityId,
          nationId: payload.nationId,
          operationalStatus: nextStatus,
          pauseReason: nextReason,
        },
      });
      break;
    }
  }

  const sortedDrafts = sortPendingEventDrafts(drafts);

  let nextEventSeq = state.eventSequence;
  const emittedEvents: DomainEvent[] = sortedDrafts.map((draft) => {
    nextEventSeq += 1;
    return {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      eventId: buildEventId(nextVersion, nextEventSeq),
      matchId: state.matchId,
      sequence: nextEventSeq,
      occurredAtUtc: draft.occurredAtUtc,
      tieBreakPriority: draft.tieBreakPriority,
      causedByCommandId: command.commandId,
      payload: draft.payload,
    };
  });

  // Sort check for newly emitted batch
  emittedEvents.sort(compareEventsDeterministically);

  const receipt: IdempotencyReceipt = {
    idempotencyKey: command.idempotencyKey,
    commandId: command.commandId,
    actorId: command.actorId,
    payloadDigest,
    appliedVersion: nextVersion,
    eventIds: emittedEvents.map((e) => e.eventId),
    recordedAtUtc: nextUtc,
  };

  const nextState: MatchState = {
    ...state,
    version: nextVersion,
    currentUtc: nextUtc,
    actors: {
      ...state.actors,
      [actor.actorId]: {
        ...actor,
        lastSequence: command.sequence,
      },
    },
    nations,
    units,
    jobs,
    policies,
    treaties,
    resourceAudit,
    ...(economicState ? { economicState } : {}),
    ...(economicLedger ? { economicLedger } : {}),
    ...(phase03Economy ? { phase03Economy } : {}),
    eventSequence: nextEventSeq,
    events: [...state.events, ...emittedEvents],
    idempotencyReceipts: {
      ...state.idempotencyReceipts,
      [command.idempotencyKey]: receipt,
    },
    serverPrivate: {
      ...state.serverPrivate,
      rngState: nextRngState,
    },
  };

  // Enforce every project invariant after transition
  assertSimulationInvariants(nextState);

  const stateHash = computeStateHash(nextState);
  return {
    ok: true,
    idempotentDuplicate: false,
    nextState,
    emittedEvents,
    receipt,
    stateHash,
  };
}

export interface ReplayLogEntry {
  readonly command: Command;
  readonly appliedAtUtc: UtcEpochMs;
}

export interface ReplayVerificationResult {
  readonly finalState: MatchState;
  readonly finalHash: string;
  readonly replayedCount: number;
  readonly duplicateCount: number;
}

/**
 * Replays an ordered command log deterministically from an initial MatchState.
 * Each command is evaluated with a FixedClock pinned to its recorded `appliedAtUtc`.
 */
export function replayCommandLog(
  initialState: MatchState,
  log: readonly ReplayLogEntry[]
): ReplayVerificationResult {
  assertSimulationInvariants(initialState);
  let state = initialState;
  let replayedCount = 0;
  let duplicateCount = 0;

  for (const entry of log) {
    const fixedClock: SimulationClock = {
      nowUtc: () => entry.appliedAtUtc,
    };
    const result = reduceCommand(state, entry.command, fixedClock);
    if (!result.ok) {
      throw new Error(
        `Replay failed on command ${entry.command.commandId} (${result.code}): ${result.reason}`
      );
    }
    state = result.nextState;
    if (result.idempotentDuplicate) {
      duplicateCount += 1;
    } else {
      replayedCount += 1;
    }
  }

  return {
    finalState: state,
    finalHash: computeStateHash(state),
    replayedCount,
    duplicateCount,
  };
}
