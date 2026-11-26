import { Compass, Minus, Mountain, Plus, RotateCcw } from 'lucide-react';
import { SemanticZoomDescriptor } from '../map/cameraEngine';

interface MapControlsClusterProps {
  readonly zoomDescriptor: SemanticZoomDescriptor;
  readonly currentZoom: number;
  readonly currentPitch: number;
  readonly currentBearing: number;
  readonly allowPitch: boolean;
  readonly renderMode: 'maplibre' | 'svg-fallback';
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetView: () => void;
  readonly onResetNorth: () => void;
  readonly onTogglePitch: () => void;
}

export function MapControlsCluster({
  zoomDescriptor,
  currentZoom,
  currentPitch,
  currentBearing,
  allowPitch,
  renderMode,
  onZoomIn,
  onZoomOut,
  onResetView,
  onResetNorth,
  onTogglePitch,
}: MapControlsClusterProps) {
  return (
    <div
      data-testid="map-controls-cluster"
      className="pointer-events-auto flex flex-col items-end gap-1.5 select-none"
    >
      {/* Semantic Zoom Level Readout */}
      <div
        data-testid="semantic-zoom-badge"
        title={`${zoomDescriptor.labelVi} — ${zoomDescriptor.summaryVi}`}
        className="border border-[#2B3540] bg-[#12171D]/92 px-2 py-1 font-mono text-[10px] text-[#C6A15B] tabular-nums shadow-md"
      >
        <span>{zoomDescriptor.code}</span>
        <span className="mx-1 text-[#5A6674]" aria-hidden="true">
          ·
        </span>
        <span className="text-[#D8D3C6]">z{currentZoom.toFixed(1)}</span>
      </div>

      {/* Compact Control Stack */}
      <div className="flex flex-col border border-[#2B3540] bg-[#12171D]/95 text-[#EFE9DC] shadow-xl">
        <button
          type="button"
          data-testid="map-zoom-in"
          onClick={onZoomIn}
          aria-label="Phóng to bản đồ (+)"
          title="Phóng to (+)"
          className="flex h-9 w-9 items-center justify-center border-b border-[#252E38] hover:bg-[#1E262F] hover:text-[#F4DC9F]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-testid="map-zoom-out"
          onClick={onZoomOut}
          aria-label="Thu nhỏ bản đồ (-)"
          title="Thu nhỏ (-)"
          className="flex h-9 w-9 items-center justify-center border-b border-[#252E38] hover:bg-[#1E262F] hover:text-[#F4DC9F]"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-testid="map-reset-view"
          onClick={onResetView}
          aria-label="Khôi phục góc nhìn toàn quốc (0)"
          title="Toàn cảnh Việt Nam (0)"
          className="flex h-9 w-9 items-center justify-center border-b border-[#252E38] hover:bg-[#1E262F] hover:text-[#F4DC9F]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {renderMode === 'maplibre' && (
          <>
            <button
              type="button"
              data-testid="map-reset-north"
              onClick={onResetNorth}
              aria-label="Đưa hướng bản đồ về chính Bắc (R)"
              title={`Hướng chính Bắc (${Math.round(currentBearing)}°)`}
              className="flex h-9 w-9 items-center justify-center border-b border-[#252E38] hover:bg-[#1E262F] hover:text-[#F4DC9F]"
            >
              <Compass
                className="h-4 w-4 transition-transform duration-150"
                style={{ transform: `rotate(${-currentBearing}deg)` }}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              data-testid="map-toggle-pitch"
              disabled={!allowPitch}
              onClick={onTogglePitch}
              aria-label={
                currentPitch > 5 ? 'Chuyển góc nhìn phẳng 2D' : 'Bật góc nhìn nghiêng 2.5D'
              }
              title={
                allowPitch
                  ? currentPitch > 5
                    ? 'Tắt góc nghiêng 2.5D'
                    : 'Bật góc nghiêng địa hình 2.5D'
                  : 'Cần cấu hình đồ họa HIGH hoặc ULTRA để nghiêng camera 2.5D'
              }
              className={`flex h-9 w-9 items-center justify-center text-[10px] font-bold transition-colors ${
                !allowPitch
                  ? 'cursor-not-allowed text-[#4A5563]'
                  : currentPitch > 5
                    ? 'bg-[#242D36] text-[#F4DC9F]'
                    : 'text-[#A8B2BC] hover:bg-[#1E262F] hover:text-[#EFE9DC]'
              }`}
            >
              <Mountain className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
