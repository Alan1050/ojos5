import { useCallback, useEffect, useState } from 'react';
import { sendAction, watchMission } from './client.ts';
import type { Connection, MissionSnapshot } from './protocol.ts';

export function useMission(connection: Connection | null) {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [lastContact, setLastContact] = useState<number | null>(null);
  useEffect(() => {
    if (!connection) return;
    return watchMission(connection, data => {
      setSnapshot(data); setError(''); setLastContact(Date.now());
    }, e => setError(e.message));
  }, [connection]);
  const action = useCallback(async (path: string, body: unknown) => {
    if (!connection) return false;
    setPending(true);
    try {
      const data = await sendAction(connection, path, body);
      setSnapshot(data); setError(''); setLastContact(Date.now()); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar la acción.'); return false; }
    finally { setPending(false); }
  }, [connection]);
  const data = snapshot?.sessionId === connection?.sessionId ? snapshot : null;
  return { data, error, pending, action, lastContact };
}
