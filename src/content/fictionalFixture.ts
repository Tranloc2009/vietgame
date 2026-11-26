import { createHash } from 'node:crypto';
import {
  ActorIdSchema,
  asFixedPoint,
  asUtcEpochMs,
  Command,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  IdempotencyKeySchema,
  JobIdSchema,
  MatchIdSchema,
  MatchState,
  MatchStateSchema,
  NationIdSchema,
  REALTIME_SECONDS_PER_GAME_DAY,
  RegionIdSchema,
  UnitIdSchema,
  wholeUnitsToFixedPoint,
} from '../contracts';
import { assertSimulationInvariants, normalizeSeed, ReplayLogEntry } from '../simulation';

export const FIXTURE_MATCH_ID = MatchIdSchema.parse('mch_preview_alt_1955');
export const FIXTURE_DEFAULT_SEED = 19550720;
export const FIXTURE_BASE_EPOCH_MS = 1_764_000_000_000; // Deterministic UTC epoch anchor

export const FIXTURE_ACTORS = {
  north: ActorIdSchema.parse('act_human_north'),
  south: ActorIdSchema.parse('act_human_south'),
  npcHighland: ActorIdSchema.parse('act_npc_highland'),
  system: ActorIdSchema.parse('act_system_clock'),
} as const;

export const FIXTURE_NATIONS = {
  north: NationIdSchema.parse('nat_north_dir'),
  south: NationIdSchema.parse('nat_south_rep'),
  npcHighland: NationIdSchema.parse('nat_npc_highland'),
} as const;

export const FIXTURE_REGIONS = {
  northDelta: RegionIdSchema.parse('reg_north_delta'),
  centralPass: RegionIdSchema.parse('reg_central_pass'),
  highlandPlateau: RegionIdSchema.parse('reg_highland_plateau'),
  southBasin: RegionIdSchema.parse('reg_south_basin'),
} as const;

export const FIXTURE_UNITS = {
  northCorps: UnitIdSchema.parse('unt_north_corps_01'),
  southCorps: UnitIdSchema.parse('unt_south_corps_01'),
  npcGarrison: UnitIdSchema.parse('unt_npc_garrison_01'),
} as const;

/**
 * Creates a deterministic two-faction fictional alternate-history match fixture
 * plus one independent NPC actor. All quantities are abstract fixed-point integers
 * and are explicitly non-historical gameplay values.
 */
export function createTwoFactionFictionalFixture(options?: {
  matchId?: string;
  seed?: number;
  createdAtUtc?: number;
}): MatchState {
  const matchId = MatchIdSchema.parse(options?.matchId ?? FIXTURE_MATCH_ID);
  const seed = normalizeSeed(options?.seed ?? FIXTURE_DEFAULT_SEED);
  const createdAtUtc = asUtcEpochMs(options?.createdAtUtc ?? FIXTURE_BASE_EPOCH_MS);

  const northResources = {
    food: wholeUnitsToFixedPoint(500),
    industrial: wholeUnitsToFixedPoint(420),
    treasury: wholeUnitsToFixedPoint(350),
    manpower: wholeUnitsToFixedPoint(600),
    politicalCapital: wholeUnitsToFixedPoint(100),
  };

  const southResources = {
    food: wholeUnitsToFixedPoint(520),
    industrial: wholeUnitsToFixedPoint(400),
    treasury: wholeUnitsToFixedPoint(380),
    manpower: wholeUnitsToFixedPoint(580),
    politicalCapital: wholeUnitsToFixedPoint(100),
  };

  const npcResources = {
    food: wholeUnitsToFixedPoint(180),
    industrial: wholeUnitsToFixedPoint(120),
    treasury: wholeUnitsToFixedPoint(140),
    manpower: wholeUnitsToFixedPoint(200),
    politicalCapital: wholeUnitsToFixedPoint(60),
  };

  const initialTotal = {
    food: asFixedPoint(
      (northResources.food as number) +
        (southResources.food as number) +
        (npcResources.food as number)
    ),
    industrial: asFixedPoint(
      (northResources.industrial as number) +
        (southResources.industrial as number) +
        (npcResources.industrial as number)
    ),
    treasury: asFixedPoint(
      (northResources.treasury as number) +
        (southResources.treasury as number) +
        (npcResources.treasury as number)
    ),
    manpower: asFixedPoint(
      (northResources.manpower as number) +
        (southResources.manpower as number) +
        (npcResources.manpower as number)
    ),
    politicalCapital: asFixedPoint(
      (northResources.politicalCapital as number) +
        (southResources.politicalCapital as number) +
        (npcResources.politicalCapital as number)
    ),
  };

  const zeroLedger = {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };

  const hiddenIntelDigest = createHash('sha256')
    .update(`server-secret:${matchId}:${seed}`, 'utf8')
    .digest('hex');

  const state: MatchState = MatchStateSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    matchId,
    title: 'Fixture Hư Cấu 2 Phe — Lịch Sử Thay Thế (Preview)',
    version: 0,
    createdAtUtc,
    currentUtc: createdAtUtc,
    config: {
      mode: 'PREVIEW_FIXTURE',
      secondsPerGameDay: REALTIME_SECONDS_PER_GAME_DAY,
      allowFastForward: false,
      humanSlotCount: 2,
      alternateHistoryLabel: 'FICTIONAL_ALTERNATE_HISTORY',
    },
    actors: {
      [FIXTURE_ACTORS.north]: {
        actorId: FIXTURE_ACTORS.north,
        role: 'HUMAN_PLAYER',
        slot: 'NORTH',
        nationId: FIXTURE_NATIONS.north,
        displayName: 'Slot Người Chơi — Phương Bắc (Hư cấu)',
        lastSequence: 0,
        active: true,
      },
      [FIXTURE_ACTORS.south]: {
        actorId: FIXTURE_ACTORS.south,
        role: 'HUMAN_PLAYER',
        slot: 'SOUTH',
        nationId: FIXTURE_NATIONS.south,
        displayName: 'Slot Người Chơi — Phương Nam (Hư cấu)',
        lastSequence: 0,
        active: true,
      },
      [FIXTURE_ACTORS.npcHighland]: {
        actorId: FIXTURE_ACTORS.npcHighland,
        role: 'INDEPENDENT_NPC',
        slot: 'NPC',
        nationId: FIXTURE_NATIONS.npcHighland,
        displayName: 'NPC Độc Lập — Hội Đồng Cao Nguyên (Hư cấu)',
        lastSequence: 0,
        active: true,
      },
      [FIXTURE_ACTORS.system]: {
        actorId: FIXTURE_ACTORS.system,
        role: 'SYSTEM',
        slot: null,
        nationId: null,
        displayName: 'Authoritative Realtime Clock',
        lastSequence: 0,
        active: true,
      },
    },
    nations: {
      [FIXTURE_NATIONS.north]: {
        nationId: FIXTURE_NATIONS.north,
        slot: 'NORTH',
        code: 'NDR',
        name: 'Liên Minh Phương Bắc (Hư cấu)',
        capitalRegionId: FIXTURE_REGIONS.northDelta,
        resources: northResources,
        stabilityFp: wholeUnitsToFixedPoint(68),
        legitimacyFp: wholeUnitsToFixedPoint(70),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
      [FIXTURE_NATIONS.south]: {
        nationId: FIXTURE_NATIONS.south,
        slot: 'SOUTH',
        code: 'SRP',
        name: 'Cộng Hòa Phương Nam (Hư cấu)',
        capitalRegionId: FIXTURE_REGIONS.southBasin,
        resources: southResources,
        stabilityFp: wholeUnitsToFixedPoint(66),
        legitimacyFp: wholeUnitsToFixedPoint(69),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
      [FIXTURE_NATIONS.npcHighland]: {
        nationId: FIXTURE_NATIONS.npcHighland,
        slot: 'NPC',
        code: 'HAC',
        name: 'Hội Đồng Cao Nguyên Độc Lập (NPC)',
        capitalRegionId: FIXTURE_REGIONS.highlandPlateau,
        resources: npcResources,
        stabilityFp: wholeUnitsToFixedPoint(74),
        legitimacyFp: wholeUnitsToFixedPoint(72),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
    },
    regions: {
      [FIXTURE_REGIONS.northDelta]: {
        regionId: FIXTURE_REGIONS.northDelta,
        code: 'R01',
        name: 'Vùng Đồng Bằng Bắc (Trừu tượng)',
        controllerNationId: FIXTURE_NATIONS.north,
        adjacentRegionIds: [FIXTURE_REGIONS.centralPass, FIXTURE_REGIONS.highlandPlateau],
        supplyCapacityFp: wholeUnitsToFixedPoint(100),
        influenceFp: wholeUnitsToFixedPoint(80),
        infrastructureFp: wholeUnitsToFixedPoint(60),
      },
      [FIXTURE_REGIONS.centralPass]: {
        regionId: FIXTURE_REGIONS.centralPass,
        code: 'R02',
        name: 'Hành Lang Trung Bộ (Trừu tượng)',
        controllerNationId: FIXTURE_NATIONS.north,
        adjacentRegionIds: [
          FIXTURE_REGIONS.northDelta,
          FIXTURE_REGIONS.highlandPlateau,
          FIXTURE_REGIONS.southBasin,
        ],
        supplyCapacityFp: wholeUnitsToFixedPoint(70),
        influenceFp: wholeUnitsToFixedPoint(55),
        infrastructureFp: wholeUnitsToFixedPoint(45),
      },
      [FIXTURE_REGIONS.highlandPlateau]: {
        regionId: FIXTURE_REGIONS.highlandPlateau,
        code: 'R03',
        name: 'Cao Nguyên Trung Lập (Trừu tượng)',
        controllerNationId: FIXTURE_NATIONS.npcHighland,
        adjacentRegionIds: [
          FIXTURE_REGIONS.northDelta,
          FIXTURE_REGIONS.centralPass,
          FIXTURE_REGIONS.southBasin,
        ],
        supplyCapacityFp: wholeUnitsToFixedPoint(60),
        influenceFp: wholeUnitsToFixedPoint(75),
        infrastructureFp: wholeUnitsToFixedPoint(40),
      },
      [FIXTURE_REGIONS.southBasin]: {
        regionId: FIXTURE_REGIONS.southBasin,
        code: 'R04',
        name: 'Vùng Châu Thổ Nam (Trừu tượng)',
        controllerNationId: FIXTURE_NATIONS.south,
        adjacentRegionIds: [FIXTURE_REGIONS.centralPass, FIXTURE_REGIONS.highlandPlateau],
        supplyCapacityFp: wholeUnitsToFixedPoint(105),
        influenceFp: wholeUnitsToFixedPoint(82),
        infrastructureFp: wholeUnitsToFixedPoint(62),
      },
    },
    units: {
      [FIXTURE_UNITS.northCorps]: {
        unitId: FIXTURE_UNITS.northCorps,
        ownerNationId: FIXTURE_NATIONS.north,
        regionId: FIXTURE_REGIONS.northDelta,
        category: 'LOGISTICS_ABSTRACT',
        strengthFp: wholeUnitsToFixedPoint(10),
        readinessFp: wholeUnitsToFixedPoint(90),
        supplyFp: wholeUnitsToFixedPoint(5),
      },
      [FIXTURE_UNITS.southCorps]: {
        unitId: FIXTURE_UNITS.southCorps,
        ownerNationId: FIXTURE_NATIONS.south,
        regionId: FIXTURE_REGIONS.southBasin,
        category: 'LOGISTICS_ABSTRACT',
        strengthFp: wholeUnitsToFixedPoint(10),
        readinessFp: wholeUnitsToFixedPoint(90),
        supplyFp: wholeUnitsToFixedPoint(5),
      },
      [FIXTURE_UNITS.npcGarrison]: {
        unitId: FIXTURE_UNITS.npcGarrison,
        ownerNationId: FIXTURE_NATIONS.npcHighland,
        regionId: FIXTURE_REGIONS.highlandPlateau,
        category: 'CIVIC_CORPS',
        strengthFp: wholeUnitsToFixedPoint(6),
        readinessFp: wholeUnitsToFixedPoint(85),
        supplyFp: wholeUnitsToFixedPoint(4),
      },
    },
    jobs: {},
    policies: {},
    treaties: {},
    resourceAudit: {
      initialTotal,
      burnedTotal: zeroLedger,
      mintedTotal: zeroLedger,
    },
    eventSequence: 0,
    events: [],
    idempotencyReceipts: {},
    serverPrivate: {
      initialSeed: seed,
      rngState: seed,
      hiddenIntelDigest,
    },
  });

  assertSimulationInvariants(state);
  return state;
}

/**
 * Deterministic sample command log used by replay & simultaneous-event tests.
 */
export function createDeterministicFixtureCommandLog(
  baseEpochMs: number = FIXTURE_BASE_EPOCH_MS
): readonly ReplayLogEntry[] {
  const t1 = asUtcEpochMs(baseEpochMs + 60_000);
  const t2 = asUtcEpochMs(baseEpochMs + 120_000);
  const t3 = asUtcEpochMs(baseEpochMs + 180_000);
  const tComplete = asUtcEpochMs(baseEpochMs + 720_000); // Both scheduled jobs complete at exact same UTC timestamp!

  const cmd1: Command = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse('cmd_fx_001'),
    matchId: FIXTURE_MATCH_ID,
    actorId: FIXTURE_ACTORS.north,
    idempotencyKey: IdempotencyKeySchema.parse('idem_fx_001_north_job'),
    sequence: 1,
    expectedVersion: 0,
    issuedAtUtc: t1,
    payload: {
      type: 'SCHEDULE_JOB',
      jobId: JobIdSchema.parse('job_zeta_north'),
      nationId: FIXTURE_NATIONS.north,
      kind: 'LOGISTICS_REFORM',
      durationMs: 660_000, // Completes at baseEpochMs + 720_000
      costResource: 'industrial',
      costAmountFp: wholeUnitsToFixedPoint(25),
    },
  };

  const cmd2: Command = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse('cmd_fx_002'),
    matchId: FIXTURE_MATCH_ID,
    actorId: FIXTURE_ACTORS.south,
    idempotencyKey: IdempotencyKeySchema.parse('idem_fx_002_south_job'),
    sequence: 1,
    expectedVersion: 1,
    issuedAtUtc: t2,
    payload: {
      type: 'SCHEDULE_JOB',
      jobId: JobIdSchema.parse('job_alpha_south'),
      nationId: FIXTURE_NATIONS.south,
      kind: 'INFRASTRUCTURE_WORK',
      durationMs: 600_000, // Completes at EXACT SAME timestamp baseEpochMs + 720_000!
      costResource: 'treasury',
      costAmountFp: wholeUnitsToFixedPoint(30),
    },
  };

  const cmd3: Command = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse('cmd_fx_003'),
    matchId: FIXTURE_MATCH_ID,
    actorId: FIXTURE_ACTORS.north,
    idempotencyKey: IdempotencyKeySchema.parse('idem_fx_003_aid'),
    sequence: 2,
    expectedVersion: 2,
    issuedAtUtc: t3,
    payload: {
      type: 'TRANSFER_RESOURCE',
      fromNationId: FIXTURE_NATIONS.north,
      toNationId: FIXTURE_NATIONS.npcHighland,
      resource: 'food',
      amountFp: wholeUnitsToFixedPoint(15),
      reason: 'Abstract highland transit supply agreement',
    },
  };

  const cmd4: Command = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse('cmd_fx_004'),
    matchId: FIXTURE_MATCH_ID,
    actorId: FIXTURE_ACTORS.system,
    idempotencyKey: IdempotencyKeySchema.parse('idem_fx_004_tick'),
    sequence: 1,
    expectedVersion: 3,
    issuedAtUtc: tComplete,
    payload: {
      type: 'ADVANCE_REALTIME_TICK',
      targetUtc: tComplete,
    },
  };

  return [
    { command: cmd1, appliedAtUtc: t1 },
    { command: cmd2, appliedAtUtc: t2 },
    { command: cmd3, appliedAtUtc: t3 },
    { command: cmd4, appliedAtUtc: tComplete },
  ];
}
