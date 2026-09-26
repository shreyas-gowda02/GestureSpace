// Experience 2 — Spatial Panel (§14): a picture floating in the air that you hold between your
// hands. Pinch both hands on it (or near its edges) to grab it; then it follows, stretches and
// turns with your hands (TwoHandTransform) — one undo step per grab. Its grab handles glow when a
// hand is in reach. Content: bundled sample pictures, a camera snapshot, the live camera, an
// animated pattern, or the user's own picture (tool panel).

import type * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type {
  HandSide,
  InteractionFrame,
  PanelContent,
  PanelSampleId,
  PanelUiState,
  Vec2,
} from '@/core/types';
import { pinchPointInto } from '@/gestures/twoHand';
import {
  applyPose,
  makePose,
  readPose,
  samePose,
  transformCommand,
  TwoHandTransform,
} from '../shared/TwoHandTransform';
import {
  imageSource,
  liveCameraSource,
  proceduralSource,
  snapshotSource,
  TextureSurface,
  type TextureSource,
} from '../shared/TextureSurface';
import type { ModeAction, ModeContext, SpatialMode } from '../types';

const P = TUNING.panel;
const PANEL_ID = 'panel';
const SIDES: readonly HandSide[] = ['left', 'right'];

const REST_POSE = makePose();
REST_POSE.position.set(0, P.restY, 0);

const isSample = (c: PanelContent): c is PanelSampleId => P.samples.some((s) => s.id === c);

export class PanelMode implements SpatialMode {
  readonly id = 'panel' as const;
  private ctx: ModeContext | null = null;
  private surface: TextureSurface | null = null;
  private transform: TwoHandTransform | null = null;

  private content: PanelContent = P.samples[0].id;
  private fileName: string | null = null;
  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;
  private wasHeld = false;

  /** Which hands are on the panel (or near its edge) this frame, and on which half. */
  private readonly reach: Record<HandSide, { in: boolean; x: number }> = {
    left: { in: false, x: 0 },
    right: { in: false, x: 0 },
  };
  // Scratch.
  private readonly pinch: Vec2 = { x: 0, y: 0 };
  private readonly ndc: Vec2 = { x: 0, y: 0 };
  private readonly local: Vec2 = { x: 0, y: 0 };

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.surface) this.build(ctx);
    const surface = this.surface;
    if (!surface) return;
    surface.object.visible = true;
    surface.mesh.userData.gsId = PANEL_ID;
    ctx.cursors.addTarget(surface.mesh);
    // The live camera follows the current mirror / video shape.
    if (this.content === 'camera') this.show('camera');
    this.uiDirty = true;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    const { ctx, surface, transform } = this;
    if (!ctx || !surface || !transform) return;
    this.now = frame.timestamp;

    for (const side of SIDES) this.measureReach(frame, side);
    const two = frame.gestures.twoHand;
    if (two.justStarted && !transform.active && this.reach.left.in && this.reach.right.in) {
      transform.begin(ctx, two, this.now);
    }
    transform.update(frame);

    this.updateHandles();
    surface.update(this.now);
    this.updateStatus(frame);
    if (transform.active !== this.wasHeld) {
      this.wasHeld = transform.active;
      this.uiDirty = true;
    }
    this.flushUi(false);
  }

  onAction(action: ModeAction): boolean {
    switch (action.type) {
      case 'panelContent':
        if (!this.show(action.content)) return false;
        break;
      case 'panelFile': {
        this.surface?.setSource(imageSource(action.url, true));
        this.content = 'file';
        this.fileName = action.name;
        break;
      }
      default:
        return false;
    }
    this.uiDirty = true;
    this.flushUi(true);
    return true;
  }

  /** Clear (C): nothing to clear on a panel. */
  reset(): void {}

  /** Reset (R): back to the middle, resting size, facing you — one undo step. */
  resetView(): void {
    const { ctx, surface } = this;
    if (!surface) return;
    this.transform?.cancel();
    const before = readPose(surface.object, makePose());
    applyPose(surface.object, REST_POSE);
    const after = readPose(surface.object, makePose());
    if (ctx && !samePose(before, after)) {
      ctx.history.push(transformCommand(surface.object, before, after, 'Reset panel'));
    }
  }

  exit(): void {
    this.transform?.cancel();
    if (this.surface) this.surface.object.visible = false;
    this.reach.left.in = this.reach.right.in = false;
  }

  dispose(): void {
    this.surface?.dispose();
    this.surface = null;
    this.transform = null;
    this.ctx = null;
  }

  /** Switch what the panel shows. False if it can't (e.g. no camera for a snapshot). */
  private show(content: Exclude<PanelContent, 'file'>): boolean {
    const { ctx, surface } = this;
    if (!ctx || !surface) return false;
    let source: TextureSource | null = null;
    if (isSample(content)) {
      const sample = P.samples.find((s) => s.id === content);
      if (sample) source = imageSource(`${import.meta.env.BASE_URL}${sample.file}`);
    } else if (content === 'animated') {
      source = proceduralSource();
    } else {
      const video = cameraVideo(ctx.videoTexture);
      if (!video) {
        ctx.emitStatus('Start the camera first');
        return false;
      }
      source =
        content === 'snapshot'
          ? snapshotSource(video, ctx.viewport.mirror)
          : liveCameraSource(
              ctx.videoTexture,
              video.videoWidth / video.videoHeight,
              ctx.viewport.mirror,
            );
    }
    if (!source) return false;
    surface.setSource(source);
    this.content = content;
    this.fileName = null;
    return true;
  }

  /** Is this hand's pinch point on the panel, or within `captureMargin` of its edge? */
  private measureReach(frame: InteractionFrame, side: HandSide): void {
    const r = this.reach[side];
    r.in = false;
    const { ctx, surface } = this;
    const hand = frame.hands[side];
    if (!ctx || !surface || !hand) return;
    ctx.coords.viewToNdc(pinchPointInto(this.pinch, hand), this.ndc);
    if (!surface.within(ctx.coords.rayThrough(this.ndc).ray, P.captureMargin, this.local)) return;
    r.in = true;
    r.x = this.local.x;
  }

  private updateHandles(): void {
    const { surface, transform } = this;
    if (!surface) return;
    const G = P.handleGlow;
    if (transform?.active) {
      surface.setHandles(G.held, G.held);
      return;
    }
    let left: number = G.idle;
    let right: number = G.idle;
    for (const side of SIDES) {
      const r = this.reach[side];
      if (!r.in) continue;
      if (r.x < 0) left = G.near;
      else right = G.near;
    }
    surface.setHandles(left, right);
  }

  private updateStatus(frame: InteractionFrame): void {
    const ctx = this.ctx;
    const t = this.transform;
    if (!ctx || !t) return;
    let text: string;
    if (t.frozen) text = 'Hand lost — the panel holds still until it is back';
    else if (t.active)
      text = 'Holding the panel — move, spread or tilt your hands; let go to drop it';
    else if (this.reach.left.in && this.reach.right.in)
      text = 'Both hands on the panel — pinch to grab it';
    else if (frame.gestures.twoHand.active)
      text = 'Pinch on the panel (or its glowing edges) to grab it';
    else text = 'Pinch the panel with both hands to grab it · R to reset';
    ctx.emitStatus(text);
  }

  private uiState(): PanelUiState {
    return {
      content: this.content,
      fileName: this.fileName,
      held: this.transform?.active ?? false,
    };
  }

  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / P.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('panel', this.uiState());
  }

  private build(ctx: ModeContext): void {
    const surface = new TextureSurface('Mode:panel');
    this.surface = surface;
    ctx.scene.add(surface.object);
    applyPose(surface.object, REST_POSE);
    this.transform = new TwoHandTransform(surface.object, {
      id: PANEL_ID,
      label: 'Move panel',
      scaleRange: P.scaleRange,
    });
    const first = this.content;
    if (first !== 'file') this.show(first);
  }
}

/** The camera's <video>, once it is delivering frames (null in tests / before the camera runs). */
function cameraVideo(texture: THREE.VideoTexture): HTMLVideoElement | null {
  const v: unknown = texture.image;
  if (typeof HTMLVideoElement === 'undefined' || !(v instanceof HTMLVideoElement)) return null;
  return v.videoWidth > 0 && v.readyState >= 2 ? v : null;
}
