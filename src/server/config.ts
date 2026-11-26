import fs from 'node:fs';
import path from 'node:path';

export type AppEnvironment = 'preview' | 'development' | 'production';

export interface ServerConfig {
  readonly port: number;
  readonly appEnv: AppEnvironment;
  readonly sqliteDbPath: string;
  readonly allowPreviewFixture: boolean;
  readonly isProduction: boolean;
}

export class ServerConfigError extends Error {
  public readonly code = 'SERVER_CONFIG_ERROR' as const;
  public readonly missingOrInvalidFields: readonly string[];

  constructor(message: string, fields: readonly string[]) {
    super(message);
    this.name = 'ServerConfigError';
    this.missingOrInvalidFields = fields;
  }
}

export class DatabaseAccessError extends Error {
  public readonly code = 'DATABASE_NOT_WRITABLE' as const;
  public readonly targetPath: string;

  constructor(targetPath: string, detail: string) {
    super(`SQLite database path "${targetPath}" is not writable: ${detail}`);
    this.name = 'DatabaseAccessError';
    this.targetPath = targetPath;
  }
}

function parseAppEnv(
  rawAppEnv: string | undefined,
  rawNodeEnv: string | undefined
): AppEnvironment {
  if (!rawAppEnv || rawAppEnv.trim() === '') {
    if (rawNodeEnv?.trim().toLowerCase() === 'production') {
      return 'production';
    }
    return 'preview';
  }
  const normalized = rawAppEnv.trim().toLowerCase();
  if (normalized === 'preview' || normalized === 'development' || normalized === 'production') {
    return normalized;
  }
  throw new ServerConfigError(
    `Invalid APP_ENV "${rawAppEnv}". Expected one of: preview, development, production.`,
    ['APP_ENV']
  );
}

/**
 * Loads and validates server runtime configuration strictly.
 * Non-sensitive defaults are auto-configured for Google AI Studio Preview (`APP_ENV=preview`,
 * `SQLITE_DB_PATH=./data/vdn-preview.sqlite`, `PORT=3000`, `ALLOW_PREVIEW_FIXTURE=true`).
 * Production mode (`APP_ENV=production` or `NODE_ENV=production`) strictly requires an explicit
 * persistent `SQLITE_DB_PATH` and hard-locks `allowPreviewFixture=false`.
 */
export function loadServerConfig(
  env: Record<string, string | undefined>,
  baseDir: string = process.cwd()
): ServerConfig {
  const issues: string[] = [];

  const rawPort = env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    issues.push('PORT');
  }

  let appEnv: AppEnvironment = 'preview';
  try {
    appEnv = parseAppEnv(env.APP_ENV, env.NODE_ENV);
  } catch {
    issues.push('APP_ENV');
  }

  const isProduction = appEnv === 'production';

  const rawDbPath = env.SQLITE_DB_PATH?.trim();
  if (isProduction && (!rawDbPath || rawDbPath === ':memory:')) {
    issues.push('SQLITE_DB_PATH');
  }

  if (issues.length > 0) {
    throw new ServerConfigError(
      `Missing or invalid server configuration fields: ${issues.join(', ')}`,
      issues
    );
  }

  const defaultRelativeDb =
    appEnv === 'development' ? './data/vdn-dev.sqlite' : './data/vdn-preview.sqlite';
  const chosenDbPath = rawDbPath && rawDbPath.length > 0 ? rawDbPath : defaultRelativeDb;
  const resolvedDbPath =
    chosenDbPath === ':memory:'
      ? ':memory:'
      : path.isAbsolute(chosenDbPath)
        ? path.normalize(chosenDbPath)
        : path.resolve(baseDir, chosenDbPath);

  // Preview fixtures are strictly prohibited in production environments.
  // This flag ONLY gates POST /api/matches/fixture and NEVER disables auth or validation.
  const allowPreviewFixture =
    !isProduction && (env.ALLOW_PREVIEW_FIXTURE?.trim().toLowerCase() ?? 'true') !== 'false';

  return {
    port,
    appEnv,
    sqliteDbPath: resolvedDbPath,
    allowPreviewFixture,
    isProduction,
  };
}

/**
 * Verifies that the target SQLite path (and its parent directory) can be created and written.
 */
export function assertDatabasePathWritable(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  const dir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.R_OK);

    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      if (stat.isDirectory()) {
        throw new Error('Target path is a directory, not a SQLite file.');
      }
      fs.accessSync(dbPath, fs.constants.W_OK | fs.constants.R_OK);
    }
  } catch (err) {
    throw new DatabaseAccessError(
      dbPath,
      err instanceof Error ? err.message : 'Filesystem permission check failed'
    );
  }
}
