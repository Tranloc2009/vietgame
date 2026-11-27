import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  Flag,
  KeyRound,
  Lock,
  LogOut,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import {
  asUtcEpochMs,
  ClientMatchView,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  FilteredClientMatchView,
  fpFormat,
  HumanSlot,
  IdempotencyKeySchema,
  JobIdSchema,
  MatchIdSchema,
  MatchRoomSummary,
  NationIdSchema,
  PublicUser,
  wholeUnitsToFixedPoint,
} from '../contracts';
import { HealthPayload, WsLiveState } from './api';
import { DiplomacyDrawer } from './DiplomacyDrawer';
import { LeftNavRail, WorkspaceDrawerId } from './components/LeftNavRail';
import { TopCommandBar } from './components/TopCommandBar';
import { RoomEconomyDrawer, type RoomCommandFactory } from './RoomEconomyDrawer';
import { MatchSimulationPanel } from './MatchSimulationPanel';
import {
  BackupAuditSummary,
  createRoom,
  fetchRoomBackupSummary,
  fetchRoomDetail,
  fetchMovementPreview,
  fetchWorldMap,
  joinRoomByCode,
  listMyRooms,
  loginAccount,
  logoutAccount,
  registerAccount,
  RoomReplayReport,
  setRoomReady,
  SnapshotSummary,
  startRoomMatch,
  submitRoomCommand,
  surrenderRoomMatch,
  syncRoomState,
  useRoomSyncSocket,
  verifyRoomReplay,
  WorldMapGeoJson,
  WorldMapLayers,
} from './roomApi';
import { StrategicMap } from './StrategicMap';
import { DeltaSyncState } from './syncClient';
import { SystemStatusPanel } from './SystemStatusPanel';

interface MultiplayerWorkspaceProps {
  readonly health: HealthPayload | null;
  readonly healthLoading: boolean;
  readonly healthError: string | null;
  readonly foundationWs: WsLiveState;
  readonly foundationMatch: ClientMatchView | null;
  readonly foundationMatchLoading: boolean;
  readonly onRefreshFoundation: () => void;
  readonly onFoundationMatchLoaded: (m: ClientMatchView) => void;
}

function formatUtc(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function isCompactMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || (window.innerHeight < 500 && window.innerWidth < 1024);
}

function useResponsiveMobileFlag(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(isCompactMobileViewport);

  useEffect(() => {
    const update = () => setIsMobile(isCompactMobileViewport());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return isMobile;
}

export function MultiplayerWorkspace({
  health,
  healthLoading,
  healthError,
  foundationWs,
  foundationMatch,
  foundationMatchLoading,
  onRefreshFoundation,
  onFoundationMatchLoaded,
}: MultiplayerWorkspaceProps) {
  const isMobile = useResponsiveMobileFlag();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [activeDrawer, setActiveDrawer] = useState<WorkspaceDrawerId>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // World Map GeoJSON & Geographic Context Layers (P02-03, P02-05, P02-06)
  const [geojson, setGeojson] = useState<WorldMapGeoJson | null>(null);
  const [worldLayers, setWorldLayers] = useState<WorldMapLayers | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  // Auth Session strictly in React memory (NEVER localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Room List, Create & Join
  const [myRooms, setMyRooms] = useState<MatchRoomSummary[]>([]);
  const [newRoomTitle, setNewRoomTitle] = useState('Chiến Dịch 1955 — Phòng 2 Người');
  const [preferredSlot, setPreferredSlot] = useState<HumanSlot>('NORTH');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);

  // Active Room & Permission-Filtered Match State
  const [activeRoom, setActiveRoom] = useState<MatchRoomSummary | null>(null);
  const [activeMatch, setActiveMatch] = useState<FilteredClientMatchView | null>(null);
  const [snapshots, setSnapshots] = useState<readonly SnapshotSummary[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const commandInFlight = useRef(false);
  const [economyRegionId, setEconomyRegionId] = useState<string | null>(null);
  const [replayReport, setReplayReport] = useState<RoomReplayReport | null>(null);
  const [backupSummary, setBackupSummary] = useState<BackupAuditSummary | null>(null);

  // Sync fullscreen document state
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void rootRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // Load static world geography once (NEVER refetched on server ticks!)
  useEffect(() => {
    let active = true;
    setMapLoading(true);
    fetchWorldMap()
      .then((bundle) => {
        if (active) {
          setGeojson(bundle.geojson);
          setWorldLayers(bundle.layers);
          setMapError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setMapError(err instanceof Error ? err.message : 'Không tải được GeoJSON bản đồ.');
        }
      })
      .finally(() => {
        if (active) setMapLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshMyRooms = useCallback(async (sessionToken: string) => {
    try {
      const list = await listMyRooms(sessionToken);
      setMyRooms(list);
    } catch {
      // Non-fatal
    }
  }, []);

  const openRoom = useCallback(async (sessionToken: string, matchId: string) => {
    setRoomBusy(true);
    setRoomError(null);
    setReplayReport(null);
    setBackupSummary(null);
    setConfirmSurrender(false);
    try {
      const detail = await fetchRoomDetail(sessionToken, matchId);
      setActiveRoom(detail.room);
      setActiveMatch(detail.match);
      setSnapshots(detail.snapshots ?? []);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không thể mở phòng đấu.');
    } finally {
      setRoomBusy(false);
    }
  }, []);

  // Live Authenticated WebSocket Sync (P02-04)
  const handleWsSnapshot = useCallback(
    (room: MatchRoomSummary, match: FilteredClientMatchView) => {
      setActiveRoom(room);
      setActiveMatch(match);
    },
    []
  );

  const handleWsRoomStatus = useCallback((room: MatchRoomSummary) => {
    setActiveRoom(room);
    setMyRooms((prev) => {
      const idx = prev.findIndex((r) => r.matchId === room.matchId);
      if (idx === -1) return [room, ...prev];
      const next = [...prev];
      next[idx] = room;
      return next;
    });
  }, []);

  const handleWsDeltaSynced = useCallback(
    (matchId: string, _deltaState: DeltaSyncState) => {
      if (!token) return;
      void fetchRoomDetail(token, matchId)
        .then((detail) => {
          setActiveRoom(detail.room);
          setActiveMatch(detail.match);
          setSnapshots(detail.snapshots ?? []);
        })
        .catch(() => {});
    },
    [token]
  );

  const syncTelemetry = useRoomSyncSocket({
    token,
    matchId: activeRoom?.matchId ?? null,
    onSnapshot: handleWsSnapshot,
    onRoomStatus: handleWsRoomStatus,
    onDeltaSynced: handleWsDeltaSynced,
  });

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    setRoomNotice(null);
    try {
      const res =
        authMode === 'register'
          ? await registerAccount({ username, displayName, password })
          : await loginAccount({ username, password });
      setToken(res.token);
      setUser(res.user);
      setPassword('');
      await refreshMyRooms(res.token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Xác thực thất bại.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      await logoutAccount(token).catch(() => {});
    }
    setToken(null);
    setUser(null);
    setMyRooms([]);
    setActiveRoom(null);
    setActiveMatch(null);
    setSnapshots([]);
    setReplayReport(null);
    setBackupSummary(null);
    setConfirmSurrender(false);
  };

  const handleCreateRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setRoomBusy(true);
    setRoomError(null);
    setRoomNotice(null);
    try {
      const created = await createRoom(token, {
        title: newRoomTitle.trim() || 'Chiến Dịch 1955',
        preferredSlot,
      });
      setActiveRoom(created.room);
      setActiveMatch(created.match);
      setSnapshots([]);
      setReplayReport(null);
      setBackupSummary(null);
      setRoomNotice(`Đã tạo phòng với mã mời ${created.room.inviteCode}.`);
      await refreshMyRooms(token);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không thể tạo phòng.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleJoinRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setRoomBusy(true);
    setRoomError(null);
    setRoomNotice(null);
    try {
      const joined = await joinRoomByCode(token, {
        inviteCode: inviteCodeInput.trim().toUpperCase(),
      });
      setActiveRoom(joined.room);
      setActiveMatch(joined.match);
      setInviteCodeInput('');
      setRoomNotice(
        joined.reconnected
          ? `Đã kết nối lại phòng và giữ nguyên slot ${joined.room.viewerSlot}.`
          : `Đã tham gia phòng vào slot ${joined.room.viewerSlot}.`
      );
      await refreshMyRooms(token);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không thể tham gia phòng.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleToggleReady = async () => {
    if (!token || !activeRoom || !activeRoom.viewerSlot) return;
    const currentReady = activeRoom.slots[activeRoom.viewerSlot].ready;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const res = await setRoomReady(token, activeRoom.matchId, !currentReady);
      setActiveRoom(res.room);
      setRoomNotice(
        !currentReady ? 'Bạn đã xác nhận Sẵn sàng.' : 'Đã hủy trạng thái Sẵn sàng.'
      );
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không cập nhật được Ready.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleStartRoom = async () => {
    if (!token || !activeRoom) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const res = await startRoomMatch(token, activeRoom.matchId);
      setActiveRoom(res.room);
      setRoomNotice('Trận đấu đã bắt đầu và khóa chặt 2 slot Bắc / Nam.');
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không thể bắt đầu trận đấu.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleSurrender = async () => {
    if (!token || !activeRoom) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const res = await surrenderRoomMatch(token, activeRoom.matchId);
      setActiveRoom(res.room);
      setConfirmSurrender(false);
      setRoomNotice(`Trận đấu kết thúc do đầu hàng. Bên thắng: ${res.room.winnerSlot}.`);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không thể đầu hàng.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleManualResync = async () => {
    if (!token || !activeRoom) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const synced = await syncRoomState(
        token,
        activeRoom.matchId,
        activeMatch?.eventSequence ?? 0
      );
      setActiveRoom(synced.room);
      setActiveMatch(synced.match);
      setRoomNotice(
        `Đã đồng bộ lại từ server (v${synced.version}, seq #${synced.currentSequence}).`
      );
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Resync thất bại.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleVerifyReplay = async () => {
    if (!token || !activeRoom) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const report = await verifyRoomReplay(token, activeRoom.matchId);
      setReplayReport(report);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Kiểm chứng replay thất bại.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleFetchBackupAudit = async () => {
    if (!token || !activeRoom) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const summary = await fetchRoomBackupSummary(token, activeRoom.matchId);
      setBackupSummary(summary);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Không lấy được tóm tắt backup.');
    } finally {
      setRoomBusy(false);
    }
  };

  const submitActiveRoomCommand = async (makePayload: RoomCommandFactory) => {
    if (!token || !activeRoom?.viewerActorId || !activeRoom.viewerNationId ||
      activeRoom.status !== 'ACTIVE' || activeMatch?.matchId !== activeRoom.matchId) {
      throw new Error('Cần mở phòng đang diễn ra và đồng bộ trạng thái trước khi gửi lệnh.');
    }
    if (commandInFlight.current) throw new Error('Đang xử lý lệnh trước.');
    commandInFlight.current = true;
    setCommandBusy(true);
    const useLatest = (match: FilteredClientMatchView) => {
      setActiveMatch((previous) => previous?.matchId === match.matchId && previous.version <= match.version
        ? match : previous);
    };
    try {
      const actor = activeMatch.actors[activeRoom.viewerActorId];
      if (!actor) throw new Error('Chưa đồng bộ được người chỉ huy của phe bạn.');
      const nonce = crypto.getRandomValues(new Uint32Array(3))
        .reduce((id, word) => id + word.toString(16).padStart(8, '0'), '');
      const result = await submitRoomCommand(token, activeRoom.matchId, {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse(`cmd_${nonce}`),
        matchId: MatchIdSchema.parse(activeRoom.matchId),
        actorId: actor.actorId,
        idempotencyKey: IdempotencyKeySchema.parse(`idem_${nonce}`),
        sequence: actor.lastSequence + 1,
        expectedVersion: activeMatch.version,
        issuedAtUtc: asUtcEpochMs(Date.now()),
        payload: makePayload(NationIdSchema.parse(activeRoom.viewerNationId), nonce),
      });
      useLatest(result.match);
      return result.version;
    } catch (error) {
      const refreshed = await fetchRoomDetail(token, activeRoom.matchId).catch(() => null);
      if (refreshed) useLatest(refreshed.match);
      throw error;
    } finally {
      commandInFlight.current = false;
      setCommandBusy(false);
    }
  };

  const selectDrawer = (drawer: WorkspaceDrawerId) => {
    if (drawer === 'economy') setEconomyRegionId(null);
    setActiveDrawer(drawer);
  };

  const handleScheduleRegionAction = async (regionId: string) => {
    if (activeMatch?.phase03Economy) {
      setEconomyRegionId(regionId);
      setActiveDrawer('economy');
      return;
    }
    setRoomError(null);
    setRoomNotice(null);
    try {
      const version = await submitActiveRoomCommand((nationId, nonce) => ({
        type: 'SCHEDULE_JOB',
        jobId: JobIdSchema.parse(`job_infra_${nonce}`),
        nationId,
        kind: 'INFRASTRUCTURE_WORK',
        durationMs: 900_000,
        costResource: 'industrial',
        costAmountFp: wholeUnitsToFixedPoint(10),
      }));
      setRoomNotice(`Đã đặt lịch dự án hạ tầng quốc gia (v${version}, hoàn tất sau 15 phút).`);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Lệnh bị máy chủ từ chối.');
    }
  };

  const handleCopyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Clipboard may be restricted in iframe
    }
  };

  const bothFilled = Boolean(activeRoom?.slots.NORTH.userId && activeRoom?.slots.SOUTH.userId);
  const bothReady = Boolean(activeRoom?.slots.NORTH.ready && activeRoom?.slots.SOUTH.ready);
  const canStart = Boolean(activeRoom?.status === 'LOBBY' && bothFilled && bothReady);
  const viewerSlot = activeRoom?.viewerSlot ?? null;
  const viewerReady = viewerSlot && activeRoom ? activeRoom.slots[viewerSlot].ready : false;

  return (
    <div
      ref={rootRef}
      data-testid="game-workspace-root"
      className="flex h-dvh w-screen flex-col overflow-hidden bg-[#11151A] text-[#EFE9DC]"
    >
      {/* Top Compact Resource & Command Bar */}
      <TopCommandBar
        health={health}
        user={user}
        activeRoom={activeRoom}
        activeMatch={activeMatch}
        syncTelemetry={syncTelemetry}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onOpenRoomsDrawer={() =>
          setActiveDrawer((prev) => (prev === 'rooms' ? 'none' : 'rooms'))
        }
      />

      {/* Main Fullscreen Command Stage */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop Left Navigation Rail */}
        {!isMobile && (
          <LeftNavRail
            activeDrawer={activeDrawer}
            onSelectDrawer={selectDrawer}
            hasActiveRoom={Boolean(activeRoom)}
            isMobile={false}
          />
        )}

        {/* Dominant Fullscreen Strategic Map Engine 2.0 */}
        <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <StrategicMap
            geojson={geojson}
            layers={worldLayers}
            loading={mapLoading}
            error={mapError}
            match={activeMatch}
            foundationMatch={foundationMatch}
            room={activeRoom}
            isMobile={isMobile}
            activeDrawer={activeDrawer}
            onChangeDrawer={setActiveDrawer}
            onToggleFullscreen={handleToggleFullscreen}
            onScheduleRegionAction={
              activeRoom ? (regionId) => void handleScheduleRegionAction(regionId) : undefined
            }
            actionBusy={commandBusy}
            sendMarch={(unitId,targetRegionId,reroute)=>submitActiveRoomCommand(()=>targetRegionId?{type:reroute?'REROUTE_MARCH':'ORDER_MARCH',unitId,targetRegionId}:{type:'HALT_MARCH',unitId})}
            loadMovementPreview={token && activeRoom
              ? (unitId, destinationId) => fetchMovementPreview(token, activeRoom.matchId, unitId, destinationId)
              : undefined}
          />

          {/* Floating Notification Toast Area */}
          {(roomNotice || roomError) && (
            <div
              data-testid="floating-notifications"
              className="pointer-events-auto absolute top-3 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 border px-3 py-2 text-xs shadow-2xl sm:max-w-lg"
              style={{
                backgroundColor: roomError ? '#2A1614' : '#16261E',
                borderColor: roomError ? '#B84B3E' : '#4F8A64',
                color: '#EFE9DC',
              }}
            >
              <span className="leading-snug">{roomError ?? roomNotice}</span>
              <button
                type="button"
                aria-label="Đóng thông báo"
                onClick={() => {
                  setRoomError(null);
                  setRoomNotice(null);
                }}
                className="shrink-0 text-[#A8B2BC] hover:text-[#EFE9DC]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Contextual Multiplayer Rooms Drawer (P02-01..P02-04 preserved 100%) */}
          {activeDrawer === 'economy' && token && activeRoom && activeMatch?.matchId === activeRoom.matchId && (
            <RoomEconomyDrawer
              key={`${activeRoom.matchId}:${activeRoom.viewerNationId}:${economyRegionId ?? ''}`}
              token={token}
              room={activeRoom}
              match={activeMatch}
              regionId={economyRegionId}
              commandBusy={commandBusy}
              onClose={() => setActiveDrawer('none')}
              onSubmit={submitActiveRoomCommand}
            />
          )}

          {activeDrawer==='diplomacy' && activeRoom && activeMatch?.matchId===activeRoom.matchId && <DiplomacyDrawer match={activeMatch} room={activeRoom} busy={commandBusy} submit={submitActiveRoomCommand} close={()=>setActiveDrawer('none')}/>}
          {activeDrawer === 'rooms' && (
            <aside
              aria-label="Phòng đấu 2 người chơi"
              data-testid="rooms-drawer"
              className="pointer-events-auto absolute top-3 bottom-3 left-3 z-30 flex w-[460px] max-w-[calc(100%-24px)] flex-col border border-[#3C4957] bg-[#161C22]/98 text-[#EFE9DC] shadow-2xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-[#252E38] bg-[#12171D] px-4 py-3">
                <div>
                  <p className="text-[10px] font-semibold tracking-wide text-[#C6A15B]">
                    MULTIPLAYER AUTHORITATIVE · ĐÚNG 2 SLOT BẮC / NAM
                  </p>
                  <h2 className="text-sm font-bold text-[#EFE9DC]">
                    Phòng Đấu &amp; Danh Tính Người Chơi
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {user && (
                    <button
                      type="button"
                      data-testid="logout-btn"
                      onClick={() => void handleLogout()}
                      className="inline-flex h-7 items-center gap-1 border border-[#3C4957] bg-[#1B222A] px-2 text-[11px] font-medium text-[#EFE9DC] hover:border-[#C6A15B]"
                    >
                      <LogOut className="h-3 w-3" />
                      <span>Thoát</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Đóng bảng phòng đấu"
                    onClick={() => setActiveDrawer('none')}
                    className="flex h-7 w-7 items-center justify-center border border-[#2B3540] text-[#9CA7B4] hover:text-[#EFE9DC]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
                {!user ? (
                  <form onSubmit={(e) => void handleAuthSubmit(e)} className="space-y-3">
                    <div className="grid grid-cols-2 gap-1.5 border-b border-[#252E38] pb-3">
                      <button
                        type="button"
                        data-testid="auth-tab-register"
                        onClick={() => {
                          setAuthMode('register');
                          setAuthError(null);
                        }}
                        className={`border py-1.5 text-xs font-semibold ${
                          authMode === 'register'
                            ? 'border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                            : 'border-[#2B3540] bg-[#12171D] text-[#9CA7B4]'
                        }`}
                      >
                        Tạo tài khoản mới
                      </button>
                      <button
                        type="button"
                        data-testid="auth-tab-login"
                        onClick={() => {
                          setAuthMode('login');
                          setAuthError(null);
                        }}
                        className={`border py-1.5 text-xs font-semibold ${
                          authMode === 'login'
                            ? 'border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                            : 'border-[#2B3540] bg-[#12171D] text-[#9CA7B4]'
                        }`}
                      >
                        Đăng nhập
                      </button>
                    </div>

                    <div>
                      <label htmlFor="vdn-username" className="block text-[11px] text-[#A8B2BC]">
                        Tên đăng nhập (3–32 ký tự)
                      </label>
                      <input
                        id="vdn-username"
                        data-testid="auth-username"
                        type="text"
                        required
                        minLength={3}
                        maxLength={32}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="vd: chi_huy_bac"
                        className="mt-1 w-full border border-[#3C4957] bg-[#11161C] px-3 py-2 text-xs text-[#EFE9DC] focus:border-[#C6A15B] focus:outline-none"
                      />
                    </div>

                    {authMode === 'register' && (
                      <div>
                        <label
                          htmlFor="vdn-displayname"
                          className="block text-[11px] text-[#A8B2BC]"
                        >
                          Tên hiển thị trong phòng đấu
                        </label>
                        <input
                          id="vdn-displayname"
                          data-testid="auth-displayname"
                          type="text"
                          required
                          minLength={2}
                          maxLength={48}
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="vd: Chỉ huy Phương Bắc"
                          className="mt-1 w-full border border-[#3C4957] bg-[#11161C] px-3 py-2 text-xs text-[#EFE9DC] focus:border-[#C6A15B] focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label htmlFor="vdn-password" className="block text-[11px] text-[#A8B2BC]">
                        Mật khẩu (tối thiểu 8 ký tự · băm scrypt trên server)
                      </label>
                      <input
                        id="vdn-password"
                        data-testid="auth-password"
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="mt-1 w-full border border-[#3C4957] bg-[#11161C] px-3 py-2 text-xs text-[#EFE9DC] focus:border-[#C6A15B] focus:outline-none"
                      />
                    </div>

                    {authError && (
                      <p className="border border-[#B84B3E] bg-[#2A1614] px-3 py-2 text-xs text-[#F2B8B0]">
                        {authError}
                      </p>
                    )}

                    <button
                      type="submit"
                      data-testid="auth-submit-btn"
                      disabled={authBusy}
                      className="inline-flex w-full items-center justify-center gap-2 border border-[#C6A15B] bg-[#24322A] px-4 py-2 text-xs font-semibold text-[#EFE9DC] hover:bg-[#2F4337] disabled:opacity-50"
                    >
                      {authMode === 'register' ? (
                        <UserPlus className="h-3.5 w-3.5" />
                      ) : (
                        <KeyRound className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {authBusy
                          ? 'Đang xác thực...'
                          : authMode === 'register'
                            ? 'Đăng ký & Vào sảnh'
                            : 'Đăng nhập'}
                      </span>
                    </button>

                    <div className="border border-[#252E38] bg-[#12171D] p-3 text-[11px] leading-relaxed text-[#9CA7B4]">
                      <p className="font-semibold text-[#EFE9DC]">Nguyên tắc bảo mật &amp; 2 slot</p>
                      <p className="mt-1">
                        Mỗi phòng đấu chỉ gồm đúng 2 người chơi thật (Bắc/Nam); NPC vận hành độc lập.
                        Token phiên chỉ lưu trong RAM trình duyệt (không dùng localStorage).
                      </p>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    {/* User Identity Strip */}
                    <div className="flex items-center justify-between border border-[#252E38] bg-[#12171D] px-3 py-2">
                      <div>
                        <p className="font-semibold text-[#EFE9DC]">{user.displayName}</p>
                        <p className="font-mono text-[10px] text-[#758290]">
                          @{user.username} · RAM Bearer Token
                        </p>
                      </div>
                      <span className="font-mono text-[10px] text-[#5FA374]">Đã xác thực</span>
                    </div>

                    {/* Create & Join Forms */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <form
                        onSubmit={(e) => void handleCreateRoom(e)}
                        className="space-y-2 border border-[#252E38] bg-[#12171D] p-3"
                      >
                        <p className="flex items-center gap-1.5 font-semibold text-[#EFE9DC]">
                          <PlusCircle className="h-3.5 w-3.5 text-[#C6A15B]" />
                          <span>Tạo phòng mới</span>
                        </p>
                        <input
                          type="text"
                          data-testid="create-room-title"
                          value={newRoomTitle}
                          onChange={(e) => setNewRoomTitle(e.target.value)}
                          minLength={3}
                          maxLength={96}
                          required
                          className="w-full border border-[#3C4957] bg-[#161C22] px-2 py-1.5 text-xs text-[#EFE9DC]"
                        />
                        <select
                          data-testid="create-room-slot"
                          value={preferredSlot}
                          onChange={(e) => setPreferredSlot(e.target.value as HumanSlot)}
                          className="w-full border border-[#3C4957] bg-[#161C22] px-2 py-1.5 text-xs text-[#EFE9DC]"
                        >
                          <option value="NORTH">Phương Bắc (NORTH)</option>
                          <option value="SOUTH">Phương Nam (SOUTH)</option>
                        </select>
                        <button
                          type="submit"
                          data-testid="create-room-btn"
                          disabled={roomBusy}
                          className="w-full border border-[#C6A15B] bg-[#24322A] py-1.5 text-xs font-semibold text-[#EFE9DC] hover:bg-[#2F4337] disabled:opacity-50"
                        >
                          Tạo phòng &amp; Mã mời
                        </button>
                      </form>

                      <form
                        onSubmit={(e) => void handleJoinRoom(e)}
                        className="space-y-2 border border-[#252E38] bg-[#12171D] p-3"
                      >
                        <p className="flex items-center gap-1.5 font-semibold text-[#EFE9DC]">
                          <Users className="h-3.5 w-3.5 text-[#C6A15B]" />
                          <span>Tham gia / Reconnect</span>
                        </p>
                        <input
                          type="text"
                          data-testid="join-invite-code"
                          value={inviteCodeInput}
                          onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                          required
                          placeholder="VDN-XXXX-XXXX"
                          className="w-full border border-[#3C4957] bg-[#161C22] px-2 py-1.5 font-mono text-xs text-[#EFE9DC]"
                        />
                        <p className="text-[10px] text-[#758290]">
                          Thành viên cũ nhập lại mã sẽ giữ nguyên slot gốc.
                        </p>
                        <button
                          type="submit"
                          data-testid="join-room-btn"
                          disabled={roomBusy}
                          className="w-full border border-[#3C4957] bg-[#242D36] py-1.5 text-xs font-semibold text-[#EFE9DC] hover:border-[#C6A15B] disabled:opacity-50"
                        >
                          Vào phòng
                        </button>
                      </form>
                    </div>

                    {/* My Rooms */}
                    {myRooms.length > 0 && (
                      <div className="border border-[#252E38] bg-[#12171D] p-3">
                        <p className="mb-2 text-[11px] font-semibold text-[#A8B2BC]">
                          Phòng của tôi ({myRooms.length})
                        </p>
                        <ul className="max-h-28 space-y-1 overflow-y-auto">
                          {myRooms.map((rm) => (
                            <li key={rm.matchId}>
                              <button
                                type="button"
                                onClick={() => token && void openRoom(token, rm.matchId)}
                                className={`flex w-full items-center justify-between border px-2.5 py-1.5 text-left text-xs ${
                                  activeRoom?.matchId === rm.matchId
                                    ? 'border-[#C6A15B] bg-[#222B34] font-semibold text-[#F4DC9F]'
                                    : 'border-[#252E38] bg-[#161C22] text-[#D8D3C6] hover:border-[#3C4957]'
                                }`}
                              >
                                <span className="truncate pr-2">{rm.title}</span>
                                <span className="shrink-0 font-mono text-[10px] text-[#9CA7B4]">
                                  {rm.viewerSlot} · {rm.status}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Active Room Controls & Telemetry */}
                    {activeRoom && (
                      <div
                        data-testid="active-room-panel"
                        className="space-y-3 border border-[#C6A15B]/45 bg-[#12171D] p-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#252E38] pb-2.5">
                          <div>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#C6A15B]">
                              <span>{activeRoom.matchId}</span>
                              <span>·</span>
                              <span>{activeRoom.status}</span>
                              {activeRoom.lockedAtUtc && (
                                <span className="inline-flex items-center gap-0.5 text-[#9CA7B4]">
                                  <Lock className="h-2.5 w-2.5" /> Khóa slot
                                </span>
                              )}
                            </div>
                            <h3 className="mt-0.5 text-sm font-bold text-[#EFE9DC]">
                              {activeRoom.title}
                            </h3>
                          </div>

                          <div className="flex items-center gap-1.5 border border-[#3C4957] bg-[#161C22] px-2 py-1">
                            <code
                              data-testid="active-invite-code"
                              className="font-mono text-[11px] font-bold text-[#F4DC9F]"
                            >
                              {activeRoom.inviteCode}
                            </code>
                            <button
                              type="button"
                              onClick={() => void handleCopyInvite(activeRoom.inviteCode)}
                              aria-label="Sao chép mã mời"
                              className="border-l border-[#2B3540] pl-1.5 text-[10px] text-[#C6A15B]"
                            >
                              {copiedCode ? 'Đã chép' : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>

                        {/* 2 Human Slots */}
                        <div className="grid grid-cols-2 gap-2">
                          {(['NORTH', 'SOUTH'] as const).map((slotKey) => {
                            const info = activeRoom.slots[slotKey];
                            const isMe = activeRoom.viewerSlot === slotKey;
                            return (
                              <div
                                key={slotKey}
                                data-testid={`room-slot-${slotKey.toLowerCase()}`}
                                className={`border p-2.5 ${
                                  isMe
                                    ? 'border-[#C6A15B] bg-[#1B222A]'
                                    : 'border-[#252E38] bg-[#161C22]'
                                }`}
                              >
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="font-bold text-[#EFE9DC]">{slotKey}</span>
                                  {isMe && <span className="font-mono text-[#C6A15B]">Bạn</span>}
                                </div>
                                <p className="mt-1 truncate text-xs font-medium text-[#EFE9DC]">
                                  {info.displayName ?? 'Đang chờ...'}
                                </p>
                                <p className="mt-1 flex items-center gap-1 text-[10px] text-[#9CA7B4]">
                                  <CheckCircle2
                                    className={`h-3 w-3 ${
                                      info.ready ? 'text-[#5FA374]' : 'text-[#4A5563]'
                                    }`}
                                  />
                                  <span>{info.ready ? 'Sẵn sàng' : 'Chưa Ready'}</span>
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        {/* Live UTC Clock & Sync */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border border-[#252E38] bg-[#161C22] px-2.5 py-2 font-mono text-[10px] text-[#A8B2BC] tabular-nums">
                          <span className="inline-flex items-center gap-1 text-[#EFE9DC]">
                            <Clock className="h-3 w-3 text-[#C6A15B]" />
                            {activeMatch ? formatUtc(activeMatch.currentUtc) : 'Đang đồng bộ...'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[#5FA374]">
                            <Wifi className="h-3 w-3" />
                            {syncTelemetry.status} · v{activeMatch?.version ?? 0} · #
                            {syncTelemetry.lastSequence}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {activeRoom.status === 'LOBBY' && (
                            <>
                              <button
                                type="button"
                                data-testid="toggle-ready-btn"
                                disabled={roomBusy}
                                onClick={() => void handleToggleReady()}
                                className={`border px-2.5 py-1.5 text-[11px] font-semibold ${
                                  viewerReady
                                    ? 'border-[#3C4957] bg-[#161C22] text-[#EFE9DC]'
                                    : 'border-[#C6A15B] bg-[#24322A] text-[#EFE9DC]'
                                }`}
                              >
                                {viewerReady ? 'Hủy Ready' : 'Sẵn sàng (Ready)'}
                              </button>
                              <button
                                type="button"
                                data-testid="start-room-btn"
                                disabled={!canStart || roomBusy}
                                onClick={() => void handleStartRoom()}
                                className="border border-[#C6A15B] bg-[#C6A15B] px-2.5 py-1.5 text-[11px] font-bold text-[#12171D] disabled:cursor-not-allowed disabled:border-[#2B3540] disabled:bg-[#1E252D] disabled:text-[#66727F]"
                              >
                                Bắt đầu &amp; Khóa slot
                              </button>
                            </>
                          )}

                          {activeRoom.status === 'ACTIVE' && !confirmSurrender && (
                            <button
                              type="button"
                              data-testid="surrender-btn"
                              disabled={roomBusy}
                              onClick={() => setConfirmSurrender(true)}
                              className="inline-flex items-center gap-1 border border-[#B84B3E] bg-[#2A1614] px-2.5 py-1.5 text-[11px] font-semibold text-[#F2B8B0]"
                            >
                              <Flag className="h-3 w-3" />
                              <span>Đầu hàng</span>
                            </button>
                          )}

                          {activeRoom.status === 'ACTIVE' && confirmSurrender && (
                            <div className="flex items-center gap-1.5 border border-[#B84B3E] bg-[#2A1614] px-2 py-1 text-[11px]">
                              <span>Xác nhận?</span>
                              <button
                                type="button"
                                data-testid="confirm-surrender-btn"
                                disabled={roomBusy}
                                onClick={() => void handleSurrender()}
                                className="bg-[#B84B3E] px-2 py-0.5 font-semibold text-white"
                              >
                                Đồng ý
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmSurrender(false)}
                                className="border border-[#3C4957] px-2 py-0.5"
                              >
                                Hủy
                              </button>
                            </div>
                          )}

                          <button
                            type="button"
                            data-testid="resync-btn"
                            disabled={roomBusy}
                            onClick={() => void handleManualResync()}
                            className="inline-flex items-center gap-1 border border-[#3C4957] bg-[#161C22] px-2.5 py-1.5 text-[11px] text-[#D8D3C6] hover:border-[#C6A15B]"
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Resync</span>
                          </button>

                          <button
                            type="button"
                            data-testid="verify-room-replay-btn"
                            disabled={roomBusy}
                            onClick={() => void handleVerifyReplay()}
                            className="inline-flex items-center gap-1 border border-[#3C4957] bg-[#161C22] px-2.5 py-1.5 text-[11px] text-[#D8D3C6] hover:border-[#C6A15B]"
                          >
                            <ShieldCheck className="h-3 w-3 text-[#5FA374]" />
                            <span>Replay SHA-256</span>
                          </button>

                          <button
                            type="button"
                            data-testid="backup-audit-btn"
                            disabled={roomBusy}
                            onClick={() => void handleFetchBackupAudit()}
                            className="border border-[#3C4957] bg-[#161C22] px-2.5 py-1.5 text-[11px] text-[#D8D3C6] hover:border-[#C6A15B]"
                          >
                            Backup Audit
                          </button>
                        </div>

                        {replayReport && (
                          <div className="border border-[#4F8A64] bg-[#16261E] p-2 font-mono text-[10px] text-[#D8EDE0]">
                            Replay: {replayReport.verified ? 'KHỚP 100%' : 'SAI LỆCH'} · Cmd:{' '}
                            {replayReport.replayedCommandCount} · SHA:{' '}
                            {replayReport.replayedHash.slice(0, 20)}...
                          </div>
                        )}

                        {backupSummary && (
                          <div className="border border-[#3C4957] bg-[#161C22] p-2 font-mono text-[10px] text-[#A8B2BC]">
                            Backup v{backupSummary.backupVersion} · v{backupSummary.version} ·
                            Snapshots: {backupSummary.snapshots.length} · secretsIncluded:{' '}
                            {String(backupSummary.secretsIncluded)}
                          </div>
                        )}

                        {/* Nation Ledger Summary */}
                        {activeMatch && (
                          <div className="border-t border-[#252E38] pt-2.5">
                            <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-[#758290]">
                              SỔ CÁI QUỐC GIA &amp; NPC ĐỘC LẬP (FIXED-POINT ×1000)
                            </p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left font-mono text-[10px] tabular-nums">
                                <thead>
                                  <tr className="border-b border-[#252E38] text-[#758290]">
                                    <th className="py-1 pr-2">Phe</th>
                                    <th className="px-1 py-1 text-right">LT</th>
                                    <th className="px-1 py-1 text-right">CN</th>
                                    <th className="pl-1 py-1 text-right">NS</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#202730]">
                                  {Object.values(activeMatch.nations).map((n) => (
                                    <tr key={n.nationId}>
                                      <td className="py-1 pr-2 font-sans text-[#EFE9DC]">
                                        {n.code} ({n.slot})
                                      </td>
                                      <td className="px-1 py-1 text-right">
                                        {fpFormat(n.resources.food, 0)}
                                      </td>
                                      <td className="px-1 py-1 text-right">
                                        {fpFormat(n.resources.industrial, 0)}
                                      </td>
                                      <td className="pl-1 py-1 text-right">
                                        {fpFormat(n.resources.treasury, 0)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* Separate Developer / Diagnostics Workspace Modal (All P01 tools preserved cleanly) */}
          {activeDrawer === 'diagnostics' && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Không gian Chẩn đoán Kỹ thuật và Nền tảng P01"
              data-testid="diagnostics-workspace"
              className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-[#F6F5F0] text-[#171B20]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-[#D9D6CC] bg-[#12171D] px-4 py-2.5 text-[#EFE9DC]">
                <div>
                  <p className="font-mono text-[10px] text-[#C6A15B]">
                    DEVELOPER &amp; DIAGNOSTICS WORKSPACE · TÁCH BIỆT KHỎI GIAO DIỆN CHIẾN TRƯỜNG
                  </p>
                  <h2 className="text-sm font-bold">
                    Kiểm chứng Nền tảng Authoritative (P01-01 · P01-02 · P01-03 &amp; P02)
                  </h2>
                </div>
                <button
                  type="button"
                  data-testid="close-diagnostics-btn"
                  onClick={() => setActiveDrawer('none')}
                  className="inline-flex items-center gap-1.5 border border-[#C6A15B] bg-[#242D36] px-3 py-1.5 text-xs font-semibold text-[#F4DC9F] hover:bg-[#2F3A46]"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Quay lại Bản đồ</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <div className="mx-auto max-w-[1320px] space-y-6">
                  <SystemStatusPanel
                    health={health}
                    loading={healthLoading}
                    error={healthError}
                    ws={foundationWs}
                    onRefresh={onRefreshFoundation}
                  />

                  <MatchSimulationPanel
                    health={health}
                    match={foundationMatch}
                    loading={foundationMatchLoading}
                    onMatchLoaded={onFoundationMatchLoaded}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Compact Bottom Navigation */}
      {isMobile && (
        <LeftNavRail
          activeDrawer={activeDrawer}
          onSelectDrawer={selectDrawer}
          hasActiveRoom={Boolean(activeRoom)}
          isMobile={true}
        />
      )}
    </div>
  );
}
