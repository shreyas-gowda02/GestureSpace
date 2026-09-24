// Hand tracking in a Web Worker (§23: "Web Worker for vision only if profiling shows main-thread
// jank" — it did: ~12 FPS on the user's laptop with inference blocking the render loop).
//
//   main thread (WorkerTracker)                 worker (workers/visionWorker.ts)
//   ───────────────────────────                 ────────────────────────────────
//   FrameGate: new camera frame due?
//   createImageBitmap(video) ── detect ───────▶ HandLandmarker.detectForVideo(bitmap)
//   (one frame in flight max — never queue)      packResult → Float32Array
//   unpack into reused RawDetection ◀── result ─ (the same buffer ping-pongs back and forth)
//
// The render loop never waits for inference: poll() returns the newest finished result (if any)
// and immediately sends the next frame. WorkerTracker is both the TrackerBackend (status) and the
// live InputSource, so Core treats it exactly like the main-thread tracker.

import {
  makeDetection,
  makeHandPool,
  FrameGate,
  type InputSource,
  type RawDetection,
  type RawHand,
} from '@/core/input';
import type { InferenceStats } from '@/core/renderLoop';
import { TUNING } from '@/config/tuning';
import { createLogger } from '@/utils/logger';
import type {
  TrackerBackend,
  TrackerDelegate,
  TrackerResult,
  TrackerStatus,
  TrackerThread,
} from './HandTracker';
import { LANDMARK_COUNT } from './landmarks';

const log = createLogger('vision-worker');

// ---------------------------------------------------------------------------------------------
// Wire protocol (shared with the worker; pure + unit-tested)
// ---------------------------------------------------------------------------------------------

export const WIRE_MAX_HANDS: number = TUNING.tracker.numHands;
/** Per hand: label code, score, 21×xyz image landmarks, 21×xyz world landmarks. */
const HAND_STRIDE = 2 + LANDMARK_COUNT * 6;
/** Header: hand count. */
export const WIRE_LENGTH = 1 + WIRE_MAX_HANDS * HAND_STRIDE;

const LABEL_CODE: Record<string, number> = { Left: 1, Right: 2 };
const LABEL_NAME = ['', 'Left', 'Right'] as const;

export type ToWorker =
  | { type: 'load' }
  | { type: 'detect'; frame: ImageBitmap; ts: number; gen: number; buffer: Float32Array }
  | { type: 'dispose' };

export type FromWorker =
  | {
      type: 'status';
      status: TrackerStatus;
      delegate: TrackerDelegate | null;
      error: string | null;
      loadMs: number;
    }
  | { type: 'result'; ts: number; gen: number; ms: number; buffer: Float32Array };

/** Worker side: MediaPipe result → flat buffer. */
export function packResult(result: TrackerResult, buf: Float32Array): void {
  const n = Math.min(result.landmarks.length, WIRE_MAX_HANDS);
  buf[0] = n;
  for (let h = 0; h < n; h++) {
    const base = 1 + h * HAND_STRIDE;
    const cat = result.handedness[h]?.[0];
    buf[base] = LABEL_CODE[cat?.categoryName ?? ''] ?? 0;
    buf[base + 1] = cat?.score ?? 0;
    const lms = result.landmarks[h];
    const world = result.worldLandmarks[h];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const p = lms?.[i];
      const w = world?.[i];
      const o = base + 2 + i * 3;
      buf[o] = p?.x ?? 0;
      buf[o + 1] = p?.y ?? 0;
      buf[o + 2] = p?.z ?? 0;
      const ow = base + 2 + LANDMARK_COUNT * 3 + i * 3;
      buf[ow] = w?.x ?? 0;
      buf[ow + 1] = w?.y ?? 0;
      buf[ow + 2] = w?.z ?? 0;
    }
  }
}

/** Main side: flat buffer → reused RawDetection (no allocation). */
export function unpackDetection(
  buf: Float32Array,
  det: RawDetection,
  pool: readonly RawHand[],
  ts: number,
  width: number,
  height: number,
): RawDetection {
  det.timestamp = ts;
  det.videoWidth = width;
  det.videoHeight = height;
  det.hands.length = 0;
  const n = Math.min(buf[0] ?? 0, pool.length);
  for (let h = 0; h < n; h++) {
    const hand = pool[h];
    if (!hand) continue;
    const base = 1 + h * HAND_STRIDE;
    hand.handedness = LABEL_NAME[buf[base] ?? 0] ?? '';
    hand.score = buf[base + 1] ?? 0;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const p = hand.landmarks[i];
      const o = base + 2 + i * 3;
      if (p) {
        p.x = buf[o] ?? 0;
        p.y = buf[o + 1] ?? 0;
        p.z = buf[o + 2] ?? 0;
      }
      const w = hand.worldLandmarks?.[i];
      const ow = base + 2 + LANDMARK_COUNT * 3 + i * 3;
      if (w) {
        w.x = buf[ow] ?? 0;
        w.y = buf[ow + 1] ?? 0;
        w.z = buf[ow + 2] ?? 0;
      }
    }
    det.hands.push(hand);
  }
  return det;
}

/** Can this browser run the vision worker (module worker + OffscreenCanvas + ImageBitmap)? */
export function visionWorkerSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

// ---------------------------------------------------------------------------------------------
// Main-thread proxy
// ---------------------------------------------------------------------------------------------

type Listener = (tracker: TrackerBackend) => void;

export class WorkerTracker implements TrackerBackend, InputSource {
  readonly thread: TrackerThread = 'worker';
  readonly kind = 'live';
  status: TrackerStatus = 'idle';
  delegate: TrackerDelegate | null = null;
  error: string | null = null;
  loadMs = 0;

  private readonly worker: Worker;
  private readonly video: HTMLVideoElement;
  private readonly stats: InferenceStats;
  private readonly gate: FrameGate;
  private readonly listeners = new Set<Listener>();
  /** Ping-pong buffer: null while it is in the worker. */
  private buffer: Float32Array | null = new Float32Array(WIRE_LENGTH);
  private inFlight = false;
  /** Bumped by reset(): results for older generations are dropped. */
  private generation = 0;
  private sentWidth = 0;
  private sentHeight = 0;
  private hasResult = false;
  private readonly detection = makeDetection();
  private readonly pool = makeHandPool(WIRE_MAX_HANDS);
  private disposed = false;
  private loadWaiters: (() => void)[] = [];

  constructor(worker: Worker, video: HTMLVideoElement, stats: InferenceStats) {
    this.worker = worker;
    this.video = video;
    this.stats = stats;
    this.gate = new FrameGate(video, stats);
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onWorkerError);
  }

  get ready(): boolean {
    return this.status === 'ready';
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Idempotent; after an error it retries. Resolves when the worker is ready or failed. */
  load(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve();
    const done = new Promise<void>((resolve) => this.loadWaiters.push(resolve));
    if (this.status !== 'loading') {
      this.setStatus('loading', this.delegate, null, this.loadMs);
      this.post({ type: 'load' });
    }
    return done;
  }

  setRate(hz: number): void {
    this.gate.setRate(hz);
  }

  poll(now: number): RawDetection | null {
    const out = this.hasResult ? this.detection : null;
    this.hasResult = false;
    if (!this.inFlight && this.ready && this.buffer) {
      const ts = this.gate.take(now);
      if (ts !== null) this.send(ts);
    }
    return out;
  }

  reset(): void {
    this.generation++;
    this.hasResult = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gate.dispose();
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.post({ type: 'dispose' });
    this.worker.terminate();
    this.listeners.clear();
    for (const w of this.loadWaiters) w();
    this.loadWaiters = [];
  }

  private send(ts: number): void {
    const buffer = this.buffer;
    if (!buffer) return;
    this.inFlight = true;
    this.buffer = null;
    this.sentWidth = this.video.videoWidth;
    this.sentHeight = this.video.videoHeight;
    const gen = this.generation;
    createImageBitmap(this.video)
      .then((frame) => {
        if (this.disposed) {
          frame.close();
          return;
        }
        this.post({ type: 'detect', frame, ts, gen, buffer }, [frame, buffer.buffer]);
      })
      .catch((err: unknown) => {
        // e.g. the video had no frame yet — just try again on the next one.
        log.debug('createImageBitmap failed', err);
        this.buffer = buffer;
        this.inFlight = false;
      });
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private readonly onMessage = (e: MessageEvent<FromWorker>): void => {
    const msg = e.data;
    if (msg.type === 'status') {
      this.setStatus(msg.status, msg.delegate, msg.error, msg.loadMs);
      return;
    }
    this.buffer = msg.buffer;
    this.inFlight = false;
    if (msg.gen !== this.generation) return; // stale (camera stopped / input switched meanwhile)
    unpackDetection(msg.buffer, this.detection, this.pool, msg.ts, this.sentWidth, this.sentHeight);
    this.hasResult = true;
    this.stats.record(performance.now(), msg.ms);
  };

  private readonly onWorkerError = (e: ErrorEvent): void => {
    e.preventDefault();
    log.error('vision worker failed', e.message);
    this.inFlight = false;
    this.setStatus('error', this.delegate, e.message || 'The vision worker failed to start.', 0);
  };

  private setStatus(
    status: TrackerStatus,
    delegate: TrackerDelegate | null,
    error: string | null,
    loadMs: number,
  ): void {
    this.status = status;
    this.delegate = delegate;
    this.error = error;
    this.loadMs = loadMs;
    if (status === 'ready' || status === 'error') {
      for (const w of this.loadWaiters) w();
      this.loadWaiters = [];
    }
    for (const l of this.listeners) l(this);
  }
}
