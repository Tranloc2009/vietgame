"use strict";
let activeUnit = null,
  choosingDestination = false;
function unitTitle(u) {
  return projects[u.key].label + " #" + (u.displayNumber ?? u.id);
}
function simNow() {
  if (typeof isOnline === "function" && isOnline()) {
    return onlineNowUtc();
  }
  return Date.now();
}
function unitList(units) {
  return units
    .map(
      (u) =>
        '<button class="unitRow" data-select-unit="' +
        u.id +
        '"><strong>▣ ' +
        unitTitle(u) +
        "</strong><span>" +
        escapeText(u.trip ? "→ " + u.trip.to : u.city || "Đã dừng") +
        "</span></button>",
    )
    .join("");
}
function studyHtml() {
  return Object.entries(doctrines)
    .map(([key, d]) => {
      const j = live.study?.key === key ? live.study : null,
        learned = live.learned.includes(key),
        locked = d.requires && !live.learned.includes(d.requires);
      const cost = d.cost
        .map((v, i) => (v ? materials[i] + " " + num(v) : ""))
        .filter(Boolean)
        .join(" · ");
      const blocked =
        locked ||
        live.study ||
        d.cost.some((v, i) => v * hour > live.balance[i]);
      const state = learned
        ? "Hoàn tất"
        : locked
          ? "Cần cấp I"
          : live.study
            ? "Hàng đợi bận"
            : blocked
              ? "Thiếu tài nguyên"
              : "Nghiên cứu";
      return (
        '<div class="techRow"><small>CẤP ' +
        (d.requires ? "II" : "I") +
        "</small><h3>" +
        d.name +
        "</h3><p>" +
        d.description +
        "</p><p>" +
        cost +
        " · " +
        countdown(d.seconds * 1000) +
        "</p>" +
        (j
          ? '<progress value="' +
            (live.time - j.start) +
            '" max="' +
            (j.end - j.start) +
            '"></progress><button data-abort="' +
            key +
            '" data-start="' +
            j.start +
            '">Hủy · còn ' +
            countdown(j.end - live.time) +
            "</button>"
          : '<button data-study="' +
            key +
            '" ' +
            (blocked || learned ? "disabled" : "") +
            ">" +
            state +
            "</button>") +
        "</div>"
      );
    })
    .join("");
}
function focusCounter(u) {
  const p = pointAt(u, simNow());
  fly(p.lon, p.lat, Math.max(camera.z, 2.25));
}
function chooseCounter(id, focus = false) {
  const u = live.units.find((u) => u.id === id);
  if (!u) return;
  panel(null);
  choosingDestination = false;
  selectItem(null);
  activeUnit = id;
  if (focus) focusCounter(u);
  renderMatch();
  invalidate();
}
function cancelDestination() {
  choosingDestination = false;
  if (!storeFailed) $("#notice").hidden = true;
  renderArmy();
  invalidate();
}
async function sendMove(to) {
  const u = live.units.find((u) => u.id === activeUnit);
  if (!u) return;
  if (u.owned === false) {
    notice("Không thể điều khiển đơn vị của đối phương.");
    cancelDestination();
    return;
  }
  if (typeof isOnline === "function" && isOnline()) {
    const ok = await sendOnlineMove(u, to);
    if (ok) cancelDestination();
    return;
  }
  const { id, rev } = u;
  const ok = await commitOrder((s) => moveOrder(s, id, to, rev));
  if (ok) cancelDestination();
}
function renderArmy() {
  const unit = live.units.find((u) => u.id === activeUnit);
  $("#army").hidden = !unit;
  $("#selection").hidden = !!unit;
  $("#stage").classList.toggle("picking", !!unit && choosingDestination);
  if (!unit) return;
  const isEnemy = unit.owned === false;
  $("#armyName").textContent = isEnemy
    ? unitTitle(unit) + " · Đối phương"
    : unitTitle(unit);
  $("#armyInfo").textContent = isEnemy
    ? "Liên hệ trinh sát đối phương" +
      (unit.city ? " tại " + unit.city : "") +
      " · Không thể ra lệnh."
    : choosingDestination
      ? "Chọn thành phố đích trên bản đồ hoặc trong menu Thành phố."
      : unit.trip
        ? "Đang di chuyển tới " +
          unit.trip.to +
          " · Còn " +
          countdown(unit.trip.end - live.time)
        : unit.city
          ? "Đóng quân tại " + unit.city
          : "Đã dừng trên đường";
  $("#move").hidden = isEnemy;
  $("#halt").hidden = isEnemy;
  $("#move").textContent = choosingDestination
    ? "Hủy chọn đích"
    : unit.trip
      ? "Đổi điểm đến"
      : "Di chuyển";
  $("#halt").disabled = isEnemy || !unit.trip;
}
const routeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  routeLine = document.createElementNS(routeSvg.namespaceURI, "polyline");
routeSvg.classList.add("routeOverlay");
routeSvg.append(routeLine);
$("#unitMarkers").append(routeSvg);
const pins = new Map();
function drawUnits() {
  if (!live) return;
  const groups = new Map(),
    now = simNow();
  let route = false;
  for (const u of live.units) {
    const pos = pointAt(u, now),
      [x, y] = projectPoint(pos.lon, pos.lat);
    if (u.id === activeUnit && u.trip && u.owned !== false) {
      const points = [pos, ...travelSegment(u, now).remaining];
      routeLine.setAttribute(
        "points",
        points.map((p) => projectPoint(p.lon, p.lat).join(",")).join(" "),
      );
      route = true;
    }
    if (x < -35 || x > w + 35 || y < -35 || y > h + 35) continue;
    const ownerTag = u.owned === false ? "enemy:" : "own:";
    const key = u.city ? ownerTag + "city:" + u.city : ownerTag + "unit:" + u.id;
    if (!groups.has(key)) groups.set(key, { x, y, enemy: u.owned === false, units: [] });
    groups.get(key).units.push(u);
  }
  routeSvg.style.display = route ? "" : "none";
  for (const [key, node] of pins)
    if (!groups.has(key)) {
      node.remove();
      pins.delete(key);
    }
  for (const [key, g] of groups) {
    let btn = pins.get(key);
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "armyPin";
      $("#unitMarkers").append(btn);
      pins.set(key, btn);
    }
    const members = g.units,
      sel = members.findIndex((u) => u.id === activeUnit);
    const firstLabel = members[0].displayNumber ?? members[0].id;
    btn.textContent =
      "▣ " + (members.length > 1 ? "×" + members.length : firstLabel);
    btn.title = members.map(unitTitle).join(", ");
    btn.setAttribute("aria-label", "Chọn quân: " + btn.title);
    btn.style.transform =
      "translate(" +
      Math.round(g.x - 13) +
      "px," +
      Math.round(g.y - 29) +
      "px)";
    btn.classList.toggle("active", sel >= 0);
    btn.classList.toggle("enemy", g.enemy);
    btn.onclick = () => chooseCounter(members[(sel + 1) % members.length].id);
  }
}
$("#menuStudy").onclick = () => openNational("study");
$("#menuUnits").onclick = () => openNational("units");
$("#armyClose").onclick = () => {
  cancelDestination();
  selectItem(null);
};
$("#move").onclick = () => {
  if (choosingDestination) {
    cancelDestination();
    return;
  }
  choosingDestination = true;
  panel(null);
  renderArmy();
};
$("#halt").onclick = () => sendMove(null);
$("#findUnit").onclick = () => {
  const u = live.units.find((u) => u.id === activeUnit);
  if (u) focusCounter(u);
};
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;
  const b = /** @type {HTMLButtonElement} */ (e.target.closest("button"));
  if (!b || b.disabled) return;
  if (b.dataset.selectUnit) {
    const rawId = b.dataset.selectUnit;
    const unitId =
      typeof isOnline === "function" && isOnline() ? rawId : Number(rawId);
    chooseCounter(unitId, true);
  }
  if (b.dataset.study) {
    if (typeof isOnline === "function" && isOnline()) {
      sendOnlineResearch(b.dataset.study, false, 0);
    } else {
      commitOrder((s) => studyOrder(s, b.dataset.study));
    }
  }
  if (b.dataset.abort) {
    if (typeof isOnline === "function" && isOnline()) {
      sendOnlineResearch(b.dataset.abort, true, Number(b.dataset.start));
    } else {
      commitOrder((s) =>
        studyOrder(s, b.dataset.abort, true, Number(b.dataset.start)),
      );
    }
  }
});
canvas.addEventListener("contextmenu", (e) => {
  if (!activeUnit) return;
  e.preventDefault();
  const t = hit(e.clientX, e.clientY);
  if (towns.includes(t)) sendMove(t.name);
});
setInterval(() => {
  if (!document.hidden && live?.units.some((u) => u.trip)) drawUnits();
}, 100);
loadCampaign();
