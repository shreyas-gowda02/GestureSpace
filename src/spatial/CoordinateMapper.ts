// Coordinate spaces (§8) beyond the video crop: view-normalized ↔ screen (CSS px) ↔ NDC ↔ scene.
// Also the virtual InteractionPlane and the per-hand RaycastCursor (steady aim point → scene hit).
// Only this file and ViewportMapper convert between spaces.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type {
  CursorHitKind,
  GestureFrame,
  HandFrame,
  HandSide,
  SceneCursor,
  TrackedHand,
  Vec2,
  Vec3,
} from '@/core/types';
import { INDEX_MCP, INDEX_TIP } from '@/vision/landmarks';
import type { ViewportMapper } from './ViewportMapper';

export interface ViewSize {
  /** CSS px of the canvas. */
  width: number;
  height: number;
}

export class CoordinateMapper {
  readonly viewport: ViewportMapper;
  readonly camera: THREE.PerspectiveCamera;
  private readonly size: ViewSize;
  private readonly scratchScreen: Vec2 = { x: 0, y: 0 };
  private readonly scratchNdc = new THREE.Vector2();
  private readonly scratchV3 = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();

  /** `size` is read live (e.g. SceneManager), so resizes need no extra wiring. */
  constructor(viewport: ViewportMapper, camera: THREE.PerspectiveCamera, size: ViewSize) {
    this.viewport = viewport;
    this.camera = camera;
    this.size = size;
  }

  viewToScreen(v: Vec2, out: Vec2): Vec2 {
    return this.viewport.viewToScreen(v, out);
  }

  screenToNdc(s: Vec2, out: Vec2): Vec2 {
    const w = this.size.width || 1;
    const h = this.size.height || 1;
    out.x = (s.x / w) * 2 - 1;
    out.y = -((s.y / h) * 2 - 1);
    return out;
  }

  ndcToScreen(n: Vec2, out: Vec2): Vec2 {
    out.x = ((n.x + 1) / 2) * this.size.width;
    out.y = ((1 - n.y) / 2) * this.size.height;
    return out;
  }

  viewToNdc(v: Vec2, out: Vec2): Vec2 {
    return this.screenToNdc(this.viewport.viewToScreen(v, this.scratchScreen), out);
  }

  /** Project a scene point to screen CSS px. */
  worldToScreen(p: Vec3, out: Vec2): Vec2 {
    this.scratchV3.set(p.x, p.y, p.z).project(this.camera);
    this.scratchNdc.set(this.scratchV3.x, this.scratchV3.y);
    return this.ndcToScreen(this.scratchNdc, out);
  }

  /** A raycaster aimed from the camera through `ndc` (shared instance — use immediately). */
  rayThrough(ndc: Vec2): THREE.Raycaster {
    this.scratchNdc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this.scratchNdc, this.camera);
    return this.raycaster;
  }

  /** Where the ray through `ndc` meets `plane`. Returns false if parallel / behind the camera. */
  ndcToPlane(ndc: Vec2, plane: THREE.Plane, out: THREE.Vector3): boolean {
    return this.rayThrough(ndc).ray.intersectPlane(plane, out) !== null;
  }
}

/** A virtual plane the cursor lands on when it hits no object (§9.3). */
export class InteractionPlane {
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -TUNING.cursor.planeZ);
  private readonly scratch = new THREE.Vector3();

  /** Plane z = const, facing the camera (+Z). */
  setZ(z: number): void {
    this.plane.set(this.scratch.set(0, 0, 1), -z);
  }

  /** Camera-facing plane through `point` (for dragging something at its own depth). */
  setThrough(point: THREE.Vector3, camera: THREE.Camera): void {
    camera.getWorldDirection(this.scratch).negate();
    this.plane.setFromNormalAndCoplanarPoint(this.scratch, point);
  }
}

/** Mutable hit record reused per hand (SceneCursor.hit points at it when there is a hit). */
interface CursorHit {
  point: Vec3;
  normal?: Vec3;
  objectId?: string;
  kind: CursorHitKind;
}

function makeCursor(side: HandSide): SceneCursor {
  return { side, screen: { x: 0, y: 0 }, ndc: { x: 0, y: 0 } };
}

/**
 * Where one hand aims (D43), view-normalized: the index fingertip while the hand is open. Closing a
 * pinch slides the tip toward the thumb, so below `aim.freezeBelow` the aim keeps the tip's last
 * offset from the index knuckle and moves rigidly with the hand; above `aim.releaseAbove` it blends
 * back to the fingertip. Result: what the cursor showed before a pinch is where the pinch acts.
 * The frozen offset scales with the hand's apparent size, so pulling the hand toward the camera
 * (push / pull extrusion) keeps the aim on the fingertip instead of drifting with the knuckle.
 */
export class HandAim {
  readonly point: Vec2 = { x: 0, y: 0 };
  private has = false;
  private frozen = false;
  /** Offset (tip − knuckle) at the freeze — or where the blend back starts after a release. */
  private offX = 0;
  private offY = 0;
  /** Palm scale when the offset froze. */
  private palm = 1;
  private releasedAt = -1;
  /** Offset and palm scale in effect on the previous frame. */
  private lastX = 0;
  private lastY = 0;
  private lastPalm = 1;

  update(hand: TrackedHand, pinchValue: number | undefined, now: number): Vec2 {
    const tip = hand.landmarks[INDEX_TIP];
    const knuckle = hand.landmarks[INDEX_MCP];
    if (!tip || !knuckle) return this.point;
    const liveX = tip.x - knuckle.x;
    const liveY = tip.y - knuckle.y;
    const a = TUNING.cursor.aim;
    const v = pinchValue ?? Infinity;
    const palm = hand.palmScale > 0 ? hand.palmScale : 1;
    if (!this.has) {
      this.has = true;
      this.frozen = false;
      this.releasedAt = -1;
      this.lastX = liveX;
      this.lastY = liveY;
      this.lastPalm = palm;
    }
    let x = liveX;
    let y = liveY;
    if (this.frozen) {
      const k = palm / this.palm;
      x = this.offX * k;
      y = this.offY * k;
      if (v > a.releaseAbove) {
        this.frozen = false;
        this.releasedAt = now; // blend from here back to the live fingertip
        this.offX = x;
        this.offY = y;
      }
    } else if (this.releasedAt >= 0) {
      const t = (now - this.releasedAt) / a.blendMs;
      if (t >= 1 || t < 0) this.releasedAt = -1;
      else {
        x = this.offX + (liveX - this.offX) * t;
        y = this.offY + (liveY - this.offY) * t;
      }
    }
    if (!this.frozen && v < a.freezeBelow) {
      // Freeze the offset from the previous frame: by the frame the pinch value crosses the
      // threshold, the tip has already moved one tracker update toward the thumb.
      this.frozen = true;
      this.releasedAt = -1;
      this.offX = x = this.lastX;
      this.offY = y = this.lastY;
      this.palm = this.lastPalm;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastPalm = palm;
    this.point.x = knuckle.x + x;
    this.point.y = knuckle.y + y;
    return this.point;
  }

  reset(): void {
    this.has = false;
    this.frozen = false;
    this.releasedAt = -1;
  }
}

/**
 * Per-hand scene cursor: the hand's aim point (index fingertip, steadied while pinching — D43) is
 * projected to the screen, a ray is cast from the camera through it, and the first hit among the
 * registered targets — else the interaction plane — becomes the cursor's scene point. Targets carry
 * `userData.gsId` (and optional `gsKind`).
 */
export class RaycastCursor {
  readonly cursors: { left?: SceneCursor; right?: SceneCursor } = {};
  readonly interactionPlane = new InteractionPlane();
  private readonly coords: CoordinateMapper;
  private readonly targets: THREE.Object3D[] = [];
  private readonly hitsBuf: THREE.Intersection[] = [];
  private readonly store: Record<HandSide, SceneCursor> = {
    left: makeCursor('left'),
    right: makeCursor('right'),
  };
  /** Swapped with the hand when left ↔ right are renamed (D42). */
  private aims: Record<HandSide, HandAim> = { left: new HandAim(), right: new HandAim() };
  private readonly hitStore: Record<HandSide, CursorHit> = {
    left: { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, kind: 'plane' },
    right: { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, kind: 'plane' },
  };
  private readonly scratch = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();

  constructor(coords: CoordinateMapper) {
    this.coords = coords;
  }

  get targetCount(): number {
    return this.targets.length;
  }

  addTarget(obj: THREE.Object3D): void {
    if (!this.targets.includes(obj)) this.targets.push(obj);
  }

  removeTarget(obj: THREE.Object3D): void {
    const i = this.targets.indexOf(obj);
    if (i >= 0) this.targets.splice(i, 1);
  }

  /** Called by the ModeController on every mode switch. */
  clearTargets(): void {
    this.targets.length = 0;
  }

  /** `gestures` (pinch values) steady the aim while pinching; without them the aim is the tip. */
  update(hands: HandFrame, gestures?: GestureFrame): { left?: SceneCursor; right?: SceneCursor } {
    this.cursors.left = this.updateSide('left', hands, gestures);
    this.cursors.right = this.updateSide('right', hands, gestures);
    return this.cursors;
  }

  /** Left ↔ right were renamed (D42): each aim's pinch state follows its physical hand. */
  swapSides(): void {
    this.aims = { left: this.aims.right, right: this.aims.left };
  }

  private updateSide(
    side: HandSide,
    hands: HandFrame,
    gestures: GestureFrame | undefined,
  ): SceneCursor | undefined {
    const hand = hands[side];
    const aim = this.aims[side];
    if (!hand) {
      aim.reset();
      return undefined;
    }
    const c = this.store[side];
    this.coords.viewToScreen(
      aim.update(hand, gestures?.[side]?.pinch.value, hands.timestamp),
      c.screen,
    );
    this.coords.screenToNdc(c.screen, c.ndc);
    c.hit = this.cast(side, c.ndc);
    return c;
  }

  private cast(side: HandSide, ndc: Vec2): CursorHit | undefined {
    const ray = this.coords.rayThrough(ndc);
    const h = this.hitStore[side];
    if (this.targets.length > 0) {
      this.hitsBuf.length = 0;
      ray.intersectObjects(this.targets, true, this.hitsBuf);
      let first: THREE.Intersection | undefined;
      for (const x of this.hitsBuf) {
        if (x.object.visible) {
          first = x;
          break;
        }
      }
      if (first) {
        h.point.x = first.point.x;
        h.point.y = first.point.y;
        h.point.z = first.point.z;
        if (first.face && h.normal) {
          // Face normal in world space.
          this.normalMatrix.getNormalMatrix(first.object.matrixWorld);
          this.scratch.copy(first.face.normal).applyMatrix3(this.normalMatrix).normalize();
          h.normal.x = this.scratch.x;
          h.normal.y = this.scratch.y;
          h.normal.z = this.scratch.z;
        }
        let o: THREE.Object3D | null = first.object;
        let id: unknown;
        let kind: unknown;
        while (o && id === undefined) {
          id = o.userData.gsId;
          kind = o.userData.gsKind;
          o = o.parent;
        }
        h.objectId = typeof id === 'string' ? id : undefined;
        h.kind = kind === 'voxel' ? 'voxel' : 'object';
        return h;
      }
    }
    if (!ray.ray.intersectPlane(this.interactionPlane.plane, this.scratch)) return undefined;
    h.point.x = this.scratch.x;
    h.point.y = this.scratch.y;
    h.point.z = this.scratch.z;
    h.objectId = undefined;
    h.kind = 'plane';
    return h;
  }
}
