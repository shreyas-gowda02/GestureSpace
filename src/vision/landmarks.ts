// Named MediaPipe hand landmark indices, skeleton connections and basic hand metrics.
// Mode code must use these names — never magic indices (§2 rule 4).

import type { Vec2, Vec3 } from '@/core/types';

export const WRIST = 0;
export const THUMB_CMC = 1;
export const THUMB_MCP = 2;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_DIP = 7;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_PIP = 10;
export const MIDDLE_DIP = 11;
export const MIDDLE_TIP = 12;
export const RING_MCP = 13;
export const RING_PIP = 14;
export const RING_DIP = 15;
export const RING_TIP = 16;
export const PINKY_MCP = 17;
export const PINKY_PIP = 18;
export const PINKY_DIP = 19;
export const PINKY_TIP = 20;

export const LANDMARK_COUNT = 21;

export const FINGERTIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP] as const;

/** Anatomical skeleton edges (same topology as MediaPipe's HAND_CONNECTIONS). */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  // thumb
  [WRIST, THUMB_CMC],
  [THUMB_CMC, THUMB_MCP],
  [THUMB_MCP, THUMB_IP],
  [THUMB_IP, THUMB_TIP],
  // index
  [WRIST, INDEX_MCP],
  [INDEX_MCP, INDEX_PIP],
  [INDEX_PIP, INDEX_DIP],
  [INDEX_DIP, INDEX_TIP],
  // middle
  [MIDDLE_MCP, MIDDLE_PIP],
  [MIDDLE_PIP, MIDDLE_DIP],
  [MIDDLE_DIP, MIDDLE_TIP],
  // ring
  [RING_MCP, RING_PIP],
  [RING_PIP, RING_DIP],
  [RING_DIP, RING_TIP],
  // pinky
  [WRIST, PINKY_MCP],
  [PINKY_MCP, PINKY_PIP],
  [PINKY_PIP, PINKY_DIP],
  [PINKY_DIP, PINKY_TIP],
  // palm
  [INDEX_MCP, MIDDLE_MCP],
  [MIDDLE_MCP, RING_MCP],
  [RING_MCP, PINKY_MCP],
];

/**
 * Palm scale = |WRIST → MIDDLE_MCP| in view-normalized units with x scaled by the video aspect
 * (i.e. measured in "video heights"). All gesture distances are divided by this.
 */
export function palmScale(landmarks: readonly Vec3[], videoAspect: number): number {
  const a = landmarks[WRIST];
  const b = landmarks[MIDDLE_MCP];
  if (!a || !b) return 0;
  const dx = (b.x - a.x) * videoAspect;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Axis-aligned bounds of the landmarks, written into `out`. */
export function boundsInto(
  out: { min: Vec2; max: Vec2 },
  landmarks: readonly Vec3[],
): { min: Vec2; max: Vec2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  out.min.x = minX;
  out.min.y = minY;
  out.max.x = maxX;
  out.max.y = maxY;
  return out;
}

/** Fresh array of `LANDMARK_COUNT` zero points (for preallocated buffers, never per frame). */
export function makeLandmarkBuffer(): Vec3[] {
  return Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
}
