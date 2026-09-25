// Air Draw end to end: synthetic hand recordings through Core's per-frame steps (pipelineRig), so
// a pinch "in the video" becomes a stroke exactly as it would in the app.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core/types';
import type { DrawMode } from '@/modes/draw/DrawMode';
import { pipelineRig } from '../fixtures/modeHarness';
import { pinchDragScenario } from '../fixtures/syntheticHands';

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
  /** The raw pen (cursor) positions while the pinch is held, and when the pinch began. */
  const raw: Vec2[] = [];
  const seen: { t: number; p: Vec2 }[] = [];
  let pinchAt = -1;
  const visit = (t: number): void => {
    const c = app.base.cursors.cursors.right;
    if (!c) return;
    const s = app.base.coords.ndcToScreen(c.ndc, { x: 0, y: 0 });
    const p = app.base.viewport.screenToView(s, { x: 0, y: 0 });
    seen.push({ t, p });
    const pinch = app.frame.gestures.right?.pinch;
    if (pinch?.phase === 'active') {
      if (pinchAt < 0) pinchAt = t;
      raw.push(p);
    }
  };
  return { ...app, mode, raw, seen, visit, pinchAt: () => pinchAt };
}

describe('Air Draw end to end (synthetic hands through the full pipeline)', () => {
  it('pinch, hold, drag, release = one stroke that starts where the cursor was', () => {
    const app = drawApp();
    app.play(pinchDragScenario(), app.visit);
    expect(app.mode.strokeList).toHaveLength(1);
    const s = app.mode.strokeList[0];
    if (!s) return;
    // Holding still adds (almost) nothing; the drag adds the rest.
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
    // The stroke begins where the cursor was shown ~150 ms before the pinch registered (D43).
    const before = app.seen.filter((x) => x.t <= app.pinchAt() - 150).at(-1)?.p;
    const px = before
      ? Math.hypot(((s.points[0] ?? 0) - before.x) * W, ((s.points[1] ?? 0) - before.y) * H)
      : Infinity;
    expect(px).toBeLessThan(12);
    expect(app.mc.history?.undoLabel).toBe('Draw stroke');
  });

  it('with shaky landmarks the stroke is straighter than the raw pen path', () => {
    const app = drawApp();
    app.play(pinchDragScenario(0.003, 9), app.visit);
    const s = app.mode.strokeList[0];
    expect(s).toBeDefined();
    if (!s) return;
    const drawn: Vec2[] = [];
    for (let i = 0; i < s.count; i++)
      drawn.push({ x: s.points[i * 2] ?? 0, y: s.points[i * 2 + 1] ?? 0 });
    const rawShake = wiggle(app.raw);
    const drawnShake = wiggle(drawn);
    expect(rawShake).toBeGreaterThan(0.5); // the input really is shaky…
    // Measured 1.78 → 0.34 px; without the pen filter (point spacing alone) 0.67 px.
    expect(drawnShake).toBeLessThan(rawShake * 0.3); // …and the line is visibly calmer
  });
});
