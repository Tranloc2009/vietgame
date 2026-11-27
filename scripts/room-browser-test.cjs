const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    channel: "msedge",
    args: ["--disable-webgl"],
  });
  const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4829";
  async function player(viewport, name) {
    const mobile = viewport.width < 500;
    const context = await browser.newContext({
      baseURL,
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const frames = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (ws) =>
      ws.on("framereceived", ({ payload }) => {
        try {
          frames.push(JSON.parse(String(payload)));
        } catch {}
      }),
    );
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("topbar-open-rooms").click();
    await page.getByTestId("auth-username").fill(name);
    await page
      .getByTestId("auth-displayname")
      .fill(name.startsWith("north") ? "Chỉ huy Bắc" : "Chỉ huy Nam");
    await page
      .getByTestId("auth-password")
      .fill(require("node:crypto").randomUUID());
    const registered = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/register"),
    );
    await page.getByTestId("auth-submit-btn").click();
    assert.equal((await registered).status(), 201);
    return { page, context, mobile, frames, errors };
  }

  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const runId = Date.now().toString(36) + viewport.width;
      const north = await player(viewport, "north_" + runId);
      const south = await player(viewport, "south_" + runId);
      const a = north.page,
        b = south.page;
      const created = a.waitForResponse(
        (r) =>
          r.url().endsWith("/api/rooms") && r.request().method() === "POST",
      );
      await a.getByTestId("create-room-btn").click();
      const createResponse = await created;
      assert.equal(createResponse.status(), 201);
      const { room } = await createResponse.json();
      await b.getByTestId("join-invite-code").fill(room.inviteCode);
      await b.getByTestId("join-room-btn").click();
      await b.getByTestId("toggle-ready-btn").click();
      await a.getByTestId("toggle-ready-btn").click();
      await a.getByTestId("start-room-btn").click();
      await b
        .getByTestId("start-room-btn")
        .waitFor({ state: "hidden", timeout: 15000 });
      await a.getByRole("button", { name: "Đóng bảng phòng đấu" }).click();
      await b.getByRole("button", { name: "Đóng bảng phòng đấu" }).click();

      await a.getByTestId("rail-btn-economy").click();
      await a.getByTestId("p03-ledger-tab").waitFor();
      assert.equal(
        await a.locator('[data-testid^="p03-resource-row-"]').count(),
        8,
      );
      await a.getByTestId("p03-tab-budget").click();
      await a.getByTestId("budget-net-24h").waitFor();
      const budgetCommand = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await a.getByTestId("budget-tax-slider").press("ArrowRight");
      await a.getByTestId("save-budget-policy-btn").click();
      const savedBudget = await budgetCommand;
      assert.equal(
        savedBudget.status(),
        201,
        JSON.stringify(await savedBudget.json()),
      );
      await a.getByTestId("budget-pending-tax-utc").waitFor();
      await a
        .getByRole("button", { name: "Đóng kinh tế", exact: true })
        .click();

      if (north.mobile) await a.getByTestId("mobile-sheet-expand-btn").click();
      await a
        .getByRole("button", { name: "Xem công trình có thể xây" })
        .click();
      await a.getByTestId("p03-facilities-tab").waitFor();
      assert.equal(
        await a.getByTestId("build-region-select").inputValue(),
        "reg_vn_11",
      );
      const outgoing = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await a.getByTestId("build-facility-btn-MEDICAL_CENTER").click();
      const result = await outgoing;
      const command = result.request().postDataJSON();
      const ack = await result.json();
      assert.equal(result.status(), 201, JSON.stringify(ack));
      assert.equal(command.payload.regionId, "reg_vn_11");
      const orderId = command.payload.orderId;
      await a
        .getByTestId("construction-order-" + orderId)
        .scrollIntoViewIfNeeded();
      await a.screenshot({
        path: path.resolve(
          process.env.QA_OUTPUT || ".",
          "construction-" + viewport.width + ".png",
        ),
      });
      const deadline = Date.now() + 8000;
      while (
        Date.now() < deadline &&
        !south.frames.some(
          (f) => f.type === "room:delta" && f.version === ack.version,
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      const southDelta = south.frames.find(
        (f) => f.type === "room:delta" && f.version === ack.version,
      );
      assert.ok(southDelta, "delta reached the other player");
      assert.equal(JSON.stringify(southDelta).includes(orderId), false);
      await b.getByTestId("rail-btn-economy").click();
      await b.getByTestId("p03-tab-facilities").click();
      await b.getByTestId("p03-facilities-tab").waitFor();
      assert.equal(
        await b.getByTestId("construction-order-" + orderId).count(),
        0,
      );

      const cancelled = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await a.getByTestId("cancel-construction-btn-" + orderId).click();
      const cancelledResponse = await cancelled;
      assert.equal(
        cancelledResponse.status(),
        201,
        JSON.stringify(await cancelledResponse.json()),
      );
      await a
        .getByTestId("construction-order-" + orderId)
        .waitFor({ state: "hidden" });
      await a.getByTestId("p03-tab-ledger").click();
      await a.getByTestId("p03-reconciliation-status").waitFor();
      await a
        .getByRole("button", { name: "Đóng kinh tế", exact: true })
        .click();
      if (
        north.mobile &&
        !(await a.getByLabel("Đích trong vùng kiểm soát").isVisible())
      )
        await a.getByTestId("mobile-sheet-expand-btn").click();
      const select = a.getByLabel("Đích trong vùng kiểm soát");
      await select.selectOption({ index: 1 });
      await a.getByRole("button", { name: "Xem trước tuyến" }).click();
      const march = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await a.getByRole("button", { name: "Ra lệnh hành quân" }).click();
      const marchResponse = await march;
      assert.equal(marchResponse.status(), 201);
      const started = await marchResponse.json();
      const marching = Object.values(started.match.units).find(
        (u) => u.march?.length,
      );
      assert.ok(marching);
      const halt = a.getByRole("button", { name: "Dừng ở vùng hiện tại" });
      await halt.waitFor();
      await halt.scrollIntoViewIfNeeded();
      await a.screenshot({
        path: path.resolve(
          process.env.QA_OUTPUT || ".",
          "march-" + viewport.width + ".png",
        ),
      });
      await a.getByRole("button", { name: "Đổi điểm đến" }).click();
      await a.getByRole("button", { name: "Giữ tuyến hiện tại" }).click();
      await a.getByRole("button", { name: "Đổi điểm đến" }).click();
      const replacement = await select.selectOption({ index: 1 });
      await a.getByRole("button", { name: "Xem trước tuyến" }).click();
      const rerouted = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await a.getByRole("button", { name: "Xác nhận đổi đích" }).click();
      const rerouteResponse = await rerouted;
      assert.equal(rerouteResponse.status(), 201);
      const reroutedUnit = (await rerouteResponse.json()).match.units[
        marching.unitId
      ];
      assert.equal(reroutedUnit.march.at(-1).regionId, replacement[0]);
      assert.notEqual(replacement[0], marching.march.at(-1).regionId);
      const haltAck = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await halt.click();
      assert.equal((await haltAck).status(), 201);
      await a.getByTestId("rail-btn-diplomacy").click();
      await b.getByTestId("rail-btn-diplomacy").click();
      await a.getByRole("button", { name: /Đề nghị chia sẻ/ }).click();
      const accepted = b.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await b.getByRole("button", { name: "Chấp nhận" }).click();
      const revealed = (await (await accepted).json()).match.units
        .unt_north_hq_01;
      assert.ok(revealed, "Hiệp ước phải mở tầm nhìn tới quân của đối tác");
      assert.equal(revealed.supplyFp, 0);
      assert.equal(revealed.march, undefined);
      const end = a.getByRole("button", { name: "Chấm dứt hiệp ước" });
      await end.waitFor();
      await a.screenshot({
        path: path.resolve(
          process.env.QA_OUTPUT || ".",
          "diplomacy-" + viewport.width + ".png",
        ),
      });
      const terminated = a.waitForResponse(
        (r) => r.url().endsWith("/commands") && r.request().method() === "POST",
      );
      await end.click();
      assert.equal(
        (await (await terminated).json()).match.units.unt_south_hq_01,
        undefined,
      );
      await b.getByRole("button", { name: /Đề nghị chia sẻ/ }).waitFor();
      assert.deepEqual([...north.errors, ...south.errors], []);
      console.log(
        JSON.stringify({
          viewport,
          ledgerRows: 8,
          delayedTaxSaved: true,
          region: command.payload.regionId,
          queued: true,
          cancelled: true,
          privateOrderHidden: true,
          errors: 0,
        }),
      );
      await north.context.close();
      await south.context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
