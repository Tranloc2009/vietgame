import { useMemo, useRef, useState } from 'react';
import { FilteredClientMatchView, MapLayerMode } from '../../contracts';
import { MAP_TOKENS } from '../map/designTokens';
import { EnrichedCity } from '../map/settlementCatalog';
import { PoliticalBordersGeoJson } from '../map/terrainRelief';
import { computeRegionFillColor, computeTerrainBaseColor } from '../mapLayerRegistry';
import { WorldMapGeoJson, WorldMapLayers } from '../roomApi';

interface SvgFallbackMapProps {
  readonly geojson: WorldMapGeoJson;
  readonly layers: WorldMapLayers;
  readonly layer: MapLayerMode;
  readonly match: FilteredClientMatchView | null;
  readonly selectedRegionId: string | null;
  readonly selectedCityId: string | null;
  readonly enrichedCities: readonly EnrichedCity[];
  readonly dynamicBorders: PoliticalBordersGeoJson;
  readonly showCities: boolean;
  readonly showTransport: boolean;
  readonly showRivers: boolean;
  readonly showPeaksAndCodes: boolean;
  readonly svgZoom: number;
  readonly svgPan: { readonly x: number; readonly y: number };
  readonly onChangeSvgZoom: (next: number) => void;
  readonly onChangeSvgPan: (next: { x: number; y: number }) => void;
  readonly onSelectRegion: (regionId: string) => void;
  readonly onSelectCity: (city: EnrichedCity) => void;
  readonly onClearSelection: () => void;
}

const SEA_LABELS: readonly { key: string; text: string; coords: readonly [number, number] }[] = [
  { key: 'sea_east', text: 'BIỂN ĐÔNG', coords: [111.1, 14.5] },
  { key: 'sea_tonkin', text: 'VỊNH BẮC BỘ', coords: [107.8, 19.7] },
  { key: 'sea_thailand', text: 'VỊNH THÁI LAN', coords: [102.4, 9.7] },
];

function projectSvg(lon: number, lat: number): [number, number] {
  const x = ((lon - 99.0) / (113.5 - 99.0)) * 640;
  const y = ((24.4 - lat) / (24.4 - 7.6)) * 760;
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
}

function ringToSvgPoints(ring: readonly (readonly [number, number])[]): string {
  return ring.map(([lon, lat]) => projectSvg(lon, lat).join(',')).join(' ');
}

export function SvgFallbackMap({
  geojson,
  layers,
  layer,
  match,
  selectedRegionId,
  selectedCityId,
  enrichedCities,
  dynamicBorders,
  showCities,
  showTransport,
  showRivers,
  showPeaksAndCodes,
  svgZoom,
  svgPan,
  onChangeSvgZoom,
  onChangeSvgPan,
  onSelectRegion,
  onSelectCity,
  onClearSelection,
}: SvgFallbackMapProps) {
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(
    null
  );
  const pinchDistRef = useRef<number | null>(null);

  const graticuleLines = useMemo(() => {
    const lines: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (let lon = 100; lon <= 114; lon += 2) {
      const [x1, y1] = projectSvg(lon, 24.4);
      const [x2, y2] = projectSvg(lon, 7.6);
      lines.push({ key: `lon_${lon}`, x1, y1, x2, y2 });
    }
    for (let lat = 8; lat <= 24; lat += 2) {
      const [x1, y1] = projectSvg(99.0, lat);
      const [x2, y2] = projectSvg(113.5, lat);
      lines.push({ key: `lat_${lat}`, x1, y1, x2, y2 });
    }
    return lines;
  }, []);

  return (
    <div
      data-testid="svg-fallback-map"
      className="h-full w-full overflow-hidden bg-[#1F3545] select-none touch-none"
      onWheel={(e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.22 : -0.22;
        onChangeSvgZoom(Math.max(0.85, Math.min(4.0, Number((svgZoom + delta).toFixed(2)))));
      }}
      onTouchStart={(e) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          pinchDistRef.current = Math.hypot(dx, dy);
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2 && pinchDistRef.current !== null) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const nextDist = Math.hypot(dx, dy);
          const ratio = nextDist / Math.max(1, pinchDistRef.current);
          pinchDistRef.current = nextDist;
          onChangeSvgZoom(Math.max(0.85, Math.min(4.0, Number((svgZoom * ratio).toFixed(2)))));
        }
      }}
      onTouchEnd={() => {
        pinchDistRef.current = null;
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: svgPan.x,
          panY: svgPan.y,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.x;
        const dy = e.clientY - dragRef.current.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          dragRef.current.moved = true;
        }
        onChangeSvgPan({
          x: Math.max(-360, Math.min(360, dragRef.current.panX + dx)),
          y: Math.max(-420, Math.min(420, dragRef.current.panY + dy)),
        });
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
    >
      <svg
        viewBox="0 0 640 760"
        className="h-full w-full cursor-grab active:cursor-grabbing"
        role="img"
        aria-label="Bản đồ vector địa lý 72 vùng dự phòng"
      >
        {/* Deep Strategic Ocean Backdrop */}
        <rect
          x="0"
          y="0"
          width="640"
          height="760"
          fill={MAP_TOKENS.water.deepOcean}
          onClick={() => {
            if (!dragRef.current?.moved) onClearSelection();
          }}
        />

        <g
          transform={`translate(${320 + svgPan.x}, ${380 + svgPan.y}) scale(${svgZoom}) translate(-320, -380)`}
        >
          {/* Graticule */}
          {graticuleLines.map((gl) => (
            <line
              key={gl.key}
              x1={gl.x1}
              y1={gl.y1}
              x2={gl.x2}
              y2={gl.y2}
              stroke={MAP_TOKENS.water.graticule}
              strokeWidth={0.5}
              strokeOpacity={0.55}
              pointerEvents="none"
            />
          ))}

          {/* Neighboring Indochina Context Countries */}
          {layers.contextCountries.features.map((country) =>
            country.geometry.coordinates.map((poly, pIdx) => (
              <polygon
                key={`${country.id}_${pIdx}`}
                points={ringToSvgPoints(poly[0])}
                fill={MAP_TOKENS.context.landFill}
                stroke={MAP_TOKENS.context.borderLine}
                strokeWidth={0.85}
                onClick={() => {
                  if (!dragRef.current?.moved) onClearSelection();
                }}
              />
            ))
          )}

          {/* Offshore Vietnam Islands */}
          {layers.offshoreIslands.features.map((isl) => (
            <polygon
              key={isl.id}
              points={ringToSvgPoints(isl.geometry.coordinates[0])}
              fill={MAP_TOKENS.terrain.islandFill}
              stroke={MAP_TOKENS.terrain.islandBorder}
              strokeWidth={0.7}
            />
          ))}

          {/* 72 Organic Vietnam Regions: Terrain base + Semi-transparent Political/Mode Overlay */}
          {geojson.features.map((f) => {
            const rId = f.properties.regionId;
            const isSel = rId === selectedRegionId;
            const isHov = rId === hoveredRegionId;
            const pts = ringToSvgPoints(f.geometry.coordinates[0]);
            const modeColor = computeRegionFillColor(f, layer, match);
            const terrainBase = computeTerrainBaseColor(f);

            return (
              <g key={rId}>
                {/* Terrain base layer underneath political tint */}
                <polygon
                  points={pts}
                  fill={terrainBase}
                  stroke={MAP_TOKENS.water.coastalEdgeHalo}
                  strokeWidth={2.2}
                  strokeOpacity={0.22}
                  pointerEvents="none"
                />
                {/* Interactive mode layer */}
                <polygon
                  data-region-id={rId}
                  points={pts}
                  fill={modeColor}
                  fillOpacity={layer === 'POLITICAL' ? 0.68 : 0.88}
                  stroke={
                    isSel
                      ? MAP_TOKENS.boundaries.selectedOutline
                      : isHov
                        ? MAP_TOKENS.boundaries.hoverOutline
                        : MAP_TOKENS.boundaries.internalRegion
                  }
                  strokeWidth={isSel ? 2.1 : isHov ? 1.2 : 0.55}
                  strokeOpacity={isSel ? 1 : isHov ? 0.95 : 0.45}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredRegionId(rId)}
                  onMouseLeave={() => setHoveredRegionId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRegion(rId);
                  }}
                >
                  <title>{`${f.properties.code} · ${f.properties.name} (${f.properties.elevationMeters}m)`}</title>
                </polygon>
              </g>
            );
          })}

          {/* Dynamic National Borders derived from authoritative state */}
          {dynamicBorders.features.map((seg, idx) => {
            const [x1, y1] = projectSvg(seg.geometry.coordinates[0][0], seg.geometry.coordinates[0][1]);
            const [x2, y2] = projectSvg(seg.geometry.coordinates[1][0], seg.geometry.coordinates[1][1]);
            const isNational = seg.properties.borderKind === 'NATIONAL_FACTION_BORDER';
            return (
              <g key={`nb_${idx}`} pointerEvents="none">
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={MAP_TOKENS.boundaries.nationalBorderCasing}
                  strokeWidth={isNational ? 3.2 : 2.1}
                  strokeLinecap="round"
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isNational ? MAP_TOKENS.boundaries.nationalBorderLine : '#B6A989'}
                  strokeWidth={isNational ? 1.4 : 0.95}
                  strokeDasharray={isNational ? undefined : '3,2'}
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {/* Rivers */}
          {showRivers &&
            layers.rivers.features.map((rv) => (
              <polyline
                key={rv.id}
                points={ringToSvgPoints(rv.geometry.coordinates)}
                fill="none"
                stroke={rv.properties.major ? MAP_TOKENS.water.riverMajor : MAP_TOKENS.water.riverMinor}
                strokeWidth={rv.properties.major ? 1.55 : 0.85}
                strokeOpacity={0.85}
                pointerEvents="none"
              />
            ))}

          {/* 4-Tier Transport Corridors */}
          {showTransport &&
            layers.transportCorridors.map((t) => {
              if (t.kind === 'SECONDARY_ROAD' && svgZoom < 1.35) return null;
              const pts = ringToSvgPoints(t.coordinates);
              if (t.kind === 'RAILWAY') {
                return (
                  <g key={t.id} pointerEvents="none">
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={MAP_TOKENS.transport.railwayBase}
                      strokeWidth={2.0}
                    />
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={MAP_TOKENS.transport.railwayTies}
                      strokeWidth={0.9}
                      strokeDasharray="2.5,3"
                    />
                  </g>
                );
              }
              return (
                <polyline
                  key={t.id}
                  points={pts}
                  fill="none"
                  stroke={
                    t.kind === 'PRIMARY_ROAD'
                      ? MAP_TOKENS.transport.primaryRoadLine
                      : t.kind === 'RIVER_CROSSING'
                        ? MAP_TOKENS.transport.riverCrossingLine
                        : MAP_TOKENS.transport.secondaryRoadLine
                  }
                  strokeWidth={t.kind === 'PRIMARY_ROAD' ? 1.45 : 1.0}
                  strokeDasharray={
                    t.kind === 'SECONDARY_ROAD'
                      ? '3,2'
                      : t.kind === 'RIVER_CROSSING'
                        ? '1.5,2'
                        : undefined
                  }
                  strokeOpacity={0.88}
                  pointerEvents="none"
                />
              );
            })}

          {/* Sea Labels */}
          {SEA_LABELS.map((s) => {
            const [x, y] = projectSvg(s.coords[0], s.coords[1]);
            return (
              <text
                key={s.key}
                x={x}
                y={y}
                textAnchor="middle"
                fill={MAP_TOKENS.water.seaLabel}
                fontSize={8.5}
                fontStyle="italic"
                letterSpacing={2.2}
                opacity={0.78}
                pointerEvents="none"
              >
                {s.text}
              </text>
            );
          })}

          {/* Context Country Labels */}
          {layers.contextCountries.features.map((c) => {
            const [x, y] = projectSvg(c.properties.labelPos[0], c.properties.labelPos[1]);
            return (
              <text
                key={`svg_ctx_${c.properties.iso}`}
                x={x}
                y={y}
                textAnchor="middle"
                fill={MAP_TOKENS.context.countryLabel}
                fontSize={8.5}
                fontWeight={600}
                letterSpacing={1.4}
                opacity={0.82}
                pointerEvents="none"
              >
                {c.properties.nameVi}
              </text>
            );
          })}

          {/* 24 Hierarchical Cities with Original SVG Icons */}
          {showCities &&
            enrichedCities.map((ec) => {
              if (ec.category === 'STRATEGIC_SETTLEMENT' && svgZoom < 1.35) return null;
              const [cx, cy] = projectSvg(ec.city.coords[0], ec.city.coords[1]);
              const isCitySel = ec.city.id === selectedCityId;
              const isCap = ec.category === 'NATIONAL_CAPITAL';
              const isPort = ec.category === 'PORT_CITY';
              return (
                <g
                  key={ec.city.id}
                  data-city-id={ec.city.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCity(ec);
                  }}
                >
                  {isCitySel && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isCap ? 9.5 : 7}
                      fill="none"
                      stroke="#F3D27A"
                      strokeWidth={1.5}
                    />
                  )}
                  {isCap ? (
                    <>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={5.8}
                        fill={MAP_TOKENS.labels.capitalGold}
                        stroke="#12161C"
                        strokeWidth={1.4}
                      />
                      <polygon
                        points={`${cx},${cy - 3.4} ${cx + 1.0},${cy - 0.9} ${cx + 3.4},${cy - 0.9} ${cx + 1.5},${cy + 0.7} ${cx + 2.2},${cy + 3.2} ${cx},${cy + 1.7} ${cx - 2.2},${cy + 3.2} ${cx - 1.5},${cy + 0.7} ${cx - 3.4},${cy - 0.9} ${cx - 1.0},${cy - 0.9}`}
                        fill="#12161C"
                      />
                    </>
                  ) : isPort ? (
                    <rect
                      x={cx - 3.2}
                      y={cy - 3.2}
                      width={6.4}
                      height={6.4}
                      fill="#7CC0D6"
                      stroke="#12161C"
                      strokeWidth={1.2}
                    />
                  ) : (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={ec.category === 'MAJOR_CITY' ? 3.5 : 2.5}
                      fill="#F5EFE2"
                      stroke="#12161C"
                      strokeWidth={1.2}
                    />
                  )}
                  <text
                    x={cx + (isCap ? 7.5 : 5.5)}
                    y={cy + 3}
                    fill={isCap ? '#F8E3A3' : MAP_TOKENS.labels.ivory}
                    fontSize={isCap ? 9.5 : ec.category === 'MAJOR_CITY' ? 8 : 7}
                    fontWeight={isCap ? 700 : 600}
                    stroke="#12161C"
                    strokeWidth={2.2}
                    paintOrder="stroke"
                  >
                    {ec.city.name}
                  </text>
                </g>
              );
            })}

          {/* Mountain Peaks / Region Codes when enabled */}
          {(showPeaksAndCodes || layer === 'TERRAIN') &&
            layers.peaks.map((pk) => {
              const [x, y] = projectSvg(pk.coords[0], pk.coords[1]);
              return (
                <text
                  key={`svg_pk_${pk.name}`}
                  x={x}
                  y={y - 5}
                  textAnchor="middle"
                  fill={MAP_TOKENS.labels.peakBrown}
                  fontSize={7}
                  fontWeight={600}
                  stroke="#12161C"
                  strokeWidth={2}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  ▲ {pk.name} {pk.elevationMeters}m
                </text>
              );
            })}
        </g>
      </svg>
    </div>
  );
}
