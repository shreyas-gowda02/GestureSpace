// 3D Object Lab building blocks (§20):
//  • The five primitives. Geometry is shared per kind (made once); each shape has its own material,
//    so it can glow on its own when hovered or selected.
//  • LabItem = a shape, or a group of items (a THREE.Group). Items live in the lab's root, which
//    never moves, so a top-level item's local pose is its world pose.
//  • LabScene: the root, the shared kit and every item made so far (undo can bring one back).
//  • Undoable commands for every edit: add, remove, move, restyle, group, ungroup.
//  • SelectionRig: one stand-in "handle" that a one-hand drag, TwoHandTransform or FistOrbit
//    moves; sync() applies the handle's motion to every selected item, so they move as one.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type { Command, ObjectKind, ObjectLook } from '@/core/types';
import {
  applyPose,
  clonePose,
  makePose,
  readPose,
  samePose,
  type Pose,
} from '../shared/TwoHandTransform';

const L = TUNING.objectLab;

export const OBJECT_KINDS: readonly { kind: ObjectKind; name: string }[] = [
  { kind: 'cube', name: 'Cube' },
  { kind: 'sphere', name: 'Sphere' },
  { kind: 'cylinder', name: 'Cylinder' },
  { kind: 'plane', name: 'Plane' },
  { kind: 'torus', name: 'Donut' },
];

export const kindName = (kind: ObjectKind): string =>
  OBJECT_KINDS.find((k) => k.kind === kind)?.name ?? kind;

/** New shapes are turned a little so their 3D shape shows; R turns them back to this. */
export const REST_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(L.restTurn.tiltX, L.restTurn.turnY, 0),
);

const LOOKS: readonly ObjectLook[] = ['solid', 'glow', 'glass'];

/** Hover / selection state of a shape, as bits. */
export const HOVERED = 1;
export const SELECTED = 2;

function makeGeometry(kind: ObjectKind): THREE.BufferGeometry {
  const s = L.shapes;
  switch (kind) {
    case 'cube':
      return new THREE.BoxGeometry(s.cube, s.cube, s.cube);
    case 'sphere':
      return new THREE.SphereGeometry(
        s.sphere.radius,
        s.sphere.widthSegments,
        s.sphere.heightSegments,
      );
    case 'cylinder':
      return new THREE.CylinderGeometry(
        s.cylinder.radius,
        s.cylinder.radius,
        s.cylinder.height,
        s.cylinder.segments,
      );
    case 'plane':
      return new THREE.BoxGeometry(s.plane.size, s.plane.size, s.plane.thickness);
    case 'torus':
      return new THREE.TorusGeometry(
        s.torus.radius,
        s.torus.tube,
        s.torus.radialSegments,
        s.torus.tubularSegments,
      );
  }
}

/** Shared GPU resources: one geometry per kind (made on first use) and the outline box. */
export class ObjectKit {
  private readonly shapes = new Map<
    ObjectKind,
    { geometry: THREE.BufferGeometry; box: THREE.Box3 }
  >();
  /** A unit box's 12 edges, scaled to each shape's bounds. */
  readonly outlineGeometry: THREE.EdgesGeometry;
  readonly hoverLine = new THREE.LineBasicMaterial({
    color: L.outline.hover,
    transparent: true,
    opacity: L.outline.hoverOpacity,
    depthWrite: false,
  });
  readonly selectLine = new THREE.LineBasicMaterial({ color: L.outline.selected });

  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.outlineGeometry = new THREE.EdgesGeometry(box);
    box.dispose();
  }

  /** Geometries made so far (tests: one per kind, however many shapes). */
  get geometryCount(): number {
    return this.shapes.size;
  }

  shape(kind: ObjectKind): { geometry: THREE.BufferGeometry; box: THREE.Box3 } {
    let s = this.shapes.get(kind);
    if (!s) {
      const geometry = makeGeometry(kind);
      geometry.computeBoundingBox();
      s = { geometry, box: geometry.boundingBox?.clone() ?? new THREE.Box3() };
      this.shapes.set(kind, s);
    }
    return s;
  }

  dispose(): void {
    for (const s of this.shapes.values()) s.geometry.dispose();
    this.shapes.clear();
    this.outlineGeometry.dispose();
    this.hoverLine.dispose();
    this.selectLine.dispose();
  }
}

export interface LabItem {
  readonly id: string;
  /** What moves, turns and resizes; `userData.gsId` = id, which the cursor reports on a hit. */
  readonly object: THREE.Group;
  readonly kind: ObjectKind | 'group';
  /** Shapes: the mesh (own material; its scale does the pop-in) and the outline box. Groups: null. */
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  readonly outline: THREE.LineSegments | null;
  /** Shapes: colour (0xrrggbb) and look. */
  color: number;
  look: ObjectLook;
  /** What the material shows now (colour, look, hover / selected): unchanged shapes are skipped. */
  styled: number;
}

/** Undo can re-add a removed item, so nothing is freed until the lab is disposed. */
export class LabScene {
  /** Holds the top-level items; never moved (so their local poses are world poses). */
  readonly root = new THREE.Group();
  readonly kit = new ObjectKit();
  /** Items were added, removed or regrouped (commands call it, also on undo / redo). */
  onChange: () => void = () => {};
  private readonly items = new Map<string, LabItem>();
  private nextId = 1;
  private readonly box = new THREE.Box3();

  constructor() {
    this.root.name = 'Mode:objectLab';
  }

  /** Top-level items in the scene. */
  get count(): number {
    return this.root.children.length;
  }

  /** The i-th top-level item. */
  top(i: number): LabItem | undefined {
    const o = this.root.children[i];
    return o ? this.itemOf(o) : undefined;
  }

  itemOf(o: THREE.Object3D): LabItem | undefined {
    const id: unknown = o.userData.gsId;
    return typeof id === 'string' ? this.items.get(id) : undefined;
  }

  isTop(item: LabItem): boolean {
    return item.object.parent === this.root;
  }

  /** The top-level item an id belongs to (a shape inside a group → the group), if it is shown. */
  topOf(id: string | undefined): LabItem | undefined {
    let o: THREE.Object3D | null =
      (id === undefined ? undefined : this.items.get(id))?.object ?? null;
    while (o && o.parent !== this.root) o = o.parent;
    return o ? this.itemOf(o) : undefined;
  }

  /** A new shape at the origin, turned to REST_QUATERNION (not yet in the scene). */
  makeShape(kind: ObjectKind, color: number, look: ObjectLook): LabItem {
    const id = `shape-${this.nextId++}`;
    const { geometry, box } = this.kit.shape(kind);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = kind;
    const outline = new THREE.LineSegments(this.kit.outlineGeometry, this.kit.hoverLine);
    box.getSize(outline.scale).multiplyScalar(1 + L.outline.pad);
    box.getCenter(outline.position);
    outline.visible = false;
    outline.raycast = () => {}; // never a cursor hit
    const object = new THREE.Group();
    object.name = `Lab:${id}`;
    object.userData.gsId = id;
    object.quaternion.copy(REST_QUATERNION);
    object.add(mesh, outline);
    const item: LabItem = { id, object, kind, mesh, outline, color, look, styled: -1 };
    this.items.set(id, item);
    this.style(item, 0);
    return item;
  }

  /** An empty group at the origin (not yet in the scene). */
  makeGroup(): LabItem {
    const id = `group-${this.nextId++}`;
    const object = new THREE.Group();
    object.name = `Lab:${id}`;
    object.userData.gsId = id;
    const item: LabItem = {
      id,
      object,
      kind: 'group',
      mesh: null,
      outline: null,
      color: 0,
      look: 'solid',
      styled: -1,
    };
    this.items.set(id, item);
    return item;
  }

  /** A deep copy with new ids, in the same pose (not yet in the scene). */
  clone(src: LabItem): LabItem {
    const copy =
      src.kind === 'group' ? this.makeGroup() : this.makeShape(src.kind, src.color, src.look);
    copy.object.position.copy(src.object.position);
    copy.object.quaternion.copy(src.object.quaternion);
    copy.object.scale.copy(src.object.scale);
    if (src.kind === 'group') {
      for (const child of src.object.children) {
        const member = this.itemOf(child);
        if (member) copy.object.add(this.clone(member).object);
      }
    }
    return copy;
  }

  /** Every shape in an item (itself, or a group's shapes at any depth). */
  shapesOf(item: LabItem, out: LabItem[] = []): LabItem[] {
    if (item.kind !== 'group') out.push(item);
    else {
      const kids = item.object.children;
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        const member = kid && this.itemOf(kid);
        if (member) this.shapesOf(member, out);
      }
    }
    return out;
  }

  /** Material and outline for a shape (or every shape in a group) — HOVERED / SELECTED bits. */
  style(item: LabItem, state: number): void {
    const { mesh, outline } = item;
    if (!mesh || !outline) {
      const kids = item.object.children;
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        const member = kid && this.itemOf(kid);
        if (member) this.style(member, state);
      }
      return;
    }
    const key = (item.color * 3 + LOOKS.indexOf(item.look)) * 4 + state;
    if (key === item.styled) return;
    item.styled = key;
    const m = mesh.material;
    const glass = item.look === 'glass';
    m.color.setHex(item.color);
    m.emissive.setHex(item.color);
    m.emissiveIntensity =
      (item.look === 'glow' ? L.glow.emissive : 0) +
      (state & HOVERED ? L.highlight.hover : 0) +
      (state & SELECTED ? L.highlight.selected : 0);
    m.roughness = L.solid.roughness;
    m.metalness = L.solid.metalness;
    if (m.transparent !== glass) {
      m.transparent = glass;
      m.depthWrite = !glass;
      m.needsUpdate = true;
    }
    m.opacity = glass ? L.glass.opacity : 1;
    outline.visible = state !== 0;
    outline.material = state & SELECTED ? this.kit.selectLine : this.kit.hoverLine;
  }

  /** Middle of the items' bounds (world). */
  centerOf(items: readonly LabItem[], out: THREE.Vector3): THREE.Vector3 {
    this.box.makeEmpty();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item) this.box.expandByObject(item.object);
    }
    return this.box.isEmpty() ? out.set(0, 0, 0) : this.box.getCenter(out);
  }

  dispose(): void {
    for (const item of this.items.values()) item.mesh?.material.dispose();
    this.items.clear();
    this.kit.dispose();
    this.root.removeFromParent();
  }
}

// --- commands (every edit is one undo step) ------------------------------------------------------

/** Put items into the scene (already there when pushed after the fact, e.g. a menu spawn). */
export function addCommand(lab: LabScene, items: readonly LabItem[], label: string): Command {
  const list = items.slice();
  return {
    label,
    do: () => {
      for (const it of list) lab.root.add(it.object);
      lab.onChange();
    },
    undo: () => {
      for (const it of list) it.object.removeFromParent();
      lab.onChange();
    },
  };
}

export function removeCommand(lab: LabScene, items: readonly LabItem[], label: string): Command {
  const add = addCommand(lab, items, label);
  return { label, do: add.undo, undo: add.do };
}

/** Items from one set of poses to another (both copied). */
export function moveCommand(
  items: readonly LabItem[],
  before: readonly Pose[],
  after: readonly Pose[],
  label: string,
): Command {
  const list = items.slice();
  const b = before.slice(0, list.length).map(clonePose);
  const a = after.slice(0, list.length).map(clonePose);
  const apply = (poses: Pose[]): void => {
    list.forEach((it, i) => {
      const p = poses[i];
      if (p) applyPose(it.object, p);
    });
  };
  return { label, do: () => apply(a), undo: () => apply(b) };
}

/** New colour and / or look for shapes (null = keep). */
export function styleCommand(
  lab: LabScene,
  shapes: readonly LabItem[],
  color: number | null,
  look: ObjectLook | null,
  label: string,
): Command {
  const list = shapes.slice();
  const before = list.map((s) => ({ color: s.color, look: s.look }));
  return {
    label,
    do: () => {
      for (const s of list) {
        if (color !== null) s.color = color;
        if (look !== null) s.look = look;
      }
      lab.onChange();
    },
    undo: () => {
      list.forEach((s, i) => {
        const b = before[i];
        if (!b) return;
        s.color = b.color;
        s.look = b.look;
      });
      lab.onChange();
    },
  };
}

/** Members go into `group` (already placed where it should be), keeping where they are. */
export function groupCommand(lab: LabScene, group: LabItem, members: readonly LabItem[]): Command {
  const list = members.slice();
  const pose = readPose(group.object, makePose());
  return {
    label: 'Group',
    do: () => {
      applyPose(group.object, pose);
      lab.root.add(group.object);
      group.object.updateMatrixWorld(true);
      for (const m of list) group.object.attach(m.object);
      lab.onChange();
    },
    undo: () => {
      for (const m of list) lab.root.attach(m.object);
      group.object.removeFromParent();
      lab.onChange();
    },
  };
}

/** Each group's members back into the scene, keeping where they are; the groups go. */
export function ungroupCommand(lab: LabScene, groups: readonly LabItem[]): Command {
  const parts = groups.map((g) => ({
    group: g,
    members: g.object.children.map((c) => lab.itemOf(c)).filter((m) => m !== undefined),
  }));
  return {
    label: 'Ungroup',
    do: () => {
      for (const { group, members } of parts) {
        group.object.updateMatrixWorld(true);
        for (const m of members) lab.root.attach(m.object);
        group.object.removeFromParent();
      }
      lab.onChange();
    },
    undo: () => {
      for (const { group, members } of parts) {
        lab.root.add(group.object);
        group.object.updateMatrixWorld(true);
        for (const m of members) group.object.attach(m.object);
      }
      lab.onChange();
    },
  };
}

/** Several commands as one undo step (applied in order, undone in reverse). */
export function batchCommand(label: string, cmds: readonly Command[]): Command {
  const list = cmds.slice();
  return {
    label,
    do: () => {
      for (const c of list) c.do();
    },
    undo: () => {
      for (let i = list.length - 1; i >= 0; i--) list[i]?.undo();
    },
  };
}

// --- moving the selection as one ---------------------------------------------------------------

/**
 * Moves several items rigidly through one stand-in: `begin` places `handle` at a pivot (no turn,
 * size 1) and remembers every item; whatever then moves / turns / scales the handle, `sync()`
 * applies to the items (item = handle's change × item at begin). `end()` = the undo step.
 * Per frame nothing is allocated: a move writes positions; a turn / resize writes each item's
 * matrix (setting a quaternion would also re-derive Euler angles every frame), taken apart into
 * position / quaternion / scale once, at `end()` / `revert()`.
 */
export class SelectionRig {
  readonly handle = new THREE.Object3D();
  private readonly list: LabItem[] = [];
  private readonly before: Pose[] = [];
  private readonly base: THREE.Matrix4[] = [];
  private readonly pivot = new THREE.Vector3();
  private readonly handleInverse = new THREE.Matrix4();
  private readonly delta = new THREE.Matrix4();
  private readonly pose = makePose();
  private held = false;

  constructor() {
    // Setting a quaternion re-derives the Euler angles too (≈ 150 B of boxed numbers per frame);
    // nothing reads the handle's.
    this.handle.quaternion._onChange(() => {});
  }

  get active(): boolean {
    return this.held;
  }

  get items(): readonly LabItem[] {
    return this.list;
  }

  begin(items: readonly LabItem[], pivot: THREE.Vector3): void {
    this.list.length = 0;
    const h = this.handle;
    this.pivot.copy(pivot);
    h.position.copy(pivot);
    h.quaternion.identity();
    h.scale.set(1, 1, 1);
    h.updateMatrixWorld();
    this.handleInverse.copy(h.matrixWorld).invert();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const k = this.list.length;
      this.list.push(item);
      const before = this.before[k] ?? makePose();
      this.before[k] = before;
      readPose(item.object, before);
      item.object.updateMatrix();
      const base = this.base[k] ?? new THREE.Matrix4();
      this.base[k] = base;
      base.copy(item.object.matrix);
    }
    this.held = true;
  }

  /** Apply the handle's motion since begin() to every item. */
  sync(): void {
    if (!this.held) return;
    const h = this.handle;
    const q = h.quaternion;
    if (
      q.x === 0 &&
      q.y === 0 &&
      q.z === 0 &&
      h.scale.x === 1 &&
      h.scale.y === 1 &&
      h.scale.z === 1
    ) {
      // Only moved (a one-hand drag): shift each item, no matrices to take apart.
      const dx = h.position.x - this.pivot.x;
      const dy = h.position.y - this.pivot.y;
      const dz = h.position.z - this.pivot.z;
      for (let i = 0; i < this.list.length; i++) {
        const o = this.list[i]?.object;
        const b = this.before[i]?.position;
        if (!o || !b || !o.matrixAutoUpdate) continue;
        o.position.x = b.x + dx;
        o.position.y = b.y + dy;
        o.position.z = b.z + dz;
        o.updateMatrixWorld();
      }
      return;
    }
    h.updateMatrixWorld();
    this.delta.multiplyMatrices(h.matrixWorld, this.handleInverse);
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i]?.object;
      const b = this.base[i];
      if (!o || !b) continue;
      o.matrixAutoUpdate = false;
      o.matrix.multiplyMatrices(this.delta, b);
      o.matrixWorldNeedsUpdate = true;
      o.updateMatrixWorld();
    }
  }

  /** Position / quaternion / scale from the matrix a turn / resize wrote. */
  private settle(): void {
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i]?.object;
      if (!o || o.matrixAutoUpdate) continue;
      o.matrix.decompose(o.position, o.quaternion, o.scale);
      o.matrixAutoUpdate = true;
    }
  }

  /** Everything back to where it was at begin() (still held). */
  revert(): void {
    this.settle();
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i]?.object;
      const b = this.before[i];
      if (o && b) applyPose(o, b);
    }
  }

  /** Let go: the undo step for what moved (null if nothing did). */
  end(label: string): Command | null {
    if (!this.held) return null;
    this.held = false;
    this.settle();
    const after: Pose[] = [];
    let moved = false;
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i]?.object;
      const b = this.before[i];
      if (!o || !b) continue;
      readPose(o, this.pose);
      if (!samePose(b, this.pose)) moved = true;
      after.push(clonePose(this.pose));
    }
    return moved ? moveCommand(this.list, this.before, after, label) : null;
  }
}
