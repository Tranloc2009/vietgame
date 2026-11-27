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
      const hpPct =
        u.hp !== undefined && u.maxHp
          ? Math.max(0, Math.min(100, Math.round((u.hp / u.maxHp) * 100)))
          : 100;
      const hpStr =
        u.hp !== undefined && u.maxHp !== undefined
          ? " · " + u.hp + "/" + u.maxHp + " HP"
          : "";
      const fac =
        typeof unit3dBridge !== "undefined"
          ? unit3dBridge.resolveUnitFaction(u)
          : "NORTH";
      const learnedList = live?.learned || [];
      const thumb =
        typeof unit3dBridge !== "undefined"
          ? '<img class="unitRowThumb" alt="" src="' +
            unit3dBridge.getPortraitUrl(u.key, fac, u.owned === false ? [] : learnedList) +
            '">'
          : "";
      const modelSub =
        typeof unit3dBridge !== "undefined"
          ? unit3dBridge.getModelDisplayName(u.key, fac, u.owned === false ? [] : learnedList)
          : "";
      return (
        '<button class="unitRow" data-select-unit="' +
        u.id +
        '">' +
        thumb +
        '<div class="unitRowMain"><strong>' +
        st.glyph +
        " " +
        unitTitle(u) +
        "</strong>" +
        (modelSub ? '<small class="unitModelSub">' + escapeText(modelSub) + "</small>" : "") +
        "</div><span class=\"unitRowMeta\">" +
        escapeText(
          (u.inCombat
            ? "⚔ Giao tranh"
            : u.trip
              ? "→ " + u.trip.to
              : u.city || "Đã dừng") + hpStr,
        ) +
        '<span class="miniHpTrack"><i class="' +
        (hpPct < 35 ? "hpLow" : hpPct < 65 ? "hpMid" : "hpHigh") +
        '" style="width:' +
        hpPct +
        '%"></i></span></span></button>'
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
    st.airOnlyRanged
      ? " · Phòng không 1.6°"
      : st.stealth
        ? " · Ngư lôi 1.35° · Tàng hình"
        : st.domain === "AIR"
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

  const fac =
    typeof unit3dBridge !== "undefined"
      ? unit3dBridge.resolveUnitFaction(unit)
      : "NORTH";
  const learnedForUnit = isEnemy ? [] : live?.learned || [];
  const portraitSrc =
    typeof unit3dBridge !== "undefined"
      ? unit3dBridge.getPortraitUrl(unit.key, fac, learnedForUnit)
      : "";
  const modelLabel =
    typeof unit3dBridge !== "undefined"
      ? unit3dBridge.getModelDisplayName(unit.key, fac, learnedForUnit)
      : "";
  const hpPct =
    totalHp !== undefined && totalMaxHp
      ? Math.max(0, Math.min(100, Math.round((totalHp / totalMaxHp) * 100)))
      : 100;
  const hpClass = hpPct < 35 ? "hpLow" : hpPct < 65 ? "hpMid" : "hpHigh";
  const statusLine = isEnemy
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

  const armyInfoHtml =
    '<div class="armyCardWrap">' +
    (portraitSrc
      ? '<div class="armyPortraitBox ' +
        (fac === "NORTH" ? "facNorth" : "facSouth") +
        '"><img class="unitPortrait" alt="' +
        escapeText(modelLabel || unitTitle(unit)) +
        '" src="' +
        portraitSrc +
        '"><span class="portraitFactionTag">' +
        (fac === "NORTH" ? "BẮC" : "NAM") +
        "</span></div>"
      : "") +
    '<div class="armyCardMeta">' +
    (modelLabel
      ? '<div class="armyModelLine"><strong>' +
        escapeText(modelLabel) +
        "</strong>" +
        (unit.key === "motor" && learnedForUnit.includes("motor2")
          ? ' <span class="tierBadge">Cấp II</span>'
          : "") +
        "</div>"
      : "") +
    '<div class="armyHpBar"><i class="' +
    hpClass +
    '" style="width:' +
    hpPct +
    '%"></i><span>' +
    escapeText(hpText || "HP 100%") +
    (hpPct < 65 ? " · Bị thương" : "") +
    "</span></div>" +
    '<div class="armyStatusText">' +
    escapeText(statusLine) +
    "</div></div></div>";
  replaceContent($("#armyInfo"), armyInfoHtml);
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
const SVG_NS = "http://www.w3.org/2000/svg";
const routeSvg = document.createElementNS(SVG_NS, "svg"),
  routeLine = document.createElementNS(SVG_NS, "polyline"),
  routeDestRing = document.createElementNS(SVG_NS, "circle");
routeSvg.classList.add("routeOverlay");
routeSvg.innerHTML =
  '<defs>' +
  '<marker id="routeArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#ffdf7a"/></marker>' +
  '<marker id="routeArrowWar" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#ff6a52"/></marker>' +
  '<marker id="routeArrowAir" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#7fd0ff"/></marker>' +
  '<marker id="routeArrowNaval" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#67e3d4"/></marker>' +
  "</defs>";
routeDestRing.setAttribute("r", "8");
routeDestRing.classList.add("routeDestRing");
routeSvg.append(routeLine, routeDestRing);
$("#unitMarkers").append(routeSvg);
const pins = new Map();
function drawUnits() {
  if (!live) return;
  const groups = new Map(),
    now = simNow(),
    show3d = typeof unit3dBridge !== "undefined" && unit3dBridge.is3DVisibleNow();
  let route = false;
  for (const u of live.units) {
    const pos = pointAt(u, now),
      [x, y] = projectPoint(pos.lon, pos.lat);
    if (u.id === activeUnit && u.trip && u.owned !== false) {
      const points = [pos, ...travelSegment(u, now).remaining];
      const screenPts = points.map((p) => projectPoint(p.lon, p.lat));
      routeLine.setAttribute(
        "points",
        screenPts.map((pt) => pt.join(",")).join(" "),
      );
      const destPt = screenPts[screenPts.length - 1];
      if (destPt) {
        routeDestRing.setAttribute("cx", String(destPt[0]));
        routeDestRing.setAttribute("cy", String(destPt[1]));
      }
      const destOwned = live?.cities?.[u.trip.to]?.owned !== false;
      const domain = (unitStats[u.key] || unitStats.reserve).domain;
      routeLine.classList.toggle("assault", !destOwned);
      routeLine.classList.toggle("airRoute", destOwned && domain === "AIR");
      routeLine.classList.toggle("navalRoute", destOwned && domain === "NAVAL");
      routeDestRing.classList.toggle("assault", !destOwned);
      routeLine.setAttribute(
        "marker-end",
        !destOwned
          ? "url(#routeArrowWar)"
          : domain === "AIR"
            ? "url(#routeArrowAir)"
            : domain === "NAVAL"
              ? "url(#routeArrowNaval)"
              : "url(#routeArrow)",
      );
      route = true;
    }
    if (x < -45 || x > w + 45 || y < -45 || y > h + 45) continue;
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
        faction:
          typeof unit3dBridge !== "undefined"
            ? unit3dBridge.resolveUnitFaction(u)
            : u.owned === false
              ? "SOUTH"
              : "NORTH",
        fighting: false,
        stacked: false,
        hp: 0,
        maxHp: 0,
        units: [],
      });
    const grp = groups.get(key);
    grp.units.push(u);
    grp.hp += u.hp ?? 20;
    grp.maxHp += u.maxHp ?? 20;
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
    const first = sel >= 0 ? members[sel] : members[0];
    const firstGlyph = (unitStats[first.key] || unitStats.reserve).glyph;
    const firstLabel = first.displayNumber ?? first.id;
    const hpPct = g.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((g.hp / g.maxHp) * 100))) : 100;
    const hpCls = hpPct < 35 ? "hpLow" : hpPct < 65 ? "hpMid" : "hpHigh";
    const labelStr = firstGlyph + " " + (members.length > 1 ? "×" + members.length : firstLabel);
    const pinHtml =
      '<span class="pinPlate"><span class="pinLabel">' +
      (g.fighting ? "⚔ " : "") +
      labelStr +
      '</span><span class="pinHp"><i class="' +
      hpCls +
      '" style="width:' +
      hpPct +
      '%"></i></span></span>';
    if (btn._pinHtml !== pinHtml) {
      btn.innerHTML = pinHtml;
      btn._pinHtml = pinHtml;
    }
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
    btn.style.transform = show3d
      ? "translate(" + Math.round(g.x - 24) + "px," + Math.round(g.y - 16) + "px)"
      : "translate(" + Math.round(g.x - 19) + "px," + Math.round(g.y - 31) + "px)";
    btn.classList.toggle("pin3d", show3d);
    btn.classList.toggle("active", sel >= 0);
    btn.classList.toggle("enemy", g.enemy);
    btn.classList.toggle("facNorth", g.faction === "NORTH");
    btn.classList.toggle("facSouth", g.faction === "SOUTH");
    btn.classList.toggle("fighting", g.fighting);
    btn.classList.toggle("damaged", hpPct < 65);
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
  if (!document.hidden && live?.units.some((u) => u.trip)) {
    drawUnits();
    if (typeof unit3dBridge !== "undefined") unit3dBridge.ensureAnimated();
  }
}, 100);
if (typeof unit3dBridge !== "undefined") unit3dBridge.init();
loadCampaign();
