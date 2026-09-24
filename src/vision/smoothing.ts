// One Euro filter (Casiez et al. 2012) + per-hand landmark smoother (§10).
// Smooth when slow (kills jitter), responsive when fast (little lag). Two profiles per hand:
// VISUAL (stronger; overlays/objects) and TRIGGER (lighter; gesture distances).

import { TUNING } from '@/config/tuning';
import type { Vec3 } from '@/core/types';
import { clamp, lerp } from '@/utils/math';
import { LANDMARK_COUNT } from './landmarks';

export interface OneEuroParams {
  /** Hz. Lower = smoother when still. */
  minCutoff: number;
  /** Cutoff increase per unit/s of speed. Higher = less lag when moving fast. */
  beta: number;
  /** Hz, cutoff for the derivative. */
  dCutoff: number;
}

function alpha(cutoffHz: number, dtS: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
}

export class OneEuroFilter {
  params: OneEuroParams;
  private x = 0;
  private dx = 0;
  private lastT = -1;

  constructor(params: OneEuroParams) {
    this.params = params;
  }

  /** @param t timestamp in ms (must increase; a non-increasing t resets the filter). */
  filter(value: number, t: number): number {
    if (this.lastT < 0 || t <= this.lastT) {
      this.x = value;
      this.dx = 0;
      this.lastT = t;
      return value;
    }
    const dt = (t - this.lastT) / 1000;
    this.lastT = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.lastT = -1;
  }
}

/** Smoothing slider (0..1) → visual minCutoff. 0 = most responsive, 1 = smoothest. */
export function smoothingToMinCutoff(slider: number): number {
  const r = TUNING.smoothing.sliderMinCutoffRange;
  return lerp(r.max, r.min, clamp(slider, 0, 1));
}

/**
 * 21 × (x, y, z) One Euro filters for one profile, plus a low-passed velocity per coordinate
 * (units/s) used for prediction. Allocated once; no per-frame allocation.
 */
class ProfileSmoother {
  readonly params: OneEuroParams;
  private readonly filters: OneEuroFilter[];
  private readonly value = new Float64Array(LANDMARK_COUNT * 3);
  private readonly velocity = new Float64Array(LANDMARK_COUNT * 3);
  private lastT = -1;

  constructor(params: OneEuroParams) {
    this.params = params;
    // All filters share the same params object, so a slider change applies to every one.
    this.filters = Array.from({ length: LANDMARK_COUNT * 3 }, () => new OneEuroFilter(params));
  }

  apply(src: readonly Vec3[], dst: Vec3[], t: number): void {
    const dt = this.lastT >= 0 && t > this.lastT ? (t - this.lastT) / 1000 : 0;
    const a = dt > 0 ? alpha(TUNING.smoothing.predict.velocityCutoff, dt) : 0;
    if (dt === 0) this.velocity.fill(0);
    this.lastT = t;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const s = src[i];
      const d = dst[i];
      if (!s || !d) continue;
      d.x = this.step(i * 3, s.x, t, dt, a);
      d.y = this.step(i * 3 + 1, s.y, t, dt, a);
      d.z = this.step(i * 3 + 2, s.z, t, dt, a);
    }
  }

  /** Extrapolate the filtered positions `aheadS` seconds forward along their velocity. */
  predictInto(dst: Vec3[], aheadS: number): void {
    const v = this.value;
    const vel = this.velocity;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const d = dst[i];
      if (!d) continue;
      const k = i * 3;
      d.x = (v[k] ?? 0) + (vel[k] ?? 0) * aheadS;
      d.y = (v[k + 1] ?? 0) + (vel[k + 1] ?? 0) * aheadS;
      d.z = (v[k + 2] ?? 0) + (vel[k + 2] ?? 0) * aheadS;
    }
  }

  reset(): void {
    for (const f of this.filters) f.reset();
    this.velocity.fill(0);
    this.lastT = -1;
  }

  private step(k: number, raw: number, t: number, dt: number, a: number): number {
    const f = this.filters[k];
    if (!f) return raw;
    const x = f.filter(raw, t);
    if (dt > 0) {
      const prev = this.value[k] ?? x;
      const vel = this.velocity[k] ?? 0;
      this.velocity[k] = vel + a * ((x - prev) / dt - vel);
    }
    this.value[k] = x;
    return x;
  }
}

/** How the VISUAL landmarks are produced (Debug panel switch; default 'predict'). */
export type SmoothingMode = 'off' | 'smooth' | 'predict';

/** Visual + trigger smoothing for one hand slot. */
export class LandmarkSmoother {
  private readonly visual: ProfileSmoother;
  private readonly trigger: ProfileSmoother;

  constructor(visualMinCutoff = smoothingToMinCutoff(TUNING.smoothing.defaultSlider)) {
    this.visual = new ProfileSmoother({ ...TUNING.smoothing.visual, minCutoff: visualMinCutoff });
    this.trigger = new ProfileSmoother({ ...TUNING.smoothing.trigger });
  }

  get visualMinCutoff(): number {
    return this.visual.params.minCutoff;
  }

  setVisualMinCutoff(hz: number): void {
    this.visual.params.minCutoff = hz;
  }

  /** Smooth view-space `src` into both output buffers. `t` = inference timestamp (ms). */
  apply(src: readonly Vec3[], visualOut: Vec3[], triggerOut: Vec3[], t: number): void {
    this.visual.apply(src, visualOut, t);
    this.trigger.apply(src, triggerOut, t);
  }

  /**
   * Visual landmarks extrapolated `aheadMs` past the last inference (render at 60 Hz while the
   * tracker runs at 30 Hz): cancels most of the filter's lag while keeping its steadiness.
   */
  predictVisual(out: Vec3[], aheadMs: number): void {
    this.visual.predictInto(out, aheadMs / 1000);
  }

  reset(): void {
    this.visual.reset();
    this.trigger.reset();
  }
}
