import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT_SCHEMA_VERSION } from '../src/contracts';
import { WORLD_ACTORS, WORLD_NATIONS } from '../src/content/worldMap72';
import { VIETNAM_CAMPAIGN_CITY_BY_NAME, VIETNAM_CAMPAIGN_SCENARIO_ID } from '../src/content/vietnamCampaignScenario';
import { loadServerConfig } from '../src/server/config';
import { createServerRuntime, ServerRuntime } from '../src/server/createApp';
import { SqliteMatchStore } from '../src/server/db/sqliteStore';
import { ManualClock } from '../src/simulation';

declare const live: any;
declare const mp: any;
declare const camera: any;
declare const draw: () => void;
declare function pullOnlineSnapshot(): Promise<boolean>;

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(playwrightPath) as {
  chromium: {
    launch: (opts: Record<string, unknown>) => Promise<any>;
  };
};

async function bootServer(dbPath: string, clock: ManualClock): Promise<{
  runtime: ServerRuntime;
  store: SqliteMatchStore;
  baseUrl: string;
}> {
  const store = new SqliteMatchStore(dbPath);
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: '0',
    SQLITE_DB_PATH: dbPath,
  });
  const runtime = createServerRuntime(config, store, clock, {
    authMaxPerMin: 500,
    commandMaxPerMin: 500,
    wsMaxPer10s: 500,
  });
  runtime.app.use('/assets', express.static(path.resolve(process.cwd(), 'public/assets')));
  runtime.app.get('/', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'index.html'));
  });
  await new Promise<void>((resolve) => {
    runtime.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = runtime.httpServer.address();
  assert.ok(addr && typeof addr === 'object');
  return { runtime, store, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function apiJson(url: string, opts?: { method?: string; token?: string; body?: unknown }) {
  const headers: Record<string, string> = {};
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, {
    method: opts?.method ?? 'GET',
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

(async () => {
  const outDir = path.resolve(process.cwd(), 'kiem-thu');
  fs.mkdirSync(outDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdn-t09-qa-'));
  const dbPath = path.join(tmpDir, 't09.sqlite');
  const clock = new ManualClock(1_765_000_000_000);
  const { runtime, store, baseUrl } = await bootServer(dbPath, clock);

  const browser = await chromium.launch({ channel: 'msedge' });

  try {
    // 1) Set up a rich live match with NORTH & SOUTH units across all 5 GLB-backed ground unit families
    //    (Reserve, Motor Tier I -> Tier II motor2 upgrade, Recon, Artillery, Tank) facing each other at Đà Nẵng & Quảng Ngãi!
    const regN = await apiJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { username: 't09_north', displayName: 'Chỉ huy Phương Bắc', password: 'Password123!' },
    });
    const regS = await apiJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { username: 't09_south', displayName: 'Chỉ huy Phương Nam', password: 'Password123!' },
    });
    assert.equal(regN.status, 201);
    assert.equal(regS.status, 201);
    const northToken = regN.data.token as string;
    const southToken = regS.data.token as string;

    const createRoom = await apiJson(`${baseUrl}/api/rooms`, {
      method: 'POST',
      token: northToken,
      body: { title: 'Chiến dịch T09 3D', preferredSlot: 'NORTH', scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID },
    });
    assert.equal(createRoom.status, 201);
    const matchId = createRoom.data.room.matchId as string;
    const inviteCode = createRoom.data.room.inviteCode as string;

    await apiJson(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      token: southToken,
      body: { inviteCode },
    });
    await apiJson(`${baseUrl}/api/rooms/${matchId}/ready`, { method: 'POST', token: northToken, body: { ready: true } });
    await apiJson(`${baseUrl}/api/rooms/${matchId}/ready`, { method: 'POST', token: southToken, body: { ready: true } });
    await apiJson(`${baseUrl}/api/rooms/${matchId}/start`, { method: 'POST', token: northToken, body: {} });

    let seqN = 1;
    let seqS = 1;
    let cmdIdx = 1;
    const sendCmd = async (token: string, actorId: string, payload: Record<string, unknown>) => {
      const loaded = store.getMatch(matchId as any)!;
      const isN = actorId === WORLD_ACTORS.north;
      const res = await apiJson(`${baseUrl}/api/rooms/${matchId}/commands`, {
        method: 'POST',
        token,
        body: {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          commandId: `cmd_t09_${String(cmdIdx).padStart(4, '0')}`,
          matchId,
          actorId,
          idempotencyKey: `idem_t09_${String(cmdIdx).padStart(4, '0')}`,
          sequence: isN ? seqN : seqS,
          expectedVersion: loaded.state.version,
          issuedAtUtc: clock.nowUtc(),
          payload,
        },
      });
      cmdIdx += 1;
      assert.equal(res.ok, true, `Command failed (${res.status}): ${JSON.stringify(res.data)}`);
      if (isN) seqN += 1;
      else seqS += 1;
    };

    const daNang = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đà Nẵng')!;
    const hue = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Huế')!;
    const dongHoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Đồng Hới')!;
    const quangNgai = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quảng Ngãi')!;
    const quyNhon = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Quy Nhơn')!;
    const haNoi = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội')!;
    const caMau = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Cà Mau')!;

    // Build offices & bases on frontline cities, research motor -> recon -> tank + artillery
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'motor' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'office' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: hue.cityId, projectKey: 'office' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: dongHoi.cityId, projectKey: 'office' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'motor' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'office' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quyNhon.cityId, projectKey: 'office' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: caMau.cityId, projectKey: 'office' });
    clock.advanceByMs(60_000);
    runtime.scheduler.runCatchUpCycle();

    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'recon' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: hue.cityId, projectKey: 'motor' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: dongHoi.cityId, projectKey: 'reserve' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'recon' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'base' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quyNhon.cityId, projectKey: 'motor' });
    // Hidden deep-south unit at Cà Mau for strict Fog-of-War verification!
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: caMau.cityId, projectKey: 'reserve' });
    clock.advanceByMs(65_000);
    runtime.scheduler.runCatchUpCycle();

    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'tank' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'base' }); // Base Lv2 (110s)
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'recon' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'tank' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'base' }); // Base Lv2 (110s)
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'recon' });
    clock.advanceByMs(115_000);
    runtime.scheduler.runCatchUpCycle();

    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.north, doctrineKey: 'artillery' });
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'tank' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_RESEARCH', nationId: WORLD_NATIONS.south, doctrineKey: 'artillery' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'tank' });
    clock.advanceByMs(75_000);
    runtime.scheduler.runCatchUpCycle();

    // Mobilize artillery at Đà Nẵng & Quảng Ngãi, and give North a moving motor unit from Huế -> Đà Nẵng
    await sendCmd(northToken, WORLD_ACTORS.north, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.north, cityId: daNang.cityId, projectKey: 'artillery' });
    await sendCmd(southToken, WORLD_ACTORS.south, { type: 'CAMPAIGN_START_CITY_PROJECT', nationId: WORLD_NATIONS.south, cityId: quangNgai.cityId, projectKey: 'artillery' });
    clock.advanceByMs(65_000);
    runtime.scheduler.runCatchUpCycle();

    // Verify server has hidden Cà Mau reserve unit
    const fullCs = store.getMatch(matchId as any)!.state.campaignState!;
    const hiddenCaMauUnit = Object.values(fullCs.units).find((u) => u.cityId === caMau.cityId);
    assert.ok(hiddenCaMauUnit, 'South must have a hidden unit at Cà Mau for fog-of-war check');

    // 2) Open Desktop (1440x900) as North, verify Three.js 3D WebGL, GLB preload, LOD switching,
    //    motor Tier I (BTR-40) -> research motor2 -> Tier II (BTR-60PB), Fog of War, WebGL Context Loss/Restore, Resize, and 50/100/200 GPU Benchmarks!
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktopCtx.newPage();
    const desktopErrors: string[] = [];
    page.on('pageerror', (e: Error) => desktopErrors.push(e.message));
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') desktopErrors.push(msg.text());
    });

    await page.addInitScript(
      ({ token, user, mid }: any) => {
        sessionStorage.setItem(
          'vdn_campaign_mp_session_v1',
          JSON.stringify({ token, user, matchId: mid })
        );
      },
      { token: northToken, user: regN.data.user, mid: matchId }
    );

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(live?.online) && live.units.length >= 4, { timeout: 15000 });

    // Wait for Three.js WebGL overlay and all 12 LOD2 GLB models to finish loading + baking portraits
    await page.waitForFunction(
      () => {
        const m = (window as any).__VDN_VISUAL_METRICS;
        return m && m.rendererMode === 'webgl-3d' && m.loadedGlbCount >= 12 && m.portraitsCached >= 12;
      },
      { timeout: 25000 }
    );

    const initialMetrics = await page.evaluate(() => (window as any).__VDN_VISUAL_METRICS);
    assert.equal(initialMetrics.rendererMode, 'webgl-3d');
    assert.ok(initialMetrics.loadedGlbCount >= 12);
    assert.ok(initialMetrics.portraitsCached >= 12);

    // Strict Fog-of-War check: hidden Cà Mau unit MUST NOT be in live.units or rendered in 3D!
    const hasHiddenUnit = await page.evaluate(
      (hid: string) => live.units.some((u: any) => u.id === hid),
      hiddenCaMauUnit.unitId
    );
    assert.equal(hasHiddenUnit, false, '3D renderer must never expose fog-of-war enemy unit at Cà Mau');

    // Verify LOD transitions across zoom levels: SYMBOL (1.0) -> LOD2 (1.9) -> LOD1 (2.8) -> LOD0 (4.2)
    const lodChecks = await page.evaluate(async () => {
      const results: Record<string, any> = {};
      for (const [label, z] of [['symbol', 1.0], ['lod2', 1.9], ['lod1', 2.8], ['lod0', 4.2]] as const) {
        camera.lon = 108.2;
        camera.lat = 15.8;
        camera.z = z;
        draw();
        await new Promise((r) => setTimeout(r, 120));
        results[label] = { ...(window as any).__VDN_VISUAL_METRICS };
      }
      return results;
    });
    assert.equal(lodChecks.symbol.activeLod, 'SYMBOL');
    assert.equal(lodChecks.symbol.drawCalls, 0);
    assert.equal(lodChecks.lod2.activeLod, 'LOD2');
    assert.ok(lodChecks.lod2.drawCalls > 0);
    assert.equal(lodChecks.lod1.activeLod, 'LOD1');
    assert.equal(lodChecks.lod0.activeLod, 'LOD0');

    // Verify Motor Tier I displays BTR-40 before motor2 is researched!
    const motorUnitId = Object.values(fullCs.units).find(
      (u) => u.ownerNationId === WORLD_NATIONS.north && u.key === 'motor'
    )!.unitId;
    await page.locator('#menuUnits').click();
    await page.locator(`[data-select-unit="${motorUnitId}"]`).click();
    await page.locator('#army').waitFor({ state: 'visible' });
    const tier1CardText = (await page.locator('#armyInfo').textContent()) || '';
    assert.ok(tier1CardText.includes('BTR-40'), `Expected BTR-40 before motor2, got: ${tier1CardText}`);
    const hasPortraitImg = await page.locator('#armyInfo img.unitPortrait').isVisible();
    assert.equal(hasPortraitImg, true, 'Unit info card must display rendered portrait image');

    // Research motor2 on server -> pull snapshot -> verify Motor visually upgrades to BTR-60PB (Cấp II)!
    await sendCmd(northToken, WORLD_ACTORS.north, {
      type: 'CAMPAIGN_START_RESEARCH',
      nationId: WORLD_NATIONS.north,
      doctrineKey: 'motor2',
    });
    clock.advanceByMs(66_000);
    runtime.scheduler.runCatchUpCycle();
    await page.evaluate(() => pullOnlineSnapshot());
    await page.waitForFunction(() => live.learned.includes('motor2'));
    const tier2CardText = (await page.locator('#armyInfo').textContent()) || '';
    assert.ok(tier2CardText.includes('BTR-60PB'), `Expected BTR-60PB after motor2, got: ${tier2CardText}`);

    // Issue movement order (Huế -> Đà Nẵng) + Declare WAR so frontline combat & marching arrows render live!
    await sendCmd(northToken, WORLD_ACTORS.north, {
      type: 'CAMPAIGN_SET_DIPLOMACY',
      nationId: WORLD_NATIONS.north,
      targetNationId: WORLD_NATIONS.south,
      action: 'DECLARE_WAR',
    });
    await sendCmd(northToken, WORLD_ACTORS.north, {
      type: 'CAMPAIGN_MOVE_UNIT',
      nationId: WORLD_NATIONS.north,
      unitId: motorUnitId,
      toCityId: quangNgai.cityId,
      expectedRev: store.getMatch(matchId as any)!.state.campaignState!.units[motorUnitId].rev,
    });
    await page.evaluate(() => pullOnlineSnapshot());

    // Position camera cleanly over Central Front (Huế -> Đà Nẵng -> Quảng Ngãi) at LOD1 zoom 2.9 for hero screenshot!
    await page.evaluate(async () => {
      camera.lon = 108.15;
      camera.lat = 15.85;
      camera.z = 3.0;
      draw();
      await new Promise((r) => setTimeout(r, 350));
      draw();
    });
    await page.screenshot({ path: path.join(outDir, 't09-3d-desktop-war.png') });

    // Close #army and zoom even closer (LOD0, z=4.0) onto Đà Nẵng (T-54/55 + PT-76 + M-30 + BTR-60PB) for hero close-up
    await page.locator('#armyClose').click();
    await page.evaluate(async () => {
      camera.lon = 108.22;
      camera.lat = 16.05;
      camera.z = 4.0;
      draw();
      await new Promise((r) => setTimeout(r, 400));
      draw();
    });
    await page.screenshot({ path: path.join(outDir, 't09-3d-desktop-zoom.png') });

    // 3) Desktop Performance Benchmarks: 50, 100, and 200 displayed 3D units!
    const desktopBench50 = await page.evaluate(() => (window as any).__VDN_UNIT3D.runStressBenchmark(50, { zoom: 2.2, frames: 45 }));
    const desktopBench100 = await page.evaluate(() => (window as any).__VDN_UNIT3D.runStressBenchmark(100, { zoom: 2.2, frames: 45 }));
    const desktopBench200 = await page.evaluate(() => (window as any).__VDN_UNIT3D.runStressBenchmark(200, { zoom: 2.2, frames: 45 }));

    // 4) Resize check + WebGL Context Loss & Restore check!
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(150);
    const resizedDims = await page.evaluate(() => {
      const c = document.getElementById('unit3d') as HTMLCanvasElement;
      return { w: c.clientWidth, h: c.clientHeight };
    });
    assert.equal(resizedDims.w, 1024);
    assert.equal(resizedDims.h, 768);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.evaluate(() => (window as any).__VDN_UNIT3D.simulateContextLoss());
    await page.waitForFunction(() => (window as any).__VDN_VISUAL_METRICS?.rendererMode === 'fallback-2d');
    const pinCountDuringLoss = await page.locator('.armyPin').count();
    assert.ok(pinCountDuringLoss >= 3, 'Units must remain clickable in fallback mode during WebGL context loss');

    await page.evaluate(() => (window as any).__VDN_UNIT3D.simulateContextRestore());
    await page.waitForFunction(() => (window as any).__VDN_VISUAL_METRICS?.rendererMode === 'webgl-3d');

    assert.deepEqual(desktopErrors, [], `Desktop errors: ${desktopErrors.join(' | ')}`);
    await desktopCtx.close();

    // 5) Mobile Touch Viewport (390x844): 3D GLB rendering + 50/100/200 benchmark + visual screenshot!
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const mPage = await mobileCtx.newPage();
    const mobileErrors: string[] = [];
    mPage.on('pageerror', (e: Error) => mobileErrors.push(e.message));
    await mPage.addInitScript(
      ({ token, user, mid }: any) => {
        sessionStorage.setItem(
          'vdn_campaign_mp_session_v1',
          JSON.stringify({ token, user, matchId: mid })
        );
      },
      { token: northToken, user: regN.data.user, mid: matchId }
    );
    await mPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await mPage.waitForFunction(
      () => {
        const m = (window as any).__VDN_VISUAL_METRICS;
        return m && m.rendererMode === 'webgl-3d' && m.loadedGlbCount >= 12;
      },
      { timeout: 25000 }
    );
    await mPage.evaluate(async () => {
      camera.lon = 108.2;
      camera.lat = 15.8;
      camera.z = 2.9;
      draw();
      await new Promise((r) => setTimeout(r, 350));
      draw();
    });
    await mPage.locator('.armyPin').first().tap();
    await mPage.locator('#army').waitFor({ state: 'visible' });
    const mobileOverflow = await mPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    assert.equal(mobileOverflow, false, 'Mobile 390x844 must have zero horizontal overflow');
    await mPage.screenshot({ path: path.join(outDir, 't09-3d-mobile-doc.png') });

    const mobileBench50 = await mPage.evaluate(() => (window as any).__VDN_UNIT3D.runStressBenchmark(50, { zoom: 2.0, frames: 40 }));
    const mobileBench100 = await mPage.evaluate(() => (window as any).__VDN_UNIT3D.runStressBenchmark(100, { zoom: 2.0, frames: 40 }));
    const mobileBench200 = await mPage.evaluate(() => (window as any).__VDN_UNIT3D.runStressBenchmark(200, { zoom: 2.0, frames: 40 }));
    assert.deepEqual(mobileErrors, [], `Mobile errors: ${mobileErrors.join(' | ')}`);
    await mobileCtx.close();

    // 6) No-WebGL Fallback (?nowebgl=1) & Offline file:// HTML Fallback verification!
    const fallbackCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const fbPage = await fallbackCtx.newPage();
    const fbErrors: string[] = [];
    fbPage.on('pageerror', (e: Error) => fbErrors.push(e.message));
    await fbPage.addInitScript(
      ({ token, user, mid }: any) => {
        sessionStorage.setItem(
          'vdn_campaign_mp_session_v1',
          JSON.stringify({ token, user, matchId: mid })
        );
      },
      { token: northToken, user: regN.data.user, mid: matchId }
    );
    await fbPage.goto(`${baseUrl}/?nowebgl=1`, { waitUntil: 'networkidle' });
    await fbPage.waitForFunction(() => Boolean(live?.online) && live.units.length >= 4);
    const fbMetrics = await fbPage.evaluate(() => (window as any).__VDN_VISUAL_METRICS);
    assert.equal(fbMetrics.rendererMode, 'fallback-2d');
    await fbPage.locator('.armyPin').first().click();
    await fbPage.locator('#armyInfo img.unitPortrait').waitFor({ state: 'visible' });
    await fbPage.screenshot({ path: path.join(outDir, 't09-fallback-nowebgl.png') });

    // Offline file:// index.html test
    const fileUrl = pathToFileURL(path.resolve(process.cwd(), 'index.html')).href;
    await fbPage.goto(fileUrl, { waitUntil: 'load' });
    await fbPage.waitForFunction(() => Boolean(live) && Object.keys(live.cities).length === 60);
    const offlineMetrics = await fbPage.evaluate(() => (window as any).__VDN_VISUAL_METRICS);
    assert.equal(offlineMetrics.rendererMode, 'fallback-2d');
    assert.deepEqual(fbErrors, [], `Fallback/offline errors: ${fbErrors.join(' | ')}`);
    await fallbackCtx.close();

    // Verify deterministic server replay still passes 100%
    assert.equal(store.verifyMatchReplay(matchId as any)?.verified, true);

    const summary = {
      ok: true,
      initialLod2LoadMs: initialMetrics.initialLod2LoadMs,
      loadedGlbCount: initialMetrics.loadedGlbCount,
      portraitsCached: initialMetrics.portraitsCached,
      lodTransitions: {
        symbol: { lod: lodChecks.symbol.activeLod, drawCalls: lodChecks.symbol.drawCalls },
        lod2: { lod: lodChecks.lod2.activeLod, drawCalls: lodChecks.lod2.drawCalls },
        lod1: { lod: lodChecks.lod1.activeLod, drawCalls: lodChecks.lod1.drawCalls },
        lod0: { lod: lodChecks.lod0.activeLod, drawCalls: lodChecks.lod0.drawCalls },
      },
      motor2VisualUpgrade: 'BTR-40 -> BTR-60PB verified',
      fogOfWarStrict: true,
      webglContextLossRestore: true,
      noWebglFallback: true,
      offlineFileFallback: true,
      benchmarks: {
        desktop: [desktopBench50, desktopBench100, desktopBench200],
        mobile: [mobileBench50, mobileBench100, mobileBench200],
      },
    };
    fs.writeFileSync(
      path.join(outDir, 'ket-qua-t09-benchmark.json'),
      JSON.stringify(summary, null, 2) + '\n',
      'utf8'
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    await runtime.close();
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
