import express, { Express, Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  APP_VERSION,
  asUtcEpochMs,
  Command,
  CONTRACT_SCHEMA_VERSION,
  ContractValidationError,
  CreateRoomPayloadSchema,
  DomainEvent,
  HumanSlot,
  IncompatibleSchemaVersionError,
  JoinRoomPayloadSchema,
  LoginPayloadSchema,
  MatchDeltaEnvelopeSchema,
  MatchId,
  MatchIdSchema,
  NationId,
  parseCommand,
  projectMatchForClient,
  projectMatchForViewer,
  projectRoomEventsForViewer,
  PublicUser,
  REALTIME_SECONDS_PER_GAME_DAY,
  RegisterPayloadSchema,
  RegionIdSchema,
  UnitIdSchema,
  SIMULATION_ENGINE_VERSION,
  ToggleReadyPayloadSchema,
} from '../contracts';
import { createTwoFactionFictionalFixture } from '../content/fictionalFixture';
import { WORLD_GEO_LAYERS, WORLD_MAP_72_GEOJSON } from '../content/worldMap72';
import {
  computeNationEconomicForecast,
  computePhase03NationReport,
  SimulationClock,
} from '../simulation';
import { ServerConfig } from './config';
import { SqliteMatchStore } from './db/sqliteStore';
import { SlidingWindowRateLimiter } from './rateLimiter';
import { MatchClockScheduler } from './scheduler';
import { scenarioRoute } from '../simulation/movementRoute';

export interface ServerRateLimitConfig {
  readonly authMaxPerMin?: number;
  readonly commandMaxPerMin?: number;
  readonly wsMaxPer10s?: number;
}



export interface ServerRuntime {
  readonly app: Express;
  readonly httpServer: http.Server;
  readonly wss: WebSocketServer;
  readonly store: SqliteMatchStore;
  readonly scheduler: MatchClockScheduler;
  broadcast(message: Record<string, unknown>): void;
  close(): Promise<void>;
}

interface SocketRoomSession {
  token: string;
  user: PublicUser;
  matchId: MatchId;
  slot: HumanSlot;
  nationId: NationId;
}

function createRealSystemClock(): SimulationClock {
  return {
    nowUtc: () => asUtcEpochMs(Date.now()),
  };
}

function mapRejectionToHttpStatus(code: string): number {
  switch (code) {
    case 'UNAUTHORIZED_ACTOR':
      return 401;
    case 'FORBIDDEN_ACTION':
      return 403;
    case 'VERSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'DUPLICATE_ENTITY':
      return 409;
    case 'INCOMPATIBLE_SCHEMA_VERSION':
    case 'INSUFFICIENT_RESOURCES':
    case 'INVALID_SEQUENCE':
    case 'INVALID_TARGET':
    case 'INVALID_TIME_PROGRESSION':
    case 'MATCH_ID_MISMATCH':
      return 422;
    default:
      return 400;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function checkCommandNationOwnership(
  command: Command,
  memberNationId: NationId
): { ok: true } | { ok: false; code: string; reason: string } {
  switch (command.payload.type) {
    case 'ADVANCE_REALTIME_TICK':
      return {
        ok: false,
        code: 'FORBIDDEN_SYSTEM_COMMAND',
        reason: 'Người chơi không được phép gửi lệnh tua/đẩy đồng hồ server.',
      };
    case 'TRANSFER_RESOURCE':
      if (command.payload.fromNationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền chuyển tài nguyên từ quốc gia "${memberNationId}", không thể mạo danh "${command.payload.fromNationId}".`,
        };
      }
      return { ok: true };
    case 'SCHEDULE_JOB':
      if (command.payload.nationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền đặt lịch tác vụ cho "${memberNationId}", không thể mạo danh "${command.payload.nationId}".`,
        };
      }
      return { ok: true };
    case 'ENACT_POLICY':
      if (command.payload.nationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền ban hành chính sách cho "${memberNationId}", không thể mạo danh "${command.payload.nationId}".`,
        };
      }
      return { ok: true };
    case 'PROPOSE_TREATY':
      if (command.payload.proposerNationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền đề xuất hiệp ước với tư cách "${memberNationId}", không thể mạo danh "${command.payload.proposerNationId}".`,
        };
      }
      return { ok: true };
    case 'UPDATE_INTEL_PACT':
    case 'ORDER_MARCH':
    case 'REROUTE_MARCH':
    case 'HALT_MARCH':
    case 'MOVE_UNIT':
      if(command.payload.type==='MOVE_UNIT')return {ok:false,code:'USE_MARCH_ORDER',reason:'Phòng trực tuyến sử dụng lệnh hành quân theo đồng hồ máy chủ.'};
      // Unit ownership is further verified against actor.nationId inside reduceCommand
      return { ok: true };
    case 'SET_TAX_RATE':
      if (command.payload.nationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền điều chỉnh thuế suất cho "${memberNationId}", không thể mạo danh "${command.payload.nationId}".`,
        };
      }
      return { ok: true };
    case 'CANCEL_JOB':
      if (command.payload.nationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền hủy tác vụ của "${memberNationId}", không thể mạo danh "${command.payload.nationId}".`,
        };
      }
      return { ok: true };
    case 'RESERVE_RESOURCES':
    case 'COMMIT_RESERVATION':
    case 'RELEASE_RESERVATION':
    case 'UPDATE_BUDGET_POLICY':
    case 'MANAGE_CREDIT':
    case 'QUEUE_CONSTRUCTION':
    case 'CANCEL_CONSTRUCTION':
    case 'QUEUE_PRODUCTION':
    case 'CANCEL_PRODUCTION':
    case 'TOGGLE_FACILITY_PAUSE':
    case 'CAMPAIGN_START_RESEARCH':
    case 'CAMPAIGN_CANCEL_RESEARCH':
    case 'CAMPAIGN_START_CITY_PROJECT':
    case 'CAMPAIGN_CANCEL_CITY_PROJECT':
    case 'CAMPAIGN_MOVE_UNIT':
    case 'CAMPAIGN_SET_DIPLOMACY':
    case 'CAMPAIGN_GROUP_UNITS':
      if (command.payload.nationId !== memberNationId) {
        return {
          ok: false,
          code: 'FORBIDDEN_NATION_IMPERSONATION',
          reason: `Bạn chỉ có quyền thực hiện lệnh cho "${memberNationId}", không thể mạo danh "${command.payload.nationId}".`,
        };
      }
      return { ok: true };
  }
}

export function createServerRuntime(
  config: ServerConfig,
  store: SqliteMatchStore,
  clock: SimulationClock = createRealSystemClock(),
  rateLimitOverrides?: ServerRateLimitConfig
): ServerRuntime {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const limiter = new SlidingWindowRateLimiter(clock);
  const authMaxPerMin = rateLimitOverrides?.authMaxPerMin ?? 40;
  const commandMaxPerMin = rateLimitOverrides?.commandMaxPerMin ?? 180;
  const wsMaxPer10s = rateLimitOverrides?.wsMaxPer10s ?? 120;

  const clientIpKey = (req: Request): string =>
    (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');

  const checkHttpRateLimit = (
    res: Response,
    bucketKey: string,
    maxRequests: number,
    windowMs: number
  ): boolean => {
    const check = limiter.check(bucketKey, maxRequests, windowMs);
    if (!check.allowed) {
      res.setHeader('Retry-After', String(check.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        reason: `Gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${check.retryAfterSeconds} giây.`,
        retryAfterSeconds: check.retryAfterSeconds,
      });
      return false;
    }
    return true;
  };

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const socketSessions = new Map<WebSocket, SocketRoomSession>();
  let nextWsClientSeq = 0;

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws') {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  const broadcast = (message: Record<string, unknown>): void => {
    const serialized = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  function validSubscription(client: WebSocket, session:SocketRoomSession):boolean{
    if(store.resolveSession(session.token,clock.nowUtc())?.userId===session.user.userId)return true;
    socketSessions.delete(client);client.close(1008,'Session expired');return false;
  }
  const broadcastRoomStatus = (matchId: MatchId): void => {
    const serverUtc = clock.nowUtc();
    for (const [client, session] of socketSessions.entries()) {
      if (client.readyState !== WebSocket.OPEN || session.matchId !== matchId || !validSubscription(client,session)) continue;
      const roomRes = store.getRoomForUser(matchId, session.user.userId);
      if (roomRes.ok) {
        client.send(
          JSON.stringify({
            type: 'room:status',
            matchId,
            room: roomRes.room,
            serverUtc,
          })
        );
      }
    }
  };

  const broadcastRoomDelta = (payload: {
    matchId: MatchId;
    version: number;
    stateHash: string;
    emittedEvents: readonly DomainEvent[];
    fromSequence: number;
    toSequence: number;
  }): void => {
    if (payload.emittedEvents.length === 0) return;
    const serverUtc = clock.nowUtc();
    for (const [client, session] of socketSessions.entries()) {
      if (client.readyState === WebSocket.OPEN && session.matchId === payload.matchId && validSubscription(client,session)) {
        const envelope = MatchDeltaEnvelopeSchema.parse({
          type: 'room:delta',
          matchId: payload.matchId,
          fromSequence: payload.fromSequence,
          toSequence: payload.toSequence,
          version: payload.version,
          stateHash: payload.stateHash,
          events: projectRoomEventsForViewer(payload.emittedEvents, session.nationId),
          serverUtc,
        });
        client.send(JSON.stringify(envelope));
      }
    }
  };

  const scheduler = new MatchClockScheduler(store, clock, {
    onMatchTicked: (tickPayload) => {
      broadcastRoomDelta(tickPayload);
      if (tickPayload.emittedEvents.some((e) => e.payload.type === 'CAMPAIGN_MATCH_ENDED')) {
        broadcastRoomStatus(tickPayload.matchId);
      }
    },
  });

  wss.on('connection', (socket: WebSocket) => {
    nextWsClientSeq += 1;
    const wsBucketKey = `ws:${nextWsClientSeq}`;
    const serverUtc = clock.nowUtc();
    socket.send(
      JSON.stringify({
        type: 'system:connected',
        appVersion: APP_VERSION,
        contractVersion: CONTRACT_SCHEMA_VERSION,
        simulationVersion: SIMULATION_ENGINE_VERSION,
        appEnv: config.appEnv,
        serverUtc,
        activeConnections: wss.clients.size,
      })
    );

    socket.on('close', () => {
      socketSessions.delete(socket);
    });

    socket.on('message', (raw) => {
      const wsCheck = limiter.check(wsBucketKey, wsMaxPer10s, 10_000);
      if (!wsCheck.allowed) {
        socket.send(
          JSON.stringify({
            type: 'room:error',
            code: 'RATE_LIMITED',
            reason: 'Tần suất gói tin WebSocket vượt ngưỡng cho phép.',
          })
        );
        return;
      }
      try {
        const parsed = JSON.parse(String(raw)) as {
          type?: string;
          clientTs?: unknown;
          token?: unknown;
          matchId?: unknown;
          sinceSequence?: unknown;
          fullSnapshot?: unknown;
        };

        if (parsed.type === 'ping') {
          socket.send(
            JSON.stringify({
              type: 'pong',
              clientTs: typeof parsed.clientTs === 'number' ? parsed.clientTs : null,
              serverUtc: clock.nowUtc(),
              activeConnections: wss.clients.size,
            })
          );
          return;
        }

        if (parsed.type === 'room:subscribe') {
          const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
          const user = store.resolveSession(token, clock.nowUtc());
          if (!user) {
            socket.send(
              JSON.stringify({
                type: 'room:error',
                code: 'UNAUTHORIZED',
                reason: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
              })
            );
            return;
          }

          const parsedMatchId = MatchIdSchema.safeParse(parsed.matchId);
          if (!parsedMatchId.success) {
            socket.send(
              JSON.stringify({
                type: 'room:error',
                code: 'INVALID_MATCH_ID',
                reason: 'Match ID không hợp lệ.',
              })
            );
            return;
          }

          const slotInfo = store.getUserSlotInRoom(parsedMatchId.data, user.userId);
          if (!slotInfo) {
            socket.send(
              JSON.stringify({
                type: 'room:error',
                code: 'NOT_ROOM_MEMBER',
                reason: 'Chỉ thành viên thuộc 2 slot Bắc / Nam mới được đồng bộ phòng đấu này.',
              })
            );
            return;
          }

          socketSessions.set(socket, {
            token,
            user,
            matchId: parsedMatchId.data,
            slot: slotInfo.slot,
            nationId: slotInfo.nationId,
          });

          const roomRes = store.getRoomForUser(parsedMatchId.data, user.userId);
          if (roomRes.ok && roomRes.room.status === 'ACTIVE' && roomRes.room.scenarioId === 'vietnam_campaign_v1') {
            scheduler.catchUpMatchIfDue(parsedMatchId.data);
          }
          const loaded = store.getMatch(parsedMatchId.data);
          if (!roomRes.ok || !loaded) {
            socket.send(
              JSON.stringify({
                type: 'room:error',
                code: 'ROOM_NOT_FOUND',
                reason: 'Không tìm thấy trạng thái phòng đấu.',
              })
            );
            return;
          }

          const filtered = projectMatchForViewer(
            loaded.state,
            loaded.stateHash,
            slotInfo.slot,
            slotInfo.nationId
          );

          socket.send(
            JSON.stringify({
              type: 'room:snapshot',
              matchId: parsedMatchId.data,
              room: roomRes.room,
              match: filtered,
              serverUtc: clock.nowUtc(),
            })
          );
          return;
        }

        if (parsed.type === 'room:resync') {
          const session = socketSessions.get(socket);
          if (session && !validSubscription(socket,session))return;
          if (!session) {
            socket.send(
              JSON.stringify({
                type: 'room:error',
                code: 'NOT_SUBSCRIBED',
                reason: 'Cần xác thực room:subscribe trước khi yêu cầu room:resync.',
              })
            );
            return;
          }

          const roomRes = store.getRoomForUser(session.matchId, session.user.userId);
          if (roomRes.ok && roomRes.room.status === 'ACTIVE' && roomRes.room.scenarioId === 'vietnam_campaign_v1') {
            scheduler.catchUpMatchIfDue(session.matchId);
          }
          const loaded = store.getMatch(session.matchId);
          if (!loaded || !roomRes.ok) {
            socket.send(
              JSON.stringify({
                type: 'room:error',
                code: 'ROOM_NOT_FOUND',
                reason: 'Không tìm thấy dữ liệu đồng bộ.',
              })
            );
            return;
          }

          const sinceSeq =
            typeof parsed.sinceSequence === 'number' &&
            Number.isInteger(parsed.sinceSequence) &&
            parsed.sinceSequence >= 0
              ? parsed.sinceSequence
              : null;

          if (sinceSeq !== null && !parsed.fullSnapshot) {
            const missed = store.getEventsSince(session.matchId, sinceSeq);
            if (missed.length > 0) {
              const envelope = MatchDeltaEnvelopeSchema.parse({
                type: 'room:delta',
                matchId: session.matchId,
                fromSequence: missed[0].sequence,
                toSequence: missed[missed.length - 1].sequence,
                version: loaded.state.version,
                stateHash: loaded.stateHash,
                events: projectRoomEventsForViewer(missed,session.nationId),
                serverUtc: clock.nowUtc(),
              });
              socket.send(JSON.stringify(envelope));
              return;
            }
          }

          const filtered = projectMatchForViewer(
            loaded.state,
            loaded.stateHash,
            session.slot,
            session.nationId
          );
          socket.send(
            JSON.stringify({
              type: 'room:snapshot',
              matchId: session.matchId,
              room: roomRes.room,
              match: filtered,
              serverUtc: clock.nowUtc(),
            })
          );
        }
      } catch {
        socket.send(
          JSON.stringify({
            type: 'system:error',
            code: 'INVALID_WS_FRAME',
            reason: 'Malformed JSON WebSocket frame.',
          })
        );
      }
    });
  });

  const requireAuthenticatedUser = (req: Request, res: Response): PublicUser | null => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        reason: 'Thiếu token xác thực (Authorization: Bearer ...).',
      });
      return null;
    }
    const user = store.resolveSession(token, clock.nowUtc());
    if (!user) {
      res.status(401).json({
        ok: false,
        code: 'INVALID_OR_EXPIRED_SESSION',
        reason: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      });
      return null;
    }
    return user;
  };

  // ===========================================================================
  // Phase 01 System & Preview Fixture Routes (100% backward-compatible)
  // ===========================================================================

  // 1. Live System Health & Connection Telemetry (real DB write probe + versions)
  app.get('/api/health', (_req: Request, res: Response) => {
    const serverUtc = clock.nowUtc();
    const probe = store.verifyWritable(serverUtc);
    const migrations = store.getAppliedMigrations();
    const matches = store.listMatches();

    const dbLabel =
      store.dbPath === ':memory:' ? ':memory:' : path.basename(store.dbPath);

    res.status(probe.writable ? 200 : 503).json({
      status: probe.writable ? 'ok' : 'degraded',
      appName: 'VIETNAM: THE DIVIDED NATION',
      appVersion: APP_VERSION,
      contractVersion: CONTRACT_SCHEMA_VERSION,
      simulationVersion: SIMULATION_ENGINE_VERSION,
      appEnv: config.appEnv,
      isProduction: config.isProduction,
      allowPreviewFixture: config.allowPreviewFixture,
      aiApiDependency: false,
      realtimePolicy: {
        secondsPerGameDay: REALTIME_SECONDS_PER_GAME_DAY,
        allowFastForward: false,
      },
      database: {
        engine: 'sqlite',
        writable: probe.writable,
        fileLabel: dbLabel,
        appliedMigrations: migrations.map((m) => m.id),
        matchCount: matches.length,
        error: probe.error ?? null,
      },
      websocket: {
        path: '/ws',
        activeConnections: wss.clients.size,
      },
      serverUtc,
    });
  });

  // 2. List persisted matches (metadata only — zero server secrets)
  app.get('/api/matches', (_req: Request, res: Response) => {
    const matches = store.listMatches().filter(({ matchId }) => !store.getRoomRow(matchId));
    res.json({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      matches,
    });
  });

  // 3. Create or reset two-faction fictional preview fixture (blocked in production)
  app.post('/api/matches/fixture', (req: Request, res: Response) => {
    if (!config.allowPreviewFixture || config.isProduction) {
      res.status(403).json({
        ok: false,
        code: 'PREVIEW_FIXTURE_DISABLED',
        reason: 'Khởi tạo fixture hư cấu bị khóa trong môi trường production.',
      });
      return;
    }

    const overwrite = Boolean((req.body as { reset?: unknown } | undefined)?.reset === true);
    const createdAtUtc = clock.nowUtc();
    const initialState = createTwoFactionFictionalFixture({
      createdAtUtc,
    });

    const persisted = store.saveInitialMatch(initialState, { overwrite });
    const clientView = projectMatchForClient(persisted.state, persisted.stateHash);

    broadcast({
      type: 'match:updated',
      matchId: clientView.matchId,
      version: clientView.version,
      stateHash: clientView.stateHash,
      emittedEvents: [],
      serverUtc: clock.nowUtc(),
    });

    res.status(201).json({
      ok: true,
      match: clientView,
    });
  });

  // 4. Get single match projected safely for client (strips serverPrivate secrets)
  app.get('/api/matches/:matchId', (req: Request, res: Response) => {
    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_MATCH_ID',
        reason: 'Match ID không đúng định dạng hợp đồng.',
      });
      return;
    }

    const loaded = store.getRoomRow(parsedId.data) ? null : store.getMatch(parsedId.data);
    if (!loaded) {
      res.status(404).json({
        ok: false,
        code: 'MATCH_NOT_FOUND',
        reason: 'Không tìm thấy dữ liệu nền tảng.',
      });
      return;
    }

    res.json({
      ok: true,
      match: projectMatchForClient(loaded.state, loaded.stateHash),
    });
  });

  // 5. Execute authoritative command inside SQLite transaction (P01 fixture endpoint)
  app.post('/api/matches/:matchId/commands', (req: Request, res: Response) => {
    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_MATCH_ID',
        reason: 'Match ID không đúng định dạng hợp đồng.',
      });
      return;
    }

    // Multiplayer rooms MUST go through authenticated /api/rooms/:matchId/commands
    if (store.getRoomRow(parsedId.data) !== null) {
      res.status(403).json({
        ok: false,
        code: 'USE_AUTHENTICATED_ROOM_ENDPOINT',
        reason: 'Phòng đấu multiplayer yêu cầu gửi lệnh qua /api/rooms/:matchId/commands với Bearer token.',
      });
      return;
    }

    const headerActorId = req.header('x-actor-id')?.trim();
    if (!headerActorId) {
      res.status(401).json({
        ok: false,
        code: 'MISSING_ACTOR_CREDENTIAL',
        reason: 'Thiếu định danh actor (header x-actor-id) để xác thực quyền trên server.',
      });
      return;
    }

    let command;
    try {
      command = parseCommand(req.body);
    } catch (err) {
      if (err instanceof IncompatibleSchemaVersionError) {
        res.status(422).json({
          ok: false,
          code: err.code,
          reason: err.message,
          expectedVersion: err.expectedVersion,
          receivedVersion: err.receivedVersion,
        });
        return;
      }
      if (err instanceof ContractValidationError) {
        res.status(400).json({
          ok: false,
          code: err.code,
          reason: err.message,
          issues: err.issues,
        });
        return;
      }
      res.status(400).json({
        ok: false,
        code: 'INVALID_PAYLOAD',
        reason: err instanceof Error ? err.message : 'Invalid command payload',
      });
      return;
    }

    // Server-side actor authorization boundary check
    if (headerActorId !== command.actorId) {
      res.status(403).json({
        ok: false,
        code: 'ACTOR_IMPERSONATION_BLOCKED',
        reason: `Header actor "${headerActorId}" không khớp với command.actorId "${command.actorId}".`,
      });
      return;
    }

    const execution = store.executeCommand(parsedId.data, command, clock);
    if (!execution.found) {
      res.status(404).json({
        ok: false,
        code: 'MATCH_NOT_FOUND',
        reason: `Không tìm thấy match "${parsedId.data}".`,
      });
      return;
    }

    const result = execution.result;
    if (!result.ok) {
      res.status(mapRejectionToHttpStatus(result.code)).json({
        ok: false,
        code: result.code,
        reason: result.reason,
        currentVersion: result.currentVersion,
        stateHash: result.stateHash,
      });
      return;
    }

    const clientView = projectMatchForClient(result.nextState, result.stateHash);

    if (!result.idempotentDuplicate) {
      broadcast({
        type: 'match:events',
        matchId: clientView.matchId,
        version: clientView.version,
        stateHash: clientView.stateHash,
        emittedEvents: result.emittedEvents,
        serverUtc: clock.nowUtc(),
      });
    }

    res.status(result.idempotentDuplicate ? 200 : 201).json({
      ok: true,
      idempotentDuplicate: result.idempotentDuplicate,
      version: clientView.version,
      stateHash: clientView.stateHash,
      receipt: result.receipt,
      emittedEvents: result.emittedEvents,
      match: clientView,
    });
  });

  // 6. Server-side deterministic replay hash check
  app.post('/api/matches/:matchId/verify-replay', (req: Request, res: Response) => {
    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_MATCH_ID',
        reason: 'Match ID không đúng định dạng hợp đồng.',
      });
      return;
    }

    if(store.getRoomRow(parsedId.data)){res.status(404).json({ok:false,code:'MATCH_NOT_FOUND'});return;}
    const report = store.verifyMatchReplay(parsedId.data);
    if (!report) {
      res.status(404).json({
        ok: false,
        code: 'MATCH_NOT_FOUND',
        reason: `Không tìm thấy match "${parsedId.data}".`,
      });
      return;
    }

    res.json({
      ok: true,
      report,
    });
  });

  // ===========================================================================
  // Phase 02 World Map, Auth, Multiplayer Two-Slot Rooms & Sync Routes
  // ===========================================================================

  // P02-03 & P02-05: Public 72-region realistic geographic map, context countries, rivers, cities & transport corridors
  app.get('/api/world/map', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geojson: WORLD_MAP_72_GEOJSON,
      layers: WORLD_GEO_LAYERS,
    });
  });

  // P02-01: Register account (scrypt salted password hash + opaque Bearer token)
  app.post('/api/auth/register', (req: Request, res: Response) => {
    if (!checkHttpRateLimit(res, `auth:${clientIpKey(req)}`, authMaxPerMin, 60_000)) return;
    const parsed = RegisterPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: parsed.error.issues[0]?.message ?? 'Thông tin đăng ký không hợp lệ.',
        issues: parsed.error.issues,
      });
      return;
    }

    const outcome = store.registerUser(
      parsed.data.username,
      parsed.data.displayName,
      parsed.data.password,
      clock.nowUtc()
    );
    if (!outcome.ok) {
      res.status(outcome.status).json({
        ok: false,
        code: outcome.code,
        reason: outcome.reason,
      });
      return;
    }

    res.status(201).json({
      ok: true,
      user: outcome.user,
      token: outcome.token,
    });
  });

  // P02-01: Login account
  app.post('/api/auth/login', (req: Request, res: Response) => {
    if (!checkHttpRateLimit(res, `auth:${clientIpKey(req)}`, authMaxPerMin, 60_000)) return;
    const parsed = LoginPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: parsed.error.issues[0]?.message ?? 'Thông tin đăng nhập không hợp lệ.',
      });
      return;
    }

    const outcome = store.loginUser(
      parsed.data.username,
      parsed.data.password,
      clock.nowUtc()
    );
    if (!outcome.ok) {
      res.status(outcome.status).json({
        ok: false,
        code: outcome.code,
        reason: outcome.reason,
      });
      return;
    }

    res.json({
      ok: true,
      user: outcome.user,
      token: outcome.token,
    });
  });

  // P02-01: Inspect current authenticated session
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    res.json({ ok: true, user });
  });

  // P02-01: Logout (revoke token)
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) {
      store.revokeSession(token);
      for(const [socket,session] of socketSessions)if(session.token===token){socketSessions.delete(socket);socket.close(1008,'Signed out');}
    }
    res.json({ ok: true });
  });

  // P02-01: Create a new 2-slot multiplayer room with invite code
  app.post('/api/rooms', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsed = CreateRoomPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: parsed.error.issues[0]?.message ?? 'Thông tin tạo phòng không hợp lệ.',
      });
      return;
    }

    const created = store.createRoom({
      creator: user,
      title: parsed.data.title,
      preferredSlot: parsed.data.preferredSlot,
      scenarioId: parsed.data.scenarioId,
      aiOpponent: parsed.data.aiOpponent,
      nowUtc: clock.nowUtc(),
      mode: config.isProduction ? 'PRODUCTION_REALTIME' : 'PREVIEW_FIXTURE',
    });

    const filteredMatch = projectMatchForViewer(
      created.state,
      created.stateHash,
      created.room.viewerSlot,
      created.room.viewerNationId
    );

    res.status(201).json({
      ok: true,
      room: created.room,
      match: filteredMatch,
    });
  });

  // P02-01: List rooms belonging to authenticated user
  app.get('/api/rooms', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    const rooms = store.listRoomsForUser(user.userId);
    res.json({ ok: true, rooms });
  });

  // P02-01: Join room by invite code (strict 2 human slots; reconnect preserves original slot)
  app.post('/api/rooms/join', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsed = JoinRoomPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: parsed.error.issues[0]?.message ?? 'Mã mời không hợp lệ.',
      });
      return;
    }

    const joined = store.joinRoomByInviteCode({
      user,
      inviteCode: parsed.data.inviteCode,
      preferredSlot: parsed.data.preferredSlot,
      nowUtc: clock.nowUtc(),
    });

    if (!joined.ok) {
      res.status(joined.status).json({
        ok: false,
        code: joined.code,
        reason: joined.reason,
      });
      return;
    }

    const loaded = store.getMatch(joined.room.matchId);
    if (!loaded) {
      res.status(404).json({
        ok: false,
        code: 'MATCH_NOT_FOUND',
        reason: 'Không tìm thấy trạng thái trận đấu.',
      });
      return;
    }

    if (!joined.reconnected) {
      broadcastRoomStatus(joined.room.matchId);
    }

    const filteredMatch = projectMatchForViewer(
      loaded.state,
      loaded.stateHash,
      joined.room.viewerSlot,
      joined.room.viewerNationId
    );

    res.json({
      ok: true,
      reconnected: joined.reconnected,
      room: joined.room,
      match: filteredMatch,
    });
  });

  // P02-01 & P02-04: Get room details + permission-filtered snapshot (members only)
  app.get('/api/rooms/:matchId', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_MATCH_ID',
        reason: 'Match ID không hợp lệ.',
      });
      return;
    }

    const roomRes = store.getRoomForUser(parsedId.data, user.userId);
    if (!roomRes.ok) {
      res.status(roomRes.status).json({
        ok: false,
        code: roomRes.code,
        reason: roomRes.reason,
      });
      return;
    }

    if (roomRes.room.status === 'ACTIVE' && roomRes.room.scenarioId === 'vietnam_campaign_v1') {
      scheduler.catchUpMatchIfDue(parsedId.data);
    }

    const loaded = store.getMatch(parsedId.data);
    if (!loaded) {
      res.status(404).json({
        ok: false,
        code: 'MATCH_NOT_FOUND',
        reason: 'Không tìm thấy dữ liệu trận đấu.',
      });
      return;
    }

    res.json({
      ok: true,
      room: roomRes.room,
      match: projectMatchForViewer(
        loaded.state,
        loaded.stateHash,
        roomRes.room.viewerSlot,
        roomRes.room.viewerNationId
      ),
      snapshots: store.listSnapshots(parsedId.data),
      serverUtc: clock.nowUtc(),
    });
  });

  // Read-only estimate for the player’s own unit in an active room.
  app.get('/api/rooms/:matchId/movement-preview', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const matchId = MatchIdSchema.safeParse(req.params.matchId);
    const unitId = UnitIdSchema.safeParse(req.query.unitId);
    const destination = RegionIdSchema.safeParse(req.query.destinationId);
    if (!matchId.success || !unitId.success || !destination.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MOVEMENT_PREVIEW', reason: 'Đơn vị hoặc đích không hợp lệ.' });
      return;
    }

    const access = store.getRoomForUser(matchId.data, user.userId);
    if (!access.ok) {
      res.status(access.status).json({ ok: false, code: access.code, reason: access.reason });
      return;
    }
    if (access.room.status !== 'ACTIVE' || !access.room.viewerNationId) {
      res.status(409).json({ ok: false, code: 'MATCH_NOT_ACTIVE', reason: 'Chỉ xem trước tuyến trong trận đang diễn ra.' });
      return;
    }

    const state = store.getMatch(matchId.data)?.state;
    const unit = state?.units[unitId.data];
    if (!state || !unit || unit.ownerNationId !== access.room.viewerNationId) {
      res.status(404).json({ ok: false, code: 'UNIT_NOT_AVAILABLE', reason: 'Đơn vị không khả dụng.' });
      return;
    }
    const route = scenarioRoute(
      state.regions,
      unit.regionId, destination.data, unit.ownerNationId
    );
    if (!route) {
      res.status(422).json({ ok: false, code: 'NO_MOVEMENT_ROUTE', reason: 'Không có tuyến hợp lệ qua vùng đang kiểm soát.' });
      return;
    }

    res.json({
      ok: true,
      originId: unit.regionId,
      destinationId: destination.data,
      matchVersion: state.version,
      estimatedArrivalUtc: Math.max(clock.nowUtc(), state.currentUtc) + route.durationMs,
      durationMs: route.durationMs,
      regions: route.regionIds.map((id) => ({ id, name: state.regions[id].name })),
    });
  });

  // P02-01: Toggle ready state in lobby
  app.post('/api/rooms/:matchId/ready', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const parsed = ToggleReadyPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', reason: 'Trường ready phải là boolean.' });
      return;
    }

    const outcome = store.setPlayerReady(
      parsedId.data,
      user.userId,
      parsed.data.ready,
      clock.nowUtc()
    );
    if (!outcome.ok) {
      res.status(outcome.status).json({ ok: false, code: outcome.code, reason: outcome.reason });
      return;
    }

    broadcastRoomStatus(parsedId.data);
    res.json({ ok: true, room: outcome.room });
  });

  // P02-01: Start match & lock both human slots (NORTH / SOUTH)
  app.post('/api/rooms/:matchId/start', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const outcome = store.startRoom(parsedId.data, user.userId, clock.nowUtc());
    if (!outcome.ok) {
      res.status(outcome.status).json({ ok: false, code: outcome.code, reason: outcome.reason });
      return;
    }

    broadcastRoomStatus(parsedId.data);
    res.json({ ok: true, room: outcome.room });
  });

  // P02-01: Surrender active match
  app.post('/api/rooms/:matchId/surrender', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const outcome = store.surrenderRoom(parsedId.data, user.userId, clock.nowUtc());
    if (!outcome.ok) {
      res.status(outcome.status).json({ ok: false, code: outcome.code, reason: outcome.reason });
      return;
    }

    broadcastRoomStatus(parsedId.data);
    res.json({ ok: true, room: outcome.room });
  });

  // P02-01, P02-02 & P02-04: Authenticated multiplayer command submission (server-enforced slot & nationId)
  app.post('/api/rooms/:matchId/commands', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    if (!checkHttpRateLimit(res, `cmd:${user.userId}`, commandMaxPerMin, 60_000)) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const slotInfo = store.getUserSlotInRoom(parsedId.data, user.userId);
    if (!slotInfo) {
      res.status(403).json({
        ok: false,
        code: 'NOT_ROOM_MEMBER',
        reason: 'Bạn không thuộc 2 slot người chơi (Bắc / Nam) của phòng đấu này.',
      });
      return;
    }

    if (slotInfo.status !== 'ACTIVE') {
      res.status(409).json({
        ok: false,
        code: 'MATCH_NOT_ACTIVE',
        reason:
          slotInfo.status === 'LOBBY'
            ? 'Phòng đấu chưa bắt đầu; cần đủ 2 người chơi Ready và nhấn Bắt đầu để khóa slot.'
            : 'Phòng đấu đã kết thúc; không thể gửi thêm lệnh.',
      });
      return;
    }

    let command: Command;
    try {
      command = parseCommand(req.body);
    } catch (err) {
      if (err instanceof IncompatibleSchemaVersionError) {
        res.status(422).json({
          ok: false,
          code: err.code,
          reason: err.message,
          expectedVersion: err.expectedVersion,
          receivedVersion: err.receivedVersion,
        });
        return;
      }
      if (err instanceof ContractValidationError) {
        res.status(400).json({
          ok: false,
          code: err.code,
          reason: err.message,
          issues: err.issues,
        });
        return;
      }
      res.status(400).json({
        ok: false,
        code: 'INVALID_PAYLOAD',
        reason: err instanceof Error ? err.message : 'Invalid command payload',
      });
      return;
    }

    if (command.matchId !== parsedId.data) {
      res.status(422).json({
        ok: false,
        code: 'MATCH_ID_MISMATCH',
        reason: 'matchId trong lệnh không khớp với phòng đấu.',
      });
      return;
    }

    if (command.actorId !== slotInfo.actorId) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_ACTOR_IMPERSONATION',
        reason: `Slot ${slotInfo.slot} chỉ được phép gửi lệnh với actorId "${slotInfo.actorId}", không thể mạo danh "${command.actorId}".`,
      });
      return;
    }

    const nationCheck = checkCommandNationOwnership(command, slotInfo.nationId);
    if (!nationCheck.ok) {
      res.status(403).json({
        ok: false,
        code: nationCheck.code,
        reason: nationCheck.reason,
      });
      return;
    }

    const preState = store.getMatch(parsedId.data);
    const prevSeq = preState ? preState.state.eventSequence : 0;

    const execution = store.executeCommand(parsedId.data, command, clock);
    if (!execution.found) {
      res.status(404).json({ ok: false, code: 'MATCH_NOT_FOUND', reason: 'Không tìm thấy trận đấu.' });
      return;
    }

    const result = execution.result;
    if (!result.ok) {
      res.status(mapRejectionToHttpStatus(result.code)).json({
        ok: false,
        code: result.code,
        reason: result.reason,
        currentVersion: result.currentVersion,
        stateHash: result.stateHash,
      });
      return;
    }

    const filteredView = projectMatchForViewer(
      result.nextState,
      result.stateHash,
      slotInfo.slot,
      slotInfo.nationId
    );

    if (!result.idempotentDuplicate && result.emittedEvents.length > 0) {
      broadcastRoomDelta({
        matchId: parsedId.data,
        version: result.nextState.version,
        stateHash: result.stateHash,
        emittedEvents: result.emittedEvents,
        fromSequence: prevSeq + 1,
        toSequence: result.nextState.eventSequence,
      });
      if (result.emittedEvents.some((e) => e.payload.type === 'CAMPAIGN_MATCH_ENDED')) {
        broadcastRoomStatus(parsedId.data);
      }
    }

    res.status(result.idempotentDuplicate ? 200 : 201).json({
      ok: true,
      idempotentDuplicate: result.idempotentDuplicate,
      version: filteredView.version,
      stateHash: filteredView.stateHash,
      receipt: result.receipt,
      emittedEvents: result.emittedEvents,
      match: filteredView,
      serverUtc: clock.nowUtc(),
    });
  });

  // P02-04: Sequence gap recovery & permission-filtered resync endpoint
  app.get('/api/rooms/:matchId/sync', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const roomRes = store.getRoomForUser(parsedId.data, user.userId);
    if (!roomRes.ok) {
      res.status(roomRes.status).json({ ok: false, code: roomRes.code, reason: roomRes.reason });
      return;
    }

    if (roomRes.room.status === 'ACTIVE' && roomRes.room.scenarioId === 'vietnam_campaign_v1') {
      scheduler.catchUpMatchIfDue(parsedId.data);
    }

    const loaded = store.getMatch(parsedId.data);
    if (!loaded) {
      res.status(404).json({ ok: false, code: 'MATCH_NOT_FOUND', reason: 'Không tìm thấy trận đấu.' });
      return;
    }

    const sinceRaw = req.query.sinceSequence;
    const sinceSeq =
      typeof sinceRaw === 'string' && /^\d+$/.test(sinceRaw) ? Number.parseInt(sinceRaw, 10) : null;

    const missedEvents =
      sinceSeq !== null
        ? projectRoomEventsForViewer(store.getEventsSince(parsedId.data, sinceSeq), roomRes.room.viewerNationId)
        : [];

    res.json({
      ok: true,
      matchId: parsedId.data,
      currentSequence: loaded.state.eventSequence,
      version: loaded.state.version,
      stateHash: loaded.stateHash,
      missedEvents,
      room: roomRes.room,
      match: projectMatchForViewer(
        loaded.state,
        loaded.stateHash,
        roomRes.room.viewerSlot,
        roomRes.room.viewerNationId
      ),
      serverUtc: clock.nowUtc(),
    });
  });

  // P02-02: Sanitized public audit export for room members (NEVER exposes serverPrivate)
  app.get('/api/rooms/:matchId/backup-summary', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const roomRes = store.getRoomForUser(parsedId.data, user.userId);
    if (!roomRes.ok) {
      res.status(roomRes.status).json({ ok: false, code: roomRes.code, reason: roomRes.reason });
      return;
    }

    const backup = store.exportMatchBackup(parsedId.data, clock.nowUtc());
    if (!backup) {
      res.status(404).json({ ok: false, code: 'MATCH_NOT_FOUND', reason: 'Không tìm thấy trận đấu.' });
      return;
    }

    res.json({
      ok: true,
      summary: {
        backupVersion: backup.backupVersion,
        matchId: backup.matchId,
        exportedAtUtc: backup.exportedAtUtc,
        version: backup.version,
        stateHash: backup.stateHash,
        commandCount: backup.commandLog.length,
        snapshots: backup.snapshots,
        secretsIncluded: false,
      },
    });
  });

  // P02-02: Server-side replay verification for authenticated room member
  app.post('/api/rooms/:matchId/verify-replay', (req: Request, res: Response) => {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const roomRes = store.getRoomForUser(parsedId.data, user.userId);
    if (!roomRes.ok) {
      res.status(roomRes.status).json({ ok: false, code: roomRes.code, reason: roomRes.reason });
      return;
    }

    const report = store.verifyMatchReplay(parsedId.data);
    if (!report) {
      res.status(404).json({ ok: false, code: 'MATCH_NOT_FOUND', reason: 'Không tìm thấy trận đấu.' });
      return;
    }

    res.json({ ok: true, report });
  });

  // P03-01: Authenticated viewer-scoped economic forecast & traceable resource ledger
  app.get('/api/rooms/:matchId/economy', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;

    const parsedId = MatchIdSchema.safeParse(req.params.matchId);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, code: 'INVALID_MATCH_ID', reason: 'Match ID không hợp lệ.' });
      return;
    }

    const slotInfo = store.getUserSlotInRoom(parsedId.data, user.userId);
    if (!slotInfo) {
      res.status(403).json({
        ok: false,
        code: 'NOT_ROOM_MEMBER',
        reason: 'Chỉ thành viên thuộc 2 slot Bắc / Nam mới được xem sổ cái kinh tế của phòng đấu này.',
      });
      return;
    }

    const loaded = store.getMatch(parsedId.data);
    if (!loaded) {
      res.status(404).json({ ok: false, code: 'MATCH_NOT_FOUND', reason: 'Không tìm thấy trận đấu.' });
      return;
    }

    const forecast = computeNationEconomicForecast(loaded.state, slotInfo.nationId);
    const viewerLedger = (loaded.state.economicLedger ?? []).filter(
      (entry) => entry.nationId === slotInfo.nationId
    );
    const phase03 = computePhase03NationReport(loaded.state, slotInfo.nationId);

    res.json({
      ok: true,
      matchId: parsedId.data,
      version: loaded.state.version,
      slot: slotInfo.slot,
      nationId: slotInfo.nationId,
      forecast,
      ledger: viewerLedger,
      phase03,
      serverUtc: clock.nowUtc(),
    });
  });

  // Catch-all for unknown API routes (never return HTML for /api/*)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      code: 'API_ROUTE_NOT_FOUND',
      reason: 'Endpoint API không tồn tại.',
    });
  });

  const close = async (): Promise<void> => {
    scheduler.stop();
    socketSessions.clear();
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve()))
    );
  };

  return {
    app,
    httpServer,
    wss,
    store,
    scheduler,
    broadcast,
    close,
  };
}
