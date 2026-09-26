// ModeId → metadata (name, icon, help) + factories. Each experience replaces its placeholder
// factory in the phase that builds it (`phase` below).

import { MODE_IDS, type ModeId } from '@/core/types';
import { PlaceholderMode, type PlaceholderShape } from './PlaceholderMode';
import { DrawMode } from './draw/DrawMode';
import type { ModeFactory } from './types';
import { VoxelMode } from './voxel/VoxelMode';

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
      { gesture: 'Two-hand pinch', action: 'Move / twist / resize the structure' },
      { gesture: 'Fist + move', action: 'Turn the structure in 3D (spin round / tip)' },
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
    tagline: 'Point your index finger and draw glowing strokes in the air.',
    phase: 8,
    help: [
      {
        gesture: 'Point (index finger out, others curled)',
        action: 'Pen down — the fingertip draws',
      },
      { gesture: 'Lower the finger or open your hand', action: 'Pen up' },
      {
        gesture: 'Fist with the other hand',
        action: 'Eraser — the drawing fingertip wipes lines away',
      },
      { gesture: 'Open the fist, then point', action: 'Draw again' },
      { gesture: 'Eraser tool (X) + point', action: 'Same, without the fist' },
      { gesture: 'Ctrl+Z / C', action: 'Undo a stroke / clear the drawing' },
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

/** Experiences that are fully built (the rest still run as PlaceholderMode). */
export const BUILT_MODES: ReadonlySet<ModeId> = new Set<ModeId>(['voxel', 'draw']);

/** Placeholder look per experience until its real implementation lands. */
const PLACEHOLDERS: Record<
  Exclude<ModeId, 'voxel' | 'draw'>,
  { shape: PlaceholderShape; color: string }
> = {
  panel: { shape: 'panel', color: '#6c8cff' },
  strings: { shape: 'icosahedron', color: '#a6ff3d' },
  filter: { shape: 'cylinder', color: '#ffb62e' },
  portal: { shape: 'torus', color: '#b36bff' },
  objectLab: { shape: 'octahedron', color: '#ff7a59' },
};

function placeholder(id: Exclude<ModeId, 'voxel' | 'draw'>): ModeFactory {
  const meta = MODE_META[id];
  return () => new PlaceholderMode({ id, name: meta.name, phase: meta.phase, ...PLACEHOLDERS[id] });
}

export const MODE_FACTORIES: Readonly<Record<ModeId, ModeFactory>> = {
  voxel: () => new VoxelMode(),
  panel: placeholder('panel'),
  draw: () => new DrawMode(),
  strings: placeholder('strings'),
  filter: placeholder('filter'),
  portal: placeholder('portal'),
  objectLab: placeholder('objectLab'),
};
