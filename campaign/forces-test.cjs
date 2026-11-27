const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url");
(async () => {
  fs.mkdirSync(path.resolve(__dirname, "../kiem-thu"), {recursive:true});
  const browser = await chromium.launch({ channel: "msedge" });
  const report = [];
  try {
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["doc", 390, 844],
      ["ngang", 844, 390],
    ]) {
      const context = await browser.newContext({
          viewport: { width, height },
          hasTouch: name !== "desktop",
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const click = async (selector) => {
        const el = page.locator(selector).first();
        if (name === "desktop") await el.click();
        else await el.tap();
      };
      await page.clock.install();
      await page.goto(
        process.env.CAMPAIGN_TEST_URL || pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(() => db && live);
      assert(
        await page.evaluate(() => {
          const s = startCampaign(
            towns.map((t) => t.name),
            0,
          );
          s.cities["Hà Nội"].reserve = 2;
          settle(s, 0);
          settle(s, 0);
          return (
            s.units.length === 2 &&
            new Set(s.units.map((u) => u.id)).size === 2 &&
            ledger(s).expense[0] === 2
          );
        }),
      );
      await click("#menuStudy");
      assert(await page.locator('[data-study="motor2"]').isDisabled());
      await click('[data-study="motor"]');
      await page.clock.fastForward(5000);
      await click('[data-abort="motor"]');
      await page.waitForFunction(() => live.study === null);
      await click('[data-study="motor"]');
      await page.locator('[data-abort="motor"]').waitFor();
      await page.clock.fastForward(46000);
      await page.waitForFunction(() => live.learned.includes("motor"));
      await page.screenshot({
        path: path.resolve(
          __dirname,
          "../kiem-thu/nghien-cuu-" + name + ".png",
        ),
      });
      await click("#menuCity");
      await page.locator(".townRow").filter({ hasText: "Đà Nẵng" }).click();
      await click('[data-city-tab="build"]');
      await click('[data-project="office"]');
      await page.locator('[data-cancel="office"]').waitFor();
      await page.clock.fastForward(46000);
      await click('[data-city-tab="mobilize"]');
      await click('[data-project="motor"]');
      await page.locator('[data-cancel="motor"]').waitFor();
      await page.clock.fastForward(51000);
      await page.locator(".unitRow").first().waitFor();
      await click("#cityBody .unitRow");
      await page.waitForFunction(() => activeUnit === 1 && camera.z === 2.25);
      await page.clock.fastForward(500);
      await click("#armyClose");
      await click(".armyPin");
      await click("#move");
      const dest = await page.evaluate(() =>
        visible
          .filter(({ c }) => c.name !== "Đà Nẵng")
          .map(({ c }) => ({ name: c.name, pt: projectPoint(c.lon, c.lat) }))
          .find(({ pt: [x, y] }) => document.elementFromPoint(x, y) === canvas),
      );
      assert(dest);
      if (name === "desktop") await page.mouse.click(...dest.pt);
      else await page.touchscreen.tap(...dest.pt);
      await page.waitForFunction(() => !!live.units[0].trip);
      let first = await page.evaluate(() => ({ ...live.units[0].position }));
      await page.clock.fastForward(8000);
      await click("#halt");
      await page.waitForFunction(() => !live.units[0].trip);
      assert.notDeepEqual(
        await page.evaluate(() => live.units[0].position),
        first,
      );
      await click("#move");
      await click("#menuCity");
      await page.locator(".townRow").filter({ hasText: "Hà Nội" }).click();
      await page.waitForFunction(() => live.units[0].trip?.to === "Hà Nội");
      await page.screenshot({
        path: path.resolve(__dirname, "../kiem-thu/di-chuyen-" + name + ".png"),
      });
      await page.reload();
      await page.waitForFunction(() => live?.units[0].trip?.to === "Hà Nội");
      await click("#menuUnits");
      await click("#nationalBody .unitRow");
      await click("#move");
      await click("#menuCity");
      await page.locator(".townRow").filter({ hasText: "Hải Phòng" }).click();
      await page.waitForFunction(() => live.units[0].trip?.to === "Hải Phòng");
      await page.clock.fastForward(33000);
      await page.waitForFunction(
        () => live.units[0].city === "Hải Phòng" && !live.units[0].trip,
      );
      assert.equal(await page.evaluate(() => live.units.length), 1);
      assert.equal(await page.evaluate(() => ledger(live).expense[6]), 3);
      await click("#menuStudy");
      await click('[data-study="motor2"]');
      await page.locator('[data-abort="motor2"]').waitFor();
      await page.clock.fastForward(66000);
      await page.waitForFunction(() => live.learned.includes("motor2"));
      await click("[data-close=national]");
      await click("#move");
      await click("#menuCity");
      await page.locator(".townRow").filter({ hasText: "Hà Nội" }).click();
      await page.waitForFunction(() => live.units[0].trip);
      assert.equal(
        await page.evaluate(
          () => live.units[0].trip.end - live.units[0].trip.start,
        ),
        24000,
      );
      assert.deepEqual(errors, []);
      report.push({
        khung: name,
        dichBanDo: dest.name,
        nghienCuu: "đạt",
        chonQuan: "đạt",
        dungDoiLenh: "đạt",
        taiLaiVaDenNoi: "đạt",
        chuyenDoiBanLuuCu: "đạt",
      });
      await context.close();
    }
    fs.writeFileSync(
      path.resolve(__dirname, "../kiem-thu/ket-qua-don-vi.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(report);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
