import { RefreshCw, Radio, Database, ShieldCheck, AlertTriangle } from 'lucide-react';
import { HealthPayload, WsLiveState } from './api';

interface SystemStatusPanelProps {
  health: HealthPayload | null;
  loading: boolean;
  error: string | null;
  ws: WsLiveState;
  onRefresh: () => void;
}

function formatUtcTimestamp(ms: number | null | undefined): string {
  if (typeof ms !== 'number') return '—';
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function getWsLabel(status: WsLiveState['status']): { text: string; toneClass: string } {
  switch (status) {
    case 'connected':
      return { text: 'Đã kết nối (/ws)', toneClass: 'text-[#156C3B]' };
    case 'connecting':
      return { text: 'Đang thiết lập kết nối...', toneClass: 'text-[#9A5B00]' };
    case 'disconnected':
      return { text: 'Đã ngắt — tự động nối lại', toneClass: 'text-[#9A5B00]' };
    case 'error':
      return { text: 'Lỗi kết nối WebSocket', toneClass: 'text-[#B42318]' };
  }
}

export function SystemStatusPanel({
  health,
  loading,
  error,
  ws,
  onRefresh,
}: SystemStatusPanelProps) {
  const wsDisplay = getWsLabel(ws.status);

  if (loading && !health) {
    return (
      <section
        aria-label="Trạng thái kết nối hệ thống"
        className="border border-[#D9D6CC] bg-[#FFFFFF] p-6"
      >
        <div className="mb-4 h-5 w-56 animate-pulse bg-[#EAE7DF]" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-24 animate-pulse bg-[#F2F0EA]" />
          <div className="h-24 animate-pulse bg-[#F2F0EA]" />
          <div className="h-24 animate-pulse bg-[#F2F0EA]" />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Trạng thái kết nối hệ thống"
      className="border border-[#D9D6CC] bg-[#FFFFFF]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6E3DA] px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-[#171B20]">
            01. Phiên bản &amp; Trạng thái kết nối thực
          </h2>
          <p className="mt-0.5 text-sm text-[#545B66]">
            Dữ liệu được đọc trực tiếp từ Express HTTP API, SQLite persistent và kênh WebSocket.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={ws.sendPing}
            disabled={ws.status !== 'connected'}
            title={
              ws.status !== 'connected'
                ? 'Chỉ gửi được ping khi WebSocket đang ở trạng thái Đã kết nối'
                : 'Đo thời gian phản hồi thực từ WebSocket server'
            }
            className="inline-flex items-center gap-2 border border-[#CFD3D9] bg-[#FAF9F6] px-3.5 py-2 text-xs font-medium text-[#171B20] transition-colors hover:bg-[#EFECE4] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            Gửi Ping WebSocket
          </button>

          <button
            type="button"
            onClick={() => {
              onRefresh();
              if (ws.status !== 'connected') {
                ws.reconnect();
              }
            }}
            className="inline-flex items-center gap-2 bg-[#1D2939] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#111926] whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Kiểm tra lại kết nối
          </button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 border-b border-[#F3C6C3] bg-[#FEF3F2] px-6 py-4 text-sm text-[#912018]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Không thể kết nối tới backend server</p>
            <p className="mt-0.5 text-xs">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 divide-y divide-[#E6E3DA] md:grid-cols-3 md:divide-x md:divide-y-0">
        {/* Column 1: Build & Contract Versions */}
        <div className="p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#545B66]">
            <ShieldCheck className="h-4 w-4 text-[#2B4C3F]" aria-hidden="true" />
            <span>Phiên bản nền tảng &amp; Hợp đồng</span>
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">App Version</dt>
              <dd className="text-right font-mono font-medium text-[#171B20]">
                {health?.appVersion ?? '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Contract Schema</dt>
              <dd className="text-right font-mono font-medium text-[#171B20]">
                {health?.contractVersion ?? '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Simulation Reducer</dt>
              <dd className="text-right font-mono font-medium text-[#171B20]">
                {health?.simulationVersion ?? '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Phụ thuộc AI API</dt>
              <dd className="text-right font-mono font-medium text-[#156C3B]">
                {health ? (health.aiApiDependency ? 'Có' : 'Không (0 AI API)') : '—'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Column 2: Persistent SQLite & Realtime Policy */}
        <div className="p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#545B66]">
            <Database className="h-4 w-4 text-[#2B4C3F]" aria-hidden="true" />
            <span>Lưu trữ bền vững SQLite</span>
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Trạng thái ghi DB</dt>
              <dd
                className={`text-right font-medium ${
                  health?.database.writable ? 'text-[#156C3B]' : 'text-[#B42318]'
                }`}
              >
                {health
                  ? health.database.writable
                    ? 'Sẵn sàng ghi (Verified)'
                    : 'Không ghi được'
                  : '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Tệp SQLite</dt>
              <dd className="max-w-[190px] truncate text-right font-mono text-xs text-[#171B20]">
                {health?.database.fileLabel ?? '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Migration đã chạy</dt>
              <dd className="text-right font-mono text-xs text-[#171B20]">
                {health ? health.database.appliedMigrations.join(', ') || 'Chưa có' : '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Thời gian thực</dt>
              <dd className="text-right font-mono text-xs text-[#171B20]">
                {health
                  ? `${health.realtimePolicy.secondsPerGameDay.toLocaleString('en-US')}s/ngày · Không tua`
                  : '—'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Column 3: Live WebSocket & Authoritative UTC Clock */}
        <div className="p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#545B66]">
            <Radio className="h-4 w-4 text-[#2B4C3F]" aria-hidden="true" />
            <span>Kênh WebSocket &amp; Đồng hồ Server</span>
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">WebSocket</dt>
              <dd className={`text-right font-medium ${wsDisplay.toneClass}`}>{wsDisplay.text}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Kết nối đang mở</dt>
              <dd className="text-right font-mono font-medium text-[#171B20]">
                {ws.activeConnections ?? health?.websocket.activeConnections ?? '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Độ trễ Ping thực</dt>
              <dd className="text-right font-mono text-xs text-[#171B20]">
                {ws.lastPingMs !== null ? `${ws.lastPingMs} ms` : 'Chưa đo (bấm Gửi Ping)'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[#545B66]">Đồng hồ UTC</dt>
              <dd className="text-right font-mono text-xs text-[#171B20]">
                {formatUtcTimestamp(ws.lastServerUtc ?? health?.serverUtc)}
              </dd>
            </div>
          </dl>
          {ws.errorReason ? (
            <p className="mt-2 text-xs text-[#B42318]">{ws.errorReason}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
