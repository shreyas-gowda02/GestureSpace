// Hand transforms shared by the experiences, each grab one undo step (`transformCommand`):
//  TwoHandTransform (§12) — hold something with both hands: move / turn / resize it in the
//    screen's plane. Voxel (the whole structure), Panel, Filter Lab, Portal, Object Lab.
//  FistOrbit — make a fist and drag to turn it in 3D (spin round / tip), like a mouse drag in a
//    3D viewer. Voxel (the whole structure); Object Lab later.
// TwoHandTransform:
//  • No jump: when the grab starts, the object's pose and the hands' midpoint / spread / angle are
//    the baseline; after that the object scales and turns about the hands' midpoint and follows it.
//  • Nearly touching hands are noisy: spread below `minSpan` doesn't scale, turning fades out.
//  • Safety limits on how fast the object may move / scale / turn, so a glitch can't throw it.
//  • A hand in its loss grace period freezes the object; if it comes back the grab re-anchors
//    (no jump); if it's gone for good the grab ends and the object stays where it was.
//  • One grab = one undo step (`transformCommand`), however the grab ends.
// The object's parent must be the scene (or untransformed): poses are in world space.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type {
  Command,
  HandSide,
  InteractionFrame,
  TrackedHand,
  TwoHandState,
  Vec2,
} from '@/core/types';
import type { ReleaseReason } from '@/spatial/CaptureManager';
import { InteractionPlane } from '@/spatial/CoordinateMapper';
import { clamp } from '@/utils/math';
import { INDEX_MCP, MIDDLE_MCP, PINKY_MCP, RING_MCP, WRIST } from '@/vision/landmarks';
import type { ModeContext } from '../types';

const T = TUNING.twoHand;
const O = TUNING.orbit;

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export const makePose = (): Pose => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(1, 1, 1),
});

export function readPose(object: THREE.Object3D, out: Pose): Pose {
  out.position.copy(object.position);
  out.quaternion.copy(object.quaternion);
  out.scale.copy(object.scale);
  return out;
}

export function applyPose(object: THREE.Object3D, pose: Pose): void {
  object.position.copy(pose.position);
  object.quaternion.copy(pose.quaternion);
  object.scale.copy(pose.scale);
  object.updateMatrixWorld();
}

export function samePose(a: Pose, b: Pose, eps = 1e-6): boolean {
  return (
    a.position.distanceToSquared(b.position) <= eps * eps &&
    a.scale.distanceToSquared(b.scale) <= eps * eps &&
    1 - Math.abs(a.quaternion.dot(b.quaternion)) <= eps
  );
}

/** One undo step (TransformObjectCommand): the object from `before` to `after` (both copied). */
export function transformCommand(
  object: THREE.Object3D,
  before: Pose,
  after: Pose,
  label: string,
): Command {
  const b = clonePose(before);
  const a = clonePose(after);
  return { label, do: () => applyPose(object, a), undo: () => applyPose(object, b) };
}

const clonePose = (p: Pose): Pose => ({
  position: p.position.clone(),
  quaternion: p.quaternion.clone(),
  scale: p.scale.clone(),
});

/** 0 when the hands (nearly) touch → 1 once they're clearly apart. */
export function turnWeight(distance: number): number {
  const { none, full } = T.turnFade;
  return clamp((distance - none) / (full - none), 0, 1);
}

export interface TwoHandTransformOptions {
  /** Capture target id: who holds the two-hand pinch. */
  id: string;
  /** Undo step label. */
  label: string;
  /** Limits on the object's own scale (its x scale in width-only mode). */
  scaleRange?: { min: number; max: number };
  /** Non-uniform (§12): only the width (x) follows the hands' spread — for the strip experiences. */
  widthOnly?: boolean;
  /** Called once when a grab ends, however it ends (after its undo step is recorded). */
  onEnd?: (reason: ReleaseReason) => void;
}

export class TwoHandTransform {
  private ctx: ModeContext | null = null;
  private held = false;
  private lost = false;
  /** The grab's undo "before", and the pose the current anchor is relative to. */
  private readonly before = makePose();
  private readonly after = makePose();
  private readonly base = makePose();
  private readonly plane = new InteractionPlane();
  private readonly axis = new THREE.Vector3();
  private readonly baseCenter = new THREE.Vector3();
  private baseSpan = 1;
  private lastRotation = 0;
  /** Where the hands say the object should be (relative to base), and where it has got to. */
  private targetTurn = 0;
  private turn = 0;
  private logScale = 0;
  private readonly view: Vec2 = { x: 0, y: 0 };
  // Scratch.
  private readonly ndc: Vec2 = { x: 0, y: 0 };
  private readonly center = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  readonly object: THREE.Object3D;
  private readonly opts: TwoHandTransformOptions;

  constructor(object: THREE.Object3D, opts: TwoHandTransformOptions) {
    this.object = object;
    this.opts = opts;
  }

  /** A grab is in progress. */
  get active(): boolean {
    return this.held;
  }

  /** A hand is in its loss grace period: the object holds still. */
  get frozen(): boolean {
    return this.held && this.lost;
  }

  /**
   * Start a grab (call on `twoHand.justStarted`, once the experience decided the pinch is on this
   * object). False if both hands already hold something else.
   */
  begin(ctx: ModeContext, two: TwoHandState, now: number): boolean {
    if (this.held) return true;
    if (!ctx.capture.capture('twoHand', this.opts.id, now, this.finish)) return false;
    this.ctx = ctx;
    this.held = true;
    this.lost = false;
    readPose(this.object, this.before);
    this.plane.setThrough(this.object.position, ctx.camera);
    ctx.camera.getWorldDirection(this.axis).negate(); // turns happen in the screen's plane
    this.anchor(two);
    return true;
  }

  update(frame: InteractionFrame): void {
    const ctx = this.ctx;
    if (!this.held || !ctx) return;
    const two = frame.gestures.twoHand;
    if (!two.active) {
      ctx.capture.release('twoHand', 'released'); // → finish
      return;
    }
    const { left, right } = frame.hands;
    if (!left || !right || left.lostForMs > 0 || right.lostForMs > 0) {
      this.lost = true;
      return;
    }
    if (this.lost) {
      this.lost = false;
      this.anchor(two); // the returning hand may have moved: carry on from here, no jump
      return;
    }
    const dt = frame.dt;
    this.targetTurn += (two.rotation - this.lastRotation) * turnWeight(two.distance);
    this.lastRotation = two.rotation;
    const turnStep = T.maxTurnRate * dt;
    this.turn += clamp(this.targetTurn - this.turn, -turnStep, turnStep);
    const ratio = clamp(Math.max(two.distance, T.minSpan) / this.baseSpan, T.minScale, T.maxScale);
    const scaleStep = T.maxScaleRate * dt;
    this.logScale += clamp(Math.log(ratio) - this.logScale, -scaleStep, scaleStep);
    this.follow(two.center, T.maxMoveRate * dt, ctx.viewport.videoAspect);
    this.apply();
  }

  /** End the grab now (e.g. Reset view); what it did so far is kept as its undo step. */
  cancel(): void {
    if (this.held) this.ctx?.capture.release('twoHand', 'cancelled');
  }

  /** Capture callback: the grab ended (hands let go / lost, undo, mode switch, UI…). */
  private readonly finish = (reason: ReleaseReason): void => {
    const ctx = this.ctx;
    if (!this.held) return;
    this.held = false;
    this.lost = false;
    this.ctx = null;
    readPose(this.object, this.after);
    if (ctx && !samePose(this.before, this.after)) {
      ctx.history.push(transformCommand(this.object, this.before, this.after, this.opts.label));
    }
    this.opts.onEnd?.(reason);
  };

  /** Baseline = the object as it is now + where the hands are now. */
  private anchor(two: TwoHandState): void {
    readPose(this.object, this.base);
    this.view.x = two.center.x;
    this.view.y = two.center.y;
    if (!this.project(this.view, this.baseCenter)) this.baseCenter.copy(this.base.position);
    this.baseSpan = Math.max(two.distance, T.minSpan);
    this.lastRotation = two.rotation;
    this.targetTurn = this.turn = this.logScale = 0;
  }

  /** Move the followed midpoint toward the hands' midpoint, at most `maxStep` view heights. */
  private follow(target: Vec2, maxStep: number, aspect: number): void {
    const dx = (target.x - this.view.x) * aspect;
    const dy = target.y - this.view.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const k = d > maxStep ? maxStep / d : 1;
    this.view.x += (dx * k) / aspect;
    this.view.y += dy * k;
  }

  /** Scale and turn about the hands' midpoint, and follow it. */
  private apply(): void {
    if (!this.project(this.view, this.center)) return;
    const { base, object } = this;
    const range = this.opts.scaleRange;
    const baseSize = base.scale.x;
    let size = baseSize * Math.exp(this.logScale);
    if (range) size = clamp(size, range.min, range.max);
    const k = size / baseSize;
    // View y points down, scene y up: a clockwise hand line is a negative turn about the axis.
    this.q.setFromAxisAngle(this.axis, -this.turn * T.ROTATION_SENSITIVITY);
    object.quaternion.copy(this.q).multiply(base.quaternion);
    object.position
      .copy(base.position)
      .sub(this.baseCenter)
      .multiplyScalar(k)
      .applyQuaternion(this.q)
      .add(this.center);
    object.scale.copy(base.scale);
    if (this.opts.widthOnly) object.scale.x = size;
    else object.scale.multiplyScalar(k);
    object.updateMatrixWorld();
  }

  private project(view: Vec2, out: THREE.Vector3): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    ctx.coords.viewToNdc(view, this.ndc);
    return ctx.coords.ndcToPlane(this.ndc, this.plane.plane, out);
  }
}

/** The middle of the palm (wrist + four knuckles): steady while the fingers curl into a fist. */
export function palmCenterInto(out: Vec2, hand: TrackedHand): Vec2 {
  const lms = hand.landmarks;
  let x = 0;
  let y = 0;
  let n = 0;
  for (const i of PALM) {
    const p = lms[i];
    if (!p) continue;
    x += p.x;
    y += p.y;
    n++;
  }
  if (n) {
    out.x = x / n;
    out.y = y / n;
  }
  return out;
}

const PALM = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP] as const;

export interface FistOrbitOptions {
  /** Capture target id: what the fist holds. */
  id: string;
  /** Undo step label. */
  label: string;
}

/**
 * Fist + drag turns an object in 3D about a pivot: moving the fist right turns the object's front
 * to the right (about the screen's up axis), moving it down tips the front down so the top shows
 * (about the screen's across axis). It starts only once the fist is held `holdMs` and has moved
 * `deadZone` (brief, accidental fists do nothing); from there it is absolute, so going back undoes
 * it. A lost hand freezes it and it re-anchors on return; opening the hand ends it (one undo step).
 */
export class FistOrbit {
  readonly object: THREE.Object3D;
  private readonly opts: FistOrbitOptions;
  private ctx: ModeContext | null = null;
  private held: HandSide | null = null;
  private lost = false;
  /** The fist was held long enough and moved far enough: it is turning the object. */
  private armed = false;
  private closedAt = 0;
  private readonly before = makePose();
  private readonly after = makePose();
  private readonly base = makePose();
  private readonly pivot = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  /** Where the fist closed (aspect-corrected view units), and the turn applied so far. */
  private readonly start: Vec2 = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = 0;
  // Scratch.
  private readonly palm: Vec2 = { x: 0, y: 0 };
  private readonly qYaw = new THREE.Quaternion();
  private readonly qPitch = new THREE.Quaternion();

  constructor(object: THREE.Object3D, opts: FistOrbitOptions) {
    this.object = object;
    this.opts = opts;
  }

  /** A fist is held (maybe not turning yet). */
  get active(): boolean {
    return this.held !== null;
  }

  /** The fist is turning the object (held `holdMs` and moved past the dead zone). */
  get turning(): boolean {
    return this.held !== null && this.armed;
  }

  /** The hand doing the turning. */
  get side(): HandSide | null {
    return this.held;
  }

  /** Start turning with this hand's fist (call on its `grab.justStarted`) about `pivot` (world). */
  begin(
    ctx: ModeContext,
    side: HandSide,
    hand: TrackedHand,
    pivot: THREE.Vector3,
    now: number,
  ): boolean {
    if (this.held) return this.held === side;
    if (!ctx.capture.capture(side, this.opts.id, now, this.finish)) return false;
    this.ctx = ctx;
    this.held = side;
    this.lost = false;
    this.armed = false;
    this.closedAt = now;
    readPose(this.object, this.before);
    this.pivot.copy(pivot);
    ctx.camera.updateMatrixWorld();
    this.across.setFromMatrixColumn(ctx.camera.matrixWorld, 0).normalize();
    this.up.setFromMatrixColumn(ctx.camera.matrixWorld, 1).normalize();
    this.anchor(hand);
    return true;
  }

  update(frame: InteractionFrame): void {
    const ctx = this.ctx;
    const side = this.held;
    if (!ctx || !side) return;
    const hand = frame.hands[side];
    if (!hand || frame.gestures[side]?.grab.phase !== 'active') {
      ctx.capture.release(side, 'released'); // → finish
      return;
    }
    if (hand.lostForMs > 0) {
      this.lost = true;
      return;
    }
    if (this.lost) {
      this.lost = false;
      this.anchor(hand); // the hand may have moved while it was lost: no jump
      return;
    }
    const aspect = ctx.viewport.videoAspect;
    palmCenterInto(this.palm, hand);
    if (!this.armed) {
      const moved = Math.hypot(this.palm.x * aspect - this.start.x, this.palm.y - this.start.y);
      if (frame.timestamp - this.closedAt < O.holdMs || moved < O.deadZone) return;
      this.armed = true;
      this.anchor(hand); // turning starts from here: the dead zone never shows as a jump
      return;
    }
    const yaw = (this.palm.x * aspect - this.start.x) * O.radPerViewHeight;
    const pitch = (this.palm.y - this.start.y) * O.radPerViewHeight;
    const step = O.maxTurnRate * frame.dt;
    this.yaw += clamp(yaw - this.yaw, -step, step);
    this.pitch += clamp(pitch - this.pitch, -step, step);
    this.apply();
  }

  /** End the turn now; what it did so far is kept as its undo step. */
  cancel(): void {
    if (this.held) this.ctx?.capture.release(this.held, 'cancelled');
  }

  /** The hand pipeline renamed left ↔ right (D42): the same hand keeps turning. */
  onSidesSwapped(): void {
    if (this.held) this.held = this.held === 'right' ? 'left' : 'right';
  }

  private readonly finish = (): void => {
    const ctx = this.ctx;
    if (!this.held) return;
    this.held = null;
    this.lost = false;
    this.armed = false;
    this.ctx = null;
    readPose(this.object, this.after);
    if (ctx && !samePose(this.before, this.after)) {
      ctx.history.push(transformCommand(this.object, this.before, this.after, this.opts.label));
    }
  };

  private anchor(hand: TrackedHand): void {
    readPose(this.object, this.base);
    palmCenterInto(this.palm, hand);
    this.start.x = this.palm.x * (this.ctx?.viewport.videoAspect ?? 1);
    this.start.y = this.palm.y;
    this.yaw = this.pitch = 0;
  }

  private apply(): void {
    const { base, object } = this;
    this.qYaw.setFromAxisAngle(this.up, this.yaw);
    this.qPitch.setFromAxisAngle(this.across, this.pitch).multiply(this.qYaw);
    object.quaternion.copy(this.qPitch).multiply(base.quaternion);
    object.position
      .copy(base.position)
      .sub(this.pivot)
      .applyQuaternion(this.qPitch)
      .add(this.pivot);
    object.updateMatrixWorld();
  }
}
