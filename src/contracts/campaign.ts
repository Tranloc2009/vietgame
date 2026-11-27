import { z } from 'zod';
import {
  NationIdSchema,
  RegionIdSchema,
  UnitIdSchema,
  UtcEpochMsSchema,
} from './primitives';

const CampaignWinnerSlotSchema = z.enum(['NORTH', 'SOUTH']);

/**
 * Scenario identifier distinguishing legacy 1955 72-region rooms from the
 * modern Vietnam campaign map (60 populated places, 7-resource economy,
 * WW3 research, mobilization, diplomacy, combat, conquest & victory).
 */
export const ScenarioIdSchema = z.enum(['vietnam_1955', 'vietnam_campaign_v1']);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

export const CAMPAIGN_HOUR_MS = 3_600_000;
export const CAMPAIGN_OBSERVATION_RADIUS_DEG = 1.25;
export const CAMPAIGN_MELEE_RANGE_DEG = 0.09; // ~10 km; strictly below min 0.118° inter-city spacing
export const CAMPAIGN_RANGED_RANGE_DEG = 1.25;
export const CAMPAIGN_NAVAL_RANGE_DEG = 1.5;
export const CAMPAIGN_SAM_RANGE_DEG = 1.6;
export const CAMPAIGN_SUB_RANGE_DEG = 1.35;
export const CAMPAIGN_AIR_RANGE_DEG = 2.0;
export const CAMPAIGN_COMBAT_TICK_MS = 10_000;
export const CAMPAIGN_HEAL_TICK_MS = 30_000;
export const CAMPAIGN_MORALE_TICK_MS = 60_000;
export const CAMPAIGN_AI_DECISION_INTERVAL_MS = 20_000;
export const CAMPAIGN_VICTORY_TARGET_VP = 400;

const CampaignSafeIntSchema = z
  .number()
  .int('Campaign integer must be an exact integer')
  .refine((v) => Number.isSafeInteger(v) && v >= 0, {
    message: 'Campaign integer must be a non-negative safe integer',
  });

/**
 * Exact 7-resource tuple matching campaign/economy.js:
 * [0: Tiếp tế, 1: Linh kiện, 2: Nhiên liệu, 3: Điện tử, 4: Vật liệu hiếm, 5: Nhân lực, 6: Tiền]
 */
export const CampaignResourceTupleSchema = z.tuple([
  CampaignSafeIntSchema,
  CampaignSafeIntSchema,
  CampaignSafeIntSchema,
  CampaignSafeIntSchema,
  CampaignSafeIntSchema,
  CampaignSafeIntSchema,
  CampaignSafeIntSchema,
]);
export type CampaignResourceTuple = z.infer<typeof CampaignResourceTupleSchema>;

export const CampaignDoctrineKeySchema = z.enum([
  'motor',
  'motor2',
  'recon',
  'tank',
  'artillery',
  'sam',
  'fighter',
  'corvette',
  'submarine',
]);
export type CampaignDoctrineKey = z.infer<typeof CampaignDoctrineKeySchema>;

export const CampaignProjectKeySchema = z.enum([
  'factory',
  'office',
  'base',
  'bunker',
  'hospital',
  'airbase',
  'port',
  'reserve',
  'motor',
  'recon',
  'tank',
  'artillery',
  'sam',
  'fighter',
  'corvette',
  'submarine',
]);
export type CampaignProjectKey = z.infer<typeof CampaignProjectKeySchema>;

export const CampaignUnitKeySchema = z.enum([
  'reserve',
  'motor',
  'recon',
  'tank',
  'artillery',
  'sam',
  'fighter',
  'corvette',
  'submarine',
]);
export type CampaignUnitKey = z.infer<typeof CampaignUnitKeySchema>;

export const CampaignLaneSchema = z.enum(['build', 'mobilize']);
export type CampaignLane = z.infer<typeof CampaignLaneSchema>;

export const CampaignRelationStatusSchema = z.enum(['PEACE', 'WAR']);
export type CampaignRelationStatus = z.infer<typeof CampaignRelationStatusSchema>;

export const CampaignDiplomacyActionSchema = z.enum([
  'DECLARE_WAR',
  'PROPOSE_PEACE',
  'ACCEPT_PEACE',
  'PROPOSE_INTEL',
  'ACCEPT_INTEL',
  'END_INTEL',
]);
export type CampaignDiplomacyAction = z.infer<typeof CampaignDiplomacyActionSchema>;

export const CampaignGeoPointSchema = z
  .object({
    lon: z.number().finite(),
    lat: z.number().finite(),
  })
  .strict();
export type CampaignGeoPoint = z.infer<typeof CampaignGeoPointSchema>;

export const CampaignResearchJobSchema = z
  .object({
    key: CampaignDoctrineKeySchema,
    startUtc: UtcEpochMsSchema,
    endUtc: UtcEpochMsSchema,
  })
  .strict();
export type CampaignResearchJob = z.infer<typeof CampaignResearchJobSchema>;

export const CampaignCityJobSchema = z
  .object({
    key: CampaignProjectKeySchema,
    lane: CampaignLaneSchema,
    cost: CampaignResourceTupleSchema,
    startUtc: UtcEpochMsSchema,
    endUtc: UtcEpochMsSchema,
  })
  .strict();
export type CampaignCityJob = z.infer<typeof CampaignCityJobSchema>;

export const CampaignCityStateSchema = z
  .object({
    cityId: RegionIdSchema,
    name: z.string().min(1).max(80),
    lon: z.number().finite(),
    lat: z.number().finite(),
    capital: z.boolean(),
    coastal: z.boolean().default(false),
    rank: z.number().finite(),
    material: z.number().int().min(0).max(4),
    ownerNationId: NationIdSchema,
    factory: z.number().int().min(0),
    office: z.number().int().min(0),
    base: z.number().int().min(0).default(0),
    bunker: z.number().int().min(0).default(0),
    hospital: z.number().int().min(0).default(0),
    airbase: z.number().int().min(0).default(0),
    port: z.number().int().min(0).default(0),
    morale: z.number().int().min(0).max(100).default(85),
    lastMoraleUtc: UtcEpochMsSchema.nullable().default(null),
    reserve: z.number().int().min(0),
    jobs: z.array(CampaignCityJobSchema),
  })
  .strict();
export type CampaignCityState = z.infer<typeof CampaignCityStateSchema>;

export const CampaignUnitTripSchema = z
  .object({
    toCityId: RegionIdSchema,
    toCityName: z.string().min(1).max(80),
    points: z.array(CampaignGeoPointSchema).min(2),
    startUtc: UtcEpochMsSchema,
    endUtc: UtcEpochMsSchema,
  })
  .strict();
export type CampaignUnitTrip = z.infer<typeof CampaignUnitTripSchema>;

export const CampaignUnitStateSchema = z
  .object({
    unitId: UnitIdSchema,
    displayNumber: z.number().int().min(1),
    key: CampaignUnitKeySchema,
    ownerNationId: NationIdSchema,
    cityId: RegionIdSchema.nullable(),
    cityName: z.string().min(1).max(80).nullable(),
    position: CampaignGeoPointSchema,
    trip: CampaignUnitTripSchema.nullable(),
    rev: z.number().int().min(0),
    hp: z.number().int().min(0).default(20),
    maxHp: z.number().int().min(1).default(20),
    inCombat: z.boolean().default(false),
    lastCombatUtc: UtcEpochMsSchema.nullable().default(null),
    lastHealUtc: UtcEpochMsSchema.nullable().default(null),
    stackId: z.string().min(3).max(40).nullable().default(null),
  })
  .strict();
export type CampaignUnitState = z.infer<typeof CampaignUnitStateSchema>;

export const CampaignLogEntrySchema = z
  .object({
    timeUtc: UtcEpochMsSchema,
    nationId: NationIdSchema.nullable(),
    cityId: RegionIdSchema.nullable(),
    cityName: z.string().max(80),
    text: z.string().min(1).max(240),
  })
  .strict();
export type CampaignLogEntry = z.infer<typeof CampaignLogEntrySchema>;

export const CampaignBattleReportSchema = z
  .object({
    reportId: z.string().min(3).max(80),
    occurredAtUtc: UtcEpochMsSchema,
    kind: z.enum(['MELEE', 'BOMBARDMENT', 'AIRSTRIKE']),
    locationName: z.string().min(1).max(80),
    attackerNationId: NationIdSchema,
    defenderNationId: NationIdSchema,
    attackerUnitIds: z.array(UnitIdSchema),
    defenderUnitIds: z.array(UnitIdSchema),
    damageToDefenders: z.number().int().min(0),
    damageToAttackers: z.number().int().min(0),
    destroyedUnitIds: z.array(UnitIdSchema),
    summary: z.string().min(1).max(240),
  })
  .strict();
export type CampaignBattleReport = z.infer<typeof CampaignBattleReportSchema>;

export const CampaignNewsItemSchema = z
  .object({
    newsId: z.string().min(3).max(80),
    timeUtc: UtcEpochMsSchema,
    category: z.enum(['DIPLOMACY', 'COMBAT', 'CONQUEST', 'VICTORY', 'SYSTEM']),
    headline: z.string().min(1).max(160),
    detail: z.string().min(1).max(280),
  })
  .strict();
export type CampaignNewsItem = z.infer<typeof CampaignNewsItemSchema>;

export const CampaignDiplomacyStateSchema = z
  .object({
    relation: CampaignRelationStatusSchema,
    peaceProposedByNationId: NationIdSchema.nullable(),
    intelProposedByNationId: NationIdSchema.nullable(),
    sharedIntelActive: z.boolean(),
    updatedAtUtc: UtcEpochMsSchema,
  })
  .strict();
export type CampaignDiplomacyState = z.infer<typeof CampaignDiplomacyStateSchema>;

export const CampaignVictoryStateSchema = z
  .object({
    winnerNationId: NationIdSchema,
    winnerSlot: CampaignWinnerSlotSchema,
    reason: z.enum(['VICTORY_POINTS', 'TOTAL_CONQUEST', 'SURRENDER']),
    achievedAtUtc: UtcEpochMsSchema,
    targetVp: z.number().int().min(1),
    scoresByNation: z.record(z.string(), z.number().int().min(0)),
  })
  .strict();
export type CampaignVictoryState = z.infer<typeof CampaignVictoryStateSchema>;

export const CampaignNationStateSchema = z
  .object({
    nationId: NationIdSchema,
    balance: CampaignResourceTupleSchema,
    learned: z.array(CampaignDoctrineKeySchema),
    study: CampaignResearchJobSchema.nullable(),
    stats: z
      .object({
        unitsMobilized: z.number().int().min(0),
        unitsLost: z.number().int().min(0),
        enemyUnitsDestroyed: z.number().int().min(0),
        citiesCaptured: z.number().int().min(0),
      })
      .strict()
      .default({
        unitsMobilized: 0,
        unitsLost: 0,
        enemyUnitsDestroyed: 0,
        citiesCaptured: 0,
      }),
  })
  .strict();
export type CampaignNationState = z.infer<typeof CampaignNationStateSchema>;

export const CampaignMatchStateSchema = z
  .object({
    startUtc: UtcEpochMsSchema,
    timeUtc: UtcEpochMsSchema,
    nextUnitNumber: z.number().int().min(1),
    nextReportNumber: z.number().int().min(1).default(1),
    victoryTargetVp: z.number().int().min(1).default(CAMPAIGN_VICTORY_TARGET_VP),
    victoryPointsByNation: z.record(z.string(), z.number().int().min(0)).default({}),
    diplomacy: CampaignDiplomacyStateSchema.optional(),
    victory: CampaignVictoryStateSchema.nullable().default(null),
    aiControlledNationId: NationIdSchema.nullable().default(null),
    aiLastDecisionUtc: UtcEpochMsSchema.nullable().default(null),
    nations: z.record(z.string(), CampaignNationStateSchema),
    cities: z.record(z.string(), CampaignCityStateSchema),
    units: z.record(z.string(), CampaignUnitStateSchema),
    log: z.array(CampaignLogEntrySchema),
    news: z.array(CampaignNewsItemSchema).default([]),
    battleReports: z.array(CampaignBattleReportSchema).default([]),
  })
  .strict();
export type CampaignMatchState = z.infer<typeof CampaignMatchStateSchema>;

/**
 * Vision radius per unit type in degrees (matches Supremacy WW3 recon role).
 */
export function getCampaignUnitVisionRadiusDeg(key: CampaignUnitKey): number {
  switch (key) {
    case 'fighter':
      return 2.6;
    case 'recon':
      return 2.25;
    case 'corvette':
      return 2.0;
    case 'sam':
    case 'submarine':
      return 1.8;
    case 'artillery':
      return 1.45;
    case 'motor':
    case 'tank':
      return 1.35;
    default:
      return CAMPAIGN_OBSERVATION_RADIUS_DEG;
  }
}

/**
 * Pure interpolation helper shared between simulation engine and viewer fog-of-war projection.
 */
export function interpolateCampaignUnitPosition(
  unit: CampaignUnitState,
  atUtc: number
): CampaignGeoPoint {
  if (!unit.trip) {
    return unit.position;
  }
  const points = unit.trip.points;
  const span = unit.trip.endUtc - unit.trip.startUtc;
  if (span <= 0 || points.length < 2) {
    return points[points.length - 1] ?? unit.position;
  }
  const rawRatio = Math.max(0, Math.min(1, (atUtc - unit.trip.startUtc) / span));
  const scaled = rawRatio * (points.length - 1);
  const idx = Math.min(points.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = points[idx];
  const b = points[idx + 1];
  return {
    lon: Math.round((a.lon + (b.lon - a.lon) * frac) * 1_000_000) / 1_000_000,
    lat: Math.round((a.lat + (b.lat - a.lat) * frac) * 1_000_000) / 1_000_000,
  };
}
