import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asUtcEpochMs,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  DomainEvent,
  EventIdSchema,
  MatchIdSchema,
} from '../contracts';
import {
  applyIncomingDelta,
  computeReconnectBackoffMs,
  createInitialDeltaSyncState,
} from '../web/syncClient';
import {
  createWorld72MatchState,
  WORLD_GEO_LAYERS,
  WORLD_MAP_72_GEOJSON,
  WORLD_MAP_METADATA,
} from './worldMap72';

function computeSignedRingArea(ring: readonly [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function makeFakeEvent(sequence: number): DomainEvent {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    eventId: EventIdSchema.parse(`evt_test_${sequence}`),
    matchId: MatchIdSchema.parse('mch_sync_test'),
    sequence,
    occurredAtUtc: asUtcEpochMs(1_750_000_000_000 + sequence * 1000),
    tieBreakPriority: 100,
    causedByCommandId: CommandIdSchema.parse(`cmd_test_${sequence}`),
    payload: {
      type: 'CLOCK_ADVANCED',
      previousUtc: asUtcEpochMs(1_750_000_000_000 + (sequence - 1) * 1000),
      currentUtc: asUtcEpochMs(1_750_000_000_000 + sequence * 1000),
      elapsedMs: 1000,
    },
  };
}

describe('P02-03 World Map 72-Region GeoJSON & Graph Integrity', () => {
  it('contains 72 valid, unique, closed counter-clockwise polygons with WGS84 coordinates', () => {
    const features = WORLD_MAP_72_GEOJSON.features;
    assert.equal(features.length, 72);
    assert.ok(features.length >= 60 && features.length <= 100);

    const seenIds = new Set<string>();
    const seenCodes = new Set<string>();

    for (const f of features) {
      assert.equal(f.type, 'Feature');
      assert.equal(f.geometry.type, 'Polygon');
      assert.ok(!seenIds.has(f.properties.regionId), `Duplicate regionId ${f.properties.regionId}`);
      assert.ok(!seenCodes.has(f.properties.code), `Duplicate code ${f.properties.code}`);
      seenIds.add(f.properties.regionId);
      seenCodes.add(f.properties.code);

      const ring = f.geometry.coordinates[0];
      assert.ok(ring.length >= 4, 'Polygon ring must have at least 4 coordinates');
      assert.deepEqual(ring[0], ring[ring.length - 1], 'Polygon ring must be closed');

      const signedArea = computeSignedRingArea(ring);
      assert.ok(signedArea > 0, `Polygon ${f.properties.regionId} must be CCW with non-zero area`);

      for (const [lon, lat] of ring) {
        assert.ok(lon >= 102 && lon <= 111, `Longitude out of bounds: ${lon}`);
        assert.ok(lat >= 8 && lat <= 24, `Latitude out of bounds: ${lat}`);
      }

      assert.equal(f.properties.modernRoadsUsedAsHistorical, false);
      assert.equal(f.properties.eraLabel, 'ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK');
      assert.ok(f.properties.dataSource.includes('Natural Earth'));
    }

    assert.equal(WORLD_MAP_METADATA.modernRoadsUsedAsHistorical, false);
  });

  it('has strictly symmetric adjacency and zero orphan regions (connected graph)', () => {
    const adjMap = new Map<string, Set<string>>();
    for (const f of WORLD_MAP_72_GEOJSON.features) {
      adjMap.set(f.properties.regionId, new Set(f.properties.adjacentRegionIds));
    }

    for (const [id, neighbors] of adjMap.entries()) {
      assert.ok(neighbors.size >= 2, `Region ${id} should have at least 2 neighbors`);
      for (const n of neighbors) {
        assert.ok(adjMap.has(n), `Neighbor ${n} of ${id} does not exist`);
        assert.ok(adjMap.get(n)!.has(id), `Adjacency ${id} <-> ${n} is asymmetric`);
      }
    }

    // BFS reachability from first region
    const startId: string = WORLD_MAP_72_GEOJSON.features[0].properties.regionId;
    const visited = new Set<string>([startId]);
    const queue: string[] = [startId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of adjMap.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    assert.equal(visited.size, 72, 'All 72 regions must be reachable with zero orphans');
  });

  it('creates an invariant-valid 72-region MatchState with 2 human slots and independent NPCs', () => {
    const state = createWorld72MatchState({
      matchId: 'mch_world72_unit',
      title: 'World 72 Test',
      seed: 424242,
      createdAtUtc: 1_750_000_000_000,
      mode: 'PRODUCTION_REALTIME',
    });

    assert.equal(Object.keys(state.regions).length, 72);
    const humanActors = Object.values(state.actors).filter((a) => a.role === 'HUMAN_PLAYER');
    const npcActors = Object.values(state.actors).filter((a) => a.role === 'INDEPENDENT_NPC');
    assert.equal(humanActors.length, 2);
    assert.deepEqual(
      humanActors.map((a) => a.slot).sort(),
      ['NORTH', 'SOUTH']
    );
    assert.ok(npcActors.length >= 2);
  });
});

describe('P02-04 Pure Client Delta Sync & Reconnect Backoff', () => {
  it('applies contiguous deltas, ignores duplicates, detects out-of-order gaps, and drains once gap arrives', () => {
    let state = createInitialDeltaSyncState(0, 0, '0'.repeat(64), []);

    // Delta 1 (seq 1..1) -> applied
    const r1 = applyIncomingDelta(state, {
      fromSequence: 1,
      toSequence: 1,
      version: 1,
      stateHash: '1'.repeat(64),
      events: [makeFakeEvent(1)],
    });
    assert.equal(r1.status, 'APPLIED');
    assert.equal(r1.state.lastAppliedSequence, 1);
    state = r1.state;

    // Duplicate delta 1 -> ignored cleanly
    const dup = applyIncomingDelta(state, {
      fromSequence: 1,
      toSequence: 1,
      version: 1,
      stateHash: '1'.repeat(64),
      events: [makeFakeEvent(1)],
    });
    assert.equal(dup.status, 'DUPLICATE_IGNORED');
    assert.equal(dup.state.events.length, 1);

    // Out-of-order delta 3 (seq 3..3 while lastApplied is 1) -> gap detected & buffered
    const gap = applyIncomingDelta(state, {
      fromSequence: 3,
      toSequence: 3,
      version: 3,
      stateHash: '3'.repeat(64),
      events: [makeFakeEvent(3)],
    });
    assert.equal(gap.status, 'GAP_DETECTED_RESYNC_REQUIRED');
    assert.equal(gap.state.needsResync, true);
    assert.equal(gap.state.lastAppliedSequence, 1);
    assert.equal(gap.state.pendingOutOfOrder.length, 1);
    state = gap.state;

    // Missing delta 2 arrives -> applies 2 AND automatically drains buffered 3!
    const healed = applyIncomingDelta(state, {
      fromSequence: 2,
      toSequence: 2,
      version: 2,
      stateHash: '2'.repeat(64),
      events: [makeFakeEvent(2)],
    });
    assert.equal(healed.status, 'APPLIED');
    assert.equal(healed.state.needsResync, false);
    assert.equal(healed.state.lastAppliedSequence, 3);
    assert.equal(healed.state.currentVersion, 3);
    assert.equal(healed.state.stateHash, '3'.repeat(64));
    assert.deepEqual(
      healed.state.events.map((e) => e.sequence),
      [1, 2, 3]
    );
  });

  it('computes capped exponential reconnect backoff', () => {
    assert.equal(computeReconnectBackoffMs(0), 500);
    assert.equal(computeReconnectBackoffMs(1), 1000);
    assert.equal(computeReconnectBackoffMs(2), 2000);
    assert.equal(computeReconnectBackoffMs(3), 4000);
    assert.equal(computeReconnectBackoffMs(10), 30000);
  });
});

describe('P02-05 Realistic Geographic Map Foundation', () => {
  it('preserves all 72 exact reg_vn_01..reg_vn_72 IDs with non-rectangular organic polygons', () => {
    const expectedIds = Array.from(
      { length: 72 },
      (_, idx) => `reg_vn_${String(idx + 1).padStart(2, '0')}`
    );
    const actualIds = WORLD_MAP_72_GEOJSON.features.map((f) => f.properties.regionId);
    assert.deepEqual(actualIds, expectedIds);

    for (const feature of WORLD_MAP_72_GEOJSON.features) {
      const ring = feature.geometry.coordinates[0];
      // Organic Voronoi + Natural Earth coastline polygons must have >= 6 unique vertices (never a 4-corner square)
      const uniqueVertices = ring.length - 1;
      assert.ok(
        uniqueVertices >= 6,
        `Region ${feature.properties.regionId} must be organic (>=6 vertices), got ${uniqueVertices}`
      );

      // Verify polygon is not purely axis-aligned like a grid cell
      let obliqueEdges = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const dx = Math.abs(ring[i + 1][0] - ring[i][0]);
        const dy = Math.abs(ring[i + 1][1] - ring[i][1]);
        if (dx > 0.0005 && dy > 0.0005) obliqueEdges += 1;
      }
      assert.ok(
        obliqueEdges >= 3,
        `Region ${feature.properties.regionId} must have organic non-grid boundaries`
      );
    }
  });

  it('includes verified NASA SRTM 90m elevations, Movement Engine costs, and strict historical separation', () => {
    let highlandCount = 0;
    let lowlandCount = 0;

    for (const feature of WORLD_MAP_72_GEOJSON.features) {
      const p = feature.properties;
      assert.equal(p.elevationSource, 'NASA_SRTM_90M_PUBLIC_DOMAIN');
      assert.equal(p.modernRoadsUsedAsHistorical, false);
      assert.equal(p.modernAdminBordersUsedAsHistorical, false);
      assert.ok(p.movementCostFp >= 800 && p.movementCostFp <= 5000);
      assert.ok(p.elevationPeakMeters >= p.elevationMeters);
      assert.ok(p.terrainFeatures.length >= 1);
      if (p.elevationMeters >= 500) highlandCount += 1;
      if (p.elevationMeters <= 50) lowlandCount += 1;
    }

    assert.ok(highlandCount >= 10, 'Expected substantial highland/mountain regions from SRTM DEM');
    assert.ok(lowlandCount >= 15, 'Expected substantial delta/coastal lowland regions from SRTM DEM');

    // Sanity check key capitals & mountains
    const byId = new Map<string, (typeof WORLD_MAP_72_GEOJSON.features)[number]['properties']>(
      WORLD_MAP_72_GEOJSON.features.map((f) => [String(f.properties.regionId), f.properties])
    );
    assert.ok(byId.get('reg_vn_11')?.name.includes('Hà Nội'));
    assert.ok((byId.get('reg_vn_11')?.elevationMeters ?? 999) < 40);
    assert.ok(byId.get('reg_vn_59')?.name.includes('Sài Gòn'));
    assert.ok((byId.get('reg_vn_59')?.elevationMeters ?? 999) < 40);
    assert.ok((byId.get('reg_vn_38')?.elevationMeters ?? 0) > 600);
  });

  it('provides Natural Earth surrounding countries, rivers, real cities, peaks, and 4-tier transport corridors', () => {
    const countryCodes = new Set(
      WORLD_GEO_LAYERS.contextCountries.features.map((f) => f.properties.iso)
    );
    for (const requiredCode of ['LAO', 'KHM', 'CHN', 'THA']) {
      assert.ok(countryCodes.has(requiredCode), `Missing context territory ${requiredCode}`);
    }

    assert.ok(WORLD_GEO_LAYERS.offshoreIslands.features.length >= 5);
    assert.ok(WORLD_GEO_LAYERS.rivers.features.length >= 50);
    assert.ok(WORLD_GEO_LAYERS.cities.length >= 20);
    assert.ok(WORLD_GEO_LAYERS.peaks.length >= 5);

    const validRegionIds = new Set(WORLD_MAP_72_GEOJSON.features.map((f) => f.properties.regionId));
    const adjById = new Map(
      WORLD_MAP_72_GEOJSON.features.map((f) => [f.properties.regionId, new Set(f.properties.adjacentRegionIds)])
    );

    for (const city of WORLD_GEO_LAYERS.cities) {
      assert.ok(validRegionIds.has(city.regionId), `City ${city.name} references unknown region ${city.regionId}`);
      assert.ok(city.coords[0] >= 102 && city.coords[0] <= 110);
      assert.ok(city.coords[1] >= 8.5 && city.coords[1] <= 23.5);
    }

    const transportKinds = new Set<string>();
    for (const corridor of WORLD_GEO_LAYERS.transportCorridors) {
      transportKinds.add(corridor.kind);
      assert.ok(validRegionIds.has(corridor.fromRegionId));
      assert.ok(validRegionIds.has(corridor.toRegionId));
      assert.ok(
        adjById.get(corridor.fromRegionId)?.has(corridor.toRegionId),
        `Corridor ${corridor.id} connects non-adjacent regions ${corridor.fromRegionId} -> ${corridor.toRegionId}`
      );
      assert.ok(corridor.movementModifierFp > 0);
      assert.ok(corridor.coordinates.length >= 2);
    }

    assert.ok(transportKinds.has('PRIMARY_ROAD'));
    assert.ok(transportKinds.has('SECONDARY_ROAD'));
    assert.ok(transportKinds.has('RAILWAY'));
    assert.ok(transportKinds.has('RIVER_CROSSING'));
  });
});

