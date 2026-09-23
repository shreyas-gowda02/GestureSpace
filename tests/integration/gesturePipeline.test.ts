// Full perception → gesture pipeline driven by synthetic fixtures, exactly as Core.frame runs it:
// FixturePlaybackSource → HandNormalizer (process / tick) → GestureEngine → identity lock feedback.

import { describe, expect, it } from 'vitest';
import { FixturePlaybackSource, type LandmarkFixture } from '@/core/input';
import type { GestureFrame, HandFrame } from '@/core/types';
import { GestureEngine } from '@/gestures/GestureEngine';
import { HandNormalizer } from '@/vision/handPipeline';
import {
  ASPECT,
  crowdScenario,
  gestureTourScenario,
  pinchScenario,
  twoHandStretchScenario,
} from '../fixtures/syntheticHands';

type Visit = (hands: HandFrame, g: GestureFrame, now: number) => void;

function run(fixture: LandmarkFixture, visit: Visit): void {
  const src = new FixturePlaybackSource(fixture, 0, false);
  const norm = new HandNormalizer();
  const engine = new GestureEngine();
  const end = src.duration + 400; // let grace periods / releases play out
  for (let now = 0; now <= end; now += 1000 / 60) {
    const det = src.poll(now);
    const hands = det ? norm.process(det, true, now) : norm.tick(now);
    const g = engine.update(hands, ASPECT, now);
    norm.setIdentityLock(engine.capturing);
    visit(hands, g, now);
  }
}

const GESTURES = ['pinch', 'grab', 'point', 'openPalm', 'thumbPinky'] as const;

describe('gesture pipeline (synthetic fixtures)', () => {
  for (const jitter of [0, 0.004]) {
    it(`pinch ${jitter ? 'with jitter ' : ''}starts and ends exactly once`, () => {
      const starts: number[] = [];
      let ends = 0;
      run(pinchScenario(jitter, 7), (_h, g) => {
        if (g.right?.pinch.justStarted) starts.push(g.right.pinch.startedAt);
        if (g.right?.pinch.justEnded) ends++;
      });
      expect(starts).toHaveLength(1);
      expect(ends).toBe(1);
      expect(starts[0]).toBeGreaterThan(800);
      expect(starts[0]).toBeLessThan(1100);
    });
  }

  it('the gesture tour triggers each single-hand gesture in order, once', () => {
    const order: string[] = [];
    run(gestureTourScenario(), (_h, g) => {
      for (const name of GESTURES) {
        if (g.right?.[name].justStarted && name !== 'openPalm') order.push(name);
      }
    });
    expect(order).toEqual(['pinch', 'grab', 'point', 'thumbPinky']);
  });

  it('two-hand stretch: one start, no jump, scale and rotation grow, one end', () => {
    let starts = 0;
    let ends = 0;
    let startScale = 0;
    let maxScale = 0;
    let maxRot = 0;
    let cancel: string | null = null;
    run(twoHandStretchScenario(), (_h, g) => {
      const t = g.twoHand;
      if (t.justStarted) {
        starts++;
        startScale = t.scale;
        cancel = t.cancelFirstHand;
      }
      if (t.justEnded) ends++;
      if (t.active) {
        maxScale = Math.max(maxScale, t.scale);
        maxRot = Math.max(maxRot, Math.abs(t.rotation));
      }
    });
    expect(starts).toBe(1);
    expect(ends).toBe(1);
    expect(startScale).toBe(1);
    expect(maxScale).toBeGreaterThan(2);
    expect(maxRot).toBeGreaterThan(0.1);
    expect(cancel).not.toBeNull(); // both pinched together → the first hand's action is cancelled
  });

  it('crowd: only the main user is ever tracked; their left hand leaves and returns', () => {
    const leftSeen: boolean[] = [];
    run(crowdScenario(), (hands, _g, now) => {
      for (const h of [hands.left, hands.right]) if (h) expect(h.palmScale).toBeGreaterThan(0.12);
      if (now > 100 && now < 2900) expect(hands.right).toBeDefined();
      if (now > 200 && now < 3000) leftSeen.push(!!hands.left);
    });
    // present → absent (after the 150 ms grace) → present again
    const changes = leftSeen.filter((v, i) => i > 0 && v !== leftSeen[i - 1]).length;
    expect(changes).toBe(2);
  });
});
