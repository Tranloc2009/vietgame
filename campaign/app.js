"use strict";
const $ = (s) => document.querySelector(s);
const icons = {
  study: '<path d="M9 2h6m-5 1v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M8 15h8"/>',
  unit: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM7 10l5 4 5-4"/>',
  box: '<path d="m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4m-9 4v11M7 5l9 4"/>',
  news: '<path d="M3 4h15v16H4a1 1 0 0 1-1-1zM18 8h3v10q0 2-3 2M6 8h9M6 11h4v4H6zM12 12h3m-3 3h3m-9 2h9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
  map: '<path d="m2 5 7-2 6 3 7-2v15l-7 2-6-3-7 2zM9 3v15m6-12v15"/>',
  layers: '<path d="m2 8 10-5 10 5-10 5zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  mountain: '<path d="M2 20 10 5l5 8 2-4 6 11zM7 11l3 2 2-3"/>',
  focus:
    '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5"/><circle cx="12" cy="12" r="4"/>',
  city: '<path d="M2 21h20M4 21V10h6v11m0 0V3h7v18m0-9h4v9M6 13h1m5-7h2m-2 4h2m-2 4h2"/>',
  home: '<path d="m2 11 10-8 10 8M5 10v11h14V10m-9 11v-7h4v7"/>',
  shield:
    '<path d="M12 2 21 6v6q-1 6-9 10-8-4-9-10V6z"/><path d="m12 6 1.5 3.5 3.9.3-3 2.6 1 3.8-3.4-2-3.4 2 1-3.8-3-2.6 3.9-.3z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  online:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/>',
};
for (const el of /** @type {NodeListOf<HTMLElement>} */ (
  document.querySelectorAll("[data-icon]")
))
  el.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24">' +
    icons[el.dataset.icon] +
    "</svg>";
const panels = ["drawer", "settings", "guide", "national", "mpPanel"];
function panel(id) {
  const open = id && $("#" + id).hidden;
  for (const key of panels) $("#" + key).hidden = !(open && key === id);
  $("#places").setAttribute("aria-expanded", String(!$("#drawer").hidden));
  $("#layers").setAttribute("aria-expanded", String(!$("#settings").hidden));
  if (open && id === "drawer") {
    $("#query").value = "";
    listPlaces();
    if (matchMedia("(pointer:fine)").matches) $("#query").focus();
  }
}
function selectItem(p, go = false) {
  if (choosingDestination) {
    if (towns.includes(p)) sendMove(p.name);
    else
      notice(
        "Chọn một điểm dân cư trên bản đồ hoặc trong danh sách Thành phố.",
      );
    return;
  }
  activeUnit = null;
  const changed = selected !== p;
  selected = p;
  if (changed) cityTab = "summary";
  renderMatch();
  hover = null;
  $("#tip").hidden = true;
  $("#kind").textContent = p
    ? towns.includes(p) && typeof isOnline === "function" && isOnline()
      ? live?.cities?.[p.name]?.owned
        ? (p.capital ? "THỦ ĐÔ" : "THÀNH PHỐ") + " · CỦA BẠN"
        : "THÀNH PHỐ ĐỐI PHƯƠNG"
      : p.type.toLocaleUpperCase("vi")
    : "KHU VỰC";
  $("#name").textContent = p?.name || "Việt Nam";
  $("#detail").textContent = p
    ? Number(p.lat).toFixed(2) +
      "° B   ·   " +
      Number(p.lon).toFixed(2) +
      "° Đ" +
      (towns.includes(p) &&
      typeof isOnline === "function" &&
      isOnline() &&
      live?.cities?.[p.name]?.owned === false
        ? " · Kiểm soát bởi đối phương"
        : "")
    : "Bản đồ toàn quốc";
  $("#clear").hidden = !p;
  if (go && p) fly(+p.lon, +p.lat, Math.max(camera.z, 2.25));
  invalidate();
}
function norm(v) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d");
}
function listPlaces() {
  const q = norm($("#query").value.trim());
  const frag = document.createDocumentFragment();
  const found = [...towns, ...regions].filter((p) => norm(p.name).includes(q));
  for (const p of found) {
    const btn = document.createElement("button"),
      type = document.createElement("small");
    btn.textContent = p.name;
    type.textContent = p.type;
    btn.append(type);
    btn.onclick = () => {
      panel(null);
      selectItem(p, true);
    };
    frag.append(btn);
  }
  if (!found.length) {
    const msg = document.createElement("p");
    msg.textContent = "Không tìm thấy địa danh.";
    frag.append(msg);
  }
  $("#list").replaceChildren(frag);
}
$("#query").oninput = listPlaces;
$("#places").onclick = () => panel("drawer");
$("#help").onclick = () => panel("guide");
$("#layers").onclick = () => panel("settings");
for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll("[data-close]")
))
  btn.onclick = () => panel(null);
for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll("[data-mode]")
))
  btn.onclick = () => {
    mode = btn.dataset.mode;
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (
      document.querySelectorAll("[data-mode]")
    ))
      b.setAttribute("aria-pressed", String(b === btn));
    invalidate();
  };
for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll("[data-layer]")
))
  input.onchange = () => {
    layers[input.dataset.layer] = input.checked;
    invalidate();
  };
$("#plus").onclick = () => setZoom(1.4);
$("#minus").onclick = () => setZoom(1 / 1.4);
$("#reset").onclick = () => fly(106.5, 15.9, 1);
$("#center").onclick = () =>
  selected ? selectItem(selected, true) : $("#reset").click();
$("#clear").onclick = () => selectItem(null);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (panels.some((id) => !$("#" + id).hidden)) panel(null);
    else if (choosingDestination) cancelDestination();
    else selectItem(null);
  }
});
