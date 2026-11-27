import { z } from 'zod';
import {
  NationIdSchema,
  RegionIdSchema,
  UnitIdSchema,
  UtcEpochMsSchema,
} from './primitives';

/**
 * Scenario identifier distinguishing legacy 1955 72-region rooms from the
 * modern Vietnam campaign map (60 populated places, 7-resource economy,
 * mechanized research & mobilization).
 */
export const ScenarioIdSchema = z.enum(['vietnam_1955', 'vietnam_campaign_v1']);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

export const CAMPAIGN_HOUR_MS = 3_600_000;
export const CAMPAIGN_OBSERVATION_RADIUS_DEG = 1.25;

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

export const CampaignDoctrineKeySchema = z.enum(['motor', 'motor2']);
export type CampaignDoctrineKey = z.infer<typeof CampaignDoctrineKeySchema>;

export const CampaignProjectKeySchema = z.enum(['factory', 'office', 'reserve', 'motor']);
export type CampaignProjectKey = z.infer<typeof CampaignProjectKeySchema>;

export const CampaignUnitKeySchema = z.enum(['reserve', 'motor']);
export type CampaignUnitKey = z.infer<typeof CampaignUnitKeySchema>;

export const CampaignLaneSchema = z.enum(['build', 'mobilize']);
export type CampaignLane = z.infer<typeof CampaignLaneSchema>;

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
    rank: z.number().finite(),
    material: z.number().int().min(0).max(4),
    ownerNationId: NationIdSchema,
    factory: z.number().int().min(0),
    office: z.number().int().min(0),
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

export const CampaignNationStateSchema = z
  .object({
    nationId: NationIdSchema,
    balance: CampaignResourceTupleSchema,
    learned: z.array(CampaignDoctrineKeySchema),
    study: CampaignResearchJobSchema.nullable(),
  })
  .strict();
export type CampaignNationState = z.infer<typeof CampaignNationStateSchema>;

export const CampaignMatchStateSchema = z
  .object({
    startUtc: UtcEpochMsSchema,
    timeUtc: UtcEpochMsSchema,
    nextUnitNumber: z.number().int().min(1),
    nations: z.record(z.string(), CampaignNationStateSchema),
    cities: z.record(z.string(), CampaignCityStateSchema),
    units: z.record(z.string(), CampaignUnitStateSchema),
    log: z.array(CampaignLogEntrySchema),
  })
  .strict();
export type CampaignMatchState = z.infer<typeof CampaignMatchStateSchema>;

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
