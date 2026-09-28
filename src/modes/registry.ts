// ModeId → metadata (name, hotkey, help) + factories for the seven experiences.

import { MODE_IDS, type ModeId } from '@/core/types';
import { DrawMode } from './draw/DrawMode';
import { FilterLabMode } from './filter/FilterLabMode';
import { ObjectLabMode } from './objectLab/ObjectLabMode';
import { PanelMode } from './panel/PanelMode';
import { PortalMode } from './portal/PortalMode';
import { StringsMode } from './strings/StringsMode';
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
      {
        gesture: 'Both hands pinch on the panel',
        action: 'Grab it (the edge handles glow in reach)',
      },
      { gesture: 'Move both hands', action: 'Move it' },
      { gesture: 'Spread / close hands', action: 'Bigger / smaller' },
      { gesture: 'Tilt the hand-to-hand line', action: 'Rotate it' },
      { gesture: 'Let go of a pinch', action: 'Drop it (Ctrl+Z undoes the move)' },
      { gesture: 'Tool panel', action: 'Pictures, camera snapshot, live camera, your own picture' },
      { gesture: 'R', action: 'Reset: back to the middle' },
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
        gesture: 'Point (index finger out, others curled) and keep it out',
        action: 'A ring fills round the fingertip for 3 s, then the pen goes down and it draws',
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
    help: [
      { gesture: 'Move your hands', action: 'Glowing threads stretch, sag and wobble' },
      { gesture: 'Move faster', action: 'Brighter, bigger sparks' },
      { gesture: 'Both hands in view', action: 'Web / Full mesh link fingertips across' },
      { gesture: 'Tool panel', action: 'Threads: Skeleton / Web / Full mesh · Trails' },
      { gesture: 'R or C', action: 'Let every thread settle, clear trails' },
    ],
  },
  filter: {
    id: 'filter',
    name: 'Filter Lab',
    shortName: 'Filter',
    hotkey: '5',
    tagline: 'A magic lens that filters the world behind it.',
    phase: 10,
    help: [
      { gesture: 'Both hands pinch on the lens', action: 'Grab it (edge handles glow in reach)' },
      { gesture: 'Move / tilt both hands', action: 'Move / turn it' },
      { gesture: 'Spread / close hands', action: 'Wider / narrower' },
      { gesture: 'Thumb touches pinky (right hand)', action: 'Next filter' },
      { gesture: 'Thumb touches pinky (left hand)', action: 'Previous filter' },
      { gesture: '← / → or [ / ]', action: 'Previous / next filter' },
      { gesture: 'Tool panel', action: '13 filters · live / frozen / picture' },
      { gesture: 'R', action: 'Reset the lens' },
    ],
  },
  portal: {
    id: 'portal',
    name: 'Portal / Dimensions',
    shortName: 'Portal',
    hotkey: '6',
    tagline: 'Open a window into another world.',
    phase: 10,
    help: [
      { gesture: 'Both hands pinch the glowing line', action: 'Open the portal' },
      { gesture: 'Both hands pinch on the portal', action: 'Grab it: move / resize / turn' },
      { gesture: '← / → or thumb touches pinky', action: 'Another world' },
      { gesture: 'Tool panel', action: 'Nebula · Other World · Inverted Reality · Picture' },
      { gesture: 'R', action: 'Reset: back to the middle, shut' },
    ],
  },
  objectLab: {
    id: 'objectLab',
    name: '3D Object Lab',
    shortName: '3D Lab',
    hotkey: '7',
    tagline: 'Make 3D shapes and arrange them with your hands, Iron-Man style.',
    phase: 11,
    help: [
      { gesture: 'Hold your hand open and still', action: 'Shape menu — point at a shape, pinch' },
      { gesture: 'Point at a shape + pinch', action: 'Select it and pick it up' },
      { gesture: 'Pinch + drag', action: 'Move the selection' },
      { gesture: 'Push / pull while holding (Q / E)', action: 'Nearer / farther' },
      { gesture: 'Both hands pinch', action: 'Turn / resize the selection' },
      { gesture: 'Fist + move', action: 'Spin / tip the selection in 3D' },
      { gesture: 'Pinch empty space (tap)', action: 'Deselect' },
      { gesture: 'D · Delete · G', action: 'Copy · delete · group / ungroup' },
      { gesture: 'R', action: 'Turn back upright, original size' },
    ],
  },
};

export const MODE_LIST: readonly ModeMeta[] = MODE_IDS.map((id) => MODE_META[id]);

export const MODE_FACTORIES: Readonly<Record<ModeId, ModeFactory>> = {
  voxel: () => new VoxelMode(),
  panel: () => new PanelMode(),
  draw: () => new DrawMode(),
  strings: () => new StringsMode(),
  filter: () => new FilterLabMode(),
  portal: () => new PortalMode(),
  objectLab: () => new ObjectLabMode(),
};
