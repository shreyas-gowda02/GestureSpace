// Air Draw end to end: synthetic hand recordings through Core's per-frame steps (pipelineRig), so
// pointing "in the video" becomes a stroke exactly as it would in the app.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core/types';
import type { DrawMode } from '@/modes/draw/DrawMode';
import { pipelineRig } from '../fixtures/modeHarness';
import { INDEX_TIP } from '@/vision/landmarks';
import { pointDrawScenario } from '../fixtures/syntheticHands';

const W = 1280;
const H = 720;

/**
 * Shake (px): the path resampled every 3 px along its length, then the RMS distance of each
 * sample from the midpoint of its neighbours 9 px either side — independent of how densely either
 * path was sampled (a still hold adds many raw samples but no length).
 */
function wiggle(pts: readonly Vec2[]): number {
  const px = pts.map((p) => ({ x: p.x * W, y: p.y * H }));
  const even: { x: number; y: number }[] = [];
  let carry = 0;
  for (let i = 1; i < px.length; i++) {
    const a = px[i - 1];
    const b = px[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = carry; d < len; d += 3) {
      even.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
    }
    carry = len > 0 ? (carry - len) % 3 : carry;
    if (carry < 0) carry += 3;
  }
  let sum = 0;
  let n = 0;
  for (let i = 3; i < even.length - 3; i++) {
    const p = even[i];
    const l = even[i - 3];
    const r = even[i + 3];
    if (!p || !l || !r) continue;
    sum += (p.x - (l.x + r.x) / 2) ** 2 + (p.y - (l.y + r.y) / 2) ** 2;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

function drawApp() {
  const app = pipelineRig('draw');
  const mode = app.mc.activeMode as DrawMode;
  /** The fingertip (60 Hz, incl. predicted frames) while pointing, and where the pen went down. */
  const raw: Vec2[] = [];
  let down: Vec2 | null = null;
  const visit = (): void => {
    const tip = app.frame.hands.right?.landmarks[INDEX_TIP];
    if (!tip || app.frame.gestures.right?.point.phase !== 'active') return;
    down ??= { x: tip.x, y: tip.y };
    raw.push({ x: tip.x, y: tip.y });
  };
  return { ...app, mode, raw, visit, down: () => down };
}

describe('Air Draw end to end (synthetic hands through the full pipeline)', () => {
  it('point, hold, trace, open the hand = one stroke that starts at the fingertip', () => {
    const app = drawApp();
    app.play(pointDrawScenario(), app.visit);
    expect(app.mode.strokeList).toHaveLength(1);
    const s = app.mode.strokeList[0];
    if (!s) return;
    // Holding still adds (almost) nothing; the tracing adds the rest.
    const holdPoints = [];
    for (let i = 0; i < s.count; i++) {
      const d = Math.hypot(
        ((s.points[i * 2] ?? 0) - (s.points[0] ?? 0)) * W,
        ((s.points[i * 2 + 1] ?? 0) - (s.points[1] ?? 0)) * H,
      );
      if (d < 4) holdPoints.push(i);
    }
    expect(holdPoints.length).toBeLessThanOrEqual(2);
    expect(s.count).toBeGreaterThan(20);
    const down = app.down();
    const px = down
      ? Math.hypot(((s.points[0] ?? 0) - down.x) * W, ((s.points[1] ?? 0) - down.y) * H)
      : Infinity;
    expect(px).toBeLessThan(3); // exactly where the pointing fingertip was
    expect(app.mc.history?.undoLabel).toBe('Draw stroke');
  });

  it('with shaky landmarks the stroke is calmer than the fingertip path', () => {
    const app = drawApp();
    app.play(pointDrawScenario(0.003, 9), app.visit);
    const s = app.mode.strokeList[0];
    expect(s).toBeDefined();
    if (!s) return;
    const drawn: Vec2[] = [];
    for (let i = 0; i < s.count; i++)
      drawn.push({ x: s.points[i * 2] ?? 0, y: s.points[i * 2 + 1] ?? 0 });
    const rawShake = wiggle(app.raw);
    const drawnShake = wiggle(drawn);
    // The traced wave curves on its own, so compare against the same hand without jitter.
    const clean = drawApp();
    clean.play(pointDrawScenario(0, 9), clean.visit);
    const c = clean.mode.strokeList[0];
    const cleanPts: Vec2[] = [];
    for (let i = 0; i < (c?.count ?? 0); i++) {
      cleanPts.push({ x: c?.points[i * 2] ?? 0, y: c?.points[i * 2 + 1] ?? 0 });
    }
    const addedToTip = rawShake - wiggle(clean.raw);
    const addedToStroke = drawnShake - wiggle(cleanPts);
    expect(addedToTip).toBeGreaterThan(0.5); // the jitter really shakes the fingertip…
    // …and most of it never reaches the line. Measured 0.79 → 0.18 px.
    expect(addedToStroke).toBeLessThan(addedToTip * 0.35);
  });
});
