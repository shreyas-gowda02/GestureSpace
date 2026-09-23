// ModeId → metadata (name, icon, help). Factories are registered here in Phase 4.

import { MODE_IDS, type ModeId } from '@/core/types/common';

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
  help: readonly ModeHelpItem[];
}

export const MODE_META: Readonly<Record<ModeId, ModeMeta>> = {
  voxel: {
    id: 'voxel',
    name: 'Voxel Builder',
    shortName: 'Voxel',
    hotkey: '1',
    tagline: 'Build block structures in the air with pinch.',
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
    help: [{ gesture: 'Move your hands', action: 'Stretch the string network' }],
  },
  filter: {
    id: 'filter',
    name: 'Filter Lab',
    shortName: 'Filter',
    hotkey: '5',
    tagline: 'A magic lens that filters the world behind it.',
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
    help: [{ gesture: 'Two-hand pinch', action: 'Open / move / stretch / rotate the portal' }],
  },
  objectLab: {
    id: 'objectLab',
    name: '3D Object Lab',
    shortName: '3D Lab',
    hotkey: '7',
    tagline: 'Spawn and manipulate 3D objects, Iron-Man style.',
    help: [
      { gesture: 'Open palm (hold)', action: 'Spawn menu' },
      { gesture: 'Point + pinch', action: 'Select' },
      { gesture: 'Pinch + drag', action: 'Move selection' },
      { gesture: 'Two-hand pinch', action: 'Rotate / scale selection' },
    ],
  },
};

export const MODE_LIST: readonly ModeMeta[] = MODE_IDS.map((id) => MODE_META[id]);
