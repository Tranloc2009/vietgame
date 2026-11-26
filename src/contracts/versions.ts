export const APP_VERSION = '0.1.0-p01';
export const CONTRACT_SCHEMA_VERSION = '1.0.0';
export const SIMULATION_ENGINE_VERSION = '1.0.0';

/**
 * Invariant: Production gameplay advances strictly 1:1 with real time
 * (86,400 real seconds per in-game day). Fast-forwarding is prohibited in production.
 */
export const REALTIME_SECONDS_PER_GAME_DAY = 86_400;

export const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export class IncompatibleSchemaVersionError extends Error {
  public readonly code = 'INCOMPATIBLE_SCHEMA_VERSION' as const;
  public readonly expectedVersion: string;
  public readonly receivedVersion: string;

  constructor(receivedVersion: string, expectedVersion: string = CONTRACT_SCHEMA_VERSION) {
    super(
      `Incompatible contract schema version: received "${receivedVersion}", expected major-compatible with "${expectedVersion}".`
    );
    this.name = 'IncompatibleSchemaVersionError';
    this.expectedVersion = expectedVersion;
    this.receivedVersion = receivedVersion;
  }
}

export function parseSemver(version: string): ParsedSemver {
  const match = SEMVER_REGEX.exec(version);
  if (!match) {
    throw new IncompatibleSchemaVersionError(version, CONTRACT_SCHEMA_VERSION);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Major version must match exactly; minor version must not exceed supported contract minor.
 */
export function assertCompatibleSchemaVersion(
  receivedVersion: unknown,
  supportedVersion: string = CONTRACT_SCHEMA_VERSION
): string {
  if (typeof receivedVersion !== 'string') {
    throw new IncompatibleSchemaVersionError(String(receivedVersion), supportedVersion);
  }
  const received = parseSemver(receivedVersion);
  const supported = parseSemver(supportedVersion);

  if (received.major !== supported.major || received.minor > supported.minor) {
    throw new IncompatibleSchemaVersionError(receivedVersion, supportedVersion);
  }

  return receivedVersion;
}
