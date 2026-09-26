// Voxel Builder end to end: synthetic hand recordings through the same per-frame steps Core runs —
// perceptionStep → depth estimators → steady aim cursors (D43) → captures → ModeController — so a
// pinch in the "video" becomes voxels exactly as it would in the app. The two-hand grab (Phase 6)
// is also replayed on the user's real crossing recording.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import { parseFixture } from '@/core/input';
import type { Vec2 } from '@/core/types';
import type { VoxelMode } from '@/modes/voxel/VoxelMode';
import { pipelineRig, VIEW_H } from '../fixtures/modeHarness';
import {
  pinchDragScenario,
  twoHandStretchScenario,
  voxelPullScenario,
} from '../fixtures/syntheticHands';

/** A headless Core running the Voxel Builder. */
function voxelApp() {
  const { base, mc, frame, play } = pipelineRig('voxel');
  const mode = mc.activeMode as VoxelMode;
  const cells = (): { x: number; y: number; z: number }[] => {
    const out: { x: number; y: number; z: number }[] = [];
    mode.grid.forEach((k) =>
      out.push({ x: mode.grid.keyX(k), y: mode.grid.keyY(k), z: mode.grid.keyZ(k) }),
    );
    return out;
  };
  const root = base.scene.getObjectByName('Mode:voxel');
  if (!root) throw new Error('no voxel root');
  const labels: string[] = [];
  const history = mc.history;
  if (history) {
    const push = history.push.bind(history);
    history.push = (cmd) => {
      labels.push(cmd.label);
      push(cmd);
    };
  }
  return { base, mc, frame, mode, root, play, cells, labels };
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
      app.play(pinchDragScenario(jitter, 4), (t) => {
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
    app.play(pinchDragScenario(), (t) => {
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
    app.play(pinchDragScenario());
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

describe('Voxel Builder: two-hand grab (Phase 6, §12)', () => {
  it('both hands pinch and spread: no jump when it starts, the structure grows and turns, one undo step', () => {
    const app = voxelApp();
    const start = app.root.matrixWorld.clone();
    let atGrab: THREE.Matrix4 | null = null;
    let grabs = 0;
    app.play(twoHandStretchScenario(), () => {
      const two = app.frame.gestures.twoHand;
      if (two.justStarted) {
        grabs++;
        atGrab = app.root.matrixWorld.clone();
      }
    });
    expect(grabs).toBe(1);
    expect(atGrab && start.equals(atGrab)).toBe(true); // no jump on engage
    expect(app.root.scale.x).toBeGreaterThan(1.5);
    expect(app.mode.grid.count).toBe(0); // the first hand's pinch left no stray voxel
    expect(app.labels).toEqual(['Move structure']);
    app.mc.undo();
    expect(app.root.matrixWorld.equals(start)).toBe(true);
  });

  it('your real crossing recording: every grab is one undo step, no half-turn flip, no lag', () => {
    const fixture = parseFixture(
      JSON.parse(
        readFileSync(resolve(__dirname, '../fixtures/landmarks/real/both-crossing.json'), 'utf8'),
      ),
    );
    const app = voxelApp();
    const start = app.root.matrixWorld.clone();
    const T = TUNING.twoHand;
    const dt = 1 / 60;
    const scr: Vec2 = { x: 0, y: 0 };
    let prev: { x: number; y: number; q: THREE.Quaternion; s: number } | null = null;
    let worst = { px: 0, turn: 0, size: 0 };
    const grabs: { at: number; q0: THREE.Quaternion; turn: number }[] = [];
    app.play(fixture, (t) => {
      const two = app.frame.gestures.twoHand;
      const root = app.root;
      if (two.justStarted) {
        grabs.push({ at: t, q0: root.quaternion.clone(), turn: 0 });
      }
      const g = grabs.at(-1);
      if (!two.active || !g) {
        prev = null;
        return;
      }
      g.turn = (root.quaternion.angleTo(g.q0) * 180) / Math.PI;
      app.base.coords.worldToScreen(root.position, scr);
      if (prev) {
        worst = {
          px: Math.max(worst.px, Math.hypot(scr.x - prev.x, scr.y - prev.y)),
          turn: Math.max(worst.turn, root.quaternion.angleTo(prev.q)),
          size: Math.max(worst.size, Math.abs(Math.log(root.scale.x / prev.s))),
        };
      }
      prev = { x: scr.x, y: scr.y, q: root.quaternion.clone(), s: root.scale.x };
    });
    expect(grabs).toHaveLength(9);
    expect(app.labels.filter((l) => l === 'Move structure')).toHaveLength(9);
    // 36.6 s: the hands cross while pinching — the hand line turns 161° (the old in-mode transform
    // spun the structure that far); now it barely turns.
    const crossed = grabs.find((g) => Math.abs(g.at - 36_550) < 200);
    expect(crossed?.turn).toBeLessThan(5);
    // The safety limits never held back a real grab (else the structure would trail the hands).
    expect(worst.px).toBeLessThan(T.maxMoveRate * dt * VIEW_H * 0.9);
    expect(worst.turn).toBeLessThan(T.maxTurnRate * dt * 0.9);
    expect(worst.size).toBeLessThan(T.maxScaleRate * dt * 0.9);
    // Undo everything (voxels and moves, interleaved): back exactly where it started.
    while (app.mc.undo());
    expect(app.mode.grid.count).toBe(0);
    expect(app.root.matrixWorld.equals(start)).toBe(true);
  });
});
