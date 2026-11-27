"use strict";
const MP_STORAGE_KEY = "vdn_campaign_mp_session_v1";
const mp = {
  authMode: "register",
  token: null,
  user: null,
  rooms: [],
  room: null,
  match: null,
  clockOffsetMs: 0,
  ws: null,
  wsState: "idle",
  reconnectTimer: null,
  reconnectAttempt: 0,
  lastDeadlineSyncAt: 0,
  syncing: false,
  error: "",
  roomTitleDraft: "Chiến dịch Việt Nam",
  preferredSlot: "NORTH",
  inviteDraft: "",
  confirmSurrender: false,
};

function isOnline() {
  return Boolean(
    mp.token &&
      mp.room &&
      mp.room.scenarioId === "vietnam_campaign_v1" &&
      (mp.room.status === "ACTIVE" || mp.room.status === "ENDED") &&
      mp.match &&
      mp.match.campaignState,
  );
}

function onlineNowUtc() {
  if (!mp.match?.campaignState) return Date.now();
  return Math.max(mp.match.campaignState.timeUtc, Date.now() + mp.clockOffsetMs);
}

function randomHex(len) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

function saveMpSession() {
  try {
    if (mp.token && mp.user) {
      sessionStorage.setItem(
        MP_STORAGE_KEY,
        JSON.stringify({
          token: mp.token,
          user: mp.user,
          matchId: mp.room?.matchId || null,
        }),
      );
    } else {
      sessionStorage.removeItem(MP_STORAGE_KEY);
    }
  } catch {}
}

async function mpApi(url, options = {}) {
  if (location.protocol === "file:") {
    throw new Error(
      "Chế độ phòng mạng cần mở qua máy chủ ứng dụng (http://localhost:3000).",
    );
  }
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (mp.token) {
    headers.Authorization = "Bearer " + mp.token;
  }
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, ok: res.ok, data };
}

function updateOnlineHeaderBadge() {
  const btn = $("#menuOnline");
  if (!btn) return;
  btn.classList.toggle("onlineActive", isOnline());
}

function buildOnlineLiveState() {
  const cs = mp.match.campaignState;
  const viewerNationId = mp.match.viewerNationId;
  const nation = cs.nations[viewerNationId];
  const now = onlineNowUtc();

  const cities = {};
  for (const city of Object.values(cs.cities)) {
    cities[city.name] = {
      cityId: city.cityId,
      name: city.name,
      ownerNationId: city.ownerNationId,
      owned: city.ownerNationId === viewerNationId,
      capital: Boolean(city.capital),
      material: city.material,
      factory: city.factory,
      office: city.office,
      base: city.base || 0,
      bunker: city.bunker || 0,
      hospital: city.hospital || 0,
      reserve: city.reserve,
      jobs: city.jobs.map((j) => ({
        key: j.key,
        lane: j.lane,
        cost: j.cost,
        start: j.startUtc,
        end: j.endUtc,
      })),
    };
  }

  const units = Object.values(cs.units)
    .sort((a, b) => a.displayNumber - b.displayNumber)
    .map((u) => ({
      id: u.unitId,
      displayNumber: u.displayNumber,
      key: u.key,
      ownerNationId: u.ownerNationId,
      owned: u.ownerNationId === viewerNationId,
      city: u.cityName,
      cityId: u.cityId,
      position: u.position,
      hp: u.hp,
      maxHp: u.maxHp,
      inCombat: Boolean(u.inCombat),
      trip: u.trip
        ? {
            to: u.trip.toCityName,
            toCityId: u.trip.toCityId,
            points: u.trip.points,
            start: u.trip.startUtc,
            end: u.trip.endUtc,
          }
        : null,
      rev: u.rev,
    }));

  const tempState = { cities, units };
  const net = ledger(tempState).net;
  const elapsedMs = cs.victory ? 0 : Math.max(0, now - cs.timeUtc);
  const baseBalance = nation
    ? nation.balance
    : [0, 0, 0, 0, 0, 0, 0];
  const balance = baseBalance.map((v, i) => Math.max(0, v + elapsedMs * net[i]));

  const effectiveVictory =
    cs.victory ||
    (mp.room?.status === "ENDED" && mp.room.winnerSlot
      ? {
          winnerNationId:
            mp.room.winnerSlot === "NORTH" ? "nat_north_dir" : "nat_south_rep",
          winnerSlot: mp.room.winnerSlot,
          reason: mp.room.endedReason === "SURRENDER" ? "SURRENDER" : "VICTORY_POINTS",
          achievedAtUtc: cs.timeUtc,
          targetVp: cs.victoryTargetVp || 400,
          scoresByNation: cs.victoryPointsByNation || {},
        }
      : null);

  return {
    online: true,
    viewerNationId,
    start: cs.startUtc,
    time: effectiveVictory ? cs.timeUtc : now,
    balance,
    cities,
    units,
    learned: nation ? [...nation.learned] : [],
    stats: nation?.stats || null,
    diplomacy: cs.diplomacy || null,
    victoryTargetVp: cs.victoryTargetVp || 400,
    victoryPointsByNation: cs.victoryPointsByNation || {},
    victory: effectiveVictory,
    news: cs.news || [],
    battleReports: cs.battleReports || [],
    study: nation?.study
      ? {
          key: nation.study.key,
          start: nation.study.startUtc,
          end: nation.study.endUtc,
        }
      : null,
    log: cs.log.map((e) => ({
      time: e.timeUtc,
      city: e.cityName,
      text: e.text,
    })),
  };
}

function getNextOnlineDeadlineUtc() {
  if (!isOnline() || mp.match.campaignState.victory) return null;
  const cs = mp.match.campaignState;
  const viewerNationId = mp.match.viewerNationId;
  let earliest = null;
  const consider = (ts) => {
    if (typeof ts !== "number") return;
    if (earliest === null || ts < earliest) earliest = ts;
  };
  const nation = cs.nations[viewerNationId];
  if (nation?.study) consider(nation.study.endUtc);
  for (const city of Object.values(cs.cities)) {
    if (city.ownerNationId !== viewerNationId) continue;
    for (const job of city.jobs) consider(job.endUtc);
  }
  for (const u of Object.values(cs.units)) {
    if (u.ownerNationId === viewerNationId && u.trip) consider(u.trip.endUtc);
    if (cs.diplomacy?.relation === "WAR" && (u.inCombat || u.key === "artillery")) {
      consider(u.lastCombatUtc ? u.lastCombatUtc + 10000 : cs.timeUtc + 10000);
    }
    if (
      u.ownerNationId === viewerNationId &&
      !u.trip &&
      !u.inCombat &&
      u.hp < u.maxHp &&
      u.cityId &&
      (cs.cities[u.cityId]?.hospital || 0) > 0
    ) {
      consider((u.lastHealUtc || cs.timeUtc) + 30000);
    }
  }
  return earliest;
}

function maybeAutoSyncOnlineDeadlines() {
  if (!isOnline() || mp.syncing) return;
  const nextDeadline = getNextOnlineDeadlineUtc();
  if (nextDeadline === null) return;
  const now = onlineNowUtc();
  if (now >= nextDeadline - 50 && Date.now() - mp.lastDeadlineSyncAt >= 650) {
    mp.lastDeadlineSyncAt = Date.now();
    pullOnlineSnapshot();
  }
}

function closeOnlineSocket() {
  if (mp.reconnectTimer) {
    clearTimeout(mp.reconnectTimer);
    mp.reconnectTimer = null;
  }
  if (mp.ws) {
    try {
      mp.ws.onclose = null;
      mp.ws.onmessage = null;
      mp.ws.onerror = null;
      mp.ws.close();
    } catch {}
    mp.ws = null;
  }
  mp.wsState = "idle";
}

function connectOnlineSocket() {
  closeOnlineSocket();
  if (!mp.token || !mp.room || location.protocol === "file:") return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = proto + "//" + location.host + "/ws";
  mp.wsState = "connecting";
  renderMpPanel();

  const ws = new WebSocket(wsUrl);
  mp.ws = ws;
  ws.onopen = () => {
    mp.reconnectAttempt = 0;
    ws.send(
      JSON.stringify({
        type: "room:subscribe",
        token: mp.token,
        matchId: mp.room.matchId,
      }),
    );
  };
  ws.onmessage = (evt) => {
    let msg;
    try {
      msg = JSON.parse(String(evt.data));
    } catch {
      return;
    }
    if (typeof msg.serverUtc === "number") {
      mp.clockOffsetMs = msg.serverUtc - Date.now();
    }
    if (msg.type === "room:snapshot" && msg.matchId === mp.room?.matchId) {
      const wasActive = mp.room?.status === "ACTIVE";
      mp.room = msg.room;
      mp.match = msg.match;
      mp.wsState = "connected";
      saveMpSession();
      updateOnlineHeaderBadge();
      if (!wasActive && mp.room.status === "ACTIVE") {
        panel(null);
      }
      renderMpPanel();
      refresh();
      return;
    }
    if (msg.type === "room:status" && msg.matchId === mp.room?.matchId) {
      const wasActive = mp.room?.status === "ACTIVE";
      mp.room = msg.room;
      saveMpSession();
      updateOnlineHeaderBadge();
      if (!wasActive && mp.room.status === "ACTIVE") {
        pullOnlineSnapshot();
        panel(null);
      } else if (wasActive && mp.room.status === "ENDED") {
        mp.confirmSurrender = false;
        pullOnlineSnapshot();
      }
      renderMpPanel();
      refresh();
      return;
    }
    if (msg.type === "room:delta" && msg.matchId === mp.room?.matchId) {
      if (!mp.match || msg.version > mp.match.version) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "room:resync",
              matchId: mp.room.matchId,
              fullSnapshot: true,
            }),
          );
        } else {
          pullOnlineSnapshot();
        }
      }
      return;
    }
    if (msg.type === "room:error") {
      mp.error = msg.reason || "Lỗi đồng bộ WebSocket.";
      renderMpPanel();
    }
  };
  ws.onclose = () => {
    if (mp.ws !== ws) return;
    mp.ws = null;
    if (!mp.token || !mp.room) {
      mp.wsState = "idle";
      return;
    }
    mp.wsState = "reconnecting";
    renderMpPanel();
    const delay = Math.min(8000, 1000 * 2 ** mp.reconnectAttempt);
    mp.reconnectAttempt += 1;
    mp.reconnectTimer = setTimeout(() => {
      if (mp.token && mp.room) {
        pullOnlineSnapshot();
        connectOnlineSocket();
      }
    }, delay);
  };
}

async function pullOnlineSnapshot() {
  if (!mp.token || !mp.room || mp.syncing) return false;
  mp.syncing = true;
  try {
    const res = await mpApi("/api/rooms/" + encodeURIComponent(mp.room.matchId));
    if (res.ok && res.data?.ok) {
      if (typeof res.data.serverUtc === "number") {
        mp.clockOffsetMs = res.data.serverUtc - Date.now();
      }
      mp.room = res.data.room;
      mp.match = res.data.match;
      updateOnlineHeaderBadge();
      renderMpPanel();
      refresh();
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    mp.syncing = false;
  }
}

async function refreshMyRooms() {
  if (!mp.token) return;
  const res = await mpApi("/api/rooms");
  if (res.ok && res.data?.ok) {
    mp.rooms = (res.data.rooms || []).filter(
      (r) => r.scenarioId === "vietnam_campaign_v1",
    );
    renderMpPanel();
  }
}

async function sendOnlineCommand(payload, retryKey = null, attempt = 0) {
  if (!isOnline()) {
    notice("Chưa vào phòng chiến dịch đang diễn ra.");
    return false;
  }
  if (mp.room.status !== "ACTIVE" || mp.match?.campaignState?.victory) {
    notice("Trận chiến dịch đã kết thúc.");
    return false;
  }
  if (busy && attempt === 0) return false;
  busy = true;
  const idempotencyKey = retryKey || "idem_vn_" + randomHex(16);
  try {
    const actorId = mp.room.viewerActorId;
    const actor = mp.match.actors[actorId];
    const cmd = {
      schemaVersion: "1.0.0",
      commandId: "cmd_vn_" + randomHex(16),
      matchId: mp.room.matchId,
      actorId,
      idempotencyKey,
      sequence: (actor?.lastSequence ?? 0) + 1,
      expectedVersion: mp.match.version,
      issuedAtUtc: Date.now(),
      payload,
    };
    const res = await mpApi(
      "/api/rooms/" + encodeURIComponent(mp.room.matchId) + "/commands",
      { method: "POST", body: cmd },
    );
    if (res.ok && res.data?.ok) {
      if (typeof res.data.serverUtc === "number") {
        mp.clockOffsetMs = res.data.serverUtc - Date.now();
      }
      mp.match = res.data.match;
      $("#notice").hidden = true;
      refresh();
      return true;
    }
    const code = res.data?.code;
    if (
      attempt === 0 &&
      (code === "VERSION_CONFLICT" || code === "INVALID_SEQUENCE")
    ) {
      busy = false;
      const synced = await pullOnlineSnapshot();
      if (synced) {
        return sendOnlineCommand(payload, idempotencyKey, 1);
      }
    }
    notice(res.data?.reason || "Máy chủ từ chối lệnh.");
    return false;
  } catch (e) {
    notice(e?.message || "Mất kết nối tới máy chủ.");
    return false;
  } finally {
    busy = false;
  }
}

async function sendOnlineResearch(doctrineKey, cancel, expectedStartUtc) {
  const nationId = mp.match.viewerNationId;
  if (cancel) {
    return sendOnlineCommand({
      type: "CAMPAIGN_CANCEL_RESEARCH",
      nationId,
      doctrineKey,
      expectedStartUtc,
    });
  }
  return sendOnlineCommand({
    type: "CAMPAIGN_START_RESEARCH",
    nationId,
    doctrineKey,
  });
}

async function sendOnlineCityProject(cityName, projectKey, cancel, expectedStartUtc) {
  const nationId = mp.match.viewerNationId;
  const city = live?.cities?.[cityName];
  if (!city?.cityId) {
    notice("Không xác định được mã thành phố.");
    return false;
  }
  if (cancel) {
    return sendOnlineCommand({
      type: "CAMPAIGN_CANCEL_CITY_PROJECT",
      nationId,
      cityId: city.cityId,
      projectKey,
      expectedStartUtc,
    });
  }
  return sendOnlineCommand({
    type: "CAMPAIGN_START_CITY_PROJECT",
    nationId,
    cityId: city.cityId,
    projectKey,
  });
}

async function sendOnlineMove(unit, toCityName) {
  const nationId = mp.match.viewerNationId;
  let toCityId = null;
  if (toCityName !== null) {
    const dest = live?.cities?.[toCityName];
    if (!dest?.cityId) {
      notice("Thành phố đích không hợp lệ.");
      return false;
    }
    toCityId = dest.cityId;
  }
  return sendOnlineCommand({
    type: "CAMPAIGN_MOVE_UNIT",
    nationId,
    unitId: unit.id,
    toCityId,
    expectedRev: unit.rev,
  });
}

async function sendOnlineDiplomacy(action) {
  if (!isOnline()) {
    notice("Ngoại giao chỉ khả dụng trong phòng mạng.");
    return false;
  }
  const nationId = mp.match.viewerNationId;
  const targetNationId =
    nationId === "nat_north_dir" ? "nat_south_rep" : "nat_north_dir";
  return sendOnlineCommand({
    type: "CAMPAIGN_SET_DIPLOMACY",
    nationId,
    targetNationId,
    action,
  });
}

function renderDiplomacyHtml() {
  if (!isOnline() || !live?.diplomacy) {
    return '<div class="mpBox"><h3>Chế độ chơi đơn</h3><p class="mpMuted">Mở nút <b>Phòng mạng</b> để thi đấu 2 người chơi với ngoại giao, chiến tranh, chiếm đóng thành phố và điểm chiến thắng.</p></div>';
  }
  const dip = live.diplomacy;
  const myId = live.viewerNationId;
  const myLabel = myId === "nat_north_dir" ? "Phương Bắc" : "Phương Nam";
  const oppLabel = myId === "nat_north_dir" ? "Phương Nam" : "Phương Bắc";
  const northVp = live.victoryPointsByNation?.nat_north_dir ?? 0;
  const southVp = live.victoryPointsByNation?.nat_south_rep ?? 0;
  const targetVp = live.victoryTargetVp || 400;
  const northCities = Object.values(live.cities).filter(
    (c) => c.ownerNationId === "nat_north_dir",
  ).length;
  const southCities = Object.values(live.cities).filter(
    (c) => c.ownerNationId === "nat_south_rep",
  ).length;

  let actionsHtml = "";
  if (!live.victory) {
    if (dip.relation === "PEACE") {
      actionsHtml +=
        '<button class="dipBtnWar" data-diplomacy="DECLARE_WAR">⚔ Tuyên chiến với ' +
        oppLabel +
        "</button>";
      if (dip.sharedIntelActive) {
        actionsHtml +=
          '<button data-diplomacy="END_INTEL">Chấm dứt chia sẻ tình báo</button>';
      } else if (dip.intelProposedByNationId && dip.intelProposedByNationId !== myId) {
        actionsHtml +=
          '<button class="mpBtnPrimary" data-diplomacy="ACCEPT_INTEL">Chấp nhận chia sẻ tình báo</button>';
      } else if (dip.intelProposedByNationId === myId) {
        actionsHtml +=
          '<button disabled>Đang chờ đối phương đồng ý tình báo</button>';
      } else {
        actionsHtml +=
          '<button data-diplomacy="PROPOSE_INTEL">Đề nghị chia sẻ tình báo</button>';
      }
    } else {
      if (dip.peaceProposedByNationId && dip.peaceProposedByNationId !== myId) {
        actionsHtml +=
          '<button class="mpBtnPrimary" data-diplomacy="ACCEPT_PEACE">Chấp nhận đình chiến (Hòa bình)</button>';
      } else if (dip.peaceProposedByNationId === myId) {
        actionsHtml +=
          '<button disabled>Đã gửi đề nghị hòa bình</button>';
      } else {
        actionsHtml +=
          '<button data-diplomacy="PROPOSE_PEACE">Đề nghị hòa bình</button>';
      }
    }
  }

  const stats = live.stats;
  const statsHtml = stats
    ? '<div class="mpBox"><h3>Thành tích ' +
      myLabel +
      '</h3><p class="mpMuted">Đã huy động: <b>' +
      stats.unitsMobilized +
      "</b> · Tiêu diệt địch: <b>" +
      stats.enemyUnitsDestroyed +
      "</b> · Tổn thất: <b>" +
      stats.unitsLost +
      "</b> · Chiếm thành phố: <b>" +
      stats.citiesCaptured +
      "</b></p></div>"
    : "";

  return (
    '<div class="dipWrap">' +
    '<div class="mpBox"><h3>Điểm chiến thắng · Mục tiêu ' +
    targetVp +
    " điểm</h3>" +
    '<div class="vpRow"><span>Phương Bắc (' +
    northCities +
    ' TP)</span><strong>' +
    northVp +
    " / " +
    targetVp +
    '</strong></div><progress max="' +
    targetVp +
    '" value="' +
    Math.min(targetVp, northVp) +
    '"></progress>' +
    '<div class="vpRow"><span>Phương Nam (' +
    southCities +
    ' TP)</span><strong>' +
    southVp +
    " / " +
    targetVp +
    '</strong></div><progress max="' +
    targetVp +
    '" value="' +
    Math.min(targetVp, southVp) +
    '"></progress></div>' +
    '<div class="mpBox"><div class="mpRow"><h3>Quan hệ với ' +
    oppLabel +
    '</h3><span class="mpTag ' +
    (dip.relation === "WAR" ? "warTag" : "ready") +
    '">' +
    (dip.relation === "WAR" ? "CHIẾN TRANH" : "HÒA BÌNH") +
    "</span></div>" +
    '<p class="mpMuted">' +
    (dip.relation === "WAR"
      ? "Quân đội có thể tiến công thành phố đối phương và giao tranh trực tiếp."
      : dip.sharedIntelActive
        ? "Đang hòa bình và chia sẻ tầm nhìn chiến trường."
        : "Đang hòa bình. Cần tuyên chiến trước khi tiến vào thành phố đối phương.") +
    '</p><div class="dipActions">' +
    actionsHtml +
    "</div></div>" +
    statsHtml +
    "</div>"
  );
}

function renderCampaignNewsAndBattlesHtml() {
  const news = live?.news || [];
  const reports = live?.battleReports || [];
  let html = "";
  if (news.length) {
    html +=
      '<h4 class="subHead">Nhật báo chiến sự</h4><ol class="eventList">' +
      news
        .slice(0, 25)
        .map(
          (n) =>
            '<li><time>' +
            new Date(n.timeUtc).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }) +
            "</time><span><b>" +
            escapeText(n.headline) +
            "</b> — " +
            escapeText(n.detail) +
            "</span></li>",
        )
        .join("") +
      "</ol>";
  }
  if (reports.length) {
    html +=
      '<h4 class="subHead">Báo cáo chiến đấu (' +
      reports.length +
      ')</h4><ol class="eventList">' +
      reports
        .slice(0, 20)
        .map(
          (r) =>
            "<li><time>" +
            new Date(r.occurredAtUtc).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }) +
            "</time><span><b>" +
            (r.kind === "BOMBARDMENT" ? "◎ Pháo kích" : "⚔ Cận chiến") +
            "</b> · " +
            escapeText(r.summary) +
            "</span></li>",
        )
        .join("") +
      "</ol>";
  }
  return html;
}

function renderVictoryBanner() {
  const el = $("#victoryBanner");
  if (!el) return;
  const v = live?.online ? live.victory : null;
  if (!v) {
    el.hidden = true;
    delete el.dataset.dismissed;
    return;
  }
  if (el.dataset.dismissed === "1") return;
  const won = v.winnerNationId === live.viewerNationId;
  const winnerName = v.winnerSlot === "NORTH" ? "PHƯƠNG BẮC" : "PHƯƠNG NAM";
  const reasonText =
    v.reason === "TOTAL_CONQUEST"
      ? "Kiểm soát toàn bộ bản đồ Việt Nam."
      : v.reason === "SURRENDER"
        ? "Đối phương đã đầu hàng."
        : "Đạt ngưỡng " + v.targetVp + " điểm chiến thắng.";
  const nVp = v.scoresByNation?.nat_north_dir ?? 0;
  const sVp = v.scoresByNation?.nat_south_rep ?? 0;
  const html =
    '<div class="panelHead"><h2>' +
    (won ? "CHIẾN THẮNG CHIẾN DỊCH" : "THẤT BẠI CHIẾN DỊCH") +
    '</h2><button type="button" data-dismiss-victory="1" aria-label="Đóng bảng kết quả">×</button></div>' +
    '<div class="victoryBody"><strong>' +
    winnerName +
    " GIÀNH THẮNG LỢI</strong><p>" +
    escapeText(reasonText) +
    "</p><p>Điểm chung cuộc: Phương Bắc <b>" +
    nVp +
    "</b> · Phương Nam <b>" +
    sVp +
    "</b></p></div>";
  replaceContent(el, html);
  el.hidden = false;
}

async function enterOnlineRoom(matchId) {
  mp.error = "";
  const res = await mpApi("/api/rooms/" + encodeURIComponent(matchId));
  if (!res.ok || !res.data?.ok) {
    mp.error = res.data?.reason || "Không mở được phòng.";
    renderMpPanel();
    return;
  }
  if (res.data.room.scenarioId !== "vietnam_campaign_v1") {
    mp.error = "Phòng này thuộc bản đồ 1955 cũ. Hãy mở tại /rooms.html.";
    renderMpPanel();
    return;
  }
  mp.room = res.data.room;
  mp.match = res.data.match;
  activeUnit = null;
  choosingDestination = false;
  selected = null;
  saveMpSession();
  updateOnlineHeaderBadge();
  connectOnlineSocket();
  if (mp.room.status === "ACTIVE") {
    panel(null);
  }
  renderMpPanel();
  refresh();
}

async function restoreOnlineSession() {
  if (location.protocol === "file:") return;
  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(MP_STORAGE_KEY) || "null");
  } catch {}
  if (!stored?.token) return;
  mp.token = stored.token;
  try {
    const me = await mpApi("/api/auth/me");
    if (!me.ok || !me.data?.ok) {
      mp.token = null;
      mp.user = null;
      saveMpSession();
      return;
    }
    mp.user = me.data.user;
    await refreshMyRooms();
    if (stored.matchId) {
      const roomRes = await mpApi(
        "/api/rooms/" + encodeURIComponent(stored.matchId),
      );
      if (
        roomRes.ok &&
        roomRes.data?.ok &&
        roomRes.data.room.scenarioId === "vietnam_campaign_v1"
      ) {
        mp.room = roomRes.data.room;
        mp.match = roomRes.data.match;
        updateOnlineHeaderBadge();
        connectOnlineSocket();
      }
    }
  } catch {
    // Keep offline fallback if server unreachable
  }
}

function renderMpPanel() {
  const body = $("#mpBody");
  if (!body) return;
  if (location.protocol === "file:") {
    body.innerHTML =
      '<div class="mpBox"><h3>Chế độ ngoại tuyến</h3><p class="mpMuted">Bạn đang mở tệp trực tiếp. Để chơi phòng mạng nhiều người chơi, hãy chạy máy chủ ứng dụng và truy cập qua HTTP.</p></div>';
    return;
  }

  const errHtml = mp.error
    ? '<div class="mpError" role="alert">' + escapeText(mp.error) + "</div>"
    : "";

  if (!mp.token || !mp.user) {
    const isReg = mp.authMode === "register";
    body.innerHTML =
      errHtml +
      '<div class="mpTabs">' +
      '<button type="button" data-mp-auth-mode="register" aria-pressed="' +
      isReg +
      '">Đăng ký</button>' +
      '<button type="button" data-mp-auth-mode="login" aria-pressed="' +
      !isReg +
      '">Đăng nhập</button>' +
      "</div>" +
      '<form id="mpAuthForm" class="mpBox">' +
      "<h3>" +
      (isReg ? "Tạo tài khoản chỉ huy" : "Đăng nhập chỉ huy") +
      "</h3>" +
      '<div class="mpField"><label for="mpUsername">Tên đăng nhập</label><input id="mpUsername" name="username" required minlength="3" autocomplete="username" placeholder="vd: bac_01"></div>' +
      (isReg
        ? '<div class="mpField"><label for="mpDisplayName">Tên hiển thị</label><input id="mpDisplayName" name="displayName" required minlength="2" placeholder="vd: Chỉ huy Phương Bắc"></div>'
        : "") +
      '<div class="mpField"><label for="mpPassword">Mật khẩu (tối thiểu 8 ký tự)</label><input id="mpPassword" name="password" type="password" required minlength="8" autocomplete="' +
      (isReg ? "new-password" : "current-password") +
      '"></div>' +
      '<button type="submit" id="mpAuthSubmit" class="mpBtnPrimary">' +
      (isReg ? "Đăng ký & vào sảnh" : "Đăng nhập") +
      "</button>" +
      "</form>" +
      '<p class="mpMuted">Tài khoản dùng chung với hệ thống phòng đấu SQLite của máy chủ. <a class="mpFootLink" href="/rooms.html">Mở phòng bản đồ 1955 cũ</a></p>';
    return;
  }

  let html =
    errHtml +
    '<div class="mpRow"><strong>' +
    escapeText(mp.user.displayName) +
    ' <small class="mpMuted">(@' +
    escapeText(mp.user.username) +
    ")</small></strong>" +
    '<button type="button" id="mpLogout" class="mpBtnSmall">Đăng xuất</button></div>';

  if (mp.room) {
    const r = mp.room;
    const mySlot = r.viewerSlot;
    const myReady = mySlot ? r.slots[mySlot].ready : false;
    const canStart =
      r.status === "LOBBY" &&
      Boolean(r.slots.NORTH.userId) &&
      Boolean(r.slots.SOUTH.userId) &&
      r.slots.NORTH.ready &&
      r.slots.SOUTH.ready;
    const statusLabel =
      r.status === "LOBBY"
        ? "CHỜ SẴN SÀNG"
        : r.status === "ACTIVE"
          ? "ĐANG DIỄN RA"
          : "ĐÃ KẾT THÚC";
    const wsLabel =
      mp.wsState === "connected"
        ? "WS trực tuyến"
        : mp.wsState === "reconnecting"
          ? "Đang nối lại…"
          : "Đang kết nối…";

    html +=
      '<div class="mpBox">' +
      '<div class="mpRow"><h3>' +
      escapeText(r.title) +
      '</h3><span class="mpTag ' +
      (r.status === "ACTIVE" ? "ready" : "") +
      '">' +
      statusLabel +
      "</span></div>" +
      '<div class="mpRow"><span class="mpMuted">Mã mời:</span><code id="mpInviteCode" class="mpCode">' +
      escapeText(r.inviteCode) +
      "</code></div>" +
      '<div class="mpSlot"><span>PHƯƠNG BẮC · ' +
      escapeText(r.slots.NORTH.displayName || "Đang chờ") +
      '</span><span class="mpTag ' +
      (r.slots.NORTH.ready ? "ready" : "") +
      '">' +
      (r.slots.NORTH.ready ? "Sẵn sàng" : "Chưa") +
      "</span></div>" +
      '<div class="mpSlot"><span>PHƯƠNG NAM · ' +
      escapeText(r.slots.SOUTH.displayName || "Đang chờ") +
      '</span><span class="mpTag ' +
      (r.slots.SOUTH.ready ? "ready" : "") +
      '">' +
      (r.slots.SOUTH.ready ? "Sẵn sàng" : "Chưa") +
      "</span></div>";

    if (r.status === "LOBBY") {
      html +=
        '<div class="mpRow">' +
        '<button type="button" id="mpReadyBtn" class="mpBtnPrimary">' +
        (myReady ? "Hủy sẵn sàng" : "Sẵn sàng") +
        "</button>" +
        '<button type="button" id="mpStartBtn" class="mpBtnPrimary" ' +
        (canStart ? "" : "disabled") +
        ">Bắt đầu trận</button>" +
        "</div>";
    } else if (r.status === "ACTIVE") {
      html +=
        '<div class="mpRow"><span class="mpMuted">Kênh đồng bộ: ' +
        wsLabel +
        " · v" +
        (mp.match?.version ?? 0) +
        '</span><button type="button" id="mpSyncBtn" class="mpBtnSmall">Đồng bộ</button></div>' +
        '<div class="mpRow">' +
        (mp.confirmSurrender
          ? '<button type="button" id="mpSurrenderConfirm" class="dipBtnWar">Xác nhận đầu hàng</button><button type="button" id="mpSurrenderCancel" class="mpBtnSmall">Hủy</button>'
          : '<button type="button" id="mpSurrenderBtn" class="mpBtnSmall">Đầu hàng trận đấu</button>') +
        "</div>";
    }
    html +=
      '<div class="mpRow"><button type="button" id="mpLeaveBtn" class="mpBtnSmall">Chuyển sang chơi đơn</button></div></div>';
  }

  if (!mp.room || mp.room.status !== "ACTIVE") {
    html +=
      '<form id="mpCreateForm" class="mpBox">' +
      "<h3>Tạo phòng bản đồ Việt Nam mới</h3>" +
      '<div class="mpField"><label for="mpRoomTitle">Tên phòng</label><input id="mpRoomTitle" name="title" required minlength="3" value="' +
      escapeText(mp.roomTitleDraft) +
      '"></div>' +
      '<div class="mpField"><label for="mpSlot">Chọn phe</label><select id="mpSlot" name="preferredSlot">' +
      '<option value="NORTH" ' +
      (mp.preferredSlot === "NORTH" ? "selected" : "") +
      ">Phương Bắc (Hà Nội · Đà Nẵng · 30 thành phố)</option>" +
      '<option value="SOUTH" ' +
      (mp.preferredSlot === "SOUTH" ? "selected" : "") +
      ">Phương Nam (TP. Hồ Chí Minh · Cần Thơ · 30 thành phố)</option>" +
      "</select></div>" +
      '<button type="submit" id="mpCreateRoom" class="mpBtnPrimary">Tạo phòng chiến dịch</button>' +
      "</form>" +
      '<form id="mpJoinForm" class="mpBox">' +
      "<h3>Vào phòng bằng mã mời</h3>" +
      '<div class="mpField"><label for="mpInviteInput">Mã mời (VDN-XXXX-XXXX)</label><input id="mpInviteInput" name="inviteCode" required placeholder="VDN-XXXX-XXXX" value="' +
      escapeText(mp.inviteDraft) +
      '"></div>' +
      '<button type="submit" id="mpJoinRoom" class="mpBtnPrimary">Tham gia phòng</button>' +
      "</form>";
  }

  if (mp.rooms.length) {
    html +=
      '<div class="mpBox"><h3>Phòng Việt Nam của bạn</h3>' +
      mp.rooms
        .map(
          (r) =>
            '<button type="button" class="mpRoomItem" data-mp-enter="' +
            escapeText(r.matchId) +
            '"><span>' +
            escapeText(r.title) +
            " (" +
            escapeText(r.inviteCode) +
            ')</span><span class="mpTag">' +
            escapeText(r.status) +
            "</span></button>",
        )
        .join("") +
      "</div>";
  }

  html +=
    '<p class="mpMuted"><a class="mpFootLink" href="/rooms.html">Mở phòng bản đồ 1955 cũ (/rooms.html)</a></p>';

  body.innerHTML = html;
}

$("#menuOnline").onclick = () => {
  panel("mpPanel");
  if (!$("#mpPanel").hidden) {
    renderMpPanel();
    if (mp.token) refreshMyRooms();
  }
};

$("#mpBody").addEventListener("click", async (e) => {
  if (!(e.target instanceof Element)) return;
  const btn = /** @type {HTMLButtonElement | null} */ (e.target.closest("button"));
  if (!btn || btn.disabled) return;

  if (btn.dataset.mpAuthMode) {
    mp.authMode = btn.dataset.mpAuthMode;
    mp.error = "";
    renderMpPanel();
    return;
  }
  if (btn.id === "mpLogout") {
    try {
      await mpApi("/api/auth/logout", { method: "POST" });
    } catch {}
    closeOnlineSocket();
    mp.token = null;
    mp.user = null;
    mp.room = null;
    mp.match = null;
    mp.rooms = [];
    mp.error = "";
    activeUnit = null;
    choosingDestination = false;
    selected = null;
    saveMpSession();
    updateOnlineHeaderBadge();
    renderMpPanel();
    refresh();
    return;
  }
  if (btn.id === "mpLeaveBtn") {
    closeOnlineSocket();
    mp.room = null;
    mp.match = null;
    activeUnit = null;
    choosingDestination = false;
    selected = null;
    saveMpSession();
    updateOnlineHeaderBadge();
    renderMpPanel();
    refresh();
    return;
  }
  if (btn.id === "mpSyncBtn") {
    await pullOnlineSnapshot();
    return;
  }
  if (btn.id === "mpSurrenderBtn") {
    mp.confirmSurrender = true;
    renderMpPanel();
    return;
  }
  if (btn.id === "mpSurrenderCancel") {
    mp.confirmSurrender = false;
    renderMpPanel();
    return;
  }
  if (btn.id === "mpSurrenderConfirm" && mp.room) {
    mp.confirmSurrender = false;
    const res = await mpApi(
      "/api/rooms/" + encodeURIComponent(mp.room.matchId) + "/surrender",
      { method: "POST", body: {} },
    );
    if (res.ok && res.data?.ok) {
      mp.room = res.data.room;
      mp.error = "";
      await pullOnlineSnapshot();
      panel(null);
    } else {
      mp.error = res.data?.reason || "Không thể đầu hàng lúc này.";
      renderMpPanel();
    }
    return;
  }
  if (btn.id === "mpReadyBtn" && mp.room) {
    const mySlot = mp.room.viewerSlot;
    const nextReady = !mp.room.slots[mySlot].ready;
    const res = await mpApi(
      "/api/rooms/" + encodeURIComponent(mp.room.matchId) + "/ready",
      { method: "POST", body: { ready: nextReady } },
    );
    if (res.ok && res.data?.ok) {
      mp.room = res.data.room;
      mp.error = "";
    } else {
      mp.error = res.data?.reason || "Không cập nhật được trạng thái sẵn sàng.";
    }
    renderMpPanel();
    return;
  }
  if (btn.id === "mpStartBtn" && mp.room) {
    const res = await mpApi(
      "/api/rooms/" + encodeURIComponent(mp.room.matchId) + "/start",
      { method: "POST", body: {} },
    );
    if (res.ok && res.data?.ok) {
      mp.room = res.data.room;
      mp.error = "";
      await pullOnlineSnapshot();
      panel(null);
    } else {
      mp.error = res.data?.reason || "Chưa thể bắt đầu trận.";
      renderMpPanel();
    }
    return;
  }
  if (btn.dataset.mpEnter) {
    await enterOnlineRoom(btn.dataset.mpEnter);
  }
});

$("#mpBody").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  mp.error = "";

  if (form.id === "mpAuthForm") {
    const fd = new FormData(form);
    const username = String(fd.get("username") || "").trim();
    const password = String(fd.get("password") || "");
    const displayName = String(fd.get("displayName") || "").trim();
    const endpoint =
      mp.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const body =
      mp.authMode === "register"
        ? { username, displayName, password }
        : { username, password };
    try {
      const res = await mpApi(endpoint, { method: "POST", body });
      if (!res.ok || !res.data?.ok) {
        mp.error = res.data?.reason || "Xác thực thất bại.";
        renderMpPanel();
        return;
      }
      mp.token = res.data.token;
      mp.user = res.data.user;
      saveMpSession();
      await refreshMyRooms();
      renderMpPanel();
    } catch (err) {
      mp.error = err?.message || "Không thể kết nối máy chủ.";
      renderMpPanel();
    }
    return;
  }

  if (form.id === "mpCreateForm") {
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const preferredSlot = String(fd.get("preferredSlot") || "NORTH");
    mp.roomTitleDraft = title;
    mp.preferredSlot = preferredSlot;
    try {
      const res = await mpApi("/api/rooms", {
        method: "POST",
        body: { title, preferredSlot, scenarioId: "vietnam_campaign_v1" },
      });
      if (!res.ok || !res.data?.ok) {
        mp.error = res.data?.reason || "Không tạo được phòng.";
        renderMpPanel();
        return;
      }
      mp.room = res.data.room;
      mp.match = res.data.match;
      saveMpSession();
      updateOnlineHeaderBadge();
      connectOnlineSocket();
      await refreshMyRooms();
      renderMpPanel();
    } catch (err) {
      mp.error = err?.message || "Không tạo được phòng.";
      renderMpPanel();
    }
    return;
  }

  if (form.id === "mpJoinForm") {
    const fd = new FormData(form);
    const inviteCode = String(fd.get("inviteCode") || "").trim().toUpperCase();
    mp.inviteDraft = inviteCode;
    try {
      const res = await mpApi("/api/rooms/join", {
        method: "POST",
        body: { inviteCode },
      });
      if (!res.ok || !res.data?.ok) {
        mp.error = res.data?.reason || "Không tham gia được phòng.";
        renderMpPanel();
        return;
      }
      if (res.data.room.scenarioId !== "vietnam_campaign_v1") {
        mp.error =
          "Mã mời này thuộc bản đồ 1955 cũ. Hãy mở tại /rooms.html.";
        renderMpPanel();
        return;
      }
      mp.room = res.data.room;
      mp.match = res.data.match;
      saveMpSession();
      updateOnlineHeaderBadge();
      connectOnlineSocket();
      await refreshMyRooms();
      if (mp.room.status === "ACTIVE") {
        panel(null);
        refresh();
      } else {
        renderMpPanel();
      }
    } catch (err) {
      mp.error = err?.message || "Không tham gia được phòng.";
      renderMpPanel();
    }
  }
});
