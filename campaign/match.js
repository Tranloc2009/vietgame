"use strict";
const resourceArt = [
  '<path fill="#af9c62" d="m2 8 10-5 10 5v11l-10 4-10-4z"/><path d="m2 8 10 4 10-4m-10 4v11M6 6l10 4v5"/>',
  '<path fill="#a3adb0" d="m9 2 5 0 1 3 3 1 2-1 3 4-2 3 1 3-3 4-3-1-2 4H9l-1-3-3-1-2 1-2-4 2-3-1-3 3-4 3 1z"/><circle fill="#3f4b48" cx="12" cy="12" r="3.7"/>',
  '<rect fill="#af5b43" x="5" y="4" width="14" height="17" rx="2"/><path d="M5 8h14M5 17h14M8 4V2h6v2M9 10l5 5"/>',
  '<path fill="#78a88b" d="M4 4h16v16H4z"/><path d="M8 1v3m4-3v3m4-3v3M8 20v3m4-3v3m4-3v3M1 8h3m-3 5h3m16-5h3m-3 5h3"/><path fill="#425c50" d="M8 8h8v8H8z"/>',
  '<path fill="#b69a7c" d="m2 15 5-9 7-3 8 10-4 7-11 1z"/><path d="m7 6 3 8 4-11m-4 11 8 6m-8-6-3 7"/>',
  '<circle fill="#c3bd99" cx="12" cy="7" r="4"/><path fill="#a6ae92" d="M3 21v-4q1-5 6-5l3 3 3-3q5 0 6 5v4z"/>',
  '<path fill="#83a779" d="m1 8 18-5 4 12-18 6z"/><path d="m5 10 2 7 12-4-2-6z"/><ellipse fill="#bfc59a" cx="12" cy="12" rx="3" ry="3.5"/>',
];
const art = (i) =>
  '<svg aria-hidden="true" viewBox="0 0 24 24" stroke="#344239" stroke-width="1.2" stroke-linejoin="round">' +
  resourceArt[i] +
  "</svg>";
const fmt = new Intl.NumberFormat("vi-VN");
const num = (n) => fmt.format(Math.floor(n));
const escapeText = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
let cityTab = "summary",
  nationalView = "stock",
  pickedMaterial = -1,
  db = null,
  saved = null,
  live = null,
  busy = false,
  storeFailed = false;
function notice(msg) {
  $("#notice").hidden = false;
  $("#notice").textContent = msg;
}
function openStore() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("viet-nam-chien-dich-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("matches");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function transaction(action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("matches", "readwrite"),
      store = tx.objectStore("matches"),
      r = store.get("vietnam");
    let state, problem;
    r.onsuccess = () => {
      try {
        state = settle(
          r.result ||
            startCampaign(
              towns.map((t) => t.name),
              Date.now(),
            ),
          Date.now(),
        );
        if (action) action(state);
        store.put(state, "vietnam");
      } catch (e) {
        problem = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(state);
    tx.onabort = () => reject(problem || tx.error);
  });
}
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("viet-nam-chien-dich-v1")
    : null;
async function sync() {
  if (!db) return;
  const tx = db.transaction("matches"),
    r = tx.objectStore("matches").get("vietnam");
  r.onsuccess = () => {
    if (r.result && (!saved || r.result.time >= saved.time)) {
      saved = r.result;
      refresh();
    }
  };
}
if (channel) channel.onmessage = sync;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) sync();
});
function command(key, cancel, jobStart) {
  if (!selected) return;
  const city = selected.name;
  if (typeof isOnline === "function" && isOnline()) {
    return sendOnlineCityProject(city, key, cancel, jobStart);
  }
  return commitOrder((s) => {
    if (
      cancel &&
      !s.cities[city]?.jobs.some((j) => j.key === key && j.start === jobStart)
    )
      throw Error("Hàng đợi đã thay đổi.");
    order(s, city, key, cancel);
  });
}
async function commitOrder(mutate) {
  if (busy || !live) return false;
  busy = true;
  try {
    if (db) saved = await transaction(mutate);
    else {
      const next = settle(structuredClone(saved), Date.now());
      mutate(next);
      saved = next;
    }
    if (db) channel?.postMessage("update");
    if (!storeFailed) $("#notice").hidden = true;
    refresh();
    return true;
  } catch (e) {
    notice(e.message || "Chưa lưu được lệnh.");
  } finally {
    busy = false;
  }
}
function refresh() {
  if (typeof isOnline === "function" && isOnline()) {
    live = buildOnlineLiveState();
    maybeAutoSyncOnlineDeadlines();
    renderMatch();
    invalidate();
    return;
  }
  if (!saved) return;
  live = settle(structuredClone(saved), Date.now());
  renderMatch();
  invalidate();
}
function replaceContent(el, html) {
  if (el._lastHtml !== html) {
    el.innerHTML = html;
    el._lastHtml = html;
  }
}
function openNational(view, index = -1) {
  const same =
    !$("#national").hidden && view === nationalView && index === pickedMaterial;
  panel(null);
  if (same) return;
  nationalView = view;
  pickedMaterial = index;
  panel("national");
  renderMatch();
}
function initBar() {
  for (const [i, label] of materials.entries()) {
    const b = document.createElement("button");
    b.className = "resource";
    b.setAttribute("aria-label", label);
    b.innerHTML = art(i) + "<span><strong>…</strong><small></small></span>";
    b.onclick = () => openNational("stock", i);
    $("#resources").append(b);
  }
}
function renderStock(L) {
  const ids =
    pickedMaterial < 0 ? materials.map((_, i) => i) : [pickedMaterial];
  return (
    "<table><thead><tr><th>Nguồn lực</th><th>Trong kho</th><th>Thu/h</th><th>Chi/h</th></tr></thead><tbody>" +
    ids
      .map(
        (i) =>
          "<tr><td>" +
          art(i) +
          materials[i] +
          "</td><td>" +
          num(live.balance[i] / hour) +
          "</td><td>+" +
          num(L.income[i]) +
          "</td><td>−" +
          num(L.expense[i]) +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}
const countdown = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
};
function logHtml() {
  return live.log
    .map(
      (e) =>
        "<li><time>" +
        new Date(e.time).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        "</time><span>" +
        (e.city ? "<b>" + escapeText(e.city) + "</b> · " : "") +
        escapeText(e.text) +
        "</span></li>",
    )
    .join("");
}
function renderCity(c) {
  if (cityTab === "summary") {
    const prod = cityOutput(c);
    const totalBuildings =
      (c.factory || 0) +
      (c.office || 0) +
      (c.base || 0) +
      (c.bunker || 0) +
      (c.hospital || 0) +
      (c.airbase || 0) +
      (c.port || 0);
    const defBonus = Math.min(
      60,
      (c.base || 0) * 10 + (c.bunker || 0) * 15 + (c.airbase || 0) * 5,
    );
    const bParts = [];
    if (c.factory) bParts.push("Xưởng " + c.factory);
    if (c.office) bParts.push("VP " + c.office);
    if (c.base) bParts.push("Lục quân " + c.base);
    if (c.bunker) bParts.push("Công sự " + c.bunker);
    if (c.hospital) bParts.push("Quân y " + c.hospital);
    if (c.airbase) bParts.push("Không quân " + c.airbase);
    if (c.port) bParts.push("Quân cảng " + c.port);
    return (
      '<div class="cityStats"><div><small>Sản lượng' +
      (c.coastal ? ' · <span class="coastalTag">Ven biển</span>' : "") +
      "</small><b>" +
      art(c.material) +
      materials[c.material] +
      " +" +
      num(prod[c.material] * 24) +
      "/ngày</b></div><div><small>Công trình" +
      (defBonus ? " · Thủ +" + defBonus + "%" : "") +
      "</small><b>" +
      (bParts.length ? bParts.join(" · ") : num(totalBuildings) + " cấp") +
      "</b></div><div><small>Lực lượng</small><b>" +
      num(
        live.units.filter(
          (u) => u.city === selected.name && u.owned !== false,
        ).length,
      ) +
      ' đơn vị</b></div></div><p class="queueLine">' +
      (c.jobs.length
        ? c.jobs
            .map(
              (j) =>
                projects[j.key].label + " · " + countdown(j.end - live.time),
            )
            .join(" / ")
        : "Hàng đợi trống") +
      "</p>"
    );
  }
  const lane = cityTab === "build" ? "build" : "mobilize",
    j = c.jobs.find((j) => projects[j.key].lane === lane);
  if (j) {
    const pct = clamp(
      (100 * (live.time - j.start)) / (j.end - j.start),
      0,
      100,
    );
    return (
      '<div class="job"><div><strong>' +
      projects[j.key].label +
      "</strong><span> Còn " +
      countdown(j.end - live.time) +
      '</span><progress max="100" value="' +
      pct.toFixed(1) +
      '"></progress></div><button data-cancel="' +
      j.key +
      '" data-start="' +
      j.start +
      '">Hủy lệnh</button></div>'
    );
  }
  return Object.entries(projects)
    .filter(([, p]) => p.lane === lane)
    .map(([key, p]) => {
      const t = terms(c, key);
      const st = lane === "mobilize" ? unitStats[key] : null;
      const curLv = lane === "build" ? c[key] || 0 : 0;
      const reason =
        lane === "build" && p.coastalOnly && !c.coastal
          ? "Chỉ TP ven biển"
          : lane === "build" && p.maxLevel && curLv >= p.maxLevel
            ? "Đã tối đa"
            : st?.reqDoctrine && !live.learned.includes(st.reqDoctrine)
              ? key === "motor"
                ? "Cần nghiên cứu cấp I"
                : "Cần " + doctrines[st.reqDoctrine].name
              : st && (c.office || 0) < st.reqOffice
                ? "Cần văn phòng cấp " + st.reqOffice
                : st && (c.base || 0) < st.reqBase
                  ? "Cần căn cứ cấp " + st.reqBase
                  : st && (c.airbase || 0) < (st.reqAirbase || 0)
                    ? "Cần sân bay cấp " + st.reqAirbase
                    : st && (c.port || 0) < (st.reqPort || 0)
                      ? "Cần quân cảng cấp " + st.reqPort
                      : t.cost.some((n, i) => n * hour > live.balance[i])
                        ? "Thiếu tài nguyên"
                        : "";
      const cost = t.cost
        .map((n, i) =>
          n
            ? '<span title="' +
              materials[i] +
              '" aria-label="' +
              materials[i] +
              " " +
              n +
              '">' +
              art(i) +
              num(n) +
              "</span>"
            : "",
        )
        .join("");
      const subNote =
        lane === "build" && p.note
          ? '<div class="offerNote">' + escapeText(p.note) + "</div>"
          : st
            ? '<div class="offerNote">HP ' +
              st.maxHp +
              " · Công " +
              st.softAttack +
              "/" +
              st.hardAttack +
              " · Thủ " +
              st.defense +
              (st.domain === "AIR"
                ? " · Không kích 2.0°"
                : st.domain === "NAVAL"
                  ? " · Hải pháo 1.5°"
                  : st.ranged
                    ? " · Pháo 1.25°"
                    : st.canConquer
                      ? " · Chiếm đất"
                      : " · Xung kích") +
              "</div>"
            : "";
      return (
        '<div class="offer"><div><strong>' +
        p.label +
        (lane === "build" ? " · Cấp " + t.level : "") +
        "</strong>" +
        subNote +
        '<div class="cost">' +
        cost +
        '</div></div><button data-project="' +
        key +
        '" ' +
        (reason ? "disabled" : "") +
        ">" +
        (reason ||
          (lane === "build" ? "Xây" : "Huy động") +
            " · " +
            countdown(t.duration * 1000)) +
        "</button></div>"
      );
    })
    .join("");
}
function renderInteractiveGuide() {
  const el = $("#guideBody");
  if (!el || !live) return;
  const ownCities = Object.values(live.cities).filter((c) => c.owned !== false);
  const ownUnits = live.units.filter((u) => u.owned !== false);
  const s1 = live.learned.length > 0 || Boolean(live.study);
  const s2 = ownCities.some(
    (c) =>
      (c.office || 0) > 0 ||
      (c.base || 0) > 0 ||
      (c.airbase || 0) > 0 ||
      (c.port || 0) > 0 ||
      c.jobs.some((j) => projects[j.key]?.lane === "build"),
  );
  const s3 =
    ownUnits.length > 0 ||
    ownCities.some((c) => c.jobs.some((j) => projects[j.key]?.lane === "mobilize"));
  const s4 = ownUnits.some((u) => Boolean(u.trip) || Boolean(u.stackId) || u.rev > 0);
  const s5 = Boolean(
    live.online &&
      ((live.stats?.citiesCaptured || 0) > 0 || live.diplomacy?.relation === "WAR"),
  );
  const steps = [
    {
      done: s1,
      title: "1. Nghiên cứu công nghệ",
      desc: "Mở mục Nghiên cứu để học Bộ binh cơ giới, Trinh sát, Pháo, Không quân hoặc Hải quân.",
      action: "study",
      btn: "Mở Nghiên cứu",
    },
    {
      done: s2,
      title: "2. Xây hạ tầng thành phố",
      desc: "Chọn thành phố và xây Văn phòng tuyển dụng, Căn cứ, Sân bay hoặc Quân cảng (ven biển).",
      action: "cities",
      btn: "Chọn Thành phố",
    },
    {
      done: s3,
      title: "3. Huy động lực lượng",
      desc: "Chuyển sang thẻ Huy động trong thành phố đã có Văn phòng để tạo quân.",
      action: "cities",
      btn: "Đi tới Thành phố",
    },
    {
      done: s4,
      title: "4. Điều quân & Gộp đạo quân",
      desc: "Bấm quân hiệu trên bản đồ để Di chuyển, Đổi đích hoặc Gộp nhiều đơn vị thành đạo quân.",
      action: "units",
      btn: "Xem Đơn vị",
    },
    {
      done: s5,
      title: "5. Ngoại giao & Chiến dịch trực tuyến",
      desc: "Mở Phòng mạng để đấu 2 người hoặc Đấu với Máy (AI), tuyên chiến và đạt 400 điểm chiến thắng.",
      action: live.online ? "diplomacy" : "online",
      btn: live.online ? "Mở Ngoại giao" : "Mở Phòng mạng",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const html =
    '<div class="guideIntro"><strong>Tiến độ chỉ huy: ' +
    doneCount +
    "/" +
    steps.length +
    '</strong><progress max="' +
    steps.length +
    '" value="' +
    doneCount +
    '"></progress></div><ol class="guideList">' +
    steps
      .map(
        (s) =>
          '<li class="guideItem ' +
          (s.done ? "guideDone" : "") +
          '"><div><b>' +
          (s.done ? "✓ " : "○ ") +
          s.title +
          "</b><small>" +
          s.desc +
          '</small></div><button type="button" data-guide-action="' +
          s.action +
          '">' +
          s.btn +
          "</button></li>",
      )
      .join("") +
    '</ol><p class="guideFoot">Kéo bản đồ để di chuyển · Lăn chuột/chụm ngón để thu phóng · Nhấn Esc để đóng bảng.</p>';
  replaceContent(el, html);
}
function renderMatch() {
  if (!live) return;
  const L = ledger(live);
  const dayNum = 1 + Math.floor((live.time - live.start) / 86400000);
  if (typeof isOnline === "function" && isOnline()) {
    const slotLabel = mp.room.viewerSlot === "NORTH" ? "PHƯƠNG BẮC" : "PHƯƠNG NAM";
    $("#day").textContent = slotLabel + " · NGÀY " + dayNum;
  } else {
    $("#day").textContent = "CHIẾN DỊCH · NGÀY " + dayNum;
  }
  [...$("#resources").children].forEach((el, i) => {
    el.querySelector("strong").textContent = num(live.balance[i] / hour);
    el.querySelector("small").textContent =
      (L.net[i] >= 0 ? "+" : "") + num(L.net[i]) + "/h";
    el.title =
      materials[i] +
      " · Thu " +
      L.income[i] +
      "/h · Chi " +
      L.expense[i] +
      "/h";
  });
  const c =
    selected && towns.includes(selected) ? live.cities[selected.name] : null;
  const canManageCity = Boolean(c && c.owned !== false);
  $("#management").hidden = !canManageCity;
  $("#selection").classList.toggle("managed", canManageCity);
  if (canManageCity && c) {
    for (const b of $("#cityTabs").children)
      b.setAttribute("aria-pressed", String(b.dataset.cityTab === cityTab));
    replaceContent(
      $("#cityBody"),
      renderCity(c) +
        (cityTab === "build"
          ? ""
          : unitList(
              live.units.filter(
                (u) => u.city === selected.name && u.owned !== false,
              ),
            )),
    );
  }
  renderArmy();
  if (!$("#national").hidden) {
    let title = "",
      html = "";
    if (nationalView === "study") {
      title = "Nghiên cứu · Lục / Không / Hải quân";
      html = studyHtml();
    } else if (nationalView === "units") {
      const ownUnits = live.units.filter((u) => u.owned !== false);
      title = "Đơn vị · " + ownUnits.length;
      html =
        unitList(ownUnits) ||
        '<p class="emptyArmy">Chưa có đơn vị. Chọn thành phố để huy động.</p>';
    } else if (nationalView === "stock") {
      title = pickedMaterial < 0 ? "Kho quốc gia" : materials[pickedMaterial];
      html = renderStock(L);
    } else if (nationalView === "diplomacy") {
      title = "Ngoại giao & Điểm chiến thắng";
      html =
        typeof renderDiplomacyHtml === "function"
          ? renderDiplomacyHtml()
          : '<p class="emptyArmy">Ngoại giao hoạt động trong chế độ Phòng mạng.</p>';
    } else if (nationalView === "events") {
      title = "Nhật báo & Báo cáo chiến đấu";
      html =
        (typeof renderCampaignNewsAndBattlesHtml === "function" && live.online
          ? renderCampaignNewsAndBattlesHtml()
          : "") +
        '<h4 class="subHead">Nhật ký chỉ huy</h4><ol class="eventList">' +
        logHtml() +
        "</ol>";
    } else {
      const atWar = live.online && live.diplomacy?.relation === "WAR";
      const showEnemyTargets = Boolean(choosingDestination && atWar);
      const ownedEntries = towns
        .map((t, i) => ({ t, i, c: live.cities[t.name] }))
        .filter(({ c }) => !live.online || c?.owned !== false);
      const enemyEntries = showEnemyTargets
        ? towns
            .map((t, i) => ({ t, i, c: live.cities[t.name] }))
            .filter(({ c }) => c?.owned === false)
        : [];
      title =
        (live.online ? "Thành phố của bạn · " : "Thành phố · ") +
        ownedEntries.length;
      html =
        ownedEntries
          .map(({ t, i, c }) => {
            return (
              '<button class="townRow" data-town="' +
              i +
              '"><strong>' +
              escapeText(t.name) +
              "</strong><span>" +
              art(c.material) +
              (c.jobs.length
                ? c.jobs.length + " lệnh"
                : "+" + cityOutput(c)[c.material] + "/h") +
              "</span></button>"
            );
          })
          .join("") +
        (enemyEntries.length
          ? '<h4 class="subHead warHead">Mục tiêu tiến công (Đối phương · ' +
            enemyEntries.length +
            ")</h4>" +
            enemyEntries
              .map(
                ({ t, i }) =>
                  '<button class="townRow enemyTownRow" data-town="' +
                  i +
                  '"><strong>⚔ ' +
                  escapeText(t.name) +
                  "</strong><span>Tấn công</span></button>",
              )
              .join("")
          : "");
    }
    $("#nationalTitle").textContent = title;
    replaceContent($("#nationalBody"), html);
  }
  if (typeof renderVictoryBanner === "function") {
    renderVictoryBanner();
  }
  if (!$("#guide").hidden) {
    renderInteractiveGuide();
  }
}
$("#cityTabs").onclick = (e) => {
  const b = e.target.closest("[data-city-tab]");
  if (b) {
    cityTab = b.dataset.cityTab;
    renderMatch();
  }
};
$("#cityBody").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.project) {
    if (typeof sfx !== "undefined") {
      sfx.play(projects[b.dataset.project]?.lane === "mobilize" ? "mobilize" : "build");
    }
    command(b.dataset.project, false, 0);
  }
  if (b.dataset.cancel) {
    if (typeof sfx !== "undefined") sfx.play("click");
    command(b.dataset.cancel, true, Number(b.dataset.start));
  }
};
$("#guideBody").onclick = (e) => {
  const b = e.target.closest("[data-guide-action]");
  if (!b) return;
  const act = b.dataset.guideAction;
  if (act === "online") {
    panel("mpPanel");
    if (typeof renderMpPanel === "function") renderMpPanel();
  } else {
    openNational(act);
  }
};
$("#nationalBody").onclick = (e) => {
  const b = e.target.closest("[data-town]");
  if (b) {
    panel(null);
    selectItem(towns[Number(b.dataset.town)], true);
  }
};
$("#menuCity").onclick = () => openNational("cities");
$("#menuDiplomacy").onclick = () => openNational("diplomacy");
$("#menuStock").onclick = () => openNational("stock");
$("#menuEvents").onclick = () => openNational("events");
for (const [selector, delta] of [
  ["#prevCity", -1],
  ["#nextCity", 1],
])
  $(selector).onclick = () => {
    const pool =
      typeof isOnline === "function" && isOnline()
        ? towns.filter((t) => live?.cities?.[t.name]?.owned !== false)
        : towns;
    const index = pool.indexOf(selected);
    if (index >= 0)
      selectItem(
        pool[(index + Number(delta) + pool.length) % pool.length],
        true,
      );
  };
initBar();
async function loadCampaign() {
  try {
    db = await openStore();
    saved = await transaction(null);
  } catch (e) {
    db = null;
    storeFailed = true;
    saved = startCampaign(
      towns.map((t) => t.name),
      Date.now(),
    );
    notice(
      "Trình duyệt không mở được bộ nhớ chiến dịch. Tiến độ chỉ giữ trong phiên này.",
    );
  }
  if (typeof restoreOnlineSession === "function") {
    await restoreOnlineSession();
  }
  refresh();
  setInterval(refresh, 1000);
}
