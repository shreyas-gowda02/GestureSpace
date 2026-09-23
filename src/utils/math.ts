// Scalar math helpers. Pure and allocation-free.

export const EPSILON = 1e-6;
export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp; returns 0 when a === b. */
export function invLerp(a: number, b: number, v: number): number {
  const d = b - a;
  return Math.abs(d) < EPSILON ? 0 : (v - a) / d;
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/**
 * Unwrap `next` so it is continuous with `prev` (no ±π jumps).
 * Returns prev + shortest signed delta.
 */
export function unwrapAngle(prev: number, next: number): number {
  return prev + wrapAngle(next - prev);
}
