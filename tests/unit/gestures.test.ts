import { describe, expect, it } from 'vitest';
import type { TrackedHand, Vec3 } from '@/core/types';
import {
  grabValue,
  openPalmValue,
  pinchGestureValue,
  pinchValue,
  pointValue,
  thumbPinkyValue,
} from '@/gestures/detectors';
import { GestureStateMachine } from '@/gestures/stateMachine';
import { makeTwoHandState, TwoHandTracker } from '@/gestures/twoHand';
import { makeGestureState } from '@/gestures/stateMachine';
import { OneEuroFilter, smoothingToMinCutoff } from '@/vision/smoothing';
import { palmScale } from '@/vision/landmarks';
import { ASPECT, placeHand, POSES, type PoseName } from '../fixtures/syntheticHands';

/** A pose placed like the pipeline would see it (view space = mirrored raw). */
function viewPose(name: PoseName, side: 'right' | 'left' = 'right'): { lms: Vec3[]; palm: number } {
  const raw = placeHand(POSES[name], { side, wristX: 0.3, wristY: 0.7, palm: 0.16 });
  const lms = raw.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
  return { lms, palm: palmScale(lms, ASPECT) };
}

describe('OneEuroFilter', () => {
  it('passes a constant through and settles jitter', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 8, dCutoff: 1 });
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.004); // ±0.01 jitter shrinks a lot
  });

  it('follows fast motion with little lag (beta)', () => {
    const slow = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    const fast = new OneEuroFilter({ minCutoff: 1, beta: 8, dCutoff: 1 });
    let s = 0;
    let q = 0;
    for (let i = 0; i <= 15; i++) {
      const x = i * 0.05; // 1.5 view units per second
      s = slow.filter(x, i * 33);
      q = fast.filter(x, i * 33);
    }
    expect(0.75 - q).toBeLessThan((0.75 - s) / 3);
  });

  it('resets on non-increasing timestamps (fixture loops)', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 8, dCutoff: 1 });
    f.filter(0, 100);
    expect(f.filter(1, 50)).toBe(1);
  });

  it('maps the smoothing slider onto minCutoff (higher = smoother)', () => {
    expect(smoothingToMinCutoff(0)).toBeCloseTo(3.0);
    expect(smoothingToMinCutoff(1)).toBeCloseTo(0.3);
    expect(smoothingToMinCutoff(0.5)).toBeGreaterThan(smoothingToMinCutoff(0.9));
  });
});

describe('GestureStateMachine', () => {
  const make = () =>
    new GestureStateMachine({ start: 0.35, end: 0.5, below: true, candidateMs: 60, releaseMs: 80 });

  it('needs the candidate hold before activating; justStarted fires exactly once', () => {
    const m = make();
    expect(m.update(0.2, 0).phase).toBe('candidate');
    expect(m.update(0.2, 30).phase).toBe('candidate');
    const s = m.update(0.2, 60);
    expect(s.phase).toBe('active');
    expect(s.justStarted).toBe(true);
    expect(s.startedAt).toBe(60);
    expect(m.update(0.2, 70).justStarted).toBe(false);
  });

  it('a blip shorter than the candidate time never activates', () => {
    const m = make();
    m.update(0.2, 0);
    expect(m.update(0.9, 30).phase).toBe('idle');
  });

  it('hysteresis: values between start and end keep it active', () => {
    const m = make();
    m.update(0.2, 0);
    m.update(0.2, 60);
    for (let t = 70; t < 500; t += 10) expect(m.update(0.45, t).phase).toBe('active');
  });

  it('release is debounced; justEnded fires once, then idle', () => {
    const m = make();
    m.update(0.2, 0);
    m.update(0.2, 60);
    expect(m.update(0.9, 100).phase).toBe('active'); // debounce starts
    expect(m.update(0.2, 150).phase).toBe('active'); // came back: debounce cancelled
    m.update(0.9, 200);
    const s = m.update(0.9, 280);
    expect(s.phase).toBe('released');
    expect(s.justEnded).toBe(true);
    expect(m.update(0.9, 290).phase).toBe('idle');
  });

  it('forceRelease ends an active gesture immediately', () => {
    const m = make();
    m.update(0.2, 0);
    m.update(0.2, 60);
    const s = m.forceRelease();
    expect(s.justEnded).toBe(true);
    expect(s.phase).toBe('released');
  });

  it('cooldown blocks a re-trigger (thumb-pinky taps)', () => {
    const m = new GestureStateMachine({
      start: 0.35,
      end: 0.5,
      below: true,
      candidateMs: 0,
      releaseMs: 0,
      cooldownMs: 400,
    });
    expect(m.update(0.1, 0).justStarted).toBe(true);
    m.update(0.9, 50); // released
    m.update(0.9, 60); // idle
    expect(m.update(0.1, 100).phase).toBe('idle'); // within cooldown
    expect(m.update(0.1, 450).justStarted).toBe(true);
  });
});

describe('gesture detectors on synthetic poses', () => {
  const G = { pinchStart: 0.35, grabStart: 0.6 };
  const all = (name: PoseName) => {
    const { lms, palm } = viewPose(name);
    const grab = grabValue(lms, ASPECT, palm);
    return {
      pinch: pinchGestureValue(lms, ASPECT, palm, grab) < G.pinchStart,
      grab: grabValue(lms, ASPECT, palm) < G.grabStart,
      point: pointValue(lms, ASPECT) === 1,
      open: openPalmValue(lms, ASPECT, palm) === 1,
      thumbPinky: thumbPinkyValue(lms, ASPECT, palm) < 0.35,
    };
  };

  it.each([
    ['open', { pinch: false, grab: false, point: false, open: true, thumbPinky: false }],
    ['fist', { pinch: false, grab: true, point: false, open: false, thumbPinky: false }],
    ['point', { pinch: false, grab: false, point: true, open: false, thumbPinky: false }],
    ['pinch', { pinch: true, grab: false, point: false, open: false, thumbPinky: false }],
    ['thumbPinky', { pinch: false, grab: false, point: false, open: false, thumbPinky: true }],
  ] as const)('%s pose → exactly its gesture', (name, expected) => {
    expect(all(name)).toEqual(expected);
  });

  it('a fist is never a pinch, even though its thumb touches the index', () => {
    const { lms, palm } = viewPose('fist');
    expect(pinchValue(lms, ASPECT, palm)).toBeLessThan(0.35); // raw metric says "pinch"…
    expect(pinchGestureValue(lms, ASPECT, palm, grabValue(lms, ASPECT, palm))).toBeGreaterThan(0.5);
  });

  it('works for left hands and is scale-invariant', () => {
    const { lms, palm } = viewPose('pinch', 'left');
    expect(pinchValue(lms, ASPECT, palm)).toBeLessThan(0.35);
    const far = placeHand(POSES.open, { side: 'right', wristX: 0.5, wristY: 0.5, palm: 0.05 });
    const near = placeHand(POSES.open, { side: 'right', wristX: 0.5, wristY: 0.7, palm: 0.25 });
    const v = (l: Vec3[]) => pinchValue(l, ASPECT, palmScale(l, ASPECT));
    expect(v(far)).toBeCloseTo(v(near), 1);
  });
});

describe('TwoHandTracker', () => {
  const hand = (lms: Vec3[]): TrackedHand => ({
    side: 'right',
    score: 1,
    rawLandmarks: lms,
    landmarks: lms,
    triggerLandmarks: lms,
    palmScale: 0.16,
    bbox: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
    lostForMs: 0,
  });
  /** A "hand" whose thumb tip and index tip both sit at (x, y). */
  const at = (x: number, y: number) => hand(Array.from({ length: 21 }, () => ({ x, y, z: 0 })));
  const pinching = (startedAt: number) => ({
    ...makeGestureState(),
    phase: 'active' as const,
    startedAt,
  });

  it('snapshots a baseline on start (no jump) and reports relative scale / rotation', () => {
    const t = new TwoHandTracker();
    const s = t.update(at(0.4, 0.5), pinching(0), at(0.6, 0.5), pinching(100), 1);
    expect(s.justStarted).toBe(true);
    expect(s.scale).toBe(1);
    expect(s.rotation).toBe(0);
    expect(s.cancelFirstHand).toBe('left'); // right joined 100 ms later (< 150 ms)

    const s2 = t.update(at(0.3, 0.5), pinching(0), at(0.7, 0.5), pinching(100), 1);
    expect(s2.justStarted).toBe(false);
    expect(s2.scale).toBeCloseTo(2);
    expect(s2.translation.x).toBeCloseTo(0);

    const s3 = t.update(at(0.4, 0.4), pinching(0), at(0.6, 0.6), pinching(100), 1);
    expect(s3.rotation).toBeCloseTo(Math.PI / 4);
  });

  it('unwraps the angle when the hands cross (no 2π spike)', () => {
    const t = new TwoHandTracker();
    t.update(at(0.4, 0.5), pinching(0), at(0.6, 0.5), pinching(0), 1);
    // Rotate the hand-to-hand vector through ±π in small steps.
    let last = 0;
    for (let k = 1; k <= 24; k++) {
      const a = (k / 24) * 1.2 * Math.PI;
      const s = t.update(
        at(0.5 - 0.1 * Math.cos(a), 0.5 - 0.1 * Math.sin(a)),
        pinching(0),
        at(0.5 + 0.1 * Math.cos(a), 0.5 + 0.1 * Math.sin(a)),
        pinching(0),
        1,
      );
      expect(Math.abs(s.rotation - last)).toBeLessThan(0.3);
      last = s.rotation;
    }
    expect(last).toBeCloseTo(1.2 * Math.PI);
  });

  it('ends when either hand stops pinching or disappears', () => {
    const t = new TwoHandTracker();
    t.update(at(0.4, 0.5), pinching(0), at(0.6, 0.5), pinching(500), 1);
    expect(t.state.cancelFirstHand).toBeNull(); // joined 500 ms later: no cancel
    const s = t.update(at(0.4, 0.5), pinching(0), undefined, undefined, 1);
    expect(s.justEnded).toBe(true);
    expect(s.active).toBe(false);
    expect(makeTwoHandState().scale).toBe(1);
  });
});
