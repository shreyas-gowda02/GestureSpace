// Air Draw (Phase 8, §15): pen sampling + smoothing, Catmull-Rom curves, the eraser hit test, the
// renderer's resize alignment and cache, and the mode itself driven frame by frame.

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { DrawUiState, HandSide, Vec2 } from '@/core/types';
import type { DrawMode } from '@/modes/draw/DrawMode';
import {
  StrokeBuilder,
  strokeHit,
  StrokeRenderer,
  traceCatmullRom,
  whiten,
  type Canvas2D,
  type Stroke,
} from '@/modes/draw/strokes';
import { ViewportMapper } from '@/spatial/ViewportMapper';
import { ModeRig } from '../fixtures/modeHarness';
import { makeRng } from '../fixtures/syntheticHands';

const D = TUNING.draw;
const ASPECT = 16 / 9;
const LOOK = { color: '#2ef2ff', width: 0.012, glow: false };

/** Feed a builder a path at 60 Hz and finish it. */
function build(path: readonly Vec2[], id = 1): Stroke {
  const b = new StrokeBuilder();
  const first = path[0] ?? { x: 0, y: 0 };
  b.begin(first.x, first.y, 0);
  path.slice(1).forEach((p, i) => b.add(p.x, p.y, (i + 1) * (1000 / 60), ASPECT));
  return b.finish(id, LOOK);
}

const line = (n: number, from: Vec2, to: Vec2): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (n - 1),
    y: from.y + ((to.y - from.y) * i) / (n - 1),
  }));

describe('StrokeBuilder: pen sampling (§15)', () => {
  it('a still pen adds nothing — a pinch without moving is a single dot', () => {
    const s = build(Array.from({ length: 60 }, () => ({ x: 0.4, y: 0.5 })));
    expect(s.count).toBe(1);
    expect([s.points[0], s.points[1]]).toEqual([expect.closeTo(0.4, 6), expect.closeTo(0.5, 6)]);
  });

  it('keeps a point only after MIN_STROKE_STEP (aspect-corrected), and ends where the pen lifted', () => {
    const s = build(line(200, { x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }));
    for (let i = 1; i < s.count - 1; i++) {
      const dx = ((s.points[i * 2] ?? 0) - (s.points[i * 2 - 2] ?? 0)) * ASPECT;
      const dy = (s.points[i * 2 + 1] ?? 0) - (s.points[i * 2 - 1] ?? 0);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(D.MIN_STROKE_STEP * 0.999);
    }
    expect(s.points[(s.count - 1) * 2]).toBeGreaterThan(0.59); // the tail, not the last step
    expect(s.minX).toBeCloseTo(0.2, 5);
    expect(s.maxX).toBeGreaterThan(0.59);
  });

  it('grows past its initial buffer without losing points', () => {
    const n = D.initialPoints * 3;
    const b = new StrokeBuilder();
    b.begin(0, 0, 0);
    for (let i = 1; i < n; i++) b.add(i * 0.01, 0, i * 16, 1); // steady 0.6 units/s to the right
    const s = b.finish(1, LOOK);
    expect(s.count).toBeGreaterThan(D.initialPoints * 2); // the buffer doubled twice
    for (let i = 1; i < s.count; i++) {
      expect(s.points[i * 2]).toBeGreaterThan(s.points[i * 2 - 2] ?? 0); // nothing lost or out of order
    }
    expect(s.points[(s.count - 1) * 2]).toBeGreaterThan((n - 1) * 0.01 - 0.02); // ends near the pen
  });

  it('smooths hand jitter: a shaky straight line comes out straighter', () => {
    const rng = makeRng(4);
    const jitter = 0.004; // ≈ 3 px on a 720 px view, like a shaky real pinch
    const shaky = line(120, { x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }).map((p) => ({
      x: p.x,
      y: p.y + (rng() - 0.5) * 2 * jitter,
    }));
    const s = build(shaky);
    let worst = 0;
    for (let i = 5; i < s.count; i++)
      worst = Math.max(worst, Math.abs((s.points[i * 2 + 1] ?? 0) - 0.5));
    expect(worst).toBeLessThan(jitter * 0.6);
  });

  it('the live stroke reaches the pen (tail past the last kept point)', () => {
    const b = new StrokeBuilder();
    b.begin(0.5, 0.5, 0);
    b.add(0.5005, 0.5, 16, ASPECT); // smaller than a step: not kept…
    expect(b.count).toBe(1);
    expect(b.liveCount()).toBe(2); // …but drawn
    expect(b.points[2]).toBeCloseTo(b.tail.x, 6);
  });
});

describe('Catmull-Rom curve + eraser hit test', () => {
  const recorder = () => {
    const calls: [string, ...number[]][] = [];
    return {
      calls,
      moveTo: (x: number, y: number) => calls.push(['M', x, y]),
      lineTo: (x: number, y: number) => calls.push(['L', x, y]),
      bezierCurveTo: (a: number, b: number, c: number, d: number, x: number, y: number) =>
        calls.push(['C', a, b, c, d, x, y]),
    };
  };
  const identity = (x: number, y: number, out: Vec2): Vec2 => ((out.x = x), (out.y = y), out);

  it('passes through every point; evenly spaced points on a line stay on it', () => {
    const r = recorder();
    const pts = [0, 0, 1, 0, 2, 0, 3, 0];
    traceCatmullRom(r, pts, 4, identity);
    expect(r.calls[0]).toEqual(['M', 0, 0]);
    expect(r.calls.slice(1).map((c) => [c[5], c[6]])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    for (const c of r.calls.slice(1)) {
      expect([c[2], c[4]]).toEqual([0, 0]); // control points on the line…
    }
    expect(r.calls[2]?.[1]).toBeCloseTo(1 + 1 / 3); // …a third of the way along
    const dot = recorder();
    traceCatmullRom(dot, [5, 6], 1, identity);
    expect(dot.calls).toEqual([
      ['M', 5, 6],
      ['L', 5, 6],
    ]);
  });

  it('the eraser touches a stroke within its reach (+ half the line width), not beyond', () => {
    const s = build(line(60, { x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }));
    const reach = D.eraserRadius + s.width / 2;
    expect(strokeHit(s, 0.4, 0.5 + reach * 0.9, ASPECT)).toBe(true);
    expect(strokeHit(s, 0.4, 0.5 + reach * 1.1, ASPECT)).toBe(false);
    const endX = s.points[(s.count - 1) * 2] ?? 0;
    expect(strokeHit(s, endX + (reach * 0.9) / ASPECT, 0.5, ASPECT)).toBe(true); // past the end:
    expect(strokeHit(s, endX + (reach * 1.1) / ASPECT, 0.5, ASPECT)).toBe(false); // x in video heights
    expect(strokeHit(s, 0.9, 0.9, ASPECT)).toBe(false);
    const dot = build([{ x: 0.7, y: 0.2 }]);
    expect(strokeHit(dot, 0.7, 0.2 + reach * 0.5, ASPECT)).toBe(true);
  });

  it('whiten mixes a colour toward white', () => {
    expect(whiten('#000000', 0.5)).toBe('#808080');
    expect(whiten('#ff0000', 1)).toBe('#ffffff');
  });
});

/** A 2D context that records paths and style (enough for the renderer). */
function fakeCanvas() {
  const paths: { style: string; width: number; op: string; alpha: number; points: number[][] }[] =
    [];
  let current: number[][] = [];
  const ctx = {
    strokeStyle: '#000' as string | CanvasGradient | CanvasPattern,
    fillStyle: '#000' as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    beginPath: () => void (current = []),
    moveTo: (x: number, y: number) => void current.push([x, y]),
    lineTo: (x: number, y: number) => void current.push([x, y]),
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) =>
      void current.push([x, y]),
    arc: () => {},
    stroke: () =>
      void paths.push({
        style: String(ctx.strokeStyle),
        width: ctx.lineWidth,
        op: ctx.globalCompositeOperation,
        alpha: ctx.globalAlpha,
        points: current,
      }),
    fill: () => {},
    save: () => {},
    restore: () => {
      ctx.globalCompositeOperation = 'source-over';
    },
    setTransform: () => {},
    clearRect: () => {},
    drawImage: () => {},
    setLineDash: () => {},
  };
  return { ctx: ctx as unknown as Canvas2D, paths };
}

describe('StrokeRenderer', () => {
  const stroke = build(line(30, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }));
  const size = { width: 1280, height: 720, pixelRatio: 1 };

  it('stays glued to the camera image through a resize (view units → screen via the viewport)', () => {
    const vp = new ViewportMapper();
    const r = new StrokeRenderer(() => null); // no offscreen cache: draws directly
    for (const [w, h] of [
      [1280, 720],
      [900, 900], // portrait-ish window: the video is cropped at the sides
    ] as const) {
      vp.update(1280, 720, w, h);
      const { ctx, paths } = fakeCanvas();
      r.drawStrokes(ctx, { width: w, height: h, pixelRatio: 1 }, vp, [stroke], 1);
      const out = { x: 0, y: 0 };
      const first = paths[0]?.points[0];
      vp.viewToScreen({ x: stroke.points[0] ?? 0, y: stroke.points[1] ?? 0 }, out);
      expect(first?.[0]).toBeCloseTo(out.x, 3);
      expect(first?.[1]).toBeCloseTo(out.y, 3);
      expect(paths[0]?.width).toBeCloseTo(stroke.width * 720 * vp.scale, 3); // width scales too
    }
  });

  it('glow = additive see-through halos, the line, then a whiter core (no canvas blur)', () => {
    const vp = new ViewportMapper();
    vp.update(1280, 720, 1280, 720);
    const { ctx, paths } = fakeCanvas();
    new StrokeRenderer(() => null).drawStrokes(ctx, size, vp, [{ ...stroke, glow: true }], 1);
    const w = stroke.width * 720;
    expect(paths.map((p) => [p.op, p.style, +p.width.toFixed(3), p.alpha])).toEqual([
      ...D.glow.layers.map((l) => ['lighter', stroke.color, +(w * l.width).toFixed(3), l.alpha]),
      ['lighter', stroke.color, +w.toFixed(3), 1],
      ['lighter', whiten(stroke.color, D.glow.coreWhite), +(w * D.glow.core).toFixed(3), 1],
    ]);
  });

  it('the cache paints a new stroke on top; erase / undo / resize repaint it', () => {
    const vp = new ViewportMapper();
    vp.update(1280, 720, 1280, 720);
    const cache = fakeCanvas();
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const r = new StrokeRenderer(() => ({ canvas, ctx: cache.ctx }));
    const screen = fakeCanvas();
    const second = { ...stroke, id: 2 };
    r.drawStrokes(screen.ctx, size, vp, [stroke], 1);
    r.drawStrokes(screen.ctx, size, vp, [stroke], 1);
    expect(cache.paths).toHaveLength(1); // painted once, blitted twice
    r.drawStrokes(screen.ctx, size, vp, [stroke, second], 2); // a new stroke: only it is painted
    expect(cache.paths).toHaveLength(2);
    r.drawStrokes(screen.ctx, size, vp, [second], 3); // erased / undone: full repaint
    expect(cache.paths).toHaveLength(3);
    vp.update(1280, 720, 1000, 720); // view resized: full repaint
    r.drawStrokes(screen.ctx, { ...size, width: 1000 }, vp, [second], 3);
    expect(cache.paths).toHaveLength(4);
    expect(canvas.width).toBe(1000);
    expect(screen.paths).toHaveLength(0); // the screen only gets the cached image
  });
});

// ---------------------------------------------------------------------------------------------
// DrawMode, frame by frame
// ---------------------------------------------------------------------------------------------

function drawRig(): { rig: ModeRig; mode: DrawMode } {
  const rig = new ModeRig('draw');
  rig.show('right');
  return { rig, mode: rig.mc.activeMode as DrawMode };
}

/** Put the hand's index fingertip at a view-normalized point. */
function tipAt(rig: ModeRig, p: Vec2, side: HandSide = 'right'): void {
  rig.show(side, p.x, p.y);
}

/** Point at the first point, move the fingertip through the rest (one frame each), lower it. */
function drawPath(rig: ModeRig, path: readonly Vec2[], side: HandSide = 'right'): void {
  const [first, ...rest] = path;
  if (!first) return;
  tipAt(rig, first, side);
  rig.step();
  rig.point(side, true);
  rig.step();
  for (const p of rest) {
    tipAt(rig, p, side);
    rig.step();
  }
  rig.point(side, false);
  rig.step();
}

const lastUi = (rig: ModeRig): DrawUiState | undefined => rig.ui.filter((u) => u.draw).at(-1)?.draw;

describe('DrawMode (§15, point to draw — D48)', () => {
  it('point = pen down at the index fingertip, move = draw, lower = pen up: one stroke, one undo step', () => {
    const { rig, mode } = drawRig();
    drawPath(rig, line(40, { x: 0.3, y: 0.4 }, { x: 0.6, y: 0.5 }));
    const s = mode.strokeList[0];
    expect(mode.strokeList).toHaveLength(1);
    expect(s?.count).toBeGreaterThan(10);
    expect(s?.points[0]).toBeCloseTo(0.3, 3); // view units, exactly where the fingertip was
    expect(s?.points[1]).toBeCloseTo(0.4, 3);
    expect(s?.color).toBe(D.palette[0].hex);
    expect(rig.mc.history?.undoLabel).toBe('Draw stroke');
    rig.mc.undo();
    expect(mode.strokeList).toHaveLength(0);
    rig.mc.redo();
    expect(mode.strokeList).toHaveLength(1);
    expect(lastUi(rig)?.count).toBe(1);
  });

  it('pinching no longer draws', () => {
    const { rig, mode } = drawRig();
    tipAt(rig, { x: 0.3, y: 0.3 });
    rig.step();
    rig.pinch('right', true);
    for (const p of line(20, { x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 })) {
      tipAt(rig, p);
      rig.step();
    }
    rig.pinch('right', false);
    rig.step();
    expect(mode.strokeList).toHaveLength(0);
  });

  it('only real tracker readings go into the stroke, never the predicted in-between positions', () => {
    const { rig, mode } = drawRig();
    tipAt(rig, { x: 0.3, y: 0.5 });
    rig.step();
    rig.point('right', true);
    rig.step();
    for (const p of line(20, { x: 0.3, y: 0.5 }, { x: 0.6, y: 0.5 })) {
      tipAt(rig, { x: p.x + 0.01, y: 0.56 }); // a prediction overshooting a turn…
      rig.step(1000 / 60, false);
      tipAt(rig, p); // …then the real reading
      rig.step();
    }
    rig.point('right', false);
    rig.step();
    const s = mode.strokeList[0];
    let worst = 0;
    for (let i = 0; i < (s?.count ?? 0); i++)
      worst = Math.max(worst, Math.abs((s?.points[i * 2 + 1] ?? 0) - 0.5));
    expect(worst).toBeLessThan(0.001);
  });

  it('the eraser removes the stroke you point at; keep pointing and sweep to remove more, as one step', () => {
    const { rig, mode } = drawRig();
    drawPath(rig, line(20, { x: 0.2, y: 0.3 }, { x: 0.4, y: 0.3 }));
    drawPath(rig, line(20, { x: 0.2, y: 0.6 }, { x: 0.4, y: 0.6 }));
    drawPath(rig, line(20, { x: 0.7, y: 0.3 }, { x: 0.9, y: 0.3 }));
    rig.mc.handleAction({ type: 'toggleErase' });
    expect(lastUi(rig)?.tool).toBe('eraser');
    drawPath(rig, [{ x: 0.3, y: 0.3 }]); // point at the first stroke
    expect(mode.strokeList.map((s) => s.id)).toEqual([2, 3]);
    drawPath(
      rig,
      line(20, { x: 0.3, y: 0.45 }, { x: 0.3, y: 0.65 }).concat(
        line(20, { x: 0.3, y: 0.65 }, { x: 0.8, y: 0.3 }),
      ),
    ); // sweep
    expect(mode.strokeList).toHaveLength(0);
    expect(rig.mc.history?.undoLabel).toBe('Erase strokes');
    rig.mc.undo(); // one step brings both back
    expect(mode.strokeList.map((s) => s.id)).toEqual([2, 3]);
    rig.mc.undo();
    expect(mode.strokeList.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('colour, width and glow apply to new strokes; bad values are refused', () => {
    const { rig, mode } = drawRig();
    rig.mc.handleAction({ type: 'drawColor', color: '#FF2BD6' });
    rig.mc.handleAction({ type: 'drawWidth', width: 2 });
    rig.mc.handleAction({ type: 'drawGlow' });
    expect(rig.mc.handleAction({ type: 'drawWidth', width: 7 })).toBe(false);
    expect(rig.mc.handleAction({ type: 'drawColor', color: 'pink' })).toBe(false);
    drawPath(rig, line(10, { x: 0.3, y: 0.3 }, { x: 0.5, y: 0.3 }));
    expect(mode.strokeList[0]).toMatchObject({
      color: '#ff2bd6',
      width: D.widths[2].size,
      glow: false,
    });
    expect(lastUi(rig)).toMatchObject({ tool: 'pen', color: '#ff2bd6', width: 2, glow: false });
  });

  it('Clear is undoable', () => {
    const { rig, mode } = drawRig();
    drawPath(rig, line(10, { x: 0.3, y: 0.3 }, { x: 0.5, y: 0.3 }));
    drawPath(rig, line(10, { x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }));
    rig.mc.clear();
    expect(mode.strokeList).toHaveLength(0);
    rig.mc.undo();
    expect(mode.strokeList).toHaveLength(2);
  });

  it('no stroke starts while both hands pinch (a two-hand gesture)', () => {
    const { rig, mode } = drawRig();
    tipAt(rig, { x: 0.5, y: 0.5 });
    rig.frame.gestures.twoHand.active = true;
    rig.point('right', true);
    rig.step();
    tipAt(rig, { x: 0.6, y: 0.5 });
    rig.step();
    expect(mode.strokeList).toHaveLength(0);
    expect(rig.base.capture.count).toBe(0);
  });

  it('a lost hand or a mode switch lifts the pen and keeps the stroke', () => {
    const { rig, mode } = drawRig();
    tipAt(rig, { x: 0.3, y: 0.3 });
    rig.step();
    rig.point('right', true);
    rig.step();
    tipAt(rig, { x: 0.4, y: 0.3 });
    rig.step();
    rig.base.capture.release('right', 'lost'); // what Core does when the hand disappears
    expect(mode.strokeList).toHaveLength(1);
    rig.point('right', false);
    rig.step();
    tipAt(rig, { x: 0.3, y: 0.6 });
    rig.step();
    rig.point('right', true);
    rig.step();
    rig.mc.switchTo('voxel');
    expect(mode.strokeList).toHaveLength(2);
    expect(rig.base.capture.count).toBe(0);
  });

  it('left/right renamed mid-stroke (D42): the same stroke continues with the renamed hand', () => {
    const { rig, mode } = drawRig();
    tipAt(rig, { x: 0.3, y: 0.3 });
    rig.step();
    rig.point('right', true);
    rig.step();
    rig.base.capture.swapSides();
    rig.mc.swapSides();
    rig.frame.gestures.left = rig.frame.gestures.right;
    rig.frame.cursors.left = rig.frame.cursors.right;
    rig.frame.hands.left = rig.frame.hands.right;
    rig.hide('right');
    for (const p of line(20, { x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 })) {
      tipAt(rig, p, 'left');
      rig.step();
    }
    rig.point('left', false);
    rig.step();
    expect(mode.strokeList).toHaveLength(1);
    expect(mode.strokeList[0]?.maxX).toBeGreaterThan(0.55);
  });
});

describe('DrawMode: a fist with the other hand is the eraser (D49)', () => {
  /** Two lines to erase: one across y = 0.3, one across y = 0.6. */
  function twoLines(): { rig: ModeRig; mode: DrawMode } {
    const r = drawRig();
    drawPath(r.rig, line(20, { x: 0.2, y: 0.3 }, { x: 0.5, y: 0.3 }));
    drawPath(r.rig, line(20, { x: 0.2, y: 0.6 }, { x: 0.5, y: 0.6 }));
    r.rig.show('left', 0.8, 0.8);
    return r;
  }

  it('while the left hand is a fist, the right fingertip wipes lines away — no pointing needed', () => {
    const { rig, mode } = twoLines();
    tipAt(rig, { x: 0.1, y: 0.45 });
    rig.grab('left', true);
    rig.step();
    expect(mode.strokeList).toHaveLength(2); // nothing under the fingertip yet
    for (const p of line(20, { x: 0.35, y: 0.2 }, { x: 0.35, y: 0.7 })) {
      tipAt(rig, p); // an open right hand, just moving over the lines
      rig.step();
    }
    expect(mode.strokeList).toHaveLength(0);
    rig.grab('left', false);
    rig.run(15);
    expect(rig.mc.history?.undoLabel).toBe('Erase strokes');
    rig.mc.undo(); // the whole wipe is one step
    expect(mode.strokeList).toHaveLength(2);
  });

  it('opening the fist goes back to drawing — after a fresh point, so no stray line starts', () => {
    const { rig, mode } = twoLines();
    rig.grab('left', true);
    rig.point('right', true); // the right finger happens to be out while erasing
    tipAt(rig, { x: 0.1, y: 0.9 });
    rig.step();
    rig.grab('left', false);
    for (const p of line(10, { x: 0.1, y: 0.9 }, { x: 0.3, y: 0.9 })) {
      tipAt(rig, p);
      rig.step();
    }
    expect(mode.strokeList).toHaveLength(2); // still pointing from the erase: no new line
    rig.point('right', false);
    rig.step();
    drawPath(rig, line(10, { x: 0.6, y: 0.9 }, { x: 0.8, y: 0.9 })); // a fresh point draws
    expect(mode.strokeList).toHaveLength(3);
  });

  it('making the fist mid-line keeps the line; it is not erased just because the fingertip is on it', () => {
    const { rig, mode } = drawRig();
    rig.show('left', 0.8, 0.8);
    tipAt(rig, { x: 0.2, y: 0.4 });
    rig.step();
    rig.point('right', true);
    for (const p of line(15, { x: 0.2, y: 0.4 }, { x: 0.5, y: 0.4 })) {
      tipAt(rig, p);
      rig.step();
    }
    rig.grab('left', true);
    rig.step();
    rig.step();
    expect(mode.strokeList).toHaveLength(1); // finished and kept, though the fingertip is on it
    tipAt(rig, { x: 0.5, y: 0.6 }); // off the line…
    rig.step();
    tipAt(rig, { x: 0.35, y: 0.4 }); // …and back onto it: now it goes
    rig.step();
    expect(mode.strokeList).toHaveLength(0);
  });

  it('a fist that flickers for a moment (tracking) neither ends the wipe nor starts a line', () => {
    const { rig, mode } = twoLines();
    tipAt(rig, { x: 0.1, y: 0.45 });
    rig.grab('left', true);
    rig.step();
    tipAt(rig, { x: 0.35, y: 0.3 });
    rig.step(); // first line wiped
    rig.grab('left', false);
    rig.point('right', true);
    rig.run(5); // 83 ms without the fist (grace 150 ms), finger out
    rig.grab('left', true);
    tipAt(rig, { x: 0.35, y: 0.6 });
    rig.step(); // second line wiped, same wipe
    rig.grab('left', false);
    rig.run(15);
    expect(mode.strokeList).toHaveLength(0);
    rig.mc.undo();
    expect(mode.strokeList).toHaveLength(2); // one undo step for both
  });

  it('only the other hand’s fist counts: a right fist does not erase', () => {
    const { rig, mode } = twoLines();
    tipAt(rig, { x: 0.35, y: 0.3 });
    rig.grab('right', true);
    rig.step();
    tipAt(rig, { x: 0.35, y: 0.6 });
    rig.step();
    expect(mode.strokeList).toHaveLength(2);
  });
});
