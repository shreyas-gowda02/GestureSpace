// Creates core singletons exactly once (§2 rule 2).
// Guarded at module level so React StrictMode's double-invoked effects cannot duplicate
// the camera stream, tracker, render loop or renderer. Ref-counted: the core is torn down
// only when the last consumer releases it.

import { FEATURE_FLAGS } from '@/config/featureFlags';
import { createLogger } from '@/utils/logger';

const log = createLogger('bootstrap');

/** Dev/test-only counters read by E2E to prove nothing is duplicated. */
export interface DebugCounters {
  coreCreated: number;
  coreDisposed: number;
  renderLoops: number;
  trackers: number;
  cameraStreams: number;
}

export interface Core {
  readonly createdAt: number;
  dispose(): void;
}

let core: Core | null = null;
let refCount = 0;

const counters: DebugCounters = {
  coreCreated: 0,
  coreDisposed: 0,
  renderLoops: 0,
  trackers: 0,
  cameraStreams: 0,
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

function createCore(): Core {
  counters.coreCreated++;
  log.debug('core created');
  // Phase 1+: CameraManager, SceneManager, renderLoop, HandTracker are created here.
  return {
    createdAt: performance.now(),
    dispose() {
      counters.coreDisposed++;
      log.debug('core disposed');
    },
  };
}

/** Acquire the shared core. Pair every call with `releaseCore()`. */
export function acquireCore(): Core {
  if (!core) core = createCore();
  refCount++;
  return core;
}

export function releaseCore(): void {
  if (refCount === 0) return;
  refCount--;
  if (refCount === 0 && core) {
    // Defer teardown one microtask so StrictMode's unmount→remount doesn't churn the core.
    const pending = core;
    queueMicrotask(() => {
      if (refCount === 0 && core === pending) {
        pending.dispose();
        core = null;
      }
    });
  }
}
