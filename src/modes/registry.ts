// ModeId → metadata (name, icon, help) + factories. Each experience replaces its placeholder
// factory in the phase that builds it (`phase` below).

import { MODE_IDS, type ModeId } from '@/core/types';
import { PlaceholderMode, type PlaceholderShape } from './PlaceholderMode';
import type { ModeFactory } from './types';

export interface ModeHelpItem {
  gesture: string;
  action: string;
}

export interface ModeMeta {
  id: ModeId;
  name: string;
  shortName: string;
  /** 1-based keyboard shortcut. */
  hotkey: string;
  tagline: string;
  /** Build phase that delivers the real experience. */
  phase: number;
  help: readonly ModeHelpItem[];
}

export const MODE_META: Readonly<Record<ModeId, ModeMeta>> = {
  voxel: {
    id: 'voxel',
    name: 'Voxel Builder',
    shortName: 'Voxel',
    hotkey: '1',
    tagline: 'Build block structures in the air with pinch.',
    phase: 5,
    help: [
      { gesture: 'Move index finger', action: 'Move X/Y cursor (ghost cube shows target)' },
      { gesture: 'Pinch', action: 'Place a voxel' },
      { gesture: 'Hold pinch + move', action: 'Paint voxels continuously' },
      { gesture: 'Point at voxel face + pinch', action: 'Add voxel on that face' },
      { gesture: 'Pinch face + push/pull', action: 'Extrude in depth' },
      { gesture: 'Non-dominant pinch + up/down', action: 'Change active Z layer' },
      { gesture: '+Z / −Z (E / Q)', action: 'Precise depth' },
      { gesture: 'Depth Lock (L)', action: 'Prevent accidental Z changes' },
      { gesture: 'Two-hand pinch', action: 'Move / rotate / scale the structure' },
    ],
  },
  panel: {
    id: 'panel',
    name: 'Spatial Panel',
    shortName: 'Panel',
    hotkey: '2',
    tagline: 'Hold a floating image between your hands.',
    phase: 7,
    help: [
      { gesture: 'Pinch both handles', action: 'Capture the panel' },
      { gesture: 'Move hands together', action: 'Move' },
      { gesture: 'Spread / close hands', action: 'Stretch' },
      { gesture: 'Tilt hand-to-hand line', action: 'Rotate' },
    ],
  },
  draw: {
    id: 'draw',
    name: 'Air Draw',
    shortName: 'Draw',
    hotkey: '3',
    tagline: 'Draw glowing strokes with your index finger.',
    phase: 8,
    help: [
      { gesture: 'Pinch', action: 'Pen down' },
      { gesture: 'Release', action: 'Pen up' },
      { gesture: 'Eraser tool + pinch', action: 'Erase stroke under cursor' },
    ],
  },
  strings: {
    id: 'strings',
    name: 'Hand Strings',
    shortName: 'Strings',
    hotkey: '4',
    tagline: 'Glowing particles and elastic threads on your hands.',
    phase: 9,
    help: [{ gesture: 'Move your hands', action: 'Stretch the string network' }],
  },
  filter: {
    id: 'filter',
    name: 'Filter Lab',
    shortName: 'Filter',
    hotkey: '5',
    tagline: 'A magic lens that filters the world behind it.',
    phase: 10,
    help: [
      { gesture: 'Two-hand pinch', action: 'Capture / move / stretch / rotate the lens' },
      { gesture: 'Thumb-pinky tap (dominant)', action: 'Next filter' },
      { gesture: 'Thumb-pinky tap (other hand)', action: 'Previous filter' },
    ],
  },
  portal: {
    id: 'portal',
    name: 'Portal / Dimensions',
    shortName: 'Portal',
    hotkey: '6',
    tagline: 'Open a window into another world.',
    phase: 10,
    help: [{ gesture: 'Two-hand pinch', action: 'Open / move / stretch / rotate the portal' }],
  },
  objectLab: {
    id: 'objectLab',
    name: '3D Object Lab',
    shortName: '3D Lab',
    hotkey: '7',
    tagline: 'Spawn and manipulate 3D objects, Iron-Man style.',
    phase: 11,
    help: [
      { gesture: 'Open palm (hold)', action: 'Spawn menu' },
      { gesture: 'Point + pinch', action: 'Select' },
      { gesture: 'Pinch + drag', action: 'Move selection' },
      { gesture: 'Two-hand pinch', action: 'Rotate / scale selection' },
    ],
  },
};

export const MODE_LIST: readonly ModeMeta[] = MODE_IDS.map((id) => MODE_META[id]);

/** Placeholder look per experience until its real implementation lands. */
const PLACEHOLDERS: Record<ModeId, { shape: PlaceholderShape; color: string }> = {
  voxel: { shape: 'box', color: '#21d4d8' },
  panel: { shape: 'panel', color: '#6c8cff' },
  draw: { shape: 'torusKnot', color: '#ff3dcb' },
  strings: { shape: 'icosahedron', color: '#a6ff3d' },
  filter: { shape: 'cylinder', color: '#ffb62e' },
  portal: { shape: 'torus', color: '#b36bff' },
  objectLab: { shape: 'octahedron', color: '#ff7a59' },
};

function placeholder(id: ModeId): ModeFactory {
  const meta = MODE_META[id];
  return () => new PlaceholderMode({ id, name: meta.name, phase: meta.phase, ...PLACEHOLDERS[id] });
}

export const MODE_FACTORIES: Readonly<Record<ModeId, ModeFactory>> = {
  voxel: placeholder('voxel'),
  panel: placeholder('panel'),
  draw: placeholder('draw'),
  strings: placeholder('strings'),
  filter: placeholder('filter'),
  portal: placeholder('portal'),
  objectLab: placeholder('objectLab'),
};
