// Owns the ONE WebGLRenderer, the main scene and the perspective camera (§2 rule 2).
// Also hosts the shared recursive-dispose helper.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** CSS px. */
  width = 0;
  height = 0;
  /** Device px (includes devicePixelRatio); used by screen-space shaders. */
  readonly drawingBuffer = new THREE.Vector2(1, 1);

  constructor() {
    // Throws if WebGL2 is unavailable (three ≥ r163); the core surfaces that as "unsupported".
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(TUNING.scene.clearColor, 1);
    this.renderer.domElement.className = 'gs-canvas';

    const { fov, near, far, cameraZ } = TUNING.scene;
    this.camera = new THREE.PerspectiveCamera(fov, 1, near, far);
    this.camera.position.set(0, 0, cameraZ);
    this.camera.lookAt(0, 0, 0);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Returns true if the size changed. */
  setSize(width: number, height: number): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, TUNING.scene.maxPixelRatio);
    if (width === this.width && height === this.height && dpr === this.renderer.getPixelRatio()) {
      return false;
    }
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false); // CSS sizes the canvas to 100%
    this.renderer.getDrawingBufferSize(this.drawingBuffer);
    this.camera.aspect = height > 0 ? width / height : 1;
    this.camera.updateProjectionMatrix();
    return true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    disposeObject3D(this.scene);
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** Dispose every geometry/material/texture under `root` (§2 rule 6). */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}

function disposeMaterial(mat: THREE.Material): void {
  for (const value of Object.values(mat)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  mat.dispose();
}
