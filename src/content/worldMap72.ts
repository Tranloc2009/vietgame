import { createHash } from 'node:crypto';
import {
  ActorIdSchema,
  asFixedPoint,
  asUtcEpochMs,
  CONTRACT_SCHEMA_VERSION,
  MatchIdSchema,
  MatchState,
  MatchStateSchema,
  NationIdSchema,
  REALTIME_SECONDS_PER_GAME_DAY,
  Region,
  RegionId,
  RegionIdSchema,
  UnitIdSchema,
  wholeUnitsToFixedPoint,
} from '../contracts';
import {
  RegionGeoMetadata,
  RegionGeoMetadataSchema,
  TerrainFeatureTag,
  TerrainKind,
  TransportCorridor,
  TransportCorridorSchema,
  WorldCity,
  WorldCitySchema,
  WorldPeak,
  WorldPeakSchema,
} from '../contracts/rooms';
import { assertSimulationInvariants, normalizeSeed } from '../simulation';
import rawWorldData from './geo/vietnam72WorldData.json';

export const WORLD_MAP_METADATA = {
  version: rawWorldData.metadata.version,
  regionCount: rawWorldData.metadata.regionCount,
  eraLabel: 'ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK' as const,
  modernRoadsUsedAsHistorical: false as const,
  modernAdminBordersUsedAsHistorical: false as const,
  coastlineSource: rawWorldData.metadata.coastlineSource,
  riverSource: rawWorldData.metadata.riverSource,
  elevationSource: rawWorldData.metadata.elevationSource,
  regionPartitionNotice: rawWorldData.metadata.regionPartitionNotice,
  attribution: rawWorldData.metadata.attribution,
} as const;

export const WORLD_ACTORS = {
  north: ActorIdSchema.parse('act_human_north'),
  south: ActorIdSchema.parse('act_human_south'),
  npcHighland: ActorIdSchema.parse('act_npc_highland'),
  npcBorder: ActorIdSchema.parse('act_npc_border'),
  system: ActorIdSchema.parse('act_system_clock'),
} as const;

export const WORLD_NATIONS = {
  north: NationIdSchema.parse('nat_north_dir'),
  south: NationIdSchema.parse('nat_south_rep'),
  npcHighland: NationIdSchema.parse('nat_npc_highland'),
  npcBorder: NationIdSchema.parse('nat_npc_border'),
} as const;

export interface WorldRegionFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly properties: RegionGeoMetadata & {
    readonly initialControllerNationId: string;
    readonly adjacentRegionIds: readonly string[];
  };
  readonly geometry: {
    readonly type: 'Polygon';
    readonly coordinates: readonly (readonly [number, number][])[];
  };
}

export interface WorldGeoJsonCollection {
  readonly type: 'FeatureCollection';
  readonly metadata: typeof WORLD_MAP_METADATA;
  readonly features: readonly WorldRegionFeature[];
}

export interface ContextCountryFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly properties: {
    readonly iso: string;
    readonly nameVi: string;
    readonly labelPos: readonly [number, number];
    readonly source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN';
  };
  readonly geometry: {
    readonly type: 'MultiPolygon';
    readonly coordinates: readonly (readonly (readonly [number, number][])[])[];
  };
}

export interface RiverFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly properties: {
    readonly id: string;
    readonly name: string;
    readonly source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN' | 'SUPPLEMENTARY_HYDROGRAPHIC_REFERENCE';
    readonly major: boolean;
  };
  readonly geometry: {
    readonly type: 'LineString';
    readonly coordinates: readonly [number, number][];
  };
}

export interface WorldGeographicLayers {
  readonly bounds: {
    readonly minLon: number;
    readonly maxLon: number;
    readonly minLat: number;
    readonly maxLat: number;
  };
  readonly contextCountries: {
    readonly type: 'FeatureCollection';
    readonly features: readonly ContextCountryFeature[];
  };
  readonly offshoreIslands: {
    readonly type: 'FeatureCollection';
    readonly features: readonly {
      readonly type: 'Feature';
      readonly id: string;
      readonly properties: { readonly source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN' };
      readonly geometry: {
        readonly type: 'Polygon';
        readonly coordinates: readonly (readonly [number, number][])[];
      };
    }[];
  };
  readonly rivers: {
    readonly type: 'FeatureCollection';
    readonly features: readonly RiverFeature[];
  };
  readonly cities: readonly WorldCity[];
  readonly peaks: readonly WorldPeak[];
  readonly transportCorridors: readonly TransportCorridor[];
}

function buildWorldGeoJson(): WorldGeoJsonCollection {
  const features: WorldRegionFeature[] = rawWorldData.regions.map((r) => {
    const regionId = RegionIdSchema.parse(r.regionId);
    const meta = RegionGeoMetadataSchema.parse({
      regionId,
      code: r.code,
      name: r.name,
      zone: r.zone,
      terrain: r.terrain as TerrainKind,
      terrainFeatures: r.terrainFeatures as TerrainFeatureTag[],
      elevationMeters: r.elevationMeters,
      elevationPeakMeters: r.elevationPeakMeters,
      elevationSource: r.elevationSource,
      movementCostFp: asFixedPoint(r.movementCostFp),
      forestCoverFp: asFixedPoint(r.forestCoverFp),
      urbanizationFp: asFixedPoint(r.urbanizationFp),
      hasCoastline: r.hasCoastline,
      hasMajorRiver: r.hasMajorRiver,
      economicOutputFp: wholeUnitsToFixedPoint(r.economicOutput),
      infrastructureFp: wholeUnitsToFixedPoint(r.infrastructure),
      supplyCapacityFp: wholeUnitsToFixedPoint(r.supplyCapacity),
      centroid: [r.centroid[0], r.centroid[1]],
      dataSource: WORLD_MAP_METADATA.attribution,
      eraLabel: WORLD_MAP_METADATA.eraLabel,
      modernRoadsUsedAsHistorical: false,
      modernAdminBordersUsedAsHistorical: false,
    });

    return {
      type: 'Feature',
      id: regionId,
      properties: {
        ...meta,
        initialControllerNationId: r.initialControllerNationId,
        adjacentRegionIds: [...r.adjacentRegionIds],
      },
      geometry: {
        type: 'Polygon',
        coordinates: [r.coordinates.map(([lon, lat]) => [lon, lat] as [number, number])],
      },
    };
  });

  return {
    type: 'FeatureCollection',
    metadata: WORLD_MAP_METADATA,
    features,
  };
}

function buildWorldGeographicLayers(): WorldGeographicLayers {
  const contextCountries: ContextCountryFeature[] = rawWorldData.contextCountries.map((c) => ({
    type: 'Feature',
    id: `ctx_${c.iso.toLowerCase()}`,
    properties: {
      iso: c.iso,
      nameVi: c.nameVi,
      labelPos: [c.labelPos[0], c.labelPos[1]],
      source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN',
    },
    geometry: {
      type: 'MultiPolygon',
      coordinates: c.polygons as [number, number][][][],
    },
  }));

  const offshoreIslands = rawWorldData.offshoreIslands.map((poly, idx) => ({
    type: 'Feature' as const,
    id: `isl_vn_${idx + 1}`,
    properties: { source: 'NATURAL_EARTH_10M_PUBLIC_DOMAIN' as const },
    geometry: {
      type: 'Polygon' as const,
      coordinates: poly as [number, number][][],
    },
  }));

  const rivers: RiverFeature[] = rawWorldData.rivers.map((rv) => ({
    type: 'Feature',
    id: rv.id,
    properties: {
      id: rv.id,
      name: rv.name,
      source: rv.source as
        | 'NATURAL_EARTH_10M_PUBLIC_DOMAIN'
        | 'SUPPLEMENTARY_HYDROGRAPHIC_REFERENCE',
      major: rv.major,
    },
    geometry: {
      type: 'LineString',
      coordinates: rv.coordinates.map(([lon, lat]) => [lon, lat] as [number, number]),
    },
  }));

  const cities = rawWorldData.cities.map((c) =>
    WorldCitySchema.parse({
      id: c.id,
      name: c.name,
      coords: [c.coords[0], c.coords[1]],
      tier: c.tier,
      regionId: RegionIdSchema.parse(c.regionId),
      port: 'port' in c ? Boolean((c as { port?: boolean }).port) : undefined,
      elevationMeters: c.elevationMeters,
    })
  );

  const peaks = rawWorldData.peaks.map((p) =>
    WorldPeakSchema.parse({
      name: p.name,
      coords: [p.coords[0], p.coords[1]],
      elevationMeters: p.elevationMeters,
    })
  );

  const transportCorridors = rawWorldData.transportCorridors.map((t) =>
    TransportCorridorSchema.parse({
      id: t.id,
      fromRegionId: RegionIdSchema.parse(t.fromRegionId),
      toRegionId: RegionIdSchema.parse(t.toRegionId),
      kind: t.kind,
      movementModifierFp: asFixedPoint(t.movementModifierFp),
      label: t.label,
      coordinates: t.coordinates.map(([lon, lat]) => [lon, lat] as [number, number]),
    })
  );

  return {
    bounds: rawWorldData.bounds,
    contextCountries: {
      type: 'FeatureCollection',
      features: contextCountries,
    },
    offshoreIslands: {
      type: 'FeatureCollection',
      features: offshoreIslands,
    },
    rivers: {
      type: 'FeatureCollection',
      features: rivers,
    },
    cities,
    peaks,
    transportCorridors,
  };
}

export const WORLD_MAP_72_GEOJSON: WorldGeoJsonCollection = buildWorldGeoJson();
export const WORLD_GEO_LAYERS: WorldGeographicLayers = buildWorldGeographicLayers();

export const WORLD_REGION_METADATA_BY_ID: Readonly<Record<string, RegionGeoMetadata>> =
  Object.fromEntries(
    WORLD_MAP_72_GEOJSON.features.map((f) => {
      const {
        initialControllerNationId: _c,
        adjacentRegionIds: _a,
        ...meta
      } = f.properties;
      return [f.properties.regionId, meta];
    })
  );

/**
 * Builds an authoritative 72-region multiplayer MatchState for a newly created match room.
 * Preserves all 72 existing RegionIds (reg_vn_01..reg_vn_72), 2 human slots (NORTH, SOUTH),
 * and 2 independent NPC governments (Highland & Border).
 */
export function createWorld72MatchState(options: {
  matchId: string;
  title: string;
  seed: number;
  createdAtUtc: number;
  mode: 'PRODUCTION_REALTIME' | 'PREVIEW_FIXTURE';
}): MatchState {
  const matchId = MatchIdSchema.parse(options.matchId);
  const seed = normalizeSeed(options.seed);
  const createdAtUtc = asUtcEpochMs(options.createdAtUtc);

  const regions: Record<string, Region> = {};
  for (const feature of WORLD_MAP_72_GEOJSON.features) {
    const p = feature.properties;
    regions[p.regionId] = {
      regionId: p.regionId,
      code: p.code,
      name: p.name,
      controllerNationId: NationIdSchema.parse(p.initialControllerNationId),
      adjacentRegionIds: [...p.adjacentRegionIds] as RegionId[],
      supplyCapacityFp: p.supplyCapacityFp,
      influenceFp: wholeUnitsToFixedPoint(65),
      infrastructureFp: p.infrastructureFp,
    };
  }

  const northResources = {
    food: wholeUnitsToFixedPoint(640),
    industrial: wholeUnitsToFixedPoint(520),
    treasury: wholeUnitsToFixedPoint(410),
    manpower: wholeUnitsToFixedPoint(760),
    politicalCapital: wholeUnitsToFixedPoint(120),
  };
  const southResources = {
    food: wholeUnitsToFixedPoint(680),
    industrial: wholeUnitsToFixedPoint(490),
    treasury: wholeUnitsToFixedPoint(470),
    manpower: wholeUnitsToFixedPoint(720),
    politicalCapital: wholeUnitsToFixedPoint(120),
  };
  const npcHighlandResources = {
    food: wholeUnitsToFixedPoint(210),
    industrial: wholeUnitsToFixedPoint(130),
    treasury: wholeUnitsToFixedPoint(150),
    manpower: wholeUnitsToFixedPoint(220),
    politicalCapital: wholeUnitsToFixedPoint(70),
  };
  const npcBorderResources = {
    food: wholeUnitsToFixedPoint(160),
    industrial: wholeUnitsToFixedPoint(110),
    treasury: wholeUnitsToFixedPoint(120),
    manpower: wholeUnitsToFixedPoint(180),
    politicalCapital: wholeUnitsToFixedPoint(60),
  };

  const sumKey = (k: keyof typeof northResources) =>
    asFixedPoint(
      (northResources[k] as number) +
        (southResources[k] as number) +
        (npcHighlandResources[k] as number) +
        (npcBorderResources[k] as number)
    );

  const initialTotal = {
    food: sumKey('food'),
    industrial: sumKey('industrial'),
    treasury: sumKey('treasury'),
    manpower: sumKey('manpower'),
    politicalCapital: sumKey('politicalCapital'),
  };

  const zeroLedger = {
    food: asFixedPoint(0),
    industrial: asFixedPoint(0),
    treasury: asFixedPoint(0),
    manpower: asFixedPoint(0),
    politicalCapital: asFixedPoint(0),
  };

  const hiddenIntelDigest = createHash('sha256')
    .update(`world72-secret:${matchId}:${seed}`, 'utf8')
    .digest('hex');

  const northCapital = RegionIdSchema.parse('reg_vn_11');
  const southCapital = RegionIdSchema.parse('reg_vn_59');
  const highlandCapital = RegionIdSchema.parse('reg_vn_38');
  const borderCapital = RegionIdSchema.parse('reg_vn_01');

  const state: MatchState = MatchStateSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    matchId,
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
        actorId: WORLD_ACTORS.north,
        role: 'HUMAN_PLAYER',
        slot: 'NORTH',
        nationId: WORLD_NATIONS.north,
        displayName: 'Chính quyền Phương Bắc (Slot Người Thật)',
        lastSequence: 0,
        active: true,
      },
      [WORLD_ACTORS.south]: {
        actorId: WORLD_ACTORS.south,
        role: 'HUMAN_PLAYER',
        slot: 'SOUTH',
        nationId: WORLD_NATIONS.south,
        displayName: 'Chính quyền Phương Nam (Slot Người Thật)',
        lastSequence: 0,
        active: true,
      },
      [WORLD_ACTORS.npcHighland]: {
        actorId: WORLD_ACTORS.npcHighland,
        role: 'INDEPENDENT_NPC',
        slot: 'NPC',
        nationId: WORLD_NATIONS.npcHighland,
        displayName: 'Hội Đồng Cao Nguyên Độc Lập (NPC)',
        lastSequence: 0,
        active: true,
      },
      [WORLD_ACTORS.npcBorder]: {
        actorId: WORLD_ACTORS.npcBorder,
        role: 'INDEPENDENT_NPC',
        slot: 'NPC',
        nationId: WORLD_NATIONS.npcBorder,
        displayName: 'Liên Minh Biên Giới Độc Lập (NPC)',
        lastSequence: 0,
        active: true,
      },
      [WORLD_ACTORS.system]: {
        actorId: WORLD_ACTORS.system,
        role: 'SYSTEM',
        slot: null,
        nationId: null,
        displayName: 'Authoritative UTC Scheduler',
        lastSequence: 0,
        active: true,
      },
    },
    nations: {
      [WORLD_NATIONS.north]: {
        nationId: WORLD_NATIONS.north,
        slot: 'NORTH',
        code: 'NDR',
        name: 'Liên Minh Phương Bắc (Hư cấu)',
        capitalRegionId: northCapital,
        resources: northResources,
        stabilityFp: wholeUnitsToFixedPoint(68),
        legitimacyFp: wholeUnitsToFixedPoint(71),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
      [WORLD_NATIONS.south]: {
        nationId: WORLD_NATIONS.south,
        slot: 'SOUTH',
        code: 'SRP',
        name: 'Cộng Hòa Phương Nam (Hư cấu)',
        capitalRegionId: southCapital,
        resources: southResources,
        stabilityFp: wholeUnitsToFixedPoint(66),
        legitimacyFp: wholeUnitsToFixedPoint(70),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
      [WORLD_NATIONS.npcHighland]: {
        nationId: WORLD_NATIONS.npcHighland,
        slot: 'NPC',
        code: 'HAC',
        name: 'Hội Đồng Cao Nguyên Độc Lập (NPC)',
        capitalRegionId: highlandCapital,
        resources: npcHighlandResources,
        stabilityFp: wholeUnitsToFixedPoint(74),
        legitimacyFp: wholeUnitsToFixedPoint(72),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
      [WORLD_NATIONS.npcBorder]: {
        nationId: WORLD_NATIONS.npcBorder,
        slot: 'NPC',
        code: 'BDR',
        name: 'Liên Minh Biên Giới Độc Lập (NPC)',
        capitalRegionId: borderCapital,
        resources: npcBorderResources,
        stabilityFp: wholeUnitsToFixedPoint(71),
        legitimacyFp: wholeUnitsToFixedPoint(68),
        fictionalDisclaimer: 'ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY',
      },
    },
    regions,
    units: {
      [UnitIdSchema.parse('unt_north_hq_01')]: {
        unitId: UnitIdSchema.parse('unt_north_hq_01'),
        ownerNationId: WORLD_NATIONS.north,
        regionId: northCapital,
        category: 'LOGISTICS_ABSTRACT',
        strengthFp: wholeUnitsToFixedPoint(12),
        readinessFp: wholeUnitsToFixedPoint(92),
        supplyFp: wholeUnitsToFixedPoint(6),
      },
      [UnitIdSchema.parse('unt_south_hq_01')]: {
        unitId: UnitIdSchema.parse('unt_south_hq_01'),
        ownerNationId: WORLD_NATIONS.south,
        regionId: southCapital,
        category: 'LOGISTICS_ABSTRACT',
        strengthFp: wholeUnitsToFixedPoint(12),
        readinessFp: wholeUnitsToFixedPoint(90),
        supplyFp: wholeUnitsToFixedPoint(6),
      },
      [UnitIdSchema.parse('unt_npc_highland_01')]: {
        unitId: UnitIdSchema.parse('unt_npc_highland_01'),
        ownerNationId: WORLD_NATIONS.npcHighland,
        regionId: highlandCapital,
        category: 'CIVIC_CORPS',
        strengthFp: wholeUnitsToFixedPoint(6),
        readinessFp: wholeUnitsToFixedPoint(84),
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
