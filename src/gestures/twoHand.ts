// Two-hand state (§11 two-hand pinch, feeds §12's transform controller).
// Active while BOTH hands pinch. On start we snapshot a baseline (centre, distance, angle); every
// frame after reports scale / rotation / translation RELATIVE to it, so grabbing never jumps.
// Angles are unwrapped so crossing ±π (e.g. hands crossing) never produces a 2π spike.

import { TUNING } from '@/config/tuning';
import type { GestureState, HandSide, TrackedHand, TwoHandState, Vec2 } from '@/core/types';
import { unwrapAngle } from '@/utils/math';
import { INDEX_TIP, THUMB_TIP } from '@/vision/landmarks';

/** Midpoint of thumb tip and index tip (view-normalized) — where a pinch "holds" something. */
export function pinchPointInto(out: Vec2, hand: TrackedHand): Vec2 {
  const t = hand.landmarks[THUMB_TIP];
  const i = hand.landmarks[INDEX_TIP];
  if (!t || !i) return out;
  out.x = (t.x + i.x) * 0.5;
  out.y = (t.y + i.y) * 0.5;
  return out;
}

export function makeTwoHandState(): TwoHandState {
  return {
    active: false,
    justStarted: false,
    justEnded: false,
    center: { x: 0, y: 0 },
    distance: 0,
    angle: 0,
    scale: 1,
    rotation: 0,
    translation: { x: 0, y: 0 },
    cancelFirstHand: null,
  };
}

export class TwoHandTracker {
  readonly state: TwoHandState = makeTwoHandState();
  /** True when both hands are visible (indicators can show the hand-to-hand line). */
  bothVisible = false;
  private readonly pL: Vec2 = { x: 0, y: 0 };
  private readonly pR: Vec2 = { x: 0, y: 0 };
  private readonly baseCenter: Vec2 = { x: 0, y: 0 };
  private baseDistance = 1;
  private baseAngle = 0;
  private unwrapped = 0;
  private hasAngle = false;

  update(
    left: TrackedHand | undefined,
    leftPinch: GestureState | undefined,
    right: TrackedHand | undefined,
    rightPinch: GestureState | undefined,
    aspect: number,
  ): TwoHandState {
    const s = this.state;
    s.justStarted = false;
    s.justEnded = false;
    s.cancelFirstHand = null;

    this.bothVisible = !!left && !!right;
    if (!left || !right) {
      this.hasAngle = false;
      if (s.active) this.end();
      return s;
    }

    pinchPointInto(this.pL, left);
    pinchPointInto(this.pR, right);
    s.center.x = (this.pL.x + this.pR.x) * 0.5;
    s.center.y = (this.pL.y + this.pR.y) * 0.5;
    const dx = (this.pR.x - this.pL.x) * aspect;
    const dy = this.pR.y - this.pL.y;
    s.distance = Math.sqrt(dx * dx + dy * dy);
    s.angle = Math.atan2(dy, dx);
    this.unwrapped = this.hasAngle ? unwrapAngle(this.unwrapped, s.angle) : s.angle;
    this.hasAngle = true;

    const both = leftPinch?.phase === 'active' && rightPinch?.phase === 'active';
    if (both && !s.active && leftPinch && rightPinch) {
      s.active = true;
      s.justStarted = true;
      this.baseCenter.x = s.center.x;
      this.baseCenter.y = s.center.y;
      this.baseDistance = Math.max(s.distance, 1e-4);
      this.baseAngle = this.unwrapped;
      // Precedence (§11 rule 2): if the second hand joined quickly, the first hand's single-hand
      // action (e.g. a voxel it just placed) was really the start of this two-hand grab.
      const first: HandSide = leftPinch.startedAt <= rightPinch.startedAt ? 'left' : 'right';
      const gap = Math.abs(leftPinch.startedAt - rightPinch.startedAt);
      if (gap <= TUNING.gestures.TWO_HAND_JOIN_MS) s.cancelFirstHand = first;
    } else if (!both && s.active) {
      this.end();
    }

    if (s.active) {
      s.scale = s.distance / this.baseDistance;
      s.rotation = this.unwrapped - this.baseAngle;
      s.translation.x = s.center.x - this.baseCenter.x;
      s.translation.y = s.center.y - this.baseCenter.y;
    } else {
      this.resetRelative();
    }
    return s;
  }

  reset(): void {
    const s = this.state;
    s.active = s.justStarted = s.justEnded = false;
    s.cancelFirstHand = null;
    this.hasAngle = false;
    this.bothVisible = false;
    this.resetRelative();
  }

  private end(): void {
    this.state.active = false;
    this.state.justEnded = true;
    this.resetRelative();
  }

  private resetRelative(): void {
    const s = this.state;
    s.scale = 1;
    s.rotation = 0;
    s.translation.x = 0;
    s.translation.y = 0;
  }
}
