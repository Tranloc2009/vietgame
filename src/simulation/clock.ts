import { asUtcEpochMs, UtcEpochMs } from '../contracts';

/**
 * Injectable UTC clock abstraction.
 * Simulation reducers MUST obtain timestamps strictly through this interface
 * and MUST NEVER invoke Date.now() directly.
 */
export interface SimulationClock {
  nowUtc(): UtcEpochMs;
}

export class FixedClock implements SimulationClock {
  private readonly fixedMs: UtcEpochMs;

  constructor(epochMs: number) {
    this.fixedMs = asUtcEpochMs(epochMs);
  }

  nowUtc(): UtcEpochMs {
    return this.fixedMs;
  }
}

export class ManualClock implements SimulationClock {
  private currentMs: UtcEpochMs;

  constructor(initialEpochMs: number) {
    this.currentMs = asUtcEpochMs(initialEpochMs);
  }

  nowUtc(): UtcEpochMs {
    return this.currentMs;
  }

  advanceByMs(deltaMs: number): UtcEpochMs {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new RangeError(`Clock cannot advance by negative or non-integer delta: ${deltaMs}`);
    }
    this.currentMs = asUtcEpochMs((this.currentMs as number) + deltaMs);
    return this.currentMs;
  }

  setUtc(epochMs: number): UtcEpochMs {
    const next = asUtcEpochMs(epochMs);
    if ((next as number) < (this.currentMs as number)) {
      throw new RangeError('ManualClock cannot move backwards in time');
    }
    this.currentMs = next;
    return this.currentMs;
  }
}
