"use strict";
const canvas = /** @type {HTMLCanvasElement} */ (
    document.querySelector("#map")
  ),
  ctx = canvas.getContext("2d"),
  mini = /** @type {HTMLCanvasElement} */ (document.querySelector("#mini")),
  mc = mini.getContext("2d");
const regions = atlasData.provinces.map((p) => ({
  ...p,
  shape: new Path2D(p.path),
  type: "Vùng",
}));
const towns = atlasData.cities.map((p) => ({
  ...p,
  type: p.capital ? "Thủ đô" : "Điểm dân cư",
}));
const exterior = new Path2D();
exterior.rect(86, -32, 42, 31);
for (const p of regions) exterior.addPath(p.shape);
const boundaries = new Path2D(atlasData.borders),
  waterways = new Path2D(atlasData.rivers);
const relief = new Image();
relief.src = "assets/relief.webp";
const layers = { cities: true, borders: true, rivers: true, labels: true };
const camera = { lon: 106.5, lat: 15.9, z: 1 };
let mode = "political",
  selected = null,
  hover = null,
  visible = [],
  w,
  h,
  dpr,
  sx,
  sy,
  frame = 0,
  flight = 0;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function scales() {
  sy = Math.min(h / 20.2, w / 10.6) * camera.z;
  sx = sy * 0.958;
}
function locate(x, y) {
  return [(x - w / 2) / sx + camera.lon, camera.lat - (y - h / 2) / sy];
}
function projectPoint(lon, lat) {
  return [w / 2 + (lon - camera.lon) * sx, h / 2 - (lat - camera.lat) * sy];
}
function constrain() {
  scales();
  camera.lon = clamp(camera.lon, 102, 111);
  camera.lat = clamp(camera.lat, 9, 23);
}
function invalidate() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
}
function resize() {
  w = canvas.clientWidth;
  h = canvas.clientHeight;
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  constrain();
  invalidate();
}
/** @param {CanvasTextAlign} [align] */
function label(text, x, y, font, fill, edge, align = "center") {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = edge;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}
function emblem(x, y, capital, active) {
  ctx.save();
  ctx.translate(x, y);
  const size = capital ? 9 : 5;
  ctx.fillStyle = active ? "#ffd666" : capital ? "#b19b58" : "#d7d1ad";
  ctx.strokeStyle = "#25332d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (capital) {
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#263930";
    ctx.fillText("★", 0, 1);
  }
  if (active) {
    ctx.strokeStyle = "#ffe388";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
const terrainColors = [
  "#80964f",
  "#b1a772",
  "#8a995c",
  "#a6a263",
  "#ac9860",
  "#88975f",
];
/** @type {Array<[string,number,number,number?]>} */
const geoLabels = [
  ["L À O", 102.9, 19.2],
  ["C A M P U C H I A", 104.0, 12.9],
  ["T H Á I   L A N", 100.7, 15.1],
  ["T R U N G   Q U Ố C", 107.3, 24.5],
  ["B I Ể N   Đ Ô N G", 111.7, 15.7, 1],
  ["VỊNH BẮC BỘ", 108.05, 19.4, 1],
  ["VỊNH THÁI LAN", 102, 9.2, 1],
];
function draw() {
  if (!w || !h) return;
  scales();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#35535b";
  ctx.fillRect(0, 0, w, h);
  const [ox, oy] = projectPoint(0, 0);
  ctx.translate(ox, oy);
  ctx.scale(sx, sy);
  if (relief.complete && relief.naturalWidth)
    ctx.drawImage(relief, 86, -32, 42, 31);
  if (mode === "political") {
    ctx.fillStyle = "#18272556";
    ctx.fill(exterior, "evenodd");
  }
  ctx.lineWidth = 0.8 / sx;
  ctx.strokeStyle = "#3a4946aa";
  ctx.stroke(boundaries);
  for (const [i, p] of regions.entries()) {
    if (mode === "political") {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = terrainColors[i % terrainColors.length];
      ctx.fill(p.shape);
      ctx.globalAlpha = 1;
    }
    if (p === hover || p === selected) {
      ctx.fillStyle = p === selected ? "#f4cc595b" : "#f7edbb39";
      ctx.fill(p.shape);
    }
    if (layers.borders) {
      ctx.lineWidth = 0.85 / sx;
      ctx.strokeStyle = "#343e2fba";
      ctx.stroke(p.shape);
    }
  }
  if (layers.rivers) {
    ctx.strokeStyle = "#508894ad";
    ctx.lineWidth = 0.85 / sx;
    ctx.stroke(waterways);
  }
  if (selected?.shape) {
    ctx.strokeStyle = "#ffdf86";
    ctx.lineWidth = 2 / sx;
    ctx.stroke(selected.shape);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (layers.labels) {
    for (const [txt, lon, lat, sea] of geoLabels) {
      if (sea && sy < 26) continue;
      const [x, y] = projectPoint(lon, lat);
      label(
        txt,
        x,
        y,
        sea ? "italic 15px Georgia" : "bold 14px Georgia",
        sea ? "#d7e2d4" : "#edebcf",
        sea ? "#385e6b88" : "#5b624b99",
      );
    }
    const [x, y] = projectPoint(105.55, 17.2);
    label("V I Ệ T   N A M", x, y, "bold 18px Georgia", "#fff0c3", "#4c5745bb");
  }
  visible = [];
  const boxes = [];
  if (layers.cities) {
    const order = [
      ...(selected && towns.includes(selected) ? [selected] : []),
      ...towns.filter((t) => t !== selected),
    ].sort(
      (a, b) =>
        Number(b === selected) - Number(a === selected) ||
        Number(b.capital) - Number(a.capital) ||
        a.rank - b.rank,
    );
    for (const c of order) {
      const [x, y] = projectPoint(c.lon, c.lat);
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const major = [
        "Hà Nội",
        "TP. Hồ Chí Minh",
        "Đà Nẵng",
        "Huế",
        "Cần Thơ",
        "Hải Phòng",
        "Nha Trang",
        "Vinh",
        "Cà Mau",
        "Quy Nhơn",
        "Pleiku",
        "Sơn La",
        "Lào Cai",
      ];
      if (camera.z < 1.9 && !major.includes(c.name) && c !== selected) continue;
      ctx.font = (c.capital ? "bold " : "") + '13px "Segoe UI",sans-serif';
      const width = layers.labels ? ctx.measureText(c.name).width + 18 : 14;
      const b = [x - 7, y - 9, x + width, y + 9];
      if (
        boxes.some(
          (q) => q[0] < b[2] && q[2] > b[0] && q[1] < b[3] && q[3] > b[1],
        )
      )
        continue;
      boxes.push(b);
      visible.push({ c, b });
      emblem(x, y, c.capital, c === selected || c === hover);
      if (layers.labels)
        label(
          c.name,
          x + (c.capital ? 13 : 9),
          y,
          (c.capital ? "bold " : "") + '13px "Segoe UI",sans-serif',
          "#fffae1",
          "#323b32",
          "left",
        );
    }
  }
  const km =
    [5, 10, 20, 50, 100, 200, 500]
      .filter(
        (n) => (n * sx) / (111 * Math.cos((camera.lat * Math.PI) / 180)) < 125,
      )
      .pop() || 5;
  const bar = /** @type {HTMLElement} */ (document.querySelector("#scale"));
  bar.textContent = km + " km";
  bar.style.width =
    (km * sx) / (111 * Math.cos((camera.lat * Math.PI) / 180)) + "px";
  /** @type {HTMLButtonElement} */ (document.querySelector("#plus")).disabled =
    camera.z >= 8;
  /** @type {HTMLButtonElement} */ (document.querySelector("#minus")).disabled =
    camera.z <= 1;
  if(typeof drawUnits==="function" && document.readyState!=="loading")drawUnits();
  drawMini();
}
function drawMini() {
  const width = mini.clientWidth,
    height = mini.clientHeight;
  if (!width || !height) return;
  mini.width = width * dpr;
  mini.height = height * dpr;
  mc.setTransform(dpr, 0, 0, dpr, 0, 0);
  mc.fillStyle = "#38525a";
  mc.fillRect(0, 0, width, height);
  const dx = width / 42,
    dy = height / 31;
  mc.translate(-86 * dx, 32 * dy);
  mc.scale(dx, dy);
  if (relief.complete && relief.naturalWidth)
    mc.drawImage(relief, 86, -32, 42, 31);
  mc.fillStyle = "#c8c287";
  for (const p of regions) mc.fill(p.shape);
  mc.strokeStyle = "#fff0a6";
  mc.lineWidth = 1 / dx;
  mc.strokeRect(
    camera.lon - w / (2 * sx),
    -camera.lat - h / (2 * sy),
    w / sx,
    h / sy,
  );
}
function hit(x, y) {
  const t = visible.find(
    ({ b }) => x > b[0] - 3 && x < b[2] + 3 && y > b[1] - 3 && y < b[3] + 3,
  );
  if (t) return t.c;
  const [lon, lat] = locate(x, y);
  ctx.save();
  ctx.resetTransform();
  const p = regions.find((p) => ctx.isPointInPath(p.shape, lon, -lat));
  ctx.restore();
  return p || null;
}
function setZoom(f, x = w / 2, y = h / 2) {
  cancelAnimationFrame(flight);
  const [a, b] = locate(x, y);
  camera.z = clamp(camera.z * f, 1, 8);
  scales();
  camera.lon = a - (x - w / 2) / sx;
  camera.lat = b + (y - h / 2) / sy;
  constrain();
  invalidate();
}
function fly(lon, lat, z) {
  cancelAnimationFrame(flight);
  const from = { ...camera },
    start = performance.now();
  function step(now) {
    const t = clamp((now - start) / 320, 0, 1),
      v = 1 - (1 - t) ** 3;
    camera.lon = from.lon + (lon - from.lon) * v;
    camera.lat = from.lat + (lat - from.lat) * v;
    camera.z = from.z + (z - from.z) * v;
    constrain();
    invalidate();
    if (t < 1) flight = requestAnimationFrame(step);
  }
  flight = requestAnimationFrame(step);
}
const pointers = new Map();
let down = null,
  moved = false;
canvas.addEventListener("pointerdown", (e) => {
  cancelAnimationFrame(flight);
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  down = [e.clientX, e.clientY];
  moved = pointers.size > 1;
  /** @type {HTMLElement} */ (document.querySelector("#tip")).hidden = true;
});
canvas.addEventListener("pointermove", (e) => {
  const x = e.clientX,
    y = e.clientY,
    [lon, lat] = locate(x, y);
  document.querySelector("#coord").textContent =
    lat.toFixed(2) + "° B   " + lon.toFixed(2) + "° Đ";
  const old = pointers.get(e.pointerId);
  if (!old) {
    hover = hit(x, y);
    const tip = /** @type {HTMLElement} */ (document.querySelector("#tip"));
    tip.hidden = !hover;
    if (hover) {
      tip.textContent = hover.name;
      tip.style.left = Math.min(w - 135, x + 13) + "px";
      tip.style.top = Math.min(h - 45, y + 15) + "px";
    }
    invalidate();
    return;
  }
  const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
  pointers.set(e.pointerId, [x, y]);
  if (other) {
    const a = Math.hypot(old[0] - other[0], old[1] - other[1]),
      b = Math.hypot(x - other[0], y - other[1]);
    if (a > 2 && b > 2)
      setZoom(b / a, (old[0] + other[0]) / 2, (old[1] + other[1]) / 2);
  }
  if (Math.hypot(x - down[0], y - down[1]) > 4) moved = true;
  if (moved) {
    camera.lon -= (x - old[0]) / (sx * (other ? 2 : 1));
    camera.lat += (y - old[1]) / (sy * (other ? 2 : 1));
    constrain();
    invalidate();
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (!moved && pointers.size === 1) selectItem(hit(e.clientX, e.clientY));
  pointers.delete(e.pointerId);
});
canvas.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  moved = true;
});
canvas.addEventListener("pointerleave", () => {
  hover = null;
  /** @type {HTMLElement} */ (document.querySelector("#tip")).hidden = true;
  invalidate();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    setZoom(
      Math.exp(-clamp(e.deltaY, -350, 350) * 0.002),
      e.clientX,
      e.clientY,
    );
  },
  { passive: false },
);
canvas.addEventListener("keydown", (e) => {
  const step = 70;
  if (e.key === "+" || e.key === "=") setZoom(1.4);
  else if (e.key === "-") setZoom(1 / 1.4);
  else if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
  ) {
    camera.lon += (({ ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0) * step) / sx;
    camera.lat += (({ ArrowUp: 1, ArrowDown: -1 }[e.key] || 0) * step) / sy;
    constrain();
    invalidate();
  } else return;
  e.preventDefault();
});
mini.onclick = (e) => {
  const b = mini.getBoundingClientRect();
  fly(
    86 + ((e.clientX - b.left) * 42) / b.width,
    32 - ((e.clientY - b.top) * 31) / b.height,
    camera.z,
  );
};
relief.onload = invalidate;
new ResizeObserver(resize).observe(canvas);
resize();


