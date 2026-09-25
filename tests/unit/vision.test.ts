import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { RawDetection, RawHand } from '@/core/input';
import type { HandFrame, HandSide, Vec3 } from '@/core/types';
import { handChirality, HandNormalizer, labelToSide } from '@/vision/handPipeline';
import type { SmoothingMode } from '@/vision/smoothing';
import { makeRng } from '../fixtures/syntheticHands';
import {
  boundsInto,
  HAND_CONNECTIONS,
  INDEX_MCP,
  INDEX_TIP,
  LANDMARK_COUNT,
  makeLandmarkBuffer,
  MIDDLE_MCP,
  palmScale,
  PINKY_MCP,
  PINKY_TIP,
  THUMB_CMC,
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
    const f = n.process(det([rawHand('Left', 0.65), rawHand('Left', 0.35)]), true, 0);
    expect(f.right?.landmarks[WRIST]?.x).toBeCloseTo(0.65);
    expect(f.left?.landmarks[WRIST]?.x).toBeCloseTo(0.35);
    // Un-mirrored view: raw x is the screen position.
    const g = new HandNormalizer({ swapLabels: false }).process(
      det([rawHand('Right', 0.65), rawHand('Right', 0.35)]),
      false,
      1,
    );
    expect(g.right?.landmarks[WRIST]?.x).toBeCloseTo(0.65);
    expect(g.left?.landmarks[WRIST]?.x).toBeCloseTo(0.35);
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

  it('keeps a vanished hand frozen for the grace period, then drops it; clears on demand', () => {
    const n = new HandNormalizer({ swapLabels: true });
    n.process(det([rawHand('Left', 0.3), rawHand('Right', 0.7)]), true, 0);
    const f = n.process(det([rawHand('Right', 0.7)]), true, 10);
    expect(f.left).toBeDefined();
    expect(f.right).toBeDefined(); // still here, frozen…
    expect(n.tick(100).right?.lostForMs).toBe(90); // …counting its loss time
    expect(n.tick(200).right).toBeUndefined(); // > 150 ms grace → gone
    n.clear(300);
    expect(n.frame.left).toBeUndefined();
  });
});

/** Hand with a given palm size: wrist at (x, y), middle MCP `palm` above it (raw image coords). */
function sizedHand(label: string, x: number, y: number, palm: number): RawHand {
  const landmarks: Vec3[] = makeLandmarkBuffer().map(() => ({ x, y: y - palm / 2, z: 0 }));
  landmarks[WRIST] = { x, y, z: 0 };
  landmarks[MIDDLE_MCP] = { x, y: y - palm, z: 0 };
  return { handedness: label, score: 0.95, landmarks };
}

describe('main-user lock', () => {
  it('keeps the closest person (largest hands) and ignores background hands', () => {
    const n = new HandNormalizer({ swapLabels: false });
    const f = n.process(
      det([
        sizedHand('Right', 0.1, 0.4, 0.07), // background person, listed first
        sizedHand('Left', 0.9, 0.4, 0.07),
        sizedHand('Right', 0.35, 0.75, 0.16), // main user
        sizedHand('Left', 0.65, 0.75, 0.16),
      ]),
      true,
      0,
    );
    expect(n.detectedCount).toBe(4);
    expect(n.usedCount).toBe(2);
    expect(f.right?.rawLandmarks[WRIST]?.x).toBeCloseTo(0.35);
    expect(f.left?.rawLandmarks[WRIST]?.x).toBeCloseTo(0.65);
  });

  it('never takes a much smaller background hand as the second hand', () => {
    const n = new HandNormalizer({ swapLabels: false });
    const f = n.process(
      det([sizedHand('Left', 0.9, 0.4, 0.07), sizedHand('Right', 0.35, 0.75, 0.16)]),
      true,
      0,
    );
    expect(n.usedCount).toBe(1);
    expect(f.right).toBeDefined();
    expect(f.left).toBeUndefined();
  });

  it('keeps following the tracked user when someone closer walks in', () => {
    const n = new HandNormalizer({ swapLabels: false });
    n.process(det([sizedHand('Right', 0.35, 0.75, 0.12)]), true, 0);
    const f = n.process(
      det([sizedHand('Right', 0.8, 0.6, 0.2), sizedHand('Right', 0.36, 0.75, 0.12)]),
      true,
      33,
    );
    expect(f.right?.rawLandmarks[WRIST]?.x).toBeCloseTo(0.36);
  });

  it('ignores hands below the confidence gate', () => {
    const n = new HandNormalizer({ swapLabels: false });
    const weak = { ...sizedHand('Right', 0.35, 0.75, 0.16), score: 0.3 };
    expect(n.process(det([weak]), true, 0).right).toBeUndefined();
    expect(n.gatedCount).toBe(0);
  });
});

describe('side stability', () => {
  it('a contradicting label must persist before a tracked hand switches sides', () => {
    const n = new HandNormalizer({ swapLabels: false });
    n.process(det([sizedHand('Right', 0.35, 0.75, 0.16)]), true, 0);
    const wrong = (t: number) => n.process(det([sizedHand('Left', 0.35, 0.75, 0.16)]), true, t);
    expect(wrong(33).right).toBeDefined(); // 1 disagreeing frame
    expect(wrong(66).right).toBeDefined(); // 2
    const f = wrong(99); // 3 → accept the label
    expect(f.left).toBeDefined();
  });

  it('while identity is locked (a capture is active), labels cannot swap hands', () => {
    const n = new HandNormalizer({ swapLabels: false });
    n.process(
      det([sizedHand('Right', 0.35, 0.75, 0.16), sizedHand('Left', 0.65, 0.75, 0.16)]),
      true,
      0,
    );
    n.setIdentityLock(true);
    for (let i = 1; i <= 6; i++) {
      // MediaPipe swaps the labels (e.g. hands crossing) — ignored while locked.
      const f = n.process(
        det([sizedHand('Left', 0.35, 0.75, 0.16), sizedHand('Right', 0.65, 0.75, 0.16)]),
        true,
        i * 33,
      );
      expect(f.right?.rawLandmarks[WRIST]?.x).toBeCloseTo(0.35);
      expect(f.left?.rawLandmarks[WRIST]?.x).toBeCloseTo(0.65);
    }
  });

  it('rejects a single impossible jump, but accepts it if it persists', () => {
    const n = new HandNormalizer({ swapLabels: false });
    n.process(det([sizedHand('Right', 0.35, 0.5, 0.16)]), true, 0);
    // 0.28 jump in y: within the continuity radius but above MAX_JUMP.
    let f = n.process(det([sizedHand('Right', 0.35, 0.78, 0.16)]), true, 33);
    expect(f.right?.rawLandmarks[WRIST]?.y).toBeCloseTo(0.5); // ignored once
    f = n.process(det([sizedHand('Right', 0.35, 0.78, 0.16)]), true, 66);
    expect(f.right?.rawLandmarks[WRIST]?.y).toBeCloseTo(0.78); // persistent → accepted
  });
});

describe('smoothing latency budget (real pipeline, 30 Hz inference / 60 Hz render)', () => {
  // Tracker noise σ ≈ 0.002 view units (~1.4 px at 720p), like MediaPipe on a still hand.
  const gauss = (r: () => number): number =>
    Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

  /** Drive the normalizer with a moving, noisy hand; return errors of the wrist in view x (px). */
  function simulate(mode: SmoothingMode, truth: (t: number) => number, seed: number) {
    const r = makeRng(seed);
    const n = new HandNormalizer({ swapLabels: false });
    n.setSmoothingMode(mode);
    const out: { t: number; err: number }[] = [];
    let nextSample = 0;
    for (let t = 0; t <= 3500; t += 1000 / 60) {
      while (nextSample <= t) {
        const x = 0.5 - truth(nextSample) + 0.002 * gauss(r); // raw x (view = 1 - raw)
        const hand = sizedHand('Right', x, 0.7 + 0.002 * gauss(r), 0.16);
        n.process({ ...det([hand]), timestamp: nextSample }, true, t);
        nextSample += 1000 / 30;
      }
      const f: HandFrame = n.tick(t);
      const wx = f.right?.landmarks[WRIST]?.x ?? 0.5;
      out.push({ t, err: (wx - 0.5 - truth(t)) * 720 });
    }
    return out;
  }

  const rms = (xs: number[]): number => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);
  function metrics(mode: SmoothingMode) {
    const still = (t: number): number => (t < 1500 ? 0 : 0);
    const ramp = (t: number): number => (t < 1500 ? 0 : (0.6 * (t - 1500)) / 1000); // 0.6 units/s
    const wave = (t: number): number => 0.12 * Math.sin((2 * Math.PI * 1.5 * t) / 1000);
    let jitter = 0;
    let lagMs = 0;
    let waveErr = 0;
    const seeds = 8;
    for (let s = 1; s <= seeds; s++) {
      jitter +=
        rms(
          simulate(mode, still, s)
            .filter((e) => e.t > 500)
            .map((e) => e.err),
        ) / seeds;
      const moving = simulate(mode, ramp, s).filter((e) => e.t > 1750 && e.t < 2300);
      lagMs += (moving.reduce((a, e) => a - e.err / 720 / 0.6, 0) / moving.length / seeds) * 1000;
      waveErr +=
        rms(
          simulate(mode, wave, s)
            .filter((e) => e.t > 1000)
            .map((e) => e.err),
        ) / seeds;
    }
    return { jitter, lagMs, waveErr };
  }

  it('prediction keeps most of the steadiness while cancelling the lag', () => {
    const raw = metrics('off');
    const smooth = metrics('smooth');
    const predict = metrics('predict');
    // Steadier than raw tracking when still…
    expect(predict.jitter).toBeLessThan(raw.jitter * 0.65);
    // …with lag no worse than the raw tracker's own frame age, and far below plain smoothing.
    expect(predict.lagMs).toBeLessThan(12);
    expect(predict.lagMs).toBeLessThan(smooth.lagMs * 0.6);
    // Following a fast wave: closer to the finger than both raw and plain smoothing.
    expect(predict.waveErr).toBeLessThan(raw.waveErr);
    expect(predict.waveErr).toBeLessThan(smooth.waveErr);
  });
});

// ---------------------------------------------------------------------------------------------
// Which hand is which (D42): 3D thumb check, phantom filter, evidence-based sides, lock trap
// ---------------------------------------------------------------------------------------------

/** World (3D) landmarks of a right hand — or its mirror image, the left hand. */
function worldHand(side: HandSide, rotate: (p: Vec3) => Vec3 = (p) => p): Vec3[] {
  const s = side === 'right' ? 1 : -1;
  const w = makeLandmarkBuffer();
  const put = (i: number, x: number, y: number, z: number): void => {
    w[i] = rotate({ x: s * x, y, z });
  };
  put(WRIST, 0, 0, 0);
  put(INDEX_MCP, 0.02, -0.08, 0);
  put(PINKY_MCP, -0.03, -0.07, 0);
  put(THUMB_CMC, 0.03, -0.02, -0.02);
  return w;
}

/** A uniformly random 3D rotation (Shoemake's random unit quaternion). */
function randomRotation(r: () => number): (p: Vec3) => Vec3 {
  const u1 = r();
  const u2 = r();
  const u3 = r();
  const qx = Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2);
  const qy = Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2);
  const qz = Math.sqrt(u1) * Math.sin(2 * Math.PI * u3);
  const qw = Math.sqrt(u1) * Math.cos(2 * Math.PI * u3);
  return (p) => {
    const cx = qy * p.z - qz * p.y;
    const cy = qz * p.x - qx * p.z;
    const cz = qx * p.y - qy * p.x;
    return {
      x: p.x + 2 * (qw * cx + qy * cz - qz * cy),
      y: p.y + 2 * (qw * cy + qz * cx - qx * cz),
      z: p.z + 2 * (qw * cz + qx * cy - qy * cx),
    };
  };
}

/** A hand with a real extent (so boxes can overlap) and, optionally, a 3D shape. */
function boxHand(
  label: string,
  x: number,
  y: number,
  opts: { score?: number; world?: HandSide } = {},
): RawHand {
  const size = 0.16;
  const landmarks: Vec3[] = makeLandmarkBuffer().map((_, i) => ({
    x: x - size / 2 + ((i % 5) / 4) * size,
    y: y - (Math.floor(i / 5) / 4) * size,
    z: 0,
  }));
  landmarks[WRIST] = { x, y, z: 0 };
  landmarks[MIDDLE_MCP] = { x, y: y - size / 2, z: 0 };
  return {
    handedness: label,
    score: opts.score ?? 0.95,
    landmarks,
    ...(opts.world ? { worldLandmarks: worldHand(opts.world) } : {}),
  };
}

describe('3D thumb check (D42)', () => {
  it('is positive for a right hand and negative for its mirror image, however it is turned', () => {
    const r = makeRng(42);
    for (let k = 0; k < 50; k++) {
      const rot = randomRotation(r);
      expect(handChirality(worldHand('right', rot))).toBeGreaterThan(0.2);
      expect(handChirality(worldHand('left', rot))).toBeLessThan(-0.2);
    }
  });

  it('gives no vote for a flat hand, and none without 3D data', () => {
    const flat = worldHand('right');
    flat[THUMB_CMC] = { x: 0.01, y: -0.05, z: 0 }; // thumb base in the palm plane
    expect(Math.abs(handChirality(flat))).toBeLessThan(1e-9);
    expect(handChirality(undefined)).toBeNaN();
  });
});

describe('which hand is which (D42)', () => {
  it('drops a phantom duplicate on top of a real hand, but keeps two separate hands', () => {
    const n = new HandNormalizer({ swapLabels: false });
    const f = n.process(
      det([boxHand('Left', 0.3, 0.7), boxHand('Right', 0.31, 0.68, { score: 0.7 })]),
      true,
      0,
    );
    expect(n.phantomCount).toBe(1);
    expect(f.left).toBeDefined();
    expect(f.right).toBeUndefined();

    const m = new HandNormalizer({ swapLabels: false });
    const g = m.process(det([boxHand('Left', 0.3, 0.7), boxHand('Right', 0.7, 0.7)]), true, 0);
    expect(m.phantomCount).toBe(0);
    expect(g.left).toBeDefined();
    expect(g.right).toBeDefined();
  });

  it('keeps crossed hands on their true sides when MediaPipe calls both "Right" (3D decides, not screen position)', () => {
    const n = new HandNormalizer({ swapLabels: false });
    for (let k = 0; k <= 8; k++) {
      // The right hand starts on the right of the mirrored view (raw x 0.3); the hands cross over.
      const rx = 0.3 + k * 0.05;
      const lx = 0.7 - k * 0.05;
      const crossing = k >= 3;
      const f = n.process(
        det([
          boxHand('Right', rx, 0.6, { world: 'right', score: crossing ? 0.6 : 0.95 }),
          boxHand(crossing ? 'Right' : 'Left', lx, 0.85, {
            world: 'left',
            score: crossing ? 0.6 : 0.95,
          }),
        ]),
        true,
        k * 50,
      );
      expect(f.right?.rawLandmarks[WRIST]?.x).toBeCloseTo(rx);
      expect(f.left?.rawLandmarks[WRIST]?.x).toBeCloseTo(lx);
    }
    expect(n.takeSwap()).toBe(false);
  });

  it('fixes the lock trap: mid-pinch a wrong side is corrected once the 3D check agrees; the hand keeps its identity and leaves no ghost', () => {
    const n = new HandNormalizer({ swapLabels: false });
    // A left hand that arrives looking like a right one (e.g. a bad first detection).
    const slot = n.process(det([boxHand('Right', 0.3, 0.7, { world: 'right' })]), true, 0).right;
    expect(slot).toBeDefined();
    n.setIdentityLock(true); // the user pinches: something is held
    let renamedAt = -1;
    for (let k = 1; k <= 6 && renamedAt < 0; k++) {
      const f = n.process(det([boxHand('Left', 0.3, 0.7, { world: 'left' })]), true, k * 33);
      if (f.left) renamedAt = k;
    }
    expect(renamedAt).toBeGreaterThan(1); // never on a single frame…
    expect(renamedAt).toBeLessThanOrEqual(4); // …but within a few, even while a gesture holds
    expect(n.frame.left).toBe(slot); // the same hand object: smoothing and identity carried over
    expect(n.frame.right).toBeUndefined(); // no ghost of the old side
    expect(n.takeSwap()).toBe(true); // Core is told once, to move gestures / captures / depth
    expect(n.takeSwap()).toBe(false);
  });

  it('waits to show a newly arrived hand until its side is clear, at most maxNamingWaitMs', () => {
    const n = new HandNormalizer({ swapLabels: false });
    // Arriving edge-on: a weak, wrong label and no usable 3D shape → not shown yet.
    const first = n.process(det([boxHand('Right', 0.3, 0.7, { score: 0.62 })]), true, 0);
    expect(first.right).toBeUndefined();
    expect(n.pendingCount).toBe(1);
    // Next inference it is clearly a left hand → shown straight away, as left.
    const f = n.process(det([boxHand('Left', 0.3, 0.7, { world: 'left' })]), true, 50);
    expect(f.left).toBeDefined();
    expect(f.right).toBeUndefined();
    expect(n.pendingCount).toBe(0);

    // Never any real evidence: shown after the maximum wait, with the best guess.
    const m = new HandNormalizer({ swapLabels: false });
    const faint = (): RawHand => boxHand('Right', 0.3, 0.7, { score: 0.6 });
    const wait = TUNING.handedness.maxNamingWaitMs;
    for (let t = 0; t < wait; t += 50) {
      expect(m.process(det([faint()]), true, t).right).toBeUndefined();
    }
    expect(m.process(det([faint()]), true, wait).right).toBeDefined();
  });
});
