const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url");
(async () => {
  fs.mkdirSync(path.resolve(__dirname, "../kiem-thu"), {recursive:true});
  const b = await chromium.launch({ channel: "msedge" }),
    results = [];
  try {
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["doc", 390, 844],
      ["ngang", 844, 390],
    ]) {
      const context = await b.newContext({
          viewport: { width, height },
          hasTouch: label !== "desktop",
        }),
        p = await context.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.clock.install();
      await p.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await p.waitForFunction(() => db && live);
      assert.equal(await p.locator(".resource").count(), 7);
      await p.locator(".resource").first().click();
      assert.equal(await p.locator("#nationalTitle").innerText(), "Tiếp tế");
      await p.locator("[data-close=national]").click();
      await p.locator("#menuCity").click();
      await p.locator(".townRow").filter({ hasText: "Đà Nẵng" }).click();
      await p.locator('[data-city-tab="mobilize"]').click();
      assert(await p.locator('[data-project="reserve"]').isDisabled());
      await p.locator('[data-city-tab="build"]').click();
      const before = await p.evaluate(() => live.balance[0] / hour);
      await p.locator('[data-project="factory"]').click();
      await p.locator('[data-cancel="factory"]').waitFor();
      assert(
        Math.abs(
          (await p.evaluate(() => live.balance[0] / hour)) - (before - 200),
        ) < 2,
      );
      await p.locator('[data-cancel="factory"]').click();
      await p.locator('[data-project="factory"]').waitFor();
      assert(
        Math.abs((await p.evaluate(() => live.balance[0] / hour)) - before) < 2,
      );
      await p.locator('[data-project="office"]').click();
      await p.locator('[data-cancel="office"]').waitFor();
      await p.screenshot({
        path: path.resolve(__dirname, "../kiem-thu/quan-ly-" + label + ".png"),
      });
      await p.reload();
      await p.waitForFunction(
        () => db && live?.cities["Đà Nẵng"].jobs.length === 1,
      );
      await p.clock.fastForward(47000);
      await p.waitForFunction(() => live.cities["Đà Nẵng"].office === 1);
      await p.locator("#menuEvents").click();
      assert.match(
        await p.locator("#nationalBody").innerText(),
        /Hoàn thành Văn phòng tuyển dụng/,
      );
      await p.locator("#menuCity").click();
      await p.locator(".townRow").filter({ hasText: "Đà Nẵng" }).click();
      await p.locator('[data-city-tab="mobilize"]').click();
      await p.locator('[data-project="reserve"]').click();
      await p.locator('[data-cancel="reserve"]').waitFor();
      await p.clock.fastForward(42000);
      await p.waitForFunction(() => live.cities["Đà Nẵng"].reserve === 1);
      assert.equal(await p.evaluate(() => ledger(live).expense[6]), 2);
      await p.locator("#prevCity").click();
      assert.notEqual(await p.locator("#name").innerText(), "Đà Nẵng");
      await p.locator("#nextCity").click();
      assert.equal(await p.locator("#name").innerText(), "Đà Nẵng");
      await p.screenshot({
        path: path.resolve(
          __dirname,
          "../kiem-thu/thanh-pho-" + label + ".png",
        ),
      });
      assert.deepEqual(errors, []);
      results.push({
        khung: label,
        kho: "đạt",
        xayDung: "đạt",
        huyLenh: "đạt",
        taiLai: "đạt",
        huyDong: "đạt",
        suKien: "đạt",
      });
      await context.close();
    }
    fs.writeFileSync(
      path.resolve(__dirname, "../kiem-thu/kiem-thu-trong-tran.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(results);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
