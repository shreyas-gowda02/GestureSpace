// Replays the committed synthetic two-hand fixture through input → normalizer, exactly as the
// render loop does, and checks the perception output (§25 fixture-driven integration tests).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixturePlaybackSource, parseFixture } from '@/core/input';
import { HandNormalizer } from '@/vision/handPipeline';
import { WRIST } from '@/vision/landmarks';

const fixture = parseFixture(
  JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/landmarks/synthetic-two-hands.json'), 'utf8'),
  ),
);

describe('synthetic two-hand fixture → HandFrame', () => {
  it('tracks both physical hands on the correct side of the mirrored view', () => {
    const src = new FixturePlaybackSource(fixture, 0, false);
    const norm = new HandNormalizer(); // uses the real TUNING handedness setting
    let frames = 0;
    let bothHands = 0;
    // Simulate a 60 Hz render loop over the whole clip.
    for (let now = 0; now <= src.duration + 20; now += 1000 / 60) {
      const det = src.poll(now);
      if (!det) continue;
      frames++;
      const f = norm.process(det, true, now);
      if (f.left && f.right) bothHands++;
      // Physical right hand appears on the RIGHT of the selfie view, left hand on the left.
      expect(f.right?.landmarks[WRIST]?.x ?? 1).toBeGreaterThan(0.5);
      expect(f.left?.landmarks[WRIST]?.x ?? 0).toBeLessThan(0.5);
      expect(f.right?.palmScale).toBeCloseTo(0.16, 2);
    }
    expect(frames).toBe(fixture.frames.length);
    expect(bothHands).toBe(frames);
  });
});
