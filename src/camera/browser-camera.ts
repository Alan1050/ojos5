export type CameraStatus = 'connecting' | 'live' | 'paused' | 'error';
export type BrowserCameraState = {
  status: CameraStatus;
  stream: MediaStream | null;
  cameras: MediaDeviceInfo[];
  selectedCamera: string;
  message: string;
};

export function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'El acceso a la cámara está bloqueado. Permítelo en los ajustes de este sitio y vuelve a intentarlo.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No se encontró una cámara. Conecta una cámara y vuelve a intentarlo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'No se pudo abrir la cámara. Comprueba que otra aplicación no la esté usando.';
    case 'OverconstrainedError':
      return 'Esa cámara ya no está disponible. Vuelve a intentarlo para usar otra.';
    case 'SecurityError':
      return 'El navegador bloqueó la cámara. Abre Ojos mediante HTTPS o localhost y revisa los permisos.';
    default:
      return 'No se pudo acceder a la cámara. Revisa la conexión y los permisos e inténtalo de nuevo.';
  }
}

function pageIsHidden() {
  return document.visibilityState === 'hidden';
}

/** A live stream for preview only. No encoder, recording buffers or storage. */
export class BrowserCamera {
  state: BrowserCameraState = {
    status: 'connecting', stream: null, cameras: [], selectedCamera: '', message: '',
  };
  private listeners = new Set<() => void>();
  private requestId = 0;
  private disposed = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  snapshot = () => this.state;

  private update(patch: Partial<BrowserCameraState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private releaseStream() {
    this.state.stream?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    this.update({ stream: null });
  }

  async refreshCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.update({ cameras: devices.filter(device => device.kind === 'videoinput') });
    } catch {
      // Preview still works if a browser hides its device list.
    }
  }

  async activate(deviceId?: string) {
    if (this.disposed) return;
    const request = ++this.requestId;
    this.releaseStream();
    if (pageIsHidden()) {
      this.update({ status: 'paused' });
      return;
    }
    if (!window.isSecureContext) {
      this.update({ status: 'error', message: 'La cámara necesita una conexión segura. Usa HTTPS o abre localhost en este dispositivo.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.update({ status: 'error', message: 'Este navegador no permite abrir la cámara. Prueba una versión reciente de Safari, Chrome, Edge o Firefox.' });
      return;
    }
    this.update({ status: 'connecting', message: '' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
      });
      if (this.disposed || request !== this.requestId || pageIsHidden()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach(item => item.stop());
        throw new DOMException('No camera', 'NotFoundError');
      }
      stream.getAudioTracks().forEach(item => { item.stop(); stream.removeTrack(item); });
      track.onended = () => this.fail('Se desconectó la cámara. Conéctala y vuelve a intentarlo.');
      this.update({ stream, status: 'live', selectedCamera: track.getSettings().deviceId ?? deviceId ?? '' });
      await this.refreshCameras();
    } catch (error) {
      if (request === this.requestId) this.update({ status: 'error', message: cameraError(error) });
    }
  }

  deactivate() {
    ++this.requestId;
    this.releaseStream();
    this.update({ status: 'paused', message: '' });
  }

  fail(message: string) {
    this.deactivate();
    this.update({ status: 'error', message });
  }

  dispose() {
    this.deactivate();
    this.disposed = true;
    this.listeners.clear();
  }
}
