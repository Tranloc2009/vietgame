const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
(async () => {
  const target = pathToFileURL(path.join(__dirname, "../index.html")).href;
  const out = path.resolve(__dirname, "../kiem-thu");
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: "msedge" }),
    report = [],
    errors = [];
  try {
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["doc", 390, 844],
      ["ngang", 844, 390],
    ]) {
      const ctx = await b.newContext({
        viewport: { width, height },
        hasTouch: name !== "desktop",
      });
      const p = await ctx.newPage();
      const remote = [];
      p.on("request", r => { if (/^https?:/.test(r.url())) remote.push(r.url()); });
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(target);
      await p.waitForFunction(
        () => relief.complete && relief.naturalWidth > 0 && visible.length,
      );
      assert(
        await p.evaluate(
          () =>
            document.documentElement.scrollWidth === innerWidth &&
            document.documentElement.scrollHeight === innerHeight,
        ),
      );
      assert(
        await p.evaluate(
          () =>
            regions.length === 63 &&
            towns.every((t) => isFinite(t.lon) && isFinite(t.lat)) &&
            regions.every((r) => r.shape && isFinite(r.lon) && isFinite(r.lat)),
        ),
      );
      await p.screenshot({ path: path.join(out, name + ".png") });
      await p.locator("#places").click();
      await p.locator("#query").fill("da nang");
      await p
        .locator("#list button")
        .filter({ hasText: "Điểm dân cư" })
        .first()
        .click();
      await p.waitForFunction(
        () => selected?.name === "Đà Nẵng" && camera.z === 2.25,
      );
      assert.equal(await p.locator("#name").innerText(), "Đà Nẵng");
      const before = await p.evaluate(() => JSON.stringify(camera));
      await p.locator("[data-mode=terrain]").click();
      assert.equal(await p.evaluate(() => JSON.stringify(camera)), before);
      await p.locator("#layers").click();
      await p.locator("[data-layer=rivers]").uncheck();
      assert.equal(await p.evaluate(() => layers.rivers), false);
      await p.locator("[data-close=settings]").click();
      await p.locator("#clear").click();
      assert.equal(await p.evaluate(() => selected), null);
      await p.locator("#plus").click();
      assert(await p.evaluate(() => camera.z > 2.25));
      await p.locator("#reset").click();
      await p.waitForFunction(() => camera.z === 1);
      await p.locator("[data-mode=political]").click();
      const point = await p.evaluate(() =>
        projectPoint(
          towns.find((t) => t.capital).lon,
          towns.find((t) => t.capital).lat,
        ),
      );
      await p.mouse.click(...point);
      assert.equal(await p.locator("#name").innerText(), "Hà Nội");
      const regionPoint = await p.evaluate(() => {
        for (const r of regions) {
          const pt = projectPoint(+r.lon, +r.lat);
          if (
            pt[0] > 40 &&
            pt[0] < w - 60 &&
            pt[1] > 90 &&
            pt[1] < h - 100 &&
            hit(...pt) === r
          )
            return pt;
        }
      });
      assert(regionPoint);
      await p.mouse.click(...regionPoint);
      assert.equal(await p.locator("#kind").innerText(), "VÙNG");
      await p.mouse.move(width * 0.4, height * 0.45);
      await p.mouse.down();
      await p.mouse.move(width * 0.4 + 35, height * 0.45 + 15, { steps: 4 });
      await p.mouse.up();
      assert(await p.evaluate(() => camera.lon !== 106.5));
      if (name === "doc") {
        const cdp = await ctx.newCDPSession(p),
          send = (type, touchPoints) =>
            cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
        await send("touchStart", [
          { x: 140, y: 330 },
          { x: 210, y: 330 },
        ]);
        await send("touchMove", [
          { x: 110, y: 330 },
          { x: 245, y: 330 },
        ]);
        await send("touchEnd", []);
        assert(await p.evaluate(() => camera.z > 1.3));
      }
      assert.deepEqual(remote, []);
      assert(await p.evaluate(() => {
        const [x,y]=projectPoint(105.85,21.03);
        const [lon,lat]=locate(x,y);
        return Math.abs(lon-105.85)<1e-8 && Math.abs(lat-21.03)<1e-8;
      }));
      report.push({
        khung: name,
        width,
        height,
        vung: await p.evaluate(() => regions.length),
        diem: await p.evaluate(() => towns.length),
        ketQua: "ĐẠT",
      });
      await ctx.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "ket-qua.json"),
      JSON.stringify({ trinhDuyet: b.version(), report, loi: errors }, null, 2),
    );
    console.log(report);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
