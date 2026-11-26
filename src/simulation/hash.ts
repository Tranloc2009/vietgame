import { createHash } from 'node:crypto';
import { canonicalStringify, CommandPayload, MatchState } from '../contracts';

/**
 * Computes a deterministic SHA-256 hex digest over the canonicalized MatchState.
 * Identical initial seed + identical command log MUST always produce an identical hash.
 */
export function computeStateHash(state: MatchState): string {
  const canonical = canonicalStringify(state);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Computes a deterministic SHA-256 digest of a command's semantic payload
 * to detect idempotency key reuse with mismatched payloads.
 */
export function computePayloadDigest(payload: CommandPayload): string {
  const canonical = canonicalStringify(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
