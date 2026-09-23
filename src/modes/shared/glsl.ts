// Shared GLSL chunks + uniform plumbing for anything that samples the camera in screen space
// (camera background now; Filter Lab lens / Portal later). One source of truth for cover-crop.

import * as THREE from 'three';
import type { ViewportMapper } from '@/spatial/ViewportMapper';

export interface CoverUniforms {
  [uniform: string]: THREE.IUniform;
  uVideo: THREE.IUniform<THREE.Texture | null>;
  /** Drawing-buffer size in DEVICE pixels (accounts for devicePixelRatio). */
  uResolution: THREE.IUniform<THREE.Vector2>;
  uCoverScale: THREE.IUniform<THREE.Vector2>;
  uCoverOffset: THREE.IUniform<THREE.Vector2>;
  uMirror: THREE.IUniform<number>;
}

export function createCoverUniforms(video: THREE.Texture | null): CoverUniforms {
  return {
    uVideo: { value: video },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCoverScale: { value: new THREE.Vector2(1, 1) },
    uCoverOffset: { value: new THREE.Vector2(0, 0) },
    uMirror: { value: 1 },
  };
}

/** Copy the viewport mapping into shader uniforms (call when viewport.version or size changes). */
export function syncCoverUniforms(
  u: CoverUniforms,
  viewport: ViewportMapper,
  drawingBuffer: THREE.Vector2,
): void {
  u.uResolution.value.copy(drawingBuffer);
  u.uCoverScale.value.set(viewport.coverScale.x, viewport.coverScale.y);
  u.uCoverOffset.value.set(viewport.coverOffset.x, viewport.coverOffset.y);
  u.uMirror.value = viewport.mirror ? 1 : 0;
}

export const COVER_UV_GLSL = /* glsl */ `
uniform sampler2D uVideo;
uniform vec2 uResolution;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform float uMirror;

// 0..1 across the canvas, origin bottom-left.
vec2 screenUv() {
  return gl_FragCoord.xy / uResolution;
}

// Screen-space uv -> video texture uv, applying object-fit: cover and the selfie mirror.
vec2 coverUv(vec2 sUv) {
  vec2 uv = sUv * uCoverScale + uCoverOffset;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  return uv;
}
`;

/** Vertex shader for a clip-space quad (PlaneGeometry(2, 2)) drawn behind everything. */
export const FULLSCREEN_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
