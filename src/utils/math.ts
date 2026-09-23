// Scalar + vector math helpers. Pure and allocation-free unless noted.
import type { Vec2, Vec3 } from '@/core/types';

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

// ---------- Vec2 / Vec3 helpers ----------
// Hot paths should use the `*Into` variants that write into a caller-owned `out`.
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

/** 2D distance with x scaled by `aspect` (view-normalized → aspect-correct units). */
export function dist2(a: Vec2, b: Vec2, aspect = 1): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function midpointInto(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = (a.x + b.x) * 0.5;
  out.y = (a.y + b.y) * 0.5;
  return out;
}

export function subInto(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function copyInto<T extends Vec2 | Vec3>(out: T, src: T): T {
  out.x = src.x;
  out.y = src.y;
  if ('z' in out && 'z' in src) out.z = src.z;
  return out;
}

/** Angle (radians) of the vector a→b with x scaled by `aspect`. */
export function angle2(a: Vec2, b: Vec2, aspect = 1): number {
  return Math.atan2(b.y - a.y, (b.x - a.x) * aspect);
}
