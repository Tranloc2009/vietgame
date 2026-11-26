import { FormEvent, useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import {
  ActorIdSchema,
  asUtcEpochMs,
  Command,
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
import {
  BackupAuditSummary,
  createRoom,
  fetchRoomBackupSummary,
  fetchRoomDetail,
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

function formatUtc(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function MultiplayerWorkspace() {
  // World Map GeoJSON & Geographic Context Layers (P02-03 & P02-05)
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
  const [replayReport, setReplayReport] = useState<RoomReplayReport | null>(null);
  const [backupSummary, setBackupSummary] = useState<BackupAuditSummary | null>(null);

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

  const openRoom = useCallback(
    async (sessionToken: string, matchId: string) => {
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
    },
    []
  );

  // Live Authenticated WebSocket Sync (P02-04)
  const handleWsSnapshot = useCallback(
    (room: MatchRoomSummary, match: FilteredClientMatchView) => {
      setActiveRoom(room);
      setActiveMatch(match);
    },
    []
  );

  const handleWsRoomStatus = useCallback(
    (room: MatchRoomSummary) => {
      setActiveRoom(room);
      setMyRooms((prev) => {
        const idx = prev.findIndex((r) => r.matchId === room.matchId);
        if (idx === -1) return [room, ...prev];
        const next = [...prev];
        next[idx] = room;
        return next;
      });
    },
    []
  );

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

  const handleScheduleRegionAction = async (regionId: string) => {
    if (!token || !activeRoom || !activeMatch || !activeRoom.viewerActorId || !activeRoom.viewerNationId) {
      return;
    }
    setCommandBusy(true);
    setRoomError(null);
    setRoomNotice(null);
    try {
      const actor = activeMatch.actors[activeRoom.viewerActorId];
      const nextSeq = (actor?.lastSequence ?? 0) + 1;
      const nonce = Math.random().toString(36).slice(2, 8);
      const command: Command = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse(`cmd_job_${nextSeq}_${nonce}`),
        matchId: MatchIdSchema.parse(activeRoom.matchId),
        actorId: ActorIdSchema.parse(activeRoom.viewerActorId),
        idempotencyKey: IdempotencyKeySchema.parse(`idem_job_${activeRoom.matchId}_${nextSeq}_${nonce}`),
        sequence: nextSeq,
        expectedVersion: activeMatch.version,
        issuedAtUtc: asUtcEpochMs(Date.now()),
        payload: {
          type: 'SCHEDULE_JOB',
          jobId: JobIdSchema.parse(`job_infra_${nextSeq}_${nonce}`),
          nationId: NationIdSchema.parse(activeRoom.viewerNationId),
          kind: 'INFRASTRUCTURE_WORK',
          durationMs: 900_000,
          costResource: 'industrial',
          costAmountFp: wholeUnitsToFixedPoint(10),
        },
      };

      const res = await submitRoomCommand(token, activeRoom.matchId, command);
      setActiveMatch(res.match);
      setRoomNotice(
        `Đã đặt lịch dự án hạ tầng cho khu vực ${regionId} (v${res.version}, trừ 10.000 công nghiệp, hoàn tất theo đồng hồ UTC server sau 15 phút).`
      );
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Lệnh bị máy chủ từ chối.');
    } finally {
      setCommandBusy(false);
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

  const bothFilled = Boolean(
    activeRoom?.slots.NORTH.userId && activeRoom?.slots.SOUTH.userId
  );
  const bothReady = Boolean(
    activeRoom?.slots.NORTH.ready && activeRoom?.slots.SOUTH.ready
  );
  const canStart = Boolean(activeRoom?.status === 'LOBBY' && bothFilled && bothReady);
  const viewerSlot = activeRoom?.viewerSlot ?? null;
  const viewerReady = viewerSlot && activeRoom ? activeRoom.slots[viewerSlot].ready : false;

  return (
    <div className="space-y-6">
      {/* Section 1: Dominant Strategic Geographic 72-Region Map (P02-03, P02-04 & P02-05) */}
      <StrategicMap
        geojson={geojson}
        layers={worldLayers}
        loading={mapLoading}
        error={mapError}
        match={activeMatch}
        room={activeRoom}
        onScheduleRegionAction={
          activeRoom ? (regionId) => void handleScheduleRegionAction(regionId) : undefined
        }
        actionBusy={commandBusy}
      />

      {/* Section 2: Identity & Two-Slot Multiplayer Room Manager (P02-01) */}
      <section
        aria-label="Danh tính & Phòng đấu 2 người chơi"
        className="border border-[#D9D6CC] bg-[#FFFFFF]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-5 py-4">
          <div>
            <p className="text-xs font-medium text-[#2B4C3F]">
              P02-01 · Danh tính &amp; Phòng đấu Độc lập (Đúng 2 Slot Bắc / Nam · NPC Độc lập)
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-[#171B20]">
              Phòng Đấu Multiplayer Authoritative
            </h2>
          </div>

          {user && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-right text-xs">
                <p className="font-semibold text-[#171B20]">{user.displayName}</p>
                <p className="font-mono text-[#545B66]">
                  @{user.username} · Token trong RAM
                </p>
              </div>
              <button
                type="button"
                data-testid="logout-btn"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 border border-[#D9D6CC] bg-[#F6F5F0] px-3 py-1.5 text-xs font-medium text-[#171B20] hover:bg-[#EBE8DF]"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Đăng xuất</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-5">
          {!user ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
              {/* Auth Form */}
              <form onSubmit={(e) => void handleAuthSubmit(e)} className="space-y-3">
                <div className="flex items-center gap-2 border-b border-[#E6E3DA] pb-2.5">
                  <button
                    type="button"
                    data-testid="auth-tab-register"
                    onClick={() => {
                      setAuthMode('register');
                      setAuthError(null);
                    }}
                    className={`border px-3 py-1 text-xs font-semibold ${
                      authMode === 'register'
                        ? 'border-[#171B20] bg-[#171B20] text-[#FFFFFF]'
                        : 'border-[#D9D6CC] bg-[#F6F5F0] text-[#171B20]'
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
                    className={`border px-3 py-1 text-xs font-semibold ${
                      authMode === 'login'
                        ? 'border-[#171B20] bg-[#171B20] text-[#FFFFFF]'
                        : 'border-[#D9D6CC] bg-[#F6F5F0] text-[#171B20]'
                    }`}
                  >
                    Đăng nhập
                  </button>
                </div>

                <div>
                  <label htmlFor="vdn-username" className="block text-xs font-medium text-[#171B20]">
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
                    className="mt-1 w-full border border-[#D9D6CC] bg-[#FAFAF7] px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                  />
                </div>

                {authMode === 'register' && (
                  <div>
                    <label
                      htmlFor="vdn-displayname"
                      className="block text-xs font-medium text-[#171B20]"
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
                      className="mt-1 w-full border border-[#D9D6CC] bg-[#FAFAF7] px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="vdn-password" className="block text-xs font-medium text-[#171B20]">
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
                    className="mt-1 w-full border border-[#D9D6CC] bg-[#FAFAF7] px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                  />
                </div>

                {authError && (
                  <p className="border border-[#E5B8AF] bg-[#FDF2F0] px-3 py-2 text-xs text-[#9A3B26]">
                    {authError}
                  </p>
                )}

                <button
                  type="submit"
                  data-testid="auth-submit-btn"
                  disabled={authBusy}
                  className="inline-flex items-center gap-2 border border-[#2B4C3F] bg-[#2B4C3F] px-4 py-2 text-xs font-semibold text-[#FFFFFF] hover:bg-[#223D33] disabled:opacity-60"
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
              </form>

              {/* Invariant Guidance Box */}
              <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4 text-xs leading-relaxed text-[#545B66]">
                <p className="font-semibold text-[#171B20]">
                  Nguyên tắc phiên &amp; phân quyền Giai đoạn 02
                </p>
                <ul className="mt-2 list-disc space-y-1.5 pl-4">
                  <li>
                    Mỗi phòng đấu chỉ có đúng <strong>2 slot người chơi thật</strong> (Phương Bắc &amp;
                    Phương Nam). Người chơi thứ 3 luôn bị server từ chối.
                  </li>
                  <li>
                    Các chính quyền NPC (Cao Nguyên, Biên Giới) vận hành độc lập, không bao giờ chiếm
                    slot người chơi.
                  </li>
                  <li>
                    Token phiên chỉ lưu trong bộ nhớ phiên làm việc (không lưu vào{' '}
                    <code>localStorage</code>), và mọi lệnh đều bị kiểm tra <code>matchId</code> +{' '}
                    <code>nationId</code> trên server.
                  </li>
                  <li>
                    Bạn có thể khám phá đầy đủ <strong>Bản đồ địa lý 72 vùng &amp; 4 lớp</strong>{' '}
                    ngay phía trên trước khi đăng nhập hoặc mở phòng đấu.
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Create + Join + My Rooms Strip */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Create Room */}
                <form
                  onSubmit={(e) => void handleCreateRoom(e)}
                  className="space-y-2.5 border border-[#E6E3DA] bg-[#FAFAF7] p-4"
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[#171B20]">
                    <PlusCircle className="h-3.5 w-3.5 text-[#2B4C3F]" />
                    <span>Tạo phòng đấu mới</span>
                  </p>
                  <input
                    type="text"
                    data-testid="create-room-title"
                    value={newRoomTitle}
                    onChange={(e) => setNewRoomTitle(e.target.value)}
                    minLength={3}
                    maxLength={96}
                    required
                    className="w-full border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-1.5 text-xs text-[#171B20]"
                    placeholder="Tên chiến dịch"
                  />
                  <div className="flex items-center gap-2 text-xs">
                    <label className="text-[#545B66]">Chọn phe:</label>
                    <select
                      data-testid="create-room-slot"
                      value={preferredSlot}
                      onChange={(e) => setPreferredSlot(e.target.value as HumanSlot)}
                      className="flex-1 border border-[#D9D6CC] bg-[#FFFFFF] px-2 py-1 text-xs text-[#171B20]"
                    >
                      <option value="NORTH">Phương Bắc (NORTH)</option>
                      <option value="SOUTH">Phương Nam (SOUTH)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    data-testid="create-room-btn"
                    disabled={roomBusy}
                    className="w-full border border-[#2B4C3F] bg-[#2B4C3F] px-3 py-1.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#223D33] disabled:opacity-60"
                  >
                    Tạo phòng &amp; Sinh mã mời
                  </button>
                </form>

                {/* Join by Invite Code */}
                <form
                  onSubmit={(e) => void handleJoinRoom(e)}
                  className="space-y-2.5 border border-[#E6E3DA] bg-[#FAFAF7] p-4"
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[#171B20]">
                    <Users className="h-3.5 w-3.5 text-[#2B4C3F]" />
                    <span>Tham gia / Reconnect bằng mã mời</span>
                  </p>
                  <input
                    type="text"
                    data-testid="join-invite-code"
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                    required
                    placeholder="VDN-XXXX-XXXX"
                    className="w-full border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-1.5 font-mono text-xs text-[#171B20]"
                  />
                  <p className="text-[11px] text-[#6E7681]">
                    Nếu bạn đã là thành viên phòng, nhập lại mã sẽ giữ nguyên slot ban đầu kể cả sau khi trận đã bắt đầu.
                  </p>
                  <button
                    type="submit"
                    data-testid="join-room-btn"
                    disabled={roomBusy}
                    className="w-full border border-[#171B20] bg-[#171B20] px-3 py-1.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2E343D] disabled:opacity-60"
                  >
                    Vào phòng bằng mã mời
                  </button>
                </form>

                {/* My Rooms List */}
                <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                  <p className="text-xs font-semibold text-[#171B20]">
                    Phòng đấu của tôi ({myRooms.length})
                  </p>
                  {myRooms.length === 0 ? (
                    <p className="mt-2 text-xs text-[#6E7681]">
                      Chưa tham gia phòng đấu nào. Hãy tạo phòng mới hoặc nhập mã mời.
                    </p>
                  ) : (
                    <ul className="mt-2 max-h-28 space-y-1.5 overflow-y-auto">
                      {myRooms.map((rm) => (
                        <li key={rm.matchId}>
                          <button
                            type="button"
                            onClick={() => token && void openRoom(token, rm.matchId)}
                            className={`flex w-full items-center justify-between border px-2.5 py-1.5 text-left text-xs ${
                              activeRoom?.matchId === rm.matchId
                                ? 'border-[#2B4C3F] bg-[#EDF3F0] font-semibold text-[#171B20]'
                                : 'border-[#D9D6CC] bg-[#FFFFFF] text-[#171B20] hover:bg-[#F6F5F0]'
                            }`}
                          >
                            <span className="truncate pr-2">{rm.title}</span>
                            <span className="shrink-0 font-mono text-[11px] text-[#545B66]">
                              {rm.viewerSlot} · {rm.status}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {roomError && (
                <div
                  role="alert"
                  className="border border-[#E5B8AF] bg-[#FDF2F0] px-4 py-2.5 text-xs text-[#9A3B26]"
                >
                  {roomError}
                </div>
              )}

              {roomNotice && (
                <div className="border border-[#BFD6CA] bg-[#EFF6F2] px-4 py-2.5 text-xs text-[#214235]">
                  {roomNotice}
                </div>
              )}

              {/* Active Room Lobby & Live Sync Controls */}
              {activeRoom && (
                <div
                  data-testid="active-room-panel"
                  className="space-y-4 border border-[#2B4C3F]/30 bg-[#FAFAF7] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E6E3DA] pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-[#171B20]">
                          {activeRoom.matchId}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-[#2B4C3F]">
                          Trạng thái: {activeRoom.status}
                        </span>
                        {activeRoom.lockedAtUtc && (
                          <span className="inline-flex items-center gap-1 text-[#545B66]">
                            <Lock className="h-3 w-3" /> Đã khóa slot
                          </span>
                        )}
                        {activeRoom.winnerSlot && (
                          <span className="font-semibold text-[#9A3B26]">
                            Kết thúc · Thắng: {activeRoom.winnerSlot} ({activeRoom.endedReason})
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1 text-base font-bold text-[#171B20]">
                        {activeRoom.title}
                      </h3>
                    </div>

                    {/* Invite Code Box */}
                    <div className="flex items-center gap-2 border border-[#D9D6CC] bg-[#FFFFFF] px-3 py-1.5">
                      <span className="text-[11px] text-[#545B66]">Mã mời:</span>
                      <code
                        data-testid="active-invite-code"
                        className="font-mono text-xs font-bold text-[#171B20]"
                      >
                        {activeRoom.inviteCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => void handleCopyInvite(activeRoom.inviteCode)}
                        className="border-l border-[#E6E3DA] pl-2 text-xs text-[#2B4C3F] hover:text-[#171B20]"
                        aria-label="Sao chép mã mời"
                      >
                        {copiedCode ? 'Đã chép' : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Two Human Slots + Sync Telemetry */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {(['NORTH', 'SOUTH'] as const).map((slotKey) => {
                      const info = activeRoom.slots[slotKey];
                      const isMe = activeRoom.viewerSlot === slotKey;
                      return (
                        <div
                          key={slotKey}
                          data-testid={`room-slot-${slotKey.toLowerCase()}`}
                          className={`border p-3 ${
                            isMe
                              ? 'border-[#2B4C3F] bg-[#FFFFFF]'
                              : 'border-[#D9D6CC] bg-[#FFFFFF]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-[#171B20]">
                              {slotKey === 'NORTH' ? 'Phương Bắc (NORTH)' : 'Phương Nam (SOUTH)'}
                            </span>
                            {isMe && (
                              <span className="font-mono text-[11px] font-semibold text-[#2B4C3F]">
                                Bạn
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm font-medium text-[#171B20]">
                            {info.displayName ?? 'Đang chờ người chơi thứ 2...'}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-[#545B66]">
                            <CheckCircle2
                              className={`h-3.5 w-3.5 ${
                                info.ready ? 'text-[#2B4C3F]' : 'text-[#B5B9C0]'
                              }`}
                            />
                            <span>{info.ready ? 'Đã Sẵn sàng (Ready)' : 'Chưa Ready'}</span>
                          </p>
                        </div>
                      );
                    })}

                    {/* Live UTC Clock & WS Sync Telemetry */}
                    <div className="border border-[#D9D6CC] bg-[#FFFFFF] p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#171B20]">Đồng bộ &amp; Đồng hồ UTC</span>
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2B4C3F]">
                          <Wifi className="h-3 w-3" />
                          {syncTelemetry.status}
                        </span>
                      </div>
                      <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-[#171B20] tabular-nums">
                        <Clock className="h-3 w-3 text-[#545B66]" />
                        <span>
                          {activeMatch ? formatUtc(activeMatch.currentUtc) : 'Đang đồng bộ...'}
                        </span>
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-[#545B66] tabular-nums">
                        v{activeMatch?.version ?? 0} · seq #{syncTelemetry.lastSequence} ·
                        Snapshots: {snapshots.length}
                      </p>
                      {syncTelemetry.nextBackoffMs !== null && (
                        <p className="mt-1 text-[11px] text-[#9A3B26]">
                          Mất kết nối · thử lại lần {syncTelemetry.reconnectAttempt} sau{' '}
                          {syncTelemetry.nextBackoffMs}ms
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Room Lifecycle & Integrity Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {activeRoom.status === 'LOBBY' && (
                      <>
                        <button
                          type="button"
                          data-testid="toggle-ready-btn"
                          disabled={roomBusy}
                          onClick={() => void handleToggleReady()}
                          className={`border px-3 py-1.5 text-xs font-semibold ${
                            viewerReady
                              ? 'border-[#D9D6CC] bg-[#FFFFFF] text-[#171B20]'
                              : 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                          }`}
                        >
                          {viewerReady ? 'Hủy Sẵn sàng' : 'Xác nhận Sẵn sàng (Ready)'}
                        </button>
                        <button
                          type="button"
                          data-testid="start-room-btn"
                          disabled={!canStart || roomBusy}
                          onClick={() => void handleStartRoom()}
                          className="border border-[#171B20] bg-[#171B20] px-3 py-1.5 text-xs font-semibold text-[#FFFFFF] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:bg-[#E6E3DA] disabled:text-[#6E7681]"
                        >
                          Bắt đầu trận đấu &amp; Khóa slot
                        </button>
                        {!canStart && (
                          <span className="text-[11px] text-[#6E7681]">
                            {!bothFilled
                              ? 'Cần thêm người chơi thứ 2 tham gia bằng mã mời.'
                              : 'Cả Bắc và Nam phải cùng nhấn Sẵn sàng.'}
                          </span>
                        )}
                      </>
                    )}

                    {activeRoom.status === 'ACTIVE' && !confirmSurrender && (
                      <button
                        type="button"
                        data-testid="surrender-btn"
                        disabled={roomBusy}
                        onClick={() => setConfirmSurrender(true)}
                        className="inline-flex items-center gap-1.5 border border-[#9A3B26] bg-[#FFFFFF] px-3 py-1.5 text-xs font-semibold text-[#9A3B26] hover:bg-[#FDF2F0]"
                      >
                        <Flag className="h-3.5 w-3.5" />
                        <span>Đầu hàng (Surrender)</span>
                      </button>
                    )}

                    {activeRoom.status === 'ACTIVE' && confirmSurrender && (
                      <div className="flex items-center gap-2 border border-[#9A3B26] bg-[#FDF2F0] px-3 py-1 text-xs">
                        <span className="font-medium text-[#9A3B26]">Xác nhận đầu hàng?</span>
                        <button
                          type="button"
                          data-testid="confirm-surrender-btn"
                          disabled={roomBusy}
                          onClick={() => void handleSurrender()}
                          className="bg-[#9A3B26] px-2.5 py-1 font-semibold text-[#FFFFFF]"
                        >
                          Đồng ý đầu hàng
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmSurrender(false)}
                          className="border border-[#D9D6CC] bg-[#FFFFFF] px-2 py-1 text-[#171B20]"
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
                      className="inline-flex items-center gap-1.5 border border-[#D9D6CC] bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#171B20] hover:bg-[#F6F5F0]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Đồng bộ lại (Resync)</span>
                    </button>

                    <button
                      type="button"
                      data-testid="verify-room-replay-btn"
                      disabled={roomBusy}
                      onClick={() => void handleVerifyReplay()}
                      className="inline-flex items-center gap-1.5 border border-[#D9D6CC] bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#171B20] hover:bg-[#F6F5F0]"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-[#2B4C3F]" />
                      <span>Kiểm chứng Replay SHA-256</span>
                    </button>

                    <button
                      type="button"
                      data-testid="backup-audit-btn"
                      disabled={roomBusy}
                      onClick={() => void handleFetchBackupAudit()}
                      className="border border-[#D9D6CC] bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#171B20] hover:bg-[#F6F5F0]"
                    >
                      Tóm tắt Backup (Không bí mật)
                    </button>
                  </div>

                  {replayReport && (
                    <div className="border border-[#BFD6CA] bg-[#FFFFFF] p-3 font-mono text-[11px] text-[#171B20]">
                      Replay: {replayReport.verified ? 'KHỚP 100%' : 'SAI LỆCH'} · Commands:{' '}
                      {replayReport.replayedCommandCount} · SHA-256:{' '}
                      {replayReport.replayedHash.slice(0, 24)}...
                    </div>
                  )}

                  {backupSummary && (
                    <div className="border border-[#D9D6CC] bg-[#FFFFFF] p-3 font-mono text-[11px] text-[#545B66]">
                      Backup v{backupSummary.backupVersion} · v{backupSummary.version} · Lệnh:{' '}
                      {backupSummary.commandCount} · Snapshots: {backupSummary.snapshots.length} ·
                      secretsIncluded: {String(backupSummary.secretsIncluded)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Section 3: Active Match Nation Ledger & Sequenced Events (when a room is open) */}
      {activeMatch && (
        <section
          aria-label="Sổ cái quốc gia & Chuỗi sự kiện phòng đấu"
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
        >
          {/* Nation Ledgers */}
          <div className="border border-[#D9D6CC] bg-[#FFFFFF] p-5">
            <h3 className="text-sm font-semibold text-[#171B20]">
              Tài nguyên Quốc gia &amp; Chính quyền NPC Độc lập
            </h3>
            <p className="mt-0.5 text-xs text-[#6E7681]">
              Định dạng số cố định (scale 1000). Dữ liệu bí mật server (seed, RNG) không bao giờ gửi xuống client.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E6E3DA] text-[#545B66]">
                    <th className="py-2 pr-3 font-medium">Quốc gia</th>
                    <th className="px-2 py-2 font-medium">Vai trò</th>
                    <th className="px-2 py-2 text-right font-medium">Lương thực</th>
                    <th className="px-2 py-2 text-right font-medium">Công nghiệp</th>
                    <th className="pl-2 py-2 text-right font-medium">Ngân sách</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE5]">
                  {Object.values(activeMatch.nations).map((n) => (
                    <tr key={n.nationId}>
                      <td className="py-2 pr-3 font-medium text-[#171B20]">{n.name}</td>
                      <td className="px-2 py-2 font-mono text-[11px] text-[#545B66]">{n.slot}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {fpFormat(n.resources.food)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {fpFormat(n.resources.industrial)}
                      </td>
                      <td className="pl-2 py-2 text-right font-mono tabular-nums">
                        {fpFormat(n.resources.treasury)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sequenced Events & Scheduled Jobs */}
          <div className="border border-[#D9D6CC] bg-[#FFFFFF] p-5">
            <h3 className="text-sm font-semibold text-[#171B20]">
              Nhật ký Sự kiện theo Sequence ({activeMatch.events.length}) &amp; Tác vụ Đã đặt lịch (
              {Object.keys(activeMatch.jobs).length})
            </h3>
            {Object.values(activeMatch.jobs).length > 0 && (
              <div className="mt-3 space-y-1.5 border-b border-[#E6E3DA] pb-3">
                {Object.values(activeMatch.jobs).map((j) => (
                  <div
                    key={j.jobId}
                    className="flex flex-wrap items-center justify-between gap-2 bg-[#FAFAF7] px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[#171B20]">
                      {j.kind} · {j.jobId}
                    </span>
                    <span className="font-mono text-[11px] text-[#2B4C3F]">
                      {j.status} · Hạn: {formatUtc(j.completesAtUtc)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {activeMatch.events.length === 0 ? (
              <p className="mt-3 text-xs text-[#6E7681]">
                Chưa có sự kiện nào được phát. Sau khi trận đấu ở trạng thái ACTIVE, hãy chọn một vùng trên bản đồ để đặt lịch dự án.
              </p>
            ) : (
              <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto text-xs">
                {[...activeMatch.events].reverse().map((ev) => (
                  <li
                    key={ev.eventId}
                    className="flex items-start justify-between gap-3 border-b border-[#F0EDE5] pb-1.5 last:border-b-0"
                  >
                    <div>
                      <span className="font-mono font-semibold text-[#2B4C3F]">
                        #{ev.sequence}
                      </span>{' '}
                      <span className="font-medium text-[#171B20]">{ev.payload.type}</span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-[#6E7681] tabular-nums">
                      {formatUtc(ev.occurredAtUtc)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
