// Full-screen quad that draws the camera INSIDE Three.js using the ViewportMapper cover-crop +
// mirror (§5 layering decision). Lens shaders reuse the same COVER_UV_GLSL, so they line up exactly.
// Colors pass through unconverted (no colorspace chunk) so the feed looks identical to the camera.

import * as THREE from 'three';
import {
  COVER_UV_GLSL,
  createCoverUniforms,
  FULLSCREEN_VERT,
  syncCoverUniforms,
  type CoverUniforms,
} from '@/modes/shared/glsl';
import type { ViewportMapper } from '@/spatial/ViewportMapper';

const FRAG = /* glsl */ `
${COVER_UV_GLSL}
void main() {
  gl_FragColor = vec4(texture2D(uVideo, coverUv(screenUv())).rgb, 1.0);
}
`;

export class CameraBackground {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: CoverUniforms;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private syncedVersion = -1;
  private readonly syncedBuffer = new THREE.Vector2();

  constructor(videoTexture: THREE.Texture) {
    this.uniforms = createCoverUniforms(videoTexture);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'CameraBackground';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000; // first among opaques
    this.mesh.raycast = () => {}; // never a cursor hit
    this.mesh.visible = false;
  }

  /**
   * Cheap to call every frame: only touches uniforms when the mapping or size changed.
   * `hasVideo` is false during fixture playback without a camera (nothing to sample).
   */
  sync(viewport: ViewportMapper, drawingBuffer: THREE.Vector2, hasVideo: boolean): void {
    this.mesh.visible = hasVideo && viewport.ready;
    if (viewport.version === this.syncedVersion && drawingBuffer.equals(this.syncedBuffer)) return;
    syncCoverUniforms(this.uniforms, viewport, drawingBuffer);
    this.syncedVersion = viewport.version;
    this.syncedBuffer.copy(drawingBuffer);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose(); // the shared VideoTexture is owned by the core, not disposed here
  }
}
