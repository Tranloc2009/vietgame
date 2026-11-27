import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import {
  asUtcEpochMs,
  CONTRACT_SCHEMA_VERSION,
  wholeUnitsToFixedPoint,
} from '../contracts';
import { WORLD_ACTORS, WORLD_NATIONS } from '../content/worldMap72';
import { ManualClock } from '../simulation';
import { loadServerConfig } from './config';
import { createServerRuntime, ServerRuntime } from './createApp';
import { SqliteMatchStore } from './db/sqliteStore';
import { MatchClockScheduler } from './scheduler';

async function startTestRuntime(options?: {
  dbPath?: string;
  clock?: ManualClock;
}): Promise<{ runtime: ServerRuntime; baseUrl: string; wsUrl: string; store: SqliteMatchStore }> {
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: options?.dbPath ?? ':memory:',
  });
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const clock = options?.clock ?? new ManualClock(1_750_000_000_000);
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

describe('Phase 02 Integration — Rooms, Persistence/Clock, and Live Filtered Sync', () => {
  it('previews an authoritative friendly route without applying a move or exposing another unit', async () => {
    const clock = new ManualClock(1_750_000_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });
    try {
      const north = await registerUser(baseUrl, 'route_north', 'Bắc');
      const south = await registerUser(baseUrl, 'route_south', 'Nam');
      const post = (token: string, route: string, data: object) => fetch(baseUrl + route, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const created = await post(north.token, '/api/rooms', { title: 'Kiểm tuyến', preferredSlot: 'NORTH' });
      assert.equal(created.status, 201);
      const { room } = await created.json();
      const roomPath = `/api/rooms/${room.matchId}`;
      const state = store.getMatch(room.matchId)!.state;
      const unit = state.units.unt_north_hq_01;
      const targetId = state.regions[unit.regionId].adjacentRegionIds.find(
        (id) => state.regions[id].controllerNationId === unit.ownerNationId
      )!;
      assert.ok(targetId);
      const url = `${baseUrl}${roomPath}/movement-preview?unitId=${unit.unitId}&destinationId=${targetId}`;
      const preview = (token: string, endpoint = url) => fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert.equal((await fetch(url)).status, 401);
      assert.equal((await preview(north.token)).status, 409);
      assert.equal((await post(south.token, '/api/rooms/join', { inviteCode: room.inviteCode })).status, 200);
      for (const player of [north, south]) {
        assert.equal((await post(player.token, roomPath + '/ready', { ready: true })).status, 200);
      }
      assert.equal((await post(north.token, roomPath + '/start', {})).status, 200);
      const before = store.getMatch(room.matchId)!;

      const response = await preview(north.token);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.originId, unit.regionId);
      assert.equal(result.destinationId, targetId);
      assert.equal(result.regions[0].id, unit.regionId);
      assert.equal(result.regions.at(-1).id, targetId);
      assert.equal(result.estimatedArrivalUtc, Math.max(clock.nowUtc(), before.state.currentUtc) + result.durationMs);
      assert.ok(result.durationMs > 0);
      for (const { id } of result.regions) {
        assert.equal(before.state.regions[id].controllerNationId, unit.ownerNationId);
      }

      assert.equal((await preview(south.token)).status, 404);
      assert.equal((await preview(north.token, url.replace(targetId, unit.regionId))).status, 422);
      assert.equal((await preview(north.token, url.replace(targetId, 'reg_vn_59'))).status, 422);
      assert.deepEqual(await (await preview(north.token)).json(), result);
      assert.equal(store.getMatch(room.matchId)!.stateHash, before.stateHash);
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('P02-01: enforces 2 human slots, invite join, lock on start, reconnect slot preservation, anti-spoofing, and surrender', async () => {
    const clock = new ManualClock(1_750_000_000_000);
    const { runtime, baseUrl, store } = await startTestRuntime({ clock });

    try {
      const north = await registerUser(baseUrl, 'cmd_north', 'Chỉ huy Bắc');
      const south = await registerUser(baseUrl, 'cmd_south', 'Chỉ huy Nam');
      const third = await registerUser(baseUrl, 'intruder_3', 'Người thứ 3');

      // 1. North creates room
      const createRes = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${north.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Trận 2 Slot Kiểm Chứng', preferredSlot: 'NORTH' }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as {
        room: { matchId: string; inviteCode: string; status: string; viewerSlot: string };
      };
      assert.equal(created.room.status, 'LOBBY');
      assert.equal(created.room.viewerSlot, 'NORTH');
      const { matchId, inviteCode } = created.room;

      // 2. South joins via invite code
      const joinSouthRes = await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${south.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inviteCode }),
      });
      assert.equal(joinSouthRes.status, 200);
      const joinedSouth = (await joinSouthRes.json()) as {
        reconnected: boolean;
        room: { viewerSlot: string };
      };
      assert.equal(joinedSouth.reconnected, false);
      assert.equal(joinedSouth.room.viewerSlot, 'SOUTH');

      // 3. Third player rejected when both slots are occupied
      const thirdJoinRes = await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${third.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inviteCode }),
      });
      assert.equal(thirdJoinRes.status, 403);
      assert.equal(((await thirdJoinRes.json()) as { code: string }).code, 'ROOM_FULL');

      // 4. Cannot start before both players are Ready
      const earlyStart = await fetch(`${baseUrl}/api/rooms/${matchId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${north.token}` },
      });
      assert.equal(earlyStart.status, 422);
      assert.equal(((await earlyStart.json()) as { code: string }).code, 'PLAYERS_NOT_READY');

      // 5. Both Ready -> Start locks slots
      assert.equal(
        (
          await fetch(`${baseUrl}/api/rooms/${matchId}/ready`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${north.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ready: true }),
          })
        ).status,
        200
      );
      assert.equal(
        (
          await fetch(`${baseUrl}/api/rooms/${matchId}/ready`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${south.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ready: true }),
          })
        ).status,
        200
      );

      const startRes = await fetch(`${baseUrl}/api/rooms/${matchId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${north.token}` },
      });
      assert.equal(startRes.status, 200);
      const started = (await startRes.json()) as {
        room: { status: string; lockedAtUtc: number | null };
      };
      assert.equal(started.room.status, 'ACTIVE');
      assert.ok(started.room.lockedAtUtc !== null);

      // 6. Third player blocked after start (SLOTS_LOCKED & NOT_ROOM_MEMBER)
      const thirdAfterStart = await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${third.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inviteCode }),
      });
      assert.equal(thirdAfterStart.status, 403);
      assert.equal(((await thirdAfterStart.json()) as { code: string }).code, 'SLOTS_LOCKED');

      const thirdRead = await fetch(`${baseUrl}/api/rooms/${matchId}`, {
        headers: { Authorization: `Bearer ${third.token}` },
      });
      assert.equal(thirdRead.status, 403);
      assert.equal(((await thirdRead.json()) as { code: string }).code, 'NOT_ROOM_MEMBER');

      // 7. South logs in again and reconnects -> preserves SOUTH slot even after lock!
      const reloginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'cmd_south', password: 'SecurePass123!' }),
      });
      const southNewToken = ((await reloginRes.json()) as { token: string }).token;
      const reconnectRes = await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${southNewToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inviteCode }),
      });
      assert.equal(reconnectRes.status, 200);
      const reconnected = (await reconnectRes.json()) as {
        reconnected: boolean;
        room: { viewerSlot: string };
      };
      assert.equal(reconnected.reconnected, true);
      assert.equal(reconnected.room.viewerSlot, 'SOUTH');

      // 8. Spoof check: North cannot send command with South's nationId or actorId or ADVANCE_REALTIME_TICK
      const spoofNationRes = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${north.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_spoof_nation',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_spoof_nation',
          sequence: 1,
          expectedVersion: 0,
          issuedAtUtc: clock.nowUtc(),
          payload: {
            type: 'TRANSFER_RESOURCE',
            fromNationId: WORLD_NATIONS.south,
            toNationId: WORLD_NATIONS.north,
            resource: 'food',
            amountFp: wholeUnitsToFixedPoint(5),
            reason: 'Spoof test',
          },
        }),
      });
      assert.equal(spoofNationRes.status, 403);
      assert.equal(
        ((await spoofNationRes.json()) as { code: string }).code,
        'FORBIDDEN_NATION_IMPERSONATION'
      );

      const spoofTickRes = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${north.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_spoof_tick',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_spoof_tick',
          sequence: 1,
          expectedVersion: 0,
          issuedAtUtc: clock.nowUtc(),
          payload: {
            type: 'ADVANCE_REALTIME_TICK',
            targetUtc: asUtcEpochMs((clock.nowUtc() as number) + 86_400_000),
          },
        }),
      });
      assert.equal(spoofTickRes.status, 403);
      assert.equal(
        ((await spoofTickRes.json()) as { code: string }).code,
        'FORBIDDEN_SYSTEM_COMMAND'
      );

      // P01 unauthenticated route must refuse multiplayer rooms
      const bypassP01 = await fetch(`${baseUrl}/api/matches/${matchId}/commands`, {
        method: 'POST',
        headers: {
          'x-actor-id': WORLD_ACTORS.north,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(bypassP01.status, 403);

      // 9. Surrender transitions to ENDED and assigns winner to opponent
      const surrenderRes = await fetch(`${baseUrl}/api/rooms/${matchId}/surrender`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${southNewToken}` },
      });
      assert.equal(surrenderRes.status, 200);
      const surrendered = (await surrenderRes.json()) as {
        room: { status: string; winnerSlot: string; endedReason: string };
      };
      assert.equal(surrendered.room.status, 'ENDED');
      assert.equal(surrendered.room.winnerSlot, 'NORTH');
      assert.equal(surrendered.room.endedReason, 'SURRENDER');
    } finally {
      await runtime.close();
      store.close();
    }
  });

  it('P02-02: survives mid-job server restart without losing or duplicating jobs, ignores client clock, enforces worker lock, and matches backup/restore SHA-256 hash', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-p02-'));
    const dbPath = path.join(tmpDir, 'primary.sqlite');
    const restoreDbPath = path.join(tmpDir, 'restored.sqlite');

    const startUtc = 1_750_000_000_000;
    const clock = new ManualClock(startUtc);

    let matchId = '';
    let originalHash = '';

    // --- Boot #1: create room, start, schedule 900s job with spoofed future client timestamp ---
    {
      const { runtime, baseUrl, store } = await startTestRuntime({ dbPath, clock });
      try {
        const north = await registerUser(baseUrl, 'clk_north', 'Bắc');
        const south = await registerUser(baseUrl, 'clk_south', 'Nam');

        const created = (await (
          await fetch(`${baseUrl}/api/rooms`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${north.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: 'Clock Restart Test', preferredSlot: 'NORTH' }),
          })
        ).json()) as { room: { matchId: string; inviteCode: string } };
        matchId = created.room.matchId;

        await fetch(`${baseUrl}/api/rooms/join`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${south.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inviteCode: created.room.inviteCode }),
        });

        for (const tok of [north.token, south.token]) {
          await fetch(`${baseUrl}/api/rooms/${matchId}/ready`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ready: true }),
          });
        }
        await fetch(`${baseUrl}/api/rooms/${matchId}/start`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${north.token}` },
        });

        // Client lies with issuedAtUtc 10 days in the future — server MUST use server clock!
        const jobRes = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${north.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            commandId: 'cmd_job_restart_1',
            matchId,
            actorId: WORLD_ACTORS.north,
            idempotencyKey: 'idem_job_restart_1',
            sequence: 1,
            expectedVersion: 0,
            issuedAtUtc: asUtcEpochMs(startUtc + 10 * 86_400_000),
            payload: {
              type: 'SCHEDULE_JOB',
              jobId: 'job_bridge_01',
              nationId: WORLD_NATIONS.north,
              kind: 'INFRASTRUCTURE_WORK',
              durationMs: 900_000,
              costResource: 'industrial',
              costAmountFp: wholeUnitsToFixedPoint(10),
            },
          }),
        });
        assert.equal(jobRes.status, 201);
        const jobBody = (await jobRes.json()) as {
          match: {
            currentUtc: number;
            jobs: Record<string, { completesAtUtc: number; status: string }>;
          };
        };
        assert.equal(jobBody.match.currentUtc, startUtc);
        assert.equal(jobBody.match.jobs.job_bridge_01.completesAtUtc, startUtc + 900_000);
        assert.equal(jobBody.match.jobs.job_bridge_01.status, 'SCHEDULED');

        // Verify sanitized backup-summary HTTP route leaks zero secrets
        const summaryRes = await fetch(`${baseUrl}/api/rooms/${matchId}/backup-summary`, {
          headers: { Authorization: `Bearer ${north.token}` },
        });
        assert.equal(summaryRes.status, 200);
        const summaryRaw = await summaryRes.text();
        assert.ok(!summaryRaw.includes('serverPrivate'));
        assert.ok(!summaryRaw.includes('hiddenIntelDigest'));
        assert.ok(summaryRaw.includes('"secretsIncluded":false'));
      } finally {
        await runtime.close();
        store.close();
      }
    }

    // --- Boot #2: Restart mid-job (+300s, BEFORE 900s deadline) ---
    clock.advanceByMs(300_000);
    {
      const store2 = new SqliteMatchStore(dbPath);
      try {
        const scheduler2 = new MatchClockScheduler(store2, clock, { workerOwnerId: 'wrk_boot2' });
        const report = scheduler2.runCatchUpCycle();
        assert.ok(report.executedTicks >= 1);

        const loaded = store2.getMatch(matchId as never);
        assert.ok(loaded);
        assert.equal(loaded.state.jobs.job_bridge_01.status, 'SCHEDULED');
      } finally {
        store2.close();
      }
    }

    // --- Boot #3: Restart AFTER deadline (+700s more => total +1000s > 900s) ---
    clock.advanceByMs(700_000);
    {
      const store3 = new SqliteMatchStore(dbPath);
      try {
        // Test worker lock contention: worker A holds lease -> worker B skips
        const locked = store3.acquireMatchWorkerLock(
          matchId as never,
          'wrk_holder',
          clock.nowUtc() as number,
          30_000
        );
        assert.equal(locked, true);

        const contender = new MatchClockScheduler(store3, clock, { workerOwnerId: 'wrk_contender' });
        const blockedReport = contender.runCatchUpCycle();
        assert.equal(blockedReport.skippedLockedMatches, 1);
        assert.equal(blockedReport.executedTicks, 0);

        store3.releaseMatchWorkerLock(matchId as never, 'wrk_holder');

        // Now run actual catch-up twice -> job must complete ONCE, never duplicated!
        const scheduler3 = new MatchClockScheduler(store3, clock, { workerOwnerId: 'wrk_boot3' });
        const firstRun = scheduler3.runCatchUpCycle();
        assert.ok(firstRun.executedTicks >= 1);

        const afterFirst = store3.getMatch(matchId as never)!;
        assert.equal(afterFirst.state.jobs.job_bridge_01.status, 'COMPLETED');
        assert.equal(afterFirst.state.jobs.job_bridge_01.completesAtUtc, startUtc + 900_000);
        const completionEvents = afterFirst.state.events.filter(
          (e) => e.payload.type === 'JOB_COMPLETED'
        );
        assert.equal(completionEvents.length, 1);
        originalHash = afterFirst.stateHash;

        // Second run at same UTC must execute 0 ticks and keep exact same hash
        const secondRun = scheduler3.runCatchUpCycle();
        assert.equal(secondRun.executedTicks, 0);
        assert.equal(store3.getMatch(matchId as never)!.stateHash, originalHash);

        // Export full server-side backup & restore into fresh SQLite DB -> SHA-256 must match!
        const backup = store3.exportMatchBackup(matchId as never, clock.nowUtc() as number);
        assert.ok(backup);
        assert.equal(backup.stateHash, originalHash);

        const restoredStore = new SqliteMatchStore(restoreDbPath);
        try {
          const restored = restoredStore.restoreMatchBackup(backup, clock.nowUtc() as number);
          assert.equal(restored.stateHash, originalHash);

          const replay = restoredStore.verifyMatchReplay(matchId as never);
          assert.ok(replay);
          assert.equal(replay.verified, true);
          assert.equal(replay.replayedHash, originalHash);
        } finally {
          restoredStore.close();
        }
      } finally {
        store3.close();
      }
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('P02-04: delivers permission-filtered snapshots with fog-of-war, zero secret leakage, identical public deltas to both clients, and gap resync after disconnect', async () => {
    const clock = new ManualClock(1_750_000_000_000);
    const { runtime, baseUrl, wsUrl, store } = await startTestRuntime({ clock });

    try {
      const north = await registerUser(baseUrl, 'sync_north', 'Bắc Sync');
      const south = await registerUser(baseUrl, 'sync_south', 'Nam Sync');
      const outsider = await registerUser(baseUrl, 'sync_out', 'Ngoài Cuộc');

      const created = (await (
        await fetch(`${baseUrl}/api/rooms`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${north.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Sync & Fog Test', preferredSlot: 'NORTH' }),
        })
      ).json()) as { room: { matchId: string; inviteCode: string } };
      const { matchId, inviteCode } = created.room;

      await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${south.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inviteCode }),
      });

      for (const tok of [north.token, south.token]) {
        await fetch(`${baseUrl}/api/rooms/${matchId}/ready`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ready: true }),
        });
      }
      await fetch(`${baseUrl}/api/rooms/${matchId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${north.token}` },
      });

      // Connect outsider WS -> must get room:error NOT_ROOM_MEMBER
      const wsOut = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => wsOut.once('open', resolve));
      const outErrPromise = waitForWsMessage(wsOut, (m) => m.type === 'room:error');
      wsOut.send(JSON.stringify({ type: 'room:subscribe', token: outsider.token, matchId }));
      const outErr = await outErrPromise;
      assert.equal(outErr.code, 'NOT_ROOM_MEMBER');
      wsOut.close();

      // Connect North & South WS clients
      const wsNorth = new WebSocket(wsUrl);
      const wsSouth = new WebSocket(wsUrl);
      await Promise.all([
        new Promise<void>((resolve) => wsNorth.once('open', resolve)),
        new Promise<void>((resolve) => wsSouth.once('open', resolve)),
      ]);

      const northSnapPromise = waitForWsMessage(wsNorth, (m) => m.type === 'room:snapshot');
      const southSnapPromise = waitForWsMessage(wsSouth, (m) => m.type === 'room:snapshot');

      wsNorth.send(JSON.stringify({ type: 'room:subscribe', token: north.token, matchId }));
      wsSouth.send(JSON.stringify({ type: 'room:subscribe', token: south.token, matchId }));

      const [northSnap, southSnap] = await Promise.all([northSnapPromise, southSnapPromise]);
      const northSerialized = JSON.stringify(northSnap);
      const southSerialized = JSON.stringify(southSnap);

      // Zero server secrets in either snapshot
      for (const payloadStr of [northSerialized, southSerialized]) {
        assert.ok(!payloadStr.includes('serverPrivate'));
        assert.ok(!payloadStr.includes('initialSeed'));
        assert.ok(!payloadStr.includes('rngState'));
        assert.ok(!payloadStr.includes('hiddenIntelDigest'));
      }

      const nMatch = northSnap.match as {
        stateHash: string;
        nations: Record<string, unknown>;
        units: Record<string, { readinessFp: number; supplyFp: number }>;
        redactedUnitIds: string[];
      };
      const sMatch = southSnap.match as typeof nMatch;

      // Identical public data for both players
      assert.equal(nMatch.stateHash, sMatch.stateHash);
      assert.deepEqual(nMatch.nations, sMatch.nations);

      // Symmetric fog-of-war redaction on opposing units
      assert.ok(nMatch.units.unt_north_hq_01.readinessFp > 0);
      assert.equal(nMatch.units.unt_south_hq_01.readinessFp, 0);
      assert.ok(nMatch.redactedUnitIds.includes('unt_south_hq_01'));

      assert.ok(sMatch.units.unt_south_hq_01.readinessFp > 0);
      assert.equal(sMatch.units.unt_north_hq_01.readinessFp, 0);
      assert.ok(sMatch.redactedUnitIds.includes('unt_north_hq_01'));

      // Execute command from North -> both clients receive identical sequenced room:delta
      const northDeltaPromise = waitForWsMessage(wsNorth, (m) => m.type === 'room:delta');
      const southDeltaPromise = waitForWsMessage(wsSouth, (m) => m.type === 'room:delta');

      const cmd1Res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${north.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: 'cmd_sync_1',
          matchId,
          actorId: WORLD_ACTORS.north,
          idempotencyKey: 'idem_sync_1',
          sequence: 1,
          expectedVersion: 0,
          issuedAtUtc: clock.nowUtc(),
          payload: {
            type: 'TRANSFER_RESOURCE',
            fromNationId: WORLD_NATIONS.north,
            toNationId: WORLD_NATIONS.npcHighland,
            resource: 'food',
            amountFp: wholeUnitsToFixedPoint(5),
            reason: 'Sync delta 1',
          },
        }),
      });
      assert.equal(cmd1Res.status, 201);

      const [nDelta, sDelta] = await Promise.all([northDeltaPromise, southDeltaPromise]);
      assert.equal(nDelta.fromSequence, 1);
      assert.equal(nDelta.toSequence, 1);
      assert.equal(nDelta.stateHash, sDelta.stateHash);
      assert.deepEqual(nDelta.events, sDelta.events);

      // Simulate South disconnect while North executes 2 more commands -> South resyncs via HTTP & WS
      wsSouth.close();

      for (const seq of [2, 3]) {
        const res = await fetch(`${baseUrl}/api/rooms/${matchId}/commands`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${north.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            commandId: `cmd_sync_${seq}`,
            matchId,
            actorId: WORLD_ACTORS.north,
            idempotencyKey: `idem_sync_${seq}`,
            sequence: seq,
            expectedVersion: seq - 1,
            issuedAtUtc: clock.nowUtc(),
            payload: {
              type: 'TRANSFER_RESOURCE',
              fromNationId: WORLD_NATIONS.north,
              toNationId: WORLD_NATIONS.npcHighland,
              resource: 'food',
              amountFp: wholeUnitsToFixedPoint(2),
              reason: `Sync delta ${seq}`,
            },
          }),
        });
        assert.equal(res.status, 201);
      }

      // South catches up via GET /api/rooms/:matchId/sync?sinceSequence=1
      const syncRes = await fetch(`${baseUrl}/api/rooms/${matchId}/sync?sinceSequence=1`, {
        headers: { Authorization: `Bearer ${south.token}` },
      });
      assert.equal(syncRes.status, 200);
      const syncBody = (await syncRes.json()) as {
        currentSequence: number;
        missedEvents: { sequence: number }[];
        match: { stateHash: string; units: Record<string, { readinessFp: number }> };
      };
      assert.equal(syncBody.currentSequence, 3);
      assert.deepEqual(
        syncBody.missedEvents.map((e) => e.sequence),
        [2, 3]
      );
      assert.equal(syncBody.match.units.unt_north_hq_01.readinessFp, 0);

      // Also verify WS room:resync after reconnect delivers missed delta events 2..3
      const wsSouth2 = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => wsSouth2.once('open', resolve));
      const snap2 = waitForWsMessage(wsSouth2, (m) => m.type === 'room:snapshot');
      wsSouth2.send(JSON.stringify({ type: 'room:subscribe', token: south.token, matchId }));
      await snap2;

      const resyncDelta = waitForWsMessage(wsSouth2, (m) => m.type === 'room:delta');
      wsSouth2.send(JSON.stringify({ type: 'room:resync', matchId, sinceSequence: 1 }));
      const deltaMsg = await resyncDelta;
      assert.equal(deltaMsg.fromSequence, 2);
      assert.equal(deltaMsg.toSequence, 3);

      wsNorth.close();
      wsSouth2.close();
    } finally {
      await runtime.close();
      store.close();
    }
  });
});
