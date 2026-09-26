// Voxel Builder (Phase 5, §13): pure voxel math, the grid + undo commands, the instanced renderer
// and the mode itself driven frame by frame (acceptance criteria §13.9).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { HandSide, Vec3, VoxelUiState } from '@/core/types';
import { CommandHistory } from '@/modes/shared/history';
import { clearCommand, VoxelEdit, VoxelGrid, type VoxelValue } from '@/modes/voxel/VoxelGrid';
import type { VoxelMode } from '@/modes/voxel/VoxelMode';
import { VOXEL_MATERIALS, VoxelRenderer } from '@/modes/voxel/VoxelRenderer';
import {
  inPlaneDistance,
  LayerDial,
  lineCells,
  makeGridHit,
  offsetCell,
  raycastGrid,
  rayPlanePoint,
} from '@/modes/voxel/voxelMath';
import { RaycastCursor } from '@/spatial/CoordinateMapper';
import { INDEX_MCP, INDEX_TIP } from '@/vision/landmarks';
import { ModeRig } from '../fixtures/modeHarness';
import { makeRng } from '../fixtures/syntheticHands';

const SOLID: VoxelValue = { color: 0x21d4d8, material: 'solid' };
const GLASS: VoxelValue = { color: 0xff3dcb, material: 'glass' };
const S = TUNING.voxel.voxelSize;
const cellKey = (c: Vec3): string => `${c.x},${c.y},${c.z}`;

function gridCells(grid: VoxelGrid): string[] {
  const out: string[] = [];
  grid.forEach((k) => out.push(`${grid.keyX(k)},${grid.keyY(k)},${grid.keyZ(k)}`));
  return out.sort();
}

function place(grid: VoxelGrid, cells: readonly Vec3[], value = SOLID): void {
  const edit = new VoxelEdit(grid);
  for (const c of cells) edit.apply(c.x, c.y, c.z, value);
}

// ---------------------------------------------------------------------------------------------
// voxelMath
// ---------------------------------------------------------------------------------------------

describe('voxelMath: line fill (§13.6 step 5)', () => {
  it('every step touches the last cell (26-connected), no repeats, ends exactly at b', () => {
    const rng = makeRng(3);
    const r = (): number => Math.floor(rng() * 21) - 10;
    for (let k = 0; k < 500; k++) {
      const a = { x: r(), y: r(), z: r() };
      const b = { x: r(), y: r(), z: r() };
      const cells: Vec3[] = [];
      const n = lineCells(a, b, (x, y, z) => cells.push({ x, y, z }));
      expect(n).toBe(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)));
      let prev = a;
      for (const c of cells) {
        const d = [c.x - prev.x, c.y - prev.y, c.z - prev.z].map(Math.abs);
        expect(Math.max(...d)).toBe(1);
        prev = c;
      }
      expect(cellKey(cells.at(-1) ?? a)).toBe(cellKey(b));
      expect(new Set(cells.map(cellKey)).size).toBe(cells.length);
    }
  });

  it('straight and diagonal lines are exact', () => {
    const got: string[] = [];
    lineCells({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, (x, y, z) => got.push(`${x},${y},${z}`));
    lineCells({ x: 0, y: 0, z: 0 }, { x: 2, y: -2, z: 2 }, (x, y, z) => got.push(`${x},${y},${z}`));
    expect(got).toEqual(['1,0,0', '2,0,0', '3,0,0', '1,-1,1', '2,-2,2']);
  });
});

const NORMALS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

describe('voxelMath: ray walk + face extrusion (§13.3 mechanism 2)', () => {
  const grid = new VoxelGrid();
  const target = { x: 2, y: -1, z: 3 };
  place(grid, [target]);
  const occupied = (x: number, y: number, z: number): boolean => grid.has(x, y, z);

  it('finds the face you point at and builds on it — all 6 normals, straight and oblique', () => {
    const rng = makeRng(11);
    for (const n of NORMALS) {
      for (let k = 0; k < 20; k++) {
        // A point on that face (not on its edge), approached from outside at an angle.
        const u = (rng() - 0.5) * 0.8;
        const v = (rng() - 0.5) * 0.8;
        const onFace = {
          x: target.x + n.x * 0.5 + (n.x ? 0 : u),
          y: target.y + n.y * 0.5 + (n.y ? 0 : n.x ? u : v),
          z: target.z + n.z * 0.5 + (n.z ? 0 : v),
        };
        const from = new THREE.Vector3(
          onFace.x + n.x * 8 + (rng() - 0.5) * 4 * (1 - Math.abs(n.x)),
          onFace.y + n.y * 8 + (rng() - 0.5) * 4 * (1 - Math.abs(n.y)),
          onFace.z + n.z * 8 + (rng() - 0.5) * 4 * (1 - Math.abs(n.z)),
        );
        const dir = new THREE.Vector3(onFace.x, onFace.y, onFace.z).sub(from).normalize();
        const hit = raycastGrid(from, dir, grid.half, occupied, makeGridHit());
        expect(hit?.cell).toEqual(target);
        expect(hit?.normal).toEqual(n);
        const next = offsetCell(target, n, 1, { x: 0, y: 0, z: 0 });
        expect(next).toEqual({ x: target.x + n.x, y: target.y + n.y, z: target.z + n.z });
      }
    }
  });

  it('misses return null; the nearer of two voxels wins; the world edge stops the walk', () => {
    const g = new VoxelGrid();
    place(g, [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
    ]);
    const occ = (x: number, y: number, z: number): boolean => g.has(x, y, z);
    const down = new THREE.Vector3(0, 0, -1);
    expect(raycastGrid(new THREE.Vector3(0, 0, 30), down, g.half, occ, makeGridHit())?.cell.z).toBe(
      4,
    );
    expect(raycastGrid(new THREE.Vector3(3, 0, 30), down, g.half, occ, makeGridHit())).toBeNull();
    // Starts inside the world, heads out without meeting anything.
    const out = new THREE.Vector3(1, 0.2, 0).normalize();
    expect(raycastGrid(new THREE.Vector3(1, 0, 0), out, g.half, occ, makeGridHit())).toBeNull();
  });

  it('ray ↔ layer plane', () => {
    const p = { x: 0, y: 0, z: 0 };
    const o = { x: 1, y: 2, z: 20 };
    expect(rayPlanePoint(o, { x: 0, y: 0, z: -1 }, 2, 3, p)).toBe(true);
    expect(p).toEqual({ x: 1, y: 2, z: 3 });
    expect(rayPlanePoint(o, { x: 0, y: 0, z: 1 }, 2, 3, p)).toBe(false); // pointing away
    expect(rayPlanePoint(o, { x: 1, y: 0, z: 0 }, 2, 3, p)).toBe(false); // parallel
    expect(inPlaneDistance({ x: 0.7, y: -0.2, z: 9 }, { x: 0, y: 0, z: 0 }, 2)).toBeCloseTo(0.7);
  });
});

describe('voxelMath: layer dial (§13.3 mechanism 4)', () => {
  it('one layer per step of travel; reversing needs a full step back', () => {
    const dial = new LayerDial(0.06);
    dial.start(0);
    expect(dial.update(0.059)).toBe(0);
    expect(dial.update(0.061)).toBe(1);
    expect(dial.update(0.05)).toBe(0); // jitter just behind the step: nothing
    expect(dial.update(0.0)).toBe(-1); // a full step back
    expect(dial.update(0.2)).toBe(3); // a fast sweep counts every step
  });
});

// ---------------------------------------------------------------------------------------------
// Grid + commands
// ---------------------------------------------------------------------------------------------

describe('VoxelGrid + edit commands (§22)', () => {
  it('packs and unpacks every corner of the world; out-of-bounds cells never exist', () => {
    const g = new VoxelGrid();
    const h = g.half;
    for (const x of [-h, 0, h - 1])
      for (const y of [-h, 0, h - 1])
        for (const z of [-h, 0, h - 1]) {
          const k = g.key(x, y, z);
          expect([g.keyX(k), g.keyY(k), g.keyZ(k)]).toEqual([x, y, z]);
        }
    expect(g.inBounds(h, 0, 0)).toBe(false);
    expect(new VoxelEdit(g).apply(0, -h - 1, 0, SOLID)).toBe(false);
    expect(g.count).toBe(0);
  });

  it('a stroke is ONE undo step that restores exactly; touching a cell twice keeps its original', () => {
    const g = new VoxelGrid();
    place(g, [{ x: 5, y: 5, z: 5 }], GLASS); // existing content
    const before = gridCells(g);
    const history = new CommandHistory();
    const edit = new VoxelEdit(g);
    edit.apply(0, 0, 0, SOLID);
    edit.apply(1, 0, 0, SOLID);
    edit.apply(1, 0, 0, null); // placed then erased in the same stroke: a no-op overall
    edit.apply(5, 5, 5, SOLID); // recolour of existing content
    const cmd = edit.commit(history, 'Add voxels');
    expect(cmd?.size).toBe(2);
    expect(g.get(5, 5, 5)).toEqual(SOLID);
    history.undo();
    expect(gridCells(g)).toEqual(before);
    expect(g.get(5, 5, 5)).toEqual(GLASS);
    history.redo();
    expect(gridCells(g)).toEqual(['0,0,0', '5,5,5']);
    expect(new VoxelEdit(g).commit(history, 'nothing')).toBeNull();
  });

  it('revert puts everything back without an undo step; Clear is undoable', () => {
    const g = new VoxelGrid();
    const history = new CommandHistory();
    const edit = new VoxelEdit(g);
    edit.apply(0, 0, 0, SOLID);
    edit.revert();
    expect(g.count).toBe(0);
    place(g, [
      { x: 1, y: 2, z: 3 },
      { x: -4, y: 0, z: 2 },
    ]);
    history.execute(clearCommand(g));
    expect(g.count).toBe(0);
    history.undo();
    expect(gridCells(g)).toEqual(['-4,0,2', '1,2,3']);
  });
});

// ---------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------

/** Instance positions (as cell keys) across all material batches, plus exactness. */
function drawnCells(root: THREE.Object3D): string[] {
  const out: string[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const kind of VOXEL_MATERIALS) {
    const mesh = root.getObjectByName(`Voxels:${kind}`) as THREE.InstancedMesh;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m).divideScalar(S);
      expect(Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z)).toBe(true);
      out.push(`${p.x},${p.y},${p.z}`);
    }
  }
  return out.sort();
}

describe('VoxelRenderer (§13.2)', () => {
  it('mirrors the grid exactly; capacity doubles on overflow; removal and material moves stay exact', () => {
    const root = new THREE.Group();
    const grid = new VoxelGrid();
    const r = new VoxelRenderer(root, grid);
    const rng = makeRng(2);
    const cells: Vec3[] = [];
    for (let i = 0; i < 700; i++) {
      cells.push({
        x: Math.floor(rng() * 32) - 16,
        y: Math.floor(rng() * 32) - 16,
        z: Math.floor(rng() * 32) - 16,
      });
    }
    place(grid, cells);
    expect(r.counts().solid).toBe(grid.count);
    expect(r.capacity('solid')).toBe(1024); // 256 → 512 → 1024
    expect(drawnCells(root)).toEqual(gridCells(grid));

    const edit = new VoxelEdit(grid);
    cells.forEach((c, i) => {
      if (i % 3 === 0) edit.apply(c.x, c.y, c.z, null);
      else if (i % 3 === 1) edit.apply(c.x, c.y, c.z, GLASS);
    });
    r.update(0);
    expect(r.counts().solid + r.counts().glass).toBe(grid.count);
    expect(r.counts().glass).toBeGreaterThan(100);
    expect(drawnCells(root)).toEqual(gridCells(grid));

    r.dispose();
    expect(root.children).toHaveLength(0);
    expect(grid.listener).toBeNull();
  });

  it('the cursor sees voxels through the pick target, with world-space face normals', () => {
    const root = new THREE.Group();
    root.position.set(1, -2, 3);
    root.quaternion.setFromEuler(new THREE.Euler(0.3, -0.5, 0.4));
    root.scale.setScalar(1.5);
    const scene = new THREE.Scene();
    scene.add(root);
    const grid = new VoxelGrid();
    place(grid, [{ x: 0, y: 0, z: 0 }]);
    const r = new VoxelRenderer(root, grid);
    const rig = new ModeRig('panel'); // borrow its camera / coordinate mapper
    const coords = rig.base.coords;
    const cursors = new RaycastCursor(coords);
    cursors.addTarget(r.pickTarget);
    root.updateMatrixWorld(true);
    const face = root.localToWorld(new THREE.Vector3(0, 0, 0.5 * S));
    const s = coords.worldToScreen(face, { x: 0, y: 0 });
    const hand = rig.show('right');
    const lms = hand.landmarks as Vec3[];
    lms[INDEX_TIP] = { x: s.x / 1280, y: s.y / 720, z: 0 };
    lms[INDEX_MCP] = { x: s.x / 1280, y: s.y / 720 + 0.1, z: 0 };
    const hit = cursors.update(rig.frame.hands).right?.hit;
    expect(hit?.kind).toBe('voxel');
    expect(hit?.objectId).toBe('voxels');
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    expect(hit?.normal?.x).toBeCloseTo(n.x);
    expect(hit?.normal?.y).toBeCloseTo(n.y);
    expect(hit?.normal?.z).toBeCloseTo(n.z);
    const p = hit?.point ?? { x: NaN, y: NaN, z: NaN };
    expect(new THREE.Vector3(p.x, p.y, p.z).distanceTo(face)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------------------------
// VoxelMode, frame by frame
// ---------------------------------------------------------------------------------------------

function voxelRig(): { rig: ModeRig; mode: VoxelMode; root: THREE.Object3D } {
  const rig = new ModeRig('voxel');
  const mode = rig.mc.activeMode as VoxelMode;
  const root = rig.base.scene.getObjectByName('Mode:voxel');
  if (!root) throw new Error('voxel root missing');
  rig.show('right');
  return { rig, mode, root };
}

/** Cursor NDC that points at a voxelRoot-local point (cell units). */
function ndcOf(rig: ModeRig, root: THREE.Object3D, x: number, y: number, z: number) {
  root.updateMatrixWorld(true);
  const v = root.localToWorld(new THREE.Vector3(x * S, y * S, z * S)).project(rig.base.camera);
  return { x: v.x, y: v.y };
}

function aimAt(rig: ModeRig, root: THREE.Object3D, p: Vec3, side: HandSide = 'right'): void {
  rig.aim(side, ndcOf(rig, root, p.x, p.y, p.z));
}

/** Pinch at `p`, optionally drag through `path` (one frame each), release. */
function stroke(rig: ModeRig, root: THREE.Object3D, p: Vec3, path: readonly Vec3[] = []): void {
  aimAt(rig, root, p);
  rig.step();
  rig.pinch('right', true);
  rig.step();
  for (const q of path) {
    aimAt(rig, root, q);
    rig.step();
  }
  rig.pinch('right', false);
  rig.step();
}

const lastUi = (rig: ModeRig): VoxelUiState | undefined =>
  rig.ui.filter((u) => u.voxel).at(-1)?.voxel;

describe('VoxelMode: placing and painting (§13.6, §13.9)', () => {
  it('a stationary pinch creates exactly one voxel, even with aim jitter at a cell edge', () => {
    const rng = makeRng(5);
    for (let trial = 0; trial < 20; trial++) {
      const { rig, mode, root } = voxelRig();
      const edge = { x: 0.45, y: -0.48, z: 0 }; // near the corner of four cells
      aimAt(rig, root, edge);
      rig.step();
      rig.pinch('right', true);
      for (let i = 0; i < 90; i++) {
        const j = 0.4; // ±0.4 of a voxel each frame
        aimAt(rig, root, {
          x: edge.x + (rng() - 0.5) * 2 * j,
          y: edge.y + (rng() - 0.5) * 2 * j,
          z: 0,
        });
        rig.step();
      }
      rig.pinch('right', false);
      rig.step();
      expect(mode.grid.count).toBe(1);
      expect(rig.mc.history?.undoLabel).toBe('Add voxels');
      rig.mc.undo();
      expect(mode.grid.count).toBe(0);
    }
  });

  it('hold + move paints a gap-free line on the layer, even at 3 voxels per frame; one undo step', () => {
    const { rig, mode, root } = voxelRig();
    const path: Vec3[] = [];
    for (let x = -3; x <= 6; x += 3) path.push({ x, y: 2, z: 0 });
    path.push({ x: 6, y: 0, z: 0 }, { x: 6, y: -3, z: 0 });
    stroke(rig, root, { x: -6, y: 2, z: 0 }, path);
    const expected: string[] = [];
    for (let x = -6; x <= 6; x++) expected.push(`${x},2,0`);
    for (let y = 1; y >= -3; y--) expected.push(`6,${y},0`);
    expect(gridCells(mode.grid)).toEqual(expected.sort());
    rig.mc.undo();
    expect(mode.grid.count).toBe(0);
    expect(rig.mc.history?.canUndo).toBe(false);
    rig.mc.redo();
    expect(mode.grid.count).toBe(expected.length);
  });

  it('a fast diagonal stroke leaves no gaps (every voxel touches the next)', () => {
    const { rig, mode, root } = voxelRig();
    stroke(rig, root, { x: -8, y: -5, z: 0 }, [
      { x: 0, y: 0, z: 0 },
      { x: 8, y: 5, z: 0 },
    ]);
    const want: string[] = ['-8,-5,0'];
    lineCells({ x: -8, y: -5, z: 0 }, { x: 0, y: 0, z: 0 }, (x, y, z) =>
      want.push(`${x},${y},${z}`),
    );
    lineCells({ x: 0, y: 0, z: 0 }, { x: 8, y: 5, z: 0 }, (x, y, z) => want.push(`${x},${y},${z}`));
    expect(gridCells(mode.grid)).toEqual(want.sort());
  });

  it('pinching a voxel face builds on that face (front, top and side faces are all pickable)', () => {
    const faces: [Vec3, Vec3][] = [
      [
        { x: 0, y: 0, z: 0.5 },
        { x: 0, y: 0, z: 1 },
      ], // front
      [
        { x: 0.1, y: 0.5, z: 0 },
        { x: 0, y: 1, z: 0 },
      ], // top
      [
        { x: 0.5, y: -0.1, z: 0.1 },
        { x: 1, y: 0, z: 0 },
      ], // right side
    ];
    for (const [onFace, expected] of faces) {
      const { rig, mode, root } = voxelRig();
      place(mode.grid, [{ x: 0, y: 0, z: 0 }]);
      stroke(rig, root, onFace);
      expect(mode.grid.count).toBe(2);
      expect(mode.grid.has(expected.x, expected.y, expected.z)).toBe(true);
    }
  });

  it('erase and paint strokes follow the face plane they start on', () => {
    const { rig, mode, root } = voxelRig();
    const row: Vec3[] = [];
    for (let x = -3; x <= 3; x++) row.push({ x, y: 0, z: 0 });
    place(mode.grid, row);
    mode.onAction({ type: 'voxelColor', color: '#ff3dcb' });
    mode.onAction({ type: 'voxelTool', tool: 'paint' });
    stroke(rig, root, { x: -3, y: 0, z: 0.5 }, [
      { x: 0, y: 0, z: 0.5 },
      { x: 3, y: 0, z: 0.5 },
    ]);
    for (const c of row) expect(mode.grid.get(c.x, c.y, c.z)?.color).toBe(0xff3dcb);
    expect(rig.mc.history?.undoLabel).toBe('Recolor voxels');
    mode.onAction({ type: 'toggleErase' });
    stroke(rig, root, { x: 3, y: 0, z: 0.5 }, [
      { x: 0, y: 0, z: 0.5 },
      { x: -3, y: 0, z: 0.5 },
    ]);
    expect(mode.grid.count).toBe(0);
    rig.mc.undo();
    expect(mode.grid.count).toBe(7);
    rig.mc.undo();
    expect(mode.grid.get(0, 0, 0)?.color).toBe(0x21d4d8);
  });
});

describe('VoxelMode: depth (§13.3–13.5)', () => {
  it('push / pull on a face extrudes a column, previewed as a ghost, committed as ONE undo step', () => {
    const { rig, mode, root } = voxelRig();
    place(mode.grid, [{ x: 0, y: 0, z: 0 }]);
    aimAt(rig, root, { x: 0, y: 0, z: 0.5 });
    rig.step();
    rig.pinch('right', true);
    rig.step();
    const g = rig.gestures('right');
    for (let i = 1; i <= 30; i++) {
      g.depthSignal = (0.21 * i) / 30; // pulling the hand toward the camera
      rig.step();
    }
    rig.run(20);
    const ghost = root.getObjectByName('VoxelGhost');
    expect(ghost?.visible).toBe(true);
    expect(ghost?.scale.z).toBe(4);
    rig.pinch('right', false);
    rig.step();
    expect(gridCells(mode.grid)).toEqual(['0,0,0', '0,0,1', '0,0,2', '0,0,3', '0,0,4', '0,0,5']);
    rig.mc.undo();
    expect(gridCells(mode.grid)).toEqual(['0,0,0']);
    expect(rig.mc.history?.canUndo).toBe(false);
  });

  it('erase + pull removes a column going into the structure', () => {
    const { rig, mode, root } = voxelRig();
    place(
      mode.grid,
      [0, 1, 2, 3, 4].map((z) => ({ x: 0, y: 0, z })),
    );
    mode.onAction({ type: 'voxelTool', tool: 'erase' });
    aimAt(rig, root, { x: 0, y: 0, z: 4.5 });
    rig.step();
    rig.pinch('right', true);
    rig.step();
    rig.gestures('right').depthSignal = 0.11;
    rig.run(20);
    rig.pinch('right', false);
    rig.step();
    expect(gridCells(mode.grid)).toEqual(['0,0,0', '0,0,1']);
  });

  it('Depth Lock on: two minutes of drawing with a drifting hand depth never leaves the layer', () => {
    const { rig, mode, root } = voxelRig();
    const rng = makeRng(8);
    const g = rig.gestures('right');
    let depth = 0;
    for (let s = 0; s < 60; s++) {
      // 60 strokes × 2 s = 2 minutes at 60 Hz; the depth estimate random-walks all the while.
      const y = Math.floor(rng() * 11) - 5;
      aimAt(rig, root, { x: -10, y, z: 0 });
      rig.step();
      rig.pinch('right', true);
      for (let i = 0; i < 110; i++) {
        depth = Math.max(-0.6, Math.min(0.6, depth + (rng() - 0.5) * 0.04));
        g.depthSignal = depth;
        aimAt(rig, root, { x: -10 + (20 * i) / 110, y: y + Math.sin(i / 9) * 0.3, z: 0 });
        rig.step();
      }
      rig.pinch('right', false);
      rig.run(9);
      mode.grid.forEach((k) => expect(mode.grid.keyZ(k)).toBe(0));
      expect(mode.grid.count).toBeGreaterThanOrEqual(21);
      rig.mc.clear();
    }
    expect(lastUi(rig)?.layer).toBe(0);
  });

  it('Depth Lock off (experimental): the hand moving closer steps the layer', () => {
    const { rig, root } = voxelRig();
    rig.mc.handleAction({ type: 'depthLock' });
    expect(lastUi(rig)?.depthLock).toBe(false);
    aimAt(rig, root, { x: 0, y: 0, z: 0 });
    rig.step();
    rig.gestures('right').depthSignal = 0.27; // ≈ 2 layer steps (depth.DEPTH_STEP 0.12)
    rig.run(20);
    expect(lastUi(rig)?.layer).toBe(2);
  });

  it('Q / E / buttons step the layer (clamped to the world); new voxels land on it', () => {
    const { rig, mode, root } = voxelRig();
    for (let i = 0; i < 3; i++) rig.mc.handleAction({ type: 'depthUp' });
    expect(lastUi(rig)?.layer).toBe(3);
    stroke(rig, root, { x: 1, y: 1, z: 3 });
    expect(mode.grid.has(1, 1, 3)).toBe(true);
    for (let i = 0; i < 40; i++) rig.mc.handleAction({ type: 'depthDown' });
    expect(lastUi(rig)?.layer).toBe(-TUNING.voxel.worldBounds / 2);
  });

  it('non-dominant pinch + up / down turns the layer like a dial', () => {
    const { rig } = voxelRig();
    rig.show('left', 0.3, 0.6);
    rig.pinch('left', true);
    rig.step();
    const step = TUNING.voxel.LAYER_STEP_DISTANCE;
    for (let i = 1; i <= 20; i++) {
      rig.show('left', 0.3, 0.6 - (3.3 * step * i) / 20); // up 3.3 steps
      rig.step();
    }
    expect(lastUi(rig)?.layer).toBe(3);
    rig.show('left', 0.3, 0.6 - 1.9 * step); // back down a full step (and a bit)
    rig.step();
    rig.pinch('left', false);
    rig.run(8);
    expect(lastUi(rig)?.layer).toBe(2);
    expect(rig.base.capture.count).toBe(0);
  });
});

describe('VoxelMode: two hands, tools, lifecycle', () => {
  it('a quick second pinch turns the first into a two-hand grab: its voxel is undone, the structure moves', () => {
    const { rig, mode, root } = voxelRig();
    rig.show('left', 0.3, 0.5);
    aimAt(rig, root, { x: 0, y: 0, z: 0 });
    rig.step();
    rig.pinch('right', true);
    rig.step();
    expect(mode.grid.count).toBe(1);
    rig.pinch('left', true);
    const two = rig.frame.gestures.twoHand;
    Object.assign(two, {
      active: true,
      justStarted: true,
      cancelFirstHand: 'right',
      distance: 0.4,
    });
    two.center = { x: 0.5, y: 0.5 };
    rig.step();
    expect(mode.grid.count).toBe(0);
    expect(rig.mc.history?.canUndo).toBe(false);
    expect(rig.base.capture.get('twoHand')?.targetId).toBe('voxel-root');
    const before = root.position.clone();
    const tilt = root.quaternion.clone();
    two.center.x = 0.6;
    two.distance = 0.6;
    two.rotation = 0.3;
    rig.run(30);
    expect(root.scale.x).toBeCloseTo(1.5);
    expect(root.position.x).toBeGreaterThan(before.x + 1);
    two.active = false;
    rig.step();
    expect(rig.base.capture.count).toBe(0);
    // The move is one undo step (Phase 6), and so is Reset view.
    expect(rig.mc.history?.undoLabel).toBe('Move structure');
    rig.mc.resetView();
    expect(root.position.length()).toBe(0);
    expect(root.scale.x).toBe(1);
    expect(rig.mc.history?.undoLabel).toBe('Reset view');
    rig.mc.undo();
    expect(root.scale.x).toBeCloseTo(1.5);
    rig.mc.undo();
    expect(root.position.distanceTo(before)).toBeLessThan(1e-9);
    expect(root.quaternion.angleTo(tilt)).toBeLessThan(1e-6);
    expect(root.scale.x).toBe(1);
  });

  it('grid alignment stays exact after 1,000+ placements and many group transforms', () => {
    const { rig, mode, root } = voxelRig();
    const rng = makeRng(21);
    const r = (a: number, b: number): number => a + rng() * (b - a);
    let placed = 0;
    for (let i = 0; i < 3000 && placed < 1100; i++) {
      if (i % 40 === 0) {
        root.position.set(r(-3, 3), r(-2, 2), r(-2, 2));
        root.quaternion.setFromEuler(new THREE.Euler(r(-0.5, 0.5), r(-0.8, 0.8), r(-3, 3)));
        root.scale.setScalar(r(0.6, 1.6));
        rig.mc.handleAction({ type: rng() < 0.5 ? 'depthUp' : 'depthDown' });
      }
      const layer = lastUi(rig)?.layer ?? 0;
      const x = Math.floor(r(-8, 8)) + r(-0.3, 0.3);
      const y = Math.floor(r(-5, 5)) + r(-0.3, 0.3);
      const before = mode.grid.count;
      stroke(rig, root, { x, y, z: layer });
      const added = mode.grid.count - before;
      expect(added).toBeLessThanOrEqual(1);
      placed += added;
    }
    expect(placed).toBeGreaterThanOrEqual(1000);
    rig.step();
    expect(drawnCells(root)).toEqual(gridCells(mode.grid));
  });

  it('keys and tool-panel buttons update the published panel state', () => {
    const { rig, mode } = voxelRig();
    expect(lastUi(rig)).toMatchObject({
      tool: 'build',
      color: '#21d4d8',
      layer: 0,
      depthLock: true,
    });
    mode.onAction({ type: 'toggleErase' });
    mode.onAction({ type: 'voxelMaterial', material: 'emissive' });
    mode.onAction({ type: 'voxelColor', color: '#a6ff3d' });
    expect(mode.onAction({ type: 'voxelColor', color: 'red' })).toBe(false);
    expect(lastUi(rig)).toMatchObject({ tool: 'erase', material: 'emissive', color: '#a6ff3d' });
    expect(mode.onAction({ type: 'filterNext' })).toBe(false);
  });

  it('switching modes or undoing mid-stroke finishes the stroke first; Clear is undoable', () => {
    const { rig, mode, root } = voxelRig();
    aimAt(rig, root, { x: 0, y: 0, z: 0 });
    rig.step();
    rig.pinch('right', true);
    rig.step();
    rig.mc.undo(); // the half-done stroke becomes the step that is undone
    expect(mode.grid.count).toBe(0);
    rig.pinch('right', false);
    rig.step();
    stroke(rig, root, { x: 2, y: 0, z: 0 });
    rig.pinch('right', true);
    aimAt(rig, root, { x: -2, y: 0, z: 0 });
    rig.step();
    rig.mc.switchTo('draw');
    expect(rig.base.capture.count).toBe(0);
    expect(mode.grid.count).toBe(2);
    expect(root.visible).toBe(false);
    rig.mc.switchTo('voxel');
    rig.mc.clear();
    expect(mode.grid.count).toBe(0);
    rig.mc.undo();
    expect(mode.grid.count).toBe(2);
  });

  it('left/right renamed mid-stroke (D42): the renamed hand keeps painting the same stroke', () => {
    const { rig, mode, root } = voxelRig();
    aimAt(rig, root, { x: -3, y: 0, z: 0 });
    rig.step();
    rig.pinch('right', true);
    rig.step();
    // The tracker renames the hand: Core swaps captures + tells the mode; the input moves sides.
    rig.base.capture.swapSides();
    rig.mc.swapSides();
    rig.frame.gestures.left = rig.frame.gestures.right;
    rig.frame.cursors.left = rig.frame.cursors.right;
    rig.frame.hands.left = rig.frame.hands.right;
    rig.hide('right');
    aimAt(rig, root, { x: 3, y: 0, z: 0 }, 'left');
    rig.step();
    rig.pinch('left', false);
    rig.step();
    expect(mode.grid.count).toBe(7);
    rig.mc.undo();
    expect(mode.grid.count).toBe(0);
  });
});
