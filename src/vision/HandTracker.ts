// The ONE MediaPipe HandLandmarker (§2 rule 2, §9). Loads once (idempotent), GPU delegate with
// CPU fallback, self-hosted model + WASM. The MediaPipe bundle is dynamically imported so it is
// only downloaded once the camera is actually enabled.

import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { TUNING } from '@/config/tuning';
import { createLogger } from '@/utils/logger';

const log = createLogger('tracker');

export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type TrackerDelegate = 'GPU' | 'CPU';
export type TrackerResult = HandLandmarkerResult;

type Listener = (tracker: HandTracker) => void;

const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

export class HandTracker {
  status: TrackerStatus = 'idle';
  delegate: TrackerDelegate | null = null;
  error: string | null = null;
  /** Wall time the last successful load took (ms). */
  loadMs = 0;

  private landmarker: HandLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;
  private readonly listeners = new Set<Listener>();

  get ready(): boolean {
    return this.status === 'ready' && this.landmarker !== null;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Idempotent: concurrent/repeated calls share one load. Retries only after an error. */
  load(): Promise<void> {
    this.loading ??= this.doLoad();
    return this.loading;
  }

  /** Synchronous inference on the current video frame. Only call when `ready`. */
  detect(video: HTMLVideoElement, timestampMs: number): TrackerResult {
    if (!this.landmarker) throw new Error('HandTracker.detect() called before load');
    return this.landmarker.detectForVideo(video, timestampMs);
  }

  dispose(): void {
    this.disposed = true;
    this.landmarker?.close();
    this.landmarker = null;
    this.listeners.clear();
  }

  private async doLoad(): Promise<void> {
    const t0 = performance.now();
    this.error = null;
    this.setStatus('loading');
    try {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(assetUrl(TUNING.tracker.wasmBasePath));
      const t = TUNING.tracker;
      const create = (delegate: TrackerDelegate) =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: assetUrl(t.modelAssetPath), delegate },
          runningMode: 'VIDEO',
          numHands: t.numHands,
          minHandDetectionConfidence: t.minHandDetectionConfidence,
          minHandPresenceConfidence: t.minHandPresenceConfidence,
          minTrackingConfidence: t.minTrackingConfidence,
        });

      let landmarker: HandLandmarker;
      try {
        landmarker = await create('GPU');
        this.delegate = 'GPU';
      } catch (gpuErr) {
        log.warn('GPU delegate failed, falling back to CPU', gpuErr);
        landmarker = await create('CPU');
        this.delegate = 'CPU';
      }

      if (this.disposed) {
        landmarker.close();
        return;
      }
      this.landmarker = landmarker;
      this.loadMs = performance.now() - t0;
      log.info(`ready (${this.delegate}) in ${Math.round(this.loadMs)} ms`);
      this.setStatus('ready');
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.loading = null; // allow Retry
      log.error('failed to load hand tracker', err);
      this.setStatus('error');
    }
  }

  private setStatus(status: TrackerStatus): void {
    this.status = status;
    for (const l of this.listeners) l(this);
  }
}
