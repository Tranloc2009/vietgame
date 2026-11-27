import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import {
  CAMPAIGN_COMBAT_TICK_MS,
  CAMPAIGN_HEAL_TICK_MS,
  CAMPAIGN_OBSERVATION_RADIUS_DEG,
  CAMPAIGN_VICTORY_TARGET_VP,
  CONTRACT_SCHEMA_VERSION,
  MatchId,
} from '../contracts';
import {
  VIETNAM_CAMPAIGN_CITIES,
  VIETNAM_CAMPAIGN_CITY_BY_NAME,
  VIETNAM_CAMPAIGN_SCENARIO_ID,
} from '../content/vietnamCampaignScenario';
import { WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import {
  CAMPAIGN_DOCTRINE_CATALOG,
  CAMPAIGN_PROJECT_CATALOG,
  CAMPAIGN_UNIT_STATS,
  computeCampaignNationLedger,
  ManualClock,
} from '../simulation';
import { loadServerConfig } from './config';
import { createServerRuntime, ServerRuntime } from './createApp';
import { SqliteMatchStore } from './db/sqliteStore';

async function startTestRuntime(options?: {
  dbPath?: string;
  clock?: ManualClock;
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
  const clock = options?.clock ?? new ManualClock(1_761_000_000_000);
  const runtime = createServerRuntime(config, store, clock);

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
  title = 'Chiến dịch T05 Test'
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
    room: { matchId: MatchId; inviteCode: string; scenarioId: string };
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
        commandId: `cmd_t05_${cmdCounter}`,
        matchId,
        actorId,
        idempotencyKey: `idem_t05_${cmdCounter}`,
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

function waitForWsMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };

    ws.on('message', onMessage);
  });
}

describe('T05 — WW3 Tech Tree, Infrastructure, Diplomacy, Combat Engine, Conquest & Victory', () => {
  it('enforces WW3 tech & building prerequisites, bunker max level, recon 2.25° vision, fuel upkeep, and enemy building fog redaction', async () => {
    const clock = new ManualClock(1_761_000_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    // Find a South city strictly > 1.25° from all North cities, yet <= 2.25° from Đà Nẵng (e.g. Kon Tum at 1.73°)
    const northCities = VIETNAM_CAMPAIGN_CITIES.filter((c) => c.initialOwnerSlot === 'NORTH');
    const reconTargetCity = VIETNAM_CAMPAIGN_CITIES.find((c) => {
      if (c.initialOwnerSlot !== 'SOUTH') return false;
      const dDaNang = Math.hypot(c.lon - daNang.lon, c.lat - daNang.lat);
      if (dDaNang <= CAMPAIGN_OBSERVATION_RADIUS_DEG || dDaNang > 2.25) return false;
      return northCities.every(
        (nc) => Math.hypot(c.lon - nc.lon, c.lat - nc.lat) > CAMPAIGN_OBSERVATION_RADIUS_DEG
      );
    });
    assert.ok(reconTargetCity, 'Expected a South city in (1.25°, 2.25°] ring from Đà Nẵng');

    try {
      const north = await registerUser(baseUrl, 't05_tech_n', 'Bắc Công Nghệ');
      const south = await registerUser(baseUrl, 't05_tech_s', 'Nam Công Nghệ');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

      // Initial symmetric VP & PEACE diplomacy & opening news
      const initialCs = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(initialCs.victoryTargetVp, CAMPAIGN_VICTORY_TARGET_VP);
      assert.equal(initialCs.victoryPointsByNation[WORLD_NATIONS.north], 320);
      assert.equal(initialCs.victoryPointsByNation[WORLD_NATIONS.south], 320);
      assert.equal(initialCs.diplomacy?.relation, 'PEACE');
      assert.ok(initialCs.news.length >= 1);

      // Tech prerequisite rejections: tank requires recon, artillery requires motor
      const badTankTech = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'tank',
      });
      assert.equal(badTankTech.status, 422);

      const badArtyTech = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'artillery',
      });
      assert.equal(badArtyTech.status, 422);

      // South builds office + mobilizes reserve at reconTargetCity (outside normal 1.25° North city vision)
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.south,
          cityId: reconTargetCity.cityId,
          projectKey: 'office',
        },
        { expectOk: true }
      );
      // North simultaneously builds office at Đà Nẵng and researches recon
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNang.cityId,
          projectKey: 'office',
        },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_RESEARCH',
          nationId: WORLD_NATIONS.north,
          doctrineKey: 'recon',
        },
        { expectOk: true }
      );

      clock.advanceByMs(45_000);
      runtime.scheduler.runCatchUpCycle();

      // Recon mobilization MUST fail before Army Base Lv 1
      const badReconNoBase = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNang.cityId,
        projectKey: 'recon',
      });
      assert.equal(badReconNoBase.status, 422);

      // South mobilizes reserve at reconTargetCity; North builds base Lv 1 and researches tank
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.south,
          cityId: reconTargetCity.cityId,
          projectKey: 'reserve',
        },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNang.cityId,
          projectKey: 'base',
        },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_RESEARCH',
          nationId: WORLD_NATIONS.north,
          doctrineKey: 'tank',
        },
        { expectOk: true }
      );

      clock.advanceByMs(75_000);
      runtime.scheduler.runCatchUpCycle();

      // Before Recon exists, North CANNOT see South's reserve at reconTargetCity (> 1.25° away)
      const northBeforeRecon = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${north.token}` },
        })
      ).json()) as { match: { campaignState: { units: Record<string, unknown> } } };
      assert.equal(Object.keys(northBeforeRecon.match.campaignState.units).length, 0);

      // Tank mobilization MUST fail at Base Lv 1 (requires Base Lv 2)
      const badTankNoBase2 = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNang.cityId,
        projectKey: 'tank',
      });
      assert.equal(badTankNoBase2.status, 422);

      // Now mobilize Recon at Đà Nẵng (Base Lv 1 + Office Lv 1 + recon learned) AND upgrade Base to Lv 2
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNang.cityId,
          projectKey: 'recon',
        },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNang.cityId,
          projectKey: 'base',
        },
        { expectOk: true }
      );

      clock.advanceByMs(110_000); // Recon (45s) + Base Lv2 (110s)
      runtime.scheduler.runCatchUpCycle();

      // Verify Recon unit spawned with 22 HP, fuel upkeep >= 1, and reveals South unit at reconTargetCity!
      const csAfterRecon = store.getMatch(matchId)!.state.campaignState!;
      const reconUnit = Object.values(csAfterRecon.units).find((u) => u.key === 'recon');
      assert.ok(reconUnit);
      assert.equal(reconUnit.hp, CAMPAIGN_UNIT_STATS.recon.maxHp);
      const ledger = computeCampaignNationLedger(csAfterRecon, WORLD_NATIONS.north);
      assert.equal(ledger.expense[2], CAMPAIGN_UNIT_STATS.recon.upkeepFuel);

      const northAfterRecon = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${north.token}` },
        })
      ).json()) as { match: { campaignState: { units: Record<string, { ownerNationId: string }> } } };
      const spottedSouth = Object.values(northAfterRecon.match.campaignState.units).find(
        (u) => u.ownerNationId === WORLD_NATIONS.south
      );
      assert.ok(spottedSouth, 'Recon 2.25° radar vision must spot South unit beyond 1.25° city sight');

      // Mobilize Tank at Đà Nẵng (Base Lv 2 now satisfied) -> 42 HP
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNang.cityId,
          projectKey: 'tank',
        },
        { expectOk: true }
      );
      // Also build 3 levels of bunker and verify level 4 is rejected
      for (let lv = 1; lv <= 3; lv += 1) {
        await sendCmd(
          north.token,
          WORLD_ACTORS.north,
          {
            type: 'CAMPAIGN_START_CITY_PROJECT',
            nationId: WORLD_NATIONS.north,
            cityId: daNang.cityId,
            projectKey: 'bunker',
          },
          { expectOk: true }
        );
        clock.advanceByMs(CAMPAIGN_PROJECT_CATALOG.bunker.seconds * lv * 1000);
        runtime.scheduler.runCatchUpCycle();
      }
      const bunkerLv4 = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNang.cityId,
        projectKey: 'bunker',
      });
      assert.equal(bunkerLv4.status, 422);

      const csFinal = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csFinal.cities[daNang.cityId].bunker, 3);
      assert.equal(csFinal.cities[daNang.cityId].base, 2);
      const tankUnit = Object.values(csFinal.units).find((u) => u.key === 'tank');
      assert.ok(tankUnit);
      assert.equal(tankUnit.hp, 42);

      // Fog redaction check: South MUST see base/bunker/hospital = 0 on North's Đà Nẵng
      const southView = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as {
        match: {
          campaignState: {
            cities: Record<string, { base: number; bunker: number; hospital: number; office: number }>;
          };
        };
      };
      assert.equal(southView.match.campaignState.cities[daNang.cityId].base, 0);
      assert.equal(southView.match.campaignState.cities[daNang.cityId].bunker, 0);
      assert.equal(southView.match.campaignState.cities[daNang.cityId].hospital, 0);
      assert.equal(southView.match.campaignState.cities[daNang.cityId].office, 0);

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('resolves diplomacy, shared intel, ranged artillery bombardment (0 counter-damage), entrenched melee combat, peace halt, and hospital healing', async () => {
    const clock = new ManualClock(1_761_100_000_000);
    const { runtime, baseUrl, wsUrl, store } = await startTestRuntime({ clock });

    const haNoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!;
    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;
    const hcm = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh')!;

    try {
      const north = await registerUser(baseUrl, 't05_war_n', 'Bắc Chiến Trận');
      const south = await registerUser(baseUrl, 't05_war_s', 'Nam Chiến Trận');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);
      const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

      // Subscribe South over WS to verify public diplomacy/combat delta delivery
      const wsSouth = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => wsSouth.once('open', resolve));
      const snapP = waitForWsMessage(wsSouth, (m) => m.type === 'room:snapshot');
      wsSouth.send(JSON.stringify({ type: 'room:subscribe', token: south.token, matchId }));
      await snapP;

      // 1. Setup: North builds office + base + hospital at Đà Nẵng, office at Hà Nội, researches motor -> artillery
      // South builds office + bunker at Quảng Ngãi
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
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: haNoi.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'office' },
        { expectOk: true }
      );
      clock.advanceByMs(45_000);
      runtime.scheduler.runCatchUpCycle();

      // North researches artillery (60s), builds base at Đà Nẵng (55s), mobilizes reserve at Hà Nội (40s)
      // South builds bunker Lv 1 at Quảng Ngãi (50s), mobilizes reserve at Quảng Ngãi (40s)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'artillery' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: haNoi.cityId, projectKey: 'reserve' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'bunker' },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'reserve' },
        { expectOk: true }
      );
      clock.advanceByMs(60_000);
      runtime.scheduler.runCatchUpCycle();

      const hnUnit = Object.values(store.getMatch(matchId)!.state.campaignState!.units).find(
        (u) => u.cityId === haNoi.cityId
      )!;
      assert.ok(hnUnit);

      // 2. Shared Intel diplomacy check: South cannot see Hà Nội unit before pact, CAN see after bilateral ACCEPT_INTEL
      const getSouthVisibleUnitIds = async () => {
        const res = (await (
          await fetch(`${baseUrl}/api/rooms/${matchId}`, {
            headers: { Authorization: `Bearer ${south.token}` },
          })
        ).json()) as { match: { campaignState: { units: Record<string, unknown> } } };
        return Object.keys(res.match.campaignState.units);
      };
      assert.ok(!(await getSouthVisibleUnitIds()).includes(hnUnit.unitId));

      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_SET_DIPLOMACY',
          nationId: WORLD_NATIONS.north,
          targetNationId: WORLD_NATIONS.south,
          action: 'PROPOSE_INTEL',
        },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        {
          type: 'CAMPAIGN_SET_DIPLOMACY',
          nationId: WORLD_NATIONS.south,
          targetNationId: WORLD_NATIONS.north,
          action: 'ACCEPT_INTEL',
        },
        { expectOk: true }
      );
      assert.ok((await getSouthVisibleUnitIds()).includes(hnUnit.unitId));

      // 3. North mobilizes artillery at Đà Nẵng (60s) & builds hospital at Đà Nẵng (55s)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'artillery' },
        { expectOk: true }
      );
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'hospital' },
        { expectOk: true }
      );
      clock.advanceByMs(60_000);
      runtime.scheduler.runCatchUpCycle();

      // Mobilize motor at Đà Nẵng (50s) as well for melee assault
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'motor' },
        { expectOk: true }
      );
      clock.advanceByMs(50_000);
      runtime.scheduler.runCatchUpCycle();

      const csPreWar = store.getMatch(matchId)!.state.campaignState!;
      const northArty = Object.values(csPreWar.units).find((u) => u.key === 'artillery')!;
      const northMotor = Object.values(csPreWar.units).find((u) => u.key === 'motor')!;
      const southReserve = Object.values(csPreWar.units).find(
        (u) => u.ownerNationId === WORLD_NATIONS.south
      )!;
      assert.ok(northArty && northMotor && southReserve);

      // Moving into Quảng Ngãi during PEACE must fail with 403
      const blockedAssault = await sendCmd(north.token, WORLD_ACTORS.north, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: northMotor.unitId,
        toCityId: quangNgai.cityId,
        expectedRev: northMotor.rev,
      });
      assert.equal(blockedAssault.status, 403);

      // 4. North declares WAR -> breaks Shared Intel, emits public WS delta, AND fires opening Artillery bombardment!
      const warDeltaP = waitForWsMessage(
        wsSouth,
        (m) =>
          m.type === 'room:delta' &&
          Array.isArray(m.events) &&
          m.events.some(
            (ev: { payload?: { type?: string } }) => ev.payload?.type === 'CAMPAIGN_DIPLOMACY_CHANGED'
          )
      );
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
      await warDeltaP;

      const csAfterWar = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csAfterWar.diplomacy?.relation, 'WAR');
      assert.equal(csAfterWar.diplomacy?.sharedIntelActive, false);

      // Artillery at Đà Nẵng (softAttack 7) fired at South reserve at Quảng Ngãi (15% bunker entrenchment):
      // Expected dmg = floor(7 * 100 * 85 / 10000) = 5 -> South reserve drops from 15 to 10 HP, Artillery stays 16/16!
      const artyNow = csAfterWar.units[northArty.unitId];
      const southAfterSalvo1 = csAfterWar.units[southReserve.unitId];
      assert.equal(artyNow.hp, 16, 'Artillery must take 0 counter-damage on ranged bombardment');
      assert.equal(southAfterSalvo1.hp, 10, 'Entrenched reserve (bunker Lv1 = 15%) should take 5 dmg from 7 softAttack');
      assert.equal(csAfterWar.battleReports[0].kind, 'BOMBARDMENT');
      assert.equal(csAfterWar.battleReports[0].damageToAttackers, 0);

      // 5. Move Artillery out to Hà Nội so we can cleanly test 1v1 melee combat + hospital healing
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: northArty.unitId,
          toCityId: haNoi.cityId,
          expectedRev: artyNow.rev,
        },
        { expectOk: true }
      );

      // Send North Motor (20 HP) to attack South Reserve (10 HP, bunker Lv1) at Quảng Ngãi (32s travel)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: northMotor.unitId,
          toCityId: quangNgai.cityId,
          expectedRev: csAfterWar.units[northMotor.unitId].rev,
        },
        { expectOk: true }
      );

      // Advance 32s -> Motor arrives at Quảng Ngãi & fights Opening Melee Round 1!
      // Motor (20/20 HP, softAttack 6) vs Reserve (10/15 HP -> 66% hpPct, defense 4, bunker 15%):
      // Motor deals floor(6 * 100 * 85 / 10000) = 5 dmg -> Reserve drops 10 -> 5 HP
      // Reserve retaliates ONCE (no double-hit!): floor(4 * 66 * 100 / 10000) = 2 dmg -> Motor drops 20 -> 18 HP
      clock.advanceByMs(32_000);
      runtime.scheduler.runCatchUpCycle();

      const csMelee1 = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csMelee1.units[northMotor.unitId].hp, 18, 'Motor must take single simultaneous retaliation (2 dmg)');
      assert.equal(csMelee1.units[southReserve.unitId].hp, 5, 'Reserve must take 5 melee dmg');
      assert.equal(csMelee1.units[northMotor.unitId].inCombat, true);
      assert.equal(csMelee1.battleReports[0].kind, 'MELEE');

      // Advance 10s (Round 2): Motor at 18/20 HP (90%) deals floor(6*90*85/10000) = 4 dmg -> Reserve drops 5 -> 1 HP
      clock.advanceByMs(CAMPAIGN_COMBAT_TICK_MS);
      runtime.scheduler.runCatchUpCycle();
      assert.equal(store.getMatch(matchId)!.state.campaignState!.units[southReserve.unitId]?.hp, 1);

      // Advance 10s (Round 3): finishes South Reserve (1 -> 0 HP) and captures Quảng Ngãi!
      clock.advanceByMs(CAMPAIGN_COMBAT_TICK_MS);
      runtime.scheduler.runCatchUpCycle();

      const csMelee2 = store.getMatch(matchId)!.state.campaignState!;
      assert.equal(csMelee2.units[southReserve.unitId], undefined, 'South reserve must be destroyed');
      assert.equal(csMelee2.cities[quangNgai.cityId].ownerNationId, WORLD_NATIONS.north);
      assert.equal(csMelee2.cities[quangNgai.cityId].bunker, 0, 'Bunker should degrade by 1 upon capture');
      assert.equal(csMelee2.nations[WORLD_NATIONS.north].stats.enemyUnitsDestroyed, 1);
      assert.equal(csMelee2.nations[WORLD_NATIONS.south].stats.unitsLost, 1);
      assert.equal(csMelee2.nations[WORLD_NATIONS.north].stats.citiesCaptured, 1);

      const damagedMotor = csMelee2.units[northMotor.unitId];
      assert.ok(damagedMotor.hp < damagedMotor.maxHp, 'Motor should have sustained melee damage');

      // 6. Test Peace halting an in-transit assault march toward enemy city (TP. Hồ Chí Minh)
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: damagedMotor.unitId,
          toCityId: hcm.cityId,
          expectedRev: damagedMotor.rev,
        },
        { expectOk: true }
      );
      clock.advanceByMs(5_000);
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_SET_DIPLOMACY',
          nationId: WORLD_NATIONS.north,
          targetNationId: WORLD_NATIONS.south,
          action: 'PROPOSE_PEACE',
        },
        { expectOk: true }
      );
      await sendCmd(
        south.token,
        WORLD_ACTORS.south,
        {
          type: 'CAMPAIGN_SET_DIPLOMACY',
          nationId: WORLD_NATIONS.south,
          targetNationId: WORLD_NATIONS.north,
          action: 'ACCEPT_PEACE',
        },
        { expectOk: true }
      );
      const motorAfterPeace = store.getMatch(matchId)!.state.campaignState!.units[damagedMotor.unitId];
      assert.equal(motorAfterPeace.trip, null, 'Signing PEACE must halt in-transit assault marches into enemy cities');

      // 7. Return damaged Motor to Đà Nẵng (which has hospital Lv 1) and verify +1 HP healing after 30s!
      await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        {
          type: 'CAMPAIGN_MOVE_UNIT',
          nationId: WORLD_NATIONS.north,
          unitId: motorAfterPeace.unitId,
          toCityId: daNang.cityId,
          expectedRev: motorAfterPeace.rev,
        },
        { expectOk: true }
      );
      clock.advanceByMs(32_000);
      runtime.scheduler.runCatchUpCycle();
      const hpOnArrival = store.getMatch(matchId)!.state.campaignState!.units[damagedMotor.unitId].hp;
      assert.ok(hpOnArrival < 20);

      // Advance 15s (before 30s heal tick) -> HP must NOT change yet
      clock.advanceByMs(15_000);
      runtime.scheduler.runCatchUpCycle();
      assert.equal(store.getMatch(matchId)!.state.campaignState!.units[damagedMotor.unitId].hp, hpOnArrival);

      // Advance remaining 15s (30s total) -> Hospital Lv 1 heals exactly +1 HP!
      clock.advanceByMs(CAMPAIGN_HEAL_TICK_MS - 15_000);
      runtime.scheduler.runCatchUpCycle();
      assert.equal(
        store.getMatch(matchId)!.state.campaignState!.units[damagedMotor.unitId].hp,
        Math.min(20, hpOnArrival + 1)
      );

      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
      wsSouth.close();
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('enforces infantry-only city capture, cancels enemy queues on conquest, ends room atomically at 400 VP, and passes restart + replay', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-t05-victory-'));
    const dbPath = path.join(tmpDir, 'victory.sqlite');
    const clock = new ManualClock(1_761_200_000_000);

    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;
    const konTum = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Kon Tum')!;
    const pleiku = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Pleiku')!;
    const quyNhon = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quy Nhơn')!;
    const nhaTrang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Nha Trang')!;
    const hcm = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh')!;

    let matchId!: MatchId;

    try {
      const { runtime, baseUrl, wsUrl, store } = await startTestRuntime({ dbPath, clock });
      try {
        const north = await registerUser(baseUrl, 't05_vic_n', 'Bắc Chiến Thắng');
        const south = await registerUser(baseUrl, 't05_vic_s', 'Nam Phòng Thủ');
        const created = await createAndStartCampaignRoom(baseUrl, north.token, south.token, 'Chiến thắng 400 VP');
        matchId = created.matchId;
        const sendCmd = makeCommandSender(baseUrl, store, clock, matchId);

        const wsSouth = new WebSocket(wsUrl);
        await new Promise<void>((resolve) => wsSouth.once('open', resolve));
        const snapP = waitForWsMessage(wsSouth, (m) => m.type === 'room:snapshot');
        wsSouth.send(JSON.stringify({ type: 'room:subscribe', token: south.token, matchId }));
        await snapP;

        // Build office + base Lv 1 at Đà Nẵng, research recon & motor, mobilize Recon + Motor
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
          { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' },
          { expectOk: true }
        );
        await sendCmd(
          north.token,
          WORLD_ACTORS.north,
          { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' },
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

        await sendCmd(
          north.token,
          WORLD_ACTORS.north,
          { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'motor' },
          { expectOk: true }
        );
        clock.advanceByMs(50_000);
        runtime.scheduler.runCatchUpCycle();

        // South starts a factory queue inside Quảng Ngãi so we verify capture wipes enemy queues
        await sendCmd(
          south.token,
          WORLD_ACTORS.south,
          { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'factory' },
          { expectOk: true }
        );
        assert.equal(store.getMatch(matchId)!.state.campaignState!.cities[quangNgai.cityId].jobs.length, 1);

        // Declare war
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

        const unitsNow = Object.values(store.getMatch(matchId)!.state.campaignState!.units);
        const reconUnit = unitsNow.find((u) => u.key === 'recon')!;
        const motorUnit = unitsNow.find((u) => u.key === 'motor')!;

        // 1. Recon (canConquer: false) arrives at undefended Quảng Ngãi -> MUST NOT capture!
        await sendCmd(
          north.token,
          WORLD_ACTORS.north,
          {
            type: 'CAMPAIGN_MOVE_UNIT',
            nationId: WORLD_NATIONS.north,
            unitId: reconUnit.unitId,
            toCityId: quangNgai.cityId,
            expectedRev: reconUnit.rev,
          },
          { expectOk: true }
        );
        clock.advanceByMs(CAMPAIGN_UNIT_STATS.recon.moveSeconds * 1000);
        runtime.scheduler.runCatchUpCycle();
        assert.equal(
          store.getMatch(matchId)!.state.campaignState!.cities[quangNgai.cityId].ownerNationId,
          WORLD_NATIONS.south,
          'Recon vehicle (canConquer=false) must NOT capture enemy city'
        );

        // 2. Motor infantry (canConquer: true) captures Quảng Ngãi (+10), Kon Tum (+10), Pleiku (+10),
        // Quy Nhơn (+10), Nha Trang (+10), and Capital TP. Hồ Chí Minh (+30) => 320 + 80 = 400 VP!
        const statusEndedP = waitForWsMessage(
          wsSouth,
          (m) => m.type === 'room:status' && (m.room as { status?: string })?.status === 'ENDED'
        );

        const conquestPath = [quangNgai, konTum, pleiku, quyNhon, nhaTrang, hcm];
        for (let i = 0; i < conquestPath.length; i += 1) {
          const target = conquestPath[i];
          const curMotor = store.getMatch(matchId)!.state.campaignState!.units[motorUnit.unitId];
          await sendCmd(
            north.token,
            WORLD_ACTORS.north,
            {
              type: 'CAMPAIGN_MOVE_UNIT',
              nationId: WORLD_NATIONS.north,
              unitId: motorUnit.unitId,
              toCityId: target.cityId,
              expectedRev: curMotor.rev,
            },
            { expectOk: true }
          );
          clock.advanceByMs(CAMPAIGN_UNIT_STATS.motor.moveSeconds * 1000);
          runtime.scheduler.runCatchUpCycle();

          const st = store.getMatch(matchId)!.state;
          assert.equal(st.campaignState!.cities[target.cityId].ownerNationId, WORLD_NATIONS.north);
          assert.equal(st.regions[target.cityId].controllerNationId, WORLD_NATIONS.north);
          if (i === 0) {
            assert.equal(
              st.campaignState!.cities[quangNgai.cityId].jobs.length,
              0,
              'Capturing a city must cancel previous owner pending jobs'
            );
            assert.equal(st.campaignState!.victoryPointsByNation[WORLD_NATIONS.north], 330);
            assert.equal(st.campaignState!.victoryPointsByNation[WORLD_NATIONS.south], 310);
          }
        }

        await statusEndedP;

        const endedRecord = store.getMatch(matchId)!;
        const endedCs = endedRecord.state.campaignState!;
        assert.ok(endedCs.victory, 'Victory must trigger at 400 VP');
        assert.equal(endedCs.victory.winnerSlot, 'NORTH');
        assert.equal(endedCs.victory.reason, 'VICTORY_POINTS');
        assert.equal(endedCs.victoryPointsByNation[WORLD_NATIONS.north], 400);
        assert.equal(endedCs.victoryPointsByNation[WORLD_NATIONS.south], 240);

        const roomRow = store.getRoomRow(matchId)!;
        assert.equal(roomRow.status, 'ENDED');
        assert.equal(roomRow.winner_slot, 'NORTH');
        assert.equal(roomRow.ended_reason, 'VICTORY_POINTS');

        // Post-victory commands must be rejected with 409 MATCH_NOT_ACTIVE
        const postWinCmd = await sendCmd(north.token, WORLD_ACTORS.north, {
          type: 'CAMPAIGN_START_RESEARCH',
          nationId: WORLD_NATIONS.north,
          doctrineKey: 'motor2',
        });
        assert.equal(postWinCmd.status, 409);
        assert.equal(postWinCmd.body.code, 'MATCH_NOT_ACTIVE');

        wsSouth.close();
      } finally {
        await runtime.close();
        store.close();
      }

      // 3. Reopen SQLite from disk (simulating server restart) and verify persistence + 100% replay hash match!
      const reopenedStore = new SqliteMatchStore(dbPath);
      try {
        const persistedRoom = reopenedStore.getRoomRow(matchId)!;
        assert.equal(persistedRoom.status, 'ENDED');
        assert.equal(persistedRoom.winner_slot, 'NORTH');
        assert.equal(persistedRoom.ended_reason, 'VICTORY_POINTS');

        const persistedState = reopenedStore.getMatch(matchId)!.state;
        assert.equal(persistedState.campaignState?.victory?.winnerSlot, 'NORTH');
        assert.equal(persistedState.campaignState?.victoryPointsByNation[WORLD_NATIONS.north], 400);

        const replay = reopenedStore.verifyMatchReplay(matchId);
        assert.ok(replay);
        assert.equal(replay.verified, true);
        assert.equal(replay.replayedHash, replay.storedHash);
      } finally {
        reopenedStore.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
