// Composition root: holds the ONE Core (§2 rule 2) — ref-counted and module-guarded so React
// StrictMode's mount → unmount → mount cannot duplicate or churn it — plus the UI actions React
// calls. React never touches the camera, tracker, renderer or modes directly.

import type { KeyAction } from '@/config/keybindings';
import { TUNING } from '@/config/tuning';
import type { CameraError } from '@/core/camera';
import type { ModeId } from '@/core/types';
import type { ModeAction } from '@/modes/types';
import { useAppStore } from '@/state/appStore';
import {
  downloadSceneFile,
  makeSceneFile,
  parseSceneFile,
  readScene,
  writeScene,
} from '@/state/persistence';
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
  void getCore()?.startCamera();
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

/** Tool-panel button of the active experience (tool, colour, depth…). */
export function modeAction(action: ModeAction): void {
  getCore()?.modeAction(action);
}

// --- scenes (§22): the active experience's Save / Load / Export / Import ------------------------

/** The active experience's content now (undefined: none). */
function activeScene(): { core: Core; id: ModeId; data: unknown } | null {
  const core = getCore();
  const id = core?.modes.activeId;
  const data = id ? core?.modes.sceneOf(id) : undefined;
  return core && id && data !== undefined ? { core, id, data } : null;
}

/** Save: into the experience's one saved slot. */
export async function saveScene(): Promise<boolean> {
  const s = activeScene();
  return s ? writeScene(s.core.scenes, 'saved', s.id, s.data) : false;
}

/** Load: the saved slot back, as one undo step. */
export async function loadSavedScene(): Promise<'loaded' | 'none' | 'invalid'> {
  const core = getCore();
  const id = core?.modes.activeId;
  if (!core || !id) return 'none';
  const data = await readScene(core.scenes, 'saved', id);
  if (data === null) return 'none';
  return core.modes.loadScene(id, data, 'Load saved scene') ? 'loaded' : 'invalid';
}

/** Export: download the active experience's scene as a JSON file. */
export function exportScene(): boolean {
  const s = activeScene();
  if (!s) return false;
  downloadSceneFile(makeSceneFile(s.id, s.data));
  return true;
}

/**
 * Import a scene file (its text, untrusted): switches to its experience if needed, then loads it
 * as one undo step. Returns an error message, or null if it worked.
 */
export function importScene(text: string): string | null {
  const core = getCore();
  if (!core) return 'The app is not ready yet.';
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'This file is not valid JSON.';
  }
  const file = parseSceneFile(raw);
  if ('error' in file) return file.error;
  if (core.modes.activeId !== file.mode) useAppStore.getState().setActiveMode(file.mode);
  return core.modes.loadScene(file.mode, file.data, 'Import scene')
    ? null
    : 'This scene file is damaged or from a different version of the app.';
}

// --- the first-run walkthrough's checks (§21.4) --------------------------------------------------

export type OnboardingStep = 'welcome' | 'hand' | 'pinch' | 'spread' | 'done';
export type OnboardingSnap = ReturnType<Core['onboardingSnapshot']>;

/** What the walkthrough checks (polled a few times a second). */
export function onboardingSnapshot(): OnboardingSnap | null {
  return getCore()?.onboardingSnapshot() ?? null;
}

/** Is this step's hand check met right now? (The walkthrough also wants it held a moment.) */
export function stepMet(step: OnboardingStep, snap: OnboardingSnap): boolean {
  switch (step) {
    case 'hand':
      return snap.right;
    case 'pinch':
      return snap.pinch;
    case 'spread':
      return snap.spread >= TUNING.onboarding.spread;
    default:
      return false;
  }
}

/** Asked for the right hand, only a "left" one is seen: maybe the camera mirrors (swap hint). */
export const onlyLeftSeen = (snap: OnboardingSnap): boolean => snap.left && !snap.right;

/** Cameras to choose from (names show once camera access was allowed). */
export async function listCameras(): Promise<{ id: string; label: string }[]> {
  const devices = (await getCore()?.camera.listDevices()) ?? [];
  return devices.map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
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
