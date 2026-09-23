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

/** 21 × (x, y, z) One Euro filters for one profile. Allocated once. */
class ProfileSmoother {
  readonly params: OneEuroParams;
  private readonly filters: OneEuroFilter[];

  constructor(params: OneEuroParams) {
    this.params = params;
    // All filters share the same params object, so a slider change applies to every one.
    this.filters = Array.from({ length: LANDMARK_COUNT * 3 }, () => new OneEuroFilter(params));
  }

  apply(src: readonly Vec3[], dst: Vec3[], t: number): void {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const s = src[i];
      const d = dst[i];
      const fx = this.filters[i * 3];
      const fy = this.filters[i * 3 + 1];
      const fz = this.filters[i * 3 + 2];
      if (!s || !d || !fx || !fy || !fz) continue;
      d.x = fx.filter(s.x, t);
      d.y = fy.filter(s.y, t);
      d.z = fz.filter(s.z, t);
    }
  }

  reset(): void {
    for (const f of this.filters) f.reset();
  }
}

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

  reset(): void {
    this.visual.reset();
    this.trigger.reset();
  }
}
