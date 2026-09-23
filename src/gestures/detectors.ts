// Pure per-hand gesture METRICS (§11). Each returns a number the state machines threshold.
// All distances are 2D, aspect-corrected (x × videoAspect) and divided by palmScale, so they work
// at any distance from the camera. Inputs are the TRIGGER-profile landmarks.

import type { Vec3 } from '@/core/types';
import { TUNING } from '@/config/tuning';
import {
  INDEX_MCP,
  INDEX_PIP,
  INDEX_TIP,
  MIDDLE_MCP,
  MIDDLE_PIP,
  MIDDLE_TIP,
  PINKY_MCP,
  PINKY_PIP,
  PINKY_TIP,
  RING_MCP,
  RING_PIP,
  RING_TIP,
  THUMB_MCP,
  THUMB_TIP,
  WRIST,
} from '@/vision/landmarks';

const TIPS4 = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP] as const;

/** Aspect-corrected 2D distance between two landmarks. */
export function lmDist(lms: readonly Vec3[], a: number, b: number, aspect: number): number {
  const p = lms[a];
  const q = lms[b];
  if (!p || !q) return 0;
  const dx = (p.x - q.x) * aspect;
  const dy = p.y - q.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const safe = (palm: number): number => (palm > 1e-6 ? palm : 1e-6);

/** Thumb tip ↔ index tip / palm. Pinch when small. */
export function pinchValue(lms: readonly Vec3[], aspect: number, palm: number): number {
  return lmDist(lms, THUMB_TIP, INDEX_TIP, aspect) / safe(palm);
}

/**
 * Pinch metric used by the engine: a closed fist never counts as a pinch (its thumb rests next to
 * the curled index finger, which would otherwise read as a pinch). `grab` = grabValue().
 */
export function pinchGestureValue(
  lms: readonly Vec3[],
  aspect: number,
  palm: number,
  grab: number,
): number {
  const v = pinchValue(lms, aspect, palm);
  const g = TUNING.gestures;
  return grab < g.grab.start ? Math.max(v, g.pinch.end + 0.5) : v;
}

/** Thumb tip ↔ pinky tip / palm. Thumb-pinky tap when small. */
export function thumbPinkyValue(lms: readonly Vec3[], aspect: number, palm: number): number {
  return lmDist(lms, THUMB_TIP, PINKY_TIP, aspect) / safe(palm);
}

/**
 * FARTHEST of the four fingertips from the palm centre / palm. Fist when small (all four curled,
 * ≈0.2–0.4). Using the max (not the mean) keeps "point" — three fingers curled — from reading as grab.
 */
export function grabValue(lms: readonly Vec3[], aspect: number, palm: number): number {
  const w = lms[WRIST];
  const i = lms[INDEX_MCP];
  const m = lms[MIDDLE_MCP];
  const r = lms[RING_MCP];
  const p = lms[PINKY_MCP];
  if (!w || !i || !m || !r || !p) return 0;
  const cx = (w.x + i.x + m.x + r.x + p.x) / 5;
  const cy = (w.y + i.y + m.y + r.y + p.y) / 5;
  let max = 0;
  for (const tip of TIPS4) {
    const t = lms[tip];
    if (!t) continue;
    const dx = (t.x - cx) * aspect;
    const dy = t.y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > max) max = d;
  }
  return max / safe(palm);
}

/** A finger is extended when its tip is clearly farther from the wrist than its PIP joint. */
export function fingerExtended(
  lms: readonly Vec3[],
  tip: number,
  pip: number,
  aspect: number,
): boolean {
  return (
    lmDist(lms, WRIST, tip, aspect) >
    lmDist(lms, WRIST, pip, aspect) * TUNING.gestures.fingerExtendedRatio
  );
}

/** Thumb is abducted (sticking out) when its tip is well away from the pinky side of the palm. */
export function thumbExtended(lms: readonly Vec3[], aspect: number): boolean {
  return (
    lmDist(lms, THUMB_TIP, PINKY_MCP, aspect) >
    lmDist(lms, THUMB_MCP, PINKY_MCP, aspect) * TUNING.gestures.thumbExtendedRatio
  );
}

/** Which of index / middle / ring / pinky are extended, as a bitmask (1 = index … 8 = pinky). */
export function extendedMask(lms: readonly Vec3[], aspect: number): number {
  let m = 0;
  if (fingerExtended(lms, INDEX_TIP, INDEX_PIP, aspect)) m |= 1;
  if (fingerExtended(lms, MIDDLE_TIP, MIDDLE_PIP, aspect)) m |= 2;
  if (fingerExtended(lms, RING_TIP, RING_PIP, aspect)) m |= 4;
  if (fingerExtended(lms, PINKY_TIP, PINKY_PIP, aspect)) m |= 8;
  return m;
}

/** 1 when only the index finger is extended (pointing), else 0. */
export function pointValue(lms: readonly Vec3[], aspect: number): number {
  return extendedMask(lms, aspect) === 1 ? 1 : 0;
}

/** 1 when all four fingers and the thumb are extended and not pinching, else 0. */
export function openPalmValue(lms: readonly Vec3[], aspect: number, palm: number): number {
  return extendedMask(lms, aspect) === 15 &&
    thumbExtended(lms, aspect) &&
    pinchValue(lms, aspect, palm) > TUNING.gestures.pinch.end
    ? 1
    : 0;
}
