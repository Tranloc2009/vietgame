import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActorIdSchema,
  asFixedPoint,
  asUtcEpochMs,
  Command,
  CommandIdSchema,
  CONTRACT_SCHEMA_VERSION,
  ContractValidationError,
  deserializeContract,
  FixedPointIntSchema,
  fpAdd,
  fpFormat,
  fpMulRatio,
  fpSub,
  IdempotencyKeySchema,
  IncompatibleSchemaVersionError,
  MatchIdSchema,
  NationIdSchema,
  parseCommand,
  projectMatchForClient,
  serializeContract,
  UtcEpochMsSchema,
  wholeUnitsToFixedPoint,
} from './index';
import { createTwoFactionFictionalFixture, FIXTURE_ACTORS, FIXTURE_MATCH_ID, FIXTURE_NATIONS } from '../content/fictionalFixture';
import { computeStateHash } from '../simulation';

test('P01-02: immutable branded IDs accept valid prefixes and reject malformed values', () => {
  assert.equal(MatchIdSchema.parse('mch_valid_01'), 'mch_valid_01');
  assert.equal(NationIdSchema.parse('nat_north_dir'), 'nat_north_dir');
  assert.equal(ActorIdSchema.parse('act_human_north'), 'act_human_north');

  assert.throws(() => MatchIdSchema.parse('nat_wrong_prefix'));
  assert.throws(() => MatchIdSchema.parse('mch_UPPERCASE'));
  assert.throws(() => MatchIdSchema.parse('mch_a'));
  assert.throws(() => IdempotencyKeySchema.parse('short'));
  assert.throws(() => IdempotencyKeySchema.parse('invalid space key'));
});

test('P01-02: fixed-point integer arithmetic is exact and rejects floats, negatives, and NaN', () => {
  const a = wholeUnitsToFixedPoint(12);
  const b = asFixedPoint(500); // 0.500
  const sum = fpAdd(a, b);
  assert.equal(sum, 12500);
  assert.equal(fpFormat(sum, 3), '12.500');
  assert.equal(fpSub(sum, b), 12000);
  assert.equal(fpMulRatio(asFixedPoint(10_000), asFixedPoint(250)), 2500);

  assert.throws(() => FixedPointIntSchema.parse(12.5));
  assert.throws(() => FixedPointIntSchema.parse(-1));
  assert.throws(() => FixedPointIntSchema.parse(Number.NaN));
  assert.throws(() => FixedPointIntSchema.parse(Number.POSITIVE_INFINITY));
  assert.throws(() => fpSub(asFixedPoint(100), asFixedPoint(200)));
  assert.throws(() => UtcEpochMsSchema.parse(-5));
  assert.throws(() => UtcEpochMsSchema.parse(1700000000000.5));
});

test('P01-02: serializeContract and deserializeContract roundtrip losslessly for Command and MatchState', () => {
  const state = createTwoFactionFictionalFixture();
  const stateJson = serializeContract('MATCH_STATE', state);
  const decodedState = deserializeContract(stateJson);
  assert.equal(decodedState.kind, 'MATCH_STATE');
  assert.equal(decodedState.schemaVersion, CONTRACT_SCHEMA_VERSION);
  assert.deepEqual(decodedState.payload, state);

  const cmd: Command = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    commandId: CommandIdSchema.parse('cmd_roundtrip_01'),
    matchId: FIXTURE_MATCH_ID,
    actorId: FIXTURE_ACTORS.north,
    idempotencyKey: IdempotencyKeySchema.parse('idem_roundtrip_01'),
    sequence: 1,
    expectedVersion: 0,
    issuedAtUtc: asUtcEpochMs(1_764_000_060_000),
    payload: {
      type: 'TRANSFER_RESOURCE',
      fromNationId: FIXTURE_NATIONS.north,
      toNationId: FIXTURE_NATIONS.npcHighland,
      resource: 'food',
      amountFp: wholeUnitsToFixedPoint(10),
      reason: 'Roundtrip serialization check',
    },
  };

  const cmdJson = serializeContract('COMMAND', cmd);
  const decodedCmd = deserializeContract(cmdJson);
  assert.equal(decodedCmd.kind, 'COMMAND');
  assert.deepEqual(decodedCmd.payload, cmd);
});

test('P01-02: invalid payloads and incompatible schema versions are rejected with structured errors', () => {
  assert.throws(
    () =>
      parseCommand({
        schemaVersion: '2.0.0',
        commandId: 'cmd_bad_ver',
        matchId: FIXTURE_MATCH_ID,
        actorId: FIXTURE_ACTORS.north,
        idempotencyKey: 'idem_bad_ver_01',
        sequence: 1,
        expectedVersion: 0,
        issuedAtUtc: 1_764_000_060_000,
        payload: {
          type: 'TRANSFER_RESOURCE',
          fromNationId: FIXTURE_NATIONS.north,
          toNationId: FIXTURE_NATIONS.south,
          resource: 'food',
          amountFp: 1000,
          reason: 'Version check',
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof IncompatibleSchemaVersionError);
      assert.equal(err.code, 'INCOMPATIBLE_SCHEMA_VERSION');
      assert.equal(err.receivedVersion, '2.0.0');
      assert.equal(err.expectedVersion, CONTRACT_SCHEMA_VERSION);
      return true;
    }
  );

  // Unknown extra property rejected by .strict()
  assert.throws(
    () =>
      parseCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: 'cmd_extra_field',
        matchId: FIXTURE_MATCH_ID,
        actorId: FIXTURE_ACTORS.north,
        idempotencyKey: 'idem_extra_field_01',
        sequence: 1,
        expectedVersion: 0,
        issuedAtUtc: 1_764_000_060_000,
        unexpectedClientOverride: true,
        payload: {
          type: 'TRANSFER_RESOURCE',
          fromNationId: FIXTURE_NATIONS.north,
          toNationId: FIXTURE_NATIONS.south,
          resource: 'food',
          amountFp: 1000,
          reason: 'Strict check',
        },
      }),
    (err: unknown) => err instanceof ContractValidationError
  );

  // Zero transfer amount rejected
  assert.throws(
    () =>
      parseCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        commandId: 'cmd_zero_amount',
        matchId: FIXTURE_MATCH_ID,
        actorId: FIXTURE_ACTORS.north,
        idempotencyKey: 'idem_zero_amount_01',
        sequence: 1,
        expectedVersion: 0,
        issuedAtUtc: 1_764_000_060_000,
        payload: {
          type: 'TRANSFER_RESOURCE',
          fromNationId: FIXTURE_NATIONS.north,
          toNationId: FIXTURE_NATIONS.south,
          resource: 'food',
          amountFp: 0,
          reason: 'Zero amount check',
        },
      }),
    (err: unknown) => err instanceof ContractValidationError
  );

  // Incompatible envelope version in JSON string
  const badEnvelope = JSON.stringify({
    schemaVersion: '1.9.0',
    kind: 'COMMAND',
    payload: {},
  });
  assert.throws(
    () => deserializeContract(badEnvelope),
    (err: unknown) => err instanceof IncompatibleSchemaVersionError
  );
});

test('P01-02: projectMatchForClient strips serverPrivate secrets completely', () => {
  const state = createTwoFactionFictionalFixture();
  const hash = computeStateHash(state);
  const clientView = projectMatchForClient(state, hash);

  assert.equal(clientView.stateHash, hash);
  assert.equal('serverPrivate' in clientView, false);
  const serialized = serializeContract('CLIENT_MATCH_VIEW', clientView);
  assert.equal(serialized.includes('hiddenIntelDigest'), false);
  assert.equal(serialized.includes('initialSeed'), false);
  assert.equal(serialized.includes('rngState'), false);
});
