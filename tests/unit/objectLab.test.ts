// 3D Object Lab (Phase 11, §20): the shapes, commands and SelectionRig (objects.ts), the ring
// spawn menu, and the experience driven frame by frame — select, drag, push / pull, two-hand turn /
// resize, fist spin, copy / delete / group, undo — plus a heap-sampling check that its per-frame
// work allocates (almost) nothing.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { HandSide, ObjectLabUiState, SceneCursor, Vec2 } from '@/core/types';
import type { ObjectLabMode } from '@/modes/objectLab/ObjectLabMode';
import {
  addCommand,
  groupCommand,
  LabScene,
  OBJECT_KINDS,
  REST_QUATERNION,
  SelectionRig,
  ungroupCommand,
  type LabItem,
} from '@/modes/objectLab/objects';
import { CommandHistory } from '@/modes/shared/history';
import { allocationsPerFrame, ModeRig, movePalm } from '../fixtures/modeHarness';

const L = TUNING.objectLab;
const Z0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

function labRig() {
  const rig = new ModeRig('objectLab');
  const mode = rig.mc.activeMode as ObjectLabMode;
  const lab = mode.scene as LabScene;
  const history = rig.mc.history as CommandHistory;
  return { rig, mode, lab, history };
}

/** Point `side`'s cursor at NDC (x, y), with the hit Core's RaycastCursor would report. */
function aim(rig: ModeRig, lab: LabScene, side: HandSide, x: number, y: number): SceneCursor {
  rig.aim(side, { x, y });
  const c = rig.frame.cursors[side] as SceneCursor;
  rig.base.coords.ndcToScreen(c.ndc, c.screen);
  lab.root.updateMatrixWorld(true);
  const ray = rig.base.coords.rayThrough(c.ndc);
  const first = ray.intersectObject(lab.root, true).find((h) => h.object.visible);
  if (first) {
    let o: THREE.Object3D | null = first.object;
    let id: unknown;
    while (o && id === undefined) {
      id = o.userData.gsId;
      o = o.parent;
    }
    const { x: px, y: py, z: pz } = first.point;
    c.hit = {
      point: { x: px, y: py, z: pz },
      kind: 'object',
      objectId: typeof id === 'string' ? id : undefined,
    };
  } else {
    const p = new THREE.Vector3();
    c.hit = ray.ray.intersectPlane(Z0, p)
      ? { point: { x: p.x, y: p.y, z: p.z }, kind: 'plane' }
      : undefined;
  }
  return c;
}

const ndcOf = (rig: ModeRig, p: THREE.Vector3): Vec2 => {
  const v = p.clone().project(rig.base.camera);
  return { x: v.x, y: v.y };
};

const world = (item: LabItem, local: THREE.Vector3): THREE.Vector3 =>
  item.object.localToWorld(local.clone());

/** Spawn from the tool panel and let it finish popping in. */
function spawn(rig: ModeRig, mode: ObjectLabMode, kind: (typeof OBJECT_KINDS)[number]['kind']) {
  rig.mc.handleAction({ type: 'objectSpawn', kind });
  rig.run(20);
  const item = mode.selected[0];
  if (!item) throw new Error('nothing spawned');
  return item;
}

const angleBetween = (a: THREE.Quaternion, b: THREE.Quaternion): number =>
  2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

/** Pinch on `item` (at its middle), drag the fingertip by NDC (dx, dy) over `frames`, release. */
function drag(
  rig: ModeRig,
  lab: LabScene,
  item: LabItem,
  dx: number,
  dy: number,
  frames = 20,
  side: HandSide = 'right',
): void {
  const start = ndcOf(rig, item.object.getWorldPosition(new THREE.Vector3()));
  rig.show(side);
  aim(rig, lab, side, start.x, start.y);
  rig.step();
  rig.pinch(side, true);
  rig.step();
  for (let i = 1; i <= frames; i++) {
    aim(rig, lab, side, start.x + (dx * i) / frames, start.y + (dy * i) / frames);
    rig.step();
  }
  rig.pinch(side, false);
  rig.step();
}

function tap(rig: ModeRig, lab: LabScene, x: number, y: number, side: HandSide = 'right'): void {
  rig.show(side);
  aim(rig, lab, side, x, y);
  rig.step();
  rig.pinch(side, true);
  rig.step();
  rig.pinch(side, false);
  rig.step();
}

describe('objects: shapes, groups, commands', () => {
  it('shares one geometry per kind; every shape has its own material and a fitted outline', () => {
    const lab = new LabScene();
    const shapes: LabItem[] = [];
    for (let i = 0; i < 20; i++) {
      const kind = OBJECT_KINDS[i % OBJECT_KINDS.length]?.kind ?? 'cube';
      shapes.push(lab.makeShape(kind, 0x21d4d8, 'solid'));
    }
    expect(lab.kit.geometryCount).toBe(5);
    expect(new Set(shapes.map((s) => s.mesh?.material)).size).toBe(20);
    for (const s of shapes) {
      const box = new THREE.Box3().setFromBufferAttribute(
        s.mesh?.geometry.getAttribute('position') as THREE.BufferAttribute,
      );
      const size = box.getSize(new THREE.Vector3());
      expect(s.outline?.scale.x).toBeCloseTo(size.x * (1 + L.outline.pad), 5);
      expect(s.outline?.scale.z).toBeCloseTo(size.z * (1 + L.outline.pad), 5);
      expect(s.object.quaternion.equals(REST_QUATERNION)).toBe(true);
      // About 3 units across (≈ 16% of the view height), none tiny or huge.
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(2.3);
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(3.2);
    }
    lab.dispose();
  });

  it('a copy is deep (groups too), with new ids, in the same pose', () => {
    const lab = new LabScene();
    const a = lab.makeShape('cube', 0xff0000, 'glow');
    const b = lab.makeShape('torus', 0x00ff00, 'glass');
    b.object.position.set(3, 0, 0);
    const g = lab.makeGroup();
    const history = new CommandHistory();
    history.execute(addCommand(lab, [a, b], 'Add'));
    history.execute(groupCommand(lab, g, [a, b]));
    g.object.position.set(1, 2, 3);
    g.object.rotation.set(0.1, 0.2, 0.3);
    const copy = lab.clone(g);
    expect(copy.id).not.toBe(g.id);
    expect(copy.object.position.equals(g.object.position)).toBe(true);
    expect(copy.object.quaternion.equals(g.object.quaternion)).toBe(true);
    const members = lab.shapesOf(copy);
    expect(members.map((m) => m.kind)).toEqual(['cube', 'torus']);
    expect(members.map((m) => m.color)).toEqual([0xff0000, 0x00ff00]);
    expect(members.map((m) => m.look)).toEqual(['glow', 'glass']);
    for (const m of members) {
      expect([a.id, b.id]).not.toContain(m.id);
      expect([a.mesh?.material, b.mesh?.material]).not.toContain(m.mesh?.material);
    }
    lab.dispose();
  });

  it('group / ungroup keep every shape where it is; undo / redo both ways', () => {
    const lab = new LabScene();
    const history = new CommandHistory();
    const a = lab.makeShape('cube', 1, 'solid');
    const b = lab.makeShape('sphere', 2, 'solid');
    a.object.position.set(-2, 1, 0);
    b.object.position.set(3, -1, 2);
    b.object.rotation.set(0.4, 0.2, 0);
    history.execute(addCommand(lab, [a, b], 'Add'));
    const where = () => [a, b].map((s) => s.object.getWorldPosition(new THREE.Vector3()));
    const at0 = where();
    const g = lab.makeGroup();
    g.object.position.set(0.5, 0, 1);
    history.execute(groupCommand(lab, g, [a, b]));
    expect(lab.count).toBe(1);
    expect(lab.topOf(a.id)).toBe(g);
    where().forEach((p, i) => expect(p.distanceTo(at0[i] as THREE.Vector3)).toBeLessThan(1e-9));
    // Moving the group moves both.
    g.object.position.x += 4;
    g.object.updateMatrixWorld(true);
    where().forEach((p, i) => expect(p.x - (at0[i]?.x ?? 0)).toBeCloseTo(4, 9));
    history.execute(ungroupCommand(lab, [g]));
    expect(lab.count).toBe(2);
    expect(g.object.parent).toBeNull();
    where().forEach((p, i) => expect(p.x - (at0[i]?.x ?? 0)).toBeCloseTo(4, 9));
    history.undo(); // regroup
    expect(lab.count).toBe(1);
    history.undo(); // ungroup (the group's move isn't a command here)
    expect(lab.count).toBe(2);
    expect(lab.topOf(a.id)).toBe(a);
    lab.dispose();
  });

  it('SelectionRig: whatever moves the handle moves every item rigidly; end() = one undo step', () => {
    const lab = new LabScene();
    const a = lab.makeShape('cube', 1, 'solid');
    const b = lab.makeShape('sphere', 1, 'solid');
    a.object.position.set(-2, 0, 0);
    b.object.position.set(2, 1, -1);
    lab.root.add(a.object, b.object);
    const before = [a, b].map((s) => s.object.quaternion.clone());
    const rig = new SelectionRig();
    const pivot = new THREE.Vector3(0, 0.5, -0.5);
    rig.begin([a, b], pivot);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2));
    rig.handle.quaternion.copy(turn);
    rig.handle.scale.setScalar(2);
    rig.handle.position.set(1, 1, 1);
    rig.sync();
    // While held the items move through their matrices; the undo step (end) settles their poses.
    const onScreen = a.object.getWorldPosition(new THREE.Vector3());
    const cmd = rig.end('Move');
    expect(onScreen.distanceTo(a.object.position)).toBeLessThan(1e-9);
    // Positions: pivot → new handle position, offsets turned and doubled.
    const expectAt = (p0: THREE.Vector3) =>
      p0.clone().sub(pivot).applyQuaternion(turn).multiplyScalar(2).add(rig.handle.position);
    expect(a.object.position.distanceTo(expectAt(new THREE.Vector3(-2, 0, 0)))).toBeLessThan(1e-9);
    expect(b.object.position.distanceTo(expectAt(new THREE.Vector3(2, 1, -1)))).toBeLessThan(1e-9);
    // Orientations turned by the same amount, sizes doubled.
    [a, b].forEach((s, i) => {
      const want = turn.clone().multiply(before[i] as THREE.Quaternion);
      expect(angleBetween(s.object.quaternion, want)).toBeLessThan(1e-6);
      expect(s.object.scale.x).toBeCloseTo(2, 9);
    });
    expect(cmd).not.toBeNull();
    cmd?.undo();
    expect(a.object.position.x).toBeCloseTo(-2, 9);
    expect(b.object.scale.x).toBeCloseTo(1, 9);
    cmd?.do();
    expect(b.object.scale.x).toBeCloseTo(2, 9);
    // Nothing moved → no undo step.
    rig.begin([a], pivot);
    expect(rig.end('Move')).toBeNull();
    lab.dispose();
  });
});

describe('ObjectLabMode: making and selecting shapes', () => {
  it('tool panel: a shape in the middle, selected; the next steps aside; each one undo step', () => {
    const ui: ObjectLabUiState[] = [];
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    expect(cube.object.position.length()).toBe(0);
    expect(cube.mesh?.scale.x).toBe(1); // popped in
    expect(cube.outline?.visible).toBe(true); // selected: amber box
    const sphere = spawn(rig, mode, 'sphere');
    expect(sphere.object.position.distanceTo(cube.object.position)).toBeCloseTo(L.spawnSpacing, 9);
    expect(mode.selected).toEqual([sphere]);
    expect(history.undoLabel).toBe('Add Sphere');
    for (const u of rig.ui) if (u.objectLab) ui.push(u.objectLab);
    expect(ui.at(-1)).toMatchObject({ count: 2, selected: 1, canGroup: false });
    history.undo();
    expect(lab.count).toBe(1);
    expect(mode.selected).toEqual([]); // the removed shape left the selection
    history.redo();
    expect(lab.count).toBe(2);
    rig.mc.dispose();
  });

  it('point + pinch selects and picks up; the grabbed spot stays under the fingertip; one step', () => {
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    rig.mc.handleAction({ type: 'escape' });
    expect(mode.selected).toEqual([]);
    rig.show('right');
    const c = aim(rig, lab, 'right', 0.03, 0.02);
    rig.step();
    expect(c.hit?.objectId).toBe(cube.id);
    expect(cube.outline?.visible).toBe(true); // hovered: faint box
    expect(cube.outline?.material).toBe(lab.kit.hoverLine);
    const spot = cube.object.worldToLocal(
      new THREE.Vector3(c.hit?.point.x, c.hit?.point.y, c.hit?.point.z),
    );
    // A still pinch: selected, nothing to undo.
    rig.pinch('right', true);
    rig.step();
    expect(mode.selected).toEqual([cube]);
    expect(cube.outline?.material).toBe(lab.kit.selectLine);
    rig.pinch('right', false);
    rig.step();
    expect(history.undoLabel).toBe('Add Cube');
    // Pinch and drag: it follows, the grabbed spot exactly under the fingertip.
    rig.pinch('right', true);
    rig.step();
    for (let i = 1; i <= 30; i++) {
      aim(rig, lab, 'right', 0.03 + 0.4 * (i / 30), 0.02 - 0.25 * (i / 30));
      rig.step();
      const under = ndcOf(rig, world(cube, spot));
      expect(Math.abs(under.x - c.ndc.x) * 640).toBeLessThan(0.01); // px
      expect(Math.abs(under.y - c.ndc.y) * 360).toBeLessThan(0.01);
    }
    expect(cube.object.position.x).toBeGreaterThan(5);
    expect(cube.object.position.z).toBeCloseTo(0, 6); // same depth
    rig.pinch('right', false);
    rig.step();
    expect(history.undoLabel).toBe('Move shape');
    history.undo();
    expect(cube.object.position.length()).toBeLessThan(1e-9);
    rig.mc.dispose();
  });

  it('a tap on empty space deselects; a drag on empty space does not', () => {
    const { rig, mode, lab } = labRig();
    const cube = spawn(rig, mode, 'cube');
    rig.show('right');
    aim(rig, lab, 'right', -0.8, 0.8);
    rig.step();
    rig.pinch('right', true);
    rig.step();
    for (let i = 1; i <= 10; i++) {
      aim(rig, lab, 'right', -0.8 + 0.03 * i, 0.8);
      rig.step();
    }
    rig.pinch('right', false);
    rig.step();
    expect(mode.selected).toEqual([cube]);
    tap(rig, lab, -0.8, 0.8);
    expect(mode.selected).toEqual([]);
    rig.mc.dispose();
  });

  it('Add to selection: pinches collect shapes, a tap drops one, a drag moves them all as one', () => {
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    const sphere = spawn(rig, mode, 'sphere');
    const torus = spawn(rig, mode, 'cylinder'); // (a donut's middle is empty space)
    rig.mc.handleAction({ type: 'objectMulti' });
    rig.mc.handleAction({ type: 'escape' });
    const at = (s: LabItem) => ndcOf(rig, s.object.position);
    for (const s of [cube, sphere, torus]) tap(rig, lab, at(s).x, at(s).y);
    expect(mode.selected).toEqual([cube, sphere, torus]);
    tap(rig, lab, at(torus).x, at(torus).y); // tap a selected one: dropped
    expect(mode.selected).toEqual([cube, sphere]);
    const gap = sphere.object.position.clone().sub(cube.object.position);
    const torusAt = torus.object.position.clone();
    drag(rig, lab, cube, 0, -0.3);
    expect(cube.object.position.y).toBeLessThan(-2);
    expect(sphere.object.position.clone().sub(cube.object.position).distanceTo(gap)).toBeLessThan(
      1e-9,
    );
    expect(torus.object.position.equals(torusAt)).toBe(true);
    expect(history.undoLabel).toBe('Move 2 shapes');
    rig.mc.dispose();
  });
});

describe('ObjectLabMode: depth', () => {
  it('push / pull while holding: nearer / farther, still under the fingertip; Q / E too', () => {
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    const cam = rig.base.camera.position;
    const dist = () => cam.z - cube.object.position.z;
    rig.show('right');
    const c = aim(rig, lab, 'right', 0.02, 0.01);
    const spot = cube.object.worldToLocal(
      new THREE.Vector3(c.hit?.point.x, c.hit?.point.y, c.hit?.point.z),
    );
    rig.pinch('right', true);
    rig.step();
    const d0 = dist();
    // Pull the hand toward the camera: 0.1 of depth signal = 2 steps = 4 units nearer.
    rig.gestures('right').depthSignal = 0.1;
    rig.run(40);
    expect(d0 - dist()).toBeCloseTo(2 * L.depth.unitsPerStep, 1);
    const under = ndcOf(rig, world(cube, spot));
    expect(Math.abs(under.x - c.ndc.x) * 640).toBeLessThan(0.01);
    // Q while holding: one step back.
    rig.mc.handleAction({ type: 'depthDown' });
    rig.run(40);
    expect(d0 - dist()).toBeCloseTo(L.depth.unitsPerStep, 1);
    // A strong pull stops at the near limit.
    rig.gestures('right').depthSignal = 3;
    rig.run(60);
    expect(dist()).toBeGreaterThanOrEqual(L.distance.min - 1.5); // grabbed spot at min; centre ≈ 1.2 behind
    rig.pinch('right', false);
    rig.step();
    expect(history.undoLabel).toBe('Move shape');
    history.undo();
    // E with nothing held: the selection one step nearer, staying put on screen.
    const before = ndcOf(rig, cube.object.position);
    const d1 = dist();
    rig.mc.handleAction({ type: 'depthUp' });
    expect(d1 - dist()).toBeGreaterThan(L.depth.unitsPerStep * 0.95);
    const after = ndcOf(rig, cube.object.position);
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    expect(history.undoLabel).toBe('Move nearer');
    rig.mc.dispose();
  });
});

describe('ObjectLabMode: two hands and a fist', () => {
  function twoHandRig() {
    const r = labRig();
    r.rig.trackTwoHands();
    return r;
  }

  /** Both hands pinch at view points, then move to new ones over `frames`, then let go. */
  function grab(
    rig: ModeRig,
    from: [Vec2, Vec2],
    to: [Vec2, Vec2],
    frames = 30,
    release = true,
  ): void {
    const [l0, r0] = from;
    const [l1, r1] = to;
    rig.show('left', l0.x, l0.y);
    rig.show('right', r0.x, r0.y);
    rig.step();
    rig.pinch('left', true);
    rig.pinch('right', true);
    rig.step();
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      rig.show('left', l0.x + (l1.x - l0.x) * t, l0.y + (l1.y - l0.y) * t);
      rig.show('right', r0.x + (r1.x - r0.x) * t, r0.y + (r1.y - r0.y) * t);
      rig.step();
    }
    rig.run(10);
    if (!release) return;
    rig.pinch('left', false);
    rig.pinch('right', false);
    rig.step();
  }

  it('turn / resize the selection with both hands; one undo step', () => {
    const { rig, mode, history } = twoHandRig();
    const cube = spawn(rig, mode, 'cube');
    grab(
      rig,
      [
        { x: 0.4, y: 0.5 },
        { x: 0.6, y: 0.5 },
      ],
      [
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
    );
    expect(cube.object.scale.x).toBeCloseTo(2, 3);
    expect(history.undoLabel).toBe('Turn / resize');
    // Tilt the hand line 30° (hands 0.4 apart, aspect-corrected).
    const a = (30 * Math.PI) / 180;
    const half = 0.2;
    const asp = 1280 / 720;
    const tilt: [Vec2, Vec2] = [
      { x: 0.5 - (half * Math.cos(a)) / asp, y: 0.5 - half * Math.sin(a) },
      { x: 0.5 + (half * Math.cos(a)) / asp, y: 0.5 + half * Math.sin(a) },
    ];
    const level: [Vec2, Vec2] = [
      { x: 0.5 - half / asp, y: 0.5 },
      { x: 0.5 + half / asp, y: 0.5 },
    ];
    grab(rig, level, tilt);
    expect(angleBetween(cube.object.quaternion, REST_QUATERNION)).toBeCloseTo(a, 2);
    history.undo();
    history.undo();
    expect(cube.object.scale.x).toBeCloseTo(1, 9);
    expect(angleBetween(cube.object.quaternion, REST_QUATERNION)).toBeLessThan(1e-6);
    rig.mc.dispose();
  });

  it('several selected shapes turn / resize as one; each shape keeps within its size limits', () => {
    const { rig, mode, lab } = twoHandRig();
    const cube = spawn(rig, mode, 'cube');
    const sphere = spawn(rig, mode, 'sphere');
    rig.mc.handleAction({ type: 'objectMulti' });
    tap(rig, lab, ndcOf(rig, cube.object.position).x, ndcOf(rig, cube.object.position).y);
    expect(mode.selected).toEqual([sphere, cube]);
    rig.hide('right');
    const gap0 = cube.object.position.distanceTo(sphere.object.position);
    const wide: [Vec2, Vec2] = [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ];
    const narrow: [Vec2, Vec2] = [
      { x: 0.45, y: 0.5 },
      { x: 0.55, y: 0.5 },
    ];
    grab(rig, narrow, wide); // × 5 asked
    expect(cube.object.scale.x).toBeCloseTo(5, 3);
    expect(cube.object.position.distanceTo(sphere.object.position) / gap0).toBeCloseTo(5, 3);
    grab(rig, narrow, wide); // another × 5 asked: stops at the shape's limit
    expect(cube.object.scale.x).toBeCloseTo(L.scaleRange.max, 3);
    expect(sphere.object.scale.x).toBeCloseTo(L.scaleRange.max, 3);
    rig.mc.dispose();
  });

  it('a second hand joining at once cancels the first hand’s drag but keeps what it selected', () => {
    const { rig, mode, lab, history } = twoHandRig();
    const cube = spawn(rig, mode, 'cube');
    rig.mc.handleAction({ type: 'escape' });
    rig.show('right', 0.55, 0.5);
    aim(rig, lab, 'right', 0.02, 0.02);
    rig.step();
    rig.pinch('right', true);
    rig.step();
    aim(rig, lab, 'right', 0.2, 0.02); // the drag moves it…
    rig.step();
    expect(cube.object.position.x).toBeGreaterThan(1);
    rig.show('left', 0.45, 0.5);
    rig.pinch('left', true); // …but 33 ms later the second hand pinches
    rig.step();
    expect(cube.object.position.length()).toBeLessThan(1e-9); // put back
    expect(mode.selected).toEqual([cube]); // still selected: both hands now hold it
    rig.run(5);
    rig.pinch('left', false);
    rig.pinch('right', false);
    rig.step();
    expect(history.undoLabel).toBe('Add Cube'); // no stray move step
    rig.mc.dispose();
  });

  it('fist + drag spins the selection in 3D about its middle; one undo step', () => {
    const { rig, mode, history } = labRig();
    const a = spawn(rig, mode, 'cube');
    const b = spawn(rig, mode, 'cylinder');
    rig.mc.handleAction({ type: 'objectMulti' });
    rig.mc.handleAction({ type: 'escape' });
    const lab = mode.scene as LabScene;
    for (const s of [a, b])
      tap(rig, lab, ndcOf(rig, s.object.position).x, ndcOf(rig, s.object.position).y);
    const middle = lab.centerOf([a, b], new THREE.Vector3());
    const r0 = [a, b].map((s) => s.object.position.distanceTo(middle));
    const hand = rig.show('right');
    movePalm(hand, 0.5, 0.5);
    rig.grab('right', true);
    for (let i = 0; i <= 40; i++) {
      movePalm(hand, 0.5 + 0.004 * i, 0.5);
      rig.step();
    }
    rig.grab('right', false);
    rig.step();
    expect(angleBetween(a.object.quaternion, REST_QUATERNION)).toBeGreaterThan(0.3);
    [a, b].forEach((s, i) =>
      expect(s.object.position.distanceTo(middle)).toBeCloseTo(r0[i] ?? 0, 6),
    );
    expect(history.undoLabel).toBe('Spin shapes');
    history.undo();
    expect(angleBetween(a.object.quaternion, REST_QUATERNION)).toBeLessThan(1e-6);
    rig.mc.dispose();
  });
});

describe('ObjectLabMode: editing the selection', () => {
  it('D copies (offset, selected), Delete removes, C clears — each one undo step', () => {
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    rig.mc.handleAction({ type: 'duplicate' });
    const copy = mode.selected[0] as LabItem;
    expect(copy).not.toBe(cube);
    expect(copy.object.position.x - cube.object.position.x).toBeCloseTo(L.duplicateOffset, 9);
    expect(copy.object.position.y - cube.object.position.y).toBeCloseTo(-L.duplicateOffset, 9);
    expect(history.undoLabel).toBe('Copy shape');
    rig.mc.handleAction({ type: 'delete' });
    expect(lab.count).toBe(1);
    expect(mode.selected).toEqual([]);
    history.undo();
    expect(lab.count).toBe(2);
    rig.mc.clear();
    expect(lab.count).toBe(0);
    expect(history.undoLabel).toBe('Clear');
    history.undo();
    expect(lab.count).toBe(2);
    rig.mc.dispose();
  });

  it('G groups (pointing at one member picks the group) and ungroups in place', () => {
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    const sphere = spawn(rig, mode, 'sphere');
    rig.mc.handleAction({ type: 'objectMulti' });
    const at = (s: LabItem) => ndcOf(rig, s.object.getWorldPosition(new THREE.Vector3()));
    tap(rig, lab, at(cube).x, at(cube).y);
    rig.mc.handleAction({ type: 'objectMulti' }); // off again
    rig.mc.handleAction({ type: 'group' });
    expect(lab.count).toBe(1);
    const group = mode.selected[0] as LabItem;
    expect(group.kind).toBe('group');
    rig.mc.handleAction({ type: 'escape' });
    const sphereAt = sphere.object.getWorldPosition(new THREE.Vector3());
    drag(rig, lab, sphere, 0, 0.2); // grabbing the sphere moves the whole group
    expect(mode.selected).toEqual([group]);
    const moved = sphere.object.getWorldPosition(new THREE.Vector3()).sub(sphereAt);
    const cubeMoved = cube.object.getWorldPosition(new THREE.Vector3());
    expect(moved.y).toBeGreaterThan(1);
    expect(cubeMoved.y).toBeCloseTo(moved.y, 9);
    rig.mc.handleAction({ type: 'group' }); // one group selected: G ungroups
    expect(lab.count).toBe(2);
    expect(new Set(mode.selected)).toEqual(new Set([cube, sphere]));
    expect(cube.object.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(moved.y, 9);
    expect(history.undoLabel).toBe('Ungroup');
    history.undo();
    history.undo();
    history.undo();
    expect(lab.count).toBe(2);
    expect(cube.object.position.y).toBeCloseTo(0, 9);
    rig.mc.dispose();
  });

  it('colour and look apply to new shapes and restyle the selection (undoable)', () => {
    const { rig, mode, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    rig.mc.handleAction({ type: 'objectColor', color: '#ff3dcb' });
    rig.mc.handleAction({ type: 'objectLook', look: 'glass' });
    expect(cube.color).toBe(0xff3dcb);
    expect(cube.look).toBe('glass');
    expect(cube.mesh?.material.transparent).toBe(true);
    expect(cube.mesh?.material.opacity).toBe(L.glass.opacity);
    history.undo();
    expect(cube.look).toBe('solid');
    expect(cube.mesh?.material.transparent).toBe(false);
    history.undo();
    expect(cube.color).toBe(0x21d4d8);
    const sphere = spawn(rig, mode, 'sphere');
    expect(sphere.color).toBe(0xff3dcb); // the chosen colour stays for new shapes
    rig.mc.dispose();
  });

  it('R turns the selection back upright at its made size, where it is (one undo step)', () => {
    const { rig, mode, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    cube.object.position.set(2, 1, -3);
    cube.object.rotation.set(1, 2, 0.5);
    cube.object.scale.setScalar(2.5);
    rig.mc.resetView();
    expect(cube.object.position.toArray()).toEqual([2, 1, -3]);
    expect(angleBetween(cube.object.quaternion, REST_QUATERNION)).toBeLessThan(1e-6);
    expect(cube.object.scale.x).toBe(1);
    history.undo();
    expect(cube.object.scale.x).toBe(2.5);
    rig.mc.dispose();
  });
});

describe('ObjectLabMode: the ring spawn menu', () => {
  function openMenu(rig: ModeRig, lab: LabScene, mode: ObjectLabMode) {
    rig.show('right');
    aim(rig, lab, 'right', 0.1, 0.1);
    const g = rig.gestures('right');
    g.openPalm.phase = 'active';
    rig.run(Math.ceil(TUNING.gestures.HOLD_MS / (1000 / 60)) + 2);
    expect(mode.spawnMenu.state).toBe('open');
    g.openPalm.phase = 'idle'; // the hand closes to point and pinch
    return g;
  }

  function aimItem(rig: ModeRig, lab: LabScene, mode: ObjectLabMode, i: number) {
    const s = mode.spawnMenu.itemCenter(i, { x: 0, y: 0 });
    const n = rig.base.coords.screenToNdc(s, { x: 0, y: 0 });
    return aim(rig, lab, 'right', n.x, n.y);
  }

  it('hold the hand open and still → it opens; moving the hand restarts the wait', () => {
    const { rig, mode, lab } = labRig();
    const hand = rig.show('right');
    aim(rig, lab, 'right', 0.1, 0.1);
    rig.gestures('right').openPalm.phase = 'active';
    rig.run(20); // 333 ms
    expect(mode.spawnMenu.state).toBe('charging');
    movePalm(hand, 0.3, 0.3); // the hand moves: start again
    rig.run(30); // 500 ms since
    expect(mode.spawnMenu.state).toBe('charging');
    rig.run(10);
    expect(mode.spawnMenu.state).toBe('open');
    expect(rig.statuses.at(-1)).toContain('Shape menu');
    rig.mc.dispose();
  });

  it('pinch a shape: it appears under the fingertip, held; dropping it is one "Add" step', () => {
    const { rig, mode, lab, history } = labRig();
    openMenu(rig, lab, mode);
    const c = aimItem(rig, lab, mode, 1);
    rig.step();
    expect(mode.spawnMenu.hover).toBe(1);
    rig.pinch('right', true);
    rig.step();
    expect(mode.spawnMenu.state).toBe('closed');
    expect(lab.count).toBe(1);
    const sphere = lab.top(0) as LabItem;
    expect(sphere.kind).toBe(OBJECT_KINDS[1]?.kind);
    expect(mode.selected).toEqual([sphere]);
    const under = ndcOf(rig, sphere.object.position);
    expect(Math.abs(under.x - c.ndc.x) * 640).toBeLessThan(0.01);
    expect(sphere.object.position.z).toBeCloseTo(0, 9);
    for (let i = 1; i <= 20; i++) {
      aim(rig, lab, 'right', c.ndc.x - 0.02 * i, c.ndc.y - 0.01 * i);
      rig.step();
    }
    rig.pinch('right', false);
    rig.step();
    expect(history.undoLabel).toBe('Add Sphere');
    const dropped = sphere.object.position.clone();
    history.undo();
    expect(lab.count).toBe(0);
    history.redo();
    expect(sphere.object.position.equals(dropped)).toBe(true);
    rig.mc.dispose();
  });

  it('a pinch away from the items closes it and picks nothing', () => {
    const { rig, mode, lab } = labRig();
    openMenu(rig, lab, mode);
    rig.pinch('right', true);
    rig.step(); // in the middle
    expect(mode.spawnMenu.state).toBe('closed');
    expect(lab.count).toBe(0);
    expect(mode.selected).toEqual([]);
    expect(rig.base.capture.count).toBe(0); // the pinch was used up: no tap / drag
    rig.mc.dispose();
  });

  it('unused, it closes by itself — and stays shut until the hand opens afresh', () => {
    const { rig, mode, lab } = labRig();
    const g = openMenu(rig, lab, mode);
    g.openPalm.phase = 'active'; // the hand just stays open
    rig.run(Math.ceil(L.menu.closeMs / (1000 / 60)) + 5);
    expect(mode.spawnMenu.state).toBe('closed');
    rig.run(60);
    expect(mode.spawnMenu.state).toBe('closed');
    g.openPalm.phase = 'idle';
    rig.step();
    openMenu(rig, lab, mode); // a fresh open hand: it opens again
    rig.mc.dispose();
  });
});

describe('ObjectLabMode: hands renamed, switching away, cleaning up', () => {
  it('left / right renamed mid-drag (D42): the shape keeps following the same hand', () => {
    const { rig, mode, lab } = labRig();
    const cube = spawn(rig, mode, 'cube');
    rig.show('right');
    aim(rig, lab, 'right', 0.02, 0.02);
    rig.step();
    rig.pinch('right', true);
    rig.step();
    // The tracker renames the holding hand: Core moves the captures and tells the mode.
    const f = rig.frame;
    f.hands.left = f.hands.right;
    f.gestures.left = f.gestures.right;
    f.cursors.left = f.cursors.right ? { ...f.cursors.right, side: 'left' } : undefined;
    rig.hide('right');
    rig.base.capture.swapSides();
    rig.mc.swapSides();
    for (let i = 1; i <= 10; i++) {
      aim(rig, lab, 'left', 0.02 + 0.03 * i, 0.02);
      rig.step();
    }
    expect(rig.base.capture.get('left')?.targetId).toBe('lab-drag');
    expect(cube.object.position.x).toBeGreaterThan(3);
    rig.mc.dispose();
  });

  it('switching away mid-drag drops it as an undo step; switching back shows the shapes', () => {
    const { rig, mode, lab, history } = labRig();
    const cube = spawn(rig, mode, 'cube');
    rig.show('right');
    aim(rig, lab, 'right', 0.02, 0.02);
    rig.step();
    rig.pinch('right', true);
    rig.step();
    aim(rig, lab, 'right', 0.3, 0.02);
    rig.step();
    rig.mc.switchTo('voxel');
    expect(lab.root.visible).toBe(false);
    expect(rig.base.capture.count).toBe(0);
    rig.mc.switchTo('objectLab');
    expect(lab.root.visible).toBe(true);
    expect(rig.mc.history?.undoLabel).toBe('Move shape');
    expect(cube.object.position.x).toBeGreaterThan(2);
    expect(history).toBe(rig.mc.history);
    rig.mc.dispose();
    expect(rig.base.scene.getObjectByName('Mode:objectLab')).toBeUndefined();
  });

  it('dispose frees every material and the shared geometry', () => {
    const { rig, mode, lab } = labRig();
    const disposed: string[] = [];
    const shapes = OBJECT_KINDS.map(({ kind }) => spawn(rig, mode, kind));
    rig.mc.handleAction({ type: 'delete' }); // one removed but undoable: still freed on dispose
    for (const s of shapes) s.mesh?.material.addEventListener('dispose', () => disposed.push(s.id));
    const geometries = new Set(shapes.map((s) => s.mesh?.geometry));
    let geoFreed = 0;
    for (const g of geometries) g?.addEventListener('dispose', () => geoFreed++);
    expect(lab.kit.geometryCount).toBe(5);
    rig.mc.dispose();
    expect(disposed).toHaveLength(5);
    expect(geoFreed).toBe(5);
  });
});

describe('ObjectLabMode allocates (almost) nothing per frame (heap sampling)', () => {
  // allocationsPerFrame (modeHarness) counts what Object Lab code allocates, library calls
  // included. One window = four long, steady interactions (50 s each at 60 Hz): a drag over the
  // other shapes with push / pull, a two-hand turn / resize, a fist spin, and the ring menu with
  // the fingertip wandering over its items. Measured: ≈ 3 / 43 / 5 / 5–28 B per frame, all boxed
  // decimals in three.js / the shared two-hand code (no objects); each grab's start / end (its
  // undo step, status, tool panel) allocates a little, once. A per-frame `new THREE.Vector3()`
  // added ≈ 100 B / frame in every one of the four.
  const BUDGET_PER_FRAME = 40; // bytes

  it('drag, two hands, fist, menu: under 40 bytes per frame from the Object Lab code', async () => {
    const { rig, mode, lab } = labRig();
    rig.trackTwoHands();
    for (const { kind } of OBJECT_KINDS) spawn(rig, mode, kind);
    const cube = lab.top(0) as LabItem;
    const FRAMES = 3000;
    let frames = 0;
    const run = (n: number, each: (i: number) => void): void => {
      for (let i = 0; i < n; i++) {
        each(i);
        rig.step();
        frames++;
      }
    };
    const workout = (): number => {
      frames = 0;
      // 1. Drag a shape round in circles over the others, pulling and pushing.
      rig.hide('left');
      rig.mc.handleAction({ type: 'escape' });
      const c0 = ndcOf(rig, cube.object.position);
      rig.show('right');
      aim(rig, lab, 'right', c0.x, c0.y);
      rig.step();
      rig.pinch('right', true);
      run(FRAMES, (i) => {
        const a = (i / FRAMES) * Math.PI * 8;
        aim(rig, lab, 'right', c0.x + 0.3 * Math.sin(a), c0.y + 0.2 * Math.sin(2 * a));
        rig.gestures('right').depthSignal = 0.08 * Math.sin(a);
      });
      rig.gestures('right').depthSignal = 0;
      rig.pinch('right', false);
      rig.step();
      // 2. Both hands turn / resize it.
      rig.show('left', 0.4, 0.5);
      rig.show('right', 0.6, 0.5);
      rig.step();
      rig.pinch('left', true);
      rig.pinch('right', true);
      run(FRAMES, (i) => {
        const a = (i / FRAMES) * Math.PI * 8;
        rig.show('left', 0.4 - 0.05 * Math.sin(a), 0.5 + 0.05 * Math.sin(a));
        rig.show('right', 0.6 + 0.05 * Math.sin(a), 0.5 - 0.05 * Math.sin(a));
      });
      rig.pinch('left', false);
      rig.pinch('right', false);
      rig.step();
      rig.hide('left');
      // 3. A fist spins it.
      const hand = rig.show('right');
      rig.grab('right', true);
      run(FRAMES, (i) => movePalm(hand, 0.5 + 0.1 * Math.sin((i / FRAMES) * Math.PI * 8), 0.5));
      rig.grab('right', false);
      rig.step();
      // 4. The ring menu, the fingertip wandering round its items.
      movePalm(hand, 0.5, 0.5);
      const g = rig.gestures('right');
      g.openPalm.phase = 'active';
      aim(rig, lab, 'right', 0.1, 0.1);
      rig.run(45);
      g.openPalm.phase = 'idle';
      const p = { x: 0, y: 0 };
      run(FRAMES, (i) => {
        mode.spawnMenu.itemCenter(Math.floor(i / 20) % OBJECT_KINDS.length, p);
        const n = rig.base.coords.screenToNdc(p, { x: 0, y: 0 });
        aim(rig, lab, 'right', n.x, n.y);
      });
      expect(mode.spawnMenu.state).toBe('open');
      mode.spawnMenu.close();
      rig.step();
      return frames;
    };
    const best = await allocationsPerFrame(/modes\/objectLab\//, workout, 3, 3);
    expect(best.perFrame, best.detail).toBeLessThan(BUDGET_PER_FRAME);
    rig.mc.dispose();
  });
});
