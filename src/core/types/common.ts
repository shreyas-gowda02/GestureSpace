// Shared primitive types used across every layer.

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** The user's PHYSICAL hand (after handedness correction in HandNormalizer). */
export type HandSide = 'left' | 'right';

export const MODE_IDS = [
  'voxel',
  'panel',
  'draw',
  'strings',
  'filter',
  'portal',
  'objectLab',
] as const;
export type ModeId = (typeof MODE_IDS)[number];

export type QualityPreset = 'low' | 'medium' | 'high';
export type InferenceRate = 15 | 30 | 60;

/** Undoable edit. Every scene mutation in an editing mode goes through one. */
export interface Command {
  label: string;
  do(): void;
  undo(): void;
}
