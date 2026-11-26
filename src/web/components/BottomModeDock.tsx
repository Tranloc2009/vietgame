import { useState } from 'react';
import { BookOpen, Lock, X } from 'lucide-react';
import { MapLayerMode } from '../../contracts';
import {
  ACTIVE_MAP_LAYERS,
  buildLegendItems,
  FUTURE_MAP_MODES_REGISTRY,
  getActiveMapLayerDescriptor,
} from '../mapLayerRegistry';

interface BottomModeDockProps {
  readonly layer: MapLayerMode;
  readonly onChangeLayer: (layer: MapLayerMode) => void;
  readonly isMobile: boolean;
}

export function BottomModeDock({ layer, onChangeLayer, isMobile }: BottomModeDockProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const [futureOpen, setFutureOpen] = useState(false);

  const activeDesc = getActiveMapLayerDescriptor(layer);
  const legendItems = buildLegendItems(layer);

  return (
    <div
      data-testid="bottom-mode-dock"
      className="pointer-events-auto relative flex flex-col items-center gap-1.5"
    >
      {/* Contextual Legend Popover */}
      {legendOpen && (
        <div
          data-testid="map-legend-popover"
          className="w-[300px] max-w-[calc(100vw-24px)] border border-[#3C4957] bg-[#161C22]/96 p-3 text-xs text-[#EFE9DC] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[#252E38] pb-2">
            <div>
              <p className="font-semibold text-[#C6A15B]">Chú giải · {activeDesc.label}</p>
              <p className="mt-0.5 text-[10px] text-[#9CA7B4]">{activeDesc.shortDesc}</p>
            </div>
            <button
              type="button"
              aria-label="Đóng chú giải"
              onClick={() => setLegendOpen(false)}
              className="flex h-6 w-6 items-center justify-center text-[#9CA7B4] hover:text-[#EFE9DC]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 min-w-0">
                <span
                  className="h-2.5 w-2.5 shrink-0 border border-[#EFE9DC]/30"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span className="truncate text-[#D8D3C6]">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 border-t border-[#252E38] pt-2 text-[10px] text-[#758290]">
            <span>Tuyến giao thông (1955 hư cấu): </span>
            <span className="text-[#C66B36]">Đường chính</span> ·{' '}
            <span className="text-[#E6DEC8]">Đường sắt</span> ·{' '}
            <span className="text-[#42A5B5]">Vượt sông</span>
          </div>
        </div>
      )}

      {/* Future Roadmap Modes Info Popover (explicitly disabled / non-playable) */}
      {futureOpen && (
        <div
          data-testid="future-modes-popover"
          className="w-[320px] max-w-[calc(100vw-24px)] border border-[#3C4957] bg-[#161C22]/96 p-3 text-xs text-[#EFE9DC] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[#252E38] pb-2">
            <span className="font-semibold text-[#A8B2BC]">
              Các chế độ bản đồ theo lộ trình (Chưa mở khóa)
            </span>
            <button
              type="button"
              aria-label="Đóng danh sách chế độ tương lai"
              onClick={() => setFutureOpen(false)}
              className="flex h-6 w-6 items-center justify-center text-[#9CA7B4] hover:text-[#EFE9DC]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px]">
            {FUTURE_MAP_MODES_REGISTRY.map((fm) => (
              <li
                key={fm.id}
                className="flex items-center justify-between border border-dashed border-[#2B3540] bg-[#12171D] px-2.5 py-1.5 text-[#758290]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{fm.label}</span>
                </span>
                <span className="font-mono text-[10px]">{fm.targetPhase}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Active Mode Segmented Strip */}
      <div
        role="tablist"
        aria-label="Chế độ lớp bản đồ"
        className="flex items-center gap-0.5 border border-[#2B3540] bg-[#12171D]/95 p-1 shadow-xl"
      >
        {ACTIVE_MAP_LAYERS.map((desc) => {
          const active = layer === desc.id;
          return (
            <button
              key={desc.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`layer-btn-${desc.id.toLowerCase()}`}
              onClick={() => onChangeLayer(desc.id)}
              title={`${desc.label} (Phím ${desc.shortcutKey})`}
              className={`flex items-center gap-1.5 px-2.5 transition-colors whitespace-nowrap ${
                isMobile ? 'min-h-[38px] text-[11px]' : 'h-8 text-xs'
              } font-semibold ${
                active
                  ? 'border border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                  : 'border border-transparent text-[#A8B2BC] hover:bg-[#1B222A] hover:text-[#EFE9DC]'
              }`}
            >
              <span>{desc.shortLabel}</span>
              {!isMobile && (
                <span className="font-mono text-[10px] text-[#758290]">{desc.shortcutKey}</span>
              )}
            </button>
          );
        })}

        <div className="mx-0.5 h-5 w-px bg-[#2B3540]" aria-hidden="true" />

        <button
          type="button"
          data-testid="legend-toggle-btn"
          aria-label="Bật tắt chú giải bản đồ"
          aria-expanded={legendOpen}
          onClick={() => {
            setLegendOpen((v) => !v);
            setFutureOpen(false);
          }}
          className={`inline-flex items-center gap-1 px-2 text-xs font-medium transition-colors whitespace-nowrap ${
            isMobile ? 'min-h-[38px]' : 'h-8'
          } ${
            legendOpen
              ? 'bg-[#242D36] text-[#F4DC9F]'
              : 'text-[#A8B2BC] hover:bg-[#1B222A] hover:text-[#EFE9DC]'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Chú giải</span>
        </button>

        {!isMobile && (
          <button
            type="button"
            data-testid="future-modes-btn"
            aria-label="Xem các lớp tương lai theo lộ trình"
            aria-expanded={futureOpen}
            onClick={() => {
              setFutureOpen((v) => !v);
              setLegendOpen(false);
            }}
            className={`inline-flex h-8 items-center gap-1 px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              futureOpen
                ? 'bg-[#242D36] text-[#C6A15B]'
                : 'text-[#758290] hover:bg-[#1B222A] hover:text-[#A8B2BC]'
            }`}
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            <span className="hidden lg:inline">Lộ trình (+8)</span>
          </button>
        )}
      </div>
    </div>
  );
}
