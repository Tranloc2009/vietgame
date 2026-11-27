import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ShieldAlert } from 'lucide-react';
import {
  ClientMatchView,
  FilteredClientMatchView,
  MapLayerMode,
  MatchRoomSummary,
  TransportCorridor,
} from '../contracts';
import { BottomModeDock } from './components/BottomModeDock';
import { ContextualInspector, MobileSheetSnap } from './components/ContextualInspector';
import { WorkspaceDrawerId } from './components/LeftNavRail';
import { MapControlsCluster } from './components/MapControlsCluster';
import { MapDisplayDrawer, MapSearchDrawer } from './components/MapSideDrawers';
import { MinimapViewportBounds, StrategicMinimap } from './components/StrategicMinimap';
import { SvgFallbackMap } from './components/SvgFallbackMap';
import {
  CameraPresetId,
  clampCameraSnapshot,
  classifySemanticZoom,
  getCameraPresetById,
  loadSessionCamera,
  PLAYABLE_MAX_BOUNDS,
  saveSessionCamera,
  VIETNAM_THEATER_BOUNDS,
} from './map/cameraEngine';
import { getFactionVisual, MAP_TOKENS } from './map/designTokens';
import { resolveMapMatchData } from './map/foundationAdapter';
import {
  DEFAULT_WEATHER_ADAPTER_CONFIG,
  detectBrowserGraphicsPreset,
  GRAPHICS_PRESETS,
  GraphicsQualityPreset,
  WeatherAtmosphereAdapterConfig,
} from './map/graphicsSettings';
import {
  EnrichedCity,
  enrichSettlementCatalog,
  LabelCandidate,
  MapSearchResult,
  resolveLabelCollisions,
} from './map/settlementCatalog';
import {
  extractDynamicNationalBorders,
  generateSrtmHillshadeDataUrl,
  HILLSHADE_BOUNDS,
} from './map/terrainRelief';
import {
  computeRegionFillColor,
  computeTerrainBaseColor,
  getActiveMapLayerDescriptor,
} from './mapLayerRegistry';
import { WorldMapFeature, WorldMapGeoJson, WorldMapLayers } from './roomApi';
import type { LoadMovementPreview } from './components/MovementPreviewPanel';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export interface StrategicMapProps {
  readonly geojson: WorldMapGeoJson | null;
  readonly layers: WorldMapLayers | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly match?: FilteredClientMatchView | null;
  readonly foundationMatch?: ClientMatchView | null;
  readonly room?: MatchRoomSummary | null;
  readonly isMobile?: boolean;
  readonly activeDrawer?: WorkspaceDrawerId;
  readonly onChangeDrawer?: (drawer: WorkspaceDrawerId) => void;
  readonly onToggleFullscreen?: () => void;
  readonly onScheduleRegionAction?: (regionId: string) => void;
  readonly actionBusy?: boolean;
  readonly sendMarch?: import('./components/MovementPreviewPanel').SendMarch;
  readonly loadMovementPreview?: LoadMovementPreview;
}

const SEA_LABELS: readonly { key: string; text: string; coords: readonly [number, number] }[] = [
  { key: 'sea_east', text: 'BIỂN ĐÔNG', coords: [111.1, 14.5] },
  { key: 'sea_tonkin', text: 'VỊNH BẮC BỘ', coords: [107.85, 19.75] },
  { key: 'sea_thailand', text: 'VỊNH THÁI LAN', coords: [102.45, 9.7] },
];

function checkWebGlAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return gl !== null;
  } catch {
    return false;
  }
}

type GeoJsonData = Parameters<maplibregl.GeoJSONSource['setData']>[0];

function buildGraticuleGeoJson(): GeoJsonData {
  const features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }> = [];
  for (let lon = 100; lon <= 114; lon += 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, 7.0],
          [lon, 25.0],
        ],
      },
    });
  }
  for (let lat = 8; lat <= 24; lat += 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [99.0, lat],
          [114.0, lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

const GRATICULE_GEOJSON = buildGraticuleGeoJson();

interface HoverTooltipState {
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
}

export function StrategicMap({
  geojson,
  layers,
  loading,
  error,
  match = null,
  foundationMatch = null,
  room = null,
  isMobile = false,
  activeDrawer = 'none',
  onChangeDrawer = () => {},
  onToggleFullscreen = () => {},
  onScheduleRegionAction,
  actionBusy,
  sendMarch,
  loadMovementPreview,
}: StrategicMapProps) {
  // Active Map Mode (switching mode NEVER resets camera or selection)
  const [layer, setLayer] = useState<MapLayerMode>('POLITICAL');

  // Selection state (preserved across WebSocket deltas and mode changes)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>('reg_vn_11');
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);

  // Renderer & Graphics Settings
  const [renderMode, setRenderMode] = useState<'maplibre' | 'svg-fallback'>('maplibre');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [graphicsPreset, setGraphicsPreset] = useState<GraphicsQualityPreset>(() =>
    detectBrowserGraphicsPreset()
  );
  const [weatherConfig, setWeatherConfig] = useState<WeatherAtmosphereAdapterConfig>(
    DEFAULT_WEATHER_ADAPTER_CONFIG
  );

  // Panel / HUD state
  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState<boolean>(true);
  const [mobileSheetSnap, setMobileSheetSnap] = useState<MobileSheetSnap>('collapsed');
  const [minimapExpanded, setMinimapExpanded] = useState<boolean>(true);

  // Cartographic overlay toggles
  const [showCities, setShowCities] = useState(true);
  const [showTransport, setShowTransport] = useState(true);
  const [showRivers, setShowRivers] = useState(true);
  const [showPeaksAndCodes, setShowPeaksAndCodes] = useState(false);

  // Live Camera telemetry (updated smoothly on move/zoom)
  const [currentZoom, setCurrentZoom] = useState<number>(5.45);
  const [currentPitch, setCurrentPitch] = useState<number>(0);
  const [currentBearing, setCurrentBearing] = useState<number>(0);
  const [viewportBounds, setViewportBounds] = useState<MinimapViewportBounds | null>(null);

  // Projected screen-space Vietnamese labels & hover tooltip
  const [projectedLabels, setProjectedLabels] = useState<readonly LabelCandidate[]>([]);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltipState | null>(null);

  // SVG Fallback pan & zoom state
  const [svgZoom, setSvgZoom] = useState<number>(1.08);
  const [svgPan, setSvgPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // MapLibre refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const hoveredFeatureIdRef = useRef<string | number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [landReady, setLandReady] = useState(false);

  const graphicsConfig = GRAPHICS_PRESETS[graphicsPreset];
  const activeLayerDesc = getActiveMapLayerDescriptor(layer);
  const effectiveZoom = renderMode === 'maplibre' ? currentZoom : 4.6 + svgZoom * 1.3;
  const zoomDescriptor = useMemo(() => classifySemanticZoom(effectiveZoom), [effectiveZoom]);

  const featuresById = useMemo(() => {
    const map = new Map<string, WorldMapFeature>();
    if (geojson) {
      for (const f of geojson.features) {
        map.set(f.properties.regionId, f);
      }
    }
    return map;
  }, [geojson]);

  const enrichedCities = useMemo(() => {
    if (!layers) return [];
    return enrichSettlementCatalog(layers.cities, layers.transportCorridors, featuresById);
  }, [layers, featuresById]);

  const enrichedCitiesById = useMemo(
    () => new Map(enrichedCities.map((c) => [c.city.id, c])),
    [enrichedCities]
  );

  // Generate cached SRTM 90m cartographic hillshade data URL once per dataset load
  const hillshadeDataUrl = useMemo(() => {
    if (!geojson || !layers) return null;
    return generateSrtmHillshadeDataUrl(geojson, layers.peaks);
  }, [geojson, layers]);

  // Resolve authoritative match data: active multiplayer room takes priority,
  // falling back seamlessly to live server `foundationMatch` data for region rendering.
  const {
    effectiveMatch,
    sourceKind: matchSourceKind,
    foundationRegionMap,
  } = useMemo(
    () => resolveMapMatchData(match, foundationMatch, geojson?.features ?? []),
    [match, foundationMatch, geojson]
  );

  // Dynamic political borders derived strictly from authoritative match state
  const dynamicBorders = useMemo(() => {
    if (!geojson) return { type: 'FeatureCollection' as const, features: [] };
    return extractDynamicNationalBorders(geojson.features, effectiveMatch);
  }, [geojson, effectiveMatch]);

  // Enriched region GeoJSON with terrain base + mode fill + restrained elevation extrusion
  const enrichedGeoJson = useMemo(() => {
    if (!geojson) return null;
    return {
      type: 'FeatureCollection' as const,
      features: geojson.features.map((f, idx) => ({
        type: 'Feature' as const,
        id: idx + 1,
        properties: {
          ...f.properties,
          terrainColor: computeTerrainBaseColor(f),
          fillColor: computeRegionFillColor(f, layer, effectiveMatch),
          reliefOpacity: Math.min(0.32, (f.properties.elevationMeters / 1600) * 0.28),
          extrusionHeight: Math.round(Math.min(18000, f.properties.elevationMeters * 11)),
          isSelected: f.properties.regionId === selectedRegionId ? 1 : 0,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: f.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
        },
      })),
    };
  }, [geojson, layer, effectiveMatch, selectedRegionId]);

  const transportGeoJson = useMemo((): GeoJsonData => {
    if (!layers) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: layers.transportCorridors.map((t) => ({
        type: 'Feature',
        id: t.id,
        properties: {
          id: t.id,
          kind: t.kind,
          label: t.label,
          movementModifierFp: t.movementModifierFp,
        },
        geometry: {
          type: 'LineString',
          coordinates: t.coordinates.map(([lon, lat]) => [lon, lat]),
        },
      })),
    };
  }, [layers]);

  const citiesGeoJson = useMemo((): GeoJsonData => {
    return {
      type: 'FeatureCollection',
      features: enrichedCities.map((ec) => ({
        type: 'Feature',
        id: ec.city.id,
        properties: {
          id: ec.city.id,
          name: ec.city.name,
          tier: ec.city.tier,
          category: ec.category,
          regionId: ec.city.regionId,
          port: Boolean(ec.city.port),
          isSelected: ec.city.id === selectedCityId ? 1 : 0,
        },
        geometry: {
          type: 'Point',
          coordinates: [ec.city.coords[0], ec.city.coords[1]],
        },
      })),
    };
  }, [enrichedCities, selectedCityId]);

  // Ref for callbacks accessed inside MapLibre event listeners without re-initializing the map
  const mapCallbacksRef = useRef({
    onRegionClick: (regionId: string) => {
      setSelectedRegionId(regionId);
      setSelectedCityId(null);
      if (isMobile) setMobileSheetSnap((prev) => (prev === 'collapsed' ? 'half' : prev));
    },
    onCityClick: (cityId: string, regionId: string) => {
      setSelectedRegionId(regionId);
      setSelectedCityId(cityId);
      if (isMobile) setMobileSheetSnap('half');
      else setDesktopInspectorOpen(true);
    },
    onOutsideClick: () => {
      setSelectedRegionId(null);
      setSelectedCityId(null);
      setHoverTooltip(null);
    },
  });
  mapCallbacksRef.current = {
    onRegionClick: (regionId: string) => {
      setSelectedRegionId(regionId);
      setSelectedCityId(null);
      if (isMobile) {
        setMobileSheetSnap((prev) => (prev === 'collapsed' ? 'half' : prev));
      }
    },
    onCityClick: (cityId: string, regionId: string) => {
      setSelectedRegionId(regionId);
      setSelectedCityId(cityId);
      if (isMobile) setMobileSheetSnap('half');
      else setDesktopInspectorOpen(true);
    },
    onOutsideClick: () => {
      setSelectedRegionId(null);
      setSelectedCityId(null);
      setHoverTooltip(null);
    },
  };

  // Keep projected Vietnamese labels + minimap viewport synchronized with MapLibre camera
  const syncCameraAndLabels = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !geojson || !layers) return;

    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const bearing = map.getBearing();
    const center = map.getCenter();
    const bounds = map.getBounds();

    setCurrentZoom(zoom);
    setCurrentPitch(pitch);
    setCurrentBearing(bearing);
    setViewportBounds({
      west: bounds.getWest(),
      east: bounds.getEast(),
      south: bounds.getSouth(),
      north: bounds.getNorth(),
    });
    saveSessionCamera(
      { center: [center.lng, center.lat], zoom, bearing, pitch },
      graphicsConfig.maxPitch
    );

    const { width, height } = map.getCanvas().getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const zSpec = classifySemanticZoom(zoom);
    const inView = (x: number, y: number) =>
      x >= -30 && x <= width + 30 && y >= -16 && y <= height + 16;

    const candidates: LabelCandidate[] = [];

    // Sea labels
    for (const s of SEA_LABELS) {
      const p = map.project([s.coords[0], s.coords[1]]);
      if (inView(p.x, p.y)) {
        candidates.push({
          key: s.key,
          text: s.text,
          x: p.x,
          y: p.y,
          width: s.text.length * 7.5,
          height: 16,
          priority: 42,
          kind: 'sea',
        });
      }
    }

    // Surrounding country labels
    for (const c of layers.contextCountries.features) {
      if (c.properties.iso === 'MMR' && zoom < 5.3) continue;
      const p = map.project([c.properties.labelPos[0], c.properties.labelPos[1]]);
      if (inView(p.x, p.y)) {
        candidates.push({
          key: `lbl_${c.properties.iso}`,
          text: c.properties.nameVi,
          x: p.x,
          y: p.y,
          width: c.properties.nameVi.length * 7.5,
          height: 16,
          priority: 58,
          kind: 'country',
        });
      }
    }

    // Cities (hierarchical semantic zoom + collision priority)
    const capitalRegionIds = new Set<string>();
    if (showCities) {
      for (const ec of enrichedCities) {
        if (
          graphicsConfig.labelDensity === 'minimal' &&
          ec.category !== 'NATIONAL_CAPITAL' &&
          ec.category !== 'MAJOR_CITY' &&
          ec.city.id !== selectedCityId
        ) {
          continue;
        }
        if (ec.category === 'STRATEGIC_SETTLEMENT' && !zSpec.showTownLabels && ec.city.id !== selectedCityId) {
          continue;
        }
        if (
          (ec.category === 'REGIONAL_CITY' || ec.category === 'TRANSPORT_HUB') &&
          zoom < 5.45 &&
          ec.city.id !== selectedCityId
        ) {
          continue;
        }
        const p = map.project([ec.city.coords[0], ec.city.coords[1]]);
        if (inView(p.x, p.y)) {
          const kind =
            ec.category === 'NATIONAL_CAPITAL'
              ? 'capital'
              : ec.category === 'PORT_CITY'
                ? 'port'
                : ec.category === 'MAJOR_CITY'
                  ? 'major-city'
                  : 'town';
          if (kind === 'capital') {
            capitalRegionIds.add(ec.city.regionId);
          }
          const badgeWidth =
            kind === 'capital'
              ? ec.city.name.length * 7.2 + 28
              : ec.city.name.length * 6.4 + 12;
          const anchorOffset = kind === 'capital' ? 14 : 9;
          candidates.push({
            key: `lbl_${ec.city.id}`,
            text: ec.city.name,
            x: p.x + anchorOffset + badgeWidth / 2,
            y: p.y,
            width: badgeWidth,
            height: kind === 'capital' ? 22 : 16,
            priority: ec.priority,
            kind,
            cityId: ec.city.id,
            regionId: ec.city.regionId,
            selected: ec.city.id === selectedCityId,
          });
        }
      }
    }

    // Mountain peaks (TERRAIN mode, L3+, or explicit toggle)
    if (
      (layer === 'TERRAIN' || showPeaksAndCodes || zSpec.showPeaks) &&
      graphicsConfig.labelDensity !== 'minimal'
    ) {
      for (const pk of layers.peaks) {
        const p = map.project([pk.coords[0], pk.coords[1]]);
        if (inView(p.x, p.y)) {
          const txt = `▲ ${pk.name} ${pk.elevationMeters}m`;
          candidates.push({
            key: `pk_${pk.name}`,
            text: txt,
            x: p.x,
            y: p.y - 12,
            width: txt.length * 5.6 + 8,
            height: 15,
            priority: layer === 'TERRAIN' ? 76 : 48,
            kind: 'peak',
          });
        }
      }
    }

    // Region codes at Level 3+ or when explicitly enabled (skip capital regions to prevent overlap)
    if ((showPeaksAndCodes || zSpec.showRegionCodes) && graphicsConfig.labelDensity !== 'minimal') {
      for (const f of geojson.features) {
        if (capitalRegionIds.has(f.properties.regionId)) continue;
        const p = map.project([f.properties.centroid[0], f.properties.centroid[1]]);
        if (inView(p.x, p.y)) {
          const isSel = f.properties.regionId === selectedRegionId;
          candidates.push({
            key: `code_${f.properties.regionId}`,
            text: f.properties.code,
            x: p.x,
            y: p.y,
            width: 28,
            height: 14,
            priority: isSel ? 92 : 30,
            kind: 'code',
            regionId: f.properties.regionId,
            selected: isSel,
          });
        }
      }
    }

    setProjectedLabels(resolveLabelCollisions(candidates, graphicsConfig.maxLabelCount));
  }, [
    geojson,
    layers,
    enrichedCities,
    layer,
    showCities,
    showPeaksAndCodes,
    selectedRegionId,
    selectedCityId,
    graphicsConfig.labelDensity,
    graphicsConfig.maxLabelCount,
    graphicsConfig.maxPitch,
  ]);

  // Initialize MapLibre GL ONCE per dataset load or renderer mode switch
  useEffect(() => {
    if (!geojson || !layers || renderMode !== 'maplibre' || !mapContainerRef.current) {
      return;
    }

    if (!checkWebGlAvailable()) {
      setRenderMode('svg-fallback');
      setFallbackReason('Thiết bị không hỗ trợ WebGL; đã tự động chuyển sang bản đồ vector SVG.');
      return;
    }

    const savedCam = loadSessionCamera();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: 'east-sea-bg',
              type: 'background',
              paint: { 'background-color': MAP_TOKENS.water.deepOcean },
            },
          ],
        },
        ...(savedCam
          ? {
              center: [savedCam.center[0], savedCam.center[1]],
              zoom: savedCam.zoom,
              bearing: savedCam.bearing,
              pitch: Math.min(savedCam.pitch, graphicsConfig.maxPitch),
            }
          : {
              bounds: [
                [VIETNAM_THEATER_BOUNDS[0][0], VIETNAM_THEATER_BOUNDS[0][1]],
                [VIETNAM_THEATER_BOUNDS[1][0], VIETNAM_THEATER_BOUNDS[1][1]],
              ],
              fitBoundsOptions: {
                padding: isMobile
                  ? { top: 24, bottom: 72, left: 16, right: 16 }
                  : { top: 32, bottom: 64, left: 40, right: 356 },
              },
            }),
        minZoom: MAP_TOKENS.zoom.min,
        maxZoom: MAP_TOKENS.zoom.max,
        maxPitch: 45,
        maxBounds: [
          [PLAYABLE_MAX_BOUNDS[0][0], PLAYABLE_MAX_BOUNDS[0][1]],
          [PLAYABLE_MAX_BOUNDS[1][0], PLAYABLE_MAX_BOUNDS[1][1]],
        ],
        attributionControl: false,
      });
    } catch {
      setRenderMode('svg-fallback');
      setFallbackReason('Không khởi tạo được MapLibre WebGL; đang dùng bản đồ vector SVG dự phòng.');
      return;
    }

    mapInstanceRef.current = map;

    // Handle WebGL context loss gracefully (Section 19 & 21)
    const canvas = map.getCanvas();
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setRenderMode('svg-fallback');
      setFallbackReason('Ngữ cảnh đồ họa WebGL bị gián đoạn; đã tự động chuyển sang bản đồ SVG.');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    let loaded = false;
    let landTimeout: number | undefined;
    const clearLandTimeout = () => {
      if (landTimeout !== undefined) window.clearTimeout(landTimeout);
    };
    const markLandReady = () => {
      if (!map.getLayer('vdn-regions-fill')) return;
      const regions = map.queryRenderedFeatures({ layers: ['vdn-regions-fill'] });
      if (regions.length === 0) return;
      clearLandTimeout();
      map.off('render', markLandReady);
      setLandReady(true);
    };

    map.on('render', markLandReady);
    landTimeout = window.setTimeout(() => {
      setRenderMode('svg-fallback');
      setFallbackReason('Các lớp lãnh thổ chưa hiển thị; đã chuyển sang bản đồ vector dự phòng.');
    }, 12_000);

    map.on('error', () => {
      if (!loaded) {
        setRenderMode('svg-fallback');
        setFallbackReason('Lỗi kết xuất WebGL; đã tự động chuyển sang bản đồ vector SVG dự phòng.');
      }
    });

    map.on('load', () => {
      loaded = true;
      if (!enrichedGeoJson) return;

      // 1. Graticule lines
      map.addSource('vdn-graticule', { type: 'geojson', data: GRATICULE_GEOJSON });
      map.addLayer({
        id: 'vdn-graticule-lines',
        type: 'line',
        source: 'vdn-graticule',
        paint: {
          'line-color': MAP_TOKENS.water.graticule,
          'line-width': 0.65,
          'line-opacity': 0.45,
        },
      });

      // 2. Surrounding Indochina Context Countries (Natural Earth 1:10m Public Domain)
      map.addSource('vdn-context', {
        type: 'geojson',
        data: layers.contextCountries as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-context-shelf',
        type: 'line',
        source: 'vdn-context',
        paint: {
          'line-color': MAP_TOKENS.water.shelfWater,
          'line-width': 12,
          'line-opacity': 0.45,
        },
      });
      map.addLayer({
        id: 'vdn-context-fill',
        type: 'fill',
        source: 'vdn-context',
        paint: {
          'fill-color': MAP_TOKENS.context.landFill,
          'fill-opacity': 0.96,
        },
      });
      map.addLayer({
        id: 'vdn-context-outline',
        type: 'line',
        source: 'vdn-context',
        paint: {
          'line-color': MAP_TOKENS.context.borderLine,
          'line-width': 0.9,
          'line-opacity': 0.72,
        },
      });

      // 3. Offshore Vietnam Islands
      map.addSource('vdn-islands', {
        type: 'geojson',
        data: layers.offshoreIslands as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-islands-halo',
        type: 'line',
        source: 'vdn-islands',
        paint: {
          'line-color': MAP_TOKENS.water.coastalShallow,
          'line-width': 5,
          'line-opacity': 0.55,
        },
      });
      map.addLayer({
        id: 'vdn-islands-fill',
        type: 'fill',
        source: 'vdn-islands',
        paint: {
          'fill-color': MAP_TOKENS.terrain.islandFill,
          'fill-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'vdn-islands-outline',
        type: 'line',
        source: 'vdn-islands',
        paint: {
          'line-color': MAP_TOKENS.terrain.islandBorder,
          'line-width': 0.8,
        },
      });

      // 4. 72 Organic Regions (Terrain Base + Restrained Coastal Shading + Mode Fill + Hover + Selection)
      map.addSource('vdn-regions', {
        type: 'geojson',
        data: enrichedGeoJson as unknown as GeoJsonData,
      });
      // Restrained multi-ring cartographic coastal shading (visual styling, NOT scientific bathymetry)
      map.addLayer({
        id: 'vdn-regions-coast-outer',
        type: 'line',
        source: 'vdn-regions',
        paint: {
          'line-color': MAP_TOKENS.water.shelfWater,
          'line-width': 16,
          'line-opacity': 0.5,
        },
      });
      map.addLayer({
        id: 'vdn-regions-coast-inner',
        type: 'line',
        source: 'vdn-regions',
        paint: {
          'line-color': MAP_TOKENS.water.coastalEdgeHalo,
          'line-width': 5.5,
          'line-opacity': 0.52,
        },
      });
      // Terrain hypsometric base always beneath political tint so terrain stays visible
      map.addLayer({
        id: 'vdn-regions-terrain-base',
        type: 'fill',
        source: 'vdn-regions',
        paint: {
          'fill-color': ['get', 'terrainColor'],
          'fill-opacity': 1,
        },
      });
      // Active mode overlay (semi-transparent in POLITICAL mode)
      map.addLayer({
        id: 'vdn-regions-fill',
        type: 'fill',
        source: 'vdn-regions',
        paint: {
          'fill-color': ['get', 'fillColor'],
          'fill-opacity': activeLayerDesc.terrainBlendOpacity,
        },
      });
      // Elevation relief depth tint
      map.addLayer({
        id: 'vdn-regions-relief-tint',
        type: 'fill',
        source: 'vdn-regions',
        paint: {
          'fill-color': '#1F1811',
          'fill-opacity': ['get', 'reliefOpacity'],
        },
      });

      // 5. Procedural SRTM 90m Shaded Relief Hillshade Image Overlay (Cartographic Approximation)
      if (hillshadeDataUrl) {
        map.addSource('vdn-srtm-hillshade-src', {
          type: 'image',
          url: hillshadeDataUrl,
          coordinates: [
            [HILLSHADE_BOUNDS[0][0], HILLSHADE_BOUNDS[0][1]],
            [HILLSHADE_BOUNDS[1][0], HILLSHADE_BOUNDS[1][1]],
            [HILLSHADE_BOUNDS[2][0], HILLSHADE_BOUNDS[2][1]],
            [HILLSHADE_BOUNDS[3][0], HILLSHADE_BOUNDS[3][1]],
          ],
        });
        map.addLayer({
          id: 'vdn-srtm-hillshade',
          type: 'raster',
          source: 'vdn-srtm-hillshade-src',
          paint: {
            'raster-opacity': 0.62,
            'raster-resampling': 'linear',
          },
        });
      }

      // Optional restrained 2.5D relief extrusion (only enabled on ULTRA preset when pitched)
      map.addLayer({
        id: 'vdn-regions-25d-relief',
        type: 'fill-extrusion',
        source: 'vdn-regions',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['get', 'fillColor'],
          'fill-extrusion-height': ['get', 'extrusionHeight'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.32,
        },
      });

      // Hover Highlight via MapLibre feature-state (zero GeoJSON rebuild on mousemove!)
      map.addLayer({
        id: 'vdn-regions-hover-fill',
        type: 'fill',
        source: 'vdn-regions',
        paint: {
          'fill-color': MAP_TOKENS.boundaries.hoverFill,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.16, 0],
        },
      });

      // Thin internal region boundaries
      map.addLayer({
        id: 'vdn-regions-outline',
        type: 'line',
        source: 'vdn-regions',
        paint: {
          'line-color': MAP_TOKENS.boundaries.internalRegion,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.5, 0.45, 7.5, 1.0],
          'line-opacity': MAP_TOKENS.boundaries.internalRegionOpacity,
        },
      });

      // Dynamic National & NPC Frontier Borders (derived strictly from authoritative match state)
      map.addSource('vdn-national-borders', {
        type: 'geojson',
        data: dynamicBorders as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-national-borders-casing',
        type: 'line',
        source: 'vdn-national-borders',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_TOKENS.boundaries.nationalBorderCasing,
          'line-width': [
            'case',
            ['==', ['get', 'borderKind'], 'NATIONAL_FACTION_BORDER'],
            4.2,
            2.6,
          ],
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'vdn-national-borders-line',
        type: 'line',
        source: 'vdn-national-borders',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'borderKind'], 'NATIONAL_FACTION_BORDER'],
            MAP_TOKENS.boundaries.nationalBorderLine,
            '#B6A989',
          ],
          'line-width': [
            'case',
            ['==', ['get', 'borderKind'], 'NATIONAL_FACTION_BORDER'],
            1.75,
            1.0,
          ],
          'line-opacity': 0.95,
        },
      });

      // Selected Region Highlight (dark halo + gold command outline)
      map.addLayer({
        id: 'vdn-regions-selected-halo',
        type: 'line',
        source: 'vdn-regions',
        filter: ['==', ['get', 'isSelected'], 1],
        paint: {
          'line-color': MAP_TOKENS.boundaries.selectedHalo,
          'line-width': 4.6,
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'vdn-regions-selected',
        type: 'line',
        source: 'vdn-regions',
        filter: ['==', ['get', 'isSelected'], 1],
        paint: {
          'line-color': MAP_TOKENS.boundaries.selectedOutline,
          'line-width': 2.2,
        },
      });

      // 6. Rivers (zoom-dependent width hierarchy)
      map.addSource('vdn-rivers', {
        type: 'geojson',
        data: layers.rivers as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-rivers-minor',
        type: 'line',
        source: 'vdn-rivers',
        minzoom: 5.5,
        filter: ['==', ['get', 'major'], false],
        paint: {
          'line-color': MAP_TOKENS.water.riverMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5.5, 0.7, 8.5, 1.7],
          'line-opacity': 0.72,
        },
      });
      map.addLayer({
        id: 'vdn-rivers-major-casing',
        type: 'line',
        source: 'vdn-rivers',
        filter: ['==', ['get', 'major'], true],
        paint: {
          'line-color': MAP_TOKENS.water.riverCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.2, 1.8, 8.5, 4.4],
          'line-opacity': 0.55,
        },
      });
      map.addLayer({
        id: 'vdn-rivers-major',
        type: 'line',
        source: 'vdn-rivers',
        filter: ['==', ['get', 'major'], true],
        paint: {
          'line-color': MAP_TOKENS.water.riverMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.2, 1.1, 8.5, 3.0],
          'line-opacity': 0.9,
        },
      });

      // 7. 4-Tier Abstract Transport Corridors (1955 Network)
      map.addSource('vdn-transport', {
        type: 'geojson',
        data: transportGeoJson,
      });
      map.addLayer({
        id: 'vdn-transport-secondary',
        type: 'line',
        source: 'vdn-transport',
        minzoom: 5.95,
        filter: ['==', ['get', 'kind'], 'SECONDARY_ROAD'],
        paint: {
          'line-color': MAP_TOKENS.transport.secondaryRoadLine,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6.0, 0.9, 8.5, 1.9],
          'line-dasharray': [3, 2.5],
          'line-opacity': 0.76,
        },
      });
      map.addLayer({
        id: 'vdn-transport-primary-casing',
        type: 'line',
        source: 'vdn-transport',
        minzoom: 4.8,
        filter: ['==', ['get', 'kind'], 'PRIMARY_ROAD'],
        paint: {
          'line-color': MAP_TOKENS.transport.primaryRoadCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.8, 2.0, 8.5, 4.2],
          'line-opacity': 0.7,
        },
      });
      map.addLayer({
        id: 'vdn-transport-primary',
        type: 'line',
        source: 'vdn-transport',
        minzoom: 4.8,
        filter: ['==', ['get', 'kind'], 'PRIMARY_ROAD'],
        paint: {
          'line-color': MAP_TOKENS.transport.primaryRoadLine,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.8, 1.1, 8.5, 2.5],
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'vdn-transport-rail-base',
        type: 'line',
        source: 'vdn-transport',
        minzoom: 4.8,
        filter: ['==', ['get', 'kind'], 'RAILWAY'],
        paint: {
          'line-color': MAP_TOKENS.transport.railwayBase,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.8, 2.1, 8.5, 3.8],
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'vdn-transport-rail-ties',
        type: 'line',
        source: 'vdn-transport',
        minzoom: 4.8,
        filter: ['==', ['get', 'kind'], 'RAILWAY'],
        paint: {
          'line-color': MAP_TOKENS.transport.railwayTies,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.8, 0.9, 8.5, 1.8],
          'line-dasharray': [2.2, 2.8],
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'vdn-transport-crossing',
        type: 'line',
        source: 'vdn-transport',
        minzoom: 5.8,
        filter: ['==', ['get', 'kind'], 'RIVER_CROSSING'],
        paint: {
          'line-color': MAP_TOKENS.transport.riverCrossingLine,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5.8, 1.8, 8.5, 3.0],
          'line-dasharray': [1.5, 2],
          'line-opacity': 0.95,
        },
      });

      // 8. Hierarchical 24 Cities Layer (zoom-dependent sizing & selected ring)
      map.addSource('vdn-cities', {
        type: 'geojson',
        data: citiesGeoJson,
      });
      map.addLayer({
        id: 'vdn-cities-selected-ring',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'isSelected'], 1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 9.5, 8.5, 14],
          'circle-color': 'rgba(243, 210, 122, 0.18)',
          'circle-stroke-color': '#F3D27A',
          'circle-stroke-width': 2.2,
        },
      });
      map.addLayer({
        id: 'vdn-cities-towns',
        type: 'circle',
        source: 'vdn-cities',
        minzoom: 5.7,
        filter: [
          'in',
          ['get', 'category'],
          ['literal', ['STRATEGIC_SETTLEMENT', 'REGIONAL_CITY', 'TRANSPORT_HUB']],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5.7, 2.8, 8.5, 4.8],
          'circle-color': '#EFE9DC',
          'circle-stroke-color': '#12161C',
          'circle-stroke-width': 1.4,
        },
      });
      map.addLayer({
        id: 'vdn-cities-ports',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'category'], 'PORT_CITY'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 3.8, 8.5, 6.2],
          'circle-color': '#7CC0D6',
          'circle-stroke-color': '#12161C',
          'circle-stroke-width': 1.8,
        },
      });
      map.addLayer({
        id: 'vdn-cities-major',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'category'], 'MAJOR_CITY'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 4.2, 8.5, 6.8],
          'circle-color': '#F5EFE2',
          'circle-stroke-color': '#12161C',
          'circle-stroke-width': 2.0,
        },
      });
      map.addLayer({
        id: 'vdn-cities-capital-outer',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'category'], 'NATIONAL_CAPITAL'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 6.5, 8.5, 10],
          'circle-color': MAP_TOKENS.labels.capitalGold,
          'circle-stroke-color': '#12161C',
          'circle-stroke-width': 2.2,
        },
      });
      map.addLayer({
        id: 'vdn-cities-capital-inner',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'category'], 'NATIONAL_CAPITAL'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 2.5, 8.5, 4.0],
          'circle-color': '#12161C',
        },
      });

      // Unified click handler: City takes priority over Region; clicking ocean/outside deselects
      map.on('click', (e: maplibregl.MapMouseEvent) => {
        const cityHits = map.queryRenderedFeatures(e.point, {
          layers: [
            'vdn-cities-capital-outer',
            'vdn-cities-major',
            'vdn-cities-ports',
            'vdn-cities-towns',
          ],
        });
        if (cityHits.length > 0) {
          const props = cityHits[0].properties;
          if (typeof props?.id === 'string' && typeof props?.regionId === 'string') {
            mapCallbacksRef.current.onCityClick(props.id, props.regionId);
            return;
          }
        }

        const regionHits = map.queryRenderedFeatures(e.point, {
          layers: ['vdn-regions-fill'],
        });
        if (regionHits.length > 0) {
          const rId = regionHits[0].properties?.regionId;
          if (typeof rId === 'string') {
            mapCallbacksRef.current.onRegionClick(rId);
            return;
          }
        }

        mapCallbacksRef.current.onOutsideClick();
      });

      // Efficient feature-state hover highlight + desktop tooltip
      map.on('mousemove', 'vdn-regions-fill', (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const hit = e.features?.[0];
        if (!hit) return;

        if (hoveredFeatureIdRef.current !== null && hoveredFeatureIdRef.current !== hit.id) {
          map.setFeatureState(
            { source: 'vdn-regions', id: hoveredFeatureIdRef.current },
            { hover: false }
          );
        }
        if (hit.id !== undefined) {
          hoveredFeatureIdRef.current = hit.id;
          map.setFeatureState({ source: 'vdn-regions', id: hit.id }, { hover: true });
        }

        const rId = hit.properties?.regionId;
        if (typeof rId === 'string') {
          setHoverTooltip({ regionId: rId, x: e.point.x, y: e.point.y });
        }
      });

      map.on('mouseleave', 'vdn-regions-fill', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredFeatureIdRef.current !== null) {
          map.setFeatureState(
            { source: 'vdn-regions', id: hoveredFeatureIdRef.current },
            { hover: false }
          );
          hoveredFeatureIdRef.current = null;
        }
        setHoverTooltip(null);
      });

      setMapReady(true);
    });

    // Debounced ResizeObserver for crisp panel & orientation changes
    let resizeTimer: number | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        map.resize();
      }, 65);
    });
    ro.observe(mapContainerRef.current);

    return () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      ro.disconnect();
      clearLandTimeout();
      setLandReady(false);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      setMapReady(false);
      map.remove();
      mapInstanceRef.current = null;
      hoveredFeatureIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(geojson && layers), renderMode]);

  // Incremental source & layer property updates (ZERO map recreation!)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !enrichedGeoJson) return;

    const regSrc = map.getSource('vdn-regions') as maplibregl.GeoJSONSource | undefined;
    regSrc?.setData(enrichedGeoJson as unknown as GeoJsonData);

    const borderSrc = map.getSource('vdn-national-borders') as maplibregl.GeoJSONSource | undefined;
    borderSrc?.setData(dynamicBorders as unknown as GeoJsonData);

    const citySrc = map.getSource('vdn-cities') as maplibregl.GeoJSONSource | undefined;
    citySrc?.setData(citiesGeoJson);
  }, [mapReady, enrichedGeoJson, dynamicBorders, citiesGeoJson]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    // Blend political/mode overlay opacity so terrain stays legible
    if (map.getLayer('vdn-regions-fill')) {
      map.setPaintProperty('vdn-regions-fill', 'fill-opacity', activeLayerDesc.terrainBlendOpacity);
    }

    // Hillshade opacity stronger in TERRAIN mode, subtle in POLITICAL mode, hidden on LOW preset
    if (map.getLayer('vdn-srtm-hillshade')) {
      map.setLayoutProperty(
        'vdn-srtm-hillshade',
        'visibility',
        graphicsConfig.hillshadeEnabled ? 'visible' : 'none'
      );
      map.setPaintProperty(
        'vdn-srtm-hillshade',
        'raster-opacity',
        layer === 'TERRAIN' ? 0.82 : graphicsPreset === 'HIGH' || graphicsPreset === 'ULTRA' ? 0.56 : 0.42
      );
    }

    const setVis = (id: string, visible: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };

    setVis('vdn-graticule-lines', graphicsConfig.graticuleEnabled);
    setVis('vdn-regions-coast-outer', graphicsConfig.coastalShadingRings);
    setVis('vdn-regions-coast-inner', graphicsConfig.coastalShadingRings);
    setVis('vdn-regions-relief-tint', graphicsConfig.reliefContourTint);
    setVis(
      'vdn-regions-25d-relief',
      graphicsConfig.relief25DExtrusion && currentPitch > 8
    );

    setVis('vdn-rivers-minor', showRivers && graphicsConfig.riverDetail === 'all');
    setVis('vdn-rivers-major', showRivers);
    setVis('vdn-rivers-major-casing', showRivers && graphicsConfig.coastalShadingRings);

    setVis('vdn-transport-secondary', showTransport);
    setVis('vdn-transport-primary-casing', showTransport);
    setVis('vdn-transport-primary', showTransport);
    setVis('vdn-transport-rail-base', showTransport);
    setVis('vdn-transport-rail-ties', showTransport);
    setVis('vdn-transport-crossing', showTransport);

    setVis('vdn-cities-selected-ring', showCities);
    setVis('vdn-cities-towns', showCities);
    setVis('vdn-cities-ports', showCities);
    setVis('vdn-cities-major', showCities);
    setVis('vdn-cities-capital-outer', showCities);
    setVis('vdn-cities-capital-inner', showCities);

    // Flatten pitch cleanly if user switches down to LOW / MEDIUM preset
    if (!graphicsConfig.allowPitch && map.getPitch() > 0) {
      map.easeTo({ pitch: 0, duration: 240 });
    }
  }, [
    activeLayerDesc.terrainBlendOpacity,
    layer,
    graphicsConfig,
    graphicsPreset,
    currentPitch,
    mapReady,
    showRivers,
    showTransport,
    showCities,
  ]);

  // Bind camera move / resize events to label sync
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    syncCameraAndLabels();
    const onMove = () => syncCameraAndLabels();
    map.on('move', onMove);
    map.on('resize', onMove);
    return () => {
      map.off('move', onMove);
      map.off('resize', onMove);
    };
  }, [mapReady, syncCameraAndLabels]);

  // Camera actions
  const handleZoomIn = useCallback(() => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn({ duration: 220 });
    } else {
      setSvgZoom((z) => Math.min(4.0, Number((z + 0.35).toFixed(2))));
    }
  }, [renderMode]);

  const handleZoomOut = useCallback(() => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut({ duration: 220 });
    } else {
      setSvgZoom((z) => Math.max(0.85, Number((z - 0.35).toFixed(2))));
    }
  }, [renderMode]);

  const handleResetView = useCallback(() => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds(
        [
          [VIETNAM_THEATER_BOUNDS[0][0], VIETNAM_THEATER_BOUNDS[0][1]],
          [VIETNAM_THEATER_BOUNDS[1][0], VIETNAM_THEATER_BOUNDS[1][1]],
        ],
        {
          padding: isMobile
            ? { top: 24, bottom: 72, left: 16, right: 16 }
            : { top: 32, bottom: 64, left: 40, right: desktopInspectorOpen ? 356 : 48 },
          duration: 380,
          bearing: 0,
          pitch: 0,
        }
      );
    } else {
      setSvgZoom(1.08);
      setSvgPan({ x: 0, y: 0 });
    }
  }, [renderMode, isMobile, desktopInspectorOpen]);

  const handleResetNorth = useCallback(() => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.easeTo({ bearing: 0, duration: 260 });
    }
  }, [renderMode]);

  const handleTogglePitch = useCallback(() => {
    if (!graphicsConfig.allowPitch || renderMode !== 'maplibre' || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const nextPitch = map.getPitch() > 8 ? 0 : Math.min(36, graphicsConfig.maxPitch);
    map.easeTo({ pitch: nextPitch, duration: 320 });
  }, [graphicsConfig.allowPitch, graphicsConfig.maxPitch, renderMode]);

  const handleJumpCameraPreset = useCallback(
    (presetId: CameraPresetId) => {
      const preset = getCameraPresetById(presetId);
      if (renderMode === 'maplibre' && mapInstanceRef.current) {
        mapInstanceRef.current.flyTo({
          center: [preset.center[0], preset.center[1]],
          zoom: preset.zoom,
          bearing: preset.bearing,
          pitch: Math.min(preset.pitch, graphicsConfig.maxPitch),
          duration: 460,
        });
      } else {
        const clamped = clampCameraSnapshot(
          {
            center: preset.center,
            zoom: preset.zoom,
            bearing: preset.bearing,
            pitch: preset.pitch,
          },
          0
        );
        setSvgZoom(Math.max(1.0, Number(((clamped.zoom - 4.2) * 0.55).toFixed(2))));
      }
      if (presetId === 'CAPITAL_NORTH') {
        setSelectedRegionId('reg_vn_11');
        const hanoi = enrichedCities.find((c) => c.city.regionId === 'reg_vn_11');
        setSelectedCityId(hanoi?.city.id ?? null);
      } else if (presetId === 'CAPITAL_SOUTH') {
        setSelectedRegionId('reg_vn_59');
        const saigon = enrichedCities.find((c) => c.city.regionId === 'reg_vn_59');
        setSelectedCityId(saigon?.city.id ?? null);
      }
    },
    [renderMode, graphicsConfig.maxPitch, enrichedCities]
  );

  const focusRegion = useCallback(
    (regionId: string) => {
      setSelectedRegionId(regionId);
      setSelectedCityId(null);
      const feat = featuresById.get(regionId);
      if (feat && renderMode === 'maplibre' && mapInstanceRef.current) {
        const z = mapInstanceRef.current.getZoom();
        mapInstanceRef.current.flyTo({
          center: [feat.properties.centroid[0], feat.properties.centroid[1]],
          zoom: Math.max(z, 6.7),
          duration: 400,
        });
      }
      if (isMobile) setMobileSheetSnap('half');
      else setDesktopInspectorOpen(true);
    },
    [featuresById, renderMode, isMobile]
  );

  const handleSelectCity = useCallback(
    (ec: EnrichedCity) => {
      setSelectedRegionId(ec.city.regionId);
      setSelectedCityId(ec.city.id);
      if (renderMode === 'maplibre' && mapInstanceRef.current) {
        const z = mapInstanceRef.current.getZoom();
        mapInstanceRef.current.flyTo({
          center: [ec.city.coords[0], ec.city.coords[1]],
          zoom: Math.max(z, 7.2),
          duration: 420,
        });
      }
      if (isMobile) setMobileSheetSnap('half');
      else setDesktopInspectorOpen(true);
    },
    [renderMode, isMobile]
  );

  const handleSearchSelect = useCallback(
    (res: MapSearchResult) => {
      if (res.kind === 'city' && res.cityId) {
        const city = enrichedCitiesById.get(res.cityId);
        if (city) {
          handleSelectCity(city);
          if (isMobile) onChangeDrawer('none');
          return;
        }
      }
      focusRegion(res.regionId);
      if (isMobile) onChangeDrawer('none');
    },
    [enrichedCitiesById, handleSelectCity, focusRegion, isMobile, onChangeDrawer]
  );

  const handleMinimapNavigate = useCallback(
    (lon: number, lat: number) => {
      if (renderMode === 'maplibre' && mapInstanceRef.current) {
        mapInstanceRef.current.easeTo({ center: [lon, lat], duration: 180 });
      }
    },
    [renderMode]
  );

  // Keyboard shortcuts (safely ignored inside form controls)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        if (e.key === 'Escape') {
          onChangeDrawer('none');
          target?.blur();
        }
        return;
      }

      if (e.key === '1') setLayer('POLITICAL');
      else if (e.key === '2') setLayer('TERRAIN');
      else if (e.key === '3') setLayer('ECONOMY');
      else if (e.key === '4') setLayer('INFRASTRUCTURE');
      else if (e.key === '+' || e.key === '=') handleZoomIn();
      else if (e.key === '-' || e.key === '_') handleZoomOut();
      else if (e.key === '0' || e.key === 'Home') handleResetView();
      else if (e.key === 'r' || e.key === 'R') handleResetNorth();
      else if (e.key === 'm' || e.key === 'M') setMinimapExpanded((v) => !v);
      else if (e.key === 'f' || e.key === 'F') onToggleFullscreen();
      else if (e.key === '/') {
        e.preventDefault();
        onChangeDrawer(activeDrawer === 'search' ? 'none' : 'search');
      } else if (e.key === 'Escape') {
        if (activeDrawer !== 'none') onChangeDrawer('none');
        else {
          setSelectedRegionId(null);
          setSelectedCityId(null);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeDrawer,
    handleResetNorth,
    handleResetView,
    handleZoomIn,
    handleZoomOut,
    onChangeDrawer,
    onToggleFullscreen,
  ]);

  const selectedFeature = selectedRegionId ? featuresById.get(selectedRegionId) ?? null : null;
  const selectedCity = selectedCityId ? enrichedCitiesById.get(selectedCityId) ?? null : null;

  const citiesInSelectedRegion = useMemo(() => {
    if (!selectedFeature) return [];
    return enrichedCities.filter((c) => c.city.regionId === selectedFeature.properties.regionId);
  }, [enrichedCities, selectedFeature]);

  const corridorsForSelectedRegion = useMemo((): readonly TransportCorridor[] => {
    if (!layers || !selectedFeature) return [];
    const id = selectedFeature.properties.regionId;
    return layers.transportCorridors.filter(
      (t) => t.fromRegionId === id || t.toRegionId === id
    );
  }, [layers, selectedFeature]);

  const hoveredFeature = hoverTooltip ? featuresById.get(hoverTooltip.regionId) ?? null : null;

  return (
    <div
      data-testid="strategic-map-stage"
      data-render-mode={renderMode}
      data-map-ready={renderMode === 'svg-fallback' || landReady}
      data-map-layer={layer}
      data-graphics-preset={graphicsPreset}
      data-semantic-zoom={zoomDescriptor.code}
      data-match-source={matchSourceKind}
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-[#1F3545]"
    >
      {/* Loading & Error States */}
      {loading && (
        <div className="flex h-full w-full items-center justify-center bg-[#141A21] text-xs font-medium text-[#A8B2BC]">
          Đang tải nền địa lý Natural Earth 1:10m &amp; độ cao NASA SRTM 90m...
        </div>
      )}

      {!loading && error && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#141A21] p-6 text-center">
          <ShieldAlert className="h-6 w-6 text-[#C95A4C]" aria-hidden="true" />
          <p className="text-sm font-medium text-[#EFE9DC]">{error}</p>
        </div>
      )}

      {/* Active Map Canvas or Full-Fidelity SVG Fallback */}
      {!loading && !error && geojson && layers && (
        <>
          {renderMode === 'maplibre' ? (
            <div className="relative h-full w-full touch-none">
              <div
                ref={mapContainerRef}
                data-testid="maplibre-canvas"
                className="h-full w-full"
              />

              {!landReady && (
                <div
                  role="status"
                  className="absolute inset-0 z-10 grid place-items-center bg-[#1F3545] px-6 text-center text-sm text-[#EFE9DC]"
                >
                  Đang vẽ ranh giới và vùng chiến lược…
                </div>
              )}

              {/* Cosmetic-Only Weather/Atmosphere Surface Adapter (Zero gameplay impact) */}
              {weatherConfig.enabled &&
                graphicsConfig.cosmeticAtmosphereAllowed &&
                weatherConfig.visualState !== 'CLEAR' && (
                  <div
                    aria-hidden="true"
                    data-testid="cosmetic-weather-overlay"
                    className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
                      weatherConfig.visualState === 'FOG'
                        ? 'bg-[#D8E2E8]/14'
                        : weatherConfig.visualState === 'CLOUD_COVER'
                          ? 'bg-[#1D2832]/16'
                          : weatherConfig.visualState === 'RAIN'
                            ? 'bg-[#172838]/20'
                            : 'bg-[#101B26]/28'
                    }`}
                  />
                )}

              {/* Collision-Resolved Vietnamese Cartographic Labels & Clickable City Badges */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden select-none">
                {projectedLabels.map((lbl) => {
                  if (lbl.kind === 'sea') {
                    return (
                      <span
                        key={lbl.key}
                        style={{ left: lbl.x, top: lbl.y }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-semibold tracking-[0.26em] text-[#8EB0C2]/75 italic whitespace-nowrap"
                      >
                        {lbl.text}
                      </span>
                    );
                  }
                  if (lbl.kind === 'country') {
                    return (
                      <span
                        key={lbl.key}
                        style={{ left: lbl.x, top: lbl.y }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold tracking-[0.2em] text-[#A9B0A0]/80 whitespace-nowrap"
                      >
                        {lbl.text}
                      </span>
                    );
                  }
                  if (lbl.kind === 'capital') {
                    return (
                      <button
                        key={lbl.key}
                        type="button"
                        onClick={() => {
                          const c = lbl.cityId ? enrichedCitiesById.get(lbl.cityId) : null;
                          if (c) handleSelectCity(c);
                        }}
                        style={{ left: lbl.x, top: lbl.y }}
                        className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 border px-1.5 py-0.5 text-[11px] font-bold tracking-tight whitespace-nowrap shadow-md transition-colors ${
                          lbl.selected
                            ? 'border-[#F3D27A] bg-[#242D36] text-[#F8E3A3]'
                            : 'border-[#C6A15B]/70 bg-[#12171D]/88 text-[#F5EFE2] hover:border-[#F3D27A]'
                        }`}
                      >
                        ★ {lbl.text}
                      </button>
                    );
                  }
                  if (lbl.kind === 'port' || lbl.kind === 'major-city' || lbl.kind === 'town') {
                    return (
                      <button
                        key={lbl.key}
                        type="button"
                        onClick={() => {
                          const c = lbl.cityId ? enrichedCitiesById.get(lbl.cityId) : null;
                          if (c) handleSelectCity(c);
                        }}
                        style={{ left: lbl.x, top: lbl.y }}
                        className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap [text-shadow:0_1px_3px_#0B0F14,0_0_5px_#0B0F14] ${
                          lbl.selected
                            ? 'font-bold text-[#F3D27A]'
                            : lbl.kind === 'port'
                              ? 'text-[10px] font-semibold text-[#A7D8E8] hover:text-[#F3D27A]'
                              : lbl.kind === 'major-city'
                                ? 'text-[10px] font-semibold text-[#F5EFE2] hover:text-[#F3D27A]'
                                : 'text-[9px] font-medium text-[#D6CEBD] hover:text-[#F3D27A]'
                        }`}
                      >
                        {lbl.text}
                      </button>
                    );
                  }
                  if (lbl.kind === 'peak') {
                    return (
                      <span
                        key={lbl.key}
                        style={{ left: lbl.x, top: lbl.y }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 border border-[#4D4538] bg-[#1A1713]/88 px-1.5 py-0.5 text-[9px] font-semibold text-[#E8DAC2] whitespace-nowrap"
                      >
                        {lbl.text}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={lbl.key}
                      style={{ left: lbl.x, top: lbl.y }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[9px] font-semibold whitespace-nowrap [text-shadow:0_1px_3px_#0B0F14,0_0_4px_#0B0F14] ${
                        lbl.selected ? 'text-[#F3D27A]' : 'text-[#EFE9DC]/80'
                      }`}
                    >
                      {lbl.text}
                    </span>
                  );
                })}
              </div>

              {/* Desktop Hover Tooltip (non-blocking) */}
              {!isMobile && hoverTooltip && hoveredFeature && (
                <div
                  aria-hidden="true"
                  style={{
                    left: Math.min(hoverTooltip.x + 14, window.innerWidth - 260),
                    top: Math.max(12, hoverTooltip.y - 44),
                  }}
                  className="pointer-events-none absolute z-30 border border-[#3C4957] bg-[#12171D]/94 px-2.5 py-1.5 text-[11px] text-[#EFE9DC] shadow-xl"
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <span
                      className="h-2 w-2 shrink-0"
                      style={{
                        backgroundColor: getFactionVisual(
                          effectiveMatch?.regions[hoveredFeature.properties.regionId]?.controllerNationId ??
                            hoveredFeature.properties.initialControllerNationId
                        ).fill,
                      }}
                    />
                    <span>
                      {hoveredFeature.properties.code} · {hoveredFeature.properties.name}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-[#A8B2BC] tabular-nums">
                    Cao {hoveredFeature.properties.elevationMeters}m · KT{' '}
                    {(hoveredFeature.properties.economicOutputFp / 1000).toFixed(0)} · HT{' '}
                    {(
                      (effectiveMatch?.regions[hoveredFeature.properties.regionId]?.infrastructureFp ??
                        hoveredFeature.properties.infrastructureFp) / 1000
                    ).toFixed(0)}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <SvgFallbackMap
              geojson={geojson}
              layers={layers}
              layer={layer}
              match={effectiveMatch}
              selectedRegionId={selectedRegionId}
              selectedCityId={selectedCityId}
              enrichedCities={enrichedCities}
              dynamicBorders={dynamicBorders}
              showCities={showCities}
              showTransport={showTransport}
              showRivers={showRivers}
              showPeaksAndCodes={showPeaksAndCodes}
              svgZoom={svgZoom}
              svgPan={svgPan}
              onChangeSvgZoom={setSvgZoom}
              onChangeSvgPan={setSvgPan}
              onSelectRegion={(rId) => {
                setSelectedRegionId(rId);
                setSelectedCityId(null);
                if (isMobile) setMobileSheetSnap((s) => (s === 'collapsed' ? 'half' : s));
              }}
              onSelectCity={handleSelectCity}
              onClearSelection={() => {
                setSelectedRegionId(null);
                setSelectedCityId(null);
              }}
            />
          )}

          {/* HUD Overlay Layer (pointer-events-none wrapper so map pan/zoom never blocked) */}
          <div className="pointer-events-none absolute inset-0 z-10">
            {/* Subtle Left-Top Attribution & Active Renderer Badge (non-intrusive) */}
            <div className="absolute top-3 left-3 hidden border border-[#2B3540] bg-[#12171D]/85 px-2.5 py-1 text-[10px] text-[#9CA7B4] md:block">
              <span>
                72 vùng chiến lược · {renderMode === 'maplibre' ? 'MapLibre GL' : 'SVG Dự phòng'} ·{' '}
                {graphicsPreset} ·{' '}
                {matchSourceKind === 'ROOM_LIVE' && effectiveMatch
                  ? `Phòng v${effectiveMatch.version}`
                  : matchSourceKind === 'FOUNDATION_LIVE' && effectiveMatch
                    ? `Foundation v${effectiveMatch.version}`
                    : 'Natural Earth 1:10m & NASA SRTM 90m'}
              </span>
            </div>

            {/* Left Contextual Drawers: Search & Display/Graphics Settings */}
            <MapSearchDrawer
              open={activeDrawer === 'search'}
              onClose={() => onChangeDrawer('none')}
              features={geojson.features}
              cities={enrichedCities}
              onSelectResult={handleSearchSelect}
              onJumpCameraPreset={handleJumpCameraPreset}
            />

            <MapDisplayDrawer
              open={activeDrawer === 'display'}
              onClose={() => onChangeDrawer('none')}
              graphicsPreset={graphicsPreset}
              onChangeGraphicsPreset={setGraphicsPreset}
              renderMode={renderMode}
              onChangeRenderMode={(next) => {
                setRenderMode(next);
                if (next === 'maplibre') setFallbackReason(null);
              }}
              fallbackReason={fallbackReason}
              showCities={showCities}
              onToggleCities={() => setShowCities((v) => !v)}
              showTransport={showTransport}
              onToggleTransport={() => setShowTransport((v) => !v)}
              showRivers={showRivers}
              onToggleRivers={() => setShowRivers((v) => !v)}
              showPeaksAndCodes={showPeaksAndCodes}
              onTogglePeaksAndCodes={() => setShowPeaksAndCodes((v) => !v)}
              weatherConfig={weatherConfig}
              onChangeWeatherConfig={setWeatherConfig}
              cityCount={layers.cities.length}
              corridorCount={layers.transportCorridors.length}
            />

            {/* Right Contextual Inspector (Desktop Panel / Mobile 3-State Bottom Sheet) */}
            <ContextualInspector
              isMobile={isMobile}
              desktopOpen={desktopInspectorOpen}
              onToggleDesktopOpen={() => setDesktopInspectorOpen((v) => !v)}
              mobileSnap={mobileSheetSnap}
              onChangeMobileSnap={setMobileSheetSnap}
              selectedFeature={selectedFeature}
              selectedCity={selectedCity}
              onClearCitySelection={() => setSelectedCityId(null)}
              onSelectCity={handleSelectCity}
              onFocusRegion={focusRegion}
              onClearSelection={() => {
                setSelectedRegionId(null);
                setSelectedCityId(null);
              }}
              match={effectiveMatch}
              matchSourceKind={matchSourceKind}
              foundationSector={
                selectedFeature
                  ? foundationRegionMap.get(selectedFeature.properties.regionId) ?? null
                  : null
              }
              room={room}
              citiesInRegion={citiesInSelectedRegion}
              corridorsForRegion={corridorsForSelectedRegion}
              featuresById={featuresById}
              onScheduleRegionAction={onScheduleRegionAction}
              actionBusy={actionBusy}
              sendMarch={sendMarch}
              loadMovementPreview={loadMovementPreview}
            />

            {/* Bottom-Left: Lightweight Expandable Minimap (Desktop/Tablet only) */}
            {!isMobile && (
              <div className="absolute bottom-3 left-3">
                <StrategicMinimap
                  geojson={geojson}
                  layers={layers}
                  layer={layer}
                  match={effectiveMatch}
                  selectedRegionId={selectedRegionId}
                  viewportBounds={viewportBounds}
                  expanded={minimapExpanded}
                  onToggleExpanded={() => setMinimapExpanded((v) => !v)}
                  onNavigateToCoords={handleMinimapNavigate}
                />
              </div>
            )}

            {/* Bottom-Center: Map Mode Selector & Legend */}
            {(!isMobile || mobileSheetSnap === 'collapsed') && (
              <div
                className={`absolute left-1/2 -translate-x-1/2 ${
                  isMobile ? (selectedFeature ? 'bottom-[70px]' : 'bottom-3') : 'bottom-3'
                }`}
              >
                <BottomModeDock layer={layer} onChangeLayer={setLayer} isMobile={isMobile} />
              </div>
            )}

            {/* Bottom-Right: Compact Zoom, North-Up, Reset & 2.5D Pitch Controls */}
            {(!isMobile || mobileSheetSnap === 'collapsed') && (
              <div
                className={`absolute right-3 ${
                  isMobile
                    ? selectedFeature
                      ? 'bottom-[120px] sm:bottom-[70px]'
                      : 'bottom-16 sm:bottom-3'
                    : 'bottom-3'
                }`}
                style={
                  !isMobile && desktopInspectorOpen ? { right: '352px' } : undefined
                }
              >
                <MapControlsCluster
                  zoomDescriptor={zoomDescriptor}
                  currentZoom={renderMode === 'maplibre' ? currentZoom : 4.6 + svgZoom * 1.3}
                  currentPitch={currentPitch}
                  currentBearing={currentBearing}
                  allowPitch={graphicsConfig.allowPitch}
                  renderMode={renderMode}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onResetView={handleResetView}
                  onResetNorth={handleResetNorth}
                  onTogglePitch={handleTogglePitch}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
