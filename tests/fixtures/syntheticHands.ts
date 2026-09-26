// Synthetic hand generator: realistic-shaped hand poses placed in the RAW (un-mirrored) camera
// image, assembled into scenarios in the exact LandmarkFixture format FixtureRecorder produces.
// Used by unit/integration tests (in memory) and by `node scripts/make-fixtures.ts`.
// Pure TS with type-only imports so Node can run it directly (type stripping).
//
// Label convention (verified on a real webcam, D16): MediaPipe labels the PHYSICAL hand, so a
// physical right hand is labelled "Right". In the raw image the user's right hand sits at LOW x
// (it shows on the right of the mirrored view) with the thumb pointing toward +x.

import type { LandmarkFixture, RawDetection, RawHand } from '../../src/core/input.ts';
import type { Vec3 } from '../../src/core/types.ts';

type P2 = readonly [number, number];
export type PoseName = 'open' | 'fist' | 'point' | 'pinch' | 'thumbPinky';
export type Side = 'right' | 'left';

export const VIDEO_W = 1280;
export const VIDEO_H = 720;
export const ASPECT = VIDEO_W / VIDEO_H;

// Physical RIGHT hand, palm to camera, fingers up, raw image. Units: palm lengths
// (wrist → middle MCP = 1), y down. Order: wrist, thumb×4, index×4, middle×4, ring×4, pinky×4.
const WRIST: P2 = [0, 0];
const THUMB_OPEN: P2[] = [[0.25, -0.15], [0.45, -0.35], [0.6, -0.55], [0.72, -0.72]];
const THUMB_TUCKED: P2[] = [[0.25, -0.15], [0.4, -0.35], [0.35, -0.55], [0.15, -0.65]];
const INDEX_OPEN: P2[] = [[0.28, -0.95], [0.32, -1.3], [0.34, -1.52], [0.36, -1.72]];
const INDEX_CURLED: P2[] = [[0.28, -0.95], [0.35, -1.2], [0.25, -1.05], [0.2, -0.85]];
const MIDDLE_OPEN: P2[] = [[0, -1.0], [0, -1.4], [0, -1.65], [0, -1.88]];
const MIDDLE_CURLED: P2[] = [[0, -1.0], [0.05, -1.25], [0, -1.08], [-0.02, -0.88]];
const RING_OPEN: P2[] = [[-0.22, -0.93], [-0.26, -1.28], [-0.28, -1.5], [-0.3, -1.68]];
const RING_CURLED: P2[] = [[-0.22, -0.93], [-0.2, -1.15], [-0.2, -1.0], [-0.2, -0.82]];
const PINKY_OPEN: P2[] = [[-0.42, -0.82], [-0.5, -1.08], [-0.55, -1.25], [-0.58, -1.4]];
const PINKY_CURLED: P2[] = [[-0.42, -0.82], [-0.42, -1.0], [-0.4, -0.9], [-0.38, -0.75]];

const build = (...parts: (P2 | P2[])[]): P2[] =>
  parts.flatMap((p) => (Array.isArray(p[0]) ? (p as P2[]) : [p as P2]));

export const POSES: Record<PoseName, readonly P2[]> = {
  open: build(WRIST, THUMB_OPEN, INDEX_OPEN, MIDDLE_OPEN, RING_OPEN, PINKY_OPEN),
  fist: build(WRIST, THUMB_TUCKED, INDEX_CURLED, MIDDLE_CURLED, RING_CURLED, PINKY_CURLED),
  point: build(WRIST, THUMB_TUCKED, INDEX_OPEN, MIDDLE_CURLED, RING_CURLED, PINKY_CURLED),
  pinch: build(
    WRIST,
    [[0.25, -0.15], [0.45, -0.4], [0.55, -0.65], [0.5, -0.95]],
    [[0.28, -0.95], [0.4, -1.25], [0.5, -1.15], [0.52, -1.0]],
    MIDDLE_OPEN,
    RING_OPEN,
    PINKY_OPEN,
  ),
  thumbPinky: build(
    WRIST,
    [[0.25, -0.15], [0.3, -0.4], [0.0, -0.75], [-0.5, -1.3]],
    INDEX_OPEN,
    MIDDLE_OPEN,
    RING_OPEN,
    [[-0.42, -0.82], [-0.5, -1.05], [-0.5, -1.2], [-0.47, -1.3]],
  ),
};

export function blendPose(a: readonly P2[], b: readonly P2[], t: number): P2[] {
  return a.map(([ax, ay], i) => {
    const [bx, by] = b[i] ?? [ax, ay];
    return [ax + (bx - ax) * t, ay + (by - ay) * t] as const;
  });
}

/** Pose at time `t` from keyframes [[time, pose], …], blending over `transition` seconds. */
export function poseAt(t: number, keys: readonly (readonly [number, PoseName])[], transition = 0.15): P2[] {
  let prev: PoseName = keys[0]?.[1] ?? 'open';
  for (const [kt, name] of keys) {
    if (t < kt) break;
    if (t < kt + transition) return blendPose(POSES[prev], POSES[name], (t - kt) / transition);
    prev = name;
  }
  return [...POSES[prev]];
}

/** Deterministic PRNG (mulberry32) so jittery fixtures are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Placement {
  side: Side;
  /** Wrist position in the RAW image (0..1). */
  wristX: number;
  wristY: number;
  /** Palm length in video heights (≈0.16 at arm's length, smaller further away). */
  palm: number;
  /** Radians, rotation around the wrist. */
  angle?: number;
  /** Per-landmark noise amplitude (view units). */
  jitter?: number;
  rng?: () => number;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Place a pose in the raw image. Left hands are the mirror image of the right-hand template. */
export function placeHand(pose: readonly P2[], p: Placement): Vec3[] {
  const c = Math.cos(p.angle ?? 0);
  const s = Math.sin(p.angle ?? 0);
  const noise = (): number => (p.jitter && p.rng ? (p.rng() - 0.5) * 2 * p.jitter : 0);
  return pose.map(([tx, ty]) => {
    const x = (p.side === 'right' ? tx : -tx) * p.palm;
    const y = ty * p.palm;
    return {
      x: r4(p.wristX + (x * c - y * s) / ASPECT + noise()),
      y: r4(p.wristY + (x * s + y * c) + noise()),
      z: r4(-0.03 * Math.hypot(tx, ty)),
    };
  });
}

export function rawHand(side: Side, landmarks: Vec3[], score = 0.95): RawHand {
  return { handedness: side === 'right' ? 'Right' : 'Left', score, landmarks };
}

export function makeFixture(name: string, frames: RawDetection[]): LandmarkFixture {
  return {
    version: 1,
    name,
    recordedAt: '2026-09-24T00:00:00.000Z',
    videoWidth: VIDEO_W,
    videoHeight: VIDEO_H,
    frames,
  };
}

function scenario(
  name: string,
  seconds: number,
  fps: number,
  handsAt: (t: number) => RawHand[],
): LandmarkFixture {
  const frames: RawDetection[] = [];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const t = i / fps;
    frames.push({
      timestamp: Math.round((i * 1000) / fps),
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      hands: handsAt(t),
    });
  }
  return makeFixture(name, frames);
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

/** Two open hands gently waving (the Debug panel demo). */
export function waveScenario(): LandmarkFixture {
  return scenario('synthetic-two-hands', 4, 30, (t) => {
    const wave = Math.sin((2 * Math.PI * t) / 2);
    return [
      rawHand('right', placeHand(POSES.open, { side: 'right', wristX: 0.3 + 0.03 * wave, wristY: 0.72, palm: 0.16, angle: 0.25 * wave })),
      rawHand('left', placeHand(POSES.open, { side: 'left', wristX: 0.7 - 0.03 * wave, wristY: 0.72, palm: 0.16, angle: -0.25 * wave })),
    ];
  });
}

/** Right hand: open → pinch (0.8 s) → open (1.8 s). Optional per-landmark jitter. */
export function pinchScenario(jitter = 0, seed = 1): LandmarkFixture {
  const rng = makeRng(seed);
  return scenario(`pinch${jitter ? '-jittery' : ''}`, 3, 30, (t) => [
    rawHand('right', placeHand(poseAt(t, [[0, 'open'], [0.8, 'pinch'], [1.8, 'open']]), {
      side: 'right', wristX: 0.3, wristY: 0.7, palm: 0.16, jitter, rng,
    })),
  ]);
}

const ramp = (t: number, from: number, seconds: number): number =>
  Math.min(1, Math.max(0, (t - from) / seconds));

/**
 * Pinch + drag (Voxel Builder, Air Draw): right hand pinches (0.6 s), holds still (to 1.4 s),
 * drags right and a little up while pinched (1.4–2.6 s), releases (3.0 s). Optional jitter.
 */
export function pinchDragScenario(jitter = 0, seed = 1): LandmarkFixture {
  const rng = makeRng(seed);
  return scenario(`pinch-drag${jitter ? '-jittery' : ''}`, 3.6, 30, (t) => {
    const k = ramp(t, 1.4, 1.2);
    return [
      rawHand('right', placeHand(poseAt(t, [[0, 'open'], [0.6, 'pinch'], [3.0, 'open']]), {
        side: 'right', wristX: 0.42 - 0.16 * k, wristY: 0.78 - 0.04 * k, palm: 0.16, jitter, rng,
      })),
    ];
  });
}

/**
 * Air Draw: right hand points (index out, 0.6 s), holds still (to 1.2 s), then the fingertip
 * traces a wave to the right (1.2–2.8 s), and the hand opens (3.2 s). Optional jitter.
 */
export function pointDrawScenario(jitter = 0, seed = 1): LandmarkFixture {
  const rng = makeRng(seed);
  return scenario(`point-draw${jitter ? '-jittery' : ''}`, 3.8, 30, (t) => {
    const k = ramp(t, 1.2, 1.6);
    return [
      rawHand('right', placeHand(poseAt(t, [[0, 'open'], [0.6, 'point'], [3.2, 'open']]), {
        side: 'right', wristX: 0.45 - 0.2 * k, wristY: 0.8 + 0.05 * Math.sin(k * Math.PI * 2), palm: 0.16, jitter, rng,
      })),
    ];
  });
}

/**
 * Voxel Builder push / pull: right hand pinches (0.6 s) where pinchDragScenario starts, then
 * pulls toward the camera (palm ×1.4 over 1.2–2.2 s) keeping its pinch on the same spot — the hand
 * grows around the pinched fingertips, as when you reach toward something — releases (2.8 s).
 */
export function voxelPullScenario(): LandmarkFixture {
  const [tx, ty] = POSES.pinch[8] ?? [0, 0]; // index tip, palm units from the wrist
  const palm0 = 0.16;
  const tipX = 0.42 + (tx * palm0) / ASPECT;
  const tipY = 0.78 + ty * palm0;
  return scenario('voxel-pull', 3.4, 30, (t) => {
    const palm = palm0 * (1 + 0.4 * ramp(t, 1.2, 1.0));
    return [
      rawHand('right', placeHand(poseAt(t, [[0, 'open'], [0.6, 'pinch'], [2.8, 'open']]), {
        side: 'right', wristX: tipX - (tx * palm) / ASPECT, wristY: tipY - ty * palm, palm,
      })),
    ];
  });
}

/**
 * Voxel Builder 3D turn: right hand makes a fist (0.6 s), holds still (to 1.0 s), moves right and
 * down in the view (1.0–2.2 s), opens (2.6 s).
 */
export function fistTurnScenario(): LandmarkFixture {
  return scenario('fist-turn', 3.2, 30, (t) => {
    const k = ramp(t, 1.0, 1.2);
    return [
      rawHand('right', placeHand(poseAt(t, [[0, 'open'], [0.6, 'fist'], [2.6, 'open']]), {
        side: 'right', wristX: 0.4 - 0.12 * k, wristY: 0.7 + 0.08 * k, palm: 0.16,
      })),
    ];
  });
}

/** Right hand cycles every single-hand gesture (for detector + status tests / demos). */
export function gestureTourScenario(): LandmarkFixture {
  const keys = [
    [0, 'open'], [0.6, 'pinch'], [1.4, 'open'], [2.0, 'fist'], [2.8, 'open'],
    [3.4, 'point'], [4.2, 'open'], [4.8, 'thumbPinky'], [5.4, 'open'],
  ] as const;
  return scenario('gesture-tour', 6, 30, (t) => [
    rawHand('right', placeHand(poseAt(t, keys), { side: 'right', wristX: 0.3, wristY: 0.7, palm: 0.16 })),
  ]);
}

/** Both hands pinch at 0.5 s, spread apart and tilt (1.0–2.5 s), release at 3.2 s. */
export function twoHandStretchScenario(): LandmarkFixture {
  return scenario('two-hand-stretch', 4, 30, (t) => {
    const pose = poseAt(t, [[0, 'open'], [0.5, 'pinch'], [3.2, 'open']]);
    const k = Math.min(1, Math.max(0, (t - 1.0) / 1.5)); // 0 → 1 during the stretch
    return [
      // Physical right hand: low raw x (right of the mirrored view); moves further right + down.
      rawHand('right', placeHand(pose, { side: 'right', wristX: 0.4 - 0.15 * k, wristY: 0.7 + 0.08 * k, palm: 0.16 })),
      rawHand('left', placeHand(pose, { side: 'left', wristX: 0.6 + 0.15 * k, wristY: 0.7 - 0.08 * k, palm: 0.16 })),
    ];
  });
}

/**
 * Main user (close, palm 0.16) plus a background person (far, palm 0.07). The background hands
 * are listed FIRST (MediaPipe's order is arbitrary). The main user's left hand leaves 1.0–2.0 s.
 */
export function crowdScenario(): LandmarkFixture {
  return scenario('crowd', 3, 30, (t) => {
    const hands: RawHand[] = [
      rawHand('right', placeHand(POSES.open, { side: 'right', wristX: 0.12, wristY: 0.4, palm: 0.07 })),
      rawHand('left', placeHand(POSES.open, { side: 'left', wristX: 0.88, wristY: 0.4, palm: 0.07 })),
      rawHand('right', placeHand(POSES.open, { side: 'right', wristX: 0.35, wristY: 0.75, palm: 0.16 })),
    ];
    if (t < 1.0 || t >= 2.0) {
      hands.push(rawHand('left', placeHand(POSES.open, { side: 'left', wristX: 0.65, wristY: 0.75, palm: 0.16 })));
    }
    return hands;
  });
}
