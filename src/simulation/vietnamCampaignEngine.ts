import {
  asFixedPoint,
  asUtcEpochMs,
  CAMPAIGN_HOUR_MS,
  CampaignCityJob,
  CampaignCityState,
  CampaignDoctrineKey,
  CampaignGeoPoint,
  CampaignLane,
  CampaignLogEntry,
  CampaignMatchState,
  CampaignNationState,
  CampaignProjectKey,
  CampaignResourceTuple,
  CampaignUnitKey,
  CampaignUnitState,
  DomainEventPayload,
  interpolateCampaignUnitPosition,
  NationId,
  RegionId,
  Unit,
  UnitId,
  UnitIdSchema,
  UtcEpochMs,
} from '../contracts';

/**
 * Pure, deterministic server-authoritative engine for the modern Vietnam campaign map.
 * ZERO Date.now(), ZERO Math.random(). All arithmetic uses exact safe integers.
 * Costs, durations, prerequisites, and effects match campaign/economy.js and campaign/forces.js.
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

export interface CampaignDoctrineSpec {
  readonly key: CampaignDoctrineKey;
  readonly name: string;
  readonly description: string;
  readonly cost: CampaignResourceTuple;
  readonly seconds: number;
  readonly requires: CampaignDoctrineKey | null;
}

export const CAMPAIGN_DOCTRINE_CATALOG: Readonly<Record<CampaignDoctrineKey, CampaignDoctrineSpec>> = {
  motor: {
    key: 'motor',
    name: 'Bộ binh cơ giới I',
    description: 'Mở huy động bộ binh cơ giới.',
    cost: [180, 0, 0, 0, 80, 0, 240],
    seconds: 45,
    requires: null,
  },
  motor2: {
    key: 'motor2',
    name: 'Bộ binh cơ giới II',
    description: 'Rút thời gian mỗi lệnh di chuyển mới từ 32 xuống 24 giây.',
    cost: [240, 0, 0, 0, 120, 0, 360],
    seconds: 65,
    requires: 'motor',
  },
};

export interface CampaignProjectSpec {
  readonly key: CampaignProjectKey;
  readonly label: string;
  readonly lane: CampaignLane;
  readonly seconds: number;
  readonly cost: CampaignResourceTuple;
}

export const CAMPAIGN_PROJECT_CATALOG: Readonly<Record<CampaignProjectKey, CampaignProjectSpec>> = {
  factory: {
    key: 'factory',
    label: 'Xưởng công nghiệp',
    lane: 'build',
    seconds: 60,
    cost: [200, 150, 0, 25, 0, 0, 300],
  },
  office: {
    key: 'office',
    label: 'Văn phòng tuyển dụng',
    lane: 'build',
    seconds: 45,
    cost: [150, 60, 0, 0, 0, 0, 200],
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
};

export const CAMPAIGN_MOVE_DURATION_SECONDS = {
  reserve: 45,
  motorBase: 32,
  motorUpgraded: 24,
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
      readonly drafts: readonly CampaignPendingEventDraft[];
    }
  | {
      readonly ok: false;
      readonly code: CampaignRejectionCode;
      readonly reason: string;
    };

function cloneCampaignState(state: CampaignMatchState): {
  startUtc: UtcEpochMs;
  timeUtc: UtcEpochMs;
  nextUnitNumber: number;
  nations: Record<string, CampaignNationState>;
  cities: Record<string, CampaignCityState>;
  units: Record<string, CampaignUnitState>;
  log: CampaignLogEntry[];
} {
  const nations: Record<string, CampaignNationState> = {};
  for (const [id, n] of Object.entries(state.nations)) {
    nations[id] = {
      nationId: n.nationId,
      balance: [...n.balance] as CampaignResourceTuple,
      learned: [...n.learned],
      study: n.study ? { ...n.study } : null,
    };
  }
  const cities: Record<string, CampaignCityState> = {};
  for (const [id, c] of Object.entries(state.cities)) {
    cities[id] = {
      ...c,
      jobs: c.jobs.map((j) => ({
        ...j,
        cost: [...j.cost] as CampaignResourceTuple,
      })),
    };
  }
  const units: Record<string, CampaignUnitState> = {};
  for (const [id, u] of Object.entries(state.units)) {
    units[id] = {
      ...u,
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
    nations,
    cities,
    units,
    log: state.log.map((entry) => ({ ...entry })),
  };
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
    expense[0] += 1;
    expense[6] += unit.key === 'motor' ? 3 : 2;
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

export function computeCampaignProjectTerms(
  city: CampaignCityState,
  projectKey: CampaignProjectKey
): {
  readonly level: number;
  readonly cost: CampaignResourceTuple;
  readonly durationSeconds: number;
} {
  const spec = CAMPAIGN_PROJECT_CATALOG[projectKey];
  const level =
    spec.lane === 'build'
      ? (projectKey === 'factory' ? city.factory : city.office) + 1
      : 1;
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

function accrueCampaignInPlace(
  state: ReturnType<typeof cloneCampaignState>,
  toUtc: UtcEpochMs
): void {
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
    strengthFp: asFixedPoint(100_000),
    readinessFp: asFixedPoint(100_000),
    supplyFp: asFixedPoint(100_000),
  };
}

type DueCompletion =
  | {
      readonly endUtc: UtcEpochMs;
      readonly kindOrder: 0;
      readonly tieKey: string;
      readonly kind: 'research';
      readonly nationId: NationId;
    }
  | {
      readonly endUtc: UtcEpochMs;
      readonly kindOrder: 1;
      readonly tieKey: string;
      readonly kind: 'city_job';
      readonly cityId: RegionId;
      readonly jobKey: CampaignProjectKey;
      readonly startUtc: UtcEpochMs;
    }
  | {
      readonly endUtc: UtcEpochMs;
      readonly kindOrder: 2;
      readonly tieKey: string;
      readonly kind: 'unit_arrival';
      readonly unitId: UnitId;
    };

function settleCampaignInPlace(
  cs: ReturnType<typeof cloneCampaignState>,
  unitsRecord: Record<string, Unit>,
  targetUtc: UtcEpochMs,
  drafts: CampaignPendingEventDraft[]
): void {
  if ((targetUtc as number) < (cs.timeUtc as number)) {
    return;
  }

  const due: DueCompletion[] = [];

  for (const nation of Object.values(cs.nations)) {
    if (nation.study && (nation.study.endUtc as number) <= (targetUtc as number)) {
      due.push({
        endUtc: nation.study.endUtc,
        kindOrder: 0,
        tieKey: nation.nationId,
        kind: 'research',
        nationId: nation.nationId,
      });
    }
  }

  for (const city of Object.values(cs.cities)) {
    for (const job of city.jobs) {
      if ((job.endUtc as number) <= (targetUtc as number)) {
        due.push({
          endUtc: job.endUtc,
          kindOrder: 1,
          tieKey: `${city.cityId}:${job.lane}:${job.key}`,
          kind: 'city_job',
          cityId: city.cityId,
          jobKey: job.key,
          startUtc: job.startUtc,
        });
      }
    }
  }

  for (const unit of Object.values(cs.units)) {
    if (unit.trip && (unit.trip.endUtc as number) <= (targetUtc as number)) {
      due.push({
        endUtc: unit.trip.endUtc,
        kindOrder: 2,
        tieKey: unit.unitId,
        kind: 'unit_arrival',
        unitId: unit.unitId,
      });
    }
  }

  due.sort((a, b) => {
    const timeDiff = (a.endUtc as number) - (b.endUtc as number);
    if (timeDiff !== 0) return timeDiff;
    if (a.kindOrder !== b.kindOrder) return a.kindOrder - b.kindOrder;
    return a.tieKey < b.tieKey ? -1 : a.tieKey > b.tieKey ? 1 : 0;
  });

  for (const item of due) {
    if ((item.endUtc as number) > (cs.timeUtc as number)) {
      accrueCampaignInPlace(cs, item.endUtc);
    }

    if (item.kind === 'research') {
      const nation = cs.nations[item.nationId];
      if (!nation || !nation.study || nation.study.endUtc !== item.endUtc) continue;
      const completedKey = nation.study.key;
      if (!nation.learned.includes(completedKey)) {
        nation.learned.push(completedKey);
      }
      nation.study = null;
      appendCampaignLog(
        cs.log,
        item.endUtc,
        nation.nationId,
        null,
        '',
        `Hoàn tất nghiên cứu ${CAMPAIGN_DOCTRINE_CATALOG[completedKey].name}.`
      );
      drafts.push({
        occurredAtUtc: item.endUtc,
        tieBreakPriority: 11,
        tieBreakKey: `${nation.nationId}:${completedKey}`,
        payload: {
          type: 'CAMPAIGN_RESEARCH_COMPLETED',
          nationId: nation.nationId,
          doctrineKey: completedKey,
          completedAtUtc: item.endUtc,
        },
      });
      continue;
    }

    if (item.kind === 'city_job') {
      const city = cs.cities[item.cityId];
      if (!city) continue;
      const jobIdx = city.jobs.findIndex(
        (j) => j.key === item.jobKey && j.startUtc === item.startUtc && j.endUtc === item.endUtc
      );
      if (jobIdx < 0) continue;
      const [job] = city.jobs.splice(jobIdx, 1);

      if (job.lane === 'mobilize') {
        const unitKey: CampaignUnitKey = job.key === 'motor' ? 'motor' : 'reserve';
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
        };
        cs.units[unitId] = newUnit;
        mirrorUnitRecord(unitsRecord, newUnit, city.cityId);
        if (unitKey === 'reserve') {
          city.reserve += 1;
        }
        appendCampaignLog(
          cs.log,
          item.endUtc,
          city.ownerNationId,
          city.cityId,
          city.name,
          `Hoàn thành ${CAMPAIGN_PROJECT_CATALOG[job.key].label} (#${displayNumber}).`
        );
        drafts.push({
          occurredAtUtc: item.endUtc,
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
        }
        appendCampaignLog(
          cs.log,
          item.endUtc,
          city.ownerNationId,
          city.cityId,
          city.name,
          `Hoàn thành ${CAMPAIGN_PROJECT_CATALOG[job.key].label} cấp ${newLevel}.`
        );
        drafts.push({
          occurredAtUtc: item.endUtc,
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
      continue;
    }

    if (item.kind === 'unit_arrival') {
      const unit = cs.units[item.unitId];
      if (!unit || !unit.trip || unit.trip.endUtc !== item.endUtc) continue;
      const destCity = cs.cities[unit.trip.toCityId];
      if (!destCity) continue;
      unit.position = { lon: destCity.lon, lat: destCity.lat };
      unit.cityId = destCity.cityId;
      unit.cityName = destCity.name;
      unit.trip = null;
      unit.rev += 1;
      if (unit.key === 'reserve') {
        destCity.reserve += 1;
      }
      mirrorUnitRecord(unitsRecord, unit, destCity.cityId);
      appendCampaignLog(
        cs.log,
        item.endUtc,
        unit.ownerNationId,
        destCity.cityId,
        destCity.name,
        `${CAMPAIGN_PROJECT_CATALOG[unit.key].label} #${unit.displayNumber} đã đến nơi.`
      );
      drafts.push({
        occurredAtUtc: item.endUtc,
        tieBreakPriority: 13,
        tieBreakKey: unit.unitId,
        payload: {
          type: 'CAMPAIGN_UNIT_ARRIVED',
          nationId: unit.ownerNationId,
          unitId: unit.unitId,
          cityId: destCity.cityId,
          arrivedAtUtc: item.endUtc,
        },
      });
    }
  }

  accrueCampaignInPlace(cs, targetUtc);
  cs.log.sort((a, b) => (b.timeUtc as number) - (a.timeUtc as number));
}

export function settleCampaignOnTick(
  state: CampaignMatchState,
  unitsRecord: Readonly<Record<string, Unit>>,
  targetUtc: UtcEpochMs
): {
  readonly campaignState: CampaignMatchState;
  readonly units: Record<string, Unit>;
  readonly drafts: readonly CampaignPendingEventDraft[];
} {
  const cs = cloneCampaignState(state);
  const nextUnits = { ...unitsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, targetUtc, drafts);
  return { campaignState: cs, units: nextUnits, drafts };
}

export function applyCampaignStartResearch(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly nationId: NationId;
  readonly doctrineKey: CampaignDoctrineKey;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, options.nowUtc, drafts);

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

  return { ok: true, campaignState: cs, units: nextUnits, drafts };
}

export function applyCampaignCancelResearch(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly nationId: NationId;
  readonly doctrineKey: CampaignDoctrineKey;
  readonly expectedStartUtc: UtcEpochMs;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, options.nowUtc, drafts);

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

  return { ok: true, campaignState: cs, units: nextUnits, drafts };
}

export function applyCampaignStartCityProject(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly nationId: NationId;
  readonly cityId: RegionId;
  readonly projectKey: CampaignProjectKey;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, options.nowUtc, drafts);

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
  if (options.projectKey === 'motor' && !nation.learned.includes('motor')) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      reason: 'Cần hoàn tất nghiên cứu Bộ binh cơ giới I.',
    };
  }
  if (spec.lane === 'mobilize' && city.office < 1) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      reason: `Cần Văn phòng tuyển dụng cấp 1 tại ${city.name}.`,
    };
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

  return { ok: true, campaignState: cs, units: nextUnits, drafts };
}

export function applyCampaignCancelCityProject(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly nationId: NationId;
  readonly cityId: RegionId;
  readonly projectKey: CampaignProjectKey;
  readonly expectedStartUtc: UtcEpochMs;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, options.nowUtc, drafts);

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

  return { ok: true, campaignState: cs, units: nextUnits, drafts };
}

export function applyCampaignMoveUnit(options: {
  readonly state: CampaignMatchState;
  readonly unitsRecord: Readonly<Record<string, Unit>>;
  readonly nationId: NationId;
  readonly unitId: UnitId;
  readonly toCityId: RegionId | null;
  readonly expectedRev: number;
  readonly nowUtc: UtcEpochMs;
}): CampaignMutationResult {
  const cs = cloneCampaignState(options.state);
  const nextUnits = { ...options.unitsRecord };
  const drafts: CampaignPendingEventDraft[] = [];
  settleCampaignInPlace(cs, nextUnits, options.nowUtc, drafts);

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
    return { ok: true, campaignState: cs, units: nextUnits, drafts };
  }

  const destCity = cs.cities[options.toCityId];
  if (!destCity) {
    return { ok: false, code: 'INVALID_TARGET', reason: 'Thành phố đích không hợp lệ.' };
  }
  if (destCity.ownerNationId !== options.nationId) {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTION',
      reason: `Không thể điều quân đến thành phố ${destCity.name} chưa thuộc quyền kiểm soát của bạn.`,
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

  const durationSeconds =
    unit.key === 'reserve'
      ? CAMPAIGN_MOVE_DURATION_SECONDS.reserve
      : nation.learned.includes('motor2')
        ? CAMPAIGN_MOVE_DURATION_SECONDS.motorUpgraded
        : CAMPAIGN_MOVE_DURATION_SECONDS.motorBase;
  const durationMs = durationSeconds * 1000;
  const endUtc = asUtcEpochMs((options.nowUtc as number) + durationMs);
  const points = buildCampaignPath(cs.cities, currentPos, destCity);

  unit.position = currentPos;
  unit.cityId = null;
  unit.cityName = null;
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
    `${CAMPAIGN_PROJECT_CATALOG[unit.key].label} #${unit.displayNumber} di chuyển tới ${destCity.name}.`
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

  return { ok: true, campaignState: cs, units: nextUnits, drafts };
}
