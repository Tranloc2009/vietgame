"use strict";
const materials = [
  "Tiếp tế",
  "Linh kiện",
  "Nhiên liệu",
  "Điện tử",
  "Vật liệu hiếm",
  "Nhân lực",
  "Tiền",
];
const projects = {
  factory: {
    label: "Xưởng công nghiệp",
    lane: "build",
    seconds: 60,
    cost: [200, 150, 0, 25, 0, 0, 300],
    maxLevel: 5,
    note: "+5 sản lượng địa phương/h",
  },
  office: {
    label: "Văn phòng tuyển dụng",
    lane: "build",
    seconds: 45,
    cost: [150, 60, 0, 0, 0, 0, 200],
    maxLevel: 5,
    note: "+2 nhân lực/h · mở huy động",
  },
  base: {
    label: "Căn cứ lục quân",
    lane: "build",
    seconds: 55,
    cost: [180, 120, 0, 30, 0, 0, 260],
    maxLevel: 3,
    note: "Mở thiết giáp/pháo · +10% phòng thủ",
  },
  bunker: {
    label: "Hầm công sự",
    lane: "build",
    seconds: 50,
    cost: [140, 100, 0, 0, 40, 0, 220],
    maxLevel: 3,
    note: "+15% phòng thủ thành phố/cấp",
  },
  hospital: {
    label: "Bệnh viện quân y",
    lane: "build",
    seconds: 55,
    cost: [160, 80, 0, 40, 0, 0, 250],
    maxLevel: 3,
    note: "Hồi máu quân đồn trú định kỳ",
  },
  reserve: {
    label: "Đội dự bị",
    lane: "mobilize",
    seconds: 40,
    cost: [120, 40, 20, 0, 0, 75, 150],
  },
};
const unitStats = {
  reserve: {
    glyph: "▣",
    maxHp: 15,
    softAttack: 3,
    hardAttack: 1,
    defense: 4,
    moveSeconds: 45,
    canConquer: true,
    ranged: false,
    visionDeg: 1.25,
    upkeep: [1, 0, 2],
    reqDoctrine: null,
    reqOffice: 1,
    reqBase: 0,
  },
  motor: {
    glyph: "▣",
    maxHp: 20,
    softAttack: 6,
    hardAttack: 3,
    defense: 6,
    moveSeconds: 32,
    canConquer: true,
    ranged: false,
    visionDeg: 1.35,
    upkeep: [1, 0, 3],
    reqDoctrine: "motor",
    reqOffice: 1,
    reqBase: 0,
  },
  recon: {
    glyph: "◈",
    maxHp: 22,
    softAttack: 5,
    hardAttack: 4,
    defense: 5,
    moveSeconds: 22,
    canConquer: false,
    ranged: false,
    visionDeg: 2.25,
    upkeep: [1, 1, 4],
    reqDoctrine: "recon",
    reqOffice: 1,
    reqBase: 1,
  },
  tank: {
    glyph: "◆",
    maxHp: 42,
    softAttack: 9,
    hardAttack: 12,
    defense: 11,
    moveSeconds: 36,
    canConquer: false,
    ranged: false,
    visionDeg: 1.35,
    upkeep: [2, 2, 7],
    reqDoctrine: "tank",
    reqOffice: 1,
    reqBase: 2,
  },
  artillery: {
    glyph: "◎",
    maxHp: 16,
    softAttack: 7,
    hardAttack: 5,
    defense: 3,
    moveSeconds: 42,
    canConquer: false,
    ranged: true,
    visionDeg: 1.45,
    upkeep: [2, 0, 5],
    reqDoctrine: "artillery",
    reqOffice: 1,
    reqBase: 1,
  },
};
const hour = 3600000;
function startCampaign(names, now) {
  const cities = Object.fromEntries(
    names.map((name, i) => [
      name,
      {
        material: i % 5,
        factory: 0,
        office: 0,
        base: 0,
        bunker: 0,
        hospital: 0,
        reserve: 0,
        jobs: [],
      },
    ]),
  );
  return {
    cities,
    start: now,
    time: now,
    balance: [4200, 3200, 2800, 1800, 1400, 3500, 12500].map((v) => v * hour),
    log: [{ time: now, city: "", text: "Mở chiến dịch Việt Nam." }],
  };
}
function cityOutput(c) {
  const output = [0, 0, 0, 0, 0, 2 + c.office * 2, 8];
  output[c.material] = 10 + 5 * c.factory;
  return output;
}
function ledger(s) {
  const income = materials.map(() => 0),
    expense = materials.map(() => 0);
  for (const c of Object.values(s.cities)) {
    if (c.owned === false) continue;
    cityOutput(c).forEach((v, i) => (income[i] += v));
  }
  for (const unit of s.units) {
    if (unit.owned === false) continue;
    const st = unitStats[unit.key] || unitStats.reserve;
    expense[0] += st.upkeep[0];
    expense[2] += st.upkeep[1];
    expense[6] += st.upkeep[2];
  }
  return { income, expense, net: income.map((v, i) => v - expense[i]) };
}
function addLog(s, time, city, text) {
  s.log.unshift({ time, city, text });
  s.log.length = Math.min(s.log.length, 200);
}
function accrue(s, to) {
  const delta = to - s.time;
  if (delta <= 0) return;
  const { net } = ledger(s);
  s.balance = s.balance.map((v, i) => Math.max(0, v + delta * net[i]));
  s.time = to;
}
function settle(s, now) {
  upgradeCampaign(s);
  const done = Object.entries(s.cities)
    .flatMap(([name, c]) =>
      c.jobs.filter((j) => j.end <= now).map((job) => ({ name, c, job })),
    )
    .sort((a, b) => a.job.end - b.job.end);
  for (const { name, c, job } of done) {
    accrue(s, job.end);
    if (projects[job.key].lane === "mobilize") spawnCounter(s, name, job.key);
    if (projects[job.key].lane === "build" || job.key === "reserve") {
      c[job.key] = (c[job.key] || 0) + 1;
    }
    c.jobs = c.jobs.filter((j) => j !== job);
    addLog(s, job.end, name, "Hoàn thành " + projects[job.key].label + ".");
  }
  finishOperations(s, now);
  accrue(s, now);
  return s;
}
function terms(c, key) {
  const p = projects[key],
    level = p.lane === "build" ? (c[key] || 0) + 1 : 1;
  return {
    level,
    cost: p.cost.map((v) => v * level),
    duration: p.seconds * level,
  };
}
function order(s, city, key, cancel = false) {
  if (!Object.hasOwn(s.cities, city) || !Object.hasOwn(projects, key))
    throw Error("Lệnh không hợp lệ.");
  const c = s.cities[city],
    p = projects[key],
    j = c.jobs.find((j) => projects[j.key].lane === p.lane);
  if (cancel) {
    if (!j || j.key !== key) throw Error("Hàng đợi đã thay đổi.");
    c.jobs = c.jobs.filter((x) => x !== j);
    j.cost.forEach((v, i) => (s.balance[i] += v * hour));
    addLog(s, s.time, city, "Hủy " + p.label + ", hoàn lại chi phí.");
    return;
  }
  if (j) throw Error("Hàng đợi này đang bận.");
  if (p.lane === "build" && p.maxLevel && (c[key] || 0) >= p.maxLevel)
    throw Error(p.label + " đã đạt cấp tối đa.");
  if (p.lane === "mobilize") {
    const st = unitStats[key];
    if (st?.reqDoctrine && !s.learned.includes(st.reqDoctrine))
      throw Error("Cần nghiên cứu " + doctrines[st.reqDoctrine].name + ".");
    if (st && (c.office || 0) < st.reqOffice)
      throw Error("Cần văn phòng tuyển dụng cấp " + st.reqOffice + ".");
    if (st && (c.base || 0) < st.reqBase)
      throw Error("Cần căn cứ lục quân cấp " + st.reqBase + ".");
  }
  const { cost, duration } = terms(c, key);
  if (cost.some((v, i) => v * hour > s.balance[i]))
    throw Error("Kho không đủ tài nguyên.");
  cost.forEach((v, i) => (s.balance[i] -= v * hour));
  c.jobs.push({ key, cost, start: s.time, end: s.time + duration * 1000 });
  addLog(s, s.time, city, "Bắt đầu " + p.label + ".");
}
