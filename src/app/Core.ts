// The core engine: the ONE camera stream, renderer, render loop, hand tracker, gesture engine,
// spatial systems and mode controller (§2 rule 2), plus the per-frame pipeline (§5 runtime loop).
// Created exactly once via app/bootstrap.ts.

import * as THREE from 'three';
import type { KeyAction } from '@/config/keybindings';
import { FEATURE_FLAGS, TUNING } from '@/config/tuning';
import { CameraManager } from '@/core/camera';
import {
  FixturePlaybackSource,
  FixtureRecorder,
  LiveTrackerSource,
  type InputSource,
  type LandmarkFixture,
} from '@/core/input';
import { FpsMeter, FramePacer, InferenceStats, RenderLoop } from '@/core/renderLoop';
import type {
  GestureFrame,
  HandFrame,
  HandSide,
  InteractionFrame,
  ModeId,
  Settings,
} from '@/core/types';
import { describeHand, GestureEngine } from '@/gestures/GestureEngine';
import { ModeController } from '@/modes/ModeController';
import { MODE_FACTORIES } from '@/modes/registry';
import { CameraBackground } from '@/scene/CameraBackground';
import { CursorMarker } from '@/scene/materials';
import { drawGestureIndicators, drawHandSkeleton, OverlayCanvas2D } from '@/scene/overlay';
import { SceneManager } from '@/scene/SceneManager';
import { CaptureManager } from '@/spatial/CaptureManager';
import { CoordinateMapper, RaycastCursor } from '@/spatial/CoordinateMapper';
import { DepthEstimator } from '@/spatial/DepthEstimator';
import { ViewportMapper } from '@/spatial/ViewportMapper';
import { useAppStore, type AppState } from '@/state/appStore';
import { createLogger } from '@/utils/logger';
import { HandNormalizer } from '@/vision/handPipeline';
import { HandTracker, type TrackerBackend } from '@/vision/HandTracker';
import type { SmoothingMode } from '@/vision/smoothing';
import { visionWorkerSupported, WorkerTracker } from '@/vision/workerTracker';
import { counters } from './debug';

const log = createLogger('core');
const SIDES: readonly HandSide[] = ['right', 'left'];

/** The live input: the tracker source the render loop polls (worker proxy or main-thread). */
type LiveSource = InputSource & { setRate(hz: number): void };

/** Vite bundles this worker; `new Worker(new URL(…, import.meta.url))` must stay literal. */
function createVisionWorker(): Worker {
  return new Worker(new URL('../workers/visionWorker.ts', import.meta.url), {
    type: 'module',
    name: 'gs-vision',
  });
}

/** Worker by default; `?vision=main` in the URL forces the main-thread tracker (A/B, debugging). */
function preferVisionWorker(): boolean {
  const forcedMain =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('vision') === 'main';
  return FEATURE_FLAGS.visionWorker && !forcedMain && visionWorkerSupported();
}

export class Core {
  readonly camera = new CameraManager();
  readonly viewport = new ViewportMapper();
  readonly normalizer = new HandNormalizer();
  readonly gestureEngine = new GestureEngine();
  readonly recorder = new FixtureRecorder();
  readonly inferenceStats = new InferenceStats();
  readonly capture = new CaptureManager();
  readonly depth: Readonly<Record<HandSide, DepthEstimator>> = {
    left: new DepthEstimator(),
    right: new DepthEstimator(),
  };
  readonly sceneManager: SceneManager;
  readonly overlay: OverlayCanvas2D;
  readonly videoTexture: THREE.VideoTexture;
  readonly background: CameraBackground;
  readonly coords: CoordinateMapper;
  readonly cursors: RaycastCursor;
  readonly modes: ModeController;
  readonly loop: RenderLoop;
  /** Live settings object handed to modes (updated in place). */
  readonly settings: Settings;

  private readonly markers: Record<HandSide, CursorMarker> = {
    left: new CursorMarker('left'),
    right: new CursorMarker('right'),
  };
  private readonly interaction: InteractionFrame;
  private trackerBackend: TrackerBackend;
  private live: LiveSource;
  private unsubscribeTracker: () => void = () => {};
  private fellBackToMain = false;
  private input: InputSource;
  private playback: FixturePlaybackSource | null = null;

  private readonly fps = new FpsMeter();
  private readonly drawPacer = new FramePacer();
  private lastFpsPush = 0;
  private lastStatusPush = 0;
  private statusKey = '';
  private modeStatus = '';
  private wasStreaming = false;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor() {
    this.sceneManager = new SceneManager();
    counters.renderersCreated++;
    this.overlay = new OverlayCanvas2D();
    this.setLayersVisible(false); // idle screen shows the CSS backdrop

    const store = useAppStore.getState();
    this.settings = { ...store.settings };
    this.videoTexture = new THREE.VideoTexture(this.camera.video);
    this.background = new CameraBackground(this.videoTexture);
    const scene = this.sceneManager.scene;
    scene.add(this.background.mesh, this.markers.left.group, this.markers.right.group);

    this.coords = new CoordinateMapper(this.viewport, this.sceneManager.camera, this.sceneManager);
    this.cursors = new RaycastCursor(this.coords);
    const t = this.makeTracker(preferVisionWorker());
    this.trackerBackend = t.tracker;
    this.live = t.live;
    this.input = this.live;
    this.applySettings(store.settings);

    this.interaction = {
      timestamp: 0,
      dt: 0,
      hands: this.normalizer.frame,
      gestures: this.gestureEngine.frame,
      cursors: this.cursors.cursors,
      dominant: this.settings.dominant,
      activeMode: store.activeMode,
    };

    this.modes = new ModeController(
      {
        scene,
        camera: this.sceneManager.camera,
        renderer: this.sceneManager.renderer,
        overlay: this.overlay,
        videoTexture: this.videoTexture,
        viewport: this.viewport,
        coords: this.coords,
        cursors: this.cursors,
        capture: this.capture,
        settings: this.settings,
        emitStatus: this.emitStatus,
      },
      MODE_FACTORIES,
    );

    this.loop = new RenderLoop(this.frame);
    this.unsubscribers.push(
      this.camera.onChange(this.onCameraChange),
      this.modes.onHistoryChange((h) => useAppStore.getState().setHistory(h.canUndo, h.canRedo)),
      useAppStore.subscribe(this.onStoreChange),
    );
    this.unsubscribeTracker = this.trackerBackend.onChange(this.onTrackerChange);
    this.switchMode(store.activeMode);
    counters.coreCreated++;
    log.debug('core created');
  }

  /** The hand tracker (worker proxy by default, main-thread fallback). */
  get tracker(): TrackerBackend {
    return this.trackerBackend;
  }

  /** Latest perception output (reused object). */
  get hands(): HandFrame {
    return this.normalizer.frame;
  }

  /** Latest gesture output (reused object, updated every render frame). */
  get gestures(): GestureFrame {
    return this.gestureEngine.frame;
  }

  get renderFps(): number {
    return this.fps.fps;
  }

  get inputKind(): 'live' | 'fixture' {
    return this.input.kind;
  }

  get playbackInfo(): { name: string; progress: number } | null {
    return this.playback
      ? { name: this.playback.fixture.name, progress: this.playback.progress }
      : null;
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
    this.unsubscribeTracker();
    this.modes.dispose();
    this.markers.left.dispose();
    this.markers.right.dispose();
    this.live.dispose();
    this.playback?.dispose();
    this.trackerBackend.dispose();
    this.camera.dispose();
    this.background.dispose();
    this.videoTexture.dispose();
    this.overlay.dispose();
    this.sceneManager.dispose();
    counters.coreDisposed++;
    log.debug('core disposed');
  }

  retryTracker(): void {
    void this.trackerBackend.load();
  }

  /** Debug switch: raw vs smoothed vs smoothed + predicted hand visuals. */
  setSmoothingMode(mode: SmoothingMode): void {
    this.normalizer.setSmoothingMode(mode);
  }

  // --- global actions (status bar buttons + keyboard) ------------------------------------------

  undo(): void {
    this.modes.undo();
  }

  redo(): void {
    this.modes.redo();
  }

  clearMode(): void {
    this.modes.clear();
  }

  resetView(): void {
    this.modes.resetView();
  }

  /** Keyboard actions not handled by the UI shell. Returns true if something used the key. */
  handleKey(action: KeyAction): boolean {
    switch (action.type) {
      case 'undo':
        this.undo();
        return true;
      case 'redo':
        this.redo();
        return true;
      case 'clear':
        this.clearMode();
        return true;
      case 'reset':
        this.resetView();
        return true;
      case 'escape':
        this.capture.releaseAll('cancelled');
        return this.modes.handleKey(action) || true;
      default:
        return this.modes.handleKey(action);
    }
  }

  /** Replay recorded landmarks through the full pipeline (works with or without a camera). */
  playFixture(fixture: LandmarkFixture): void {
    this.playback?.dispose();
    this.playback = new FixturePlaybackSource(fixture, performance.now());
    this.input = this.playback;
    this.resetPerception();
    this.updateLoop();
    log.info(`playing fixture "${fixture.name}" (${fixture.frames.length} frames)`);
  }

  stopPlayback(): void {
    if (!this.playback) return;
    this.playback.dispose();
    this.playback = null;
    this.input = this.live;
    this.resetPerception();
    this.updateLoop();
  }

  // -------------------------------------------------------------------------------------------

  private makeTracker(useWorker: boolean): { tracker: TrackerBackend; live: LiveSource } {
    if (useWorker) {
      const wt = new WorkerTracker(createVisionWorker(), this.camera.video, this.inferenceStats);
      counters.visionWorkers++;
      log.info('hand tracking runs in a Web Worker');
      return { tracker: wt, live: wt };
    }
    const ht = new HandTracker();
    log.info('hand tracking runs on the main thread');
    return { tracker: ht, live: new LiveTrackerSource(ht, this.camera.video, this.inferenceStats) };
  }

  /** The worker could not start (old browser, blocked, crashed): carry on on the main thread. */
  private fallBackToMainThread(reason: string | null): void {
    log.warn('vision worker failed, falling back to the main thread:', reason);
    this.fellBackToMain = true;
    const wasLive = this.input === this.live;
    this.unsubscribeTracker();
    this.live.dispose();
    this.trackerBackend.dispose();
    const t = this.makeTracker(false);
    this.trackerBackend = t.tracker;
    this.live = t.live;
    this.live.setRate(this.settings.inferenceHz);
    if (wasLive) this.input = this.live;
    this.unsubscribeTracker = this.trackerBackend.onChange(this.onTrackerChange);
    if (this.camera.running) void this.trackerBackend.load();
  }

  private switchMode(id: ModeId): void {
    this.modes.switchTo(id);
    this.interaction.activeMode = id;
    counters.modeSwitches++;
  }

  private applySettings(s: Settings): void {
    Object.assign(this.settings, s);
    this.viewport.setMirror(s.mirror);
    this.normalizer.setSmoothing(s.smoothing);
    this.live.setRate(s.inferenceHz);
    if (this.interaction) this.interaction.dominant = s.dominant;
  }

  private readonly onStoreChange = (state: AppState, prev: AppState): void => {
    if (state.activeMode !== prev.activeMode) this.switchMode(state.activeMode);
    if (state.settings !== prev.settings) this.applySettings(state.settings);
    if (state.helpOpen !== prev.helpOpen || state.settingsOpen !== prev.settingsOpen) {
      this.modes.setUiCaptured(state.helpOpen || state.settingsOpen);
    }
  };

  private readonly emitStatus = (text: string): void => {
    if (text === this.modeStatus) return;
    this.modeStatus = text;
    useAppStore.getState().setModeStatus(text);
  };

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

  /** The ONE per-frame pipeline (§5 runtime loop). */
  private readonly frame = (now: number, dt: number): void => {
    this.syncViewport(); // cheap no-op unless the video or viewport size changed

    // 1–2. Inference on a new video frame (throttled) → gated, main-user-locked, smoothed HandFrame.
    const det = this.input.poll(now);
    if (det) {
      if (this.input === this.live) this.recorder.record(det);
      this.normalizer.process(det, this.viewport.mirror, now);
    } else {
      this.normalizer.tick(now); // prediction + loss grace period run every frame
    }
    const hands = this.hands;

    // 3. Gestures (every frame, so justStarted/justEnded last exactly one frame) + depth.
    const gestures = this.gestureEngine.update(hands, this.viewport.videoAspect, now);
    for (const side of SIDES) {
      const d = this.depth[side].update(hands[side], now);
      const g = gestures[side];
      if (g) g.depthSignal = d;
    }

    // 4. Scene cursors; a lost hand drops whatever it held (§10 grace → force release).
    this.cursors.update(hands);
    for (const side of SIDES) if (!hands[side]) this.capture.release(side, 'lost');
    if (!hands.left || !hands.right) this.capture.release('twoHand', 'lost');
    // While anything is held, lock hand identities by proximity (§8 hands crossing).
    this.normalizer.setIdentityLock(this.gestureEngine.capturing || this.capture.count > 0);

    // 5. Active experience.
    const f = this.interaction;
    f.timestamp = now;
    f.dt = dt;
    this.modes.update(f);

    // 6. Render: mode passes → camera background + 3D scene → 2D overlay. Only the draw is paced
    //    (D40) — it shares the GPU with the hand tracker; steps 1–5 run every display frame.
    if (this.drawPacer.due(now)) {
      this.renderFrame();
      // FPS = frames actually drawn.
      if (this.fps.tick(now) && now - this.lastFpsPush >= 1000 / TUNING.ui.statusHz) {
        this.lastFpsPush = now;
        useAppStore.getState().setFps(this.fps.fps);
      }
    }

    // 7. Throttled UI status.
    this.pushStatus(now);
  };

  private renderFrame(): void {
    this.modes.render();
    const cam = this.sceneManager.camera;
    for (const side of SIDES) {
      this.markers[side].update(this.cursors.cursors[side], this.gestures[side]?.pinch.phase, cam);
    }
    this.sceneManager.render();

    const ov = this.overlay;
    ov.clear();
    if (this.settings.showSkeleton) {
      const { left, right } = this.hands;
      if (left) drawHandSkeleton(ov.ctx, left, this.viewport);
      if (right) drawHandSkeleton(ov.ctx, right, this.viewport);
    }
    drawGestureIndicators(
      ov.ctx,
      this.hands,
      this.gestures,
      this.gestureEngine.bothHandsVisible,
      this.viewport,
    );
    this.modes.drawOverlay(ov.ctx);
  }

  /** Push hand/gesture status to the UI at ≤ statusHz, and only when it changes. */
  private pushStatus(now: number): void {
    if (now - this.lastStatusPush < 1000 / TUNING.ui.statusHz) return;
    this.lastStatusPush = now;
    const { left, right } = this.hands;
    const g = this.gestures;
    const two = g.twoHand.active ? ' · Two-hand ✓' : '';
    const text = `Right: ${describeHand(right, g.right)} · Left: ${describeHand(left, g.left)}${two}`;
    if (text === this.statusKey) return;
    this.statusKey = text;
    const store = useAppStore.getState();
    const count = (left ? 1 : 0) + (right ? 1 : 0);
    if (store.handCount !== count) store.setHandCount(count);
    store.setStatusText(text);
  }

  private resetPerception(): void {
    this.live.reset?.();
    this.normalizer.clear(performance.now());
    this.gestureEngine.reset();
    this.capture.releaseAll('lost');
    for (const side of SIDES) this.depth[side].update(undefined, 0);
    this.cursors.update(this.normalizer.frame);
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
    this.drawPacer.reset();
    this.inferenceStats.reset();
    this.resetPerception();
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
    if (streaming && this.trackerBackend.status === 'idle') void this.trackerBackend.load();

    useAppStore.getState().setCamera(cam.state, cam.error);
  };

  private readonly onTrackerChange = (t: TrackerBackend): void => {
    if (t.thread === 'worker' && t.status === 'error' && !this.fellBackToMain) {
      this.fallBackToMainThread(t.error);
      return;
    }
    if (t.status === 'ready') counters.trackersCreated++;
    useAppStore.getState().setTracker(t.status, t.error, t.delegate);
  };
}
