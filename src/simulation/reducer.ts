import {
  asFixedPoint,
  asUtcEpochMs,
  assertCompatibleSchemaVersion,
  Command,
  CONTRACT_SCHEMA_VERSION,
  DomainEvent,
  DomainEventPayload,
  EventId,
  EventIdSchema,
  FixedPointInt,
  fpAdd,
  fpSub,
  IdempotencyReceipt,
  MatchState,
  Nation,
  ResourceLedger,
  ResourceType,
  UtcEpochMs,
} from '../contracts';
import { SimulationClock } from './clock';
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
  const nations = { ...state.nations };
  const units = { ...state.units };
  const jobs = { ...state.jobs };
  const policies = { ...state.policies };
  const treaties = { ...state.treaties };
  let resourceAudit = state.resourceAudit;
  let nextUtc: UtcEpochMs = nowUtc;
  let nextRngState = state.serverPrivate.rngState;
  const drafts: PendingEventDraft[] = [];

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
  }

  const nextVersion = state.version + 1;
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
