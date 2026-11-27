import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ActorIdSchema,
  asFixedPoint,
  asUtcEpochMs,
  Command,
  CommandIdSchema,
  CommandSchema,
  ConstructionOrderIdSchema,
  CONTRACT_SCHEMA_VERSION,
  FacilityIdSchema,
  FacilityInstance,
  IdempotencyKeySchema,
  MatchIdSchema,
  MatchState,
  ProductionOrderIdSchema,
  ReservationIdSchema,
  wholeUnitsToFixedPoint,
} from '../contracts';
import { createWorld72MatchState, WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import {
  assertSimulationInvariants,
  computeEffectiveTaxYieldBps,
  computeNationFiscalForecast24h,
  computePhase03NationReport,
  EXTENDED_RESOURCE_TYPES,
  FACILITY_CATALOG,
  FACILITY_TYPES,
  makeExtendedBasket,
  ManualClock,
  reconcilePhase03Resources,
  reduceCommand,
  TAX_POLICY_DELAY_MS,
} from './index';
import { loadServerConfig } from '../server/config';
import { createServerRuntime, ServerRuntime } from '../server/createApp';
import { SqliteMatchStore } from '../server/db/sqliteStore';
import { MatchClockScheduler } from '../server/scheduler';

const BASE_UTC = 1_750_000_000_000;

function makeWorldState(matchId: string): MatchState {
  return createWorld72MatchState({
    matchId,
    title: `Phase 03 Test (${matchId})`,
    seed: 195503,
    createdAtUtc: BASE_UTC,
    mode: 'PRODUCTION_REALTIME',
  });
}

function makeCmd(
  state: MatchState,
  actorId: string,
  seq: number,
  keySuffix: string,
  payload: Command['payload'],
  expectedVersion?: number
): Command {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse(`cmd_${keySuffix}_${seq}`),
    matchId: state.matchId,
    actorId: ActorIdSchema.parse(actorId),
    idempotencyKey: IdempotencyKeySchema.parse(`idem_${keySuffix}_${seq}`),
    sequence: seq,
    expectedVersion: expectedVersion ?? state.version,
    issuedAtUtc: state.currentUtc,
    payload,
  };
}

function runCmd(state: MatchState, command: Command) {
  return reduceCommand(state, command, new ManualClock(state.currentUtc as number));
}

function advanceClock(state: MatchState, sysSeq: number, deltaMs: number): MatchState {
  const targetUtc = asUtcEpochMs((state.currentUtc as number) + deltaMs);
  const res = reduceCommand(
    state,
    makeCmd(state, WORLD_ACTORS.system, sysSeq, `tick_${sysSeq}`, {
      type: 'ADVANCE_REALTIME_TICK',
      targetUtc,
    }),
    new ManualClock(targetUtc as number)
  );
  if (!res.ok) {
    assert.fail(`ADVANCE_REALTIME_TICK failed: ${res.reason}`);
  }
  return res.nextState;
}

async function startRuntime(options?: {
  dbPath?: string;
  clock?: ManualClock;
}): Promise<{ runtime: ServerRuntime; baseUrl: string; store: SqliteMatchStore }> {
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: options?.dbPath ?? ':memory:',
  });
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const clock = options?.clock ?? new ManualClock(BASE_UTC);
  const runtime = createServerRuntime(config, store, clock);

  await new Promise<void>((resolve) => {
    runtime.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = runtime.httpServer.address() as AddressInfo;
  return {
    runtime,
    store,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

async function registerUser(
  baseUrl: string,
  username: string,
  displayName: string
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, password: 'Phase03Pass123!' }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { token: string; user: { userId: string } };
  return { token: body.token, userId: body.user.userId };
}

describe('Phase 03 — Economy, Budget & Facilities (P03-01, P03-02, P03-03)', () => {
  it('P03-01: initializes 8 resources with explicit stock/flow/capacity and exact reconciliation', () => {
    const state = makeWorldState('mch_p03_init');
    assert.ok(state.phase03Economy, 'phase03Economy must be initialized on World72 matches');
    assertSimulationInvariants(state);

    const northReport = computePhase03NationReport(state, WORLD_NATIONS.north);
    assert.ok(northReport);
    assert.equal(northReport.reconciliation.allReconciled, true);
    assert.equal(northReport.reconciliation.rows.length, 8);
    for (const res of EXTENDED_RESOURCE_TYPES) {
      assert.ok((northReport.stock.available[res] as number) > 0, `expected initial ${res} > 0`);
      assert.ok(
        (northReport.stock.storageCaps[res] as number) >= (northReport.stock.available[res] as number),
        `expected cap >= available for ${res}`
      );
    }
  });

  it('P03-01: two competing commands on the same stock allow ONLY one to succeed (optimistic lock + sequential depletion)', () => {
    const state0 = makeWorldState('mch_p03_race');
    const northStock0 = state0.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!;
    const availMoney = northStock0.available.money as number;
    const sixtyPct = Math.floor(availMoney * 0.6);

    const basketA = makeExtendedBasket({ money: sixtyPct });
    const basketB = makeExtendedBasket({ money: sixtyPct });

    const cmd1 = makeCmd(
      state0,
      WORLD_ACTORS.north,
      1,
      'race_a',
      {
        type: 'RESERVE_RESOURCES',
        reservationId: ReservationIdSchema.parse('res_race_a'),
        nationId: WORLD_NATIONS.north,
        refId: 'order_race_a',
        basket: basketA,
        note: 'Competing reservation A',
      },
      0
    );
    const cmd2Concurrent = makeCmd(
      state0,
      WORLD_ACTORS.north,
      2,
      'race_b_ver',
      {
        type: 'RESERVE_RESOURCES',
        reservationId: ReservationIdSchema.parse('res_race_b'),
        nationId: WORLD_NATIONS.north,
        refId: 'order_race_b',
        basket: basketB,
        note: 'Competing reservation B (stale version)',
      },
      0
    );

    const res1 = runCmd(state0, cmd1);
    if (!res1.ok) assert.fail(res1.reason);

    // Concurrent command targeting same expectedVersion MUST fail
    const res2Concurrent = runCmd(res1.nextState, cmd2Concurrent);
    assert.equal(res2Concurrent.ok, false);
    if (!res2Concurrent.ok) {
      assert.equal(res2Concurrent.code, 'VERSION_CONFLICT');
    }

    // Even if retried against latest version, remaining 40% is insufficient for 60% -> MUST fail
    const cmd2Sequential = makeCmd(
      res1.nextState,
      WORLD_ACTORS.north,
      2,
      'race_b_seq',
      {
        type: 'RESERVE_RESOURCES',
        reservationId: ReservationIdSchema.parse('res_race_b_seq'),
        nationId: WORLD_NATIONS.north,
        refId: 'order_race_b_seq',
        basket: basketB,
        note: 'Competing reservation B (insufficient stock)',
      },
      res1.nextState.version
    );
    const res2Seq = runCmd(res1.nextState, cmd2Sequential);
    assert.equal(res2Seq.ok, false);
    if (!res2Seq.ok) {
      assert.equal(res2Seq.code, 'INSUFFICIENT_RESOURCES');
    }

    // Duplicate idempotency key returns identical result without double-reserving
    const dupRes = runCmd(res1.nextState, cmd1);
    if (!dupRes.ok) assert.fail(dupRes.reason);
    assert.equal(dupRes.idempotentDuplicate, true);
    assert.equal(
      dupRes.nextState.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.reserved.money,
      sixtyPct
    );

    const recon = reconcilePhase03Resources(res1.nextState.phase03Economy!);
    assert.equal(recon.allReconciled, true);
    assertSimulationInvariants(res1.nextState);
  });

  it('P03-01: cancelling a half-finished construction order refunds exact unspent portion and reconciles 8/8', () => {
    const state0 = makeWorldState('mch_p03_refund');
    const northRegionId = Object.values(state0.regions).find(
      (r) => r.controllerNationId === WORLD_NATIONS.north
    )!.regionId;

    const tier1Cost = FACILITY_CATALOG.GRANARY_FARM.tiers[1].buildCost;
    const durationMs = FACILITY_CATALOG.GRANARY_FARM.tiers[1].buildDurationMs; // 2 hours
    const moneyBefore = state0.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.available.money as number;
    const suppliesBefore = state0.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.available.supplies as number;

    const qRes = runCmd(
      state0,
      makeCmd(state0, WORLD_ACTORS.north, 1, 'build_granary', {
        type: 'QUEUE_CONSTRUCTION',
        orderId: ConstructionOrderIdSchema.parse('con_refund_test'),
        nationId: WORLD_NATIONS.north,
        regionId: northRegionId,
        facilityType: 'GRANARY_FARM',
        targetFacilityId: null,
      })
    );
    if (!qRes.ok) assert.fail(qRes.reason);

    // Advance exactly 50% of build time
    const midState = advanceClock(qRes.nextState, 1, Math.floor(durationMs / 2));

    const cancelRes = runCmd(
      midState,
      makeCmd(midState, WORLD_ACTORS.north, 2, 'cancel_granary', {
        type: 'CANCEL_CONSTRUCTION',
        orderId: ConstructionOrderIdSchema.parse('con_refund_test'),
        nationId: WORLD_NATIONS.north,
      })
    );
    if (!cancelRes.ok) assert.fail(cancelRes.reason);

    const cancelEvt = cancelRes.emittedEvents.find((e) => e.payload.type === 'CONSTRUCTION_CANCELLED');
    assert.ok(cancelEvt && cancelEvt.payload.type === 'CONSTRUCTION_CANCELLED');
    assert.equal(
      (cancelEvt.payload.consumed.money as number) + (cancelEvt.payload.refunded.money as number),
      tier1Cost.money as number
    );
    assert.equal(
      (cancelEvt.payload.consumed.supplies as number) + (cancelEvt.payload.refunded.supplies as number),
      tier1Cost.supplies as number
    );
    assert.equal(cancelEvt.payload.consumed.money, Math.floor((tier1Cost.money as number) / 2));
    assert.equal(
      cancelEvt.payload.refunded.money,
      (tier1Cost.money as number) - Math.floor((tier1Cost.money as number) / 2)
    );

    // Immediate cancel (0% elapsed) refunds 100%
    const q2 = runCmd(
      state0,
      makeCmd(state0, WORLD_ACTORS.north, 1, 'build_imm', {
        type: 'QUEUE_CONSTRUCTION',
        orderId: ConstructionOrderIdSchema.parse('con_imm_cancel'),
        nationId: WORLD_NATIONS.north,
        regionId: northRegionId,
        facilityType: 'GRANARY_FARM',
        targetFacilityId: null,
      })
    );
    if (!q2.ok) assert.fail(q2.reason);
    const c2 = runCmd(
      q2.nextState,
      makeCmd(q2.nextState, WORLD_ACTORS.north, 2, 'cancel_imm', {
        type: 'CANCEL_CONSTRUCTION',
        orderId: ConstructionOrderIdSchema.parse('con_imm_cancel'),
        nationId: WORLD_NATIONS.north,
      })
    );
    if (!c2.ok) assert.fail(c2.reason);
    assert.equal(c2.nextState.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.available.money, moneyBefore);
    assert.equal(
      c2.nextState.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.available.supplies,
      suppliesBefore
    );

    assert.equal(reconcilePhase03Resources(cancelRes.nextState.phase03Economy!).allReconciled, true);
    assert.equal(reconcilePhase03Resources(c2.nextState.phase03Economy!).allReconciled, true);
    assertSimulationInvariants(cancelRes.nextState);
  });

  it('P03-02: Laffer curve bounds tax revenue (raising tax from 35% to 60% yields LESS income)', () => {
    const yield20 = computeEffectiveTaxYieldBps(2000, asFixedPoint(0));
    const yield35 = computeEffectiveTaxYieldBps(3500, asFixedPoint(0));
    const yield50 = computeEffectiveTaxYieldBps(5000, asFixedPoint(0));
    const yield60 = computeEffectiveTaxYieldBps(6000, asFixedPoint(0));

    assert.ok(yield35 > yield20, `expected yield at 35% (${yield35}) > yield at 20% (${yield20})`);
    assert.ok(yield50 < yield35, `expected yield at 50% (${yield50}) < yield at 35% (${yield35})`);
    assert.ok(yield60 < yield50, `expected yield at 60% (${yield60}) < yield at 50% (${yield50})`);

    const state = makeWorldState('mch_p03_laffer');
    const p3 = structuredClone(state.phase03Economy!);
    p3.budgetsByNation[WORLD_NATIONS.north] = {
      ...p3.budgetsByNation[WORLD_NATIONS.north]!,
      effectiveTaxRateBps: 3500,
      targetTaxRateBps: 3500,
    };
    const f35 = computeNationFiscalForecast24h(state, p3, WORLD_NATIONS.north);

    const p3High = structuredClone(p3);
    p3High.budgetsByNation[WORLD_NATIONS.north] = {
      ...p3High.budgetsByNation[WORLD_NATIONS.north]!,
      effectiveTaxRateBps: 6000,
      targetTaxRateBps: 6000,
    };
    const f60 = computeNationFiscalForecast24h(state, p3High, WORLD_NATIONS.north);

    assert.ok(
      (f60.taxRevenueDailyFp as number) < (f35.taxRevenueDailyFp as number),
      `expected daily tax at 60% (${f60.taxRevenueDailyFp}) < 35% (${f35.taxRevenueDailyFp})`
    );
    assert.ok(
      f60.warnings.some((w) => w.code === 'HIGH_TAX_LAFFER_DRAG'),
      'expected HIGH_TAX_LAFFER_DRAG warning at 60% tax'
    );
  });

  it('P03-02: delayed tax policy, cooldown, 4-sector allocation validation, bounded credit & austerity throttle', () => {
    const state0 = makeWorldState('mch_p03_budget');

    // Invalid 4-sector allocation (sum != 10000) rejected by Zod schema
    const badAllocParse = CommandSchema.safeParse(
      makeCmd(state0, WORLD_ACTORS.north, 1, 'bad_alloc', {
        type: 'UPDATE_BUDGET_POLICY',
        nationId: WORLD_NATIONS.north,
        targetTaxRateBps: 2500,
        allocations: { defenseBps: 4000, civilianBps: 4000, scienceBps: 1000, industryBps: 2000 },
      })
    );
    assert.equal(badAllocParse.success, false);

    // Valid budget update: target tax 35% -> delayed by 2h
    const budRes = runCmd(
      state0,
      makeCmd(state0, WORLD_ACTORS.north, 1, 'good_bud', {
        type: 'UPDATE_BUDGET_POLICY',
        nationId: WORLD_NATIONS.north,
        targetTaxRateBps: 3500,
        allocations: { defenseBps: 3500, civilianBps: 2500, scienceBps: 2000, industryBps: 2000 },
      })
    );
    if (!budRes.ok) assert.fail(budRes.reason);
    const b1 = budRes.nextState.phase03Economy!.budgetsByNation[WORLD_NATIONS.north]!;
    assert.equal(b1.effectiveTaxRateBps, 2000, 'tax change must NOT take effect immediately');
    assert.equal(b1.targetTaxRateBps, 3500);
    assert.equal(b1.taxChangeEffectiveAtUtc, BASE_UTC + TAX_POLICY_DELAY_MS);

    // Immediate second tax change MUST be rejected by cooldown
    const cooldownRes = runCmd(
      budRes.nextState,
      makeCmd(budRes.nextState, WORLD_ACTORS.north, 2, 'cool_bud', {
        type: 'UPDATE_BUDGET_POLICY',
        nationId: WORLD_NATIONS.north,
        targetTaxRateBps: 1500,
        allocations: { defenseBps: 3500, civilianBps: 2500, scienceBps: 2000, industryBps: 2000 },
      })
    );
    assert.equal(cooldownRes.ok, false);

    // Advance 2 hours -> delayed tax rate activates
    const after2h = advanceClock(budRes.nextState, 1, TAX_POLICY_DELAY_MS);
    assert.equal(after2h.phase03Economy!.budgetsByNation[WORLD_NATIONS.north]!.effectiveTaxRateBps, 3500);

    // Bounded credit: draw exceeding limit rejected; draw within limit succeeds; repay works
    const creditLimit = after2h.phase03Economy!.budgetsByNation[WORLD_NATIONS.north]!.creditLimitFp as number;
    const drawOver = runCmd(
      after2h,
      makeCmd(after2h, WORLD_ACTORS.north, 2, 'draw_over', {
        type: 'MANAGE_CREDIT',
        nationId: WORLD_NATIONS.north,
        action: 'DRAW',
        amountFp: asFixedPoint(creditLimit + 1000),
      })
    );
    assert.equal(drawOver.ok, false);

    const drawOk = runCmd(
      after2h,
      makeCmd(after2h, WORLD_ACTORS.north, 2, 'draw_ok', {
        type: 'MANAGE_CREDIT',
        nationId: WORLD_NATIONS.north,
        action: 'DRAW',
        amountFp: wholeUnitsToFixedPoint(100),
      })
    );
    if (!drawOk.ok) assert.fail(drawOk.reason);
    assert.equal(
      drawOk.nextState.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.debtMoneyFp,
      wholeUnitsToFixedPoint(100)
    );

    const repayOk = runCmd(
      drawOk.nextState,
      makeCmd(drawOk.nextState, WORLD_ACTORS.north, 3, 'repay_ok', {
        type: 'MANAGE_CREDIT',
        nationId: WORLD_NATIONS.north,
        action: 'REPAY',
        amountFp: wholeUnitsToFixedPoint(40),
      })
    );
    if (!repayOk.ok) assert.fail(repayOk.reason);
    assert.equal(
      repayOk.nextState.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.debtMoneyFp,
      wholeUnitsToFixedPoint(60)
    );

    // Cash shortfall + maxed debt -> AUSTERITY_THROTTLED, activityThrottleBps < 10000, treasury >= 0
    const stressed = structuredClone(repayOk.nextState);
    const stressedStock = stressed.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!;
    const stressedBudget = stressed.phase03Economy!.budgetsByNation[WORLD_NATIONS.north]!;
    const moneyToBurn = stressedStock.available.money as number;
    const debtGap = (stressedBudget.creditLimitFp as number) - (stressedStock.debtMoneyFp as number);
    stressedStock.available.money = asFixedPoint(0);
    stressedStock.debtMoneyFp = stressedBudget.creditLimitFp;
    stressed.phase03Economy!.resourceAudit.burnedTotal.money = asFixedPoint(
      (stressed.phase03Economy!.resourceAudit.burnedTotal.money as number) + moneyToBurn + debtGap
    );
    stressedBudget.effectiveTaxRateBps = 500;
    stressedBudget.targetTaxRateBps = 500;
    stressedBudget.interestRateBpsPerDay = 1500;

    const afterShortfall = advanceClock(stressed, 2, 3_600_000);
    const northBudgetAfter = afterShortfall.phase03Economy!.budgetsByNation[WORLD_NATIONS.north]!;
    const northStockAfter = afterShortfall.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!;
    assert.equal(northBudgetAfter.fiscalStatus, 'AUSTERITY_THROTTLED');
    assert.ok(
      northBudgetAfter.activityThrottleBps < 10000,
      `expected activityThrottleBps < 10000, got ${northBudgetAfter.activityThrottleBps}`
    );
    assert.ok((northStockAfter.available.money as number) >= 0, 'treasury must NEVER be negative');
    assert.ok(
      (northStockAfter.debtMoneyFp as number) <= (northBudgetAfter.creditLimitFp as number),
      'debt must NEVER exceed creditLimitFp'
    );
    assert.equal(reconcilePhase03Resources(afterShortfall.phase03Economy!).allReconciled, true);
    assertSimulationInvariants(afterShortfall);
  });

  it('P03-03: 8 facility types Tiers I-III, ownership vs operational status, and input shortage pauses factory & production', () => {
    assert.equal(FACILITY_TYPES.length, 8);
    for (const fType of FACILITY_TYPES) {
      assert.ok(FACILITY_CATALOG[fType].tiers[1]);
      assert.ok(FACILITY_CATALOG[fType].tiers[2]);
      assert.ok(FACILITY_CATALOG[fType].tiers[3]);
    }

    const state0 = makeWorldState('mch_p03_fac');
    const northArms = Object.values(state0.phase03Economy!.facilities).find(
      (f) => f.ownerNationId === WORLD_NATIONS.north && f.type === 'ARMS_FACTORY'
    )!;
    assert.ok(northArms);
    assert.equal(northArms.operationalStatus, 'ACTIVE');

    // Manual pause separates ownership from operational status
    const pauseRes = runCmd(
      state0,
      makeCmd(state0, WORLD_ACTORS.north, 1, 'pause_arms', {
        type: 'TOGGLE_FACILITY_PAUSE',
        nationId: WORLD_NATIONS.north,
        facilityId: northArms.facilityId,
        paused: true,
      })
    );
    if (!pauseRes.ok) assert.fail(pauseRes.reason);
    const pausedFac = pauseRes.nextState.phase03Economy!.facilities[northArms.facilityId]!;
    assert.equal(pausedFac.ownerNationId, WORLD_NATIONS.north);
    assert.equal(pausedFac.operationalStatus, 'PAUSED_MANUAL');
    assert.ok(pausedFac.pauseReason && pausedFac.pauseReason.length > 0);

    // Resume facility
    const resumeRes = runCmd(
      pauseRes.nextState,
      makeCmd(pauseRes.nextState, WORLD_ACTORS.north, 2, 'resume_arms', {
        type: 'TOGGLE_FACILITY_PAUSE',
        nationId: WORLD_NATIONS.north,
        facilityId: northArms.facilityId,
        paused: false,
      })
    );
    if (!resumeRes.ok) assert.fail(resumeRes.reason);
    assert.equal(resumeRes.nextState.phase03Economy!.facilities[northArms.facilityId]!.operationalStatus, 'ACTIVE');

    // Queue a 1-batch production order on ARMS_FACTORY (60 min)
    const prodRes = runCmd(
      resumeRes.nextState,
      makeCmd(resumeRes.nextState, WORLD_ACTORS.north, 3, 'prod_arms', {
        type: 'QUEUE_PRODUCTION',
        orderId: ProductionOrderIdSchema.parse('prd_arms_shortage'),
        nationId: WORLD_NATIONS.north,
        facilityId: northArms.facilityId,
        batchCount: 1,
      })
    );
    if (!prodRes.ok) assert.fail(prodRes.reason);

    // Simulate acute input shortage: deplete North's supplies to 0 while keeping reconciliation exact
    const starved = structuredClone(prodRes.nextState);
    const northStock = starved.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!;
    const suppliesToDrain = northStock.available.supplies as number;
    northStock.available.supplies = asFixedPoint(0);
    starved.phase03Economy!.resourceAudit.burnedTotal.supplies = asFixedPoint(
      (starved.phase03Economy!.resourceAudit.burnedTotal.supplies as number) + suppliesToDrain
    );
    const allFacs: FacilityInstance[] = Object.values(starved.phase03Economy!.facilities);
    const northSupplyDepot = allFacs.find(
      (f) => f.ownerNationId === WORLD_NATIONS.north && f.type === 'SUPPLY_DEPOT'
    )!;
    starved.phase03Economy!.facilities[northSupplyDepot.facilityId] = {
      ...northSupplyDepot,
      manualPaused: true,
      operationalStatus: 'PAUSED_MANUAL',
      efficiencyBps: 0,
      pauseReason: 'Tạm dừng thủ công để kiểm thử thiếu đầu vào.',
    };

    const equipmentBefore = northStock.available.equipment as number;
    const after1h = advanceClock(starved, 1, 3_600_000);

    const armsAfter = after1h.phase03Economy!.facilities[northArms.facilityId]!;
    const orderAfter = after1h.phase03Economy!.productionQueue['prd_arms_shortage']!;
    assert.equal(armsAfter.operationalStatus, 'PAUSED_NO_INPUTS');
    assert.ok(armsAfter.pauseReason && armsAfter.pauseReason.toLowerCase().includes('vật tư'));
    assert.equal(orderAfter.status, 'PAUSED');
    assert.ok(orderAfter.pauseReason && orderAfter.pauseReason.length > 0);
    assert.equal(
      after1h.phase03Economy!.stocksByNation[WORLD_NATIONS.north]!.available.equipment,
      equipmentBefore
    );
    assert.equal(reconcilePhase03Resources(after1h.phase03Economy!).allReconciled, true);
    assertSimulationInvariants(after1h);
  });

  it('P03-03 + Restart + Auth: server restart across construction & production deadlines NEVER double-produces, and viewer isolation holds', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-p03-restart-'));
    const dbPath = path.join(tmpDir, 'phase03.sqlite');
    const clock = new ManualClock(BASE_UTC);

    let matchId = '';
    let northToken = '';
    let southToken = '';
    let outsiderToken = '';
    let northFacCountBefore = 0;
    let northArmsId = '';

    // Phase 1: Boot runtime #1, create 2-slot match, start, queue construction (2h) & production (1h)
    const run1 = await startRuntime({ dbPath, clock });
    try {
      const north = await registerUser(run1.baseUrl, 'p03_north', 'Chỉ huy Bắc');
      const south = await registerUser(run1.baseUrl, 'p03_south', 'Chỉ huy Nam');
      const outsider = await registerUser(run1.baseUrl, 'p03_outsider', 'Người ngoài');
      northToken = north.token;
      southToken = south.token;
      outsiderToken = outsider.token;

      const createRes = await fetch(`${run1.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${northToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Phase 03 Restart Proof', preferredSlot: 'NORTH' }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as {
        room: { matchId: string; inviteCode: string };
        match: { version: number; regions: Record<string, { regionId: string; controllerNationId: string }> };
      };
      matchId = created.room.matchId;

      const joinRes = await fetch(`${run1.baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${southToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: created.room.inviteCode }),
      });
      assert.equal(joinRes.status, 200);

      for (const tok of [northToken, southToken]) {
        const rdy = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/ready`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ready: true }),
        });
        assert.equal(rdy.status, 200);
      }

      const startRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${northToken}` },
      });
      assert.equal(startRes.status, 200);

      // Outsider MUST get 403 on economy endpoint
      const outEcon = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/economy`, {
        headers: { Authorization: `Bearer ${outsiderToken}` },
      });
      assert.equal(outEcon.status, 403);

      // Fetch North's initial Phase 03 report
      const econNorthRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/economy`, {
        headers: { Authorization: `Bearer ${northToken}` },
      });
      assert.equal(econNorthRes.status, 200);
      const econNorth = (await econNorthRes.json()) as {
        version: number;
        phase03: {
          nationId: string;
          facilities: Array<{ facilityId: string; type: string; ownerNationId: string }>;
        };
      };
      assert.equal(econNorth.phase03.nationId, WORLD_NATIONS.north);
      northFacCountBefore = econNorth.phase03.facilities.length;
      northArmsId = econNorth.phase03.facilities.find((f) => f.type === 'ARMS_FACTORY')!.facilityId;

      // Impersonation guard: North trying to borrow credit on South's nationId MUST get 403
      const hijackRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${northToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_hijack_1',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_hijack_1',
          sequence: 1,
          expectedVersion: econNorth.version,
          issuedAtUtc: BASE_UTC,
          payload: {
            type: 'MANAGE_CREDIT',
            nationId: WORLD_NATIONS.south,
            action: 'DRAW',
            amountFp: 10_000,
          },
        }),
      });
      assert.equal(hijackRes.status, 403);

      // Queue 1 construction order (MEDICAL_CENTER Tier I, 2h)
      const northRegionId = Object.values(created.match.regions).find(
        (r) => r.controllerNationId === WORLD_NATIONS.north
      )!.regionId;

      const buildCmdRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${northToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_build_med_1',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_build_med_1',
          sequence: 1,
          expectedVersion: econNorth.version,
          issuedAtUtc: BASE_UTC,
          payload: {
            type: 'QUEUE_CONSTRUCTION',
            orderId: 'con_restart_med_1',
            nationId: WORLD_NATIONS.north,
            regionId: northRegionId,
            facilityType: 'MEDICAL_CENTER',
            targetFacilityId: null,
          },
        }),
      });
      assert.equal(buildCmdRes.status, 201);
      const buildAck = (await buildCmdRes.json()) as { version: number };

      // Queue 1 production order (ARMS_FACTORY 1 batch = +12 equipment, 60 min)
      const prodCmdRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${northToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_prod_arms_2',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_prod_arms_2',
          sequence: 2,
          expectedVersion: buildAck.version,
          issuedAtUtc: BASE_UTC,
          payload: {
            type: 'QUEUE_PRODUCTION',
            orderId: 'prd_restart_arms_1',
            nationId: WORLD_NATIONS.north,
            facilityId: FacilityIdSchema.parse(northArmsId),
            batchCount: 1,
          },
        }),
      });
      assert.equal(prodCmdRes.status, 201);

      const northSyncRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/sync?sinceSequence=0`, {
        headers: { Authorization: `Bearer ${northToken}` },
      });
      const southSyncRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/sync?sinceSequence=0`, {
        headers: { Authorization: `Bearer ${southToken}` },
      });
      assert.equal(northSyncRes.status, 200);
      assert.equal(southSyncRes.status, 200);
      const northSync = await northSyncRes.json();
      const southSync = await southSyncRes.json();
      assert.equal(northSync.currentSequence, southSync.currentSequence);
      assert.equal(northSync.missedEvents.some((event: { payload: { type: string } }) =>
        event.payload.type === 'CONSTRUCTION_QUEUED'), true);
      for (const projected of [southSync.missedEvents, southSync.match.events]) {
        const serialized = JSON.stringify(projected);
        assert.doesNotMatch(serialized, /con_restart_med_1|prd_restart_arms_1/);
      }
      const publicDetails = await fetch(`${run1.baseUrl}/api/matches/${matchId}`);
      assert.equal(publicDetails.status, 404);
      const publicMatches = await (await fetch(`${run1.baseUrl}/api/matches`)).json();
      assert.equal(publicMatches.matches.some((match: { matchId: string }) => match.matchId === matchId), false);

      // Viewer isolation: South calling /economy must NEVER see North's construction/production/ledger
      const econSouthRes = await fetch(`${run1.baseUrl}/api/rooms/${matchId}/economy`, {
        headers: { Authorization: `Bearer ${southToken}` },
      });
      assert.equal(econSouthRes.status, 200);
      const econSouth = (await econSouthRes.json()) as {
        phase03: {
          nationId: string;
          constructionQueue: Array<{ orderId: string }>;
          productionQueue: Array<{ orderId: string }>;
          ledger: Array<{ nationId: string }>;
        };
      };
      assert.equal(econSouth.phase03.nationId, WORLD_NATIONS.south);
      assert.equal(econSouth.phase03.constructionQueue.length, 0);
      assert.equal(econSouth.phase03.productionQueue.length, 0);
      assert.ok(econSouth.phase03.ledger.every((e) => e.nationId === WORLD_NATIONS.south));
    } finally {
      await run1.runtime.close();
      run1.store.close();
    }

    // Phase 2: Server restarts AFTER both deadlines have passed (+3 hours)
    clock.advanceByMs(3 * 3_600_000);
    const store2 = new SqliteMatchStore(dbPath);
    try {
      const schedA = new MatchClockScheduler(store2, clock, {
        workerOwnerId: 'wrk_restart_a',
        maxBatchesPerMatch: 10,
      });
      schedA.runCatchUpCycle();
      schedA.runCatchUpCycle();
    } finally {
      store2.close();
    }

    // Phase 3: Restart a 3rd time at the exact same timestamp to guarantee zero duplicate completion
    const store3 = new SqliteMatchStore(dbPath);
    try {
      const schedB = new MatchClockScheduler(store3, clock, {
        workerOwnerId: 'wrk_restart_b',
        maxBatchesPerMatch: 10,
      });
      schedB.runCatchUpCycle();

      const loaded = store3.getMatch(MatchIdSchema.parse(matchId))!;
      assert.ok(loaded);
      const p3 = loaded.state.phase03Economy!;

      // Construction completed EXACTLY ONCE
      const northFacsAfter = Object.values(p3.facilities).filter(
        (f) => f.ownerNationId === WORLD_NATIONS.north
      );
      assert.equal(northFacsAfter.length, northFacCountBefore + 1);
      assert.equal(p3.constructionQueue['con_restart_med_1']!.status, 'COMPLETED');

      // Production completed EXACTLY ONCE
      assert.equal(p3.productionQueue['prd_restart_arms_1']!.status, 'COMPLETED');
      const prodDoneEvents = loaded.state.events.filter(
        (e) =>
          e.payload.type === 'PRODUCTION_COMPLETED' &&
          e.payload.orderId === 'prd_restart_arms_1'
      );
      assert.equal(prodDoneEvents.length, 1, 'production MUST complete exactly once across restarts');

      const conDoneEvents = loaded.state.events.filter(
        (e) =>
          e.payload.type === 'CONSTRUCTION_COMPLETED' &&
          e.payload.orderId === 'con_restart_med_1'
      );
      assert.equal(conDoneEvents.length, 1, 'construction MUST complete exactly once across restarts');

      assert.equal(reconcilePhase03Resources(p3).allReconciled, true);
      assertSimulationInvariants(loaded.state);
      const replay = store3.verifyMatchReplay(MatchIdSchema.parse(matchId));
      assert.ok(replay, 'replay report must exist');
      assert.equal(replay.verified, true, 'deterministic replay SHA-256 must match 100% after restarts');
    } finally {
      store3.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
