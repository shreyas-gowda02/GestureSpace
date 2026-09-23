import { describe, expect, it } from 'vitest';
import {
  FixturePlaybackSource,
  FixtureRecorder,
  parseFixture,
  type LandmarkFixture,
  type RawDetection,
} from '@/core/input';
import { InferenceStats } from '@/core/renderLoop';
import { makeLandmarkBuffer } from '@/vision/landmarks';

const frame = (timestamp: number, x = 0.5): RawDetection => ({
  timestamp,
  videoWidth: 640,
  videoHeight: 480,
  hands: [
    {
      handedness: 'Left',
      score: 0.9,
      landmarks: makeLandmarkBuffer().map(() => ({ x, y: 0.5, z: 0 })),
    },
  ],
});

const fixture = (timestamps: number[]): LandmarkFixture => ({
  version: 1,
  name: 't',
  recordedAt: '',
  videoWidth: 640,
  videoHeight: 480,
  frames: timestamps.map((t) => frame(t)),
});

describe('FixturePlaybackSource', () => {
  it('emits frames in real time and jumps to the newest when several are due', () => {
    const src = new FixturePlaybackSource(fixture([0, 33, 66, 100]), 1000, false);
    expect(src.poll(1000)?.timestamp).toBe(0);
    expect(src.poll(1010)).toBeNull();
    expect(src.poll(1070)?.timestamp).toBe(66); // 33 and 66 due → newest
    expect(src.poll(1100)?.timestamp).toBe(100);
    expect(src.poll(2000)).toBeNull();
    expect(src.done).toBe(true);
  });

  it('loops', () => {
    const src = new FixturePlaybackSource(fixture([0, 50, 100]), 0, true);
    expect(src.poll(0)?.timestamp).toBe(0);
    expect(src.poll(100)?.timestamp).toBe(100);
    // duration 100 + one average gap (50) → next pass starts at t=150
    expect(src.poll(150)?.timestamp).toBe(0);
    expect(src.done).toBe(false);
  });
});

describe('FixtureRecorder + parseFixture', () => {
  it('records relative timestamps as a deep copy and round-trips through JSON', () => {
    const rec = new FixtureRecorder();
    expect(rec.stop('empty')).toBeNull();

    rec.start();
    const live = frame(5000, 0.25);
    rec.record(live);
    const p = live.hands[0]?.landmarks[0];
    if (p) p.x = 0.99; // the live buffer is reused next frame
    rec.record(frame(5033, 0.3));
    const fx = rec.stop('clip');
    expect(rec.recording).toBe(false);
    expect(fx?.frames.map((f) => f.timestamp)).toEqual([0, 33]);
    expect(fx?.frames[0]?.hands[0]?.landmarks[0]?.x).toBeCloseTo(0.25);

    const parsed = parseFixture(JSON.parse(JSON.stringify(fx)));
    expect(parsed.name).toBe('clip');
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames[1]?.hands[0]?.landmarks).toHaveLength(21);
  });

  it('rejects malformed input', () => {
    expect(() => parseFixture(null)).toThrow();
    expect(() => parseFixture({ version: 2, frames: [] })).toThrow();
    expect(() =>
      parseFixture({
        version: 1,
        videoWidth: 1,
        videoHeight: 1,
        frames: [{ timestamp: 0, hands: [{ handedness: 'Left', score: 1, landmarks: [] }] }],
      }),
    ).toThrow(/21 landmarks/);
  });
});

describe('InferenceStats', () => {
  it('tracks rate and average time', () => {
    const s = new InferenceStats();
    for (let i = 0; i <= 30; i++) s.record(i * (1000 / 30), 10);
    expect(s.fps).toBeCloseTo(30, 0);
    expect(s.avgMs).toBeCloseTo(10);
    expect(s.count).toBe(31);
    s.reset();
    expect(s.count).toBe(0);
    expect(s.fps).toBe(0);
  });
});
