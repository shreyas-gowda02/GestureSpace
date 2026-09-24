import { describe, expect, it } from 'vitest';
import {
  FrameGate,
  fillDetection,
  makeDetection,
  makeHandPool,
  type GateVideo,
} from '@/core/input';
import { InferenceStats } from '@/core/renderLoop';
import type { TrackerResult } from '@/vision/HandTracker';
import { makeLandmarkBuffer } from '@/vision/landmarks';
import {
  packResult,
  unpackDetection,
  visionWorkerSupported,
  WIRE_LENGTH,
  WIRE_MAX_HANDS,
} from '@/vision/workerTracker';

/** A MediaPipe-shaped result with `n` hands; hand i's points are offset by i. */
function fakeResult(n: number): TrackerResult {
  const hands = Array.from({ length: n }, (_, i) =>
    makeLandmarkBuffer().map((_, j) => ({
      x: 0.1 * i + j / 100,
      y: 0.5,
      z: -j / 1000,
      visibility: 1,
    })),
  );
  return {
    landmarks: hands,
    worldLandmarks: hands.map((h) => h.map((p) => ({ ...p, x: p.x * 0.1 }))),
    handedness: hands.map((_, i) => [
      { categoryName: i % 2 ? 'Left' : 'Right', displayName: '', score: 0.9 - i / 10, index: 0 },
    ]),
    handednesses: [],
  };
}

describe('fillDetection (main-thread path)', () => {
  it('keeps ALL hands MediaPipe reports (up to numHands = 4), not just the first two', () => {
    const det = makeDetection();
    fillDetection(det, makeHandPool(), fakeResult(4), 100, 1280, 720);
    expect(det.hands).toHaveLength(4);
    expect(det.hands[3]?.landmarks[0]?.x).toBeCloseTo(0.3);
    expect(det.hands[3]?.handedness).toBe('Left');
    expect(det.videoWidth).toBe(1280);
  });
});

describe('worker wire protocol', () => {
  it('round-trips labels, scores, image + world landmarks for every hand', () => {
    const buf = new Float32Array(WIRE_LENGTH);
    const result = fakeResult(WIRE_MAX_HANDS);
    packResult(result, buf);
    const det = unpackDetection(buf, makeDetection(), makeHandPool(), 42, 640, 480);
    expect(det.timestamp).toBe(42);
    expect(det.hands).toHaveLength(WIRE_MAX_HANDS);
    for (let h = 0; h < WIRE_MAX_HANDS; h++) {
      const got = det.hands[h];
      expect(got?.handedness).toBe(h % 2 ? 'Left' : 'Right');
      expect(got?.score).toBeCloseTo(0.9 - h / 10, 5);
      expect(got?.landmarks[20]?.x).toBeCloseTo(result.landmarks[h]?.[20]?.x ?? NaN, 5);
      expect(got?.landmarks[20]?.z).toBeCloseTo(result.landmarks[h]?.[20]?.z ?? NaN, 5);
      expect(got?.worldLandmarks?.[5]?.x).toBeCloseTo(result.worldLandmarks[h]?.[5]?.x ?? NaN, 5);
    }
  });

  it('handles zero hands and reuses the same objects (no allocation per result)', () => {
    const buf = new Float32Array(WIRE_LENGTH);
    const det = makeDetection();
    const pool = makeHandPool();
    packResult(fakeResult(2), buf);
    const a = unpackDetection(buf, det, pool, 1, 640, 480).hands[0];
    packResult(fakeResult(0), buf);
    expect(unpackDetection(buf, det, pool, 2, 640, 480).hands).toHaveLength(0);
    packResult(fakeResult(1), buf);
    expect(unpackDetection(buf, det, pool, 3, 640, 480).hands[0]).toBe(a);
  });

  it('is not available in Node (tests) — Core falls back to the main thread there', () => {
    expect(visionWorkerSupported()).toBe(false);
  });
});

describe('FrameGate', () => {
  const video = (): GateVideo => ({ readyState: 4, videoWidth: 1280, currentTime: 0 });

  it('only runs on NEW camera frames, throttled, with strictly increasing timestamps', () => {
    const v = video();
    const gate = new FrameGate(v, new InferenceStats());
    gate.setRate(30); // interval 33 ms × 0.8 slack
    v.currentTime = 0.033;
    expect(gate.take(1000)).toBe(1000);
    expect(gate.take(1010)).toBeNull(); // throttled
    expect(gate.take(1040)).toBeNull(); // same video frame → never re-run a stale frame
    v.currentTime = 0.066;
    expect(gate.take(1040)).toBe(1040);
    v.currentTime = 0.1;
    expect(gate.take(1040)).toBeNull(); // throttled again
  });

  it('never runs before the video has frames', () => {
    const v = { ...video(), readyState: 1 };
    expect(new FrameGate(v, new InferenceStats()).take(0)).toBeNull();
  });
});
