// Gesture engine (§11): HandFrame → GestureFrame, every render frame.
// Per hand: pinch / grab / point / openPalm / thumbPinky state machines (+ optional swipe).
// Both hands: two-hand pinch state. Precedence helpers for modes live here too.
// The GestureFrame and every GestureState are reused — no per-frame allocation.

import { FEATURE_FLAGS, TUNING } from '@/config/tuning';
import type {
  GestureFrame,
  HandFrame,
  HandGestures,
  HandSide,
  SwipeDirection,
  TrackedHand,
} from '@/core/types';
import { WRIST } from '@/vision/landmarks';
import {
  grabValue,
  openPalmValue,
  pinchGestureValue,
  pointValue,
  thumbPinkyValue,
} from './detectors';
import { GestureStateMachine, type MachineConfig } from './stateMachine';
import { TwoHandTracker } from './twoHand';

const G = TUNING.gestures;
const timing = { candidateMs: G.CANDIDATE_MS, releaseMs: G.RELEASE_DEBOUNCE_MS };

const CONFIGS: Record<'pinch' | 'grab' | 'point' | 'openPalm' | 'thumbPinky', MachineConfig> = {
  pinch: { start: G.pinch.start, end: G.pinch.end, below: true, ...timing },
  grab: { start: G.grab.start, end: G.grab.end, below: true, ...timing },
  point: { start: 0.5, end: 0.5, below: false, ...timing },
  openPalm: { start: 0.5, end: 0.5, below: false, ...timing },
  thumbPinky: {
    start: G.thumbPinky.start,
    end: G.thumbPinky.end,
    below: true,
    ...timing,
    cooldownMs: G.thumbPinky.cooldownMs,
  },
};

const SWIPE_SAMPLES = 16;

/** Wrist-velocity swipe detector (off by default — FEATURE_FLAGS.swipeGesture). */
class SwipeDetector {
  private readonly xs = new Float64Array(SWIPE_SAMPLES);
  private readonly ys = new Float64Array(SWIPE_SAMPLES);
  private readonly ts = new Float64Array(SWIPE_SAMPLES);
  private head = 0;
  private count = 0;
  private cooldownUntil = -Infinity;
  readonly event: { direction: SwipeDirection; at: number } = { direction: 'left', at: 0 };

  /** Returns the (reused) event object on the frame a swipe fires, else undefined. */
  update(x: number, y: number, now: number, aspect: number): HandGestures['swipe'] {
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.ts[this.head] = now;
    this.head = (this.head + 1) % SWIPE_SAMPLES;
    this.count = Math.min(this.count + 1, SWIPE_SAMPLES);
    if (now < this.cooldownUntil || this.count < 2) return undefined;

    // Oldest sample still inside the window.
    let oldest = -1;
    for (let k = this.count - 1; k >= 1; k--) {
      const i = (this.head - 1 - k + SWIPE_SAMPLES * 2) % SWIPE_SAMPLES;
      if (now - (this.ts[i] ?? 0) <= G.swipe.windowMs) {
        oldest = i;
        break;
      }
    }
    if (oldest < 0) return undefined;
    const dt = (now - (this.ts[oldest] ?? now)) / 1000;
    if (dt <= 0) return undefined;
    const vx = ((x - (this.xs[oldest] ?? x)) * aspect) / dt;
    const vy = (y - (this.ys[oldest] ?? y)) / dt;
    if (Math.hypot(vx, vy) < G.swipe.minVelocity) return undefined;
    this.event.direction =
      Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
    this.event.at = now;
    this.cooldownUntil = now + G.swipe.cooldownMs;
    return this.event;
  }

  reset(): void {
    this.head = this.count = 0;
    this.cooldownUntil = -Infinity;
  }
}

/** All gesture machines for one hand. */
class HandGestureTracker {
  readonly pinch = new GestureStateMachine(CONFIGS.pinch);
  readonly grab = new GestureStateMachine(CONFIGS.grab);
  readonly point = new GestureStateMachine(CONFIGS.point);
  readonly openPalm = new GestureStateMachine(CONFIGS.openPalm);
  readonly thumbPinky = new GestureStateMachine(CONFIGS.thumbPinky);
  private readonly swipe = new SwipeDetector();
  present = false;

  /** Reused output object for this hand. */
  readonly gestures: HandGestures = {
    pinch: this.pinch.state,
    grab: this.grab.state,
    point: this.point.state,
    openPalm: this.openPalm.state,
    thumbPinky: this.thumbPinky.state,
    depthSignal: 0, // DepthEstimator arrives in Phase 4
  };

  update(hand: TrackedHand, aspect: number, now: number): HandGestures {
    const lms = hand.triggerLandmarks;
    const palm = hand.palmScale;
    const grab = grabValue(lms, aspect, palm);
    this.grab.update(grab, now);
    this.pinch.update(pinchGestureValue(lms, aspect, palm, grab), now);
    this.point.update(pointValue(lms, aspect), now);
    this.openPalm.update(openPalmValue(lms, aspect, palm), now);
    this.thumbPinky.update(thumbPinkyValue(lms, aspect, palm), now);
    const w = lms[WRIST];
    this.gestures.swipe =
      FEATURE_FLAGS.swipeGesture && w ? this.swipe.update(w.x, w.y, now, aspect) : undefined;
    this.present = true;
    return this.gestures;
  }

  /** Hand removed after its grace period: end everything (emits justEnded once). */
  release(): HandGestures {
    this.pinch.forceRelease();
    this.grab.forceRelease();
    this.point.forceRelease();
    this.openPalm.forceRelease();
    this.thumbPinky.forceRelease();
    this.swipe.reset();
    this.gestures.swipe = undefined;
    this.present = false;
    return this.gestures;
  }

  reset(): void {
    this.pinch.reset();
    this.grab.reset();
    this.point.reset();
    this.openPalm.reset();
    this.thumbPinky.reset();
    this.swipe.reset();
    this.gestures.swipe = undefined;
    this.present = false;
  }
}

export class GestureEngine {
  private readonly hands: Record<HandSide, HandGestureTracker> = {
    left: new HandGestureTracker(),
    right: new HandGestureTracker(),
  };
  private readonly twoHandTracker = new TwoHandTracker();
  readonly frame: GestureFrame = { twoHand: this.twoHandTracker.state };

  /** Both hands visible (for the hand-to-hand indicator line). */
  get bothHandsVisible(): boolean {
    return this.twoHandTracker.bothVisible;
  }

  /**
   * A gesture currently "holds" something (pinch/grab on either hand, or two-hand). While true,
   * the hand pipeline locks hand identities by proximity so crossing hands can't swap them (§8).
   */
  get capturing(): boolean {
    const l = this.hands.left;
    const r = this.hands.right;
    return (
      this.frame.twoHand.active ||
      l.pinch.active ||
      l.grab.active ||
      r.pinch.active ||
      r.grab.active
    );
  }

  update(hands: HandFrame, aspect: number, now: number): GestureFrame {
    const f = this.frame;
    f.left = this.updateSide(hands.left, this.hands.left, aspect, now);
    f.right = this.updateSide(hands.right, this.hands.right, aspect, now);
    this.twoHandTracker.update(hands.left, f.left?.pinch, hands.right, f.right?.pinch, aspect);
    return f;
  }

  reset(): void {
    this.hands.left.reset();
    this.hands.right.reset();
    this.twoHandTracker.reset();
    this.frame.left = undefined;
    this.frame.right = undefined;
  }

  private updateSide(
    hand: TrackedHand | undefined,
    tracker: HandGestureTracker,
    aspect: number,
    now: number,
  ): HandGestures | undefined {
    if (hand) return tracker.update(hand, aspect, now);
    // Deliver the forced release for exactly one frame, then report the hand as absent.
    if (tracker.present) return tracker.release();
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Precedence helpers (§11) — modes use these instead of re-deriving the rules.
// ---------------------------------------------------------------------------------------------

/** Rule 2: an active two-hand transform suppresses single-hand pinch actions for both hands. */
export function singleHandPinchAllowed(g: GestureFrame): boolean {
  return !g.twoHand.active;
}

/** Short human label for the status bar ("pinch", "open", …). */
export function describeHand(hand: TrackedHand | undefined, g: HandGestures | undefined): string {
  if (!hand) return '—';
  if (hand.lostForMs > 0) return 'lost…';
  if (!g) return 'hand';
  if (g.pinch.phase === 'active') return 'pinch';
  if (g.grab.phase === 'active') return 'grab';
  if (g.thumbPinky.phase === 'active') return 'thumb-pinky';
  if (g.point.phase === 'active') return 'point';
  if (g.openPalm.phase === 'active') return 'open';
  return 'hand';
}
