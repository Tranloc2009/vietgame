import { useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  EyeOff,
  Landmark,
  Layers,
  MapPin,
  Mountain,
  PanelRightClose,
  PanelRightOpen,
  Route,
  X,
} from 'lucide-react';
import {
  FilteredClientMatchView,
  fpFormat,
  MatchRoomSummary,
  Region,
  TransportCorridor,
} from '../../contracts';
import { getFactionVisual } from '../map/designTokens';
import { MatchDataSourceKind } from '../map/foundationAdapter';
import { EnrichedCity } from '../map/settlementCatalog';
import { HILLSHADE_PROVENANCE_NOTICE } from '../map/terrainRelief';
import {
  NATION_LABELS,
  TERRAIN_FEATURE_LABELS,
  TERRAIN_LABELS,
  TRANSPORT_LABELS,
} from '../mapLayerRegistry';
import { WorldMapFeature } from '../roomApi';
import { MovementPreviewPanel, type LoadMovementPreview } from './MovementPreviewPanel';

export type MobileSheetSnap = 'collapsed' | 'half' | 'full';

interface ContextualInspectorProps {
  readonly isMobile: boolean;
  readonly desktopOpen: boolean;
  readonly onToggleDesktopOpen: () => void;
  readonly mobileSnap: MobileSheetSnap;
  readonly onChangeMobileSnap: (snap: MobileSheetSnap) => void;
  readonly selectedFeature: WorldMapFeature | null;
  readonly selectedCity: EnrichedCity | null;
  readonly onClearCitySelection: () => void;
  readonly onSelectCity: (city: EnrichedCity) => void;
  readonly onFocusRegion: (regionId: string) => void;
  readonly onClearSelection: () => void;
  readonly match: FilteredClientMatchView | null;
  readonly matchSourceKind?: MatchDataSourceKind;
  readonly foundationSector?: Region | null;
  readonly room: MatchRoomSummary | null;
  readonly citiesInRegion: readonly EnrichedCity[];
  readonly corridorsForRegion: readonly TransportCorridor[];
  readonly featuresById: ReadonlyMap<string, WorldMapFeature>;
  readonly onScheduleRegionAction?: (regionId: string) => void;
  readonly actionBusy?: boolean;
  readonly loadMovementPreview?: LoadMovementPreview;
}

type AccordionKey = 'overview' | 'terrain' | 'economy' | 'connections' | 'cities' | 'provenance';

export function ContextualInspector({
  isMobile,
  desktopOpen,
  onToggleDesktopOpen,
  mobileSnap,
  onChangeMobileSnap,
  selectedFeature,
  selectedCity,
  onClearCitySelection,
  onSelectCity,
  onFocusRegion,
  onClearSelection,
  match,
  matchSourceKind = match ? 'ROOM_LIVE' : 'STATIC_GEO',
  foundationSector = null,
  room,
  citiesInRegion,
  corridorsForRegion,
  featuresById,
  onScheduleRegionAction,
  actionBusy,
  loadMovementPreview,
}: ContextualInspectorProps) {
  const [openSections, setOpenSections] = useState<Record<AccordionKey, boolean>>({
    overview: true,
    terrain: true,
    economy: true,
    connections: false,
    cities: true,
    provenance: false,
  });

  const dragStartYRef = useRef<number | null>(null);

  const toggleSection = (key: AccordionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const liveRegion = selectedFeature
    ? match?.regions[selectedFeature.properties.regionId] ?? null
    : null;
  const controllerId =
    liveRegion?.controllerNationId ??
    selectedFeature?.properties.initialControllerNationId ??
    '';
  const factionVis = getFactionVisual(controllerId);

  const unitsInRegion =
    match && selectedFeature
      ? Object.values(match.units).filter(
          (u) => u.regionId === selectedFeature.properties.regionId
        )
      : [];

  const destinations = match && room?.matchId === match.matchId && room.status === 'ACTIVE'
    ? Object.values(match.regions)
        .filter((region) => region.controllerNationId === room.viewerNationId && region.regionId !== selectedFeature?.properties.regionId)
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    : [];

  const handleSheetPointerDown = (e: React.PointerEvent) => {
    dragStartYRef.current = e.clientY;
  };

  const handleSheetPointerUp = (e: React.PointerEvent) => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    if (Math.abs(dy) < 24) {
      // Tap cycles snap
      if (mobileSnap === 'collapsed') onChangeMobileSnap('half');
      else if (mobileSnap === 'half') onChangeMobileSnap('full');
      else onChangeMobileSnap('collapsed');
      return;
    }
    if (dy < -24) {
      // Swiped up
      if (mobileSnap === 'collapsed') onChangeMobileSnap('half');
      else if (mobileSnap === 'half') onChangeMobileSnap('full');
    } else if (dy > 24) {
      // Swiped down
      if (mobileSnap === 'full') onChangeMobileSnap('half');
      else if (mobileSnap === 'half') onChangeMobileSnap('collapsed');
    }
  };

  const renderInspectorBody = () => {
    if (!selectedFeature) {
      return (
        <div className="p-4 text-xs text-[#9CA7B4]">
          <p className="font-medium text-[#EFE9DC]">Chưa chọn khu vực hoặc đô thị</p>
          <p className="mt-1.5 leading-relaxed">
            Nhấn trực tiếp vào bất kỳ vùng lãnh thổ hoặc thành phố nào trên bản đồ để kiểm định địa hình SRTM,
            hạ tầng, hành lang giao thông và chủ quyền hiện hành.
          </p>
        </div>
      );
    }

    const p = selectedFeature.properties;

    return (
      <div className="divide-y divide-[#252E38] text-xs">
        {/* Selected City Spotlight (when a city was clicked or chosen) */}
        {selectedCity && (
          <div
            data-testid="city-inspector-card"
            className="bg-[#1D252E] p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#C6A15B]">
                  <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{selectedCity.categoryLabelVi}</span>
                </div>
                <h4 className="mt-0.5 text-sm font-bold text-[#EFE9DC]">
                  {selectedCity.city.name}
                </h4>
                <p className="mt-0.5 font-mono text-[11px] text-[#9CA7B4] tabular-nums">
                  {selectedCity.city.coords[1].toFixed(2)}°N, {selectedCity.city.coords[0].toFixed(2)}°E · Cao{' '}
                  {selectedCity.city.elevationMeters}m
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng chi tiết thành phố"
                onClick={onClearCitySelection}
                className="flex h-7 w-7 items-center justify-center border border-[#2B3540] bg-[#161C22] text-[#9CA7B4] hover:text-[#EFE9DC]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-[#2B3540] pt-2 text-[11px]">
              <div>
                <span className="text-[#758290]">Hành lang kết nối</span>
                <p className="font-mono font-semibold text-[#EFE9DC] tabular-nums">
                  {selectedCity.corridorCount} tuyến {selectedCity.hasRail ? '· Có đường sắt' : ''}
                </p>
              </div>
              <div>
                <span className="text-[#758290]">Cảng biển</span>
                <p className="font-semibold text-[#EFE9DC]">
                  {selectedCity.city.port ? 'Cảng chiến lược' : 'Nội địa'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[#758290]">
              Chỉ hiển thị dữ liệu địa lý &amp; mạng giao thông authoritative. Chỉ số dân số &amp; công trình chi tiết mở ở giai đoạn sau.
            </p>
          </div>
        )}

        {/* Section 1: Ownership & Strategic Status */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('overview')}
            aria-expanded={openSections.overview}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-semibold text-[#EFE9DC] hover:bg-[#1B222A]"
          >
            <span>Chủ quyền &amp; Trạng thái Vùng</span>
            {openSections.overview ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#758290]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#758290]" />
            )}
          </button>
          {openSections.overview && (
            <div className="space-y-2.5 px-3.5 pb-3.5">
              <div className="flex items-center justify-between gap-2 bg-[#12171D] px-2.5 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-3 w-3 shrink-0 border border-[#EFE9DC]/40"
                    style={{ backgroundColor: factionVis.fill }}
                    aria-hidden="true"
                  />
                  <span className="truncate font-semibold text-[#EFE9DC]">
                    {NATION_LABELS[controllerId] ?? controllerId}
                  </span>
                </div>
                <span
                  data-testid="inspector-match-source"
                  className="shrink-0 font-mono text-[10px] text-[#9CA7B4]"
                >
                  {matchSourceKind === 'ROOM_LIVE' && match
                    ? `Live Room v${match.version}`
                    : matchSourceKind === 'FOUNDATION_LIVE' && match
                      ? `Foundation v${match.version}`
                      : 'Khởi điểm 1955'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-[#758290]">Mã vùng</span>
                  <span className="font-mono text-[#EFE9DC]">{p.code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#758290]">Định danh</span>
                  <span className="font-mono text-[#C6A15B]">{p.regionId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#758290]">Ảnh hưởng</span>
                  <span className="font-mono text-[#EFE9DC] tabular-nums">
                    {liveRegion ? fpFormat(liveRegion.influenceFp, 1) : '65.0'}
                  </span>
                </div>
                {foundationSector && matchSourceKind === 'FOUNDATION_LIVE' && (
                  <div className="col-span-2 flex justify-between border-t border-[#252E38]/70 pt-1.5">
                    <span className="text-[#758290]">Khu vực Foundation</span>
                    <span className="font-mono text-[#C6A15B]">
                      {foundationSector.regionId}
                    </span>
                  </div>
                )}
                <div className="col-span-2 flex justify-between border-t border-[#252E38]/70 pt-1.5">
                  <span className="text-[#758290]">Tọa độ tâm</span>
                  <span className="font-mono text-[#A8B2BC] tabular-nums">
                    {p.centroid[1].toFixed(2)}°N, {p.centroid[0].toFixed(2)}°E
                  </span>
                </div>
              </div>

              {/* Authorized Units in Region (respecting Fog-of-War redaction) */}
              {unitsInRegion.length > 0 && (
                <div className="border-t border-[#252E38] pt-2">
                  <p className="text-[11px] font-medium text-[#A8B2BC]">
                    Đơn vị trong vùng ({unitsInRegion.length})
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {unitsInRegion.map((u) => {
                      const isRedacted = match?.redactedUnitIds.includes(u.unitId) ?? false;
                      return (
                        <li
                          key={u.unitId}
                          className="border border-[#2B3540] bg-[#12171D] px-2.5 py-1.5 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-[#EFE9DC]">
                              {u.unitId}
                            </span>
                            <span className="text-[10px] text-[#9CA7B4]">{u.category}</span>
                          </div>
                          {isRedacted ? (
                            <p className="mt-1 flex items-center gap-1 text-[10px] text-[#C8923C]">
                              <EyeOff className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span>Ẩn chỉ số sẵn sàng &amp; tiếp tế (Fog of War)</span>
                            </p>
                          ) : (
                            <p className="mt-1 font-mono text-[10px] text-[#A8B2BC] tabular-nums">
                              Sức mạnh: {fpFormat(u.strengthFp, 1)} · Sẵn sàng:{' '}
                              {fpFormat(u.readinessFp, 0)}% · Tiếp tế: {fpFormat(u.supplyFp, 1)}
                            </p>
                          )}
                          {!isRedacted && matchSourceKind === 'ROOM_LIVE'
                            && room?.status === 'ACTIVE' && room.matchId === match?.matchId
                            && room.viewerNationId === u.ownerNationId && loadMovementPreview && (
                            <MovementPreviewPanel
                              key={`${room.matchId}:${u.unitId}:${u.regionId}`}
                              unitId={u.unitId}
                              originId={u.regionId}
                              destinations={destinations}
                              load={loadMovementPreview}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Authoritative Scheduled Job Action (ONLY shown when room is ACTIVE and viewer controls this region) */}
              {room &&
                room.status === 'ACTIVE' &&
                room.viewerNationId === controllerId &&
                onScheduleRegionAction && (
                  <button
                    type="button"
                    data-testid="schedule-region-infra-btn"
                    disabled={actionBusy}
                    onClick={() => onScheduleRegionAction(p.regionId)}
                    className="mt-1 w-full border border-[#C6A15B] bg-[#24322A] px-3 py-2 text-xs font-semibold text-[#EFE9DC] transition-colors hover:bg-[#2F4337] disabled:opacity-50"
                  >
                    {actionBusy
                      ? 'Đang gửi lệnh lên server...'
                      : match?.phase03Economy
                        ? 'Xem công trình có thể xây'
                        : 'Đặt lịch Dự án Hạ tầng (15 phút UTC · -10 CN)'}
                  </button>
                )}
            </div>
          )}
        </div>

        {/* Section 2: Terrain & NASA SRTM Elevation */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('terrain')}
            aria-expanded={openSections.terrain}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-semibold text-[#EFE9DC] hover:bg-[#1B222A]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Mountain className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
              <span>Địa hình &amp; Độ cao SRTM</span>
            </span>
            {openSections.terrain ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#758290]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#758290]" />
            )}
          </button>
          {openSections.terrain && (
            <div className="space-y-2 px-3.5 pb-3.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-[#758290]">Phân loại địa hình</span>
                <span className="font-semibold text-[#EFE9DC]">
                  {TERRAIN_LABELS[p.terrain]}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-[#12171D] p-2">
                <div>
                  <span className="text-[10px] text-[#758290]">Độ cao trung bình</span>
                  <p className="font-mono text-xs font-semibold text-[#EFE9DC] tabular-nums">
                    {p.elevationMeters} m
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[#758290]">Đỉnh cao nhất vùng</span>
                  <p className="font-mono text-xs font-semibold text-[#E5C68B] tabular-nums">
                    {p.elevationPeakMeters} m
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[#758290]">Hệ số di chuyển</span>
                  <p className="font-mono text-xs font-semibold text-[#EFE9DC] tabular-nums">
                    ×{fpFormat(p.movementCostFp, 2)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[#758290]">Độ che phủ rừng</span>
                  <p className="font-mono text-xs font-semibold text-[#99BD8C] tabular-nums">
                    {Math.round((p.forestCoverFp as number) / 10)}%
                  </p>
                </div>
              </div>
              <p className="text-[#9CA7B4]">
                Đặc trưng:{' '}
                <span className="text-[#EFE9DC]">
                  {p.terrainFeatures.map((tf) => TERRAIN_FEATURE_LABELS[tf]).join(' · ')}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Section 3: Economy & Infrastructure */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('economy')}
            aria-expanded={openSections.economy}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-semibold text-[#EFE9DC] hover:bg-[#1B222A]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
              <span>Kinh tế &amp; Hạ tầng</span>
            </span>
            {openSections.economy ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#758290]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#758290]" />
            )}
          </button>
          {openSections.economy && (
            <div className="grid grid-cols-3 gap-2 px-3.5 pb-3.5 text-[11px]">
              <div className="border border-[#252E38] bg-[#12171D] p-2">
                <span className="text-[10px] text-[#758290]">Kinh tế</span>
                <p className="mt-0.5 font-mono text-xs font-semibold text-[#8EC29E] tabular-nums">
                  {fpFormat(p.economicOutputFp, 1)}
                </p>
              </div>
              <div className="border border-[#252E38] bg-[#12171D] p-2">
                <span className="text-[10px] text-[#758290]">Hạ tầng</span>
                <p className="mt-0.5 font-mono text-xs font-semibold text-[#E5C68B] tabular-nums">
                  {fpFormat(liveRegion?.infrastructureFp ?? p.infrastructureFp, 1)}
                </p>
              </div>
              <div className="border border-[#252E38] bg-[#12171D] p-2">
                <span className="text-[10px] text-[#758290]">Tiếp tế</span>
                <p className="mt-0.5 font-mono text-xs font-semibold text-[#EFE9DC] tabular-nums">
                  {fpFormat(liveRegion?.supplyCapacityFp ?? p.supplyCapacityFp, 1)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Cities in Region */}
        {citiesInRegion.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleSection('cities')}
              aria-expanded={openSections.cities}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-semibold text-[#EFE9DC] hover:bg-[#1B222A]"
            >
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
                <span>Đô thị trong vùng ({citiesInRegion.length})</span>
              </span>
              {openSections.cities ? (
                <ChevronDown className="h-3.5 w-3.5 text-[#758290]" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-[#758290]" />
              )}
            </button>
            {openSections.cities && (
              <div className="space-y-1.5 px-3.5 pb-3.5">
                {citiesInRegion.map((ec) => (
                  <button
                    key={ec.city.id}
                    type="button"
                    onClick={() => onSelectCity(ec)}
                    className={`flex w-full items-center justify-between border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                      selectedCity?.city.id === ec.city.id
                        ? 'border-[#C6A15B] bg-[#212A34] text-[#EFE9DC]'
                        : 'border-[#252E38] bg-[#12171D] text-[#D8D3C6] hover:border-[#3C4957]'
                    }`}
                  >
                    <span className="font-semibold">{ec.city.name}</span>
                    <span className="text-[10px] text-[#9CA7B4]">{ec.categoryLabelVi}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Section 5: Adjacent Regions & Transport Corridors */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('connections')}
            aria-expanded={openSections.connections}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-semibold text-[#EFE9DC] hover:bg-[#1B222A]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Route className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
              <span>
                Giao thông ({corridorsForRegion.length}) &amp; Giáp ranh ({p.adjacentRegionIds.length})
              </span>
            </span>
            {openSections.connections ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#758290]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#758290]" />
            )}
          </button>
          {openSections.connections && (
            <div className="space-y-2.5 px-3.5 pb-3.5 text-[11px]">
              <div className="space-y-1">
                {corridorsForRegion.map((c) => {
                  const targetId = c.fromRegionId === p.regionId ? c.toRegionId : c.fromRegionId;
                  const target = featuresById.get(targetId);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onFocusRegion(targetId)}
                      className="flex w-full items-center justify-between border border-[#252E38] bg-[#12171D] px-2.5 py-1.5 text-left hover:border-[#C6A15B]"
                    >
                      <span className="truncate pr-2 text-[#EFE9DC]">
                        {target ? `${target.properties.code} · ${target.properties.name}` : targetId}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-[#A8B2BC] tabular-nums">
                        {TRANSPORT_LABELS[c.kind].split(' ')[0]} · ×{fpFormat(c.movementModifierFp, 2)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div>
                <p className="mb-1 text-[10px] text-[#758290]">Di chuyển nhanh tới vùng giáp ranh</p>
                <div className="flex flex-wrap gap-1">
                  {p.adjacentRegionIds.map((adjId) => {
                    const adj = featuresById.get(adjId);
                    return (
                      <button
                        key={adjId}
                        type="button"
                        onClick={() => onFocusRegion(adjId)}
                        className="border border-[#2B3540] bg-[#12171D] px-2 py-1 font-mono text-[10px] text-[#D8D3C6] hover:border-[#C6A15B] hover:text-[#F4DC9F]"
                      >
                        {adj?.properties.code ?? adjId}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 6: Data Provenance & Alternate History Notice */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('provenance')}
            aria-expanded={openSections.provenance}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-semibold text-[#A8B2BC] hover:bg-[#1B222A]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-[#758290]" aria-hidden="true" />
              <span>Nguồn Dữ liệu &amp; Phân tách Lịch sử</span>
            </span>
            {openSections.provenance ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#758290]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#758290]" />
            )}
          </button>
          {openSections.provenance && (
            <div className="space-y-1.5 px-3.5 pb-3.5 text-[10px] leading-relaxed text-[#9CA7B4]">
              <p>
                <strong className="text-[#EFE9DC]">Địa lý tự nhiên:</strong> {p.dataSource}
              </p>
              <p>
                <strong className="text-[#EFE9DC]">Độ cao:</strong> {p.elevationSource}.{' '}
                {HILLSHADE_PROVENANCE_NOTICE}
              </p>
              <p>
                <strong className="text-[#EFE9DC]">Tách biệt gameplay 1955:</strong> Phân vùng 72 khu vực và
                mạng 98 hành lang giao thông là đồ thị chiến lược lịch sử thay thế trừu tượng (
                <code>modernRoadsUsedAsHistorical: false</code>,{' '}
                <code>modernAdminBordersUsedAsHistorical: false</code>).
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // MOBILE: 3-state Expandable Bottom Sheet with touch swipe gestures
  if (isMobile) {
    if (!selectedFeature) return null;

    const heightClass =
      mobileSnap === 'collapsed'
        ? 'h-[62px]'
        : mobileSnap === 'half'
          ? 'h-[46dvh]'
          : 'h-[76dvh]';

    return (
      <section
        aria-label="Bảng thông tin vùng di động"
        data-testid="mobile-bottom-sheet"
        data-sheet-snap={mobileSnap}
        className={`pointer-events-auto fixed inset-x-0 bottom-14 z-30 flex flex-col border-t border-[#3C4957] bg-[#161C22] text-[#EFE9DC] shadow-2xl transition-[height] duration-200 ${heightClass}`}
      >
        {/* Drag Handle + Summary Header */}
        <div
          data-testid="mobile-sheet-handle"
          onPointerDown={handleSheetPointerDown}
          onPointerUp={handleSheetPointerUp}
          className="flex shrink-0 cursor-ns-resize flex-col border-b border-[#252E38] bg-[#12171D] px-3.5 pt-1.5 pb-2 touch-none"
        >
          <div className="mx-auto mb-1.5 h-1 w-10 bg-[#4A5563]" aria-hidden="true" />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] text-[#A8B2BC]">
                <span
                  className="h-2 w-2 shrink-0"
                  style={{ backgroundColor: factionVis.fill }}
                  aria-hidden="true"
                />
                <span className="font-mono font-semibold text-[#C6A15B]">
                  {selectedFeature.properties.code}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{factionVis.shortName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {selectedFeature.properties.elevationMeters}m
                </span>
              </div>
              <h3 className="truncate text-xs font-bold text-[#EFE9DC]">
                {selectedCity ? selectedCity.city.name : selectedFeature.properties.name}
              </h3>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="mobile-sheet-expand-btn"
                aria-label={mobileSnap === 'full' ? 'Thu gọn bảng chi tiết' : 'Mở rộng bảng chi tiết'}
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeMobileSnap(
                    mobileSnap === 'collapsed'
                      ? 'half'
                      : mobileSnap === 'half'
                        ? 'full'
                        : 'collapsed'
                  );
                }}
                className="flex h-9 w-9 items-center justify-center border border-[#2B3540] bg-[#1B222A] text-[#EFE9DC]"
              >
                {mobileSnap === 'full' ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                aria-label="Bỏ chọn vùng"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSelection();
                }}
                className="flex h-9 w-9 items-center justify-center border border-[#2B3540] bg-[#1B222A] text-[#9CA7B4]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        {mobileSnap !== 'collapsed' && (
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {renderInspectorBody()}
          </div>
        )}
      </section>
    );
  }

  // DESKTOP: Collapsible Contextual Right Panel
  if (!desktopOpen) {
    return (
      <button
        type="button"
        data-testid="inspector-reopen-btn"
        onClick={onToggleDesktopOpen}
        aria-label="Mở bảng thông tin vùng"
        className="pointer-events-auto absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 border border-[#3C4957] bg-[#161C22]/95 px-3 py-2 text-xs font-semibold text-[#EFE9DC] shadow-lg transition-colors hover:border-[#C6A15B]"
      >
        <PanelRightOpen className="h-3.5 w-3.5 text-[#C6A15B]" aria-hidden="true" />
        <span>
          {selectedFeature ? `${selectedFeature.properties.code} · Chi tiết` : 'Chi tiết vùng'}
        </span>
      </button>
    );
  }

  return (
    <aside
      aria-label="Bảng thông tin khu vực chiến lược"
      data-testid="region-inspector"
      className="pointer-events-auto absolute top-3 right-3 bottom-16 z-20 flex w-[328px] max-w-[calc(100%-24px)] flex-col border border-[#2B3540] bg-[#161C22]/96 text-[#EFE9DC] shadow-2xl"
    >
      {/* Inspector Header */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[#2B3540] bg-[#12171D] px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#C6A15B]">
            <Compass className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              {selectedFeature
                ? `${selectedFeature.properties.code} · ${selectedFeature.properties.zone}`
                : 'Thanh tra Chiến trường'}
            </span>
          </div>
          <h2 className="mt-0.5 truncate text-sm font-bold text-[#EFE9DC]">
            {selectedFeature ? selectedFeature.properties.name : 'Chọn một vùng trên bản đồ'}
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {selectedFeature && (
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Bỏ chọn vùng hiện tại"
              title="Bỏ chọn (Esc)"
              className="flex h-7 w-7 items-center justify-center border border-[#2B3540] bg-[#161C22] text-[#9CA7B4] hover:border-[#3C4957] hover:text-[#EFE9DC]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            data-testid="inspector-collapse-btn"
            onClick={onToggleDesktopOpen}
            aria-label="Thu gọn bảng thông tin"
            title="Thu gọn bảng thông tin"
            className="flex h-7 w-7 items-center justify-center border border-[#2B3540] bg-[#161C22] text-[#9CA7B4] hover:border-[#C6A15B] hover:text-[#EFE9DC]"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Accordion Content */}
      <div className="flex-1 overflow-y-auto">{renderInspectorBody()}</div>
    </aside>
  );
}
