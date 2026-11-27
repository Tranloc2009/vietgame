"use strict";
const doctrines = {
  motor: {
    branch: "BỘ BINH",
    tier: "I",
    name: "Bộ binh cơ giới I",
    description: "Mở huy động bộ binh cơ giới có khả năng chiếm đóng thành phố.",
    cost: [180, 0, 0, 0, 80, 0, 240],
    seconds: 45,
    requires: null,
  },
  motor2: {
    branch: "BỘ BINH",
    tier: "II",
    name: "Bộ binh cơ giới II",
    description: "Rút thời gian lệnh di chuyển mới từ 32 xuống 24 giây và +20% hỏa lực.",
    cost: [240, 0, 0, 0, 120, 0, 360],
    seconds: 65,
    requires: "motor",
  },
  recon: {
    branch: "THIẾT GIÁP",
    tier: "I",
    name: "Xe trinh sát chiến đấu I",
    description: "Mở xe trinh sát tốc độ cao (22s), tầm quan sát 2.25°.",
    cost: [150, 90, 0, 30, 60, 0, 220],
    seconds: 45,
    requires: null,
  },
  tank: {
    branch: "THIẾT GIÁP",
    tier: "II",
    name: "Xe tăng chủ lực I",
    description: "Mở xe tăng chủ lực giáp nặng, hỏa lực mạnh (cần Căn cứ cấp 2).",
    cost: [220, 180, 60, 50, 120, 0, 420],
    seconds: 75,
    requires: "recon",
  },
  artillery: {
    branch: "HỖ TRỢ",
    tier: "I",
    name: "Pháo binh dã chiến I",
    description: "Mở pháo binh bắn tầm xa 1.25° không chịu phản công cận chiến.",
    cost: [200, 140, 0, 60, 100, 0, 340],
    seconds: 60,
    requires: "motor",
  },
};
projects.motor = {
  label: "Bộ binh cơ giới",
  lane: "mobilize",
  seconds: 50,
  cost: [170, 90, 40, 0, 0, 85, 220],
};
projects.recon = {
  label: "Xe trinh sát",
  lane: "mobilize",
  seconds: 45,
  cost: [130, 110, 50, 30, 0, 65, 240],
};
projects.tank = {
  label: "Xe tăng chủ lực",
  lane: "mobilize",
  seconds: 70,
  cost: [210, 200, 90, 40, 50, 95, 420],
};
projects.artillery = {
  label: "Pháo binh dã chiến",
  lane: "mobilize",
  seconds: 60,
  cost: [190, 140, 30, 50, 30, 75, 330],
};
const nodeByName = new Map(
  towns.map((t) => [t.name, { lon: +t.lon, lat: +t.lat }]),
);
function spawnCounter(s, city, key) {
  const st = unitStats[key] || unitStats.reserve;
  s.units.push({
    id: s.nextUnit++,
    key,
    city,
    position: nodeByName.get(city),
    trip: null,
    rev: 0,
    hp: st.maxHp,
    maxHp: st.maxHp,
  });
}
function upgradeCampaign(s) {
  for (const c of Object.values(s.cities)) {
    if (c.base === undefined) c.base = 0;
    if (c.bunker === undefined) c.bunker = 0;
    if (c.hospital === undefined) c.hospital = 0;
  }
  if (s.units) {
    for (const u of s.units) {
      const st = unitStats[u.key] || unitStats.reserve;
      if (u.hp === undefined) u.hp = st.maxHp;
      if (u.maxHp === undefined) u.maxHp = st.maxHp;
    }
    return;
  }
  s.units = [];
  s.nextUnit = 1;
  s.learned = [];
  s.study = null;
  for (const [city, c] of Object.entries(s.cities)) {
    for (let i = 0; i < c.reserve; i++) spawnCounter(s, city, "reserve");
  }
}
function studyOrder(s, key, cancel = false, expectedStart = null) {
  if (!Object.hasOwn(doctrines, key)) throw Error("Công nghệ không hợp lệ.");
  const d = doctrines[key];
  if (cancel) {
    const j = s.study;
    if (!j || j.key !== key || j.start !== expectedStart)
      throw Error("Đề tài đã thay đổi.");
    const remaining = (j.end - s.time) / (j.end - j.start);
    d.cost.forEach(
      (v, i) => (s.balance[i] += Math.floor(v * remaining) * hour),
    );
    s.study = null;
    addLog(s, s.time, "", "Hủy nghiên cứu " + d.name + ".");
    return;
  }
  if (
    s.study ||
    s.learned.includes(key) ||
    (d.requires && !s.learned.includes(d.requires))
  )
    throw Error("Chưa thể nghiên cứu đề tài này.");
  if (d.cost.some((v, i) => v * hour > s.balance[i]))
    throw Error("Kho không đủ tài nguyên.");
  d.cost.forEach((v, i) => (s.balance[i] -= v * hour));
  s.study = { key, start: s.time, end: s.time + d.seconds * 1000 };
  addLog(s, s.time, "", "Bắt đầu nghiên cứu " + d.name + ".");
}
// Các nút đồ họa của kịch bản. Mỗi chặng nhận cùng một phần thời gian lệnh.
function gamePath(from, to) {
  const dest = nodeByName.get(to),
    south = from.lat > dest.lat;
  const middle = [
    "Hà Nội",
    "Thanh Hóa",
    "Vinh",
    "Đồng Hới",
    "Huế",
    "Đà Nẵng",
    "Kon Tum",
    "Pleiku",
    "Buôn Ma Thuột",
    "Đà Lạt",
    "TP. Hồ Chí Minh",
    "Cần Thơ",
  ]
    .map((n) => nodeByName.get(n))
    .filter(
      (p) =>
        p &&
        p.lat > Math.min(from.lat, dest.lat) + 0.22 &&
        p.lat < Math.max(from.lat, dest.lat) - 0.22,
    )
    .sort((a, b) => (south ? b.lat - a.lat : a.lat - b.lat));
  return [from, ...middle, dest];
}
function travelSegment(u, now) {
  const points = u.trip.points || [u.position, nodeByName.get(u.trip.to)];
  const progress =
    clamp((now - u.trip.start) / (u.trip.end - u.trip.start), 0, 1) *
    (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(progress)),
    f = progress - index;
  const a = points[index],
    b = points[index + 1];
  return {
    point: {
      lon: a.lon + (b.lon - a.lon) * f,
      lat: a.lat + (b.lat - a.lat) * f,
    },
    remaining: points.slice(index + 1),
  };
}
function pointAt(u, now) {
  return u.trip ? travelSegment(u, now).point : u.position;
}
function moveOrder(s, id, to, rev) {
  const u = s.units.find((a) => a.id === id);
  if (!u || u.rev !== rev)
    throw Error("Đơn vị đã nhận lệnh khác. Hãy chọn lại.");
  if (to === null && !u.trip) throw Error("Đơn vị đã dừng.");
  if (
    to !== null &&
    (!Object.hasOwn(s.cities, to) || u.city === to || u.trip?.to === to)
  )
    throw Error("Hãy chọn một thành phố khác.");
  u.position = pointAt(u, s.time);
  if (u.city && u.key === "reserve") s.cities[u.city].reserve--;
  u.city = null;
  u.rev++;
  const st = unitStats[u.key] || unitStats.reserve;
  const duration =
    u.key === "motor" && s.learned.includes("motor2") ? 24 : st.moveSeconds;
  u.trip =
    to === null
      ? null
      : {
          to,
          points: gamePath(u.position, to),
          start: s.time,
          end: s.time + duration * 1000,
        };
  addLog(
    s,
    s.time,
    "",
    projects[u.key].label +
      " #" +
      id +
      (to ? " di chuyển tới " + to + "." : " đã dừng tại chỗ."),
  );
}
function finishOperations(s, now) {
  if (s.study && s.study.end <= now) {
    s.learned.push(s.study.key);
    addLog(
      s,
      s.study.end,
      "",
      "Hoàn tất nghiên cứu " + doctrines[s.study.key].name + ".",
    );
    s.study = null;
  }
  for (const u of s.units) {
    if (!u.trip || u.trip.end > now) continue;
    const { to, end } = u.trip;
    u.position = nodeByName.get(to);
    u.city = to;
    u.trip = null;
    u.rev++;
    if (u.key === "reserve") s.cities[to].reserve++;
    addLog(s, end, to, projects[u.key].label + " #" + u.id + " đã đến nơi.");
  }
  s.log.sort((a, b) => b.time - a.time);
}
