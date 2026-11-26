import { useCallback, useEffect, useState } from 'react';
import { ClientMatchView } from './contracts';
import {
  fetchHealth,
  fetchMatchDetail,
  fetchMatches,
  HealthPayload,
  useLiveWebSocket,
} from './web/api';
import { MatchSimulationPanel } from './web/MatchSimulationPanel';
import { MultiplayerWorkspace } from './web/MultiplayerWorkspace';
import { SystemStatusPanel } from './web/SystemStatusPanel';

type ActiveTab = 'multiplayer' | 'foundation';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('multiplayer');

  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [activeMatch, setActiveMatch] = useState<ClientMatchView | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);

  const refreshSystem = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const [h, matches] = await Promise.all([fetchHealth(), fetchMatches()]);
      setHealth(h);
      const fixtureMatch =
        matches.find((m) => m.matchId === 'mch_preview_alt_1955') ?? matches[0] ?? null;
      if (fixtureMatch) {
        const detail = await fetchMatchDetail(fixtureMatch.matchId);
        setActiveMatch(detail);
      } else {
        setActiveMatch(null);
      }
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : 'Không thể đọc trạng thái từ máy chủ.'
      );
    } finally {
      setHealthLoading(false);
      setMatchLoading(false);
    }
  }, []);

  const handleWsMatchUpdate = useCallback(async (matchId: string) => {
    if (matchId !== 'mch_preview_alt_1955') return;
    try {
      const detail = await fetchMatchDetail(matchId);
      setActiveMatch(detail);
    } catch {
      // Ignore transient refresh failure; user can retry manually
    }
  }, []);

  const ws = useLiveWebSocket(handleWsMatchUpdate);

  useEffect(() => {
    void refreshSystem();
  }, [refreshSystem]);

  return (
    <div className="min-h-screen bg-[#F6F5F0] text-[#171B20]">
      {/* Minimal Top Bar */}
      <header className="border-b border-[#D9D6CC] bg-[#FFFFFF]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="text-base font-bold tracking-tight text-[#171B20] whitespace-nowrap shrink-0">
            VIETNAM: THE DIVIDED NATION
          </span>

          <nav aria-label="Điều hướng chính" className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="nav-tab-multiplayer"
              onClick={() => setActiveTab('multiplayer')}
              className={`border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'multiplayer'
                  ? 'border-[#171B20] bg-[#171B20] text-[#FFFFFF]'
                  : 'border-[#D9D6CC] bg-[#F6F5F0] text-[#171B20] hover:bg-[#EBE8DF]'
              }`}
            >
              Thế giới &amp; Phòng đấu (P02)
            </button>
            <button
              type="button"
              data-testid="nav-tab-foundation"
              onClick={() => setActiveTab('foundation')}
              className={`border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'foundation'
                  ? 'border-[#171B20] bg-[#171B20] text-[#FFFFFF]'
                  : 'border-[#D9D6CC] bg-[#F6F5F0] text-[#171B20] hover:bg-[#EBE8DF]'
              }`}
            >
              Trạng thái &amp; Nền tảng (P01)
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-[#545B66] whitespace-nowrap">
              {health?.isProduction
                ? 'Production'
                : 'Preview Thử Nghiệm · Tách biệt Production'}
            </span>
            <span className="font-mono text-xs text-[#545B66] whitespace-nowrap shrink-0">
              {health ? `v${health.appVersion}` : 'Đang tải...'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
        {/* Intro Context Strip */}
        <section className="flex flex-col justify-between gap-2 border-b border-[#DCD9CE] pb-3.5 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-medium text-[#2B4C3F]">
              {activeTab === 'multiplayer'
                ? 'Giai đoạn 02 (P02-01 · P02-02 · P02-03 · P02-04 · P02-05) · Bản Đồ Địa Lý Chiến Lược 72 Vùng & Multiplayer 2 Slot'
                : 'Nền tảng Giai đoạn 01 (P01-01 · P01-02 · P01-03) · Kiểm chứng SQLite & Reducer'}
            </p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-[#171B20] sm:text-2xl [text-wrap:balance]">
              {activeTab === 'multiplayer'
                ? 'Bản Đồ Địa Lý Chiến Lược 72 Vùng, Đồng Hồ UTC & Phòng Đấu 2 Người Chơi'
                : 'Màn hình khởi đầu & Kiểm chứng Nền tảng Authoritative'}
            </h1>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-[#545B66]">
              Địa lý tự nhiên tham chiếu Natural Earth 1:10m &amp; NASA SRTM 90m (Public Domain). Ranh giới 72 vùng,
              mạng giao thông và các thực thể là cơ chế trò chơi trừu tượng thuộc bối cảnh lịch sử thay thế 1955 — không
              phải dữ kiện lịch sử. Trạng thái được tính toán hoàn toàn trên server, lưu SQLite và đồng bộ WebSocket.
            </p>
          </div>
        </section>

        <div className={activeTab === 'multiplayer' ? '' : 'hidden'}>
          <MultiplayerWorkspace />
        </div>

        {activeTab === 'foundation' && (
          <div className="space-y-6">
            <SystemStatusPanel
              health={health}
              loading={healthLoading}
              error={healthError}
              ws={ws}
              onRefresh={() => void refreshSystem()}
            />

            <MatchSimulationPanel
              health={health}
              match={activeMatch}
              loading={matchLoading}
              onMatchLoaded={(m) => {
                setActiveMatch(m);
                void fetchHealth()
                  .then(setHealth)
                  .catch(() => {});
              }}
            />
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1440px] border-t border-[#DCD9CE] px-4 py-5 text-xs text-[#6E7681] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            VIETNAM: THE DIVIDED NATION · Phase 01 &amp; Phase 02 Authoritative World
          </span>
          <span>
            Server Authoritative · 24h thực / ngày · Đúng 2 slot Bắc/Nam · Không pay-to-win · Không AI API trả phí
          </span>
        </div>
      </footer>
    </div>
  );
}
