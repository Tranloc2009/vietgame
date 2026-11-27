// Từ thư mục workspace, chạy với Node và sharp. Đầu vào ghi trong NGUON.md.
const fs = require("node:fs"),
  sharp = require("sharp");
const read = (n) => JSON.parse(fs.readFileSync("work/" + n));
const out = __dirname + "/assets/";
const vn = read("areas.json").features.filter(
  (f) => f.properties.adm0_a3 === "VNM",
);
const fix = { "VN-39": "Đồng Nai", "VN-53": "Bắc Kạn", "VN-66": "Hưng Yên" };
const pathLine = (pts) =>
  pts
    .map(([x, y], i) => (i ? "L" : "M") + x.toFixed(3) + " " + (-y).toFixed(3))
    .join("");
const provinces = vn.map(({ geometry: g, properties: p }) => ({
  name: fix[p.iso_3166_2] || p.name_vi || p.name,
  lon: p.longitude,
  lat: p.latitude,
  path: (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
    .flatMap((poly) => poly.map((r) => pathLine(r) + "Z"))
    .join(""),
}));
const names = {
  Hanoi: "Hà Nội",
  "Da Nang": "Đà Nẵng",
  "Ho Chi Minh City": "TP. Hồ Chí Minh",
  "Can Tho": "Cần Thơ",
  Haiphong: "Hải Phòng",
  Hue: "Huế",
  "Qui Nhon": "Quy Nhơn",
  "Play Ku": "Pleiku",
  "Lao Chi": "Lào Cai",
  "Hong Gai": "Hòn Gai",
  "Luan Chau": "Luân Châu",
  "Hai Duong": "Hải Dương",
  "Thu Dau Mot": "Thủ Dầu Một",
  "Tra Vinh": "Trà Vinh",
  "Truc Giang": "Trúc Giang",
  "Hoa Binh": "Hòa Bình",
  "Buon Me Thuot": "Buôn Ma Thuột",
  "Da Lat": "Đà Lạt",
  "Hon Quan": "Hớn Quản",
  "Vung Tau": "Vũng Tàu",
  "Phan Thiet": "Phan Thiết",
  "Long Xuyen": "Long Xuyên",
  "Tan An": "Tân An",
  "Ha Giang": "Hà Giang",
};
const cities = read("towns.json")
  .features.filter((f) => f.properties.iso_a2 === "VN")
  .map(({ properties: p }) => ({
    name: names[p.name] || p.name,
    lon: p.longitude,
    lat: p.latitude,
    capital: !!p.adm0cap,
    rank: p.min_zoom,
  }))
  .sort((a, b) => a.rank - b.rank);
const box = ([x, y]) => x >= 86 && x <= 128 && y >= 1 && y <= 32;
const atlas = read("world.json"),
  { scale, translate } = atlas.transform;
const arcs = atlas.arcs.map((a) => {
  let x = 0,
    y = 0;
  return a.map(([dx, dy]) => [
    (x += dx) * scale[0] + translate[0],
    (y += dy) * scale[1] + translate[1],
  ]);
});
const borders = atlas.objects.countries.geometries
  .flatMap((g) =>
    (g.type === "Polygon" ? [g.arcs] : g.arcs).flatMap((poly) =>
      poly.map((r) =>
        r.flatMap((i) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i])),
      ),
    ),
  )
  .filter((r) => r.some(box))
  .map(pathLine)
  .join("");
const rivers = read("data2.json")
  .features.flatMap(({ geometry: g }) =>
    g.type === "LineString" ? [g.coordinates] : g.coordinates,
  )
  .filter((r) => r.some(box))
  .map(pathLine)
  .join("");
fs.writeFileSync(
  out + "atlas.js",
  "const atlasData=" +
    JSON.stringify({ provinces, cities, borders, rivers }) +
    ";",
);
async function raster() {
  const src = process.argv[2] || "work/NE2_HR_LC_SR_W.tif";
  const { width } = await sharp(src, { limitInputPixels: false }).metadata(),
    d = width / 360;
  const { data, info } = await sharp(src, { limitInputPixels: false })
    .extract({
      left: Math.round(266 * d),
      top: Math.round(58 * d),
      width: Math.round(42 * d),
      height: Math.round(31 * d),
    })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (b > r + 12 && b > g) {
      data[i] = Math.max(8, r * 0.48 - 3);
      data[i + 1] = g * 0.59;
      data[i + 2] = b * 0.53;
    } else {
      data[i] = r * 0.79;
      data[i + 1] = g * 0.76;
      data[i + 2] = b * 0.63;
    }
  }
  await sharp(data, { raw: info })
    .sharpen()
    .webp({ quality: 93 })
    .toFile(out + "relief.webp");
}
raster().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
