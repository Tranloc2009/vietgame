import { z } from 'zod';
import {
  ActorIdSchema,
  CommandIdSchema,
  EventIdSchema,
  FixedPointIntSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  MatchIdSchema,
  NationIdSchema,
  PolicyIdSchema,
  RegionIdSchema,
  SignedFixedPointIntSchema,
  TreatyIdSchema,
  UnitIdSchema,
  UtcEpochMsSchema,
} from './primitives';
import { CONTRACT_SCHEMA_VERSION, REALTIME_SECONDS_PER_GAME_DAY, SEMVER_REGEX } from './versions';

export const SchemaVersionFieldSchema = z.string().regex(SEMVER_REGEX, 'Invalid semver string');

export const FactionSlotSchema = z.enum(['NORTH', 'SOUTH', 'NPC']);
export type FactionSlot = z.infer<typeof FactionSlotSchema>;

export const HumanSlotSchema = z.enum(['NORTH', 'SOUTH']);
export type HumanSlot = z.infer<typeof HumanSlotSchema>;

export const ResourceTypeSchema = z.enum([
  'food',
  'industrial',
  'treasury',
  'manpower',
  'politicalCapital',
]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ResourceLedgerSchema = z
  .object({
    food: FixedPointIntSchema,
    industrial: FixedPointIntSchema,
    treasury: FixedPointIntSchema,
    manpower: FixedPointIntSchema,
    politicalCapital: FixedPointIntSchema,
  })
  .strict();
export type ResourceLedger = z.infer<typeof ResourceLedgerSchema>;

export const ActorRoleSchema = z.enum(['HUMAN_PLAYER', 'INDEPENDENT_NPC', 'SYSTEM']);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

export const ActorSchema = z
  .object({
    actorId: ActorIdSchema,
    role: ActorRoleSchema,
    slot: FactionSlotSchema.nullable(),
    nationId: NationIdSchema.nullable(),
    displayName: z.string().min(1).max(80),
    lastSequence: z.number().int().min(0),
    active: z.boolean(),
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;

export const NationSchema = z
  .object({
    nationId: NationIdSchema,
    slot: FactionSlotSchema,
    code: z.string().min(2).max(16),
    name: z.string().min(1).max(80),
    capitalRegionId: RegionIdSchema,
    resources: ResourceLedgerSchema,
    stabilityFp: FixedPointIntSchema,
    legitimacyFp: FixedPointIntSchema,
    fictionalDisclaimer: z.literal('ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY'),
  })
  .strict();
export type Nation = z.infer<typeof NationSchema>;

export const RegionSchema = z
  .object({
    regionId: RegionIdSchema,
    code: z.string().min(2).max(24),
    name: z.string().min(1).max(80),
    controllerNationId: NationIdSchema,
    adjacentRegionIds: z.array(RegionIdSchema),
    supplyCapacityFp: FixedPointIntSchema,
    influenceFp: FixedPointIntSchema,
    infrastructureFp: FixedPointIntSchema,
  })
  .strict();
export type Region = z.infer<typeof RegionSchema>;

export const UnitCategorySchema = z.enum(['INFANTRY_ABSTRACT', 'LOGISTICS_ABSTRACT', 'CIVIC_CORPS']);
export type UnitCategory = z.infer<typeof UnitCategorySchema>;

export const UnitSchema = z
  .object({
    unitId: UnitIdSchema,
    ownerNationId: NationIdSchema,
    regionId: RegionIdSchema,
    category: UnitCategorySchema,
    strengthFp: FixedPointIntSchema,
    readinessFp: FixedPointIntSchema,
    supplyFp: FixedPointIntSchema,
  })
  .strict();
export type Unit = z.infer<typeof UnitSchema>;

export const JobStatusSchema = z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z
  .object({
    jobId: JobIdSchema,
    ownerNationId: NationIdSchema,
    kind: z.enum(['LOGISTICS_REFORM', 'INFRASTRUCTURE_WORK', 'DIPLOMATIC_ENVOY']),
    startsAtUtc: UtcEpochMsSchema,
    completesAtUtc: UtcEpochMsSchema,
    status: JobStatusSchema,
    reservedCost: ResourceLedgerSchema,
  })
  .strict();
export type Job = z.infer<typeof JobSchema>;

export const PolicyStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'REPEALED']);
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;

export const PolicySchema = z
  .object({
    policyId: PolicyIdSchema,
    ownerNationId: NationIdSchema,
    code: z.string().min(2).max(40),
    title: z.string().min(1).max(120),
    status: PolicyStatusSchema,
    enactedAtUtc: UtcEpochMsSchema,
    upkeepPerDay: ResourceLedgerSchema,
    stabilityDeltaFp: SignedFixedPointIntSchema,
  })
  .strict();
export type Policy = z.infer<typeof PolicySchema>;

export const TreatyStatusSchema = z.enum(['PROPOSED', 'ACTIVE', 'EXPIRED', 'TERMINATED']);
export type TreatyStatus = z.infer<typeof TreatyStatusSchema>;

export const TreatySchema = z
  .object({
    treatyId: TreatyIdSchema,
    proposerNationId: NationIdSchema,
    targetNationId: NationIdSchema,
    kind: z.enum(['NON_AGGRESSION', 'TRADE_CORRIDOR', 'NEUTRAL_ZONE']),
    status: TreatyStatusSchema,
    createdAtUtc: UtcEpochMsSchema,
    expiresAtUtc: UtcEpochMsSchema.nullable(),
  })
  .strict();
export type Treaty = z.infer<typeof TreatySchema>;

export const CommandPayloadSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('TRANSFER_RESOURCE'),
      fromNationId: NationIdSchema,
      toNationId: NationIdSchema,
      resource: ResourceTypeSchema,
      amountFp: FixedPointIntSchema.refine((v) => (v as number) > 0, {
        message: 'Transfer amount must be greater than 0',
      }),
      reason: z.string().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal('MOVE_UNIT'),
      unitId: UnitIdSchema,
      targetRegionId: RegionIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('ENACT_POLICY'),
      policyId: PolicyIdSchema,
      nationId: NationIdSchema,
      code: z.string().min(2).max(40),
      title: z.string().min(1).max(120),
      enactmentCostFp: FixedPointIntSchema,
      stabilityDeltaFp: SignedFixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PROPOSE_TREATY'),
      treatyId: TreatyIdSchema,
      proposerNationId: NationIdSchema,
      targetNationId: NationIdSchema,
      kind: z.enum(['NON_AGGRESSION', 'TRADE_CORRIDOR', 'NEUTRAL_ZONE']),
      durationDays: z.number().int().min(1).max(365),
    })
    .strict(),
  z
    .object({
      type: z.literal('SCHEDULE_JOB'),
      jobId: JobIdSchema,
      nationId: NationIdSchema,
      kind: z.enum(['LOGISTICS_REFORM', 'INFRASTRUCTURE_WORK', 'DIPLOMATIC_ENVOY']),
      durationMs: z.number().int().min(60_000).max(30 * 86_400_000),
      costResource: ResourceTypeSchema,
      costAmountFp: FixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('ADVANCE_REALTIME_TICK'),
      targetUtc: UtcEpochMsSchema,
    })
    .strict(),
]);
export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

export const CommandSchema = z
  .object({
    schemaVersion: SchemaVersionFieldSchema.default(CONTRACT_SCHEMA_VERSION),
    commandId: CommandIdSchema,
    matchId: MatchIdSchema,
    actorId: ActorIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    sequence: z.number().int().min(1),
    expectedVersion: z.number().int().min(0),
    issuedAtUtc: UtcEpochMsSchema,
    payload: CommandPayloadSchema,
  })
  .strict();
export type Command = z.infer<typeof CommandSchema>;

export const DomainEventPayloadSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('RESOURCE_TRANSFERRED'),
      fromNationId: NationIdSchema,
      toNationId: NationIdSchema,
      resource: ResourceTypeSchema,
      amountFp: FixedPointIntSchema,
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('UNIT_MOVED'),
      unitId: UnitIdSchema,
      fromRegionId: RegionIdSchema,
      toRegionId: RegionIdSchema,
      supplySpentFp: FixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('POLICY_ENACTED'),
      policyId: PolicyIdSchema,
      nationId: NationIdSchema,
      code: z.string(),
      enactmentCostFp: FixedPointIntSchema,
      stabilityDeltaFp: SignedFixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('TREATY_PROPOSED'),
      treatyId: TreatyIdSchema,
      proposerNationId: NationIdSchema,
      targetNationId: NationIdSchema,
      kind: z.enum(['NON_AGGRESSION', 'TRADE_CORRIDOR', 'NEUTRAL_ZONE']),
    })
    .strict(),
  z
    .object({
      type: z.literal('JOB_SCHEDULED'),
      jobId: JobIdSchema,
      nationId: NationIdSchema,
      kind: z.enum(['LOGISTICS_REFORM', 'INFRASTRUCTURE_WORK', 'DIPLOMATIC_ENVOY']),
      completesAtUtc: UtcEpochMsSchema,
      costResource: ResourceTypeSchema,
      costAmountFp: FixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('JOB_COMPLETED'),
      jobId: JobIdSchema,
      nationId: NationIdSchema,
      kind: z.enum(['LOGISTICS_REFORM', 'INFRASTRUCTURE_WORK', 'DIPLOMATIC_ENVOY']),
      deterministicRoll: z.number().int().min(0).max(9999),
    })
    .strict(),
  z
    .object({
      type: z.literal('CLOCK_ADVANCED'),
      previousUtc: UtcEpochMsSchema,
      currentUtc: UtcEpochMsSchema,
      elapsedMs: z.number().int().min(0),
    })
    .strict(),
]);
export type DomainEventPayload = z.infer<typeof DomainEventPayloadSchema>;

export const DomainEventSchema = z
  .object({
    schemaVersion: SchemaVersionFieldSchema,
    eventId: EventIdSchema,
    matchId: MatchIdSchema,
    sequence: z.number().int().min(1),
    occurredAtUtc: UtcEpochMsSchema,
    tieBreakPriority: z.number().int().min(0).max(999),
    causedByCommandId: CommandIdSchema,
    payload: DomainEventPayloadSchema,
  })
  .strict();
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const IdempotencyReceiptSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    commandId: CommandIdSchema,
    actorId: ActorIdSchema,
    payloadDigest: z.string().min(16).max(128),
    appliedVersion: z.number().int().min(0),
    eventIds: z.array(EventIdSchema),
    recordedAtUtc: UtcEpochMsSchema,
  })
  .strict();
export type IdempotencyReceipt = z.infer<typeof IdempotencyReceiptSchema>;

export const MatchModeSchema = z.enum(['PRODUCTION_REALTIME', 'PREVIEW_FIXTURE']);
export type MatchMode = z.infer<typeof MatchModeSchema>;

export const MatchConfigSchema = z
  .object({
    mode: MatchModeSchema,
    secondsPerGameDay: z.literal(REALTIME_SECONDS_PER_GAME_DAY),
    allowFastForward: z.literal(false),
    humanSlotCount: z.literal(2),
    alternateHistoryLabel: z.literal('FICTIONAL_ALTERNATE_HISTORY'),
  })
  .strict();
export type MatchConfig = z.infer<typeof MatchConfigSchema>;

/**
 * Server-private secrets (RNG seed, PRNG internal state, fog-of-war/hidden intelligence).
 * MUST NEVER be serialized into client payloads.
 */
export const ServerPrivateStateSchema = z
  .object({
    initialSeed: z.number().int().min(0).max(0xffffffff),
    rngState: z.number().int().min(0).max(0xffffffff),
    hiddenIntelDigest: z.string().min(16).max(128),
  })
  .strict();
export type ServerPrivateState = z.infer<typeof ServerPrivateStateSchema>;

export const ResourceAuditSchema = z
  .object({
    initialTotal: ResourceLedgerSchema,
    burnedTotal: ResourceLedgerSchema,
    mintedTotal: ResourceLedgerSchema,
  })
  .strict();
export type ResourceAudit = z.infer<typeof ResourceAuditSchema>;

export const MatchStateSchema = z
  .object({
    schemaVersion: SchemaVersionFieldSchema,
    matchId: MatchIdSchema,
    title: z.string().min(1).max(120),
    version: z.number().int().min(0),
    createdAtUtc: UtcEpochMsSchema,
    currentUtc: UtcEpochMsSchema,
    config: MatchConfigSchema,
    actors: z.record(z.string(), ActorSchema),
    nations: z.record(z.string(), NationSchema),
    regions: z.record(z.string(), RegionSchema),
    units: z.record(z.string(), UnitSchema),
    jobs: z.record(z.string(), JobSchema),
    policies: z.record(z.string(), PolicySchema),
    treaties: z.record(z.string(), TreatySchema),
    resourceAudit: ResourceAuditSchema,
    eventSequence: z.number().int().min(0),
    events: z.array(DomainEventSchema),
    idempotencyReceipts: z.record(z.string(), IdempotencyReceiptSchema),
    serverPrivate: ServerPrivateStateSchema,
  })
  .strict();
export type MatchState = z.infer<typeof MatchStateSchema>;

/**
 * Client-safe projection of MatchState: strictly omits `serverPrivate` and internal secrets.
 */
export const ClientMatchViewSchema = MatchStateSchema.omit({
  serverPrivate: true,
}).extend({
  stateHash: z.string().min(64).max(64),
});
export type ClientMatchView = z.infer<typeof ClientMatchViewSchema>;
