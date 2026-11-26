import { z } from 'zod';

/**
 * Fixed-point integer scaling factor: 1.000 unit == 1000 integer micro-units.
 * All resource quantities and abstract gameplay rates are represented as safe integers
 * to guarantee cross-platform deterministic arithmetic without IEEE-754 rounding drift.
 */
export const FIXED_POINT_SCALE = 1000;

export const MAX_FIXED_POINT = Number.MAX_SAFE_INTEGER;
export const MIN_NON_NEGATIVE_FIXED_POINT = 0;

function makeIdSchema<TBrand extends string>(prefix: string, brandName: TBrand) {
  const regex = new RegExp(`^${prefix}_[a-z0-9][a-z0-9_-]{2,62}$`);
  return z
    .string()
    .regex(regex, `${brandName} must match ${prefix}_<3..63 lowercase alphanumeric/_/- chars>`)
    .brand<TBrand>();
}

export const MatchIdSchema = makeIdSchema('mch', 'MatchId');
export const NationIdSchema = makeIdSchema('nat', 'NationId');
export const RegionIdSchema = makeIdSchema('reg', 'RegionId');
export const ActorIdSchema = makeIdSchema('act', 'ActorId');
export const UnitIdSchema = makeIdSchema('unt', 'UnitId');
export const CommandIdSchema = makeIdSchema('cmd', 'CommandId');
export const EventIdSchema = makeIdSchema('evt', 'EventId');
export const JobIdSchema = makeIdSchema('job', 'JobId');
export const PolicyIdSchema = makeIdSchema('pol', 'PolicyId');
export const TreatyIdSchema = makeIdSchema('trt', 'TreatyId');

export const IdempotencyKeySchema = z
  .string()
  .min(8, 'IdempotencyKey must be at least 8 characters')
  .max(128, 'IdempotencyKey must be at most 128 characters')
  .regex(/^[A-Za-z0-9:_-]+$/, 'IdempotencyKey contains forbidden characters')
  .brand<'IdempotencyKey'>();

export type MatchId = z.infer<typeof MatchIdSchema>;
export type NationId = z.infer<typeof NationIdSchema>;
export type RegionId = z.infer<typeof RegionIdSchema>;
export type ActorId = z.infer<typeof ActorIdSchema>;
export type UnitId = z.infer<typeof UnitIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type JobId = z.infer<typeof JobIdSchema>;
export type PolicyId = z.infer<typeof PolicyIdSchema>;
export type TreatyId = z.infer<typeof TreatyIdSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/**
 * UTC epoch milliseconds (strict safe integer >= 0).
 */
export const UtcEpochMsSchema = z
  .number()
  .int('UtcEpochMs must be an integer')
  .refine((v) => Number.isSafeInteger(v) && v >= 0, {
    message: 'UtcEpochMs must be a non-negative safe integer',
  })
  .brand<'UtcEpochMs'>();

export type UtcEpochMs = z.infer<typeof UtcEpochMsSchema>;

/**
 * Non-negative fixed-point integer (scale = 1000).
 */
export const FixedPointIntSchema = z
  .number()
  .int('FixedPointInt must be an exact integer (no floating-point values)')
  .refine((v) => Number.isSafeInteger(v) && v >= MIN_NON_NEGATIVE_FIXED_POINT, {
    message: 'FixedPointInt must be a non-negative safe integer',
  })
  .brand<'FixedPointInt'>();

export type FixedPointInt = z.infer<typeof FixedPointIntSchema>;

/**
 * Signed fixed-point integer delta (scale = 1000) for rate modifiers or deltas.
 */
export const SignedFixedPointIntSchema = z
  .number()
  .int('SignedFixedPointInt must be an exact integer')
  .refine((v) => Number.isSafeInteger(v), {
    message: 'SignedFixedPointInt must be a safe integer',
  })
  .brand<'SignedFixedPointInt'>();

export type SignedFixedPointInt = z.infer<typeof SignedFixedPointIntSchema>;

export function asFixedPoint(rawInt: number): FixedPointInt {
  return FixedPointIntSchema.parse(rawInt);
}

export function asSignedFixedPoint(rawInt: number): SignedFixedPointInt {
  return SignedFixedPointIntSchema.parse(rawInt);
}

export function asUtcEpochMs(ms: number): UtcEpochMs {
  return UtcEpochMsSchema.parse(ms);
}

export function wholeUnitsToFixedPoint(wholeUnits: number): FixedPointInt {
  if (!Number.isSafeInteger(wholeUnits) || wholeUnits < 0) {
    throw new RangeError(`wholeUnits must be a non-negative safe integer, got ${wholeUnits}`);
  }
  const scaled = wholeUnits * FIXED_POINT_SCALE;
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(`FixedPoint overflow for wholeUnits=${wholeUnits}`);
  }
  return scaled as FixedPointInt;
}

export function fpAdd(a: FixedPointInt, b: FixedPointInt): FixedPointInt {
  const sum = (a as number) + (b as number);
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new RangeError(`FixedPoint addition overflow: ${a} + ${b}`);
  }
  return sum as FixedPointInt;
}

export function fpSub(a: FixedPointInt, b: FixedPointInt): FixedPointInt {
  const diff = (a as number) - (b as number);
  if (!Number.isSafeInteger(diff) || diff < 0) {
    throw new RangeError(`FixedPoint subtraction underflow: ${a} - ${b}`);
  }
  return diff as FixedPointInt;
}

export function fpMulRatio(value: FixedPointInt, ratioFixedPoint: FixedPointInt): FixedPointInt {
  const product = BigInt(value as number) * BigInt(ratioFixedPoint as number);
  const quotient = product / BigInt(FIXED_POINT_SCALE);
  const numeric = Number(quotient);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new RangeError(`FixedPoint multiplication overflow: ${value} * ${ratioFixedPoint}`);
  }
  return numeric as FixedPointInt;
}

export function fpFormat(value: FixedPointInt | SignedFixedPointInt, decimals = 3): string {
  const sign = (value as number) < 0 ? '-' : '';
  const abs = Math.abs(value as number);
  const whole = Math.floor(abs / FIXED_POINT_SCALE);
  const frac = String(abs % FIXED_POINT_SCALE).padStart(3, '0');
  if (decimals <= 0) {
    return `${sign}${whole}`;
  }
  return `${sign}${whole}.${frac.slice(0, Math.min(3, decimals))}`;
}
