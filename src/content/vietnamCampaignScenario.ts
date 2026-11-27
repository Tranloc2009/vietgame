import { createHash } from 'node:crypto';
import {
  ActorIdSchema,
  asFixedPoint,
  asUtcEpochMs,
  CAMPAIGN_HOUR_MS,
  CampaignCityState,
  CampaignMatchState,
  CampaignResourceTuple,
  CONTRACT_SCHEMA_VERSION,
  MatchId,
  MatchIdSchema,
  MatchMode,
  MatchState,
  MatchStateSchema,
  NationId,
  REALTIME_SECONDS_PER_GAME_DAY,
  Region,
  RegionId,
  RegionIdSchema,
  ResourceLedger,
  ScenarioId,
} from '../contracts';
import { assertSimulationInvariants, normalizeSeed } from '../simulation';
import { WORLD_ACTORS, WORLD_NATIONS } from './worldMap72';
import rawCities from './geo/vietnamCampaignCities.json';

export const VIETNAM_CAMPAIGN_SCENARIO_ID: ScenarioId = 'vietnam_campaign_v1';

export interface VietnamCampaignCityBlueprint {
  readonly cityId: RegionId;
  readonly index: number;
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  readonly capital: boolean;
  readonly rank: number;
  readonly material: number;
  readonly initialOwnerSlot: 'NORTH' | 'SOUTH';
}

export const VIETNAM_CAMPAIGN_CITIES: readonly VietnamCampaignCityBlueprint[] = rawCities.map(
  (row) => ({
    cityId: RegionIdSchema.parse(row.cityId),
    index: row.index,
    name: row.name,
    lon: row.lon,
    lat: row.lat,
    capital: row.capital,
    rank: row.rank,
    material: row.material,
    initialOwnerSlot: row.initialOwnerSlot === 'NORTH' ? 'NORTH' : 'SOUTH',
  })
);

export const VIETNAM_CAMPAIGN_CITY_BY_ID: ReadonlyMap<RegionId, VietnamCampaignCityBlueprint> =
  new Map(VIETNAM_CAMPAIGN_CITIES.map((c) => [c.cityId, c]));

export const VIETNAM_CAMPAIGN_CITY_BY_NAME: ReadonlyMap<string, VietnamCampaignCityBlueprint> =
  new Map(VIETNAM_CAMPAIGN_CITIES.map((c) => [c.name, c]));

/**
 * Exact initial balance from campaign/economy.js:
 * [4200, 3200, 2800, 1800, 1400, 3500, 12500] * 3_600_000
 */
export const CAMPAIGN_INITIAL_WHOLE_BALANCE: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [4200, 3200, 2800, 1800, 1400, 3500, 12500];

export function makeInitialCampaignBalance(): CampaignResourceTuple {
  return [
    CAMPAIGN_INITIAL_WHOLE_BALANCE[0] * CAMPAIGN_HOUR_MS,
    CAMPAIGN_INITIAL_WHOLE_BALANCE[1] * CAMPAIGN_HOUR_MS,
    CAMPAIGN_INITIAL_WHOLE_BALANCE[2] * CAMPAIGN_HOUR_MS,
    CAMPAIGN_INITIAL_WHOLE_BALANCE[3] * CAMPAIGN_HOUR_MS,
    CAMPAIGN_INITIAL_WHOLE_BALANCE[4] * CAMPAIGN_HOUR_MS,
    CAMPAIGN_INITIAL_WHOLE_BALANCE[5] * CAMPAIGN_HOUR_MS,
    CAMPAIGN_INITIAL_WHOLE_BALANCE[6] * CAMPAIGN_HOUR_MS,
  ];
}

function zeroLegacyLedger(): ResourceLedger {
  return {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };
}

/**
 * Builds an authoritative initial MatchState for the modern Vietnam campaign map (60 cities).
 * Reuses the exact 2 human slots (NORTH / SOUTH), actors, auth, SQLite store, and WebSocket sync.
 */
export function createVietnamCampaignMatchState(options: {
  matchId: MatchId | string;
  title: string;
  seed: number;
  createdAtUtc: number;
  mode: MatchMode;
}): MatchState {
  const matchId = MatchIdSchema.parse(options.matchId);
  const createdAtUtc = asUtcEpochMs(options.createdAtUtc);
  const normalizedSeed = normalizeSeed(options.seed);

  const northCapital = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('Hà Nội');
  const southCapital = VIETNAM_CAMPAIGN_CITY_BY_NAME.get('TP. Hồ Chí Minh');
  if (!northCapital || !southCapital) {
    throw new Error('Missing canonical Vietnam campaign capitals in vietnamCampaignCities.json');
  }

  // Build deterministic geographic nearest-neighbor adjacency across the 60 cities
  const adjacency = new Map<RegionId, Set<RegionId>>();
  for (const city of VIETNAM_CAMPAIGN_CITIES) {
    adjacency.set(city.cityId, new Set<RegionId>());
  }
  for (const city of VIETNAM_CAMPAIGN_CITIES) {
    const nearest = VIETNAM_CAMPAIGN_CITIES.filter((other) => other.cityId !== city.cityId)
      .map((other) => ({
        cityId: other.cityId,
        distSq: (other.lon - city.lon) ** 2 + (other.lat - city.lat) ** 2,
      }))
      .sort((a, b) => a.distSq - b.distSq || (a.cityId < b.cityId ? -1 : 1))
      .slice(0, 3);
    for (const neighbor of nearest) {
      adjacency.get(city.cityId)!.add(neighbor.cityId);
      adjacency.get(neighbor.cityId)!.add(city.cityId);
    }
  }

  const regions: Record<string, Region> = {};
  const campaignCities: Record<string, CampaignCityState> = {};

  for (const bp of VIETNAM_CAMPAIGN_CITIES) {
    const ownerNationId: NationId =
      bp.initialOwnerSlot === 'NORTH' ? WORLD_NATIONS.north : WORLD_NATIONS.south;
    regions[bp.cityId] = {
      regionId: bp.cityId,
      code: `VNC-${String(bp.index + 1).padStart(2, '0')}`,
      name: bp.name,
      controllerNationId: ownerNationId,
      adjacentRegionIds: Array.from(adjacency.get(bp.cityId)!).sort(),
      supplyCapacityFp: asFixedPoint(20_000),
      influenceFp: asFixedPoint(50_000),
      infrastructureFp: asFixedPoint(10_000),
      economicOutputFp: asFixedPoint(10_000),
    };
    campaignCities[bp.cityId] = {
      cityId: bp.cityId,
      name: bp.name,
      lon: bp.lon,
      lat: bp.lat,
      capital: bp.capital,
      rank: bp.rank,
      material: bp.material,
      ownerNationId,
      factory: 0,
      office: 0,
      reserve: 0,
      jobs: [],
    };
  }

  const campaignState: CampaignMatchState = {
    startUtc: createdAtUtc,
    timeUtc: createdAtUtc,
    nextUnitNumber: 1,
    nations: {
      [WORLD_NATIONS.north]: {
        nationId: WORLD_NATIONS.north,
        balance: makeInitialCampaignBalance(),
        learned: [],
        study: null,
      },
      [WORLD_NATIONS.south]: {
        nationId: WORLD_NATIONS.south,
        balance: makeInitialCampaignBalance(),
        learned: [],
        study: null,
      },
    },
    cities: campaignCities,
    units: {},
    log: [
      {
        timeUtc: createdAtUtc,
        nationId: null,
        cityId: null,
        cityName: '',
        text: 'Mở phòng chiến dịch Việt Nam.',
      },
    ],
  };

  const hiddenIntelDigest = createHash('sha256')
    .update(`vdn-campaign-v1:${matchId}:${normalizedSeed}`)
    .digest('hex');

  const state: MatchState = MatchStateSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    matchId,
    scenarioId: VIETNAM_CAMPAIGN_SCENARIO_ID,
    title: options.title,
    version: 0,
    createdAtUtc,
    currentUtc: createdAtUtc,
    config: {
      mode: options.mode,
      secondsPerGameDay: REALTIME_SECONDS_PER_GAME_DAY,
      allowFastForward: false,
      humanSlotCount: 2,
      alternateHistoryLabel: 'FICTIONAL_ALTERNATE_HISTORY',
    },
    actors: {
      [WORLD_ACTORS.north]: {
        actorId: ActorIdSchema.parse(WORLD_ACTORS.north),
        role: 'HUMAN_PLAYER',
        slot: 'NORTH',
        nationId: WORLD_NATIONS.north,
        displayName: 'Chỉ huy Phương Bắc',
        lastSequence: 0,
        active: true,
      },
      [WORLD_ACTORS.south]: {
        actorId: ActorIdSchema.parse(WORLD_ACTORS.south),
        role: 'HUMAN_PLAYER',
        slot: 'SOUTH',
        nationId: WORLD_NATIONS.south,
        displayName: 'Chỉ huy Phương Nam',
        lastSequence: 0,
        active: true,
      },
      [WORLD_ACTORS.system]: {
        actorId: ActorIdSchema.parse(WORLD_ACTORS.system),
        role: 'SYSTEM',
        slot: null,
        nationId: null,
        displayName: 'Đồng hồ máy chủ',
        lastSequence: 0,
        active: true,
      },
    },
    nations: {
      [WORLD_NATIONS.north]: {
        nationId: WORLD_NATIONS.north,
        slot: 'NORTH',
        code: 'NORTH',
        name: 'Phương Bắc',
        capitalRegionId: northCapital.cityId,
        resources: zeroLegacyLedger(),
        stabilityFp: asFixedPoint(80_000),
        legitimacyFp: asFixedPoint(80_000),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
      [WORLD_NATIONS.south]: {
        nationId: WORLD_NATIONS.south,
        slot: 'SOUTH',
        code: 'SOUTH',
        name: 'Phương Nam',
        capitalRegionId: southCapital.cityId,
        resources: zeroLegacyLedger(),
        stabilityFp: asFixedPoint(80_000),
        legitimacyFp: asFixedPoint(80_000),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
    },
    regions,
    units: {},
    jobs: {},
    policies: {},
    treaties: {},
    resourceAudit: {
      initialTotal: zeroLegacyLedger(),
      burnedTotal: zeroLegacyLedger(),
      mintedTotal: zeroLegacyLedger(),
    },
    campaignState,
    eventSequence: 0,
    events: [],
    idempotencyReceipts: {},
    serverPrivate: {
      initialSeed: normalizedSeed,
      rngState: normalizedSeed,
      hiddenIntelDigest,
    },
  });

  assertSimulationInvariants(state);
  return state;
}
