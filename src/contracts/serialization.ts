import { z } from 'zod';
import {
  ClientMatchView,
  ClientMatchViewSchema,
  Command,
  CommandSchema,
  DomainEvent,
  DomainEventSchema,
  MatchState,
  MatchStateSchema,
} from './entities';
import {
  assertCompatibleSchemaVersion,
  CONTRACT_SCHEMA_VERSION,
  IncompatibleSchemaVersionError,
} from './versions';

export class ContractValidationError extends Error {
  public readonly code = 'CONTRACT_VALIDATION_ERROR' as const;
  public readonly issues: readonly { path: string; message: string }[];

  constructor(message: string, issues: readonly { path: string; message: string }[]) {
    super(message);
    this.name = 'ContractValidationError';
    this.issues = issues;
  }
}

export interface ContractEnvelope<TPayload> {
  readonly schemaVersion: string;
  readonly kind: 'COMMAND' | 'EVENT' | 'MATCH_STATE' | 'CLIENT_MATCH_VIEW';
  readonly payload: TPayload;
}

const RawEnvelopeSchema = z
  .object({
    schemaVersion: z.string(),
    kind: z.enum(['COMMAND', 'EVENT', 'MATCH_STATE', 'CLIENT_MATCH_VIEW']),
    payload: z.unknown(),
  })
  .strict();

function formatZodIssues(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
  }));
}

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ContractValidationError(
      `Invalid ${label} payload`,
      formatZodIssues(result.error)
    );
  }
  return result.data;
}

/**
 * Deterministic canonical JSON stringification with recursively sorted object keys.
 * Ensures lossless roundtrip serialization and stable hashing across JS engines.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      sorted[key] = sortKeysDeep(entry);
    }
  }
  return sorted;
}

export function serializeContract<TPayload>(
  kind: ContractEnvelope<TPayload>['kind'],
  payload: TPayload,
  schemaVersion: string = CONTRACT_SCHEMA_VERSION
): string {
  assertCompatibleSchemaVersion(schemaVersion);

  // Validate payload before emitting wire JSON
  validateKindPayload(kind, payload);

  const envelope: ContractEnvelope<TPayload> = {
    schemaVersion,
    kind,
    payload,
  };
  return canonicalStringify(envelope);
}

export function deserializeContract(
  rawJson: string
):
  | ContractEnvelope<Command>
  | ContractEnvelope<DomainEvent>
  | ContractEnvelope<MatchState>
  | ContractEnvelope<ClientMatchView> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new ContractValidationError('Malformed JSON input', [
      { path: '$', message: error instanceof Error ? error.message : 'JSON parse error' },
    ]);
  }

  const envelope = parseWithSchema(RawEnvelopeSchema, parsed, 'ContractEnvelope');
  assertCompatibleSchemaVersion(envelope.schemaVersion);

  const payload = validateKindPayload(envelope.kind, envelope.payload);
  return {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    payload,
  } as
    | ContractEnvelope<Command>
    | ContractEnvelope<DomainEvent>
    | ContractEnvelope<MatchState>
    | ContractEnvelope<ClientMatchView>;
}

function validateKindPayload(
  kind: ContractEnvelope<unknown>['kind'],
  payload: unknown
): Command | DomainEvent | MatchState | ClientMatchView {
  switch (kind) {
    case 'COMMAND': {
      const cmd = parseWithSchema(CommandSchema, payload, 'Command');
      assertCompatibleSchemaVersion(cmd.schemaVersion);
      return cmd;
    }
    case 'EVENT': {
      const evt = parseWithSchema(DomainEventSchema, payload, 'DomainEvent');
      assertCompatibleSchemaVersion(evt.schemaVersion);
      return evt;
    }
    case 'MATCH_STATE': {
      const state = parseWithSchema(MatchStateSchema, payload, 'MatchState');
      assertCompatibleSchemaVersion(state.schemaVersion);
      return state;
    }
    case 'CLIENT_MATCH_VIEW': {
      const view = parseWithSchema(ClientMatchViewSchema, payload, 'ClientMatchView');
      assertCompatibleSchemaVersion(view.schemaVersion);
      return view;
    }
  }
}

export function parseCommand(input: unknown): Command {
  const cmd = parseWithSchema(CommandSchema, input, 'Command');
  assertCompatibleSchemaVersion(cmd.schemaVersion);
  return cmd;
}

/**
 * Strips server-only secrets (`serverPrivate`) before sending match state to any client.
 */
export function projectMatchForClient(state: MatchState, stateHash: string): ClientMatchView {
  const { serverPrivate: _stripped, ...publicFields } = state;
  return parseWithSchema(
    ClientMatchViewSchema,
    {
      ...publicFields,
      stateHash,
    },
    'ClientMatchView'
  );
}

export { IncompatibleSchemaVersionError };
