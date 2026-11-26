import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {
  ActorIdSchema,
  asUtcEpochMs,
  canonicalStringify,
  Command,
  CommandSchema,
  DomainEvent,
  DomainEventSchema,
  HumanSlot,
  MatchId,
  MatchIdSchema,
  MatchRoomSummary,
  MatchState,
  MatchStateSchema,
  NationIdSchema,
  PublicUser,
  RoomStatus,
  UserId,
  UserIdSchema,
  UtcEpochMs,
} from '../../contracts';
import { createWorld72MatchState, WORLD_ACTORS, WORLD_NATIONS } from '../../content/worldMap72';
import {
  assertSimulationInvariants,
  computeStateHash,
  reduceCommand,
  ReduceResult,
  replayCommandLog,
  ReplayLogEntry,
  SimulationClock,
} from '../../simulation';
import { assertDatabasePathWritable, DatabaseAccessError } from '../config';

export interface MigrationRecord {
  readonly id: string;
  readonly description: string;
  readonly appliedAtUtc: number;
}

export interface PersistedMatchSummary {
  readonly matchId: MatchId;
  readonly title: string;
  readonly mode: string;
  readonly schemaVersion: string;
  readonly version: number;
  readonly stateHash: string;
  readonly createdAtUtc: number;
  readonly updatedAtUtc: number;
}

export interface ReplayCheckReport {
  readonly matchId: MatchId;
  readonly verified: boolean;
  readonly storedHash: string;
  readonly replayedHash: string;
  readonly replayedCommandCount: number;
  readonly version: number;
}

export interface MatchSnapshotRecord {
  readonly snapshotId: string;
  readonly matchId: MatchId;
  readonly version: number;
  readonly stateHash: string;
  readonly createdAtUtc: number;
}

export interface MatchBackupBundle {
  readonly backupVersion: '1.0.0';
  readonly matchId: MatchId;
  readonly exportedAtUtc: number;
  readonly version: number;
  readonly stateHash: string;
  readonly initialState: MatchState;
  readonly commandLog: readonly { command: Command; appliedAtUtc: number }[];
  readonly snapshots: readonly MatchSnapshotRecord[];
}

export interface RoomActionError {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly reason: string;
}

export type RoomActionResult<T> = ({ readonly ok: true } & T) | RoomActionError;

interface MigrationDefinition {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
}

const SESSION_TTL_MS = 7 * 86_400_000;
const SNAPSHOT_EVERY_N_VERSIONS = 5;

const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    id: '001_initial_foundation',
    description: 'Create matches, command_log, event_log, and schema_migrations foundation tables',
    sql: `
      CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        version INTEGER NOT NULL,
        initial_state_json TEXT NOT NULL,
        current_state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        created_at_utc INTEGER NOT NULL,
        updated_at_utc INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT NOT NULL,
        command_id TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        expected_version INTEGER NOT NULL,
        applied_version INTEGER NOT NULL,
        applied_at_utc INTEGER NOT NULL,
        command_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
        UNIQUE (match_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_command_log_match_order
        ON command_log (match_id, id ASC);

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL,
        occurred_at_utc INTEGER NOT NULL,
        tie_break_priority INTEGER NOT NULL,
        caused_by_command_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_match_seq
        ON event_log (match_id, sequence ASC);

      CREATE TABLE IF NOT EXISTS health_probes (
        probe_key TEXT PRIMARY KEY,
        checked_at_utc INTEGER NOT NULL
      );
    `,
  },
  {
    id: '002_phase02_multiplayer_clock',
    description:
      'Add users, user_sessions, match_rooms, match_snapshots, match_worker_locks, and scheduled_ticks for P02-01 and P02-02',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at_utc INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at_utc INTEGER NOT NULL,
        expires_at_utc INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user
        ON user_sessions (user_id);

      CREATE TABLE IF NOT EXISTS match_rooms (
        match_id TEXT PRIMARY KEY,
        invite_code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        north_user_id TEXT,
        south_user_id TEXT,
        north_ready INTEGER NOT NULL DEFAULT 0,
        south_ready INTEGER NOT NULL DEFAULT 0,
        winner_slot TEXT,
        ended_reason TEXT,
        locked_at_utc INTEGER,
        created_at_utc INTEGER NOT NULL,
        updated_at_utc INTEGER NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_match_rooms_invite
        ON match_rooms (invite_code);

      CREATE TABLE IF NOT EXISTS match_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at_utc INTEGER NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_match_snapshots_match_ver
        ON match_snapshots (match_id, version DESC);

      CREATE TABLE IF NOT EXISTS match_worker_locks (
        match_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        lease_until_utc INTEGER NOT NULL,
        updated_at_utc INTEGER NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scheduled_ticks (
        match_id TEXT PRIMARY KEY,
        last_tick_utc INTEGER NOT NULL,
        tick_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
      );
    `,
  },
];

function hashPassword(password: string, saltHex: string): string {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i += 1) {
    part1 += alphabet[bytes[i] % alphabet.length];
    part2 += alphabet[bytes[i + 4] % alphabet.length];
  }
  return `VDN-${part1}-${part2}`;
}

interface RawRoomRow {
  match_id: string;
  invite_code: string;
  title: string;
  status: RoomStatus;
  created_by_user_id: string;
  north_user_id: string | null;
  south_user_id: string | null;
  north_ready: number;
  south_ready: number;
  winner_slot: HumanSlot | null;
  ended_reason: string | null;
  locked_at_utc: number | null;
  created_at_utc: number;
  updated_at_utc: number;
}

export class SqliteMatchStore {
  private readonly db: Database.Database;
  public readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    assertDatabasePathWritable(dbPath);

    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.runMigrations();
    } catch (err) {
      throw new DatabaseAccessError(
        dbPath,
        err instanceof Error ? err.message : 'Unable to open or initialize SQLite database'
      );
    }
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at_utc INTEGER NOT NULL
      );
    `);

    const getApplied = this.db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const recordApplied = this.db.prepare(
      'INSERT INTO schema_migrations (id, description, applied_at_utc) VALUES (?, ?, ?)'
    );

    const applyAll = this.db.transaction(() => {
      const now = Date.now();
      for (const migration of MIGRATIONS) {
        const existing = getApplied.get(migration.id);
        if (!existing) {
          this.db.exec(migration.sql);
          recordApplied.run(migration.id, migration.description, now);
        }
      }
    });

    applyAll();
  }

  public getAppliedMigrations(): MigrationRecord[] {
    const rows = this.db
      .prepare('SELECT id, description, applied_at_utc FROM schema_migrations ORDER BY id ASC')
      .all() as { id: string; description: string; applied_at_utc: number }[];
    return rows.map((r) => ({
      id: r.id,
      description: r.description,
      appliedAtUtc: r.applied_at_utc,
    }));
  }

  public verifyWritable(nowUtc: number): { writable: boolean; error?: string } {
    try {
      const probe = this.db.transaction((ts: number) => {
        this.db
          .prepare(
            `INSERT INTO health_probes (probe_key, checked_at_utc)
             VALUES ('last_health_check', ?)
             ON CONFLICT(probe_key) DO UPDATE SET checked_at_utc = excluded.checked_at_utc`
          )
          .run(ts);
      });
      probe(nowUtc);
      return { writable: true };
    } catch (err) {
      return {
        writable: false,
        error: err instanceof Error ? err.message : 'SQLite write probe failed',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // P02-01: Secure Account & Session Persistence
  // ---------------------------------------------------------------------------

  public registerUser(
    username: string,
    displayName: string,
    password: string,
    nowUtc: number
  ): RoomActionResult<{ user: PublicUser; token: string }> {
    const normalizedUsername = username.trim().toLowerCase();
    const existing = this.db
      .prepare('SELECT user_id FROM users WHERE username = ?')
      .get(normalizedUsername);
    if (existing) {
      return {
        ok: false,
        status: 409,
        code: 'USERNAME_TAKEN',
        reason: `Tên đăng nhập "${username}" đã tồn tại.`,
      };
    }

    const userId = UserIdSchema.parse(`usr_${crypto.randomBytes(6).toString('hex')}`);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (user_id, username, display_name, password_hash, password_salt, created_at_utc)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(userId, normalizedUsername, displayName.trim(), passwordHash, salt, nowUtc);

      this.db
        .prepare(
          `INSERT INTO user_sessions (token_hash, user_id, created_at_utc, expires_at_utc)
           VALUES (?, ?, ?, ?)`
        )
        .run(tokenHash, userId, nowUtc, nowUtc + SESSION_TTL_MS);
    });
    tx();

    return {
      ok: true,
      user: { userId, username: normalizedUsername, displayName: displayName.trim() },
      token: rawToken,
    };
  }

  public loginUser(
    username: string,
    password: string,
    nowUtc: number
  ): RoomActionResult<{ user: PublicUser; token: string }> {
    const normalizedUsername = username.trim().toLowerCase();
    const row = this.db
      .prepare(
        `SELECT user_id, username, display_name, password_hash, password_salt
         FROM users WHERE username = ?`
      )
      .get(normalizedUsername) as
      | {
          user_id: string;
          username: string;
          display_name: string;
          password_hash: string;
          password_salt: string;
        }
      | undefined;

    if (!row) {
      return {
        ok: false,
        status: 401,
        code: 'INVALID_CREDENTIALS',
        reason: 'Sai tên đăng nhập hoặc mật khẩu.',
      };
    }

    const computed = Buffer.from(hashPassword(password, row.password_salt), 'hex');
    const stored = Buffer.from(row.password_hash, 'hex');
    if (computed.length !== stored.length || !crypto.timingSafeEqual(computed, stored)) {
      return {
        ok: false,
        status: 401,
        code: 'INVALID_CREDENTIALS',
        reason: 'Sai tên đăng nhập hoặc mật khẩu.',
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    this.db
      .prepare(
        `INSERT INTO user_sessions (token_hash, user_id, created_at_utc, expires_at_utc)
         VALUES (?, ?, ?, ?)`
      )
      .run(tokenHash, row.user_id, nowUtc, nowUtc + SESSION_TTL_MS);

    return {
      ok: true,
      user: {
        userId: UserIdSchema.parse(row.user_id),
        username: row.username,
        displayName: row.display_name,
      },
      token: rawToken,
    };
  }

  public resolveSession(rawToken: string, nowUtc: number): PublicUser | null {
    if (!rawToken || rawToken.length < 16) return null;
    const tokenHash = hashSessionToken(rawToken);
    const row = this.db
      .prepare(
        `SELECT u.user_id, u.username, u.display_name, s.expires_at_utc
         FROM user_sessions s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | { user_id: string; username: string; display_name: string; expires_at_utc: number }
      | undefined;

    if (!row) return null;
    if (row.expires_at_utc <= nowUtc) {
      this.db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }

    return {
      userId: UserIdSchema.parse(row.user_id),
      username: row.username,
      displayName: row.display_name,
    };
  }

  public revokeSession(rawToken: string): void {
    const tokenHash = hashSessionToken(rawToken);
    this.db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
  }

  // ---------------------------------------------------------------------------
  // P02-01: Two-Slot Match Rooms (NORTH / SOUTH), Invite Code, Ready, Start, Surrender
  // ---------------------------------------------------------------------------

  private hydrateRoomSummary(row: RawRoomRow, viewerUserId: UserId | null): MatchRoomSummary {
    const getUserName = this.db.prepare('SELECT display_name FROM users WHERE user_id = ?');
    const northUser = row.north_user_id
      ? (getUserName.get(row.north_user_id) as { display_name: string } | undefined)
      : undefined;
    const southUser = row.south_user_id
      ? (getUserName.get(row.south_user_id) as { display_name: string } | undefined)
      : undefined;

    let viewerSlot: HumanSlot | null = null;
    if (viewerUserId && row.north_user_id === viewerUserId) viewerSlot = 'NORTH';
    if (viewerUserId && row.south_user_id === viewerUserId) viewerSlot = 'SOUTH';

    return {
      matchId: MatchIdSchema.parse(row.match_id),
      inviteCode: row.invite_code,
      title: row.title,
      status: row.status,
      lockedAtUtc: row.locked_at_utc !== null ? asUtcEpochMs(row.locked_at_utc) : null,
      winnerSlot: row.winner_slot,
      endedReason: row.ended_reason,
      slots: {
        NORTH: {
          slot: 'NORTH',
          userId: row.north_user_id ? UserIdSchema.parse(row.north_user_id) : null,
          displayName: northUser?.display_name ?? null,
          actorId: WORLD_ACTORS.north,
          nationId: WORLD_NATIONS.north,
          ready: row.north_ready === 1,
        },
        SOUTH: {
          slot: 'SOUTH',
          userId: row.south_user_id ? UserIdSchema.parse(row.south_user_id) : null,
          displayName: southUser?.display_name ?? null,
          actorId: WORLD_ACTORS.south,
          nationId: WORLD_NATIONS.south,
          ready: row.south_ready === 1,
        },
      },
      viewerSlot,
      viewerActorId:
        viewerSlot === 'NORTH'
          ? WORLD_ACTORS.north
          : viewerSlot === 'SOUTH'
            ? WORLD_ACTORS.south
            : null,
      viewerNationId:
        viewerSlot === 'NORTH'
          ? WORLD_NATIONS.north
          : viewerSlot === 'SOUTH'
            ? WORLD_NATIONS.south
            : null,
      createdAtUtc: asUtcEpochMs(row.created_at_utc),
      updatedAtUtc: asUtcEpochMs(row.updated_at_utc),
    };
  }

  public createRoom(options: {
    creator: PublicUser;
    title: string;
    preferredSlot: HumanSlot;
    nowUtc: number;
    mode: 'PRODUCTION_REALTIME' | 'PREVIEW_FIXTURE';
  }): { room: MatchRoomSummary; state: MatchState; stateHash: string } {
    const matchId = MatchIdSchema.parse(`mch_${crypto.randomBytes(6).toString('hex')}`);
    const inviteCode = generateInviteCode();
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    const initialState = createWorld72MatchState({
      matchId,
      title: options.title,
      seed,
      createdAtUtc: options.nowUtc,
      mode: options.mode,
    });
    const stateHash = computeStateHash(initialState);
    const stateJson = canonicalStringify(initialState);

    const northUserId = options.preferredSlot === 'NORTH' ? options.creator.userId : null;
    const southUserId = options.preferredSlot === 'SOUTH' ? options.creator.userId : null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO matches (
            match_id, schema_version, title, mode, version,
            initial_state_json, current_state_json, state_hash,
            created_at_utc, updated_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          initialState.matchId,
          initialState.schemaVersion,
          initialState.title,
          initialState.config.mode,
          initialState.version,
          stateJson,
          stateJson,
          stateHash,
          initialState.createdAtUtc,
          initialState.currentUtc
        );

      this.db
        .prepare(
          `INSERT INTO match_rooms (
            match_id, invite_code, title, status, created_by_user_id,
            north_user_id, south_user_id, north_ready, south_ready,
            winner_slot, ended_reason, locked_at_utc, created_at_utc, updated_at_utc
          ) VALUES (?, ?, ?, 'LOBBY', ?, ?, ?, 0, 0, NULL, NULL, NULL, ?, ?)`
        )
        .run(
          matchId,
          inviteCode,
          options.title,
          options.creator.userId,
          northUserId,
          southUserId,
          options.nowUtc,
          options.nowUtc
        );

      this.insertSnapshotInternal(matchId, 0, stateHash, stateJson, options.nowUtc);
    });
    tx();

    const row = this.db
      .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
      .get(matchId) as RawRoomRow;

    return {
      room: this.hydrateRoomSummary(row, options.creator.userId),
      state: initialState,
      stateHash,
    };
  }

  public listRoomsForUser(userId: UserId): MatchRoomSummary[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM match_rooms
         WHERE north_user_id = ? OR south_user_id = ?
         ORDER BY updated_at_utc DESC`
      )
      .all(userId, userId) as RawRoomRow[];
    return rows.map((r) => this.hydrateRoomSummary(r, userId));
  }

  public getRoomForUser(matchId: MatchId, userId: UserId): RoomActionResult<{ room: MatchRoomSummary }> {
    const row = this.db
      .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
      .get(matchId) as RawRoomRow | undefined;

    if (!row) {
      return {
        ok: false,
        status: 404,
        code: 'ROOM_NOT_FOUND',
        reason: `Không tìm thấy phòng đấu "${matchId}".`,
      };
    }

    if (row.north_user_id !== userId && row.south_user_id !== userId) {
      return {
        ok: false,
        status: 403,
        code: 'NOT_ROOM_MEMBER',
        reason: 'Bạn không thuộc 2 slot người chơi (Bắc / Nam) của phòng đấu này.',
      };
    }

    return { ok: true, room: this.hydrateRoomSummary(row, userId) };
  }

  public joinRoomByInviteCode(options: {
    user: PublicUser;
    inviteCode: string;
    preferredSlot?: HumanSlot;
    nowUtc: number;
  }): RoomActionResult<{ room: MatchRoomSummary; reconnected: boolean }> {
    const code = options.inviteCode.trim().toUpperCase();

    const tx = this.db.transaction(
      (): RoomActionResult<{ room: MatchRoomSummary; reconnected: boolean }> => {
        const row = this.db
          .prepare('SELECT * FROM match_rooms WHERE invite_code = ?')
          .get(code) as RawRoomRow | undefined;

        if (!row) {
          return {
            ok: false,
            status: 404,
            code: 'INVITE_NOT_FOUND',
            reason: `Mã mời "${code}" không tồn tại.`,
          };
        }

        // Reconnect: existing member ALWAYS keeps their original slot (even after start!)
        if (row.north_user_id === options.user.userId || row.south_user_id === options.user.userId) {
          return {
            ok: true,
            room: this.hydrateRoomSummary(row, options.user.userId),
            reconnected: true,
          };
        }

        // Slots are locked once match starts or ends
        if (row.status !== 'LOBBY' || row.locked_at_utc !== null) {
          return {
            ok: false,
            status: 403,
            code: 'SLOTS_LOCKED',
            reason: 'Phòng đấu đã bắt đầu và khóa chặt 2 slot Bắc / Nam; người ngoài không thể tham gia.',
          };
        }

        // Both human slots occupied -> reject 3rd player strictly
        if (row.north_user_id !== null && row.south_user_id !== null) {
          return {
            ok: false,
            status: 403,
            code: 'ROOM_FULL',
            reason: 'Phòng đấu đã đủ đúng 2 người chơi thật (Bắc / Nam); người thứ ba bị từ chối.',
          };
        }

        let assignedSlot: HumanSlot;
        if (options.preferredSlot === 'NORTH') {
          if (row.north_user_id !== null) {
            return {
              ok: false,
              status: 409,
              code: 'SLOT_TAKEN',
              reason: 'Slot Phương Bắc đã có người giữ; hãy chọn Phương Nam.',
            };
          }
          assignedSlot = 'NORTH';
        } else if (options.preferredSlot === 'SOUTH') {
          if (row.south_user_id !== null) {
            return {
              ok: false,
              status: 409,
              code: 'SLOT_TAKEN',
              reason: 'Slot Phương Nam đã có người giữ; hãy chọn Phương Bắc.',
            };
          }
          assignedSlot = 'SOUTH';
        } else {
          assignedSlot = row.north_user_id === null ? 'NORTH' : 'SOUTH';
        }

        if (assignedSlot === 'NORTH') {
          this.db
            .prepare(
              'UPDATE match_rooms SET north_user_id = ?, north_ready = 0, updated_at_utc = ? WHERE match_id = ?'
            )
            .run(options.user.userId, options.nowUtc, row.match_id);
        } else {
          this.db
            .prepare(
              'UPDATE match_rooms SET south_user_id = ?, south_ready = 0, updated_at_utc = ? WHERE match_id = ?'
            )
            .run(options.user.userId, options.nowUtc, row.match_id);
        }

        const updated = this.db
          .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
          .get(row.match_id) as RawRoomRow;

        return {
          ok: true,
          room: this.hydrateRoomSummary(updated, options.user.userId),
          reconnected: false,
        };
      }
    );

    return tx();
  }

  public setPlayerReady(
    matchId: MatchId,
    userId: UserId,
    ready: boolean,
    nowUtc: number
  ): RoomActionResult<{ room: MatchRoomSummary }> {
    const tx = this.db.transaction((): RoomActionResult<{ room: MatchRoomSummary }> => {
      const row = this.db
        .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
        .get(matchId) as RawRoomRow | undefined;

      if (!row) {
        return { ok: false, status: 404, code: 'ROOM_NOT_FOUND', reason: 'Không tìm thấy phòng đấu.' };
      }
      if (row.status !== 'LOBBY') {
        return {
          ok: false,
          status: 409,
          code: 'ROOM_ALREADY_STARTED',
          reason: 'Phòng đấu đã bắt đầu hoặc kết thúc; không thể thay đổi trạng thái Ready.',
        };
      }

      if (row.north_user_id === userId) {
        this.db
          .prepare('UPDATE match_rooms SET north_ready = ?, updated_at_utc = ? WHERE match_id = ?')
          .run(ready ? 1 : 0, nowUtc, matchId);
      } else if (row.south_user_id === userId) {
        this.db
          .prepare('UPDATE match_rooms SET south_ready = ?, updated_at_utc = ? WHERE match_id = ?')
          .run(ready ? 1 : 0, nowUtc, matchId);
      } else {
        return {
          ok: false,
          status: 403,
          code: 'NOT_ROOM_MEMBER',
          reason: 'Chỉ thành viên thuộc slot Bắc hoặc Nam mới được xác nhận Ready.',
        };
      }

      const updated = this.db
        .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
        .get(matchId) as RawRoomRow;
      return { ok: true, room: this.hydrateRoomSummary(updated, userId) };
    });

    return tx();
  }

  public startRoom(
    matchId: MatchId,
    userId: UserId,
    nowUtc: number
  ): RoomActionResult<{ room: MatchRoomSummary }> {
    const tx = this.db.transaction((): RoomActionResult<{ room: MatchRoomSummary }> => {
      const row = this.db
        .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
        .get(matchId) as RawRoomRow | undefined;

      if (!row) {
        return { ok: false, status: 404, code: 'ROOM_NOT_FOUND', reason: 'Không tìm thấy phòng đấu.' };
      }
      if (row.north_user_id !== userId && row.south_user_id !== userId) {
        return {
          ok: false,
          status: 403,
          code: 'NOT_ROOM_MEMBER',
          reason: 'Bạn không thuộc phòng đấu này.',
        };
      }
      if (row.status !== 'LOBBY') {
        return {
          ok: false,
          status: 409,
          code: 'ROOM_ALREADY_STARTED',
          reason: 'Phòng đấu đã được khởi chạy trước đó.',
        };
      }
      if (!row.north_user_id || !row.south_user_id) {
        return {
          ok: false,
          status: 422,
          code: 'SLOTS_INCOMPLETE',
          reason: 'Cần đủ đúng 2 người chơi thật ở slot Bắc và Nam trước khi bắt đầu.',
        };
      }
      if (row.north_ready !== 1 || row.south_ready !== 1) {
        return {
          ok: false,
          status: 422,
          code: 'PLAYERS_NOT_READY',
          reason: 'Cả hai người chơi Bắc và Nam phải xác nhận Ready trước khi bắt đầu.',
        };
      }

      this.db
        .prepare(
          `UPDATE match_rooms
           SET status = 'ACTIVE', locked_at_utc = ?, updated_at_utc = ?
           WHERE match_id = ?`
        )
        .run(nowUtc, nowUtc, matchId);

      this.db
        .prepare(
          `INSERT INTO scheduled_ticks (match_id, last_tick_utc, tick_count)
           VALUES (?, ?, 0)
           ON CONFLICT(match_id) DO UPDATE SET last_tick_utc = excluded.last_tick_utc`
        )
        .run(matchId, nowUtc);

      const updated = this.db
        .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
        .get(matchId) as RawRoomRow;
      return { ok: true, room: this.hydrateRoomSummary(updated, userId) };
    });

    return tx();
  }

  public surrenderRoom(
    matchId: MatchId,
    userId: UserId,
    nowUtc: number
  ): RoomActionResult<{ room: MatchRoomSummary }> {
    const tx = this.db.transaction((): RoomActionResult<{ room: MatchRoomSummary }> => {
      const row = this.db
        .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
        .get(matchId) as RawRoomRow | undefined;

      if (!row) {
        return { ok: false, status: 404, code: 'ROOM_NOT_FOUND', reason: 'Không tìm thấy phòng đấu.' };
      }
      if (row.status !== 'ACTIVE') {
        return {
          ok: false,
          status: 409,
          code: 'MATCH_NOT_ACTIVE',
          reason: 'Chỉ có thể đầu hàng (surrender) khi phòng đấu đang ở trạng thái ACTIVE.',
        };
      }

      let winnerSlot: HumanSlot;
      if (row.north_user_id === userId) {
        winnerSlot = 'SOUTH';
      } else if (row.south_user_id === userId) {
        winnerSlot = 'NORTH';
      } else {
        return {
          ok: false,
          status: 403,
          code: 'NOT_ROOM_MEMBER',
          reason: 'Bạn không thuộc 2 slot người chơi của phòng đấu này.',
        };
      }

      this.db
        .prepare(
          `UPDATE match_rooms
           SET status = 'ENDED', winner_slot = ?, ended_reason = 'SURRENDER', updated_at_utc = ?
           WHERE match_id = ?`
        )
        .run(winnerSlot, nowUtc, matchId);

      const updated = this.db
        .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
        .get(matchId) as RawRoomRow;
      return { ok: true, room: this.hydrateRoomSummary(updated, userId) };
    });

    return tx();
  }

  public getRoomRow(matchId: MatchId): RawRoomRow | null {
    const row = this.db
      .prepare('SELECT * FROM match_rooms WHERE match_id = ?')
      .get(matchId) as RawRoomRow | undefined;
    return row ?? null;
  }

  public getUserSlotInRoom(
    matchId: MatchId,
    userId: UserId
  ): { slot: HumanSlot; actorId: typeof WORLD_ACTORS.north | typeof WORLD_ACTORS.south; nationId: typeof WORLD_NATIONS.north | typeof WORLD_NATIONS.south; status: RoomStatus } | null {
    const row = this.getRoomRow(matchId);
    if (!row) return null;
    if (row.north_user_id === userId) {
      return {
        slot: 'NORTH',
        actorId: ActorIdSchema.parse(WORLD_ACTORS.north),
        nationId: NationIdSchema.parse(WORLD_NATIONS.north),
        status: row.status,
      };
    }
    if (row.south_user_id === userId) {
      return {
        slot: 'SOUTH',
        actorId: ActorIdSchema.parse(WORLD_ACTORS.south),
        nationId: NationIdSchema.parse(WORLD_NATIONS.south),
        status: row.status,
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // P02-02: Worker Locks, Snapshots, Backup & Restore, Delta Event Queries
  // ---------------------------------------------------------------------------

  private insertSnapshotInternal(
    matchId: MatchId,
    version: number,
    stateHash: string,
    stateJson: string,
    nowUtc: number
  ): void {
    const snapshotId = `snp_${matchId}_v${version}_${nowUtc}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO match_snapshots (snapshot_id, match_id, version, state_hash, state_json, created_at_utc)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(snapshotId, matchId, version, stateHash, stateJson, nowUtc);
  }

  public listSnapshots(matchId: MatchId): MatchSnapshotRecord[] {
    const rows = this.db
      .prepare(
        `SELECT snapshot_id, match_id, version, state_hash, created_at_utc
         FROM match_snapshots
         WHERE match_id = ?
         ORDER BY version DESC`
      )
      .all(matchId) as {
      snapshot_id: string;
      match_id: string;
      version: number;
      state_hash: string;
      created_at_utc: number;
    }[];

    return rows.map((r) => ({
      snapshotId: r.snapshot_id,
      matchId: MatchIdSchema.parse(r.match_id),
      version: r.version,
      stateHash: r.state_hash,
      createdAtUtc: r.created_at_utc,
    }));
  }

  public acquireMatchWorkerLock(
    matchId: MatchId,
    ownerId: string,
    nowUtc: number,
    leaseMs: number
  ): boolean {
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT owner_id, lease_until_utc FROM match_worker_locks WHERE match_id = ?')
        .get(matchId) as { owner_id: string; lease_until_utc: number } | undefined;

      if (existing && existing.owner_id !== ownerId && existing.lease_until_utc > nowUtc) {
        return false;
      }

      this.db
        .prepare(
          `INSERT INTO match_worker_locks (match_id, owner_id, lease_until_utc, updated_at_utc)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(match_id) DO UPDATE SET
             owner_id = excluded.owner_id,
             lease_until_utc = excluded.lease_until_utc,
             updated_at_utc = excluded.updated_at_utc`
        )
        .run(matchId, ownerId, nowUtc + leaseMs, nowUtc);
      return true;
    });
    return tx();
  }

  public releaseMatchWorkerLock(matchId: MatchId, ownerId: string): void {
    this.db
      .prepare('DELETE FROM match_worker_locks WHERE match_id = ? AND owner_id = ?')
      .run(matchId, ownerId);
  }

  public listSchedulableMatchIds(): MatchId[] {
    // Active multiplayer rooms + any preview fixture matches that have scheduled jobs
    const rows = this.db
      .prepare(
        `SELECT m.match_id
         FROM matches m
         LEFT JOIN match_rooms r ON r.match_id = m.match_id
         WHERE r.status = 'ACTIVE' OR r.match_id IS NULL
         ORDER BY m.created_at_utc ASC`
      )
      .all() as { match_id: string }[];
    return rows.map((r) => MatchIdSchema.parse(r.match_id));
  }

  public recordTickCompleted(matchId: MatchId, tickUtc: number): void {
    this.db
      .prepare(
        `INSERT INTO scheduled_ticks (match_id, last_tick_utc, tick_count)
         VALUES (?, ?, 1)
         ON CONFLICT(match_id) DO UPDATE SET
           last_tick_utc = excluded.last_tick_utc,
           tick_count = scheduled_ticks.tick_count + 1`
      )
      .run(matchId, tickUtc);
  }

  public getEventsSince(matchId: MatchId, sinceSequence: number): DomainEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_json FROM event_log
         WHERE match_id = ? AND sequence > ?
         ORDER BY sequence ASC`
      )
      .all(matchId, sinceSequence) as { event_json: string }[];

    return rows.map((r) => DomainEventSchema.parse(JSON.parse(r.event_json)));
  }

  public exportMatchBackup(matchId: MatchId, nowUtc: number): MatchBackupBundle | null {
    const matchRow = this.db
      .prepare('SELECT initial_state_json, version, state_hash FROM matches WHERE match_id = ?')
      .get(matchId) as
      | { initial_state_json: string; version: number; state_hash: string }
      | undefined;

    if (!matchRow) return null;

    const initialState = MatchStateSchema.parse(JSON.parse(matchRow.initial_state_json));
    const logRows = this.db
      .prepare(
        `SELECT command_json, applied_at_utc
         FROM command_log
         WHERE match_id = ?
         ORDER BY id ASC`
      )
      .all(matchId) as { command_json: string; applied_at_utc: number }[];

    return {
      backupVersion: '1.0.0',
      matchId,
      exportedAtUtc: nowUtc,
      version: matchRow.version,
      stateHash: matchRow.state_hash,
      initialState,
      commandLog: logRows.map((r) => ({
        command: CommandSchema.parse(JSON.parse(r.command_json)),
        appliedAtUtc: r.applied_at_utc,
      })),
      snapshots: this.listSnapshots(matchId),
    };
  }

  /**
   * Verifies backup integrity via full deterministic replay before atomically restoring into SQLite.
   */
  public restoreMatchBackup(
    bundle: MatchBackupBundle,
    nowUtc: number
  ): { restoredMatchId: MatchId; version: number; stateHash: string } {
    const initialState = MatchStateSchema.parse(bundle.initialState);
    const replayEntries: ReplayLogEntry[] = bundle.commandLog.map((entry) => ({
      command: CommandSchema.parse(entry.command),
      appliedAtUtc: asUtcEpochMs(entry.appliedAtUtc),
    }));

    const replayed = replayCommandLog(initialState, replayEntries);
    if (replayed.finalHash !== bundle.stateHash) {
      throw new Error(
        `Backup integrity check failed: replayed hash ${replayed.finalHash} !== expected ${bundle.stateHash}`
      );
    }

    const initialJson = canonicalStringify(initialState);
    const finalJson = canonicalStringify(replayed.finalState);

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM command_log WHERE match_id = ?').run(bundle.matchId);
      this.db.prepare('DELETE FROM event_log WHERE match_id = ?').run(bundle.matchId);
      this.db.prepare('DELETE FROM match_snapshots WHERE match_id = ?').run(bundle.matchId);

      const exists = this.db
        .prepare('SELECT match_id FROM matches WHERE match_id = ?')
        .get(bundle.matchId);

      if (exists) {
        this.db
          .prepare(
            `UPDATE matches
             SET schema_version = ?, title = ?, mode = ?, version = ?,
                 initial_state_json = ?, current_state_json = ?, state_hash = ?,
                 created_at_utc = ?, updated_at_utc = ?
             WHERE match_id = ?`
          )
          .run(
            replayed.finalState.schemaVersion,
            replayed.finalState.title,
            replayed.finalState.config.mode,
            replayed.finalState.version,
            initialJson,
            finalJson,
            replayed.finalHash,
            replayed.finalState.createdAtUtc,
            replayed.finalState.currentUtc,
            bundle.matchId
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO matches (
              match_id, schema_version, title, mode, version,
              initial_state_json, current_state_json, state_hash,
              created_at_utc, updated_at_utc
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            bundle.matchId,
            replayed.finalState.schemaVersion,
            replayed.finalState.title,
            replayed.finalState.config.mode,
            replayed.finalState.version,
            initialJson,
            finalJson,
            replayed.finalHash,
            replayed.finalState.createdAtUtc,
            replayed.finalState.currentUtc
          );
      }

      const insertCmd = this.db.prepare(
        `INSERT INTO command_log (
          match_id, command_id, actor_id, idempotency_key,
          sequence, expected_version, applied_version, applied_at_utc,
          command_json, payload_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const entry of replayEntries) {
        const receipt = replayed.finalState.idempotencyReceipts[entry.command.idempotencyKey];
        insertCmd.run(
          bundle.matchId,
          entry.command.commandId,
          entry.command.actorId,
          entry.command.idempotencyKey,
          entry.command.sequence,
          entry.command.expectedVersion,
          receipt?.appliedVersion ?? entry.command.expectedVersion + 1,
          entry.appliedAtUtc,
          canonicalStringify(entry.command),
          receipt?.payloadDigest ?? ''
        );
      }

      const insertEvt = this.db.prepare(
        `INSERT INTO event_log (
          match_id, event_id, sequence, occurred_at_utc,
          tie_break_priority, caused_by_command_id, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const ev of replayed.finalState.events) {
        insertEvt.run(
          bundle.matchId,
          ev.eventId,
          ev.sequence,
          ev.occurredAtUtc,
          ev.tieBreakPriority,
          ev.causedByCommandId,
          canonicalStringify(ev)
        );
      }

      this.insertSnapshotInternal(
        bundle.matchId,
        replayed.finalState.version,
        replayed.finalHash,
        finalJson,
        nowUtc
      );
    });
    tx();

    return {
      restoredMatchId: bundle.matchId,
      version: replayed.finalState.version,
      stateHash: replayed.finalHash,
    };
  }

  // ---------------------------------------------------------------------------
  // Existing P01 Match Operations (100% backward-compatible)
  // ---------------------------------------------------------------------------

  public listMatches(): PersistedMatchSummary[] {
    const rows = this.db
      .prepare(
        `SELECT match_id, title, mode, schema_version, version, state_hash, created_at_utc, updated_at_utc
         FROM matches
         ORDER BY updated_at_utc DESC`
      )
      .all() as {
      match_id: string;
      title: string;
      mode: string;
      schema_version: string;
      version: number;
      state_hash: string;
      created_at_utc: number;
      updated_at_utc: number;
    }[];

    return rows.map((row) => ({
      matchId: row.match_id as MatchId,
      title: row.title,
      mode: row.mode,
      schemaVersion: row.schema_version,
      version: row.version,
      stateHash: row.state_hash,
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
    }));
  }

  public getMatch(matchId: MatchId): { state: MatchState; stateHash: string } | null {
    const row = this.db
      .prepare('SELECT current_state_json, state_hash FROM matches WHERE match_id = ?')
      .get(matchId) as { current_state_json: string; state_hash: string } | undefined;

    if (!row) {
      return null;
    }

    const parsed = MatchStateSchema.parse(JSON.parse(row.current_state_json));
    return {
      state: parsed,
      stateHash: row.state_hash,
    };
  }

  public saveInitialMatch(
    initialState: MatchState,
    options?: { overwrite?: boolean }
  ): { state: MatchState; stateHash: string } {
    assertSimulationInvariants(initialState);
    const stateHash = computeStateHash(initialState);
    const stateJson = canonicalStringify(initialState);

    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT match_id FROM matches WHERE match_id = ?')
        .get(initialState.matchId);

      if (existing) {
        if (!options?.overwrite) {
          return;
        }
        this.db.prepare('DELETE FROM command_log WHERE match_id = ?').run(initialState.matchId);
        this.db.prepare('DELETE FROM event_log WHERE match_id = ?').run(initialState.matchId);
        this.db.prepare('DELETE FROM match_snapshots WHERE match_id = ?').run(initialState.matchId);
        this.db.prepare('DELETE FROM matches WHERE match_id = ?').run(initialState.matchId);
      }

      this.db
        .prepare(
          `INSERT INTO matches (
            match_id, schema_version, title, mode, version,
            initial_state_json, current_state_json, state_hash,
            created_at_utc, updated_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          initialState.matchId,
          initialState.schemaVersion,
          initialState.title,
          initialState.config.mode,
          initialState.version,
          stateJson,
          stateJson,
          stateHash,
          initialState.createdAtUtc,
          initialState.currentUtc
        );

      this.insertSnapshotInternal(
        initialState.matchId,
        initialState.version,
        stateHash,
        stateJson,
        initialState.createdAtUtc
      );
    });

    tx();

    const loaded = this.getMatch(initialState.matchId);
    if (!loaded) {
      throw new Error(`Failed to persist match "${initialState.matchId}"`);
    }
    return loaded;
  }

  public executeCommand(
    matchId: MatchId,
    command: Command,
    clock: SimulationClock
  ): { found: false } | { found: true; result: ReduceResult } {
    const runTx = this.db.transaction(
      (): { found: false } | { found: true; result: ReduceResult } => {
        const row = this.db
          .prepare('SELECT current_state_json FROM matches WHERE match_id = ?')
          .get(matchId) as { current_state_json: string } | undefined;

        if (!row) {
          return { found: false };
        }

        const currentState = MatchStateSchema.parse(JSON.parse(row.current_state_json));
        const appliedAtUtc: UtcEpochMs = clock.nowUtc();
        const pinnedClock: SimulationClock = { nowUtc: () => appliedAtUtc };

        const result = reduceCommand(currentState, command, pinnedClock);
        if (!result.ok || result.idempotentDuplicate) {
          return { found: true, result };
        }

        const nextStateJson = canonicalStringify(result.nextState);

        this.db
          .prepare(
            `UPDATE matches
             SET version = ?, current_state_json = ?, state_hash = ?, updated_at_utc = ?
             WHERE match_id = ?`
          )
          .run(
            result.nextState.version,
            nextStateJson,
            result.stateHash,
            result.nextState.currentUtc,
            matchId
          );

        this.db
          .prepare(
            `INSERT INTO command_log (
              match_id, command_id, actor_id, idempotency_key,
              sequence, expected_version, applied_version, applied_at_utc,
              command_json, payload_digest
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            matchId,
            command.commandId,
            command.actorId,
            command.idempotencyKey,
            command.sequence,
            command.expectedVersion,
            result.nextState.version,
            appliedAtUtc,
            canonicalStringify(command),
            result.receipt.payloadDigest
          );

        const insertEvent = this.db.prepare(
          `INSERT INTO event_log (
            match_id, event_id, sequence, occurred_at_utc,
            tie_break_priority, caused_by_command_id, event_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        for (const event of result.emittedEvents) {
          insertEvent.run(
            matchId,
            event.eventId,
            event.sequence,
            event.occurredAtUtc,
            event.tieBreakPriority,
            event.causedByCommandId,
            canonicalStringify(event)
          );
        }

        // Write periodic transactional snapshot for fast recovery
        if (result.nextState.version % SNAPSHOT_EVERY_N_VERSIONS === 0) {
          this.insertSnapshotInternal(
            matchId,
            result.nextState.version,
            result.stateHash,
            nextStateJson,
            appliedAtUtc
          );
        }

        return { found: true, result };
      }
    );

    return runTx();
  }

  public verifyMatchReplay(matchId: MatchId): ReplayCheckReport | null {
    const matchRow = this.db
      .prepare('SELECT initial_state_json, state_hash, version FROM matches WHERE match_id = ?')
      .get(matchId) as
      | { initial_state_json: string; state_hash: string; version: number }
      | undefined;

    if (!matchRow) {
      return null;
    }

    const initialState = MatchStateSchema.parse(JSON.parse(matchRow.initial_state_json));
    const logRows = this.db
      .prepare(
        `SELECT command_json, applied_at_utc
         FROM command_log
         WHERE match_id = ?
         ORDER BY id ASC`
      )
      .all(matchId) as { command_json: string; applied_at_utc: number }[];

    const entries: ReplayLogEntry[] = logRows.map((r) => ({
      command: CommandSchema.parse(JSON.parse(r.command_json)),
      appliedAtUtc: asUtcEpochMs(r.applied_at_utc),
    }));

    const replayed = replayCommandLog(initialState, entries);
    return {
      matchId,
      verified: replayed.finalHash === matchRow.state_hash,
      storedHash: matchRow.state_hash,
      replayedHash: replayed.finalHash,
      replayedCommandCount: replayed.replayedCount,
      version: matchRow.version,
    };
  }

  public close(): void {
    this.db.close();
  }
}
