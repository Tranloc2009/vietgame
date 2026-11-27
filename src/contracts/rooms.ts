import { z } from 'zod';
import {
  ActorIdSchema,
  ClientMatchViewSchema,
  DomainEvent,
  DomainEventSchema,
  FixedPointIntSchema,
  HumanSlotSchema,
  MatchIdSchema,
  MatchState,
  NationIdSchema,
  RegionIdSchema,
  UtcEpochMsSchema,
} from './index';

export const UserIdSchema = z
  .string()
  .regex(/^usr_[a-z0-9][a-z0-9_-]{2,62}$/, 'UserId must start with usr_')
  .brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

export const UsernameSchema = z
  .string()
  .trim()
  .min(3, 'Tên đăng nhập tối thiểu 3 ký tự')
  .max(32, 'Tên đăng nhập tối đa 32 ký tự')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Tên đăng nhập chỉ gồm chữ, số và ký tự _ . -');

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(2, 'Tên hiển thị tối thiểu 2 ký tự')
  .max(48, 'Tên hiển thị tối đa 48 ký tự');

export const PasswordSchema = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(128, 'Mật khẩu tối đa 128 ký tự');

export const InviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^VDN-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Mã mời phải theo định dạng VDN-XXXX-XXXX');

export const RoomStatusSchema = z.enum(['LOBBY', 'ACTIVE', 'ENDED']);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const RegisterPayloadSchema = z
  .object({
    username: UsernameSchema,
    displayName: DisplayNameSchema,
    password: PasswordSchema,
  })
  .strict();

export const LoginPayloadSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .strict();

export const CreateRoomPayloadSchema = z
  .object({
    title: z.string().trim().min(3).max(96),
    preferredSlot: HumanSlotSchema.default('NORTH'),
  })
  .strict();

export const JoinRoomPayloadSchema = z
  .object({
    inviteCode: InviteCodeSchema,
    preferredSlot: HumanSlotSchema.optional(),
  })
  .strict();

export const ToggleReadyPayloadSchema = z
  .object({
    ready: z.boolean(),
  })
  .strict();

export const PublicUserSchema = z
  .object({
    userId: UserIdSchema,
    username: z.string(),
    displayName: z.string(),
  })
  .strict();
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const RoomSlotInfoSchema = z
  .object({
    slot: HumanSlotSchema,
    userId: UserIdSchema.nullable(),
    displayName: z.string().nullable(),
    actorId: ActorIdSchema,
    nationId: NationIdSchema,
    ready: z.boolean(),
  })
  .strict();
export type RoomSlotInfo = z.infer<typeof RoomSlotInfoSchema>;

export const MatchRoomSummarySchema = z
  .object({
    matchId: MatchIdSchema,
    inviteCode: z.string(),
    title: z.string(),
    status: RoomStatusSchema,
    lockedAtUtc: UtcEpochMsSchema.nullable(),
    winnerSlot: HumanSlotSchema.nullable(),
    endedReason: z.string().nullable(),
    slots: z.object({
      NORTH: RoomSlotInfoSchema,
      SOUTH: RoomSlotInfoSchema,
    }),
    viewerSlot: HumanSlotSchema.nullable(),
    viewerActorId: ActorIdSchema.nullable(),
    viewerNationId: NationIdSchema.nullable(),
    createdAtUtc: UtcEpochMsSchema,
    updatedAtUtc: UtcEpochMsSchema,
  })
  .strict();
export type MatchRoomSummary = z.infer<typeof MatchRoomSummarySchema>;

export const TerrainKindSchema = z.enum([
  'COASTAL_DELTA',
  'RIVER_BASIN',
  'HIGHLANDS',
  'MOUNTAIN_PASS',
  'URBAN_CORE',
  'JUNGLE_CORRIDOR',
]);
export type TerrainKind = z.infer<typeof TerrainKindSchema>;

export const TerrainFeatureTagSchema = z.enum([
  'MOUNTAIN',
  'HILLS',
  'PLAIN',
  'FOREST',
  'RIVER',
  'COAST',
  'URBAN',
]);
export type TerrainFeatureTag = z.infer<typeof TerrainFeatureTagSchema>;

export const TransportKindSchema = z.enum([
  'PRIMARY_ROAD',
  'SECONDARY_ROAD',
  'RAILWAY',
  'RIVER_CROSSING',
]);
export type TransportKind = z.infer<typeof TransportKindSchema>;

export const MapLayerModeSchema = z.enum(['POLITICAL', 'TERRAIN', 'ECONOMY', 'INFRASTRUCTURE']);
export type MapLayerMode = z.infer<typeof MapLayerModeSchema>;

export const PlannedFutureLayerModeSchema = z.enum([
  'MILITARY',
  'WEATHER',
  'POLITICAL_INFLUENCE',
]);
export type PlannedFutureLayerMode = z.infer<typeof PlannedFutureLayerModeSchema>;

export const RegionGeoMetadataSchema = z
  .object({
    regionId: RegionIdSchema,
    code: z.string(),
    name: z.string(),
    zone: z.enum(['NORTH_SECTOR', 'CENTRAL_FRONTIER', 'HIGHLAND_NEUTRAL', 'SOUTH_SECTOR']),
    terrain: TerrainKindSchema,
    terrainFeatures: z.array(TerrainFeatureTagSchema),
    elevationMeters: z.number().int().min(0).max(3500),
    elevationPeakMeters: z.number().int().min(0).max(3500),
    elevationSource: z.string(),
    movementCostFp: FixedPointIntSchema,
    forestCoverFp: FixedPointIntSchema,
    urbanizationFp: FixedPointIntSchema,
    hasCoastline: z.boolean(),
    hasMajorRiver: z.boolean(),
    economicOutputFp: FixedPointIntSchema,
    infrastructureFp: FixedPointIntSchema,
    supplyCapacityFp: FixedPointIntSchema,
    centroid: z.tuple([z.number(), z.number()]),
    dataSource: z.string(),
    eraLabel: z.literal('ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK'),
    modernRoadsUsedAsHistorical: z.literal(false),
    modernAdminBordersUsedAsHistorical: z.literal(false),
  })
  .strict();
export type RegionGeoMetadata = z.infer<typeof RegionGeoMetadataSchema>;

export const WorldCitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    coords: z.tuple([z.number(), z.number()]),
    tier: z.enum(['CAPITAL', 'MAJOR', 'STRATEGIC_TOWN']),
    regionId: RegionIdSchema,
    port: z.boolean().optional(),
    elevationMeters: z.number().int().min(0).max(3500),
  })
  .strict();
export type WorldCity = z.infer<typeof WorldCitySchema>;

export const WorldPeakSchema = z
  .object({
    name: z.string(),
    coords: z.tuple([z.number(), z.number()]),
    elevationMeters: z.number().int().min(0).max(3500),
  })
  .strict();
export type WorldPeak = z.infer<typeof WorldPeakSchema>;

export const TransportCorridorSchema = z
  .object({
    id: z.string(),
    fromRegionId: RegionIdSchema,
    toRegionId: RegionIdSchema,
    kind: TransportKindSchema,
    movementModifierFp: FixedPointIntSchema,
    label: z.string(),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  })
  .strict();
export type TransportCorridor = z.infer<typeof TransportCorridorSchema>;

/**
 * Permission-filtered client snapshot for multiplayer sync (P02-04).
 * Strips `serverPrivate` AND strips opposing faction's private unit readiness/supply fog-of-war.
 */
export const FilteredClientMatchViewSchema = ClientMatchViewSchema.extend({
  viewerSlot: HumanSlotSchema.nullable(),
  viewerNationId: NationIdSchema.nullable(),
  redactedUnitIds: z.array(z.string()),
});
export type FilteredClientMatchView = z.infer<typeof FilteredClientMatchViewSchema>;

export const MatchDeltaEnvelopeSchema = z
  .object({
    type: z.literal('room:delta'),
    matchId: MatchIdSchema,
    fromSequence: z.number().int().min(1),
    toSequence: z.number().int().min(1),
    version: z.number().int().min(0),
    stateHash: z.string().length(64),
    events: z.array(DomainEventSchema),
    serverUtc: UtcEpochMsSchema,
  })
  .strict();
export type MatchDeltaEnvelope = z.infer<typeof MatchDeltaEnvelopeSchema>;

/** Filters economy event payloads without renumbering the match's sequence cursor. */
export function projectRoomEventsForViewer(
  events: readonly DomainEvent[],
  viewerNationId: string | null
): DomainEvent[] {
  return events.flatMap((event): DomainEvent[] => {
    const payload = event.payload;
    switch (payload.type) {
      case 'RESOURCES_RESERVED':
      case 'RESERVATION_SETTLED':
      case 'BUDGET_POLICY_UPDATED':
      case 'CREDIT_UPDATED':
      case 'CONSTRUCTION_QUEUED':
      case 'CONSTRUCTION_COMPLETED':
      case 'CONSTRUCTION_CANCELLED':
      case 'PRODUCTION_QUEUED':
      case 'PRODUCTION_COMPLETED':
      case 'PRODUCTION_CANCELLED':
      case 'FACILITY_STATUS_CHANGED':
        return payload.nationId === viewerNationId ? [event] : [];
      case 'PHASE03_CYCLE_SETTLED':
        // The national report already carries the viewer's own capacity and alerts.
        return [{ ...event, payload: { ...payload, austerityNationIds: [], pausedFacilityIds: [] } }];
      default:
        return [event];
    }
  });
}

/** Projects a room snapshot with viewer-scoped economy data and masked unit details. */
export function projectMatchForViewer(
  state: MatchState,
  stateHash: string,
  viewerSlot: 'NORTH' | 'SOUTH' | null,
  viewerNationId: string | null
): FilteredClientMatchView {
  const { serverPrivate: _stripped, ...publicFields } = state;
  const redactedUnitIds: string[] = [];
  const filteredUnits: MatchState['units'] = {};

  for (const [unitId, unit] of Object.entries(publicFields.units)) {
    if (viewerNationId && unit.ownerNationId !== viewerNationId) {
      redactedUnitIds.push(unitId);
      filteredUnits[unitId] = {
        ...unit,
        readinessFp: 0 as typeof unit.readinessFp,
        supplyFp: 0 as typeof unit.supplyFp,
      };
    } else {
      filteredUnits[unitId] = unit;
    }
  }

  const filteredLedger =
    publicFields.economicLedger === undefined
      ? undefined
      : viewerNationId
        ? publicFields.economicLedger.filter((entry) => entry.nationId === viewerNationId)
        : [];

  const filteredPhase03 =
    publicFields.phase03Economy === undefined
      ? undefined
      : {
          ...publicFields.phase03Economy,
          stocksByNation: viewerNationId && publicFields.phase03Economy.stocksByNation[viewerNationId]
            ? { [viewerNationId]: publicFields.phase03Economy.stocksByNation[viewerNationId] }
            : {},
          budgetsByNation: viewerNationId && publicFields.phase03Economy.budgetsByNation[viewerNationId]
            ? { [viewerNationId]: publicFields.phase03Economy.budgetsByNation[viewerNationId] }
            : {},
          reservations: viewerNationId
            ? Object.fromEntries(
                Object.entries(publicFields.phase03Economy.reservations).filter(
                  ([, r]) => r.ownerNationId === viewerNationId
                )
              )
            : {},
          ledger: viewerNationId
            ? publicFields.phase03Economy.ledger.filter((e) => e.nationId === viewerNationId)
            : [],
          facilities: viewerNationId
            ? Object.fromEntries(
                Object.entries(publicFields.phase03Economy.facilities).filter(
                  ([, f]) => f.ownerNationId === viewerNationId
                )
              )
            : {},
          constructionQueue: viewerNationId
            ? Object.fromEntries(
                Object.entries(publicFields.phase03Economy.constructionQueue).filter(
                  ([, c]) => c.ownerNationId === viewerNationId
                )
              )
            : {},
          productionQueue: viewerNationId
            ? Object.fromEntries(
                Object.entries(publicFields.phase03Economy.productionQueue).filter(
                  ([, p]) => p.ownerNationId === viewerNationId
                )
              )
            : {},
        };

  return FilteredClientMatchViewSchema.parse({
    ...publicFields,
    units: filteredUnits,
    events: projectRoomEventsForViewer(publicFields.events, viewerNationId),
    ...(filteredLedger !== undefined ? { economicLedger: filteredLedger } : {}),
    ...(filteredPhase03 !== undefined ? { phase03Economy: filteredPhase03 } : {}),
    stateHash,
    viewerSlot,
    viewerNationId,
    redactedUnitIds: redactedUnitIds.sort(),
  });
}
