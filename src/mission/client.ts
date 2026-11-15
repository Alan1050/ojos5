import type { Connection, MissionSnapshot, SessionCreated } from './protocol.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function apiRequest<T>(base: string, path: string, options: {
  key?: string; body?: unknown; signal?: AbortSignal;
} = {}): Promise<T> {
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) timeout.abort();
  const timer = setTimeout(abort, 25_000);
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api${path}`, {
      method: options.body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: timeout.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(json?.error || `El servicio respondió ${response.status}.`, response.status);
    if (!json || typeof json !== 'object') throw new Error('El servicio devolvió una respuesta inválida.');
    return json as T;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
}

export function getSnapshot(c: Connection, signal?: AbortSignal) {
  return apiRequest<MissionSnapshot>(c.apiUrl, `/sessions/${c.sessionId}`, { key: c.key, signal });
}
export function sendAction<T = MissionSnapshot>(c: Connection, path: string, body: unknown) {
  return apiRequest<T>(c.apiUrl, `/sessions/${c.sessionId}${path}`, { key: c.key, body });
}
export function createSession(apiUrl: string, mode: 'camera' | 'camera-demo' | 'demo' | 'live', secondsPerMinute = 3) {
  return apiRequest<SessionCreated>(apiUrl, '/sessions', { body: { mode, secondsPerMinute } });
}
export function fetchActiveSession(apiUrl: string) {
  return apiRequest<SessionCreated>(apiUrl, '/active-session');
}

/** One request at a time. Keeps the last snapshot visible on transient failures. */
export function watchMission(c: Connection, onData: (s: MissionSnapshot) => void,
  onError: (error: Error) => void, interval = 2000): () => void {
  let stopped = false; let timer: ReturnType<typeof setTimeout>; let failures = 0;
  let controller: AbortController | undefined;
  const poll = async () => {
    controller = new AbortController();
    try {
      const data = await getSnapshot(c, controller.signal);
      if (data.version !== 1 || !Array.isArray(data.crew) || data.sessionId !== c.sessionId) throw new Error('Contrato de sesión incompatible.');
      if (c.astronautId && data.role !== c.astronautId) throw new Error('El enlace y la clave corresponden a astronautas distintos.');
      if (!stopped) { failures = 0; onData(data); }
    } catch (e) {
      if (!stopped) { failures++; onError(e instanceof Error ? e : new Error('No hay conexión con CentroControl.')); }
    }
    if (!stopped) timer = setTimeout(poll, Math.min(15000, interval * Math.max(1, failures)));
  };
  void poll();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
}
