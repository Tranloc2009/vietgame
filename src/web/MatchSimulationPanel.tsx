import { useState } from 'react';
import {
  CheckCircle2,
  RotateCcw,
  Send,
  CopyCheck,
  AlertCircle,
  Hash,
  Layers,
} from 'lucide-react';
import {
  ActorIdSchema,
  asUtcEpochMs,
  ClientMatchView,
  Command,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  fpFormat,
  IdempotencyKeySchema,
  NationIdSchema,
  ResourceType,
  wholeUnitsToFixedPoint,
} from '../contracts';
import {
  CommandSubmitResponse,
  createOrResetFixture,
  HealthPayload,
  ReplayVerificationResponse,
  submitMatchCommand,
  verifyMatchReplay,
} from './api';

interface MatchSimulationPanelProps {
  health: HealthPayload | null;
  match: ClientMatchView | null;
  loading: boolean;
  onMatchLoaded: (match: ClientMatchView) => void;
}

const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: 'Lương thực',
  industrial: 'Công nghiệp',
  treasury: 'Ngân khố',
  manpower: 'Nhân lực',
  politicalCapital: 'Vốn chính trị',
};

export function MatchSimulationPanel({
  health,
  match,
  loading,
  onMatchLoaded,
}: MatchSimulationPanelProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<CommandSubmitResponse | null>(null);
  const [replayFeedback, setReplayFeedback] = useState<ReplayVerificationResponse | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<{
    actorHeader: string;
    command: Command;
  } | null>(null);

  // Command form state
  const [actorId, setActorId] = useState<string>('act_human_north');
  const [fromNationId, setFromNationId] = useState<string>('nat_north_dir');
  const [toNationId, setToNationId] = useState<string>('nat_npc_highland');
  const [resource, setResource] = useState<ResourceType>('food');
  const [amountWhole, setAmountWhole] = useState<string>('10');
  const [reason, setReason] = useState<string>('Thỏa thuận hậu cần trừu tượng');
  const [idempotencySeed, setIdempotencySeed] = useState<number>(1);

  const canCreateFixture = Boolean(
    health && health.database.writable && health.allowPreviewFixture && !health.isProduction
  );

  const disabledFixtureReason = !health
    ? 'Đang chờ kết nối server.'
    : !health.database.writable
      ? 'Database SQLite hiện không ghi được.'
      : health.isProduction || !health.allowPreviewFixture
        ? 'Bị khóa trong môi trường Production để tách khỏi dữ liệu thật.'
        : undefined;

  async function handleInitFixture(reset: boolean) {
    setBusyAction(reset ? 'reset' : 'init');
    setActionError(null);
    setCommandFeedback(null);
    setReplayFeedback(null);
    setLastSubmitted(null);
    try {
      const created = await createOrResetFixture(reset);
      onMatchLoaded(created);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể khởi tạo fixture');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSubmitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!match) return;

    const parsedAmount = Number(amountWhole);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setActionError('Số lượng chuyển phải là số nguyên dương (hệ thống tự quy đổi sang fixed-point x1000).');
      return;
    }

    const actor = match.actors[actorId];
    const nextSequence = actor ? actor.lastSequence + 1 : 1;
    const timestamp = Date.now();
    const cmdId = `cmd_ui_${match.version + 1}_${idempotencySeed}`;
    const idemKey = `idem_ui_${match.matchId}_v${match.version}_${idempotencySeed}`;

    let command: Command;
    try {
      command = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse(cmdId),
        matchId: match.matchId,
        actorId: ActorIdSchema.parse(actorId),
        idempotencyKey: IdempotencyKeySchema.parse(idemKey),
        sequence: nextSequence,
        expectedVersion: match.version,
        issuedAtUtc: asUtcEpochMs(timestamp),
        payload: {
          type: 'TRANSFER_RESOURCE',
          fromNationId: NationIdSchema.parse(fromNationId),
          toNationId: NationIdSchema.parse(toNationId),
          resource,
          amountFp: wholeUnitsToFixedPoint(parsedAmount),
          reason: reason.trim() || 'Abstract resource transfer',
        },
      };
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Dữ liệu lệnh không hợp lệ theo hợp đồng.');
      return;
    }

    setBusyAction('command');
    setActionError(null);
    setReplayFeedback(null);
    try {
      const response = await submitMatchCommand(match.matchId, actorId, command);
      setCommandFeedback(response);
      if (response.ok && response.match) {
        onMatchLoaded(response.match);
        setLastSubmitted({ actorHeader: actorId, command });
        setIdempotencySeed((n) => n + 1);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Lỗi gửi lệnh tới server');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReplayDuplicateCommand() {
    if (!match || !lastSubmitted) return;
    setBusyAction('duplicate');
    setActionError(null);
    try {
      const response = await submitMatchCommand(
        match.matchId,
        lastSubmitted.actorHeader,
        lastSubmitted.command
      );
      setCommandFeedback(response);
      if (response.ok && response.match) {
        onMatchLoaded(response.match);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Lỗi kiểm thử lệnh lặp');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerifyReplay() {
    if (!match) return;
    setBusyAction('verify');
    setActionError(null);
    try {
      const result = await verifyMatchReplay(match.matchId);
      setReplayFeedback(result);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Lỗi xác minh replay hash');
    } finally {
      setBusyAction(null);
    }
  }

  if (loading && !match) {
    return (
      <section
        aria-label="Mô phỏng & Hợp đồng dữ liệu"
        className="border border-[#D9D6CC] bg-[#FFFFFF] p-6"
      >
        <div className="mb-4 h-5 w-64 animate-pulse bg-[#EAE7DF]" />
        <div className="h-40 animate-pulse bg-[#F2F0EA]" />
      </section>
    );
  }

  if (!match) {
    return (
      <section
        aria-label="Mô phỏng & Hợp đồng dữ liệu"
        className="border border-[#D9D6CC] bg-[#FFFFFF]"
      >
        <div className="border-b border-[#E6E3DA] px-6 py-4">
          <h2 className="text-base font-semibold text-[#171B20]">
            02. Lưu trữ Match &amp; Kiểm chứng Reducer tất định (P01-02 / P01-03)
          </h2>
          <p className="mt-0.5 text-sm text-[#545B66]">
            Chưa có match nào được lưu trong tệp SQLite hiện tại.
          </p>
        </div>

        <div className="px-6 py-10 text-center">
          <Layers className="mx-auto h-8 w-8 text-[#6E7681]" aria-hidden="true" />
          <h3 className="mt-3 text-base font-semibold text-[#171B20]">
            Trạng thái trống — Chưa có phiên mô phỏng
          </h3>
          <p className="mx-auto mt-1.5 max-w-xl text-sm text-[#545B66]">
            Khởi tạo fixture hư cấu 2 phe (Bắc / Nam) kèm 1 NPC độc lập để kiểm tra lưu trữ SQLite,
            bảo toàn tài nguyên fixed-point, idempotency key và xác minh replay hash trực tiếp trên server.
          </p>

          {actionError ? (
            <p role="alert" className="mt-4 text-sm font-medium text-[#B42318]">
              {actionError}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              type="button"
              disabled={!canCreateFixture || busyAction !== null}
              onClick={() => handleInitFixture(false)}
              className="bg-[#2B4C3F] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1F392F] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              {busyAction === 'init'
                ? 'Đang khởi tạo trong SQLite...'
                : 'Khởi tạo Fixture 2 Phe (Preview)'}
            </button>
            {disabledFixtureReason ? (
              <p className="text-xs text-[#6E7681]">Lý do khóa nút: {disabledFixtureReason}</p>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const nationsList = Object.values(match.nations);
  const actorsList = Object.values(match.actors).filter((a) => a.role !== 'SYSTEM');

  const resourceKeys: ResourceType[] = [
    'food',
    'industrial',
    'treasury',
    'manpower',
    'politicalCapital',
  ];

  const activeTotals: Record<ResourceType, number> = {
    food: 0,
    industrial: 0,
    treasury: 0,
    manpower: 0,
    politicalCapital: 0,
  };
  for (const n of nationsList) {
    for (const k of resourceKeys) {
      activeTotals[k] += n.resources[k] as number;
    }
  }

  return (
    <section
      aria-label="Mô phỏng & Hợp đồng dữ liệu"
      className="border border-[#D9D6CC] bg-[#FFFFFF]"
    >
      {/* Match Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E6E3DA] px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-[#171B20]">
            02. {match.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#545B66]">
            <span className="font-mono text-[#171B20]">{match.matchId}</span>
            <span aria-hidden="true">·</span>
            <span>Version: <strong className="font-mono text-[#171B20]">{match.version}</strong></span>
            <span aria-hidden="true">·</span>
            <span>2 Slot Người Thật (Bắc / Nam) + NPC Độc Lập</span>
            <span aria-hidden="true">·</span>
            <span>Số liệu trừu tượng hư cấu</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleVerifyReplay}
            className="inline-flex items-center gap-2 border border-[#2B4C3F] bg-[#2B4C3F] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1F392F] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Hash className="h-3.5 w-3.5" aria-hidden="true" />
            {busyAction === 'verify' ? 'Đang chạy Replay...' : 'Xác minh Replay Hash'}
          </button>

          <button
            type="button"
            disabled={!canCreateFixture || busyAction !== null}
            title={disabledFixtureReason}
            onClick={() => handleInitFixture(true)}
            className="inline-flex items-center gap-2 border border-[#CFD3D9] bg-[#FAF9F6] px-3.5 py-2 text-xs font-medium text-[#171B20] transition-colors hover:bg-[#EFECE4] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Đặt lại Fixture
          </button>
        </div>
      </div>

      {/* Authoritative SHA-256 Digest Bar */}
      <div className="border-b border-[#E6E3DA] bg-[#FAF9F6] px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-[#545B66]">
            Canonical State SHA-256 (Server Authoritative — không gửi seed/bí mật xuống client):
          </span>
          <code
            data-testid="state-hash"
            className="font-mono text-xs font-medium text-[#171B20] break-all"
          >
            {match.stateHash}
          </code>
        </div>
      </div>

      {/* Replay verification banner */}
      {replayFeedback?.report ? (
        <div
          role="status"
          className={`flex items-start gap-3 border-b px-6 py-3.5 text-sm ${
            replayFeedback.report.verified
              ? 'border-[#C6E6D4] bg-[#F0FAF4] text-[#115E34]'
              : 'border-[#F3C6C3] bg-[#FEF3F2] text-[#912018]'
          }`}
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {replayFeedback.report.verified
                ? `Replay tất định khớp 100% (${replayFeedback.report.replayedCommandCount} lệnh trong SQLite command_log)`
                : 'Cảnh báo: Hash replay không khớp với trạng thái lưu trữ!'}
            </p>
            <p className="mt-0.5 font-mono text-xs break-all">
              Replayed SHA-256: {replayFeedback.report.replayedHash}
            </p>
          </div>
        </div>
      ) : null}

      {/* Nation Fixed-Point Resource Ledger (Conservation Proof) */}
      <div className="border-b border-[#E6E3DA] px-6 py-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#171B20]">
            Sổ cái Tài nguyên Fixed-Point (Scale 1.000 = 1000 số nguyên)
          </h3>
          <span className="text-xs text-[#545B66]">
            Bảo toàn: Tổng các phe + Đã tiêu hao = Tổng khởi tạo
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#D9D6CC] text-xs font-semibold text-[#545B66]">
                <th className="py-2 pr-4">Quốc gia / Phe</th>
                <th className="py-2 pr-4">Slot</th>
                {resourceKeys.map((k) => (
                  <th key={k} className="py-2 px-3 text-right">
                    {RESOURCE_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFECE4]">
              {nationsList.map((nation) => (
                <tr key={nation.nationId}>
                  <td className="py-2.5 pr-4 font-medium text-[#171B20]">
                    <div>{nation.name}</div>
                    <div className="font-mono text-xs text-[#6E7681]">{nation.nationId}</div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-[#545B66]">
                    {nation.slot === 'NPC' ? 'NPC Độc Lập' : `Người Thật (${nation.slot})`}
                  </td>
                  {resourceKeys.map((k) => (
                    <td
                      key={k}
                      className="py-2.5 px-3 text-right font-mono tabular-nums text-[#171B20]"
                    >
                      {fpFormat(nation.resources[k], 3)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-[#FAF9F6] font-semibold">
                <td className="py-2.5 pr-4 text-xs text-[#171B20]" colSpan={2}>
                  Tổng lưu hành bảo toàn (Active Pool)
                </td>
                {resourceKeys.map((k) => (
                  <td
                    key={k}
                    className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[#156C3B]"
                  >
                    {fpFormat(activeTotals[k] as never, 3)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Authoritative Command Dispatch & Idempotency Tester */}
      <div className="grid grid-cols-1 divide-y divide-[#E6E3DA] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        <div className="p-6 lg:col-span-6">
          <h3 className="text-sm font-semibold text-[#171B20]">
            Kiểm thử Lệnh Authoritative &amp; Idempotency
          </h3>
          <p className="mt-1 text-xs text-[#545B66]">
            Server tự xác thực header <code className="font-mono">x-actor-id</code>, quyền sở hữu phe,
            số dư fixed-point, <code className="font-mono">expectedVersion</code> và <code className="font-mono">idempotencyKey</code> trong 1 transaction SQLite.
          </p>

          <form onSubmit={handleSubmitTransfer} className="mt-4 space-y-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="actor-select"
                  className="block text-xs font-medium text-[#374151]"
                >
                  Actor gửi lệnh (x-actor-id)
                </label>
                <select
                  id="actor-select"
                  value={actorId}
                  onChange={(e) => setActorId(e.target.value)}
                  className="mt-1 w-full border border-[#CFD3D9] bg-white px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                >
                  {actorsList.map((a) => (
                    <option key={a.actorId} value={a.actorId}>
                      {a.displayName} (seq: {a.lastSequence})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="resource-select"
                  className="block text-xs font-medium text-[#374151]"
                >
                  Tài nguyên chuyển
                </label>
                <select
                  id="resource-select"
                  value={resource}
                  onChange={(e) => setResource(e.target.value as ResourceType)}
                  className="mt-1 w-full border border-[#CFD3D9] bg-white px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                >
                  {resourceKeys.map((k) => (
                    <option key={k} value={k}>
                      {RESOURCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="from-nation"
                  className="block text-xs font-medium text-[#374151]"
                >
                  Từ quốc gia (Nguồn)
                </label>
                <select
                  id="from-nation"
                  value={fromNationId}
                  onChange={(e) => setFromNationId(e.target.value)}
                  className="mt-1 w-full border border-[#CFD3D9] bg-white px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                >
                  {nationsList.map((n) => (
                    <option key={n.nationId} value={n.nationId}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="to-nation"
                  className="block text-xs font-medium text-[#374151]"
                >
                  Đến quốc gia (Đích)
                </label>
                <select
                  id="to-nation"
                  value={toNationId}
                  onChange={(e) => setToNationId(e.target.value)}
                  className="mt-1 w-full border border-[#CFD3D9] bg-white px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                >
                  {nationsList.map((n) => (
                    <option key={n.nationId} value={n.nationId}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="amount-input"
                  className="block text-xs font-medium text-[#374151]"
                >
                  Số lượng (đơn vị nguyên)
                </label>
                <input
                  id="amount-input"
                  type="number"
                  min={1}
                  step={1}
                  value={amountWhole}
                  onChange={(e) => setAmountWhole(e.target.value)}
                  className="mt-1 w-full border border-[#CFD3D9] bg-white px-3 py-2 font-mono text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="reason-input"
                  className="block text-xs font-medium text-[#374151]"
                >
                  Ghi chú lệnh
                </label>
                <input
                  id="reason-input"
                  type="text"
                  maxLength={120}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full border border-[#CFD3D9] bg-white px-3 py-2 text-sm text-[#171B20] focus:border-[#2B4C3F] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busyAction !== null}
                className="inline-flex items-center gap-2 bg-[#1D2939] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#111926] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {busyAction === 'command' ? 'Đang ghi transaction...' : 'Gửi Lệnh Tới Server'}
              </button>

              <button
                type="button"
                disabled={!lastSubmitted || busyAction !== null}
                title={
                  !lastSubmitted
                    ? 'Hãy gửi thành công ít nhất 1 lệnh trước để kiểm thử gửi lặp idempotency key'
                    : 'Gửi lại đúng payload và idempotencyKey vừa thực thi để xác minh không trừ trùng'
                }
                onClick={handleReplayDuplicateCommand}
                className="inline-flex items-center gap-2 border border-[#CFD3D9] bg-[#FAF9F6] px-3.5 py-2 text-xs font-medium text-[#171B20] transition-colors hover:bg-[#EFECE4] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                <CopyCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Gửi Lặp Idempotency Key
              </button>
            </div>

            {!lastSubmitted ? (
              <p className="text-xs text-[#6E7681]">
                Nút gửi lặp đang khóa: cần có ít nhất một lệnh đã thực thi thành công để tái gửi cùng Idempotency Key.
              </p>
            ) : null}
          </form>

          {actionError ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 border border-[#F3C6C3] bg-[#FEF3F2] p-3 text-xs text-[#912018]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          ) : null}

          {commandFeedback ? (
            <div
              role="status"
              data-testid="command-feedback"
              className={`mt-4 border p-3 text-xs ${
                commandFeedback.ok
                  ? commandFeedback.idempotentDuplicate
                    ? 'border-[#F5D08A] bg-[#FFFAEB] text-[#8A4B08]'
                    : 'border-[#C6E6D4] bg-[#F0FAF4] text-[#115E34]'
                  : 'border-[#F3C6C3] bg-[#FEF3F2] text-[#912018]'
              }`}
            >
              {commandFeedback.ok ? (
                commandFeedback.idempotentDuplicate ? (
                  <p>
                    <strong>Idempotent Duplicate Detected:</strong> Server nhận diện trùng{' '}
                    <code className="font-mono">{lastSubmitted?.command.idempotencyKey}</code> —
                    không ghi lặp event, không trừ tài nguyên lần hai (Version giữ nguyên{' '}
                    <strong className="font-mono">{commandFeedback.version}</strong>).
                  </p>
                ) : (
                  <p>
                    <strong>Đã ghi nhận giao dịch:</strong> Version mới{' '}
                    <strong className="font-mono">{commandFeedback.version}</strong> · Hash mới đã
                    cập nhật và phát qua WebSocket.
                  </p>
                )
              ) : (
                <p>
                  <strong>Server từ chối ({commandFeedback.code}):</strong> {commandFeedback.reason}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Authoritative Persisted Event Log */}
        <div className="p-6 lg:col-span-6">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#171B20]">
              Nhật ký Sự kiện Authoritative ({match.events.length})
            </h3>
            <span className="text-xs text-[#545B66]">Thứ tự ổn định theo UTC + Tie-Break</span>
          </div>

          {match.events.length === 0 ? (
            <div className="mt-4 border border-dashed border-[#D9D6CC] bg-[#FAF9F6] px-4 py-8 text-center text-xs text-[#545B66]">
              Chưa có sự kiện nào phát sinh. Gửi một lệnh chuyển tài nguyên ở khung bên trái để ghi
              sự kiện đầu tiên vào SQLite <code className="font-mono">event_log</code>.
            </div>
          ) : (
            <div className="mt-4 max-h-80 overflow-y-auto border border-[#E6E3DA]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[#FAF9F6] text-[#545B66]">
                  <tr className="border-b border-[#E6E3DA]">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Event ID / Loại</th>
                    <th className="px-3 py-2 font-semibold">UTC Timestamp</th>
                    <th className="px-3 py-2 font-semibold text-right">Ưu tiên</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFECE4]">
                  {[...match.events].reverse().map((ev) => (
                    <tr key={ev.eventId}>
                      <td className="px-3 py-2 font-mono tabular-nums text-[#545B66]">
                        {ev.sequence}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono font-medium text-[#171B20]">{ev.payload.type}</div>
                        <div className="font-mono text-[11px] text-[#6E7681]">{ev.eventId}</div>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-[#545B66]">
                        {new Date(ev.occurredAtUtc).toISOString().slice(11, 19)}Z
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[#545B66]">
                        {ev.tieBreakPriority}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
