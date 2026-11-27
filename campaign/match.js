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
    return (
      '<div class="cityStats"><div><small>Sản lượng mỗi ngày</small><b>' +
      art(c.material) +
      materials[c.material] +
      " +" +
      num(prod[c.material] * 24) +
      "/ngày</b></div><div><small>Công trình</small><b>" +
      num(c.factory + c.office) +
      " cấp</b></div><div><small>Lực lượng</small><b>" +
      num(live.units.filter((u) => u.city === selected.name).length) +
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
      const t = terms(c, key),
        reason =
          key === "motor" && !live.learned.includes("motor")
            ? "Cần nghiên cứu cấp I"
            : lane === "mobilize" && !c.office
              ? "Cần văn phòng cấp 1"
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
      return (
        '<div class="offer"><div><strong>' +
        p.label +
        (lane === "build" ? " · Cấp " + t.level : "") +
        '</strong><div class="cost">' +
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
function renderMatch() {
  if (!live) return;
  const L = ledger(live);
  $("#day").textContent =
    "CHIẾN DỊCH · NGÀY " +
    (1 + Math.floor((live.time - live.start) / 86400000));
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
  $("#management").hidden = !c;
  $("#selection").classList.toggle("managed", !!c);
  if (c) {
    for (const b of $("#cityTabs").children)
      b.setAttribute("aria-pressed", String(b.dataset.cityTab === cityTab));
    replaceContent(
      $("#cityBody"),
      renderCity(c) +
        (cityTab === "build"
          ? ""
          : unitList(live.units.filter((u) => u.city === selected.name))),
    );
  }
  renderArmy();
  if (!$("#national").hidden) {
    let title = "",
      html = "";
    if (nationalView === "study") {
      title = "Nghiên cứu · Lục quân";
      html = studyHtml();
    } else if (nationalView === "units") {
      title = "Đơn vị · " + live.units.length;
      html =
        unitList(live.units) ||
        '<p class="emptyArmy">Chưa có đơn vị. Chọn thành phố để huy động.</p>';
    } else if (nationalView === "stock") {
      title = pickedMaterial < 0 ? "Kho quốc gia" : materials[pickedMaterial];
      html = renderStock(L);
    } else if (nationalView === "events") {
      title = "Nhật ký sự kiện";
      html = '<ol class="eventList">' + logHtml() + "</ol>";
    } else {
      title = "Thành phố · " + towns.length;
      html = towns
        .map((t, i) => {
          const c = live.cities[t.name];
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
        .join("");
    }
    $("#nationalTitle").textContent = title;
    replaceContent($("#nationalBody"), html);
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
  if (b.dataset.project) command(b.dataset.project, false, 0);
  if (b.dataset.cancel)
    command(b.dataset.cancel, true, Number(b.dataset.start));
};
$("#nationalBody").onclick = (e) => {
  const b = e.target.closest("[data-town]");
  if (b) {
    panel(null);
    selectItem(towns[Number(b.dataset.town)], true);
  }
};
$("#menuCity").onclick = () => openNational("cities");
$("#menuStock").onclick = () => openNational("stock");
$("#menuEvents").onclick = () => openNational("events");
for (const [selector, delta] of [
  ["#prevCity", -1],
  ["#nextCity", 1],
])
  $(selector).onclick = () => {
    const index = towns.indexOf(selected);
    if (index >= 0)
      selectItem(
        towns[(index + Number(delta) + towns.length) % towns.length],
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
  refresh();
  setInterval(refresh, 1000);
}
