import {
  asFixedPoint,
  asUtcEpochMs,
  CAMPAIGN_COMBAT_TICK_MS,
  CAMPAIGN_HEAL_TICK_MS,
  CAMPAIGN_HOUR_MS,
  CAMPAIGN_MELEE_RANGE_DEG,
  CAMPAIGN_OBSERVATION_RADIUS_DEG,
  CAMPAIGN_RANGED_RANGE_DEG,
  CampaignBattleReport,
  CampaignCityJob,
  CampaignCityState,
  CampaignDiplomacyAction,
  CampaignDiplomacyState,
  CampaignDoctrineKey,
  CampaignGeoPoint,
  CampaignLane,
  CampaignLogEntry,
  CampaignMatchState,
  CampaignNationState,
  CampaignNewsItem,
  CampaignProjectKey,
  CampaignResourceTuple,
  CampaignUnitKey,
  CampaignUnitState,
  DomainEventPayload,
  getCampaignUnitVisionRadiusDeg,
  HumanSlot,
  interpolateCampaignUnitPosition,
  Nation,
  NationId,
  Region,
  RegionId,
  Unit,
  UnitId,
  UnitIdSchema,
  UtcEpochMs,
} from '../contracts';

/**
 * Pure, deterministic server-authoritative engine for the modern Vietnam campaign map.
 * ZERO Date.now(), ZERO Math.random(). All arithmetic uses exact safe integers.
 * Covers Economy, WW3 Multi-Branch Research, City Buildings, Mobilization,
 * Diplomacy (Peace/War/Shared Intel), Melee & Ranged Combat, Conquest, Healing, and Victory Points.
 */

export const CAMPAIGN_MATERIAL_LABELS: readonly string[] = [
  'Tiếp tế',
  'Linh kiện',
  'Nhiên liệu',
  'Điện tử',
  'Vật liệu hiếm',
  'Nhân lực',
  'Tiền',
];

export type CampaignTechBranch = 'INFANTRY' | 'ARMORED' | 'SUPPORT';

export interface CampaignDoctrineSpec {
  readonly key: CampaignDoctrineKey;
  readonly branch: CampaignTechBranch;
  readonly tier: 1 | 2;
  readonly name: string;
  readonly description: string;
  readonly cost: CampaignResourceTuple;
  readonly seconds: number;
  readonly requires: CampaignDoctrineKey | null;
}

export const CAMPAIGN_DOCTRINE_CATALOG: Readonly<Record<CampaignDoctrineKey, CampaignDoctrineSpec>> = {
  motor: {
    key: 'motor',
    branch: 'INFANTRY',
    tier: 1,
    name: 'Bộ binh cơ giới I',
    description: 'Mở huy động bộ binh cơ giới có khả năng chiếm đóng thành phố.',
    cost: [180, 0, 0, 0, 80, 0, 240],
    seconds: 45,
    requires: null,
  },
  motor2: {
    key: 'motor2',
    branch: 'INFANTRY',
    tier: 2,
    name: 'Bộ binh cơ giới II',
    description: 'Rút lệnh di chuyển mới từ 32 xuống 24 giây và tăng +20% hỏa lực cơ giới.',
    cost: [240, 0, 0, 0, 120, 0, 360],
    seconds: 65,
    requires: 'motor',
  },
  recon: {
    key: 'recon',
    branch: 'ARMORED',
    tier: 1,
    name: 'Xe trinh sát chiến đấu I',
    description: 'Mở huy động xe trinh sát tốc độ cao (22s), mở rộng tầm nhìn 2.25°.',
    cost: [150, 90, 0, 30, 60, 0, 220],
    seconds: 45,
    requires: null,
  },
  tank: {
    key: 'tank',
    branch: 'ARMORED',
    tier: 2,
    name: 'Xe tăng chủ lực I',
    description: 'Mở huy động xe tăng chủ lực giáp nặng, xuyên phá công sự (cần Căn cứ cấp 2).',
    cost: [220, 180, 60, 50, 120, 0, 420],
    seconds: 75,
    requires: 'recon',
  },
  artillery: {
    key: 'artillery',
    branch: 'SUPPORT',
    tier: 1,
    name: 'Pháo binh dã chiến I',
    description: 'Mở huy động pháo binh bắn tầm xa 1.25° không chịu phản công cận chiến.',
    cost: [200, 140, 0, 60, 100, 0, 340],
    seconds: 60,
    requires: 'motor',
  },
};

export interface CampaignProjectSpec {
  readonly key: CampaignProjectKey;
  readonly label: string;
  readonly lane: CampaignLane;
  readonly seconds: number;
  readonly cost: CampaignResourceTuple;
  readonly maxLevel?: number;
}

export const CAMPAIGN_PROJECT_CATALOG: Readonly<Record<CampaignProjectKey, CampaignProjectSpec>> = {
  factory: {
    key: 'factory',
    label: 'Xưởng công nghiệp',
    lane: 'build',
    seconds: 60,
    cost: [200, 150, 0, 25, 0, 0, 300],
    maxLevel: 5,
  },
  office: {
    key: 'office',
    label: 'Văn phòng tuyển dụng',
    lane: 'build',
    seconds: 45,
    cost: [150, 60, 0, 0, 0, 0, 200],
    maxLevel: 5,
  },
  base: {
    key: 'base',
    label: 'Căn cứ lục quân',
    lane: 'build',
    seconds: 55,
    cost: [180, 120, 0, 30, 0, 0, 260],
    maxLevel: 3,
  },
  bunker: {
    key: 'bunker',
    label: 'Hầm công sự',
    lane: 'build',
    seconds: 50,
    cost: [140, 100, 0, 0, 40, 0, 220],
    maxLevel: 3,
  },
  hospital: {
    key: 'hospital',
    label: 'Bệnh viện quân y',
    lane: 'build',
    seconds: 55,
    cost: [160, 80, 0, 40, 0, 0, 250],
    maxLevel: 3,
  },
  reserve: {
    key: 'reserve',
    label: 'Đội dự bị',
    lane: 'mobilize',
    seconds: 40,
    cost: [120, 40, 20, 0, 0, 75, 150],
  },
  motor: {
    key: 'motor',
    label: 'Bộ binh cơ giới',
    lane: 'mobilize',
    seconds: 50,
    cost: [170, 90, 40, 0, 0, 85, 220],
  },
  recon: {
    key: 'recon',
    label: 'Xe trinh sát',
    lane: 'mobilize',
    seconds: 45,
    cost: [130, 110, 50, 30, 0, 65, 240],
  },
  tank: {
    key: 'tank',
    label: 'Xe tăng chủ lực',
    lane: 'mobilize',
    seconds: 70,
    cost: [210, 200, 90, 40, 50, 95, 420],
  },
  artillery: {
    key: 'artillery',
    label: 'Pháo binh dã chiến',
    lane: 'mobilize',
    seconds: 60,
    cost: [190, 140, 30, 50, 30, 75, 330],
  },
};

export interface CampaignUnitCombatSpec {
  readonly key: CampaignUnitKey;
  readonly armorClass: 'SOFT' | 'HARD';
  readonly maxHp: number;
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly defense: number;
  readonly moveSeconds: number;
  readonly canConquer: boolean;
  readonly ranged: boolean;
  readonly upkeepSupplies: number;
  readonly upkeepFuel: number;
  readonly upkeepMoney: number;
  readonly requiredDoctrine: CampaignDoctrineKey | null;
  readonly requiredOffice: number;
  readonly requiredBase: number;
}

export const CAMPAIGN_UNIT_STATS: Readonly<Record<CampaignUnitKey, CampaignUnitCombatSpec>> = {
  reserve: {
    key: 'reserve',
    armorClass: 'SOFT',
    maxHp: 15,
    softAttack: 3,
    hardAttack: 1,
    defense: 4,
    moveSeconds: 45,
    canConquer: true,
    ranged: false,
    upkeepSupplies: 1,
    upkeepFuel: 0,
    upkeepMoney: 2,
    requiredDoctrine: null,
    requiredOffice: 1,
    requiredBase: 0,
  },
  motor: {
    key: 'motor',
    armorClass: 'SOFT',
    maxHp: 20,
    softAttack: 6,
    hardAttack: 3,
    defense: 6,
    moveSeconds: 32,
    canConquer: true,
    ranged: false,
    upkeepSupplies: 1,
    upkeepFuel: 0,
    upkeepMoney: 3,
    requiredDoctrine: 'motor',
    requiredOffice: 1,
    requiredBase: 0,
  },
  recon: {
    key: 'recon',
    armorClass: 'HARD',
    maxHp: 22,
    softAttack: 5,
    hardAttack: 4,
    defense: 5,
    moveSeconds: 22,
    canConquer: false,
    ranged: false,
    upkeepSupplies: 1,
    upkeepFuel: 1,
    upkeepMoney: 4,
    requiredDoctrine: 'recon',
    requiredOffice: 1,
    requiredBase: 1,
  },
  tank: {
    key: 'tank',
    armorClass: 'HARD',
    maxHp: 42,
    softAttack: 9,
    hardAttack: 12,
    defense: 11,
    moveSeconds: 36,
    canConquer: false,
    ranged: false,
    upkeepSupplies: 2,
    upkeepFuel: 2,
    upkeepMoney: 7,
    requiredDoctrine: 'tank',
    requiredOffice: 1,
    requiredBase: 2,
  },
  artillery: {
    key: 'artillery',
    armorClass: 'SOFT',
    maxHp: 16,
    softAttack: 7,
    hardAttack: 5,
    defense: 3,
    moveSeconds: 42,
    canConquer: false,
    ranged: true,
    upkeepSupplies: 2,
    upkeepFuel: 0,
    upkeepMoney: 5,
    requiredDoctrine: 'artillery',
    requiredOffice: 1,
    requiredBase: 1,
  },
};

export const CAMPAIGN_MOVE_DURATION_SECONDS = {
  reserve: 45,
  motorBase: 32,
  motorUpgraded: 24,
  recon: 22,
  tank: 36,
  artillery: 42,
} as const;

const CAMPAIGN_SPINE_CITY_NAMES: readonly string[] = [
  'Hà Nội',
  'Thanh Hóa',
  'Vinh',
  'Đồng Hới',
  'Huế',
  'Đà Nẵng',
  'Kon Tum',
  'Pleiku',
  'Buôn Ma Thuột',
  'Đà Lạt',
  'TP. Hồ Chí Minh',
  'Cần Thơ',
];

const MAX_LOG_ENTRIES = 200;
const MAX_NEWS_ENTRIES = 120;
const MAX_BATTLE_REPORTS = 100;

export interface CampaignPendingEventDraft {
  readonly occurredAtUtc: UtcEpochMs;
  readonly tieBreakPriority: number;
  readonly tieBreakKey: string;
  readonly payload: DomainEventPayload;
}

export type CampaignRejectionCode =
  | 'FORBIDDEN_ACTION'
  | 'INSUFFICIENT_RESOURCES'
  | 'INVALID_TARGET'
  | 'DUPLICATE_ENTITY'
  | 'VERSION_CONFLICT';

export type CampaignMutationResult =
  | {
      readonly ok: true;
      readonly campaignState: CampaignMatchState;
      readonly units: Record<string, Unit>;
      readonly regions: Record<string, Region>;
      readonly drafts: readonly CampaignPendingEventDraft[];
    }
  | {
      readonly ok: false;
      readonly code: CampaignRejectionCode;
      readonly reason: string;
    };

type MutableCampaignState = {
  startUtc: UtcEpochMs;
  timeUtc: UtcEpochMs;
  nextUnitNumber: number;
  nextReportNumber: number;
  victoryTargetVp: number;
  victoryPointsByNation: Record<string, number>;
  diplomacy: CampaignDiplomacyState;
  victory: CampaignMatchState['victory'];
  nations: Record<string, CampaignNationState>;
  cities: Record<string, CampaignCityState>;
  units: Record<string, CampaignUnitState>;
  log: CampaignLogEntry[];
  news: CampaignNewsItem[];
  battleReports: CampaignBattleReport[];
};

function cloneCampaignState(state: CampaignMatchState): MutableCampaignState {
  const nations: Record<string, CampaignNationState> = {};
  for (const [id, n] of Object.entries(state.nations)) {
    nations[id] = {
      nationId: n.nationId,
      balance: [...n.balance] as CampaignResourceTuple,
      learned: [...n.learned],
      study: n.study ? { ...n.study } : null,
      stats: {
        unitsMobilized: n.stats?.unitsMobilized ?? 0,
        unitsLost: n.stats?.unitsLost ?? 0,
        enemyUnitsDestroyed: n.stats?.enemyUnitsDestroyed ?? 0,
        citiesCaptured: n.stats?.citiesCaptured ?? 0,
      },
    };
  }
  const cities: Record<string, CampaignCityState> = {};
  for (const [id, c] of Object.entries(state.cities)) {
    cities[id] = {
      ...c,
      base: c.base ?? 0,
      bunker: c.bunker ?? 0,
      hospital: c.hospital ?? 0,
      jobs: c.jobs.map((j) => ({
        ...j,
        cost: [...j.cost] as CampaignResourceTuple,
      })),
    };
  }
  const units: Record<string, CampaignUnitState> = {};
  for (const [id, u] of Object.entries(state.units)) {
    const spec = CAMPAIGN_UNIT_STATS[u.key];
    units[id] = {
      ...u,
      hp: u.hp ?? spec.maxHp,
      maxHp: u.maxHp ?? spec.maxHp,
      inCombat: u.inCombat ?? false,
      lastCombatUtc: u.lastCombatUtc ?? null,
      lastHealUtc: u.lastHealUtc ?? null,
      position: { ...u.position },
      trip: u.trip
        ? {
            ...u.trip,
            points: u.trip.points.map((pt) => ({ ...pt })),
          }
        : null,
    };
  }
  return {
    startUtc: state.startUtc,
    timeUtc: state.timeUtc,
    nextUnitNumber: state.nextUnitNumber,
    nextReportNumber: state.nextReportNumber ?? 1,
    victoryTargetVp: state.victoryTargetVp ?? 400,
    victoryPointsByNation: { ...(state.victoryPointsByNation ?? {}) },
    diplomacy: state.diplomacy
      ? { ...state.diplomacy }
      : {
          relation: 'PEACE',
          peaceProposedByNationId: null,
          intelProposedByNationId: null,
          sharedIntelActive: false,
          updatedAtUtc: state.startUtc,
        },
    victory: state.victory
      ? { ...state.victory, scoresByNation: { ...state.victory.scoresByNation } }
      : null,
    nations,
    cities,
    units,
    log: state.log.map((entry) => ({ ...entry })),
    news: (state.news ?? []).map((n) => ({ ...n })),
    battleReports: (state.battleReports ?? []).map((r) => ({
      ...r,
      attackerUnitIds: [...r.attackerUnitIds],
      defenderUnitIds: [...r.defenderUnitIds],
      destroyedUnitIds: [...r.destroyedUnitIds],
    })),
  };
}

function nationLabelVi(nationId: string): string {
  if (nationId.includes('north')) return 'Phương Bắc';
  if (nationId.includes('south')) return 'Phương Nam';
  return nationId;
}

function nationSlotOf(
  nationId: NationId,
  nationsMeta?: Readonly<Record<string, Nation>>
): HumanSlot {
  const slot = nationsMeta?.[nationId]?.slot;
  if (slot === 'NORTH' || slot === 'SOUTH') return slot;
  return nationId.includes('north') ? 'NORTH' : 'SOUTH';
}

export function computeCampaignVictoryPoints(
  cities: Readonly<Record<string, CampaignCityState>>,
  nationIds: readonly string[]
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const id of nationIds) {
    scores[id] = 0;
  }
  for (const city of Object.values(cities)) {
    const pts = city.capital ? 30 : 10;
    scores[city.ownerNationId] = (scores[city.ownerNationId] ?? 0) + pts;
  }
  return scores;
}

export function computeCampaignCityOutput(city: CampaignCityState): CampaignResourceTuple {
  const output: [number, number, number, number, number, number, number] = [
    0,
    0,
    0,
    0,
    0,
    2 + city.office * 2,
    8,
  ];
  output[city.material] = 10 + 5 * city.factory;
  return output;
}

export function computeCampaignNationLedger(
  state: CampaignMatchState,
  nationId: NationId
): {
  readonly income: CampaignResourceTuple;
  readonly expense: CampaignResourceTuple;
  readonly net: readonly [number, number, number, number, number, number, number];
} {
  const income: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];
  const expense: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];

  for (const city of Object.values(state.cities)) {
    if (city.ownerNationId !== nationId) continue;
    const out = computeCampaignCityOutput(city);
    for (let i = 0; i < 7; i += 1) {
      income[i] += out[i];
    }
  }

  for (const unit of Object.values(state.units)) {
    if (unit.ownerNationId !== nationId) continue;
    const spec = CAMPAIGN_UNIT_STATS[unit.key];
    expense[0] += spec.upkeepSupplies;
    expense[2] += spec.upkeepFuel;
    expense[6] += spec.upkeepMoney;
  }

  const net: [number, number, number, number, number, number, number] = [
    income[0] - expense[0],
    income[1] - expense[1],
    income[2] - expense[2],
    income[3] - expense[3],
    income[4] - expense[4],
    income[5] - expense[5],
    income[6] - expense[6],
  ];

  return { income, expense, net };
}

function getBuildingLevel(city: CampaignCityState, key: CampaignProjectKey): number {
  switch (key) {
    case 'factory':
      return city.factory;
    case 'office':
      return city.office;
    case 'base':
      return city.base ?? 0;
    case 'bunker':
      return city.bunker ?? 0;
    case 'hospital':
      return city.hospital ?? 0;
    default:
      return 0;
  }
}

export function computeCampaignProjectTerms(
  city: CampaignCityState,
  projectKey: CampaignProjectKey
): {
  readonly level: number;
  readonly cost: CampaignResourceTuple;
  readonly durationSeconds: number;
} {
  const spec = CAMPAIGN_PROJECT_CATALOG[projectKey];
  const level = spec.lane === 'build' ? getBuildingLevel(city, projectKey) + 1 : 1;
  const cost = spec.cost.map((v) => v * level) as unknown as CampaignResourceTuple;
  return {
    level,
    cost,
    durationSeconds: spec.seconds * level,
  };
}

export function buildCampaignPath(
  cities: Readonly<Record<string, CampaignCityState>>,
  from: CampaignGeoPoint,
  destCity: CampaignCityState
): CampaignGeoPoint[] {
  const byName = new Map<string, CampaignCityState>();
  for (const city of Object.values(cities)) {
    byName.set(city.name, city);
  }
  const dest: CampaignGeoPoint = { lon: destCity.lon, lat: destCity.lat };
  const south = from.lat > dest.lat;
  const minLat = Math.min(from.lat, dest.lat) + 0.22;
  const maxLat = Math.max(from.lat, dest.lat) - 0.22;

  const middle: CampaignGeoPoint[] = [];
  for (const name of CAMPAIGN_SPINE_CITY_NAMES) {
    const c = byName.get(name);
    if (c && c.lat > minLat && c.lat < maxLat) {
      middle.push({ lon: c.lon, lat: c.lat });
    }
  }
  middle.sort((a, b) => (south ? b.lat - a.lat : a.lat - b.lat));
  return [{ lon: from.lon, lat: from.lat }, ...middle, dest];
}

function appendCampaignLog(
  log: CampaignLogEntry[],
  timeUtc: UtcEpochMs,
  nationId: NationId | null,
  cityId: RegionId | null,
  cityName: string,
  text: string
): void {
  log.unshift({ timeUtc, nationId, cityId, cityName, text });
  if (log.length > MAX_LOG_ENTRIES) {
    log.length = MAX_LOG_ENTRIES;
  }
}

function appendCampaignNews(
  cs: MutableCampaignState,
  timeUtc: UtcEpochMs,
  category: CampaignNewsItem['category'],
  headline: string,
  detail: string
): void {
  const newsId = `news_${String(cs.nextReportNumber).padStart(4, '0')}`;
  cs.nextReportNumber += 1;
  cs.news.unshift({ newsId, timeUtc, category, headline, detail });
  if (cs.news.length > MAX_NEWS_ENTRIES) {
    cs.news.length = MAX_NEWS_ENTRIES;
  }
}

function accrueCampaignInPlace(state: MutableCampaignState, toUtc: UtcEpochMs): void {
  const delta = (toUtc as number) - (state.timeUtc as number);
  if (delta <= 0) return;

  const sortedNationIds = Object.keys(state.nations).sort();
  for (const nationId of sortedNationIds) {
    const nation = state.nations[nationId];
    const { net } = computeCampaignNationLedger(state, nation.nationId);
    const nextBalance = nation.balance.map((val, idx) =>
      Math.max(0, val + delta * net[idx])
    ) as unknown as CampaignResourceTuple;
    nation.balance = nextBalance;
  }
  state.timeUtc = toUtc;
}

function makeStableUnitId(displayNumber: number): UnitId {
  return UnitIdSchema.parse(`unt_vn_${String(displayNumber).padStart(4, '0')}`);
}

function mirrorUnitRecord(
  units: Record<string, Unit>,
  campaignUnit: CampaignUnitState,
  fallbackRegionId: RegionId
): void {
  const existing = units[campaignUnit.unitId];
  units[campaignUnit.unitId] = {
    unitId: campaignUnit.unitId,
    ownerNationId: campaignUnit.ownerNationId,
    regionId: campaignUnit.cityId ?? existing?.regionId ?? fallbackRegionId,
    category: 'INFANTRY_ABSTRACT',
    strengthFp: asFixedPoint(Math.max(0, Math.round((campaignUnit.hp * 100_000) / campaignUnit.maxHp))),
    readinessFp: asFixedPoint(100_000),
    supplyFp: asFixedPoint(100_000),
  };
}

function distSqDeg(a: CampaignGeoPoint, b: CampaignGeoPoint): number {
  const dx = a.lon - b.lon;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

function isTargetObservedByNation(
  cs: MutableCampaignState,
  observerNationId: NationId,
  targetPoint: CampaignGeoPoint,
  atUtc: number
): boolean {
  if (cs.diplomacy.sharedIntelActive) return true;
  const cityRadiusSq = CAMPAIGN_OBSERVATION_RADIUS_DEG * CAMPAIGN_OBSERVATION_RADIUS_DEG;
  for (const city of Object.values(cs.cities)) {
    if (city.ownerNationId !== observerNationId) continue;
    if (distSqDeg(city, targetPoint) <= cityRadiusSq) return true;
  }
  for (const u of Object.values(cs.units)) {
    if (u.ownerNationId !== observerNationId) continue;
    const r = getCampaignUnitVisionRadiusDeg(u.key);
    const pos = interpolateCampaignUnitPosition(u, atUtc);
    if (distSqDeg(pos, targetPoint) <= r * r) return true;
  }
  return false;
}

function nearestCityName(cs: MutableCampaignState, pt: CampaignGeoPoint): string {
  let bestName = 'Chiến tuyến';
  let bestD = Infinity;
  for (const c of Object.values(cs.cities)) {
    const d = distSqDeg(c, pt);
    if (d < bestD) {
      bestD = d;
      bestName = c.name;
    }
  }
  return bestName;
}

function computeUnitAttackDamage(
  cs: MutableCampaignState,
  attacker: CampaignUnitState,
  defender: CampaignUnitState,
  isCounterDefense: boolean
): number {
  const atkSpec = CAMPAIGN_UNIT_STATS[attacker.key];
  const defSpec = CAMPAIGN_UNIT_STATS[defender.key];
  const atkNation = cs.nations[attacker.ownerNationId];
  const motor2Boost =
    attacker.key === 'motor' && atkNation?.learned.includes('motor2') ? 120 : 100;

  let baseStat = isCounterDefense
    ? atkSpec.defense
    : defSpec.armorClass === 'HARD'
      ? atkSpec.hardAttack
      : atkSpec.softAttack;
  baseStat = Math.floor((baseStat * motor2Boost) / 100);

  const hpPct = Math.max(25, Math.floor((attacker.hp * 100) / attacker.maxHp));

  let entrenchmentPct = 0;
  if (defender.cityId) {
    const city = cs.cities[defender.cityId];
    if (city && city.ownerNationId === defender.ownerNationId) {
      entrenchmentPct = Math.min(60, (city.base ?? 0) * 10 + (city.bunker ?? 0) * 15);
    }
  }

  return Math.max(1, Math.floor((baseStat * hpPct * (100 - entrenchmentPct)) / 10_000));
}

function findNextDueCombatOrHealUtc(
  cs: MutableCampaignState,
  targetUtc: number
): number | null {
  let earliest: number | null = null;
  const consider = (ts: number): void => {
    if (ts <= targetUtc && (earliest === null || ts < earliest)) {
      earliest = ts;
    }
  };

  const atUtc = cs.timeUtc as number;
  const allUnits = Object.values(cs.units);

  if (cs.diplomacy.relation === 'WAR' && allUnits.length >= 2) {
    const meleeSq = CAMPAIGN_MELEE_RANGE_DEG * CAMPAIGN_MELEE_RANGE_DEG;
    const rangedSq = CAMPAIGN_RANGED_RANGE_DEG * CAMPAIGN_RANGED_RANGE_DEG;
    const posMap = new Map<string, CampaignGeoPoint>();
    for (const u of allUnits) {
      posMap.set(u.unitId, interpolateCampaignUnitPosition(u, atUtc));
    }

    for (const u of allUnits) {
      const uPos = posMap.get(u.unitId)!;
      const spec = CAMPAIGN_UNIT_STATS[u.key];
      let hasHostileMelee = false;
      let hasHostileRanged = false;

      for (const other of allUnits) {
        if (other.ownerNationId === u.ownerNationId) continue;
        const dSq = distSqDeg(uPos, posMap.get(other.unitId)!);
        if (dSq <= meleeSq) {
          hasHostileMelee = true;
          break;
        }
        if (spec.ranged && !u.trip && dSq <= rangedSq) {
          if (isTargetObservedByNation(cs, u.ownerNationId, posMap.get(other.unitId)!, atUtc)) {
            hasHostileRanged = true;
          }
        }
      }

      if (hasHostileMelee || hasHostileRanged) {
        const nextReady =
          u.lastCombatUtc === null ? atUtc : (u.lastCombatUtc as number) + CAMPAIGN_COMBAT_TICK_MS;
        consider(Math.max(atUtc, nextReady));
      }
    }
  }

  for (const u of allUnits) {
    if (u.trip || u.inCombat || u.hp >= u.maxHp || !u.cityId) continue;
    const city = cs.cities[u.cityId];
    if (!city || city.ownerNationId !== u.ownerNationId || (city.hospital ?? 0) < 1) continue;
    const baseUtc = (u.lastHealUtc ?? cs.timeUtc) as number;
    consider(baseUtc + CAMPAIGN_HEAL_TICK_MS);
  }

  return earliest;
}

/**
 * Exposes earliest overdue campaign deadline (including active combat & hospital healing ticks)
 * for MatchClockScheduler.
 */
export function getEarliestCampaignDeadlineUtc(
  state: CampaignMatchState,
  nowUtc: number
): number | null {
  if (state.victory) return null;
  let earliest: number | null = null;
  const consider = (ts: number): void => {
    if (ts <= nowUtc && (earliest === null || ts < earliest)) {
      earliest = ts;
    }
  };

  for (const nation of Object.values(state.nations)) {
    if (nation.study) consider(nation.study.endUtc as number);
  }
  for (const city of Object.values(state.cities)) {
    for (const job of city.jobs) consider(job.endUtc as number);
  }
  for (const u of Object.values(state.units)) {
    if (u.trip) consider(u.trip.endUtc as number);
  }

  const csClone = cloneCampaignState(state);
  const combatOrHeal = findNextDueCombatOrHealUtc(csClone, nowUtc);
  if (combatOrHeal !== null) {
    consider(combatOrHeal);
  }
  return earliest;
}

function resolveCombatAtStep(
  cs: MutableCampaignState,
  unitsRecord: Record<string, Unit>,
  stepUtc: UtcEpochMs,
  drafts: CampaignPendingEventDraft[]
): void {
  if (cs.diplomacy.relation !== 'WAR') {
    for (const u of Object.values(cs.units)) {
      u.inCombat = false;
    }
    return;
  }

  const nowNum = stepUtc as number;
  const meleeSq = CAMPAIGN_MELEE_RANGE_DEG * CAMPAIGN_MELEE_RANGE_DEG;
  const rangedSq = CAMPAIGN_RANGED_RANGE_DEG * CAMPAIGN_RANGED_RANGE_DEG;

  const sortedUnits = Object.values(cs.units).sort((a, b) =>
    a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0
  );
  const posById = new Map<string, CampaignGeoPoint>();
  for (const u of sortedUnits) {
    posById.set(u.unitId, interpolateCampaignUnitPosition(u, nowNum));
  }

  // 1. Identify melee pairs and halt moving units that enter melee contact
  const meleeEnemies = new Map<string, CampaignUnitState[]>();
  for (const u of sortedUnits) {
    meleeEnemies.set(u.unitId, []);
  }
  for (let i = 0; i < sortedUnits.length; i += 1) {
    const a = sortedUnits[i];
    const posA = posById.get(a.unitId)!;
    for (let j = i + 1; j < sortedUnits.length; j += 1) {
      const b = sortedUnits[j];
      if (a.ownerNationId === b.ownerNationId) continue;
      const posB = posById.get(b.unitId)!;
      if (distSqDeg(posA, posB) <= meleeSq) {
        meleeEnemies.get(a.unitId)!.push(b);
        meleeEnemies.get(b.unitId)!.push(a);
      }
    }
  }

  for (const u of sortedUnits) {
    const enemies = meleeEnemies.get(u.unitId)!;
    if (enemies.length > 0) {
      u.inCombat = true;
      if (u.trip) {
        u.position = posById.get(u.unitId)!;
        u.trip = null;
        u.cityId = null;
        u.cityName = null;
        u.rev += 1;
      }
    } else {
      u.inCombat = false;
    }
  }

  // 2. Resolve ready melee engagements simultaneously
  const readyMelee = sortedUnits.filter(
    (u) =>
      meleeEnemies.get(u.unitId)!.length > 0 &&
      (u.lastCombatUtc === null || (u.lastCombatUtc as number) + CAMPAIGN_COMBAT_TICK_MS <= nowNum)
  );

  if (readyMelee.length > 0) {
    const damageToUnit = new Map<string, number>();
    const killerNationByVictim = new Map<string, NationId>();

    for (const attacker of readyMelee) {
      const enemies = [...meleeEnemies.get(attacker.unitId)!].sort(
        (a, b) => a.hp - b.hp || (a.unitId < b.unitId ? -1 : 1)
      );
      const target = enemies[0];
      if (!target) continue;
      const defendingOwnCity = Boolean(
        attacker.cityId && cs.cities[attacker.cityId]?.ownerNationId === attacker.ownerNationId
      );
      const dmg = computeUnitAttackDamage(cs, attacker, target, defendingOwnCity);
      damageToUnit.set(target.unitId, (damageToUnit.get(target.unitId) ?? 0) + dmg);
      killerNationByVictim.set(target.unitId, attacker.ownerNationId);
      attacker.lastCombatUtc = stepUtc;
    }

    const participantNations = Array.from(
      new Set([
        ...readyMelee.map((u) => u.ownerNationId),
        ...Array.from(damageToUnit.keys())
          .map((id) => cs.units[id]?.ownerNationId)
          .filter((n): n is NationId => Boolean(n)),
      ])
    ).sort();
    const primaryAtkNation = participantNations[0];
    const primaryDefNation = participantNations[1] ?? participantNations[0];
    let dmgToDef = 0;
    let dmgToAtk = 0;
    const destroyedUnitIds: UnitId[] = [];
    const attackerUnitIds: UnitId[] = [];
    const defenderUnitIds: UnitId[] = [];

    for (const u of sortedUnits) {
      if (meleeEnemies.get(u.unitId)!.length > 0) {
        if (u.ownerNationId === primaryAtkNation) attackerUnitIds.push(u.unitId);
        else defenderUnitIds.push(u.unitId);
      }
    }

    const locationName = nearestCityName(cs, posById.get(readyMelee[0].unitId)!);

    for (const [victimId, dmg] of damageToUnit.entries()) {
      const victim = cs.units[victimId];
      if (!victim) continue;
      if (victim.ownerNationId === primaryDefNation) dmgToDef += dmg;
      else dmgToAtk += dmg;
      victim.hp = Math.max(0, victim.hp - dmg);
      victim.lastHealUtc = stepUtc;
      if (victim.hp <= 0) {
        destroyedUnitIds.push(victim.unitId);
        if (victim.cityId && victim.key === 'reserve') {
          const c = cs.cities[victim.cityId];
          if (c && c.reserve > 0) c.reserve -= 1;
        }
        const victimNation = cs.nations[victim.ownerNationId];
        if (victimNation) victimNation.stats.unitsLost += 1;
        const killerNationId = killerNationByVictim.get(victimId);
        if (killerNationId && cs.nations[killerNationId]) {
          cs.nations[killerNationId].stats.enemyUnitsDestroyed += 1;
        }
        delete cs.units[victimId];
        delete unitsRecord[victimId];
      } else {
        mirrorUnitRecord(
          unitsRecord,
          victim,
          victim.cityId ?? Object.values(cs.cities)[0].cityId
        );
      }
    }

    destroyedUnitIds.sort();
    const reportId = `bat_${String(cs.nextReportNumber).padStart(4, '0')}`;
    cs.nextReportNumber += 1;
    const summary =
      `Giao tranh cận chiến tại ${locationName}: ` +
      `${nationLabelVi(primaryAtkNation)} gây ${dmgToDef} ST, ` +
      `${nationLabelVi(primaryDefNation)} gây ${dmgToAtk} ST` +
      (destroyedUnitIds.length ? ` · Tiêu diệt ${destroyedUnitIds.length} đơn vị.` : '.');

    cs.battleReports.unshift({
      reportId,
      occurredAtUtc: stepUtc,
      kind: 'MELEE',
      locationName,
      attackerNationId: primaryAtkNation,
      defenderNationId: primaryDefNation,
      attackerUnitIds,
      defenderUnitIds,
      damageToDefenders: dmgToDef,
      damageToAttackers: dmgToAtk,
      destroyedUnitIds,
      summary,
    });
    if (cs.battleReports.length > MAX_BATTLE_REPORTS) {
      cs.battleReports.length = MAX_BATTLE_REPORTS;
    }

    if (destroyedUnitIds.length > 0) {
      appendCampaignNews(
        cs,
        stepUtc,
        'COMBAT',
        `Giao tranh ác liệt tại ${locationName}`,
        summary
      );
    }

    drafts.push({
      occurredAtUtc: stepUtc,
      tieBreakPriority: 14,
      tieBreakKey: reportId,
      payload: {
        type: 'CAMPAIGN_COMBAT_RESOLVED',
        reportId,
        kind: 'MELEE',
        locationName,
        attackerNationId: primaryAtkNation,
        defenderNationId: primaryDefNation,
        damageToDefenders: dmgToDef,
        damageToAttackers: dmgToAtk,
        destroyedUnitIds,
      },
    });

    // Recompute inCombat flags for surviving units
    const survivors = Object.values(cs.units);
    for (const u of survivors) {
      const posU = interpolateCampaignUnitPosition(u, nowNum);
      u.inCombat = survivors.some(
        (o) =>
          o.ownerNationId !== u.ownerNationId &&
          distSqDeg(posU, interpolateCampaignUnitPosition(o, nowNum)) <= meleeSq
      );
    }
  }

  // 3. Resolve ready ranged artillery bombardments (no melee counter-damage!)
  const livingSorted = Object.values(cs.units).sort((a, b) =>
    a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0
  );
  for (const arty of livingSorted) {
    if (!cs.units[arty.unitId]) continue;
    const spec = CAMPAIGN_UNIT_STATS[arty.key];
    if (!spec.ranged || arty.trip || arty.inCombat) continue;
    if (
      arty.lastCombatUtc !== null &&
      (arty.lastCombatUtc as number) + CAMPAIGN_COMBAT_TICK_MS > nowNum
    ) {
      continue;
    }

    const artyPos = interpolateCampaignUnitPosition(arty, nowNum);
    const candidates = Object.values(cs.units)
      .filter((other) => {
        if (other.ownerNationId === arty.ownerNationId) return false;
        const otherPos = interpolateCampaignUnitPosition(other, nowNum);
        const dSq = distSqDeg(artyPos, otherPos);
        if (dSq > rangedSq) return false;
        return isTargetObservedByNation(cs, arty.ownerNationId, otherPos, nowNum);
      })
      .map((other) => ({
        unit: other,
        dSq: distSqDeg(artyPos, interpolateCampaignUnitPosition(other, nowNum)),
      }))
      .sort((a, b) => a.dSq - b.dSq || (a.unit.unitId < b.unit.unitId ? -1 : 1));

    const chosen = candidates[0]?.unit;
    if (!chosen) continue;

    const dmg = computeUnitAttackDamage(cs, arty, chosen, false);
    arty.lastCombatUtc = stepUtc;
    chosen.hp = Math.max(0, chosen.hp - dmg);
    chosen.lastHealUtc = stepUtc;
    const targetPos = interpolateCampaignUnitPosition(chosen, nowNum);
    const locationName = chosen.cityName ?? nearestCityName(cs, targetPos);
    const destroyedUnitIds: UnitId[] = [];

    if (chosen.hp <= 0) {
      destroyedUnitIds.push(chosen.unitId);
      if (chosen.cityId && chosen.key === 'reserve') {
        const c = cs.cities[chosen.cityId];
        if (c && c.reserve > 0) c.reserve -= 1;
      }
      cs.nations[chosen.ownerNationId].stats.unitsLost += 1;
      cs.nations[arty.ownerNationId].stats.enemyUnitsDestroyed += 1;
      delete cs.units[chosen.unitId];
      delete unitsRecord[chosen.unitId];
    } else {
      mirrorUnitRecord(
        unitsRecord,
        chosen,
        chosen.cityId ?? Object.values(cs.cities)[0].cityId
      );
    }

    const reportId = `bat_${String(cs.nextReportNumber).padStart(4, '0')}`;
    cs.nextReportNumber += 1;
    const summary =
      `Pháo kích từ ${nationLabelVi(arty.ownerNationId)} (#${arty.displayNumber}) vào ${locationName} gây ${dmg} ST` +
      (destroyedUnitIds.length ? ` · Tiêu diệt đơn vị #${chosen.displayNumber}.` : '.');

    cs.battleReports.unshift({
      reportId,
      occurredAtUtc: stepUtc,
      kind: 'BOMBARDMENT',
      locationName,
      attackerNationId: arty.ownerNationId,
      defenderNationId: chosen.ownerNationId,
      attackerUnitIds: [arty.unitId],
      defenderUnitIds: [chosen.unitId],
      damageToDefenders: dmg,
      damageToAttackers: 0,
      destroyedUnitIds,
      summary,
    });
    if (cs.battleReports.length > MAX_BATTLE_REPORTS) {
      cs.battleReports.length = MAX_BATTLE_REPORTS;
    }

    if (destroyedUnitIds.length > 0) {
      appendCampaignNews(cs, stepUtc, 'COMBAT', `Pháo kích tại ${locationName}`, summary);
    }

    drafts.push({
      occurredAtUtc: stepUtc,
      tieBreakPriority: 15,
      tieBreakKey: reportId,
      payload: {
        type: 'CAMPAIGN_COMBAT_RESOLVED',
        reportId,
        kind: 'BOMBARDMENT',
        locationName,
        attackerNationId: arty.ownerNationId,
        defenderNationId: chosen.ownerNationId,
        damageToDefenders: dmg,
        damageToAttackers: 0,
        destroyedUnitIds,
      },
    });
  }
}

function resolveConquestAndVictoryAtStep(
  cs: MutableCampaignState,
  unitsRecord: Record<string, Unit>,
  regionsRecord: Record<string, Region>,
  nationsMeta: Readonly<Record<string, Nation>> | undefined,
  stepUtc: UtcEpochMs,
  drafts: CampaignPendingEventDraft[]
): void {
  if (cs.diplomacy.relation !== 'WAR' || cs.victory) return;

  const meleeSq = CAMPAIGN_MELEE_RANGE_DEG * CAMPAIGN_MELEE_RANGE_DEG;
  const nowNum = stepUtc as number;
  const sortedCities = Object.values(cs.cities).sort((a, b) =>
    a.cityId < b.cityId ? -1 : a.cityId > b.cityId ? 1 : 0
  );

  for (const city of sortedCities) {
    const attackers = Object.values(cs.units)
      .filter((u) => {
        if (u.ownerNationId === city.ownerNationId || u.trip !== null) return false;
        if (!CAMPAIGN_UNIT_STATS[u.key].canConquer) return false;
        const pos = interpolateCampaignUnitPosition(u, nowNum);
        return distSqDeg(pos, city) <= meleeSq;
      })
      .sort((a, b) => (a.unitId < b.unitId ? -1 : 1));

    if (attackers.length === 0) continue;

    const hasDefender = Object.values(cs.units).some((u) => {
      if (u.ownerNationId !== city.ownerNationId) return false;
      const pos = interpolateCampaignUnitPosition(u, nowNum);
      return distSqDeg(pos, city) <= meleeSq;
    });
    if (hasDefender) continue;

    const lead = attackers[0];
    const previousOwner = city.ownerNationId;
    const newOwner = lead.ownerNationId;

    city.ownerNationId = newOwner;
    city.jobs = []; // Destroy/cancel defeated owner's in-progress city queues
    city.bunker = Math.max(0, (city.bunker ?? 0) - 1);
    city.reserve = 0;

    if (regionsRecord[city.cityId]) {
      regionsRecord[city.cityId] = {
        ...regionsRecord[city.cityId],
        controllerNationId: newOwner,
      };
    }

    // Station all friendly idle units at the newly captured city
    for (const u of Object.values(cs.units)) {
      if (u.ownerNationId !== newOwner || u.trip !== null) continue;
      if (distSqDeg(u.position, city) <= meleeSq) {
        u.position = { lon: city.lon, lat: city.lat };
        u.cityId = city.cityId;
        u.cityName = city.name;
        u.inCombat = false;
        if (u.key === 'reserve') city.reserve += 1;
        mirrorUnitRecord(unitsRecord, u, city.cityId);
      }
    }

    if (cs.nations[newOwner]) {
      cs.nations[newOwner].stats.citiesCaptured += 1;
    }

    cs.victoryPointsByNation = computeCampaignVictoryPoints(cs.cities, Object.keys(cs.nations));
    const newOwnerVp = cs.victoryPointsByNation[newOwner] ?? 0;

    appendCampaignLog(
      cs.log,
      stepUtc,
      newOwner,
      city.cityId,
      city.name,
      `Đã chiếm đóng thành phố ${city.name} (${newOwnerVp}/${cs.victoryTargetVp} điểm).`
    );
    appendCampaignLog(
      cs.log,
      stepUtc,
      previousOwner,
      city.cityId,
      city.name,
      `Mất quyền kiểm soát thành phố ${city.name} vào tay ${nationLabelVi(newOwner)}.`
    );
    appendCampaignNews(
      cs,
      stepUtc,
      'CONQUEST',
      `${nationLabelVi(newOwner)} chiếm đóng ${city.name}`,
      `${CAMPAIGN_PROJECT_CATALOG[lead.key].label} #${lead.displayNumber} đã kiểm soát ${city.name}. Điểm chiến thắng: ${nationLabelVi(newOwner)} ${newOwnerVp} điểm.`
    );

    drafts.push({
      occurredAtUtc: stepUtc,
      tieBreakPriority: 16,
      tieBreakKey: `${city.cityId}:${newOwner}`,
      payload: {
        type: 'CAMPAIGN_CITY_CAPTURED',
        cityId: city.cityId,
        cityName: city.name,
        previousOwnerNationId: previousOwner,
        newOwnerNationId: newOwner,
        capturedByUnitId: lead.unitId,
        newOwnerVp,
      },
    });
  }

  // Victory check
  const nationIds = Object.keys(cs.nations).sort();
  cs.victoryPointsByNation = computeCampaignVictoryPoints(cs.cities, nationIds);

  for (const nationId of nationIds) {
    const vp = cs.victoryPointsByNation[nationId] ?? 0;
    const otherNations = nationIds.filter((id) => id !== nationId);
    const opponentHasAnyCity = otherNations.some((otherId) =>
      Object.values(cs.cities).some((c) => c.ownerNationId === otherId)
    );

    let winReason: 'VICTORY_POINTS' | 'TOTAL_CONQUEST' | null = null;
    if (!opponentHasAnyCity && otherNations.length > 0) {
      winReason = 'TOTAL_CONQUEST';
    } else if (vp >= cs.victoryTargetVp) {
      winReason = 'VICTORY_POINTS';
    }

    if (winReason) {
      const winnerNationId = nationId as NationId;
      const winnerSlot = nationSlotOf(winnerNationId, nationsMeta);
      cs.victory = {
        winnerNationId,
        winnerSlot,
        reason: winReason,
        achievedAtUtc: stepUtc,
        targetVp: cs.victoryTargetVp,
        scoresByNation: { ...cs.victoryPointsByNation },
      };
      appendCampaignNews(
        cs,
        stepUtc,
        'VICTORY',
        `${nationLabelVi(winnerNationId)} giành chiến thắng chiến dịch!`,
        winReason === 'TOTAL_CONQUEST'
          ? `${nationLabelVi(winnerNationId)} đã kiểm soát toàn bộ 60 thành phố.`
          : `${nationLabelVi(winnerNationId)} đạt ${vp}/${cs.victoryTargetVp} điểm chiến thắng.`
      );
      drafts.push({
        occurredAtUtc: stepUtc,
        tieBreakPriority: 18,
        tieBreakKey: winnerNationId,
        payload: {
          type: 'CAMPAIGN_MATCH_ENDED',
          winnerNationId,
          winnerSlot,
          reason: winReason,
          winnerVp: vp,
        },
      });
      break;
    }
  }
}

function resolveHospitalHealingAtStep(
  cs: MutableCampaignState,
  unitsRecord: Record<string, Unit>,
  stepUtc: UtcEpochMs
): void {
  const nowNum = stepUtc as number;
  for (const unit of Object.values(cs.units)) {
    if (unit.trip || unit.inCombat || unit.hp >= unit.maxHp || !unit.cityId) continue;
    const city = cs.cities[unit.cityId];
    if (!city || city.ownerNationId !== unit.ownerNationId || (city.hospital ?? 0) < 1) continue;
    const last = (unit.lastHealUtc ?? cs.timeUtc) as number;
    if (last + CAMPAIGN_HEAL_TICK_MS <= nowNum) {
      unit.hp = Math.min(unit.maxHp, unit.hp + (city.hospital ?? 0));
      unit.lastHealUtc = stepUtc;
      mirrorUnitRecord(unitsRecord, unit, city.cityId);
    }
  }
}

function findNextStepUtc(cs: MutableCampaignState, targetUtc: number): number | null {
  let earliest: number | null = null;
  const consider = (ts: number): void => {
    if (ts <= targetUtc && (earliest === null || ts < earliest)) {
      earliest = ts;
    }
  };

  for (const nation of Object.values(cs.nations)) {
    if (nation.study) consider(nation.study.endUtc as number);
  }
  for (const city of Object.values(cs.cities)) {
    for (const job of city.jobs) consider(job.endUtc as number);
  }
  for (const u of Object.values(cs.units)) {
    if (u.trip) consider(u.trip.endUtc as number);
  }

  const combatOrHeal = findNextDueCombatOrHealUtc(cs, targetUtc);
  if (combatOrHeal !== null) {
    consider(combatOrHeal);
  }

  return earliest;
}

function settleCampaignInPlace(
  cs: MutableCampaignState,
  unitsRecord: Record<string, Unit>,
  regionsRecord: Record<string, Region>,
  nationsMeta: Readonly<Record<string, Nation>> | undefined,
  targetUtc: UtcEpochMs,
  drafts: CampaignPendingEventDraft[]
): void {
  if ((targetUtc as number) < (cs.timeUtc as number) || cs.victory) {
    return;
  }

  const targetNum = targetUtc as number;
  const MAX_STEPS = 256;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (cs.victory) break;
    const nextStepNum = findNextStepUtc(cs, targetNum);
    if (nextStepNum === null) break;

    const stepUtc = asUtcEpochMs(Math.max(cs.timeUtc as number, nextStepNum));
    if ((stepUtc as number) > (cs.timeUtc as number)) {
      accrueCampaignInPlace(cs, stepUtc);
    }

    // 1. Research completions due <= stepUtc
    for (const nation of Object.values(cs.nations).sort((a, b) =>
      a.nationId < b.nationId ? -1 : 1
    )) {
      if (!nation.study || (nation.study.endUtc as number) > (stepUtc as number)) continue;
      const completedKey = nation.study.key;
      const doneUtc = nation.study.endUtc;
      if (!nation.learned.includes(completedKey)) {
        nation.learned.push(completedKey);
      }
      nation.study = null;
      appendCampaignLog(
        cs.log,
        doneUtc,
        nation.nationId,
        null,
        '',
        `Hoàn tất nghiên cứu ${CAMPAIGN_DOCTRINE_CATALOG[completedKey].name}.`
      );
      drafts.push({
        occurredAtUtc: doneUtc,
        tieBreakPriority: 11,
        tieBreakKey: `${nation.nationId}:${completedKey}`,
        payload: {
          type: 'CAMPAIGN_RESEARCH_COMPLETED',
          nationId: nation.nationId,
          doctrineKey: completedKey,
          completedAtUtc: doneUtc,
        },
      });
    }

    // 2. City project completions due <= stepUtc
    const sortedCities = Object.values(cs.cities).sort((a, b) =>
      a.cityId < b.cityId ? -1 : 1
    );
    for (const city of sortedCities) {
      const dueJobs = city.jobs
        .filter((j) => (j.endUtc as number) <= (stepUtc as number))
        .sort(
          (a, b) =>
            (a.endUtc as number) - (b.endUtc as number) || (a.key < b.key ? -1 : 1)
        );
      for (const job of dueJobs) {
        const idx = city.jobs.indexOf(job);
        if (idx < 0) continue;
        city.jobs.splice(idx, 1);

        if (job.lane === 'mobilize') {
          const unitKey = job.key as CampaignUnitKey;
          const unitSpec = CAMPAIGN_UNIT_STATS[unitKey];
          const displayNumber = cs.nextUnitNumber;
          cs.nextUnitNumber += 1;
          const unitId = makeStableUnitId(displayNumber);
          const newUnit: CampaignUnitState = {
            unitId,
            displayNumber,
            key: unitKey,
            ownerNationId: city.ownerNationId,
            cityId: city.cityId,
            cityName: city.name,
            position: { lon: city.lon, lat: city.lat },
            trip: null,
            rev: 0,
            hp: unitSpec.maxHp,
            maxHp: unitSpec.maxHp,
            inCombat: false,
            lastCombatUtc: null,
            lastHealUtc: job.endUtc,
          };
          cs.units[unitId] = newUnit;
          mirrorUnitRecord(unitsRecord, newUnit, city.cityId);
          if (unitKey === 'reserve') {
            city.reserve += 1;
          }
          if (cs.nations[city.ownerNationId]) {
            cs.nations[city.ownerNationId].stats.unitsMobilized += 1;
          }
          appendCampaignLog(
            cs.log,
            job.endUtc,
            city.ownerNationId,
            city.cityId,
            city.name,
            `Hoàn thành ${CAMPAIGN_PROJECT_CATALOG[job.key].label} (#${displayNumber}).`
          );
          drafts.push({
            occurredAtUtc: job.endUtc,
            tieBreakPriority: 12,
            tieBreakKey: `${city.cityId}:${unitId}`,
            payload: {
              type: 'CAMPAIGN_CITY_PROJECT_COMPLETED',
              nationId: city.ownerNationId,
              cityId: city.cityId,
              projectKey: job.key,
              spawnedUnitId: unitId,
            },
          });
        } else {
          let newLevel = 0;
          if (job.key === 'factory') {
            city.factory += 1;
            newLevel = city.factory;
          } else if (job.key === 'office') {
            city.office += 1;
            newLevel = city.office;
          } else if (job.key === 'base') {
            city.base = (city.base ?? 0) + 1;
            newLevel = city.base;
          } else if (job.key === 'bunker') {
            city.bunker = (city.bunker ?? 0) + 1;
            newLevel = city.bunker;
          } else if (job.key === 'hospital') {
            city.hospital = (city.hospital ?? 0) + 1;
            newLevel = city.hospital;
            for (const u of Object.values(cs.units)) {
              if (u.cityId === city.cityId && u.ownerNationId === city.ownerNationId) {
                u.lastHealUtc = job.endUtc;
              }
            }
          }
          appendCampaignLog(
            cs.log,
            job.endUtc,
            city.ownerNationId,
            city.cityId,
            city.name,
            `Hoàn thành ${CAMPAIGN_PROJECT_CATALOG[job.key].label} cấp ${newLevel}.`
          );
          drafts.push({
            occurredAtUtc: job.endUtc,
            tieBreakPriority: 12,
            tieBreakKey: `${city.cityId}:${job.key}`,
            payload: {
              type: 'CAMPAIGN_CITY_PROJECT_COMPLETED',
              nationId: city.ownerNationId,
              cityId: city.cityId,
              projectKey: job.key,
              newLevel,
            },
          });
        }
      }
    }

    // 3. Unit arrivals due <= stepUtc
    for (const unit of Object.values(cs.units).sort((a, b) =>
      a.unitId < b.unitId ? -1 : 1
    )) {
      if (!unit.trip || (unit.trip.endUtc as number) > (stepUtc as number)) continue;
      const destCity = cs.cities[unit.trip.toCityId];
      const arrivalUtc = unit.trip.endUtc;
      if (!destCity) {
        unit.trip = null;
        continue;
      }
      unit.position = { lon: destCity.lon, lat: destCity.lat };
      unit.trip = null;
      unit.rev += 1;
      if (destCity.ownerNationId === unit.ownerNationId) {
        unit.cityId = destCity.cityId;
        unit.cityName = destCity.name;
        unit.lastHealUtc = arrivalUtc;
        if (unit.key === 'reserve') {
          destCity.reserve += 1;
        }
        mirrorUnitRecord(unitsRecord, unit, destCity.cityId);
      } else {
        // Arrived at hostile city — combat & conquest steps immediately follow
        unit.cityId = null;
        unit.cityName = null;
        mirrorUnitRecord(unitsRecord, unit, destCity.cityId);
      }
      appendCampaignLog(
        cs.log,
        arrivalUtc,
        unit.ownerNationId,
        destCity.cityId,
        destCity.name,
        `${CAMPAIGN_PROJECT_CATALOG[unit.key].label} #${unit.displayNumber} đã đến ${destCity.name}.`
      );
      drafts.push({
        occurredAtUtc: arrivalUtc,
        tieBreakPriority: 13,
        tieBreakKey: unit.unitId,
        payload: {
          type: 'CAMPAIGN_UNIT_ARRIVED',
          nationId: unit.ownerNationId,
          unitId: unit.unitId,
          cityId: destCity.cityId,
          arrivedAtUtc: arrivalUtc,
        },
      });
    }

    // 4. Resolve combat (melee + ranged bombardment)
    resolveCombatAtStep(cs, unitsRecord, stepUtc, drafts);

    // 5. Resolve conquest & victory
    resolveConquestAndVictoryAtStep(cs, unitsRecord, regionsRecord, nationsMeta, stepUtc, drafts);

    // 6. Hospital healing
    if (!cs.victory) {
      resolveHospitalHealingAtStep(cs, unitsRecord, stepUtc);
    }

    // Prevent zero-time spin if nothing changed at stepUtc
    const afterNext = findNextStepUtc(cs, targetNum);
    if (afterNext !== null && afterNext <= (stepUtc as number)) {
      break;
    }
  }

  if (!cs.victory) {
    accrueCampaignInPlace(cs, targetUtc);
  }
  cs.victoryPointsByNation = computeCampaignVictoryPoints(cs.cities, Object.keys(cs.nations));
  cs.log.sort((a, b) => (b.timeUtc as number) - (a.timeUtc as number));
}

export function settleCampaignOnTick(
  state: CampaignMatchState,
  unitsRecord: Readonly<Record<string, Unit>>,
  regionsRecord: Readonly<Record<string, Region>>,
  nationsMeta: Readonly<Record<string, Nation>>,
  targetUtc: UtcEpochMs
): {
  readonly campaignState: CampaignMatchState;
  readonly units: Record<string, Unit>;
  readonly regions: Record<string, Region>;
  readonly drafts: readonly CampaignPendingEventDraft[];
} {
  const cs = cloneCampaignState(state);
  const nextUnits = { ...unitsRecord };
  const nextRegions = { ...regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, nationsMeta, targetUtc, drafts);
  return { campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}

export function applyCampaignStartResearch(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly regionsRecord: Readonly<Record<string, Region>>;
  readonly nationsMeta: Readonly<Record<string, Nation>>;
  readonly nationId: NationId;
  readonly doctrineKey: CampaignDoctrineKey;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const nextRegions = { ...options.regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);

  if (cs.victory) {
    return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Trận chiến dịch đã kết thúc.' };
  }
  const nation = cs.nations[options.nationId];
  if (!nation) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Quốc gia không tồn tại trong chiến dịch.' };
  }
  const spec = CAMPAIGN_DOCTRINE_CATALOG[options.doctrineKey];
  if (nation.learned.includes(options.doctrineKey)) {
    return { ok: false, code: 'DUPLICATE_ENTITY', reason: `Đã hoàn tất nghiên cứu ${spec.name}.` };
  }
  if (nation.study) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Đang có đề tài nghiên cứu trong hàng đợi.' };
  }
  if (spec.requires && !nation.learned.includes(spec.requires)) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      reason: `Cần hoàn tất ${CAMPAIGN_DOCTRINE_CATALOG[spec.requires].name} trước.`,
    };
  }
  for (let i = 0; i < 7; i += 1) {
    if (spec.cost[i] * CAMPAIGN_HOUR_MS > nation.balance[i]) {
      return {
        ok: false,
        code: 'INSUFFICIENT_RESOURCES',
        reason: `Kho không đủ ${CAMPAIGN_MATERIAL_LABELS[i]} để nghiên cứu ${spec.name}.`,
      };
    }
  }

  for (let i = 0; i < 7; i += 1) {
    nation.balance[i] -= spec.cost[i] * CAMPAIGN_HOUR_MS;
  }
  const endUtc = asUtcEpochMs((options.nowUtc as number) + spec.seconds * 1000);
  nation.study = {
    key: options.doctrineKey,
    startUtc: options.nowUtc,
    endUtc,
  };
  appendCampaignLog(
    cs.log,
    options.nowUtc,
    options.nationId,
    null,
    '',
    `Bắt đầu nghiên cứu ${spec.name}.`
  );
  drafts.push({
    occurredAtUtc: options.nowUtc,
    tieBreakPriority: 31,
    tieBreakKey: `${options.nationId}:${options.doctrineKey}`,
    payload: {
      type: 'CAMPAIGN_RESEARCH_STARTED',
      nationId: options.nationId,
      doctrineKey: options.doctrineKey,
      startUtc: options.nowUtc,
      endUtc,
    },
  });

  return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}

export function applyCampaignCancelResearch(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly regionsRecord: Readonly<Record<string, Region>>;
  readonly nationsMeta: Readonly<Record<string, Nation>>;
  readonly nationId: NationId;
  readonly doctrineKey: CampaignDoctrineKey;
  readonly expectedStartUtc: UtcEpochMs;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const nextRegions = { ...options.regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);

  if (cs.victory) {
    return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Trận chiến dịch đã kết thúc.' };
  }
  const nation = cs.nations[options.nationId];
  if (!nation) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Quốc gia không tồn tại trong chiến dịch.' };
  }
  const study = nation.study;
  if (!study || study.key !== options.doctrineKey || study.startUtc !== options.expectedStartUtc) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Đề tài nghiên cứu đã thay đổi hoặc đã hoàn tất.' };
  }

  const spec = CAMPAIGN_DOCTRINE_CATALOG[options.doctrineKey];
  const totalMs = (study.endUtc as number) - (study.startUtc as number);
  const remainingMs = Math.max(0, (study.endUtc as number) - (options.nowUtc as number));
  const refunded = spec.cost.map((unitCost) =>
    totalMs > 0 ? Math.floor((unitCost * remainingMs) / totalMs) : 0
  ) as unknown as CampaignResourceTuple;

  for (let i = 0; i < 7; i += 1) {
    nation.balance[i] += refunded[i] * CAMPAIGN_HOUR_MS;
  }
  nation.study = null;
  appendCampaignLog(
    cs.log,
    options.nowUtc,
    options.nationId,
    null,
    '',
    `Hủy nghiên cứu ${spec.name}.`
  );
  drafts.push({
    occurredAtUtc: options.nowUtc,
    tieBreakPriority: 32,
    tieBreakKey: `${options.nationId}:${options.doctrineKey}`,
    payload: {
      type: 'CAMPAIGN_RESEARCH_CANCELLED',
      nationId: options.nationId,
      doctrineKey: options.doctrineKey,
      refunded,
    },
  });

  return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}

export function applyCampaignStartCityProject(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly regionsRecord: Readonly<Record<string, Region>>;
  readonly nationsMeta: Readonly<Record<string, Nation>>;
  readonly nationId: NationId;
  readonly cityId: RegionId;
  readonly projectKey: CampaignProjectKey;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const nextRegions = { ...options.regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);

  if (cs.victory) {
    return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Trận chiến dịch đã kết thúc.' };
  }
  const nation = cs.nations[options.nationId];
  const city = cs.cities[options.cityId];
  if (!nation || !city) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Thành phố không tồn tại trong kịch bản.' };
  }
  if (city.ownerNationId !== options.nationId) {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTION',
      reason: `Thành phố ${city.name} không thuộc quyền kiểm soát của bạn.`,
    };
  }

  const spec = CAMPAIGN_PROJECT_CATALOG[options.projectKey];
  if (city.jobs.some((j) => j.lane === spec.lane)) {
    return {
      ok: false,
      code: 'DUPLICATE_ENTITY',
      reason: `Hàng đợi ${spec.lane === 'build' ? 'xây dựng' : 'huy động'} tại ${city.name} đang bận.`,
    };
  }

  if (spec.lane === 'build' && spec.maxLevel !== undefined) {
    const curLv = getBuildingLevel(city, options.projectKey);
    if (curLv >= spec.maxLevel) {
      return {
        ok: false,
        code: 'INVALID_TARGET',
        reason: `${spec.label} tại ${city.name} đã đạt cấp tối đa (${spec.maxLevel}).`,
      };
    }
  }

  if (spec.lane === 'mobilize') {
    const unitSpec = CAMPAIGN_UNIT_STATS[options.projectKey as CampaignUnitKey];
    if (unitSpec.requiredDoctrine && !nation.learned.includes(unitSpec.requiredDoctrine)) {
      return {
        ok: false,
        code: 'INVALID_TARGET',
        reason: `Cần hoàn tất nghiên cứu ${CAMPAIGN_DOCTRINE_CATALOG[unitSpec.requiredDoctrine].name}.`,
      };
    }
    if (city.office < unitSpec.requiredOffice) {
      return {
        ok: false,
        code: 'INVALID_TARGET',
        reason: `Cần Văn phòng tuyển dụng cấp ${unitSpec.requiredOffice} tại ${city.name}.`,
      };
    }
    if ((city.base ?? 0) < unitSpec.requiredBase) {
      return {
        ok: false,
        code: 'INVALID_TARGET',
        reason: `Cần Căn cứ lục quân cấp ${unitSpec.requiredBase} tại ${city.name}.`,
      };
    }
  }

  const terms = computeCampaignProjectTerms(city, options.projectKey);
  for (let i = 0; i < 7; i += 1) {
    if (terms.cost[i] * CAMPAIGN_HOUR_MS > nation.balance[i]) {
      return {
        ok: false,
        code: 'INSUFFICIENT_RESOURCES',
        reason: `Kho không đủ ${CAMPAIGN_MATERIAL_LABELS[i]} cho ${spec.label}.`,
      };
    }
  }

  for (let i = 0; i < 7; i += 1) {
    nation.balance[i] -= terms.cost[i] * CAMPAIGN_HOUR_MS;
  }
  const endUtc = asUtcEpochMs((options.nowUtc as number) + terms.durationSeconds * 1000);
  const job: CampaignCityJob = {
    key: options.projectKey,
    lane: spec.lane,
    cost: terms.cost,
    startUtc: options.nowUtc,
    endUtc,
  };
  city.jobs.push(job);

  appendCampaignLog(
    cs.log,
    options.nowUtc,
    options.nationId,
    city.cityId,
    city.name,
    `Bắt đầu ${spec.label}.`
  );
  drafts.push({
    occurredAtUtc: options.nowUtc,
    tieBreakPriority: 33,
    tieBreakKey: `${city.cityId}:${spec.lane}:${options.projectKey}`,
    payload: {
      type: 'CAMPAIGN_CITY_PROJECT_STARTED',
      nationId: options.nationId,
      cityId: city.cityId,
      projectKey: options.projectKey,
      lane: spec.lane,
      startUtc: options.nowUtc,
      endUtc,
    },
  });

  return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}

export function applyCampaignCancelCityProject(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly regionsRecord: Readonly<Record<string, Region>>;
  readonly nationsMeta: Readonly<Record<string, Nation>>;
  readonly nationId: NationId;
  readonly cityId: RegionId;
  readonly projectKey: CampaignProjectKey;
  readonly expectedStartUtc: UtcEpochMs;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const nextRegions = { ...options.regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);

  if (cs.victory) {
    return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Trận chiến dịch đã kết thúc.' };
  }
  const nation = cs.nations[options.nationId];
  const city = cs.cities[options.cityId];
  if (!nation || !city) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Thành phố không tồn tại trong kịch bản.' };
  }
  if (city.ownerNationId !== options.nationId) {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTION',
      reason: `Thành phố ${city.name} không thuộc quyền kiểm soát của bạn.`,
    };
  }

  const jobIdx = city.jobs.findIndex(
    (j) => j.key === options.projectKey && j.startUtc === options.expectedStartUtc
  );
  if (jobIdx < 0) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Hàng đợi thành phố đã thay đổi.' };
  }

  const [job] = city.jobs.splice(jobIdx, 1);
  for (let i = 0; i < 7; i += 1) {
    nation.balance[i] += job.cost[i] * CAMPAIGN_HOUR_MS;
  }

  const spec = CAMPAIGN_PROJECT_CATALOG[job.key];
  appendCampaignLog(
    cs.log,
    options.nowUtc,
    options.nationId,
    city.cityId,
    city.name,
    `Hủy ${spec.label}, hoàn lại chi phí.`
  );
  drafts.push({
    occurredAtUtc: options.nowUtc,
    tieBreakPriority: 34,
    tieBreakKey: `${city.cityId}:${job.lane}:${job.key}`,
    payload: {
      type: 'CAMPAIGN_CITY_PROJECT_CANCELLED',
      nationId: options.nationId,
      cityId: city.cityId,
      projectKey: job.key,
      refunded: job.cost,
    },
  });

  return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}

export function applyCampaignMoveUnit(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly regionsRecord: Readonly<Record<string, Region>>;
  readonly nationsMeta: Readonly<Record<string, Nation>>;
  readonly nationId: NationId;
  readonly unitId: UnitId;
  readonly toCityId: RegionId | null;
  readonly expectedRev: number;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const nextRegions = { ...options.regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);

  if (cs.victory) {
    return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Trận chiến dịch đã kết thúc.' };
  }
  const nation = cs.nations[options.nationId];
  const unit = cs.units[options.unitId];
  if (!nation || !unit) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Đơn vị không tồn tại.' };
  }
  if (unit.ownerNationId !== options.nationId) {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTION',
      reason: 'Đơn vị không thuộc quyền chỉ huy của bạn.',
    };
  }
  if (unit.rev !== options.expectedRev) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      reason: 'Đơn vị đã nhận lệnh khác. Hãy chọn lại.',
    };
  }

  if (options.toCityId === null) {
    if (!unit.trip) {
      return { ok: false, code: 'INVALID_TARGET', reason: 'Đơn vị đã dừng.' };
    }
    unit.position = interpolateCampaignUnitPosition(unit, options.nowUtc as number);
    unit.cityId = null;
    unit.cityName = null;
    unit.trip = null;
    unit.rev += 1;

    appendCampaignLog(
      cs.log,
      options.nowUtc,
      options.nationId,
      null,
      '',
      `${CAMPAIGN_PROJECT_CATALOG[unit.key].label} #${unit.displayNumber} đã dừng tại chỗ.`
    );
    drafts.push({
      occurredAtUtc: options.nowUtc,
      tieBreakPriority: 35,
      tieBreakKey: unit.unitId,
      payload: {
        type: 'CAMPAIGN_UNIT_ORDER_ISSUED',
        nationId: options.nationId,
        unitId: unit.unitId,
        toCityId: null,
        startUtc: options.nowUtc,
        endUtc: null,
        durationMs: 0,
      },
    });
    return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
  }

  const destCity = cs.cities[options.toCityId];
  if (!destCity) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Thành phố đích không hợp lệ.' };
  }
  const isHostileDestination = destCity.ownerNationId !== options.nationId;
  if (isHostileDestination && cs.diplomacy.relation !== 'WAR') {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTION',
      reason: `Cần tuyên chiến trong mục Ngoại giao trước khi tiến quân vào ${destCity.name}.`,
    };
  }
  if (unit.cityId === destCity.cityId || unit.trip?.toCityId === destCity.cityId) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Hãy chọn một thành phố khác.' };
  }

  const currentPos = interpolateCampaignUnitPosition(unit, options.nowUtc as number);
  if (unit.cityId && unit.key === 'reserve') {
    const originCity = cs.cities[unit.cityId];
    if (originCity && originCity.reserve > 0) {
      originCity.reserve -= 1;
    }
  }

  const spec = CAMPAIGN_UNIT_STATS[unit.key];
  const durationSeconds =
    unit.key === 'motor' && nation.learned.includes('motor2')
      ? CAMPAIGN_MOVE_DURATION_SECONDS.motorUpgraded
      : spec.moveSeconds;
  const durationMs = durationSeconds * 1000;
  const endUtc = asUtcEpochMs((options.nowUtc as number) + durationMs);
  const points = buildCampaignPath(cs.cities, currentPos, destCity);

  unit.position = currentPos;
  unit.cityId = null;
  unit.cityName = null;
  unit.inCombat = false;
  unit.rev += 1;
  unit.trip = {
    toCityId: destCity.cityId,
    toCityName: destCity.name,
    points,
    startUtc: options.nowUtc,
    endUtc,
  };

  appendCampaignLog(
    cs.log,
    options.nowUtc,
    options.nationId,
    null,
    '',
    `${CAMPAIGN_PROJECT_CATALOG[unit.key].label} #${unit.displayNumber} ${isHostileDestination ? 'tiến công' : 'di chuyển'} tới ${destCity.name}.`
  );
  drafts.push({
    occurredAtUtc: options.nowUtc,
    tieBreakPriority: 35,
    tieBreakKey: unit.unitId,
    payload: {
      type: 'CAMPAIGN_UNIT_ORDER_ISSUED',
      nationId: options.nationId,
      unitId: unit.unitId,
      toCityId: destCity.cityId,
      startUtc: options.nowUtc,
      endUtc,
      durationMs,
    },
  });

  return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}

export function applyCampaignSetDiplomacy(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly regionsRecord: Readonly<Record<string, Region>>;
  readonly nationsMeta: Readonly<Record<string, Nation>>;
  readonly nationId: NationId;
  readonly targetNationId: NationId;
  readonly action: CampaignDiplomacyAction;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const nextRegions = { ...options.regionsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);

  if (cs.victory) {
    return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Trận chiến dịch đã kết thúc.' };
  }
  if (
    options.nationId === options.targetNationId ||
    !cs.nations[options.nationId] ||
    !cs.nations[options.targetNationId]
  ) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Quốc gia đối tượng ngoại giao không hợp lệ.' };
  }

  const dip = cs.diplomacy;
  const actorLabel = nationLabelVi(options.nationId);
  const targetLabel = nationLabelVi(options.targetNationId);

  switch (options.action) {
    case 'DECLARE_WAR': {
      if (dip.relation === 'WAR') {
        return { ok: false, code: 'DUPLICATE_ENTITY', reason: 'Hai bên đã ở trạng thái chiến tranh.' };
      }
      dip.relation = 'WAR';
      dip.peaceProposedByNationId = null;
      dip.intelProposedByNationId = null;
      dip.sharedIntelActive = false;
      dip.updatedAtUtc = options.nowUtc;
      appendCampaignNews(
        cs,
        options.nowUtc,
        'DIPLOMACY',
        `${actorLabel} tuyên chiến với ${targetLabel}!`,
        `Trạng thái chiến tranh chính thức có hiệu lực. Hai bên có thể tiến công thành phố và giao tranh trực tiếp.`
      );
      break;
    }
    case 'PROPOSE_PEACE': {
      if (dip.relation !== 'WAR') {
        return { ok: false, code: 'INVALID_TARGET', reason: 'Hai bên hiện không ở trạng thái chiến tranh.' };
      }
      if (dip.peaceProposedByNationId === options.nationId) {
        return { ok: false, code: 'DUPLICATE_ENTITY', reason: 'Đã gửi đề nghị hòa bình.' };
      }
      dip.peaceProposedByNationId = options.nationId;
      dip.updatedAtUtc = options.nowUtc;
      appendCampaignNews(
        cs,
        options.nowUtc,
        'DIPLOMACY',
        `${actorLabel} đề nghị đình chiến`,
        `${actorLabel} đã gửi đề nghị lập lại hòa bình tới ${targetLabel}.`
      );
      break;
    }
    case 'ACCEPT_PEACE': {
      if (dip.relation !== 'WAR' || !dip.peaceProposedByNationId || dip.peaceProposedByNationId === options.nationId) {
        return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Không có đề nghị hòa bình từ đối phương để chấp nhận.' };
      }
      dip.relation = 'PEACE';
      dip.peaceProposedByNationId = null;
      dip.updatedAtUtc = options.nowUtc;
      for (const u of Object.values(cs.units)) {
        u.inCombat = false;
        if (u.trip) {
          const dest = cs.cities[u.trip.toCityId];
          if (dest && dest.ownerNationId !== u.ownerNationId) {
            u.position = interpolateCampaignUnitPosition(u, options.nowUtc as number);
            u.trip = null;
            u.cityId = null;
            u.cityName = null;
            u.rev += 1;
          }
        }
      }
      appendCampaignNews(
        cs,
        options.nowUtc,
        'DIPLOMACY',
        `Hiệp định hòa bình giữa ${actorLabel} và ${targetLabel}`,
        `Hai bên chính thức ngừng bắn và trở về trạng thái hòa bình.`
      );
      break;
    }
    case 'PROPOSE_INTEL': {
      if (dip.relation === 'WAR') {
        return { ok: false, code: 'INVALID_TARGET', reason: 'Không thể chia sẻ tình báo khi đang chiến tranh.' };
      }
      if (dip.sharedIntelActive || dip.intelProposedByNationId === options.nationId) {
        return { ok: false, code: 'DUPLICATE_ENTITY', reason: 'Đã có đề nghị hoặc hiệp ước chia sẻ tình báo.' };
      }
      dip.intelProposedByNationId = options.nationId;
      dip.updatedAtUtc = options.nowUtc;
      break;
    }
    case 'ACCEPT_INTEL': {
      if (
        dip.relation === 'WAR' ||
        !dip.intelProposedByNationId ||
        dip.intelProposedByNationId === options.nationId
      ) {
        return { ok: false, code: 'FORBIDDEN_ACTION', reason: 'Chỉ bên nhận đề nghị mới có thể chấp thuận.' };
      }
      dip.sharedIntelActive = true;
      dip.intelProposedByNationId = null;
      dip.updatedAtUtc = options.nowUtc;
      appendCampaignNews(
        cs,
        options.nowUtc,
        'DIPLOMACY',
        `Hiệp ước chia sẻ tình báo có hiệu lực`,
        `${actorLabel} và ${targetLabel} cùng chia sẻ tầm nhìn chiến trường.`
      );
      break;
    }
    case 'END_INTEL': {
      if (!dip.sharedIntelActive && !dip.intelProposedByNationId) {
        return { ok: false, code: 'INVALID_TARGET', reason: 'Không có hiệp ước tình báo nào đang hiệu lực.' };
      }
      dip.sharedIntelActive = false;
      dip.intelProposedByNationId = null;
      dip.updatedAtUtc = options.nowUtc;
      break;
    }
  }

  drafts.push({
    occurredAtUtc: options.nowUtc,
    tieBreakPriority: 36,
    tieBreakKey: `${options.nationId}:${options.action}`,
    payload: {
      type: 'CAMPAIGN_DIPLOMACY_CHANGED',
      actorNationId: options.nationId,
      targetNationId: options.targetNationId,
      action: options.action,
      relation: dip.relation,
      sharedIntelActive: dip.sharedIntelActive,
    },
  });

  // If war was just declared, immediately resolve any units already standing in melee/ranged contact
  if (options.action === 'DECLARE_WAR') {
    resolveCombatAtStep(cs, nextUnits, options.nowUtc, drafts);
    resolveConquestAndVictoryAtStep(cs, nextUnits, nextRegions, options.nationsMeta, options.nowUtc, drafts);
  }

  return { ok: true, campaignState: cs, units: nextUnits, regions: nextRegions, drafts };
}
