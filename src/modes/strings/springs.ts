// Hand Strings building blocks (§16), all allocation-free after construction:
//  • which threads exist for each style (skeleton / web / full mesh), as landmark pairs;
//  • SpringField — one spring-damper midpoint per thread, so threads sag and wobble;
//  • TrailRing — the recent positions of one fingertip, for fading trails;
//  • writeCurve — a thread as a smooth curve through its midpoint, written as line segments.

import { TUNING } from '@/config/tuning';
import type { StringsStyle } from '@/core/types';
import { clamp } from '@/utils/math';
import { FINGERTIPS, HAND_CONNECTIONS, THUMB_CMC, WRIST } from '@/vision/landmarks';

const S = TUNING.strings;

/** Hand index in thread tables: 0 = left, 1 = right. */
export type HandIndex = 0 | 1;

/** Threads as flat quads: [handA, landmarkA, handB, landmarkB, …]. */
export type ThreadTable = Uint8Array;

/** Which finger a landmark belongs to (0 thumb … 4 pinky; the wrist counts as the middle). */
export function fingerOf(landmark: number): number {
  return landmark === WRIST ? 2 : Math.floor((landmark - THUMB_CMC) / 4);
}

function table(pairs: readonly (readonly [number, number, number, number])[]): ThreadTable {
  const t = new Uint8Array(pairs.length * 4);
  pairs.forEach((p, i) => t.set(p, i * 4));
  return t;
}

/** The threads each style draws (skeleton ⊂ web ⊂ full mesh). */
export function buildThreads(style: StringsStyle): ThreadTable {
  const pairs: [number, number, number, number][] = [];
  for (const h of [0, 1]) for (const [a, b] of HAND_CONNECTIONS) pairs.push([h, a, h, b]);
  if (style === 'skeleton') return table(pairs);
  // Web: a ring through the five fingertips of each hand, and each fingertip to its twin.
  for (const h of [0, 1]) {
    for (let i = 0; i < 5; i++) {
      pairs.push([h, FINGERTIPS[i] ?? 0, h, FINGERTIPS[(i + 1) % 5] ?? 0]);
    }
  }
  for (const tip of FINGERTIPS) pairs.push([0, tip, 1, tip]);
  if (style === 'web') return table(pairs);
  // Full mesh: every other fingertip pair within a hand, and every left tip to every right tip.
  for (const h of [0, 1]) {
    for (let i = 0; i < 5; i++) {
      for (let j = i + 2; j < 5; j++) {
        if (i === 0 && j === 4) continue; // thumb–pinky is already on the ring
        pairs.push([h, FINGERTIPS[i] ?? 0, h, FINGERTIPS[j] ?? 0]);
      }
    }
  }
  for (const a of FINGERTIPS) for (const b of FINGERTIPS) if (a !== b) pairs.push([0, a, 1, b]);
  return table(pairs);
}

/**
 * One spring-damper midpoint per thread. Its rest point is the middle of the two ends, hanging
 * down by `sag` × the thread's length; when the ends move it lags and overshoots, so the thread
 * bows and wobbles.
 */
export class SpringField {
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  /** 1 while the thread is being drawn; a thread that (re)appears starts at rest. */
  readonly live: Uint8Array;

  constructor(capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.live = new Uint8Array(capacity);
  }

  reset(): void {
    this.live.fill(0);
    this.vel.fill(0);
  }

  /** Seconds the next `step` calls advance by (a field, so no decimal is passed per call). */
  dt: number = S.maxStep; // starts as a decimal, so the engine never re-types the field

  /**
   * Advance thread `i` whose ends are `ends[a..a+2]` and `ends[b..b+2]` by `dt` (split into
   * stable steps). Only indices are passed: decimals passed to a call that isn't inlined get boxed
   * on the heap, and this runs for every thread every frame.
   */
  step(i: number, ends: Float32Array, a: number, b: number): void {
    const o = i * 3;
    const { pos, vel } = this;
    const ax = ends[a] ?? 0;
    const ay = ends[a + 1] ?? 0;
    const az = ends[a + 2] ?? 0;
    const bx = ends[b] ?? 0;
    const by = ends[b + 1] ?? 0;
    const bz = ends[b + 2] ?? 0;
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const rx = (ax + bx) / 2;
    const ry = (ay + by) / 2 - S.sag * len;
    const rz = (az + bz) / 2;
    if (!this.live[i]) {
      this.live[i] = 1;
      pos[o] = rx;
      pos[o + 1] = ry;
      pos[o + 2] = rz;
      vel[o] = vel[o + 1] = vel[o + 2] = 0;
      return;
    }
    let left = clamp(this.dt, 0, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, S.maxStep);
      left -= h;
      for (let k = 0; k < 3; k++) {
        const rest = k === 0 ? rx : k === 1 ? ry : rz;
        const p = pos[o + k] ?? rest;
        const v =
          (vel[o + k] ?? 0) + (S.stiffness * (rest - p) - S.damping * (vel[o + k] ?? 0)) * h;
        vel[o + k] = v;
        pos[o + k] = p + v * h;
      }
    }
    // Never let a midpoint fly off (a hand that jumps): pull it back within reach of its rest point.
    const dx = (pos[o] ?? rx) - rx;
    const dy = (pos[o + 1] ?? ry) - ry;
    const dz = (pos[o + 2] ?? rz) - rz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const max = S.maxStretch * len;
    if (d > max && d > 0) {
      const k = max / d;
      pos[o] = rx + dx * k;
      pos[o + 1] = ry + dy * k;
      pos[o + 2] = rz + dz * k;
    }
  }
}

/**
 * The last `capacity` positions of one fingertip (x, y, z, time), newest last. Read it through
 * `slot(age)` + `data` / `times` (indices, not decimals, cross the call: no boxing per read).
 */
export class TrailRing {
  readonly data: Float32Array;
  readonly times: Float64Array;
  private head = 0;
  count = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 3);
    this.times = new Float64Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  /** Add a sample unless the last one is less than `minStepMs` old. */
  push(x: number, y: number, z: number, now: number, minStepMs: number): void {
    if (this.count > 0 && now - (this.times[this.slot(0)] ?? 0) < minStepMs) return;
    const i = this.head;
    this.data[i * 3] = x;
    this.data[i * 3 + 1] = y;
    this.data[i * 3 + 2] = z;
    this.times[i] = now;
    this.head = (i + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** Where the sample `age` steps back (0 = newest) lives: times[slot], data[slot * 3 …]. */
  slot(age: number): number {
    return (this.head - 1 - age + this.capacity * 2) % this.capacity;
  }
}

/**
 * A thread from A to B that passes through its spring midpoint M (a quadratic Bézier with control
 * point 2M − (A+B)/2), written as `segments` segments into `pos` (x y z x y z per segment) with
 * colours fading from colour A to colour B. Returns the number of segments written.
 */
export function writeCurve(
  pos: Float32Array,
  col: Float32Array,
  segment: number,
  segments: number,
  a: ArrayLike<number>,
  ao: number,
  m: ArrayLike<number>,
  mo: number,
  b: ArrayLike<number>,
  bo: number,
  ca: ArrayLike<number>,
  cao: number,
  cb: ArrayLike<number>,
  cbo: number,
): number {
  let px = a[ao] ?? 0;
  let py = a[ao + 1] ?? 0;
  let pz = a[ao + 2] ?? 0;
  for (let s = 1; s <= segments; s++) {
    const t = s / segments;
    const u = 1 - t;
    const w0 = u * u;
    const w1 = 2 * u * t;
    const w2 = t * t;
    const x = w0 * (a[ao] ?? 0) + w1 * ctrl(m, mo, a, ao, b, bo, 0) + w2 * (b[bo] ?? 0);
    const y = w0 * (a[ao + 1] ?? 0) + w1 * ctrl(m, mo, a, ao, b, bo, 1) + w2 * (b[bo + 1] ?? 0);
    const z = w0 * (a[ao + 2] ?? 0) + w1 * ctrl(m, mo, a, ao, b, bo, 2) + w2 * (b[bo + 2] ?? 0);
    const o = (segment + s - 1) * 6;
    pos[o] = px;
    pos[o + 1] = py;
    pos[o + 2] = pz;
    pos[o + 3] = x;
    pos[o + 4] = y;
    pos[o + 5] = z;
    const t0 = (s - 1) / segments;
    for (let k = 0; k < 3; k++) {
      const c0 = ca[cao + k] ?? 0;
      const c1 = cb[cbo + k] ?? 0;
      col[o + k] = c0 + (c1 - c0) * t0;
      col[o + 3 + k] = c0 + (c1 - c0) * t;
    }
    px = x;
    py = y;
    pz = z;
  }
  return segments;
}

function ctrl(
  m: ArrayLike<number>,
  mo: number,
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  k: number,
): number {
  return 2 * (m[mo + k] ?? 0) - ((a[ao + k] ?? 0) + (b[bo + k] ?? 0)) / 2;
}
