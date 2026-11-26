import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import {
  asFixedPoint,
  asUtcEpochMs,
  Command,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  IdempotencyKeySchema,
  JobIdSchema,
  MatchState,
  NationId,
  projectMatchForViewer,
  wholeUnitsToFixedPoint,
} from '../contracts';
import { createWorld72MatchState, WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import { createServerRuntime } from '../server/createApp';
import { SqliteMatchStore } from '../server/db/sqliteStore';
import { ServerConfig } from '../server/config';
import {
  assertSimulationInvariants,
  computeNationEconomicForecast,
  computeStateHash,
  ECONOMIC_SETTLEMENT_INTERVAL_MS,
  FixedClock,
  reduceCommand,
  replayCommandLog,
  ReplayLogEntry,
} from './index';

const BASE_UTC = 1_760_000_000_000;

function makeWorldState(matchId = 'mch_eco_unit_01'): MatchState {
  return createWorld72MatchState({
    matchId,
    title: 'P03-01 Economic Foundation Test',
    seed: 195501,
    createdAtUtc: BASE_UTC,
    mode: 'PRODUCTION_REALTIME',
  });
}

function makeTickCommand(
  state: MatchState,
  seq: number,
  targetUtc: number,
  tag: string
): Command {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse(`cmd_tick_${tag}_${seq}`),
    matchId: state.matchId,
    actorId: WORLD_ACTORS.system,
    idempotencyKey: IdempotencyKeySchema.parse(`idem_tick_${tag}_${seq}`),
    sequence: seq,
    expectedVersion: state.version,
    issuedAtUtc: asUtcEpochMs(targetUtc),
    payload: {
      type: 'ADVANCE_REALTIME_TICK',
      targetUtc: asUtcEpochMs(targetUtc),
    },
  };
}

describe('P03-01 Pure Authoritative Economic Engine & Ledger Integrity', () => {
  it('settles hourly, 6-hour catch-up, and 24-hour production/upkeep cycles with exact fixed-point conservation and deterministic replay', () => {
    const initial = makeWorldState('mch_eco_cycles_01');
    const log: ReplayLogEntry[] = [];
    let state = initial;

    // 1. Sub-hour tick (30 minutes) must NOT settle any economic cycle
    const t30m = BASE_UTC + 30 * 60_000;
    const cmd1 = makeTickCommand(state, 1, t30m, '30m');
    const r1 = reduceCommand(state, cmd1, new FixedClock(t30m));
    if (!r1.ok) assert.fail(r1.reason);
    assert.equal(
      r1.emittedEvents.some((e) => e.payload.type === 'ECONOMY_CYCLE_SETTLED'),
      false
    );
    log.push({ command: cmd1, appliedAtUtc: asUtcEpochMs(t30m) });
    state = r1.nextState;

    // 2. Advance to +1 hour -> settles exactly 1 hourly cycle
    const t1h = BASE_UTC + ECONOMIC_SETTLEMENT_INTERVAL_MS;
    const northFoodBefore = state.nations[WORLD_NATIONS.north].resources.food as number;
    const cmd2 = makeTickCommand(state, 2, t1h, '1h');
    const r2 = reduceCommand(state, cmd2, new FixedClock(t1h));
    if (!r2.ok) assert.fail(r2.reason);
    const settled1h = r2.emittedEvents.find((e) => e.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.ok(settled1h && settled1h.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.equal(settled1h.payload.cyclesSettled, 1);
    assert.ok(
      (r2.nextState.nations[WORLD_NATIONS.north].resources.food as number) > northFoodBefore,
      'North food should grow after 1h production minus upkeep'
    );
    log.push({ command: cmd2, appliedAtUtc: asUtcEpochMs(t1h) });
    state = r2.nextState;

    // 3. Offline catch-up jump of +6 hours -> settles 6 hourly cycles deterministically
    const t7h = BASE_UTC + 7 * ECONOMIC_SETTLEMENT_INTERVAL_MS;
    const cmd3 = makeTickCommand(state, 3, t7h, '7h');
    const r3 = reduceCommand(state, cmd3, new FixedClock(t7h));
    if (!r3.ok) assert.fail(r3.reason);
    const settled6h = r3.emittedEvents.find((e) => e.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.ok(settled6h && settled6h.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.equal(settled6h.payload.cyclesSettled, 6);
    log.push({ command: cmd3, appliedAtUtc: asUtcEpochMs(t7h) });
    state = r3.nextState;

    // 4. Advance remaining 17 hours to complete a full 24h real-time day
    const t24h = BASE_UTC + 24 * ECONOMIC_SETTLEMENT_INTERVAL_MS;
    const cmd4 = makeTickCommand(state, 4, t24h, '24h');
    const r4 = reduceCommand(state, cmd4, new FixedClock(t24h));
    if (!r4.ok) assert.fail(r4.reason);
    const settled17h = r4.emittedEvents.find((e) => e.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.ok(settled17h && settled17h.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.equal(settled17h.payload.cyclesSettled, 17);
    log.push({ command: cmd4, appliedAtUtc: asUtcEpochMs(t24h) });
    state = r4.nextState;

    assertSimulationInvariants(state);
    assert.equal(state.economicState?.lastSettlementUtc, asUtcEpochMs(t24h));
    assert.ok((state.economicLedger?.length ?? 0) > 0);

    // Deterministic replay from scratch must produce bit-identical SHA-256 hash
    const replayed = replayCommandLog(initial, log);
    assert.equal(replayed.finalHash, computeStateHash(state));
  });

  it('enforces stockpile caps without breaking conservation and prevents negative stock on upkeep shortfall', () => {
    const base = makeWorldState('mch_eco_caps_01');
    // Lower stockpile cap for food to 642.000 (North starts at 640.000) so 1h minting clamps cleanly
    const cappedState: MatchState = {
      ...base,
      economicState: {
        ...base.economicState!,
        stockpileCaps: {
          ...base.economicState!.stockpileCaps,
          food: wholeUnitsToFixedPoint(642),
        },
      },
      // Drain NPC Highland food & treasury to 0 and give it heavy upkeep policy to trigger shortfall safely
      nations: {
        ...base.nations,
        [WORLD_NATIONS.npcHighland]: {
          ...base.nations[WORLD_NATIONS.npcHighland],
          resources: {
            ...base.nations[WORLD_NATIONS.npcHighland].resources,
            food: asFixedPoint(0),
            treasury: asFixedPoint(0),
          },
        },
      },
      policies: {
        pol_heavy_upkeep: {
          policyId: 'pol_heavy_upkeep' as never,
          ownerNationId: WORLD_NATIONS.npcHighland,
          code: 'HEAVY_MAINT',
          title: 'Chi phí bảo trì cực đại (Test)',
          status: 'ACTIVE',
          enactedAtUtc: asUtcEpochMs(BASE_UTC),
          upkeepPerDay: {
            food: wholeUnitsToFixedPoint(2400), // 100/h >> Highland production
            industrial: asFixedPoint(0),
            treasury: wholeUnitsToFixedPoint(2400),
            manpower: asFixedPoint(0),
            politicalCapital: asFixedPoint(0),
          },
          stabilityDeltaFp: 0 as never,
        },
      },
      resourceAudit: {
        ...base.resourceAudit,
        burnedTotal: {
          ...base.resourceAudit.burnedTotal,
          food: base.nations[WORLD_NATIONS.npcHighland].resources.food,
          treasury: base.nations[WORLD_NATIONS.npcHighland].resources.treasury,
        },
      },
    };
    assertSimulationInvariants(cappedState);

    const highlandStabilityBefore = cappedState.nations[WORLD_NATIONS.npcHighland].stabilityFp as number;
    const t1h = BASE_UTC + ECONOMIC_SETTLEMENT_INTERVAL_MS;
    const res = reduceCommand(
      cappedState,
      makeTickCommand(cappedState, 1, t1h, 'caps'),
      new FixedClock(t1h)
    );
    if (!res.ok) assert.fail(res.reason);

    // North food never exceeds cap (642.000) even after production minus upkeep
    assert.ok(
      (res.nextState.nations[WORLD_NATIONS.north].resources.food as number) <= 642_000,
      'Stockpile cap must clamp minted production'
    );

    // Highland food & treasury are clamped at 0 (NEVER negative!) and shortfall penalty applied
    assert.equal(res.nextState.nations[WORLD_NATIONS.npcHighland].resources.food as number, 0);
    assert.equal(res.nextState.nations[WORLD_NATIONS.npcHighland].resources.treasury as number, 0);
    assert.equal(
      res.nextState.nations[WORLD_NATIONS.npcHighland].stabilityFp as number,
      highlandStabilityBefore - 1000
    );

    const settledEv = res.emittedEvents.find((e) => e.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.ok(settledEv && settledEv.payload.type === 'ECONOMY_CYCLE_SETTLED');
    assert.ok(settledEv.payload.shortfallNationIds.includes(WORLD_NATIONS.npcHighland));
    assertSimulationInvariants(res.nextState);
  });

  it('executes SET_TAX_RATE fiscal trade-offs and blocks opponent impersonation', () => {
    const state = makeWorldState('mch_eco_tax_01');
    const baselineForecast = computeNationEconomicForecast(state, WORLD_NATIONS.north);
    assert.equal(baselineForecast.taxRateBps, 2000);

    // South cannot change North's tax rate
    const impersonation: Command = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_tax_impersonate_1'),
      matchId: state.matchId,
      actorId: WORLD_ACTORS.south,
      idempotencyKey: IdempotencyKeySchema.parse('idem_tax_impersonate_1'),
      sequence: 1,
      expectedVersion: state.version,
      issuedAtUtc: asUtcEpochMs(BASE_UTC + 1000),
      payload: {
        type: 'SET_TAX_RATE',
        nationId: WORLD_NATIONS.north,
        taxRateBps: 4000,
      },
    };
    const blocked = reduceCommand(state, impersonation, new FixedClock(BASE_UTC + 1000));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, 'FORBIDDEN_ACTION');

    // North raises tax to 40% (4000 bps) -> higher treasury, lower industrial & politicalCapital
    const raiseTax: Command = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_tax_north_1'),
      matchId: state.matchId,
      actorId: WORLD_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_tax_north_1'),
      sequence: 1,
      expectedVersion: state.version,
      issuedAtUtc: asUtcEpochMs(BASE_UTC + 2000),
      payload: {
        type: 'SET_TAX_RATE',
        nationId: WORLD_NATIONS.north,
        taxRateBps: 4000,
      },
    };
    const updated = reduceCommand(state, raiseTax, new FixedClock(BASE_UTC + 2000));
    if (!updated.ok) assert.fail(updated.reason);

    const highTaxForecast = computeNationEconomicForecast(updated.nextState, WORLD_NATIONS.north);
    assert.equal(highTaxForecast.taxRateBps, 4000);
    assert.ok(
      (highTaxForecast.grossDaily.treasury as number) >
        (baselineForecast.grossDaily.treasury as number),
      'Higher tax must raise treasury income'
    );
    assert.ok(
      (highTaxForecast.grossDaily.industrial as number) <
        (baselineForecast.grossDaily.industrial as number),
      'Higher tax must moderate industrial output'
    );
    assert.ok(
      (highTaxForecast.grossDaily.politicalCapital as number) <
        (baselineForecast.grossDaily.politicalCapital as number),
      'Higher tax must reduce political capital generation'
    );
  });

  it('cancels a scheduled job with exact 80% refund + 20% overhead burn, records traceable ledger txns, and blocks double/opponent cancels', () => {
    const initial = makeWorldState('mch_eco_cancel_01');
    const startInd = initial.nations[WORLD_NATIONS.north].resources.industrial as number;
    const jobId = JobIdSchema.parse('job_cancel_test_01');

    // Schedule job costing 10.001 industrial (tests exact remainder math with non-multiple of 5!)
    const costFp = asFixedPoint(10_001);
    const scheduleCmd: Command = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_sched_cancel_1'),
      matchId: initial.matchId,
      actorId: WORLD_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_sched_cancel_1'),
      sequence: 1,
      expectedVersion: initial.version,
      issuedAtUtc: asUtcEpochMs(BASE_UTC + 1000),
      payload: {
        type: 'SCHEDULE_JOB',
        jobId,
        nationId: WORLD_NATIONS.north,
        kind: 'INFRASTRUCTURE_WORK',
        durationMs: 900_000,
        costResource: 'industrial',
        costAmountFp: costFp,
      },
    };
    const rSched = reduceCommand(initial, scheduleCmd, new FixedClock(BASE_UTC + 1000));
    if (!rSched.ok) assert.fail(rSched.reason);
    assert.equal(
      rSched.nextState.nations[WORLD_NATIONS.north].resources.industrial as number,
      startInd - 10_001
    );

    // Opponent (South) cannot cancel North's job
    const oppCancel: Command = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_cancel_opp_1'),
      matchId: initial.matchId,
      actorId: WORLD_ACTORS.south,
      idempotencyKey: IdempotencyKeySchema.parse('idem_cancel_opp_1'),
      sequence: 1,
      expectedVersion: rSched.nextState.version,
      issuedAtUtc: asUtcEpochMs(BASE_UTC + 2000),
      payload: {
        type: 'CANCEL_JOB',
        jobId,
        nationId: WORLD_NATIONS.south,
      },
    };
    const rOpp = reduceCommand(rSched.nextState, oppCancel, new FixedClock(BASE_UTC + 2000));
    assert.equal(rOpp.ok, false);
    if (!rOpp.ok) assert.equal(rOpp.code, 'FORBIDDEN_ACTION');

    // North cancels its own scheduled job -> exact 8000 refund + 2001 burned overhead (8000 + 2001 == 10001)
    const cancelCmd: Command = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_cancel_north_2'),
      matchId: initial.matchId,
      actorId: WORLD_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_cancel_north_2'),
      sequence: 2,
      expectedVersion: rSched.nextState.version,
      issuedAtUtc: asUtcEpochMs(BASE_UTC + 3000),
      payload: {
        type: 'CANCEL_JOB',
        jobId,
        nationId: WORLD_NATIONS.north,
      },
    };
    const rCancel = reduceCommand(rSched.nextState, cancelCmd, new FixedClock(BASE_UTC + 3000));
    if (!rCancel.ok) assert.fail(rCancel.reason);

    assert.equal(rCancel.nextState.jobs[jobId].status, 'CANCELLED');
    assert.equal(
      rCancel.nextState.nations[WORLD_NATIONS.north].resources.industrial as number,
      startInd - 2001
    );
    assert.equal(rCancel.nextState.resourceAudit.burnedTotal.industrial as number, 2001);

    // Ledger contains JOB_RESERVE, JOB_REFUND (8000), and JOB_CANCEL_OVERHEAD (2001)
    const kinds = (rCancel.nextState.economicLedger ?? []).map((e) => e.kind);
    assert.deepEqual(kinds, ['JOB_RESERVE', 'JOB_REFUND', 'JOB_CANCEL_OVERHEAD']);
    assertSimulationInvariants(rCancel.nextState);

    // Double-cancel must be rejected (no double refund!)
    const doubleCancel: Command = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_cancel_double_3'),
      matchId: initial.matchId,
      actorId: WORLD_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_cancel_double_3'),
      sequence: 3,
      expectedVersion: rCancel.nextState.version,
      issuedAtUtc: asUtcEpochMs(BASE_UTC + 4000),
      payload: {
        type: 'CANCEL_JOB',
        jobId,
        nationId: WORLD_NATIONS.north,
      },
    };
    const rDouble = reduceCommand(rCancel.nextState, doubleCancel, new FixedClock(BASE_UTC + 4000));
    assert.equal(rDouble.ok, false);
    if (!rDouble.ok) assert.equal(rDouble.code, 'INVALID_TARGET');

    // Viewer projection filters North's ledger strictly from South's view
    const southView = projectMatchForViewer(
      rCancel.nextState,
      rCancel.stateHash,
      'SOUTH',
      WORLD_NATIONS.south
    );
    assert.equal(southView.economicLedger?.length ?? 0, 0);
    const northView = projectMatchForViewer(
      rCancel.nextState,
      rCancel.stateHash,
      'NORTH',
      WORLD_NATIONS.north
    );
    assert.equal(northView.economicLedger?.length ?? 0, 3);
  });
});

async function httpJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  options?: { token?: string; body?: unknown }
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = options?.body !== undefined ? JSON.stringify(options.body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${urlPath}`,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('P03-01 Server API Integration: Viewer-Scoped Economy Forecast & Ledger Isolation', () => {
  it('serves authenticated GET /api/rooms/:matchId/economy, blocks non-members, and isolates opponent ledgers', async () => {
    let currentTestUtc = BASE_UTC;
    const clock = {
      nowUtc: () => asUtcEpochMs(currentTestUtc),
      advanceMs: (ms: number) => {
        currentTestUtc += ms;
      },
    };
    const store = new SqliteMatchStore(':memory:');
    const config: ServerConfig = {
      appEnv: 'development',
      isProduction: false,
      port: 0,
      sqliteDbPath: ':memory:',
      allowPreviewFixture: true,
    };
    const runtime = createServerRuntime(config, store, clock);

    await new Promise<void>((resolve) => runtime.httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = runtime.httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind ephemeral port');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Register North, South, and an outsider
      const regN = await httpJson(baseUrl, 'POST', '/api/auth/register', {
        body: { username: 'eco_north', displayName: 'Bắc Kinh Tế', password: 'Password123!' },
      });
      const regS = await httpJson(baseUrl, 'POST', '/api/auth/register', {
        body: { username: 'eco_south', displayName: 'Nam Kinh Tế', password: 'Password123!' },
      });
      const regOut = await httpJson(baseUrl, 'POST', '/api/auth/register', {
        body: { username: 'eco_outsider', displayName: 'Người Ngoài', password: 'Password123!' },
      });
      const tokenN = String(regN.json.token);
      const tokenS = String(regS.json.token);
      const tokenOut = String(regOut.json.token);

      // Create & start 2-slot room
      const created = await httpJson(baseUrl, 'POST', '/api/rooms', {
        token: tokenN,
        body: { title: 'Phòng Kiểm Thử Kinh Tế P03-01', preferredSlot: 'NORTH' },
      });
      assert.equal(created.status, 201);
      const room = created.json.room as { matchId: string; inviteCode: string };
      const matchId = room.matchId;

      await httpJson(baseUrl, 'POST', '/api/rooms/join', {
        token: tokenS,
        body: { inviteCode: room.inviteCode },
      });
      await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/ready`, {
        token: tokenN,
        body: { ready: true },
      });
      await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/ready`, {
        token: tokenS,
        body: { ready: true },
      });
      const started = await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/start`, {
        token: tokenN,
      });
      assert.equal(started.status, 200);

      // Outsider is blocked (403) from reading room economy
      const outsiderRes = await httpJson(baseUrl, 'GET', `/api/rooms/${matchId}/economy`, {
        token: tokenOut,
      });
      assert.equal(outsiderRes.status, 403);

      // North sets tax rate to 30% and schedules a job, then cancels it
      const taxCmd: Command = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse('cmd_api_tax_1'),
        matchId: matchId as never,
        actorId: WORLD_ACTORS.north,
        idempotencyKey: IdempotencyKeySchema.parse('idem_api_tax_1'),
        sequence: 1,
        expectedVersion: 0,
        issuedAtUtc: asUtcEpochMs(BASE_UTC + 1000),
        payload: {
          type: 'SET_TAX_RATE',
          nationId: WORLD_NATIONS.north,
          taxRateBps: 3000,
        },
      };
      clock.advanceMs(1000);
      const rTax = await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/commands`, {
        token: tokenN,
        body: taxCmd,
      });
      assert.equal(rTax.status, 201);

      // South attempting to set North's tax rate is blocked with 403 at HTTP boundary
      const badTaxCmd: Command = {
        ...taxCmd,
        commandId: CommandIdSchema.parse('cmd_api_bad_tax_1'),
        actorId: WORLD_ACTORS.south,
        idempotencyKey: IdempotencyKeySchema.parse('idem_api_bad_tax_1'),
        expectedVersion: 1,
      };
      const rBadTax = await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/commands`, {
        token: tokenS,
        body: badTaxCmd,
      });
      assert.equal(rBadTax.status, 403);
      assert.equal(rBadTax.json.code, 'FORBIDDEN_NATION_IMPERSONATION');

      // North schedules then cancels a job
      const jobId = JobIdSchema.parse('job_api_eco_01');
      clock.advanceMs(1000);
      const schedRes = await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/commands`, {
        token: tokenN,
        body: {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: CommandIdSchema.parse('cmd_api_sched_2'),
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: IdempotencyKeySchema.parse('idem_api_sched_2'),
          sequence: 2,
          expectedVersion: 1,
          issuedAtUtc: asUtcEpochMs(BASE_UTC + 2000),
          payload: {
            type: 'SCHEDULE_JOB',
            jobId,
            nationId: WORLD_NATIONS.north,
            kind: 'LOGISTICS_REFORM',
            durationMs: 900_000,
            costResource: 'treasury',
            costAmountFp: wholeUnitsToFixedPoint(20),
          },
        },
      });
      assert.equal(schedRes.status, 201);

      clock.advanceMs(1000);
      const cancelRes = await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/commands`, {
        token: tokenN,
        body: {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: CommandIdSchema.parse('cmd_api_cancel_3'),
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: IdempotencyKeySchema.parse('idem_api_cancel_3'),
          sequence: 3,
          expectedVersion: 2,
          issuedAtUtc: asUtcEpochMs(BASE_UTC + 3000),
          payload: {
            type: 'CANCEL_JOB',
            jobId,
            nationId: WORLD_NATIONS.north,
          },
        },
      });
      assert.equal(cancelRes.status, 201);

      // North economy endpoint returns 30% tax + 3 ledger entries (RESERVE, REFUND, OVERHEAD)
      const ecoN = await httpJson(baseUrl, 'GET', `/api/rooms/${matchId}/economy`, {
        token: tokenN,
      });
      assert.equal(ecoN.status, 200);
      const forecastN = ecoN.json.forecast as { taxRateBps: number; nationId: NationId };
      const ledgerN = ecoN.json.ledger as Array<{ nationId: string; kind: string }>;
      assert.equal(forecastN.taxRateBps, 3000);
      assert.equal(forecastN.nationId, WORLD_NATIONS.north);
      assert.equal(ledgerN.length, 3);
      assert.equal(JSON.stringify(ecoN.json).includes('serverPrivate'), false);

      // South economy endpoint returns ONLY South's forecast (20% tax) and 0 North ledger entries!
      const ecoS = await httpJson(baseUrl, 'GET', `/api/rooms/${matchId}/economy`, {
        token: tokenS,
      });
      assert.equal(ecoS.status, 200);
      const forecastS = ecoS.json.forecast as { taxRateBps: number; nationId: NationId };
      const ledgerS = ecoS.json.ledger as Array<{ nationId: string }>;
      assert.equal(forecastS.taxRateBps, 2000);
      assert.equal(forecastS.nationId, WORLD_NATIONS.south);
      assert.equal(ledgerS.length, 0);

      // Verify deterministic replay over SQLite log matches stored hash 100%
      const replayRes = await httpJson(baseUrl, 'POST', `/api/rooms/${matchId}/verify-replay`, {
        token: tokenN,
      });
      assert.equal(replayRes.status, 200);
      const report = replayRes.json.report as { verified: boolean; replayedCommandCount: number };
      assert.equal(report.verified, true);
      assert.equal(report.replayedCommandCount, 3);
    } finally {
      await runtime.close();
      store.close();
    }
  });
});
