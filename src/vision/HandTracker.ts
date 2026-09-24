// The ONE MediaPipe HandLandmarker (§2 rule 2, §9). Loads once (idempotent), GPU delegate with
// CPU fallback, self-hosted model + WASM. The MediaPipe bundle is dynamically imported so it is
// only downloaded once the camera is actually enabled.
// Runs inside the vision Web Worker by default (workers/visionWorker.ts, with `moduleWasm`), or on
// the main thread as a fallback. Both expose the same TrackerBackend status interface.

import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { TUNING } from '@/config/tuning';
import { createLogger } from '@/utils/logger';

const log = createLogger('tracker');

export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type TrackerDelegate = 'GPU' | 'CPU';
export type TrackerResult = HandLandmarkerResult;

/** Where inference runs. */
export type TrackerThread = 'worker' | 'main';

/** Status surface shared by the main-thread HandTracker and the worker proxy (WorkerTracker). */
export interface TrackerBackend {
  readonly thread: TrackerThread;
  readonly status: TrackerStatus;
  readonly delegate: TrackerDelegate | null;
  readonly error: string | null;
  /** Wall time the last successful load took (ms). */
  readonly loadMs: number;
  readonly ready: boolean;
  onChange(listener: (tracker: TrackerBackend) => void): () => void;
  load(): Promise<void>;
  dispose(): void;
}

export interface HandTrackerOptions {
  /**
   * Load MediaPipe's ES-module WASM build (required inside a module Web Worker, where the
   * classic loader's importScripts() is unavailable).
   */
  moduleWasm?: boolean;
}

type Listener = (tracker: TrackerBackend) => void;

/**
 * Absolute asset URL (works on the page and in the worker). Absolute on purpose: Vite's dev
 * server rewrites root-relative dynamic imports to `…?import`, which breaks MediaPipe's
 * runtime import of its WASM loader inside the worker.
 */
const assetUrl = (path: string): string =>
  new URL(`${import.meta.env.BASE_URL}${path}`, self.location.href).href;

export class HandTracker implements TrackerBackend {
  readonly thread: TrackerThread = 'main';
  status: TrackerStatus = 'idle';
  delegate: TrackerDelegate | null = null;
  error: string | null = null;
  /** Wall time the last successful load took (ms). */
  loadMs = 0;

  private landmarker: HandLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;
  private readonly listeners = new Set<Listener>();
  private readonly moduleWasm: boolean;

  constructor(opts: HandTrackerOptions = {}) {
    this.moduleWasm = opts.moduleWasm ?? false;
  }

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

  /** Synchronous inference on one frame (video element, ImageBitmap…). Only call when `ready`. */
  detect(image: TexImageSource, timestampMs: number): TrackerResult {
    if (!this.landmarker) throw new Error('HandTracker.detect() called before load');
    return this.landmarker.detectForVideo(image, timestampMs);
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
      const fileset = await FilesetResolver.forVisionTasks(
        assetUrl(TUNING.tracker.wasmBasePath),
        this.moduleWasm,
      );
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
