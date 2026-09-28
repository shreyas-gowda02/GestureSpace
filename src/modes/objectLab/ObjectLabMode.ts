// Experience 7 — 3D Object Lab (§20): make shapes and arrange them with your hands.
//  • Make: tool-panel buttons (a shape in the middle), or hold the dominant hand open and still →
//    a ring menu opens at the fingertip; pinch a shape in it and you are holding the new shape.
//  • Select: point at a shape (it glows, a faint box frames it) and pinch — it is selected (amber
//    box) and follows the pinch until you let go. "Add to selection" collects several; a tap (a pinch
//    that doesn't move) on empty space deselects everything.
//  • Move: pinch-drag moves the selection on a camera-facing plane — the grabbed spot stays under
//    the fingertip; push / pull the hand (or Q / E) for nearer / farther.
//  • Both hands pinching turn / resize the selection (TwoHandTransform), a fist + drag spins / tips
//    it in 3D (FistOrbit) — both through one SelectionRig, so several shapes move as one.
//  • D copies, Delete deletes, G groups / ungroups, R resets turn and size, C clears: every edit is
//    one undo step.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type {
  Command,
  HandGestures,
  HandSide,
  InteractionFrame,
  ObjectKind,
  ObjectLabUiState,
  ObjectLook,
  SceneCursor,
  Vec2,
} from '@/core/types';
import { StepQuantizer } from '@/spatial/DepthEstimator';
import { InteractionPlane } from '@/spatial/CoordinateMapper';
import {
  FistOrbit,
  makePose,
  readPose,
  samePose,
  TwoHandTransform,
} from '../shared/TwoHandTransform';
import { isRecord } from '../shared/scene';
import type { ModeAction, ModeContext, SpatialMode } from '../types';
import {
  addCommand,
  batchCommand,
  groupCommand,
  itemToNode,
  nodeToItem,
  parseLabNodes,
  HOVERED,
  kindName,
  LabScene,
  moveCommand,
  OBJECT_KINDS,
  removeCommand,
  REST_QUATERNION,
  SELECTED,
  SelectionRig,
  styleCommand,
  ungroupCommand,
  type LabItem,
} from './objects';
import { MENU_CLOSED, SpawnMenu } from './SpawnMenu';

const L = TUNING.objectLab;
const D = L.depth;
const DRAG_ID = 'lab-drag';
const TAP_ID = 'lab-tap';
const SIDES: readonly HandSide[] = ['right', 'left'];

const IDENTITY = new THREE.Quaternion();
const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');
const hexNumber = (hex: string): number => parseInt(hex.slice(1), 16);
const hexString = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const easeOutBack = (t: number): number => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** One held pinch of one hand (pinch → release). */
interface Press {
  side: HandSide;
  /** Dragging the selection — else a pinch on empty space (a deselect, if it stays a tap). */
  drag: boolean;
  /** Where the pinch began (screen CSS px) and whether it has moved past a tap. */
  startX: number;
  startY: number;
  moved: boolean;
  /** "Add to selection" pinch on an already selected shape: a tap deselects it. */
  toggle: LabItem | null;
  /** Made by this pinch from the menu: recorded as "Add …" (where it was dropped) on release. */
  spawned: LabItem | null;
  /** Push / pull: depth signal at the pinch, Q / E steps, and the eased offset toward the camera. */
  depthBase: number;
  keySteps: number;
  depth: number;
  /** The grabbed spot's distance in front of the camera (for the near / far limits). */
  distance: number;
  /** How far (CSS px) the aim may move and the pinch still be a tap. */
  tapLimit: number;
}

/** What the status bar says (the text is rebuilt only when this or the selection count changes). */
const SAY = {
  empty: 0,
  idle: 1,
  selected: 2,
  charging: 3,
  menu: 4,
  drag: 5,
  tap: 6,
  twoHand: 7,
  frozen: 8,
  turning: 9,
} as const;
type Say = (typeof SAY)[keyof typeof SAY];

export class ObjectLabMode implements SpatialMode {
  readonly id = 'objectLab' as const;
  private ctx: ModeContext | null = null;
  private lab: LabScene | null = null;
  private readonly rig = new SelectionRig();
  private transform: TwoHandTransform | null = null;
  private orbit: FistOrbit | null = null;
  private readonly menu = new SpawnMenu();
  /** Selected top-level items. */
  private readonly selection: LabItem[] = [];
  private readonly hover: Record<HandSide, LabItem | null> = { left: null, right: null };
  private press: Press | null = null;
  private readonly depthSteps = new StepQuantizer(D.step, D.hysteresis, D.dwellMs, D.deadZone);
  /** The two-hand grab's size limits (from the selected shapes' own sizes), set before each grab. */
  private readonly scaleRange = { min: 1, max: 1 };

  private color = hexNumber(L.defaultColor);
  private colorHex: string = L.defaultColor;
  private look: ObjectLook = 'solid';
  private multi = false;
  /** Shapes popping in, and when each was made. */
  private readonly popping: LabItem[] = [];
  private readonly bornAt: number[] = [];

  private now = 0;
  private stylesDirty = true;
  private uiDirty = true;
  private lastUi = -Infinity;
  private lastSay = -1;

  // Scratch.
  private readonly spawnPlane = new InteractionPlane();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly center = new THREE.Vector3();

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.lab) this.build(ctx);
    const lab = this.lab;
    if (!lab) return;
    lab.root.visible = true;
    ctx.cursors.addTarget(lab.root);
    this.stylesDirty = this.uiDirty = true;
    this.lastSay = -1;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    const { ctx, lab } = this;
    if (!ctx || !lab) return;
    this.now = frame.timestamp;
    this.updateHover(frame);
    this.updateTwoHand(frame);
    this.updateOrbit(frame);
    const used = this.updateMenu(frame);
    this.updatePress(frame, used);
    this.updatePop();
    if (this.stylesDirty) this.restyle();
    this.updateStatus();
    this.flushUi(false);
  }

  drawOverlay(c2d: CanvasRenderingContext2D): void {
    if (this.lab?.root.visible)
      this.menu.draw(c2d, this.now, this.colorHex, this.ctx?.settings.reduceMotion ?? false);
  }

  onAction(action: ModeAction): boolean {
    const { ctx, lab } = this;
    if (!ctx || !lab) return false;
    switch (action.type) {
      case 'objectSpawn':
        this.spawnInMiddle(action.kind);
        break;
      case 'objectColor':
        if (!/^#[0-9a-f]{6}$/i.test(action.color)) return false;
        this.color = hexNumber(action.color);
        this.colorHex = hexString(this.color);
        this.restyleSelection(this.color, null, 'Recolour');
        break;
      case 'objectLook':
        this.look = action.look;
        this.restyleSelection(null, this.look, 'Change look');
        break;
      case 'objectMulti':
        this.multi = !this.multi;
        break;
      case 'group':
        if (this.selection.length >= 2) this.group();
        else this.ungroup();
        break;
      case 'objectGroup':
        this.group();
        break;
      case 'objectUngroup':
        this.ungroup();
        break;
      case 'duplicate':
        this.duplicate();
        break;
      case 'delete':
        if (!this.busy && this.selection.length) {
          const n = this.selection.length;
          ctx.history.execute(
            removeCommand(lab, this.selection, n > 1 ? `Delete ${n} shapes` : 'Delete shape'),
          );
        }
        break;
      case 'depthUp':
      case 'depthDown':
        this.nudgeDepth(action.type === 'depthUp' ? 1 : -1);
        break;
      case 'escape':
        this.menu.close();
        this.setSelection(null);
        break;
      default:
        return false;
    }
    this.uiDirty = true;
    this.flushUi(true);
    return true;
  }

  onSidesSwapped(): void {
    this.orbit?.onSidesSwapped();
    this.menu.onSidesSwapped();
    if (this.press) this.press.side = other(this.press.side);
    const h = this.hover.left;
    this.hover.left = this.hover.right;
    this.hover.right = h;
  }

  /** Every shape and group: kind, colour, look, pose (members relative to their group). */
  serialize(): unknown {
    const lab = this.lab;
    if (!lab) return undefined;
    const items = [];
    for (let i = 0; i < lab.count; i++) {
      const item = lab.top(i);
      if (item) items.push(itemToNode(lab, item));
    }
    return { v: 1, items };
  }

  sceneCommand(data: unknown): Command | null {
    const lab = this.lab;
    if (!lab || !isRecord(data) || data.v !== 1) return null;
    const nodes = parseLabNodes(data.items);
    if (!nodes) return null;
    const current: LabItem[] = [];
    for (let i = 0; i < lab.count; i++) {
      const item = lab.top(i);
      if (item) current.push(item);
    }
    const loaded = nodes.map((n) => nodeToItem(lab, n));
    return batchCommand('Load scene', [
      removeCommand(lab, current, 'Load scene'),
      addCommand(lab, loaded, 'Load scene'),
    ]);
  }

  /** Clear (C): every shape removed as one undoable step. */
  reset(): void {
    const { ctx, lab } = this;
    if (!ctx || !lab || lab.count === 0) return;
    const all: LabItem[] = [];
    for (let i = 0; i < lab.count; i++) {
      const item = lab.top(i);
      if (item) all.push(item);
    }
    ctx.history.execute(removeCommand(lab, all, 'Clear'));
  }

  /**
   * Reset (R): the selection — or every shape, if none is selected — turned back upright and to
   * its made size, where it is. One undo step.
   */
  resetView(): void {
    const { ctx, lab } = this;
    if (!ctx || !lab) return;
    this.transform?.cancel();
    this.orbit?.cancel();
    this.endPress(true);
    const items: LabItem[] = this.selection.slice();
    if (!items.length) {
      for (let i = 0; i < lab.count; i++) {
        const item = lab.top(i);
        if (item) items.push(item);
      }
    }
    const before = items.map((it) => readPose(it.object, makePose()));
    const after = items.map((it) => {
      const p = readPose(it.object, makePose());
      p.quaternion.copy(it.kind === 'group' ? IDENTITY : REST_QUATERNION);
      p.scale.set(1, 1, 1);
      return p;
    });
    if (before.every((b, i) => samePose(b, after[i] ?? b))) return;
    ctx.history.execute(moveCommand(items, before, after, 'Reset turn & size'));
  }

  exit(): void {
    this.endPress(true);
    this.transform?.cancel();
    this.orbit?.cancel();
    this.menu.close();
    this.hover.left = this.hover.right = null;
    this.stylesDirty = true;
    this.restyle();
    if (this.lab) this.lab.root.visible = false;
  }

  dispose(): void {
    this.lab?.dispose();
    this.lab = null;
    this.ctx = null;
    this.selection.length = 0;
    this.popping.length = this.bornAt.length = 0;
  }

  // --- for tests ---------------------------------------------------------------------------------

  get scene(): LabScene | null {
    return this.lab;
  }

  get selected(): readonly LabItem[] {
    return this.selection;
  }

  get spawnMenu(): SpawnMenu {
    return this.menu;
  }

  // --- hover + selection -------------------------------------------------------------------------

  /** What each hand points at (the whole group, for a shape in one). */
  private updateHover(frame: InteractionFrame): void {
    const lab = this.lab;
    if (!lab) return;
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i] ?? 'right';
      const hit = frame.cursors[side]?.hit;
      const top = (hit?.kind === 'object' ? lab.topOf(hit.objectId) : undefined) ?? null;
      if (top !== this.hover[side]) {
        this.hover[side] = top;
        this.stylesDirty = true;
      }
    }
  }

  private isSelected(item: LabItem): boolean {
    return this.selection.includes(item);
  }

  /** Replace the selection (null = nothing). */
  private setSelection(items: readonly LabItem[] | null): void {
    this.selection.length = 0;
    if (items) this.selection.push(...items);
    this.stylesDirty = this.uiDirty = true;
  }

  /** Every shape's glow and box, from hover + selection (only when something changed). */
  private restyle(): void {
    const lab = this.lab;
    if (!lab) return;
    this.stylesDirty = false;
    for (let i = 0; i < lab.count; i++) {
      const item = lab.top(i);
      if (!item) continue;
      const hovered = item === this.hover.left || item === this.hover.right;
      lab.style(item, (hovered ? HOVERED : 0) | (this.isSelected(item) ? SELECTED : 0));
    }
  }

  /** A command added / removed / regrouped items: the selection keeps only what is still shown. */
  private readonly itemsChanged = (): void => {
    const lab = this.lab;
    if (!lab) return;
    for (let i = this.selection.length - 1; i >= 0; i--) {
      const item = this.selection[i];
      if (!item || !lab.isTop(item)) this.selection.splice(i, 1);
    }
    for (const side of SIDES) {
      const h = this.hover[side];
      if (h && !lab.isTop(h)) this.hover[side] = null;
    }
    this.stylesDirty = this.uiDirty = true;
    this.restyle(); // at once: undo / buttons may come while no frames run
  };

  // --- one hand: select, drag, push / pull ----------------------------------------------------

  /** Something holds the selection (drag, two-hand grab or fist). */
  private get busy(): boolean {
    return !!this.press || !!this.transform?.active || !!this.orbit?.active;
  }

  private updatePress(frame: InteractionFrame, usedBy: HandSide | null): void {
    if (this.press) {
      this.continuePress(frame);
      return;
    }
    if (this.transform?.active || this.orbit?.turning || frame.gestures.twoHand.active) return;
    const first = frame.dominant;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? first : other(first);
      if (side === usedBy || (this.menu.state === 'open' && side === this.menu.side)) continue;
      const g = frame.gestures[side];
      const cursor = frame.cursors[side];
      if (!g?.pinch.justStarted || !cursor) continue;
      this.orbit?.cancel(); // a resting fist on the other hand must not block
      this.startPress(side, g, cursor);
      return;
    }
  }

  private startPress(side: HandSide, g: HandGestures, cursor: SceneCursor): void {
    const top = this.hover[side];
    const hit = cursor.hit;
    if (top && hit) {
      let toggle: LabItem | null = null;
      if (!this.isSelected(top)) {
        if (!this.multi) this.selection.length = 0;
        this.selection.push(top);
        this.stylesDirty = this.uiDirty = true;
      } else if (this.multi) toggle = top;
      this.v.set(hit.point.x, hit.point.y, hit.point.z);
      this.startDrag(side, g, cursor, this.v, null, toggle);
      return;
    }
    const ctx = this.ctx;
    if (!ctx?.capture.capture(side, TAP_ID, this.now, this.onPressReleased)) return;
    this.press = this.makePress(side, false, g, cursor);
  }

  /** Start moving the selection with `side`'s pinch, grabbed at `point` (on the pinch's ray). */
  private startDrag(
    side: HandSide,
    g: HandGestures,
    cursor: SceneCursor,
    point: THREE.Vector3,
    spawned: LabItem | null,
    toggle: LabItem | null,
  ): boolean {
    const ctx = this.ctx;
    if (!ctx?.capture.capture(side, DRAG_ID, this.now, this.onPressReleased)) return false;
    this.rig.begin(this.selection, point);
    this.depthSteps.reset();
    const cam = ctx.camera;
    cam.getWorldDirection(this.forward);
    const p = this.makePress(side, true, g, cursor);
    p.distance = this.w.copy(point).sub(cam.position).dot(this.forward);
    p.spawned = spawned;
    p.toggle = toggle;
    this.press = p;
    return true;
  }

  private makePress(side: HandSide, drag: boolean, g: HandGestures, cursor: SceneCursor): Press {
    return {
      side,
      drag,
      startX: cursor.screen.x,
      startY: cursor.screen.y,
      moved: false,
      toggle: null,
      spawned: null,
      depthBase: g.depthSignal,
      keySteps: 0,
      depth: 0,
      distance: 0,
      tapLimit: this.ctx ? L.tapMaxMove * this.menu.screenHeight(this.ctx) : 0,
    };
  }

  private continuePress(frame: InteractionFrame): void {
    const { ctx, press: p } = this;
    if (!ctx || !p) return;
    const g = frame.gestures[p.side];
    if (!g || g.pinch.phase !== 'active') {
      ctx.capture.release(p.side, 'released'); // → endPress(true)
      return;
    }
    const hand = frame.hands[p.side];
    const cursor = frame.cursors[p.side];
    if (!hand || !cursor || hand.lostForMs > 0) return; // hold still while the hand is lost
    if (!p.moved) {
      const dx = cursor.screen.x - p.startX;
      const dy = cursor.screen.y - p.startY;
      if (dx * dx + dy * dy > p.tapLimit * p.tapLimit) p.moved = true;
    }
    if (!p.drag) return;
    // Push / pull: steps of depth change since the pinch (+ Q / E), eased.
    const steps = this.depthSteps.update(g.depthSignal - p.depthBase, this.now) + p.keySteps;
    if (steps !== 0) p.moved = true;
    const target = Math.min(
      Math.max(steps * D.unitsPerStep, p.distance - L.distance.max),
      p.distance - L.distance.min,
    );
    p.depth += (target - p.depth) * (1 - Math.exp(-D.ease * frame.dt));
    // The grabbed spot follows the fingertip's ray on a camera-facing plane, moved `depth` nearer.
    if (onCameraPlane(ctx.camera, cursor.ndc, p.distance - p.depth, this.rig.handle.position)) {
      this.rig.sync();
    }
  }

  /** Capture callback: the pinch ended (let go, hand lost, undo, mode switch…). */
  private readonly onPressReleased = (): void => this.endPress(true);

  /**
   * Finish the press. `commit` false = a second hand joined at once (§11 rule 2): the drag is put
   * back (the selection it made stays) and a tap does nothing.
   */
  private endPress(commit: boolean): void {
    const { ctx, lab, press: p } = this;
    if (!p) return;
    this.press = null;
    if (p.drag) {
      if (!commit) this.rig.revert();
      const n = this.rig.items.length;
      const move = this.rig.end(n > 1 ? `Move ${n} shapes` : 'Move shape');
      if (p.spawned && lab) {
        // The new shape's undo step, where it was dropped (the move is part of it).
        ctx?.history.push(addCommand(lab, [p.spawned], `Add ${kindName(this.kindOf(p.spawned))}`));
      } else if (move) ctx?.history.push(move);
      if (commit && !p.moved && p.toggle) {
        const i = this.selection.indexOf(p.toggle);
        if (i >= 0) this.selection.splice(i, 1);
        this.stylesDirty = this.uiDirty = true;
      }
    } else if (commit && !p.moved) this.setSelection(null); // a tap on empty space
    const id = p.drag ? DRAG_ID : TAP_ID;
    if (ctx?.capture.get(p.side)?.targetId === id) ctx.capture.release(p.side, 'cancelled');
  }

  private kindOf(item: LabItem): ObjectKind {
    return item.kind === 'group' ? 'cube' : item.kind;
  }

  /** Q / E: while holding, one more step nearer / farther; else the selection moves one step. */
  private nudgeDepth(dir: 1 | -1): void {
    const { ctx, lab, press } = this;
    if (!ctx || !lab) return;
    if (press?.drag) {
      press.keySteps += dir;
      return;
    }
    if (this.busy || !this.selection.length) return;
    const cam = ctx.camera;
    lab.centerOf(this.selection, this.center);
    cam.getWorldDirection(this.forward);
    const distance = this.w.copy(this.center).sub(cam.position).dot(this.forward);
    const next = distance - dir * D.unitsPerStep;
    if (next < L.distance.min || next > L.distance.max) return;
    // Along the line from the camera through the selection's middle: it stays put on screen.
    this.w.copy(cam.position).sub(this.center).normalize();
    this.rig.begin(this.selection, this.center);
    this.rig.handle.position.addScaledVector(this.w, dir * D.unitsPerStep);
    this.rig.sync();
    const cmd = this.rig.end(dir > 0 ? 'Move nearer' : 'Move farther');
    if (cmd) ctx.history.push(cmd);
  }

  // --- two hands: turn / resize; fist: spin in 3D ------------------------------------------------

  private updateTwoHand(frame: InteractionFrame): void {
    const { ctx, lab, transform } = this;
    if (!ctx || !lab || !transform) return;
    const two = frame.gestures.twoHand;
    if (two.justStarted && !transform.active) {
      // A quick second pinch (§11 rule 2): the first hand's drag was the start of this grab.
      const p = this.press;
      if (p) this.endPress(p.drag && p.side !== two.cancelFirstHand);
      this.menu.close();
      this.orbit?.cancel();
      if (!this.selection.length) {
        for (const side of SIDES) {
          const h = this.hover[side];
          if (h && !this.isSelected(h)) this.selection.push(h);
        }
        this.stylesDirty = this.uiDirty = true;
      }
      if (this.selection.length) {
        this.rig.begin(this.selection, lab.centerOf(this.selection, this.center));
        this.setScaleRange();
        if (!transform.begin(ctx, two, this.now)) this.rig.end('');
      }
    }
    transform.update(frame);
    if (transform.active) this.rig.sync();
  }

  /** One grab may resize only as far as keeps every selected item within its size limits. */
  private setScaleRange(): void {
    let min = 0;
    let max = Infinity;
    for (let i = 0; i < this.selection.length; i++) {
      const s = this.selection[i]?.object.scale.x ?? 1;
      min = Math.max(min, L.scaleRange.min / s);
      max = Math.min(max, L.scaleRange.max / s);
    }
    this.scaleRange.min = Math.min(1, min);
    this.scaleRange.max = Math.max(1, max);
  }

  /** A fist (either hand, the dominant one first) spins the selection about its middle. */
  private updateOrbit(frame: InteractionFrame): void {
    const { ctx, lab, orbit } = this;
    if (!ctx || !lab || !orbit) return;
    const free = !orbit.active && !this.press && !this.transform?.active;
    if (free && this.selection.length && this.menu.state !== 'open') {
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? frame.dominant : other(frame.dominant);
        const hand = frame.hands[side];
        if (!hand || !frame.gestures[side]?.grab.justStarted) continue;
        this.rig.begin(this.selection, lab.centerOf(this.selection, this.center));
        if (orbit.begin(ctx, side, hand, this.rig.handle.position, this.now)) break;
        this.rig.end('');
      }
    }
    orbit.update(frame);
    if (orbit.active) this.rig.sync();
  }

  // --- making shapes -----------------------------------------------------------------------------

  /** The ring menu; returns the hand whose pinch it used this frame. */
  private updateMenu(frame: InteractionFrame): HandSide | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const blocked = this.busy || frame.gestures.twoHand.active;
    const pick = this.menu.update(frame, ctx, blocked);
    if (pick === MENU_CLOSED) return this.menu.side;
    const kind = OBJECT_KINDS[pick]?.kind;
    if (!kind) return null;
    const side = this.menu.side;
    const g = frame.gestures[side];
    const cursor = frame.cursors[side];
    if (!g || !cursor || !ctx.coords.ndcToPlane(cursor.ndc, this.spawnPlane.plane, this.v)) {
      return side;
    }
    // The new shape appears under the fingertip, already held by this pinch.
    const item = this.addShape(this.lab, kind, this.v);
    if (!item) return side;
    this.setSelection([item]);
    this.startDrag(side, g, cursor, this.v, item, null);
    return side;
  }

  /** A new shape at `at`, popping in (its undo step is recorded by the caller). */
  private addShape(lab: LabScene | null, kind: ObjectKind, at: THREE.Vector3): LabItem | null {
    if (!lab) return null;
    const item = lab.makeShape(kind, this.color, this.look);
    item.object.position.copy(at);
    lab.root.add(item.object);
    item.object.updateMatrixWorld(true);
    if (!this.ctx?.settings.reduceMotion) {
      item.mesh?.scale.setScalar(0.01);
      this.popping.push(item);
      this.bornAt.push(this.now);
    }
    this.itemsChanged();
    return item;
  }

  /** Tool panel: a new shape in the middle (or the nearest free spot), selected. */
  private spawnInMiddle(kind: ObjectKind): void {
    const { ctx, lab } = this;
    if (!ctx || !lab || this.busy) return;
    const s = L.spawnSpacing;
    const spots = [
      [0, 0],
      [s, 0],
      [-s, 0],
      [0, s],
      [0, -s],
      [s, s],
      [-s, s],
      [s, -s],
      [-s, -s],
    ] as const;
    const spot =
      spots.find(([x, y]) => {
        for (let i = 0; i < lab.count; i++) {
          const p = lab.top(i)?.object.position;
          if (p && Math.hypot(p.x - x, p.y - y) < s * 0.7) return false;
        }
        return true;
      }) ?? spots[0];
    const item = this.addShape(lab, kind, this.v.set(spot[0], spot[1], 0));
    if (!item) return;
    this.setSelection([item]);
    ctx.history.push(addCommand(lab, [item], `Add ${kindName(kind)}`));
  }

  private updatePop(): void {
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const mesh = this.popping[i]?.mesh;
      const t = (this.now - (this.bornAt[i] ?? 0)) / L.popMs;
      if (!mesh || t >= 1) {
        mesh?.scale.setScalar(1);
        const last = this.popping.length - 1;
        this.popping[i] = this.popping[last] as LabItem;
        this.bornAt[i] = this.bornAt[last] ?? 0;
        this.popping.length = this.bornAt.length = last;
      } else mesh.scale.setScalar(Math.max(0.01, easeOutBack(Math.max(0, t))));
    }
  }

  // --- selection edits ---------------------------------------------------------------------------

  private duplicate(): void {
    const { ctx, lab } = this;
    if (!ctx || !lab || this.busy || !this.selection.length) return;
    const copies = this.selection.map((it) => lab.clone(it));
    for (const c of copies) {
      c.object.position.x += L.duplicateOffset;
      c.object.position.y -= L.duplicateOffset;
    }
    const n = copies.length;
    ctx.history.execute(addCommand(lab, copies, n > 1 ? `Copy ${n} shapes` : 'Copy shape'));
    this.setSelection(copies);
  }

  private group(): void {
    const { ctx, lab } = this;
    if (!ctx || !lab || this.busy || this.selection.length < 2) return;
    const group = lab.makeGroup();
    group.object.position.copy(lab.centerOf(this.selection, this.center));
    ctx.history.execute(groupCommand(lab, group, this.selection));
    this.setSelection([group]);
  }

  private ungroup(): void {
    const { ctx, lab } = this;
    if (!ctx || !lab || this.busy) return;
    const groups = this.selection.filter((it) => it.kind === 'group');
    if (!groups.length) return;
    const members = groups.flatMap((g) =>
      g.object.children.map((c) => lab.itemOf(c)).filter((m) => m !== undefined),
    );
    const rest = this.selection.filter((it) => it.kind !== 'group');
    ctx.history.execute(ungroupCommand(lab, groups));
    this.setSelection([...rest, ...members]);
  }

  /** Colour / look buttons also restyle the selection (one undo step). */
  private restyleSelection(color: number | null, look: ObjectLook | null, label: string): void {
    const { ctx, lab } = this;
    if (!ctx || !lab || !this.selection.length) return;
    const shapes: LabItem[] = [];
    for (const it of this.selection) lab.shapesOf(it, shapes);
    const changes = shapes.some(
      (s) => (color !== null && s.color !== color) || (look !== null && s.look !== look),
    );
    if (changes) ctx.history.execute(styleCommand(lab, shapes, color, look, label));
  }

  // --- feedback ----------------------------------------------------------------------------------

  private updateStatus(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const n = this.selection.length;
    let say: Say;
    if (this.transform?.frozen) say = SAY.frozen;
    else if (this.transform?.active) say = SAY.twoHand;
    else if (this.orbit?.turning) say = SAY.turning;
    else if (this.press) say = this.press.drag ? SAY.drag : SAY.tap;
    else if (this.menu.state === 'open') say = SAY.menu;
    else if (this.menu.showingCharge) say = SAY.charging;
    else if (n) say = SAY.selected;
    else say = this.lab?.count ? SAY.idle : SAY.empty;
    const key = say * 1000 + n;
    if (key === this.lastSay) return;
    this.lastSay = key;
    ctx.emitStatus(statusText(say, n));
  }

  private uiState(): ObjectLabUiState {
    const n = this.selection.length;
    return {
      color: hexString(this.color),
      look: this.look,
      multi: this.multi,
      count: this.lab?.count ?? 0,
      selected: n,
      canGroup: n >= 2,
      canUngroup: this.selection.some((it) => it.kind === 'group'),
    };
  }

  /** Publish tool-panel state when it changed, at most `uiHz` (immediately for buttons / keys). */
  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / L.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('objectLab', this.uiState());
  }

  private build(ctx: ModeContext): void {
    const lab = new LabScene();
    lab.onChange = this.itemsChanged;
    ctx.scene.add(lab.root);
    this.lab = lab;
    this.spawnPlane.setZ(0);
    this.transform = new TwoHandTransform(this.rig.handle, {
      id: 'lab-two-hand',
      label: 'Turn / resize',
      scaleRange: this.scaleRange,
      command: () =>
        this.rig.end(this.rig.items.length > 1 ? 'Turn / resize shapes' : 'Turn / resize'),
    });
    this.orbit = new FistOrbit(this.rig.handle, {
      id: 'lab-orbit',
      label: 'Spin',
      command: () => this.rig.end(this.rig.items.length > 1 ? 'Spin shapes' : 'Spin'),
    });
  }
}

/**
 * Where the ray through `ndc` meets the plane facing the camera `distance` in front of it — worked
 * out by hand (three's raycaster boxes a dozen decimals per call).
 */
function onCameraPlane(
  cam: THREE.PerspectiveCamera,
  ndc: Vec2,
  distance: number,
  out: THREE.Vector3,
): boolean {
  if (!(distance > 0)) return false;
  const up = (Math.tan((cam.fov * Math.PI) / 360) / cam.zoom) * distance;
  const x = ndc.x * up * cam.aspect;
  const y = ndc.y * up;
  const e = cam.matrixWorld.elements;
  // Camera space (x, y, −distance) → world.
  out.x = (e[0] ?? 1) * x + (e[4] ?? 0) * y - (e[8] ?? 0) * distance + (e[12] ?? 0);
  out.y = (e[1] ?? 0) * x + (e[5] ?? 1) * y - (e[9] ?? 0) * distance + (e[13] ?? 0);
  out.z = (e[2] ?? 0) * x + (e[6] ?? 0) * y - (e[10] ?? 1) * distance + (e[14] ?? 0);
  return true;
}

function statusText(say: Say, n: number): string {
  switch (say) {
    case SAY.empty:
      return 'Hold your hand open and still for the shape menu — or pick a shape in the tool panel';
    case SAY.idle:
      return 'Point at a shape and pinch to pick it up · hold your hand open for the shape menu';
    case SAY.selected:
      return `${n === 1 ? '1 shape' : `${n} shapes`} selected — pinch to move · both hands turn / resize · fist spins · D copy · Delete`;
    case SAY.charging:
      return 'Keep your hand open and still — the shape menu is opening…';
    case SAY.menu:
      return 'Shape menu — point at a shape and pinch to make it (pinch anywhere else to close)';
    case SAY.drag:
      return 'Moving — push / pull your hand (or Q / E) for nearer / farther; let go to drop';
    case SAY.tap:
      return 'Let go to deselect';
    case SAY.twoHand:
      return 'Turning / resizing — let go of both pinches to drop';
    case SAY.frozen:
      return 'Hand lost — the selection holds still until it is back';
    case SAY.turning:
      return 'Spinning in 3D — move your fist; open your hand to stop';
  }
}
