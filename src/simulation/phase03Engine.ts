import {
  asFixedPoint,
  asSignedFixedPoint,
  asUtcEpochMs,
  BudgetWarningCode,
  CommandId,
  ConstructionOrderId,
  ConstructionQueueItem,
  ExtendedLedgerEntry,
  ExtendedLedgerKind,
  ExtendedResourceAudit,
  ExtendedResourceBasket,
  ExtendedResourceType,
  FacilityId,
  FacilityIdSchema,
  FacilityInstance,
  FacilityOperationalStatus,
  FacilityTier,
  FacilityType,
  FiscalStatus,
  FixedPointInt,
  FIXED_POINT_SCALE,
  fpAdd,
  fpSub,
  LedgerTransactionIdSchema,
  MatchState,
  Nation,
  NationBudgetState,
  NationExtendedStock,
  NationId,
  Phase03EconomyState,
  ProductionOrder,
  ProductionOrderId,
  Region,
  RegionId,
  ReservationId,
  ReservationIdSchema,
  ReservationRefType,
  ResourceReservation,
  SignedExtendedResourceBasket,
  Unit,
  UtcEpochMs,
  wholeUnitsToFixedPoint,
} from '../contracts';
import {
  BASE_EXTENDED_STORAGE_CAPS,
  computeEffectiveTaxYieldBps,
  computeTaxComplianceBps,
  createZeroExtendedBasket,
  DEFAULT_BUDGET_ALLOCATION,
  DEFAULT_INTEREST_RATE_BPS_PER_DAY,
  DEFAULT_PHASE03_LEDGER_CAP,
  DEFAULT_PHASE03_TAX_BPS,
  EXTENDED_RESOURCE_TYPES,
  FACILITY_CATALOG,
  makeExtendedBasket,
  MAX_MORALE_FP,
  PHASE03_SETTLEMENT_INTERVAL_MS,
  TAX_POLICY_DELAY_MS,
} from './phase03Catalog';

export function addExtendedBaskets(
  a: ExtendedResourceBasket,
  b: ExtendedResourceBasket
): ExtendedResourceBasket {
  return {
    money: fpAdd(a.money, b.money),
    foreignExchange: fpAdd(a.foreignExchange, b.foreignExchange),
    manpower: fpAdd(a.manpower, b.manpower),
    food: fpAdd(a.food, b.food),
    fuel: fpAdd(a.fuel, b.fuel),
    supplies: fpAdd(a.supplies, b.supplies),
    equipment: fpAdd(a.equipment, b.equipment),
    medical: fpAdd(a.medical, b.medical),
  };
}

export function subExtendedBaskets(
  a: ExtendedResourceBasket,
  b: ExtendedResourceBasket
): ExtendedResourceBasket {
  return {
    money: fpSub(a.money, b.money),
    foreignExchange: fpSub(a.foreignExchange, b.foreignExchange),
    manpower: fpSub(a.manpower, b.manpower),
    food: fpSub(a.food, b.food),
    fuel: fpSub(a.fuel, b.fuel),
    supplies: fpSub(a.supplies, b.supplies),
    equipment: fpSub(a.equipment, b.equipment),
    medical: fpSub(a.medical, b.medical),
  };
}

export function scaleExtendedBasket(
  basket: ExtendedResourceBasket,
  multiplier: number
): ExtendedResourceBasket {
  const m = BigInt(Math.max(0, Math.trunc(multiplier)));
  return {
    money: asFixedPoint(Number(BigInt(basket.money as number) * m)),
    foreignExchange: asFixedPoint(Number(BigInt(basket.foreignExchange as number) * m)),
    manpower: asFixedPoint(Number(BigInt(basket.manpower as number) * m)),
    food: asFixedPoint(Number(BigInt(basket.food as number) * m)),
    fuel: asFixedPoint(Number(BigInt(basket.fuel as number) * m)),
    supplies: asFixedPoint(Number(BigInt(basket.supplies as number) * m)),
    equipment: asFixedPoint(Number(BigInt(basket.equipment as number) * m)),
    medical: asFixedPoint(Number(BigInt(basket.medical as number) * m)),
  };
}

export function hasEnoughInBasket(
  available: ExtendedResourceBasket,
  required: ExtendedResourceBasket
): { ok: true } | { ok: false; missing: ReadonlyArray<{ resource: ExtendedResourceType; haveFp: FixedPointInt; needFp: FixedPointInt }> } {
  const missing: Array<{ resource: ExtendedResourceType; haveFp: FixedPointInt; needFp: FixedPointInt }> = [];
  for (const r of EXTENDED_RESOURCE_TYPES) {
    if ((available[r] as number) < (required[r] as number)) {
      missing.push({ resource: r, haveFp: available[r], needFp: required[r] });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export function isZeroExtendedBasket(basket: ExtendedResourceBasket): boolean {
  return EXTENDED_RESOURCE_TYPES.every((r) => (basket[r] as number) === 0);
}

/**
 * Exact pro-rata split when cancelling an active order/job:
 * consumed = floor(initial * elapsedMs / durationMs), refunded = initial - consumed.
 * Guarantees consumed + refunded === initial to the exact 1-fp micro-unit (zero drift).
 */
export function computeProRataCancellationSplit(
  initialReserved: ExtendedResourceBasket,
  elapsedActiveMs: number,
  durationMs: number
): {
  readonly consumed: ExtendedResourceBasket;
  readonly refunded: ExtendedResourceBasket;
} {
  const clampedElapsed = Math.max(0, Math.min(durationMs, Math.trunc(elapsedActiveMs)));
  const denom = Math.max(1, Math.trunc(durationMs));
  const consumed: Record<ExtendedResourceType, FixedPointInt> = {
    ...createZeroExtendedBasket(),
  };
  const refunded: Record<ExtendedResourceType, FixedPointInt> = {
    ...createZeroExtendedBasket(),
  };

  for (const r of EXTENDED_RESOURCE_TYPES) {
    const init = initialReserved[r];
    const spentNum = Number((BigInt(init as number) * BigInt(clampedElapsed)) / BigInt(denom));
    const spentFp = asFixedPoint(spentNum);
    consumed[r] = spentFp;
    refunded[r] = fpSub(init, spentFp);
  }

  return { consumed, refunded };
}

export function computeNationStorageCaps(
  facilities: Readonly<Record<string, FacilityInstance>>,
  nationId: NationId
): ExtendedResourceBasket {
  let caps: ExtendedResourceBasket = { ...BASE_EXTENDED_STORAGE_CAPS };
  for (const fac of Object.values(facilities)) {
    if (fac.ownerNationId !== nationId) continue;
    const spec = FACILITY_CATALOG[fac.type].tiers[fac.tier];
    caps = addExtendedBaskets(caps, spec.storageCapBonus);
  }
  return caps;
}

export interface NationCapacitySummary {
  readonly laborCapacityFp: FixedPointInt;
  readonly laborUsedFp: FixedPointInt;
  readonly energyCapacityFp: FixedPointInt;
  readonly energyUsedFp: FixedPointInt;
}

export function computeNationCapacitySummary(
  facilities: Readonly<Record<string, FacilityInstance>>,
  nationId: NationId
): NationCapacitySummary {
  let laborCap = 20_000; // Baseline administrative labor pool (20.000)
  let energyCap = 15_000; // Baseline municipal power grid (15.000)
  let laborUsed = 0;
  let energyUsed = 0;

  for (const fac of Object.values(facilities)) {
    if (fac.ownerNationId !== nationId) continue;
    const spec = FACILITY_CATALOG[fac.type].tiers[fac.tier];
    if (!fac.manualPaused && fac.operationalStatus !== 'DAMAGED') {
      laborCap += spec.laborCapacityProvidedFp as number;
      if (fac.operationalStatus !== 'PAUSED_NO_INPUTS') {
        energyCap += spec.energyCapacityProvidedFp as number;
      }
      laborUsed += spec.laborDemandFp as number;
      energyUsed += spec.energyDemandFp as number;
    }
  }

  return {
    laborCapacityFp: asFixedPoint(laborCap),
    laborUsedFp: asFixedPoint(laborUsed),
    energyCapacityFp: asFixedPoint(energyCap),
    energyUsedFp: asFixedPoint(energyUsed),
  };
}

/**
 * Seeds initial Phase 03 state (8-resource stocks, starter Tier I facilities,
 * balanced fiscal budget & bounded credit line) deterministically for any new match.
 */
export function createInitialPhase03EconomyState(
  nations: Readonly<Record<string, Nation>>,
  regions: Readonly<Record<string, Region>>,
  createdAtUtc: UtcEpochMs
): Phase03EconomyState {
  const facilities: Record<string, FacilityInstance> = {};
  const stocksByNation: Record<string, NationExtendedStock> = {};
  const budgetsByNation: Record<string, NationBudgetState> = {};

  const sortedNationIds = Object.keys(nations).sort() as NationId[];

  let initialTotal = createZeroExtendedBasket();

  for (const nationId of sortedNationIds) {
    const nation = nations[nationId];
    const isHuman = nation.slot === 'NORTH' || nation.slot === 'SOUTH';
    const capitalId = nation.capitalRegionId;

    // Seed starter facilities at capital (and a second controlled region if available)
    const controlled = Object.values(regions)
      .filter((r) => r.controllerNationId === nationId)
      .sort((a, b) => (a.regionId < b.regionId ? -1 : 1));
    const secondaryRegionId =
      controlled.find((r) => r.regionId !== capitalId)?.regionId ?? capitalId;

    const starterSpecs: Array<{ suffix: string; type: FacilityType; regionId: RegionId }> = isHuman
      ? [
          { suffix: 'pwr', type: 'POWER_PLANT', regionId: capitalId },
          { suffix: 'civ', type: 'CIVILIAN_HOUSING', regionId: capitalId },
          { suffix: 'frm', type: 'GRANARY_FARM', regionId: secondaryRegionId },
          { suffix: 'sup', type: 'SUPPLY_DEPOT', regionId: capitalId },
          { suffix: 'arm', type: 'ARMS_FACTORY', regionId: capitalId },
          { suffix: 'med', type: 'MEDICAL_CENTER', regionId: secondaryRegionId },
        ]
      : [
          { suffix: 'pwr', type: 'POWER_PLANT', regionId: capitalId },
          { suffix: 'civ', type: 'CIVILIAN_HOUSING', regionId: capitalId },
          { suffix: 'frm', type: 'GRANARY_FARM', regionId: capitalId },
        ];

    const shortCode = nation.code.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const s of starterSpecs) {
      const facId = FacilityIdSchema.parse(`fac_${shortCode}_${s.suffix}_01`);
      facilities[facId] = {
        facilityId: facId,
        regionId: s.regionId,
        ownerNationId: nationId,
        type: s.type,
        tier: 1,
        builtAtUtc: createdAtUtc,
        operationalStatus: 'ACTIVE',
        manualPaused: false,
        efficiencyBps: 10000,
        pauseReason: null,
        lastSettledCycleUtc: createdAtUtc,
      };
    }

    const available: ExtendedResourceBasket = isHuman
      ? {
          money: nation.resources.treasury,
          foreignExchange: wholeUnitsToFixedPoint(nation.slot === 'SOUTH' ? 180 : 140),
          manpower: nation.resources.manpower,
          food: nation.resources.food,
          fuel: wholeUnitsToFixedPoint(nation.slot === 'NORTH' ? 240 : 260),
          supplies: nation.resources.industrial,
          equipment: wholeUnitsToFixedPoint(120),
          medical: wholeUnitsToFixedPoint(100),
        }
      : {
          money: nation.resources.treasury,
          foreignExchange: wholeUnitsToFixedPoint(45),
          manpower: nation.resources.manpower,
          food: nation.resources.food,
          fuel: wholeUnitsToFixedPoint(90),
          supplies: nation.resources.industrial,
          equipment: wholeUnitsToFixedPoint(40),
          medical: wholeUnitsToFixedPoint(35),
        };

    const storageCaps = computeNationStorageCaps(facilities, nationId);
    stocksByNation[nationId] = {
      available,
      reserved: createZeroExtendedBasket(),
      storageCaps,
      debtMoneyFp: asFixedPoint(0),
    };
    initialTotal = addExtendedBaskets(initialTotal, available);

    budgetsByNation[nationId] = {
      effectiveTaxRateBps: DEFAULT_PHASE03_TAX_BPS,
      targetTaxRateBps: DEFAULT_PHASE03_TAX_BPS,
      taxChangeEffectiveAtUtc: null,
      taxCooldownUntilUtc: null,
      taxFatigueFp: asFixedPoint(0),
      allocations: { ...DEFAULT_BUDGET_ALLOCATION },
      creditLimitFp: wholeUnitsToFixedPoint(isHuman ? 250 : 80),
      interestRateBpsPerDay: DEFAULT_INTEREST_RATE_BPS_PER_DAY,
      civilianMoraleFp: nation.stabilityFp,
      sciencePointsFp: asFixedPoint(0),
      activityThrottleBps: 10000,
      fiscalStatus: 'NORMAL',
      lastDeficitReason: null,
    };
  }

  return {
    settlementIntervalMs: PHASE03_SETTLEMENT_INTERVAL_MS,
    lastSettlementUtc: createdAtUtc,
    transactionSequence: 0,
    ledgerCap: DEFAULT_PHASE03_LEDGER_CAP,
    stocksByNation,
    resourceAudit: {
      initialTotal,
      mintedTotal: createZeroExtendedBasket(),
      burnedTotal: createZeroExtendedBasket(),
    },
    reservations: {},
    ledger: [],
    budgetsByNation,
    facilities,
    constructionQueue: {},
    productionQueue: {},
  };
}

export function appendExtendedLedgerEntry(
  p03: Phase03EconomyState,
  input: {
    readonly matchVersion: number;
    readonly occurredAtUtc: UtcEpochMs;
    readonly nationId: NationId;
    readonly resource: ExtendedResourceType;
    readonly kind: ExtendedLedgerKind;
    readonly direction: 'CREDIT' | 'DEBIT';
    readonly amountFp: FixedPointInt;
    readonly sourceAccount: string;
    readonly destinationAccount: string;
    readonly reservationId: ReservationId | null;
    readonly causedByCommandId: CommandId;
    readonly note: string;
  }
): Phase03EconomyState {
  if ((input.amountFp as number) <= 0) return p03;
  const stock = p03.stocksByNation[input.nationId];
  if (!stock) return p03;

  const nextSeq = p03.transactionSequence + 1;
  const transactionId = LedgerTransactionIdSchema.parse(
    `txn_p3v${input.matchVersion}_${String(nextSeq).padStart(6, '0')}`
  );
  const entry: ExtendedLedgerEntry = {
    transactionId,
    occurredAtUtc: input.occurredAtUtc,
    nationId: input.nationId,
    resource: input.resource,
    kind: input.kind,
    direction: input.direction,
    amountFp: input.amountFp,
    availableAfterFp: stock.available[input.resource],
    reservedAfterFp: stock.reserved[input.resource],
    debtMoneyAfterFp: stock.debtMoneyFp,
    sourceAccount: input.sourceAccount,
    destinationAccount: input.destinationAccount,
    reservationId: input.reservationId,
    causedByCommandId: input.causedByCommandId,
    note: input.note,
  };

  const combined = [...p03.ledger, entry];
  const trimmed =
    combined.length > p03.ledgerCap
      ? combined.slice(combined.length - p03.ledgerCap)
      : combined;

  return {
    ...p03,
    transactionSequence: nextSeq,
    ledger: trimmed,
  };
}

/**
 * Reserves resources atomically from a nation's available stock into escrow (reserved).
 */
export function reserveNationResources(
  p03: Phase03EconomyState,
  params: {
    readonly matchVersion: number;
    readonly occurredAtUtc: UtcEpochMs;
    readonly commandId: CommandId;
    readonly reservationId: ReservationId;
    readonly nationId: NationId;
    readonly refType: ReservationRefType;
    readonly refId: string;
    readonly basket: ExtendedResourceBasket;
    readonly note: string;
  }
):
  | { ok: true; state: Phase03EconomyState; reservation: ResourceReservation }
  | { ok: false; code: 'DUPLICATE_ENTITY' | 'INVALID_TARGET' | 'INSUFFICIENT_RESOURCES'; reason: string } {
  if (p03.reservations[params.reservationId]) {
    return {
      ok: false,
      code: 'DUPLICATE_ENTITY',
      reason: `Reservation "${params.reservationId}" đã tồn tại.`,
    };
  }
  const stock = p03.stocksByNation[params.nationId];
  if (!stock) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      reason: `Không tìm thấy kho tài nguyên Phase 03 cho quốc gia "${params.nationId}".`,
    };
  }

  const check = hasEnoughInBasket(stock.available, params.basket);
  if (!check.ok) {
    const detail = check.missing
      .map((m) => `${m.resource} (có ${(m.haveFp as number) / 1000}, cần ${(m.needFp as number) / 1000})`)
      .join(', ');
    return {
      ok: false,
      code: 'INSUFFICIENT_RESOURCES',
      reason: `Không đủ tài nguyên khả dụng để tạm giữ: ${detail}.`,
    };
  }

  const nextStock: NationExtendedStock = {
    ...stock,
    available: subExtendedBaskets(stock.available, params.basket),
    reserved: addExtendedBaskets(stock.reserved, params.basket),
  };

  const reservation: ResourceReservation = {
    reservationId: params.reservationId,
    ownerNationId: params.nationId,
    refType: params.refType,
    refId: params.refId,
    status: 'ACTIVE',
    initialReserved: params.basket,
    consumedSoFar: createZeroExtendedBasket(),
    remainingReserved: params.basket,
    createdAtUtc: params.occurredAtUtc,
    settledAtUtc: null,
  };

  let nextP03: Phase03EconomyState = {
    ...p03,
    stocksByNation: {
      ...p03.stocksByNation,
      [params.nationId]: nextStock,
    },
    reservations: {
      ...p03.reservations,
      [params.reservationId]: reservation,
    },
  };

  for (const r of EXTENDED_RESOURCE_TYPES) {
    const amt = params.basket[r];
    if ((amt as number) > 0) {
      nextP03 = appendExtendedLedgerEntry(nextP03, {
        matchVersion: params.matchVersion,
        occurredAtUtc: params.occurredAtUtc,
        nationId: params.nationId,
        resource: r,
        kind: 'RESERVATION_HOLD',
        direction: 'DEBIT',
        amountFp: amt,
        sourceAccount: `STOCK:${params.nationId}`,
        destinationAccount: `ESCROW:${params.reservationId}`,
        reservationId: params.reservationId,
        causedByCommandId: params.commandId,
        note: params.note,
      });
    }
  }

  return { ok: true, state: nextP03, reservation };
}

/**
 * Settles an active reservation:
 * - `consumed` is permanently burned into resourceAudit.burnedTotal
 * - `released = remainingReserved - consumed` is refunded 100% back to nation available stock!
 */
export function settleNationReservation(
  p03: Phase03EconomyState,
  params: {
    readonly matchVersion: number;
    readonly occurredAtUtc: UtcEpochMs;
    readonly commandId: CommandId;
    readonly reservationId: ReservationId;
    readonly nationId: NationId;
    readonly consumed: ExtendedResourceBasket;
    readonly mode: 'COMMIT' | 'RELEASE';
    readonly note: string;
  }
):
  | {
      ok: true;
      state: Phase03EconomyState;
      outcome: 'COMMITTED' | 'RELEASED' | 'PARTIAL_RELEASED';
      consumed: ExtendedResourceBasket;
      released: ExtendedResourceBasket;
    }
  | { ok: false; code: 'INVALID_TARGET' | 'FORBIDDEN_ACTION'; reason: string } {
  const res = p03.reservations[params.reservationId];
  if (!res) {
    return { ok: false, code: 'INVALID_TARGET', reason: `Không tìm thấy reservation "${params.reservationId}".` };
  }
  if (res.ownerNationId !== params.nationId) {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTION',
      reason: `Quốc gia "${params.nationId}" không sở hữu reservation "${params.reservationId}".`,
    };
  }
  if (res.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      reason: `Reservation "${params.reservationId}" đã ở trạng thái ${res.status}.`,
    };
  }

  const stock = p03.stocksByNation[params.nationId];
  if (!stock) {
    return { ok: false, code: 'INVALID_TARGET', reason: `Không tìm thấy kho cho "${params.nationId}".` };
  }

  // Clamp consumed strictly within remainingReserved
  for (const r of EXTENDED_RESOURCE_TYPES) {
    if ((params.consumed[r] as number) > (res.remainingReserved[r] as number)) {
      return {
        ok: false,
        code: 'INVALID_TARGET',
        reason: `Phần tiêu thụ ${r} vượt quá số dư đang tạm giữ trong reservation.`,
      };
    }
  }

  const released = subExtendedBaskets(res.remainingReserved, params.consumed);
  const nextStock: NationExtendedStock = {
    ...stock,
    reserved: subExtendedBaskets(stock.reserved, res.remainingReserved),
    available: addExtendedBaskets(stock.available, released),
  };

  const outcome: 'COMMITTED' | 'RELEASED' | 'PARTIAL_RELEASED' =
    isZeroExtendedBasket(released)
      ? 'COMMITTED'
      : isZeroExtendedBasket(params.consumed)
        ? 'RELEASED'
        : 'PARTIAL_RELEASED';

  const updatedReservation: ResourceReservation = {
    ...res,
    status: outcome,
    consumedSoFar: addExtendedBaskets(res.consumedSoFar, params.consumed),
    remainingReserved: createZeroExtendedBasket(),
    settledAtUtc: params.occurredAtUtc,
  };

  let nextP03: Phase03EconomyState = {
    ...p03,
    stocksByNation: {
      ...p03.stocksByNation,
      [params.nationId]: nextStock,
    },
    resourceAudit: {
      ...p03.resourceAudit,
      burnedTotal: addExtendedBaskets(p03.resourceAudit.burnedTotal, params.consumed),
    },
    reservations: {
      ...p03.reservations,
      [params.reservationId]: updatedReservation,
    },
  };

  for (const r of EXTENDED_RESOURCE_TYPES) {
    if ((params.consumed[r] as number) > 0) {
      nextP03 = appendExtendedLedgerEntry(nextP03, {
        matchVersion: params.matchVersion,
        occurredAtUtc: params.occurredAtUtc,
        nationId: params.nationId,
        resource: r,
        kind: 'RESERVATION_COMMIT',
        direction: 'DEBIT',
        amountFp: params.consumed[r],
        sourceAccount: `ESCROW:${params.reservationId}`,
        destinationAccount: `CONSUMED:${res.refId}`,
        reservationId: params.reservationId,
        causedByCommandId: params.commandId,
        note: `${params.note} (đã tiêu thụ)`,
      });
    }
    if ((released[r] as number) > 0) {
      nextP03 = appendExtendedLedgerEntry(nextP03, {
        matchVersion: params.matchVersion,
        occurredAtUtc: params.occurredAtUtc,
        nationId: params.nationId,
        resource: r,
        kind: 'RESERVATION_RELEASE',
        direction: 'CREDIT',
        amountFp: released[r],
        sourceAccount: `ESCROW:${params.reservationId}`,
        destinationAccount: `STOCK:${params.nationId}`,
        reservationId: params.reservationId,
        causedByCommandId: params.commandId,
        note: `${params.note} (hoàn phần chưa tiêu)`,
      });
    }
  }

  return { ok: true, state: nextP03, outcome, consumed: params.consumed, released };
}

/**
 * Pure fiscal revenue & mandatory spending forecast for a nation (P03-02).
 */
export interface FiscalForecast24h {
  readonly taxBaseDailyFp: FixedPointInt;
  readonly effectiveTaxRateBps: number;
  readonly targetTaxRateBps: number;
  readonly taxComplianceBps: number;
  readonly effectiveYieldBps: number;
  readonly taxRevenueDailyFp: FixedPointInt;
  readonly mandatoryUpkeepDailyFp: FixedPointInt;
  readonly debtInterestDailyFp: FixedPointInt;
  readonly totalMandatoryDailyFp: FixedPointInt;
  readonly netMoneyDailySignedFp: number;
  readonly projectedMoney24hFp: FixedPointInt;
  readonly projectedDebt24hFp: FixedPointInt;
  readonly hoursUntilCashDepletion: number | null;
  readonly creditHeadroomFp: FixedPointInt;
  readonly activityThrottleBps: number;
  readonly fiscalStatus: FiscalStatus;
  readonly warnings: readonly { readonly code: BudgetWarningCode; readonly messageVi: string }[];
}

export function computeNationTaxBaseDailyFp(
  regions: Readonly<Record<string, Region>>,
  facilities: Readonly<Record<string, FacilityInstance>>,
  budget: NationBudgetState,
  nationId: NationId
): FixedPointInt {
  let regionalOutputSum = 0;
  for (const r of Object.values(regions)) {
    if (r.controllerNationId !== nationId) continue;
    regionalOutputSum += (r.economicOutputFp ?? r.infrastructureFp) as number;
  }
  let facilityBaseBonus = 0;
  for (const fac of Object.values(facilities)) {
    if (fac.ownerNationId !== nationId) continue;
    if (fac.operationalStatus === 'ACTIVE') {
      facilityBaseBonus += fac.tier * 12_000;
    }
  }
  // Base production tax base scaled by civilian morale (0.700x .. 1.150x)
  const moraleFactor = 700 + Math.floor(((budget.civilianMoraleFp as number) * 450) / MAX_MORALE_FP);
  const rawBase = Math.floor(regionalOutputSum / 8) + facilityBaseBonus;
  const scaled = Number((BigInt(rawBase) * BigInt(moraleFactor)) / BigInt(FIXED_POINT_SCALE));
  return asFixedPoint(scaled);
}

export function computeNationFiscalForecast24h(
  state: MatchState,
  p03: Phase03EconomyState,
  nationId: NationId
): FiscalForecast24h {
  const stock = p03.stocksByNation[nationId];
  const budget = p03.budgetsByNation[nationId];
  if (!stock || !budget) {
    throw new Error(`Missing Phase 03 stock or budget for nation "${nationId}".`);
  }

  const taxBaseDailyFp = computeNationTaxBaseDailyFp(
    state.regions,
    p03.facilities,
    budget,
    nationId
  );
  const taxComplianceBps = computeTaxComplianceBps(budget.effectiveTaxRateBps);
  const effectiveYieldBps = computeEffectiveTaxYieldBps(
    budget.effectiveTaxRateBps,
    budget.taxFatigueFp
  );
  // Tax revenue = taxBase * effectiveYieldBps / 10000 (strictly bounded by Laffer curve!)
  const taxRevenueDailyFp = asFixedPoint(
    Number((BigInt(taxBaseDailyFp as number) * BigInt(effectiveYieldBps)) / BigInt(10000))
  );

  // Mandatory spending: unit upkeep + active facility money upkeep + minimum civilian welfare
  let unitMoneyUpkeepDaily = 0;
  for (const u of Object.values(state.units)) {
    if (u.ownerNationId !== nationId) continue;
    unitMoneyUpkeepDaily +=
      u.category === 'INFANTRY_ABSTRACT' ? 4_800 : u.category === 'LOGISTICS_ABSTRACT' ? 3_600 : 2_400;
  }
  let facilityMoneyUpkeepDaily = 0;
  for (const fac of Object.values(p03.facilities)) {
    if (fac.ownerNationId !== nationId || fac.manualPaused) continue;
    facilityMoneyUpkeepDaily += (FACILITY_CATALOG[fac.type].tiers[fac.tier].hourlyInputs.money as number) * 24;
  }
  const controlledRegions = Object.values(state.regions).filter(
    (r) => r.controllerNationId === nationId
  ).length;
  const civilianMinimumWelfareDaily = controlledRegions * 600; // 0.600 money/day per region
  const mandatoryUpkeepDailyFp = asFixedPoint(
    unitMoneyUpkeepDaily + facilityMoneyUpkeepDaily + civilianMinimumWelfareDaily
  );

  const debtInterestDailyFp = asFixedPoint(
    Number(
      (BigInt(stock.debtMoneyFp as number) * BigInt(budget.interestRateBpsPerDay)) / BigInt(10000)
    )
  );
  const totalMandatoryDailyFp = fpAdd(mandatoryUpkeepDailyFp, debtInterestDailyFp);

  // Trade port & facility direct money outputs
  let facilityMoneyOutputDaily = 0;
  for (const fac of Object.values(p03.facilities)) {
    if (fac.ownerNationId !== nationId || fac.operationalStatus !== 'ACTIVE') continue;
    facilityMoneyOutputDaily +=
      (FACILITY_CATALOG[fac.type].tiers[fac.tier].hourlyOutputs.money as number) * 24;
  }

  const netMoneyDailySignedFp =
    (taxRevenueDailyFp as number) + facilityMoneyOutputDaily - (totalMandatoryDailyFp as number);

  const creditHeadroomFp = fpSub(
    budget.creditLimitFp,
    asFixedPoint(Math.min(stock.debtMoneyFp as number, budget.creditLimitFp as number))
  );

  let projectedMoney24h = (stock.available.money as number) + netMoneyDailySignedFp;
  let projectedDebt24h = stock.debtMoneyFp as number;
  if (projectedMoney24h < 0) {
    const deficit = -projectedMoney24h;
    const autoBorrow = Math.min(deficit, creditHeadroomFp as number);
    projectedDebt24h += autoBorrow;
    projectedMoney24h = 0;
  } else {
    projectedMoney24h = Math.min(projectedMoney24h, stock.storageCaps.money as number);
  }

  let hoursUntilCashDepletion: number | null = null;
  if (netMoneyDailySignedFp < 0) {
    const hourlyBurn = Math.max(1, Math.floor(-netMoneyDailySignedFp / 24));
    hoursUntilCashDepletion = Math.floor((stock.available.money as number) / hourlyBurn);
  }

  const warnings: Array<{ code: BudgetWarningCode; messageVi: string }> = [];
  if (hoursUntilCashDepletion !== null && hoursUntilCashDepletion <= 24) {
    warnings.push({
      code: 'CASH_DEPLETION_24H',
      messageVi: `Cảnh báo 24h: Ngân khố dự kiến cạn sau khoảng ${hoursUntilCashDepletion} giờ nếu không giảm chi hoặc tăng nguồn thu.`,
    });
  }
  if (
    (budget.creditLimitFp as number) > 0 &&
    (stock.debtMoneyFp as number) * 100 >= (budget.creditLimitFp as number) * 75
  ) {
    warnings.push({
      code: 'DEBT_NEAR_LIMIT',
      messageVi: `Nợ công đã đạt ${Math.round(((stock.debtMoneyFp as number) * 100) / (budget.creditLimitFp as number))}% trần tín dụng hợp lệ.`,
    });
  }
  if (budget.effectiveTaxRateBps > 3500 || budget.targetTaxRateBps > 3500) {
    warnings.push({
      code: 'HIGH_TAX_LAFFER_DRAG',
      messageVi: `Thuế suất >35% kích hoạt suy giảm tuân thủ Laffer (${(taxComplianceBps / 100).toFixed(0)}%) và làm tăng mệt mỏi thuế.`,
    });
  }
  if (budget.activityThrottleBps < 10000) {
    warnings.push({
      code: 'AUSTERITY_ACTIVITY_REDUCED',
      messageVi: `Thiếu ngân khố: hoạt động nhà máy và phân bổ ngân sách đang bị giảm xuống ${(budget.activityThrottleBps / 100).toFixed(0)}%.`,
    });
  }
  if ((budget.civilianMoraleFp as number) < 45_000) {
    warnings.push({
      code: 'LOW_CIVILIAN_MORALE',
      messageVi: 'Tinh thần dân sự thấp (<45.0), làm thu hẹp cơ sở thuế và sản lượng quốc gia.',
    });
  }
  if (budget.taxChangeEffectiveAtUtc !== null && budget.targetTaxRateBps !== budget.effectiveTaxRateBps) {
    warnings.push({
      code: 'PENDING_TAX_TRANSITION',
      messageVi: `Thuế suất mục tiêu ${(budget.targetTaxRateBps / 100).toFixed(0)}% đang trong độ trễ thực thi (hiện tại ${(budget.effectiveTaxRateBps / 100).toFixed(0)}%).`,
    });
  }

  let fiscalStatus: FiscalStatus = budget.fiscalStatus;
  if (budget.activityThrottleBps < 10000) {
    fiscalStatus = 'AUSTERITY_THROTTLED';
  } else if ((stock.debtMoneyFp as number) > 0 && netMoneyDailySignedFp < 0) {
    fiscalStatus = 'DEFICIT_BORROWING';
  } else if (hoursUntilCashDepletion !== null && hoursUntilCashDepletion <= 24) {
    fiscalStatus = 'WARNING_24H';
  } else {
    fiscalStatus = 'NORMAL';
  }

  return {
    taxBaseDailyFp,
    effectiveTaxRateBps: budget.effectiveTaxRateBps,
    targetTaxRateBps: budget.targetTaxRateBps,
    taxComplianceBps,
    effectiveYieldBps,
    taxRevenueDailyFp,
    mandatoryUpkeepDailyFp,
    debtInterestDailyFp,
    totalMandatoryDailyFp,
    netMoneyDailySignedFp,
    projectedMoney24hFp: asFixedPoint(projectedMoney24h),
    projectedDebt24hFp: asFixedPoint(projectedDebt24h),
    hoursUntilCashDepletion,
    creditHeadroomFp,
    activityThrottleBps: budget.activityThrottleBps,
    fiscalStatus,
    warnings,
  };
}

export interface Phase03ReconciliationRow {
  readonly resource: ExtendedResourceType;
  readonly totalActiveAvailableFp: FixedPointInt;
  readonly totalReservedFp: FixedPointInt;
  readonly totalBurnedFp: FixedPointInt;
  readonly totalInitialFp: FixedPointInt;
  readonly totalMintedFp: FixedPointInt;
  readonly totalDebtFp: FixedPointInt;
  readonly reconciled: boolean;
}

export function reconcilePhase03Resources(p03: Phase03EconomyState): {
  readonly allReconciled: boolean;
  readonly rows: readonly Phase03ReconciliationRow[];
} {
  const rows: Phase03ReconciliationRow[] = [];
  let allReconciled = true;
  const stocks = Object.values(p03.stocksByNation);

  for (const r of EXTENDED_RESOURCE_TYPES) {
    let avail = 0;
    let resv = 0;
    let debt = 0;
    for (const s of stocks) {
      avail += s.available[r] as number;
      resv += s.reserved[r] as number;
      if (r === 'money') {
        debt += s.debtMoneyFp as number;
      }
    }
    const burned = p03.resourceAudit.burnedTotal[r] as number;
    const initial = p03.resourceAudit.initialTotal[r] as number;
    const minted = p03.resourceAudit.mintedTotal[r] as number;
    const ok = avail + resv + burned === initial + minted + debt;
    if (!ok) allReconciled = false;
    rows.push({
      resource: r,
      totalActiveAvailableFp: asFixedPoint(avail),
      totalReservedFp: asFixedPoint(resv),
      totalBurnedFp: asFixedPoint(burned),
      totalInitialFp: asFixedPoint(initial),
      totalMintedFp: asFixedPoint(minted),
      totalDebtFp: asFixedPoint(debt),
      reconciled: ok,
    });
  }

  return { allReconciled, rows };
}

export interface Phase03NationReport {
  readonly nationId: NationId;
  readonly stock: NationExtendedStock;
  readonly dailyGross: ExtendedResourceBasket;
  readonly dailyUpkeep: ExtendedResourceBasket;
  readonly dailyNetSigned: SignedExtendedResourceBasket;
  readonly capacity: NationCapacitySummary;
  readonly budget: NationBudgetState;
  readonly fiscalForecast24h: FiscalForecast24h;
  readonly facilities: readonly FacilityInstance[];
  readonly constructionQueue: readonly ConstructionQueueItem[];
  readonly productionQueue: readonly ProductionOrder[];
  readonly activeReservations: readonly ResourceReservation[];
  readonly ledger: readonly ExtendedLedgerEntry[];
  readonly reconciliation: {
    readonly allReconciled: boolean;
    readonly rows: readonly Phase03ReconciliationRow[];
  };
  readonly catalog: typeof FACILITY_CATALOG;
}

export function computePhase03NationReport(
  state: MatchState,
  nationId: NationId
): Phase03NationReport | null {
  const p03 = state.phase03Economy;
  if (!p03) return null;
  const stock = p03.stocksByNation[nationId];
  const budget = p03.budgetsByNation[nationId];
  if (!stock || !budget) return null;

  const fiscalForecast24h = computeNationFiscalForecast24h(state, p03, nationId);
  const capacity = computeNationCapacitySummary(p03.facilities, nationId);

  let dailyGross = makeExtendedBasket({
    money: fiscalForecast24h.taxRevenueDailyFp as number,
  });
  let dailyUpkeep = makeExtendedBasket({
    money: fiscalForecast24h.totalMandatoryDailyFp as number,
  });

  const ownFacilities = Object.values(p03.facilities)
    .filter((f) => f.ownerNationId === nationId)
    .sort((a, b) => (a.facilityId < b.facilityId ? -1 : 1));

  for (const fac of ownFacilities) {
    const spec = FACILITY_CATALOG[fac.type].tiers[fac.tier];
    if (fac.operationalStatus === 'ACTIVE') {
      for (const r of EXTENDED_RESOURCE_TYPES) {
        const out = Number(
          (BigInt(spec.hourlyOutputs[r] as number) * BigInt(24) * BigInt(fac.efficiencyBps)) /
            BigInt(10000)
        );
        if (out > 0) {
          dailyGross = { ...dailyGross, [r]: fpAdd(dailyGross[r], asFixedPoint(out)) };
        }
        if (r !== 'money' && (spec.hourlyInputs[r] as number) > 0) {
          dailyUpkeep = {
            ...dailyUpkeep,
            [r]: fpAdd(dailyUpkeep[r], asFixedPoint((spec.hourlyInputs[r] as number) * 24)),
          };
        }
      }
    }
  }

  const dailyNetSigned: SignedExtendedResourceBasket = {
    money: asSignedFixedPoint((dailyGross.money as number) - (dailyUpkeep.money as number)),
    foreignExchange: asSignedFixedPoint(
      (dailyGross.foreignExchange as number) - (dailyUpkeep.foreignExchange as number)
    ),
    manpower: asSignedFixedPoint((dailyGross.manpower as number) - (dailyUpkeep.manpower as number)),
    food: asSignedFixedPoint((dailyGross.food as number) - (dailyUpkeep.food as number)),
    fuel: asSignedFixedPoint((dailyGross.fuel as number) - (dailyUpkeep.fuel as number)),
    supplies: asSignedFixedPoint((dailyGross.supplies as number) - (dailyUpkeep.supplies as number)),
    equipment: asSignedFixedPoint(
      (dailyGross.equipment as number) - (dailyUpkeep.equipment as number)
    ),
    medical: asSignedFixedPoint((dailyGross.medical as number) - (dailyUpkeep.medical as number)),
  };

  const constructionQueue = Object.values(p03.constructionQueue)
    .filter((c) => c.ownerNationId === nationId)
    .sort((a, b) => (a.completesAtUtc as number) - (b.completesAtUtc as number));

  const productionQueue = Object.values(p03.productionQueue)
    .filter((p) => p.ownerNationId === nationId)
    .sort((a, b) => (a.completesAtUtc as number) - (b.completesAtUtc as number));

  const activeReservations = Object.values(p03.reservations)
    .filter((r) => r.ownerNationId === nationId && r.status === 'ACTIVE')
    .sort((a, b) => (a.createdAtUtc as number) - (b.createdAtUtc as number));

  const ledger = p03.ledger.filter((e) => e.nationId === nationId);

  return {
    nationId,
    stock,
    dailyGross,
    dailyUpkeep,
    dailyNetSigned,
    capacity,
    budget,
    fiscalForecast24h,
    facilities: ownFacilities,
    constructionQueue,
    productionQueue,
    activeReservations,
    ledger,
    reconciliation: reconcilePhase03Resources(p03),
    catalog: FACILITY_CATALOG,
  };
}

export interface Phase03TickOutcome {
  readonly phase03Economy: Phase03EconomyState;
  readonly nations: Record<string, Nation>;
  readonly events: Array<{
    readonly occurredAtUtc: UtcEpochMs;
    readonly tieBreakPriority: number;
    readonly tieBreakKey: string;
    readonly payload:
      | {
          type: 'CONSTRUCTION_COMPLETED';
          orderId: ConstructionOrderId;
          facilityId: FacilityId;
          nationId: NationId;
          regionId: RegionId;
          facilityType: FacilityType;
          tier: FacilityTier;
        }
      | {
          type: 'PRODUCTION_COMPLETED';
          orderId: ProductionOrderId;
          nationId: NationId;
          facilityId: FacilityId;
          outputResource: ExtendedResourceType;
          outputAmountFp: FixedPointInt;
        }
      | {
          type: 'PHASE03_CYCLE_SETTLED';
          cycleUtc: UtcEpochMs;
          cyclesSettled: number;
          austerityNationIds: NationId[];
          pausedFacilityIds: FacilityId[];
        };
  }>;
}

/**
 * Settles due construction orders, due production orders, and complete hourly fiscal/facility cycles
 * deterministically on ADVANCE_REALTIME_TICK.
 * Guarantees:
 * - Zero double-production or double-build after restart (status flips to COMPLETED + completedAtUtc set).
 * - Facilities & production orders pause cleanly on input/power/labor/austerity shortage with explicit pauseReason.
 * - Money NEVER goes negative outside creditLimitFp; austerity reduces activityThrottleBps deterministically.
 */
export function settlePhase03OnRealtimeTick(params: {
  readonly matchVersion: number;
  readonly previousUtc: UtcEpochMs;
  readonly targetUtc: UtcEpochMs;
  readonly commandId: CommandId;
  readonly regions: Readonly<Record<string, Region>>;
  readonly units: Readonly<Record<string, Unit>>;
  readonly nations: Record<string, Nation>;
  readonly phase03Economy: Phase03EconomyState;
}): Phase03TickOutcome {
  let p03: Phase03EconomyState = {
    ...params.phase03Economy,
    stocksByNation: { ...params.phase03Economy.stocksByNation },
    budgetsByNation: { ...params.phase03Economy.budgetsByNation },
    reservations: { ...params.phase03Economy.reservations },
    facilities: { ...params.phase03Economy.facilities },
    constructionQueue: { ...params.phase03Economy.constructionQueue },
    productionQueue: { ...params.phase03Economy.productionQueue },
  };
  const nations: Record<string, Nation> = { ...params.nations };
  const events: Phase03TickOutcome['events'] = [];

  const tickDeltaMs = Math.max(0, (params.targetUtc as number) - (params.previousUtc as number));

  // 1. Progress & complete due Construction Orders (idempotent: only IN_PROGRESS/QUEUED)
  const activeConstructions = Object.values(p03.constructionQueue)
    .filter((c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED')
    .sort((a, b) => {
      const diff = (a.completesAtUtc as number) - (b.completesAtUtc as number);
      return diff !== 0 ? diff : a.orderId < b.orderId ? -1 : 1;
    });

  for (const order of activeConstructions) {
    const budget = p03.budgetsByNation[order.ownerNationId];
    const effectiveMs = budget
      ? Math.floor((tickDeltaMs * budget.activityThrottleBps) / 10000)
      : tickDeltaMs;
    const nextElapsed = Math.min(order.durationMs, order.elapsedActiveMs + effectiveMs);

    if ((order.completesAtUtc as number) <= (params.targetUtc as number) || nextElapsed >= order.durationMs) {
      const res = p03.reservations[order.reservationId];
      if (res && res.status === 'ACTIVE') {
        const committed = settleNationReservation(p03, {
          matchVersion: params.matchVersion,
          occurredAtUtc: order.completesAtUtc,
          commandId: params.commandId,
          reservationId: order.reservationId,
          nationId: order.ownerNationId,
          consumed: res.remainingReserved,
          mode: 'COMMIT',
          note: `Hoàn tất xây dựng ${FACILITY_CATALOG[order.facilityType].nameVi} cấp ${order.targetTier}`,
        });
        if (committed.ok) {
          p03 = committed.state;
        }
      }

      const facilityId =
        order.targetFacilityId ??
        FacilityIdSchema.parse(`fac_${order.orderId.slice(4)}`);

      const existingFac = p03.facilities[facilityId];
      p03 = {
        ...p03,
        facilities: {
          ...p03.facilities,
          [facilityId]: existingFac
            ? {
                ...existingFac,
                tier: order.targetTier,
                operationalStatus: existingFac.manualPaused ? 'PAUSED_MANUAL' : 'ACTIVE',
                pauseReason: existingFac.manualPaused ? 'Tạm dừng thủ công bởi người chơi' : null,
              }
            : {
                facilityId,
                regionId: order.regionId,
                ownerNationId: order.ownerNationId,
                type: order.facilityType,
                tier: order.targetTier,
                builtAtUtc: order.completesAtUtc,
                operationalStatus: 'ACTIVE',
                manualPaused: false,
                efficiencyBps: 10000,
                pauseReason: null,
                lastSettledCycleUtc: order.completesAtUtc,
              },
        },
        constructionQueue: {
          ...p03.constructionQueue,
          [order.orderId]: {
            ...order,
            elapsedActiveMs: order.durationMs,
            status: 'COMPLETED',
            pauseReason: null,
            completedAtUtc: order.completesAtUtc,
          },
        },
      };

      // Recalculate storage caps for nation after new/upgraded facility
      const nationStock = p03.stocksByNation[order.ownerNationId];
      if (nationStock) {
        p03 = {
          ...p03,
          stocksByNation: {
            ...p03.stocksByNation,
            [order.ownerNationId]: {
              ...nationStock,
              storageCaps: computeNationStorageCaps(p03.facilities, order.ownerNationId),
            },
          },
        };
      }

      events.push({
        occurredAtUtc: order.completesAtUtc,
        tieBreakPriority: 12,
        tieBreakKey: order.orderId,
        payload: {
          type: 'CONSTRUCTION_COMPLETED',
          orderId: order.orderId,
          facilityId,
          nationId: order.ownerNationId,
          regionId: order.regionId,
          facilityType: order.facilityType,
          tier: order.targetTier,
        },
      });
    } else {
      const remainingMs = Math.max(60_000, order.durationMs - nextElapsed);
      p03 = {
        ...p03,
        constructionQueue: {
          ...p03.constructionQueue,
          [order.orderId]: {
            ...order,
            elapsedActiveMs: nextElapsed,
            status: 'IN_PROGRESS',
            completesAtUtc:
              budget && budget.activityThrottleBps < 10000
                ? asUtcEpochMs((params.targetUtc as number) + remainingMs)
                : order.completesAtUtc,
          },
        },
      };
    }
  }

  // 2. Settle complete hourly fiscal & facility operational cycles FIRST
  // so input/power/labor/austerity shortages pause factories BEFORE production orders can complete.
  const elapsedSinceLastCycle = (params.targetUtc as number) - (p03.lastSettlementUtc as number);
  const cycles = Math.floor(elapsedSinceLastCycle / p03.settlementIntervalMs);

  if (cycles > 0) {
    const austeritySet = new Set<NationId>();
    const pausedFacSet = new Set<FacilityId>();
    const sortedNationIds = Object.keys(p03.stocksByNation).sort() as NationId[];

    for (let c = 1; c <= cycles; c += 1) {
      const cycleUtc = asUtcEpochMs(
        (p03.lastSettlementUtc as number) + c * p03.settlementIntervalMs
      );

      for (const nationId of sortedNationIds) {
        let stock = p03.stocksByNation[nationId];
        let budget = p03.budgetsByNation[nationId];
        if (!stock || !budget) continue;

        // 3a. Delayed tax rate activation (P03-02: thuế có tác động trễ)
        if (
          budget.taxChangeEffectiveAtUtc !== null &&
          (cycleUtc as number) >= (budget.taxChangeEffectiveAtUtc as number)
        ) {
          budget = {
            ...budget,
            effectiveTaxRateBps: budget.targetTaxRateBps,
            taxChangeEffectiveAtUtc: null,
          };
        }

        // Update tax fatigue & civilian morale based on tax rate & civilian budget allocation
        let nextTaxFatigue = budget.taxFatigueFp as number;
        if (budget.effectiveTaxRateBps > 3000) {
          nextTaxFatigue = Math.min(30_000, nextTaxFatigue + Math.floor((budget.effectiveTaxRateBps - 3000) / 10));
        } else {
          nextTaxFatigue = Math.max(0, nextTaxFatigue - 250);
        }

        let nextMorale = budget.civilianMoraleFp as number;
        if (budget.allocations.civilianBps >= 3000) {
          nextMorale = Math.min(MAX_MORALE_FP, nextMorale + 150);
        } else if (budget.allocations.civilianBps < 1500) {
          nextMorale = Math.max(10_000, nextMorale - 250);
        }
        if (budget.effectiveTaxRateBps > 4000) {
          nextMorale = Math.max(10_000, nextMorale - Math.floor((budget.effectiveTaxRateBps - 4000) / 10));
        }

        budget = {
          ...budget,
          taxFatigueFp: asFixedPoint(nextTaxFatigue),
          civilianMoraleFp: asFixedPoint(nextMorale),
        };
        p03 = {
          ...p03,
          budgetsByNation: { ...p03.budgetsByNation, [nationId]: budget },
        };

        // 3b. Tax revenue collection (hourly = daily / 24, strictly bounded by Laffer curve)
        const taxBaseDaily = computeNationTaxBaseDailyFp(
          params.regions,
          p03.facilities,
          budget,
          nationId
        );
        const effYieldBps = computeEffectiveTaxYieldBps(
          budget.effectiveTaxRateBps,
          budget.taxFatigueFp
        );
        const taxHourlyRaw = Number(
          (BigInt(taxBaseDaily as number) * BigInt(effYieldBps)) / BigInt(10000 * 24)
        );
        const moneyHeadroom = Math.max(
          0,
          (stock.storageCaps.money as number) - (stock.available.money as number)
        );
        const taxMinted = asFixedPoint(Math.min(taxHourlyRaw, moneyHeadroom));

        if ((taxMinted as number) > 0) {
          stock = {
            ...stock,
            available: { ...stock.available, money: fpAdd(stock.available.money, taxMinted) },
          };
          p03 = {
            ...p03,
            stocksByNation: { ...p03.stocksByNation, [nationId]: stock },
            resourceAudit: {
              ...p03.resourceAudit,
              mintedTotal: {
                ...p03.resourceAudit.mintedTotal,
                money: fpAdd(p03.resourceAudit.mintedTotal.money, taxMinted),
              },
            },
          };
          p03 = appendExtendedLedgerEntry(p03, {
            matchVersion: params.matchVersion,
            occurredAtUtc: cycleUtc,
            nationId,
            resource: 'money',
            kind: 'TAX_REVENUE',
            direction: 'CREDIT',
            amountFp: taxMinted,
            sourceAccount: 'TAX_BASE_PRODUCTION',
            destinationAccount: `STOCK:${nationId}`,
            reservationId: null,
            causedByCommandId: params.commandId,
            note: `Thu thuế giờ (${(budget.effectiveTaxRateBps / 100).toFixed(0)}%, tuân thủ ${(computeTaxComplianceBps(budget.effectiveTaxRateBps) / 100).toFixed(0)}%)`,
          });
        }

        // 3c. Mandatory spending + debt interest + bounded auto-credit or austerity throttle (P03-02)
        const debtInterestHourly = Number(
          (BigInt(stock.debtMoneyFp as number) * BigInt(budget.interestRateBpsPerDay)) /
            BigInt(10000 * 24)
        );
        let unitMoneyHourly = 0;
        for (const u of Object.values(params.units)) {
          if (u.ownerNationId !== nationId) continue;
          unitMoneyHourly +=
            u.category === 'INFANTRY_ABSTRACT' ? 200 : u.category === 'LOGISTICS_ABSTRACT' ? 150 : 100;
        }
        const regionCount = Object.values(params.regions).filter(
          (r) => r.controllerNationId === nationId
        ).length;
        const welfareHourly = regionCount * 25;
        const mandatoryRequired = debtInterestHourly + unitMoneyHourly + welfareHourly;

        // If available money < mandatoryRequired, draw from valid credit line up to creditLimitFp
        if ((stock.available.money as number) < mandatoryRequired) {
          const shortfall = mandatoryRequired - (stock.available.money as number);
          const creditHeadroom = Math.max(
            0,
            (budget.creditLimitFp as number) - (stock.debtMoneyFp as number)
          );
          const autoDrawNum = Math.min(shortfall, creditHeadroom);
          if (autoDrawNum > 0) {
            const autoDraw = asFixedPoint(autoDrawNum);
            stock = {
              ...stock,
              available: { ...stock.available, money: fpAdd(stock.available.money, autoDraw) },
              debtMoneyFp: fpAdd(stock.debtMoneyFp, autoDraw),
            };
            p03 = {
              ...p03,
              stocksByNation: { ...p03.stocksByNation, [nationId]: stock },
            };
            p03 = appendExtendedLedgerEntry(p03, {
              matchVersion: params.matchVersion,
              occurredAtUtc: cycleUtc,
              nationId,
              resource: 'money',
              kind: 'DEBT_DRAW',
              direction: 'CREDIT',
              amountFp: autoDraw,
              sourceAccount: 'CREDIT_FACILITY',
              destinationAccount: `STOCK:${nationId}`,
              reservationId: null,
              causedByCommandId: params.commandId,
              note: 'Rút tín dụng tự động bù thâm hụt chi bắt buộc trong trần nợ',
            });
          }
        }

        // Pay mandatory required strictly clamped at available money (NEVER negative!)
        const actualMandatoryPaid = Math.min(stock.available.money as number, mandatoryRequired);
        if (actualMandatoryPaid > 0) {
          const paidFp = asFixedPoint(actualMandatoryPaid);
          stock = {
            ...stock,
            available: { ...stock.available, money: fpSub(stock.available.money, paidFp) },
          };
          p03 = {
            ...p03,
            stocksByNation: { ...p03.stocksByNation, [nationId]: stock },
            resourceAudit: {
              ...p03.resourceAudit,
              burnedTotal: {
                ...p03.resourceAudit.burnedTotal,
                money: fpAdd(p03.resourceAudit.burnedTotal.money, paidFp),
              },
            },
          };
          p03 = appendExtendedLedgerEntry(p03, {
            matchVersion: params.matchVersion,
            occurredAtUtc: cycleUtc,
            nationId,
            resource: 'money',
            kind: debtInterestHourly > 0 ? 'DEBT_INTEREST' : 'UPKEEP_DEBIT',
            direction: 'DEBIT',
            amountFp: paidFp,
            sourceAccount: `STOCK:${nationId}`,
            destinationAccount: 'MANDATORY_SPEND_BURN',
            reservationId: null,
            causedByCommandId: params.commandId,
            note: 'Chi bắt buộc theo giờ (duy trì quân sự, dân sinh & lãi nợ)',
          });
        }

        // Determine activityThrottleBps (P03-02: thiếu tiền làm giảm hoạt động theo quy tắc)
        let nextThrottleBps = 10000;
        let nextFiscalStatus: FiscalStatus = 'NORMAL';
        let lastDeficitReason: string | null = null;
        if (mandatoryRequired > 0 && actualMandatoryPaid < mandatoryRequired) {
          const fundedRatioBps = Math.floor((actualMandatoryPaid * 10000) / mandatoryRequired);
          nextThrottleBps = Math.max(2500, Math.min(7500, fundedRatioBps));
          nextFiscalStatus = 'AUSTERITY_THROTTLED';
          lastDeficitReason = `Ngân khố cạn và chạm trần tín dụng: giảm công suất hoạt động xuống ${(nextThrottleBps / 100).toFixed(0)}%.`;
          austeritySet.add(nationId);
          budget = {
            ...budget,
            civilianMoraleFp: asFixedPoint(Math.max(10_000, (budget.civilianMoraleFp as number) - 800)),
          };
        } else if ((stock.debtMoneyFp as number) > 0) {
          nextFiscalStatus = 'DEFICIT_BORROWING';
        }

        // Science points accumulation scaled by science allocation & activity throttle
        const scienceGain = Math.floor(
          (budget.allocations.scienceBps * nextThrottleBps) / (10000 * 25)
        );
        budget = {
          ...budget,
          activityThrottleBps: nextThrottleBps,
          fiscalStatus: nextFiscalStatus,
          lastDeficitReason,
          sciencePointsFp: fpAdd(budget.sciencePointsFp, asFixedPoint(scienceGain)),
        };
        p03 = {
          ...p03,
          budgetsByNation: { ...p03.budgetsByNation, [nationId]: budget },
        };

        // 3d. Run 8 facility types with power/labor capacity & input shortage pausing (P03-03)
        // Sort POWER_PLANT and CIVILIAN_HOUSING first so capacity providers run before consumers!
        const ownFacs = Object.values(p03.facilities)
          .filter((f) => f.ownerNationId === nationId)
          .sort((a, b) => {
            const rank = (t: FacilityType) =>
              t === 'POWER_PLANT' ? 0 : t === 'CIVILIAN_HOUSING' ? 1 : 2;
            const rd = rank(a.type) - rank(b.type);
            if (rd !== 0) return rd;
            return a.facilityId < b.facilityId ? -1 : 1;
          });

        let availablePowerFp = 15_000;
        let availableLaborFp = 20_000;

        for (const fac of ownFacs) {
          const spec = FACILITY_CATALOG[fac.type].tiers[fac.tier];
          if (fac.manualPaused) {
            p03.facilities[fac.facilityId] = {
              ...fac,
              operationalStatus: 'PAUSED_MANUAL',
              efficiencyBps: 0,
              pauseReason: 'Tạm dừng thủ công bởi người chơi',
              lastSettledCycleUtc: cycleUtc,
            };
            pausedFacSet.add(fac.facilityId);
            continue;
          }

          // Check energy & labor capacity for consumers
          if ((spec.energyDemandFp as number) > availablePowerFp) {
            p03.facilities[fac.facilityId] = {
              ...fac,
              operationalStatus: 'PAUSED_NO_POWER',
              efficiencyBps: 0,
              pauseReason: `Thiếu công suất năng lượng (cần ${(spec.energyDemandFp as number) / 1000}, còn ${availablePowerFp / 1000})`,
              lastSettledCycleUtc: cycleUtc,
            };
            pausedFacSet.add(fac.facilityId);
            continue;
          }
          if ((spec.laborDemandFp as number) > availableLaborFp) {
            p03.facilities[fac.facilityId] = {
              ...fac,
              operationalStatus: 'PAUSED_NO_LABOR',
              efficiencyBps: 0,
              pauseReason: `Thiếu công suất lao động (cần ${(spec.laborDemandFp as number) / 1000}, còn ${availableLaborFp / 1000})`,
              lastSettledCycleUtc: cycleUtc,
            };
            pausedFacSet.add(fac.facilityId);
            continue;
          }

          // Check required hourly inputs (P03-03: thiếu vật tư tạm dừng!)
          stock = p03.stocksByNation[nationId];
          const inputCheck = hasEnoughInBasket(stock.available, spec.hourlyInputs);
          if (!inputCheck.ok) {
            const missingStr = inputCheck.missing
              .map((m) => `${m.resource} (có ${(m.haveFp as number) / 1000}, cần ${(m.needFp as number) / 1000})`)
              .join(', ');
            p03.facilities[fac.facilityId] = {
              ...fac,
              operationalStatus: 'PAUSED_NO_INPUTS',
              efficiencyBps: 0,
              pauseReason: `Thiếu vật tư đầu vào: ${missingStr}`,
              lastSettledCycleUtc: cycleUtc,
            };
            pausedFacSet.add(fac.facilityId);
            continue;
          }

          // Consume hourly inputs atomically
          availablePowerFp -= spec.energyDemandFp as number;
          availableLaborFp -= spec.laborDemandFp as number;

          const burnedInputs = spec.hourlyInputs;
          if (!isZeroExtendedBasket(burnedInputs)) {
            stock = {
              ...stock,
              available: subExtendedBaskets(stock.available, burnedInputs),
            };
            p03 = {
              ...p03,
              stocksByNation: { ...p03.stocksByNation, [nationId]: stock },
              resourceAudit: {
                ...p03.resourceAudit,
                burnedTotal: addExtendedBaskets(p03.resourceAudit.burnedTotal, burnedInputs),
              },
            };
            for (const r of EXTENDED_RESOURCE_TYPES) {
              if ((burnedInputs[r] as number) > 0) {
                p03 = appendExtendedLedgerEntry(p03, {
                  matchVersion: params.matchVersion,
                  occurredAtUtc: cycleUtc,
                  nationId,
                  resource: r,
                  kind: 'FACILITY_UPKEEP',
                  direction: 'DEBIT',
                  amountFp: burnedInputs[r],
                  sourceAccount: `STOCK:${nationId}`,
                  destinationAccount: `FACILITY:${fac.facilityId}`,
                  reservationId: null,
                  causedByCommandId: params.commandId,
                  note: `Vận hành giờ: ${FACILITY_CATALOG[fac.type].nameVi} cấp ${fac.tier}`,
                });
              }
            }
          }

          // Provide capacity if this facility is POWER_PLANT or CIVILIAN_HOUSING
          availablePowerFp += spec.energyCapacityProvidedFp as number;
          availableLaborFp += spec.laborCapacityProvidedFp as number;

          // Compute effective efficiency (industry allocation bonus * fiscal activityThrottleBps)
          const industryBonusBps = Math.floor(budget.allocations.industryBps / 10); // up to +10%
          const effBps = Math.min(
            10000,
            Math.floor((budget.activityThrottleBps * (9500 + industryBonusBps)) / 10000)
          );

          // Mint hourly outputs clamped by storageCaps
          stock = p03.stocksByNation[nationId];
          for (const r of EXTENDED_RESOURCE_TYPES) {
            const rawOut = Number(
              (BigInt(spec.hourlyOutputs[r] as number) * BigInt(effBps)) / BigInt(10000)
            );
            if (rawOut <= 0) continue;
            const headroom = Math.max(
              0,
              (stock.storageCaps[r] as number) - (stock.available[r] as number)
            );
            const minted = asFixedPoint(Math.min(rawOut, headroom));
            if ((minted as number) > 0) {
              stock = {
                ...stock,
                available: { ...stock.available, [r]: fpAdd(stock.available[r], minted) },
              };
              p03 = {
                ...p03,
                stocksByNation: { ...p03.stocksByNation, [nationId]: stock },
                resourceAudit: {
                  ...p03.resourceAudit,
                  mintedTotal: {
                    ...p03.resourceAudit.mintedTotal,
                    [r]: fpAdd(p03.resourceAudit.mintedTotal[r], minted),
                  },
                },
              };
              p03 = appendExtendedLedgerEntry(p03, {
                matchVersion: params.matchVersion,
                occurredAtUtc: cycleUtc,
                nationId,
                resource: r,
                kind: 'FACILITY_OUTPUT',
                direction: 'CREDIT',
                amountFp: minted,
                sourceAccount: `FACILITY:${fac.facilityId}`,
                destinationAccount: `STOCK:${nationId}`,
                reservationId: null,
                causedByCommandId: params.commandId,
                note: `Sản lượng giờ: ${FACILITY_CATALOG[fac.type].nameVi} cấp ${fac.tier}`,
              });
            }
          }

          p03.facilities[fac.facilityId] = {
            ...fac,
            operationalStatus: 'ACTIVE',
            efficiencyBps: effBps,
            pauseReason: null,
            lastSettledCycleUtc: cycleUtc,
          };
        }
      }
    }

    const finalCycleUtc = asUtcEpochMs(
      (p03.lastSettlementUtc as number) + cycles * p03.settlementIntervalMs
    );
    p03 = { ...p03, lastSettlementUtc: finalCycleUtc };

    events.push({
      occurredAtUtc: finalCycleUtc,
      tieBreakPriority: 16,
      tieBreakKey: 'phase03_economy_cycle',
      payload: {
        type: 'PHASE03_CYCLE_SETTLED',
        cycleUtc: finalCycleUtc,
        cyclesSettled: cycles,
        austerityNationIds: [...austeritySet].sort() as NationId[],
        pausedFacilityIds: [...pausedFacSet].sort() as FacilityId[],
      },
    });
  }

  // 3. Progress & complete due Production Orders (pause cleanly if parent facility is paused!)
  const activeProductions = Object.values(p03.productionQueue)
    .filter((p) => p.status === 'IN_PROGRESS' || p.status === 'QUEUED' || p.status === 'PAUSED')
    .sort((a, b) => {
      const diff = (a.completesAtUtc as number) - (b.completesAtUtc as number);
      return diff !== 0 ? diff : a.orderId < b.orderId ? -1 : 1;
    });

  for (const order of activeProductions) {
    const facility = p03.facilities[order.facilityId];
    const nationStock = p03.stocksByNation[order.ownerNationId];
    if (!facility || !nationStock) continue;

    if (facility.operationalStatus !== 'ACTIVE') {
      const pauseReason =
        facility.pauseReason ?? `Nhà máy đang ở trạng thái ${facility.operationalStatus}`;
      p03 = {
        ...p03,
        productionQueue: {
          ...p03.productionQueue,
          [order.orderId]: {
            ...order,
            status: 'PAUSED',
            pauseReason,
            completesAtUtc: asUtcEpochMs((order.completesAtUtc as number) + tickDeltaMs),
          },
        },
      };
      continue;
    }

    const effectiveMs = Math.floor((tickDeltaMs * facility.efficiencyBps) / 10000);
    const nextElapsed = Math.min(order.durationMs, order.elapsedActiveMs + effectiveMs);

    if ((order.completesAtUtc as number) <= (params.targetUtc as number) || nextElapsed >= order.durationMs) {
      const res = p03.reservations[order.reservationId];
      if (res && res.status === 'ACTIVE') {
        const committed = settleNationReservation(p03, {
          matchVersion: params.matchVersion,
          occurredAtUtc: order.completesAtUtc,
          commandId: params.commandId,
          reservationId: order.reservationId,
          nationId: order.ownerNationId,
          consumed: res.remainingReserved,
          mode: 'COMMIT',
          note: `Tất toán nguyên liệu lô sản xuất ${order.orderId}`,
        });
        if (committed.ok) {
          p03 = committed.state;
        }
      }

      const freshStock = p03.stocksByNation[order.ownerNationId];
      const outRes = order.outputResource;
      const cap = freshStock.storageCaps[outRes] as number;
      const current = freshStock.available[outRes] as number;
      const mintable = Math.min(order.outputAmountFp as number, Math.max(0, cap - current));
      const actualMinted = asFixedPoint(mintable);

      if (mintable > 0) {
        p03 = {
          ...p03,
          stocksByNation: {
            ...p03.stocksByNation,
            [order.ownerNationId]: {
              ...freshStock,
              available: {
                ...freshStock.available,
                [outRes]: fpAdd(freshStock.available[outRes], actualMinted),
              },
            },
          },
          resourceAudit: {
            ...p03.resourceAudit,
            mintedTotal: {
              ...p03.resourceAudit.mintedTotal,
              [outRes]: fpAdd(p03.resourceAudit.mintedTotal[outRes], actualMinted),
            },
          },
        };
        p03 = appendExtendedLedgerEntry(p03, {
          matchVersion: params.matchVersion,
          occurredAtUtc: order.completesAtUtc,
          nationId: order.ownerNationId,
          resource: outRes,
          kind: 'PRODUCTION_OUTPUT',
          direction: 'CREDIT',
          amountFp: actualMinted,
          sourceAccount: `FACILITY:${order.facilityId}`,
          destinationAccount: `STOCK:${order.ownerNationId}`,
          reservationId: order.reservationId,
          causedByCommandId: params.commandId,
          note: `Hoàn tất sản xuất ${order.batchCount} lô (${order.orderId})`,
        });
      }

      p03 = {
        ...p03,
        productionQueue: {
          ...p03.productionQueue,
          [order.orderId]: {
            ...order,
            elapsedActiveMs: order.durationMs,
            status: 'COMPLETED',
            pauseReason: null,
            completedAtUtc: order.completesAtUtc,
          },
        },
      };

      events.push({
        occurredAtUtc: order.completesAtUtc,
        tieBreakPriority: 14,
        tieBreakKey: order.orderId,
        payload: {
          type: 'PRODUCTION_COMPLETED',
          orderId: order.orderId,
          nationId: order.ownerNationId,
          facilityId: order.facilityId,
          outputResource: outRes,
          outputAmountFp: actualMinted,
        },
      });
    } else {
      p03 = {
        ...p03,
        productionQueue: {
          ...p03.productionQueue,
          [order.orderId]: {
            ...order,
            elapsedActiveMs: nextElapsed,
            status: 'IN_PROGRESS',
            pauseReason: null,
          },
        },
      };
    }
  }

  return {
    phase03Economy: p03,
    nations,
    events,
  };
}

export function buildOrderReservationId(prefix: 'con' | 'prd', orderId: string): ReservationId {
  const sanitized = orderId.replace(/[^a-z0-9_-]/g, '').slice(0, 50);
  return ReservationIdSchema.parse(`res_${prefix}_${sanitized}`);
}

export { TAX_POLICY_DELAY_MS };
