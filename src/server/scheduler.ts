import crypto from 'node:crypto';
import {
  ActorIdSchema,
  asUtcEpochMs,
  Command,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  DomainEvent,
  IdempotencyKeySchema,
  MatchId,
} from '../contracts';
import { SimulationClock } from '../simulation';
import { SqliteMatchStore } from './db/sqliteStore';

export interface SchedulerOptions {
  readonly tickIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly maxBatchesPerMatch?: number;
  readonly workerOwnerId?: string;
  readonly onMatchTicked?: (payload: {
    matchId: MatchId;
    version: number;
    stateHash: string;
    emittedEvents: readonly DomainEvent[];
    fromSequence: number;
    toSequence: number;
  }) => void;
}

export interface CatchUpReport {
  readonly processedMatches: number;
  readonly executedTicks: number;
  readonly skippedLockedMatches: number;
}

/**
 * Authoritative UTC Scheduler (P02-02).
 * - Advances active matches strictly according to server UTC clock (never trusts client clock).
 * - Uses per-match SQLite worker lease locks (`match_worker_locks`) to prevent concurrent double-processing.
 * - Catches up overdue job deadlines and 60s tick intervals in bounded deterministic batches.
 * - Uses deterministic tick idempotency keys so restarts before or after a job deadline never duplicate results.
 */
export class MatchClockScheduler {
  private readonly store: SqliteMatchStore;
  private readonly clock: SimulationClock;
  private readonly tickIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly maxBatchesPerMatch: number;
  private readonly workerOwnerId: string;
  private readonly onMatchTicked?: SchedulerOptions['onMatchTicked'];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: SqliteMatchStore, clock: SimulationClock, options?: SchedulerOptions) {
    this.store = store;
    this.clock = clock;
    this.tickIntervalMs = options?.tickIntervalMs ?? 60_000;
    this.leaseDurationMs = options?.leaseDurationMs ?? 30_000;
    this.maxBatchesPerMatch = options?.maxBatchesPerMatch ?? 10;
    this.workerOwnerId =
      options?.workerOwnerId ?? `wrk_${crypto.randomBytes(4).toString('hex')}`;
    this.onMatchTicked = options?.onMatchTicked;
  }

  public start(): void {
    if (this.timer !== null) return;
    // Run an immediate bounded recovery pass on startup for overdue jobs
    this.runCatchUpCycle();
    this.timer = setInterval(() => {
      this.runCatchUpCycle();
    }, this.tickIntervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public runCatchUpCycle(): CatchUpReport {
    const matchIds = this.store.listSchedulableMatchIds();
    let processedMatches = 0;
    let executedTicks = 0;
    let skippedLockedMatches = 0;

    for (const matchId of matchIds) {
      const nowUtc = this.clock.nowUtc();
      const locked = this.store.acquireMatchWorkerLock(
        matchId,
        this.workerOwnerId,
        nowUtc,
        this.leaseDurationMs
      );
      if (!locked) {
        skippedLockedMatches += 1;
        continue;
      }

      try {
        const ticksForMatch = this.processMatchBounded(matchId);
        if (ticksForMatch > 0) {
          processedMatches += 1;
          executedTicks += ticksForMatch;
        }
      } finally {
        this.store.releaseMatchWorkerLock(matchId, this.workerOwnerId);
      }
    }

    return { processedMatches, executedTicks, skippedLockedMatches };
  }

  private processMatchBounded(matchId: MatchId): number {
    let executed = 0;

    for (let batch = 0; batch < this.maxBatchesPerMatch; batch += 1) {
      const loaded = this.store.getMatch(matchId);
      if (!loaded) break;

      const state = loaded.state;
      const nowUtc = this.clock.nowUtc();
      if ((nowUtc as number) <= (state.currentUtc as number)) {
        break;
      }

      // Find earliest overdue scheduled job deadline OR next 60s tick boundary
      let earliestDueJobUtc: number | null = null;
      for (const job of Object.values(state.jobs)) {
        if (
          job.status === 'SCHEDULED' &&
          (job.completesAtUtc as number) <= (nowUtc as number)
        ) {
          if (earliestDueJobUtc === null || (job.completesAtUtc as number) < earliestDueJobUtc) {
            earliestDueJobUtc = job.completesAtUtc as number;
          }
        }
      }

      const nextIntervalUtc = (state.currentUtc as number) + this.tickIntervalMs;
      let targetUtcNum: number | null = null;

      if (earliestDueJobUtc !== null) {
        targetUtcNum = earliestDueJobUtc;
      } else if ((nowUtc as number) >= nextIntervalUtc) {
        targetUtcNum = Math.min(nowUtc as number, nextIntervalUtc);
      } else {
        // Neither a due job nor a full 60s interval has elapsed
        break;
      }

      const systemActor = Object.values(state.actors).find((a) => a.role === 'SYSTEM');
      if (!systemActor) break;

      const targetUtc = asUtcEpochMs(targetUtcNum);
      const nextSequence = systemActor.lastSequence + 1;
      const tickCommand: Command = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse(`cmd_tick_${state.version + 1}_${targetUtcNum}`),
        matchId,
        actorId: ActorIdSchema.parse(systemActor.actorId),
        idempotencyKey: IdempotencyKeySchema.parse(`idem_tick_${matchId}_${targetUtcNum}`),
        sequence: nextSequence,
        expectedVersion: state.version,
        issuedAtUtc: targetUtc,
        payload: {
          type: 'ADVANCE_REALTIME_TICK',
          targetUtc,
        },
      };

      const prevSeq = state.eventSequence;
      const tickClock: SimulationClock = { nowUtc: () => targetUtc };
      const exec = this.store.executeCommand(matchId, tickCommand, tickClock);

      if (!exec.found || !exec.result.ok) {
        break;
      }

      if (!exec.result.idempotentDuplicate) {
        executed += 1;
        this.store.recordTickCompleted(matchId, targetUtcNum);
        if (exec.result.emittedEvents.length > 0) {
          this.onMatchTicked?.({
            matchId,
            version: exec.result.nextState.version,
            stateHash: exec.result.stateHash,
            emittedEvents: exec.result.emittedEvents,
            fromSequence: prevSeq + 1,
            toSequence: exec.result.nextState.eventSequence,
          });
        }
      } else {
        break;
      }
    }

    return executed;
  }
}
