/** Shared wire contract. Run scripts/sync-ojos.mjs after editing this file. */
export const astronautIds = ['A', 'B', 'C'] as const;
export type AstronautId = typeof astronautIds[number];
export type MentalState = 'calma' | 'estres' | 'ira' | 'fatiga' | 'alegria';
export type RiskLevel = 'bajo' | 'medio' | 'alto';
export type VisualTrigger = 'espacios_reducidos' | 'desorden_visual' | 'alerta_visual';
export type Trigger = VisualTrigger | 'charlas_largas' | 'murmullos' | 'falta_sueno';
export type Source = 'simulador' | 'sensor' | 'manual' | 'vision';
export type InterventionItem = 'musica_beethoven' | 'musica_suave' | 'voz_pareja' | 'ejercicio' | 'pausa_guiada';
export type Intervention = { type: 'audio' | 'actividad'; item: InterventionItem };
export type Prediction = {
  astronaut_id: string; timestamp: string; state_now: MentalState;
  state_probs: Record<MentalState, number>;
  risk: { anger_next_5min: number; level: RiskLevel };
  recommended_intervention: Intervention | null; model_version: string;
};
export type Reading = {
  t_min: number; confined_space: number; long_conversation: number;
  overheard_negative_talk: number; exercise: number; sleep_hours_last_night: number;
  music_playing: 'none' | 'beethoven' | 'suave'; loved_voice: number;
  hr: number; hrv_rmssd: number; eda_mean: number; resp_rate: number; skin_temp: number;
  eeg_delta: number; eeg_theta: number; eeg_alpha: number; eeg_beta: number; eeg_alpha_asym: number;
};
export type Observation = {
  id: string; astronautId: AstronautId; trigger: Trigger; source: Source;
  timestamp: string; expiresAt: string; evidence: string; confidence: number | null;
};
export type ResponseAction = 'reconocida' | 'aceptada' | 'descartada' | 'util' | 'sin_efecto';
export type Alert = {
  id: string; astronautId: AstronautId; kind: 'riesgo' | 'contexto';
  level: RiskLevel; peakLevel: RiskLevel; startedAt: string; resolvedAt: string | null; active: boolean;
  state: MentalState | null; triggers: Observation[]; intervention: Intervention | null;
  response: { action: ResponseAction; timestamp: string } | null; source: Source;
};
export type Profile = {
  astronaut_id: AstronautId; specialty: string; stress_triggers: string;
  anger_triggers: string; calmers: string; min_sleep_h: number;
};
export type VisualResult = {
  summary: string;
  impact?: string;
  suggestion?: string;
  observations: { trigger: VisualTrigger; confidence: number; evidence: string }[];
  processedOn?: 'edge_device' | 'server';
  latencyMs?: number;
  engine?: 'gemini' | 'dual_contingency';
};
export type VisualAnalysis = VisualResult & {
  id: string; astronautId: AstronautId; timestamp: string; source: 'vision' | 'simulador';
};
export type CrewStatus = {
  id: AstronautId; profile: Profile; reading: Reading | null; prediction: Prediction | null;
  readings: { reading: Reading; timestamp: string; source: Source }[];
  predictions: { prediction: Prediction; timestamp: string }[];
  observations: Observation[]; alerts: Alert[];
  quality: 'simulada' | 'recopilando' | 'actualizada' | 'sin_datos' | 'desactualizada' | 'error_modelo';
  lastReadingAt: string | null; deviceLastSeen: string | null;
  cameraStatus: string | null; inferenceError: string | null;
  visualAnalyses: VisualAnalysis[];
  selfReport: { state: MentalState; timestamp: string } | null;
};
export type MissionSnapshot = {
  version: 1; sessionId: string; mode: 'camera' | 'camera-demo' | 'demo' | 'live'; createdAt: string; serverTime: string;
  role: 'control' | 'viewer' | AstronautId;
  clock: { minute: number; playing: boolean; secondsPerMinute: number; finished: boolean };
  capabilities: { vision: boolean; sensors: boolean };
  crew: CrewStatus[];
};
export type Connection = { apiUrl: string; sessionId: string; key: string; astronautId?: AstronautId };
export type SessionCreated = {
  sessionId: string; controlKey: string; viewerKey: string; crewKeys: Record<AstronautId, string>;
  clientAi?: {
    enabled: boolean;
    provider: 'gemini' | 'none';
    apiKey?: string;
    model?: string;
  };
};
export const stateLabels: Record<MentalState, string> = {
  calma: 'Calma', estres: 'Estrés', ira: 'Ira', fatiga: 'Fatiga', alegria: 'Alegría',
};
export const triggerLabels: Record<Trigger, string> = {
  espacios_reducidos: 'Espacio reducido', charlas_largas: 'Conversación prolongada',
  murmullos: 'Comentarios negativos escuchados', falta_sueno: 'Descanso insuficiente',
  desorden_visual: 'Área de trabajo saturada', alerta_visual: 'Aviso o alarma visible',
};
export const visualTriggers: VisualTrigger[] = ['espacios_reducidos', 'desorden_visual', 'alerta_visual'];
export const sourceLabels: Record<Source, string> = {
  simulador: 'Simulación', sensor: 'Sensor', manual: 'Registro manual', vision: 'Observación visual',
};
export const interventionText: Record<InterventionItem, { title: string; description: string }> = {
  pausa_guiada: { title: 'Haz una pausa breve', description: 'Si tu tarea lo permite, toma una pausa en un lugar seguro. Respira con suavidad, sin forzar, y retoma una cosa a la vez. Puedes avisar al equipo cómo te sientes.' },
  musica_beethoven: { title: 'Tu música de calma', description: 'Considera escuchar la selección de Beethoven indicada en tu perfil, cuando la tarea lo permita.' },
  musica_suave: { title: 'Un momento de calma', description: 'Considera escuchar tu música suave preferida, cuando la tarea lo permita.' },
  voz_pareja: { title: 'Una voz familiar', description: 'Considera escuchar el mensaje de tu persona de confianza, cuando la tarea lo permita.' },
  ejercicio: { title: 'Tu actividad de bienestar', description: 'Consulta tu actividad de ejercicio programada y sigue el protocolo de la misión.' },
};

export function normalizeApiUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Introduce una dirección HTTPS válida para CentroControl.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('La conexión entre dispositivos necesita HTTPS.');
  }
  return url.href.replace(/\/$/, '').replace(/\/api$/, '');
}

export function connectionFromFragment(fragment: string): Connection | null {
  const p = new URLSearchParams(fragment.replace(/^#/, ''));
  const apiUrl = p.get('api'); const sessionId = p.get('session'); const key = p.get('key');
  if (!apiUrl || !sessionId || !key) return null;
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(sessionId) || !/^[a-zA-Z0-9_-]{32,100}$/.test(key)) {
    throw new Error('El enlace de sesión no es válido.');
  }
  const id = p.get('astronaut');
  if (id && !astronautIds.includes(id as AstronautId)) throw new Error('Astronauta desconocido.');
  return { apiUrl: normalizeApiUrl(apiUrl), sessionId, key, ...(id ? { astronautId: id as AstronautId } : {}) };
}

export function sessionLink(base: string, c: Connection): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ api: c.apiUrl, session: c.sessionId, key: c.key,
    ...(c.astronautId ? { astronaut: c.astronautId } : {}) }).toString();
  return url.href;
}
