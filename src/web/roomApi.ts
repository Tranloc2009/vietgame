import { useEffect, useRef, useState } from 'react';
import {
  BudgetWarningCode,
  Command,
  ConstructionQueueItem,
  DomainEvent,
  EconomicLedgerEntry,
  ExtendedLedgerEntry,
  ExtendedResourceBasket,
  ExtendedResourceType,
  FacilityInstance,
  FacilityTier,
  FacilityType,
  FilteredClientMatchView,
  FiscalStatus,
  FixedPointInt,
  HumanSlot,
  MatchDeltaEnvelope,
  MatchRoomSummary,
  NationBudgetState,
  NationExtendedStock,
  NationId,
  ProductionOrder,
  PublicUser,
  RegionGeoMetadata,
  RegionId,
  ResourceLedger,
  ResourceReservation,
  SignedExtendedResourceBasket,
  SignedFixedPointInt,
  TransportCorridor,
  UtcEpochMs,
  WorldCity,
  WorldPeak,
} from '../contracts';
import {
  applyIncomingDelta,
  computeReconnectBackoffMs,
  createInitialDeltaSyncState,
  DeltaSyncState,
} from './syncClient';

export interface WorldMapFeature {
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

export interface WorldMapGeoJson {
  readonly type: 'FeatureCollection';
  readonly metadata: {
    readonly version: string;
    readonly regionCount: number;
    readonly eraLabel: string;
    readonly modernRoadsUsedAsHistorical: false;
    readonly modernAdminBordersUsedAsHistorical: false;
    readonly coastlineSource: string;
    readonly riverSource: string;
    readonly elevationSource: string;
    readonly regionPartitionNotice: string;
    readonly attribution: string;
  };
  readonly features: readonly WorldMapFeature[];
}

export interface WorldMapLayers {
  readonly bounds: {
    readonly minLon: number;
    readonly maxLon: number;
    readonly minLat: number;
    readonly maxLat: number;
  };
  readonly contextCountries: {
    readonly type: 'FeatureCollection';
    readonly features: readonly {
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
    }[];
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
    readonly features: readonly {
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
    }[];
  };
  readonly cities: readonly WorldCity[];
  readonly peaks: readonly WorldPeak[];
  readonly transportCorridors: readonly TransportCorridor[];
}

export interface WorldMapBundle {
  readonly geojson: WorldMapGeoJson;
  readonly layers: WorldMapLayers;
}

export interface AuthResponse {
  readonly ok: true;
  readonly user: PublicUser;
  readonly token: string;
}

export interface SnapshotSummary {
  readonly snapshotId: string;
  readonly matchId: string;
  readonly version: number;
  readonly stateHash: string;
  readonly createdAtUtc: number;
}

export interface RoomDetailResponse {
  readonly ok: true;
  readonly room: MatchRoomSummary;
  readonly match: FilteredClientMatchView;
  readonly snapshots?: readonly SnapshotSummary[];
}

export interface RoomSyncResponse {
  readonly ok: true;
  readonly matchId: string;
  readonly currentSequence: number;
  readonly version: number;
  readonly stateHash: string;
  readonly missedEvents: readonly DomainEvent[];
  readonly room: MatchRoomSummary;
  readonly match: FilteredClientMatchView;
  readonly serverUtc: number;
}

export interface BackupAuditSummary {
  readonly backupVersion: string;
  readonly matchId: string;
  readonly exportedAtUtc: number;
  readonly version: number;
  readonly stateHash: string;
  readonly commandCount: number;
  readonly snapshots: readonly SnapshotSummary[];
  readonly secretsIncluded: false;
}

export interface RoomReplayReport {
  readonly matchId: string;
  readonly verified: boolean;
  readonly storedHash: string;
  readonly replayedHash: string;
  readonly replayedCommandCount: number;
  readonly version: number;
}

export interface ClientSignedResourceLedger {
  readonly food: SignedFixedPointInt;
  readonly industrial: SignedFixedPointInt;
  readonly treasury: SignedFixedPointInt;
  readonly manpower: SignedFixedPointInt;
  readonly politicalCapital: SignedFixedPointInt;
}

export interface ClientRegionEconomicContribution {
  readonly regionId: RegionId;
  readonly name: string;
  readonly economicOutputFp: FixedPointInt;
  readonly infrastructureFp: FixedPointInt;
  readonly supplyCapacityFp: FixedPointInt;
  readonly dailyContribution: ResourceLedger;
}

export interface ClientNationEconomicForecast {
  readonly nationId: NationId;
  readonly nationName: string;
  readonly controlledRegionCount: number;
  readonly activeUnitCount: number;
  readonly activePolicyCount: number;
  readonly taxRateBps: number;
  readonly settlementIntervalMs: number;
  readonly lastSettlementUtc: UtcEpochMs;
  readonly nextSettlementUtc: UtcEpochMs;
  readonly currentBalance: ResourceLedger;
  readonly stockpileCaps: ResourceLedger;
  readonly grossDaily: ResourceLedger;
  readonly upkeepDaily: ResourceLedger;
  readonly netDailySigned: ClientSignedResourceLedger;
  readonly grossPerCycle: ResourceLedger;
  readonly upkeepPerCycle: ResourceLedger;
  readonly topRegions: readonly ClientRegionEconomicContribution[];
}

export interface ClientPhase03CapacitySummary {
  readonly laborCapacityFp: FixedPointInt;
  readonly laborUsedFp: FixedPointInt;
  readonly energyCapacityFp: FixedPointInt;
  readonly energyUsedFp: FixedPointInt;
}

export interface ClientPhase03FiscalForecast24h {
  readonly taxBaseDailyFp: FixedPointInt;
  readonly effectiveTaxRateBps: number;
  readonly targetTaxRateBps: number;
  readonly taxComplianceBps: number;
  readonly effectiveYieldBps: number;
  readonly taxRevenueDailyFp: FixedPointInt;
  readonly mandatoryUpkeepDailyFp: FixedPointInt;
  readonly debtInterestDailyFp: FixedPointInt;
  readonly totalMandatoryDailyFp: FixedPointInt;
  readonly netMoneyDailySignedFp: number;
  readonly projectedMoney24hFp: FixedPointInt;
  readonly projectedDebt24hFp: FixedPointInt;
  readonly hoursUntilCashDepletion: number | null;
  readonly creditHeadroomFp: FixedPointInt;
  readonly activityThrottleBps: number;
  readonly fiscalStatus: FiscalStatus;
  readonly warnings: readonly { readonly code: BudgetWarningCode; readonly messageVi: string }[];
}

export interface ClientPhase03FacilityTierSpec {
  readonly tier: FacilityTier;
  readonly buildDurationMs: number;
  readonly buildCost: ExtendedResourceBasket;
  readonly laborCapacityProvidedFp: FixedPointInt;
  readonly energyCapacityProvidedFp: FixedPointInt;
  readonly laborDemandFp: FixedPointInt;
  readonly energyDemandFp: FixedPointInt;
  readonly storageCapBonus: ExtendedResourceBasket;
  readonly hourlyInputs: ExtendedResourceBasket;
  readonly hourlyOutputs: ExtendedResourceBasket;
  readonly productionRecipe: {
    readonly outputResource: ExtendedResourceType;
    readonly outputPerBatchFp: FixedPointInt;
    readonly inputPerBatch: ExtendedResourceBasket;
    readonly durationPerBatchMs: number;
    readonly labelVi: string;
  } | null;
}

export interface ClientPhase03CatalogEntry {
  readonly type: FacilityType;
  readonly nameVi: string;
  readonly roleSummaryVi: string;
  readonly tiers: Readonly<Record<FacilityTier, ClientPhase03FacilityTierSpec>>;
}

export interface ClientPhase03ReconciliationRow {
  readonly resource: ExtendedResourceType;
  readonly totalActiveAvailableFp: FixedPointInt;
  readonly totalReservedFp: FixedPointInt;
  readonly totalBurnedFp: FixedPointInt;
  readonly totalInitialFp: FixedPointInt;
  readonly totalMintedFp: FixedPointInt;
  readonly totalDebtFp: FixedPointInt;
  readonly reconciled: boolean;
}

export interface ClientPhase03NationReport {
  readonly nationId: NationId;
  readonly stock: NationExtendedStock;
  readonly dailyGross: ExtendedResourceBasket;
  readonly dailyUpkeep: ExtendedResourceBasket;
  readonly dailyNetSigned: SignedExtendedResourceBasket;
  readonly capacity: ClientPhase03CapacitySummary;
  readonly budget: NationBudgetState;
  readonly fiscalForecast24h: ClientPhase03FiscalForecast24h;
  readonly facilities: readonly FacilityInstance[];
  readonly constructionQueue: readonly ConstructionQueueItem[];
  readonly productionQueue: readonly ProductionOrder[];
  readonly activeReservations: readonly ResourceReservation[];
  readonly ledger: readonly ExtendedLedgerEntry[];
  readonly reconciliation: {
    readonly allReconciled: boolean;
    readonly rows: readonly ClientPhase03ReconciliationRow[];
  };
  readonly catalog: Readonly<Record<FacilityType, ClientPhase03CatalogEntry>>;
}

export interface RoomEconomyResponse {
  readonly ok: true;
  readonly matchId: string;
  readonly version: number;
  readonly slot: HumanSlot;
  readonly nationId: NationId;
  readonly forecast: ClientNationEconomicForecast;
  readonly ledger: readonly EconomicLedgerEntry[];
  readonly phase03: ClientPhase03NationReport | null;
  readonly serverUtc: UtcEpochMs;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { ok?: boolean; reason?: string; code?: string };
  if (!res.ok) {
    const msg =
      (data as { reason?: string }).reason ??
      `Yêu cầu thất bại (HTTP ${res.status}).`;
    throw new Error(msg);
  }
  return data;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchWorldMap(): Promise<WorldMapBundle> {
  const res = await fetch('/api/world/map', { cache: 'no-store' });
  const data = await parseJsonOrThrow<{
    ok: true;
    geojson: WorldMapGeoJson;
    layers: WorldMapLayers;
  }>(res);
  return { geojson: data.geojson, layers: data.layers };
}

export async function registerAccount(payload: {
  username: string;
  displayName: string;
  password: string;
}): Promise<AuthResponse> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<AuthResponse>(res);
}

export async function loginAccount(payload: {
  username: string;
  password: string;
}): Promise<AuthResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<AuthResponse>(res);
}

export async function logoutAccount(token: string): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: authHeaders(token),
  });
}

export async function listMyRooms(token: string): Promise<MatchRoomSummary[]> {
  const res = await fetch('/api/rooms', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await parseJsonOrThrow<{ ok: true; rooms: MatchRoomSummary[] }>(res);
  return data.rooms;
}

export async function createRoom(
  token: string,
  payload: { title: string; preferredSlot: HumanSlot }
): Promise<RoomDetailResponse> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<RoomDetailResponse>(res);
}

export async function joinRoomByCode(
  token: string,
  payload: { inviteCode: string; preferredSlot?: HumanSlot }
): Promise<RoomDetailResponse & { reconnected: boolean }> {
  const res = await fetch('/api/rooms/join', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<RoomDetailResponse & { reconnected: boolean }>(res);
}

export async function fetchRoomDetail(
  token: string,
  matchId: string
): Promise<RoomDetailResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return parseJsonOrThrow<RoomDetailResponse>(res);
}

export async function setRoomReady(
  token: string,
  matchId: string,
  ready: boolean
): Promise<{ ok: true; room: MatchRoomSummary }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/ready`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ ready }),
  });
  return parseJsonOrThrow<{ ok: true; room: MatchRoomSummary }>(res);
}

export async function startRoomMatch(
  token: string,
  matchId: string
): Promise<{ ok: true; room: MatchRoomSummary }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/start`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return parseJsonOrThrow<{ ok: true; room: MatchRoomSummary }>(res);
}

export async function surrenderRoomMatch(
  token: string,
  matchId: string
): Promise<{ ok: true; room: MatchRoomSummary }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/surrender`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return parseJsonOrThrow<{ ok: true; room: MatchRoomSummary }>(res);
}

export async function submitRoomCommand(
  token: string,
  matchId: string,
  command: Command
): Promise<{
  ok: true;
  idempotentDuplicate: boolean;
  version: number;
  stateHash: string;
  emittedEvents: readonly DomainEvent[];
  match: FilteredClientMatchView;
}> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/commands`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(command),
  });
  return parseJsonOrThrow(res);
}

export async function syncRoomState(
  token: string,
  matchId: string,
  sinceSequence?: number
): Promise<RoomSyncResponse> {
  const qs = typeof sinceSequence === 'number' ? `?sinceSequence=${sinceSequence}` : '';
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/sync${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return parseJsonOrThrow<RoomSyncResponse>(res);
}

export async function verifyRoomReplay(
  token: string,
  matchId: string
): Promise<RoomReplayReport> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/verify-replay`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  const data = await parseJsonOrThrow<{ ok: true; report: RoomReplayReport }>(res);
  return data.report;
}

export async function fetchRoomBackupSummary(
  token: string,
  matchId: string
): Promise<BackupAuditSummary> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/backup-summary`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await parseJsonOrThrow<{ ok: true; summary: BackupAuditSummary }>(res);
  return data.summary;
}

export async function fetchRoomEconomy(
  token: string,
  matchId: string
): Promise<RoomEconomyResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(matchId)}/economy`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return parseJsonOrThrow<RoomEconomyResponse>(res);
}

export interface RoomSyncTelemetry {
  readonly status: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  readonly reconnectAttempt: number;
  readonly nextBackoffMs: number | null;
  readonly lastSequence: number;
  readonly resyncCount: number;
  readonly lastError: string | null;
}

/**
 * Authenticated WebSocket room synchronizer (P02-04):
 * - Subscribes with Bearer token -> receives permission-filtered `room:snapshot`
 * - Applies sequenced `room:delta` via pure `applyIncomingDelta`
 * - Automatically requests `room:resync` on sequence gap
 * - Reconnects with deterministic exponential backoff (`computeReconnectBackoffMs`)
 */
export function useRoomSyncSocket(options: {
  token: string | null;
  matchId: string | null;
  onSnapshot: (room: MatchRoomSummary, match: FilteredClientMatchView) => void;
  onRoomStatus: (room: MatchRoomSummary) => void;
  onDeltaSynced: (matchId: string, deltaState: DeltaSyncState) => void;
}): RoomSyncTelemetry {
  const { token, matchId, onSnapshot, onRoomStatus, onDeltaSynced } = options;

  const [telemetry, setTelemetry] = useState<RoomSyncTelemetry>({
    status: 'idle',
    reconnectAttempt: 0,
    nextBackoffMs: null,
    lastSequence: 0,
    resyncCount: 0,
    lastError: null,
  });

  const deltaStateRef = useRef<DeltaSyncState>(createInitialDeltaSyncState(0, 0, '', []));
  const callbacksRef = useRef({ onSnapshot, onRoomStatus, onDeltaSynced });
  callbacksRef.current = { onSnapshot, onRoomStatus, onDeltaSynced };

  useEffect(() => {
    if (!token || !matchId) {
      setTelemetry({
        status: 'idle',
        reconnectAttempt: 0,
        nextBackoffMs: null,
        lastSequence: 0,
        resyncCount: 0,
        lastError: null,
      });
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;

      setTelemetry((prev) => ({
        ...prev,
        status: attempt === 0 ? 'connecting' : 'reconnecting',
      }));

      ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        if (cancelled) return;
        attempt = 0;
        setTelemetry((prev) => ({
          ...prev,
          status: 'connected',
          reconnectAttempt: 0,
          nextBackoffMs: null,
          lastError: null,
        }));
        ws?.send(
          JSON.stringify({
            type: 'room:subscribe',
            token,
            matchId,
            sinceSequence: deltaStateRef.current.lastAppliedSequence,
          })
        );
      });

      ws.addEventListener('message', (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (msg.type === 'room:snapshot' && msg.matchId === matchId) {
            const room = msg.room as MatchRoomSummary;
            const match = msg.match as FilteredClientMatchView;
            deltaStateRef.current = createInitialDeltaSyncState(
              match.eventSequence,
              match.version,
              match.stateHash,
              match.events
            );
            setTelemetry((prev) => ({
              ...prev,
              lastSequence: match.eventSequence,
              lastError: null,
            }));
            callbacksRef.current.onSnapshot(room, match);
          } else if (msg.type === 'room:status' && msg.matchId === matchId) {
            callbacksRef.current.onRoomStatus(msg.room as MatchRoomSummary);
          } else if (msg.type === 'room:delta' && msg.matchId === matchId) {
            const delta = msg as unknown as MatchDeltaEnvelope;
            const outcome = applyIncomingDelta(deltaStateRef.current, {
              fromSequence: delta.fromSequence,
              toSequence: delta.toSequence,
              version: delta.version,
              stateHash: delta.stateHash,
              events: delta.events,
            });
            deltaStateRef.current = outcome.state;

            if (outcome.status === 'GAP_DETECTED_RESYNC_REQUIRED') {
              setTelemetry((prev) => ({
                ...prev,
                resyncCount: prev.resyncCount + 1,
              }));
              ws?.send(
                JSON.stringify({
                  type: 'room:resync',
                  matchId,
                  sinceSequence: outcome.state.lastAppliedSequence,
                })
              );
            } else if (outcome.status === 'APPLIED') {
              setTelemetry((prev) => ({
                ...prev,
                lastSequence: outcome.state.lastAppliedSequence,
              }));
              callbacksRef.current.onDeltaSynced(matchId, outcome.state);
            }
          } else if (msg.type === 'room:error') {
            setTelemetry((prev) => ({
              ...prev,
              lastError: typeof msg.reason === 'string' ? msg.reason : 'Lỗi đồng bộ phòng.',
            }));
          }
        } catch {
          // Ignore malformed non-JSON frames
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        const delayMs = computeReconnectBackoffMs(attempt);
        attempt += 1;
        setTelemetry((prev) => ({
          ...prev,
          status: 'reconnecting',
          reconnectAttempt: attempt,
          nextBackoffMs: delayMs,
        }));
        reconnectTimer = window.setTimeout(connect, delayMs);
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [token, matchId]);

  return telemetry;
}
