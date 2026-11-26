import { useRef } from 'react';
import { ChevronDown, ChevronUp, Map as MapIcon } from 'lucide-react';
import { FilteredClientMatchView, MapLayerMode } from '../../contracts';
import { MAP_TOKENS } from '../map/designTokens';
import { computeRegionFillColor } from '../mapLayerRegistry';
import { WorldMapGeoJson, WorldMapLayers } from '../roomApi';

export interface MinimapViewportBounds {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

interface StrategicMinimapProps {
  readonly geojson: WorldMapGeoJson;
  readonly layers: WorldMapLayers;
  readonly layer: MapLayerMode;
  readonly match: FilteredClientMatchView | null;
  readonly selectedRegionId: string | null;
  readonly viewportBounds: MinimapViewportBounds | null;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onNavigateToCoords: (lon: number, lat: number) => void;
}

const MIN_LON = 99.0;
const MAX_LON = 113.5;
const MIN_LAT = 7.6;
const MAX_LAT = 24.4;
const VB_W = 180;
const VB_H = 210;

function project(lon: number, lat: number): [number, number] {
  const x = ((lon - MIN_LON) / (MAX_LON - MIN_LON)) * VB_W;
  const y = ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * VB_H;
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
}

function ringToPoints(ring: readonly [number, number][]): string {
  // Light decimation every 2nd vertex for ultra-fast minimap SVG
  const pts: string[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    pts.push(project(ring[i][0], ring[i][1]).join(','));
  }
  return pts.join(' ');
}

export function StrategicMinimap({
  geojson,
  layers,
  layer,
  match,
  selectedRegionId,
  viewportBounds,
  expanded,
  onToggleExpanded,
  onNavigateToCoords,
}: StrategicMinimapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const handlePointerNavigate = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const lon = MIN_LON + rx * (MAX_LON - MIN_LON);
    const lat = MAX_LAT - ry * (MAX_LAT - MIN_LAT);
    onNavigateToCoords(lon, lat);
  };

  let vpRect: { x: number; y: number; w: number; h: number } | null = null;
  if (viewportBounds) {
    const [x1, y1] = project(viewportBounds.west, viewportBounds.north);
    const [x2, y2] = project(viewportBounds.east, viewportBounds.south);
    const x = Math.max(1, Math.min(VB_W - 6, x1));
    const y = Math.max(1, Math.min(VB_H - 6, y1));
    const w = Math.max(8, Math.min(VB_W - x - 1, x2 - x1));
    const h = Math.max(8, Math.min(VB_H - y - 1, y2 - y1));
    vpRect = { x, y, w, h };
  }

  return (
    <div
      data-testid="strategic-minimap"
      className="pointer-events-auto hidden border border-[#2B3540] bg-[#12171D]/95 text-[#EFE9DC] shadow-xl md:block"
    >
      <button
        type="button"
        data-testid="minimap-toggle-btn"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 border-b border-[#252E38] px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-[#C6A15B] hover:bg-[#1B222A]"
      >
        <span className="inline-flex items-center gap-1.5">
          <MapIcon className="h-3 w-3" aria-hidden="true" />
          <span>Bản đồ thu nhỏ</span>
        </span>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="p-1.5">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="h-[188px] w-[160px] cursor-crosshair select-none touch-none border border-[#2B3540]"
            role="application"
            aria-label="Bản đồ thu nhỏ — nhấn để di chuyển camera nhanh"
            onPointerDown={(e) => {
              draggingRef.current = true;
              handlePointerNavigate(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) {
                handlePointerNavigate(e.clientX, e.clientY);
              }
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            onPointerLeave={() => {
              draggingRef.current = false;
            }}
          >
            <rect x="0" y="0" width={VB_W} height={VB_H} fill={MAP_TOKENS.water.deepOcean} />

            {/* Surrounding context countries */}
            {layers.contextCountries.features.map((country) =>
              country.geometry.coordinates.map((poly, idx) => (
                <polygon
                  key={`mm_${country.id}_${idx}`}
                  points={ringToPoints(poly[0])}
                  fill={MAP_TOKENS.context.landFill}
                  stroke={MAP_TOKENS.context.borderLine}
                  strokeWidth={0.4}
                />
              ))
            )}

            {/* 72 Regions */}
            {geojson.features.map((f) => {
              const isSel = f.properties.regionId === selectedRegionId;
              return (
                <polygon
                  key={`mm_${f.properties.regionId}`}
                  points={ringToPoints(f.geometry.coordinates[0])}
                  fill={computeRegionFillColor(f, layer, match)}
                  fillOpacity={0.9}
                  stroke={isSel ? MAP_TOKENS.boundaries.selectedOutline : '#1B222A'}
                  strokeWidth={isSel ? 1.2 : 0.25}
                />
              );
            })}

            {/* Current Camera Viewport Box */}
            {vpRect && (
              <rect
                x={vpRect.x}
                y={vpRect.y}
                width={vpRect.w}
                height={vpRect.h}
                fill="rgba(198, 161, 91, 0.14)"
                stroke="#F3D27A"
                strokeWidth={1.3}
                pointerEvents="none"
              />
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
