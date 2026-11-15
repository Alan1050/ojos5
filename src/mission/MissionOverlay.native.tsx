import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchActiveSession, sendAction } from './client';
import { isCanceledError, runEdgeVision } from './client-ai';
import { connectionFromFragment, interventionText, stateLabels, triggerLabels } from './protocol';
import type { AstronautId, Connection, MentalState, ResponseAction, SessionCreated, VisualResult } from './protocol';
import { useMission } from './useMission';

const DEFAULT_API_URL = 'https://centrocontrolneuro.netlify.app';

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
  const [automatic, setAutomatic] = useState(true);
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [aiStatusText, setAiStatusText] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const lastExecutionRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
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
        // Auto-conectar automáticamente con Astronauta A para inicio manos libres
        if (!connectionRef.current && session.crewKeys['A']) {
          setConnection({
            apiUrl: DEFAULT_API_URL,
            sessionId: session.sessionId,
            key: session.crewKeys['A'],
            astronautId: 'A',
          });
          setAutomatic(true);
        }
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
      if (inFlightRef.current || now - lastExecutionRef.current < 13000) {
        return;
      }
      if (AppState.currentState !== 'active') return;
      const conn = connectionRef.current;
      if (!conn?.astronautId) return;

      inFlightRef.current = true;
      lastExecutionRef.current = now;
      setIsProcessingAi(true);
      setAiStatusText('Analizando entorno…');
      try {
        const image = await captureRef.current();
        if (cancelled) return;
        setCapturedImage(image);

        let result: VisualResult | null = null;
        const sess = activeSessionRef.current;

        try {
          result = await runEdgeVision(image, profileRef.current, {
            apiKey: sess?.clientAi?.apiKey,
            model: sess?.clientAi?.model,
          });
        } catch (edgeErr: unknown) {
          if (isCanceledError(edgeErr)) return;
          result = await runEdgeVision(image, profileRef.current, { forceContingency: true });
        }

        if (!cancelled && result) {
          result.thumbnail = image;
          await sendAction(conn, '/vision', { astronautId: conn.astronautId, result });
          setLocalError('');
        }
      } catch (e: unknown) {
        if (!cancelled && !isCanceledError(e)) {
          setLocalError(e instanceof Error ? e.message : 'No se pudo procesar el entorno.');
        }
      } finally {
        inFlightRef.current = false;
        setIsProcessingAi(false);
        setAiStatusText('');
      }
    };

    void sample();
    const timer = setInterval(() => void sample(), 13000);
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
    setAutomatic(true);
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
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    lastExecutionRef.current = now;
    setLocalError('');
    setIsProcessingAi(true);
    setAiStatusText('Analizando entorno…');
    try {
      const image = await captureRef.current();
      setCapturedImage(image);
      let result: VisualResult | null = null;
      const sess = activeSessionRef.current;

      try {
        result = await runEdgeVision(image, profileRef.current, {
          apiKey: sess?.clientAi?.apiKey,
          model: sess?.clientAi?.model,
        });
      } catch (edgeErr: unknown) {
        if (isCanceledError(edgeErr)) return;
        result = await runEdgeVision(image, profileRef.current, { forceContingency: true });
      }

      if (result) {
        result.thumbnail = image;
        await action('/vision', { astronautId: conn.astronautId, result });
      }
    } catch (e: unknown) {
      if (!isCanceledError(e)) {
        setLocalError(e instanceof Error ? e.message : 'No se pudo capturar el entorno.');
      }
    } finally {
      inFlightRef.current = false;
      setIsProcessingAi(false);
      setAiStatusText('');
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

                <View style={styles.scene}>
                  {(capturedImage || latest?.thumbnail) && (
                    <View style={styles.thumbnailContainer}>
                      <Image
                        source={{ uri: capturedImage || latest?.thumbnail }}
                        style={styles.thumbnail}
                        resizeMode="cover"
                      />
                    </View>
                  )}
                  <Text style={styles.title}>Lo que observa la cámara</Text>
                  {isProcessingAi && (
                    <Text style={styles.processingText}>⚙️ {aiStatusText || 'Analizando entorno…'}</Text>
                  )}
                  <Text style={styles.text}>{latest?.summary || 'Esperando el primer análisis del entorno.'}</Text>
                  {latest?.impact && (
                    <Text style={styles.impactText}>Evaluación: {latest.impact}</Text>
                  )}
                  {latest?.suggestion && (
                    <Text style={styles.suggestionText}>Sugerencia: {latest.suggestion}</Text>
                  )}
                </View>

                {crew.quality === 'desactualizada' && (
                  <Text style={styles.error}>Sin observaciones recientes. Se conserva la última escena analizada.</Text>
                )}

                {cameraSession && (
                  data?.capabilities.vision ? (
                    <>
                      <Text style={styles.text}>
                        {automatic
                          ? 'Observación continua automática activa.'
                          : 'Observación automática en pausa. Pulsa reanudar para continuar.'}
                      </Text>
                      <View style={styles.row}>
                        <Button
                          disabled={cameraStatus !== 'live'}
                          title={automatic ? 'Pausar observación' : 'Reanudar observación'}
                          onPress={() => setAutomatic(v => !v)}
                        />
                        <Button
                          disabled={pending || cameraStatus !== 'live' || isProcessingAi}
                          title="Analizar ahora"
                          onPress={() => void analyze()}
                        />
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
  thumbnailContainer: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#050c18',
    borderWidth: 1,
    borderColor: '#324c6e',
    marginBottom: 4,
  },
  thumbnail: {
    width: '100%',
    height: 160,
  },
  processingBanner: { backgroundColor: '#1a3a5f', borderRadius: 6, padding: 8 },
  processingText: { color: '#59ddbf', fontSize: 12 },
  impactText: { color: '#ffd166', fontSize: 12, lineHeight: 16 },
  suggestionText: { color: '#06d6a0', fontSize: 12, lineHeight: 16 },
});
