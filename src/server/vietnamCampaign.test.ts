import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import {
  asUtcEpochMs,
  CAMPAIGN_HOUR_MS,
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
  ManualClock,
} from '../simulation';
import { loadServerConfig } from './config';
import { createServerRuntime, ServerRuntime } from './createApp';
import { SqliteMatchStore } from './db/sqliteStore';
import { MatchClockScheduler } from './scheduler';

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
  const clock = options?.clock ?? new ManualClock(1_760_000_000_000);
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

async function createAndStartCampaignRoom(
  baseUrl: string,
  northToken: string,
  southToken: string,
  title = 'Chiến dịch Việt Nam Test'
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
    match: { scenarioId: string; campaignState: unknown };
  };
  assert.equal(created.room.scenarioId, VIETNAM_CAMPAIGN_SCENARIO_ID);
  assert.equal(created.match.scenarioId, VIETNAM_CAMPAIGN_SCENARIO_ID);
  assert.ok(created.match.campaignState);

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

describe('T04 — Modern Vietnam Campaign Server-Authoritative Research, Mobilization & Unit Orders', () => {
  it('maintains 100% 60-city parity with campaign/assets/atlas.js and balanced 30/30 NORTH-SOUTH split', () => {
    const atlasPath = path.resolve(process.cwd(), 'campaign/assets/atlas.js');
    const atlasCode = fs.readFileSync(atlasPath, 'utf8');
    const atlasData = new Function(`${atlasCode}; return atlasData;`)() as {
      cities: Array<{ name: string; lon: number; lat: number; capital: boolean; rank: number }>;
    };

    assert.equal(VIETNAM_CAMPAIGN_CITIES.length, 60);
    assert.equal(atlasData.cities.length, 60);

    const northCities = VIETNAM_CAMPAIGN_CITIES.filter((c) => c.initialOwnerSlot === 'NORTH');
    const southCities = VIETNAM_CAMPAIGN_CITIES.filter((c) => c.initialOwnerSlot === 'SOUTH');
    assert.equal(northCities.length, 30);
    assert.equal(southCities.length, 30);

    for (let i = 0; i < 60; i += 1) {
      const bp = VIETNAM_CAMPAIGN_CITIES[i];
      const raw = atlasData.cities[i];
      assert.equal(bp.name, raw.name);
      assert.equal(bp.lon, Number(raw.lon));
      assert.equal(bp.lat, Number(raw.lat));
      assert.equal(bp.capital, Boolean(raw.capital));
      assert.equal(bp.rank, Number(raw.rank));
      assert.equal(bp.material, i % 5);
    }

    assert.equal(VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')?.initialOwnerSlot, 'NORTH');
    assert.equal(VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')?.initialOwnerSlot, 'NORTH');
    assert.equal(VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh')?.initialOwnerSlot, 'SOUTH');
    assert.equal(VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Cần Thơ')?.initialOwnerSlot, 'SOUTH');
  });

  it('executes full server-authoritative research -> build office -> mobilize -> move/retarget/halt -> motor2 speed upgrade with ownership, prerequisites, idempotency, and fog-of-war checks', async () => {
    const startUtc = 1_760_000_000_000;
    const clock = new ManualClock(startUtc);
    const { runtime, baseUrl, wsUrl, store } = await startTestRuntime({ clock });

    const daNangId = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!.cityId;
    const haNoiId = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!.cityId;
    const haiPhongId = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hải Phòng')!.cityId;
    const hcmId = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh')!.cityId;

    try {
      const north = await registerUser(baseUrl, 'vn_north', 'Chỉ huy Bắc');
      const south = await registerUser(baseUrl, 'vn_south', 'Chỉ huy Nam');

      // Coexistence check: create a legacy 1955 room alongside the modern Vietnam campaign room
      const legacyCreate = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${north.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Phòng 1955 hồi quy', preferredSlot: 'NORTH' }),
      });
      assert.equal(legacyCreate.status, 201);
      const legacyBody = (await legacyCreate.json()) as {
        room: { scenarioId: string; matchId: MatchId };
      };
      assert.equal(legacyBody.room.scenarioId, 'vietnam_1955');
      assert.equal(store.verifyMatchReplay(legacyBody.room.matchId)?.verified, true);

      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);

      // Subscribe South over WebSocket to verify ZERO private queue/order leakage
      const wsSouth = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => wsSouth.once('open', resolve));
      const southSnapP = waitForWsMessage(wsSouth, (m) => m.type === 'room:snapshot');
      wsSouth.send(JSON.stringify({ type: 'room:subscribe', token: south.token, matchId }));
      const southInitialSnap = (await southSnapP) as {
        match: {
          campaignState: { nations: Record<string, unknown> };
        };
      };
      assert.equal(southInitialSnap.match.campaignState.nations[WORLD_NATIONS.north], undefined);
      assert.ok(southInitialSnap.match.campaignState.nations[WORLD_NATIONS.south]);

      const southDeltas: Record<string, unknown>[] = [];
      wsSouth.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.type === 'room:delta') southDeltas.push(msg);
      });

      let northSeq = 0;
      let southSeq = 0;

      const sendCmd = async (
        token: string,
        actorId: string,
        seq: number,
        payload: Record<string, unknown>,
        opts?: { idempotencyKey?: string; commandId?: string; expectedVersion?: number }
      ) => {
        const currentVersion = opts?.expectedVersion ?? store.getMatch(matchId)!.state.version;
        const idempotencyKey = opts?.idempotencyKey ?? `idem_${actorId}_${seq}_${Date.now()}`;
        const commandId = opts?.commandId ?? `cmd_${actorId}_${seq}_${Math.random().toString(16).slice(2, 8)}`;
        const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            commandId,
            matchId,
            actorId,
            idempotencyKey,
            sequence: seq,
            expectedVersion: currentVersion,
            issuedAtUtc: clock.nowUtc(),
            payload,
          }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        return { status: res.status, body, commandId, idempotencyKey };
      };

      // 1. Missing prerequisites must be rejected without mutating state hash
      const hashBeforePrereq = store.getMatch(matchId)!.stateHash;

      // 1a. Research motor2 before motor -> rejected 422
      const badMotor2 = await sendCmd(north.token, WORLD_ACTORS.north, northSeq + 1, {
        type: 'CAMPAIGN_START_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'motor2',
      });
      assert.equal(badMotor2.status, 422);
      assert.equal(badMotor2.body.code, 'INVALID_TARGET');

      // 1b. Mobilize motor before research I and before office -> rejected 422
      const badMobNoTech = await sendCmd(north.token, WORLD_ACTORS.north, northSeq + 1, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNangId,
        projectKey: 'motor',
      });
      assert.equal(badMobNoTech.status, 422);
      assert.equal(badMobNoTech.body.code, 'INVALID_TARGET');

      // 1c. Build office in enemy city (TP. Hồ Chí Minh) -> rejected 403
      const badEnemyCity = await sendCmd(north.token, WORLD_ACTORS.north, northSeq + 1, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: hcmId,
        projectKey: 'office',
      });
      assert.equal(badEnemyCity.status, 403);
      assert.equal(badEnemyCity.body.code, 'FORBIDDEN_ACTION');

      assert.equal(store.getMatch(matchId)!.stateHash, hashBeforePrereq);

      // 2. Start research motor I, test cancel prorated floor refund, then re-start with idempotent retry
      const balBefore = [...store.getMatch(matchId)!.state.campaignState!.nations[WORLD_NATIONS.north].balance];
      northSeq += 1;
      const startStudy1 = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_START_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'motor',
      });
      assert.equal(startStudy1.status, 201);
      const studyStartUtc = startUtc;
      const expectedCost = CAMPAIGN_DOCTRINE_CATALOG.motor.cost;
      const balAfterStart = store.getMatch(matchId)!.state.campaignState!.nations[WORLD_NATIONS.north].balance;
      for (let i = 0; i < 7; i += 1) {
        assert.equal(balAfterStart[i], balBefore[i] - expectedCost[i] * CAMPAIGN_HOUR_MS);
      }

      // Advance 5 seconds and cancel research -> exact floor(cost * 40 / 45) refund
      clock.advanceByMs(5_000);
      northSeq += 1;
      const cancelStudy = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_CANCEL_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'motor',
        expectedStartUtc: studyStartUtc,
      });
      assert.equal(cancelStudy.status, 201);
      const cancelledEvents = cancelStudy.body.emittedEvents as Array<{
        payload: { type: string; refunded?: number[] };
      }>;
      const refundEvt = cancelledEvents.find((e) => e.payload.type === 'CAMPAIGN_RESEARCH_CANCELLED');
      assert.ok(refundEvt);
      assert.deepEqual(refundEvt.payload.refunded, [
        Math.floor((180 * 40_000) / 45_000), // 160
        0,
        0,
        0,
        Math.floor((80 * 40_000) / 45_000), // 71
        0,
        Math.floor((240 * 40_000) / 45_000), // 213
      ]);

      // Start motor I again AND send duplicate retry with identical idempotencyKey -> deducts ONCE!
      northSeq += 1;
      const balBeforeRetry = [
        ...store.getMatch(matchId)!.state.campaignState!.nations[WORLD_NATIONS.north].balance,
      ];
      const studyIdem = 'idem_north_motor_study_once';
      const studyCmdId = 'cmd_north_motor_study_once';
      const versionBeforeStudy = store.getMatch(matchId)!.state.version;
      const startStudy2 = await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        northSeq,
        {
          type: 'CAMPAIGN_START_RESEARCH',
          nationId: WORLD_NATIONS.north,
          doctrineKey: 'motor',
        },
        { idempotencyKey: studyIdem, commandId: studyCmdId, expectedVersion: versionBeforeStudy }
      );
      assert.equal(startStudy2.status, 201);
      assert.equal(startStudy2.body.idempotentDuplicate, false);

      const dupStudy = await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        northSeq,
        {
          type: 'CAMPAIGN_START_RESEARCH',
          nationId: WORLD_NATIONS.north,
          doctrineKey: 'motor',
        },
        { idempotencyKey: studyIdem, commandId: studyCmdId, expectedVersion: versionBeforeStudy }
      );
      assert.equal(dupStudy.status, 200);
      assert.equal(dupStudy.body.idempotentDuplicate, true);
      const balAfterDup = store.getMatch(matchId)!.state.campaignState!.nations[WORLD_NATIONS.north].balance;
      for (let i = 0; i < 7; i += 1) {
        assert.equal(balAfterDup[i], balBeforeRetry[i] - expectedCost[i] * CAMPAIGN_HOUR_MS);
      }

      // Check South's HTTP snapshot & WS deltas: zero leakage of North's active research queue!
      const southViewMidResearch = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as {
        match: {
          campaignState: {
            nations: Record<string, unknown>;
            cities: Record<string, { jobs: unknown[]; office: number }>;
            units: Record<string, unknown>;
          };
        };
      };
      assert.equal(southViewMidResearch.match.campaignState.nations[WORLD_NATIONS.north], undefined);
      for (const delta of southDeltas) {
        assert.deepEqual(delta.events, []);
      }

      // 3. Simultaneously build Recruitment Office at Đà Nẵng while researching motor I
      northSeq += 1;
      const startOffice = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNangId,
        projectKey: 'office',
      });
      assert.equal(startOffice.status, 201);

      // Verify South cannot see North's Đà Nẵng build queue
      const southViewMidBuild = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as {
        match: { campaignState: { cities: Record<string, { jobs: unknown[]; office: number }> } };
      };
      assert.equal(southViewMidBuild.match.campaignState.cities[daNangId].jobs.length, 0);
      assert.equal(southViewMidBuild.match.campaignState.cities[daNangId].office, 0);

      // Complete both research I and office (advance 45s and tick)
      clock.advanceByMs(45_000);
      runtime.scheduler.runCatchUpCycle();
      const after45 = store.getMatch(matchId)!.state.campaignState!;
      assert.ok(after45.nations[WORLD_NATIONS.north].learned.includes('motor'));
      assert.equal(after45.nations[WORLD_NATIONS.north].study, null);
      assert.equal(after45.cities[daNangId].office, 1);

      // Also verify mobilizing at Hà Nội (no office yet) is STILL rejected!
      const mobNoOffice = await sendCmd(north.token, WORLD_ACTORS.north, northSeq + 1, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: haNoiId,
        projectKey: 'motor',
      });
      assert.equal(mobNoOffice.status, 422);

      // 4. Mobilize Mechanized Infantry at Đà Nẵng (with duplicate retry check)
      northSeq += 1;
      const mobIdem = 'idem_north_mob_danang_1';
      const mobCmdId = 'cmd_north_mob_danang_1';
      const verBeforeMob = store.getMatch(matchId)!.state.version;
      const startMob = await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        northSeq,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNangId,
          projectKey: 'motor',
        },
        { idempotencyKey: mobIdem, commandId: mobCmdId, expectedVersion: verBeforeMob }
      );
      assert.equal(startMob.status, 201);

      // Duplicate retry must be idempotent (no second deduction, no duplicate queue)
      const dupMob = await sendCmd(
        north.token,
        WORLD_ACTORS.north,
        northSeq,
        {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: daNangId,
          projectKey: 'motor',
        },
        { idempotencyKey: mobIdem, commandId: mobCmdId, expectedVersion: verBeforeMob }
      );
      assert.equal(dupMob.status, 200);
      assert.equal(dupMob.body.idempotentDuplicate, true);

      // Second mobilization in same city while busy must reject 409
      const busyMob = await sendCmd(north.token, WORLD_ACTORS.north, northSeq + 1, {
        type: 'CAMPAIGN_START_CITY_PROJECT',
        nationId: WORLD_NATIONS.north,
        cityId: daNangId,
        projectKey: 'reserve',
      });
      assert.equal(busyMob.status, 409);

      // Complete 50s mobilization -> spawns EXACTLY ONE unit at Đà Nẵng with stable ID unt_vn_0001
      clock.advanceByMs(CAMPAIGN_PROJECT_CATALOG.motor.seconds * 1000);
      runtime.scheduler.runCatchUpCycle();
      const afterMob = store.getMatch(matchId)!.state.campaignState!;
      const unitIds = Object.keys(afterMob.units);
      assert.deepEqual(unitIds, ['unt_vn_0001']);
      const spawned = afterMob.units.unt_vn_0001;
      assert.equal(spawned.ownerNationId, WORLD_NATIONS.north);
      assert.equal(spawned.cityId, daNangId);
      assert.equal(spawned.key, 'motor');

      // 5. Ownership security: South MUST NOT be able to command North's unit
      const southSpoofMove = await sendCmd(south.token, WORLD_ACTORS.south, southSeq + 1, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.south,
        unitId: 'unt_vn_0001',
        toCityId: hcmId,
        expectedRev: 0,
      });
      assert.equal(southSpoofMove.status, 403);
      assert.equal(southSpoofMove.body.code, 'FORBIDDEN_ACTION');

      // North cannot move to South-controlled TP. Hồ Chí Minh
      const northBadDest = await sendCmd(north.token, WORLD_ACTORS.north, northSeq + 1, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: 'unt_vn_0001',
        toCityId: hcmId,
        expectedRev: 0,
      });
      assert.equal(northBadDest.status, 403);

      // 6. North moves unit from Đà Nẵng -> Hà Nội (32s base duration before motor2)
      northSeq += 1;
      const move1 = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: 'unt_vn_0001',
        toCityId: haNoiId,
        expectedRev: 0,
      });
      assert.equal(move1.status, 201);
      const movingUnit = store.getMatch(matchId)!.state.campaignState!.units.unt_vn_0001;
      assert.ok(movingUnit.trip);
      assert.equal(movingUnit.trip.endUtc - movingUnit.trip.startUtc, 32_000);
      assert.equal(movingUnit.trip.toCityId, haNoiId);

      // Border contact privacy: even if South spots unit near Đà Nẵng (within 1.25° of Quảng Ngãi),
      // South NEVER receives trip destination/waypoints/ETA!
      const southWhileMoving = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as {
        match: {
          redactedUnitIds: string[];
          campaignState: { units: Record<string, { trip: unknown; rev: number }> };
        };
      };
      const spotted = southWhileMoving.match.campaignState.units.unt_vn_0001;
      assert.ok(spotted, 'Border contact at Đà Nẵng should be observable from Quảng Ngãi');
      assert.equal(spotted.trip, null);
      assert.equal(spotted.rev, 0);
      assert.ok(southWhileMoving.match.redactedUnitIds.includes('unt_vn_0001'));

      // Advance 8s, halt mid-way, verify position moved off Đà Nẵng, then retarget to Hải Phòng
      clock.advanceByMs(8_000);
      northSeq += 1;
      const haltRes = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: 'unt_vn_0001',
        toCityId: null,
        expectedRev: 1,
      });
      assert.equal(haltRes.status, 201);
      const haltedUnit = store.getMatch(matchId)!.state.campaignState!.units.unt_vn_0001;
      assert.equal(haltedUnit.trip, null);
      assert.equal(haltedUnit.cityId, null);
      assert.notEqual(haltedUnit.position.lat, VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!.lat);

      // Move to Hải Phòng & arrive
      northSeq += 1;
      const moveHP = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: 'unt_vn_0001',
        toCityId: haiPhongId,
        expectedRev: 2,
      });
      assert.equal(moveHP.status, 201);
      clock.advanceByMs(32_000);
      runtime.scheduler.runCatchUpCycle();
      const atHaiPhong = store.getMatch(matchId)!.state.campaignState!.units.unt_vn_0001;
      assert.equal(atHaiPhong.cityId, haiPhongId);
      assert.equal(atHaiPhong.trip, null);

      // Deep in North (Hải Phòng): completely hidden from South by fog of war!
      const southDeepView = (await (
        await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${south.token}` },
        })
      ).json()) as {
        match: { campaignState: { units: Record<string, unknown> } };
      };
      assert.equal(southDeepView.match.campaignState.units.unt_vn_0001, undefined);

      // 7. Research motor II (65s) -> applies 24s move time to NEW move orders
      northSeq += 1;
      const startM2 = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_START_RESEARCH',
        nationId: WORLD_NATIONS.north,
        doctrineKey: 'motor2',
      });
      assert.equal(startM2.status, 201);

      clock.advanceByMs(65_000);
      runtime.scheduler.runCatchUpCycle();
      assert.ok(
        store.getMatch(matchId)!.state.campaignState!.nations[WORLD_NATIONS.north].learned.includes('motor2')
      );

      const revAtHP = store.getMatch(matchId)!.state.campaignState!.units.unt_vn_0001.rev;
      northSeq += 1;
      const fastMove = await sendCmd(north.token, WORLD_ACTORS.north, northSeq, {
        type: 'CAMPAIGN_MOVE_UNIT',
        nationId: WORLD_NATIONS.north,
        unitId: 'unt_vn_0001',
        toCityId: haNoiId,
        expectedRev: revAtHP,
      });
      assert.equal(fastMove.status, 201);
      const fastTrip = store.getMatch(matchId)!.state.campaignState!.units.unt_vn_0001.trip!;
      assert.equal(fastTrip.endUtc - fastTrip.startUtc, 24_000);

      // 8. Full deterministic replay check matches stored SHA-256 hash 100%
      const replayReport = store.verifyMatchReplay(matchId);
      assert.ok(replayReport);
      assert.equal(replayReport.verified, true);
      assert.equal(replayReport.replayedHash, replayReport.storedHash);

      wsSouth.close();
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('rejects research and mobilization cleanly when resources are insufficient', async () => {
    const startUtc = 1_760_100_000_000;
    const clock = new ManualClock(startUtc);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    try {
      const north = await registerUser(baseUrl, 'poor_north', 'Bắc Thiếu Kho');
      const south = await registerUser(baseUrl, 'poor_south', 'Nam');
      const { matchId } = await createAndStartCampaignRoom(baseUrl, north.token, south.token);

      // Spend North's supplies/components by queueing offices across 28 North cities simultaneously
      const northCities = VIETNAM_CAMPAIGN_CITIES.filter((c) => c.initialOwnerSlot === 'NORTH');
      let seq = 0;
      let hitInsufficient = false;
      for (const city of northCities) {
        const currentVersion = store.getMatch(matchId)!.state.version;
        const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${north.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            commandId: `cmd_spend_${city.index}`,
            matchId,
            actorId: WORLD_ACTORS.north,
            idempotencyKey: `idem_spend_${city.index}`,
            sequence: seq + 1,
            expectedVersion: currentVersion,
            issuedAtUtc: clock.nowUtc(),
            payload: {
              type: 'CAMPAIGN_START_CITY_PROJECT',
              nationId: WORLD_NATIONS.north,
              cityId: city.cityId,
              projectKey: 'factory', // costs 200 supplies, 150 components, 25 electronics, 300 money
            },
          }),
        });
        if (res.status === 201) {
          seq += 1;
        } else {
          assert.equal(res.status, 422);
          const body = (await res.json()) as { code: string };
          assert.equal(body.code, 'INSUFFICIENT_RESOURCES');
          hitInsufficient = true;
          break;
        }
      }
      assert.equal(hitInsufficient, true, 'Must reject city build when supplies/components are exhausted');

      // Now also verify insufficient resources rejects research cleanly without altering stateHash
      // Spend remaining supplies with offices until supplies < 180
      for (const city of northCities.slice(seq)) {
        const currentVersion = store.getMatch(matchId)!.state.version;
        const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${north.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            commandId: `cmd_off_${city.index}`,
            matchId,
            actorId: WORLD_ACTORS.north,
            idempotencyKey: `idem_off_${city.index}`,
            sequence: seq + 1,
            expectedVersion: currentVersion,
            issuedAtUtc: clock.nowUtc(),
            payload: {
              type: 'CAMPAIGN_START_CITY_PROJECT',
              nationId: WORLD_NATIONS.north,
              cityId: city.cityId,
              projectKey: 'office',
            },
          }),
        });
        if (res.status === 201) seq += 1;
        else break;
      }

      const hashBefore = store.getMatch(matchId)!.stateHash;
      const brokeStudy = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${north.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_broke_study',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_broke_study',
          sequence: seq + 1,
          expectedVersion: store.getMatch(matchId)!.state.version,
          issuedAtUtc: clock.nowUtc(),
          payload: {
            type: 'CAMPAIGN_START_RESEARCH',
            nationId: WORLD_NATIONS.north,
            doctrineKey: 'motor',
          },
        }),
      });
      assert.equal(brokeStudy.status, 422);
      assert.equal(((await brokeStudy.json()) as { code: string }).code, 'INSUFFICIENT_RESOURCES');
      assert.equal(store.getMatch(matchId)!.stateHash, hashBefore);
      assert.equal(store.verifyMatchReplay(matchId)?.verified, true);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('survives server restart mid-research and mid-mobilization without losing or duplicating units, balances, or replay hash', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-campaign-restart-'));
    const dbPath = path.join(tmpDir, 'campaign.sqlite');
    const restoreDbPath = path.join(tmpDir, 'campaign-restored.sqlite');

    const startUtc = 1_760_200_000_000;
    const clock = new ManualClock(startUtc);
    const haNoiId = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!.cityId;

    let matchId!: MatchId;
    let northToken = '';

    // Boot #1: Register, create campaign room, start research motor I + office at Hà Nội, then shutdown MID-QUEUE (+20s)
    {
      const { runtime, baseUrl, store } = await startTestRuntime({ dbPath, clock });
      try {
        const north = await registerUser(baseUrl, 'rst_north', 'Bắc Restart');
        const south = await registerUser(baseUrl, 'rst_south', 'Nam Restart');
        northToken = north.token;
        const created = await createAndStartCampaignRoom(baseUrl, north.token, south.token, 'Restart Mid-Queue');
        matchId = created.matchId;

        const postCmd = async (seq: number, payload: Record<string, unknown>) => {
          const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${north.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              commandId: `cmd_rst_${seq}`,
              matchId,
              actorId: WORLD_ACTORS.north,
              idempotencyKey: `idem_rst_${seq}`,
              sequence: seq,
              expectedVersion: store.getMatch(matchId)!.state.version,
              issuedAtUtc: clock.nowUtc(),
              payload,
            }),
          });
          assert.equal(res.status, 201);
        };

        await postCmd(1, {
          type: 'CAMPAIGN_START_RESEARCH',
          nationId: WORLD_NATIONS.north,
          doctrineKey: 'motor',
        });
        await postCmd(2, {
          type: 'CAMPAIGN_START_CITY_PROJECT',
          nationId: WORLD_NATIONS.north,
          cityId: haNoiId,
          projectKey: 'office',
        });
      } finally {
        await runtime.close();
        store.close();
      }
    }

    // Boot #2: Restart at +20s (still mid-queue), verify still pending, then advance to +46s, mobilize motor, shutdown MID-MOBILIZATION (+20s)
    clock.advanceByMs(20_000);
    {
      const { runtime, baseUrl, store } = await startTestRuntime({ dbPath, clock });
      try {
        runtime.scheduler.runCatchUpCycle();
        const mid = store.getMatch(matchId)!.state.campaignState!;
        assert.ok(mid.nations[WORLD_NATIONS.north].study !== null);
        assert.equal(mid.cities[haNoiId].office, 0);

        // Advance past 45s deadline -> catch up via authenticated GET /api/rooms/:matchId
        clock.advanceByMs(26_000);
        const snapRes = await fetch(`${baseUrl}/api/rooms/${matchId}`, {
          headers: { Authorization: `Bearer ${northToken}` },
        });
        assert.equal(snapRes.status, 200);
        const after46 = store.getMatch(matchId)!.state.campaignState!;
        assert.ok(after46.nations[WORLD_NATIONS.north].learned.includes('motor'));
        assert.equal(after46.cities[haNoiId].office, 1);

        // Queue mobilization at Hà Nội (50s), then crash/restart server at +25s!
        const mobRes = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${northToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            commandId: 'cmd_rst_mob_3',
            matchId,
            actorId: WORLD_ACTORS.north,
            idempotencyKey: 'idem_rst_mob_3',
            sequence: 3,
            expectedVersion: store.getMatch(matchId)!.state.version,
            issuedAtUtc: clock.nowUtc(),
            payload: {
              type: 'CAMPAIGN_START_CITY_PROJECT',
              nationId: WORLD_NATIONS.north,
              cityId: haNoiId,
              projectKey: 'motor',
            },
          }),
        });
        assert.equal(mobRes.status, 201);
        clock.advanceByMs(25_000);
      } finally {
        await runtime.close();
        store.close();
      }
    }

    // Boot #3: Restart AFTER mobilization deadline (+30s more => 55s elapsed since mob start)
    clock.advanceByMs(30_000);
    {
      const store3 = new SqliteMatchStore(dbPath);
      try {
        const scheduler3 = new MatchClockScheduler(store3, clock, { workerOwnerId: 'wrk_rst_3' });
        const run1 = scheduler3.runCatchUpCycle();
        assert.ok(run1.executedTicks >= 1);

        const after1 = store3.getMatch(matchId)!;
        const cs1 = after1.state.campaignState!;
        assert.deepEqual(Object.keys(cs1.units), ['unt_vn_0001']);
        assert.equal(cs1.units.unt_vn_0001.cityId, haNoiId);
        assert.equal(cs1.cities[haNoiId].jobs.length, 0);
        const balAfter1 = [...cs1.nations[WORLD_NATIONS.north].balance];

        // Running scheduler again at same clock MUST NOT duplicate unit or change balance/hash
        const run2 = scheduler3.runCatchUpCycle();
        assert.equal(run2.executedTicks, 0);
        const after2 = store3.getMatch(matchId)!;
        assert.equal(after2.stateHash, after1.stateHash);
        assert.deepEqual(Object.keys(after2.state.campaignState!.units), ['unt_vn_0001']);
        assert.deepEqual(after2.state.campaignState!.nations[WORLD_NATIONS.north].balance, balAfter1);

        // Verify full command-log replay and backup/restore integrity
        const replay = store3.verifyMatchReplay(matchId);
        assert.ok(replay?.verified);

        const backup = store3.exportMatchBackup(matchId, clock.nowUtc() as number)!;
        const restoredStore = new SqliteMatchStore(restoreDbPath);
        try {
          const restored = restoredStore.restoreMatchBackup(backup, clock.nowUtc() as number);
          assert.equal(restored.stateHash, after1.stateHash);
          assert.equal(restoredStore.verifyMatchReplay(matchId)?.verified, true);
        } finally {
          restoredStore.close();
        }
      } finally {
        store3.close();
      }
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates an existing 003 database cleanly to 004 preserving legacy vietnam_1955 rooms and replay hashes', async () => {
    const Database = (await import('better-sqlite3')).default;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-mig004-'));
    const dbPath = path.join(tmpDir, 'legacy003.sqlite');

    // Step 1: Create a store with a legacy vietnam_1955 room, then simulate pre-004 schema by recreating match_rooms without scenario_id
    let legacyMatchId!: MatchId;
    let legacyHash = '';
    {
      const store1 = new SqliteMatchStore(dbPath);
      const reg = store1.registerUser('mig_user', 'Người chơi cũ', 'LegacyPass123!', 1_760_300_000_000);
      assert.equal(reg.ok, true);
      if (!reg.ok) return;
      const created = store1.createRoom({
        creator: reg.user,
        title: 'Phòng lịch sử trước 004',
        preferredSlot: 'NORTH',
        nowUtc: 1_760_300_000_000,
        mode: 'PREVIEW_FIXTURE',
      });
      legacyMatchId = created.room.matchId;
      legacyHash = created.stateHash;
      store1.close();
    }

    // Downgrade schema to exact state after migration 003 (no scenario_id column, no 004 row in schema_migrations)
    {
      const rawDb = new Database(dbPath);
      rawDb.pragma('foreign_keys = OFF');
      rawDb.exec(`
        CREATE TABLE match_rooms_v2 (
          match_id TEXT PRIMARY KEY,
          invite_code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL,
          north_user_id TEXT,
          south_user_id TEXT,
          north_ready INTEGER NOT NULL DEFAULT 0,
          south_ready INTEGER NOT NULL DEFAULT 0,
          winner_slot TEXT,
          ended_reason TEXT,
          locked_at_utc INTEGER,
          created_at_utc INTEGER NOT NULL,
          updated_at_utc INTEGER NOT NULL
        );
        INSERT INTO match_rooms_v2 SELECT
          match_id, invite_code, title, status, created_by_user_id,
          north_user_id, south_user_id, north_ready, south_ready,
          winner_slot, ended_reason, locked_at_utc, created_at_utc, updated_at_utc
        FROM match_rooms;
        DROP TABLE match_rooms;
        ALTER TABLE match_rooms_v2 RENAME TO match_rooms;
        DELETE FROM schema_migrations WHERE id = '004_scenario_id_on_match_rooms';
      `);
      rawDb.close();
    }

    // Step 2: Reopen with SqliteMatchStore -> applies 004 cleanly and preserves legacy room & replay hash
    {
      const store2 = new SqliteMatchStore(dbPath);
      try {
        const migs = store2.getAppliedMigrations().map((m) => m.id);
        assert.ok(migs.includes('004_scenario_id_on_match_rooms'));
        const row = store2.getRoomRow(legacyMatchId);
        assert.ok(row);
        assert.equal(row.scenario_id, 'vietnam_1955');
        const replay = store2.verifyMatchReplay(legacyMatchId);
        assert.ok(replay?.verified);
        assert.equal(replay.storedHash, legacyHash);
      } finally {
        store2.close();
      }
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
