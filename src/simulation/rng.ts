/**
 * Server-authoritative deterministic seeded PRNG (Mulberry32).
 * Pure functional transition: takes a 32-bit unsigned integer state and returns
 * both the next 32-bit state and the derived integer roll, enabling lossless replay.
 *
 * Strictly prohibited from running in browser/client environments.
 */
export interface RngStepResult {
  readonly value: number;
  readonly nextState: number;
}

export function assertServerOnlyRngContext(): void {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    throw new Error('Seeded simulation RNG is strictly server-authoritative and forbidden on the client.');
  }
}

export function normalizeSeed(seed: number): number {
  assertServerOnlyRngContext();
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`RNG seed must be a 32-bit unsigned integer, received ${seed}`);
  }
  return seed >>> 0;
}

/**
 * Pure deterministic step (Mulberry32).
 * Returns a uniformly distributed integer in [0, maxExclusive).
 */
export function nextSeededInt(currentState: number, maxExclusive: number): RngStepResult {
  assertServerOnlyRngContext();
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x7fffffff) {
    throw new RangeError(`maxExclusive must be an integer in [1, 2147483647], got ${maxExclusive}`);
  }

  const nextState = (normalizeSeed(currentState) + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const uint32 = ((t ^ (t >>> 14)) >>> 0);

  return {
    value: uint32 % maxExclusive,
    nextState,
  };
}
