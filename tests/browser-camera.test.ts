import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BrowserCamera } from '../src/camera/browser-camera.ts';

class Track {
  kind = 'video';
  onended: (() => void) | null = null;
  stopped = false;
  stop() { this.stopped = true; }
  getSettings() { return { deviceId: 'camera-1' }; }
}

class Stream {
  tracks: Track[];
  constructor(tracks: Track[] = [new Track()]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  removeTrack(track: Track) { this.tracks = this.tracks.filter(item => item !== track); }
}

const globals = ['window', 'document', 'navigator', 'MediaRecorder', 'indexedDB', 'localStorage'] as const;
const previous = new Map<string, PropertyDescriptor | undefined>();
let requests: MediaStreamConstraints[];
let source: Stream;
let camera: BrowserCamera;

beforeEach(() => {
  globals.forEach(key => previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)));
  source = new Stream();
  requests = [];
  Object.defineProperties(globalThis, {
    window: { value: { isSecureContext: true }, configurable: true },
    document: { value: { visibilityState: 'visible' }, configurable: true },
    navigator: { value: { mediaDevices: {
      getUserMedia: async (constraints: MediaStreamConstraints) => { requests.push(constraints); return source; },
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'camera-1', label: 'Cámara 1' }, { kind: 'audioinput', deviceId: 'mic-1' }],
    } }, configurable: true },
  });
  for (const key of ['MediaRecorder', 'indexedDB', 'localStorage']) {
    Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error(`La vista previa no debe usar ${key}`); } });
  }
  camera = new BrowserCamera();
});

afterEach(() => {
  camera.dispose();
  globals.forEach(key => {
    const descriptor = previous.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

test('opens a live camera without a recorder, audio, or persistent storage', async () => {
  await camera.activate();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { audio: false, video: { facingMode: { ideal: 'environment' } } });
  assert.equal(camera.state.status, 'live');
  assert.equal(camera.state.cameras.length, 1);
});

test('stops and removes unexpected audio tracks', async () => {
  const audio = new Track(); audio.kind = 'audio';
  source.tracks.push(audio);
  await camera.activate();
  assert.equal(audio.stopped, true);
  assert.equal(camera.state.stream?.getAudioTracks().length, 0);
});

test('switching cameras releases the previous stream', async () => {
  await camera.activate();
  const first = source;
  source = new Stream();
  await camera.activate('camera-2');
  assert.equal(first.getTracks()[0].stopped, true);
  assert.deepEqual(requests[1], { audio: false, video: { deviceId: { exact: 'camera-2' } } });
});

test('late permission responses cannot reopen a camera after leaving', async () => {
  let resolveRequest: (value: Stream) => void = () => {};
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise<Stream>(resolve => { resolveRequest = resolve; }) });
  const pending = camera.activate();
  camera.deactivate();
  resolveRequest(source);
  await pending;
  assert.equal(source.getTracks()[0].stopped, true);
  assert.equal(camera.state.stream, null);
  assert.equal(camera.state.status, 'paused');
});

test('an older camera request cannot replace the latest selected camera', async () => {
  const resolvers: ((stream: Stream) => void)[] = [];
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise<Stream>(resolve => resolvers.push(resolve)) });
  const first = camera.activate('camera-1');
  const second = camera.activate('camera-2');
  const latest = new Stream();
  resolvers[1](latest);
  await second;
  resolvers[0](source);
  await first;
  assert.equal(source.getTracks()[0].stopped, true);
  assert.equal(camera.state.stream, latest);
});

test('background suspension releases the camera and permits automatic reopening', async () => {
  await camera.activate();
  const first = source;
  camera.deactivate();
  assert.equal(first.getTracks()[0].stopped, true);
  assert.equal(camera.state.status, 'paused');
  source = new Stream();
  await camera.activate();
  assert.equal(camera.state.status, 'live');
  assert.equal(requests.length, 2);
});

test('a hidden page does not activate the camera', async () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
  await camera.activate();
  assert.equal(requests.length, 0);
  assert.equal(camera.state.status, 'paused');
});

test('disconnection releases the camera and explains the error in Spanish', async () => {
  await camera.activate();
  source.getTracks()[0].onended?.();
  assert.equal(camera.state.stream, null);
  assert.equal(camera.state.status, 'error');
  assert.match(camera.state.message, /desconectó/);
});

test('denied permissions, missing devices and busy cameras show actionable errors', async () => {
  for (const [name, expected] of [['NotAllowedError', /bloqueado/], ['NotFoundError', /No se encontró/], ['NotReadableError', /otra aplicación/]] as const) {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('', name); } });
    await camera.activate();
    assert.equal(camera.state.status, 'error');
    assert.match(camera.state.message, expected);
  }
});

test('insecure contexts are rejected before requesting camera access', async () => {
  Object.defineProperty(window, 'isSecureContext', { value: false });
  await camera.activate();
  assert.equal(requests.length, 0);
  assert.match(camera.state.message, /HTTPS/);
});

test('disposal releases preview and rejects all later activations', async () => {
  await camera.activate();
  camera.dispose();
  await camera.activate();
  assert.equal(source.getTracks()[0].stopped, true);
  assert.equal(requests.length, 1);
});
