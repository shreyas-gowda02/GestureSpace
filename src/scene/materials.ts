// Shared scene visuals: default lighting, the per-hand 3D cursor marker and hover highlighting.
// (Selection outlines for the 3D Object Lab join this file in Phase 11.)

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type { GesturePhase, HandSide, SceneCursor } from '@/core/types';

/** Soft hemisphere + key light so solid objects read clearly over the video (§13.2). */
export function addDefaultLighting(scene: THREE.Scene): void {
  const s = TUNING.scene;
  const hemi = new THREE.HemisphereLight(
    s.hemiLight.sky,
    s.hemiLight.ground,
    s.hemiLight.intensity,
  );
  hemi.name = 'DefaultHemiLight';
  const dir = new THREE.DirectionalLight(s.dirLight.color, s.dirLight.intensity);
  dir.position.set(...s.dirLight.position);
  dir.name = 'DefaultKeyLight';
  scene.add(hemi, dir);
}

/**
 * The 3D cursor for one hand: a camera-facing ring + centre dot drawn on top of everything.
 * It sits where the fingertip's ray meets the scene, so on screen it rings the fingertip.
 */
export class CursorMarker {
  readonly group = new THREE.Group();
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly dotMat: THREE.MeshBasicMaterial;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly dotGeo: THREE.CircleGeometry;
  private readonly baseColor: THREE.Color;
  private readonly hoverColor = new THREE.Color(TUNING.cursor.hoverColor);

  constructor(side: HandSide) {
    const c = TUNING.cursor;
    this.baseColor = new THREE.Color(TUNING.overlay.colors[side]);
    this.ringGeo = new THREE.RingGeometry(c.ringRadius - c.ringWidth, c.ringRadius, 40);
    this.dotGeo = new THREE.CircleGeometry(c.dotRadius, 20);
    const common = { transparent: true, depthTest: false, depthWrite: false } as const;
    this.ringMat = new THREE.MeshBasicMaterial({ ...common, color: this.baseColor, opacity: 0.95 });
    this.dotMat = new THREE.MeshBasicMaterial({ ...common, color: this.baseColor, opacity: 0.9 });
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    const dot = new THREE.Mesh(this.dotGeo, this.dotMat);
    for (const m of [ring, dot]) {
      m.renderOrder = 1000; // on top of scene content
      m.raycast = () => {}; // never a cursor hit itself
    }
    this.group.add(ring, dot);
    this.group.name = `CursorMarker:${side}`;
    this.group.visible = false;
  }

  update(
    cursor: SceneCursor | undefined,
    pinch: GesturePhase | undefined,
    camera: THREE.Camera,
  ): void {
    const hit = cursor?.hit;
    if (!hit) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(hit.point.x, hit.point.y, hit.point.z);
    this.group.quaternion.copy(camera.quaternion); // always face the camera
    const pinching = pinch === 'active';
    this.group.scale.setScalar(pinching ? TUNING.cursor.pinchScale : 1);
    const onObject = hit.kind !== 'plane';
    this.ringMat.color.copy(onObject ? this.hoverColor : this.baseColor);
    this.dotMat.opacity = pinching ? 1 : 0.9;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ringGeo.dispose();
    this.dotGeo.dispose();
    this.ringMat.dispose();
    this.dotMat.dispose();
  }
}

/** Toggle an emissive glow on MeshStandardMaterials under `root` (hover / grab feedback). */
export function setHighlight(
  root: THREE.Object3D,
  amount: number,
  color: THREE.ColorRepresentation,
): void {
  root.traverse((o) => {
    const m = (o as Partial<THREE.Mesh>).material;
    if (m instanceof THREE.MeshStandardMaterial) {
      m.emissive.set(color);
      m.emissiveIntensity = amount;
    }
  });
}
