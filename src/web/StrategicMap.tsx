import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Compass,
  EyeOff,
  Layers,
  MapPin,
  Minus,
  Mountain,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Route,
  ShieldAlert,
  Waves,
} from 'lucide-react';
import {
  FilteredClientMatchView,
  fpFormat,
  MapLayerMode,
  MatchRoomSummary,
  TransportCorridor,
} from '../contracts';
import {
  ACTIVE_MAP_LAYERS,
  buildLegendItems,
  computeRegionFillColor,
  NATION_LABELS,
  PLANNED_FUTURE_MAP_LAYERS,
  TERRAIN_FEATURE_LABELS,
  TERRAIN_LABELS,
  TRANSPORT_LABELS,
} from './mapLayerRegistry';
import { WorldMapFeature, WorldMapGeoJson, WorldMapLayers } from './roomApi';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface StrategicMapProps {
  readonly geojson: WorldMapGeoJson | null;
  readonly layers: WorldMapLayers | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly match: FilteredClientMatchView | null;
  readonly room: MatchRoomSummary | null;
  readonly onScheduleRegionAction?: (regionId: string) => void;
  readonly actionBusy?: boolean;
}

interface ProjectedLabel {
  readonly key: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly kind: 'sea' | 'country' | 'capital' | 'major-city' | 'town' | 'peak' | 'code';
}

const SEA_LABELS: readonly { key: string; text: string; coords: [number, number] }[] = [
  { key: 'sea_east', text: 'BIỂN ĐÔNG', coords: [111.1, 14.5] },
  { key: 'sea_tonkin', text: 'VỊNH BẮC BỘ', coords: [107.8, 19.7] },
  { key: 'sea_thailand', text: 'VỊNH THÁI LAN', coords: [102.5, 9.7] },
];

const VIETNAM_THEATER_BOUNDS: [[number, number], [number, number]] = [
  [101.6, 8.3],
  [110.2, 23.5],
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

export function StrategicMap({
  geojson,
  layers,
  loading,
  error,
  match,
  room,
  onScheduleRegionAction,
  actionBusy,
}: StrategicMapProps) {
  const [layer, setLayer] = useState<MapLayerMode>('POLITICAL');
  const [selectedRegionId, setSelectedRegionId] = useState<string>('reg_vn_11');
  const [renderMode, setRenderMode] = useState<'maplibre' | 'svg-fallback'>('maplibre');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);

  // Cartographic overlay toggles
  const [showCities, setShowCities] = useState(true);
  const [showTransport, setShowTransport] = useState(true);
  const [showRivers, setShowRivers] = useState(true);
  const [showPeaksAndCodes, setShowPeaksAndCodes] = useState(false);

  // Synchronized screen-space labels for MapLibre GL (zero external font/glyph network requests)
  const [projectedLabels, setProjectedLabels] = useState<readonly ProjectedLabel[]>([]);

  // SVG Fallback pan & zoom state
  const [svgZoom, setSvgZoom] = useState<number>(1.08);
  const [svgPan, setSvgPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const featuresById = useMemo(() => {
    const map = new Map<string, WorldMapFeature>();
    if (geojson) {
      for (const f of geojson.features) {
        map.set(f.properties.regionId, f);
      }
    }
    return map;
  }, [geojson]);

  const enrichedGeoJson = useMemo(() => {
    if (!geojson) return null;
    return {
      type: 'FeatureCollection' as const,
      features: geojson.features.map((f) => ({
        type: 'Feature' as const,
        id: f.properties.regionId,
        properties: {
          ...f.properties,
          fillColor: computeRegionFillColor(f, layer, match),
          reliefOpacity: Math.min(0.28, (f.properties.elevationMeters / 1600) * 0.26),
          isSelected: f.properties.regionId === selectedRegionId ? 1 : 0,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: f.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
        },
      })),
    };
  }, [geojson, layer, match, selectedRegionId]);

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
    if (!layers) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: layers.cities.map((c) => ({
        type: 'Feature',
        id: c.id,
        properties: {
          id: c.id,
          name: c.name,
          tier: c.tier,
          regionId: c.regionId,
          port: Boolean(c.port),
        },
        geometry: {
          type: 'Point',
          coordinates: [c.coords[0], c.coords[1]],
        },
      })),
    };
  }, [layers]);

  const syncProjectedLabels = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !geojson || !layers) return;
    const zoom = map.getZoom();
    const { width, height } = map.getCanvas().getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const next: ProjectedLabel[] = [];
    const inView = (x: number, y: number) =>
      x >= -40 && x <= width + 40 && y >= -20 && y <= height + 20;

    // Sea labels
    for (const s of SEA_LABELS) {
      const p = map.project(s.coords);
      if (inView(p.x, p.y)) {
        next.push({ key: s.key, text: s.text, x: p.x, y: p.y, kind: 'sea' });
      }
    }

    // Surrounding country labels
    for (const c of layers.contextCountries.features) {
      if (c.properties.iso === 'MMR' && zoom < 5.6) continue;
      const p = map.project([c.properties.labelPos[0], c.properties.labelPos[1]]);
      if (inView(p.x, p.y)) {
        next.push({
          key: `lbl_${c.properties.iso}`,
          text: c.properties.nameVi,
          x: p.x,
          y: p.y,
          kind: 'country',
        });
      }
    }

    // Cities
    if (showCities) {
      for (const city of layers.cities) {
        if (city.tier === 'STRATEGIC_TOWN' && zoom < 6.1) continue;
        if (city.tier === 'MAJOR' && zoom < 4.7) continue;
        const p = map.project([city.coords[0], city.coords[1]]);
        if (inView(p.x, p.y)) {
          next.push({
            key: `lbl_${city.id}`,
            text: city.name,
            x: p.x,
            y: p.y,
            kind:
              city.tier === 'CAPITAL'
                ? 'capital'
                : city.tier === 'MAJOR'
                  ? 'major-city'
                  : 'town',
          });
        }
      }
    }

    // Mountain peaks (shown in TERRAIN mode or when peaks/codes toggle enabled)
    if (layer === 'TERRAIN' || showPeaksAndCodes) {
      for (const pk of layers.peaks) {
        const p = map.project([pk.coords[0], pk.coords[1]]);
        if (inView(p.x, p.y)) {
          next.push({
            key: `pk_${pk.name}`,
            text: `▲ ${pk.name} ${pk.elevationMeters}m`,
            x: p.x,
            y: p.y - 11,
            kind: 'peak',
          });
        }
      }
    }

    // Region codes when toggled or zoomed in closely (with collision avoidance against cities & peaks)
    if (showPeaksAndCodes || zoom >= 6.6) {
      const occupied = next
        .filter((l) => l.kind === 'capital' || l.kind === 'major-city' || l.kind === 'peak')
        .map((l) => ({ x: l.x, y: l.y }));
      for (const f of geojson.features) {
        const p = map.project([f.properties.centroid[0], f.properties.centroid[1]]);
        if (!inView(p.x, p.y)) continue;
        const collides = occupied.some(
          (o) => Math.abs(o.x - p.x) < 28 && Math.abs(o.y - p.y) < 15
        );
        if (!collides) {
          next.push({
            key: `code_${f.properties.regionId}`,
            text: f.properties.code,
            x: p.x,
            y: p.y,
            kind: 'code',
          });
        }
      }
    }

    setProjectedLabels(next);
  }, [geojson, layers, layer, showCities, showPeaksAndCodes]);

  // Initialize MapLibre GL once when geojson + layers are available
  useEffect(() => {
    if (!geojson || !layers || renderMode !== 'maplibre' || !mapContainerRef.current) {
      return;
    }

    if (!checkWebGlAvailable()) {
      setRenderMode('svg-fallback');
      setFallbackReason('Thiết bị không hỗ trợ WebGL; đã tự động chuyển sang bản đồ vector SVG.');
      return;
    }

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
              paint: { 'background-color': '#C3D3DB' },
            },
          ],
        },
        bounds: VIETNAM_THEATER_BOUNDS,
        fitBoundsOptions: { padding: { top: 24, bottom: 24, left: 26, right: 26 } },
        minZoom: 3.8,
        maxZoom: 9.5,
        maxBounds: [
          [99.15, 7.35],
          [113.35, 24.45],
        ],
        attributionControl: false,
      });
    } catch {
      setRenderMode('svg-fallback');
      setFallbackReason('Không khởi tạo được MapLibre WebGL; đang dùng bản đồ vector dự phòng.');
      return;
    }

    mapInstanceRef.current = map;

    map.on('error', () => {
      if (!mapReady) {
        setRenderMode('svg-fallback');
        setFallbackReason('Lỗi đồ họa WebGL; đã chuyển sang bản đồ vector dự phòng.');
      }
    });

    map.on('load', () => {
      if (!enrichedGeoJson) return;

      // 1. Graticule
      map.addSource('vdn-graticule', { type: 'geojson', data: GRATICULE_GEOJSON });
      map.addLayer({
        id: 'vdn-graticule-lines',
        type: 'line',
        source: 'vdn-graticule',
        paint: {
          'line-color': '#A5B8C2',
          'line-width': 0.7,
          'line-opacity': 0.55,
        },
      });

      // 2. Neighboring Context Countries (Natural Earth 1:10m Public Domain)
      map.addSource('vdn-context', {
        type: 'geojson',
        data: layers.contextCountries as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-context-fill',
        type: 'fill',
        source: 'vdn-context',
        paint: {
          'fill-color': '#DDD8CB',
          'fill-opacity': 0.96,
        },
      });
      map.addLayer({
        id: 'vdn-context-outline',
        type: 'line',
        source: 'vdn-context',
        paint: {
          'line-color': '#9E9685',
          'line-width': 1.0,
        },
      });

      // 3. Offshore Vietnam Islands (Phú Quốc, Côn Đảo, Cát Bà, etc.)
      map.addSource('vdn-islands', {
        type: 'geojson',
        data: layers.offshoreIslands as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-islands-fill',
        type: 'fill',
        source: 'vdn-islands',
        paint: {
          'fill-color': '#8DA399',
          'fill-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'vdn-islands-outline',
        type: 'line',
        source: 'vdn-islands',
        paint: {
          'line-color': '#4B555E',
          'line-width': 0.8,
        },
      });

      // 4. 72 Organic Vietnam Regions (Clipped to Real Natural Earth 1:10m Coastline)
      map.addSource('vdn-regions', {
        type: 'geojson',
        data: enrichedGeoJson as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-regions-coast-halo',
        type: 'line',
        source: 'vdn-regions',
        paint: {
          'line-color': '#D8E5EB',
          'line-width': 5.5,
          'line-opacity': 0.55,
        },
      });
      map.addLayer({
        id: 'vdn-regions-fill',
        type: 'fill',
        source: 'vdn-regions',
        paint: {
          'fill-color': ['get', 'fillColor'],
          'fill-opacity': 0.86,
        },
      });
      map.addLayer({
        id: 'vdn-regions-relief-tint',
        type: 'fill',
        source: 'vdn-regions',
        paint: {
          'fill-color': '#3A2E22',
          'fill-opacity': ['get', 'reliefOpacity'],
        },
      });
      map.addLayer({
        id: 'vdn-regions-outline',
        type: 'line',
        source: 'vdn-regions',
        paint: {
          'line-color': '#F3F0E6',
          'line-width': 0.9,
          'line-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'vdn-regions-selected',
        type: 'line',
        source: 'vdn-regions',
        filter: ['==', ['get', 'isSelected'], 1],
        paint: {
          'line-color': '#14181C',
          'line-width': 2.8,
        },
      });

      // 5. Real Natural Earth 1:10m & Regional Rivers
      map.addSource('vdn-rivers', {
        type: 'geojson',
        data: layers.rivers as unknown as GeoJsonData,
      });
      map.addLayer({
        id: 'vdn-rivers-minor',
        type: 'line',
        source: 'vdn-rivers',
        filter: ['==', ['get', 'major'], false],
        paint: {
          'line-color': '#5688B0',
          'line-width': 1.0,
          'line-opacity': 0.72,
        },
      });
      map.addLayer({
        id: 'vdn-rivers-major',
        type: 'line',
        source: 'vdn-rivers',
        filter: ['==', ['get', 'major'], true],
        paint: {
          'line-color': '#3E739E',
          'line-width': 1.85,
          'line-opacity': 0.85,
        },
      });

      // 6. Multi-Tier Vector Transport Network (1955 Abstract Corridors)
      map.addSource('vdn-transport', {
        type: 'geojson',
        data: transportGeoJson,
      });
      map.addLayer({
        id: 'vdn-transport-secondary',
        type: 'line',
        source: 'vdn-transport',
        filter: ['==', ['get', 'kind'], 'SECONDARY_ROAD'],
        paint: {
          'line-color': '#6F6152',
          'line-width': 1.15,
          'line-dasharray': [3, 2.5],
          'line-opacity': 0.78,
        },
      });
      map.addLayer({
        id: 'vdn-transport-primary',
        type: 'line',
        source: 'vdn-transport',
        filter: ['==', ['get', 'kind'], 'PRIMARY_ROAD'],
        paint: {
          'line-color': '#A85226',
          'line-width': 2.0,
          'line-opacity': 0.86,
        },
      });
      map.addLayer({
        id: 'vdn-transport-rail-base',
        type: 'line',
        source: 'vdn-transport',
        filter: ['==', ['get', 'kind'], 'RAILWAY'],
        paint: {
          'line-color': '#23282E',
          'line-width': 2.3,
          'line-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'vdn-transport-rail-ties',
        type: 'line',
        source: 'vdn-transport',
        filter: ['==', ['get', 'kind'], 'RAILWAY'],
        paint: {
          'line-color': '#F5F2E8',
          'line-width': 1.1,
          'line-dasharray': [2, 3],
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'vdn-transport-crossing',
        type: 'line',
        source: 'vdn-transport',
        filter: ['==', ['get', 'kind'], 'RIVER_CROSSING'],
        paint: {
          'line-color': '#187887',
          'line-width': 2.4,
          'line-dasharray': [1.5, 2],
          'line-opacity': 0.92,
        },
      });

      // 7. Real-Coordinate Major Cities
      map.addSource('vdn-cities', {
        type: 'geojson',
        data: citiesGeoJson,
      });
      map.addLayer({
        id: 'vdn-cities-towns',
        type: 'circle',
        source: 'vdn-cities',
        minzoom: 5.8,
        filter: ['==', ['get', 'tier'], 'STRATEGIC_TOWN'],
        paint: {
          'circle-radius': 2.8,
          'circle-color': '#F6F4EC',
          'circle-stroke-color': '#1D2228',
          'circle-stroke-width': 1.2,
        },
      });
      map.addLayer({
        id: 'vdn-cities-major',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'tier'], 'MAJOR'],
        paint: {
          'circle-radius': 4.0,
          'circle-color': '#F6F4EC',
          'circle-stroke-color': '#171B20',
          'circle-stroke-width': 1.8,
        },
      });
      map.addLayer({
        id: 'vdn-cities-capital-outer',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'tier'], 'CAPITAL'],
        paint: {
          'circle-radius': 7.0,
          'circle-color': '#D9A74A',
          'circle-stroke-color': '#171B20',
          'circle-stroke-width': 2.0,
        },
      });
      map.addLayer({
        id: 'vdn-cities-capital-inner',
        type: 'circle',
        source: 'vdn-cities',
        filter: ['==', ['get', 'tier'], 'CAPITAL'],
        paint: {
          'circle-radius': 2.8,
          'circle-color': '#171B20',
        },
      });

      map.on('click', 'vdn-regions-fill', (e: maplibregl.MapLayerMouseEvent) => {
        const hit = e.features?.[0];
        const rId = hit?.properties?.regionId;
        if (typeof rId === 'string') {
          setSelectedRegionId(rId);
        }
      });

      map.on('click', 'vdn-cities-major', (e: maplibregl.MapLayerMouseEvent) => {
        const rId = e.features?.[0]?.properties?.regionId;
        if (typeof rId === 'string') setSelectedRegionId(rId);
      });

      map.on('mouseenter', 'vdn-regions-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'vdn-regions-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      setMapReady(true);
    });

    return () => {
      setMapReady(false);
      map.remove();
      mapInstanceRef.current = null;
    };
    // Initialize MapLibre once per dataset load or renderer mode switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(geojson && layers), renderMode]);

  // Keep GeoJSON fill/selection and overlay visibility in sync without recreating MapLibre
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !enrichedGeoJson) return;
    const src = map.getSource('vdn-regions') as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(enrichedGeoJson as unknown as GeoJsonData);
    }

    const setVis = (id: string, visible: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };
    setVis('vdn-rivers-minor', showRivers);
    setVis('vdn-rivers-major', showRivers);
    setVis('vdn-transport-secondary', showTransport);
    setVis('vdn-transport-primary', showTransport);
    setVis('vdn-transport-rail-base', showTransport);
    setVis('vdn-transport-rail-ties', showTransport);
    setVis('vdn-transport-crossing', showTransport);
    setVis('vdn-cities-towns', showCities);
    setVis('vdn-cities-major', showCities);
    setVis('vdn-cities-capital-outer', showCities);
    setVis('vdn-cities-capital-inner', showCities);
  }, [enrichedGeoJson, mapReady, showRivers, showTransport, showCities]);

  // Trigger resize when inspector drawer opens/closes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const id = window.setTimeout(() => {
      map.resize();
      syncProjectedLabels();
    }, 60);
    return () => window.clearTimeout(id);
  }, [inspectorOpen, mapReady, syncProjectedLabels]);

  // Keep projected HTML labels locked cleanly to MapLibre camera
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    syncProjectedLabels();
    const onMove = () => syncProjectedLabels();
    map.on('move', onMove);
    map.on('resize', onMove);
    return () => {
      map.off('move', onMove);
      map.off('resize', onMove);
    };
  }, [mapReady, syncProjectedLabels]);

  const handleZoomIn = () => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn({ duration: 220 });
    } else {
      setSvgZoom((z) => Math.min(3.5, Number((z + 0.35).toFixed(2))));
    }
  };

  const handleZoomOut = () => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut({ duration: 220 });
    } else {
      setSvgZoom((z) => Math.max(0.85, Number((z - 0.35).toFixed(2))));
    }
  };

  const handleResetView = () => {
    if (renderMode === 'maplibre' && mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds(VIETNAM_THEATER_BOUNDS, {
        padding: { top: 24, bottom: 24, left: 26, right: 26 },
        duration: 350,
      });
    } else {
      setSvgZoom(1.08);
      setSvgPan({ x: 0, y: 0 });
    }
  };

  const focusRegion = (regionId: string) => {
    setSelectedRegionId(regionId);
    const feat = featuresById.get(regionId);
    if (feat && renderMode === 'maplibre' && mapInstanceRef.current) {
      const currentZoom = mapInstanceRef.current.getZoom();
      mapInstanceRef.current.flyTo({
        center: [feat.properties.centroid[0], feat.properties.centroid[1]],
        zoom: Math.max(currentZoom, 6.2),
        duration: 380,
      });
    }
  };

  const selectedFeature =
    featuresById.get(selectedRegionId) ?? geojson?.features[0] ?? null;
  const selectedLiveRegion = selectedFeature
    ? match?.regions[selectedFeature.properties.regionId] ?? null
    : null;
  const selectedControllerId =
    selectedLiveRegion?.controllerNationId ??
    selectedFeature?.properties.initialControllerNationId ??
    '';

  const unitsInSelectedRegion = useMemo(() => {
    if (!match || !selectedFeature) return [];
    return Object.values(match.units).filter(
      (u) => u.regionId === selectedFeature.properties.regionId
    );
  }, [match, selectedFeature]);

  const citiesInSelectedRegion = useMemo(() => {
    if (!layers || !selectedFeature) return [];
    return layers.cities.filter((c) => c.regionId === selectedFeature.properties.regionId);
  }, [layers, selectedFeature]);

  const corridorsForSelectedRegion = useMemo((): readonly TransportCorridor[] => {
    if (!layers || !selectedFeature) return [];
    const id = selectedFeature.properties.regionId;
    return layers.transportCorridors.filter(
      (t) => t.fromRegionId === id || t.toRegionId === id
    );
  }, [layers, selectedFeature]);

  const legendItems = buildLegendItems(layer);

  // Equirectangular projection for full-fidelity SVG Fallback [99.0..113.5 lon, 7.6..24.4 lat] -> 640x760
  const projectSvg = (lon: number, lat: number): [number, number] => {
    const x = ((lon - 99.0) / (113.5 - 99.0)) * 640;
    const y = ((24.4 - lat) / (24.4 - 7.6)) * 760;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  };

  const ringToSvgPoints = (ring: readonly [number, number][]) =>
    ring.map(([lon, lat]) => projectSvg(lon, lat).join(',')).join(' ');

  return (
    <section
      aria-label="Bản đồ chiến lược địa lý 72 vùng"
      className="border border-[#CFCBC0] bg-[#FFFFFF] shadow-xs"
    >
      {/* Top Cartographic Command Bar */}
      <div className="flex flex-col gap-3 border-b border-[#E2DFD5] bg-[#FAFAF6] px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#2B4C3F]">
            <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Bản đồ Địa lý Chiến lược · {geojson ? `${geojson.features.length} vùng hữu cơ` : 'Đang tải...'} ·{' '}
              {renderMode === 'maplibre' ? 'MapLibre GL WebGL' : 'SVG Vector Dự phòng'}
            </span>
          </div>
          <h2 className="mt-0.5 text-base font-bold tracking-tight text-[#171B20] sm:text-lg">
            Bản đồ Chiến trường Đông Dương &amp; 72 Vùng Việt Nam (1955 Hư cấu)
          </h2>
        </div>

        {/* 4 Active Layers + Future Roadmap Slots */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Chế độ lớp bản đồ"
            className="flex flex-wrap items-center gap-1"
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
                  onClick={() => setLayer(desc.id)}
                  className={`border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-[#171B20] bg-[#171B20] text-[#FFFFFF]'
                      : 'border-[#D5D1C6] bg-[#FFFFFF] text-[#171B20] hover:bg-[#EFECE3]'
                  }`}
                >
                  {desc.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            aria-label={inspectorOpen ? 'Thu gọn bảng chi tiết vùng' : 'Mở bảng chi tiết vùng'}
            className="hidden items-center gap-1.5 border border-[#D5D1C6] bg-[#FFFFFF] px-2.5 py-1.5 text-xs font-medium text-[#171B20] hover:bg-[#EFECE3] lg:inline-flex"
          >
            {inspectorOpen ? (
              <>
                <PanelRightClose className="h-3.5 w-3.5" />
                <span>Mở rộng bản đồ</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="h-3.5 w-3.5" />
                <span>Bảng vùng</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cartographic Overlay Toggles & Future Layer Architecture Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6E3DA] bg-[#F5F3EC] px-4 py-2 text-xs sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[#545B66]">Lớp địa lý:</span>
          <button
            type="button"
            data-testid="toggle-overlay-cities"
            onClick={() => setShowCities((v) => !v)}
            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-medium ${
              showCities
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D5D1C6] bg-[#FFFFFF] text-[#545B66]'
            }`}
          >
            <MapPin className="h-3 w-3" />
            <span>Thành phố ({layers?.cities.length ?? 0})</span>
          </button>
          <button
            type="button"
            data-testid="toggle-overlay-transport"
            onClick={() => setShowTransport((v) => !v)}
            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-medium ${
              showTransport
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D5D1C6] bg-[#FFFFFF] text-[#545B66]'
            }`}
          >
            <Route className="h-3 w-3" />
            <span>Giao thông ({layers?.transportCorridors.length ?? 0})</span>
          </button>
          <button
            type="button"
            data-testid="toggle-overlay-rivers"
            onClick={() => setShowRivers((v) => !v)}
            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-medium ${
              showRivers
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D5D1C6] bg-[#FFFFFF] text-[#545B66]'
            }`}
          >
            <Waves className="h-3 w-3" />
            <span>Sông ngòi</span>
          </button>
          <button
            type="button"
            data-testid="toggle-overlay-peaks"
            onClick={() => setShowPeaksAndCodes((v) => !v)}
            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-medium ${
              showPeaksAndCodes
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D5D1C6] bg-[#FFFFFF] text-[#545B66]'
            }`}
          >
            <Mountain className="h-3 w-3" />
            <span>Đỉnh núi &amp; Mã vùng</span>
          </button>
        </div>

        <div className="hidden items-center gap-1.5 text-[11px] text-[#6E7681] xl:flex">
          <span>Kiến trúc sẵn sàng mở rộng:</span>
          {PLANNED_FUTURE_MAP_LAYERS.map((fl) => (
            <span
              key={fl.id}
              className="border border-dashed border-[#C9C4B7] bg-[#FAF9F5] px-1.5 py-0.5 text-[10px] text-[#6E7681]"
            >
              {fl.label}
            </span>
          ))}
        </div>
      </div>

      {/* Main Dominant Map Viewport + Dockable Region Inspector */}
      <div
        className={`grid grid-cols-1 ${
          inspectorOpen ? 'lg:grid-cols-[1fr_348px]' : 'lg:grid-cols-1'
        }`}
      >
        {/* Left: Dominant Strategic Map Stage */}
        <div
          className={`flex flex-col border-b border-[#E2DFD5] bg-[#C3D3DB] ${
            inspectorOpen ? 'lg:border-r lg:border-b-0' : 'lg:border-b-0'
          }`}
        >
          <div className="relative flex-1 overflow-hidden">
            {loading && (
              <div className="flex h-[520px] items-center justify-center text-sm text-[#2E3C46] sm:h-[640px] lg:h-[74vh] lg:min-h-[620px]">
                Đang tải bản đồ địa lý Natural Earth 1:10m &amp; độ cao NASA SRTM 90m...
              </div>
            )}

            {!loading && error && (
              <div className="flex h-[520px] flex-col items-center justify-center gap-2 p-6 text-center sm:h-[640px] lg:h-[74vh]">
                <ShieldAlert className="h-6 w-6 text-[#9A3B26]" aria-hidden="true" />
                <p className="text-sm font-medium text-[#9A3B26]">{error}</p>
              </div>
            )}

            {!loading && !error && geojson && layers && (
              <>
                {renderMode === 'maplibre' ? (
                  <div className="relative h-[520px] w-full sm:h-[640px] lg:h-[74vh] lg:min-h-[620px]">
                    <div
                      ref={mapContainerRef}
                      data-testid="maplibre-canvas"
                      className="h-full w-full"
                    />
                    {/* Synchronized Crisp Vietnamese Cartographic Labels */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
                    >
                      {projectedLabels.map((lbl) => {
                        if (lbl.kind === 'sea') {
                          return (
                            <span
                              key={lbl.key}
                              style={{ left: lbl.x, top: lbl.y }}
                              className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-semibold tracking-[0.26em] text-[#4C6B7C]/85 italic whitespace-nowrap"
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
                              className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold tracking-[0.18em] text-[#6B6456]/90 whitespace-nowrap"
                            >
                              {lbl.text}
                            </span>
                          );
                        }
                        if (lbl.kind === 'capital') {
                          return (
                            <span
                              key={lbl.key}
                              style={{ left: lbl.x + 10, top: lbl.y - 2 }}
                              className="absolute -translate-y-1/2 bg-[#F8F6EE]/88 px-1.5 py-0.5 text-[11px] font-bold tracking-tight text-[#14181C] shadow-xs whitespace-nowrap"
                            >
                              {lbl.text}
                            </span>
                          );
                        }
                        if (lbl.kind === 'major-city') {
                          return (
                            <span
                              key={lbl.key}
                              style={{ left: lbl.x + 7, top: lbl.y - 1 }}
                              className="absolute -translate-y-1/2 text-[10px] font-semibold text-[#171B20] [text-shadow:0_0_3px_#F6F4EC,0_0_5px_#F6F4EC] whitespace-nowrap"
                            >
                              {lbl.text}
                            </span>
                          );
                        }
                        if (lbl.kind === 'town') {
                          return (
                            <span
                              key={lbl.key}
                              style={{ left: lbl.x + 6, top: lbl.y - 1 }}
                              className="absolute -translate-y-1/2 text-[9px] font-medium text-[#2A3036] [text-shadow:0_0_3px_#F6F4EC] whitespace-nowrap"
                            >
                              {lbl.text}
                            </span>
                          );
                        }
                        if (lbl.kind === 'peak') {
                          return (
                            <span
                              key={lbl.key}
                              style={{ left: lbl.x, top: lbl.y }}
                              className="absolute -translate-x-1/2 -translate-y-1/2 border border-[#C9BFA9] bg-[#F8F5EC]/92 px-1 py-0.5 text-[9px] font-semibold text-[#3B2A1A] shadow-xs whitespace-nowrap"
                            >
                              {lbl.text}
                            </span>
                          );
                        }
                        return (
                          <span
                            key={lbl.key}
                            style={{ left: lbl.x, top: lbl.y }}
                            className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[9px] font-semibold text-[#171B20]/85 [text-shadow:0_0_3px_#FFFFFF,0_0_5px_#FFFFFF] whitespace-nowrap"
                          >
                            {lbl.text}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Full-Fidelity SVG Vector Fallback with Real Natural Earth Coastlines, Rivers, Transport & Cities */
                  <div
                    data-testid="svg-fallback-map"
                    className="h-[520px] w-full overflow-hidden select-none touch-none sm:h-[640px] lg:h-[74vh] lg:min-h-[620px]"
                    onPointerDown={(e) => {
                      dragOriginRef.current = {
                        x: e.clientX,
                        y: e.clientY,
                        panX: svgPan.x,
                        panY: svgPan.y,
                      };
                    }}
                    onPointerMove={(e) => {
                      if (!dragOriginRef.current) return;
                      const dx = e.clientX - dragOriginRef.current.x;
                      const dy = e.clientY - dragOriginRef.current.y;
                      setSvgPan({
                        x: dragOriginRef.current.panX + dx,
                        y: dragOriginRef.current.panY + dy,
                      });
                    }}
                    onPointerUp={() => {
                      dragOriginRef.current = null;
                    }}
                    onPointerLeave={() => {
                      dragOriginRef.current = null;
                    }}
                  >
                    <svg
                      viewBox="0 0 640 760"
                      className="h-full w-full cursor-grab active:cursor-grabbing"
                      role="img"
                      aria-label="Bản đồ vector địa lý 72 vùng dự phòng"
                    >
                      <rect x="0" y="0" width="640" height="760" fill="#C3D3DB" />
                      <g
                        transform={`translate(${320 + svgPan.x}, ${380 + svgPan.y}) scale(${svgZoom}) translate(-320, -380)`}
                      >
                        {/* Surrounding Context Countries (Natural Earth 1:10m) */}
                        {layers.contextCountries.features.map((country) =>
                          country.geometry.coordinates.map((poly, pIdx) => (
                            <polygon
                              key={`${country.id}_${pIdx}`}
                              points={ringToSvgPoints(poly[0])}
                              fill="#DDD8CB"
                              stroke="#9E9685"
                              strokeWidth={0.9}
                            />
                          ))
                        )}

                        {/* Offshore Vietnam Islands */}
                        {layers.offshoreIslands.features.map((isl) => (
                          <polygon
                            key={isl.id}
                            points={ringToSvgPoints(isl.geometry.coordinates[0])}
                            fill="#8DA399"
                            stroke="#4B555E"
                            strokeWidth={0.7}
                          />
                        ))}

                        {/* 72 Organic Vietnam Regions */}
                        {geojson.features.map((f) => {
                          const isSel = f.properties.regionId === selectedRegionId;
                          return (
                            <polygon
                              key={f.properties.regionId}
                              data-region-id={f.properties.regionId}
                              points={ringToSvgPoints(f.geometry.coordinates[0])}
                              fill={computeRegionFillColor(f, layer, match)}
                              fillOpacity={0.88}
                              stroke={isSel ? '#14181C' : '#F3F0E6'}
                              strokeWidth={isSel ? 2.1 : 0.75}
                              className="cursor-pointer"
                              onClick={() => setSelectedRegionId(f.properties.regionId)}
                            >
                              <title>{`${f.properties.code} · ${f.properties.name} (${f.properties.elevationMeters}m)`}</title>
                            </polygon>
                          );
                        })}

                        {/* Rivers */}
                        {showRivers &&
                          layers.rivers.features.map((rv) => (
                            <polyline
                              key={rv.id}
                              points={ringToSvgPoints(rv.geometry.coordinates)}
                              fill="none"
                              stroke={rv.properties.major ? '#3E739E' : '#5B8BB2'}
                              strokeWidth={rv.properties.major ? 1.5 : 0.85}
                              strokeOpacity={0.82}
                              pointerEvents="none"
                            />
                          ))}

                        {/* Multi-tier Transport Corridors */}
                        {showTransport &&
                          layers.transportCorridors.map((t) => {
                            const stroke =
                              t.kind === 'RAILWAY'
                                ? '#23282E'
                                : t.kind === 'PRIMARY_ROAD'
                                  ? '#A85226'
                                  : t.kind === 'RIVER_CROSSING'
                                    ? '#187887'
                                    : '#6F6152';
                            const dash =
                              t.kind === 'RAILWAY'
                                ? '4,3'
                                : t.kind === 'SECONDARY_ROAD'
                                  ? '3,2.5'
                                  : t.kind === 'RIVER_CROSSING'
                                    ? '1.5,2'
                                    : undefined;
                            return (
                              <polyline
                                key={t.id}
                                points={ringToSvgPoints(t.coordinates)}
                                fill="none"
                                stroke={stroke}
                                strokeWidth={t.kind === 'PRIMARY_ROAD' || t.kind === 'RAILWAY' ? 1.6 : 1.0}
                                strokeDasharray={dash}
                                pointerEvents="none"
                              />
                            );
                          })}

                        {/* Sea & Country Labels */}
                        {SEA_LABELS.map((s) => {
                          const [x, y] = projectSvg(s.coords[0], s.coords[1]);
                          return (
                            <text
                              key={s.key}
                              x={x}
                              y={y}
                              textAnchor="middle"
                              fill="#4C6B7C"
                              fontSize="10"
                              fontStyle="italic"
                              letterSpacing="2.4"
                              pointerEvents="none"
                            >
                              {s.text}
                            </text>
                          );
                        })}

                        {layers.contextCountries.features.map((c) => {
                          if (c.properties.iso === 'MMR') return null;
                          const [x, y] = projectSvg(c.properties.labelPos[0], c.properties.labelPos[1]);
                          return (
                            <text
                              key={`svg_lbl_${c.id}`}
                              x={x}
                              y={y}
                              textAnchor="middle"
                              fill="#6B6456"
                              fontSize="10"
                              fontWeight="700"
                              letterSpacing="1.6"
                              pointerEvents="none"
                            >
                              {c.properties.nameVi}
                            </text>
                          );
                        })}

                        {/* Cities */}
                        {showCities &&
                          layers.cities
                            .filter((c) => c.tier !== 'STRATEGIC_TOWN' || svgZoom >= 1.6)
                            .map((c) => {
                              const [x, y] = projectSvg(c.coords[0], c.coords[1]);
                              const isCap = c.tier === 'CAPITAL';
                              return (
                                <g
                                  key={`svg_cty_${c.id}`}
                                  className="cursor-pointer"
                                  onClick={() => setSelectedRegionId(c.regionId)}
                                >
                                  <circle
                                    cx={x}
                                    cy={y}
                                    r={isCap ? 4.8 : 2.8}
                                    fill={isCap ? '#D9A74A' : '#F6F4EC'}
                                    stroke="#171B20"
                                    strokeWidth={isCap ? 1.5 : 1.1}
                                  />
                                  <text
                                    x={x + 6}
                                    y={y + 3}
                                    fill="#171B20"
                                    fontSize={isCap ? '10' : '8.5'}
                                    fontWeight={isCap ? '700' : '600'}
                                    stroke="#F6F4EC"
                                    strokeWidth="2"
                                    paintOrder="stroke"
                                  >
                                    {c.name}
                                  </text>
                                </g>
                              );
                            })}
                      </g>
                    </svg>
                  </div>
                )}

                {/* Compact Zoom Controls (Top Right, Zero Overlap) */}
                <div className="pointer-events-auto absolute top-3 right-3 z-10 flex flex-col gap-1 border border-[#CFCBC0] bg-[#FFFFFF]/95 p-1 shadow-xs">
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    aria-label="Phóng to bản đồ"
                    className="flex h-8 w-8 items-center justify-center text-[#171B20] hover:bg-[#F3F0E6]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    aria-label="Thu nhỏ bản đồ"
                    className="flex h-8 w-8 items-center justify-center border-t border-[#E6E3DA] text-[#171B20] hover:bg-[#F3F0E6]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleResetView}
                    aria-label="Đặt lại góc nhìn"
                    className="flex h-8 w-8 items-center justify-center border-t border-[#E6E3DA] text-[#171B20] hover:bg-[#F3F0E6]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Dedicated Non-Overlapping Legend, Transport Key & Renderer Switch Bar */}
          {!loading && !error && geojson && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#D5D1C6] bg-[#FFFFFF] px-4 py-2.5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#545B66]">
                    {ACTIVE_MAP_LAYERS.find((l) => l.id === layer)?.label}:
                  </span>
                  {legendItems.map((item) => (
                    <span
                      key={item.label}
                      className="inline-flex items-center gap-1.5 text-xs text-[#171B20]"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 border border-[#171B20]/25"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                </div>

                {showTransport && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#545B66]">
                    <span className="font-semibold">Giao thông (hư cấu 1955):</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 bg-[#A85226]" />
                      Đường chính
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 border-t border-dashed border-[#6F6152]" />
                      Đường phụ
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#23282E]" />
                      Đường sắt
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dotted border-[#187887]" />
                      Vượt sông
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {fallbackReason && renderMode === 'svg-fallback' && (
                  <span className="border border-[#D9C7A3] bg-[#FDF8EC] px-2 py-1 text-[11px] text-[#7A541E]">
                    {fallbackReason}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="toggle-map-renderer"
                  onClick={() =>
                    setRenderMode((m) => (m === 'maplibre' ? 'svg-fallback' : 'maplibre'))
                  }
                  className="border border-[#D5D1C6] bg-[#F5F3EC] px-2.5 py-1 text-[11px] font-medium text-[#171B20] hover:bg-[#EAE6DA]"
                >
                  {renderMode === 'maplibre' ? 'Chuyển sang SVG dự phòng' : 'Dùng MapLibre GL'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right (Desktop) / Bottom (Mobile): Contextual Region Intelligence Panel */}
        {inspectorOpen && (
          <aside
            aria-label="Thông tin chi tiết vùng chọn"
            data-testid="region-info-panel"
            className="flex flex-col justify-between bg-[#FAFAF6] p-4 sm:p-5"
          >
            {selectedFeature ? (
              <div className="space-y-4">
                <div className="border-b border-[#E2DFD5] pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-[#2B4C3F]">
                      {selectedFeature.properties.code} · {selectedFeature.properties.regionId}
                    </span>
                    <span className="font-mono text-[11px] text-[#545B66] tabular-nums">
                      {selectedFeature.properties.centroid[1].toFixed(2)}°N,{' '}
                      {selectedFeature.properties.centroid[0].toFixed(2)}°E
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-[#171B20]">
                    {selectedFeature.properties.name}
                  </h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[#545B66]">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-[#2B4C3F]" aria-hidden="true" />
                    <span>
                      Kiểm soát:{' '}
                      <strong className="font-semibold text-[#171B20]">
                        {NATION_LABELS[selectedControllerId] ?? selectedControllerId}
                      </strong>
                    </span>
                  </p>
                  {selectedFeature.properties.terrainFeatures.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selectedFeature.properties.terrainFeatures.map((tag) => (
                        <span
                          key={tag}
                          className="border border-[#DBD7CB] bg-[#FFFFFF] px-1.5 py-0.5 text-[10px] font-medium text-[#4A525A]"
                        >
                          {TERRAIN_FEATURE_LABELS[tag]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Core Region Terrain, Verified SRTM Elevation & Movement-Ready Metrics */}
                <dl className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-2.5">
                    <dt className="text-[#545B66]">Loại địa hình</dt>
                    <dd className="mt-0.5 font-semibold text-[#171B20]">
                      {TERRAIN_LABELS[selectedFeature.properties.terrain]}
                    </dd>
                  </div>
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-2.5">
                    <dt className="text-[#545B66]">Độ cao (SRTM 90m)</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#171B20] tabular-nums">
                      TB {selectedFeature.properties.elevationMeters}m · Đỉnh{' '}
                      {selectedFeature.properties.elevationPeakMeters}m
                    </dd>
                  </div>
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-2.5">
                    <dt className="text-[#545B66]">Chi phí di chuyển</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#2B4C3F] tabular-nums">
                      x{fpFormat(selectedFeature.properties.movementCostFp)}
                    </dd>
                  </div>
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-2.5">
                    <dt className="text-[#545B66]">Sản lượng kinh tế</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#171B20] tabular-nums">
                      {fpFormat(selectedFeature.properties.economicOutputFp)}
                    </dd>
                  </div>
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-2.5">
                    <dt className="text-[#545B66]">Hạ tầng (trừu tượng)</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#171B20] tabular-nums">
                      {fpFormat(
                        selectedLiveRegion?.infrastructureFp ??
                          selectedFeature.properties.infrastructureFp
                      )}
                    </dd>
                  </div>
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-2.5">
                    <dt className="text-[#545B66]">Năng lực hậu cần</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[#171B20] tabular-nums">
                      {fpFormat(
                        selectedLiveRegion?.supplyCapacityFp ??
                          selectedFeature.properties.supplyCapacityFp
                      )}
                    </dd>
                  </div>
                </dl>

                {/* Cities inside this Region */}
                {citiesInSelectedRegion.length > 0 && (
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-3 text-xs">
                    <p className="font-semibold text-[#171B20]">
                      Thành phố / Đô thị trong vùng ({citiesInSelectedRegion.length})
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {citiesInSelectedRegion.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#171B20]">
                            {c.name}
                            {c.port ? ' (Cảng)' : ''}
                          </span>
                          <span className="font-mono text-[11px] text-[#545B66] tabular-nums">
                            {c.elevationMeters}m SRTM
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Transport Corridors (Prepared for Future Movement Engine) */}
                {corridorsForSelectedRegion.length > 0 && (
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-3 text-xs">
                    <p className="flex items-center gap-1.5 font-semibold text-[#171B20]">
                      <Route className="h-3.5 w-3.5 text-[#2B4C3F]" />
                      <span>Tuyến giao thông nối vùng ({corridorsForSelectedRegion.length})</span>
                    </p>
                    <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto text-[11px]">
                      {corridorsForSelectedRegion.map((t) => {
                        const targetId =
                          t.fromRegionId === selectedFeature.properties.regionId
                            ? t.toRegionId
                            : t.fromRegionId;
                        const target = featuresById.get(targetId);
                        return (
                          <li
                            key={t.id}
                            className="flex items-center justify-between gap-2 border-t border-[#F0EDE5] pt-1 first:border-t-0 first:pt-0"
                          >
                            <button
                              type="button"
                              onClick={() => focusRegion(targetId)}
                              className="truncate text-left text-[#171B20] hover:text-[#2B4C3F] hover:underline"
                            >
                              → {target ? `${target.properties.code}` : targetId} ·{' '}
                              {TRANSPORT_LABELS[t.kind]}
                            </button>
                            <span className="shrink-0 font-mono text-[#545B66] tabular-nums">
                              x{fpFormat(t.movementModifierFp)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Stationed Units (Preserves P02-04 Fog-of-War Redaction) */}
                {match && (
                  <div className="border border-[#E6E3DA] bg-[#FFFFFF] p-3">
                    <p className="text-xs font-semibold text-[#171B20]">
                      Đơn vị tại vùng ({unitsInSelectedRegion.length})
                    </p>
                    {unitsInSelectedRegion.length === 0 ? (
                      <p className="mt-1 text-xs text-[#6E7681]">Không có đơn vị đồn trú.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {unitsInSelectedRegion.map((u) => {
                          const redacted = match.redactedUnitIds.includes(u.unitId);
                          return (
                            <li
                              key={u.unitId}
                              className="border-t border-[#F0EDE5] pt-1.5 text-xs first:border-t-0 first:pt-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-medium text-[#171B20]">
                                  {u.unitId}
                                </span>
                                <span className="text-[11px] text-[#545B66]">{u.category}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between text-[11px] text-[#545B66]">
                                <span>Sức mạnh: {fpFormat(u.strengthFp)}</span>
                                {redacted ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-[#7A541E]">
                                    <EyeOff className="h-3 w-3" />
                                    Sẵn sàng/Hậu cần: Ẩn
                                  </span>
                                ) : (
                                  <span className="font-mono tabular-nums">
                                    SS: {fpFormat(u.readinessFp)} · HC: {fpFormat(u.supplyFp)}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {/* Adjacent Regions */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[#171B20]">
                    <Compass className="h-3.5 w-3.5 text-[#2B4C3F]" aria-hidden="true" />
                    <span>
                      Vùng tiếp giáp ({selectedFeature.properties.adjacentRegionIds.length})
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {selectedFeature.properties.adjacentRegionIds.map((adjId) => {
                      const adjFeat = featuresById.get(adjId);
                      return (
                        <button
                          key={adjId}
                          type="button"
                          onClick={() => focusRegion(adjId)}
                          className="border border-[#D5D1C6] bg-[#FFFFFF] px-2 py-1 font-mono text-[11px] text-[#171B20] hover:border-[#2B4C3F] hover:bg-[#EFECE3]"
                        >
                          {adjFeat ? `${adjFeat.properties.code}` : adjId}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Contextual Action when inside a Room */}
                {room && onScheduleRegionAction && (
                  <div className="border-t border-[#E2DFD5] pt-3">
                    <button
                      type="button"
                      data-testid="region-schedule-job-btn"
                      disabled={room.status !== 'ACTIVE' || actionBusy}
                      onClick={() => onScheduleRegionAction(selectedFeature.properties.regionId)}
                      className="w-full border border-[#2B4C3F] bg-[#2B4C3F] px-3 py-2 text-xs font-semibold text-[#FFFFFF] transition-colors hover:bg-[#223D33] disabled:cursor-not-allowed disabled:border-[#D5D1C6] disabled:bg-[#E6E3DA] disabled:text-[#6E7681]"
                    >
                      {actionBusy
                        ? 'Đang gửi lệnh tới server...'
                        : `Đặt lịch dự án hậu cần tại ${selectedFeature.properties.code} (10 công nghiệp · 15 phút)`}
                    </button>
                    {room.status !== 'ACTIVE' && (
                      <p className="mt-1.5 text-[11px] text-[#6E7681]">
                        {room.status === 'LOBBY'
                          ? 'Cần đủ 2 người chơi Bắc/Nam xác nhận Sẵn sàng và Bắt đầu để mở lệnh.'
                          : 'Trận đấu đã kết thúc; không thể đặt thêm lệnh.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#545B66]">
                Chọn một vùng trên bản đồ để xem địa hình, độ cao SRTM, thành phố và tuyến giao thông.
              </p>
            )}

            {/* Explicit Provenance & Historical Separation Notice */}
            {geojson && (
              <div className="mt-5 border-t border-[#E2DFD5] pt-3 text-[11px] leading-relaxed text-[#6E7681]">
                <p className="font-semibold text-[#545B66]">
                  Nguồn dữ liệu &amp; Phân tách lịch sử ({geojson.metadata.version})
                </p>
                <ul className="mt-1 space-y-0.5">
                  <li>
                    <strong>Đường bờ biển &amp; lân cận:</strong> {geojson.metadata.coastlineSource}
                  </li>
                  <li>
                    <strong>Độ cao thực:</strong> {geojson.metadata.elevationSource}
                  </li>
                  <li>
                    <strong>Phân vùng &amp; giao thông:</strong> Hư cấu lịch sử thay thế 1955; không dùng địa giới hành chính hoặc đường cao tốc hiện đại làm dữ kiện lịch sử.
                  </li>
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
