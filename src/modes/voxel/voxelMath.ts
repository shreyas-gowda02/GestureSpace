// Pure voxel math (§13.3, §13.6) — no Three.js, fully unit-tested. Cells are centred on integers:
// cell c spans [c − ½, c + ½] on each axis, in "cell units" (voxelRoot local ÷ voxelSize).
// The 3D line between two cells (fast strokes leave no gaps), the ray walk through occupied cells
// that yields the hit face (face extrusion), ray ↔ layer plane, and the layer dial.

import type { Vec3 } from '@/core/types';

/** 0 = x, 1 = y, 2 = z. */
export type Axis = 0 | 1 | 2;

export type CellVisitor = (x: number, y: number, z: number) => void;

export function getAxis(v: Vec3, a: Axis): number {
  return a === 0 ? v.x : a === 1 ? v.y : v.z;
}

export function setAxis(v: Vec3, a: Axis, value: number): void {
  if (a === 0) v.x = value;
  else if (a === 1) v.y = value;
  else v.z = value;
}

export function setCell(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function sameCell(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Axis of a unit face normal, e.g. (0, −1, 0) → 1. */
export function normalAxis(n: Vec3): Axis {
  return n.x !== 0 ? 0 : n.y !== 0 ? 1 : 2;
}

/** `c + n × steps` — the cell across a face (steps = 1 is face extrusion, §13.3 mechanism 2). */
export function offsetCell(c: Vec3, n: Vec3, steps: number, out: Vec3): Vec3 {
  return setCell(out, c.x + n.x * steps, c.y + n.y * steps, c.z + n.z * steps);
}

/** The cell containing a point (cell units). `floor(p + ½)` so −0.5 rounds like +0.5. */
export function cellOf(p: number): number {
  return Math.floor(p + 0.5);
}

/**
 * Visit every cell on the 3D line from `a` to `b` (Bresenham, 26-connected): `a` excluded, `b`
 * included. Consecutive cells always touch, so a fast stroke leaves no gaps (§13.6 step 5).
 * Returns the number of cells visited.
 */
export function lineCells(a: Vec3, b: Vec3, visit: CellVisitor): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const dz = Math.abs(b.z - a.z);
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  const sz = Math.sign(b.z - a.z);
  const n = Math.max(dx, dy, dz);
  let x = a.x;
  let y = a.y;
  let z = a.z;
  // One error term per axis against the longest (driving) axis, which steps every time.
  let ex = 2 * dx - n;
  let ey = 2 * dy - n;
  let ez = 2 * dz - n;
  for (let i = 0; i < n; i++) {
    if (ex >= 0) {
      x += sx;
      ex -= 2 * n;
    }
    if (ey >= 0) {
      y += sy;
      ey -= 2 * n;
    }
    if (ez >= 0) {
      z += sz;
      ez -= 2 * n;
    }
    ex += 2 * dx;
    ey += 2 * dy;
    ez += 2 * dz;
    visit(x, y, z);
  }
  return n;
}

/** First occupied cell along a ray and the face it was entered through (unit normal). */
export interface GridHit {
  cell: Vec3;
  normal: Vec3;
  /** Ray parameter of the entry point (cell units if the direction is unit length). */
  t: number;
}

export function makeGridHit(): GridHit {
  return { cell: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, t: 0 };
}

/**
 * Walk a ray through the grid cell by cell (Amanatides–Woo) and return the first occupied cell,
 * with the face normal it entered through — exact, allocation-free, O(cells crossed). Only cells
 * −half … half−1 on each axis exist. Origin `o` and direction `d` are in cell units.
 */
export function raycastGrid(
  o: Vec3,
  d: Vec3,
  half: number,
  occupied: (x: number, y: number, z: number) => boolean,
  out: GridHit,
): GridHit | null {
  // Clip the ray to the world box.
  const lo = -half - 0.5;
  const hi = half - 0.5;
  let t0 = 0;
  let t1 = Infinity;
  let enter: Axis | -1 = -1;
  for (let i = 0; i < 3; i++) {
    const a = i as Axis;
    const oa = getAxis(o, a);
    const da = getAxis(d, a);
    if (Math.abs(da) < 1e-12) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    const tLo = (lo - oa) / da;
    const tHi = (hi - oa) / da;
    const ta = Math.min(tLo, tHi);
    const tb = Math.max(tLo, tHi);
    if (ta > t0) {
      t0 = ta;
      enter = a;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }

  const t = t0 + 1e-9;
  let cx = clampCell(cellOf(o.x + d.x * t), half);
  let cy = clampCell(cellOf(o.y + d.y * t), half);
  let cz = clampCell(cellOf(o.z + d.z * t), half);
  const sx = Math.sign(d.x);
  const sy = Math.sign(d.y);
  const sz = Math.sign(d.z);
  // Ray parameter of the next cell boundary on each axis, and the spacing between boundaries.
  let mx = sx !== 0 ? (cx + 0.5 * sx - o.x) / d.x : Infinity;
  let my = sy !== 0 ? (cy + 0.5 * sy - o.y) / d.y : Infinity;
  let mz = sz !== 0 ? (cz + 0.5 * sz - o.z) / d.z : Infinity;
  const ddx = sx !== 0 ? Math.abs(1 / d.x) : Infinity;
  const ddy = sy !== 0 ? Math.abs(1 / d.y) : Infinity;
  const ddz = sz !== 0 ? Math.abs(1 / d.z) : Infinity;

  // Face we came in through: the box face we entered, or (origin inside the box) the dominant axis.
  let axis: Axis = enter === -1 ? dominantAxis(d) : enter;
  let tHit = t0;
  const maxSteps = half * 6 + 3;
  for (let i = 0; i < maxSteps; i++) {
    if (occupied(cx, cy, cz)) {
      setCell(out.cell, cx, cy, cz);
      setCell(out.normal, 0, 0, 0);
      setAxis(out.normal, axis, -Math.sign(getAxis(d, axis)) || 1);
      out.t = tHit;
      return out;
    }
    if (mx < my && mx < mz) {
      cx += sx;
      tHit = mx;
      mx += ddx;
      axis = 0;
    } else if (my < mz) {
      cy += sy;
      tHit = my;
      my += ddy;
      axis = 1;
    } else {
      cz += sz;
      tHit = mz;
      mz += ddz;
      axis = 2;
    }
    if (tHit > t1 || cx < -half || cx >= half || cy < -half || cy >= half) return null;
    if (cz < -half || cz >= half) return null;
  }
  return null;
}

function clampCell(c: number, half: number): number {
  return Math.min(half - 1, Math.max(-half, c));
}

function dominantAxis(d: Vec3): Axis {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
}

/**
 * Where a ray meets the plane `axis = value` (cell units). Writes the point to `out` and returns
 * true, or false if the ray is parallel to the plane or points away from it.
 */
export function rayPlanePoint(o: Vec3, d: Vec3, axis: Axis, value: number, out: Vec3): boolean {
  const da = getAxis(d, axis);
  if (Math.abs(da) < 1e-9) return false;
  const t = (value - getAxis(o, axis)) / da;
  if (t < 0) return false;
  setCell(out, o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  setAxis(out, axis, value);
  return true;
}

/**
 * Largest distance, along the two in-plane axes, between a point and a cell's centre. A stroke
 * moves on to the next cell only once this exceeds ½ (the cell's edge) plus a margin, so aim
 * jitter at a cell edge never paints back and forth.
 */
export function inPlaneDistance(p: Vec3, c: Vec3, axis: Axis): number {
  const dx = axis === 0 ? 0 : Math.abs(p.x - c.x);
  const dy = axis === 1 ? 0 : Math.abs(p.y - c.y);
  const dz = axis === 2 ? 0 : Math.abs(p.z - c.z);
  return Math.max(dx, dy, dz);
}

/**
 * Vertical pinch travel → layer steps, like a scroll dial (§13.3 mechanism 4): every `step` of
 * travel is one layer. Reversing needs a full step back, so jitter at a boundary never flickers.
 */
export class LayerDial {
  private readonly step: number;
  private anchor = 0;

  constructor(step: number) {
    this.step = step;
  }

  start(position: number): void {
    this.anchor = position;
  }

  /** Whole steps travelled since the last step (positive = position increased). */
  update(position: number): number {
    const n = Math.trunc((position - this.anchor) / this.step) || 0; // never −0
    if (n !== 0) this.anchor += n * this.step;
    return n;
  }
}
