import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import {
  CAMPAIGN_AI_DECISION_INTERVAL_MS,
  CONTRACT_SCHEMA_VERSION,
  MatchId,
} from '../contracts';
import {
  VIETNAM_CAMPAIGN_CITY_BY_NAME,
  VIETNAM_CAMPAIGN_SCENARIO_ID,
} from '../content/vietnamCampaignScenario';
import { WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import { CAMPAIGN_UNIT_STATS, ManualClock } from '../simulation';
import { loadServerConfig } from './config';
import { createServerRuntime, ServerRateLimitConfig, ServerRuntime } from './createApp';
import { SqliteMatchStore } from './db/sqliteStore';

async function startTestRuntime(options?: {
  dbPath?: string;
  clock?: ManualClock;
  rateLimits?: ServerRateLimitConfig;
}): Promise<{
  runtime: ServerRuntime;
  baseUrl: string;
  wsUrl: string;
  store: SqliteMatchStore;
}> {
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: options?.dbPath ?? ':memory:',
  });
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const clock = options?.clock ?? new ManualClock(1_762_000_000_000);
  const runtime = createServerRuntime(config, store, clock, options?.rateLimits);

  await new Promise<void>((resolve) => {
    runtime.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = runtime.httpServer.address() as AddressInfo;
  return {
    runtime,
    store,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    wsUrl: `ws://127.0.0.1:${addr.port}/ws`,
  };
}

async function registerUser(
  baseUrl: string,
  username: string,
  displayName: string,
  password = 'SecurePass123!'
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, password }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { token: string; user: { userId: string } };
  return { token: body.token, userId: body.user.userId };
}

async function createAndStartCampaignRoom(
  baseUrl: string,
  northToken: string,
  southToken: string,
  title = 'Chiến dịch T06 Test'
): Promise<{ matchId: MatchId; inviteCode: string }> {
  const post = (token: string, route: string, body: object) =>
    fetch(baseUrl + route, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  const createRes = await post(northToken, '/api/rooms', {
    title,
    preferredSlot: 'NORTH',
    scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    room: { matchId: MatchId; inviteCode: string };
  };

  const joinRes = await post(southToken, '/api/rooms/join', {
    inviteCode: created.room.inviteCode,
  });
  assert.equal(joinRes.status, 200);

  for (const tok of [northToken, southToken]) {
    const readyRes = await post(tok, `/api/rooms/${created.room.matchId}/ready`, { ready: true });
    assert.equal(readyRes.status, 200);
  }

  const startRes = await post(northToken, `/api/rooms/${created.room.matchId}/start`, {});
  assert.equal(startRes.status, 200);

  return { matchId: created.room.matchId, inviteCode: created.room.inviteCode };
}

function makeCommandSender(
  baseUrl: string,
  store: SqliteMatchStore,
  clock: ManualClock,
  matchId: MatchId
) {
  const seqByActor: Record<string, number> = {};
  let cmdCounter = 0;

  return async function sendCmd(
    token: string,
    actorId: string,
    payload: Record<string, unknown>,
    opts?: { expectOk?: boolean }
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const nextSeq = (seqByActor[actorId] ?? 0) + 1;
    cmdCounter += 1;
    const version = store.getMatch(matchId)!.state.version;
    const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: `cmd_t06_${cmdCounter}`,
        matchId,
        actorId,
        idempotencyKey: `idem_t06_${cmdCounter}`,
        sequence: nextSeq,
        expectedVersion: version,
        issuedAtUtc: clock.nowUtc(),
        payload,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (res.status === 201) {
      seqByActor[actorId] = nextSeq;
    }
    if (opts?.expectOk) {
      assert.equal(
        res.status,
        201,
        `Expected 201 for ${String(payload.type)}, got ${res.status}: ${JSON.stringify(body)}`
      );
    }
    return { status: res.status, body };
  };
}

describe('T06 — Air & Naval Branches, Army Stack/Split, Deterministic AI Commander & Rate Limiting', () => {
  it('enforces coastal ports, airbases, fighter 14s direct flight & 2.0° airstrike with AA flak, corvette sea-lane & 1.5° naval gunfire, and fog redaction', async () => {
    const clock = new ManualClock(1_762_000_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    const haNoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!;
    const haiPhong = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hải Phòng')!;
    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;
    const konTum = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Kon Tum')!;
    const pleiku = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Pleiku')!;

    try {
      const north = await registerUser(baseUrl, 't06_air_n', 'Bắc Không Hải');
      const south = await registerUser(baseUrl, 't06_air_s', 'Nam Phòng Thủ');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

      // 1. Coastal enforcement: building port in inland Hà Nội MUST reject 422
      const badInlandPort = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: haNoi.cityId,
        projectKey: 'port',
      });
      assert.equal(badInlandPort.status, 422);

      // 2. North builds office + airbase + port at coastal Đà Nẵng; researches fighter & corvette
      // South builds office at Kon Tum (1.73° from Đà Nẵng -> inside 2.0° fighter airstrike!) and Quảng Ngãi (1.08° -> inside 1.5° naval!)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'fighter' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: konTum.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      clock.advanceByMs(60_000);
      runtime.scheduler.runCatchUpCycle();

      // Mobilizing fighter before airbase must reject 422
      const badFighterNoAirbase = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNang.cityId,
        projectKey: 'fighter',
      });
      assert.equal(badFighterNoAirbase.status, 422);

      // Build airbase at Đà Nẵng (65s) + research corvette (60s) + South mobilizes reserves at Kon Tum & Quảng Ngãi
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'airbase' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'corvette' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: konTum.cityId, projectKey: 'reserve' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'reserve' },
        { expectOk: true }
      );
      clock.advanceByMs(65_000);
      runtime.scheduler.runCatchUpCycle();

      // Build port at coastal Đà Nẵng (65s) + mobilize fighter (60s) simultaneously!
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'port' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'fighter' },
        { expectOk: true }
      );
      clock.advanceByMs(65_000);
      runtime.scheduler.runCatchUpCycle();

      // Mobilize corvette at Đà Nẵng (65s)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'corvette' },
        { expectOk: true }
      );
      clock.advanceByMs(65_000);
      runtime.scheduler.runCatchUpCycle();

      const csReady = store.getMatch(matchId)!.state.campaignState!;
      const fighter = Object.values(csReady.units).find((u) => u.key === 'fighter')!;
      const corvette = Object.values(csReady.units).find((u) => u.key === 'corvette')!;
      assert.ok(fighter && corvette);

      // Fog redaction check: South sees airbase=0, port=0 on North's Đà Nẵng
      const southView = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as {
        match: { campaignState: { cities: Record<string, { airbase: number; port: number }> } };
      };
      assert.equal(southView.match.campaignState.cities[daNang.cityId].airbase, 0);
      assert.equal(southView.match.campaignState.cities[daNang.cityId].port, 0);

      // 3. Corvette cannot sail to inland Hà Nội (422), CAN sail offshore to coastal Hải Phòng (28s, 5 sea waypoints)
      const badNavalMove = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: corvette.unitId,
        toCityId: haNoi.cityId,
        expectedRev: corvette.rev,
      });
      assert.equal(badNavalMove.status, 422);

      // Declare WAR -> Fighter airstrikes & Corvette naval bombards immediately!
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_SET_DIPLOMACY',
          nationId: WORLD_NATIONS.north,
          targetNationId: WORLD_NATIONS.south,
          action: 'DECLARE_WAR',
        },
        { expectOk: true }
      );

      const csWar = store.getMatch(matchId)!.state.campaignState!;
      const airReport = csWar.battleReports.find((r) => r.kind === 'AIRSTRIKE');
      const navalReport = csWar.battleReports.find((r) => r.kind === 'BOMBARDMENT');
      assert.ok(airReport, 'Fighter must execute AIRSTRIKE on observed enemy within 2.0°');
      assert.ok(airReport.damageToDefenders > 0);
      assert.ok(airReport.damageToAttackers >= 1, 'Fighter airstrike should take reduced AA flak damage');
      assert.ok(navalReport, 'Corvette must execute naval BOMBARDMENT on Quảng Ngãi within 1.5°');
      assert.equal(navalReport.damageToAttackers, 0, 'Corvette naval gunfire takes 0 counter-damage');

      // 4. Test Fighter 14s straight-line flight & Corvette 28s coastal sea lane
      const curFighter = csWar.units[fighter.unitId];
      const curCorvette = csWar.units[corvette.unitId];
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: curFighter.unitId,
          toCityId: haNoi.cityId,
          expectedRev: curFighter.rev,
        },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: curCorvette.unitId,
          toCityId: haiPhong.cityId,
          expectedRev: curCorvette.rev,
        },
        { expectOk: true }
      );

      const csMoving = store.getMatch(matchId)!.state.campaignState!;
      const fTrip = csMoving.units[fighter.unitId].trip!;
      const cTrip = csMoving.units[corvette.unitId].trip!;
      assert.equal(fTrip.endUtc - fTrip.startUtc, CAMPAIGN_UNIT_STATS.fighter.moveSeconds * 1000);
      assert.equal(fTrip.points.length, 2, 'Fighter flies straight-line geodesic path');
      assert.equal(cTrip.endUtc - cTrip.startUtc, CAMPAIGN_UNIT_STATS.corvette.moveSeconds * 1000);
      assert.equal(cTrip.points.length, 5, 'Corvette sails offshore coastal corridor');

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('merges co-located units into an Army Stack, synchronizes march speed to slowest member, halts atomically, and splits cleanly', async () => {
    const clock = new ManualClock(1_762_100_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const hue = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Huế')!;

    try {
      const north = await registerUser(baseUrl, 't06_stk_n', 'Bắc Đạo Quân');
      const south = await registerUser(baseUrl, 't06_stk_s', 'Nam Đạo Quân');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

      // Build office + base at Đà Nẵng, research recon, mobilize reserve (45s) + recon (22s)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'recon' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      clock.advanceByMs(45_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'reserve' },
        { expectOk: true }
      );
      clock.advanceByMs(55_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'recon' },
        { expectOk: true }
      );
      clock.advanceByMs(45_000);
      runtime.scheduler.runCatchUpCycle();

      const unitsNow = Object.values(store.getMatch(matchId)!.state.campaignState!.units);
      const reserveUnit = unitsNow.find((u) => u.key === 'reserve')!;
      const reconUnit = unitsNow.find((u) => u.key === 'recon')!;
      assert.ok(reserveUnit && reconUnit);

      // Merging < 2 units rejected 422
      const badMerge = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_GROUP_UNITS',
        nationId: WORLD_NATIONS.north,
        action: 'MERGE',
        unitIds: [reserveUnit.unitId],
      });
      assert.equal(badMerge.status, 422);

      // South attempting to merge North's units rejected 403
      const hijackMerge = await sendCmd(south.token, WORLD_ACTORS.south, {
        type: 'CAMPAIGN_GROUP_UNITS',
        nationId: WORLD_NATIONS.south,
        action: 'MERGE',
        unitIds: [reserveUnit.unitId, reconUnit.unitId],
      });
      assert.equal(hijackMerge.status, 403);

      // Merge reserve (45s) + recon (22s) into stack
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_GROUP_UNITS',
          nationId: WORLD_NATIONS.north,
          action: 'MERGE',
          unitIds: [reserveUnit.unitId, reconUnit.unitId],
        },
        { expectOk: true }
      );
      const stackId = store.getMatch(matchId)!.state.campaignState!.units[reserveUnit.unitId].stackId!;
      assert.ok(stackId && stackId.startsWith('stk_'));
      assert.equal(
        store.getMatch(matchId)!.state.campaignState!.units[reconUnit.unitId].stackId,
        stackId
      );

      // MOVE_STACK to Huế -> both march at slowest member speed (45s, NOT 22s!)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_GROUP_UNITS',
          nationId: WORLD_NATIONS.north,
          action: 'MOVE_STACK',
          stackId,
          toCityId: hue.cityId,
        },
        { expectOk: true }
      );
      const csStacked = store.getMatch(matchId)!.state.campaignState!;
      const tRes = csStacked.units[reserveUnit.unitId].trip!;
      const tRec = csStacked.units[reconUnit.unitId].trip!;
      assert.equal(tRes.endUtc - tRes.startUtc, 45_000);
      assert.equal(tRec.endUtc - tRec.startUtc, 45_000);
      assert.equal(tRes.endUtc, tRec.endUtc);

      // Halt stack mid-way (+10s) -> both stop at exact same position!
      clock.advanceByMs(10_000);
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_GROUP_UNITS',
          nationId: WORLD_NATIONS.north,
          action: 'MOVE_STACK',
          stackId,
          toCityId: null,
        },
        { expectOk: true }
      );
      const csHalted = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csHalted.units[reserveUnit.unitId].trip, null);
      assert.equal(csHalted.units[reconUnit.unitId].trip, null);
      assert.deepEqual(
        csHalted.units[reserveUnit.unitId].position,
        csHalted.units[reconUnit.unitId].position
      );

      // SPLIT recon out -> singleton cleanup clears stackId on BOTH units!
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_GROUP_UNITS',
          nationId: WORLD_NATIONS.north,
          action: 'SPLIT',
          unitIds: [reconUnit.unitId],
        },
        { expectOk: true }
      );
      const csSplit = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csSplit.units[reconUnit.unitId].stackId, null);
      assert.equal(csSplit.units[reserveUnit.unitId].stackId, null);

      // Individual recon move now resumes 22s speed
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: reconUnit.unitId,
          toCityId: hue.cityId,
          expectedRev: csSplit.units[reconUnit.unitId].rev,
        },
        { expectOk: true }
      );
      const reconSoloTrip = store.getMatch(matchId)!.state.campaignState!.units[reconUnit.unitId].trip!;
      assert.equal(reconSoloTrip.endUtc - reconSoloTrip.startUtc, 22_000);

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('runs deterministic AI Commander (aiOpponent: true) through research, build, mobilization, war declaration & assault with restart + 100% replay verification', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-t06-ai-'));
    const dbPath = path.join(tmpDir, 'ai-match.sqlite');
    const clock = new ManualClock(1_762_200_000_000);
    let matchId!: MatchId;

    try {
      const { runtime, baseUrl, store } = await startTestRuntime({ dbPath, clock });
      try {
        const player = await registerUser(baseUrl, 't06_solo_ai', 'Chỉ huy Đấu Máy');
        const createRes = await fetch(`${baseUrl}/api/rooms`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${player.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Chiến dịch vs AI',
            preferredSlot: 'NORTH',
            scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
            aiOpponent: true,
          }),
        });
        assert.equal(createRes.status, 201);
        const created = (await createRes.json()) as {
          room: {
            matchId: MatchId;
            status: string;
            slots: { SOUTH: { displayName: string; ready: boolean } };
          };
          match: { campaignState: { aiControlledNationId: string | null } };
        };
        matchId = created.room.matchId;
        assert.equal(created.room.status, 'ACTIVE', 'AI room must start ACTIVE immediately');
        assert.equal(created.room.slots.SOUTH.displayName, 'Bộ Tư Lệnh Máy (AI)');
        assert.equal(created.match.campaignState.aiControlledNationId, WORLD_NATIONS.south);

        // Advance clock across 14 deterministic AI decision intervals (280s)
        for (let step = 0; step < 14; step += 1) {
          clock.advanceByMs(CAMPAIGN_AI_DECISION_INTERVAL_MS);
          runtime.scheduler.runCatchUpCycle();
        }

        const csAfterAi = store.getMatch(matchId)!.state.campaignState!;
        const aiNation = csAfterAi.nations[WORLD_NATIONS.south];
        assert.ok(aiNation.learned.includes('motor'), 'AI must autonomously research motor I');
        assert.ok(aiNation.stats.unitsMobilized >= 2, 'AI must autonomously build office & mobilize >= 2 units');
        assert.equal(csAfterAi.diplomacy?.relation, 'WAR', 'AI must declare WAR once combat units are ready');
        assert.ok(
          Object.values(csAfterAi.units).some(
            (u) => u.ownerNationId === WORLD_NATIONS.south && (u.trip !== null || csAfterAi.nations[WORLD_NATIONS.south].stats.citiesCaptured > 0)
          ),
          'AI units must actively march toward/capture North border cities'
        );
      } finally {
        await runtime.close();
        store.close();
      }

      // Reopen SQLite from disk and verify deterministic replay SHA-256 matches 100%!
      const reopened = new SqliteMatchStore(dbPath);
      try {
        const replay = reopened.verifyMatchReplay(matchId);
        assert.ok(replay);
        assert.equal(replay.verified, true);
        assert.equal(replay.replayedHash, replay.storedHash);
      } finally {
        reopened.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('enforces HTTP auth/command rate limits (429 + Retry-After) and WebSocket frame rate limits cleanly', async () => {
    const clock = new ManualClock(1_762_300_000_000);
    const { runtime, baseUrl, wsUrl, store } = await startTestRuntime({
      clock,
      rateLimits: { authMaxPerMin: 3, commandMaxPerMin: 2, wsMaxPer10s: 2 },
    });

    try {
      // 1. Auth rate limit: 2 registrations + 1 login = 3 allowed; 4th returns 429 RATE_LIMITED
      const north = await registerUser(baseUrl, 'rl_north', 'RL Bắc');
      const south = await registerUser(baseUrl, 'rl_south', 'RL Nam');
      const loginOk = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rl_north', password: 'SecurePass123!' }),
      });
      assert.equal(loginOk.status, 200);

      const loginBlocked = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rl_north', password: 'SecurePass123!' }),
      });
      assert.equal(loginBlocked.status, 429);
      assert.ok(Number(loginBlocked.headers.get('retry-after')) >= 1);
      const rlBody = (await loginBlocked.json()) as { code: string };
      assert.equal(rlBody.code, 'RATE_LIMITED');

      // Advance clock > 60s -> auth window resets
      clock.advanceByMs(61_000);
      const loginAfterWindow = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rl_north', password: 'SecurePass123!' }),
      });
      assert.equal(loginAfterWindow.status, 200);

      // 2. Room command rate limit: 2 commands allowed, 3rd returns 429
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);
      const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
      const haNoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!;

      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: haNoi.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      const thirdCmd = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'motor',
      });
      assert.equal(thirdCmd.status, 429);
      assert.equal(thirdCmd.body.code, 'RATE_LIMITED');

      // 3. WebSocket burst rate limit: 2 pings allowed, 3rd returns room:error RATE_LIMITED
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => ws.once('open', resolve));
      const frames: Array<Record<string, unknown>> = [];
      ws.on('message', (raw) => frames.push(JSON.parse(String(raw)) as Record<string, unknown>));

      ws.send(JSON.stringify({ type: 'ping', clientTs: 1 }));
      ws.send(JSON.stringify({ type: 'ping', clientTs: 2 }));
      ws.send(JSON.stringify({ type: 'ping', clientTs: 3 }));

      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      assert.ok(
        frames.some((f) => f.type === 'room:error' && f.code === 'RATE_LIMITED'),
        '3rd WS frame inside 10s window must return room:error RATE_LIMITED'
      );
      ws.close();
    } finally {
      await runtime.close();
      store.close();
    }
  });
});
