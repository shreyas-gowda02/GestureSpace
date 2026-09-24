// The experience-plugin contract (§7). Modes receive a ModeContext on enter() and an
// InteractionFrame every frame — they never see MediaPipe, the camera, or the render loop.

import type * as THREE from 'three';
import type { KeyAction } from '@/config/keybindings';
import type { InteractionFrame, ModeId, Settings } from '@/core/types';
import type { OverlayCanvas2D } from '@/scene/overlay';
import type { CaptureManager } from '@/spatial/CaptureManager';
import type { CoordinateMapper, RaycastCursor } from '@/spatial/CoordinateMapper';
import type { ViewportMapper } from '@/spatial/ViewportMapper';
import type { CommandHistory } from './shared/history';

export interface ModeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  overlay: OverlayCanvas2D;
  videoTexture: THREE.VideoTexture;
  viewport: ViewportMapper;
  coords: CoordinateMapper;
  cursors: RaycastCursor;
  capture: CaptureManager;
  /** This mode's own undo/redo stack. */
  history: CommandHistory;
  /** Live settings (the same object is updated in place when the user changes them). */
  settings: Readonly<Settings>;
  /** Short status for the status bar, e.g. "Panel captured". Cheap to call every frame. */
  emitStatus(text: string): void;
}

export interface SpatialMode {
  readonly id: ModeId;
  /** Called on EVERY activation. Create resources lazily on the first call; keep them after. */
  enter(ctx: ModeContext): void;
  update(frame: InteractionFrame): void;
  /** Extra GPU passes before the main render (e.g. the portal's render target). */
  render?(): void;
  /** 2D overlay drawing after the hand skeleton (e.g. Air Draw strokes). */
  drawOverlay?(ctx: CanvasRenderingContext2D): void;
  /** Clear this mode's content ("Clear" button / C). Should be undoable where it edits content. */
  reset(): void;
  /** Reset transform / view ("Reset" button / R). */
  resetView?(): void;
  /** Mode-specific keys (depth, tools, filters…). Return true if handled. */
  onKey?(action: KeyAction): boolean;
  /** Leaving the mode: hide content, drop hover state. Captures are released by the controller. */
  exit(): void;
  /** Free every GPU resource (§2 rule 6). */
  dispose(): void;
  serialize?(): unknown;
  deserialize?(data: unknown): void;
}

export type ModeFactory = () => SpatialMode;
