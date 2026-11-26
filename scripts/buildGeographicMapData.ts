import fs from 'node:fs';
import path from 'node:path';
import { Delaunay } from 'd3-delaunay';
import polygonClipping, { MultiPolygon, Polygon, Ring } from 'polygon-clipping';

type LonLat = [number, number];

interface SeedRegionSpec {
  readonly index: number; // 1..72
  readonly regionId: string;
  readonly code: string;
  readonly name: string;
  readonly seed: LonLat;
  readonly zone: 'NORTH_SECTOR' | 'CENTRAL_FRONTIER' | 'HIGHLAND_NEUTRAL' | 'SOUTH_SECTOR';
  readonly controller: string;
  readonly urbanCore?: boolean;
  readonly coastalHint?: boolean;
  readonly riverHint?: boolean;
  readonly jungleHint?: boolean;
}

const NORTH = 'nat_north_dir';
const SOUTH = 'nat_south_rep';
const NPC_HIGHLAND = 'nat_npc_highland';
const NPC_BORDER = 'nat_npc_border';

/**
 * 72 real geographic anchor seeds spanning Vietnam from 23.1°N to 8.65°N.
 * Preserves ALL 72 existing RegionIds (reg_vn_01..reg_vn_72), capital mappings:
 *  - reg_vn_01 = Điện Biên / Lai Châu (Border NPC Capital)
 *  - reg_vn_11 = Hà Nội / Trung Tâm Châu Thổ Hồng (North Capital)
 *  - reg_vn_38 = Kon Tum / Bắc Tây Nguyên (Highland NPC Capital)
 *  - reg_vn_59 = Sài Gòn / Gia Định (South Capital)
 * Explicitly fictional alternate-history 1955 gameplay partition — NOT modern administrative borders as history.
 */
const SEED_REGIONS: readonly SeedRegionSpec[] = [
  // Band 1: Far North Frontier (reg_vn_01..04)
  { index: 1, regionId: 'reg_vn_01', code: 'R01', name: 'Mường Tè — Lai Châu Tây Bắc', seed: [102.72, 22.36], zone: 'NORTH_SECTOR', controller: NPC_BORDER, riverHint: true },
  { index: 2, regionId: 'reg_vn_02', code: 'R02', name: 'Lào Cai — Hoàng Liên Sơn', seed: [104.02, 22.42], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 3, regionId: 'reg_vn_03', code: 'R03', name: 'Hà Giang — Cao Nguyên Đá', seed: [105.05, 22.78], zone: 'NORTH_SECTOR', controller: NORTH },
  { index: 4, regionId: 'reg_vn_04', code: 'R04', name: 'Cao Bằng — Biên Đông Bắc', seed: [106.22, 22.68], zone: 'NORTH_SECTOR', controller: NORTH },

  // Band 2: Upper Northwest & Viet Bac (reg_vn_05..08)
  { index: 5, regionId: 'reg_vn_05', code: 'R05', name: 'Điện Biên — Thung Lũng Mường Thanh', seed: [103.05, 21.48], zone: 'NORTH_SECTOR', controller: NPC_BORDER },
  { index: 6, regionId: 'reg_vn_06', code: 'R06', name: 'Yên Bái — Trung Du Sông Hồng', seed: [104.62, 21.74], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 7, regionId: 'reg_vn_07', code: 'R07', name: 'Tuyên Quang — Thái Nguyên', seed: [105.62, 21.84], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 8, regionId: 'reg_vn_08', code: 'R08', name: 'Lạng Sơn — Cửa Ngõ Đông Bắc', seed: [106.66, 21.86], zone: 'NORTH_SECTOR', controller: NORTH },

  // Band 3: Northwest Plateau to Red River Core & Ha Long (reg_vn_09..12)
  { index: 9, regionId: 'reg_vn_09', code: 'R09', name: 'Sơn La — Lưu Vực Sông Đà', seed: [103.92, 21.22], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 10, regionId: 'reg_vn_10', code: 'R10', name: 'Phú Thọ — Hòa Bình Thượng', seed: [105.12, 21.18], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 11, regionId: 'reg_vn_11', code: 'R11', name: 'Hà Nội — Trung Tâm Châu Thổ Hồng', seed: [105.84, 21.03], zone: 'NORTH_SECTOR', controller: NORTH, urbanCore: true, riverHint: true },
  { index: 12, regionId: 'reg_vn_12', code: 'R12', name: 'Quảng Ninh — Vịnh Hạ Long', seed: [107.18, 21.22], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true },

  // Band 4: Lower Northwest & Red River Delta (reg_vn_13..16)
  { index: 13, regionId: 'reg_vn_13', code: 'R13', name: 'Mộc Châu — Đèo Tây Bắc', seed: [104.58, 20.76], zone: 'NORTH_SECTOR', controller: NORTH },
  { index: 14, regionId: 'reg_vn_14', code: 'R14', name: 'Hòa Bình — Hành Lang Sông Đà', seed: [105.34, 20.66], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 15, regionId: 'reg_vn_15', code: 'R15', name: 'Bắc Ninh — Hải Dương', seed: [106.26, 20.96], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 16, regionId: 'reg_vn_16', code: 'R16', name: 'Hải Phòng — Cảng Cửa Biển Bắc', seed: [106.66, 20.72], zone: 'NORTH_SECTOR', controller: NORTH, urbanCore: true, coastalHint: true, riverHint: true },

  // Band 5: Southern Delta & Thanh Hoa West (reg_vn_17..20)
  { index: 17, regionId: 'reg_vn_17', code: 'R17', name: 'Quan Hóa — Thượng Nguồn Sông Mã', seed: [104.96, 20.28], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true, jungleHint: true },
  { index: 18, regionId: 'reg_vn_18', code: 'R18', name: 'Ninh Bình — Hà Nam', seed: [105.82, 20.32], zone: 'NORTH_SECTOR', controller: NORTH, riverHint: true },
  { index: 19, regionId: 'reg_vn_19', code: 'R19', name: 'Nam Định — Thái Bình Ven Biển', seed: [106.26, 20.32], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true, riverHint: true },
  { index: 20, regionId: 'reg_vn_20', code: 'R20', name: 'Thanh Hóa — Đồng Bằng Sông Mã', seed: [105.68, 19.80], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true, riverHint: true },

  // Band 6: North Central Corridor — Nghe An (reg_vn_21..24)
  { index: 21, regionId: 'reg_vn_21', code: 'R21', name: 'Tương Dương — Biên Tây Nghệ An', seed: [104.36, 19.34], zone: 'NORTH_SECTOR', controller: NORTH, jungleHint: true },
  { index: 22, regionId: 'reg_vn_22', code: 'R22', name: 'Quỳ Châu — Phủ Quỳ Trung Du', seed: [105.08, 19.38], zone: 'NORTH_SECTOR', controller: NORTH, jungleHint: true },
  { index: 23, regionId: 'reg_vn_23', code: 'R23', name: 'Diễn Châu — Bờ Biển Bắc Nghệ', seed: [105.58, 19.16], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true },
  { index: 24, regionId: 'reg_vn_24', code: 'R24', name: 'Vinh — Hạ Lưu Sông Cả', seed: [105.62, 18.68], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true, riverHint: true },

  // Band 7: Ha Tinh & Quang Binh North (reg_vn_25..28)
  { index: 25, regionId: 'reg_vn_25', code: 'R25', name: 'Hương Sơn — Đèo Cầu Treo', seed: [105.32, 18.42], zone: 'NORTH_SECTOR', controller: NORTH, jungleHint: true },
  { index: 26, regionId: 'reg_vn_26', code: 'R26', name: 'Hà Tĩnh — Dải Duyên Hải', seed: [105.92, 18.28], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true },
  { index: 27, regionId: 'reg_vn_27', code: 'R27', name: 'Kỳ Anh — Đèo Ngang', seed: [106.28, 17.98], zone: 'NORTH_SECTOR', controller: NORTH, coastalHint: true },
  { index: 28, regionId: 'reg_vn_28', code: 'R28', name: 'Tuyên Hóa — Phong Nha Trường Sơn', seed: [105.96, 17.64], zone: 'NORTH_SECTOR', controller: NORTH, jungleHint: true },

  // Band 8: 17th Parallel Demarcation Zone (reg_vn_29..32)
  { index: 29, regionId: 'reg_vn_29', code: 'R29', name: 'Biên Tây Quảng Bình — Trường Sơn', seed: [106.22, 17.28], zone: 'CENTRAL_FRONTIER', controller: NPC_BORDER, jungleHint: true },
  { index: 30, regionId: 'reg_vn_30', code: 'R30', name: 'Khe Sanh — Hành Lang Lao Bảo', seed: [106.66, 16.68], zone: 'CENTRAL_FRONTIER', controller: NPC_BORDER, jungleHint: true },
  { index: 31, regionId: 'reg_vn_31', code: 'R31', name: 'Đồng Hới — Vịnh Nhật Lệ', seed: [106.62, 17.44], zone: 'CENTRAL_FRONTIER', controller: NORTH, coastalHint: true },
  { index: 32, regionId: 'reg_vn_32', code: 'R32', name: 'Vĩnh Linh — Bờ Bắc Sông Bến Hải', seed: [107.02, 17.04], zone: 'CENTRAL_FRONTIER', controller: NORTH, coastalHint: true, riverHint: true },

  // Band 9: Hue, Hai Van Pass & Da Nang (reg_vn_33..36)
  { index: 33, regionId: 'reg_vn_33', code: 'R33', name: 'A Lưới — Tây Thừa Thiên', seed: [107.22, 16.22], zone: 'CENTRAL_FRONTIER', controller: NPC_HIGHLAND, jungleHint: true },
  { index: 34, regionId: 'reg_vn_34', code: 'R34', name: 'Đông Giang — Tây Quảng Nam', seed: [107.62, 15.86], zone: 'CENTRAL_FRONTIER', controller: NPC_HIGHLAND, jungleHint: true },
  { index: 35, regionId: 'reg_vn_35', code: 'R35', name: 'Huế — Kinh Đô Sông Hương', seed: [107.56, 16.52], zone: 'CENTRAL_FRONTIER', controller: SOUTH, urbanCore: true, coastalHint: true, riverHint: true },
  { index: 36, regionId: 'reg_vn_36', code: 'R36', name: 'Đà Nẵng — Đèo Hải Vân', seed: [108.16, 16.04], zone: 'CENTRAL_FRONTIER', controller: SOUTH, urbanCore: true, coastalHint: true, riverHint: true },

  // Band 10: Quang Nam, Quang Ngai & Northern Central Highlands (reg_vn_37..40)
  { index: 37, regionId: 'reg_vn_37', code: 'R37', name: 'Ngọc Linh — Ngã Ba Đông Dương', seed: [107.68, 15.08], zone: 'HIGHLAND_NEUTRAL', controller: NPC_HIGHLAND },
  { index: 38, regionId: 'reg_vn_38', code: 'R38', name: 'Kon Tum — Trung Tâm Bắc Cao Nguyên', seed: [108.04, 14.52], zone: 'HIGHLAND_NEUTRAL', controller: NPC_HIGHLAND, riverHint: true },
  { index: 39, regionId: 'reg_vn_39', code: 'R39', name: 'Tam Kỳ — Trung Du Quảng Nam', seed: [108.34, 15.52], zone: 'HIGHLAND_NEUTRAL', controller: NPC_HIGHLAND, riverHint: true },
  { index: 40, regionId: 'reg_vn_40', code: 'R40', name: 'Quảng Ngãi — Duyên Hải Trung', seed: [108.80, 15.10], zone: 'HIGHLAND_NEUTRAL', controller: SOUTH, coastalHint: true },

  // Band 11: Central Highlands Core — Pleiku & Binh Dinh (reg_vn_41..44)
  { index: 41, regionId: 'reg_vn_41', code: 'R41', name: 'Đức Cơ — Biên Tây Gia Lai', seed: [107.68, 13.86], zone: 'HIGHLAND_NEUTRAL', controller: NPC_HIGHLAND, jungleHint: true },
  { index: 42, regionId: 'reg_vn_42', code: 'R42', name: 'Pleiku — Cao Nguyên Gia Lai', seed: [108.16, 13.94], zone: 'HIGHLAND_NEUTRAL', controller: NPC_HIGHLAND },
  { index: 43, regionId: 'reg_vn_43', code: 'R43', name: 'An Khê — Đèo Mang Yang', seed: [108.66, 14.08], zone: 'HIGHLAND_NEUTRAL', controller: NPC_HIGHLAND, riverHint: true },
  { index: 44, regionId: 'reg_vn_44', code: 'R44', name: 'Quy Nhơn — Bình Định Ven Biển', seed: [109.06, 14.12], zone: 'HIGHLAND_NEUTRAL', controller: SOUTH, coastalHint: true },

  // Band 12: Dak Lak & Phu Yen (reg_vn_45..48)
  { index: 45, regionId: 'reg_vn_45', code: 'R45', name: 'Ea Súp — Rừng Khộp Tây Đắk Lắk', seed: [107.72, 13.10], zone: 'SOUTH_SECTOR', controller: NPC_HIGHLAND, jungleHint: true },
  { index: 46, regionId: 'reg_vn_46', code: 'R46', name: 'Buôn Ma Thuột — Cao Nguyên Đắk Lắk', seed: [108.16, 12.74], zone: 'SOUTH_SECTOR', controller: SOUTH },
  { index: 47, regionId: 'reg_vn_47', code: 'R47', name: 'Cheo Reo — Lưu Vực Sông Ba', seed: [108.58, 13.32], zone: 'SOUTH_SECTOR', controller: SOUTH, riverHint: true },
  { index: 48, regionId: 'reg_vn_48', code: 'R48', name: 'Tuy Hòa — Phú Yên Ven Biển', seed: [109.18, 13.18], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, riverHint: true },

  // Band 13: Southern Highlands & Khanh Hoa (reg_vn_49..52)
  { index: 49, regionId: 'reg_vn_49', code: 'R49', name: 'Đắk Nông — Cao Nguyên M’Nông', seed: [107.68, 12.16], zone: 'SOUTH_SECTOR', controller: SOUTH },
  { index: 50, regionId: 'reg_vn_50', code: 'R50', name: 'Lắk — Chư Yang Sin', seed: [108.46, 12.42], zone: 'SOUTH_SECTOR', controller: SOUTH },
  { index: 51, regionId: 'reg_vn_51', code: 'R51', name: 'Đà Lạt — Cao Nguyên Langbiang', seed: [108.42, 11.86], zone: 'SOUTH_SECTOR', controller: SOUTH },
  { index: 52, regionId: 'reg_vn_52', code: 'R52', name: 'Nha Trang — Vịnh Cam Ranh', seed: [109.10, 12.24], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true },

  // Band 14: Upper Southeast & South Central Coast (reg_vn_53..56)
  { index: 53, regionId: 'reg_vn_53', code: 'R53', name: 'Bình Phước — Chiến Khu Miền Đông', seed: [106.92, 11.78], zone: 'SOUTH_SECTOR', controller: SOUTH, jungleHint: true },
  { index: 54, regionId: 'reg_vn_54', code: 'R54', name: 'Bảo Lộc — Đèo Di Linh', seed: [107.82, 11.58], zone: 'SOUTH_SECTOR', controller: SOUTH },
  { index: 55, regionId: 'reg_vn_55', code: 'R55', name: 'Phan Rang — Ninh Thuận', seed: [108.88, 11.62], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true },
  { index: 56, regionId: 'reg_vn_56', code: 'R56', name: 'Phan Thiết — Bình Thuận Duyên Hải', seed: [108.12, 11.02], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true },

  // Band 15: Southeast & Saigon Capital Basin (reg_vn_57..60)
  { index: 57, regionId: 'reg_vn_57', code: 'R57', name: 'Tây Ninh — Biên Giới Mộc Bài', seed: [106.16, 11.34], zone: 'SOUTH_SECTOR', controller: SOUTH },
  { index: 58, regionId: 'reg_vn_58', code: 'R58', name: 'Thủ Dầu Một — Bình Dương', seed: [106.66, 11.24], zone: 'SOUTH_SECTOR', controller: SOUTH, riverHint: true },
  { index: 59, regionId: 'reg_vn_59', code: 'R59', name: 'Sài Gòn — Gia Định (Trung Tâm Nam)', seed: [106.68, 10.78], zone: 'SOUTH_SECTOR', controller: SOUTH, urbanCore: true, riverHint: true },
  { index: 60, regionId: 'reg_vn_60', code: 'R60', name: 'Biên Hòa — Bà Rịa Vũng Tàu', seed: [107.28, 10.84], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, riverHint: true },

  // Band 16: Northern Mekong Delta (reg_vn_61..64)
  { index: 61, regionId: 'reg_vn_61', code: 'R61', name: 'Châu Đốc — Tứ Giác Long Xuyên', seed: [105.08, 10.56], zone: 'SOUTH_SECTOR', controller: SOUTH, riverHint: true },
  { index: 62, regionId: 'reg_vn_62', code: 'R62', name: 'Đồng Tháp Mười — Cao Lãnh', seed: [105.68, 10.64], zone: 'SOUTH_SECTOR', controller: SOUTH, riverHint: true },
  { index: 63, regionId: 'reg_vn_63', code: 'R63', name: 'Long An — Vàm Cỏ Tây', seed: [106.26, 10.68], zone: 'SOUTH_SECTOR', controller: SOUTH, riverHint: true },
  { index: 64, regionId: 'reg_vn_64', code: 'R64', name: 'Mỹ Tho — Gò Công Cửa Tiểu', seed: [106.56, 10.36], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, riverHint: true },

  // Band 17: Central Mekong Delta (reg_vn_65..68)
  { index: 65, regionId: 'reg_vn_65', code: 'R65', name: 'Rạch Giá — Hà Tiên Ven Vịnh', seed: [104.96, 10.06], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true },
  { index: 66, regionId: 'reg_vn_66', code: 'R66', name: 'Cần Thơ — Hậu Giang Trung Tâm', seed: [105.62, 10.04], zone: 'SOUTH_SECTOR', controller: SOUTH, urbanCore: true, riverHint: true },
  { index: 67, regionId: 'reg_vn_67', code: 'R67', name: 'Vĩnh Long — Sa Đéc Sông Tiền', seed: [106.06, 10.22], zone: 'SOUTH_SECTOR', controller: SOUTH, riverHint: true },
  { index: 68, regionId: 'reg_vn_68', code: 'R68', name: 'Bến Tre — Trà Vinh Cửa Biển', seed: [106.42, 9.92], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, riverHint: true },

  // Band 18: Southernmost Mekong & Ca Mau Peninsula (reg_vn_69..72)
  { index: 69, regionId: 'reg_vn_69', code: 'R69', name: 'U Minh Thượng — Kiên Giang Nam', seed: [105.08, 9.56], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, jungleHint: true },
  { index: 70, regionId: 'reg_vn_70', code: 'R70', name: 'Sóc Trăng — Cửa Định An', seed: [105.94, 9.58], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, riverHint: true },
  { index: 71, regionId: 'reg_vn_71', code: 'R71', name: 'Bạc Liêu — Đồng Muối Nam Bộ', seed: [105.56, 9.26], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true },
  { index: 72, regionId: 'reg_vn_72', code: 'R72', name: 'Cà Mau — Mũi Đất Cực Nam', seed: [105.06, 9.02], zone: 'SOUTH_SECTOR', controller: SOUTH, coastalHint: true, jungleHint: true },
];

const CACHE_DIR = '/tmp/vdn-ne-cache';
const COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const RIVERS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson';

async function fetchCachedJson(url: string, filename: string): Promise<any> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const localPath = path.join(CACHE_DIR, filename);
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }
  console.log(`[geo] Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(localPath, text, 'utf8');
  return JSON.parse(text);
}

function roundCoord(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function distSqToSegment(p: LonLat, a: LonLat, b: LonLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return (p[0] - px) ** 2 + (p[1] - py) ** 2;
}

function simplifyLine(pts: readonly LonLat[], tolerance: number): LonLat[] {
  if (pts.length <= 3) return pts.map(([x, y]) => [roundCoord(x), roundCoord(y)]);
  const tolSq = tolerance * tolerance;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = distSqToSegment(pts[i], pts[start], pts[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolSq && index !== -1) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  const out: LonLat[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (keep[i]) out.push([roundCoord(pts[i][0]), roundCoord(pts[i][1])]);
  }
  return out;
}

function signedRingArea(ring: readonly LonLat[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function ensureClosedCCW(ring: readonly LonLat[]): LonLat[] {
  const cleaned: LonLat[] = [];
  for (const pt of ring) {
    const rounded: LonLat = [roundCoord(pt[0]), roundCoord(pt[1])];
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev[0] !== rounded[0] || prev[1] !== rounded[1]) {
      cleaned.push(rounded);
    }
  }
  if (cleaned.length < 3) return cleaned;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  if (signedRingArea(cleaned) < 0) {
    cleaned.reverse();
  }
  return cleaned;
}

function ringCentroid(ring: readonly LonLat[]): LonLat {
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area2) < 1e-10) {
    return ring[0];
  }
  return [roundCoord(cx / (3 * area2)), roundCoord(cy / (3 * area2))];
}

function pointInRing(pt: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function deterministicHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Deterministically adds organic natural curvature to a straight internal Voronoi segment
 * so two neighboring Voronoi cells share the EXACT reversed wavy vertices (zero gaps, zero overlaps).
 */
function organicEdgePoints(a: LonLat, b: LonLat): LonLat[] {
  const ax = roundCoord(a[0]);
  const ay = roundCoord(a[1]);
  const bx = roundCoord(b[0]);
  const by = roundCoord(b[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.06) {
    return [
      [ax, ay],
      [bx, by],
    ];
  }

  // Canonical orientation so A->B and B->A generate IDENTICAL intermediate points
  const canonicalForward = ax < bx || (ax === bx && ay < by);
  const p0: LonLat = canonicalForward ? [ax, ay] : [bx, by];
  const p1: LonLat = canonicalForward ? [bx, by] : [ax, ay];
  const key = `${p0[0]},${p0[1]}|${p1[0]},${p1[1]}`;
  const phase1 = deterministicHash(key + ':p1') * Math.PI * 2;
  const phase2 = deterministicHash(key + ':p2') * Math.PI * 2;
  const amp = Math.min(0.032, len * 0.085);

  const cdx = p1[0] - p0[0];
  const cdy = p1[1] - p0[1];
  const clen = Math.hypot(cdx, cdy);
  const nx = -cdy / clen;
  const ny = cdx / clen;

  const steps = Math.min(7, Math.max(4, Math.round(len / 0.12)));
  const pts: LonLat[] = [p0];
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const envelope = Math.sin(t * Math.PI);
    const wave =
      Math.sin(t * Math.PI * 2 + phase1) * 0.65 +
      Math.sin(t * Math.PI * 3 + phase2) * 0.35;
    const offset = amp * envelope * wave;
    pts.push([roundCoord(p0[0] + cdx * t + nx * offset), roundCoord(p0[1] + cdy * t + ny * offset)]);
  }
  pts.push(p1);

  if (!canonicalForward) pts.reverse();
  return pts;
}

function geoToMultiPolygon(geometry: any): MultiPolygon {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates as Polygon];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates as MultiPolygon;
  }
  return [];
}

function simplifyMultiPolygon(mp: MultiPolygon, tolerance: number, minArea = 0.0005): MultiPolygon {
  const out: MultiPolygon = [];
  for (const poly of mp) {
    const exterior = ensureClosedCCW(simplifyLine(poly[0] as LonLat[], tolerance));
    if (exterior.length >= 4 && Math.abs(signedRingArea(exterior)) >= minArea) {
      out.push([exterior as Ring]);
    }
  }
  return out;
}

async function fetchSrtmElevations(points: readonly LonLat[]): Promise<number[]> {
  const elevations: number[] = [];
  const batchSize = 80;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    const locs = batch.map(([lon, lat]) => `${lat.toFixed(4)},${lon.toFixed(4)}`).join('|');
    const url = `https://api.opentopodata.org/v1/srtm90m?locations=${locs}`;
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 1150)); // respect 1 req/sec public limit
    }
    console.log(`[srtm] Querying batch ${i / batchSize + 1} (${batch.length} points)...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SRTM API failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { results: { elevation: number | null }[] };
    for (const r of json.results) {
      elevations.push(Math.max(0, Math.round(r.elevation ?? 5)));
    }
  }
  return elevations;
}

async function main(): Promise<void> {
  const countries = await fetchCachedJson(COUNTRIES_URL, 'ne_10m_admin_0_countries.geojson');
  const riversRaw = await fetchCachedJson(RIVERS_URL, 'ne_10m_rivers_lake_centerlines.geojson');

  const theaterBboxPoly: Polygon = [
    [
      [98.6, 6.2],
      [113.8, 6.2],
      [113.8, 25.2],
      [98.6, 25.2],
      [98.6, 6.2],
    ],
  ];

  // 1. Extract Vietnam & Context Territories from Natural Earth 1:10m (Public Domain)
  const wantedIso: Record<string, { code: string; nameVi: string; labelPos: LonLat }> = {
    VNM: { code: 'VNM', nameVi: 'Việt Nam', labelPos: [106.5, 16.0] },
    LAO: { code: 'LAO', nameVi: 'LÀO', labelPos: [102.6, 19.3] },
    KHM: { code: 'KHM', nameVi: 'CAMPUCHIA', labelPos: [104.9, 12.6] },
    CHN: { code: 'CHN', nameVi: 'MIỀN NAM TRUNG QUỐC', labelPos: [108.2, 23.8] },
    THA: { code: 'THA', nameVi: 'THÁI LAN', labelPos: [101.4, 15.3] },
    MMR: { code: 'MMR', nameVi: 'MYANMAR', labelPos: [99.4, 21.8] },
  };

  let vietnamRawMulti: MultiPolygon = [];
  const contextCountries: {
    iso: string;
    nameVi: string;
    labelPos: LonLat;
    polygons: LonLat[][][];
  }[] = [];

  for (const feat of countries.features) {
    const iso = feat.properties.ISO_A3 || feat.properties.ADM0_A3;
    const spec = wantedIso[iso];
    if (!spec) continue;
    const mp = geoToMultiPolygon(feat.geometry);
    if (iso === 'VNM') {
      vietnamRawMulti = mp;
      continue;
    }
    const clipped = polygonClipping.intersection(mp, theaterBboxPoly);
    const simplified = simplifyMultiPolygon(clipped, 0.014, 0.002);
    if (simplified.length > 0) {
      contextCountries.push({
        iso,
        nameVi: spec.nameVi,
        labelPos: spec.labelPos,
        polygons: simplified as unknown as LonLat[][][],
      });
    }
  }

  if (vietnamRawMulti.length === 0) {
    throw new Error('Could not find Vietnam (VNM) in Natural Earth 1:10m dataset');
  }

  // Simplify Vietnam slightly (~800m resolution) while preserving authentic coastline & mainland
  const vietnamSimplified = simplifyMultiPolygon(vietnamRawMulti, 0.007, 0.0008);
  // Identify mainland polygon (largest area) and offshore islands (Phú Quốc, Côn Đảo, Cát Bà, etc.)
  const sortedVnPolys = [...vietnamSimplified].sort(
    (a, b) => Math.abs(signedRingArea(b[0] as LonLat[])) - Math.abs(signedRingArea(a[0] as LonLat[]))
  );
  const vietnamMainland: Polygon = sortedVnPolys[0];
  const offshoreIslands: LonLat[][][] = sortedVnPolys.slice(1, 14) as unknown as LonLat[][][];

  // 2. Partition Vietnam mainland organically into 72 regions via clipped organic Voronoi
  const delaunay = Delaunay.from(SEED_REGIONS.map((r) => r.seed));
  const voronoi = delaunay.voronoi([101.8, 8.0, 110.2, 23.8]);

  interface BuiltRegion {
    spec: SeedRegionSpec;
    ring: LonLat[];
    centroid: LonLat;
    areaDeg2: number;
    hasCoastline: boolean;
  }

  const builtRegions: BuiltRegion[] = [];

  for (let i = 0; i < SEED_REGIONS.length; i += 1) {
    const spec = SEED_REGIONS[i];
    const cellPoly = voronoi.cellPolygon(i);
    if (!cellPoly || cellPoly.length < 4) {
      throw new Error(`Voronoi cell ${spec.regionId} failed`);
    }

    // Apply organic waviness to Voronoi cell edges
    const organicRing: LonLat[] = [];
    for (let e = 0; e < cellPoly.length - 1; e += 1) {
      const segPts = organicEdgePoints(
        [cellPoly[e][0], cellPoly[e][1]],
        [cellPoly[e + 1][0], cellPoly[e + 1][1]]
      );
      for (let k = 0; k < segPts.length - 1; k += 1) {
        organicRing.push(segPts[k]);
      }
    }
    const closedOrganic = ensureClosedCCW(organicRing);

    // Clip strictly to REAL Natural Earth 1:10m Vietnam mainland polygon
    const clipped = polygonClipping.intersection([closedOrganic as Ring], vietnamMainland);
    if (clipped.length === 0) {
      throw new Error(`Region ${spec.regionId} (${spec.name}) did not intersect Vietnam mainland!`);
    }

    // Pick largest polygon piece for primary playable polygon
    const bestPiece = [...clipped].sort(
      (a, b) => Math.abs(signedRingArea(b[0] as LonLat[])) - Math.abs(signedRingArea(a[0] as LonLat[]))
    )[0];

    const finalRing = ensureClosedCCW(simplifyLine(bestPiece[0] as LonLat[], 0.005));
    const areaDeg2 = Math.abs(signedRingArea(finalRing));
    let centroid = ringCentroid(finalRing);
    if (!pointInRing(centroid, finalRing)) {
      centroid = pointInRing(spec.seed, finalRing) ? spec.seed : finalRing[0];
    }

    builtRegions.push({
      spec,
      ring: finalRing,
      centroid: [roundCoord(centroid[0]), roundCoord(centroid[1])],
      areaDeg2,
      hasCoastline: Boolean(spec.coastalHint),
    });
  }

  // 3. Derive symmetric adjacency graph directly from Delaunay triangulation + shared-vertex check
  const adjSets: Map<string, Set<string>> = new Map();
  for (const r of builtRegions) adjSets.set(r.spec.regionId, new Set());

  const shareNearVertex = (ringA: readonly LonLat[], ringB: readonly LonLat[]): boolean => {
    const epsSq = 0.025 * 0.025;
    for (const a of ringA) {
      for (const b of ringB) {
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        if (dx * dx + dy * dy <= epsSq) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < builtRegions.length; i += 1) {
    const idA = builtRegions[i].spec.regionId;
    for (const j of delaunay.neighbors(i)) {
      if (j <= i) continue;
      const idB = builtRegions[j].spec.regionId;
      if (shareNearVertex(builtRegions[i].ring, builtRegions[j].ring)) {
        adjSets.get(idA)!.add(idB);
        adjSets.get(idB)!.add(idA);
      }
    }
  }

  // Verify 100% single-component connectivity (if any narrow peninsula neck wasn't joined, link nearest Delaunay neighbor)
  const ensureConnected = () => {
    const start = builtRegions[0].spec.regionId;
    while (true) {
      const visited = new Set<string>([start]);
      const q = [start];
      while (q.length > 0) {
        const curr = q.shift()!;
        for (const n of adjSets.get(curr) ?? []) {
          if (!visited.has(n)) {
            visited.add(n);
            q.push(n);
          }
        }
      }
      if (visited.size === builtRegions.length) break;
      // Connect closest unvisited region to closest visited region
      let bestDist = Infinity;
      let pair: [string, string] | null = null;
      for (const u of builtRegions) {
        if (visited.has(u.spec.regionId)) continue;
        for (const v of builtRegions) {
          if (!visited.has(v.spec.regionId)) continue;
          const d = Math.hypot(u.centroid[0] - v.centroid[0], u.centroid[1] - v.centroid[1]);
          if (d < bestDist) {
            bestDist = d;
            pair = [u.spec.regionId, v.spec.regionId];
          }
        }
      }
      if (!pair) break;
      adjSets.get(pair[0])!.add(pair[1]);
      adjSets.get(pair[1])!.add(pair[0]);
    }
  };
  ensureConnected();

  // 4. Query REAL NASA SRTM 90m DEM elevations for all 72 region centroids + 2 offset relief points each
  const srtmQueryPoints: LonLat[] = [];
  for (const r of builtRegions) {
    srtmQueryPoints.push(r.centroid);
    srtmQueryPoints.push([roundCoord(r.centroid[0] - 0.08), roundCoord(r.centroid[1] + 0.06)]);
    srtmQueryPoints.push([roundCoord(r.centroid[0] + 0.08), roundCoord(r.centroid[1] - 0.06)]);
  }

  // Real major cities at verified geographic coordinates
  const CITIES_RAW: readonly {
    id: string;
    name: string;
    coords: LonLat;
    tier: 'CAPITAL' | 'MAJOR' | 'STRATEGIC_TOWN';
    regionId: string;
    port?: boolean;
  }[] = [
    { id: 'cty_hanoi', name: 'Hà Nội', coords: [105.8542, 21.0285], tier: 'CAPITAL', regionId: 'reg_vn_11' },
    { id: 'cty_saigon', name: 'Sài Gòn', coords: [106.7009, 10.7769], tier: 'CAPITAL', regionId: 'reg_vn_59', port: true },
    { id: 'cty_haiphong', name: 'Hải Phòng', coords: [106.6881, 20.8449], tier: 'MAJOR', regionId: 'reg_vn_16', port: true },
    { id: 'cty_hue', name: 'Huế', coords: [107.5909, 16.4637], tier: 'MAJOR', regionId: 'reg_vn_35' },
    { id: 'cty_danang', name: 'Đà Nẵng', coords: [108.2022, 16.0544], tier: 'MAJOR', regionId: 'reg_vn_36', port: true },
    { id: 'cty_cantho', name: 'Cần Thơ', coords: [105.7851, 10.0452], tier: 'MAJOR', regionId: 'reg_vn_66' },
    { id: 'cty_vinh', name: 'Vinh', coords: [105.6813, 18.6796], tier: 'MAJOR', regionId: 'reg_vn_24', port: true },
    { id: 'cty_quynhon', name: 'Quy Nhơn', coords: [109.2197, 13.7830], tier: 'MAJOR', regionId: 'reg_vn_44', port: true },
    { id: 'cty_nhatrang', name: 'Nha Trang', coords: [109.1967, 12.2388], tier: 'MAJOR', regionId: 'reg_vn_52', port: true },
    { id: 'cty_dalat', name: 'Đà Lạt', coords: [108.4583, 11.9404], tier: 'MAJOR', regionId: 'reg_vn_51' },
    { id: 'cty_bmt', name: 'Buôn Ma Thuột', coords: [108.0378, 12.6662], tier: 'MAJOR', regionId: 'reg_vn_46' },
    { id: 'cty_pleiku', name: 'Pleiku', coords: [108.0005, 13.9833], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_42' },
    { id: 'cty_kontum', name: 'Kon Tum', coords: [108.0005, 14.3497], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_38' },
    { id: 'cty_dienbien', name: 'Điện Biên Phủ', coords: [103.0168, 21.3860], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_05' },
    { id: 'cty_laocai', name: 'Lào Cai', coords: [103.9755, 22.4856], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_02' },
    { id: 'cty_langson', name: 'Lạng Sơn', coords: [106.7615, 21.8537], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_08' },
    { id: 'cty_namdinh', name: 'Nam Định', coords: [106.1621, 20.4388], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_19' },
    { id: 'cty_thanhhoa', name: 'Thanh Hóa', coords: [105.7852, 19.8067], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_20' },
    { id: 'cty_donghoi', name: 'Đồng Hới', coords: [106.6223, 17.4689], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_31', port: true },
    { id: 'cty_quangngai', name: 'Quảng Ngãi', coords: [108.8044, 15.1214], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_40' },
    { id: 'cty_phanthiet', name: 'Phan Thiết', coords: [108.1021, 10.9289], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_56', port: true },
    { id: 'cty_bienhoa', name: 'Biên Hòa', coords: [106.8243, 10.9574], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_60' },
    { id: 'cty_mytho', name: 'Mỹ Tho', coords: [106.3599, 10.3600], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_64' },
    { id: 'cty_camau', name: 'Cà Mau', coords: [105.1524, 9.1768], tier: 'STRATEGIC_TOWN', regionId: 'reg_vn_72' },
  ];

  // Notable real mountain peaks for topographic relief display
  const PEAKS_RAW: readonly { name: string; coords: LonLat }[] = [
    { name: 'Fansipan', coords: [103.7751, 22.3033] },
    { name: 'Pu Si Lung', coords: [102.7900, 22.6260] },
    { name: 'Ngọc Linh', coords: [107.9810, 15.0660] },
    { name: 'Chư Yang Sin', coords: [108.4360, 12.4080] },
    { name: 'Langbiang', coords: [108.4390, 12.0440] },
    { name: 'Bà Đen', coords: [106.1740, 11.3730] },
  ];

  for (const c of CITIES_RAW) srtmQueryPoints.push(c.coords);
  for (const p of PEAKS_RAW) srtmQueryPoints.push(p.coords);

  const allElevations = await fetchSrtmElevations(srtmQueryPoints);

  const regionElevations: { mean: number; peak: number }[] = [];
  for (let i = 0; i < builtRegions.length; i += 1) {
    const e0 = allElevations[i * 3];
    const e1 = allElevations[i * 3 + 1];
    const e2 = allElevations[i * 3 + 2];
    const mean = Math.round((e0 * 2 + e1 + e2) / 4);
    const peak = Math.max(e0, e1, e2);
    regionElevations.push({ mean, peak });
  }

  const cityOffset = builtRegions.length * 3;
  const cities = CITIES_RAW.map((c, idx) => ({
    ...c,
    elevationMeters: allElevations[cityOffset + idx],
  }));

  const peakOffset = cityOffset + CITIES_RAW.length;
  const peaks = PEAKS_RAW.map((p, idx) => ({
    ...p,
    elevationMeters: allElevations[peakOffset + idx],
  }));

  // 5. Extract real Natural Earth 1:10m Rivers clipped to theater + clearly-labeled Vietnamese regional waterways
  interface RiverLine {
    readonly id: string;
    readonly name: string;
    readonly source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN' | 'SUPPLEMENTARY_HYDROGRAPHIC_REFERENCE';
    readonly major: boolean;
    readonly coordinates: LonLat[];
  }

  const rivers: RiverLine[] = [];
  const inTheater = ([lon, lat]: LonLat) => lon >= 99.0 && lon <= 111.5 && lat >= 8.0 && lat <= 24.5;

  let neRiverIdx = 0;
  for (const feat of riversRaw.features) {
    const geom = feat.geometry;
    if (!geom) continue;
    const lines: LonLat[][] =
      geom.type === 'LineString'
        ? [geom.coordinates]
        : geom.type === 'MultiLineString'
          ? geom.coordinates
          : [];
    for (const line of lines) {
      const clippedSeg: LonLat[] = [];
      for (const pt of line) {
        if (inTheater(pt)) {
          clippedSeg.push([roundCoord(pt[0]), roundCoord(pt[1])]);
        } else if (clippedSeg.length >= 2) {
          neRiverIdx += 1;
          rivers.push({
            id: `riv_ne_${neRiverIdx}`,
            name: feat.properties.name || 'Sông khu vực',
            source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN',
            major: Number(feat.properties.scalerank ?? 6) <= 5,
            coordinates: simplifyLine(clippedSeg, 0.015),
          });
          clippedSeg.length = 0;
        } else {
          clippedSeg.length = 0;
        }
      }
      if (clippedSeg.length >= 2) {
        neRiverIdx += 1;
        rivers.push({
          id: `riv_ne_${neRiverIdx}`,
          name: feat.properties.name || 'Sông khu vực',
          source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN',
          major: Number(feat.properties.scalerank ?? 6) <= 5,
          coordinates: simplifyLine(clippedSeg, 0.015),
        });
      }
    }
  }

  // Supplementary key Vietnamese river centerlines for cartographic clarity (labeled explicitly)
  const SUPPLEMENTARY_RIVERS: readonly Omit<RiverLine, 'source'>[] = [
    {
      id: 'riv_sup_da',
      name: 'Sông Đà',
      major: true,
      coordinates: [
        [102.65, 22.38],
        [103.16, 22.05],
        [103.85, 21.52],
        [104.58, 21.15],
        [105.33, 20.82],
        [105.38, 21.25],
      ],
    },
    {
      id: 'riv_sup_lo',
      name: 'Sông Lô',
      major: false,
      coordinates: [
        [104.98, 22.82],
        [105.21, 22.12],
        [105.22, 21.82],
        [105.39, 21.30],
      ],
    },
    {
      id: 'riv_sup_ma',
      name: 'Sông Mã',
      major: false,
      coordinates: [
        [103.65, 21.15],
        [104.52, 20.68],
        [105.05, 20.32],
        [105.48, 20.02],
        [105.92, 19.78],
      ],
    },
    {
      id: 'riv_sup_ca',
      name: 'Sông Cả (Lam)',
      major: false,
      coordinates: [
        [104.22, 19.45],
        [104.78, 19.12],
        [105.24, 18.88],
        [105.68, 18.68],
        [105.78, 18.75],
      ],
    },
    {
      id: 'riv_sup_benhai',
      name: 'Sông Bến Hải (Vĩ tuyến 17)',
      major: false,
      coordinates: [
        [106.72, 16.92],
        [106.95, 16.96],
        [107.12, 17.01],
      ],
    },
    {
      id: 'riv_sup_huong',
      name: 'Sông Hương',
      major: false,
      coordinates: [
        [107.42, 16.28],
        [107.56, 16.45],
        [107.66, 16.56],
      ],
    },
    {
      id: 'riv_sup_ba',
      name: 'Sông Ba (Đà Rằng)',
      major: false,
      coordinates: [
        [108.45, 14.32],
        [108.62, 13.72],
        [108.68, 13.34],
        [109.10, 13.06],
        [109.32, 13.08],
      ],
    },
    {
      id: 'riv_sup_dongnai',
      name: 'Sông Đồng Nai — Sài Gòn',
      major: true,
      coordinates: [
        [108.28, 11.98],
        [107.56, 11.42],
        [107.02, 11.12],
        [106.82, 10.95],
        [106.72, 10.74],
        [106.92, 10.42],
      ],
    },
    {
      id: 'riv_sup_hau',
      name: 'Sông Hậu (Mekong)',
      major: true,
      coordinates: [
        [105.12, 10.72],
        [105.38, 10.42],
        [105.78, 10.04],
        [106.04, 9.76],
        [106.24, 9.52],
      ],
    },
  ];
  for (const r of SUPPLEMENTARY_RIVERS) {
    rivers.push({ ...r, source: 'SUPPLEMENTARY_HYDROGRAPHIC_REFERENCE' });
  }

  // 6. Build Multi-Tier Vector Transport Network (Alternate-History 1955 Abstract Corridors)
  // Explicitly NOT modern expressways claimed as historical facts!
  type TransportKind = 'PRIMARY_ROAD' | 'SECONDARY_ROAD' | 'RAILWAY' | 'RIVER_CROSSING';
  interface TransportEdge {
    readonly id: string;
    readonly fromRegionId: string;
    readonly toRegionId: string;
    readonly kind: TransportKind;
    readonly movementModifierFp: number; // x1000 multiplier for future Movement Engine
    readonly label: string;
    readonly coordinates: LonLat[];
  }

  const centroidById = new Map<string, LonLat>(builtRegions.map((r) => [r.spec.regionId, r.centroid]));
  const transportEdges: TransportEdge[] = [];
  const edgeKeys = new Set<string>();

  const addCorridor = (
    chain: readonly string[],
    kind: TransportKind,
    label: string,
    movementModifierFp: number
  ) => {
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i];
      const b = chain[i + 1];
      const key = `${kind}:${[a, b].sort().join('--')}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);

      // Ensure transport corridor endpoints are also connected in the gameplay graph
      adjSets.get(a)?.add(b);
      adjSets.get(b)?.add(a);

      const pA = centroidById.get(a)!;
      const pB = centroidById.get(b)!;
      const midLon = roundCoord((pA[0] + pB[0]) / 2 + (deterministicHash(key) - 0.5) * 0.06);
      const midLat = roundCoord((pA[1] + pB[1]) / 2 + (deterministicHash(key + 'y') - 0.5) * 0.06);

      transportEdges.push({
        id: `trn_${transportEdges.length + 1}`,
        fromRegionId: a,
        toRegionId: b,
        kind,
        movementModifierFp,
        label,
        coordinates: [pA, [midLon, midLat], pB],
      });
    }
  };

  // Primary Strategic Trunk Roads (1955 fictional strategic corridor abstraction)
  addCorridor(
    [
      'reg_vn_08', 'reg_vn_15', 'reg_vn_11', 'reg_vn_18', 'reg_vn_20',
      'reg_vn_23', 'reg_vn_24', 'reg_vn_26', 'reg_vn_27', 'reg_vn_31',
      'reg_vn_32', 'reg_vn_35', 'reg_vn_36', 'reg_vn_39', 'reg_vn_40',
      'reg_vn_44', 'reg_vn_48', 'reg_vn_52', 'reg_vn_55', 'reg_vn_56',
      'reg_vn_60', 'reg_vn_59', 'reg_vn_63', 'reg_vn_64', 'reg_vn_67',
      'reg_vn_66', 'reg_vn_70', 'reg_vn_71', 'reg_vn_72',
    ],
    'PRIMARY_ROAD',
    'Trục Duyên Hải Bắc–Nam (Hư cấu 1955)',
    750
  );
  addCorridor(
    ['reg_vn_11', 'reg_vn_15', 'reg_vn_16', 'reg_vn_12'],
    'PRIMARY_ROAD',
    'Hành Lang Hà Nội — Hải Phòng — Hạ Long',
    750
  );
  addCorridor(
    ['reg_vn_59', 'reg_vn_58', 'reg_vn_53', 'reg_vn_49', 'reg_vn_46', 'reg_vn_42', 'reg_vn_38'],
    'PRIMARY_ROAD',
    'Trục Cao Nguyên Miền Đông — Tây Nguyên',
    820
  );
  addCorridor(
    ['reg_vn_59', 'reg_vn_57'],
    'PRIMARY_ROAD',
    'Hành Lang Tây Bắc Sài Gòn',
    780
  );

  // Railway Trunk & Northern Branch Lines (1955 abstract rail network)
  addCorridor(
    [
      'reg_vn_02', 'reg_vn_06', 'reg_vn_10', 'reg_vn_11', 'reg_vn_16',
    ],
    'RAILWAY',
    'Tuyến Đường Sắt Sông Hồng — Cảng Bắc',
    650
  );
  addCorridor(
    [
      'reg_vn_08', 'reg_vn_15', 'reg_vn_11', 'reg_vn_18', 'reg_vn_20',
      'reg_vn_24', 'reg_vn_26', 'reg_vn_31', 'reg_vn_32', 'reg_vn_35',
      'reg_vn_36', 'reg_vn_40', 'reg_vn_44', 'reg_vn_48', 'reg_vn_52',
      'reg_vn_55', 'reg_vn_56', 'reg_vn_60', 'reg_vn_59',
    ],
    'RAILWAY',
    'Tuyến Đường Sắt Xuyên Việt (Hư cấu 1955)',
    650
  );

  // Secondary Highland, Frontier & Mountain Pass Roads
  addCorridor(
    ['reg_vn_01', 'reg_vn_05', 'reg_vn_09', 'reg_vn_13', 'reg_vn_14', 'reg_vn_11'],
    'SECONDARY_ROAD',
    'Tuyến Đèo Tây Bắc',
    950
  );
  addCorridor(
    ['reg_vn_02', 'reg_vn_03', 'reg_vn_07', 'reg_vn_04', 'reg_vn_08'],
    'SECONDARY_ROAD',
    'Vòng Cung Việt Bắc — Biên Đông Bắc',
    950
  );
  addCorridor(
    ['reg_vn_17', 'reg_vn_21', 'reg_vn_22', 'reg_vn_25', 'reg_vn_28', 'reg_vn_29', 'reg_vn_30', 'reg_vn_33', 'reg_vn_34', 'reg_vn_37', 'reg_vn_38'],
    'SECONDARY_ROAD',
    'Hành Lang Trường Sơn (Đường phụ địa hình)',
    1050
  );
  addCorridor(
    ['reg_vn_41', 'reg_vn_42', 'reg_vn_43', 'reg_vn_44'],
    'SECONDARY_ROAD',
    'Đèo An Khê — Gia Lai',
    950
  );
  addCorridor(
    ['reg_vn_45', 'reg_vn_46', 'reg_vn_47', 'reg_vn_48'],
    'SECONDARY_ROAD',
    'Đường Ngang Đắk Lắk — Phú Yên',
    950
  );
  addCorridor(
    ['reg_vn_50', 'reg_vn_51', 'reg_vn_54', 'reg_vn_55'],
    'SECONDARY_ROAD',
    'Tuyến Cao Nguyên Đà Lạt — Di Linh',
    950
  );
  addCorridor(
    ['reg_vn_61', 'reg_vn_65', 'reg_vn_69', 'reg_vn_72'],
    'SECONDARY_ROAD',
    'Tuyến Ven Vịnh Tây Nam',
    950
  );

  // River Crossings (Ferries / Bridges across Red River, 17th Parallel, and Mekong Delta)
  const riverCrossings: readonly [string, string, string][] = [
    ['reg_vn_11', 'reg_vn_19', 'Vượt Sông Hồng (Châu Thổ Bắc)'],
    ['reg_vn_10', 'reg_vn_14', 'Vượt Sông Đà (Hòa Bình)'],
    ['reg_vn_32', 'reg_vn_35', 'Vượt Sông Bến Hải — Vĩ Tuyến 17'],
    ['reg_vn_62', 'reg_vn_67', 'Phà Vượt Sông Tiền (Cao Lãnh)'],
    ['reg_vn_64', 'reg_vn_68', 'Phà Cửa Sông Tiền (Mỹ Tho — Bến Tre)'],
    ['reg_vn_66', 'reg_vn_67', 'Phà Vượt Sông Hậu (Cần Thơ — Vĩnh Long)'],
    ['reg_vn_61', 'reg_vn_62', 'Vượt Sông Tiền — Hậu (Châu Đốc)'],
    ['reg_vn_68', 'reg_vn_70', 'Phà Cửa Định An (Trà Vinh — Sóc Trăng)'],
  ];
  for (const [a, b, label] of riverCrossings) {
    addCorridor([a, b], 'RIVER_CROSSING', label, 1150);
  }

  // 7. Assemble final 72 regions with verified SRTM elevations & Movement Engine metadata
  const finalRegions = builtRegions.map((r, i) => {
    const elev = regionElevations[i];
    const s = r.spec;

    let terrain: 'URBAN_CORE' | 'COASTAL_DELTA' | 'RIVER_BASIN' | 'JUNGLE_CORRIDOR' | 'HIGHLANDS' | 'MOUNTAIN_PASS';
    if (s.urbanCore) {
      terrain = 'URBAN_CORE';
    } else if (elev.mean >= 650 || elev.peak >= 1200) {
      terrain = 'MOUNTAIN_PASS';
    } else if (elev.mean >= 220) {
      terrain = s.jungleHint ? 'JUNGLE_CORRIDOR' : 'HIGHLANDS';
    } else if (s.jungleHint && !s.coastalHint) {
      terrain = 'JUNGLE_CORRIDOR';
    } else if (s.coastalHint) {
      terrain = 'COASTAL_DELTA';
    } else if (s.riverHint || elev.mean <= 40) {
      terrain = 'RIVER_BASIN';
    } else {
      terrain = 'HIGHLANDS';
    }

    const terrainFeatures: string[] = [];
    if (elev.peak >= 1000 || terrain === 'MOUNTAIN_PASS') terrainFeatures.push('MOUNTAIN');
    if (elev.mean >= 180 && elev.mean < 800) terrainFeatures.push('HILLS');
    if (elev.mean < 65) terrainFeatures.push('PLAIN');
    if (s.jungleHint || terrain === 'JUNGLE_CORRIDOR' || elev.mean >= 350) terrainFeatures.push('FOREST');
    if (s.riverHint || terrain === 'RIVER_BASIN') terrainFeatures.push('RIVER');
    if (s.coastalHint || terrain === 'COASTAL_DELTA') terrainFeatures.push('COAST');
    if (s.urbanCore || terrain === 'URBAN_CORE') terrainFeatures.push('URBAN');

    const movementCostByTerrain: Record<typeof terrain, number> = {
      URBAN_CORE: 1000,
      RIVER_BASIN: 1200,
      COASTAL_DELTA: 1250,
      HIGHLANDS: 1850,
      JUNGLE_CORRIDOR: 2250,
      MOUNTAIN_PASS: 2750,
    };

    const econByTerrain: Record<typeof terrain, number> = {
      URBAN_CORE: 94,
      RIVER_BASIN: 78,
      COASTAL_DELTA: 70,
      HIGHLANDS: 46,
      JUNGLE_CORRIDOR: 38,
      MOUNTAIN_PASS: 32,
    };
    const infraByTerrain: Record<typeof terrain, number> = {
      URBAN_CORE: 84,
      RIVER_BASIN: 62,
      COASTAL_DELTA: 60,
      HIGHLANDS: 42,
      JUNGLE_CORRIDOR: 34,
      MOUNTAIN_PASS: 28,
    };
    const supplyByTerrain: Record<typeof terrain, number> = {
      URBAN_CORE: 112,
      RIVER_BASIN: 92,
      COASTAL_DELTA: 86,
      HIGHLANDS: 64,
      JUNGLE_CORRIDOR: 54,
      MOUNTAIN_PASS: 48,
    };

    const jitter = (s.index * 7) % 11;
    const econ = econByTerrain[terrain] + (terrain === 'URBAN_CORE' ? 0 : jitter - 5);
    const infra = infraByTerrain[terrain] + (terrain === 'URBAN_CORE' ? 0 : (s.index * 5) % 9 - 4);
    const supply = supplyByTerrain[terrain] + ((s.index * 3) % 9 - 4);

    return {
      regionId: s.regionId,
      code: s.code,
      name: s.name,
      zone: s.zone,
      initialControllerNationId: s.controller,
      terrain,
      terrainFeatures,
      elevationMeters: elev.mean,
      elevationPeakMeters: elev.peak,
      elevationSource: 'NASA_SRTM_90M_PUBLIC_DOMAIN',
      movementCostFp: movementCostByTerrain[terrain],
      forestCoverFp: terrainFeatures.includes('FOREST') ? 680 : 180,
      urbanizationFp: s.urbanCore ? 850 : terrain === 'RIVER_BASIN' ? 420 : 210,
      hasCoastline: Boolean(s.coastalHint),
      hasMajorRiver: Boolean(s.riverHint),
      economicOutput: Math.max(20, econ),
      infrastructure: Math.max(18, infra),
      supplyCapacity: Math.max(36, supply),
      centroid: r.centroid,
      adjacentRegionIds: Array.from(adjSets.get(s.regionId)!).sort(),
      coordinates: r.ring,
    };
  });

  const output = {
    metadata: {
      version: '2.0.0-p02-05',
      regionCount: finalRegions.length,
      eraLabel: 'ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK',
      modernRoadsUsedAsHistorical: false,
      modernAdminBordersUsedAsHistorical: false,
      coastlineSource: 'Natural Earth 1:10m Admin-0 Countries (Public Domain)',
      riverSource: 'Natural Earth 1:10m Rivers & Lake Centerlines (Public Domain) + Supplementary Hydrographic References',
      elevationSource: 'NASA SRTM 90m DEM via OpenTopoData (Public Domain)',
      regionPartitionNotice:
        '72 gameplay regions are fictional alternate-history subdivisions clipped strictly to Natural Earth 1:10m coastlines; modern administrative borders and modern expressways are NOT presented as verified historical facts.',
      attribution:
        'Coastlines & neighbors: Natural Earth 1:10m (Public Domain). Elevation: NASA SRTM 90m DEM (Public Domain). 72-region boundaries & 1955 transport corridors: Fictional Alternate-History Gameplay Abstraction.',
    },
    bounds: {
      minLon: 99.0,
      maxLon: 113.5,
      minLat: 7.2,
      maxLat: 24.6,
    },
    contextCountries,
    offshoreIslands,
    rivers,
    peaks,
    cities,
    transportCorridors: transportEdges,
    regions: finalRegions,
  };

  const outDir = path.resolve(process.cwd(), 'src/content/geo');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'vietnam72WorldData.json');
  fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');

  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `[geo] Wrote ${outPath} (${sizeKb} KB): ${finalRegions.length} regions, ${contextCountries.length} context countries, ${rivers.length} river segments, ${cities.length} cities, ${transportEdges.length} transport edges.`
  );
}

main().catch((err) => {
  console.error('[geo] Build failed:', err);
  process.exit(1);
});
