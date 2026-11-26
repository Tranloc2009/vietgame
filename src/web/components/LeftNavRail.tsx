import {
  Activity,
  Compass,
  Layers,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

export type WorkspaceDrawerId = 'none' | 'search' | 'rooms' | 'display' | 'diagnostics';

interface LeftNavRailProps {
  readonly activeDrawer: WorkspaceDrawerId;
  readonly onSelectDrawer: (drawer: WorkspaceDrawerId) => void;
  readonly hasActiveRoom: boolean;
  readonly isMobile: boolean;
}

interface NavItem {
  readonly id: WorkspaceDrawerId;
  readonly label: string;
  readonly shortLabel: string;
  readonly testId: string;
  readonly icon: typeof Compass;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'none',
    label: 'Bản đồ Chiến trường',
    shortLabel: 'Bản đồ',
    testId: 'rail-btn-map',
    icon: Compass,
  },
  {
    id: 'search',
    label: 'Tìm kiếm Vùng & Thành phố (/)',
    shortLabel: 'Tìm kiếm',
    testId: 'rail-btn-search',
    icon: Search,
  },
  {
    id: 'rooms',
    label: 'Phòng đấu 2 Người chơi (P02)',
    shortLabel: 'Phòng đấu',
    testId: 'rail-btn-rooms',
    icon: Users,
  },
  {
    id: 'display',
    label: 'Lớp Địa lý & Cấu hình Đồ họa',
    shortLabel: 'Hiển thị',
    testId: 'rail-btn-display',
    icon: SlidersHorizontal,
  },
  {
    id: 'diagnostics',
    label: 'Chẩn đoán Hệ thống & Nền tảng (P01/Dev)',
    shortLabel: 'Hệ thống',
    testId: 'rail-btn-diagnostics',
    icon: Activity,
  },
];

export function LeftNavRail({
  activeDrawer,
  onSelectDrawer,
  hasActiveRoom,
  isMobile,
}: LeftNavRailProps) {
  if (isMobile) {
    return (
      <nav
        aria-label="Điều hướng chiến lược di động"
        data-testid="mobile-bottom-nav"
        className="z-30 grid h-14 shrink-0 grid-cols-5 border-t border-[#2B3540] bg-[#12171D] pb-[env(safe-area-inset-bottom)] text-[#A8B2BC]"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeDrawer === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() =>
                onSelectDrawer(active && item.id !== 'none' ? 'none' : item.id)
              }
              className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                active
                  ? 'bg-[#1D242C] text-[#C6A15B]'
                  : 'text-[#9CA7B4] active:bg-[#1A2128]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[68px]">{item.shortLabel}</span>
              {item.id === 'rooms' && hasActiveRoom && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-3 h-1.5 w-1.5 bg-[#5FA374]"
                />
              )}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Thanh công cụ bên trái"
      data-testid="desktop-left-rail"
      className="z-20 flex w-14 shrink-0 flex-col items-center justify-between border-r border-[#2B3540] bg-[#12171D] py-2.5 text-[#A8B2BC] select-none"
    >
      <div className="flex flex-col items-center gap-1.5">
        {NAV_ITEMS.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const active = activeDrawer === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              aria-label={item.label}
              title={item.label}
              aria-pressed={active}
              onClick={() =>
                onSelectDrawer(active && item.id !== 'none' ? 'none' : item.id)
              }
              className={`relative flex h-11 w-11 flex-col items-center justify-center border transition-colors ${
                active
                  ? 'border-[#C6A15B] bg-[#1E262F] text-[#F2DC9F]'
                  : 'border-transparent bg-transparent text-[#9CA7B4] hover:border-[#2B3540] hover:bg-[#192028] hover:text-[#EFE9DC]'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="mt-0.5 text-[9px] font-medium leading-none">
                {item.shortLabel}
              </span>
              {item.id === 'rooms' && hasActiveRoom && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 h-1.5 w-1.5 bg-[#5FA374]"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom: Dev / Diagnostics workspace button */}
      <div className="flex flex-col items-center gap-1.5 border-t border-[#2B3540] pt-2.5">
        <button
          type="button"
          data-testid="rail-btn-diagnostics"
          aria-label="Chẩn đoán Hệ thống & Nền tảng (P01/Dev)"
          title="Chẩn đoán Hệ thống & Nền tảng (P01/Dev)"
          aria-pressed={activeDrawer === 'diagnostics'}
          onClick={() =>
            onSelectDrawer(activeDrawer === 'diagnostics' ? 'none' : 'diagnostics')
          }
          className={`flex h-11 w-11 flex-col items-center justify-center border transition-colors ${
            activeDrawer === 'diagnostics'
              ? 'border-[#C6A15B] bg-[#1E262F] text-[#F2DC9F]'
              : 'border-transparent text-[#758290] hover:border-[#2B3540] hover:bg-[#192028] hover:text-[#EFE9DC]'
          }`}
        >
          <Layers className="hidden" aria-hidden="true" />
          <Activity className="h-4 w-4" aria-hidden="true" />
          <span className="mt-0.5 text-[9px] font-medium leading-none">Dev</span>
        </button>
      </div>
    </nav>
  );
}
