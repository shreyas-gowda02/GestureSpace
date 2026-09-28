// Every experience's scene (Phase 12, §22): serialize → JSON → load into a fresh copy gives the
// same scene back; loading is one undo step (none when restoring an autosave); anything malformed
// is refused; camera frames and your own files are never part of a scene.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ModeId } from '@/core/types';
import type { ObjectLabMode } from '@/modes/objectLab/ObjectLabMode';
import type { LabScene } from '@/modes/objectLab/objects';
import { VoxelEdit } from '@/modes/voxel/VoxelGrid';
import type { VoxelMode } from '@/modes/voxel/VoxelMode';
import { ModeRig } from '../fixtures/modeHarness';

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;
const IDENTITY_POSE = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];

function rigFor(id: ModeId): ModeRig {
  const rig = new ModeRig(id);
  rig.step();
  return rig;
}

/** `prepare` makes a scene; it must come back exactly in a fresh copy, and undo / redo work. */
function roundTrip(id: ModeId, prepare: (rig: ModeRig) => void): unknown {
  const a = rigFor(id);
  prepare(a);
  a.step();
  const data = json(a.mc.sceneOf(id));
  const b = rigFor(id);
  const fresh = json(b.mc.sceneOf(id));
  expect(fresh).not.toEqual(data); // the test really changed something
  expect(b.mc.loadScene(id, data, 'Load scene')).toBe(true);
  expect(json(b.mc.sceneOf(id))).toEqual(data);
  expect(b.mc.history?.undoLabel).toBe('Load scene');
  b.mc.undo();
  expect(json(b.mc.sceneOf(id))).toEqual(fresh);
  b.mc.redo();
  expect(json(b.mc.sceneOf(id))).toEqual(data);
  a.mc.dispose();
  b.mc.dispose();
  return data;
}

function refuses(id: ModeId, bad: unknown[]): void {
  const rig = rigFor(id);
  const before = json(rig.mc.sceneOf(id));
  for (const b of [null, 42, 'scene', [], {}, { v: 2 }, ...bad]) {
    expect(rig.mc.loadScene(id, b, 'Load scene'), JSON.stringify(b)).toBe(false);
  }
  expect(json(rig.mc.sceneOf(id))).toEqual(before);
  expect(rig.mc.history?.canUndo).toBe(false);
  rig.mc.dispose();
}

const moved = (rig: ModeRig, name: string): void => {
  const o = rig.base.scene.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  o.position.set(3, -1.5, 0.5);
  o.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.4));
  o.scale.setScalar(1.7);
  o.updateMatrixWorld();
};

describe('each experience’s scene comes back exactly', () => {
  it('Voxel Builder: every voxel (colour, material), the view and the layer', () => {
    const data = roundTrip('voxel', (rig) => {
      const mode = rig.mc.activeMode as VoxelMode;
      const e = new VoxelEdit(mode.grid);
      e.apply(1, 2, 3, { color: 0xff3dcb, material: 'glass' });
      e.apply(-4, 0, 5, { color: 0x21d4d8, material: 'emissive' });
      e.apply(0, 0, 0, { color: 0xffffff, material: 'solid' });
      rig.mc.handleAction({ type: 'depthUp' });
      rig.mc.handleAction({ type: 'depthUp' });
      moved(rig, 'Mode:voxel');
    });
    expect((data as { cells: number[] }).cells).toHaveLength(15);
    refuses('voxel', [
      { v: 1, cells: [99, 0, 0, 1, 0], view: IDENTITY_POSE, layer: 0 }, // outside the grid
      { v: 1, cells: [0, 0, 0, 1, 7], view: IDENTITY_POSE, layer: 0 }, // no such material
      { v: 1, cells: [0, 0, 0, 1], view: IDENTITY_POSE, layer: 0 }, // not whole voxels
      { v: 1, cells: [0.5, 0, 0, 1, 0], view: IDENTITY_POSE, layer: 0 },
      { v: 1, cells: [], view: [1, 2, 3], layer: 0 }, // broken pose
      { v: 1, cells: [], view: IDENTITY_POSE, layer: 400 },
    ]);
  });

  it('Air Draw: every stroke with its colour, width, glow and points', () => {
    const strokes = [
      { color: '#2ef2ff', width: 0.012, glow: true, points: [0.25, 0.5, 0.375, 0.5, 0.5, 0.625] },
      { color: '#ff2bd6', width: 0.024, glow: false, points: [0.75, 0.25] },
    ];
    roundTrip('draw', (rig) => {
      expect(rig.mc.loadScene('draw', { v: 1, strokes }, 'x')).toBe(true);
    });
    const bad = (patch: Record<string, unknown>) => ({
      v: 1,
      strokes: [{ ...strokes[0], ...patch }],
    });
    refuses('draw', [
      bad({ color: 'red' }),
      bad({ width: 0 }),
      bad({ width: 5 }),
      bad({ glow: 'yes' }),
      bad({ points: [0.1, 0.2, 0.3] }), // odd count
      bad({ points: [0.1, 'x'] }),
      bad({ points: [0.1, 9] }), // far outside the picture
      { v: 1, strokes: 'many' },
    ]);
  });

  it('3D Object Lab: shapes, looks, colours, groups and every pose', () => {
    roundTrip('objectLab', (rig) => {
      const mode = rig.mc.activeMode as ObjectLabMode;
      rig.mc.handleAction({ type: 'objectColor', color: '#ff3dcb' });
      rig.mc.handleAction({ type: 'objectSpawn', kind: 'cube' });
      rig.mc.handleAction({ type: 'objectLook', look: 'glass' });
      rig.mc.handleAction({ type: 'objectSpawn', kind: 'torus' });
      rig.mc.handleAction({ type: 'objectSpawn', kind: 'sphere' });
      rig.run(20);
      const lab = mode.scene as LabScene;
      const [cube, torus] = [lab.top(0), lab.top(1)];
      if (!cube || !torus) throw new Error('shapes');
      cube.object.rotation.set(0.3, 0.2, 0.1);
      torus.object.scale.setScalar(2);
      rig.mc.handleAction({ type: 'escape' });
      rig.mc.handleAction({ type: 'objectMulti' });
      // Group the cube and torus (selected by hand-made selection through the tool actions).
      (mode as unknown as { selection: unknown[] }).selection.push(cube, torus);
      rig.mc.handleAction({ type: 'group' });
      const group = lab.top(lab.count - 1);
      group?.object.position.set(1, 2, -3);
    });
    const good = { k: 'cube', c: '#ffffff', l: 'solid', p: IDENTITY_POSE };
    const deep = (n: number): unknown =>
      n === 0 ? good : { k: 'group', p: IDENTITY_POSE, m: [deep(n - 1)] };
    refuses('objectLab', [
      { v: 1, items: [{ ...good, k: 'teapot' }] },
      { v: 1, items: [{ ...good, c: 'blue' }] },
      { v: 1, items: [{ ...good, l: 'shiny' }] },
      { v: 1, items: [{ ...good, p: [0, 0] }] },
      { v: 1, items: [{ k: 'group', p: IDENTITY_POSE }] }, // a group without members
      { v: 1, items: [deep(12)] }, // groups nested too deep
      { v: 1, items: Array.from({ length: 2001 }, () => good) }, // too many
    ]);
  });

  it('Spatial Panel: where it is and which picture it shows', () => {
    roundTrip('panel', (rig) => {
      rig.mc.handleAction({ type: 'panelContent', content: 'sunset' });
      moved(rig, 'Mode:panel');
    });
    refuses('panel', [
      { v: 1, content: 'camera', pose: IDENTITY_POSE },
      { v: 1, content: 'aurora', pose: 'here' },
    ]);
  });

  it('Filter Lab: where the lens is, its filter and source', () => {
    roundTrip('filter', (rig) => {
      rig.mc.handleAction({ type: 'filterPreset', preset: 'edge' });
      rig.mc.handleAction({ type: 'filterSource', source: 'picture' });
      moved(rig, 'Mode:filter');
    });
    refuses('filter', [
      { v: 1, preset: 'sepia', source: 'lens', pose: IDENTITY_POSE },
      { v: 1, preset: 'edge', source: 'frozen', pose: IDENTITY_POSE },
    ]);
  });

  it('Portal: where it is, its world, and whether it is open', () => {
    const data = roundTrip('portal', (rig) => {
      rig.mc.handleAction({ type: 'portalWorld', world: 'inverted' });
      moved(rig, 'Mode:portal');
      const s = rig.mc.sceneOf('portal') as Record<string, unknown>;
      expect(rig.mc.loadScene('portal', { ...s, open: true }, 'x')).toBe(true);
    });
    expect(data).toMatchObject({ world: 'inverted', open: true });
    refuses('portal', [
      { v: 1, world: 'narnia', open: true, pose: IDENTITY_POSE },
      { v: 1, world: 'nebula', open: 'yes', pose: IDENTITY_POSE },
    ]);
  });

  it('Hand Strings: thread style and trail length', () => {
    roundTrip('strings', (rig) => {
      rig.mc.handleAction({ type: 'stringsStyle', style: 'mesh' });
      rig.mc.handleAction({ type: 'stringsTrails', trails: 'long' });
    });
    refuses('strings', [
      { v: 1, style: 'rope', trails: 'long' },
      { v: 1, style: 'web', trails: 'forever' },
    ]);
  });
});

describe('what a scene never keeps', () => {
  it('the camera picture, a camera snapshot or your own file are not part of a scene', () => {
    const panel = rigFor('panel');
    panel.mc.handleAction({ type: 'panelFile', url: 'blob:mine', name: 'holiday.jpg' });
    expect(panel.mc.sceneOf('panel')).toMatchObject({ content: null });
    const filter = rigFor('filter');
    filter.mc.handleAction({ type: 'filterFile', url: 'blob:mine', name: 'holiday.jpg' });
    expect(filter.mc.sceneOf('filter')).toMatchObject({ source: 'lens' });
    panel.mc.dispose();
    filter.mc.dispose();
  });
});

describe('ModeController scenes', () => {
  it('restoring an autosave (no label) is not an undo step; an experience never opened has none', () => {
    const rig = rigFor('strings');
    expect(rig.mc.untouched('strings')).toBe(true);
    expect(rig.mc.loadScene('strings', { v: 1, style: 'mesh', trails: 'off' }, null)).toBe(true);
    expect(rig.mc.history?.canUndo).toBe(false);
    expect(rig.mc.untouched('strings')).toBe(true);
    expect(rig.mc.sceneOf('voxel')).toBeUndefined(); // not opened yet
    expect(rig.mc.loadScene('voxel', { v: 1 }, null)).toBe(false);
    rig.mc.handleAction({ type: 'stringsStyle', style: 'web' });
    expect(rig.mc.sceneOf('strings')).toMatchObject({ style: 'web' });
    rig.mc.dispose();
  });
});
