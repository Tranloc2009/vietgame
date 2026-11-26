import {
  asFixedPoint,
  asSignedFixedPoint,
  asUtcEpochMs,
  CommandId,
  EconomicLedgerEntry,
  EconomicLedgerKind,
  EconomicMatchState,
  FixedPointInt,
  FIXED_POINT_SCALE,
  fpAdd,
  fpMulRatio,
  fpSub,
  LedgerTransactionIdSchema,
  MatchState,
  Nation,
  NationId,
  Policy,
  REALTIME_SECONDS_PER_GAME_DAY,
  Region,
  RegionId,
  ResourceAudit,
  ResourceLedger,
  ResourceType,
  SignedFixedPointInt,
  Unit,
  UnitCategory,
  UtcEpochMs,
  wholeUnitsToFixedPoint,
} from '../contracts';

export const RESOURCE_TYPES: readonly ResourceType[] = [
  'food',
  'industrial',
  'treasury',
  'manpower',
  'politicalCapital',
];

/**
 * Authoritative economic settlement cadence: 1 real-time hour (24 cycles per 24h game day).
 */
export const ECONOMIC_SETTLEMENT_INTERVAL_MS = 3_600_000;
export const CYCLES_PER_GAME_DAY = Math.floor(
  (REALTIME_SECONDS_PER_GAME_DAY * 1000) / ECONOMIC_SETTLEMENT_INTERVAL_MS
);

/**
 * Job cancellation policy: 80.0% exact fixed-point refund, remaining 20.0% burned as overhead.
 */
export const JOB_CANCEL_REFUND_RATIO_FP = asFixedPoint(800);

/**
 * Tax rate bounds in basis points (10.0% to 40.0%, default 20.0%).
 */
export const MIN_TAX_RATE_BPS = 1000;
export const MAX_TAX_RATE_BPS = 4000;
export const DEFAULT_TAX_RATE_BPS = 2000;
export const DEFAULT_LEDGER_CAP = 250;

/**
 * Stability penalty (-1.000) per hourly cycle when food or treasury upkeep cannot be covered.
 */
export const SHORTFALL_STABILITY_PENALTY_FP = asFixedPoint(1000);

export const DEFAULT_STOCKPILE_CAPS: ResourceLedger = {
  food: wholeUnitsToFixedPoint(5000),
  industrial: wholeUnitsToFixedPoint(5000),
  treasury: wholeUnitsToFixedPoint(5000),
  manpower: wholeUnitsToFixedPoint(5000),
  politicalCapital: wholeUnitsToFixedPoint(500),
};

/**
 * Data-driven daily upkeep per unit category (fixed-point integer scale = 1000).
 * All values are multiples of 24 so per-hour division is exact without precision loss.
 */
export const UNIT_DAILY_UPKEEP_FP: Readonly<Record<UnitCategory, ResourceLedger>> = {
  INFANTRY_ABSTRACT: {
    food: asFixedPoint(6000), // 6.000/day (0.250/h)
    industrial: asFixedPoint(2400), // 2.400/day (0.100/h)
    treasury: asFixedPoint(4800), // 4.800/day (0.200/h)
    manpower: asFixedPoint(1200), // 1.200/day (0.050/h)
    politicalCapital: asFixedPoint(0),
  },
  LOGISTICS_ABSTRACT: {
    food: asFixedPoint(3600), // 3.600/day (0.150/h)
    industrial: asFixedPoint(3600), // 3.600/day (0.150/h)
    treasury: asFixedPoint(3600), // 3.600/day (0.150/h)
    manpower: asFixedPoint(600), // 0.600/day (0.025/h)
    politicalCapital: asFixedPoint(0),
  },
  CIVIC_CORPS: {
    food: asFixedPoint(2400), // 2.400/day (0.100/h)
    industrial: asFixedPoint(1200), // 1.200/day (0.050/h)
    treasury: asFixedPoint(2400), // 2.400/day (0.100/h)
    manpower: asFixedPoint(600), // 0.600/day (0.025/h)
    politicalCapital: asFixedPoint(0),
  },
};

export interface SignedResourceLedger {
  readonly food: SignedFixedPointInt;
  readonly industrial: SignedFixedPointInt;
  readonly treasury: SignedFixedPointInt;
  readonly manpower: SignedFixedPointInt;
  readonly politicalCapital: SignedFixedPointInt;
}

export interface RegionEconomicContribution {
  readonly regionId: RegionId;
  readonly name: string;
  readonly economicOutputFp: FixedPointInt;
  readonly infrastructureFp: FixedPointInt;
  readonly supplyCapacityFp: FixedPointInt;
  readonly dailyContribution: ResourceLedger;
}

export interface NationEconomicForecast {
  readonly nationId: NationId;
  readonly nationName: string;
  readonly controlledRegionCount: number;
  readonly activeUnitCount: number;
  readonly activePolicyCount: number;
  readonly taxRateBps: number;
  readonly settlementIntervalMs: number;
  readonly lastSettlementUtc: UtcEpochMs;
  readonly nextSettlementUtc: UtcEpochMs;
  readonly currentBalance: ResourceLedger;
  readonly stockpileCaps: ResourceLedger;
  readonly grossDaily: ResourceLedger;
  readonly upkeepDaily: ResourceLedger;
  readonly netDailySigned: SignedResourceLedger;
  readonly grossPerCycle: ResourceLedger;
  readonly upkeepPerCycle: ResourceLedger;
  readonly topRegions: readonly RegionEconomicContribution[];
}

export function createZeroResourceLedger(): ResourceLedger {
  return {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };
}

export function createInitialEconomicMatchState(
  nations: Readonly<Record<string, Nation>>,
  createdAtUtc: UtcEpochMs,
  options?: {
    settlementIntervalMs?: number;
    defaultTaxRateBps?: number;
    stockpileCaps?: ResourceLedger;
    ledgerCap?: number;
  }
): EconomicMatchState {
  const taxRate = options?.defaultTaxRateBps ?? DEFAULT_TAX_RATE_BPS;
  const taxRateBpsByNation: Record<string, number> = {};
  for (const nationId of Object.keys(nations).sort()) {
    taxRateBpsByNation[nationId] = taxRate;
  }
  return {
    settlementIntervalMs: options?.settlementIntervalMs ?? ECONOMIC_SETTLEMENT_INTERVAL_MS,
    lastSettlementUtc: createdAtUtc,
    taxRateBpsByNation,
    stockpileCaps: options?.stockpileCaps ?? { ...DEFAULT_STOCKPILE_CAPS },
    transactionSequence: 0,
    ledgerCap: options?.ledgerCap ?? DEFAULT_LEDGER_CAP,
  };
}

function addLedgerValues(a: ResourceLedger, b: ResourceLedger): ResourceLedger {
  return {
    food: fpAdd(a.food, b.food),
    industrial: fpAdd(a.industrial, b.industrial),
    treasury: fpAdd(a.treasury, b.treasury),
    manpower: fpAdd(a.manpower, b.manpower),
    politicalCapital: fpAdd(a.politicalCapital, b.politicalCapital),
  };
}

function mulDivBigInt(a: number, b: number, divisor: number): FixedPointInt {
  const result = (BigInt(a) * BigInt(b)) / BigInt(divisor);
  return asFixedPoint(Number(result));
}

function mul3DivBigInt(a: number, b: number, c: number, divisor: number): FixedPointInt {
  const result = (BigInt(a) * BigInt(b) * BigInt(c)) / BigInt(divisor);
  return asFixedPoint(Number(result));
}

function deriveRegionEconomicOutputFp(region: Region): FixedPointInt {
  if (region.economicOutputFp !== undefined) {
    return region.economicOutputFp;
  }
  return asFixedPoint(
    Math.floor(((region.infrastructureFp as number) + (region.supplyCapacityFp as number)) / 2)
  );
}

/**
 * Pure deterministic calculation of a single region's daily resource output
 * scaled by infrastructure, national stability, and fiscal tax rate.
 */
function computeRegionDailyContribution(
  region: Region,
  nationStabilityFp: FixedPointInt,
  taxRateBps: number
): RegionEconomicContribution {
  const economicOutputFp = deriveRegionEconomicOutputFp(region);

  // Infrastructure efficiency multiplier (scale 1000): 0.750x base + up to ~0.625x from infra
  const infraFactor = 750 + Math.floor((region.infrastructureFp as number) / 160);
  // Stability multiplier (scale 1000): 0.600x base + up to 0.500x at 100.000 stability
  const stabilityFactor = 600 + Math.floor((nationStabilityFp as number) / 200);

  // Fiscal trade-off driven by taxRateBps (1000..4000, baseline 2000 = 20%):
  // - Higher taxes raise treasury revenue (0.750x at 10% -> 1.500x at 40%)
  // - Higher taxes slightly moderate industrial output (1.050x at 10% -> 0.900x at 40%)
  // - Higher taxes reduce political capital generation (1.080x at 10% -> 0.840x at 40%)
  const treasuryTaxFactor = 500 + Math.floor(taxRateBps / 4);
  const industrialTaxFactor = 1100 - Math.floor(taxRateBps / 20);
  const politicalTaxFactor = 1160 - Math.floor((taxRateBps * 8) / 100);

  const food = mulDivBigInt(region.supplyCapacityFp as number, stabilityFactor, FIXED_POINT_SCALE * 24);
  const industrial = mul3DivBigInt(
    economicOutputFp as number,
    infraFactor,
    industrialTaxFactor,
    FIXED_POINT_SCALE * FIXED_POINT_SCALE * 28
  );
  const treasury = mul3DivBigInt(
    economicOutputFp as number,
    stabilityFactor,
    treasuryTaxFactor,
    FIXED_POINT_SCALE * FIXED_POINT_SCALE * 30
  );
  const manpower = mulDivBigInt(
    region.supplyCapacityFp as number,
    stabilityFactor,
    FIXED_POINT_SCALE * 48
  );
  // Small regional governance contribution to political capital (0.100/day * politicalTaxFactor)
  const politicalCapital = mulDivBigInt(100, politicalTaxFactor, FIXED_POINT_SCALE);

  return {
    regionId: region.regionId,
    name: region.name,
    economicOutputFp,
    infrastructureFp: region.infrastructureFp,
    supplyCapacityFp: region.supplyCapacityFp,
    dailyContribution: {
      food,
      industrial,
      treasury,
      manpower,
      politicalCapital,
    },
  };
}

/**
 * Computes a complete deterministic economic forecast for a single nation
 * from authoritative MatchState slices (zero floats, zero side effects).
 */
export function computeNationEconomicForecastFromSlices(
  nations: Readonly<Record<string, Nation>>,
  regions: Readonly<Record<string, Region>>,
  units: Readonly<Record<string, Unit>>,
  policies: Readonly<Record<string, Policy>>,
  economicState: EconomicMatchState,
  nationId: NationId
): NationEconomicForecast {
  const nation = nations[nationId];
  if (!nation) {
    throw new Error(`Cannot compute economic forecast: unknown nation "${nationId}".`);
  }

  const taxRateBps = economicState.taxRateBpsByNation[nationId] ?? DEFAULT_TAX_RATE_BPS;
  const politicalTaxFactor = 1160 - Math.floor((taxRateBps * 8) / 100);

  // Baseline national governance political capital (6.000/day scaled by fiscal tax rate)
  let grossDaily: ResourceLedger = {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: mulDivBigInt(wholeUnitsToFixedPoint(6) as number, politicalTaxFactor, FIXED_POINT_SCALE),
  };

  const controlledRegions = Object.values(regions)
    .filter((r) => r.controllerNationId === nationId)
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));

  const contributions: RegionEconomicContribution[] = [];
  for (const region of controlledRegions) {
    const contrib = computeRegionDailyContribution(region, nation.stabilityFp, taxRateBps);
    contributions.push(contrib);
    grossDaily = addLedgerValues(grossDaily, contrib.dailyContribution);
  }

  let upkeepDaily = createZeroResourceLedger();
  const activeUnits = Object.values(units).filter((u) => u.ownerNationId === nationId);
  for (const unit of activeUnits) {
    upkeepDaily = addLedgerValues(upkeepDaily, UNIT_DAILY_UPKEEP_FP[unit.category]);
  }

  const activePolicies = Object.values(policies).filter(
    (p) => p.ownerNationId === nationId && p.status === 'ACTIVE'
  );
  for (const policy of activePolicies) {
    upkeepDaily = addLedgerValues(upkeepDaily, policy.upkeepPerDay);
  }

  const cyclesPerDay = Math.max(
    1,
    Math.floor((REALTIME_SECONDS_PER_GAME_DAY * 1000) / economicState.settlementIntervalMs)
  );

  const grossPerCycle: ResourceLedger = {
    food: asFixedPoint(Math.floor((grossDaily.food as number) / cyclesPerDay)),
    industrial: asFixedPoint(Math.floor((grossDaily.industrial as number) / cyclesPerDay)),
    treasury: asFixedPoint(Math.floor((grossDaily.treasury as number) / cyclesPerDay)),
    manpower: asFixedPoint(Math.floor((grossDaily.manpower as number) / cyclesPerDay)),
    politicalCapital: asFixedPoint(Math.floor((grossDaily.politicalCapital as number) / cyclesPerDay)),
  };

  const upkeepPerCycle: ResourceLedger = {
    food: asFixedPoint(Math.floor((upkeepDaily.food as number) / cyclesPerDay)),
    industrial: asFixedPoint(Math.floor((upkeepDaily.industrial as number) / cyclesPerDay)),
    treasury: asFixedPoint(Math.floor((upkeepDaily.treasury as number) / cyclesPerDay)),
    manpower: asFixedPoint(Math.floor((upkeepDaily.manpower as number) / cyclesPerDay)),
    politicalCapital: asFixedPoint(Math.floor((upkeepDaily.politicalCapital as number) / cyclesPerDay)),
  };

  const netDailySigned: SignedResourceLedger = {
    food: asSignedFixedPoint((grossDaily.food as number) - (upkeepDaily.food as number)),
    industrial: asSignedFixedPoint(
      (grossDaily.industrial as number) - (upkeepDaily.industrial as number)
    ),
    treasury: asSignedFixedPoint(
      (grossDaily.treasury as number) - (upkeepDaily.treasury as number)
    ),
    manpower: asSignedFixedPoint(
      (grossDaily.manpower as number) - (upkeepDaily.manpower as number)
    ),
    politicalCapital: asSignedFixedPoint(
      (grossDaily.politicalCapital as number) - (upkeepDaily.politicalCapital as number)
    ),
  };

  const topRegions = [...contributions]
    .sort((a, b) => {
      const aTotal =
        (a.dailyContribution.treasury as number) +
        (a.dailyContribution.industrial as number) +
        (a.dailyContribution.food as number);
      const bTotal =
        (b.dailyContribution.treasury as number) +
        (b.dailyContribution.industrial as number) +
        (b.dailyContribution.food as number);
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.regionId < b.regionId ? -1 : 1;
    })
    .slice(0, 6);

  return {
    nationId,
    nationName: nation.name,
    controlledRegionCount: controlledRegions.length,
    activeUnitCount: activeUnits.length,
    activePolicyCount: activePolicies.length,
    taxRateBps,
    settlementIntervalMs: economicState.settlementIntervalMs,
    lastSettlementUtc: economicState.lastSettlementUtc,
    nextSettlementUtc: asUtcEpochMs(
      (economicState.lastSettlementUtc as number) + economicState.settlementIntervalMs
    ),
    currentBalance: { ...nation.resources },
    stockpileCaps: { ...economicState.stockpileCaps },
    grossDaily,
    upkeepDaily,
    netDailySigned,
    grossPerCycle,
    upkeepPerCycle,
    topRegions,
  };
}

export function computeNationEconomicForecast(
  state: MatchState,
  nationId: NationId
): NationEconomicForecast {
  const effectiveEcoState =
    state.economicState ?? createInitialEconomicMatchState(state.nations, state.createdAtUtc);
  return computeNationEconomicForecastFromSlices(
    state.nations,
    state.regions,
    state.units,
    state.policies,
    effectiveEcoState,
    nationId
  );
}

/**
 * Computes exact refund (80%) and burned overhead (exact remainder 20%) for a cancelled job.
 * Guarantees `refunded[k] + burnedOverhead[k] === reservedCost[k]` with zero rounding drift.
 */
export function computeJobCancellationSplit(reservedCost: ResourceLedger): {
  readonly refunded: ResourceLedger;
  readonly burnedOverhead: ResourceLedger;
} {
  const refunded: Record<ResourceType, FixedPointInt> = {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };
  const burnedOverhead: Record<ResourceType, FixedPointInt> = {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };

  for (const key of RESOURCE_TYPES) {
    const reserved = reservedCost[key];
    const refundAmount = fpMulRatio(reserved, JOB_CANCEL_REFUND_RATIO_FP);
    const burnAmount = fpSub(reserved, refundAmount);
    refunded[key] = refundAmount;
    burnedOverhead[key] = burnAmount;
  }

  return { refunded, burnedOverhead };
}

export interface AppendLedgerInput {
  readonly matchVersion: number;
  readonly occurredAtUtc: UtcEpochMs;
  readonly kind: EconomicLedgerKind;
  readonly nationId: NationId;
  readonly resource: ResourceType;
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly amountFp: FixedPointInt;
  readonly balanceAfterFp: FixedPointInt;
  readonly source: string;
  readonly destination: string;
  readonly causedByCommandId: CommandId;
  readonly note: string;
}

/**
 * Pure append helper that mints a deterministic LedgerTransactionId and enforces ledgerCap.
 */
export function appendEconomicLedgerEntry(
  economicState: EconomicMatchState,
  ledger: readonly EconomicLedgerEntry[],
  input: AppendLedgerInput
): {
  readonly economicState: EconomicMatchState;
  readonly ledger: EconomicLedgerEntry[];
  readonly entry: EconomicLedgerEntry;
} {
  const nextSeq = economicState.transactionSequence + 1;
  const transactionId = LedgerTransactionIdSchema.parse(
    `txn_v${input.matchVersion}_${String(nextSeq).padStart(6, '0')}`
  );
  const entry: EconomicLedgerEntry = {
    transactionId,
    occurredAtUtc: input.occurredAtUtc,
    kind: input.kind,
    nationId: input.nationId,
    resource: input.resource,
    direction: input.direction,
    amountFp: input.amountFp,
    balanceAfterFp: input.balanceAfterFp,
    source: input.source,
    destination: input.destination,
    causedByCommandId: input.causedByCommandId,
    note: input.note,
  };

  const combined = [...ledger, entry];
  const cap = economicState.ledgerCap;
  const trimmed = combined.length > cap ? combined.slice(combined.length - cap) : combined;

  return {
    economicState: {
      ...economicState,
      transactionSequence: nextSeq,
    },
    ledger: trimmed,
    entry,
  };
}

export interface EconomicSettlementResult {
  readonly nations: Record<string, Nation>;
  readonly resourceAudit: ResourceAudit;
  readonly economicState: EconomicMatchState;
  readonly economicLedger: EconomicLedgerEntry[];
  readonly settledEvent: {
    readonly type: 'ECONOMY_CYCLE_SETTLED';
    readonly cycleUtc: UtcEpochMs;
    readonly cyclesSettled: number;
    readonly totalMinted: ResourceLedger;
    readonly totalBurned: ResourceLedger;
    readonly shortfallNationIds: NationId[];
  } | null;
}

/**
 * Settles all complete hourly economic cycles between `economicState.lastSettlementUtc` and `targetUtc`.
 * Enforces:
 * - Exact conservation: every minted fp goes to both nation balance AND resourceAudit.mintedTotal;
 *   every burned upkeep fp is deducted from nation balance AND added to resourceAudit.burnedTotal.
 * - Stockpile caps: minting never exceeds economicState.stockpileCaps.
 * - Non-negative balances: upkeep burn is clamped at available balance; shortfall applies bounded stability penalty.
 */
export function settleDueEconomicCycles(params: {
  readonly matchVersion: number;
  readonly targetUtc: UtcEpochMs;
  readonly commandId: CommandId;
  readonly regions: Readonly<Record<string, Region>>;
  readonly units: Readonly<Record<string, Unit>>;
  readonly policies: Readonly<Record<string, Policy>>;
  readonly nations: Record<string, Nation>;
  readonly resourceAudit: ResourceAudit;
  readonly economicState: EconomicMatchState;
  readonly economicLedger: readonly EconomicLedgerEntry[];
}): EconomicSettlementResult {
  const {
    matchVersion,
    targetUtc,
    commandId,
    regions,
    units,
    policies,
  } = params;

  const elapsedMs = (targetUtc as number) - (params.economicState.lastSettlementUtc as number);
  const cycles = Math.floor(elapsedMs / params.economicState.settlementIntervalMs);

  if (cycles <= 0) {
    return {
      nations: params.nations,
      resourceAudit: params.resourceAudit,
      economicState: params.economicState,
      economicLedger: [...params.economicLedger],
      settledEvent: null,
    };
  }

  const nations: Record<string, Nation> = { ...params.nations };
  let resourceAudit: ResourceAudit = params.resourceAudit;
  let economicState: EconomicMatchState = { ...params.economicState };
  let economicLedger: EconomicLedgerEntry[] = [...params.economicLedger];

  let totalMinted = createZeroResourceLedger();
  let totalBurned = createZeroResourceLedger();
  const shortfallSet = new Set<NationId>();
  const sortedNationIds = Object.keys(nations).sort() as NationId[];

  for (let c = 1; c <= cycles; c += 1) {
    const cycleUtc = asUtcEpochMs(
      (params.economicState.lastSettlementUtc as number) + c * economicState.settlementIntervalMs
    );

    for (const nationId of sortedNationIds) {
      const forecast = computeNationEconomicForecastFromSlices(
        nations,
        regions,
        units,
        policies,
        economicState,
        nationId
      );

      let nation = nations[nationId];
      const nextResources: Record<ResourceType, FixedPointInt> = {
        ...nation.resources,
      };
      const nextMintedAudit: Record<ResourceType, FixedPointInt> = {
        ...resourceAudit.mintedTotal,
      };
      const nextBurnedAudit: Record<ResourceType, FixedPointInt> = {
        ...resourceAudit.burnedTotal,
      };
      const nextTotalMinted: Record<ResourceType, FixedPointInt> = { ...totalMinted };
      const nextTotalBurned: Record<ResourceType, FixedPointInt> = { ...totalBurned };

      // 1. Mint regional production (clamped at stockpile cap)
      for (const key of RESOURCE_TYPES) {
        const cap = economicState.stockpileCaps[key] as number;
        const current = nextResources[key] as number;
        const rawProduce = forecast.grossPerCycle[key] as number;
        const headroom = Math.max(0, cap - current);
        const actualMintedNum = Math.min(rawProduce, headroom);

        if (actualMintedNum > 0) {
          const actualMinted = asFixedPoint(actualMintedNum);
          const updatedBalance = fpAdd(nextResources[key], actualMinted);
          nextResources[key] = updatedBalance;
          nextMintedAudit[key] = fpAdd(nextMintedAudit[key], actualMinted);
          nextTotalMinted[key] = fpAdd(nextTotalMinted[key], actualMinted);

          const appended = appendEconomicLedgerEntry(economicState, economicLedger, {
            matchVersion,
            occurredAtUtc: cycleUtc,
            kind: 'PRODUCTION_CYCLE',
            nationId,
            resource: key,
            direction: 'CREDIT',
            amountFp: actualMinted,
            balanceAfterFp: updatedBalance,
            source: 'REGIONAL_OUTPUT',
            destination: nationId,
            causedByCommandId: commandId,
            note: `Sản lượng chu kỳ giờ (thuế ${(forecast.taxRateBps / 100).toFixed(0)}%)`,
          });
          economicState = appended.economicState;
          economicLedger = appended.ledger;
        }
      }

      // 2. Burn upkeep (clamped at available balance; never goes negative)
      let hadCriticalShortfall = false;
      for (const key of RESOURCE_TYPES) {
        const upkeepNeeded = forecast.upkeepPerCycle[key] as number;
        if (upkeepNeeded <= 0) continue;

        const current = nextResources[key] as number;
        const actualBurnNum = Math.min(current, upkeepNeeded);
        if (actualBurnNum < upkeepNeeded && (key === 'food' || key === 'treasury')) {
          hadCriticalShortfall = true;
          shortfallSet.add(nationId);
        }

        if (actualBurnNum > 0) {
          const actualBurn = asFixedPoint(actualBurnNum);
          const updatedBalance = fpSub(nextResources[key], actualBurn);
          nextResources[key] = updatedBalance;
          nextBurnedAudit[key] = fpAdd(nextBurnedAudit[key], actualBurn);
          nextTotalBurned[key] = fpAdd(nextTotalBurned[key], actualBurn);

          const appended = appendEconomicLedgerEntry(economicState, economicLedger, {
            matchVersion,
            occurredAtUtc: cycleUtc,
            kind: 'UPKEEP_CYCLE',
            nationId,
            resource: key,
            direction: 'DEBIT',
            amountFp: actualBurn,
            balanceAfterFp: updatedBalance,
            source: nationId,
            destination: 'UPKEEP_BURN',
            causedByCommandId: commandId,
            note: 'Chi phí duy trì lực lượng & chính sách theo chu kỳ giờ',
          });
          economicState = appended.economicState;
          economicLedger = appended.ledger;
        }
      }

      const updatedStability = hadCriticalShortfall
        ? asFixedPoint(
            Math.max(0, (nation.stabilityFp as number) - (SHORTFALL_STABILITY_PENALTY_FP as number))
          )
        : nation.stabilityFp;

      nation = {
        ...nation,
        resources: nextResources,
        stabilityFp: updatedStability,
      };
      nations[nationId] = nation;

      resourceAudit = {
        ...resourceAudit,
        mintedTotal: nextMintedAudit,
        burnedTotal: nextBurnedAudit,
      };
      totalMinted = nextTotalMinted;
      totalBurned = nextTotalBurned;
    }
  }

  const finalCycleUtc = asUtcEpochMs(
    (params.economicState.lastSettlementUtc as number) + cycles * economicState.settlementIntervalMs
  );
  economicState = {
    ...economicState,
    lastSettlementUtc: finalCycleUtc,
  };

  return {
    nations,
    resourceAudit,
    economicState,
    economicLedger,
    settledEvent: {
      type: 'ECONOMY_CYCLE_SETTLED',
      cycleUtc: finalCycleUtc,
      cyclesSettled: cycles,
      totalMinted,
      totalBurned,
      shortfallNationIds: [...shortfallSet].sort() as NationId[],
    },
  };
}
