// Composition root: creates the core singletons exactly once (§2 rule 2) — one camera stream,
// one renderer, one render loop, one hand tracker. Ref-counted and module-guarded so React
// StrictMode's mount → unmount → mount cannot duplicate or churn them.

import * as THREE from 'three';
import { FEATURE_FLAGS, TUNING } from '@/config/tuning';
import { CameraManager, type CameraError } from '@/core/camera';
import {
  FixturePlaybackSource,
  FixtureRecorder,
  LiveTrackerSource,
  type InputSource,
  type LandmarkFixture,
} from '@/core/input';
import { FpsMeter, InferenceStats, RenderLoop } from '@/core/renderLoop';
import type { HandFrame, HandSide } from '@/core/types';
import { CameraBackground } from '@/scene/CameraBackground';
import { drawHandSkeleton, OverlayCanvas2D } from '@/scene/overlay';
import { SceneManager } from '@/scene/SceneManager';
import { ViewportMapper } from '@/spatial/ViewportMapper';
import { useAppStore } from '@/state/appStore';
import { createLogger } from '@/utils/logger';
import { HandNormalizer } from '@/vision/handPipeline';
import { HandTracker, type TrackerDelegate, type TrackerStatus } from '@/vision/HandTracker';
import { WRIST } from '@/vision/landmarks';

const log = createLogger('core');

/** Dev/test-only counters read by E2E to prove nothing is ever duplicated. */
export interface DebugCounters {
  coreCreated: number;
  coreDisposed: number;
  renderersCreated: number;
  renderLoopsStarted: number;
  renderLoopsActive: number;
  cameraStreamsStarted: number;
  cameraStreamsActive: number;
  trackersCreated: number;
}

const counters: DebugCounters = {
  coreCreated: 0,
  coreDisposed: 0,
  renderersCreated: 0,
  renderLoopsStarted: 0,
  renderLoopsActive: 0,
  cameraStreamsStarted: 0,
  cameraStreamsActive: 0,
  trackersCreated: 0,
};

declare global {
  interface Window {
    __gs_debug?: DebugCounters;
  }
}

if (FEATURE_FLAGS.debugCounters && typeof window !== 'undefined') {
  window.__gs_debug = counters;
}

export function getDebugCounters(): Readonly<DebugCounters> {
  return counters;
}

/** Plain snapshot for the debug panel (polled at ~4 Hz, never per frame). */
export interface DebugSnapshot {
  renderFps: number;
  inferenceFps: number;
  inferenceMs: number;
  inferenceCount: number;
  skippedFrames: number;
  tracker: {
    status: TrackerStatus;
    delegate: TrackerDelegate | null;
    loadMs: number;
    error: string | null;
  };
  input: 'live' | 'fixture';
  playback: { name: string; progress: number } | null;
  recording: boolean;
  recordedFrames: number;
  video: { width: number; height: number };
  viewport: { width: number; height: number; dpr: number };
  mirror: boolean;
  hands: {
    side: HandSide;
    rawLabel: string;
    score: number;
    palmScale: number;
    wrist: { x: number; y: number };
  }[];
}

// ---------------------------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------------------------

export class Core {
  readonly camera = new CameraManager();
  readonly viewport = new ViewportMapper();
  readonly tracker = new HandTracker();
  readonly normalizer = new HandNormalizer();
  readonly recorder = new FixtureRecorder();
  readonly inferenceStats = new InferenceStats();
  readonly sceneManager: SceneManager;
  readonly overlay: OverlayCanvas2D;
  readonly videoTexture: THREE.VideoTexture;
  readonly background: CameraBackground;
  readonly loop: RenderLoop;

  private readonly live: LiveTrackerSource;
  private input: InputSource;
  private playback: FixturePlaybackSource | null = null;

  private readonly fps = new FpsMeter();
  private lastFpsPush = 0;
  private lastStatusPush = 0;
  private statusKey = '';
  private wasStreaming = false;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor() {
    this.sceneManager = new SceneManager();
    counters.renderersCreated++;
    this.overlay = new OverlayCanvas2D();
    this.setLayersVisible(false); // idle screen shows the CSS backdrop

    this.viewport.setMirror(TUNING.scene.mirror);
    this.videoTexture = new THREE.VideoTexture(this.camera.video);
    this.background = new CameraBackground(this.videoTexture);
    this.sceneManager.scene.add(this.background.mesh);

    this.live = new LiveTrackerSource(this.tracker, this.camera.video, this.inferenceStats);
    this.input = this.live;

    this.loop = new RenderLoop(this.frame);
    this.unsubscribers.push(
      this.camera.onChange(this.onCameraChange),
      this.tracker.onChange(this.onTrackerChange),
    );
    counters.coreCreated++;
    log.debug('core created');
  }

  /** Latest perception output (reused object; valid until the next inference). */
  get hands(): HandFrame {
    return this.normalizer.frame;
  }

  get playbackActive(): boolean {
    return this.playback !== null;
  }

  /** Attach canvases + hidden video to the stage element (idempotent). */
  mount(container: HTMLElement): void {
    if (this.container === container) return;
    this.unmount();
    this.container = container;
    container.append(this.sceneManager.canvas, this.overlay.canvas, this.camera.video);
    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(container);
    this.syncSize();
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container = null;
  }

  dispose(): void {
    this.unmount();
    this.stopLoop();
    for (const off of this.unsubscribers) off();
    this.live.dispose();
    this.playback?.dispose();
    this.tracker.dispose();
    this.camera.dispose();
    this.background.dispose();
    this.videoTexture.dispose();
    this.overlay.dispose();
    this.sceneManager.dispose();
    counters.coreDisposed++;
    log.debug('core disposed');
  }

  retryTracker(): void {
    void this.tracker.load();
  }

  /** Replay recorded landmarks through the full pipeline (works with or without a camera). */
  playFixture(fixture: LandmarkFixture): void {
    this.playback?.dispose();
    this.playback = new FixturePlaybackSource(fixture, performance.now());
    this.input = this.playback;
    this.normalizer.clear(performance.now());
    this.updateLoop();
    log.info(`playing fixture "${fixture.name}" (${fixture.frames.length} frames)`);
  }

  stopPlayback(): void {
    if (!this.playback) return;
    this.playback.dispose();
    this.playback = null;
    this.input = this.live;
    this.normalizer.clear(performance.now());
    this.updateLoop();
  }

  debugSnapshot(): DebugSnapshot {
    const hands: DebugSnapshot['hands'] = [];
    for (const side of ['right', 'left'] as const) {
      const h = this.hands[side];
      if (!h) continue;
      const slot = this.normalizer.slots[side];
      const w = h.landmarks[WRIST];
      hands.push({
        side,
        rawLabel: slot.rawLabel,
        score: h.score,
        palmScale: h.palmScale,
        wrist: { x: w?.x ?? 0, y: w?.y ?? 0 },
      });
    }
    const s = this.inferenceStats;
    return {
      renderFps: this.fps.fps,
      inferenceFps: s.fps,
      inferenceMs: s.avgMs,
      inferenceCount: s.count,
      skippedFrames: s.skippedFrames,
      tracker: {
        status: this.tracker.status,
        delegate: this.tracker.delegate,
        loadMs: this.tracker.loadMs,
        error: this.tracker.error,
      },
      input: this.input.kind,
      playback: this.playback
        ? { name: this.playback.fixture.name, progress: this.playback.progress }
        : null,
      recording: this.recorder.recording,
      recordedFrames: this.recorder.frameCount,
      video: { width: this.viewport.videoWidth, height: this.viewport.videoHeight },
      viewport: {
        width: this.sceneManager.width,
        height: this.sceneManager.height,
        dpr: this.sceneManager.renderer.getPixelRatio(),
      },
      mirror: this.viewport.mirror,
      hands,
    };
  }

  // -------------------------------------------------------------------------------------------

  private syncSize(): void {
    const el = this.container;
    if (!el) return;
    const sm = this.sceneManager;
    sm.setSize(el.clientWidth, el.clientHeight);
    this.overlay.setSize(sm.width, sm.height, sm.renderer.getPixelRatio());
    this.syncViewport();
    if (this.loop.running) this.renderFrame(); // repaint immediately; avoids resize flicker
  }

  private syncViewport(): void {
    const sm = this.sceneManager;
    const live = this.camera.running;
    const fx = this.playback?.fixture;
    const vw = live ? this.camera.width : (fx?.videoWidth ?? 0);
    const vh = live ? this.camera.height : (fx?.videoHeight ?? 0);
    this.viewport.update(vw, vh, sm.width, sm.height);
    this.background.sync(this.viewport, sm.drawingBuffer, live);
  }

  /** The ONE per-frame pipeline (§5 runtime loop). Stages are added phase by phase. */
  private readonly frame = (now: number): void => {
    this.syncViewport(); // cheap no-op unless the video or viewport size changed

    // 1–2. Inference on a new video frame (throttled) → normalized HandFrame.
    const det = this.input.poll(now);
    if (det) {
      if (this.input === this.live) this.recorder.record(det);
      this.normalizer.process(det, this.viewport.mirror, now);
    }

    // 6. Render: camera background + 3D scene → 2D overlay.
    this.renderFrame();

    // 7. Perf + throttled UI status.
    if (this.fps.tick(now) && now - this.lastFpsPush >= 1000 / TUNING.ui.statusHz) {
      this.lastFpsPush = now;
      useAppStore.getState().setFps(this.fps.fps);
    }
    this.pushStatus(now);
  };

  private renderFrame(): void {
    this.sceneManager.render();
    const ov = this.overlay;
    ov.clear();
    if (TUNING.overlay.showSkeleton) {
      const { left, right } = this.hands;
      if (left) drawHandSkeleton(ov.ctx, left, this.viewport);
      if (right) drawHandSkeleton(ov.ctx, right, this.viewport);
    }
  }

  /** Push hand presence to the UI at ≤ statusHz, and only when it changes. */
  private pushStatus(now: number): void {
    if (now - this.lastStatusPush < 1000 / TUNING.ui.statusHz) return;
    this.lastStatusPush = now;
    const { left, right } = this.hands;
    const key = `${right ? 'R' : '-'}${left ? 'L' : '-'}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    const store = useAppStore.getState();
    store.setHandCount((left ? 1 : 0) + (right ? 1 : 0));
    store.setStatusText(`Right: ${right ? 'tracked' : '—'} · Left: ${left ? 'tracked' : '—'}`);
  }

  private resetStatus(): void {
    this.statusKey = '';
    const store = useAppStore.getState();
    store.setHandCount(0);
    store.setStatusText('Right: — · Left: —');
  }

  private setLayersVisible(visible: boolean): void {
    const v = visible ? 'visible' : 'hidden';
    this.sceneManager.canvas.style.visibility = v;
    this.overlay.canvas.style.visibility = v;
  }

  /** Run the loop while there is something to show: a live camera or fixture playback. */
  private updateLoop(): void {
    const wanted = this.camera.running || this.playback !== null;
    if (wanted) {
      if (this.loop.start()) {
        counters.renderLoopsStarted++;
        counters.renderLoopsActive++;
      }
    } else {
      this.stopLoop();
    }
    this.setLayersVisible(wanted);
    this.syncViewport();
  }

  private stopLoop(): void {
    if (!this.loop.running) return;
    this.loop.stop();
    counters.renderLoopsActive--;
    this.fps.reset();
    this.inferenceStats.reset();
    this.normalizer.clear(performance.now());
    this.overlay.clear();
    this.resetStatus();
    useAppStore.getState().setFps(0);
  }

  private readonly onCameraChange = (cam: CameraManager): void => {
    const streaming = cam.state === 'running';
    if (streaming && !this.wasStreaming) {
      counters.cameraStreamsStarted++;
      counters.cameraStreamsActive++;
    } else if (!streaming && this.wasStreaming) {
      counters.cameraStreamsActive--;
    }
    this.wasStreaming = streaming;

    // "Camera stopped: everything paused" (§21.3) — unless a fixture is playing.
    this.updateLoop();
    // Load the tracker the first time the camera runs (loads exactly once).
    if (streaming && this.tracker.status === 'idle') void this.tracker.load();

    useAppStore.getState().setCamera(cam.state, cam.error);
  };

  private readonly onTrackerChange = (t: HandTracker): void => {
    if (t.status === 'ready') counters.trackersCreated++;
    useAppStore.getState().setTracker(t.status, t.error, t.delegate);
  };
}

// ---------------------------------------------------------------------------------------------
// Ref-counted singleton
// ---------------------------------------------------------------------------------------------

export interface RefCounted<T> {
  acquire(): T;
  release(): void;
  peek(): T | null;
}

/**
 * Create-once, ref-counted holder. Teardown is deferred one microtask so StrictMode's
 * synchronous unmount → remount reuses the same instance instead of destroying it.
 */
export function createRefCounted<T extends { dispose(): void }>(factory: () => T): RefCounted<T> {
  let instance: T | null = null;
  let refs = 0;
  return {
    acquire() {
      instance ??= factory();
      refs++;
      return instance;
    },
    release() {
      if (refs === 0) return;
      refs--;
      if (refs > 0 || !instance) return;
      const pending = instance;
      queueMicrotask(() => {
        if (refs === 0 && instance === pending) {
          pending.dispose();
          instance = null;
        }
      });
    },
    peek: () => instance,
  };
}

const coreHolder = createRefCounted(() => new Core());

export const acquireCore = (): Core => coreHolder.acquire();
export const releaseCore = (): void => coreHolder.release();
export const getCore = (): Core | null => coreHolder.peek();

// ---------------------------------------------------------------------------------------------
// UI actions (React calls these; it never touches the camera/tracker/renderer directly)
// ---------------------------------------------------------------------------------------------

export function startCamera(): void {
  const core = getCore();
  if (!core) return;
  void core.camera.start();
}

export function stopCamera(): void {
  getCore()?.camera.stop();
}

export function retryTracker(): void {
  getCore()?.retryTracker();
}

/** Surface a core creation failure (e.g. no WebGL2) through the normal camera error UI. */
export function reportCoreFailure(err: unknown): void {
  const error: CameraError = {
    kind: 'unsupported',
    message: err instanceof Error ? err.message : String(err),
  };
  log.error('core failed to start', err);
  useAppStore.getState().setCamera('error', error);
}
