import { Clock, Maximize2, Minimize2, Users, Wifi, WifiOff } from 'lucide-react';
import {
  FilteredClientMatchView,
  fpFormat,
  MatchRoomSummary,
  PublicUser,
} from '../../contracts';
import { HealthPayload } from '../api';
import { getFactionVisual } from '../map/designTokens';
import { RoomSyncTelemetry } from '../roomApi';

interface TopCommandBarProps {
  readonly health: HealthPayload | null;
  readonly user: PublicUser | null;
  readonly activeRoom: MatchRoomSummary | null;
  readonly activeMatch: FilteredClientMatchView | null;
  readonly syncTelemetry: RoomSyncTelemetry;
  readonly isFullscreen: boolean;
  readonly onToggleFullscreen: () => void;
  readonly onOpenRoomsDrawer: () => void;
}

function formatUtcShort(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function TopCommandBar({
  health,
  user,
  activeRoom,
  activeMatch,
  syncTelemetry,
  isFullscreen,
  onToggleFullscreen,
  onOpenRoomsDrawer,
}: TopCommandBarProps) {
  const viewerNation =
    activeMatch && activeRoom?.viewerNationId
      ? activeMatch.nations[activeRoom.viewerNationId]
      : null;
  const viewerFaction = getFactionVisual(activeRoom?.viewerNationId);
  const displayUtc = activeMatch?.currentUtc ?? health?.serverUtc ?? null;

  return (
    <header
      data-testid="top-command-bar"
      className="z-30 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#2B3540] bg-[#12171D] px-3 text-[#EFE9DC] select-none sm:px-4"
    >
      {/* Left: Brand Wordmark + Viewer Faction if in room */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-display text-xs font-bold tracking-[0.06em] text-[#EFE9DC] whitespace-nowrap sm:text-sm">
          VIETNAM: THE DIVIDED NATION
        </span>

        {activeRoom && activeRoom.viewerSlot && (
          <div className="hidden items-center gap-2 border-l border-[#2B3540] pl-3 text-xs md:flex">
            <span
              className="h-2.5 w-2.5 shrink-0 border border-[#EFE9DC]/40"
              style={{ backgroundColor: viewerFaction.fill }}
              aria-hidden="true"
            />
            <span className="font-semibold text-[#EFE9DC] whitespace-nowrap">
              {viewerFaction.shortName}
            </span>
            <span className="text-[#758290]" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-[11px] text-[#C6A15B] whitespace-nowrap">
              {activeRoom.status}
            </span>
          </div>
        )}
      </div>

      {/* Center: Compact Authoritative Resource Strip (when in active match) or Lobby Status */}
      <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
        {viewerNation ? (
          <div
            aria-label="Tài nguyên quốc gia hiện tại"
            className="flex items-center gap-3 font-mono text-[11px] tabular-nums whitespace-nowrap sm:gap-4 sm:text-xs"
          >
            <div className="flex items-center gap-1.5" title="Lương thực">
              <span className="text-[#8E9BA8]">LT</span>
              <span className="font-semibold text-[#D6E2C8]">
                {fpFormat(viewerNation.resources.food, 0)}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Công nghiệp">
              <span className="text-[#8E9BA8]">CN</span>
              <span className="font-semibold text-[#E5C68B]">
                {fpFormat(viewerNation.resources.industrial, 0)}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Ngân sách">
              <span className="text-[#8E9BA8]">NS</span>
              <span className="font-semibold text-[#EFE9DC]">
                {fpFormat(viewerNation.resources.treasury, 0)}
              </span>
            </div>
            <div className="hidden items-center gap-1.5 lg:flex" title="Nhân lực">
              <span className="text-[#8E9BA8]">NL</span>
              <span className="font-semibold text-[#CBD5E1]">
                {fpFormat(viewerNation.resources.manpower, 0)}
              </span>
            </div>
            <div className="hidden items-center gap-1.5 xl:flex" title="Chính trị">
              <span className="text-[#8E9BA8]">CT</span>
              <span className="font-semibold text-[#C6A15B]">
                {fpFormat(viewerNation.resources.politicalCapital, 0)}
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="topbar-open-rooms"
            onClick={onOpenRoomsDrawer}
            className="inline-flex h-8 items-center gap-1.5 border border-[#3C4957] bg-[#1C232B] px-2.5 text-xs font-medium text-[#EFE9DC] transition-colors hover:border-[#C6A15B] hover:text-[#F4DC9F] whitespace-nowrap"
          >
            <Users className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
            <span className="hidden sm:inline">
              {user ? `Sảnh 2 người · ${user.displayName}` : 'Đăng nhập / Phòng đấu 2 người'}
            </span>
            <span className="sm:hidden">{user ? user.displayName : 'Phòng đấu'}</span>
          </button>
        )}
      </div>

      {/* Right: Real-time 1:1 UTC Clock, Sync State & Fullscreen */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {displayUtc !== null && (
          <div
            title="Đồng hồ máy chủ thực 1:1 (24 giờ thực / ngày · không tua nhanh)"
            className="hidden items-center gap-1.5 font-mono text-[11px] text-[#C9D2DC] tabular-nums md:flex"
          >
            <Clock className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
            <span className="whitespace-nowrap">{formatUtcShort(displayUtc)}</span>
          </div>
        )}

        {activeRoom && (
          <div
            title={`WebSocket đồng bộ: ${syncTelemetry.status}`}
            className="hidden items-center gap-1 border-l border-[#2B3540] pl-2.5 font-mono text-[11px] sm:flex"
          >
            {syncTelemetry.status === 'connected' ? (
              <Wifi className="h-3.5 w-3.5 text-[#5FA374]" aria-hidden="true" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-[#C8923C]" aria-hidden="true" />
            )}
            <span className="text-[#9CA7B4]">v{activeMatch?.version ?? 0}</span>
          </div>
        )}

        <button
          type="button"
          data-testid="toggle-fullscreen-btn"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          title={isFullscreen ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)'}
          className="inline-flex h-8 w-8 items-center justify-center border border-[#2B3540] bg-[#161C22] text-[#A8B2BC] transition-colors hover:border-[#C6A15B] hover:text-[#EFE9DC]"
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
