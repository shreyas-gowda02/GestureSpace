// Depth from a single webcam (§13.4). Never treat MediaPipe z as world depth: it is relative to the
// wrist. The estimator combines palm scale (dominant: bigger = closer) with fingertip "poke" z,
// smooths it, and a StepQuantizer turns it into intentional integer steps (hysteresis + dwell).
// The signal is RELATIVE to a baseline captured when the hand appears (or on resetBaseline()).

import { TUNING } from '@/config/tuning';
import type { TrackedHand } from '@/core/types';
import { OneEuroFilter } from '@/vision/smoothing';
import { INDEX_TIP } from '@/vision/landmarks';

/** Continuous value → integer steps, changing only on clear, sustained intent. Pure; tested. */
export class StepQuantizer {
  steps = 0;
  private readonly step: number;
  private readonly hysteresis: number;
  private readonly dwellMs: number;
  private readonly deadZone: number;
  private pending = 0;
  private pendingSince = -1;

  constructor(
    step: number = TUNING.depth.DEPTH_STEP,
    hysteresis: number = TUNING.depth.DEPTH_HYSTERESIS,
    dwellMs: number = TUNING.depth.DEPTH_DWELL_MS,
    deadZone: number = TUNING.depth.DEAD_ZONE,
  ) {
    this.step = step;
    this.hysteresis = hysteresis;
    this.dwellMs = dwellMs;
    this.deadZone = deadZone;
  }

  update(value: number, now: number): number {
    let target = Math.abs(value) < this.deadZone ? 0 : Math.round(value / this.step);
    if (target !== this.steps) {
      // The value must pass the boundary toward the target by `hysteresis`…
      const dir = target > this.steps ? 1 : -1;
      const boundary = (this.steps + dir * 0.5) * this.step;
      if (dir * (value - boundary) < this.hysteresis) target = this.steps;
    }
    if (target === this.steps) {
      this.pendingSince = -1;
      return this.steps;
    }
    // …and stay there for `dwellMs`.
    if (this.pendingSince < 0 || target !== this.pending) {
      this.pending = target;
      this.pendingSince = now;
    }
    if (now - this.pendingSince >= this.dwellMs) {
      this.steps = target;
      this.pendingSince = -1;
    }
    return this.steps;
  }

  reset(steps = 0): void {
    this.steps = steps;
    this.pendingSince = -1;
  }
}

export class DepthEstimator {
  /** Smoothed relative depth: > 0 = moved toward the camera since the baseline. */
  signal = 0;
  /** Unsmoothed combination (debug). */
  raw = 0;
  readonly quantizer = new StepQuantizer();
  private readonly filter = new OneEuroFilter({ ...TUNING.depth.oneEuro });
  private baselinePalm = 0;
  private baselineTipZ = 0;
  private hasBaseline = false;

  get steps(): number {
    return this.quantizer.steps;
  }

  /** Call every frame. Returns the smoothed signal (0 while no hand). */
  update(hand: TrackedHand | undefined, now: number): number {
    const tip = hand?.landmarks[INDEX_TIP];
    if (!hand || !tip || hand.palmScale <= 0) {
      this.hasBaseline = false;
      this.signal = this.raw = 0;
      return 0;
    }
    if (!this.hasBaseline) {
      this.baselinePalm = hand.palmScale;
      this.baselineTipZ = tip.z;
      this.hasBaseline = true;
      this.filter.reset();
      this.quantizer.reset();
    }
    const d = TUNING.depth;
    const palm = hand.palmScale / this.baselinePalm - 1;
    const poke = -(tip.z - this.baselineTipZ) * d.MPZ_GAIN;
    this.raw = d.W_PALM * palm + d.W_MPZ * poke;
    this.signal = this.filter.filter(this.raw, now);
    this.quantizer.update(this.signal, now);
    return this.signal;
  }

  /** Re-capture the baseline on the next update (e.g. at pinch start for relative extrusion). */
  resetBaseline(): void {
    this.hasBaseline = false;
  }
}
