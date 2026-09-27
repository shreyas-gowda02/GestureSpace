// Experience 2 — Spatial Panel (§14): a picture floating in the air that you hold between your
// hands. Pinch both hands on it (or near its edges) to grab it; then it follows, stretches and
// turns with your hands (TwoHandTransform) — one undo step per grab. Its grab handles glow when a
// hand is in reach. Content: bundled sample pictures, a camera snapshot, the live camera, an
// animated pattern, or the user's own picture (tool panel).

import { TUNING } from '@/config/tuning';
import type { InteractionFrame, PanelContent, PanelSampleId, PanelUiState } from '@/core/types';
import { applyPose, makePose, TwoHandTransform } from '../shared/TwoHandTransform';
import {
  cameraVideo,
  imageSource,
  liveCameraSource,
  proceduralSource,
  snapshotSource,
  SurfaceGrip,
  TextureSurface,
  type TextureSource,
} from '../shared/TextureSurface';
import type { ModeAction, ModeContext, SpatialMode } from '../types';

const P = TUNING.panel;
const PANEL_ID = 'panel';

const REST_POSE = makePose();
REST_POSE.position.set(0, P.restY, 0);

const isSample = (c: PanelContent): c is PanelSampleId => P.samples.some((s) => s.id === c);

export class PanelMode implements SpatialMode {
  readonly id = 'panel' as const;
  private ctx: ModeContext | null = null;
  private surface: TextureSurface | null = null;
  private grip: SurfaceGrip | null = null;

  private content: PanelContent = P.samples[0].id;
  private fileName: string | null = null;
  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;
  private wasHeld = false;

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
    const { ctx, surface, grip } = this;
    if (!ctx || !surface || !grip) return;
    this.now = frame.timestamp;
    grip.update(ctx, frame, this.now);
    surface.update(this.now);
    this.updateStatus(frame);
    if (grip.transform.active !== this.wasHeld) {
      this.wasHeld = grip.transform.active;
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
    this.grip?.resetTo(this.ctx, REST_POSE, 'Reset panel');
  }

  exit(): void {
    this.grip?.transform.cancel();
    this.grip?.clear();
    if (this.surface) this.surface.object.visible = false;
  }

  dispose(): void {
    this.surface?.dispose();
    this.surface = null;
    this.grip = null;
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

  private updateStatus(frame: InteractionFrame): void {
    const { ctx, grip } = this;
    if (!ctx || !grip) return;
    const t = grip.transform;
    let text: string;
    if (t.frozen) text = 'Hand lost — the panel holds still until it is back';
    else if (t.active)
      text = 'Holding the panel — move, spread or tilt your hands; let go to drop it';
    else if (grip.bothInReach) text = 'Both hands on the panel — pinch to grab it';
    else if (frame.gestures.twoHand.active)
      text = 'Pinch on the panel (or its glowing edges) to grab it';
    else text = 'Pinch the panel with both hands to grab it · R to reset';
    ctx.emitStatus(text);
  }

  private uiState(): PanelUiState {
    return {
      content: this.content,
      fileName: this.fileName,
      held: this.grip?.transform.active ?? false,
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
    const transform = new TwoHandTransform(surface.object, {
      id: PANEL_ID,
      label: 'Move panel',
      scaleRange: P.scaleRange,
    });
    this.grip = new SurfaceGrip(surface, transform, P.captureMargin);
    const first = this.content;
    if (first !== 'file') this.show(first);
  }
}
