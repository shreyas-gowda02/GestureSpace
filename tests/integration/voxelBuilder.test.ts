// Voxel Builder end to end: synthetic hand recordings through the same per-frame steps Core runs —
// perceptionStep → depth estimators → steady aim cursors (D43) → captures → ModeController — so a
// pinch in the "video" becomes voxels exactly as it would in the app.

import { describe, expect, it } from 'vitest';
import { FixturePlaybackSource, type LandmarkFixture } from '@/core/input';
import type { HandSide, InteractionFrame } from '@/core/types';
import { GestureEngine, perceptionStep } from '@/gestures/GestureEngine';
import { ModeController } from '@/modes/ModeController';
import { MODE_FACTORIES } from '@/modes/registry';
import type { VoxelMode } from '@/modes/voxel/VoxelMode';
import { DepthEstimator } from '@/spatial/DepthEstimator';
import { HandNormalizer } from '@/vision/handPipeline';
import { baseContext } from '../fixtures/modeHarness';
import { ASPECT, voxelPullScenario, voxelStrokeScenario } from '../fixtures/syntheticHands';

const SIDES: readonly HandSide[] = ['right', 'left'];

/** A headless Core: plays recordings back to back into the Voxel Builder. */
function voxelApp() {
  const base = baseContext();
  const mc = new ModeController(base, MODE_FACTORIES);
  mc.switchTo('voxel');
  const mode = mc.activeMode as VoxelMode;
  const norm = new HandNormalizer();
  const engine = new GestureEngine();
  let depth: Record<HandSide, DepthEstimator> = {
    left: new DepthEstimator(),
    right: new DepthEstimator(),
  };
  const frame: InteractionFrame = {
    timestamp: 0,
    dt: 1 / 60,
    hands: norm.frame,
    gestures: engine.frame,
    cursors: base.cursors.cursors,
    dominant: 'right',
    activeMode: 'voxel',
  };
  let clock = 0;

  function play(fixture: LandmarkFixture, visit?: (t: number) => void): void {
    const start = clock;
    const src = new FixturePlaybackSource(fixture, start, false);
    for (let now = start; now <= start + src.duration + 300; now += 1000 / 60) {
      const holding = base.capture.count > 0;
      if (perceptionStep(norm, engine, src.poll(now), true, ASPECT, now, holding)) {
        depth = { left: depth.right, right: depth.left };
        base.capture.swapSides();
        base.cursors.swapSides();
        mc.swapSides();
      }
      for (const side of SIDES) {
        const d = depth[side].update(norm.frame[side], now);
        const g = engine.frame[side];
        if (g) g.depthSignal = d;
      }
      base.cursors.update(norm.frame, engine.frame);
      for (const side of SIDES) if (!norm.frame[side]) base.capture.release(side, 'lost');
      frame.timestamp = now;
      mc.update(frame);
      visit?.(now - start);
      clock = now;
    }
    clock += 1000;
  }

  const cells = (): { x: number; y: number; z: number }[] => {
    const out: { x: number; y: number; z: number }[] = [];
    mode.grid.forEach((k) =>
      out.push({ x: mode.grid.keyX(k), y: mode.grid.keyY(k), z: mode.grid.keyZ(k) }),
    );
    return out;
  };
  const root = base.scene.getObjectByName('Mode:voxel');
  return { mc, mode, root, play, cells };
}

/** No gaps: every voxel is reachable from the first through touching (26-connected) voxels. */
function connected(cells: readonly { x: number; y: number; z: number }[]): boolean {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const a = cells[queue.pop() ?? 0];
    cells.forEach((b, j) => {
      if (!a || seen.has(j)) return;
      if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z)) === 1) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  return seen.size === cells.length;
}

describe('Voxel Builder end to end (synthetic hands through the full pipeline)', () => {
  for (const jitter of [0, 0.003]) {
    it(`pinch, hold still, drag, release${jitter ? ' (jittery landmarks)' : ''}`, () => {
      const app = voxelApp();
      let duringHold = -1;
      app.play(voxelStrokeScenario(jitter, 4), (t) => {
        if (t > 1350 && t < 1400) duringHold = app.mode.grid.count;
      });
      // A stationary pinch creates exactly one voxel (§13.9)…
      expect(duringHold).toBe(1);
      // …the drag adds a gap-free line on the active layer, and the stroke is one undo step.
      const cells = app.cells();
      expect(cells.length).toBeGreaterThanOrEqual(4);
      for (const c of cells) expect(c.z).toBe(0);
      expect(connected(cells)).toBe(true);
      expect(app.mc.history?.undoLabel).toBe('Add voxels');
      app.mc.undo();
      expect(app.mode.grid.count).toBe(0);
    });
  }

  it('the voxel lands where the ghost showed it just before the pinch (steady aim, D43)', () => {
    const app = voxelApp();
    const ghost = app.root?.getObjectByName('VoxelGhost');
    const shown: { t: number; cell: string }[] = [];
    let pinchAt = -1;
    let first = '';
    app.play(voxelStrokeScenario(), (t) => {
      if (ghost?.visible) {
        const p = ghost.position;
        shown.push({ t, cell: `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}` });
      }
      if (pinchAt < 0 && app.mode.grid.count > 0) {
        pinchAt = t;
        const c = app.cells()[0];
        first = c ? `${c.x},${c.y},${c.z}` : '';
      }
    });
    // What the user saw ~150 ms before the pinch registered (their reaction time).
    const seen = shown.filter((s) => s.t <= pinchAt - 150).at(-1);
    expect(seen?.cell).toBe(first);
  });

  it('pinch the first voxel’s face and pull the hand closer: a column grows toward the camera', () => {
    const app = voxelApp();
    app.play(voxelStrokeScenario());
    const row = app.mode.grid.count;
    const first = app.cells().sort((a, b) => a.x - b.x)[0];
    app.play(voxelPullScenario());
    const column = app.cells().filter((c) => c.x === first?.x && c.y === first.y && c.z > 0);
    expect(column.length).toBeGreaterThanOrEqual(3);
    expect(app.mode.grid.count).toBe(row + column.length);
    column.sort((a, b) => a.z - b.z).forEach((c, i) => expect(c.z).toBe(i + 1));
    app.mc.undo(); // the whole extrusion is one step
    expect(app.mode.grid.count).toBe(row);
  });
});
