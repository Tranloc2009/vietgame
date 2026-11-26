import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTwoFactionFictionalFixture } from '../../content/fictionalFixture';
import { WORLD_MAP_72_GEOJSON, WORLD_GEO_LAYERS, createWorld72MatchState } from '../../content/worldMap72';
import { projectMatchForClient, projectMatchForViewer as projectViewer } from '../../contracts';
import { computeStateHash } from '../../simulation';
import {
  ACTIVE_MAP_LAYERS,
  buildLegendItems,
  computeRegionFillColor,
  computeTerrainBaseColor,
  FUTURE_MAP_MODES_REGISTRY,
  getActiveMapLayerDescriptor,
} from '../mapLayerRegistry';
import {
  CAMERA_PRESETS,
  clampCameraSnapshot,
  classifySemanticZoom,
  clearSessionCamera,
  loadSessionCamera,
  PLAYABLE_MAX_BOUNDS,
  saveSessionCamera,
} from './cameraEngine';
import { getFactionVisual, MAP_TOKENS } from './designTokens';
import {
  DEFAULT_WEATHER_ADAPTER_CONFIG,
  GRAPHICS_PRESETS,
  selectInitialGraphicsPreset,
} from './graphicsSettings';
import { MILITARY_ICON_REGISTRY, projectAuthorizedMilitaryEntities } from './militaryAdapter';
import {
  enrichSettlementCatalog,
  normalizeVietnameseQuery,
  resolveLabelCollisions,
  searchMapEntities,
} from './settlementCatalog';
import { resolveMapMatchData } from './foundationAdapter';
import { extractDynamicNationalBorders } from './terrainRelief';
import type { WorldMapFeature } from '../roomApi';

// Adapt WORLD_MAP_72_GEOJSON features to WorldMapFeature (structurally identical)
const FEATURES = WORLD_MAP_72_GEOJSON.features as unknown as readonly WorldMapFeature[];
const FEATURES_BY_ID = new Map<string, WorldMapFeature>(
  FEATURES.map((f) => [String(f.properties.regionId), f])
);

describe('P02-06 Strategic Map Engine 2.0 — Pure Logic & Contracts', () => {
  it('preserves exact counts: 72 regions, 98 transport corridors, and 24 cities', () => {
    assert.equal(WORLD_MAP_72_GEOJSON.features.length, 72);
    assert.equal(WORLD_GEO_LAYERS.transportCorridors.length, 98);
    assert.equal(WORLD_GEO_LAYERS.cities.length, 24);
  });

  it('classifies all 5 semantic zoom levels and clamps camera strictly within playable bounds', () => {
    assert.equal(classifySemanticZoom(4.5).level, 1);
    assert.equal(classifySemanticZoom(5.5).level, 2);
    assert.equal(classifySemanticZoom(6.5).level, 3);
    assert.equal(classifySemanticZoom(7.5).level, 4);
    assert.equal(classifySemanticZoom(8.6).level, 5);
    assert.equal(classifySemanticZoom(8.6).enableTerrainInspectionPitch, true);
    assert.equal(classifySemanticZoom(5.0).showSecondaryRoads, false);
    assert.equal(classifySemanticZoom(6.8).showSecondaryRoads, true);

    // Out-of-bounds camera must be clamped so the map can never be lost
    const clamped = clampCameraSnapshot(
      { center: [200, -40], zoom: 99, bearing: 400, pitch: 85 },
      36
    );
    assert.equal(clamped.center[0], PLAYABLE_MAX_BOUNDS[1][0]);
    assert.equal(clamped.center[1], PLAYABLE_MAX_BOUNDS[0][1]);
    assert.equal(clamped.zoom, MAP_TOKENS.zoom.max);
    assert.equal(clamped.pitch, 36);
    assert.ok(clamped.bearing >= -180 && clamped.bearing <= 180);

    // Session camera persistence roundtrip
    clearSessionCamera();
    assert.equal(loadSessionCamera(), null);
    saveSessionCamera({ center: [105.84, 21.03], zoom: 7.2, bearing: 10, pitch: 20 });
    const loaded = loadSessionCamera();
    assert.ok(loaded);
    assert.equal(loaded.zoom, 7.2);
    clearSessionCamera();

    assert.ok(CAMERA_PRESETS.length >= 7);
  });

  it('selects sensible graphics quality presets and keeps weather adapter cosmetic-only', () => {
    assert.equal(
      selectInitialGraphicsPreset({ viewportWidth: 390, coarsePointer: true, hardwareConcurrency: 2, deviceMemoryGb: 2 }),
      'LOW'
    );
    assert.equal(
      selectInitialGraphicsPreset({ viewportWidth: 390, coarsePointer: true, hardwareConcurrency: 6, deviceMemoryGb: 6 }),
      'MEDIUM'
    );
    assert.equal(
      selectInitialGraphicsPreset({ viewportWidth: 1440, coarsePointer: false, hardwareConcurrency: 8, deviceMemoryGb: 8 }),
      'HIGH'
    );
    assert.equal(
      selectInitialGraphicsPreset({ viewportWidth: 1440, coarsePointer: false, prefersReducedMotion: true }),
      'LOW'
    );

    assert.equal(GRAPHICS_PRESETS.LOW.allowPitch, false);
    assert.equal(GRAPHICS_PRESETS.LOW.hillshadeEnabled, false);
    assert.equal(GRAPHICS_PRESETS.HIGH.allowPitch, true);
    assert.equal(GRAPHICS_PRESETS.ULTRA.relief25DExtrusion, true);
    assert.equal(DEFAULT_WEATHER_ADAPTER_CONFIG.simulationImplemented, false);
    assert.equal(DEFAULT_WEATHER_ADAPTER_CONFIG.gameplayEffect, 'NONE_COSMETIC_ONLY');
  });

  it('classifies all 24 cities hierarchically, resolves label collisions, and searches Vietnamese queries', () => {
    const catalog = enrichSettlementCatalog(
      WORLD_GEO_LAYERS.cities,
      WORLD_GEO_LAYERS.transportCorridors,
      FEATURES_BY_ID
    );
    assert.equal(catalog.length, 24);
    const capitals = catalog.filter((c) => c.category === 'NATIONAL_CAPITAL');
    assert.equal(capitals.length, 2, 'Expected Hanoi and Saigon capitals');
    assert.ok(catalog.some((c) => c.category === 'PORT_CITY'));

    // Vietnamese diacritic-insensitive search
    assert.equal(normalizeVietnameseQuery('Đà Nẵng'), 'da nang');
    const hanoiHits = searchMapEntities('ha noi', FEATURES, catalog);
    assert.ok(hanoiHits.length > 0);
    assert.equal(hanoiHits[0].kind, 'city');
    assert.ok(hanoiHits[0].title.includes('Hà Nội'));

    const codeHits = searchMapEntities('R35', FEATURES, catalog);
    assert.ok(codeHits.some((h) => h.regionId === 'reg_vn_35'));

    // Priority collision detection keeps higher-priority & selected labels
    const placed = resolveLabelCollisions(
      [
        { key: 'a', text: 'Hà Nội', x: 100, y: 100, width: 60, height: 18, priority: 100, kind: 'capital' },
        { key: 'b', text: 'R11', x: 102, y: 101, width: 30, height: 14, priority: 20, kind: 'code' },
        { key: 'c', text: 'Hải Phòng', x: 220, y: 100, width: 70, height: 16, priority: 85, kind: 'port' },
      ],
      10
    );
    assert.deepEqual(
      placed.map((p) => p.key),
      ['a', 'c']
    );
  });

  it('derives national borders dynamically from authoritative match state rather than static geometry', () => {
    const matchState = createWorld72MatchState({
      matchId: 'mch_p0206_borders',
      title: 'Border Test',
      seed: 1955,
      createdAtUtc: 1_750_000_000_000,
      mode: 'PRODUCTION_REALTIME',
    });
    const hash = computeStateHash(matchState);
    const viewer = projectViewer(matchState, hash, 'NORTH', 'nat_north_dir');

    const bordersInitial = extractDynamicNationalBorders(FEATURES, viewer);
    assert.ok(bordersInitial.features.length > 10, 'Expected national & NPC frontier border segments');
    assert.ok(
      bordersInitial.features.some((b) => b.properties.borderKind === 'NATIONAL_FACTION_BORDER'),
      'Expected direct North/South frontier border'
    );

    // Mutate a copy of viewer state where a border region changes owner -> borders must recompute dynamically
    const modifiedViewer = {
      ...viewer,
      regions: {
        ...viewer.regions,
        reg_vn_32: {
          ...viewer.regions.reg_vn_32,
          controllerNationId: 'nat_south_rep' as typeof viewer.regions.reg_vn_32.controllerNationId,
        },
      },
    };
    const bordersAfter = extractDynamicNationalBorders(FEATURES, modifiedViewer);
    assert.notDeepEqual(bordersInitial.features, bordersAfter.features);

    // Verify fill color derives dynamically from authoritative match state
    const feat32 = FEATURES_BY_ID.get('reg_vn_32')!;
    assert.equal(computeRegionFillColor(feat32, 'POLITICAL', viewer), getFactionVisual('nat_north_dir').fill);
    assert.equal(computeRegionFillColor(feat32, 'POLITICAL', modifiedViewer), getFactionVisual('nat_south_rep').fill);
    assert.ok(computeTerrainBaseColor(feat32).startsWith('#'));
  });

  it('enforces Map Mode Registry 2.0 metadata and fog-of-war in military projection adapter', () => {
    assert.equal(ACTIVE_MAP_LAYERS.length, 4);
    for (const mode of ACTIVE_MAP_LAYERS) {
      assert.equal(mode.implemented, true);
      assert.ok(mode.dataRequirements.length > 0);
      assert.ok(mode.layerOrdering.length >= 6);
      assert.ok(buildLegendItems(mode.id).length >= 4);
      assert.equal(getActiveMapLayerDescriptor(mode.id).id, mode.id);
    }

    assert.equal(FUTURE_MAP_MODES_REGISTRY.length, 8);
    for (const futureMode of FUTURE_MAP_MODES_REGISTRY) {
      assert.equal(futureMode.implemented, false);
    }

    // Military adapter never invents fake units when no match is active
    assert.equal(projectAuthorizedMilitaryEntities(null).length, 0);
    assert.ok(Object.keys(MILITARY_ICON_REGISTRY).length >= 8);

    // Military adapter strictly honors server fog-of-war redaction
    const state = createWorld72MatchState({
      matchId: 'mch_p0206_fog',
      title: 'Fog Test',
      seed: 2026,
      createdAtUtc: 1_750_000_000_000,
      mode: 'PRODUCTION_REALTIME',
    });
    const northView = projectViewer(state, computeStateHash(state), 'NORTH', 'nat_north_dir');
    const projected = projectAuthorizedMilitaryEntities(northView);
    const enemyUnits = projected.filter((u) => u.ownerNationId !== 'nat_north_dir');
    assert.ok(enemyUnits.length >= 2);
    for (const enemy of enemyUnits) {
      assert.equal(enemy.isRedactedByFogOfWar, true);
      assert.equal(enemy.strengthDisplay, null);
    }
    const friendlyUnits = projected.filter((u) => u.ownerNationId === 'nat_north_dir');
    assert.ok(friendlyUnits.length >= 1);
    assert.equal(friendlyUnits[0].isRedactedByFogOfWar, false);
    assert.ok(friendlyUnits[0].strengthDisplay !== null);
  });

  it('preserves camera snapshot across layer mode switches and bounds all 72 regions within hillshade extent', () => {
    clearSessionCamera();
    const initial = saveSessionCamera({ center: [106.7, 10.78], zoom: 7.4, bearing: 12, pitch: 24 }, 42);
    // Switching across all 4 active map modes must never mutate or drop the saved session camera
    for (const mode of ACTIVE_MAP_LAYERS) {
      const desc = getActiveMapLayerDescriptor(mode.id);
      assert.ok(desc.terrainBlendOpacity > 0 && desc.terrainBlendOpacity <= 1);
      const current = loadSessionCamera();
      assert.deepEqual(current, initial);
    }
    clearSessionCamera();

    // Verify every region centroid sits comfortably within playable bounds and produces valid SVG/WebGL colors across all 4 modes
    for (const f of FEATURES) {
      const [lon, lat] = f.properties.centroid;
      assert.ok(
        lon >= PLAYABLE_MAX_BOUNDS[0][0] && lon <= PLAYABLE_MAX_BOUNDS[1][0],
        `Region ${f.properties.regionId} lon ${lon} outside PLAYABLE_MAX_BOUNDS`
      );
      assert.ok(
        lat >= PLAYABLE_MAX_BOUNDS[0][1] && lat <= PLAYABLE_MAX_BOUNDS[1][1],
        `Region ${f.properties.regionId} lat ${lat} outside PLAYABLE_MAX_BOUNDS`
      );
      for (const mode of ACTIVE_MAP_LAYERS) {
        const fill = computeRegionFillColor(f, mode.id, null);
        assert.ok(fill.startsWith('#') && fill.length === 7, `Invalid hex fill ${fill}`);
      }
    }
  });

  it('integrates live foundationMatch data onto all 72 regions while keeping active room match priority', () => {
    const fixtureState = createTwoFactionFictionalFixture({
      matchId: 'mch_preview_alt_1955',
      seed: 19550720,
      createdAtUtc: 1_764_000_000_000,
    });
    const foundationView = projectMatchForClient(fixtureState, computeStateHash(fixtureState));

    const resolved = resolveMapMatchData(null, foundationView, FEATURES);
    assert.equal(resolved.sourceKind, 'FOUNDATION_LIVE');
    assert.ok(resolved.effectiveMatch);
    assert.equal(Object.keys(resolved.effectiveMatch.regions).length, 72);
    // Hanoi (reg_vn_11) inherits live reg_north_delta influence (80.0 = 80000 fp) and anchored north corps unit
    assert.equal(resolved.effectiveMatch.regions.reg_vn_11.influenceFp, 80_000);
    assert.equal(resolved.foundationRegionMap.get('reg_vn_11')?.regionId, 'reg_north_delta');
    assert.equal(resolved.effectiveMatch.units.unt_north_corps_01.regionId, 'reg_vn_11');
    assert.equal(resolved.effectiveMatch.units.unt_south_corps_01.regionId, 'reg_vn_59');
    assert.equal(resolved.effectiveMatch.units.unt_npc_garrison_01.regionId, 'reg_vn_42');

    // Mutating foundationMatch ownership immediately updates projected region colors & dynamic borders
    const flippedFoundation = {
      ...foundationView,
      regions: {
        ...foundationView.regions,
        reg_central_pass: {
          ...foundationView.regions.reg_central_pass,
          controllerNationId: 'nat_south_rep' as typeof foundationView.regions.reg_central_pass.controllerNationId,
        },
      },
    };
    const resolvedFlipped = resolveMapMatchData(null, flippedFoundation, FEATURES);
    const feat31 = FEATURES_BY_ID.get('reg_vn_31')!;
    assert.equal(
      computeRegionFillColor(feat31, 'POLITICAL', resolvedFlipped.effectiveMatch),
      getFactionVisual('nat_south_rep').fill
    );

    // Active multiplayer room match always takes precedence over foundationMatch
    const world72 = createWorld72MatchState({
      matchId: 'mch_room_priority',
      title: 'Room Priority',
      seed: 1955,
      createdAtUtc: 1_750_000_000_000,
      mode: 'PRODUCTION_REALTIME',
    });
    const roomView = projectViewer(world72, computeStateHash(world72), 'NORTH', 'nat_north_dir');
    const roomResolved = resolveMapMatchData(roomView, foundationView, FEATURES);
    assert.equal(roomResolved.sourceKind, 'ROOM_LIVE');
    assert.equal(roomResolved.effectiveMatch, roomView);
  });
});

