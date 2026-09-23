import { describe, expect, it } from 'vitest';
import type { RawDetection, RawHand } from '@/core/input';
import type { Vec3 } from '@/core/types';
import { HandNormalizer, labelToSide } from '@/vision/handPipeline';
import {
  boundsInto,
  HAND_CONNECTIONS,
  INDEX_TIP,
  LANDMARK_COUNT,
  makeLandmarkBuffer,
  MIDDLE_MCP,
  palmScale,
  PINKY_TIP,
  THUMB_TIP,
  WRIST,
} from '@/vision/landmarks';

/** A hand whose wrist is at (x, y) and middle MCP 0.1 video-heights straight above it. */
function rawHand(label: string, x: number, y = 0.7, score = 0.9): RawHand {
  const landmarks: Vec3[] = makeLandmarkBuffer().map(() => ({ x, y: y - 0.05, z: 0 }));
  landmarks[WRIST] = { x, y, z: 0 };
  landmarks[MIDDLE_MCP] = { x, y: y - 0.1, z: -0.01 };
  return { handedness: label, score, landmarks };
}

const det = (hands: RawHand[]): RawDetection => ({
  timestamp: 1000,
  videoWidth: 1280,
  videoHeight: 720,
  hands,
});

describe('landmarks', () => {
  it('names the key indices', () => {
    expect([WRIST, THUMB_TIP, INDEX_TIP, MIDDLE_MCP, PINKY_TIP]).toEqual([0, 4, 8, 9, 20]);
    expect(LANDMARK_COUNT).toBe(21);
  });

  it('connections cover all 21 landmarks with valid indices', () => {
    const used = new Set(HAND_CONNECTIONS.flat());
    expect(used.size).toBe(21);
    for (const i of used) expect(i).toBeGreaterThanOrEqual(0);
    for (const i of used) expect(i).toBeLessThan(21);
  });

  it('palm scale is aspect-corrected', () => {
    const lms = makeLandmarkBuffer();
    lms[WRIST] = { x: 0.5, y: 0.5, z: 0 };
    lms[MIDDLE_MCP] = { x: 0.6, y: 0.5, z: 0 }; // purely horizontal
    expect(palmScale(lms, 16 / 9)).toBeCloseTo(0.1 * (16 / 9));
    lms[MIDDLE_MCP] = { x: 0.5, y: 0.4, z: 0 }; // purely vertical
    expect(palmScale(lms, 16 / 9)).toBeCloseTo(0.1);
  });

  it('computes bounds', () => {
    const lms = makeLandmarkBuffer().map((_, i) => ({ x: i / 20, y: 1 - i / 40, z: 0 }));
    const b = boundsInto({ min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }, lms);
    expect(b).toEqual({ min: { x: 0, y: 0.5 }, max: { x: 1, y: 1 } });
  });
});

describe('labelToSide', () => {
  it('swaps MediaPipe selfie labels to physical hands', () => {
    expect(labelToSide('Left', true)).toBe('right');
    expect(labelToSide('Right', true)).toBe('left');
    expect(labelToSide('Left', false)).toBe('left');
    expect(labelToSide('???', true)).toBeNull();
  });
});

describe('HandNormalizer', () => {
  it('mirrors x into view space and keeps raw landmarks untouched', () => {
    const n = new HandNormalizer({ swapLabels: true });
    const f = n.process(det([rawHand('Left', 0.3)]), true, 5);
    expect(f.right).toBeDefined();
    expect(f.left).toBeUndefined();
    expect(f.right?.rawLandmarks[WRIST]?.x).toBeCloseTo(0.3);
    expect(f.right?.landmarks[WRIST]?.x).toBeCloseTo(0.7); // physical right hand shows on the right
    expect(f.timestamp).toBe(5);
    expect(f.inferenceTimestamp).toBe(1000);

    const g = n.process(det([rawHand('Left', 0.3)]), false, 6);
    expect(g.right?.landmarks[WRIST]?.x).toBeCloseTo(0.3);
  });

  it('computes palm scale and bounds in view space', () => {
    const n = new HandNormalizer({ swapLabels: true });
    const h = n.process(det([rawHand('Right', 0.6)]), true, 0).left;
    expect(h?.palmScale).toBeCloseTo(0.1);
    expect(h?.bbox.min.y).toBeCloseTo(0.6);
    expect(h?.bbox.max.y).toBeCloseTo(0.7);
  });

  it('resolves duplicate labels by on-screen position (hand shown on the right = right)', () => {
    const n = new HandNormalizer({ swapLabels: false });
    // Mirrored view: raw x 0.2 is displayed at 0.8 (right of screen).
    const f = n.process(det([rawHand('Left', 0.8), rawHand('Left', 0.2)]), true, 0);
    expect(f.right?.landmarks[WRIST]?.x).toBeCloseTo(0.8);
    expect(f.left?.landmarks[WRIST]?.x).toBeCloseTo(0.2);
    // Un-mirrored view: raw x is the screen position.
    const g = n.process(det([rawHand('Right', 0.8), rawHand('Right', 0.2)]), false, 1);
    expect(g.right?.landmarks[WRIST]?.x).toBeCloseTo(0.8);
    expect(g.left?.landmarks[WRIST]?.x).toBeCloseTo(0.2);
  });

  it('uses MediaPipe labels as-is by default (verified on a real webcam)', () => {
    const f = new HandNormalizer().process(det([rawHand('Right', 0.3)]), true, 0);
    expect(f.right).toBeDefined();
    expect(f.left).toBeUndefined();
  });

  it('reuses the same objects every frame (no per-frame allocation)', () => {
    const n = new HandNormalizer({ swapLabels: true });
    const a = n.process(det([rawHand('Left', 0.3)]), true, 0);
    const handA = a.right;
    const lmsA = a.right?.landmarks;
    const b = n.process(det([rawHand('Left', 0.35)]), true, 1);
    expect(b).toBe(a);
    expect(b.right).toBe(handA);
    expect(b.right?.landmarks).toBe(lmsA);
  });

  it('drops hands that disappear and clears on demand', () => {
    const n = new HandNormalizer({ swapLabels: true });
    n.process(det([rawHand('Left', 0.3), rawHand('Right', 0.7)]), true, 0);
    const f = n.process(det([rawHand('Right', 0.7)]), true, 1);
    expect(f.right).toBeUndefined();
    expect(f.left).toBeDefined();
    n.clear(2);
    expect(n.frame.left).toBeUndefined();
  });
});
