// Texture Surface (§17): the shared "picture in the air" — Spatial Panel now, Filter Lab's lens and
// the Portal later. A flat plane with rounded corners, a glowing rim and two grab handles, showing
// any TextureSource. The content never leaks outside the rounded edge (a mask in the shader); the
// glow sits in a margin around it. Hands move `object` (e.g. with TwoHandTransform).
// Colours pass through unconverted, like the camera background (D9), so a camera picture on the
// surface looks exactly like the camera behind it.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type { Vec2 } from '@/core/types';

const P = TUNING.panel;

/** Something the surface can show. */
export interface TextureSource {
  readonly kind: 'image' | 'snapshot' | 'liveCameraFull' | 'procedural';
  /** What the surface samples; null = drawn by the shader (procedural) or still loading. */
  readonly texture: THREE.Texture | null;
  /** Content width / height: the surface takes this shape. */
  readonly aspect: number;
  /** Show it mirrored left ↔ right (the live camera in a mirrored view). */
  readonly mirrorX: boolean;
  /** Bumps when the texture or aspect changes (e.g. a picture finished loading). */
  readonly version: number;
  /** Frees what this source owns (never the shared camera texture). */
  dispose(): void;
}

/** A picture file (bundled sample or the user's own). Loads in the browser; nothing in Node. */
export function imageSource(url: string, revokeUrl = false): TextureSource {
  const src = {
    kind: 'image' as const,
    texture: null as THREE.Texture | null,
    aspect: P.defaultAspect as number,
    mirrorX: false,
    version: 0,
    disposed: false,
    dispose(): void {
      src.disposed = true;
      src.texture?.dispose();
      src.texture = null;
      if (revokeUrl) URL.revokeObjectURL(url);
    },
  };
  if (typeof document !== 'undefined') {
    new THREE.TextureLoader().load(url, (tex) => {
      if (src.disposed) {
        tex.dispose(); // switched away before it arrived
        return;
      }
      const img = tex.image as { width?: number; height?: number } | undefined;
      if (img?.width && img.height) src.aspect = img.width / img.height;
      tex.anisotropy = 4;
      src.texture = tex;
      src.version++;
    });
  }
  return src;
}

/** A frozen copy of the camera frame as the user sees it (mirrored when the view is). */
export function snapshotSource(video: HTMLVideoElement, mirror: boolean): TextureSource | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext('2d');
  if (!c2d) return null;
  if (mirror) {
    c2d.translate(w, 0);
    c2d.scale(-1, 1);
  }
  c2d.drawImage(video, 0, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  return {
    kind: 'snapshot',
    texture,
    aspect: w / h,
    mirrorX: false,
    version: 1,
    dispose: () => texture.dispose(),
  };
}

/** The live camera, whole frame (the shared VideoTexture; not owned). */
export function liveCameraSource(
  video: THREE.Texture,
  aspect: number,
  mirror: boolean,
): TextureSource {
  return {
    kind: 'liveCameraFull',
    texture: video,
    aspect,
    mirrorX: mirror,
    version: 1,
    dispose() {},
  };
}

/** A slowly flowing colour pattern drawn by the shader. */
export function proceduralSource(): TextureSource {
  return {
    kind: 'procedural',
    texture: null,
    aspect: P.defaultAspect,
    mirrorX: false,
    version: 1,
    dispose() {},
  };
}

const VERT = /* glsl */ `
uniform vec2 uQuad;
varying vec2 vPos;
void main() {
  vPos = position.xy * uQuad; // surface units, centred
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uMode;      // 0 picture, 1 procedural, 2 waiting for a picture
uniform float uMirrorX;
uniform vec2 uSize;       // the picture's width / height (surface units)
uniform float uRadius;
uniform float uTime;
uniform vec3 uAccent;
uniform vec2 uHandles;    // left / right handle brightness 0..1
varying vec2 vPos;

float sdRoundBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdSegmentY(vec2 p, float halfLen) {
  p.y -= clamp(p.y, -halfLen, halfLen);
  return length(p);
}

vec3 flow(vec2 uv, float t) {
  vec2 p = uv * vec2(uSize.x / uSize.y, 1.0) * 3.0;
  float v = sin(p.x * 1.3 + t * 0.7) + sin(p.y * 1.7 - t * 0.9)
    + sin((p.x + p.y) * 1.1 + t * 0.5) + sin(length(p - vec2(2.0 + sin(t * 0.3), 1.5)) * 2.2 - t);
  float k = 0.5 + 0.5 * sin(v * 1.2);
  vec3 col = mix(vec3(0.30, 0.49, 1.0), vec3(0.13, 0.83, 0.85), k);
  col = mix(col, vec3(1.0, 0.24, 0.8), smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(v * 0.8 + t * 0.4)));
  return col * (0.5 + 0.5 * k);
}

void main() {
  float d = sdRoundBox(vPos, uSize * 0.5, uRadius);
  float aa = fwidth(d);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  vec2 uv = vPos / uSize + 0.5;
  if (uMirrorX > 0.5) uv.x = 1.0 - uv.x;
  vec3 content;
  if (uMode < 0.5) content = texture2D(uMap, uv).rgb;
  else if (uMode < 1.5) content = flow(uv, uTime);
  else content = vec3(0.06, 0.08, 0.12) + 0.05 * sin(uv.x * 6.0 - uTime * 3.0);

  // Rim: a thin bright line on the edge and a soft glow outside it.
  float line = exp(-abs(d) / 0.05);
  float outer = exp(-max(d, 0.0) / 0.35) * step(0.0, d);
  // Handles: pills on the middle of the left and right edges.
  float r = 0.12;
  float hl = sdSegmentY(vPos - vec2(-uSize.x * 0.5, 0.0), uSize.y * 0.16);
  float hr = sdSegmentY(vPos - vec2(uSize.x * 0.5, 0.0), uSize.y * 0.16);
  float pillL = 1.0 - smoothstep(r - fwidth(hl), r + fwidth(hl), hl);
  float pillR = 1.0 - smoothstep(r - fwidth(hr), r + fwidth(hr), hr);
  float haloL = exp(-max(hl - r, 0.0) / 0.25) * uHandles.x;
  float haloR = exp(-max(hr - r, 0.0) / 0.25) * uHandles.y;
  float pill = max(pillL * uHandles.x, pillR * uHandles.y);
  float halo = max(haloL, haloR);

  vec3 col = content * inside + uAccent * (line * 0.9 + outer * 0.45 + halo * 0.6);
  col = mix(col, mix(uAccent, vec3(1.0), 0.6), pill);
  float alpha = max(inside, clamp(line * 0.9 + outer * 0.45 + halo * 0.6 + pill, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}
`;

export class TextureSurface {
  /** What hands move: position, rotation and (uniform) scale. */
  readonly object = new THREE.Group();
  /** The drawn quad (picture + glow margin); also the cursor's hit target. */
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms = {
    uMap: { value: null as THREE.Texture | null },
    uMode: { value: 2 },
    uMirrorX: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uQuad: { value: new THREE.Vector2(1, 1) },
    uRadius: { value: 0.1 },
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color(P.accent) },
    uHandles: { value: new THREE.Vector2(P.handleGlow.idle, P.handleGlow.idle) },
  };
  private src: TextureSource = proceduralSource();
  private seenVersion = -1;
  /** The picture's size in surface units (before the object's scale). */
  readonly size = new THREE.Vector2(1, 1);
  // Scratch.
  private readonly plane = new THREE.Plane();
  private readonly normal = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();

  constructor(name: string) {
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `${name}Surface`;
    this.object.name = name;
    this.object.add(this.mesh);
    this.layout();
  }

  get source(): TextureSource {
    return this.src;
  }

  /** Show something else; the previous source is disposed. */
  setSource(source: TextureSource): void {
    if (source === this.src) return;
    this.src.dispose();
    this.src = source;
    this.seenVersion = -1;
    this.layout();
  }

  /** Handle brightness 0..1 (left, right). */
  setHandles(left: number, right: number): void {
    this.uniforms.uHandles.value.set(left, right);
  }

  /** Every frame: animation time, and re-shape when the content changed (e.g. finished loading). */
  update(now: number): void {
    this.uniforms.uTime.value = now / 1000;
    if (this.src.version !== this.seenVersion) this.layout();
  }

  /**
   * Where a ray meets the surface, in fractions of the picture: x ∈ [−0.5, 0.5] left → right,
   * y ∈ [−0.5, 0.5] bottom → top; `margin` (surface units) comes back in the same fractions.
   */
  localPoint(ray: THREE.Ray, out: Vec2): boolean {
    const o = this.object;
    o.updateMatrixWorld();
    this.normal.set(0, 0, 1).transformDirection(o.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, o.getWorldPosition(this.hit));
    if (!ray.intersectPlane(this.plane, this.hit)) return false;
    o.worldToLocal(this.hit);
    out.x = this.hit.x / this.size.x;
    out.y = this.hit.y / this.size.y;
    return true;
  }

  /** Is a ray on the picture or within `margin` surface units of its edge? */
  within(ray: THREE.Ray, margin: number, out: Vec2): boolean {
    if (!this.localPoint(ray, out)) return false;
    return (
      Math.abs(out.x) <= 0.5 + margin / this.size.x && Math.abs(out.y) <= 0.5 + margin / this.size.y
    );
  }

  dispose(): void {
    this.src.dispose();
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Fit the content's shape: the longer side is `panel.size`; the quad adds the glow margin. */
  private layout(): void {
    const src = this.src;
    this.seenVersion = src.version;
    const a = src.aspect > 0 ? src.aspect : P.defaultAspect;
    const w = a >= 1 ? P.size : P.size * a;
    const h = w / a;
    this.size.set(w, h);
    const m = P.glowMargin;
    this.mesh.scale.set(w + 2 * m, h + 2 * m, 1);
    const u = this.uniforms;
    u.uSize.value.set(w, h);
    u.uQuad.value.set(w + 2 * m, h + 2 * m);
    u.uRadius.value = P.cornerRadius * Math.min(w, h);
    u.uMap.value = src.texture;
    u.uMirrorX.value = src.mirrorX ? 1 : 0;
    u.uMode.value = src.kind === 'procedural' ? 1 : src.texture ? 0 : 2;
  }
}
