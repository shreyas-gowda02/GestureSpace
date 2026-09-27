// Texture Surface (§17): the shared "picture in the air" — Spatial Panel, Filter Lab's lens and the
// Portal. A flat plane (rounded rectangle or oval) with a glowing rim and two grab handles, showing
// any TextureSource — or, for the lens / portal, a content shader of their own. The content never
// leaks outside the edge (a mask in the shader); the glow sits in a margin around it. Hands move
// `object` (TwoHandTransform, via SurfaceGrip); a width-only stretch keeps the corners round.
// Colours pass through unconverted, like the camera background (D9), so a camera picture on the
// surface looks exactly like the camera behind it.

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type { HandSide, InteractionFrame, Vec2 } from '@/core/types';
import { pinchPointInto } from '@/gestures/twoHand';
import type { ModeContext } from '../types';
import {
  applyPose,
  makePose,
  readPose,
  samePose,
  transformCommand,
  type Pose,
  type TwoHandTransform,
} from './TwoHandTransform';

const P = TUNING.panel;

/** Something the surface can show. */
export interface TextureSource {
  readonly kind: 'image' | 'snapshot' | 'liveCameraFull' | 'procedural';
  /** What the surface samples; null = drawn by the shader (procedural) or still loading. */
  readonly texture: THREE.Texture | null;
  /** Content width / height: the surface takes this shape (unless it has a fixed one). */
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

/**
 * A frozen copy of the camera frame: as the user sees it (`mirror` true, for showing it as a
 * picture), or the raw frame (false, for lens shaders that apply the view's mirror themselves).
 */
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

/** Drawn by the shader (the flowing pattern, or a lens / portal content shader). */
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

/**
 * What the surface draws inside its edge: GLSL defining `vec3 surfaceContent(vec2 uv)` (uv 0..1
 * across the picture) and the uniforms it adds. It may use the surface's own uniforms: uMap,
 * uMode, uMirrorX, uSize, uScale, uTime.
 */
export interface SurfaceContent {
  glsl: string;
  uniforms: Record<string, THREE.IUniform>;
}

export interface SurfaceOptions {
  /** A fixed shape (width / height) instead of the content's. */
  aspect?: number;
  /** The longer side at rest, in scene units (default `panel.size`). */
  size?: number;
  /** Rounded rectangle (default) or oval. */
  shape?: 'rect' | 'oval';
  /** Rim and handle colour (default `panel.accent`). */
  accent?: string;
  /** A rim of flowing, flickering energy instead of a steady glow (the portal). */
  energyRim?: boolean;
  content?: SurfaceContent;
}

/** The default content: a picture (or the live camera), the flowing pattern, or "loading". */
const DEFAULT_CONTENT = /* glsl */ `
vec3 flow(vec2 uv, float t) {
  vec2 p = uv * vec2(uSize.x / uSize.y, 1.0) * 3.0;
  float v = sin(p.x * 1.3 + t * 0.7) + sin(p.y * 1.7 - t * 0.9)
    + sin((p.x + p.y) * 1.1 + t * 0.5) + sin(length(p - vec2(2.0 + sin(t * 0.3), 1.5)) * 2.2 - t);
  float k = 0.5 + 0.5 * sin(v * 1.2);
  vec3 col = mix(vec3(0.30, 0.49, 1.0), vec3(0.13, 0.83, 0.85), k);
  col = mix(col, vec3(1.0, 0.24, 0.8), smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(v * 0.8 + t * 0.4)));
  return col * (0.5 + 0.5 * k);
}

vec3 surfaceContent(vec2 uv) {
  if (uMirrorX > 0.5) uv.x = 1.0 - uv.x;
  if (uMode < 0.5) return texture2D(uMap, uv).rgb;
  if (uMode < 1.5) return flow(uv, uTime);
  return vec3(0.06, 0.08, 0.12) + 0.05 * sin(uv.x * 6.0 - uTime * 3.0);
}
`;

const VERT = /* glsl */ `
uniform vec2 uQuad;
varying vec2 vPos;
void main() {
  vPos = position.xy * uQuad; // surface units, centred
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = (content: string): string => /* glsl */ `
uniform sampler2D uMap;
uniform float uMode;      // 0 picture, 1 procedural, 2 waiting for a picture
uniform float uMirrorX;
uniform vec2 uSize;       // the picture's width / height (surface units)
uniform vec2 uScale;      // the object's scale: edge maths is done at its real size
uniform float uRadius;
uniform float uOval;
uniform float uOpen;      // 0 = shut to a line … 1 = fully open
uniform float uEnergy;
uniform float uTime;
uniform vec3 uAccent;
uniform vec2 uHandles;    // left / right handle brightness 0..1
varying vec2 vPos;

${content}

float sdRoundBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// A good distance estimate for an ellipse (first-order), fine for a mask and a rim.
float sdOval(vec2 p, vec2 halfSize) {
  float k0 = length(p / halfSize);
  float k1 = length(p / (halfSize * halfSize));
  return k1 > 0.0 ? k0 * (k0 - 1.0) / k1 : -min(halfSize.x, halfSize.y);
}

float sdSegmentY(vec2 p, float halfLen) {
  p.y -= clamp(p.y, -halfLen, halfLen);
  return length(p);
}

void main() {
  vec2 size = uSize * uScale;
  vec2 p = vPos * uScale;
  vec2 halfSize = size * 0.5;
  halfSize.y *= max(uOpen, 0.004);
  float d = uOval > 0.5
    ? sdOval(p, halfSize)
    : sdRoundBox(p, halfSize, min(uRadius * min(uScale.x, uScale.y), halfSize.y));
  float aa = fwidth(d);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  vec3 content = surfaceContent(vPos / uSize + 0.5);

  // Rim: a thin bright line on the edge and a soft glow outside it — or flowing energy.
  float line = exp(-abs(d) / 0.05);
  float outer = exp(-max(d, 0.0) / 0.35) * step(0.0, d);
  if (uEnergy > 0.5) {
    float a = atan(p.y, p.x);
    float flicker = 0.55 + 0.45 * sin(a * 9.0 + uTime * 4.0) * sin(a * 4.0 - uTime * 2.3);
    line = exp(-abs(d) / (0.07 + 0.05 * flicker)) * (0.8 + 0.6 * flicker);
    outer *= 0.8 + 0.7 * flicker;
  }
  // Handles: pills on the middle of the left and right edges.
  float r = 0.12;
  float hl = sdSegmentY(p - vec2(-halfSize.x, 0.0), size.y * 0.16);
  float hr = sdSegmentY(p - vec2(halfSize.x, 0.0), size.y * 0.16);
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
  /** What hands move: position, rotation and scale. */
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
    uScale: { value: new THREE.Vector2(1, 1) },
    uQuad: { value: new THREE.Vector2(1, 1) },
    uRadius: { value: 0.1 },
    uOval: { value: 0 },
    uOpen: { value: 1 },
    uEnergy: { value: 0 },
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color(P.accent) },
    uHandles: { value: new THREE.Vector2(P.handleGlow.idle, P.handleGlow.idle) },
  };
  private readonly options: SurfaceOptions;
  private src: TextureSource = proceduralSource();
  private seenVersion = -1;
  /** The picture's size in surface units (before the object's scale). */
  readonly size = new THREE.Vector2(1, 1);
  // Scratch.
  private readonly plane = new THREE.Plane();
  private readonly normal = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();

  constructor(name: string, options: SurfaceOptions = {}) {
    this.options = options;
    const u = this.uniforms;
    u.uOval.value = options.shape === 'oval' ? 1 : 0;
    u.uEnergy.value = options.energyRim ? 1 : 0;
    if (options.accent) u.uAccent.value.set(options.accent);
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...u, ...options.content?.uniforms },
      vertexShader: VERT,
      fragmentShader: frag(options.content?.glsl ?? DEFAULT_CONTENT),
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

  /** How open the surface is: 0 = shut to a thin line, 1 = fully open. */
  setOpen(k: number): void {
    this.uniforms.uOpen.value = k;
  }

  /** Every frame: time, the object's scale, and re-shape when the content changed. */
  update(now: number): void {
    this.uniforms.uTime.value = now / 1000;
    const s = this.object.scale;
    this.uniforms.uScale.value.set(s.x, s.y);
    if (this.src.version !== this.seenVersion) this.layout();
  }

  /**
   * Where a ray meets the surface, in fractions of the picture: x ∈ [−0.5, 0.5] left → right,
   * y ∈ [−0.5, 0.5] bottom → top.
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

  /** Is a ray on the picture or within `margin` scene units of its edge (at its current size)? */
  within(ray: THREE.Ray, margin: number, out: Vec2): boolean {
    if (!this.localPoint(ray, out)) return false;
    const s = this.object.scale;
    const mx = margin / (this.size.x * Math.abs(s.x || 1));
    const my = margin / (this.size.y * Math.abs(s.y || 1));
    return Math.abs(out.x) <= 0.5 + mx && Math.abs(out.y) <= 0.5 + my;
  }

  dispose(): void {
    this.src.dispose();
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Fit the shape (the content's, or a fixed one); the quad adds the glow margin. */
  private layout(): void {
    const src = this.src;
    this.seenVersion = src.version;
    const fixed = this.options.aspect;
    const a = fixed ?? (src.aspect > 0 ? src.aspect : P.defaultAspect);
    const longer = this.options.size ?? P.size;
    const w = a >= 1 ? longer : longer * a;
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

const SIDES: readonly HandSide[] = ['left', 'right'];

/**
 * Holding a surface with both hands (Panel, Filter Lab, Portal): which hands are in reach of it
 * (on it, or within `margin` of its edge), its handles lighting up to match, and a two-hand pinch
 * starting a TwoHandTransform grab only when both pinches are in reach.
 */
export class SurfaceGrip {
  /** Per hand, this frame: in reach, and where across the surface (−0.5 … 0.5). */
  readonly reach: Record<HandSide, { in: boolean; x: number }> = {
    left: { in: false, x: 0 },
    right: { in: false, x: 0 },
  };
  readonly surface: TextureSurface;
  readonly transform: TwoHandTransform;
  private readonly margin: number;
  // Scratch.
  private readonly pinch: Vec2 = { x: 0, y: 0 };
  private readonly ndc: Vec2 = { x: 0, y: 0 };
  private readonly local: Vec2 = { x: 0, y: 0 };

  constructor(surface: TextureSurface, transform: TwoHandTransform, margin: number) {
    this.surface = surface;
    this.transform = transform;
    this.margin = margin;
  }

  get bothInReach(): boolean {
    return this.reach.left.in && this.reach.right.in;
  }

  /** Every frame: reach, a grab starting (returns true that frame), the grab itself, handles. */
  update(ctx: ModeContext, frame: InteractionFrame, now: number): boolean {
    for (const side of SIDES) this.measure(ctx, frame, side);
    const two = frame.gestures.twoHand;
    const began =
      two.justStarted && !this.transform.active && this.bothInReach
        ? this.transform.begin(ctx, two, now)
        : false;
    this.transform.update(frame);
    this.light();
    return began;
  }

  clear(): void {
    this.reach.left.in = this.reach.right.in = false;
  }

  /** Reset (R): back to `rest` as one undo step (a grab in progress is kept as its own first). */
  resetTo(ctx: ModeContext | null, rest: Pose, label: string): void {
    const o = this.surface.object;
    this.transform.cancel();
    const before = readPose(o, makePose());
    applyPose(o, rest);
    const after = readPose(o, makePose());
    if (ctx && !samePose(before, after))
      ctx.history.push(transformCommand(o, before, after, label));
  }

  private measure(ctx: ModeContext, frame: InteractionFrame, side: HandSide): void {
    const r = this.reach[side];
    r.in = false;
    const hand = frame.hands[side];
    if (!hand) return;
    ctx.coords.viewToNdc(pinchPointInto(this.pinch, hand), this.ndc);
    if (!this.surface.within(ctx.coords.rayThrough(this.ndc).ray, this.margin, this.local)) return;
    r.in = true;
    r.x = this.local.x;
  }

  private light(): void {
    const G = P.handleGlow;
    if (this.transform.active) {
      this.surface.setHandles(G.held, G.held);
      return;
    }
    let left: number = G.idle;
    let right: number = G.idle;
    for (const side of SIDES) {
      const r = this.reach[side];
      if (!r.in) continue;
      if (r.x < 0) left = G.near;
      else right = G.near;
    }
    this.surface.setHandles(left, right);
  }
}

/** The camera's <video>, once it is delivering frames (null in tests / before the camera runs). */
export function cameraVideo(texture: THREE.VideoTexture): HTMLVideoElement | null {
  const v: unknown = texture.image;
  if (typeof HTMLVideoElement === 'undefined' || !(v instanceof HTMLVideoElement)) return null;
  return v.videoWidth > 0 && v.readyState >= 2 ? v : null;
}
