import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  CAMPAIGN_MORALE_TICK_MS,
  CONTRACT_SCHEMA_VERSION,
  MatchId,
} from '../contracts';
import {
  VIETNAM_CAMPAIGN_CITY_BY_NAME,
  VIETNAM_CAMPAIGN_SCENARIO_ID,
} from '../content/vietnamCampaignScenario';
import { WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import {
  CAMPAIGN_UNIT_STATS,
  computeCampaignCityOutput,
  ManualClock,
} from '../simulation';
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
  store: SqliteMatchStore;
}> {
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: options?.dbPath ?? ':memory:',
  });
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const clock = options?.clock ?? new ManualClock(1_763_000_000_000);
  const runtime = createServerRuntime(config, store, clock, options?.rateLimits);

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
  title = 'Chiến dịch T07 Test'
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
        commandId: `cmd_t07_${matchId}_${cmdCounter}`,
        matchId,
        actorId,
        idempotencyKey: `idem_t07_${matchId}_${cmdCounter}`,
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

describe('T07 — City Morale & Uprisings, SAM AA, Stealth Submarines, Leaderboard, Metrics, Hot Backup & Stress/Soak', () => {
  it('throttles conquered city output at low morale, stabilizes with garrison, and triggers partisan uprising when left undefended', async () => {
    const clock = new ManualClock(1_763_000_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;

    try {
      const north = await registerUser(baseUrl, 't07_mor_n', 'Bắc Tinh Thần');
      const south = await registerUser(baseUrl, 't07_mor_s', 'Nam Tinh Thần');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

      // Build office + research motor + mobilize motor at Đà Nẵng
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' },
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
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'motor' },
        { expectOk: true }
      );
      clock.advanceByMs(50_000);
      runtime.scheduler.runCatchUpCycle();

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

      const motor = Object.values(store.getMatch(matchId)!.state.campaignState!.units)[0];
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: motor.unitId,
          toCityId: quangNgai.cityId,
          expectedRev: motor.rev,
        },
        { expectOk: true }
      );
      clock.advanceByMs(CAMPAIGN_UNIT_STATS.motor.moveSeconds * 1000);
      runtime.scheduler.runCatchUpCycle();

      // Captured Quảng Ngãi starts occupied with morale = 35 -> throttled to 80% output!
      const occupiedQn = store.getMatch(matchId)!.state.campaignState!.cities[quangNgai.cityId];
      assert.equal(occupiedQn.ownerNationId, WORLD_NATIONS.north);
      assert.equal(occupiedQn.morale, 35);
      const outLow = computeCampaignCityOutput(occupiedQn);
      assert.equal(outLow[occupiedQn.material], 8, 'Morale 35% must throttle base output 10 -> 8 (80%)');

      // Keep motor garrisoned for 1 morale tick (60s) -> morale stabilizes 35 -> 43 (+8)
      clock.advanceByMs(CAMPAIGN_MORALE_TICK_MS);
      runtime.scheduler.runCatchUpCycle();
      assert.equal(
        store.getMatch(matchId)!.state.campaignState!.cities[quangNgai.cityId].morale,
        43
      );

      // Withdraw motor back to Đà Nẵng leaving Quảng Ngãi undefended at morale 43 (< 50)
      const curMotor = store.getMatch(matchId)!.state.campaignState!.units[motor.unitId];
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: curMotor.unitId,
          toCityId: daNang.cityId,
          expectedRev: curMotor.rev,
        },
        { expectOk: true }
      );

      // Advance 5 morale ticks (43 -> 38 -> 33 -> 28 -> 23 -> 18 <= 20) -> Partisan Uprising!
      for (let i = 0; i < 5; i += 1) {
        clock.advanceByMs(CAMPAIGN_MORALE_TICK_MS);
        runtime.scheduler.runCatchUpCycle();
      }

      const stAfterRevolt = store.getMatch(matchId)!.state;
      const qnAfterRevolt = stAfterRevolt.campaignState!.cities[quangNgai.cityId];
      assert.equal(qnAfterRevolt.ownerNationId, WORLD_NATIONS.south, 'Undefended low-morale city must revolt back');
      assert.equal(stAfterRevolt.regions[quangNgai.cityId].controllerNationId, WORLD_NATIONS.south);
      assert.equal(qnAfterRevolt.morale, 50);
      assert.equal(stAfterRevolt.campaignState!.victoryPointsByNation[WORLD_NATIONS.north], 320);
      assert.equal(stAfterRevolt.campaignState!.victoryPointsByNation[WORLD_NATIONS.south], 320);
      assert.ok(
        stAfterRevolt.events.some((e) => e.payload.type === 'CAMPAIGN_CITY_UPRISING'),
        'Partisan uprising must emit CAMPAIGN_CITY_UPRISING event'
      );

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('enforces SAM anti-air interception (+6 AA flak & 14 AA ranged) and Submarine stealth fog-of-war & anti-ship torpedo priority', async () => {
    const clock = new ManualClock(1_763_100_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;

    try {
      const north = await registerUser(baseUrl, 't07_sam_n', 'Bắc Phòng Không');
      const south = await registerUser(baseUrl, 't07_sam_s', 'Nam Không Hải');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

      // North researches motor -> artillery -> sam, and corvette -> submarine; builds office + base Lv2 + port Lv2 at Đà Nẵng
      // South researches fighter & corvette; builds office + airbase Lv1 + port Lv1 at Quảng Ngãi
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' }, { expectOk: true });
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'office' }, { expectOk: true });
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'fighter' }, { expectOk: true });
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'office' }, { expectOk: true });
      clock.advanceByMs(60_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'artillery' }, { expectOk: true });
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' }, { expectOk: true });
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'corvette' }, { expectOk: true });
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'airbase' }, { expectOk: true });
      clock.advanceByMs(65_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'sam' }, { expectOk: true });
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' }, { expectOk: true }); // Base Lv2 (110s)
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'port' }, { expectOk: true });
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'fighter' }, { expectOk: true });
      clock.advanceByMs(110_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'corvette' }, { expectOk: true });
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'port' }, { expectOk: true }); // Port Lv1 (65s)
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'sam' }, { expectOk: true }); // SAM (65s)
      await sendCmd(south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'corvette' }, { expectOk: true });
      clock.advanceByMs(65_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'submarine' }, { expectOk: true });
      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'port' }, { expectOk: true }); // Port Lv2 (130s)
      clock.advanceByMs(130_000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'submarine' }, { expectOk: true }); // Sub (70s)
      clock.advanceByMs(70_000);
      runtime.scheduler.runCatchUpCycle();

      const csPreWar = store.getMatch(matchId)!.state.campaignState!;
      const northSam = Object.values(csPreWar.units).find((u) => u.key === 'sam')!;
      const northSub = Object.values(csPreWar.units).find((u) => u.key === 'submarine')!;
      const southFighter = Object.values(csPreWar.units).find((u) => u.key === 'fighter')!;
      const southCorvette = Object.values(csPreWar.units).find((u) => u.key === 'corvette')!;
      assert.ok(northSam && northSub && southFighter && southCorvette);

      // Stealth check: Đà Nẵng is 1.08° from Quảng Ngãi (> 1.0° sub detection range, <= 1.25° normal sight).
      // South MUST see North's SAM, but MUST NOT see North's stealth Submarine before it fires!
      const southPreWarSnap = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as { match: { campaignState: { units: Record<string, unknown> } } };
      assert.ok(southPreWarSnap.match.campaignState.units[northSam.unitId], 'Non-stealth SAM at 1.08° is visible');
      assert.equal(
        southPreWarSnap.match.campaignState.units[northSub.unitId],
        undefined,
        'Stealth Submarine > 1.0° from detectors must stay hidden in fog-of-war'
      );

      // Declare WAR -> SAM engages South Fighter with 14 AA damage, Submarine torpedoes South Corvette (14 hardAttack)!
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
      const fighterReport = csWar.battleReports.find((r) => r.attackerUnitIds.includes(southFighter.unitId));
      const corvetteReport = csWar.battleReports.find((r) => r.attackerUnitIds.includes(southCorvette.unitId));
      const samReport = csWar.battleReports.find((r) => r.attackerUnitIds.includes(northSam.unitId));
      const subReport = csWar.battleReports.find((r) => r.attackerUnitIds.includes(northSub.unitId));

      assert.ok(fighterReport, 'South Fighter conducts opening airstrike on Đà Nẵng');
      assert.ok(
        fighterReport.damageToAttackers >= 7,
        `Friendly SAM within 1.6° must add +6 AA flak interception (got ${fighterReport.damageToAttackers})`
      );
      if (corvetteReport) {
        assert.ok(
          !corvetteReport.defenderUnitIds.includes(northSub.unitId),
          'Enemy Corvette cannot target stealth Submarine before it reveals itself'
        );
      }

      assert.ok(samReport, 'SAM must fire anti-air missile at South Fighter');
      assert.deepEqual(samReport.defenderUnitIds, [southFighter.unitId]);
      assert.equal(
        samReport.damageToDefenders,
        9,
        'SAM (20/28 HP = 71% after opening airstrike) deals floor(14 * 71 * 95 / 10000) = 9 AA damage'
      );
      assert.equal(samReport.damageToAttackers, 0);

      assert.ok(subReport, 'Submarine must torpedo South Corvette');
      assert.deepEqual(subReport.defenderUnitIds, [southCorvette.unitId]);
      assert.equal(
        subReport.damageToDefenders,
        13,
        'Submarine prioritizes Naval unit with 14 hardAttack (floor(14 * 95 / 100) = 13 vs airbase Lv1)'
      );
      assert.equal(subReport.damageToAttackers, 0);

      // After firing, Submarine briefly reveals itself on radar (within 15s window)
      const southPostFireSnap = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as { match: { campaignState: { units: Record<string, unknown> } } };
      assert.ok(
        southPostFireSnap.match.campaignState.units[northSub.unitId],
        'Submarine reveals itself briefly for 15s after firing torpedoes'
      );

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('serves accurate Leaderboard & Operational Metrics and verifies live SQLite VACUUM INTO hot backup with replay integrity', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-t07-ops-'));
    const dbPath = path.join(tmpDir, 'live.sqlite');
    const backupPath = path.join(tmpDir, 'hot-backup.sqlite');
    const clock = new ManualClock(1_763_200_000_000);

    try {
      const { runtime, baseUrl, store } = await startTestRuntime({ dbPath, clock });
      try {
        const north = await registerUser(baseUrl, 't07_champ', 'Tướng Quân Bắc');
        const south = await registerUser(baseUrl, 't07_rival', 'Chỉ huy Nam');
        const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token, 'Trận Xếp Hạng');
        const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

        // Execute 1 command + surrender by South so North scores a clean win
        await sendCmd(
          north.token,
          WORLD_ACTORS.north,
          { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' },
          { expectOk: true }
        );
        const surrRes = await fetch(`${baseUrl}/api/rooms/${matchId}/surrender`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${south.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        assert.equal(surrRes.status, 200);

        // 1. Verify /api/leaderboard
        const lbRes = await fetch(`${baseUrl}/api/leaderboard`);
        assert.equal(lbRes.status, 200);
        const lbBody = (await lbRes.json()) as {
          ok: boolean;
          leaderboard: Array<{ username: string; wins: number; losses: number; winRatePct: number }>;
        };
        assert.equal(lbBody.ok, true);
        assert.equal(lbBody.leaderboard[0].username, 't07_champ');
        assert.equal(lbBody.leaderboard[0].wins, 1);
        assert.equal(lbBody.leaderboard[0].winRatePct, 100);
        assert.equal(lbBody.leaderboard[1].username, 't07_rival');
        assert.equal(lbBody.leaderboard[1].losses, 1);

        // 2. Verify /api/metrics
        clock.advanceByMs(5_000);
        const metRes = await fetch(`${baseUrl}/api/metrics`);
        assert.equal(metRes.status, 200);
        const metBody = (await metRes.json()) as {
          ok: boolean;
          metrics: {
            uptimeMs: number;
            commandsProcessed: number;
            memoryRssMb: number;
            database: { walMode: boolean; endedRooms: number; totalUsers: number; dbSizeBytes: number };
          };
        };
        assert.equal(metBody.ok, true);
        assert.equal(metBody.metrics.uptimeMs, 5_000);
        assert.ok(metBody.metrics.commandsProcessed >= 1);
        assert.equal(metBody.metrics.database.walMode, true);
        assert.equal(metBody.metrics.database.endedRooms, 1);
        assert.equal(metBody.metrics.database.totalUsers, 2);
        assert.ok(metBody.metrics.database.dbSizeBytes > 0);
        assert.ok(metBody.metrics.memoryRssMb > 0);

        // 3. Hot SQLite backup WHILE server is live -> verify integrity_check & replay hash!
        const backup = store.hotBackupToFile(backupPath);
        assert.equal(backup.integrityOk, true);
        assert.ok(backup.sizeBytes > 0);

        const verifyStore = new SqliteMatchStore(backupPath);
        try {
          const replay = verifyStore.verifyMatchReplay(matchId);
          assert.ok(replay);
          assert.equal(replay.verified, true);
          assert.equal(replay.replayedHash, replay.storedHash);
        } finally {
          verifyStore.close();
        }
      } finally {
        await runtime.close();
        store.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles 12 simultaneous active rooms with concurrent commands on a single WAL SQLite store without errors or replay drift', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-t07-stress-'));
    const dbPath = path.join(tmpDir, 'stress.sqlite');
    const clock = new ManualClock(1_763_300_000_000);
    const ROOM_COUNT = 12;

    try {
      const { runtime, baseUrl, store } = await startTestRuntime({
        dbPath,
        clock,
        rateLimits: { authMaxPerMin: 500, commandMaxPerMin: 1000, wsMaxPer10s: 500 },
      });
      try {
        const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
        const haNoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!;
        const haiPhong = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hải Phòng')!;
        const rooms: Array<{
          matchId: MatchId;
          token: string;
          sendCmd: ReturnType<typeof makeCommandSender>;
        }> = [];

        // Launch 12 simultaneous active AI rooms
        for (let i = 0; i < ROOM_COUNT; i += 1) {
          const u = await registerUser(baseUrl, `stress_u_${i}`, `Chỉ huy ${i}`);
          const res = await fetch(`${baseUrl}/api/rooms`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `Stress Room #${i}`,
              preferredSlot: 'NORTH',
              scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
              aiOpponent: true,
            }),
          });
          assert.equal(res.status, 201);
          const body = (await res.json()) as { room: { matchId: MatchId } };
          rooms.push({
            matchId: body.room.matchId,
            token: u.token,
            sendCmd: makeCommandSender(baseUrl, store, clock, body.room.matchId),
          });
        }

        // Fire 4 rounds of concurrent commands across ALL 12 rooms (48 parallel player commands + AI catch-ups)
        const roundPayloads: Array<Record<string, unknown>> = [
          { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' },
          { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'office' },
          { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: haNoi.cityId, projectKey: 'factory' },
          { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: haiPhong.cityId, projectKey: 'port' },
        ];

        for (const payload of roundPayloads) {
          const results = await Promise.all(
            rooms.map((r) => r.sendCmd(r.token, WORLD_ACTORS.north, payload))
          );
          for (const res of results) {
            assert.equal(res.status, 201, `Concurrent room command failed: ${JSON.stringify(res.body)}`);
          }
          clock.advanceByMs(20_000);
          runtime.scheduler.runCatchUpCycle();
        }

        const metricsRes = (await (await fetch(`${baseUrl}/api/metrics`)).json()) as {
          metrics: { commandsProcessed: number; commandsRejected: number; database: { activeRooms: number } };
        };
        assert.equal(metricsRes.metrics.database.activeRooms, ROOM_COUNT);
        assert.equal(metricsRes.metrics.commandsProcessed, ROOM_COUNT * roundPayloads.length);
        assert.equal(metricsRes.metrics.commandsRejected, 0);

        // Verify 100% deterministic replay SHA-256 across ALL 12 rooms!
        for (const r of rooms) {
          const replay = store.verifyMatchReplay(r.matchId);
          assert.ok(replay);
          assert.equal(replay.verified, true, `Replay mismatch on stress room ${r.matchId}`);
        }
      } finally {
        await runtime.close();
        store.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('survives extended multi-day (72h) deterministic AI campaign soak test with bounded logs and 100% replay verification', async () => {
    const clock = new ManualClock(1_763_400_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    try {
      const player = await registerUser(baseUrl, 'soak_player', 'Chỉ huy Soak');
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${player.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Soak Test 72h',
          preferredSlot: 'NORTH',
          scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
          aiOpponent: true,
        }),
      });
      assert.equal(res.status, 201);
      const { room } = (await res.json()) as { room: { matchId: MatchId } };

      // Advance across 72 in-game hours (3 full days) in 15-minute deterministic scheduler steps (288 steps)
      // Stopping early cleanly if AI achieves Victory Points or Total Conquest!
      const STEP_MS = 15 * 60 * 1000;
      for (let i = 0; i < 288; i += 1) {
        if (store.getRoomRow(room.matchId)?.status !== 'ACTIVE') break;
        clock.advanceByMs(STEP_MS);
        runtime.scheduler.runCatchUpCycle();
      }

      const finalMatch = store.getMatch(room.matchId)!;
      const cs = finalMatch.state.campaignState!;
      assert.ok(cs.log.length <= 200, 'Campaign log must stay capped at <= 200');
      assert.ok(cs.news.length <= 120, 'Campaign news must stay capped at <= 120');
      assert.ok(cs.battleReports.length <= 100, 'Battle reports must stay capped at <= 100');
      assert.ok(cs.nations[WORLD_NATIONS.south].stats.unitsMobilized >= 2);
      assert.equal(cs.diplomacy?.relation, 'WAR');

      const replay = store.verifyMatchReplay(room.matchId);
      assert.ok(replay);
      assert.equal(replay.verified, true);
      assert.equal(replay.replayedHash, replay.storedHash);
    } finally {
      await runtime.close();
      store.close();
    }
  });
});
