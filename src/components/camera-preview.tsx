import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraView, type CameraType, type LensInfo } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { palettes } from '../constants/palette';
import MissionOverlay from '../mission/MissionOverlay';

type Status = 'connecting' | 'live' | 'paused' | 'error';

function lensLabel(lens: LensInfo, index: number) {
  if (lens.deviceType.includes('UltraWide')) return 'Ultra gran angular';
  if (lens.deviceType.includes('Telephoto')) return 'Teleobjetivo';
  if (lens.deviceType.includes('WideAngle')) return 'Gran angular';
  return `Lente ${index + 1}`;
}

export default function CameraPreview() {
  const colors = palettes[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [lenses, setLenses] = useState<LensInfo[]>([]);
  const [selectedLens, setSelectedLens] = useState<string>();
  const focused = useRef(false);
  const askedPermission = useRef(false);
  const pendingPermission = useRef<Promise<Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>> | null>(null);
  const cameraVisible = useRef(false);
  const requestId = useRef(0);
  const camera = useRef<CameraView>(null);
  const capturing = useRef(false);
  const capture = useCallback(async () => {
    if (!camera.current || capturing.current || status !== 'live') throw new Error('La cámara todavía no está lista.');
    capturing.current = true;
    try {
      const photo = await camera.current.takePictureAsync({ base64: true, quality: .15 });
      if (!photo.base64) throw new Error('No se pudo capturar el entorno.');
      if (photo.base64.length > 880000) throw new Error('El fotograma supera el tamaño admitido. Usa la versión web para el análisis visual.');
      return `data:image/jpeg;base64,${photo.base64}`;
    } finally { capturing.current = false; }
  }, [status]);

  const activate = useCallback(async (requestPermission: boolean) => {
    if (cameraVisible.current) return;
    const request = ++requestId.current;
    setStatus('connecting');
    setMessage('');
    try {
      let pending = pendingPermission.current;
      if (!pending) {
        pending = (async () => {
          const permission = await Camera.getCameraPermissionsAsync();
          if (!permission.granted && permission.canAskAgain && requestPermission && focused.current && AppState.currentState !== 'background') {
            askedPermission.current = true;
            return Camera.requestCameraPermissionsAsync();
          }
          return permission;
        })();
        pendingPermission.current = pending;
        const clearPending = () => {
          if (pendingPermission.current === pending) pendingPermission.current = null;
        };
        void pending.then(clearPending, clearPending);
      }
      const permission = await pending;
      if (!focused.current || request !== requestId.current) return;
      setCanAskAgain(permission.canAskAgain);
      setHasPermission(permission.granted);
      if (AppState.currentState && AppState.currentState !== 'active') {
        setStatus('paused');
        return;
      }
      if (!permission.granted) {
        setStatus('error');
        setMessage(permission.canAskAgain ? 'Permite el acceso a la cámara para verla en vivo.' : 'El acceso a la cámara está bloqueado. Permítelo en los ajustes de Ojos.');
        return;
      }
      cameraVisible.current = true;
      setCameraActive(true);
    } catch {
      if (focused.current && request === requestId.current) {
        setStatus('error');
        setMessage('No se pudo acceder a la cámara. Revisa los permisos y vuelve a intentarlo.');
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void activate(!askedPermission.current);
    return () => {
      focused.current = false;
      requestId.current++;
      cameraVisible.current = false;
      setCameraActive(false);
    };
  }, [activate]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (!focused.current) return;
      if (state === 'active') void activate(!askedPermission.current);
      else if (cameraVisible.current || !pendingPermission.current) {
        requestId.current++;
        cameraVisible.current = false;
        setCameraActive(false);
        setStatus('paused');
      }
    });
    return () => subscription.remove();
  }, [activate]);

  const buttonStyle = { backgroundColor: colors.card, borderColor: colors.border };
  return <View style={styles.screen}>
    {cameraActive && <CameraView
      ref={camera}
      key={`${facing}-${selectedLens ?? 'default'}`}
      style={StyleSheet.absoluteFill}
      mode="picture"
      mute
      facing={facing}
      selectedLens={selectedLens}
      mirror={false}
      onCameraReady={() => setStatus('live')}
      onAvailableLensesChanged={event => setLenses(event.lenses)}
      onMountError={() => {
        cameraVisible.current = false;
        setCameraActive(false);
        setStatus('error');
        setMessage('No se encontró una cámara disponible para esta selección. Comprueba si otra aplicación la está usando o cambia de cámara.');
      }}/>
    }
    {status !== 'live' && <View style={[styles.messageOverlay, { backgroundColor: colors.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{status === 'error' ? 'No se pudo abrir la cámara' : status === 'paused' ? 'Cámara en pausa' : 'Abriendo tu cámara…'}</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.textSecondary }]}>{message || (status === 'paused' ? 'La cámara se reanudará al volver a Ojos.' : 'Permite el acceso a la cámara si el dispositivo lo solicita.')}</Text>
      {status === 'error' && <Pressable accessibilityRole="button" style={[styles.button, buttonStyle]} onPress={() => {
        if (canAskAgain) void activate(true);
        else void Linking.openSettings().catch(() => setMessage('Abre los ajustes del dispositivo y permite el acceso a la cámara para Ojos.'));
      }}><Text style={{ color: colors.foreground }}>{canAskAgain ? 'Volver a intentar' : 'Abrir Ajustes'}</Text></Pressable>}
    </View>}
    {(status === 'live' || (status === 'error' && hasPermission)) && <SafeAreaView style={styles.controls} pointerEvents="box-none" edges={['bottom', 'left', 'right']}>
      <View style={styles.buttonRow}>
        <Pressable accessibilityRole="button" style={[styles.button, buttonStyle]} onPress={() => { setSelectedLens(undefined); setLenses([]); setFacing(f => f === 'back' ? 'front' : 'back'); }}><Text style={{ color: colors.foreground }}>Cambiar cámara</Text></Pressable>
        {lenses.length > 1 && <Pressable accessibilityRole="button" style={[styles.button, buttonStyle]} onPress={() => { const index = (lenses.findIndex(l => l.deviceType === selectedLens) + 1) % lenses.length; setSelectedLens(lenses[index].deviceType); }}><Text style={{ color: colors.foreground }}>{lenses.find(l => l.deviceType === selectedLens) ? lensLabel(lenses.find(l => l.deviceType === selectedLens)!, 0) : 'Cambiar lente'}</Text></Pressable>}
      </View>
    </SafeAreaView>}
    <MissionOverlay cameraStatus={status} capture={capture} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1b3b' },
  messageOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 18 },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 23, textAlign: 'center', maxWidth: 380 },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 10, padding: 20 },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
});
