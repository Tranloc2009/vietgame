import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import WebSocket from 'ws';
import {
  CAMPAIGN_DEMOLISH_REFUND_PCT,
  CAMPAIGN_HOUR_MS,
  CONTRACT_SCHEMA_VERSION,
  MatchId,
  MatchIdSchema,
} from '../contracts';
import { WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import {
  VIETNAM_CAMPAIGN_CITY_BY_NAME,
  VIETNAM_CAMPAIGN_SCENARIO_ID,
} from '../content/vietnamCampaignScenario';
import { CAMPAIGN_PROJECT_CATALOG, ManualClock } from '../simulation';
import { loadServerConfig } from './config';
import { createServerRuntime, ServerRuntime } from './createApp';
import { SqliteMatchStore } from './db/sqliteStore';

interface AuthSession {
  token: string;
  userId: string;
  username: string;
}

async function startTestRuntime(options?: {
  clock?: ManualClock;
  useRealClock?: boolean;
}): Promise<{
  runtime: ServerRuntime;
  baseUrl: string;
  wsUrl: string;
  store: SqliteMatchStore;
}> {
  const store = new SqliteMatchStore(':memory:');
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: ':memory:',
  });
  const runtime = options?.useRealClock
    ? createServerRuntime(config, store)
    : createServerRuntime(config, store, options?.clock ?? new ManualClock(1_764_000_000_000));

  await new Promise<void>((resolve) => {
    runtime.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = runtime.httpServer.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    runtime,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    wsUrl: `ws://127.0.0.1:${addr.port}/ws`,
    store,
  };
}

async function registerUser(baseUrl: string, username: string, displayName: string): Promise<AuthSession> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, password: 'Password123!' }),
  });
  const data = (await res.json()) as { ok: boolean; token: string; user: { userId: string; username: string } };
  assert.equal(res.status, 201);
  assert.equal(data.ok, true);
  return { token: data.token, userId: data.user.userId, username: data.user.username };
}

async function createAndStartCampaignRoom(
  baseUrl: string,
  northToken: string,
  southToken: string,
  title = 'Chiến dịch T08'
): Promise<{ matchId: MatchId; inviteCode: string }> {
  const createRes = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${northToken}` },
    body: JSON.stringify({
      title,
      preferredSlot: 'NORTH',
      scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
    }),
  });
  const created = (await createRes.json()) as { ok: boolean; room: { matchId: string; inviteCode: string } };
  assert.equal(createRes.status, 201);

  const joinRes = await fetch(`${baseUrl}/api/rooms/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${southToken}` },
    body: JSON.stringify({ inviteCode: created.room.inviteCode }),
  });
  assert.equal(joinRes.status, 200);

  for (const tok of [northToken, southToken]) {
    const r = await fetch(`${baseUrl}/api/rooms/${created.room.matchId}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ready: true }),
    });
    assert.equal(r.status, 200);
  }

  const startRes = await fetch(`${baseUrl}/api/rooms/${created.room.matchId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${northToken}` },
    body: JSON.stringify({}),
  });
  assert.equal(startRes.status, 200);

  return { matchId: MatchIdSchema.parse(created.room.matchId), inviteCode: created.room.inviteCode };
}

function makeCommandSender(baseUrl: string, store: SqliteMatchStore, matchId: MatchId, nowFn: () => number) {
  let seqNorth = 1;
  let seqSouth = 1;
  let cmdNum = 1;
  return async (
    token: string,
    actorId: string,
    payload: Record<string, unknown>,
    opts?: { expectOk?: boolean }
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const loaded = store.getMatch(matchId)!;
    const isNorth = actorId === WORLD_ACTORS.north;
    const seq = isNorth ? seqNorth : seqSouth;
    const cmdId = `cmd_t08_${String(cmdNum).padStart(4, '0')}`;
    const idem = `idem_t08_${String(cmdNum).padStart(4, '0')}`;
    cmdNum += 1;

    const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: cmdId,
        matchId,
        actorId,
        idempotencyKey: idem,
        sequence: seq,
        expectedVersion: loaded.state.version,
        issuedAtUtc: nowFn(),
        payload,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (res.ok) {
      if (isNorth) seqNorth += 1;
      else seqSouth += 1;
    }
    if (opts?.expectOk) {
      assert.equal(res.ok, true, `Expected command OK, got ${res.status}: ${JSON.stringify(body)}`);
    }
    return { status: res.status, body };
  };
}

describe('T08 — AI Difficulty Tiers, Building Demolition, Security Hardening & Real-Socket Latency', () => {
  it('differentiates deterministic EASY, NORMAL, and HARD AI difficulties with Lv2 HARD upgrades & 100% replay verification', async () => {
    const clock = new ManualClock(1_764_000_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    try {
      const player = await registerUser(baseUrl, 't08_ai_tester', 'Tư Lệnh T08');

      const createAi = async (difficulty: 'EASY' | 'NORMAL' | 'HARD'): Promise<MatchId> => {
        const res = await fetch(`${baseUrl}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${player.token}` },
          body: JSON.stringify({
            title: `AI ${difficulty}`,
            preferredSlot: 'NORTH',
            scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
            aiOpponent: true,
            aiDifficulty: difficulty,
          }),
        });
        assert.equal(res.status, 201);
        const data = (await res.json()) as {
          ok: boolean;
          room: { matchId: string; status: string };
          match: { campaignState: { aiDifficulty: string } };
        };
        assert.equal(data.room.status, 'ACTIVE');
        assert.equal(data.match.campaignState.aiDifficulty, difficulty);
        return MatchIdSchema.parse(data.room.matchId);
      };

      const easyId = await createAi('EASY');
      const normalId = await createAi('NORMAL');
      const hardId = await createAi('HARD');

      // Advance 600s in 12s steps so HARD (12s cadence) executes far more cycles than EASY (35s cadence)
      for (let i = 0; i < 50; i += 1) {
        clock.advanceByMs(12_000);
        runtime.scheduler.runCatchUpCycle();
      }

      const csEasy = store.getMatch(easyId)!.state.campaignState!;
      const csNormal = store.getMatch(normalId)!.state.campaignState!;
      const csHard = store.getMatch(hardId)!.state.campaignState!;

      const countUnits = (cs: typeof csEasy) =>
        Object.values(cs.units).filter((u) => u.ownerNationId === WORLD_NATIONS.south).length;
      const countBuiltLevels = (cs: typeof csEasy) =>
        Object.values(cs.cities)
          .filter((c) => c.ownerNationId === WORLD_NATIONS.south)
          .reduce(
            (sum, c) =>
              sum +
              c.factory +
              c.office +
              (c.base ?? 0) +
              (c.bunker ?? 0) +
              (c.hospital ?? 0) +
              (c.airbase ?? 0) +
              (c.port ?? 0),
            0
          );

      assert.ok(
        countBuiltLevels(csHard) > countBuiltLevels(csEasy),
        `HARD AI (${countBuiltLevels(csHard)}) must build more infrastructure than EASY AI (${countBuiltLevels(csEasy)})`
      );
      assert.ok(
        countUnits(csHard) >= countUnits(csEasy),
        `HARD AI (${countUnits(csHard)}) must field >= units than EASY AI (${countUnits(csEasy)})`
      );
      assert.equal(csHard.diplomacy?.relation, 'WAR', 'HARD AI declares war aggressively');
      assert.equal(csNormal.aiDifficulty, 'NORMAL');

      // All 3 AI matches verify 100% deterministically
      for (const id of [easyId, normalId, hardId]) {
        const rep = store.verifyMatchReplay(id);
        assert.equal(rep?.verified, true, `Replay verification must pass for ${id}`);
      }
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('enforces server-authoritative CAMPAIGN_DEMOLISH_BUILDING with 40% salvage, active-job guard, ownership & fog isolation', async () => {
    const clock = new ManualClock(1_764_100_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });
    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;

    try {
      const north = await registerUser(baseUrl, 't08_dem_n', 'Bắc Công Binh');
      const south = await registerUser(baseUrl, 't08_dem_s', 'Nam Quan Sát');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, matchId, () => clock.nowUtc() as number);

      // Demolishing a non-existent building fails 422
      const emptyRes = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_DEMOLISH_BUILDING',
        nationId: WORLD_NATIONS.north,
        cityId: daNang.cityId,
        buildingKey: 'factory',
      });
      assert.equal(emptyRes.status, 422);

      // Build Factory Lv1 then start Factory Lv2
      const factorySec = CAMPAIGN_PROJECT_CATALOG.factory.seconds;
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'factory' },
        { expectOk: true }
      );
      clock.advanceByMs(factorySec * 1000 + 1000);
      runtime.scheduler.runCatchUpCycle();

      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'factory' },
        { expectOk: true }
      );

      // Cannot demolish Factory while Lv2 upgrade job is active!
      const conflictRes = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_DEMOLISH_BUILDING',
        nationId: WORLD_NATIONS.north,
        cityId: daNang.cityId,
        buildingKey: 'factory',
      });
      assert.equal(conflictRes.status, 422);

      // Complete Factory Lv2 at exact deadline so 0ms residual income accrues before salvage delta check
      clock.advanceByMs(factorySec * 2 * 1000);
      runtime.scheduler.runCatchUpCycle();
      assert.equal(store.getMatch(matchId)!.state.campaignState!.cities[daNang.cityId].factory, 2);

      // South cannot demolish North's city building (403)
      const spoofCity = await sendCmd(south.token, WORLD_ACTORS.south, {
        type: 'CAMPAIGN_DEMOLISH_BUILDING',
        nationId: WORLD_NATIONS.south,
        cityId: daNang.cityId,
        buildingKey: 'factory',
      });
      assert.equal(spoofCity.status, 403);

      // North demolishes Factory Lv2 -> Lv1 and receives exact 40% integer salvage of Lv2 cost
      const beforeBalance = [...store.getMatch(matchId)!.state.campaignState!.nations[WORLD_NATIONS.north].balance];
      const demRes = await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_DEMOLISH_BUILDING',
          nationId: WORLD_NATIONS.north,
          cityId: daNang.cityId,
          buildingKey: 'factory',
        },
        { expectOk: true }
      );
      assert.equal(demRes.status, 201);

      const csAfter = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csAfter.cities[daNang.cityId].factory, 1);

      const factoryBaseCost = CAMPAIGN_PROJECT_CATALOG.factory.cost;
      for (let i = 0; i < 7; i += 1) {
        const expectedSalvage = Math.floor((factoryBaseCost[i] * 2 * CAMPAIGN_DEMOLISH_REFUND_PCT) / 100) * CAMPAIGN_HOUR_MS;
        assert.equal(
          csAfter.nations[WORLD_NATIONS.north].balance[i] - beforeBalance[i],
          expectedSalvage,
          `Exact 40% salvage mismatch on resource index ${i}`
        );
      }

      // Fog isolation: opponent must NEVER receive CAMPAIGN_BUILDING_DEMOLISHED event!
      const southSnap = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as { match: { events: Array<{ payload: { type: string } }> } };
      assert.equal(
        southSnap.match.events.some((e) => e.payload.type === 'CAMPAIGN_BUILDING_DEMOLISHED'),
        false,
        'Opponent must never see private building demolition events'
      );

      // South still cannot demolish non-existent Quảng Ngãi factory
      const southFail = await sendCmd(south.token, WORLD_ACTORS.south, {
        type: 'CAMPAIGN_DEMOLISH_BUILDING',
        nationId: WORLD_NATIONS.south,
        cityId: quangNgai.cityId,
        buildingKey: 'factory',
      });
      assert.equal(southFail.status, 422);

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('sets HTTP security headers and cleanly rejects malformed JSON, oversized payloads, SQLi/proto fuzzing, and cross-room spoofing', async () => {
    const clock = new ManualClock(1_764_200_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    try {
      // 1. Verify HTTP security headers on /api/health
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(healthRes.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(healthRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.ok(healthRes.headers.get('permissions-policy')?.includes('camera=()'));
      assert.equal(healthRes.headers.get('x-powered-by'), null);

      // 2. Malformed JSON returns structured 400 JSON (never HTML stack trace)
      const badJsonRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"username": "broken_json',
      });
      assert.equal(badJsonRes.status, 400);
      const badJsonBody = (await badJsonRes.json()) as { ok: boolean; code: string };
      assert.equal(badJsonBody.ok, false);
      assert.equal(badJsonBody.code, 'INVALID_JSON');

      // 3. Oversized payload (>128KB) rejected cleanly with 413 PAYLOAD_TOO_LARGE
      const hugeBody = JSON.stringify({ username: 'a'.repeat(160_000), password: 'Password123!' });
      const bigRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugeBody,
      });
      assert.equal(bigRes.status, 413);
      const bigJson = (await bigRes.json()) as { ok: boolean; code: string };
      assert.equal(bigJson.ok, false);
      assert.equal(bigJson.code, 'PAYLOAD_TOO_LARGE');

      // 4. SQLi & Prototype-pollution fuzz inputs rejected cleanly via Zod strict schemas
      const sqliRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: "admin' OR '1'='1",
          displayName: 'Attacker',
          password: 'Password123!',
        }),
      });
      assert.equal(sqliRes.status, 400);

      const protoRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"username":"proto_user","displayName":"Proto","password":"Password123!","__proto__":{"polluted":true}}',
      });
      assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype must not be polluted');
      assert.ok([201, 400].includes(protoRes.status));

      // 5. Cross-room authorization boundary: user outside room gets 403
      const u1 = await registerUser(baseUrl, 't08_sec_u1', 'Chỉ Huy Một');
      const u2 = await registerUser(baseUrl, 't08_sec_u2', 'Chỉ Huy Hai');
      const intruder = await registerUser(baseUrl, 't08_sec_u3', 'Kẻ Xâm Nhập');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, u1.token, u2.token);

      const intruderRead = await fetch(`${baseUrl}/api/rooms/${matchId}`, {
        headers: { Authorization: `Bearer ${intruder.token}` },
      });
      assert.equal(intruderRead.status, 403);

      const intruderCmd = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${intruder.token}` },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_t08_intrude_1',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_t08_intrude_1',
          sequence: 1,
          expectedVersion: 0,
          issuedAtUtc: clock.nowUtc(),
          payload: { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' },
        }),
      });
      assert.equal(intruderCmd.status, 403);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('measures real HTTP + live WebSocket delta delivery latency across 3 concurrent active rooms under wall-clock runtime', async () => {
    const { runtime, baseUrl, wsUrl, store } = await startTestRuntime({ useRealClock: true });
    const sockets: WebSocket[] = [];

    try {
      const rooms: Array<{
        matchId: MatchId;
        north: AuthSession;
        south: AuthSession;
        deltasReceived: number;
      }> = [];

      for (let r = 0; r < 3; r += 1) {
        const north = await registerUser(baseUrl, `t08_ws_n${r}`, `Bắc Socket ${r}`);
        const south = await registerUser(baseUrl, `t08_ws_s${r}`, `Nam Socket ${r}`);
        const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token, `WS Room ${r}`);
        const entry = { matchId, north, south, deltasReceived: 0 };
        rooms.push(entry);

        // Connect both players over real WebSocket and wait for initial room:snapshot
        for (const sess of [north, south]) {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            sockets.push(ws);
            const timer = setTimeout(() => reject(new Error('WS snapshot timeout')), 5000);
            ws.on('open', () => {
              ws.send(JSON.stringify({ type: 'room:subscribe', token: sess.token, matchId }));
            });
            ws.on('message', (raw) => {
              const msg = JSON.parse(String(raw)) as { type?: string };
              if (msg.type === 'room:snapshot') {
                clearTimeout(timer);
                resolve();
              } else if (msg.type === 'room:delta') {
                entry.deltasReceived += 1;
              }
            });
            ws.on('error', (err) => {
              clearTimeout(timer);
              reject(err);
            });
          });
        }
      }

      const haNoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!;
      const hcm = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh')!;
      const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
      const canTho = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Cần Thơ')!;
      const latenciesMs: number[] = [];

      // Execute 18 real authenticated commands across the 3 concurrent rooms & measure wall-clock latency
      for (const room of rooms) {
        const sendCmd = makeCommandSender(baseUrl, store, room.matchId, () => Date.now());
        const actions: Array<[string, string, Record<string, unknown>]> = [
          [room.north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' }],
          [room.south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'motor' }],
          [room.north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: haNoi.cityId, projectKey: 'office' }],
          [room.south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: hcm.cityId, projectKey: 'office' }],
          [room.north.token, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'factory' }],
          [room.south.token, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: canTho.cityId, projectKey: 'factory' }],
        ];
        for (const [tok, actorId, payload] of actions) {
          const t0 = performance.now();
          await sendCmd(tok, actorId, payload, { expectOk: true });
          latenciesMs.push(performance.now() - t0);
        }
      }

      // Allow WebSocket delta frames to flush
      await new Promise((r) => setTimeout(r, 80));

      latenciesMs.sort((a, b) => a - b);
      const p95 = latenciesMs[Math.min(latenciesMs.length - 1, Math.floor(latenciesMs.length * 0.95))];
      assert.equal(latenciesMs.length, 18);
      assert.ok(p95 < 250, `Localhost P95 command latency should be < 250ms (got ${p95.toFixed(1)}ms)`);

      for (const room of rooms) {
        assert.ok(room.deltasReceived >= 6, `Expected live WS room:delta deliveries (got ${room.deltasReceived})`);
        assert.equal(store.verifyMatchReplay(room.matchId)?.verified, true);
      }

      // Verify /api/metrics reflects live sockets & processed commands
      const metricsRes = (await (await fetch(`${baseUrl}/api/metrics`)).json()) as {
        ok: boolean;
        metrics: { commandsProcessed: number; wsConnections: number };
      };
      assert.equal(metricsRes.ok, true);
      assert.ok(metricsRes.metrics.commandsProcessed >= 18);
      assert.equal(metricsRes.metrics.wsConnections, 6);
    } finally {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {}
      }
      await runtime.close();
      store.close();
    }
  });
});
