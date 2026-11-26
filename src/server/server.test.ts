import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  asUtcEpochMs,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  IdempotencyKeySchema,
  wholeUnitsToFixedPoint,
} from '../contracts';
import {
  createTwoFactionFictionalFixture,
  FIXTURE_ACTORS,
  FIXTURE_BASE_EPOCH_MS,
  FIXTURE_MATCH_ID,
  FIXTURE_NATIONS,
} from '../content/fictionalFixture';
import { ManualClock } from '../simulation';
import { DatabaseAccessError, loadServerConfig, ServerConfigError } from './config';
import { createServerRuntime } from './createApp';
import { SqliteMatchStore } from './db/sqliteStore';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('P01-01: server config detects missing production SQLITE_DB_PATH, invalid PORT, and enforces production fixture lock', () => {
  assert.throws(
    () => loadServerConfig({ APP_ENV: 'production', PORT: '3000' }),
    (err: unknown) => err instanceof ServerConfigError && err.missingOrInvalidFields.includes('SQLITE_DB_PATH')
  );

  assert.throws(
    () => loadServerConfig({ APP_ENV: 'preview', PORT: 'not-a-port' }),
    (err: unknown) => err instanceof ServerConfigError && err.missingOrInvalidFields.includes('PORT')
  );

  assert.throws(
    () => loadServerConfig({ APP_ENV: 'staging', PORT: '3000' }),
    (err: unknown) => err instanceof ServerConfigError && err.missingOrInvalidFields.includes('APP_ENV')
  );

  const prodConfig = loadServerConfig({
    APP_ENV: 'production',
    PORT: '3000',
    SQLITE_DB_PATH: '/tmp/prod-vdn.sqlite',
    ALLOW_PREVIEW_FIXTURE: 'true',
  });
  assert.equal(prodConfig.isProduction, true);
  assert.equal(prodConfig.allowPreviewFixture, false);

  // Zero-config Google AI Studio Preview defaults work without manual env input
  const previewDefaults = loadServerConfig({});
  assert.equal(previewDefaults.port, 3000);
  assert.equal(previewDefaults.appEnv, 'preview');
  assert.equal(previewDefaults.isProduction, false);
  assert.equal(previewDefaults.allowPreviewFixture, true);
  assert.ok(previewDefaults.sqliteDbPath.endsWith(path.join('data', 'vdn-preview.sqlite')));

  // Fail-safe: NODE_ENV=production infers production even when APP_ENV is omitted
  assert.throws(
    () => loadServerConfig({ NODE_ENV: 'production', ALLOW_PREVIEW_FIXTURE: 'true' }),
    (err: unknown) =>
      err instanceof ServerConfigError && err.missingOrInvalidFields.includes('SQLITE_DB_PATH')
  );
  const inferredProd = loadServerConfig({
    NODE_ENV: 'production',
    SQLITE_DB_PATH: '/tmp/prod-inferred.sqlite',
    ALLOW_PREVIEW_FIXTURE: 'true',
  });
  assert.equal(inferredProd.appEnv, 'production');
  assert.equal(inferredProd.isProduction, true);
  assert.equal(inferredProd.allowPreviewFixture, false);
});

test('P01-01: SqliteMatchStore rejects unwritable DB path cleanly with DatabaseAccessError', () => {
  const dir = makeTempDir('vdn-unwritable-');
  try {
    // Passing a directory path as SQLite file path MUST fail explicitly
    assert.throws(
      () => new SqliteMatchStore(dir),
      (err: unknown) => err instanceof DatabaseAccessError
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P01-01 & P01-03: SQLite persistence survives close/reopen restart and replay hash verifies 100%', () => {
  const dir = makeTempDir('vdn-restart-');
  const dbPath = path.join(dir, 'persist.sqlite');
  const clock = new ManualClock(FIXTURE_BASE_EPOCH_MS + 5_000);

  try {
    const store1 = new SqliteMatchStore(dbPath);
    const fixture = createTwoFactionFictionalFixture({ createdAtUtc: FIXTURE_BASE_EPOCH_MS });
    store1.saveInitialMatch(fixture);

    const execRes = store1.executeCommand(
      FIXTURE_MATCH_ID,
      {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse('cmd_persist_01'),
        matchId: FIXTURE_MATCH_ID,
        actorId: FIXTURE_ACTORS.north,
        idempotencyKey: IdempotencyKeySchema.parse('idem_persist_01'),
        sequence: 1,
        expectedVersion: 0,
        issuedAtUtc: clock.nowUtc(),
        payload: {
          type: 'TRANSFER_RESOURCE',
          fromNationId: FIXTURE_NATIONS.north,
          toNationId: FIXTURE_NATIONS.south,
          resource: 'treasury',
          amountFp: wholeUnitsToFixedPoint(25),
          reason: 'Restart survival test',
        },
      },
      clock
    );

    assert.equal(execRes.found, true);
    if (!execRes.found || !execRes.result.ok) {
      assert.fail('Expected command execution to succeed');
    }
    const savedHash = execRes.result.stateHash;
    store1.close();

    // Simulate full server restart by opening a fresh SqliteMatchStore on the same file
    const store2 = new SqliteMatchStore(dbPath);
    const reloaded = store2.getMatch(FIXTURE_MATCH_ID);
    assert.ok(reloaded);
    assert.equal(reloaded.state.version, 1);
    assert.equal(reloaded.stateHash, savedHash);
    assert.equal(reloaded.state.nations[FIXTURE_NATIONS.north].resources.treasury, 325_000);
    assert.equal(reloaded.state.nations[FIXTURE_NATIONS.south].resources.treasury, 405_000);

    const replayReport = store2.verifyMatchReplay(FIXTURE_MATCH_ID);
    assert.ok(replayReport);
    assert.equal(replayReport.verified, true);
    assert.equal(replayReport.storedHash, replayReport.replayedHash);
    assert.equal(replayReport.replayedCommandCount, 1);
    store2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P01-01/02/03 Integration: Express HTTP + WebSocket /ws + auth + idempotency + replay + production guard', async () => {
  const dir = makeTempDir('vdn-int-');
  const dbPath = path.join(dir, 'integration.sqlite');
  const clock = new ManualClock(FIXTURE_BASE_EPOCH_MS + 10_000);

  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: dbPath,
    ALLOW_PREVIEW_FIXTURE: 'true',
  });
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const runtime = createServerRuntime(config, store, clock);

  await new Promise<void>((resolve) => runtime.httpServer.listen(0, '127.0.0.1', () => resolve()));
  const { port } = runtime.httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  let ws: WebSocket | null = null;
  try {
    // 1. Check /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as {
      status: string;
      aiApiDependency: boolean;
      database: { writable: boolean; appliedMigrations: string[] };
      realtimePolicy: { secondsPerGameDay: number; allowFastForward: boolean };
    };
    assert.equal(health.status, 'ok');
    assert.equal(health.aiApiDependency, false);
    assert.equal(health.database.writable, true);
    assert.ok(health.database.appliedMigrations.includes('001_initial_foundation'));
    assert.equal(health.realtimePolicy.secondsPerGameDay, 86400);
    assert.equal(health.realtimePolicy.allowFastForward, false);

    // 2. Connect real WebSocket and verify system:connected + ping/pong
    const receivedFrames: Record<string, unknown>[] = [];
    ws = new WebSocket(wsUrl);
    const firstFramePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ws!.once('message', (data) => resolve(JSON.parse(String(data)) as Record<string, unknown>));
      ws!.once('error', reject);
    });
    await new Promise<void>((resolve, reject) => {
      ws!.once('open', () => resolve());
      ws!.once('error', reject);
    });
    const firstFrame = await firstFramePromise;
    assert.equal(firstFrame.type, 'system:connected');

    ws.on('message', (data) => {
      receivedFrames.push(JSON.parse(String(data)) as Record<string, unknown>);
    });
    ws.send(JSON.stringify({ type: 'ping', clientTs: 12345 }));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(receivedFrames.some((f) => f.type === 'pong' && f.clientTs === 12345));

    // 3. Create preview fixture and ensure secrets are stripped
    const fxRes = await fetch(`${baseUrl}/api/matches/fixture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });
    assert.equal(fxRes.status, 201);
    const fxJson = (await fxRes.json()) as { ok: boolean; match: Record<string, unknown> };
    assert.equal(fxJson.ok, true);
    assert.equal('serverPrivate' in fxJson.match, false);

    // 4. Reject missing x-actor-id header (401)
    const validCmd = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: 'cmd_http_01',
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.north,
      idempotencyKey: 'idem_http_transfer_01',
      sequence: 1,
      expectedVersion: 0,
      issuedAtUtc: asUtcEpochMs(FIXTURE_BASE_EPOCH_MS + 10_000),
      payload: {
        type: 'TRANSFER_RESOURCE',
        fromNationId: FIXTURE_NATIONS.north,
        toNationId: FIXTURE_NATIONS.npcHighland,
        resource: 'food',
        amountFp: wholeUnitsToFixedPoint(15),
        reason: 'HTTP integration transfer',
      },
    };

    const unauthRes = await fetch(`${baseUrl}/api/matches/${FIXTURE_MATCH_ID}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCmd),
    });
    assert.equal(unauthRes.status, 401);

    // 5. Reject actor impersonation header mismatch (403)
    const spoofRes = await fetch(`${baseUrl}/api/matches/${FIXTURE_MATCH_ID}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-id': FIXTURE_ACTORS.south,
      },
      body: JSON.stringify(validCmd),
    });
    assert.equal(spoofRes.status, 403);

    // 6. Execute valid command -> 201 + WebSocket broadcast
    const okRes = await fetch(`${baseUrl}/api/matches/${FIXTURE_MATCH_ID}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-id': FIXTURE_ACTORS.north,
      },
      body: JSON.stringify(validCmd),
    });
    assert.equal(okRes.status, 201);
    const okData = (await okRes.json()) as {
      ok: boolean;
      idempotentDuplicate: boolean;
      version: number;
      stateHash: string;
    };
    assert.equal(okData.ok, true);
    assert.equal(okData.idempotentDuplicate, false);
    assert.equal(okData.version, 1);

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(receivedFrames.some((f) => f.type === 'match:events' && f.version === 1));

    // 7. Re-submit duplicate command -> 200 idempotentDuplicate: true
    const dupRes = await fetch(`${baseUrl}/api/matches/${FIXTURE_MATCH_ID}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-id': FIXTURE_ACTORS.north,
      },
      body: JSON.stringify(validCmd),
    });
    assert.equal(dupRes.status, 200);
    const dupData = (await dupRes.json()) as {
      ok: boolean;
      idempotentDuplicate: boolean;
      version: number;
      stateHash: string;
    };
    assert.equal(dupData.idempotentDuplicate, true);
    assert.equal(dupData.version, 1);
    assert.equal(dupData.stateHash, okData.stateHash);

    // 8. Verify deterministic replay over HTTP
    const verifyRes = await fetch(`${baseUrl}/api/matches/${FIXTURE_MATCH_ID}/verify-replay`, {
      method: 'POST',
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = (await verifyRes.json()) as {
      ok: boolean;
      report: { verified: boolean; storedHash: string; replayedHash: string };
    };
    assert.equal(verifyData.report.verified, true);
    assert.equal(verifyData.report.storedHash, okData.stateHash);
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    await runtime.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P01-01: production mode blocks preview fixture endpoint (403)', async () => {
  const dir = makeTempDir('vdn-prod-');
  const dbPath = path.join(dir, 'prod.sqlite');
  const prodConfig = loadServerConfig({
    APP_ENV: 'production',
    PORT: '0',
    SQLITE_DB_PATH: dbPath,
  });
  const store = new SqliteMatchStore(prodConfig.sqliteDbPath);
  const runtime = createServerRuntime(prodConfig, store);

  await new Promise<void>((resolve) => runtime.httpServer.listen(0, '127.0.0.1', () => resolve()));
  const { port } = runtime.httpServer.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/matches/fixture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'PREVIEW_FIXTURE_DISABLED');
  } finally {
    await runtime.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
