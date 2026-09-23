// The ONE camera stream (§2 rule 2): getUserMedia + hidden <video>, start/stop/resolution/device,
// error classification, and browser capability checks. Knows nothing about Three.js or React.

import { TUNING } from '@/config/tuning';
import { createLogger } from '@/utils/logger';

const log = createLogger('camera');

export type CameraState = 'idle' | 'requesting' | 'running' | 'stopped' | 'error';

export type CameraErrorKind =
  'denied' | 'notFound' | 'inUse' | 'insecure' | 'unsupported' | 'ended' | 'unknown';

export interface CameraError {
  kind: CameraErrorKind;
  message: string;
}

export interface CameraStartOptions {
  deviceId?: string;
  width?: number;
  height?: number;
}

/** Map a getUserMedia / play() failure to a UI-actionable kind. Pure; unit-tested. */
export function classifyCameraError(err: unknown): CameraError {
  const name =
    err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err)
      ? String((err as { name: unknown }).name)
      : '';
  const message = err instanceof Error ? err.message : String(err);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { kind: 'denied', message };
    case 'SecurityError':
      return { kind: 'insecure', message };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { kind: 'notFound', message };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'inUse', message };
    case 'TypeError':
    case 'NotSupportedError':
      return { kind: 'unsupported', message };
    default:
      return { kind: 'unknown', message };
  }
}

/** Startup compatibility check (§27). Returns the first blocking problem, or null. */
export function checkCameraSupport(): CameraError | null {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return { kind: 'insecure', message: 'Camera access requires HTTPS or localhost.' };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { kind: 'unsupported', message: 'navigator.mediaDevices.getUserMedia is unavailable.' };
  }
  if (typeof WebAssembly !== 'object') {
    return { kind: 'unsupported', message: 'WebAssembly is unavailable.' };
  }
  return null;
}

function buildConstraints(opts: CameraStartOptions): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: opts.width ?? TUNING.camera.idealWidth },
    height: { ideal: opts.height ?? TUNING.camera.idealHeight },
  };
  if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
  else video.facingMode = TUNING.camera.facingMode;
  return { video, audio: false };
}

function stopTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

type Listener = (camera: CameraManager) => void;

export class CameraManager {
  /** Hidden but in the DOM (mounted by the core); drives the shared VideoTexture. */
  readonly video: HTMLVideoElement;
  state: CameraState = 'idle';
  error: CameraError | null = null;
  deviceId: string | null = null;
  deviceLabel = '';

  private stream: MediaStream | null = null;
  /** Bumped by every start/stop so a superseded async start can bail out. */
  private requestId = 0;
  private readonly listeners = new Set<Listener>();

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.className = 'gs-video';
    this.video = v;
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  get width(): number {
    return this.video.videoWidth;
  }

  get height(): number {
    return this.video.videoHeight;
  }

  get running(): boolean {
    return this.state === 'running';
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  /** Request the camera (must be triggered by a user gesture the first time). */
  async start(opts: CameraStartOptions = {}): Promise<void> {
    const unsupported = checkCameraSupport();
    if (unsupported) {
      this.fail(unsupported);
      return;
    }

    const id = ++this.requestId;
    this.releaseStream();
    this.error = null;
    this.setState('requesting');

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(opts));
      } catch (err) {
        // Resolution constraints can't be met: fall back to any camera rather than failing.
        if (classifyCameraError(err).kind !== 'notFound' || opts.deviceId) throw err;
        log.warn('constraints failed, retrying with defaults', err);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (id !== this.requestId) {
        stopTracks(stream); // stop() or a newer start() happened while the prompt was open
        return;
      }

      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', this.onTrackEnded);
      this.deviceId = track?.getSettings().deviceId ?? null;
      this.deviceLabel = track?.label ?? '';

      this.video.srcObject = stream;
      await this.video.play();
      if (this.video.videoWidth === 0) {
        await new Promise<void>((resolve) =>
          this.video.addEventListener('loadedmetadata', () => resolve(), { once: true }),
        );
      }
      if (id !== this.requestId) return;

      log.info(`running ${this.width}×${this.height} (${this.deviceLabel || 'default camera'})`);
      this.setState('running');
    } catch (err) {
      if (id !== this.requestId) return;
      this.releaseStream();
      this.fail(classifyCameraError(err));
    }
  }

  stop(): void {
    this.requestId++;
    this.releaseStream();
    if (this.state !== 'idle') this.setState('stopped');
  }

  dispose(): void {
    this.stop();
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.listeners.clear();
    this.video.remove();
  }

  private releaseStream(): void {
    if (!this.stream) return;
    for (const t of this.stream.getVideoTracks()) t.removeEventListener('ended', this.onTrackEnded);
    stopTracks(this.stream);
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  private fail(error: CameraError): void {
    log.warn(`camera error (${error.kind}):`, error.message);
    this.error = error;
    this.setState('error');
  }

  private setState(state: CameraState): void {
    this.state = state;
    for (const l of this.listeners) l(this);
  }

  /** Camera unplugged, permission revoked mid-session, or the OS took the device. */
  private readonly onTrackEnded = (): void => {
    this.requestId++;
    this.releaseStream();
    this.fail({ kind: 'ended', message: 'The camera stream ended.' });
  };

  private readonly onDeviceChange = (): void => {
    const track = this.stream?.getVideoTracks()[0];
    if (this.running && track?.readyState === 'ended') this.onTrackEnded();
  };
}
