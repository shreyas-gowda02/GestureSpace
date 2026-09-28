// Shared types and per-frame data contracts (§7) used across every layer.

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

/** User settings (§21.8). Edited in the Settings panel (Phase 12); defaults in config/tuning.ts. */
export interface Settings {
  dominant: HandSide;
  mirror: boolean;
  /** 0..1 visual smoothing slider (0 = most responsive). */
  smoothing: number;
  showSkeleton: boolean;
  inferenceHz: InferenceRate;
  quality: QualityPreset;
  depthLockDefault: boolean;
}

/** Undoable edit. Every scene mutation in an editing mode goes through one. */
export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

// ---------- Per-frame data contracts (§7) ----------
// Modes consume InteractionFrame ONLY — never MediaPipe, the camera, or the render loop.

export interface TrackedHand {
  side: HandSide;
  /** Handedness/detection confidence 0..1. */
  score: number;
  /** 21 points, tracker-native normalized (un-mirrored), immutable. */
  rawLandmarks: readonly Vec3[];
  /** 21 points, VISUAL smoothing profile (stronger), VIEW-normalized (mirrored); z = tracker z. */
  landmarks: readonly Vec3[];
  /** 21 points, TRIGGER smoothing profile (lighter, lower lag) — gesture metrics use these. */
  triggerLandmarks: readonly Vec3[];
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
  /**
   * Set on the `justStarted` frame when the second hand joined within TWO_HAND_JOIN_MS of the
   * first hand's pinch: that first hand's single-hand action (voxel, stroke…) must be undone.
   */
  cancelFirstHand: HandSide | null;
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
// Phases 1–4; they are added in src/modes/types.ts in Phase 4.

// ---------- Tool-panel state published by experiences (low frequency, ≤ 10 Hz) ----------

export type VoxelTool = 'build' | 'erase' | 'paint';
export type VoxelMaterial = 'solid' | 'glass' | 'emissive';

export interface VoxelUiState {
  tool: VoxelTool;
  /** '#rrggbb' */
  color: string;
  material: VoxelMaterial;
  /** Active build layer (integer Z). */
  layer: number;
  depthLock: boolean;
  count: number;
}

export type DrawTool = 'pen' | 'eraser';

export interface DrawUiState {
  tool: DrawTool;
  /** '#rrggbb' */
  color: string;
  /** Index into TUNING.draw.widths. */
  width: number;
  glow: boolean;
  /** Strokes in the drawing. */
  count: number;
}

/** Bundled sample pictures (TUNING.panel.samples). */
export type PanelSampleId = 'aurora' | 'sunset' | 'synthwave';
/** What the Spatial Panel shows. */
export type PanelContent = PanelSampleId | 'snapshot' | 'camera' | 'animated' | 'file';

export interface PanelUiState {
  content: PanelContent;
  /** Name of the user's own picture, when one is open. */
  fileName: string | null;
  /** Both hands are holding the panel. */
  held: boolean;
}

/** Hand Strings: which threads are drawn, and how long fingertip trails last. */
export type StringsStyle = 'skeleton' | 'web' | 'mesh';
export type TrailLength = 'off' | 'short' | 'long';

export interface StringsUiState {
  style: StringsStyle;
  trails: TrailLength;
}

/** Filter Lab lens presets (§18.3), in their cycling order. */
export type FilterPreset =
  | 'none'
  | 'thermal'
  | 'sketch'
  | 'pixelate'
  | 'glitch'
  | 'red'
  | 'edge'
  | 'blur'
  | 'cartoon'
  | 'rainbow'
  | 'invert'
  | 'rgbSplit'
  | 'popArt';
/** What the lens filters: the live camera behind it, a frozen camera frame, or a picture. */
export type FilterSource = 'lens' | 'frozen' | 'picture' | 'file';

export interface FilterUiState {
  preset: FilterPreset;
  source: FilterSource;
  fileName: string | null;
  held: boolean;
}

/** Portal worlds (§19). */
export type PortalWorld = 'nebula' | 'otherWorld' | 'inverted' | 'picture';

export interface PortalUiState {
  world: PortalWorld;
  /** Opened (it starts shut, as a glowing line). */
  open: boolean;
  held: boolean;
}

/** 3D Object Lab primitives (§20) and how they look. */
export type ObjectKind = 'cube' | 'sphere' | 'cylinder' | 'plane' | 'torus';
export type ObjectLook = 'solid' | 'glow' | 'glass';

export interface ObjectLabUiState {
  /** Colour ('#rrggbb') and look for new shapes — and of the selection, when one is picked. */
  color: string;
  look: ObjectLook;
  /** "Add to selection": a pinch adds shapes instead of replacing the selection. */
  multi: boolean;
  /** Shapes / groups in the scene, and how many of them are selected. */
  count: number;
  selected: number;
  /** Two or more selected (Group) / a group among them (Ungroup). */
  canGroup: boolean;
  canUngroup: boolean;
}

/** Per experience: what its tool panel shows. */
export interface ModeUiStates {
  voxel: VoxelUiState;
  panel: PanelUiState;
  draw: DrawUiState;
  strings: StringsUiState;
  filter: FilterUiState;
  portal: PortalUiState;
  objectLab: ObjectLabUiState;
}
