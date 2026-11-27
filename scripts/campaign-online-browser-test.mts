import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { CONTRACT_SCHEMA_VERSION } from '../src/contracts';
import { WORLD_ACTORS, WORLD_NATIONS } from '../src/content/worldMap72';
import { VIETNAM_CAMPAIGN_CITY_BY_NAME } from '../src/content/vietnamCampaignScenario';
import { loadServerConfig } from '../src/server/config';
import { createServerRuntime, ServerRuntime } from '../src/server/createApp';
import { SqliteMatchStore } from '../src/server/db/sqliteStore';
import { ManualClock } from '../src/simulation';

declare const live: any;
declare const mp: any;
declare const activeUnit: any;
declare function isOnline(): boolean;
declare function pullOnlineSnapshot(): Promise<boolean>;

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(playwrightPath) as {
  chromium: {
    launch: (opts: Record<string, unknown>) => Promise<any>;
  };
};

interface BootedServer {
  runtime: ServerRuntime;
  store: SqliteMatchStore;
  port: number;
  baseUrl: string;
}

async function bootProductionServer(
  dbPath: string,
  clock: ManualClock,
  fixedPort = 0
): Promise<BootedServer> {
  const config = loadServerConfig({
    APP_ENV: 'preview',
    PORT: String(fixedPort),
    SQLITE_DB_PATH: dbPath,
  });
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const runtime = createServerRuntime(config, store, clock);

  const distDir = path.resolve(process.cwd(), 'dist');
  runtime.app.use(express.static(distDir));
  runtime.app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  await new Promise<void>((resolve) => {
    runtime.httpServer.listen(fixedPort, '127.0.0.1', () => resolve());
  });
  runtime.scheduler.start();

  const addr = runtime.httpServer.address() as { port: number };
  return {
    runtime,
    store,
    port: addr.port,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

async function shutdownServer(server: BootedServer): Promise<void> {
  await server.runtime.close();
  server.store.close();
}

(async () => {
  const outDir = path.resolve(process.cwd(), 'kiem-thu');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const report: Array<Record<string, unknown>> = [];

  try {
    const viewports = [
      { name: 'desktop', width: 1440, height: 900, touch: false },
      { name: 'doc', width: 390, height: 844, touch: true },
      { name: 'ngang', width: 844, height: 390, touch: true },
    ];

    for (const vp of viewports) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vdn-online-e2e-${vp.name}-`));
      const dbPath = path.join(tmpDir, 'online-e2e.sqlite');
      const clock = new ManualClock(1_760_500_000_000);
      let server = await bootProductionServer(dbPath, clock, 0);
      const port = server.port;

      const ctxNorth = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.name === 'doc',
      });
      const ctxSouth = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.name === 'doc',
      });
      const pNorth = await ctxNorth.newPage();
      const pSouth = await ctxSouth.newPage();
      const errors: string[] = [];
      const southWsFrames: Array<Record<string, unknown>> = [];

      pNorth.on('pageerror', (e: Error) => errors.push(`north:${e.message}`));
      pSouth.on('pageerror', (e: Error) => errors.push(`south:${e.message}`));
      pSouth.on('websocket', (ws: any) => {
        ws.on('framereceived', ({ payload }: { payload: string | Buffer }) => {
          try {
            southWsFrames.push(JSON.parse(String(payload)));
          } catch {}
        });
      });

      const press = async (page: any, selector: string) => {
        const el = page.locator(selector).first();
        await el.waitFor({ state: 'visible', timeout: 15000 });
        if (vp.touch) await el.tap();
        else await el.click();
      };

      try {
        // 1. Both independent accounts open homepage "/" (new Vietnam map!)
        await Promise.all([
          pNorth.goto(server.baseUrl + '/', { waitUntil: 'domcontentloaded' }),
          pSouth.goto(server.baseUrl + '/', { waitUntil: 'domcontentloaded' }),
        ]);
        await pNorth.waitForFunction(() => Boolean(live));
        await pSouth.waitForFunction(() => Boolean(live));

        // Register North & create Vietnam Campaign room
        await press(pNorth, '#menuOnline');
        await pNorth.fill('#mpUsername', `bac_${vp.name}`);
        await pNorth.fill('#mpDisplayName', 'Chỉ huy Phương Bắc');
        await pNorth.fill('#mpPassword', 'VietNamPass123!');
        await press(pNorth, '#mpAuthSubmit');
        await pNorth.locator('#mpCreateRoom').waitFor({ state: 'visible' });
        await press(pNorth, '#mpCreateRoom');
        await pNorth.locator('#mpInviteCode').waitFor({ state: 'visible' });
        const inviteCode = (await pNorth.locator('#mpInviteCode').textContent())!.trim();
        assert.match(inviteCode, /^VDN-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

        // Register South & join by invite code
        await press(pSouth, '#menuOnline');
        await pSouth.fill('#mpUsername', `nam_${vp.name}`);
        await pSouth.fill('#mpDisplayName', 'Chỉ huy Phương Nam');
        await pSouth.fill('#mpPassword', 'VietNamPass123!');
        await press(pSouth, '#mpAuthSubmit');
        await pSouth.locator('#mpInviteInput').waitFor({ state: 'visible' });
        await pSouth.fill('#mpInviteInput', inviteCode);
        await press(pSouth, '#mpJoinRoom');
        await pSouth.locator('#mpReadyBtn').waitFor({ state: 'visible' });

        // Both Ready -> North Starts -> both enter live Vietnam map
        await press(pSouth, '#mpReadyBtn');
        await press(pNorth, '#mpReadyBtn');
        await pNorth.waitForFunction(() => {
          const btn = document.querySelector('#mpStartBtn') as HTMLButtonElement | null;
          return Boolean(btn && !btn.disabled);
        });
        await press(pNorth, '#mpStartBtn');

        await pNorth.waitForFunction(() => isOnline() === true);
        await pSouth.waitForFunction(() => isOnline() === true);

        // Verify zero horizontal page overflow
        const overflowNorth = await pNorth.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        );
        assert.equal(overflowNorth, false, `Horizontal overflow on ${vp.name}`);

        // 2. Verify prerequisite enforcement on UI: motor2 disabled, Đà Nẵng mobilize motor disabled
        await press(pNorth, '#menuStudy');
        assert.equal(await pNorth.locator('[data-study="motor2"]').isDisabled(), true);

        // Start motor I, advance 5s, cancel -> verify refund & queue clears, then re-start motor I
        await press(pNorth, '[data-study="motor"]');
        await pNorth.locator('[data-abort="motor"]').waitFor({ state: 'visible' });
        clock.advanceByMs(5_000);
        await press(pNorth, '[data-abort="motor"]');
        await pNorth.waitForFunction(() => live.study === null);

        await press(pNorth, '[data-study="motor"]');
        await pNorth.locator('[data-abort="motor"]').waitFor({ state: 'visible' });

        // 3. Select Đà Nẵng -> check Mobilize disabled -> build Recruitment Office
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Đà Nẵng' }).click();
        await press(pNorth, '[data-city-tab="mobilize"]');
        assert.equal(await pNorth.locator('[data-project="motor"]').isDisabled(), true);
        await press(pNorth, '[data-city-tab="build"]');
        await press(pNorth, '[data-project="office"]');
        await pNorth.locator('[data-cancel="office"]').waitFor({ state: 'visible' });

        // Verify South has ZERO visibility into North's queues or nation balance
        const southPrivacyCheck = await pSouth.evaluate(() => {
          const cs = mp.match.campaignState;
          const daNang = Object.values(cs.cities).find((c: any) => c.name === 'Đà Nẵng') as any;
          return {
            hasNorthNation: Boolean(cs.nations['nat_north_dir']),
            daNangJobs: daNang.jobs.length,
            daNangOffice: daNang.office,
          };
        });
        assert.deepEqual(southPrivacyCheck, {
          hasNorthNation: false,
          daNangJobs: 0,
          daNangOffice: 0,
        });

        // 4. Reload North's page MID-QUEUE -> verify session + active queues restore cleanly!
        await pNorth.reload({ waitUntil: 'domcontentloaded' });
        await pNorth.waitForFunction(() => isOnline() === true);
        const midQueueState = await pNorth.evaluate(() => ({
          studyKey: live.study?.key,
          daNangBuildKey: live.cities['Đà Nẵng']?.jobs?.[0]?.key,
        }));
        assert.deepEqual(midQueueState, { studyKey: 'motor', daNangBuildKey: 'office' });

        // 5. Advance server clock +46s -> settle research I & office Lv 1 -> mobilize motor at Đà Nẵng
        clock.advanceByMs(46_000);
        await pNorth.evaluate(() => pullOnlineSnapshot());
        await pNorth.waitForFunction(
          () => live.learned.includes('motor') && live.cities['Đà Nẵng'].office === 1
        );

        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Đà Nẵng' }).click();
        await press(pNorth, '[data-city-tab="mobilize"]');
        assert.equal(await pNorth.locator('[data-project="motor"]').isDisabled(), false);
        await press(pNorth, '[data-project="motor"]');
        await pNorth.locator('[data-cancel="motor"]').waitFor({ state: 'visible' });

        // 6. REAL SERVER RESTART MID-MOBILIZATION (+25s -> shutdown -> +30s -> reboot on same SQLite DB & port!)
        clock.advanceByMs(25_000);
        await shutdownServer(server);
        clock.advanceByMs(30_000);
        server = await bootProductionServer(dbPath, clock, port);

        // Reload North after restart -> verify EXACTLY ONE spawned unit at Đà Nẵng!
        await pNorth.reload({ waitUntil: 'domcontentloaded' });
        await pNorth.waitForFunction(() => isOnline() && live.units.length === 1);
        const unitAfterRestart = await pNorth.evaluate(() => live.units[0]);
        assert.equal(unitAfterRestart.id, 'unt_vn_0001');
        assert.equal(unitAfterRestart.city, 'Đà Nẵng');

        // 7. Select newly spawned unit from city panel AND re-select from map badge (.armyPin)
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Đà Nẵng' }).click();
        await pNorth.locator('#cityBody .unitRow').first().waitFor({ state: 'visible' });
        await press(pNorth, '#cityBody .unitRow');
        await pNorth.waitForFunction(() => activeUnit === 'unt_vn_0001');
        await press(pNorth, '#armyClose');
        await pNorth.waitForFunction(() => activeUnit === null);
        await press(pNorth, '.armyPin');
        await pNorth.waitForFunction(() => activeUnit === 'unt_vn_0001');

        // 8. Order move to Hà Nội (32s), halt mid-way, retarget to Hải Phòng, arrive at Hải Phòng
        await press(pNorth, '#move');
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Hà Nội' }).click();
        await pNorth.waitForFunction(() => live.units[0].trip?.to === 'Hà Nội');
        const firstTripDuration = await pNorth.evaluate(() => {
          const t = live.units[0].trip;
          return t.end - t.start;
        });
        assert.equal(firstTripDuration, 32_000);

        await pNorth.screenshot({
          path: path.join(outDir, `online-vietnam-${vp.name}.png`),
        });

        // Advance 8s, halt mid-journey
        clock.advanceByMs(8_000);
        await press(pNorth, '#halt');
        await pNorth.waitForFunction(() => live.units[0].trip === null);

        // Order move to Hải Phòng and complete arrival
        await press(pNorth, '#move');
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Hải Phòng' }).click();
        await pNorth.waitForFunction(() => live.units[0].trip?.to === 'Hải Phòng');
        clock.advanceByMs(33_000);
        await pNorth.evaluate(() => pullOnlineSnapshot());
        await pNorth.waitForFunction(
          () => live.units[0].city === 'Hải Phòng' && live.units[0].trip === null
        );

        // 9. Verify South CANNOT see unit in Hải Phòng AND CANNOT issue command to North's unit
        await pSouth.evaluate(() => pullOnlineSnapshot());
        const southUnitCheck = await pSouth.evaluate(
          async ({
            schemaVersion,
            southActor,
            southNation,
            hcmId,
          }: {
            schemaVersion: string;
            southActor: string;
            southNation: string;
            hcmId: string;
          }) => {
            const visibleUnits = Object.keys(mp.match.campaignState.units);
            const res = await fetch(`/api/rooms/${mp.room.matchId}/commands`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${mp.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                schemaVersion,
                commandId: 'cmd_south_hijack_test',
                matchId: mp.room.matchId,
                actorId: southActor,
                idempotencyKey: 'idem_south_hijack_test',
                sequence: (mp.match.actors[southActor]?.lastSequence ?? 0) + 1,
                expectedVersion: mp.match.version,
                issuedAtUtc: Date.now(),
                payload: {
                  type: 'CAMPAIGN_MOVE_UNIT',
                  nationId: southNation,
                  unitId: 'unt_vn_0001',
                  toCityId: hcmId,
                  expectedRev: 0,
                },
              }),
            });
            const body = await res.json();
            return { visibleUnits, status: res.status, code: body.code };
          },
          {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            southActor: WORLD_ACTORS.south,
            southNation: WORLD_NATIONS.south,
            hcmId: VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh')!.cityId,
          }
        );
        assert.deepEqual(southUnitCheck.visibleUnits, []);
        assert.equal(southUnitCheck.status, 403);
        assert.equal(southUnitCheck.code, 'FORBIDDEN_ACTION');

        // Also ensure no leaked North queue/order events ever arrived in South's WS deltas
        for (const frame of southWsFrames) {
          if (frame.type === 'room:delta') {
            const events = (frame.events as Array<{ payload: { type: string; nationId?: string } }>) || [];
            for (const ev of events) {
              assert.equal(ev.payload.type, 'CLOCK_ADVANCED');
              assert.notEqual(ev.payload.nationId, WORLD_NATIONS.north);
            }
          }
        }

        // 10. Research Motor II -> new move order uses 24s!
        await press(pNorth, '#menuStudy');
        await press(pNorth, '[data-study="motor2"]');
        await pNorth.locator('[data-abort="motor2"]').waitFor({ state: 'visible' });
        clock.advanceByMs(66_000);
        await pNorth.evaluate(() => pullOnlineSnapshot());
        await pNorth.waitForFunction(() => live.learned.includes('motor2'));
        await press(pNorth, '[data-close="national"]');

        await press(pNorth, '#move');
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Hà Nội' }).click();
        await pNorth.waitForFunction(() => live.units[0].trip?.to === 'Hà Nội');
        const fastDuration = await pNorth.evaluate(() => {
          const t = live.units[0].trip;
          return t.end - t.start;
        });
        assert.equal(fastDuration, 24_000);

        // 11. T05 Full WW3 Loop: Base + Artillery + Diplomacy War + Bombardment + Assault/Capture + News/Reports + Surrender Victory
        // Advance 25s so North Motor arrives at Hà Nội; meanwhile North builds Base at Đà Nẵng, researches Artillery;
        // South builds Office at Quảng Ngãi and mobilizes Reserve defender.
        clock.advanceByMs(25_000);
        await Promise.all([
          pNorth.evaluate(() => pullOnlineSnapshot()),
          pSouth.evaluate(() => pullOnlineSnapshot()),
        ]);

        // North builds Army Base Lv 1 at Đà Nẵng and starts Artillery research
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Đà Nẵng' }).click();
        await press(pNorth, '[data-city-tab="build"]');
        await press(pNorth, '[data-project="base"]');
        await pNorth.locator('[data-cancel="base"]').waitFor({ state: 'visible' });
        await press(pNorth, '#menuStudy');
        await press(pNorth, '[data-study="artillery"]');
        await pNorth.locator('[data-abort="artillery"]').waitFor({ state: 'visible' });
        await press(pNorth, '[data-close="national"]');

        // South builds Office at Quảng Ngãi
        await press(pSouth, '#menuCity');
        await pSouth.locator('.townRow').filter({ hasText: 'Quảng Ngãi' }).click();
        await press(pSouth, '[data-city-tab="build"]');
        await press(pSouth, '[data-project="office"]');
        await pSouth.locator('[data-cancel="office"]').waitFor({ state: 'visible' });

        // Complete Base (55s), Artillery tech (60s), and South Office (45s)
        clock.advanceByMs(61_000);
        await Promise.all([
          pNorth.evaluate(() => pullOnlineSnapshot()),
          pSouth.evaluate(() => pullOnlineSnapshot()),
        ]);
        await pNorth.waitForFunction(
          () => live.learned.includes('artillery') && live.cities['Đà Nẵng'].base === 1
        );

        // North mobilizes Artillery at Đà Nẵng; South mobilizes Reserve defender at Quảng Ngãi
        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Đà Nẵng' }).click();
        await press(pNorth, '[data-city-tab="mobilize"]');
        await press(pNorth, '[data-project="artillery"]');
        await pNorth.locator('[data-cancel="artillery"]').waitFor({ state: 'visible' });

        await press(pSouth, '[data-city-tab="mobilize"]');
        await press(pSouth, '[data-project="reserve"]');
        await pSouth.locator('[data-cancel="reserve"]').waitFor({ state: 'visible' });

        // Complete Artillery (60s) and Reserve (40s)
        clock.advanceByMs(61_000);
        await Promise.all([
          pNorth.evaluate(() => pullOnlineSnapshot()),
          pSouth.evaluate(() => pullOnlineSnapshot()),
        ]);
        await pNorth.waitForFunction(() =>
          live.units.some((u: any) => u.key === 'artillery' && u.owned !== false)
        );
        await pSouth.waitForFunction(() =>
          live.units.some((u: any) => u.key === 'reserve' && u.owned !== false)
        );

        // Open Diplomacy on North -> verify 320 / 400 VP & HÒA BÌNH -> click Tuyên chiến!
        await press(pNorth, '#menuDiplomacy');
        await pNorth.locator('[data-diplomacy="DECLARE_WAR"]').waitFor({ state: 'visible' });
        const dipTextBefore = (await pNorth.locator('#nationalBody').textContent()) || '';
        assert.ok(dipTextBefore.includes('320 / 400'));
        assert.ok(dipTextBefore.includes('HÒA BÌNH'));
        await press(pNorth, '[data-diplomacy="DECLARE_WAR"]');

        // Verify WAR status syncs to both North & South AND opening Artillery bombardment hits South defender!
        await pNorth.waitForFunction(
          () =>
            live.diplomacy?.relation === 'WAR' &&
            live.battleReports?.some((r: any) => r.kind === 'BOMBARDMENT')
        );
        await pSouth.waitForFunction(() => live.diplomacy?.relation === 'WAR');
        await press(pNorth, '[data-close="national"]');

        // T06 UI Check: Sound toggle (#soundToggle) & Interactive Guide (#help -> #guideBody)
        await press(pNorth, '#soundToggle');
        assert.equal(await pNorth.locator('#soundToggle').getAttribute('aria-pressed'), 'false');
        await press(pNorth, '#soundToggle');
        assert.equal(await pNorth.locator('#soundToggle').getAttribute('aria-pressed'), 'true');
        await press(pNorth, '#help');
        await pNorth.locator('#guideBody .guideList').waitFor({ state: 'visible' });
        const guideText = (await pNorth.locator('#guideBody').textContent()) || '';
        assert.ok(guideText.includes('Tiến độ chỉ huy'));
        await press(pNorth, '[data-close="guide"]');

        // T06/T07 UI Check: Airbase + Coastal Port + City Morale on Đà Nẵng + SAM/Submarine in Research + Stack Merge & Split!
        await press(pNorth, '#menuStudy');
        const studyHtmlText = (await pNorth.locator('#nationalBody').textContent()) || '';
        assert.ok(studyHtmlText.includes('Tên lửa phòng không SAM I'));
        assert.ok(studyHtmlText.includes('Tàu ngầm tấn công I'));
        await press(pNorth, '[data-close="national"]');

        await press(pNorth, '#menuCity');
        await pNorth.locator('.townRow').filter({ hasText: 'Đà Nẵng' }).click();
        await press(pNorth, '[data-city-tab="summary"]');
        const citySummaryText = (await pNorth.locator('#cityBody').textContent()) || '';
        assert.ok(citySummaryText.includes('Tinh thần'));
        await press(pNorth, '[data-city-tab="build"]');
        const buildHtmlText = (await pNorth.locator('#cityBody').textContent()) || '';
        assert.ok(buildHtmlText.includes('Căn cứ không quân'));
        assert.ok(buildHtmlText.includes('Quân cảng'));
        await press(pNorth, '[data-city-tab="mobilize"]');
        await press(pNorth, '[data-project="reserve"]');
        await pNorth.locator('[data-cancel="reserve"]').waitFor({ state: 'visible' });
        clock.advanceByMs(41_000);
        await pNorth.evaluate(() => pullOnlineSnapshot());
        await pNorth.waitForFunction(
          () => live.units.filter((u: any) => u.owned !== false && u.city === 'Đà Nẵng').length >= 2
        );
        // Select Artillery at Đà Nẵng -> click Gộp quân (#stackMerge) -> verify Đạo quân hợp thành -> click Tách quân (#stackSplit)
        await press(pNorth, '#menuUnits');
        await pNorth.locator('.unitRow').filter({ hasText: 'Pháo binh' }).first().click();
        await pNorth.locator('#stackMerge').waitFor({ state: 'visible' });
        await press(pNorth, '#stackMerge');
        await pNorth.waitForFunction(() =>
          (document.querySelector('#armyName')?.textContent || '').includes('Đạo quân hợp thành')
        );
        await pNorth.locator('#stackSplit').waitFor({ state: 'visible' });
        await press(pNorth, '#stackSplit');
        await pNorth.waitForFunction(() =>
          !(document.querySelector('#armyName')?.textContent || '').includes('Đạo quân hợp thành')
        );

        // Select North Motor (#1) -> order assault on enemy Quảng Ngãi via #menuCity enemy list
        await press(pNorth, '#menuUnits');
        await pNorth.locator('[data-select-unit="unt_vn_0001"]').click();
        await pNorth.waitForFunction(() => activeUnit === 'unt_vn_0001');
        await press(pNorth, '#move');
        await press(pNorth, '#menuCity');
        await pNorth.locator('.enemyTownRow').filter({ hasText: 'Quảng Ngãi' }).click();
        await pNorth.waitForFunction(() => live.units.find((u: any) => u.id === 'unt_vn_0001')?.trip?.to === 'Quảng Ngãi');

        // Capture live WAR & assault screenshot on all 3 viewports (crimson assault line + 7-button HUD + unit combat stats)
        await pNorth.screenshot({
          path: path.join(outDir, `online-vietnam-war-${vp.name}.png`),
        });

        // Verify zero horizontal overflow during WAR / expanded HUD as well
        const overflowWar = await pNorth.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        );
        assert.equal(overflowWar, false, `Horizontal overflow during WAR on ${vp.name}`);

        // Advance +35s (motor2 arrival 24s + bombardment/melee ticks) -> Quảng Ngãi captured -> 330 vs 310 VP!
        clock.advanceByMs(35_000);
        await Promise.all([
          pNorth.evaluate(() => pullOnlineSnapshot()),
          pSouth.evaluate(() => pullOnlineSnapshot()),
        ]);
        await pNorth.waitForFunction(
          () =>
            live.cities['Quảng Ngãi']?.owned === true &&
            live.victoryPointsByNation?.nat_north_dir === 330 &&
            live.victoryPointsByNation?.nat_south_rep === 310
        );

        // Verify Newspaper & Battle Reports in #menuEvents (Báo chí)
        await press(pNorth, '#menuEvents');
        const newsText = (await pNorth.locator('#nationalBody').textContent()) || '';
        assert.ok(newsText.includes('Nhật báo chiến sự'));
        assert.ok(newsText.includes('Báo cáo chiến đấu'));
        assert.ok(newsText.includes('Quảng Ngãi'));
        await press(pNorth, '[data-close="national"]');

        // South surrenders via #menuOnline -> verify #victoryBanner renders on BOTH North and South!
        await press(pSouth, '#menuOnline');
        await press(pSouth, '#mpSurrenderBtn');
        await press(pSouth, '#mpSurrenderConfirm');
        await pNorth.locator('#victoryBanner').waitFor({ state: 'visible', timeout: 15000 });
        await pSouth.locator('#victoryBanner').waitFor({ state: 'visible', timeout: 15000 });
        const northVictoryText = (await pNorth.locator('#victoryBanner').textContent()) || '';
        assert.ok(northVictoryText.includes('CHIẾN THẮNG CHIẾN DỊCH'));
        assert.ok(northVictoryText.includes('PHƯƠNG BẮC GIÀNH THẮNG LỢI'));
        const southVictoryText = (await pSouth.locator('#victoryBanner').textContent()) || '';
        assert.ok(southVictoryText.includes('THẤT BẠI CHIẾN DỊCH'));

        // Verify server replay hash matches 100%
        const matchId = await pNorth.evaluate(() => mp.room.matchId);
        const replay = server.store.verifyMatchReplay(matchId);
        assert.equal(replay?.verified, true);

        // T06/T07 UI Check (desktop): Leaderboard visible in #mpPanel + 1-click "Đấu với Máy (AI)" mode starts immediately!
        let aiMatchVerified = 'bỏ qua (chỉ kiểm trên desktop)';
        if (vp.name === 'desktop') {
          await press(pNorth, '[data-dismiss-victory="1"]');
          await press(pNorth, '#menuOnline');
          await pNorth.locator('.lbTable').waitFor({ state: 'visible', timeout: 10000 });
          const lbText = (await pNorth.locator('.lbTable').textContent()) || '';
          assert.ok(lbText.includes('Chỉ huy Phương Bắc'));
          await press(pNorth, '#mpLeaveBtn');
          await pNorth.locator('#mpCreateAiRoom').waitFor({ state: 'visible' });
          await press(pNorth, '#mpCreateAiRoom');
          await pNorth.waitForFunction(
            () => isOnline() === true && Boolean(live.aiControlledNationId)
          );
          const aiMatchId = await pNorth.evaluate(() => mp.room.matchId);
          for (let k = 0; k < 10; k += 1) {
            clock.advanceByMs(20_000);
            server.runtime.scheduler.runCatchUpCycle();
          }
          await pNorth.evaluate(() => pullOnlineSnapshot());
          const aiReplay = server.store.verifyMatchReplay(aiMatchId);
          assert.equal(aiReplay?.verified, true);
          const aiState = server.store.getMatch(aiMatchId)!.state.campaignState!;
          assert.ok(aiState.nations[WORLD_NATIONS.south].learned.includes('motor'));
          assert.ok(aiState.nations[WORLD_NATIONS.south].stats.unitsMobilized >= 1);
          aiMatchVerified = 'đạt';
        }

        assert.deepEqual(errors, []);

        report.push({
          khung: vp.name,
          width: vp.width,
          height: vp.height,
          touch: vp.touch,
          authVaPhong: 'đạt',
          nghienCuuVaHuy: 'đạt',
          xayVanPhongVaHuyDong: 'đạt',
          taiLaiGiuaHangDoi: 'đạt',
          khoiDongLaiMayChu: 'đạt',
          chonQuanVaDiChuyen: 'đạt',
          capIIGiam24s: 'đạt',
          cachLyQuyenVaTamNhin: 'đạt',
          ngoaiGiaoVaPhaoKich: 'đạt',
          gopTachDaoQuanVaAmThanhHuongDan: 'đạt',
          tienCongVaChiemQuangNgai: 'đạt',
          baoChiVaBangChienThang: 'đạt',
          dauVoiMayAI: aiMatchVerified,
          replayHash: 'đạt',
          errors: 0,
        });
      } finally {
        await ctxNorth.close();
        await ctxSouth.close();
        await shutdownServer(server);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    fs.writeFileSync(
      path.join(outDir, 'ket-qua-online-vietnam.json'),
      JSON.stringify(report, null, 2) + '\n',
      'utf8'
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
