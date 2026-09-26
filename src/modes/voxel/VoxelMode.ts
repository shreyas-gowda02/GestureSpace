// Experience 1 — Voxel Builder (§13): build blocks in the air with a pinch, in true 3D.
//  • Pinch places on the active depth layer (the faint grid), or on the face you point at (face
//    extrusion). Hold and move to paint: gap-free line fill, kept on the stroke's plane.
//  • Pinch a face and push / pull the hand to extrude a column — one undo step.
//  • Depth changes only on purpose (Depth Lock, on by default): non-dominant pinch + up/down,
//    Q / E, ±Z buttons. Unlocked (experimental), the dominant hand's depth picks the layer.
//  • Build / Erase / Paint, 8 colours, solid / glass / glow; two-hand pinch moves, turns and scales
//    the whole structure (TwoHandTransform, one undo step) — the grid stays in local integer cells,
//    so alignment is always exact.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type {
  HandGestures,
  HandSide,
  InteractionFrame,
  SceneCursor,
  Vec2,
  Vec3,
  VoxelMaterial,
  VoxelTool,
  VoxelUiState,
} from '@/core/types';
import { singleHandPinchAllowed } from '@/gestures/GestureEngine';
import { pinchPointInto } from '@/gestures/twoHand';
import { StepQuantizer } from '@/spatial/DepthEstimator';
import { clamp } from '@/utils/math';
import {
  applyPose,
  makePose,
  readPose,
  samePose,
  transformCommand,
  TwoHandTransform,
} from '../shared/TwoHandTransform';
import type { ModeAction, ModeContext, SpatialMode } from '../types';
import { clearCommand, VoxelEdit, VoxelGrid, type VoxelValue } from './VoxelGrid';
import { VoxelRenderer } from './VoxelRenderer';
import {
  cellOf,
  getAxis,
  inPlaneDistance,
  LayerDial,
  lineCells,
  makeGridHit,
  normalAxis,
  offsetCell,
  rayPlanePoint,
  raycastGrid,
  sameCell,
  setAxis,
  setCell,
  type Axis,
  type CellVisitor,
} from './voxelMath';

const V = TUNING.voxel;
const STROKE_ID = 'voxel-stroke';
const DIAL_ID = 'voxel-layer-dial';
const ROOT_ID = 'voxel-root';

const LABEL: Record<VoxelTool, string> = {
  build: 'Add voxels',
  erase: 'Remove voxels',
  paint: 'Recolor voxels',
};
const IDLE_HINT: Record<VoxelTool, string> = {
  build: 'Build — pinch to place, hold and move to paint',
  erase: 'Erase — pinch a voxel to remove it',
  paint: 'Paint — pinch a voxel to recolour it',
};
const STROKE_TEXT: Record<VoxelTool, string> = {
  build: 'Building — release to finish (push / pull on a face to extrude)',
  erase: 'Erasing — release to finish',
  paint: 'Painting — release to finish',
};

const VIEW_POSE = makePose();
VIEW_POSE.quaternion.setFromEuler(new THREE.Euler(V.defaultView.tiltX, V.defaultView.turnY, 0));

const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');
const hexString = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
export const layerLabel = (z: number): string => (z > 0 ? `+${z}` : `${z}`);
const vec3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

/** One held pinch of the building hand, from pinch to release = one undo step. */
interface Stroke {
  side: HandSide;
  tool: VoxelTool;
  /** What the stroke writes: the current voxel (build / paint) or empty (erase). */
  value: VoxelValue | null;
  edit: VoxelEdit;
  /** The stroke paints on the plane of cells whose `axis` coordinate is `lock`… */
  locked: boolean;
  axis: Axis;
  lock: number;
  /** …which is a voxel face's plane if it began on a face (push / pull possible). */
  onFace: boolean;
  normal: Vec3;
  /** First cell written, and the last cell painted. */
  anchor: Vec3;
  last: Vec3;
  kind: 'pending' | 'paint' | 'extrude';
  depthBase: number;
  depth: StepQuantizer;
  /** Faces turned away from the camera grow when you push instead of pull. */
  pushGrows: boolean;
  extrude: number;
}

export class VoxelMode implements SpatialMode {
  readonly id = 'voxel' as const;
  readonly grid = new VoxelGrid();
  private ctx: ModeContext | null = null;
  private root: THREE.Group | null = null;
  private renderer: VoxelRenderer | null = null;

  private tool: VoxelTool = 'build';
  private color = parseInt(V.defaultColor.slice(1), 16);
  private material: VoxelMaterial = 'solid';
  private current: VoxelValue = { color: this.color, material: this.material };
  private layer = 0;
  private depthLock = true;

  private stroke: Stroke | null = null;
  private dial: { side: HandSide; baseLayer: number } | null = null;
  private readonly dialer = new LayerDial(V.LAYER_STEP_DISTANCE);
  /** Two-hand pinch: moves / turns / scales the whole structure (voxelRoot). */
  private transform: TwoHandTransform | null = null;
  /** Depth Lock off: dominant-hand depth → layer, relative to where it was when last rebased. */
  private unlockBase = NaN;
  private unlockLayer = 0;
  private readonly unlockSteps = new StepQuantizer();

  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;
  private lastCount = 0;

  // Aim of the building hand this frame, in voxelRoot cell units.
  private hasAim = false;
  private hasHit = false;
  private planeWins = false;
  private hasPlane = false;
  private readonly hit = makeGridHit();
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly planePoint = vec3();
  private readonly planeCell = vec3();
  // Scratch.
  private readonly p = vec3();
  private readonly c = vec3();
  private readonly cell = vec3();
  private readonly dir = vec3();
  private readonly pinchPoint: Vec2 = { x: 0, y: 0 };
  private readonly v3 = new THREE.Vector3();

  private readonly occupied = (x: number, y: number, z: number): boolean => this.grid.has(x, y, z);
  private readonly paintCell: CellVisitor = (x, y, z) => {
    if (this.stroke) this.write(this.stroke, x, y, z);
  };

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.root) this.build(ctx);
    if (!this.root || !this.renderer) return;
    this.root.visible = true;
    ctx.cursors.addTarget(this.renderer.pickTarget);
    this.uiDirty = true;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    const { ctx, renderer } = this;
    if (!ctx || !renderer) return;
    this.now = frame.timestamp;

    this.updateTwoHand(frame);
    const allowed = singleHandPinchAllowed(frame.gestures) && !this.moving;

    // The building hand (dominant, or whichever hand holds the stroke).
    const side = this.stroke?.side ?? frame.dominant;
    const cursor = frame.cursors[side];
    this.aim(cursor);
    const g = frame.gestures[side];
    if (this.stroke) this.continueStroke(g);
    else if (allowed && cursor && g?.pinch.justStarted) this.startStroke(side, g);

    this.updateDial(frame, allowed);
    this.updateUnlockedDepth(frame);
    this.updateGhost();
    renderer.update(this.now);
    this.updateStatus();
    if (this.grid.count !== this.lastCount) {
      this.lastCount = this.grid.count;
      this.uiDirty = true;
    }
    this.flushUi(false);
  }

  onAction(action: ModeAction): boolean {
    switch (action.type) {
      case 'depthUp':
        this.setLayer(this.layer + 1);
        break;
      case 'depthDown':
        this.setLayer(this.layer - 1);
        break;
      case 'depthLock':
        this.depthLock = !this.depthLock;
        this.unlockBase = NaN;
        break;
      case 'toggleErase':
        this.tool = this.tool === 'erase' ? 'build' : 'erase';
        break;
      case 'voxelTool':
        this.tool = action.tool;
        break;
      case 'voxelColor': {
        if (!/^#[0-9a-f]{6}$/i.test(action.color)) return false;
        this.color = parseInt(action.color.slice(1), 16);
        this.current = { color: this.color, material: this.material };
        break;
      }
      case 'voxelMaterial':
        this.material = action.material;
        this.current = { color: this.color, material: this.material };
        break;
      default:
        return false;
    }
    this.uiDirty = true;
    this.flushUi(true);
    return true;
  }

  onSidesSwapped(): void {
    if (this.stroke) this.stroke.side = other(this.stroke.side);
    if (this.dial) this.dial.side = other(this.dial.side);
  }

  /** Clear (C): every voxel removed as one undoable step. */
  reset(): void {
    const { ctx, grid } = this;
    if (!ctx || grid.count === 0) return;
    this.endStroke(true);
    ctx.history.execute(clearCommand(grid));
  }

  /**
   * Reset view (R): the structure back to its resting position, size and 3/4 angle — one undo step,
   * so Ctrl+Z brings the view you had back (a grab in progress is kept as its own step first).
   */
  resetView(): void {
    const { ctx, root } = this;
    if (!root) return;
    this.transform?.cancel();
    const before = readPose(root, makePose());
    this.defaultView(root);
    const after = readPose(root, makePose());
    if (ctx && !samePose(before, after)) {
      ctx.history.push(transformCommand(root, before, after, 'Reset view'));
    }
  }

  exit(): void {
    this.endStroke(true);
    this.dial = null;
    this.transform?.cancel();
    this.renderer?.ghost.hide();
    if (this.root) this.root.visible = false;
  }

  dispose(): void {
    this.renderer?.dispose();
    this.root?.removeFromParent();
    this.renderer = null;
    this.root = null;
    this.ctx = null;
  }

  // --- building hand ---------------------------------------------------------------------------

  /** Where the building hand points: the first voxel face, else the active layer's plane. */
  private aim(cursor: SceneCursor | undefined): void {
    this.hasAim = this.hasHit = this.hasPlane = this.planeWins = false;
    const { ctx, renderer } = this;
    if (!cursor || !ctx || !renderer) return;
    this.hasAim = true;
    renderer.pickTarget.localRay(ctx.coords.rayThrough(cursor.ndc).ray, this.o, this.d);
    this.hasHit = raycastGrid(this.o, this.d, this.grid.half, this.occupied, this.hit) !== null;
    const pp = this.planePoint;
    this.hasPlane = rayPlanePoint(this.o, this.d, 2, this.layer, pp);
    if (!this.hasPlane) return;
    setCell(this.planeCell, cellOf(pp.x), cellOf(pp.y), this.layer);
    // Building: the active layer wins over voxels behind it (they're reachable by stepping back).
    const tPlane =
      (pp.x - this.o.x) * this.d.x + (pp.y - this.o.y) * this.d.y + (pp.z - this.o.z) * this.d.z;
    this.planeWins = !this.hasHit || tPlane < this.hit.t - 1e-6;
  }

  /** The cell the current tool would act on (ghost / pinch start). */
  private target(tool: VoxelTool, out: Vec3): boolean {
    const g = this.grid;
    if (tool === 'build') {
      if (this.hasPlane && this.planeWins)
        setCell(out, this.planeCell.x, this.planeCell.y, this.layer);
      else if (this.hasHit) offsetCell(this.hit.cell, this.hit.normal, 1, out);
      else return false;
      return g.inBounds(out.x, out.y, out.z) && !g.has(out.x, out.y, out.z);
    }
    if (!this.hasHit) return false;
    setCell(out, this.hit.cell.x, this.hit.cell.y, this.hit.cell.z);
    return true;
  }

  private startStroke(side: HandSide, g: HandGestures): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.capture.capture(side, STROKE_ID, this.now, () => this.endStroke(true))) return;
    const ex = V.extrude;
    const s: Stroke = {
      side,
      tool: this.tool,
      value: this.tool === 'erase' ? null : this.current,
      edit: new VoxelEdit(this.grid),
      locked: false,
      axis: 2,
      lock: 0,
      onFace: false,
      normal: vec3(),
      anchor: vec3(),
      last: vec3(),
      kind: 'pending',
      depthBase: g.depthSignal,
      depth: new StepQuantizer(ex.step, ex.hysteresis, ex.dwellMs, ex.deadZone),
      pushGrows: false,
      extrude: 0,
    };
    this.stroke = s;
    this.tryAnchor(s);
  }

  /** Fix the stroke's plane from what the hand points at, and write its first cell. */
  private tryAnchor(s: Stroke): void {
    const h = this.hit;
    const build = s.tool === 'build';
    if (build && this.hasPlane && this.planeWins) {
      setCell(s.anchor, this.planeCell.x, this.planeCell.y, this.layer);
      s.axis = 2;
    } else if (this.hasHit) {
      s.onFace = true;
      setCell(s.normal, h.normal.x, h.normal.y, h.normal.z);
      offsetCell(h.cell, h.normal, build ? 1 : 0, s.anchor);
      s.axis = normalAxis(h.normal);
      s.pushGrows = this.facesAway(h.normal);
    } else return;
    if (!this.grid.inBounds(s.anchor.x, s.anchor.y, s.anchor.z)) return;
    s.lock = getAxis(s.anchor, s.axis);
    s.locked = true;
    setCell(s.last, s.anchor.x, s.anchor.y, s.anchor.z);
    this.write(s, s.anchor.x, s.anchor.y, s.anchor.z);
  }

  private continueStroke(g: HandGestures | undefined): void {
    const s = this.stroke;
    const ctx = this.ctx;
    if (!s || !ctx) return;
    if (!g || g.pinch.phase !== 'active') {
      ctx.capture.release(s.side, 'released'); // → endStroke(true)
      return;
    }
    if (!s.locked) {
      this.tryAnchor(s);
      return;
    }
    // Push / pull on a face (§13.3 mechanism 3): depth change since the pinch began, in steps.
    if (s.onFace && s.kind !== 'paint') {
      const delta = (g.depthSignal - s.depthBase) * (s.pushGrows ? -1 : 1);
      const steps = s.depth.update(delta, this.now);
      if (steps > 0) s.kind = 'extrude';
      if (s.kind === 'extrude') {
        s.extrude = clamp(steps, 0, V.maxExtrude);
        return;
      }
    }
    // Paint along the stroke's plane (§13.6 step 5): a new cell only once the aim is clearly in it
    // (dead zone for the first move, so a stationary pinch = one voxel), then fill the gap.
    if (!this.strokePoint(s)) return;
    const margin = s.kind === 'paint' ? V.cellHysteresis : V.paintDeadZone;
    if (sameCell(this.c, s.last) || inPlaneDistance(this.p, s.last, s.axis) < 0.5 + margin) return;
    s.kind = 'paint';
    lineCells(s.last, this.c, this.paintCell);
    setCell(s.last, this.c.x, this.c.y, this.c.z);
  }

  /**
   * Where the aim meets the stroke's plane (`this.p`) and the cell there (`this.c`). A plane seen
   * nearly edge-on gives wild hits, so then only voxel faces lying on that plane count.
   */
  private strokePoint(s: Stroke): boolean {
    if (!this.hasAim) return false;
    const g = this.grid;
    const c = this.c;
    if (
      Math.abs(getAxis(this.d, s.axis)) >= V.minPlaneFacing &&
      rayPlanePoint(this.o, this.d, s.axis, s.lock, this.p)
    ) {
      setCell(c, cellOf(this.p.x), cellOf(this.p.y), cellOf(this.p.z));
      setAxis(c, s.axis, s.lock);
    } else {
      if (!this.hasHit) return false;
      const h = this.hit;
      offsetCell(h.cell, h.normal, s.tool === 'build' ? 1 : 0, c);
      if (getAxis(c, s.axis) !== s.lock) return false;
      setCell(
        this.p,
        this.o.x + this.d.x * h.t,
        this.o.y + this.d.y * h.t,
        this.o.z + this.d.z * h.t,
      );
    }
    return g.inBounds(c.x, c.y, c.z);
  }

  private write(s: Stroke, x: number, y: number, z: number): void {
    const has = this.grid.has(x, y, z);
    if (s.tool === 'build' ? !has : has) s.edit.apply(x, y, z, s.value);
  }

  /** Finish the stroke: place a push / pull column, record one undo step (or undo it all). */
  private endStroke(commit: boolean): void {
    const s = this.stroke;
    const ctx = this.ctx;
    if (!s || !ctx) return;
    this.stroke = null;
    if (commit) {
      if (s.kind === 'extrude') {
        const sign = s.tool === 'build' ? 1 : -1;
        for (let i = 1; i <= s.extrude; i++) {
          offsetCell(s.anchor, s.normal, i * sign, this.cell);
          this.write(s, this.cell.x, this.cell.y, this.cell.z);
        }
      }
      s.edit.commit(ctx.history, LABEL[s.tool]);
    } else {
      s.edit.revert();
    }
    if (ctx.capture.get(s.side)?.targetId === STROKE_ID) ctx.capture.release(s.side, 'cancelled');
  }

  /** Is this local face normal turned away from the camera (so "push" means "grow")? */
  private facesAway(n: Vec3): boolean {
    const { ctx, root } = this;
    if (!ctx || !root) return false;
    const world = this.v3.set(n.x, n.y, n.z).applyQuaternion(root.quaternion);
    return world.z < V.awayFacing; // the camera looks down −Z, so +Z faces it
  }

  // --- depth layer -----------------------------------------------------------------------------

  private setLayer(z: number, fromDepth = false): void {
    const layer = clamp(Math.round(z), -this.grid.half, this.grid.half - 1);
    if (!fromDepth) this.unlockBase = NaN;
    if (layer === this.layer) return;
    this.layer = layer;
    this.renderer?.buildPlane.setLayer(layer, this.now);
    this.uiDirty = true;
  }

  /** Non-dominant pinch + up / down steps the layer like a scroll dial (§13.3 mechanism 4). */
  private updateDial(frame: InteractionFrame, allowed: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.dial) {
      const side = other(frame.dominant);
      const g = frame.gestures[side];
      const hand = frame.hands[side];
      if (!allowed || !hand || !g?.pinch.justStarted || this.stroke?.side === side) return;
      if (!ctx.capture.capture(side, DIAL_ID, this.now, () => (this.dial = null))) return;
      this.dial = { side, baseLayer: this.layer };
      this.dialer.start(-pinchPointInto(this.pinchPoint, hand).y); // up = +
      return;
    }
    const d = this.dial;
    const g = frame.gestures[d.side];
    const hand = frame.hands[d.side];
    if (!hand || !g || g.pinch.phase !== 'active') {
      ctx.capture.release(d.side, 'released');
      return;
    }
    const steps = this.dialer.update(-pinchPointInto(this.pinchPoint, hand).y);
    if (steps !== 0) this.setLayer(this.layer + steps);
  }

  /** Depth Lock off (experimental, §13.5): the dominant hand's depth estimate picks the layer. */
  private updateUnlockedDepth(frame: InteractionFrame): void {
    const g = frame.gestures[frame.dominant];
    const busy = this.stroke || this.dial || this.moving;
    if (this.depthLock || busy || !g || !frame.hands[frame.dominant]) {
      this.unlockBase = NaN;
      return;
    }
    if (Number.isNaN(this.unlockBase)) {
      this.unlockBase = g.depthSignal;
      this.unlockLayer = this.layer;
      this.unlockSteps.reset();
    }
    this.setLayer(
      this.unlockLayer + this.unlockSteps.update(g.depthSignal - this.unlockBase, this.now),
      true,
    );
  }

  // --- two-hand transform (moves / turns / scales the whole structure) -------------------------

  private get moving(): boolean {
    return this.transform?.active ?? false;
  }

  private updateTwoHand(frame: InteractionFrame): void {
    const { ctx, transform } = this;
    if (!ctx || !transform) return;
    const two = frame.gestures.twoHand;
    if (two.justStarted && !transform.active) {
      // Precedence (§11 rule 2): a quick second pinch means the first hand's action was really the
      // start of this grab — undo it; otherwise keep what it did.
      const first = two.cancelFirstHand;
      if (this.stroke) this.endStroke(this.stroke.side !== first);
      if (this.dial) {
        if (this.dial.side === first) this.setLayer(this.dial.baseLayer);
        ctx.capture.release(this.dial.side, 'cancelled');
      }
      transform.begin(ctx, two, this.now);
    }
    transform.update(frame);
  }

  // --- feedback --------------------------------------------------------------------------------

  private updateGhost(): void {
    const ghost = this.renderer?.ghost;
    if (!ghost) return;
    const s = this.stroke;
    const color = (s?.tool ?? this.tool) === 'erase' ? V.ghost.eraseColor : this.color;
    if (s?.kind === 'extrude' && s.extrude > 0) {
      const sign = s.tool === 'build' ? 1 : -1;
      setCell(this.dir, s.normal.x * sign, s.normal.y * sign, s.normal.z * sign);
      ghost.show(offsetCell(s.anchor, this.dir, 1, this.cell), this.dir, s.extrude, color);
    } else if (
      !s &&
      !this.moving &&
      !this.dial &&
      this.hasAim &&
      this.target(this.tool, this.cell)
    ) {
      ghost.show(this.cell, null, 1, color);
    } else {
      ghost.hide(); // while painting, the voxels themselves are the feedback
    }
  }

  private updateStatus(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.stroke;
    const layer = layerLabel(this.layer);
    let text: string;
    if (this.transform?.frozen) text = 'Hand lost — the structure holds still until it is back';
    else if (this.moving) text = 'Moving the structure — let go of both pinches to drop it';
    else if (s?.kind === 'extrude') text = `Extruding ${s.extrude} — push / pull, release to place`;
    else if (s) text = STROKE_TEXT[s.tool];
    else if (this.dial) text = `Depth layer ${layer} — move your ${this.dial.side} hand up / down`;
    else if (!this.depthLock) {
      text = `Depth Lock off (experimental) — move your hand closer / further · layer ${layer}`;
    } else text = `${IDLE_HINT[this.tool]} · layer ${layer}`;
    ctx.emitStatus(text);
  }

  private uiState(): VoxelUiState {
    return {
      tool: this.tool,
      color: hexString(this.color),
      material: this.material,
      layer: this.layer,
      depthLock: this.depthLock,
      count: this.grid.count,
    };
  }

  /** Publish tool-panel state when it changed, at most `uiHz` (immediately for button / key use). */
  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / V.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('voxel', this.uiState());
  }

  private build(ctx: ModeContext): void {
    const root = new THREE.Group();
    root.name = `Mode:${this.id}`;
    this.renderer = new VoxelRenderer(root, this.grid);
    this.renderer.buildPlane.setLayer(this.layer, -Infinity);
    ctx.scene.add(root);
    this.root = root;
    this.transform = new TwoHandTransform(root, {
      id: ROOT_ID,
      label: 'Move structure',
      scaleRange: V.rootScale,
    });
    this.depthLock = ctx.settings.depthLockDefault;
    this.defaultView(root);
  }

  /** Resting position, size and the gentle 3/4 angle that shows top and side faces (D44). */
  private defaultView(root: THREE.Group): void {
    applyPose(root, VIEW_POSE);
  }
}
