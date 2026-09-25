// The voxel world's source of truth (§13.2): an occupancy map keyed by packed integer coordinates,
// in voxelRoot-local cells — world transforms never touch it, so the grid stays exact. Plus the
// edits (§22 AddVoxels / RemoveVoxels / RecolorVoxels / Clear): a stroke's changes are applied live
// and recorded, then become ONE undoable command. The renderer mirrors the grid via `listener`.

import { TUNING } from '@/config/tuning';
import type { Command, VoxelMaterial } from '@/core/types';
import type { CommandHistory } from '../shared/history';

/** Immutable, shared between cells (one object per colour + material in use). */
export interface VoxelValue {
  readonly color: number;
  readonly material: VoxelMaterial;
}

export type VoxelListener = (
  key: number,
  before: VoxelValue | null,
  after: VoxelValue | null,
) => void;

export function sameVoxel(a: VoxelValue | null, b: VoxelValue | null): boolean {
  return a === b || (!!a && !!b && a.color === b.color && a.material === b.material);
}

export class VoxelGrid {
  /** Cells per axis; coordinates run −half … half − 1. */
  readonly size: number;
  readonly half: number;
  listener: VoxelListener | null = null;
  private readonly cells = new Map<number, VoxelValue>();

  constructor(size: number = TUNING.voxel.worldBounds) {
    this.size = size;
    this.half = size / 2;
  }

  get count(): number {
    return this.cells.size;
  }

  inBounds(x: number, y: number, z: number): boolean {
    const h = this.half;
    return x >= -h && x < h && y >= -h && y < h && z >= -h && z < h;
  }

  /** Packed key of an in-bounds cell. */
  key(x: number, y: number, z: number): number {
    const n = this.size;
    const h = this.half;
    return ((x + h) * n + (y + h)) * n + (z + h);
  }

  keyX(key: number): number {
    return Math.floor(key / (this.size * this.size)) - this.half;
  }

  keyY(key: number): number {
    return (Math.floor(key / this.size) % this.size) - this.half;
  }

  keyZ(key: number): number {
    return (key % this.size) - this.half;
  }

  has(x: number, y: number, z: number): boolean {
    return this.inBounds(x, y, z) && this.cells.has(this.key(x, y, z));
  }

  get(x: number, y: number, z: number): VoxelValue | null {
    return this.inBounds(x, y, z) ? (this.cells.get(this.key(x, y, z)) ?? null) : null;
  }

  getKey(key: number): VoxelValue | null {
    return this.cells.get(key) ?? null;
  }

  /** Write one cell (null = empty). Returns the previous value. */
  setKey(key: number, value: VoxelValue | null): VoxelValue | null {
    const before = this.cells.get(key) ?? null;
    if (sameVoxel(before, value)) return before;
    if (value) this.cells.set(key, value);
    else this.cells.delete(key);
    this.listener?.(key, before, value);
    return before;
  }

  forEach(fn: (key: number, value: VoxelValue) => void): void {
    this.cells.forEach((value, key) => fn(key, value));
  }
}

export interface VoxelChange {
  key: number;
  before: VoxelValue | null;
  after: VoxelValue | null;
}

/** One undo step: a batch of cell changes (a stroke, an extrusion, a clear). */
export class VoxelEditCommand implements Command {
  readonly label: string;
  private readonly grid: VoxelGrid;
  private readonly changes: readonly VoxelChange[];

  constructor(label: string, grid: VoxelGrid, changes: readonly VoxelChange[]) {
    this.label = label;
    this.grid = grid;
    this.changes = changes;
  }

  get size(): number {
    return this.changes.length;
  }

  do(): void {
    for (const c of this.changes) this.grid.setKey(c.key, c.after);
  }

  undo(): void {
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const c = this.changes[i];
      if (c) this.grid.setKey(c.key, c.before);
    }
  }
}

/** Every voxel → empty, as one undoable command (Clear, §13.7). */
export function clearCommand(grid: VoxelGrid): VoxelEditCommand {
  const changes: VoxelChange[] = [];
  grid.forEach((key, before) => changes.push({ key, before, after: null }));
  return new VoxelEditCommand('Clear voxels', grid, changes);
}

/**
 * Changes made live while a pinch is held (§13.6 steps 4–6): applied to the grid immediately and
 * recorded; on release they become one command. A cell touched twice keeps its original "before".
 */
export class VoxelEdit {
  private readonly grid: VoxelGrid;
  private readonly changes: VoxelChange[] = [];
  private readonly index = new Map<number, number>();

  constructor(grid: VoxelGrid) {
    this.grid = grid;
  }

  /** Cells changed so far. */
  get count(): number {
    return this.changes.length;
  }

  /** Write one cell and record it. Returns true if the cell changed. */
  apply(x: number, y: number, z: number, value: VoxelValue | null): boolean {
    const grid = this.grid;
    if (!grid.inBounds(x, y, z)) return false;
    const key = grid.key(x, y, z);
    const before = grid.setKey(key, value);
    if (sameVoxel(before, value)) return false;
    const i = this.index.get(key);
    if (i === undefined) {
      this.index.set(key, this.changes.length);
      this.changes.push({ key, before, after: value });
    } else {
      const c = this.changes[i];
      if (c) c.after = value;
    }
    return true;
  }

  /** Put every touched cell back (nothing recorded) — e.g. a two-hand grab cancelled the stroke. */
  revert(): void {
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const c = this.changes[i];
      if (c) this.grid.setKey(c.key, c.before);
    }
    this.changes.length = 0;
    this.index.clear();
  }

  /** Record the edit as ONE undo step (skipped if nothing actually changed). */
  commit(history: CommandHistory, label: string): VoxelEditCommand | null {
    const real = this.changes.filter((c) => !sameVoxel(c.before, c.after));
    this.changes.length = 0;
    this.index.clear();
    if (real.length === 0) return null;
    const cmd = new VoxelEditCommand(label, this.grid, real);
    history.push(cmd);
    return cmd;
  }
}
