// Experience 5 — Filter Lab (§18): a "magic lens" strip held between both hands. Inside it you see
// the camera picture that is behind it, filtered (thermal, sketch, glitch… 13 presets, filters.ts);
// outside, the normal view. Pinch both hands on the strip to grab it: it follows, turns and
// stretches in width only (TwoHandTransform, one undo step). A thumb-pinky tap on the building hand
// = next filter, on the other hand = previous; ← / → and [ / ] too; the name pops up above the
// lens. Sources: the live camera (default), a frozen camera frame, or a picture.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type {
  Command,
  FilterPreset,
  FilterSource,
  FilterUiState,
  HandSide,
  InteractionFrame,
  Vec2,
} from '@/core/types';
import { CoverSync } from '../shared/glsl';
import {
  cameraVideo,
  imageSource,
  proceduralSource,
  snapshotSource,
  SurfaceGrip,
  TextureSurface,
} from '../shared/TextureSurface';
import { applyPose, makePose, TwoHandTransform } from '../shared/TwoHandTransform';
import { isRecord, objectPoseToJson, poseFromJson, stateCommand } from '../shared/scene';
import type { ModeAction, ModeContext, SpatialMode } from '../types';
import {
  FILTER_PRESETS,
  LENS_SOURCE,
  lensContent,
  lensUniforms,
  presetIndex,
  presetName,
  stepPreset,
  type LensUniforms,
} from './filters';

const F = TUNING.filter;
const LENS_ID = 'filter-lens';
const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');

const REST_POSE = makePose();
REST_POSE.position.set(0, F.restY, 0);

export class FilterLabMode implements SpatialMode {
  readonly id = 'filter' as const;
  private ctx: ModeContext | null = null;
  private surface: TextureSurface | null = null;
  private grip: SurfaceGrip | null = null;
  private uniforms: LensUniforms | null = null;

  private preset: FilterPreset = 'thermal';
  private source: FilterSource = 'lens';
  private fileName: string | null = null;
  /** The preset name shown above the lens, until this time. */
  private toastText = '';
  private toastUntil = -Infinity;

  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;
  private wasHeld = false;
  private readonly cover = new CoverSync();
  // Scratch.
  private readonly top = new THREE.Vector3();
  private readonly screen: Vec2 = { x: 0, y: 0 };

  /** The preset shown (tests). */
  get currentPreset(): FilterPreset {
    return this.preset;
  }

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.surface) this.build(ctx);
    const surface = this.surface;
    if (!surface) return;
    surface.object.visible = true;
    surface.mesh.userData.gsId = LENS_ID;
    ctx.cursors.addTarget(surface.mesh);
    this.cover.invalidate();
    this.uiDirty = true;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    const { ctx, surface, grip } = this;
    if (!ctx || !surface || !grip) return;
    this.now = frame.timestamp;
    grip.update(ctx, frame, this.now);

    // Thumb-pinky tap: the building hand = next preset, the other hand = previous.
    const next = frame.gestures[frame.dominant]?.thumbPinky.justStarted;
    const prev = frame.gestures[other(frame.dominant)]?.thumbPinky.justStarted;
    if (next && !prev) this.setPreset(stepPreset(this.preset, 1));
    else if (prev && !next) this.setPreset(stepPreset(this.preset, -1));

    this.syncLens(ctx);
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
      case 'filterNext':
        this.setPreset(stepPreset(this.preset, 1));
        return true;
      case 'filterPrev':
        this.setPreset(stepPreset(this.preset, -1));
        return true;
      case 'filterPreset':
        this.setPreset(action.preset);
        return true;
      case 'filterSource':
        if (!this.setSource(action.source)) return false;
        break;
      case 'filterFile':
        this.surface?.setSource(imageSource(action.url, true));
        this.source = 'file';
        this.fileName = action.name;
        break;
      default:
        return false;
    }
    this.uiDirty = true;
    this.flushUi(true);
    return true;
  }

  /** The preset name above the lens while it is showing. */
  drawOverlay(c2d: CanvasRenderingContext2D): void {
    const { ctx, surface } = this;
    const left = this.toastUntil - this.now;
    if (!ctx || !surface || left <= 0 || !surface.object.visible) return;
    const o = surface.object;
    o.updateMatrixWorld();
    o.localToWorld(this.top.set(0, surface.size.y / 2, 0));
    ctx.coords.worldToScreen(this.top, this.screen);
    c2d.save();
    c2d.globalAlpha = Math.min(1, left / 300);
    c2d.font = '600 18px system-ui, sans-serif';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    const w = c2d.measureText(this.toastText).width + 28;
    const x = this.screen.x;
    const y = this.screen.y - 34;
    c2d.fillStyle = 'rgba(10, 14, 22, 0.82)';
    c2d.beginPath();
    c2d.roundRect(x - w / 2, y - 17, w, 34, 17);
    c2d.fill();
    c2d.strokeStyle = F.accent;
    c2d.lineWidth = 1.5;
    c2d.stroke();
    c2d.fillStyle = '#ffffff';
    c2d.fillText(this.toastText, x, y + 1);
    c2d.restore();
  }

  /** The lens's place, filter and source (a frozen camera frame or your file: kept as live). */
  serialize(): unknown {
    const o = this.surface?.object;
    if (!o) return undefined;
    const source = this.source === 'picture' ? 'picture' : 'lens';
    return { v: 1, preset: this.preset, source, pose: objectPoseToJson(o) };
  }

  sceneCommand(data: unknown): Command | null {
    const o = this.surface?.object;
    const pose = makePose();
    if (!o || !isRecord(data) || data.v !== 1 || !poseFromJson(data.pose, pose)) return null;
    const preset = FILTER_PRESETS.find((p) => p.id === data.preset)?.id;
    const source = data.source === 'picture' || data.source === 'lens' ? data.source : null;
    if (!preset || !source) return null;
    type State = { preset: FilterPreset; source: 'lens' | 'picture' | null };
    const apply = (st: State): void => {
      this.preset = st.preset;
      if (this.uniforms) this.uniforms.uPreset.value = presetIndex(st.preset);
      if (st.source && st.source !== this.source) this.setSource(st.source);
      this.uiDirty = true;
      this.flushUi(true);
    };
    const now: State = {
      preset: this.preset,
      source: this.source === 'lens' || this.source === 'picture' ? this.source : null,
    };
    return stateCommand(o, apply, now, { preset, source }, pose);
  }

  /** Clear (C): nothing to clear on a lens. */
  reset(): void {}

  /** Reset (R): the strip back to the middle at its resting size — one undo step. */
  resetView(): void {
    this.grip?.resetTo(this.ctx, REST_POSE, 'Reset lens');
  }

  exit(): void {
    this.grip?.transform.cancel();
    this.grip?.clear();
    this.toastUntil = -Infinity;
    if (this.surface) this.surface.object.visible = false;
  }

  dispose(): void {
    this.surface?.dispose();
    this.surface = this.grip = this.uniforms = null;
    this.ctx = null;
  }

  private setPreset(preset: FilterPreset): void {
    this.preset = preset;
    if (this.uniforms) this.uniforms.uPreset.value = presetIndex(preset);
    this.toastText = presetName(preset);
    this.toastUntil = this.now + TUNING.ui.toastMs;
    this.uiDirty = true;
    this.flushUi(true);
  }

  /** What the lens filters. False if it can't (no camera for a frozen frame). */
  private setSource(source: Exclude<FilterSource, 'file'>): boolean {
    const { ctx, surface } = this;
    if (!ctx || !surface) return false;
    if (source === 'frozen') {
      const video = cameraVideo(ctx.videoTexture);
      const snap = video ? snapshotSource(video, false) : null; // raw frame: the lens mirrors it
      if (!snap) {
        ctx.emitStatus('Start the camera first');
        return false;
      }
      surface.setSource(snap);
    } else if (source === 'picture') {
      surface.setSource(imageSource(`${import.meta.env.BASE_URL}${F.picture}`));
    } else {
      surface.setSource(proceduralSource()); // the live camera comes straight from uVideo
    }
    this.source = source;
    this.fileName = null;
    return true;
  }

  /** Lens uniforms: the camera cover-crop (only when it changed), what's read, quality. */
  private syncLens(ctx: ModeContext): void {
    const u = this.uniforms;
    const surface = this.surface;
    if (!u || !surface) return;
    const vp = ctx.viewport;
    this.cover.update(u, vp, ctx.renderer);
    const s = this.source;
    u.uSource.value =
      s === 'lens' ? LENS_SOURCE.lens : s === 'frozen' ? LENS_SOURCE.frozen : LENS_SOURCE.picture;
    const img = surface.source.texture?.image as { width?: number; height?: number } | undefined;
    const w = s === 'lens' || !img?.width ? vp.videoWidth : img.width;
    const h = s === 'lens' || !img?.height ? vp.videoHeight : img.height;
    if (w > 0 && h > 0) u.uTexel.value.set(1 / w, 1 / h);
    u.uMapAspect.value = surface.source.aspect;
    u.uQuality.value = ctx.settings.quality === 'low' ? 0 : 1;
  }

  private updateStatus(frame: InteractionFrame): void {
    const { ctx, grip } = this;
    if (!ctx || !grip) return;
    const t = grip.transform;
    const name = presetName(this.preset);
    let text: string;
    if (t.frozen) text = 'Hand lost — the lens holds still until it is back';
    else if (t.active) text = `${name} — move, turn, spread to widen; let go to drop it`;
    else if (grip.bothInReach) text = 'Both hands on the lens — pinch to grab it';
    else if (frame.gestures.twoHand.active) {
      text = 'Pinch on the lens (or its glowing edges) to grab it';
    } else text = `${name} lens — thumb touches pinky (or ← / →) to change the filter`;
    ctx.emitStatus(text);
  }

  private uiState(): FilterUiState {
    return {
      preset: this.preset,
      source: this.source,
      fileName: this.fileName,
      held: this.grip?.transform.active ?? false,
    };
  }

  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / F.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('filter', this.uiState());
  }

  private build(ctx: ModeContext): void {
    const uniforms = lensUniforms(ctx.videoTexture);
    uniforms.uPreset.value = presetIndex(this.preset);
    this.uniforms = uniforms;
    const surface = new TextureSurface('Mode:filter', {
      aspect: F.aspect,
      size: F.size,
      accent: F.accent,
      content: lensContent(uniforms),
    });
    this.surface = surface;
    ctx.scene.add(surface.object);
    applyPose(surface.object, REST_POSE);
    const transform = new TwoHandTransform(surface.object, {
      id: LENS_ID,
      label: 'Move lens',
      widthOnly: true,
      scaleRange: F.widthRange,
    });
    this.grip = new SurfaceGrip(surface, transform, F.captureMargin);
  }
}
