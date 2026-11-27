import { SimulationClock } from '../simulation';

export interface RateLimitCheckResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Memory-bounded sliding-window rate limiter keyed by IP / user / socket.
 * Uses the server's injectable SimulationClock so rate limiting is deterministically testable.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private lastPruneUtc = 0;

  constructor(private readonly clock: SimulationClock) {}

  public check(key: string, maxRequests: number, windowMs: number): RateLimitCheckResult {
    const now = this.clock.nowUtc() as number;
    const cutoff = now - windowMs;

    // Periodic pruning to prevent unbounded memory growth under IP churn
    if (this.buckets.size > 2000 && now - this.lastPruneUtc >= 60_000) {
      this.lastPruneUtc = now;
      for (const [bucketKey, timestamps] of this.buckets.entries()) {
        const recent = timestamps.filter((ts) => ts > cutoff);
        if (recent.length === 0) this.buckets.delete(bucketKey);
        else this.buckets.set(bucketKey, recent);
      }
    }

    const existing = this.buckets.get(key) ?? [];
    const active = existing.filter((ts) => ts > cutoff);

    if (active.length >= maxRequests) {
      this.buckets.set(key, active);
      const oldest = active[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    active.push(now);
    this.buckets.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - active.length),
      retryAfterSeconds: 0,
    };
  }
}
