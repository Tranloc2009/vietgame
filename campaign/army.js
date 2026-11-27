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
    .map((u) => {
      const st = unitStats[u.key] || unitStats.reserve;
      const hpStr =
        u.hp !== undefined && u.maxHp !== undefined
          ? " · " + u.hp + "/" + u.maxHp + " HP"
          : "";
      return (
        '<button class="unitRow" data-select-unit="' +
        u.id +
        '"><strong>' +
        st.glyph +
        " " +
        unitTitle(u) +
        "</strong><span>" +
        escapeText(
          (u.inCombat
            ? "⚔ Giao tranh"
            : u.trip
              ? "→ " + u.trip.to
              : u.city || "Đã dừng") + hpStr,
        ) +
        "</span></button>"
      );
    })
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
          ? "Cần " + doctrines[d.requires].name
          : live.study
            ? "Hàng đợi bận"
            : blocked
              ? "Thiếu tài nguyên"
              : "Nghiên cứu";
      return (
        '<div class="techRow"><small>' +
        (d.branch ? d.branch + " · " : "") +
        "CẤP " +
        (d.tier || (d.requires ? "II" : "I")) +
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
function stackMembersOf(unit) {
  if (!unit?.stackId || !live?.units) return [];
  return live.units.filter(
    (u) => u.stackId === unit.stackId && u.owned !== false,
  );
}
function mergeableAlliesOf(unit) {
  if (!unit || unit.owned === false || unit.trip || !live?.units) return [];
  return live.units.filter((u) => {
    if (u.owned === false || u.trip) return false;
    if (unit.city && u.city === unit.city) return true;
    const dx = (u.position?.lon ?? 0) - (unit.position?.lon ?? 0);
    const dy = (u.position?.lat ?? 0) - (unit.position?.lat ?? 0);
    return dx * dx + dy * dy <= 0.09 * 0.09;
  });
}
async function sendMove(to) {
  const u = live.units.find((u) => u.id === activeUnit);
  if (!u) return;
  if (u.owned === false) {
    notice("Không thể điều khiển đơn vị của đối phương.");
    cancelDestination();
    return;
  }
  const members = stackMembersOf(u);
  if (members.length >= 2) {
    if (typeof isOnline === "function" && isOnline()) {
      const ok = await sendOnlineGroupUnits("MOVE_STACK", {
        stackId: u.stackId,
        toCityName: to,
      });
      if (ok) cancelDestination();
      return;
    }
    const ok = await commitOrder((s) =>
      groupUnitsOrder(s, "MOVE_STACK", [], u.stackId, to),
    );
    if (ok) {
      if (typeof sfx !== "undefined") sfx.play("move");
      cancelDestination();
    }
    return;
  }
  if (typeof isOnline === "function" && isOnline()) {
    const ok = await sendOnlineMove(u, to);
    if (ok) {
      if (typeof sfx !== "undefined") sfx.play("move");
      cancelDestination();
    }
    return;
  }
  const { id, rev } = u;
  const ok = await commitOrder((s) => moveOrder(s, id, to, rev));
  if (ok) {
    if (typeof sfx !== "undefined") sfx.play("move");
    cancelDestination();
  }
}
function renderArmy() {
  const unit = live.units.find((u) => u.id === activeUnit);
  $("#army").hidden = !unit;
  $("#selection").hidden = !!unit;
  $("#stage").classList.toggle("picking", !!unit && choosingDestination);
  if (!unit) return;
  const isEnemy = unit.owned === false;
  const st = unitStats[unit.key] || unitStats.reserve;
  const stackMembers = isEnemy ? [] : stackMembersOf(unit);
  const isStacked = stackMembers.length >= 2;
  const mergeable = isEnemy ? [] : mergeableAlliesOf(unit);
  const canMerge =
    !isEnemy &&
    !unit.trip &&
    mergeable.length >= 2 &&
    (!isStacked || mergeable.length > stackMembers.length);

  const totalHp = isStacked
    ? stackMembers.reduce((a, m) => a + (m.hp ?? 0), 0)
    : unit.hp;
  const totalMaxHp = isStacked
    ? stackMembers.reduce((a, m) => a + (m.maxHp ?? 0), 0)
    : unit.maxHp;
  const hpText =
    totalHp !== undefined && totalMaxHp !== undefined
      ? "HP " + totalHp + "/" + totalMaxHp
      : "";
  const sumSoft = isStacked
    ? stackMembers.reduce((a, m) => a + (unitStats[m.key]?.softAttack || 0), 0)
    : st.softAttack;
  const sumHard = isStacked
    ? stackMembers.reduce((a, m) => a + (unitStats[m.key]?.hardAttack || 0), 0)
    : st.hardAttack;
  const sumDef = isStacked
    ? stackMembers.reduce((a, m) => a + (unitStats[m.key]?.defense || 0), 0)
    : st.defense;
  const roleTag =
    st.domain === "AIR"
      ? " · Không kích 2.0°"
      : st.domain === "NAVAL"
        ? " · Hải pháo 1.5°"
        : st.ranged
          ? " · Pháo 1.25°"
          : st.canConquer
            ? " · Chiếm đất"
            : "";
  const statMeta =
    " · Công " + sumSoft + "/" + sumHard + " · Thủ " + sumDef + roleTag;
  const atWar = live.online && live.diplomacy?.relation === "WAR";
  $("#armyName").textContent = isEnemy
    ? unitTitle(unit) + " · Đối phương"
    : isStacked
      ? "Đạo quân hợp thành (" + stackMembers.length + " đơn vị · " + hpText + ")"
      : unitTitle(unit) + (hpText ? " (" + hpText + ")" : "");
  $("#armyInfo").textContent = isEnemy
    ? "Liên hệ trinh sát đối phương" +
      (hpText ? " · " + hpText : "") +
      (unit.city ? " tại " + unit.city : "") +
      " · Không thể ra lệnh."
    : choosingDestination
      ? atWar
        ? "Chọn thành phố đồng minh hoặc thành phố đối phương để di chuyển / tiến công."
        : "Chọn thành phố đích trên bản đồ hoặc trong menu Thành phố."
      : unit.inCombat
        ? "ĐANG GIAO TRANH!" + statMeta
        : unit.trip
          ? (isStacked ? "Cả đạo quân đang tới " : "Đang di chuyển tới ") +
            unit.trip.to +
            " · Còn " +
            countdown(unit.trip.end - live.time) +
            statMeta
          : (unit.city ? "Đóng quân tại " + unit.city : "Đã dừng trên đường") +
            (isStacked ? " · Đang chọn " + unitTitle(unit) : "") +
            statMeta;
  $("#move").hidden = isEnemy;
  $("#halt").hidden = isEnemy;
  $("#move").textContent = choosingDestination
    ? "Hủy chọn đích"
    : unit.trip
      ? "Đổi điểm đến"
      : isStacked
        ? atWar
          ? "Tiến công đạo quân"
          : "Hành quân đạo quân"
        : atWar
          ? "Di chuyển / Tiến công"
          : "Di chuyển";
  $("#halt").disabled = isEnemy || !unit.trip;
  const mergeBtn = $("#stackMerge");
  const splitBtn = $("#stackSplit");
  if (mergeBtn) {
    mergeBtn.hidden = !canMerge;
    mergeBtn.textContent = "Gộp quân (" + mergeable.length + ")";
  }
  if (splitBtn) {
    splitBtn.hidden = !isStacked;
  }
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
      const destOwned = live?.cities?.[u.trip.to]?.owned !== false;
      routeLine.classList.toggle("assault", !destOwned);
      route = true;
    }
    if (x < -35 || x > w + 35 || y < -35 || y > h + 35) continue;
    const ownerTag = u.owned === false ? "enemy:" : "own:";
    const key = u.city
      ? ownerTag + "city:" + u.city
      : u.stackId
        ? ownerTag + "stack:" + u.stackId
        : ownerTag + "unit:" + u.id;
    if (!groups.has(key))
      groups.set(key, {
        x,
        y,
        enemy: u.owned === false,
        fighting: false,
        stacked: false,
        units: [],
      });
    const grp = groups.get(key);
    grp.units.push(u);
    if (u.inCombat) grp.fighting = true;
    if (u.stackId) grp.stacked = true;
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
    const first = members[0];
    const firstGlyph = (unitStats[first.key] || unitStats.reserve).glyph;
    const firstLabel = first.displayNumber ?? first.id;
    btn.textContent =
      firstGlyph + " " + (members.length > 1 ? "×" + members.length : firstLabel);
    btn.title = members
      .map(
        (m) =>
          unitTitle(m) +
          (m.hp !== undefined && m.maxHp !== undefined
            ? " (" + m.hp + "/" + m.maxHp + " HP)"
            : ""),
      )
      .join(", ");
    btn.setAttribute("aria-label", "Chọn quân: " + btn.title);
    btn.style.transform =
      "translate(" +
      Math.round(g.x - 13) +
      "px," +
      Math.round(g.y - 29) +
      "px)";
    btn.classList.toggle("active", sel >= 0);
    btn.classList.toggle("enemy", g.enemy);
    btn.classList.toggle("fighting", g.fighting);
    btn.classList.toggle("stacked", g.stacked && members.length > 1);
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
if ($("#stackMerge")) {
  $("#stackMerge").onclick = async () => {
    const u = live.units.find((a) => a.id === activeUnit);
    if (!u) return;
    const allies = mergeableAlliesOf(u);
    if (allies.length < 2) return;
    const ids = allies.map((a) => a.id);
    if (typeof isOnline === "function" && isOnline()) {
      await sendOnlineGroupUnits("MERGE", { unitIds: ids });
    } else {
      const ok = await commitOrder((s) => groupUnitsOrder(s, "MERGE", ids));
      if (ok && typeof sfx !== "undefined") sfx.play("stack");
    }
  };
}
if ($("#stackSplit")) {
  $("#stackSplit").onclick = async () => {
    const u = live.units.find((a) => a.id === activeUnit);
    if (!u?.stackId) return;
    if (typeof isOnline === "function" && isOnline()) {
      await sendOnlineGroupUnits("SPLIT", { unitIds: [u.id] });
    } else {
      const ok = await commitOrder((s) => groupUnitsOrder(s, "SPLIT", [u.id]));
      if (ok && typeof sfx !== "undefined") sfx.play("stack");
    }
  };
}
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
  if (b.dataset.diplomacy && typeof sendOnlineDiplomacy === "function") {
    sendOnlineDiplomacy(b.dataset.diplomacy);
  }
  if (b.dataset.dismissVictory) {
    const vb = $("#victoryBanner");
    if (vb) {
      vb.dataset.dismissed = "1";
      vb.hidden = true;
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
