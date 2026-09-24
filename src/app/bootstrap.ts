// Composition root: holds the ONE Core (§2 rule 2) — ref-counted and module-guarded so React
// StrictMode's mount → unmount → mount cannot duplicate or churn it — plus the UI actions React
// calls. React never touches the camera, tracker, renderer or modes directly.

import type { KeyAction } from '@/config/keybindings';
import type { CameraError } from '@/core/camera';
import { useAppStore } from '@/state/appStore';
import { createLogger } from '@/utils/logger';
import { Core } from './Core';
import {
  buildDebugSnapshot,
  runLeakCheck,
  type DebugSnapshot,
  type LeakCheckResult,
} from './debug';

export { Core } from './Core';
export {
  getDebugCounters,
  type DebugCounters,
  type DebugSnapshot,
  type LeakCheckResult,
} from './debug';

const log = createLogger('core');

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
// UI actions
// ---------------------------------------------------------------------------------------------

export function startCamera(): void {
  void getCore()?.camera.start();
}

export function stopCamera(): void {
  getCore()?.camera.stop();
}

export function retryTracker(): void {
  getCore()?.retryTracker();
}

export function undo(): void {
  getCore()?.undo();
}

export function redo(): void {
  getCore()?.redo();
}

export function clearMode(): void {
  getCore()?.clearMode();
}

export function resetView(): void {
  getCore()?.resetView();
}

/** Forward a keyboard action to the core / active mode. Returns true if it was used. */
export function handleKeyAction(action: KeyAction): boolean {
  return getCore()?.handleKey(action) ?? false;
}

export function debugSnapshot(): DebugSnapshot | null {
  const core = getCore();
  return core ? buildDebugSnapshot(core) : null;
}

export function leakCheck(cycles?: number): LeakCheckResult | null {
  const core = getCore();
  return core ? runLeakCheck(core, cycles) : null;
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
