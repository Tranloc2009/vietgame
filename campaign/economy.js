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
  },
  office: {
    label: "Văn phòng tuyển dụng",
    lane: "build",
    seconds: 45,
    cost: [150, 60, 0, 0, 0, 0, 200],
  },
  reserve: {
    label: "Đội dự bị",
    lane: "mobilize",
    seconds: 40,
    cost: [120, 40, 20, 0, 0, 75, 150],
  },
};
const hour = 3600000;
function startCampaign(names, now) {
  const cities = Object.fromEntries(
    names.map((name, i) => [
      name,
      { material: i % 5, factory: 0, office: 0, reserve: 0, jobs: [] },
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
    cityOutput(c).forEach((v, i) => (income[i] += v));
  }
  for (const unit of s.units) {
    expense[0]++;
    expense[6] += unit.key === "motor" ? 3 : 2;
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
    if (job.key !== "motor") c[job.key]++;
    c.jobs = c.jobs.filter((j) => j !== job);
    addLog(s, job.end, name, "Hoàn thành " + projects[job.key].label + ".");
  }
  finishOperations(s, now);
  accrue(s, now);
  return s;
}
function terms(c, key) {
  const p = projects[key],
    level = p.lane === "build" ? c[key] + 1 : 1;
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
  if (key === "motor" && !s.learned.includes("motor"))
    throw Error("Cần nghiên cứu bộ binh cơ giới I.");
  if (p.lane === "mobilize" && !c.office)
    throw Error("Cần văn phòng tuyển dụng cấp 1.");
  const { cost, duration } = terms(c, key);
  if (cost.some((v, i) => v * hour > s.balance[i]))
    throw Error("Kho không đủ tài nguyên.");
  cost.forEach((v, i) => (s.balance[i] -= v * hour));
  c.jobs.push({ key, cost, start: s.time, end: s.time + duration * 1000 });
  addLog(s, s.time, city, "Bắt đầu " + p.label + ".");
}
