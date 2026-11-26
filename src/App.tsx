import { useCallback, useEffect, useState } from 'react';
import { ClientMatchView } from './contracts';
import {
  createOrResetFixture,
  fetchHealth,
  fetchMatchDetail,
  fetchMatches,
  HealthPayload,
  useLiveWebSocket,
} from './web/api';
import { MultiplayerWorkspace } from './web/MultiplayerWorkspace';

export default function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [foundationMatch, setFoundationMatch] = useState<ClientMatchView | null>(null);
  const [foundationMatchLoading, setFoundationMatchLoading] = useState(true);

  const refreshSystem = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const [h, matches] = await Promise.all([fetchHealth(), fetchMatches()]);
      setHealth(h);
      const fixtureMatch =
        matches.find((m) => m.matchId === 'mch_preview_alt_1955') ?? matches[0] ?? null;
      if (fixtureMatch) {
        const detail = await fetchMatchDetail(fixtureMatch.matchId);
        setFoundationMatch(detail);
      } else if (h.allowPreviewFixture) {
        const created = await createOrResetFixture(false);
        setFoundationMatch(created);
      } else {
        setFoundationMatch(null);
      }
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : 'Không thể đọc trạng thái từ máy chủ.'
      );
    } finally {
      setHealthLoading(false);
      setFoundationMatchLoading(false);
    }
  }, []);

  const handleWsMatchUpdate = useCallback(async (matchId: string) => {
    if (matchId !== 'mch_preview_alt_1955') return;
    try {
      const detail = await fetchMatchDetail(matchId);
      setFoundationMatch(detail);
    } catch {
      // Ignore transient refresh failure; user can retry manually
    }
  }, []);

  const ws = useLiveWebSocket(handleWsMatchUpdate);

  useEffect(() => {
    void refreshSystem();
  }, [refreshSystem]);

  return (
    <MultiplayerWorkspace
      health={health}
      healthLoading={healthLoading}
      healthError={healthError}
      foundationWs={ws}
      foundationMatch={foundationMatch}
      foundationMatchLoading={foundationMatchLoading}
      onRefreshFoundation={() => void refreshSystem()}
      onFoundationMatchLoaded={(m) => {
        setFoundationMatch(m);
        void fetchHealth()
          .then(setHealth)
          .catch(() => {});
      }}
    />
  );
}
