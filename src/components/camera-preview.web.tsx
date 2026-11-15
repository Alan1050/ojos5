import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BrowserCamera } from '../camera/browser-camera';
import MissionOverlay from '../mission/MissionOverlay';

const initialState = new BrowserCamera().state;
const initialSnapshot = () => initialState;

export default function CameraPreview() {
  const [controller] = useState(() => new BrowserCamera());

  useEffect(() => {
    const camera = controller;
    void camera.activate();

    const visibility = () => {
      if (document.visibilityState === 'hidden') camera.deactivate();
      else if (camera.state.status === 'paused') void camera.activate(camera.state.selectedCamera || undefined);
    };
    const hide = () => camera.deactivate();
    const show = () => {
      if (document.visibilityState !== 'hidden' && camera.state.status === 'paused') {
        void camera.activate(camera.state.selectedCamera || undefined);
      }
    };
    const devices = () => { void camera.refreshCameras(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    navigator.mediaDevices?.addEventListener('devicechange', devices);
    return () => {
      camera.deactivate();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      navigator.mediaDevices?.removeEventListener('devicechange', devices);
    };
  }, [controller]);

  return <CameraView controller={controller}/>;
}

function CameraView({ controller }: { controller: BrowserCamera }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, initialSnapshot);
  const video = useRef<HTMLVideoElement>(null);
  const [needsPlayback, setNeedsPlayback] = useState(false);

  const capture = useCallback(async () => {
    const element = video.current;
    if (!element || element.readyState < 2 || !element.videoWidth) throw new Error('La cámara todavía no está lista.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640, element.videoWidth);
    canvas.height = Math.round(element.videoHeight * canvas.width / element.videoWidth);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo capturar el fotograma.');
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .6);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = state.stream;
    if (state.stream) void element.play().catch(() => setNeedsPlayback(true));
    return () => { element.srcObject = null; };
  }, [state.stream]);

  return (
    <main className="camera-screen" aria-label="Cámara en vivo">
      <video ref={video} className="camera-feed" autoPlay playsInline muted disablePictureInPicture aria-label="Vista en vivo de la cámara" hidden={!state.stream} onPlaying={() => setNeedsPlayback(false)}/>
      {state.status !== 'live' && <div className="camera-message" role={state.status === 'error' ? 'alert' : 'status'}>
        <div className="camera-message-card">
          <h1>{state.status === 'error' ? 'No se pudo abrir la cámara' : state.status === 'paused' ? 'Cámara en pausa' : 'Abriendo tu cámara…'}</h1>
          <p>{state.message || (state.status === 'paused' ? 'La cámara se reanudará al volver a Ojos.' : 'Si aparece una solicitud, permite el acceso a la cámara.')}</p>
          {state.status === 'error' && <button className="camera-button" onClick={() => void controller?.activate()}>Volver a intentar</button>}
        </div>
      </div>}
      {state.status === 'live' && needsPlayback && <div className="camera-message"><div className="camera-message-card"><p>El navegador requiere un toque para mostrar la cámara.</p><button className="camera-button" onClick={() => void video.current?.play().catch(() => controller?.fail('El navegador no pudo mostrar la cámara. Vuelve a intentarlo.'))}>Mostrar cámara</button></div></div>}
      {state.status === 'live' && state.cameras.length > 1 && <label className="camera-picker">
        <span className="visually-hidden">Elegir cámara</span>
        <select aria-label="Elegir cámara" value={state.selectedCamera} onChange={event => void controller?.activate(event.target.value)}>
          {state.cameras.map((camera, index) => <option key={camera.deviceId || index} value={camera.deviceId}>{camera.label || `Cámara ${index + 1}`}</option>)}
        </select>
      </label>}
      <MissionOverlay cameraStatus={state.status} capture={capture} />
    </main>
  );
}
