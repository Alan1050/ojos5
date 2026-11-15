import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchActiveSession, sendAction } from './client';
import { isCanceledError, runEdgeVision } from './client-ai';
import { connectionFromFragment, interventionText, stateLabels, triggerLabels } from './protocol';
import type { AstronautId, Connection, MentalState, ResponseAction, SessionCreated, VisualResult } from './protocol';
import { useMission } from './useMission';

const DEFAULT_API_URL = 'https://centrocontrolneuro.netlify.app';

function getRetrySeconds(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && 'retryAfterSeconds' in e) {
    const s = Number((e as { retryAfterSeconds: unknown }).retryAfterSeconds);
    if (Number.isFinite(s) && s > 0) return s;
  }
  return null;
}

function Button({ title, onPress, disabled = false, style, textStyle }: {
  title: string; onPress: () => void; disabled?: boolean; style?: any; textStyle?: any;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, style, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, textStyle]}>{title}</Text>
    </Pressable>
  );
}

export default function MissionOverlay({ cameraStatus, capture }: { cameraStatus: string; capture: () => Promise<string> }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [activeSession, setActiveSession] = useState<SessionCreated | null>(null);
  const [localError, setLocalError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [automatic, setAutomatic] = useState(false);
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [aiStatusText, setAiStatusText] = useState('');

  const lastExecutionRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const cooldownUntilRef = useRef<number>(0);
  const activeSessionRef = useRef(activeSession);
  const connectionRef = useRef(connection);
  const captureRef = useRef(capture);

  const { data, error, pending, action } = useMission(connection);
  const crew = data?.crew.find(c => c.id === connection?.astronautId);
  const profileRef = useRef(crew?.profile);

  useEffect(() => {
    activeSessionRef.current = activeSession;
    connectionRef.current = connection;
    captureRef.current = capture;
    profileRef.current = crew?.profile;
  });
  const latest = crew?.visualAnalyses.at(-1);
  const alert = crew?.alerts.find(a => a.active);
  const suggestion = alert?.intervention ? interventionText[alert.intervention.item] : null;
  const alertId = alert?.id;
  const suggestionText = suggestion?.description;
  const cameraSession = data?.mode === 'camera';
  const simulated = data?.mode === 'camera-demo';

  // Sincronizar sesión activa desde CentroControl
  useEffect(() => {
    let mounted = true;
    const loadSession = async () => {
      try {
        const session = await fetchActiveSession(DEFAULT_API_URL);
        if (!mounted) return;
        setActiveSession(session);
      } catch (e) {
        if (mounted) console.warn('No se pudo conectar a la sesión activa fija:', e);
      }
    };
    void loadSession();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const load = (url: string | null | undefined) => {
      if (!url) return;
      try {
        const c = connectionFromFragment(new URL(url).hash);
        if (c?.astronautId) setConnection(c);
      } catch {
        setLocalError('El enlace del astronauta no es válido.');
      }
    };
    void Linking.getInitialURL().then(load).catch(() => {});
    const sub = Linking.addEventListener('url', e => load(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!connection?.astronautId) return;
    const beat = () => {
      void sendAction(connection, '/heartbeat', {
        astronautId: connection.astronautId,
        cameraStatus: AppState.currentState === 'active' ? cameraStatus : 'paused'
      }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, 30000);
    const sub = AppState.addEventListener('change', beat);
    return () => { clearInterval(timer); sub.remove(); };
  }, [connection, cameraStatus]);

  useEffect(() => {
    if (alertId && suggestionText) AccessibilityInfo.announceForAccessibility(suggestionText);
  }, [alertId, suggestionText]);

  useEffect(() => {
    if (!automatic || cameraStatus !== 'live' || !cameraSession || !data?.capabilities.vision || !connection?.astronautId) return;
    let cancelled = false;

    const sample = async () => {
      const now = Date.now();
      if (now < cooldownUntilRef.current) {
        const remaining = Math.ceil((cooldownUntilRef.current - now) / 1000);
        setLocalError(`Límite de Google AI (5/min). Enfriando por ${remaining}s…`);
        return;
      }
      if (inFlightRef.current || now - lastExecutionRef.current < 22000) {
        return;
      }
      if (AppState.currentState !== 'active') return;
      const conn = connectionRef.current;
      if (!conn?.astronautId) return;

      inFlightRef.current = true;
      lastExecutionRef.current = now;
      setIsProcessingAi(true);
      try {
        const image = await captureRef.current();
        if (cancelled) return;

        let result: VisualResult | null = null;
        const sess = activeSessionRef.current;
        if (sess?.clientAi?.apiKey) {
          try {
            setAiStatusText('Ejecutando Edge AI en smartphone…');
            result = await runEdgeVision(image, profileRef.current, {
              apiKey: sess.clientAi.apiKey,
              model: sess.clientAi.model,
            });
            setAiStatusText(`Edge AI: ${result.latencyMs ?? 0} ms · Transmitiendo telemetría…`);
          } catch (edgeErr: unknown) {
            if (isCanceledError(edgeErr)) {
              return;
            }
            const retry = getRetrySeconds(edgeErr);
            if (retry) {
              cooldownUntilRef.current = Date.now() + retry * 1000;
              setLocalError(`Límite gratuito de Google AI (5/min). Enfriando por ${retry}s…`);
              setTimeout(() => {
                setLocalError(prev => (prev.includes('Enfriando') ? '' : prev));
              }, retry * 1000);
              return;
            }
            console.warn('Fallo en Edge AI local, recurriendo al servidor:', edgeErr);
          }
        }

        if (!cancelled) {
          if (result) {
            await sendAction(conn, '/vision', { astronautId: conn.astronautId, result });
          } else {
            await sendAction(conn, '/vision', { astronautId: conn.astronautId, image });
          }
          setLocalError('');
        }
      } catch (e: unknown) {
        if (!cancelled && !isCanceledError(e)) {
          const retry = getRetrySeconds(e);
          if (retry) {
            cooldownUntilRef.current = Date.now() + retry * 1000;
            setLocalError(`Límite gratuito de Google AI (5/min). Enfriando por ${retry}s…`);
          } else {
            setLocalError(e instanceof Error ? e.message : 'No se pudo observar el entorno.');
          }
        }
      } finally {
        inFlightRef.current = false;
        setIsProcessingAi(false);
      }
    };

    void sample();
    const timer = setInterval(() => void sample(), 22000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [automatic, cameraStatus, cameraSession, data?.capabilities.vision, connection?.astronautId]);

  function selectAstronaut(aid: AstronautId) {
    if (!activeSession) return;
    const key = activeSession.crewKeys[aid];
    if (!key) return;
    setConnection({
      apiUrl: DEFAULT_API_URL,
      sessionId: activeSession.sessionId,
      key,
      astronautId: aid,
    });
    setAutomatic(false);
    setLocalError('');
  }

  function respond(response: ResponseAction) {
    if (alert && crew) void action('/response', { astronautId: crew.id, alertId: alert.id, action: response });
  }

  function report(state: MentalState) {
    if (crew) void action('/self-report', { astronautId: crew.id, state });
  }

  async function analyze() {
    const conn = connectionRef.current;
    if (!conn?.astronautId) return;
    const now = Date.now();
    if (now < cooldownUntilRef.current) {
      const remaining = Math.ceil((cooldownUntilRef.current - now) / 1000);
      setLocalError(`Límite de Google AI (5/min). Enfriando por ${remaining}s…`);
      return;
    }
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    lastExecutionRef.current = now;
    setLocalError('');
    setIsProcessingAi(true);
    setAiStatusText('Ejecutando Edge AI en smartphone…');
    try {
      const image = await captureRef.current();
      let result: VisualResult | null = null;
      const sess = activeSessionRef.current;
      if (sess?.clientAi?.apiKey) {
        try {
          result = await runEdgeVision(image, profileRef.current, {
            apiKey: sess.clientAi.apiKey,
            model: sess.clientAi.model,
          });
          setAiStatusText(`Edge AI: ${result.latencyMs ?? 0} ms · Transmitiendo telemetría…`);
        } catch (edgeErr: unknown) {
          if (isCanceledError(edgeErr)) {
            return;
          }
          const retry = getRetrySeconds(edgeErr);
          if (retry) {
            cooldownUntilRef.current = Date.now() + retry * 1000;
            setLocalError(`Límite gratuito de Google AI (5/min). Enfriando por ${retry}s…`);
            setTimeout(() => {
              setLocalError(prev => (prev.includes('Enfriando') ? '' : prev));
            }, retry * 1000);
            return;
          }
          console.warn('Fallo en Edge AI local, recurriendo al servidor:', edgeErr);
        }
      }
      if (result) {
        await action('/vision', { astronautId: conn.astronautId, result });
      } else {
        await action('/vision', { astronautId: conn.astronautId, image });
      }
    } catch (e: unknown) {
      if (!isCanceledError(e)) {
        const retry = getRetrySeconds(e);
        if (retry) {
          cooldownUntilRef.current = Date.now() + retry * 1000;
          setLocalError(`Límite gratuito de Google AI (5/min). Enfriando por ${retry}s…`);
        } else {
          setLocalError(e instanceof Error ? e.message : 'No se pudo capturar el entorno.');
        }
      }
    } finally {
      inFlightRef.current = false;
      setIsProcessingAi(false);
    }
  }

  return (
    <SafeAreaView style={styles.position} pointerEvents="box-none" edges={['top', 'left', 'right']}>
      <View style={[styles.panel, alert && styles.attention]}>
        <View style={styles.bar}>
          <Text style={styles.title}>
            {connection?.astronautId ? `Astronauta ${connection.astronautId} · Ojos` : 'Ojos · Telemetría Espacial'}
          </Text>
          <Button title={expanded ? 'Ocultar' : 'Asistencia'} onPress={() => setExpanded(v => !v)} />
        </View>

        {expanded && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {!connection && (
              <View style={styles.selectorContainer}>
                <Text style={styles.selectorTitle}>¿Qué tripulante eres hoy?</Text>
                <Text style={styles.selectorSubtitle}>
                  Toca para vincular esta cámara al Centro de Control en la Tierra:
                </Text>

                <Pressable
                  accessibilityRole="button"
                  style={styles.cardButton}
                  onPress={() => selectAstronaut('A')}
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>A</Text></View>
                  <View style={styles.cardTextContainer}>
                    <Text style={styles.cardTitle}>Astronauta A</Text>
                    <Text style={styles.cardSubtitle}>Especialista en Comunicaciones</Text>
                  </View>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  style={styles.cardButton}
                  onPress={() => selectAstronaut('B')}
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>B</Text></View>
                  <View style={styles.cardTextContainer}>
                    <Text style={styles.cardTitle}>Astronauta B</Text>
                    <Text style={styles.cardSubtitle}>Especialista en Software y Procedimientos</Text>
                  </View>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  style={styles.cardButton}
                  onPress={() => selectAstronaut('C')}
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>C</Text></View>
                  <View style={styles.cardTextContainer}>
                    <Text style={styles.cardTitle}>Astronauta C</Text>
                    <Text style={styles.cardSubtitle}>Ingeniería de Sistemas y Soporte Vital</Text>
                  </View>
                </Pressable>
              </View>
            )}

            {!!(error || localError) && (
              <Text accessibilityRole="alert" style={styles.error}>{localError || error}</Text>
            )}

            {connection && !data && !error && (
              <Text style={styles.text}>Conectando con Centro de Control en la Tierra…</Text>
            )}

            {crew && (
              <>
                <View style={styles.edgeBadge}>
                  <Text style={styles.edgeBadgeText}>🛰️ Edge AI On-Device Activo</Text>
                  <Text style={styles.edgeBadgeSub}>Inferencia en este dispositivo · Transmite solo telemetría</Text>
                </View>

                {isProcessingAi && (
                  <View style={styles.processingBanner}>
                    <Text style={styles.processingText}>⚙️ {aiStatusText || 'Analizando entorno localmente…'}</Text>
                  </View>
                )}

                <Text style={styles.origin}>
                  {simulated ? `Demo visual · Minuto ${data.clock.minute} · Escenas simuladas` : 'Cámara móvil · Telemetría espacial en vivo'}
                </Text>

                <View style={styles.scene}>
                  <Text style={styles.title}>Lo que observa la IA</Text>
                  <Text style={styles.text}>{latest?.summary || 'Esperando el primer análisis del entorno.'}</Text>
                  {latest?.impact && (
                    <Text style={styles.impactText}>Evaluación: {latest.impact}</Text>
                  )}
                  {latest?.suggestion && (
                    <Text style={styles.suggestionText}>Sugerencia: {latest.suggestion}</Text>
                  )}
                  {latest && (
                    <Text style={styles.origin}>
                      {new Date(latest.timestamp).toLocaleTimeString('es-MX')} · {latest.processedOn === 'edge_device' ? `🛰️ Procesado en móvil (${latest.latencyMs ? `${latest.latencyMs}ms` : 'Edge AI'})` : 'Servidor'}
                    </Text>
                  )}
                </View>

                {crew.quality === 'desactualizada' && (
                  <Text style={styles.error}>Sin observaciones recientes. Se conserva la última escena analizada.</Text>
                )}

                {cameraSession && (
                  data?.capabilities.vision ? (
                    <>
                      <Text style={styles.text}>Envía un fotograma cada 20 segundos mientras la cámara está activa.</Text>
                      <View style={styles.row}>
                        <Button
                          disabled={cameraStatus !== 'live'}
                          title={automatic ? 'Detener observación' : 'Iniciar observación'}
                          onPress={() => setAutomatic(v => !v)}
                        />
                        {!automatic && (
                          <Button
                            disabled={pending || cameraStatus !== 'live'}
                            title="Analizar ahora"
                            onPress={() => void analyze()}
                          />
                        )}
                      </View>
                    </>
                  ) : (
                    <Text style={styles.error}>El análisis visual está pendiente de activación en CentroControl.</Text>
                  )
                )}

                {alert ? (
                  <View style={styles.suggestion}>
                    <Text style={styles.title}>Posible detonador</Text>
                    {alert.triggers.map(t => (
                      <View key={t.id}>
                        <Text style={styles.title}>{triggerLabels[t.trigger]}</Text>
                        <Text style={styles.text}>{t.evidence}</Text>
                      </View>
                    ))}
                    {suggestion && (
                      <>
                        <Text style={styles.title}>{suggestion.title}</Text>
                        <Text style={styles.text}>{suggestion.description}</Text>
                      </>
                    )}
                    <View style={styles.row}>
                      <Button disabled={pending} title="Aceptar sugerencia" onPress={() => respond('aceptada')} />
                      <Button disabled={pending} title="Ahora no" onPress={() => respond('descartada')} />
                    </View>
                    {alert.response && (
                      <Text style={styles.origin}>Respuesta: {alert.response.action.replace('_', ' ')}</Text>
                    )}
                  </View>
                ) : (
                  latest && <Text style={styles.text}>Sin posibles detonadores en la última observación.</Text>
                )}

                <Text style={styles.title}>Comunicar cómo me siento · Opcional</Text>
                <Text style={styles.origin}>
                  {crew.selfReport ? `Última respuesta: ${stateLabels[crew.selfReport.state]}` : 'Esta respuesta la comunicas tú y se comparte con CentroControl.'}
                </Text>
                <View style={styles.row}>
                  <Button disabled={pending} title="Me siento bien" onPress={() => report('calma')} />
                  <Button disabled={pending} title="Siento estrés" onPress={() => report('estres')} />
                  <Button disabled={pending} title="Siento enojo" onPress={() => report('ira')} />
                </View>

                <Button
                  style={{ marginTop: 12, backgroundColor: 'transparent', borderColor: '#405672' }}
                  title="Cambiar de tripulante"
                  onPress={() => { setConnection(null); setAutomatic(false); }}
                />
              </>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', top: 0, left: 12, right: 12 },
  panel: { backgroundColor: '#0a1425ed', borderWidth: 1, borderColor: '#526580', borderRadius: 14, overflow: 'hidden' },
  attention: { borderColor: '#f8ad53' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, gap: 8 },
  scroll: { maxHeight: 520 },
  body: { padding: 16, paddingTop: 0, gap: 12 },
  title: { color: '#f1f6ff', fontWeight: '600', fontSize: 14 },
  text: { color: '#ccdaed', lineHeight: 21, fontSize: 13 },
  origin: { color: '#b1c2da', fontSize: 11 },
  scene: { borderColor: '#526580', borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  button: { backgroundColor: '#1d3452', paddingHorizontal: 12, paddingVertical: 10, minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: '#526580', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#f1f6ff', fontSize: 12, fontWeight: '500' },
  disabled: { opacity: .5 },
  error: { color: '#ffce99', fontSize: 12 },
  suggestion: { backgroundColor: '#392b20', padding: 12, borderRadius: 10, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectorContainer: { gap: 10, paddingVertical: 4 },
  selectorTitle: { color: '#f1f6ff', fontSize: 16, fontWeight: '700' },
  selectorSubtitle: { color: '#9bb7da', fontSize: 12, lineHeight: 17 },
  cardButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#13243a', borderWidth: 1, borderColor: '#324c6e', borderRadius: 10, padding: 12, gap: 12 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#59ddbf', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#0a1425', fontWeight: '700', fontSize: 14 },
  cardTextContainer: { flex: 1 },
  cardTitle: { color: '#f1f6ff', fontWeight: '600', fontSize: 13 },
  cardSubtitle: { color: '#9bb7da', fontSize: 11 },
  edgeBadge: { backgroundColor: '#0c1a2c', borderColor: '#1f3b5e', borderWidth: 1, borderRadius: 8, padding: 8, gap: 2 },
  edgeBadgeText: { color: '#59ddbf', fontSize: 11, fontWeight: '700' },
  edgeBadgeSub: { color: '#9bb7da', fontSize: 10 },
  processingBanner: { backgroundColor: '#1a3a5f', borderRadius: 6, padding: 8 },
  processingText: { color: '#bde0fe', fontSize: 12 },
  impactText: { color: '#ffd166', fontSize: 12, lineHeight: 16 },
  suggestionText: { color: '#06d6a0', fontSize: 12, lineHeight: 16 },
});
