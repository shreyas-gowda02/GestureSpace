// Dev/debug instrumentation: duplication counters (read by E2E), the Debug panel snapshot and the
// mode-switch leak check (§23: renderer.info.memory must return to baseline).

import { FEATURE_FLAGS } from '@/config/tuning';
import { MODE_IDS, type GesturePhase, type HandSide, type ModeId } from '@/core/types';
import type { TrackerDelegate, TrackerStatus } from '@/vision/HandTracker';
import { WRIST } from '@/vision/landmarks';
import type { SmoothingMode } from '@/vision/smoothing';
import type { Core } from './Core';

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
  modeSwitches: number;
}

export const counters: DebugCounters = {
  coreCreated: 0,
  coreDisposed: 0,
  renderersCreated: 0,
  renderLoopsStarted: 0,
  renderLoopsActive: 0,
  cameraStreamsStarted: 0,
  cameraStreamsActive: 0,
  trackersCreated: 0,
  modeSwitches: 0,
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
  /** Main-user lock at the last inference. */
  userLock: { detected: number; gated: number; used: number; identityLocked: boolean };
  smoothingHz: number;
  smoothingMode: SmoothingMode;
  hands: {
    side: HandSide;
    rawLabel: string;
    score: number;
    palmScale: number;
    lostForMs: number;
    wrist: { x: number; y: number };
    gestures: { name: string; phase: GesturePhase; value: number }[];
    depth: { signal: number; steps: number };
    cursor: { kind: string; id?: string; x: number; y: number; z: number } | null;
  }[];
  twoHand: {
    active: boolean;
    scale: number;
    rotationDeg: number;
    distance: number;
    cancelFirstHand: HandSide | null;
  };
  mode: {
    active: ModeId | null;
    created: number;
    captures: string[];
    targets: number;
    canUndo: boolean;
    canRedo: boolean;
  };
  renderer: { calls: number; triangles: number; geometries: number; textures: number };
}

const GESTURE_NAMES = ['pinch', 'grab', 'point', 'openPalm', 'thumbPinky'] as const;

export function buildDebugSnapshot(core: Core): DebugSnapshot {
  const hands: DebugSnapshot['hands'] = [];
  for (const side of ['right', 'left'] as const) {
    const h = core.hands[side];
    if (!h) continue;
    const w = h.landmarks[WRIST];
    const g = core.gestures[side];
    const cur = core.cursors.cursors[side];
    const d = core.depth[side];
    hands.push({
      side,
      rawLabel: core.normalizer.slots[side].rawLabel,
      score: h.score,
      palmScale: h.palmScale,
      lostForMs: h.lostForMs,
      wrist: { x: w?.x ?? 0, y: w?.y ?? 0 },
      gestures: g
        ? GESTURE_NAMES.map((name) => ({ name, phase: g[name].phase, value: g[name].value }))
        : [],
      depth: { signal: d.signal, steps: d.steps },
      cursor: cur?.hit
        ? {
            kind: cur.hit.kind,
            id: cur.hit.objectId,
            x: cur.hit.point.x,
            y: cur.hit.point.y,
            z: cur.hit.point.z,
          }
        : null,
    });
  }
  const two = core.gestures.twoHand;
  const n = core.normalizer;
  const s = core.inferenceStats;
  const info = core.sceneManager.renderer.info;
  const history = core.modes.history;
  return {
    renderFps: core.renderFps,
    inferenceFps: s.fps,
    inferenceMs: s.avgMs,
    inferenceCount: s.count,
    skippedFrames: s.skippedFrames,
    tracker: {
      status: core.tracker.status,
      delegate: core.tracker.delegate,
      loadMs: core.tracker.loadMs,
      error: core.tracker.error,
    },
    input: core.inputKind,
    playback: core.playbackInfo,
    recording: core.recorder.recording,
    recordedFrames: core.recorder.frameCount,
    video: { width: core.viewport.videoWidth, height: core.viewport.videoHeight },
    viewport: {
      width: core.sceneManager.width,
      height: core.sceneManager.height,
      dpr: core.sceneManager.renderer.getPixelRatio(),
    },
    mirror: core.viewport.mirror,
    userLock: {
      detected: n.detectedCount,
      gated: n.gatedCount,
      used: n.usedCount,
      identityLocked: n.identityLocked,
    },
    smoothingHz: n.visualMinCutoff,
    smoothingMode: n.smoothingMode,
    hands,
    twoHand: {
      active: two.active,
      scale: two.scale,
      rotationDeg: (two.rotation * 180) / Math.PI,
      distance: two.distance,
      cancelFirstHand: two.cancelFirstHand,
    },
    mode: {
      active: core.modes.activeId,
      created: core.modes.createdCount,
      captures: core.capture.describe(),
      targets: core.cursors.targetCount,
      canUndo: history?.canUndo ?? false,
      canRedo: history?.canRedo ?? false,
    },
    renderer: {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    },
  };
}

export interface LeakCheckResult {
  cycles: number;
  before: { geometries: number; textures: number };
  after: { geometries: number; textures: number };
  modesCreated: number;
  ok: boolean;
}

/**
 * §23 dev check: switch through all seven modes `cycles` times, rendering each, and verify GPU
 * memory (geometries / textures) ends exactly where it was after the first (warm-up) cycle.
 */
export function runLeakCheck(core: Core, cycles = 10): LeakCheckResult {
  const { modes, sceneManager } = core;
  const mem = sceneManager.renderer.info.memory;
  const start = modes.activeId;
  const cycle = (): void => {
    for (const id of MODE_IDS) {
      modes.switchTo(id);
      sceneManager.render();
    }
  };
  cycle(); // warm-up: every mode created and uploaded once
  const before = { geometries: mem.geometries, textures: mem.textures };
  for (let i = 0; i < cycles; i++) cycle();
  if (start) modes.switchTo(start);
  sceneManager.render();
  const after = { geometries: mem.geometries, textures: mem.textures };
  return {
    cycles,
    before,
    after,
    modesCreated: modes.createdCount,
    ok: after.geometries === before.geometries && after.textures === before.textures,
  };
}
