import { z } from 'zod';
import {
  CommandIdSchema,
  ConstructionOrderIdSchema,
  FacilityIdSchema,
  FixedPointIntSchema,
  LedgerTransactionIdSchema,
  NationIdSchema,
  ProductionOrderIdSchema,
  RegionIdSchema,
  ReservationIdSchema,
  SignedFixedPointIntSchema,
  UtcEpochMsSchema,
} from './primitives';

/**
 * P03-01: Full 8-resource national economic ledger
 * (Tiền tệ, Ngoại tệ, Nhân lực, Lương thực, Nhiên liệu, Vật tư, Trang bị, Y tế).
 */
export const ExtendedResourceTypeSchema = z.enum([
  'money',
  'foreignExchange',
  'manpower',
  'food',
  'fuel',
  'supplies',
  'equipment',
  'medical',
]);
export type ExtendedResourceType = z.infer<typeof ExtendedResourceTypeSchema>;

export const ExtendedResourceBasketSchema = z
  .object({
    money: FixedPointIntSchema,
    foreignExchange: FixedPointIntSchema,
    manpower: FixedPointIntSchema,
    food: FixedPointIntSchema,
    fuel: FixedPointIntSchema,
    supplies: FixedPointIntSchema,
    equipment: FixedPointIntSchema,
    medical: FixedPointIntSchema,
  })
  .strict();
export type ExtendedResourceBasket = z.infer<typeof ExtendedResourceBasketSchema>;

export const SignedExtendedResourceBasketSchema = z
  .object({
    money: SignedFixedPointIntSchema,
    foreignExchange: SignedFixedPointIntSchema,
    manpower: SignedFixedPointIntSchema,
    food: SignedFixedPointIntSchema,
    fuel: SignedFixedPointIntSchema,
    supplies: SignedFixedPointIntSchema,
    equipment: SignedFixedPointIntSchema,
    medical: SignedFixedPointIntSchema,
  })
  .strict();
export type SignedExtendedResourceBasket = z.infer<typeof SignedExtendedResourceBasketSchema>;

export const NationExtendedStockSchema = z
  .object({
    available: ExtendedResourceBasketSchema,
    reserved: ExtendedResourceBasketSchema,
    storageCaps: ExtendedResourceBasketSchema,
    debtMoneyFp: FixedPointIntSchema,
  })
  .strict();
export type NationExtendedStock = z.infer<typeof NationExtendedStockSchema>;

export const ReservationStatusSchema = z.enum([
  'ACTIVE',
  'COMMITTED',
  'RELEASED',
  'PARTIAL_RELEASED',
]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const ReservationRefTypeSchema = z.enum([
  'MANUAL',
  'JOB',
  'CONSTRUCTION',
  'PRODUCTION',
]);
export type ReservationRefType = z.infer<typeof ReservationRefTypeSchema>;

export const ResourceReservationSchema = z
  .object({
    reservationId: ReservationIdSchema,
    ownerNationId: NationIdSchema,
    refType: ReservationRefTypeSchema,
    refId: z.string().min(1).max(80),
    status: ReservationStatusSchema,
    initialReserved: ExtendedResourceBasketSchema,
    consumedSoFar: ExtendedResourceBasketSchema,
    remainingReserved: ExtendedResourceBasketSchema,
    createdAtUtc: UtcEpochMsSchema,
    settledAtUtc: UtcEpochMsSchema.nullable(),
  })
  .strict();
export type ResourceReservation = z.infer<typeof ResourceReservationSchema>;

export const ExtendedLedgerKindSchema = z.enum([
  'PRODUCTION_CREDIT',
  'UPKEEP_DEBIT',
  'TAX_REVENUE',
  'FACILITY_UPKEEP',
  'FACILITY_OUTPUT',
  'RESERVATION_HOLD',
  'RESERVATION_COMMIT',
  'RESERVATION_RELEASE',
  'DEBT_DRAW',
  'DEBT_REPAY',
  'DEBT_INTEREST',
  'TRANSFER_DEBIT',
  'TRANSFER_CREDIT',
  'PRODUCTION_INPUT',
  'PRODUCTION_OUTPUT',
]);
export type ExtendedLedgerKind = z.infer<typeof ExtendedLedgerKindSchema>;

export const ExtendedLedgerEntrySchema = z
  .object({
    transactionId: LedgerTransactionIdSchema,
    occurredAtUtc: UtcEpochMsSchema,
    nationId: NationIdSchema,
    resource: ExtendedResourceTypeSchema,
    kind: ExtendedLedgerKindSchema,
    direction: z.enum(['CREDIT', 'DEBIT']),
    amountFp: FixedPointIntSchema,
    availableAfterFp: FixedPointIntSchema,
    reservedAfterFp: FixedPointIntSchema,
    debtMoneyAfterFp: FixedPointIntSchema,
    sourceAccount: z.string().min(1).max(80),
    destinationAccount: z.string().min(1).max(80),
    reservationId: ReservationIdSchema.nullable(),
    causedByCommandId: CommandIdSchema,
    note: z.string().min(1).max(180),
  })
  .strict();
export type ExtendedLedgerEntry = z.infer<typeof ExtendedLedgerEntrySchema>;

export const ExtendedResourceAuditSchema = z
  .object({
    initialTotal: ExtendedResourceBasketSchema,
    mintedTotal: ExtendedResourceBasketSchema,
    burnedTotal: ExtendedResourceBasketSchema,
  })
  .strict();
export type ExtendedResourceAudit = z.infer<typeof ExtendedResourceAuditSchema>;

/**
 * P03-02: Fiscal budget, delayed tax rate, 4-sector allocation, bounded credit & civilian morale.
 */
export const BudgetAllocationSchema = z
  .object({
    defenseBps: z.number().int().min(0).max(10000),
    civilianBps: z.number().int().min(0).max(10000),
    scienceBps: z.number().int().min(0).max(10000),
    industryBps: z.number().int().min(0).max(10000),
  })
  .strict()
  .refine(
    (a) => a.defenseBps + a.civilianBps + a.scienceBps + a.industryBps === 10000,
    { message: 'Tổng phân bổ 4 lĩnh vực ngân sách phải bằng đúng 10000 bps (100%).' }
  );
export type BudgetAllocation = z.infer<typeof BudgetAllocationSchema>;

export const FiscalStatusSchema = z.enum([
  'NORMAL',
  'WARNING_24H',
  'DEFICIT_BORROWING',
  'AUSTERITY_THROTTLED',
]);
export type FiscalStatus = z.infer<typeof FiscalStatusSchema>;

export const BudgetWarningCodeSchema = z.enum([
  'CASH_DEPLETION_24H',
  'DEBT_NEAR_LIMIT',
  'HIGH_TAX_LAFFER_DRAG',
  'AUSTERITY_ACTIVITY_REDUCED',
  'LOW_CIVILIAN_MORALE',
  'PENDING_TAX_TRANSITION',
]);
export type BudgetWarningCode = z.infer<typeof BudgetWarningCodeSchema>;

export const NationBudgetStateSchema = z
  .object({
    effectiveTaxRateBps: z.number().int().min(500).max(6000),
    targetTaxRateBps: z.number().int().min(500).max(6000),
    taxChangeEffectiveAtUtc: UtcEpochMsSchema.nullable(),
    taxCooldownUntilUtc: UtcEpochMsSchema.nullable(),
    taxFatigueFp: FixedPointIntSchema,
    allocations: BudgetAllocationSchema,
    creditLimitFp: FixedPointIntSchema,
    interestRateBpsPerDay: z.number().int().min(0).max(2000),
    civilianMoraleFp: FixedPointIntSchema,
    sciencePointsFp: FixedPointIntSchema,
    activityThrottleBps: z.number().int().min(2500).max(10000),
    fiscalStatus: FiscalStatusSchema,
    lastDeficitReason: z.string().max(180).nullable(),
  })
  .strict();
export type NationBudgetState = z.infer<typeof NationBudgetStateSchema>;

/**
 * P03-03: 8 facility types, Tiers I-III, separated ownership vs operational status,
 * construction queue & production queue with pause reasons and UTC deadlines.
 */
export const FacilityTypeSchema = z.enum([
  'POWER_PLANT',
  'CIVILIAN_HOUSING',
  'GRANARY_FARM',
  'FUEL_REFINERY',
  'SUPPLY_DEPOT',
  'ARMS_FACTORY',
  'MEDICAL_CENTER',
  'TRADE_PORT',
]);
export type FacilityType = z.infer<typeof FacilityTypeSchema>;

export const FacilityTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type FacilityTier = z.infer<typeof FacilityTierSchema>;

export const FacilityOperationalStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED_MANUAL',
  'PAUSED_NO_INPUTS',
  'PAUSED_NO_POWER',
  'PAUSED_NO_LABOR',
  'PAUSED_AUSTERITY',
  'DAMAGED',
]);
export type FacilityOperationalStatus = z.infer<typeof FacilityOperationalStatusSchema>;

export const FacilityInstanceSchema = z
  .object({
    // Ownership identity (strictly decoupled from runtime operational state)
    facilityId: FacilityIdSchema,
    regionId: RegionIdSchema,
    ownerNationId: NationIdSchema,
    type: FacilityTypeSchema,
    tier: FacilityTierSchema,
    builtAtUtc: UtcEpochMsSchema,
    // Operational state
    operationalStatus: FacilityOperationalStatusSchema,
    manualPaused: z.boolean(),
    efficiencyBps: z.number().int().min(0).max(10000),
    pauseReason: z.string().max(180).nullable(),
    lastSettledCycleUtc: UtcEpochMsSchema,
  })
  .strict();
export type FacilityInstance = z.infer<typeof FacilityInstanceSchema>;

export const QueueOrderStatusSchema = z.enum([
  'QUEUED',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
]);
export type QueueOrderStatus = z.infer<typeof QueueOrderStatusSchema>;

export const ConstructionQueueItemSchema = z
  .object({
    orderId: ConstructionOrderIdSchema,
    ownerNationId: NationIdSchema,
    regionId: RegionIdSchema,
    targetFacilityId: FacilityIdSchema.nullable(),
    facilityType: FacilityTypeSchema,
    targetTier: FacilityTierSchema,
    reservationId: ReservationIdSchema,
    startsAtUtc: UtcEpochMsSchema,
    durationMs: z.number().int().min(60_000).max(30 * 86_400_000),
    elapsedActiveMs: z.number().int().min(0),
    completesAtUtc: UtcEpochMsSchema,
    status: QueueOrderStatusSchema,
    pauseReason: z.string().max(180).nullable(),
    completedAtUtc: UtcEpochMsSchema.nullable(),
  })
  .strict();
export type ConstructionQueueItem = z.infer<typeof ConstructionQueueItemSchema>;

export const ProductionOrderSchema = z
  .object({
    orderId: ProductionOrderIdSchema,
    ownerNationId: NationIdSchema,
    facilityId: FacilityIdSchema,
    regionId: RegionIdSchema,
    outputResource: ExtendedResourceTypeSchema,
    outputAmountFp: FixedPointIntSchema,
    inputCost: ExtendedResourceBasketSchema,
    reservationId: ReservationIdSchema,
    batchCount: z.number().int().min(1).max(10),
    startsAtUtc: UtcEpochMsSchema,
    durationMs: z.number().int().min(60_000).max(30 * 86_400_000),
    elapsedActiveMs: z.number().int().min(0),
    completesAtUtc: UtcEpochMsSchema,
    status: QueueOrderStatusSchema,
    pauseReason: z.string().max(180).nullable(),
    completedAtUtc: UtcEpochMsSchema.nullable(),
  })
  .strict();
export type ProductionOrder = z.infer<typeof ProductionOrderSchema>;

export const Phase03EconomyStateSchema = z
  .object({
    settlementIntervalMs: z.number().int().min(60_000).max(86_400_000),
    lastSettlementUtc: UtcEpochMsSchema,
    transactionSequence: z.number().int().min(0),
    ledgerCap: z.number().int().min(50).max(2000),
    stocksByNation: z.record(z.string(), NationExtendedStockSchema),
    resourceAudit: ExtendedResourceAuditSchema,
    reservations: z.record(z.string(), ResourceReservationSchema),
    ledger: z.array(ExtendedLedgerEntrySchema),
    budgetsByNation: z.record(z.string(), NationBudgetStateSchema),
    facilities: z.record(z.string(), FacilityInstanceSchema),
    constructionQueue: z.record(z.string(), ConstructionQueueItemSchema),
    productionQueue: z.record(z.string(), ProductionOrderSchema),
  })
  .strict();
export type Phase03EconomyState = z.infer<typeof Phase03EconomyStateSchema>;
