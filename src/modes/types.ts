// The experience-plugin contract (§7). Modes receive a ModeContext on enter() and an
// InteractionFrame every frame — they never see MediaPipe, the camera, or the render loop.

import type * as THREE from 'three';
import type { KeyAction } from '@/config/keybindings';
import type {
  Command,
  DrawTool,
  InteractionFrame,
  ModeId,
  ModeUiStates,
  FilterPreset,
  ObjectKind,
  ObjectLook,
  FilterSource,
  PanelContent,
  PortalWorld,
  Settings,
  StringsStyle,
  TrailLength,
  VoxelMaterial,
  VoxelTool,
} from '@/core/types';
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
  /** Tool-panel state (layer, tool, colour…). Call on change only, at most ~10 Hz. */
  publishUi<K extends keyof ModeUiStates>(id: K, state: ModeUiStates[K]): void;
}

/** Tool-panel buttons for the active experience (keys arrive as KeyActions through the same door). */
export type ToolAction =
  | { type: 'voxelTool'; tool: VoxelTool }
  | { type: 'voxelColor'; color: string }
  | { type: 'voxelMaterial'; material: VoxelMaterial }
  | { type: 'drawTool'; tool: DrawTool }
  | { type: 'drawColor'; color: string }
  | { type: 'drawWidth'; width: number }
  | { type: 'drawGlow' }
  /** Show a sample, the live camera or the animated pattern; 'snapshot' takes a new one. */
  | { type: 'panelContent'; content: Exclude<PanelContent, 'file'> }
  /** The user's own picture: an object URL the panel takes ownership of (and revokes). */
  | { type: 'panelFile'; url: string; name: string }
  | { type: 'stringsStyle'; style: StringsStyle }
  | { type: 'stringsTrails'; trails: TrailLength }
  | { type: 'filterPreset'; preset: FilterPreset }
  /** 'frozen' takes a new camera snapshot each time. */
  | { type: 'filterSource'; source: Exclude<FilterSource, 'file'> }
  | { type: 'filterFile'; url: string; name: string }
  | { type: 'portalWorld'; world: PortalWorld }
  /** A new shape in the middle of the view (selected). */
  | { type: 'objectSpawn'; kind: ObjectKind }
  /** Colour / look for new shapes and the selection. */
  | { type: 'objectColor'; color: string }
  | { type: 'objectLook'; look: ObjectLook }
  /** "Add to selection" on / off. */
  | { type: 'objectMulti' }
  | { type: 'objectGroup' }
  | { type: 'objectUngroup' };

export type ModeAction = KeyAction | ToolAction;

export interface SpatialMode {
  readonly id: ModeId;
  /**
   * The experience draws the hands itself (Hand Strings): Core then skips the skeleton, the
   * pinch / two-hand indicators and the cursor rings.
   */
  readonly drawsHands?: boolean;
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
  /** Mode-specific keys and tool-panel buttons (depth, tools, filters…). Return true if handled. */
  onAction?(action: ModeAction): boolean;
  /**
   * The tracker corrected which hand is which (D42): any side the mode stored (e.g. "held by the
   * right hand") now refers to the other hand. Captures have already been moved.
   */
  onSidesSwapped?(): void;
  /** Leaving the mode: hide content, drop hover state. Captures are released by the controller. */
  exit(): void;
  /** Free every GPU resource (§2 rule 6). */
  dispose(): void;
  /**
   * This experience's content as plain JSON (autosave, Save, Export, §22) — never camera frames.
   */
  serialize?(): unknown;
  /**
   * A command that replaces the content with `data` (untrusted: null if it isn't a valid scene for
   * this experience). Undo puts back exactly what was there before.
   */
  sceneCommand?(data: unknown): Command | null;
}

export type ModeFactory = () => SpatialMode;
