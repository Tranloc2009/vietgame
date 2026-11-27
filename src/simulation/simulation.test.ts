import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActorIdSchema,
  asFixedPoint,
  asUtcEpochMs,
  Command,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  IdempotencyKeySchema,
  RegionIdSchema,
  TreatyIdSchema,
  wholeUnitsToFixedPoint,
} from '../contracts';
import {
  createDeterministicFixtureCommandLog,
  createTwoFactionFictionalFixture,
  FIXTURE_ACTORS,
  FIXTURE_BASE_EPOCH_MS,
  FIXTURE_MATCH_ID,
  FIXTURE_NATIONS,
  FIXTURE_REGIONS,
  FIXTURE_UNITS,
} from '../content/fictionalFixture';
import {
  assertSimulationInvariants,
  computeStateHash,
  FixedClock,
  ManualClock,
  reduceCommand,
  replayCommandLog,
  SimulationInvariantError,
} from './index';

test('chỉ bên nhận được chấp thuận và quyền chia sẻ hết hạn theo đồng hồ trận', () => {
  const initial = createTwoFactionFictionalFixture();
  const commands = createDeterministicFixtureCommandLog().map(entry => entry.command);
  const treatyId = TreatyIdSchema.parse('trt_visibility');
  const clock = new FixedClock(commands[0].issuedAtUtc);
  const proposed = reduceCommand(initial, {
    ...commands[0],
    payload: {type: 'PROPOSE_TREATY', kind: 'SHARED_INTEL', treatyId,
      proposerNationId: FIXTURE_NATIONS.north, targetNationId: FIXTURE_NATIONS.south, durationDays: 1},
  }, clock);
  assert.ok(proposed.ok);
  const response: Command = {...commands[1], payload: {type:'UPDATE_INTEL_PACT', treatyId, decision:'ACCEPT'}};
  const answerClock = new FixedClock(response.issuedAtUtc);
  const denied = reduceCommand(proposed.nextState, {...response, actorId: FIXTURE_ACTORS.north, sequence: 2}, answerClock);
  assert.ok(!denied.ok);
  assert.equal(denied.code, 'FORBIDDEN_ACTION');
  const accepted = reduceCommand(proposed.nextState, response, answerClock);
  assert.ok(accepted.ok);
  assert.equal(accepted.nextState.treaties[treatyId].status, 'ACTIVE');
  const deadline = accepted.nextState.treaties[treatyId].expiresAtUtc!;
  const expired = reduceCommand(accepted.nextState, {...commands[3], issuedAtUtc: deadline, expectedVersion: 2,
    payload: {type: 'ADVANCE_REALTIME_TICK', targetUtc: deadline}}, new FixedClock(deadline));
  assert.ok(expired.ok);
  assert.equal(expired.nextState.treaties[treatyId].status, 'EXPIRED');
  assert.equal(expired.emittedEvents.filter(e => e.payload.type === 'INTEL_PACT_STATUS').length, 1);
});

test('P01-03: simulation module source files contain zero Date.now() or Math.random() calls', () => {
  const simDir = path.resolve(process.cwd(), 'src/simulation');
  const files = fs
    .readdirSync(simDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  assert.ok(files.length >= 4, 'Expected simulation source modules to exist');
  for (const file of files) {
    const content = fs.readFileSync(path.join(simDir, file), 'utf8');
    const withoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.equal(
      /\bDate\.now\s*\(/.test(withoutComments),
      false,
      `Forbidden Date.now() found in src/simulation/${file}`
    );
    assert.equal(
      /\bMath\.random\s*\(/.test(withoutComments),
      false,
      `Forbidden Math.random() found in src/simulation/${file}`
    );
  }
});

test('P01-03: replay with identical seed and command log yields bit-identical SHA-256 hash', () => {
  const initialA = createTwoFactionFictionalFixture({ seed: 20260720 });
  const initialB = createTwoFactionFictionalFixture({ seed: 20260720 });
  const log = createDeterministicFixtureCommandLog(FIXTURE_BASE_EPOCH_MS);

  const replayA = replayCommandLog(initialA, log);
  const replayB = replayCommandLog(initialB, log);

  assert.equal(replayA.finalHash, replayB.finalHash);
  assert.equal(replayA.replayedCount, 4);
  assert.equal(replayA.finalState.version, 4);
  assert.deepEqual(replayA.finalState, replayB.finalState);

  // Different seed must alter deterministic job completion roll & final state hash
  const initialDifferentSeed = createTwoFactionFictionalFixture({ seed: 99999999 });
  const replayC = replayCommandLog(initialDifferentSeed, log);
  assert.notEqual(replayA.finalHash, replayC.finalHash);
});

test('P01-03: simultaneous events sharing exact UTC timestamp are ordered deterministically', () => {
  const initial = createTwoFactionFictionalFixture();
  const log = createDeterministicFixtureCommandLog(FIXTURE_BASE_EPOCH_MS);

  const replayed = replayCommandLog(initial, log);
  const tickEvents = replayed.finalState.events.filter(
    (e) => e.causedByCommandId === 'cmd_fx_004'
  );

  // Expect 3 simultaneous events at base + 720_000ms:
  // 1) job_alpha_south (tieBreakPriority 10, lexical 'job_alpha_south' < 'job_zeta_north')
  // 2) job_zeta_north  (tieBreakPriority 10)
  // 3) CLOCK_ADVANCED  (tieBreakPriority 90)
  assert.equal(tickEvents.length, 3);
  assert.equal(tickEvents[0].occurredAtUtc, tickEvents[1].occurredAtUtc);
  assert.equal(tickEvents[1].occurredAtUtc, tickEvents[2].occurredAtUtc);

  assert.equal(tickEvents[0].payload.type, 'JOB_COMPLETED');
  assert.equal(tickEvents[0].payload.jobId, 'job_alpha_south');

  assert.equal(tickEvents[1].payload.type, 'JOB_COMPLETED');
  assert.equal(tickEvents[1].payload.jobId, 'job_zeta_north');

  assert.equal(tickEvents[2].payload.type, 'CLOCK_ADVANCED');
});

test('P01-03: duplicate idempotency key returns idempotent replay without double mutation; mismatched payload conflicts', () => {
  const initial = createTwoFactionFictionalFixture();
  const initialSnapshot = JSON.stringify(initial);
  const clock = new FixedClock(FIXTURE_BASE_EPOCH_MS + 10_000);

  const transferCmd: Command = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse('cmd_idem_01'),
    matchId: FIXTURE_MATCH_ID,
    actorId: FIXTURE_ACTORS.north,
    idempotencyKey: IdempotencyKeySchema.parse('idem_transfer_unique_001'),
    sequence: 1,
    expectedVersion: 0,
    issuedAtUtc: clock.nowUtc(),
    payload: {
      type: 'TRANSFER_RESOURCE',
      fromNationId: FIXTURE_NATIONS.north,
      toNationId: FIXTURE_NATIONS.npcHighland,
      resource: 'food',
      amountFp: wholeUnitsToFixedPoint(20),
      reason: 'Idempotent transfer test',
    },
  };

  const first = reduceCommand(initial, transferCmd, clock);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.idempotentDuplicate, false);
  assert.equal(first.nextState.version, 1);
  assert.equal(first.nextState.nations[FIXTURE_NATIONS.north].resources.food, 480_000);
  assert.equal(first.nextState.nations[FIXTURE_NATIONS.npcHighland].resources.food, 200_000);

  // Confirm pure reducer never mutated original input state
  assert.equal(JSON.stringify(initial), initialSnapshot);

  // Replay exact same command with same idempotencyKey
  const duplicate = reduceCommand(first.nextState, transferCmd, clock);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.idempotentDuplicate, true);
  assert.equal(duplicate.stateHash, first.stateHash);
  assert.equal(duplicate.nextState.version, 1);
  assert.equal(duplicate.emittedEvents.length, 0);
  assert.equal(duplicate.nextState.nations[FIXTURE_NATIONS.north].resources.food, 480_000);

  // Reusing same idempotencyKey with a DIFFERENT payload amount MUST fail with IDEMPOTENCY_CONFLICT
  const mutatedPayloadCmd: Command = {
    ...transferCmd,
    commandId: CommandIdSchema.parse('cmd_idem_02'),
    payload: {
      ...transferCmd.payload,
      amountFp: wholeUnitsToFixedPoint(50),
    } as Command['payload'],
  };
  const conflict = reduceCommand(first.nextState, mutatedPayloadCmd, clock);
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
});

test('P01-03: enforces authorization, insufficient resources, version conflict, sequence order, and adjacency', () => {
  const initial = createTwoFactionFictionalFixture();
  const clock = new ManualClock(FIXTURE_BASE_EPOCH_MS + 30_000);

  // 1. Unauthorized unknown actor
  const unauthRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_unauth_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: ActorIdSchema.parse('act_intruder_99'),
      idempotencyKey: IdempotencyKeySchema.parse('idem_unauth_01'),
      sequence: 1,
      expectedVersion: 0,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'TRANSFER_RESOURCE',
        fromNationId: FIXTURE_NATIONS.north,
        toNationId: FIXTURE_NATIONS.south,
        resource: 'food',
        amountFp: wholeUnitsToFixedPoint(1),
        reason: 'Intruder attempt',
      },
    },
    clock
  );
  assert.equal(unauthRes.ok, false);
  if (!unauthRes.ok) assert.equal(unauthRes.code, 'UNAUTHORIZED_ACTOR');

  // 2. Forbidden cross-faction resource transfer (NORTH actor trying to drain SOUTH)
  const forbiddenRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_forbid_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_forbid_01'),
      sequence: 1,
      expectedVersion: 0,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'TRANSFER_RESOURCE',
        fromNationId: FIXTURE_NATIONS.south,
        toNationId: FIXTURE_NATIONS.north,
        resource: 'treasury',
        amountFp: wholeUnitsToFixedPoint(10),
        reason: 'Cross-faction theft attempt',
      },
    },
    clock
  );
  assert.equal(forbiddenRes.ok, false);
  if (!forbiddenRes.ok) assert.equal(forbiddenRes.code, 'FORBIDDEN_ACTION');

  // 3. Insufficient resources
  const brokeRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_broke_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_broke_01'),
      sequence: 1,
      expectedVersion: 0,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'TRANSFER_RESOURCE',
        fromNationId: FIXTURE_NATIONS.north,
        toNationId: FIXTURE_NATIONS.south,
        resource: 'treasury',
        amountFp: wholeUnitsToFixedPoint(9999),
        reason: 'Exceeds balance',
      },
    },
    clock
  );
  assert.equal(brokeRes.ok, false);
  if (!brokeRes.ok) assert.equal(brokeRes.code, 'INSUFFICIENT_RESOURCES');

  // 4. Version conflict
  const staleRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_stale_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_stale_01'),
      sequence: 1,
      expectedVersion: 99,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'MOVE_UNIT',
        unitId: FIXTURE_UNITS.northCorps,
        targetRegionId: FIXTURE_REGIONS.centralPass,
      },
    },
    clock
  );
  assert.equal(staleRes.ok, false);
  if (!staleRes.ok) assert.equal(staleRes.code, 'VERSION_CONFLICT');

  // 5. Invalid sequence (expected 1, sent 2)
  const seqRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_seq_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_seq_01'),
      sequence: 2,
      expectedVersion: 0,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'MOVE_UNIT',
        unitId: FIXTURE_UNITS.northCorps,
        targetRegionId: FIXTURE_REGIONS.centralPass,
      },
    },
    clock
  );
  assert.equal(seqRes.ok, false);
  if (!seqRes.ok) assert.equal(seqRes.code, 'INVALID_SEQUENCE');

  // 6. Non-adjacent unit move rejected (northDelta -> southBasin is not directly adjacent)
  const nonAdjRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_nonadj_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.north,
      idempotencyKey: IdempotencyKeySchema.parse('idem_nonadj_01'),
      sequence: 1,
      expectedVersion: 0,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'MOVE_UNIT',
        unitId: FIXTURE_UNITS.northCorps,
        targetRegionId: RegionIdSchema.parse(FIXTURE_REGIONS.southBasin),
      },
    },
    clock
  );
  assert.equal(nonAdjRes.ok, false);
  if (!nonAdjRes.ok) assert.equal(nonAdjRes.code, 'INVALID_TARGET');

  // 7. Fast-forward beyond authoritative clock rejected
  const ffRes = reduceCommand(
    initial,
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      commandId: CommandIdSchema.parse('cmd_ff_01'),
      matchId: FIXTURE_MATCH_ID,
      actorId: FIXTURE_ACTORS.system,
      idempotencyKey: IdempotencyKeySchema.parse('idem_ff_01'),
      sequence: 1,
      expectedVersion: 0,
      issuedAtUtc: clock.nowUtc(),
      payload: {
        type: 'ADVANCE_REALTIME_TICK',
        targetUtc: asUtcEpochMs((clock.nowUtc() as number) + 86_400_000),
      },
    },
    clock
  );
  assert.equal(ffRes.ok, false);
  if (!ffRes.ok) assert.equal(ffRes.code, 'INVALID_TIME_PROGRESSION');
});

test('P01-03: invariants detector catches broken conservation or missing human slot', () => {
  const initial = createTwoFactionFictionalFixture();
  assert.doesNotThrow(() => assertSimulationInvariants(initial));

  // Break resource conservation by secretly inflating NORTH food
  const brokenConservation = {
    ...initial,
    nations: {
      ...initial.nations,
      [FIXTURE_NATIONS.north]: {
        ...initial.nations[FIXTURE_NATIONS.north],
        resources: {
          ...initial.nations[FIXTURE_NATIONS.north].resources,
          food: asFixedPoint(999_999),
        },
      },
    },
  };
  assert.throws(
    () => assertSimulationInvariants(brokenConservation),
    (err: unknown) => err instanceof SimulationInvariantError
  );

  // Break 2-human-slot invariant
  const { [FIXTURE_ACTORS.south]: _removed, ...onlyNorthActors } = initial.actors;
  const brokenSlots = {
    ...initial,
    actors: onlyNorthActors,
  };
  assert.throws(
    () => assertSimulationInvariants(brokenSlots),
    (err: unknown) => err instanceof SimulationInvariantError
  );
  assert.ok(computeStateHash(initial).length === 64);
});
