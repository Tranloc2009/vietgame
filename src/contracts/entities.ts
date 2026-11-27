import { z } from 'zod';
import {
  ActorIdSchema,
  CommandIdSchema,
  ConstructionOrderIdSchema,
  EventIdSchema,
  FacilityIdSchema,
  FixedPointIntSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  LedgerTransactionIdSchema,
  MatchIdSchema,
  NationIdSchema,
  PolicyIdSchema,
  ProductionOrderIdSchema,
  RegionIdSchema,
  ReservationIdSchema,
  SignedFixedPointIntSchema,
  TreatyIdSchema,
  UnitIdSchema,
  UtcEpochMsSchema,
} from './primitives';
import {
  CampaignDiplomacyActionSchema,
  CampaignDoctrineKeySchema,
  CampaignLaneSchema,
  CampaignMatchStateSchema,
  CampaignProjectKeySchema,
  CampaignRelationStatusSchema,
  CampaignResourceTupleSchema,
  ScenarioIdSchema,
} from './campaign';
import {
  BudgetAllocationSchema,
  ExtendedResourceBasketSchema,
  ExtendedResourceTypeSchema,
  FacilityOperationalStatusSchema,
  FacilityTierSchema,
  FacilityTypeSchema,
  Phase03EconomyStateSchema,
} from './phase03';
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
    economicOutputFp: FixedPointIntSchema.optional(),
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
    march: z.array(z.object({ regionId: RegionIdSchema, dueUtc: UtcEpochMsSchema }).strict()).min(1).optional(),
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
    kind: z.enum(['NON_AGGRESSION', 'TRADE_CORRIDOR', 'NEUTRAL_ZONE', 'SHARED_INTEL']),
    status: TreatyStatusSchema,
    createdAtUtc: UtcEpochMsSchema,
    expiresAtUtc: UtcEpochMsSchema.nullable(),
  })
  .strict();
export type Treaty = z.infer<typeof TreatySchema>;

export const EconomicLedgerKindSchema = z.enum([
  'PRODUCTION_CYCLE',
  'UPKEEP_CYCLE',
  'TRANSFER_DEBIT',
  'TRANSFER_CREDIT',
  'JOB_RESERVE',
  'JOB_REFUND',
  'JOB_CANCEL_OVERHEAD',
  'JOB_COMPLETE_SETTLE',
  'POLICY_ENACT',
]);
export type EconomicLedgerKind = z.infer<typeof EconomicLedgerKindSchema>;

export const EconomicLedgerEntrySchema = z
  .object({
    transactionId: LedgerTransactionIdSchema,
    occurredAtUtc: UtcEpochMsSchema,
    kind: EconomicLedgerKindSchema,
    nationId: NationIdSchema,
    resource: ResourceTypeSchema,
    direction: z.enum(['CREDIT', 'DEBIT']),
    amountFp: FixedPointIntSchema,
    balanceAfterFp: FixedPointIntSchema,
    source: z.string().min(1).max(80),
    destination: z.string().min(1).max(80),
    causedByCommandId: CommandIdSchema,
    note: z.string().min(1).max(160),
  })
  .strict();
export type EconomicLedgerEntry = z.infer<typeof EconomicLedgerEntrySchema>;

export const EconomicMatchStateSchema = z
  .object({
    settlementIntervalMs: z.number().int().min(60_000).max(86_400_000),
    lastSettlementUtc: UtcEpochMsSchema,
    taxRateBpsByNation: z.record(z.string(), z.number().int().min(1000).max(4000)),
    stockpileCaps: ResourceLedgerSchema,
    transactionSequence: z.number().int().min(0),
    ledgerCap: z.number().int().min(50).max(2000).default(250),
  })
  .strict();
export type EconomicMatchState = z.infer<typeof EconomicMatchStateSchema>;

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
  z.object({type:z.literal('UPDATE_INTEL_PACT'),treatyId:TreatyIdSchema,decision:z.enum(['ACCEPT','END'])}).strict(),
  z.object({type:z.literal('ORDER_MARCH'),unitId:UnitIdSchema,targetRegionId:RegionIdSchema}).strict(),
  z.object({type:z.literal('REROUTE_MARCH'),unitId:UnitIdSchema,targetRegionId:RegionIdSchema}).strict(),
  z.object({type:z.literal('HALT_MARCH'),unitId:UnitIdSchema}).strict(),
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
      kind: z.enum(['NON_AGGRESSION', 'TRADE_CORRIDOR', 'NEUTRAL_ZONE', 'SHARED_INTEL']),
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
  z
    .object({
      type: z.literal('SET_TAX_RATE'),
      nationId: NationIdSchema,
      taxRateBps: z.number().int().min(1000).max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal('CANCEL_JOB'),
      jobId: JobIdSchema,
      nationId: NationIdSchema,
    })
    .strict(),
  // P03-01: Direct 8-resource reservation / commit / release lifecycle
  z
    .object({
      type: z.literal('RESERVE_RESOURCES'),
      reservationId: ReservationIdSchema,
      nationId: NationIdSchema,
      refId: z.string().min(1).max(80),
      basket: ExtendedResourceBasketSchema,
      note: z.string().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal('COMMIT_RESERVATION'),
      reservationId: ReservationIdSchema,
      nationId: NationIdSchema,
      consumedBasket: ExtendedResourceBasketSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('RELEASE_RESERVATION'),
      reservationId: ReservationIdSchema,
      nationId: NationIdSchema,
      consumedBeforeCancel: ExtendedResourceBasketSchema.optional(),
    })
    .strict(),
  // P03-02: Fiscal budget policy (delayed tax + 4-sector allocation) & bounded credit
  z
    .object({
      type: z.literal('UPDATE_BUDGET_POLICY'),
      nationId: NationIdSchema,
      targetTaxRateBps: z.number().int().min(500).max(6000),
      allocations: BudgetAllocationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('MANAGE_CREDIT'),
      nationId: NationIdSchema,
      action: z.enum(['DRAW', 'REPAY']),
      amountFp: FixedPointIntSchema.refine((v) => (v as number) > 0, {
        message: 'Số tiền vay/trả nợ phải lớn hơn 0.',
      }),
    })
    .strict(),
  // P03-03: 8 facility types (Tiers I-III), construction queue, production queue & operational pause
  z
    .object({
      type: z.literal('QUEUE_CONSTRUCTION'),
      orderId: ConstructionOrderIdSchema,
      nationId: NationIdSchema,
      regionId: RegionIdSchema,
      facilityType: FacilityTypeSchema,
      targetFacilityId: FacilityIdSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      type: z.literal('CANCEL_CONSTRUCTION'),
      orderId: ConstructionOrderIdSchema,
      nationId: NationIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('QUEUE_PRODUCTION'),
      orderId: ProductionOrderIdSchema,
      nationId: NationIdSchema,
      facilityId: FacilityIdSchema,
      batchCount: z.number().int().min(1).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal('CANCEL_PRODUCTION'),
      orderId: ProductionOrderIdSchema,
      nationId: NationIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('TOGGLE_FACILITY_PAUSE'),
      nationId: NationIdSchema,
      facilityId: FacilityIdSchema,
      paused: z.boolean(),
    })
    .strict(),
  // Modern Vietnam Campaign (vietnam_campaign_v1) authoritative commands
  z
    .object({
      type: z.literal('CAMPAIGN_START_RESEARCH'),
      nationId: NationIdSchema,
      doctrineKey: CampaignDoctrineKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_CANCEL_RESEARCH'),
      nationId: NationIdSchema,
      doctrineKey: CampaignDoctrineKeySchema,
      expectedStartUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_START_CITY_PROJECT'),
      nationId: NationIdSchema,
      cityId: RegionIdSchema,
      projectKey: CampaignProjectKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_CANCEL_CITY_PROJECT'),
      nationId: NationIdSchema,
      cityId: RegionIdSchema,
      projectKey: CampaignProjectKeySchema,
      expectedStartUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_MOVE_UNIT'),
      nationId: NationIdSchema,
      unitId: UnitIdSchema,
      toCityId: RegionIdSchema.nullable(),
      expectedRev: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_SET_DIPLOMACY'),
      nationId: NationIdSchema,
      targetNationId: NationIdSchema,
      action: CampaignDiplomacyActionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_GROUP_UNITS'),
      nationId: NationIdSchema,
      action: z.enum(['MERGE', 'SPLIT', 'MOVE_STACK']),
      unitIds: z.array(UnitIdSchema).max(20).optional(),
      stackId: z.string().min(3).max(40).optional(),
      toCityId: RegionIdSchema.nullable().optional(),
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
  z.object({type:z.literal('INTEL_PACT_STATUS'),treatyId:TreatyIdSchema,status:TreatyStatusSchema}).strict(),
  z.object({type:z.literal('MARCH_CHANGED'),unitId:UnitIdSchema,nationId:NationIdSchema,status:z.enum(['STARTED','STOPPED'])}).strict(),
  z
    .object({
      type: z.literal('UNIT_MOVED'),
      nationId: NationIdSchema.optional(),
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
      kind: z.enum(['NON_AGGRESSION', 'TRADE_CORRIDOR', 'NEUTRAL_ZONE', 'SHARED_INTEL']),
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
  z
    .object({
      type: z.literal('TAX_RATE_UPDATED'),
      nationId: NationIdSchema,
      previousTaxRateBps: z.number().int().min(1000).max(4000),
      newTaxRateBps: z.number().int().min(1000).max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal('JOB_CANCELLED'),
      jobId: JobIdSchema,
      nationId: NationIdSchema,
      refunded: ResourceLedgerSchema,
      burnedOverhead: ResourceLedgerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('ECONOMY_CYCLE_SETTLED'),
      cycleUtc: UtcEpochMsSchema,
      cyclesSettled: z.number().int().min(1),
      totalMinted: ResourceLedgerSchema,
      totalBurned: ResourceLedgerSchema,
      shortfallNationIds: z.array(NationIdSchema),
    })
    .strict(),
  // Phase 03 domain events
  z
    .object({
      type: z.literal('RESOURCES_RESERVED'),
      reservationId: ReservationIdSchema,
      nationId: NationIdSchema,
      refId: z.string(),
      basket: ExtendedResourceBasketSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('RESERVATION_SETTLED'),
      reservationId: ReservationIdSchema,
      nationId: NationIdSchema,
      outcome: z.enum(['COMMITTED', 'RELEASED', 'PARTIAL_RELEASED']),
      consumed: ExtendedResourceBasketSchema,
      released: ExtendedResourceBasketSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('BUDGET_POLICY_UPDATED'),
      nationId: NationIdSchema,
      effectiveTaxRateBps: z.number().int().min(500).max(6000),
      targetTaxRateBps: z.number().int().min(500).max(6000),
      taxChangeEffectiveAtUtc: UtcEpochMsSchema.nullable(),
      allocations: BudgetAllocationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CREDIT_UPDATED'),
      nationId: NationIdSchema,
      action: z.enum(['DRAW', 'REPAY']),
      amountFp: FixedPointIntSchema,
      debtAfterFp: FixedPointIntSchema,
      creditLimitFp: FixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CONSTRUCTION_QUEUED'),
      orderId: ConstructionOrderIdSchema,
      nationId: NationIdSchema,
      regionId: RegionIdSchema,
      facilityType: FacilityTypeSchema,
      targetTier: FacilityTierSchema,
      completesAtUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CONSTRUCTION_COMPLETED'),
      orderId: ConstructionOrderIdSchema,
      facilityId: FacilityIdSchema,
      nationId: NationIdSchema,
      regionId: RegionIdSchema,
      facilityType: FacilityTypeSchema,
      tier: FacilityTierSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CONSTRUCTION_CANCELLED'),
      orderId: ConstructionOrderIdSchema,
      nationId: NationIdSchema,
      consumed: ExtendedResourceBasketSchema,
      refunded: ExtendedResourceBasketSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PRODUCTION_QUEUED'),
      orderId: ProductionOrderIdSchema,
      nationId: NationIdSchema,
      facilityId: FacilityIdSchema,
      outputResource: ExtendedResourceTypeSchema,
      outputAmountFp: FixedPointIntSchema,
      completesAtUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PRODUCTION_COMPLETED'),
      orderId: ProductionOrderIdSchema,
      nationId: NationIdSchema,
      facilityId: FacilityIdSchema,
      outputResource: ExtendedResourceTypeSchema,
      outputAmountFp: FixedPointIntSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PRODUCTION_CANCELLED'),
      orderId: ProductionOrderIdSchema,
      nationId: NationIdSchema,
      consumed: ExtendedResourceBasketSchema,
      refunded: ExtendedResourceBasketSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('FACILITY_STATUS_CHANGED'),
      facilityId: FacilityIdSchema,
      nationId: NationIdSchema,
      operationalStatus: FacilityOperationalStatusSchema,
      pauseReason: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PHASE03_CYCLE_SETTLED'),
      cycleUtc: UtcEpochMsSchema,
      cyclesSettled: z.number().int().min(1),
      austerityNationIds: z.array(NationIdSchema),
      pausedFacilityIds: z.array(FacilityIdSchema),
    })
    .strict(),
  // Modern Vietnam Campaign (vietnam_campaign_v1) domain events
  z
    .object({
      type: z.literal('CAMPAIGN_RESEARCH_STARTED'),
      nationId: NationIdSchema,
      doctrineKey: CampaignDoctrineKeySchema,
      startUtc: UtcEpochMsSchema,
      endUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_RESEARCH_CANCELLED'),
      nationId: NationIdSchema,
      doctrineKey: CampaignDoctrineKeySchema,
      refunded: CampaignResourceTupleSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_RESEARCH_COMPLETED'),
      nationId: NationIdSchema,
      doctrineKey: CampaignDoctrineKeySchema,
      completedAtUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_CITY_PROJECT_STARTED'),
      nationId: NationIdSchema,
      cityId: RegionIdSchema,
      projectKey: CampaignProjectKeySchema,
      lane: CampaignLaneSchema,
      startUtc: UtcEpochMsSchema,
      endUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_CITY_PROJECT_CANCELLED'),
      nationId: NationIdSchema,
      cityId: RegionIdSchema,
      projectKey: CampaignProjectKeySchema,
      refunded: CampaignResourceTupleSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_CITY_PROJECT_COMPLETED'),
      nationId: NationIdSchema,
      cityId: RegionIdSchema,
      projectKey: CampaignProjectKeySchema,
      newLevel: z.number().int().min(0).optional(),
      spawnedUnitId: UnitIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_UNIT_ORDER_ISSUED'),
      nationId: NationIdSchema,
      unitId: UnitIdSchema,
      toCityId: RegionIdSchema.nullable(),
      startUtc: UtcEpochMsSchema,
      endUtc: UtcEpochMsSchema.nullable(),
      durationMs: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_UNIT_ARRIVED'),
      nationId: NationIdSchema,
      unitId: UnitIdSchema,
      cityId: RegionIdSchema,
      arrivedAtUtc: UtcEpochMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_DIPLOMACY_CHANGED'),
      actorNationId: NationIdSchema,
      targetNationId: NationIdSchema,
      action: CampaignDiplomacyActionSchema,
      relation: CampaignRelationStatusSchema,
      sharedIntelActive: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_COMBAT_RESOLVED'),
      reportId: z.string(),
      kind: z.enum(['MELEE', 'BOMBARDMENT', 'AIRSTRIKE']),
      locationName: z.string(),
      attackerNationId: NationIdSchema,
      defenderNationId: NationIdSchema,
      damageToDefenders: z.number().int().min(0),
      damageToAttackers: z.number().int().min(0),
      destroyedUnitIds: z.array(UnitIdSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_UNITS_GROUPED'),
      nationId: NationIdSchema,
      action: z.enum(['MERGE', 'SPLIT', 'MOVE_STACK']),
      stackId: z.string().nullable(),
      unitIds: z.array(UnitIdSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_CITY_CAPTURED'),
      cityId: RegionIdSchema,
      cityName: z.string(),
      previousOwnerNationId: NationIdSchema,
      newOwnerNationId: NationIdSchema,
      capturedByUnitId: UnitIdSchema,
      newOwnerVp: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAMPAIGN_MATCH_ENDED'),
      winnerNationId: NationIdSchema,
      winnerSlot: HumanSlotSchema,
      reason: z.enum(['VICTORY_POINTS', 'TOTAL_CONQUEST', 'SURRENDER']),
      winnerVp: z.number().int().min(0),
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
    scenarioId: ScenarioIdSchema.optional(),
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
    economicState: EconomicMatchStateSchema.optional(),
    economicLedger: z.array(EconomicLedgerEntrySchema).optional(),
    phase03Economy: Phase03EconomyStateSchema.optional(),
    campaignState: CampaignMatchStateSchema.optional(),
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
