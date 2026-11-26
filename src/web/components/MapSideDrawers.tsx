import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  Compass,
  Cpu,
  MapPin,
  Mountain,
  Route,
  Search,
  SlidersHorizontal,
  Waves,
  X,
} from 'lucide-react';
import { CAMERA_PRESETS, CameraPresetId } from '../map/cameraEngine';
import {
  CosmeticWeatherVisualState,
  GRAPHICS_PRESETS,
  GraphicsQualityPreset,
  WEATHER_VISUAL_LABELS,
  WeatherAtmosphereAdapterConfig,
} from '../map/graphicsSettings';
import { EnrichedCity, MapSearchResult, searchMapEntities } from '../map/settlementCatalog';
import { HILLSHADE_PROVENANCE_NOTICE } from '../map/terrainRelief';
import { WorldMapFeature } from '../roomApi';

interface SearchDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly features: readonly WorldMapFeature[];
  readonly cities: readonly EnrichedCity[];
  readonly onSelectResult: (result: MapSearchResult) => void;
  readonly onJumpCameraPreset: (presetId: CameraPresetId) => void;
}

export function MapSearchDrawer({
  open,
  onClose,
  features,
  cities,
  onSelectResult,
  onJumpCameraPreset,
}: SearchDrawerProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const results = useMemo(
    () => searchMapEntities(query, features, cities, 16),
    [query, features, cities]
  );

  if (!open) return null;

  return (
    <aside
      aria-label="Tìm kiếm vùng và thành phố"
      data-testid="search-drawer"
      className="pointer-events-auto absolute top-3 bottom-16 left-3 z-30 flex w-[310px] max-w-[calc(100%-24px)] flex-col border border-[#2B3540] bg-[#161C22] text-[#EFE9DC] shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[#252E38] bg-[#12171D] px-3.5 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EFE9DC]">
          <Search className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
          <span>Điều hướng &amp; Tìm kiếm Bản đồ</span>
        </span>
        <button
          type="button"
          aria-label="Đóng bảng tìm kiếm"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center border border-[#2B3540] text-[#9CA7B4] hover:text-[#EFE9DC]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Theater Quick Jumps */}
      <div className="shrink-0 border-b border-[#252E38] p-3">
        <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-[#758290]">
          CHUYỂN NHANH GÓC NHÌN CHIẾN TRƯỜNG
        </p>
        <div className="grid grid-cols-2 gap-1">
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-testid={`camera-preset-${preset.id.toLowerCase()}`}
              onClick={() => onJumpCameraPreset(preset.id)}
              className="flex items-center gap-1.5 border border-[#2B3540] bg-[#12171D] px-2 py-1.5 text-left text-[11px] font-medium text-[#D8D3C6] hover:border-[#C6A15B] hover:text-[#F4DC9F]"
            >
              <Compass className="h-3 w-3 shrink-0 text-[#C6A15B]" aria-hidden="true" />
              <span className="truncate">{preset.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search Input */}
      <div className="shrink-0 border-b border-[#252E38] p-3">
        <label htmlFor="vdn-map-search" className="sr-only">
          Tìm tên thành phố, tên vùng hoặc mã vùng
        </label>
        <input
          ref={inputRef}
          id="vdn-map-search"
          data-testid="map-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm Hà Nội, Sài Gòn, Đà Nẵng, R35..."
          className="w-full border border-[#3C4957] bg-[#11161C] px-2.5 py-2 text-xs text-[#EFE9DC] placeholder-[#6B7785] focus:border-[#C6A15B] focus:outline-none"
        />
      </div>

      {/* Search Results */}
      <div className="flex-1 overflow-y-auto p-2">
        {results.length === 0 ? (
          <p className="p-3 text-center text-xs text-[#758290]">
            Không tìm thấy địa danh phù hợp.
          </p>
        ) : (
          <ul className="space-y-1">
            {results.map((item) => (
              <li key={`${item.kind}_${item.id}`}>
                <button
                  type="button"
                  data-testid={`search-result-${item.id}`}
                  onClick={() => onSelectResult(item)}
                  className="flex w-full items-center justify-between gap-2 border border-transparent bg-[#12171D]/70 px-2.5 py-2 text-left transition-colors hover:border-[#C6A15B] hover:bg-[#1D252E]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#EFE9DC]">{item.title}</p>
                    <p className="truncate text-[10px] text-[#9CA7B4]">{item.subtitle}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-[#C6A15B]">
                    {item.kind === 'city' ? 'ĐÔ THỊ' : 'VÙNG'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

interface DisplaySettingsDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly graphicsPreset: GraphicsQualityPreset;
  readonly onChangeGraphicsPreset: (preset: GraphicsQualityPreset) => void;
  readonly renderMode: 'maplibre' | 'svg-fallback';
  readonly onChangeRenderMode: (mode: 'maplibre' | 'svg-fallback') => void;
  readonly fallbackReason: string | null;
  readonly showCities: boolean;
  readonly onToggleCities: () => void;
  readonly showTransport: boolean;
  readonly onToggleTransport: () => void;
  readonly showRivers: boolean;
  readonly onToggleRivers: () => void;
  readonly showPeaksAndCodes: boolean;
  readonly onTogglePeaksAndCodes: () => void;
  readonly weatherConfig: WeatherAtmosphereAdapterConfig;
  readonly onChangeWeatherConfig: (next: WeatherAtmosphereAdapterConfig) => void;
  readonly cityCount: number;
  readonly corridorCount: number;
}

const PRESET_ORDER: readonly GraphicsQualityPreset[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

export function MapDisplayDrawer({
  open,
  onClose,
  graphicsPreset,
  onChangeGraphicsPreset,
  renderMode,
  onChangeRenderMode,
  fallbackReason,
  showCities,
  onToggleCities,
  showTransport,
  onToggleTransport,
  showRivers,
  onToggleRivers,
  showPeaksAndCodes,
  onTogglePeaksAndCodes,
  weatherConfig,
  onChangeWeatherConfig,
  cityCount,
  corridorCount,
}: DisplaySettingsDrawerProps) {
  if (!open) return null;

  const activeConfig = GRAPHICS_PRESETS[graphicsPreset];

  return (
    <aside
      aria-label="Lớp địa lý và cài đặt đồ họa"
      data-testid="display-settings-drawer"
      className="pointer-events-auto absolute top-3 bottom-16 left-3 z-30 flex w-[320px] max-w-[calc(100%-24px)] flex-col border border-[#2B3540] bg-[#161C22] text-[#EFE9DC] shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[#252E38] bg-[#12171D] px-3.5 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EFE9DC]">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
          <span>Lớp Địa lý &amp; Đồ họa Bản đồ</span>
        </span>
        <button
          type="button"
          aria-label="Đóng bảng cài đặt hiển thị"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center border border-[#2B3540] text-[#9CA7B4] hover:text-[#EFE9DC]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3.5 text-xs">
        {/* Geographic Overlay Toggles */}
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#758290]">
            HIỂN THỊ LỚP BẢN ĐỒ
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="toggle-overlay-cities"
              aria-pressed={showCities}
              onClick={onToggleCities}
              className={`flex items-center gap-1.5 border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                showCities
                  ? 'border-[#C6A15B] bg-[#222B34] text-[#F4DC9F]'
                  : 'border-[#2B3540] bg-[#12171D] text-[#758290]'
              }`}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>Thành phố ({cityCount})</span>
            </button>
            <button
              type="button"
              data-testid="toggle-overlay-transport"
              aria-pressed={showTransport}
              onClick={onToggleTransport}
              className={`flex items-center gap-1.5 border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                showTransport
                  ? 'border-[#C6A15B] bg-[#222B34] text-[#F4DC9F]'
                  : 'border-[#2B3540] bg-[#12171D] text-[#758290]'
              }`}
            >
              <Route className="h-3.5 w-3.5 shrink-0" />
              <span>Giao thông ({corridorCount})</span>
            </button>
            <button
              type="button"
              data-testid="toggle-overlay-rivers"
              aria-pressed={showRivers}
              onClick={onToggleRivers}
              className={`flex items-center gap-1.5 border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                showRivers
                  ? 'border-[#C6A15B] bg-[#222B34] text-[#F4DC9F]'
                  : 'border-[#2B3540] bg-[#12171D] text-[#758290]'
              }`}
            >
              <Waves className="h-3.5 w-3.5 shrink-0" />
              <span>Sông ngòi</span>
            </button>
            <button
              type="button"
              data-testid="toggle-overlay-peaks"
              aria-pressed={showPeaksAndCodes}
              onClick={onTogglePeaksAndCodes}
              className={`flex items-center gap-1.5 border px-2.5 py-2 text-[11px] font-medium transition-colors ${
                showPeaksAndCodes
                  ? 'border-[#C6A15B] bg-[#222B34] text-[#F4DC9F]'
                  : 'border-[#2B3540] bg-[#12171D] text-[#758290]'
              }`}
            >
              <Mountain className="h-3.5 w-3.5 shrink-0" />
              <span>Đỉnh núi &amp; Mã</span>
            </button>
          </div>
        </div>

        {/* Graphics Quality Presets */}
        <div className="border-t border-[#252E38] pt-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-[#758290]">
              <Cpu className="h-3 w-3" aria-hidden="true" />
              <span>CẤU HÌNH ĐỒ HỌA (CHỈ THẨM MỸ)</span>
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Mức đồ họa bản đồ">
            {PRESET_ORDER.map((preset) => {
              const active = graphicsPreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`graphics-preset-${preset.toLowerCase()}`}
                  onClick={() => onChangeGraphicsPreset(preset)}
                  className={`border py-1.5 font-mono text-[11px] font-semibold transition-colors ${
                    active
                      ? 'border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                      : 'border-[#2B3540] bg-[#12171D] text-[#9CA7B4] hover:text-[#EFE9DC]'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#9CA7B4]">
            {activeConfig.descriptionVi}
          </p>
        </div>

        {/* Renderer Mode (WebGL MapLibre vs SVG Fallback) */}
        <div className="border-t border-[#252E38] pt-3.5">
          <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#758290]">
            TRÌNH KẾT XUẤT BẢN ĐỒ
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="renderer-btn-maplibre"
              onClick={() => onChangeRenderMode('maplibre')}
              className={`border px-2.5 py-2 text-[11px] font-semibold ${
                renderMode === 'maplibre'
                  ? 'border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                  : 'border-[#2B3540] bg-[#12171D] text-[#9CA7B4]'
              }`}
            >
              MapLibre WebGL
            </button>
            <button
              type="button"
              data-testid="renderer-btn-svg"
              onClick={() => onChangeRenderMode('svg-fallback')}
              className={`border px-2.5 py-2 text-[11px] font-semibold ${
                renderMode === 'svg-fallback'
                  ? 'border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                  : 'border-[#2B3540] bg-[#12171D] text-[#9CA7B4]'
              }`}
            >
              Vector SVG Dự phòng
            </button>
          </div>
          {fallbackReason && (
            <p className="mt-2 border border-[#7A5928] bg-[#272014] px-2.5 py-1.5 text-[10px] text-[#E5C68B]">
              {fallbackReason}
            </p>
          )}
        </div>

        {/* Cosmetic Weather & Atmosphere Adapter Foundation (Section 18) */}
        <div className="border-t border-[#252E38] pt-3.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-[#758290]">
              <Cloud className="h-3 w-3" aria-hidden="true" />
              <span>KHÍ QUYỂN THẨM MỸ (NỀN TẢNG)</span>
            </span>
            <button
              type="button"
              data-testid="toggle-atmosphere-btn"
              disabled={!activeConfig.cosmeticAtmosphereAllowed}
              onClick={() =>
                onChangeWeatherConfig({
                  ...weatherConfig,
                  enabled: !weatherConfig.enabled,
                })
              }
              className={`border px-2 py-0.5 text-[10px] font-semibold ${
                !activeConfig.cosmeticAtmosphereAllowed
                  ? 'cursor-not-allowed border-[#252E38] text-[#4A5563]'
                  : weatherConfig.enabled
                    ? 'border-[#C6A15B] bg-[#242D36] text-[#F4DC9F]'
                    : 'border-[#2B3540] bg-[#12171D] text-[#9CA7B4]'
              }`}
            >
              {weatherConfig.enabled ? 'Đang bật' : 'Đã tắt'}
            </button>
          </div>

          {weatherConfig.enabled && activeConfig.cosmeticAtmosphereAllowed && (
            <div className="mt-2">
              <label htmlFor="vdn-weather-visual" className="block text-[10px] text-[#9CA7B4]">
                Trạng thái bề mặt (0% ảnh hưởng gameplay):
              </label>
              <select
                id="vdn-weather-visual"
                value={weatherConfig.visualState}
                onChange={(e) =>
                  onChangeWeatherConfig({
                    ...weatherConfig,
                    visualState: e.target.value as CosmeticWeatherVisualState,
                  })
                }
                className="mt-1 w-full border border-[#3C4957] bg-[#12171D] px-2 py-1.5 text-[11px] text-[#EFE9DC]"
              >
                {(Object.keys(WEATHER_VISUAL_LABELS) as CosmeticWeatherVisualState[]).map((st) => (
                  <option key={st} value={st}>
                    {WEATHER_VISUAL_LABELS[st]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="mt-1.5 text-[10px] leading-relaxed text-[#758290]">
            Mô phỏng thời tiết chiến trường sẽ được mở ở giai đoạn sau. Hiệu ứng hiện tại hoàn toàn thẩm mỹ.
          </p>
        </div>

        {/* Cartographic Hillshade Transparency Note */}
        <div className="border-t border-[#252E38] pt-3 text-[10px] leading-relaxed text-[#758290]">
          <p>{HILLSHADE_PROVENANCE_NOTICE}</p>
        </div>
      </div>
    </aside>
  );
}
