// Two-hand transform (§12), shared by every experience that holds something with both hands —
// Voxel (the whole structure), Panel, Filter Lab, Portal, Object Lab.
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
import type { Command, InteractionFrame, TwoHandState, Vec2 } from '@/core/types';
import type { ReleaseReason } from '@/spatial/CaptureManager';
import { InteractionPlane } from '@/spatial/CoordinateMapper';
import { clamp } from '@/utils/math';
import type { ModeContext } from '../types';

const T = TUNING.twoHand;

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
