// Filter Lab presets (§18.3) and the lens content shader. The lens shows what is BEHIND it on
// screen: each fragment maps its screen position to the camera texture with the same cover-crop +
// mirror maths as the camera background (`coverUv(screenUv())`, glsl.ts), so the lens lines up
// with the background exactly however the strip moves, turns or stretches — then filters it.
// All 13 presets live in ONE shader, picked by a `uPreset` number: one program compiled once, so
// switching presets never stalls on a shader compile (13 separate materials would each compile on
// first use — a visible hitch on the Intel iGPU); the branch is the same for the whole strip, so
// the unused presets cost nothing per pixel.

import * as THREE from 'three';
import type { FilterPreset } from '@/core/types';
import { COVER_UV_GLSL, createCoverUniforms, type CoverUniforms } from '../shared/glsl';
import type { SurfaceContent } from '../shared/TextureSurface';

/** Presets in cycling order (thumb-pinky / arrow keys), with their names for the toast and UI. */
export const FILTER_PRESETS: readonly { id: FilterPreset; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'thermal', name: 'Thermal' },
  { id: 'sketch', name: 'Sketch' },
  { id: 'pixelate', name: 'Pixelate' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'red', name: 'Red channel' },
  { id: 'edge', name: 'Edge' },
  { id: 'blur', name: 'Blur' },
  { id: 'cartoon', name: 'Cartoon' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'invert', name: 'Invert' },
  { id: 'rgbSplit', name: 'RGB split' },
  { id: 'popArt', name: 'Pop art' },
];

export const presetIndex = (id: FilterPreset): number =>
  Math.max(
    0,
    FILTER_PRESETS.findIndex((p) => p.id === id),
  );

export const presetName = (id: FilterPreset): string => FILTER_PRESETS[presetIndex(id)]?.name ?? id;

/** The preset `step` places along the list (wraps round). */
export function stepPreset(id: FilterPreset, step: number): FilterPreset {
  const n = FILTER_PRESETS.length;
  return FILTER_PRESETS[(((presetIndex(id) + step) % n) + n) % n]?.id ?? 'none';
}

/** Where the lens reads from: 0 the live camera behind it, 1 a frozen frame behind it, 2 a picture. */
export const LENS_SOURCE = { lens: 0, frozen: 1, picture: 2 } as const;

export interface LensUniforms extends CoverUniforms {
  uPreset: THREE.IUniform<number>;
  uSource: THREE.IUniform<number>;
  /** One texel of what is being read (UV units), for the neighbour-sampling presets. */
  uTexel: THREE.IUniform<THREE.Vector2>;
  /** Width / height of the picture (source 2), so it covers the strip without stretching. */
  uMapAspect: THREE.IUniform<number>;
  /** 0 = Low quality (fewer blur taps), 1 = Medium / High. */
  uQuality: THREE.IUniform<number>;
}

export function lensUniforms(video: THREE.Texture | null): LensUniforms {
  return {
    ...createCoverUniforms(video),
    uPreset: { value: 0 },
    uSource: { value: LENS_SOURCE.lens },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uMapAspect: { value: 1.6 },
    uQuality: { value: 1 },
  };
}

const LENS_GLSL = /* glsl */ `
${COVER_UV_GLSL}
uniform float uPreset;
uniform float uSource;
uniform vec2 uTexel;
uniform float uMapAspect;
uniform float uQuality;

vec3 src(vec2 p) {
  return uSource < 0.5 ? texture2D(uVideo, p).rgb : texture2D(uMap, p).rgb;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float lumAt(vec2 p) { return luma(src(p)); }

// Sobel gradient of the brightness around p (t = sampling step in UV).
vec2 sobel(vec2 p, vec2 t) {
  float tl = lumAt(p + t * vec2(-1.0, 1.0));
  float tc = lumAt(p + t * vec2(0.0, 1.0));
  float tr = lumAt(p + t * vec2(1.0, 1.0));
  float ml = lumAt(p + t * vec2(-1.0, 0.0));
  float mr = lumAt(p + t * vec2(1.0, 0.0));
  float bl = lumAt(p + t * vec2(-1.0, -1.0));
  float bc = lumAt(p + t * vec2(0.0, -1.0));
  float br = lumAt(p + t * vec2(1.0, -1.0));
  return vec2((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br));
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

vec3 hueRotate(vec3 c, float a, float minChroma) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * c;
  float h = atan(yiq.z, yiq.y) + a;
  float chroma = max(length(yiq.yz), minChroma);
  yiq.yz = vec2(cos(h), sin(h)) * chroma;
  return toRgb * yiq;
}

vec3 thermal(float x) {
  x = clamp(x, 0.0, 1.0) * 5.0;
  if (x < 1.0) return mix(vec3(0.0), vec3(0.08, 0.1, 0.75), x);
  if (x < 2.0) return mix(vec3(0.08, 0.1, 0.75), vec3(0.8, 0.1, 0.75), x - 1.0);
  if (x < 3.0) return mix(vec3(0.8, 0.1, 0.75), vec3(1.0, 0.45, 0.08), x - 2.0);
  if (x < 4.0) return mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.92, 0.2), x - 3.0);
  return mix(vec3(1.0, 0.92, 0.2), vec3(1.0), x - 4.0);
}

vec3 blur(vec2 p) {
  vec2 t = uTexel * 2.5;
  vec3 c = src(p) * 0.2;
  c += (src(p + vec2(t.x, 0.0)) + src(p - vec2(t.x, 0.0)) + src(p + vec2(0.0, t.y)) + src(p - vec2(0.0, t.y))) * 0.12;
  c += (src(p + t) + src(p - t) + src(p + vec2(t.x, -t.y)) + src(p + vec2(-t.x, t.y))) * 0.08;
  if (uQuality > 0.5) {
    vec2 u = t * 2.2;
    c = c * 0.75 + (src(p + vec2(u.x, 0.0)) + src(p - vec2(u.x, 0.0)) + src(p + vec2(0.0, u.y)) + src(p - vec2(0.0, u.y))) * 0.0625;
  }
  return c;
}

vec3 applyFilter(vec2 p) {
  int k = int(uPreset + 0.5);
  if (k == 1) return thermal(lumAt(p));
  if (k == 2) { // sketch: pencil lines on paper
    float g = lumAt(p);
    float e = length(sobel(p, uTexel * 1.2));
    vec3 paper = vec3(0.96, 0.93, 0.86);
    return paper * mix(0.72, 1.0, smoothstep(0.15, 0.85, g)) * (1.0 - clamp(e * 2.6, 0.0, 0.88));
  }
  if (k == 3) { // pixelate: cells fixed to the camera image, so the grid stays put as the lens moves
    vec2 cell = uTexel * 14.0;
    return src((floor(p / cell) + 0.5) * cell);
  }
  if (k == 4) { // glitch: jumping horizontal bands, colour fringes, scanlines
    float tick = floor(uTime * 12.0);
    float band = floor(p.y * 28.0);
    float shift = (hash(band * 13.1 + tick) - 0.5) * 0.08 * step(0.72, hash(band + tick * 7.3));
    vec2 q = vec2(p.x + shift, p.y);
    vec3 c = vec3(src(q + vec2(uTexel.x * 6.0, 0.0)).r, src(q).g, src(q - vec2(uTexel.x * 6.0, 0.0)).b);
    return c * (0.82 + 0.18 * sin(gl_FragCoord.y * 3.14159));
  }
  if (k == 5) { vec3 c = src(p); return vec3(c.r, c.g * 0.15, c.b * 0.15); }
  if (k == 6) { // edge: neon outlines on black
    vec2 g = sobel(p, uTexel * 1.5);
    float e = clamp(length(g) * 2.2, 0.0, 1.0);
    vec3 neon = mix(vec3(0.13, 0.83, 0.85), vec3(1.0, 0.24, 0.8), 0.5 + 0.5 * sin(atan(g.y, g.x) * 2.0));
    return neon * e;
  }
  if (k == 7) return blur(p);
  if (k == 8) { // cartoon: flat colours + ink lines
    vec3 c = floor(src(p) * 5.0 + 0.5) / 5.0;
    float e = length(sobel(p, uTexel * 1.3));
    return c * (1.0 - smoothstep(0.25, 0.45, e));
  }
  if (k == 9) return hueRotate(src(p), (p.x + p.y) * 6.2832 + uTime * 1.5, 0.12);
  if (k == 10) return 1.0 - src(p);
  if (k == 11) { // RGB split
    float o = uTexel.x * 9.0 * (1.0 + 0.35 * sin(uTime * 2.0));
    return vec3(src(p + vec2(o, 0.0)).r, src(p).g, src(p - vec2(o, 0.0)).b);
  }
  if (k == 12) { // pop art: four flat colours by brightness
    float g = lumAt(p);
    if (g < 0.3) return vec3(0.1, 0.1, 0.38);
    if (g < 0.5) return vec3(1.0, 0.2, 0.55);
    if (g < 0.7) return vec3(0.1, 0.8, 0.9);
    return vec3(1.0, 0.9, 0.2);
  }
  return src(p);
}

vec3 surfaceContent(vec2 uv) {
  vec2 p;
  if (uSource < 1.5) {
    p = coverUv(screenUv()); // what is behind this pixel of the lens
  } else {
    // A picture covering the strip without stretching.
    float strip = (uSize.x * uScale.x) / (uSize.y * uScale.y);
    p = uv;
    if (strip > uMapAspect) p.y = (p.y - 0.5) * uMapAspect / strip + 0.5;
    else p.x = (p.x - 0.5) * strip / uMapAspect + 0.5;
  }
  return applyFilter(p);
}
`;

/** The lens content for a TextureSurface (with its uniforms, which the mode keeps updating). */
export function lensContent(uniforms: LensUniforms): SurfaceContent {
  return { glsl: LENS_GLSL, uniforms: uniforms as unknown as Record<string, THREE.IUniform> };
}
