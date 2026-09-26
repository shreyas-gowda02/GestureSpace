// Hand transforms (Phase 6). TwoHandTransform (§12): real TwoHandTracker states from two moving
// pinch points drive the shared controller; checks are in screen pixels, where the user sees them.
// FistOrbit: a fist dragged across the view turns an object in 3D.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { GestureState, InteractionFrame, Vec2 } from '@/core/types';
import { makeGestureState } from '@/gestures/stateMachine';
import { TwoHandTracker } from '@/gestures/twoHand';
import { CommandHistory } from '@/modes/shared/history';
import {
  FistOrbit,
  makePose,
  readPose,
  samePose,
  turnWeight,
  TwoHandTransform,
  type TwoHandTransformOptions,
} from '@/modes/shared/TwoHandTransform';
import type { ModeContext } from '@/modes/types';
import type { ReleaseReason } from '@/spatial/CaptureManager';
import {
  baseContext,
  makeHand,
  makeHandGestures,
  movePalm,
  movePinchPoint,
  VIEW_H,
  VIEW_W,
} from '../fixtures/modeHarness';

const T = TUNING.twoHand;
const ASPECT = VIEW_W / VIEW_H;
const DT = 1 / 60;

function held(active: boolean): GestureState {
  const g = makeGestureState();
  g.phase = active ? 'active' : 'idle';
  return g;
}

/** Both hands pinching at view points `l` / `r`, one display frame per `step`. */
function transformRig(opts: Partial<TwoHandTransformOptions> = {}) {
  const base = baseContext();
  const history = new CommandHistory();
  const ctx: ModeContext = { ...base, history };
  const object = new THREE.Group();
  object.position.set(2, -1, 0);
  object.quaternion.setFromEuler(new THREE.Euler(0.3, -0.4, 0.2));
  base.scene.add(object);
  object.updateMatrixWorld();
  const ended: ReleaseReason[] = [];
  const t = new TwoHandTransform(object, {
    id: 'thing',
    label: 'Move thing',
    onEnd: (r) => ended.push(r),
    ...opts,
  });
  const tracker = new TwoHandTracker();
  const left = makeHand('left');
  const right = makeHand('right');
  const lp = held(true);
  const rp = held(true);
  const frame: InteractionFrame = {
    timestamp: 0,
    dt: DT,
    hands: { timestamp: 0, inferenceTimestamp: 0, left, right },
    gestures: {
      left: makeHandGesturesWith(lp),
      right: makeHandGesturesWith(rp),
      twoHand: tracker.state,
    },
    cursors: {},
    dominant: 'right',
    activeMode: 'voxel',
  };
  let now = 0;
  const l: Vec2 = { x: 0.35, y: 0.5 };
  const r: Vec2 = { x: 0.65, y: 0.5 };

  function step(pinching = true): void {
    now += DT * 1000;
    movePinchPoint(left, l.x, l.y);
    movePinchPoint(right, r.x, r.y);
    lp.phase = rp.phase = pinching ? 'active' : 'idle';
    const two = tracker.update(frame.hands.left, lp, frame.hands.right, rp, ASPECT);
    frame.timestamp = now;
    if (two.justStarted) t.begin(ctx, two, now);
    t.update(frame);
  }

  /** Where a view point (hand) lands on screen, and where an object-local point is drawn. */
  const screenOfView = (v: Vec2): Vec2 => base.viewport.viewToScreen(v, { x: 0, y: 0 });
  const screenOfLocal = (p: THREE.Vector3): Vec2 =>
    base.coords.worldToScreen(object.localToWorld(p.clone()), { x: 0, y: 0 });
  /** The object-local point under a view point (on the grab's camera-facing plane). */
  function localUnder(v: Vec2): THREE.Vector3 {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      object.position,
    );
    const hit = new THREE.Vector3();
    base.coords.ndcToPlane(base.coords.viewToNdc(v, { x: 0, y: 0 }), plane, hit);
    return object.worldToLocal(hit);
  }

  return {
    t,
    ctx,
    history,
    object,
    tracker,
    frame,
    l,
    r,
    step,
    ended,
    screenOfView,
    screenOfLocal,
    localUnder,
  };
}

function makeHandGesturesWith(pinch: GestureState) {
  return {
    pinch,
    grab: makeGestureState(),
    point: makeGestureState(),
    openPalm: makeGestureState(),
    thumbPinky: makeGestureState(),
    depthSignal: 0,
  };
}

const px = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Move both hands smoothly: `f(k)` sets l / r for k = 0 → 1 over `frames` frames. */
function glide(rig: ReturnType<typeof transformRig>, frames: number, f: (k: number) => void): void {
  for (let i = 1; i <= frames; i++) {
    f(i / frames);
    rig.step();
  }
}

describe('TwoHandTransform (§12)', () => {
  it('no jump when the grab starts, wherever the hands are', () => {
    const rig = transformRig();
    rig.l.x = 0.1;
    rig.r.x = 0.3; // far from the object, any spread
    const start = readPose(rig.object, makePose());
    rig.step();
    expect(rig.t.active).toBe(true);
    for (let i = 0; i < 20; i++) rig.step();
    expect(samePose(readPose(rig.object, makePose()), start)).toBe(true);
  });

  it('each hand keeps holding the same spot on the object while it moves, scales and turns', () => {
    const rig = transformRig();
    rig.step();
    const heldL = rig.localUnder(rig.l);
    const heldR = rig.localUnder(rig.r);
    // Centre moves right and up, spread 0.53 → 0.8 view heights (×1.5), the hand line turns 30°.
    const a = (-30 * Math.PI) / 180;
    glide(rig, 60, (k) => {
      const cx = 0.5 + 0.08 * k;
      const cy = 0.5 - 0.06 * k;
      const half = ((0.3 * ASPECT) / 2) * (1 + 0.5 * k);
      const ang = a * k;
      rig.l.x = cx - (Math.cos(ang) * half) / ASPECT;
      rig.l.y = cy - Math.sin(ang) * half;
      rig.r.x = cx + (Math.cos(ang) * half) / ASPECT;
      rig.r.y = cy + Math.sin(ang) * half;
    });
    for (let i = 0; i < 20; i++) rig.step(); // let the safety limits catch up
    expect(rig.object.scale.x).toBeCloseTo(1.5, 3);
    expect(px(rig.screenOfLocal(heldL), rig.screenOfView(rig.l))).toBeLessThan(1);
    expect(px(rig.screenOfLocal(heldR), rig.screenOfView(rig.r))).toBeLessThan(1);
  });

  it('one grab = one undo step; undo / redo restore the exact poses; a still grab adds none', () => {
    const rig = transformRig();
    const start = readPose(rig.object, makePose());
    rig.step();
    rig.step();
    rig.step(false);
    expect(rig.history.canUndo).toBe(false); // nothing moved
    expect(rig.ended).toEqual(['released']);
    rig.step();
    glide(rig, 30, (k) => {
      rig.l.x = 0.35 + 0.1 * k;
      rig.r.x = 0.65 + 0.1 * k;
    });
    const end = readPose(rig.object, makePose());
    rig.step(false);
    expect(rig.t.active).toBe(false);
    expect(rig.history.undoLabel).toBe('Move thing');
    rig.history.undo();
    expect(samePose(readPose(rig.object, makePose()), start)).toBe(true);
    expect(rig.history.canUndo).toBe(false);
    rig.history.redo();
    expect(samePose(readPose(rig.object, makePose()), end)).toBe(true);
  });

  it('a lost hand freezes the object; its return re-anchors (no jump); gone for good = released', () => {
    const rig = transformRig();
    rig.step();
    glide(rig, 20, (k) => (rig.r.x = 0.65 + 0.05 * k));
    const left = rig.frame.hands.left;
    if (!left) throw new Error('no left hand');
    const frozen = readPose(rig.object, makePose());
    left.lostForMs = 60; // grace period: its landmarks are stale, the other hand keeps moving
    glide(rig, 6, (k) => (rig.r.x = 0.7 + 0.1 * k));
    expect(rig.t.frozen).toBe(true);
    expect(samePose(readPose(rig.object, makePose()), frozen)).toBe(true);
    left.lostForMs = 0;
    rig.l.x -= 0.1; // it comes back somewhere else
    rig.step();
    expect(samePose(readPose(rig.object, makePose()), frozen)).toBe(true);
    const heldR = rig.localUnder(rig.r);
    glide(rig, 20, (k) => (rig.r.x = 0.8 + 0.05 * k));
    for (let i = 0; i < 10; i++) rig.step();
    expect(px(rig.screenOfLocal(heldR), rig.screenOfView(rig.r))).toBeLessThan(1);
    // Now it's gone for good: the grab ends, the object stays, one undo step for the whole grab.
    const last = readPose(rig.object, makePose());
    rig.frame.hands.left = undefined;
    rig.step();
    expect(rig.t.active).toBe(false);
    expect(rig.ended).toEqual(['released']);
    expect(samePose(readPose(rig.object, makePose()), last)).toBe(true);
    expect(rig.history.undoLabel).toBe('Move thing');
  });

  it('hands turning through ±180° turn the object smoothly, and a left/right rename changes nothing', () => {
    const rig = transformRig();
    rig.step();
    const start = rig.object.quaternion.clone();
    const turn = (200 * Math.PI) / 180;
    let prev = start.clone();
    let biggest = 0;
    glide(rig, 150, (k) => {
      const ang = turn * k; // the hand line turns anticlockwise on screen, past ±π
      const half = 0.3;
      rig.l.x = 0.5 - (Math.cos(ang) * half) / ASPECT;
      rig.l.y = 0.5 + Math.sin(ang) * half;
      rig.r.x = 0.5 + (Math.cos(ang) * half) / ASPECT;
      rig.r.y = 0.5 - Math.sin(ang) * half;
      biggest = Math.max(biggest, rig.object.quaternion.angleTo(prev));
      prev = rig.object.quaternion.clone();
    });
    for (let i = 0; i < 30; i++) rig.step();
    expect(biggest).toBeLessThanOrEqual(T.maxTurnRate * DT + 1e-9);
    // 200° about the view axis (the object's own tilt is kept).
    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), turn)
      .multiply(start);
    expect(rig.object.quaternion.angleTo(expected)).toBeLessThan(1e-3);
    // The hand pipeline renames the hands mid-grab (D42): the same two hands, new names.
    const pose = readPose(rig.object, makePose());
    const { left, right } = rig.frame.hands;
    rig.frame.hands.left = right;
    rig.frame.hands.right = left; // each hand stays where it is, under its new name
    rig.tracker.swapSides();
    for (let i = 0; i < 10; i++) rig.step();
    expect(samePose(readPose(rig.object, makePose()), pose, 1e-5)).toBe(true);
  });

  it('hands crossing close together: no half-turn flip, no size explosion', () => {
    const rig = transformRig();
    rig.l.y = 0.49;
    rig.r.y = 0.51;
    rig.step();
    const start = rig.object.quaternion.clone();
    let smallest = Infinity;
    let largest = 0;
    glide(rig, 90, (k) => {
      rig.l.x = 0.35 + 0.3 * k; // the hands pass each other ~0.02 apart and swap places
      rig.r.x = 0.65 - 0.3 * k;
      smallest = Math.min(smallest, rig.object.scale.x);
      largest = Math.max(largest, rig.object.scale.x);
    });
    for (let i = 0; i < 30; i++) rig.step();
    // The hand line itself turns 180° as they pass (the old in-mode transform flipped the
    // structure); now only the part while they are clearly apart counts. Measured: 11°.
    expect((rig.object.quaternion.angleTo(start) * 180) / Math.PI).toBeLessThan(13);
    expect(smallest).toBeGreaterThan(T.minSpan / 0.54 - 0.01); // shrinks only down to minSpan
    expect(largest).toBeLessThanOrEqual(1 + 1e-9);
    expect(rig.object.scale.x).toBeCloseTo(1, 6); // same spread again = same size
  });

  it('a grab begun with the hands nearly touching does not explode in size', () => {
    const rig = transformRig();
    rig.l.x = 0.49;
    rig.r.x = 0.51; // 0.036 view heights apart
    rig.step();
    glide(rig, 60, (k) => {
      rig.l.x = 0.49 - 0.14 * k;
      rig.r.x = 0.51 + 0.14 * k; // → 0.53 apart: 15× the start, but only 3.5× minSpan
    });
    for (let i = 0; i < 60; i++) rig.step();
    expect(rig.object.scale.x).toBeCloseTo((0.3 * ASPECT) / T.minSpan, 3);
  });

  it('a one-frame tracking glitch moves the object at most the safety limit', () => {
    const rig = transformRig();
    rig.step();
    const heldC = rig.localUnder({ x: 0.5, y: 0.5 });
    const before = rig.screenOfLocal(heldC);
    rig.l.x += 0.4;
    rig.r.x += 0.4; // both hands "jump" 0.71 view heights for one frame…
    rig.step();
    const moved = px(rig.screenOfLocal(heldC), before);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(T.maxMoveRate * DT * VIEW_H + 0.5); // ≈ 48 px, not 510
    rig.l.x -= 0.4;
    rig.r.x -= 0.4; // …and are back
    for (let i = 0; i < 10; i++) rig.step();
    expect(px(rig.screenOfLocal(heldC), before)).toBeLessThan(0.5);
  });

  it('size limits hold; width-only mode stretches x alone', () => {
    const capped = transformRig({ scaleRange: { min: 0.5, max: 2 } });
    capped.step();
    glide(capped, 90, (k) => {
      capped.l.x = 0.35 - 0.3 * k;
      capped.r.x = 0.65 + 0.3 * k; // ×3 spread
    });
    for (let i = 0; i < 60; i++) capped.step();
    expect(capped.object.scale.toArray()).toEqual([2, 2, 2]);

    const strip = transformRig({ widthOnly: true });
    strip.step();
    glide(strip, 60, (k) => {
      strip.l.x = 0.35 - 0.075 * k;
      strip.r.x = 0.65 + 0.075 * k; // ×1.5 spread
    });
    for (let i = 0; i < 30; i++) strip.step();
    expect(strip.object.scale.x).toBeCloseTo(1.5, 3);
    expect(strip.object.scale.y).toBe(1);
    expect(strip.object.scale.z).toBe(1);
  });

  it('undo, a mode switch or Reset mid-grab keep what was done as its undo step', () => {
    for (const reason of ['cancelled', 'modeSwitch', 'ui'] as const) {
      const rig = transformRig();
      rig.step();
      glide(rig, 20, (k) => (rig.r.x = 0.65 + 0.1 * k));
      const moved = readPose(rig.object, makePose());
      rig.ctx.capture.releaseAll(reason);
      expect(rig.t.active).toBe(false);
      expect(rig.ended).toEqual([reason]);
      expect(rig.history.undoLabel).toBe('Move thing');
      rig.step(); // hands still pinching: nothing happens until a new grab
      expect(samePose(readPose(rig.object, makePose()), moved)).toBe(true);
    }
    const rig = transformRig();
    rig.step();
    glide(rig, 20, (k) => (rig.r.x = 0.65 + 0.1 * k));
    rig.t.cancel();
    expect(rig.ended).toEqual(['cancelled']);
    expect(rig.history.undoLabel).toBe('Move thing');
  });

  it('turn weight: none when the hands touch, full once clearly apart', () => {
    expect(turnWeight(0)).toBe(0);
    expect(turnWeight(T.turnFade.none)).toBe(0);
    expect(turnWeight((T.turnFade.none + T.turnFade.full) / 2)).toBeCloseTo(0.5);
    expect(turnWeight(T.turnFade.full)).toBe(1);
    expect(turnWeight(1)).toBe(1);
  });
});

/**
 * One hand making a fist with its palm at `p` (view), turning `object` about `pivot`. `arm()` holds
 * the fist still past `holdMs`, then moves it just past the dead zone: turning starts from there,
 * so `o` is where the turn is measured from.
 */
function orbitRig(pivot = new THREE.Vector3()) {
  const base = baseContext();
  const history = new CommandHistory();
  const ctx: ModeContext = { ...base, history };
  const object = new THREE.Group();
  base.scene.add(object);
  const orbit = new FistOrbit(object, { id: 'thing', label: 'Turn thing' });
  const hand = makeHand('right');
  const g = makeHandGestures();
  g.grab.phase = 'active';
  const frame: InteractionFrame = {
    timestamp: 0,
    dt: DT,
    hands: { timestamp: 0, inferenceTimestamp: 0, right: hand },
    gestures: { right: g, twoHand: new TwoHandTracker().state },
    cursors: {},
    dominant: 'right',
    activeMode: 'voxel',
  };
  const p: Vec2 = { x: 0.5, y: 0.5 };
  const o: Vec2 = { x: 0.5, y: 0.5 };
  let now = 0;
  movePalm(hand, p.x, p.y);
  const step = (): void => {
    now += DT * 1000;
    movePalm(hand, p.x, p.y);
    frame.timestamp = now;
    orbit.update(frame);
  };
  const close = (): void => {
    movePalm(hand, p.x, p.y);
    orbit.begin(ctx, 'right', hand, pivot, now);
  };
  const arm = (): void => {
    for (let i = 0; i < Math.ceil(TUNING.orbit.holdMs / (DT * 1000)) + 1; i++) step();
    p.x += (TUNING.orbit.deadZone * 1.2) / ASPECT;
    step();
    o.x = p.x;
    o.y = p.y;
  };
  /** Where an object-local direction points now, in world space. */
  const dir = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).applyQuaternion(object.quaternion);
  return { orbit, ctx, history, object, hand, g, frame, p, o, step, close, arm, dir };
}

const K = TUNING.orbit.radPerViewHeight;
const noTurn = (o: THREE.Object3D): number => o.quaternion.angleTo(new THREE.Quaternion());

describe('FistOrbit (fist + drag turns in 3D)', () => {
  it('fist right: the front turns right; fist down: the top tips toward you; back again: as it was', () => {
    const rig = orbitRig();
    rig.close();
    rig.arm();
    expect(rig.orbit.turning).toBe(true);
    expect(noTurn(rig.object)).toBe(0); // the dead zone never shows as a jump
    for (let i = 1; i <= 30; i++) {
      rig.p.x = rig.o.x + (0.1 * i) / 30; // 0.18 view heights right
      rig.step();
    }
    const front = rig.dir(0, 0, 1);
    expect(front.x).toBeCloseTo(Math.sin(0.1 * ASPECT * K), 6);
    expect(front.y).toBeCloseTo(0, 6);
    for (let i = 1; i <= 30; i++) {
      rig.p.x = rig.o.x + 0.1 - (0.1 * i) / 30;
      rig.p.y = rig.o.y + (0.1 * i) / 30; // back, then down
      rig.step();
    }
    expect(rig.dir(0, 1, 0).z).toBeCloseTo(Math.sin(0.1 * K), 6); // the top toward the camera
    expect(rig.dir(0, 0, 1).x).toBeCloseTo(0, 6);
    rig.p.y = rig.o.y;
    for (let i = 0; i < 10; i++) rig.step();
    expect(noTurn(rig.object)).toBeLessThan(1e-9);
  });

  it('a brief fist, or one held still, turns nothing (accidental fists)', () => {
    const brief = orbitRig();
    brief.close();
    for (let i = 1; i <= 8; i++) {
      brief.p.x = 0.5 + (0.1 * i) / 8; // moves a lot, but only for 133 ms…
      brief.step();
    }
    brief.g.grab.phase = 'released';
    brief.step();
    expect(noTurn(brief.object)).toBe(0);
    expect(brief.history.canUndo).toBe(false);

    const still = orbitRig();
    still.close();
    for (let i = 0; i < 60; i++) {
      still.p.x = 0.5 + (i % 2 ? 0.01 : 0); // …or held for a second with a little tremor
      still.step();
    }
    expect(still.orbit.active).toBe(true);
    expect(still.orbit.turning).toBe(false);
    expect(noTurn(still.object)).toBe(0);
  });

  it('turns about the pivot: the middle of the structure stays where it is', () => {
    const pivot = new THREE.Vector3(3, -2, 1);
    const rig = orbitRig(pivot);
    rig.object.position.set(1, 1, 0);
    rig.object.updateMatrixWorld();
    const middle = rig.object.worldToLocal(pivot.clone());
    rig.close();
    rig.arm();
    for (let i = 1; i <= 30; i++) {
      rig.p.x = rig.o.x + (0.08 * i) / 30;
      rig.p.y = rig.o.y - (0.06 * i) / 30;
      rig.step();
    }
    expect(noTurn(rig.object)).toBeGreaterThan(0.3);
    expect(rig.object.localToWorld(middle.clone()).distanceTo(pivot)).toBeLessThan(1e-9);
  });

  it('opening the hand ends it as one undo step; undo restores it exactly', () => {
    const rig = orbitRig();
    rig.close();
    rig.arm();
    for (let i = 1; i <= 20; i++) {
      rig.p.x = rig.o.x + (0.1 * i) / 20;
      rig.step();
    }
    const turned = rig.object.quaternion.clone();
    rig.g.grab.phase = 'released';
    rig.step();
    expect(rig.orbit.active).toBe(false);
    expect(rig.history.undoLabel).toBe('Turn thing');
    rig.history.undo();
    expect(noTurn(rig.object)).toBeLessThan(1e-9);
    rig.history.redo();
    expect(rig.object.quaternion.angleTo(turned)).toBeLessThan(1e-9);
  });

  it('a lost hand freezes the turn and re-anchors on return; a rename keeps the same hand turning', () => {
    const rig = orbitRig();
    rig.close();
    rig.arm();
    for (let i = 1; i <= 10; i++) {
      rig.p.x = rig.o.x + (0.05 * i) / 10;
      rig.step();
    }
    const frozen = rig.object.quaternion.clone();
    rig.hand.lostForMs = 50;
    rig.p.x = 0.8;
    rig.step();
    expect(rig.object.quaternion.angleTo(frozen)).toBe(0);
    rig.hand.lostForMs = 0;
    rig.step(); // back somewhere else: carries on from here
    expect(rig.object.quaternion.angleTo(frozen)).toBe(0);
    // The pipeline renames the hand (D42): same hand, now called left.
    rig.frame.hands.left = rig.hand;
    rig.frame.gestures.left = rig.g;
    rig.frame.hands.right = undefined;
    rig.frame.gestures.right = undefined;
    rig.ctx.capture.swapSides();
    rig.orbit.onSidesSwapped();
    rig.p.x = 0.85;
    for (let i = 0; i < 10; i++) rig.step();
    expect(rig.orbit.side).toBe('left');
    expect(rig.object.quaternion.angleTo(frozen)).toBeCloseTo(0.05 * ASPECT * K, 6);
  });

  it('a one-frame jump of the fist turns it at most the safety limit', () => {
    const rig = orbitRig();
    rig.close();
    rig.arm();
    rig.p.x = rig.o.x + 0.4; // 0.71 view heights in one frame (≈ 2.5 rad asked)
    rig.step();
    expect(noTurn(rig.object)).toBeCloseTo(TUNING.orbit.maxTurnRate * DT, 6);
  });
});
