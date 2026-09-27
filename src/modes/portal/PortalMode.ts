// Experience 6 — Portal / Dimensions (§19): an oval window into another world, with a rim of
// flowing energy. It starts shut, as a glowing line; the first time both hands pinch it, it opens
// out of the line. Then it's held like the panel (move / resize / turn, one undo step per grab).
// Worlds (portalContent.ts): Nebula, Other World (a real 3D scene rendered off-screen, its view
// swinging with the portal's position), Inverted Reality (the camera behind, inverted + rippling),
// and a Picture. Switch with the tool panel, ← / → or a thumb-pinky tap. Reset shuts it again.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type { HandSide, InteractionFrame, PortalUiState, PortalWorld, Vec2 } from '@/core/types';
import { CoverSync } from '../shared/glsl';
import {
  imageSource,
  proceduralSource,
  SurfaceGrip,
  TextureSurface,
} from '../shared/TextureSurface';
import { applyPose, makePose, TwoHandTransform } from '../shared/TwoHandTransform';
import type { ModeAction, ModeContext, SpatialMode } from '../types';
import {
  OtherWorld,
  portalContent,
  portalUniforms,
  stepWorld,
  worldIndex,
  worldName,
  type PortalUniforms,
} from './portalContent';

const PT = TUNING.portal;
const PORTAL_ID = 'portal';
const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');

const REST_POSE = makePose();
REST_POSE.position.set(0, PT.restY, 0);

export class PortalMode implements SpatialMode {
  readonly id = 'portal' as const;
  private ctx: ModeContext | null = null;
  private surface: TextureSurface | null = null;
  private grip: SurfaceGrip | null = null;
  private uniforms: PortalUniforms | null = null;
  private world: OtherWorld | null = null;
  private readonly cover = new CoverSync();

  private current: PortalWorld = 'nebula';
  /** 0 = shut (a glowing line) … 1 = open; opening runs from `openedAt`. */
  private openK = 0;
  private openedAt = -Infinity;
  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;
  private wasHeld = false;
  private wasOpen = false;
  // Scratch.
  private readonly look: Vec2 = { x: 0, y: 0 };
  private readonly centre = new THREE.Vector3();

  /** For tests. */
  get openness(): number {
    return this.openK;
  }

  get worldShown(): PortalWorld {
    return this.current;
  }

  /** The Other World's camera, once that world has been shown (tests: parallax). */
  get worldCamera(): THREE.PerspectiveCamera | null {
    return this.world?.camera ?? null;
  }

  /** Its render target while it exists (freed on exit). */
  get worldTarget(): THREE.WebGLRenderTarget | null {
    return this.world?.currentTarget ?? null;
  }

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.surface) this.build(ctx);
    const surface = this.surface;
    if (!surface) return;
    surface.object.visible = true;
    surface.mesh.userData.gsId = PORTAL_ID;
    ctx.cursors.addTarget(surface.mesh);
    this.cover.invalidate();
    this.uiDirty = true;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    const { ctx, surface, grip, uniforms } = this;
    if (!ctx || !surface || !grip || !uniforms) return;
    this.now = frame.timestamp;
    const began = grip.update(ctx, frame, this.now);
    if (began && this.openK === 0) this.openedAt = this.now; // first grab: open out of the line
    if (this.openedAt > -Infinity) {
      const k = Math.min(1, (this.now - this.openedAt) / PT.openMs);
      this.openK = 1 - (1 - k) ** 3;
    }
    surface.setOpen(this.openK);

    const next = frame.gestures[frame.dominant]?.thumbPinky.justStarted;
    const prev = frame.gestures[other(frame.dominant)]?.thumbPinky.justStarted;
    if (next && !prev) this.setWorld(stepWorld(this.current, 1));
    else if (prev && !next) this.setWorld(stepWorld(this.current, -1));

    this.cover.update(uniforms, ctx.viewport, ctx.renderer);
    uniforms.uMapAspect.value = surface.source.aspect;
    surface.update(this.now);
    this.updateStatus(frame);
    const open = this.openK > 0;
    if (grip.transform.active !== this.wasHeld || open !== this.wasOpen) {
      this.wasHeld = grip.transform.active;
      this.wasOpen = open;
      this.uiDirty = true;
    }
    this.flushUi(false);
  }

  /** The Other World is drawn into its render target before the main render, while it shows. */
  render(): void {
    const { ctx, surface, world, uniforms } = this;
    if (!ctx || !surface || !world || !uniforms) return;
    if (this.current !== 'otherWorld' || this.openK <= 0 || !surface.object.visible) return;
    if (typeof ctx.renderer.setRenderTarget !== 'function') return; // tests: no real renderer
    const target = world.targetFor(PT.worldSize[ctx.settings.quality], PT.aspect);
    uniforms.uWorldMap.value = target.texture;
    // Look through the portal: its position on screen swings the other world's camera.
    surface.object.getWorldPosition(this.centre).project(ctx.camera);
    this.look.x = this.centre.x;
    this.look.y = this.centre.y;
    world.render(ctx.renderer, this.now / 1000, this.look, PT.parallax);
  }

  onAction(action: ModeAction): boolean {
    switch (action.type) {
      case 'portalWorld':
        this.setWorld(action.world);
        return true;
      case 'filterNext':
        this.setWorld(stepWorld(this.current, 1));
        return true;
      case 'filterPrev':
        this.setWorld(stepWorld(this.current, -1));
        return true;
      default:
        return false;
    }
  }

  /** Clear (C): nothing to clear in a portal. */
  reset(): void {}

  /** Reset (R): back to the middle, resting size, shut again — the move is one undo step. */
  resetView(): void {
    this.grip?.resetTo(this.ctx, REST_POSE, 'Reset portal');
    this.openK = 0;
    this.openedAt = -Infinity;
    this.surface?.setOpen(0);
    this.uiDirty = true;
    this.flushUi(true);
  }

  exit(): void {
    this.grip?.transform.cancel();
    this.grip?.clear();
    this.world?.releaseTarget(); // §19: the render target is freed on exit
    if (this.uniforms) this.uniforms.uWorldMap.value = null;
    if (this.surface) this.surface.object.visible = false;
  }

  dispose(): void {
    this.surface?.dispose();
    this.world?.dispose();
    this.surface = this.grip = this.uniforms = this.world = null;
    this.ctx = null;
  }

  private setWorld(world: PortalWorld): void {
    const { surface, uniforms } = this;
    this.current = world;
    if (uniforms) uniforms.uWorld.value = worldIndex(world);
    if (world === 'otherWorld' && !this.world) this.world = new OtherWorld();
    if (world !== 'otherWorld') this.world?.releaseTarget();
    surface?.setSource(
      world === 'picture'
        ? imageSource(`${import.meta.env.BASE_URL}${PT.picture}`)
        : proceduralSource(),
    );
    this.uiDirty = true;
    this.flushUi(true);
  }

  private updateStatus(frame: InteractionFrame): void {
    const { ctx, grip } = this;
    if (!ctx || !grip) return;
    const t = grip.transform;
    const name = worldName(this.current);
    let text: string;
    if (t.frozen) text = 'Hand lost — the portal holds still until it is back';
    else if (this.openK === 0) {
      text = grip.bothInReach
        ? 'Both hands on the line — pinch to open the portal'
        : 'Pinch both ends of the glowing line to open a portal';
    } else if (this.openK < 1) text = `Opening… ${name}`;
    else if (t.active) text = `${name} — move, spread or tilt your hands; let go to leave it there`;
    else if (grip.bothInReach) text = 'Both hands on the portal — pinch to grab it';
    else if (frame.gestures.twoHand.active) text = 'Pinch on the portal (or its rim) to grab it';
    else text = `${name} — ← / → or thumb touches pinky for another world · R shuts it`;
    ctx.emitStatus(text);
  }

  private uiState(): PortalUiState {
    return {
      world: this.current,
      open: this.openK > 0,
      held: this.grip?.transform.active ?? false,
    };
  }

  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / PT.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('portal', this.uiState());
  }

  private build(ctx: ModeContext): void {
    const uniforms = portalUniforms(ctx.videoTexture);
    this.uniforms = uniforms;
    const surface = new TextureSurface('Mode:portal', {
      aspect: PT.aspect,
      size: PT.size,
      shape: 'oval',
      energyRim: true,
      accent: PT.accent,
      content: portalContent(uniforms),
    });
    this.surface = surface;
    surface.setOpen(0);
    ctx.scene.add(surface.object);
    applyPose(surface.object, REST_POSE);
    const transform = new TwoHandTransform(surface.object, {
      id: PORTAL_ID,
      label: 'Move portal',
      scaleRange: PT.scaleRange,
    });
    this.grip = new SurfaceGrip(surface, transform, PT.captureMargin);
  }
}
