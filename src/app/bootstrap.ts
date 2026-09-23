// Composition root: creates the core singletons exactly once (§2 rule 2) — one camera stream,
// one renderer, one render loop (tracker joins in Phase 2). Ref-counted and module-guarded so
// React StrictMode's mount → unmount → mount cannot duplicate or churn them.

import * as THREE from 'three';
import { FEATURE_FLAGS, TUNING } from '@/config/tuning';
import { CameraManager, type CameraError } from '@/core/camera';
import { FpsMeter, RenderLoop } from '@/core/renderLoop';
import { CameraBackground } from '@/scene/CameraBackground';
import { SceneManager } from '@/scene/SceneManager';
import { ViewportMapper } from '@/spatial/ViewportMapper';
import { useAppStore } from '@/state/appStore';
import { createLogger } from '@/utils/logger';

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

// ---------------------------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------------------------

export class Core {
  readonly camera = new CameraManager();
  readonly viewport = new ViewportMapper();
  readonly sceneManager: SceneManager;
  readonly videoTexture: THREE.VideoTexture;
  readonly background: CameraBackground;
  readonly loop: RenderLoop;

  private readonly fps = new FpsMeter();
  private lastFpsPush = 0;
  private wasStreaming = false;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly unsubscribeCamera: () => void;

  constructor() {
    this.sceneManager = new SceneManager();
    counters.renderersCreated++;
    this.sceneManager.canvas.style.visibility = 'hidden'; // idle screen shows the CSS backdrop

    this.viewport.setMirror(TUNING.scene.mirror);
    this.videoTexture = new THREE.VideoTexture(this.camera.video);
    this.background = new CameraBackground(this.videoTexture);
    this.sceneManager.scene.add(this.background.mesh);

    this.loop = new RenderLoop(this.frame);
    this.unsubscribeCamera = this.camera.onChange(this.onCameraChange);
    counters.coreCreated++;
    log.debug('core created');
  }

  /** Attach canvas + hidden video to the stage element (idempotent). */
  mount(container: HTMLElement): void {
    if (this.container === container) return;
    this.unmount();
    this.container = container;
    container.append(this.sceneManager.canvas, this.camera.video);
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
    this.unsubscribeCamera();
    this.camera.dispose();
    this.background.dispose();
    this.videoTexture.dispose();
    this.sceneManager.dispose();
    counters.coreDisposed++;
    log.debug('core disposed');
  }

  private syncSize(): void {
    const el = this.container;
    if (!el) return;
    this.sceneManager.setSize(el.clientWidth, el.clientHeight);
    this.syncViewport();
    if (this.loop.running) this.sceneManager.render(); // repaint immediately; avoids resize flicker
  }

  private syncViewport(): void {
    const sm = this.sceneManager;
    this.viewport.update(this.camera.width, this.camera.height, sm.width, sm.height);
    this.background.sync(this.viewport, sm.drawingBuffer);
  }

  private readonly frame = (now: number): void => {
    this.syncViewport(); // cheap no-op unless the video or viewport size changed
    this.sceneManager.render();
    if (this.fps.tick(now) && now - this.lastFpsPush >= 1000 / TUNING.ui.statusHz) {
      this.lastFpsPush = now;
      useAppStore.getState().setFps(this.fps.fps);
    }
  };

  private startLoop(): void {
    if (this.loop.start()) {
      counters.renderLoopsStarted++;
      counters.renderLoopsActive++;
    }
  }

  private stopLoop(): void {
    if (!this.loop.running) return;
    this.loop.stop();
    counters.renderLoopsActive--;
    this.fps.reset();
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

    // "Camera stopped: everything paused" (§21.3).
    if (streaming) this.startLoop();
    else this.stopLoop();
    this.sceneManager.canvas.style.visibility = streaming ? 'visible' : 'hidden';
    this.syncViewport();

    useAppStore.getState().setCamera(cam.state, cam.error);
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
// UI actions (React calls these; it never touches the camera/renderer directly)
// ---------------------------------------------------------------------------------------------

export function startCamera(): void {
  const core = getCore();
  if (!core) return;
  void core.camera.start();
}

export function stopCamera(): void {
  getCore()?.camera.stop();
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
