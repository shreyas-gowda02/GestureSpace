// Plain-object vector helpers for the perception/gesture layers.
// Hot paths should use the `*Into` variants that write into a caller-owned `out`.

import type { Vec2, Vec3 } from '@/core/types/common';

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
