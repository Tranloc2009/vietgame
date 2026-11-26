import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientMatchView,
  Command,
  CONTRACT_SCHEMA_VERSION,
} from '../contracts';

export interface HealthPayload {
  status: 'ok' | 'degraded';
  appName: string;
  appVersion: string;
  contractVersion: string;
  simulationVersion: string;
  appEnv: 'preview' | 'development' | 'production';
  isProduction: boolean;
  allowPreviewFixture: boolean;
  aiApiDependency: boolean;
  realtimePolicy: {
    secondsPerGameDay: number;
    allowFastForward: boolean;
  };
  database: {
    engine: string;
    writable: boolean;
    fileLabel: string;
    appliedMigrations: string[];
    matchCount: number;
    error: string | null;
  };
  websocket: {
    path: string;
    activeConnections: number;
  };
  serverUtc: number;
}

export interface MatchSummaryItem {
  matchId: string;
  title: string;
  mode: string;
  schemaVersion: string;
  version: number;
  stateHash: string;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface ReplayVerificationResponse {
  ok: boolean;
  report?: {
    matchId: string;
    verified: boolean;
    storedHash: string;
    replayedHash: string;
    replayedCommandCount: number;
    version: number;
  };
  code?: string;
  reason?: string;
}

export interface CommandSubmitResponse {
  ok: boolean;
  idempotentDuplicate?: boolean;
  version?: number;
  stateHash?: string;
  match?: ClientMatchView;
  code?: string;
  reason?: string;
  issues?: { path: string; message: string }[];
}

export async function fetchHealth(): Promise<HealthPayload> {
  const res = await fetch('/api/health', { cache: 'no-store' });
  const data = (await res.json()) as HealthPayload;
  if (!res.ok && data.status !== 'degraded') {
    throw new Error(`HTTP ${res.status} khi kiểm tra /api/health`);
  }
  return data;
}

export async function fetchMatches(): Promise<MatchSummaryItem[]> {
  const res = await fetch('/api/matches', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} khi tải danh sách match`);
  }
  const data = (await res.json()) as { matches: MatchSummaryItem[] };
  return data.matches;
}

export async function fetchMatchDetail(matchId: string): Promise<ClientMatchView> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, { cache: 'no-store' });
  const data = (await res.json()) as { ok: boolean; match?: ClientMatchView; reason?: string };
  if (!res.ok || !data.ok || !data.match) {
    throw new Error(data.reason ?? `HTTP ${res.status} khi tải match ${matchId}`);
  }
  return data.match;
}

export async function createOrResetFixture(reset = false): Promise<ClientMatchView> {
  const res = await fetch('/api/matches/fixture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset }),
  });
  const data = (await res.json()) as { ok: boolean; match?: ClientMatchView; reason?: string };
  if (!res.ok || !data.ok || !data.match) {
    throw new Error(data.reason ?? `HTTP ${res.status} khi khởi tạo fixture`);
  }
  return data.match;
}

export async function submitMatchCommand(
  matchId: string,
  actorHeaderId: string,
  command: Command
): Promise<CommandSubmitResponse> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/commands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-actor-id': actorHeaderId,
    },
    body: JSON.stringify({
      ...command,
      schemaVersion: command.schemaVersion ?? CONTRACT_SCHEMA_VERSION,
    }),
  });
  return (await res.json()) as CommandSubmitResponse;
}

export async function verifyMatchReplay(matchId: string): Promise<ReplayVerificationResponse> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/verify-replay`, {
    method: 'POST',
  });
  return (await res.json()) as ReplayVerificationResponse;
}

export type WsConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WsLiveState {
  status: WsConnectionState;
  lastServerUtc: number | null;
  activeConnections: number | null;
  lastPingMs: number | null;
  errorReason: string | null;
  lastMatchEventVersion: number | null;
  sendPing: () => void;
  reconnect: () => void;
}

export function useLiveWebSocket(onMatchUpdate?: (matchId: string) => void): WsLiveState {
  const [status, setStatus] = useState<WsConnectionState>('connecting');
  const [lastServerUtc, setLastServerUtc] = useState<number | null>(null);
  const [activeConnections, setActiveConnections] = useState<number | null>(null);
  const [lastPingMs, setLastPingMs] = useState<number | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [lastMatchEventVersion, setLastMatchEventVersion] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const onMatchUpdateRef = useRef(onMatchUpdate);
  onMatchUpdateRef.current = onMatchUpdate;

  useEffect(() => {
    setStatus('connecting');
    setErrorReason(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let socket: WebSocket;
    let closedByCleanup = false;
    let reconnectTimer: number | null = null;

    try {
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;
    } catch (err) {
      setStatus('error');
      setErrorReason(err instanceof Error ? err.message : 'Không thể mở kết nối WebSocket');
      return;
    }

    socket.onopen = () => {
      setStatus('connected');
      setErrorReason(null);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          serverUtc?: number;
          activeConnections?: number;
          clientTs?: number | null;
          matchId?: string;
          version?: number;
        };

        if (typeof msg.serverUtc === 'number') {
          setLastServerUtc(msg.serverUtc);
        }
        if (typeof msg.activeConnections === 'number') {
          setActiveConnections(msg.activeConnections);
        }
        if (msg.type === 'pong' && typeof msg.clientTs === 'number') {
          setLastPingMs(Math.max(0, Date.now() - msg.clientTs));
        }
        if (
          (msg.type === 'match:events' || msg.type === 'match:updated') &&
          typeof msg.matchId === 'string'
        ) {
          if (typeof msg.version === 'number') {
            setLastMatchEventVersion(msg.version);
          }
          onMatchUpdateRef.current?.(msg.matchId);
        }
      } catch {
        // Ignore malformed frame safely
      }
    };

    socket.onerror = () => {
      setStatus('error');
      setErrorReason('Lỗi kết nối WebSocket tới /ws');
    };

    socket.onclose = () => {
      if (!closedByCleanup) {
        setStatus('disconnected');
        reconnectTimer = window.setTimeout(() => {
          setAttempt((prev) => prev + 1);
        }, 4000);
      }
    };

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      wsRef.current = null;
    };
  }, [attempt]);

  const sendPing = useCallback(() => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping', clientTs: Date.now() }));
    }
  }, []);

  const reconnect = useCallback(() => {
    setAttempt((prev) => prev + 1);
  }, []);

  return {
    status,
    lastServerUtc,
    activeConnections,
    lastPingMs,
    errorReason,
    lastMatchEventVersion,
    sendPing,
    reconnect,
  };
}
