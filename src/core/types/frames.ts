// Per-frame data contracts flowing through the pipeline (§7).
// Modes consume InteractionFrame ONLY — never MediaPipe, the camera, or the render loop.

import type { HandSide, ModeId, Vec2, Vec3 } from './common';

export interface TrackedHand {
  side: HandSide;
  /** Handedness/detection confidence 0..1. */
  score: number;
  /** 21 points, tracker-native normalized (un-mirrored), immutable. */
  rawLandmarks: readonly Vec3[];
  /** 21 points, smoothed, VIEW-normalized (mirrored); z = tracker relative z. */
  landmarks: readonly Vec3[];
  worldLandmarks?: readonly Vec3[];
  /** Aspect-corrected, view-normalized units. */
  palmScale: number;
  bbox: { min: Vec2; max: Vec2 };
  /** 0 if seen this frame; >0 during the loss grace period. */
  lostForMs: number;
}

export interface HandFrame {
  timestamp: number;
  inferenceTimestamp: number;
  left?: TrackedHand;
  right?: TrackedHand;
}

export type GesturePhase = 'idle' | 'candidate' | 'active' | 'released';

export interface GestureState {
  phase: GesturePhase;
  /** When the gesture entered `active`. */
  startedAt: number;
  /** True for exactly one frame. */
  justStarted: boolean;
  /** True for exactly one frame. */
  justEnded: boolean;
  /** Gesture metric, e.g. normalized pinch distance. */
  value: number;
}

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface HandGestures {
  pinch: GestureState;
  grab: GestureState;
  point: GestureState;
  openPalm: GestureState;
  thumbPinky: GestureState;
  swipe?: { direction: SwipeDirection; at: number };
  /** Smoothed DepthEstimator output. */
  depthSignal: number;
}

export interface TwoHandState {
  /** Both hands pinching and captured together. */
  active: boolean;
  justStarted: boolean;
  justEnded: boolean;
  /** View-normalized midpoint. */
  center: Vec2;
  distance: number;
  /** Radians, hand-to-hand vector. */
  angle: number;
  // Relative to the baseline captured at start:
  /** distance / baselineDistance */
  scale: number;
  /** angle - baselineAngle (unwrapped) */
  rotation: number;
  /** center - baselineCenter */
  translation: Vec2;
}

export interface GestureFrame {
  left?: HandGestures;
  right?: HandGestures;
  twoHand: TwoHandState;
}

export type CursorHitKind = 'plane' | 'object' | 'voxel';

export interface SceneCursor {
  side: HandSide;
  /** CSS pixels. */
  screen: Vec2;
  ndc: Vec2;
  hit?: { point: Vec3; normal?: Vec3; objectId?: string; kind: CursorHitKind };
}

export interface InteractionFrame {
  timestamp: number;
  dt: number;
  hands: HandFrame;
  gestures: GestureFrame;
  cursors: { left?: SceneCursor; right?: SceneCursor };
  /** From settings, default 'right'. */
  dominant: HandSide;
  activeMode: ModeId;
}

// NOTE: ModeContext and SpatialMode (§7) reference Three.js and core classes that land in
// Phases 1–4; they live in src/modes/shared/SpatialMode.ts and are added in Phase 4.
