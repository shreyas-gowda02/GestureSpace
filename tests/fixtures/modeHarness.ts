// Test rig for experiences: a real ModeController with a headless ModeContext (no WebGL) and
// hand-made InteractionFrames, so a mode sees exactly the kind of input Core gives it.

import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '@/config/tuning';
import { FixturePlaybackSource, type LandmarkFixture } from '@/core/input';
import type {
  HandGestures,
  HandSide,
  InteractionFrame,
  ModeId,
  ModeUiStates,
  TrackedHand,
  Vec2,
} from '@/core/types';
import { GestureEngine, perceptionStep } from '@/gestures/GestureEngine';
import { makeGestureState } from '@/gestures/stateMachine';
import { makeTwoHandState } from '@/gestures/twoHand';
import { ModeController, type BaseContext } from '@/modes/ModeController';
import { MODE_FACTORIES } from '@/modes/registry';
import type { OverlayCanvas2D } from '@/scene/overlay';
import { CaptureManager } from '@/spatial/CaptureManager';
import { CoordinateMapper, RaycastCursor } from '@/spatial/CoordinateMapper';
import { DepthEstimator } from '@/spatial/DepthEstimator';
import { ViewportMapper } from '@/spatial/ViewportMapper';
import { HandNormalizer } from '@/vision/handPipeline';
import { INDEX_TIP, makeLandmarkBuffer, THUMB_TIP } from '@/vision/landmarks';

export const VIEW_W = 1280;
export const VIEW_H = 720;

/** 1280×720 view, the app's default camera (fov 50, z = 20, looking down −Z). */
export function baseContext(
  statuses: string[] = [],
  ui: Partial<ModeUiStates>[] = [],
): BaseContext {
  const viewport = new ViewportMapper();
  viewport.update(VIEW_W, VIEW_H, VIEW_W, VIEW_H);
  const camera = new THREE.PerspectiveCamera(50, VIEW_W / VIEW_H, 0.1, 1000);
  camera.position.set(0, 0, 20);
  camera.updateMatrixWorld();
  const coords = new CoordinateMapper(viewport, camera, { width: VIEW_W, height: VIEW_H });
  return {
    scene: new THREE.Scene(),
    camera,
    renderer: {} as unknown as THREE.WebGLRenderer, // modes under test never draw
    overlay: {} as unknown as OverlayCanvas2D,
    videoTexture: {} as unknown as THREE.VideoTexture,
    viewport,
    coords,
    cursors: new RaycastCursor(coords),
    capture: new CaptureManager(),
    settings: { ...DEFAULT_SETTINGS },
    emitStatus: (t) => statuses.push(t),
    publishUi: (id, state) => ui.push({ [id]: state }),
  };
}

export function makeHandGestures(): HandGestures {
  return {
    pinch: makeGestureState(),
    grab: makeGestureState(),
    point: makeGestureState(),
    openPalm: makeGestureState(),
    thumbPinky: makeGestureState(),
    depthSignal: 0,
  };
}

/** A tracked hand whose pinch point (thumb tip = index tip) is at view (x, y). */
export function makeHand(side: HandSide, x = 0.5, y = 0.5): TrackedHand {
  const lms = makeLandmarkBuffer();
  const hand: TrackedHand = {
    side,
    score: 1,
    rawLandmarks: lms,
    landmarks: lms,
    triggerLandmarks: lms,
    palmScale: 0.16,
    bbox: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
    lostForMs: 0,
  };
  movePinchPoint(hand, x, y);
  return hand;
}

export function movePinchPoint(hand: TrackedHand, x: number, y: number): void {
  const lms = hand.landmarks as { x: number; y: number; z: number }[];
  for (const i of [THUMB_TIP, INDEX_TIP]) {
    const p = lms[i];
    if (p) {
      p.x = x;
      p.y = y;
    }
  }
}

/**
 * A headless Core for one experience: plays hand recordings back to back through the same
 * per-frame steps Core runs — perceptionStep → depth estimators → steady-aim cursors (D43) → lost
 * hands release captures → ModeController — so a pinch "in the video" acts exactly as in the app.
 */
export function pipelineRig(mode: ModeId) {
  const base = baseContext();
  const mc = new ModeController(base, MODE_FACTORIES);
  mc.switchTo(mode);
  const norm = new HandNormalizer();
  const engine = new GestureEngine();
  let depth: Record<HandSide, DepthEstimator> = {
    left: new DepthEstimator(),
    right: new DepthEstimator(),
  };
  const frame: InteractionFrame = {
    timestamp: 0,
    dt: 1 / 60,
    hands: norm.frame,
    gestures: engine.frame,
    cursors: base.cursors.cursors,
    dominant: 'right',
    activeMode: mode,
  };
  let clock = 0;

  /** Play a recording to its end (+300 ms); `visit(t)` runs after every frame (t from its start). */
  function play(fixture: LandmarkFixture, visit?: (t: number) => void): void {
    const start = clock;
    const src = new FixturePlaybackSource(fixture, start, false);
    const aspect = fixture.videoWidth / fixture.videoHeight;
    for (let now = start; now <= start + src.duration + 300; now += 1000 / 60) {
      const holding = base.capture.count > 0;
      if (perceptionStep(norm, engine, src.poll(now), true, aspect, now, holding)) {
        depth = { left: depth.right, right: depth.left };
        base.capture.swapSides();
        base.cursors.swapSides();
        mc.swapSides();
      }
      for (const side of SIDES) {
        const d = depth[side].update(norm.frame[side], now);
        const g = engine.frame[side];
        if (g) g.depthSignal = d;
      }
      base.cursors.update(norm.frame, engine.frame);
      for (const side of SIDES) if (!norm.frame[side]) base.capture.release(side, 'lost');
      frame.timestamp = now;
      mc.update(frame);
      visit?.(now - start);
      clock = now;
    }
    clock += 1000;
  }

  return { base, mc, frame, play };
}

const SIDES: readonly HandSide[] = ['right', 'left'];

/**
 * Drives one experience frame by frame at 60 Hz. Per hand: `show` / `hide`, `aim` (cursor NDC),
 * `pinch(side, true|false)`; one-frame flags (justStarted / justEnded) clear after each `step`.
 */
export class ModeRig {
  readonly base: BaseContext;
  readonly mc: ModeController;
  readonly statuses: string[] = [];
  readonly ui: Partial<ModeUiStates>[] = [];
  readonly frame: InteractionFrame;
  now = 0;

  constructor(mode: ModeId, base?: BaseContext) {
    this.base = base ?? baseContext(this.statuses, this.ui);
    this.mc = new ModeController(this.base, MODE_FACTORIES);
    this.frame = {
      timestamp: 0,
      dt: 1 / 60,
      hands: { timestamp: 0, inferenceTimestamp: 0 },
      gestures: { twoHand: makeTwoHandState() },
      cursors: {},
      dominant: 'right',
      activeMode: mode,
    };
    this.mc.switchTo(mode);
  }

  show(side: HandSide, x = 0.5, y = 0.5): TrackedHand {
    const hand = this.frame.hands[side] ?? makeHand(side, x, y);
    movePinchPoint(hand, x, y);
    this.frame.hands[side] = hand;
    this.frame.gestures[side] ??= makeHandGestures();
    this.frame.cursors[side] ??= { side, screen: { x: 0, y: 0 }, ndc: { x: 0, y: 0 } };
    return hand;
  }

  hide(side: HandSide): void {
    this.frame.hands[side] = undefined;
    this.frame.gestures[side] = undefined;
    this.frame.cursors[side] = undefined;
  }

  aim(side: HandSide, ndc: Vec2): void {
    const c = this.frame.cursors[side];
    if (!c) throw new Error(`${side} hand not shown`);
    c.ndc.x = ndc.x;
    c.ndc.y = ndc.y;
  }

  gestures(side: HandSide): HandGestures {
    const g = this.frame.gestures[side];
    if (!g) throw new Error(`${side} hand not shown`);
    return g;
  }

  pinch(side: HandSide, down: boolean): void {
    const p = this.gestures(side).pinch;
    if (down && p.phase !== 'active') {
      p.phase = 'active';
      p.justStarted = true;
      p.startedAt = this.now;
      p.value = 0.2;
    } else if (!down && p.phase === 'active') {
      p.phase = 'released';
      p.justEnded = true;
      p.value = 1;
    }
  }

  step(ms = 1000 / 60): void {
    this.now += ms;
    this.frame.timestamp = this.now;
    this.frame.dt = ms / 1000;
    this.frame.hands.timestamp = this.now;
    this.mc.update(this.frame);
    for (const side of ['left', 'right'] as const) {
      const p = this.frame.gestures[side]?.pinch;
      if (!p) continue;
      p.justStarted = false;
      if (p.justEnded) {
        p.justEnded = false;
        p.phase = 'idle';
      }
    }
    const two = this.frame.gestures.twoHand;
    two.justStarted = two.justEnded = false;
    two.cancelFirstHand = null;
  }

  /** Several frames. */
  run(frames: number, ms = 1000 / 60): void {
    for (let i = 0; i < frames; i++) this.step(ms);
  }
}
