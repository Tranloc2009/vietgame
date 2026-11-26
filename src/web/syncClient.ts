import { DomainEvent } from '../contracts';

export interface DeltaMessage {
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly version: number;
  readonly stateHash: string;
  readonly events: readonly DomainEvent[];
}

export interface DeltaSyncState {
  readonly lastAppliedSequence: number;
  readonly currentVersion: number;
  readonly stateHash: string;
  readonly events: readonly DomainEvent[];
  readonly pendingOutOfOrder: readonly DeltaMessage[];
  readonly needsResync: boolean;
}

export interface DeltaApplyOutcome {
  readonly state: DeltaSyncState;
  readonly status: 'APPLIED' | 'DUPLICATE_IGNORED' | 'GAP_DETECTED_RESYNC_REQUIRED';
}

export function createInitialDeltaSyncState(
  lastAppliedSequence: number,
  currentVersion: number,
  stateHash: string,
  events: readonly DomainEvent[]
): DeltaSyncState {
  return {
    lastAppliedSequence,
    currentVersion,
    stateHash,
    events: [...events],
    pendingOutOfOrder: [],
    needsResync: false,
  };
}

/**
 * Pure deterministic delta sequence reconciler (P02-04).
 * - Ignores duplicate or already-applied deltas cleanly.
 * - Applies strictly contiguous deltas in order.
 * - Buffers out-of-order future deltas and flags `needsResync = true` when a sequence gap is detected.
 * - Automatically drains buffered future deltas once the missing gap arrives!
 */
export function applyIncomingDelta(
  current: DeltaSyncState,
  delta: DeltaMessage
): DeltaApplyOutcome {
  // Duplicate / already applied
  if (delta.toSequence <= current.lastAppliedSequence) {
    return { state: current, status: 'DUPLICATE_IGNORED' };
  }

  // Gap / out-of-order packet
  if (delta.fromSequence > current.lastAppliedSequence + 1) {
    const dedupPending = [
      ...current.pendingOutOfOrder.filter((d) => d.fromSequence !== delta.fromSequence),
      delta,
    ].sort((a, b) => a.fromSequence - b.fromSequence);

    return {
      status: 'GAP_DETECTED_RESYNC_REQUIRED',
      state: {
        ...current,
        pendingOutOfOrder: dedupPending,
        needsResync: true,
      },
    };
  }

  // Contiguous (or overlapping tail): apply and drain any now-contiguous buffered deltas
  const queue = [delta, ...current.pendingOutOfOrder].sort(
    (a, b) => a.fromSequence - b.fromSequence
  );

  let lastSeq = current.lastAppliedSequence;
  let version = current.currentVersion;
  let stateHash = current.stateHash;
  const mergedEvents = [...current.events];
  const seenEventIds = new Set(mergedEvents.map((e) => e.eventId));
  const remaining: DeltaMessage[] = [];

  for (const item of queue) {
    if (item.toSequence <= lastSeq) {
      continue;
    }
    if (item.fromSequence <= lastSeq + 1) {
      for (const ev of item.events) {
        if (!seenEventIds.has(ev.eventId)) {
          mergedEvents.push(ev);
          seenEventIds.add(ev.eventId);
        }
      }
      lastSeq = Math.max(lastSeq, item.toSequence);
      version = Math.max(version, item.version);
      stateHash = item.stateHash;
    } else {
      remaining.push(item);
    }
  }

  mergedEvents.sort((a, b) => a.sequence - b.sequence);

  return {
    status: 'APPLIED',
    state: {
      lastAppliedSequence: lastSeq,
      currentVersion: version,
      stateHash,
      events: mergedEvents,
      pendingOutOfOrder: remaining,
      needsResync: remaining.length > 0,
    },
  };
}

/**
 * Deterministic exponential backoff schedule for WebSocket reconnection (P02-04).
 * Base 500ms, doubles each attempt, capped at 30_000ms.
 */
export function computeReconnectBackoffMs(
  attempt: number,
  baseMs = 500,
  maxMs = 30_000
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = baseMs * Math.pow(2, Math.min(safeAttempt, 10));
  return Math.min(maxMs, raw);
}
