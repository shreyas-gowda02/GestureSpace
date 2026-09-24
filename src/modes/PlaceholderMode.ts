// Temporary stand-in for experiences not built yet (removed once Phase 11 lands the last one).
// Each shows a slowly spinning shape you can hover (cursor highlight) and pinch-drag across a
// camera-facing plane — exercising cursor raycasts, captures, precedence and the mode lifecycle.

import * as THREE from 'three';
import type { HandSide, InteractionFrame, ModeId } from '@/core/types';
import { singleHandPinchAllowed } from '@/gestures/GestureEngine';
import { setHighlight } from '@/scene/materials';
import { disposeObject3D } from '@/scene/SceneManager';
import { InteractionPlane } from '@/spatial/CoordinateMapper';
import type { ModeContext, SpatialMode } from './types';

export type PlaceholderShape =
  'box' | 'panel' | 'torusKnot' | 'icosahedron' | 'cylinder' | 'torus' | 'octahedron';

export interface PlaceholderSpec {
  id: ModeId;
  name: string;
  /** Phase in which the real experience replaces this placeholder. */
  phase: number;
  shape: PlaceholderShape;
  color: string;
}

function makeGeometry(shape: PlaceholderShape): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(3, 3, 3);
    case 'panel':
      return new THREE.BoxGeometry(5, 3, 0.2);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(1.4, 0.45, 96, 12);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(2, 0);
    case 'cylinder':
      return new THREE.CylinderGeometry(1.5, 1.5, 3, 24);
    case 'torus':
      return new THREE.TorusGeometry(1.7, 0.55, 16, 48);
    case 'octahedron':
      return new THREE.OctahedronGeometry(2.1, 0);
  }
}

const SIDES: readonly HandSide[] = ['right', 'left'];

export class PlaceholderMode implements SpatialMode {
  readonly id: ModeId;
  private readonly spec: PlaceholderSpec;
  private readonly targetId: string;
  private ctx: ModeContext | null = null;
  private root: THREE.Group | null = null;
  private mesh: THREE.Mesh | null = null;
  private grabbedBy: HandSide | null = null;
  private highlight = -1;
  private readonly plane = new InteractionPlane();
  private readonly grabOffset = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor(spec: PlaceholderSpec) {
    this.id = spec.id;
    this.spec = spec;
    this.targetId = `${spec.id}-placeholder`;
  }

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.root) this.build(ctx);
    if (!this.root || !this.mesh) return;
    this.root.visible = true;
    ctx.cursors.addTarget(this.mesh);
    this.idleStatus();
  }

  update(frame: InteractionFrame): void {
    const { ctx, root, mesh } = this;
    if (!ctx || !root || !mesh) return;

    let hover = false;
    for (const side of SIDES) {
      const cursor = frame.cursors[side];
      const onShape = cursor?.hit?.objectId === this.targetId;
      if (onShape) hover = true;
      const g = frame.gestures[side];
      if (
        !this.grabbedBy &&
        onShape &&
        g?.pinch.justStarted &&
        singleHandPinchAllowed(frame.gestures) &&
        cursor &&
        ctx.capture.capture(side, this.targetId, frame.timestamp, () => this.onReleased())
      ) {
        // Drag on a camera-facing plane through the shape, keeping the grab offset (no jump).
        this.grabbedBy = side;
        this.plane.setThrough(root.position, ctx.camera);
        if (ctx.coords.ndcToPlane(cursor.ndc, this.plane.plane, this.scratch)) {
          this.grabOffset.copy(root.position).sub(this.scratch);
        } else {
          this.grabOffset.set(0, 0, 0);
        }
        ctx.emitStatus(`${this.spec.name}: shape captured by ${side} hand — release to drop`);
      }
    }

    if (this.grabbedBy) {
      const side = this.grabbedBy;
      const g = frame.gestures[side];
      const cursor = frame.cursors[side];
      if (!g || g.pinch.phase !== 'active') {
        ctx.capture.release(side, 'released');
      } else if (cursor && ctx.coords.ndcToPlane(cursor.ndc, this.plane.plane, this.scratch)) {
        root.position.copy(this.scratch).add(this.grabOffset);
      }
    } else {
      mesh.rotation.y += frame.dt * 0.4;
      mesh.rotation.x += frame.dt * 0.15;
    }

    const level = this.grabbedBy ? 0.55 : hover ? 0.25 : 0;
    if (level !== this.highlight) {
      this.highlight = level;
      setHighlight(mesh, level, this.spec.color);
    }
  }

  reset(): void {
    this.resetView();
  }

  resetView(): void {
    this.root?.position.set(0, 0, 0);
    this.mesh?.rotation.set(0, 0, 0);
  }

  exit(): void {
    if (this.root) this.root.visible = false;
    this.grabbedBy = null;
    this.highlight = -1;
  }

  dispose(): void {
    if (this.root) {
      this.root.removeFromParent();
      disposeObject3D(this.root);
    }
    this.root = null;
    this.mesh = null;
    this.ctx = null;
  }

  private onReleased(): void {
    this.grabbedBy = null;
    this.idleStatus();
  }

  private idleStatus(): void {
    this.ctx?.emitStatus(
      `${this.spec.name} preview — pinch the shape to drag it (full experience in Phase ${this.spec.phase})`,
    );
  }

  private build(ctx: ModeContext): void {
    const geometry = makeGeometry(this.spec.shape);
    const material = new THREE.MeshStandardMaterial({
      color: this.spec.color,
      roughness: 0.45,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.gsId = this.targetId;
    mesh.name = this.targetId;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 20),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }),
    );
    edges.raycast = () => {};
    mesh.add(edges);
    const root = new THREE.Group();
    root.name = `Mode:${this.id}`;
    root.add(mesh);
    ctx.scene.add(root);
    this.root = root;
    this.mesh = mesh;
  }
}
