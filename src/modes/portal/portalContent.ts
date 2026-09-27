// Portal worlds (§19): the content shader for the portal's TextureSurface, and the "Other World" —
// a small Three.js scene (floating crystals, a planet, a starfield) rendered off-screen into a
// render target and shown through the portal, its camera swinging with the portal's position so
// looking through it feels like looking through a window.
//   nebula      procedural swirling fbm clouds + stars
//   otherWorld  the render-target scene
//   inverted    the camera behind the portal, inverted, recoloured and rippling
//   picture     a bundled picture, covering the oval without stretching

import * as THREE from 'three';
import type { PortalWorld, Vec2 } from '@/core/types';
import { COVER_UV_GLSL, createCoverUniforms, type CoverUniforms } from '../shared/glsl';
import type { SurfaceContent } from '../shared/TextureSurface';

/** Worlds in cycling order, with their names for the UI. */
export const PORTAL_WORLDS: readonly { id: PortalWorld; name: string }[] = [
  { id: 'nebula', name: 'Nebula' },
  { id: 'otherWorld', name: 'Other World' },
  { id: 'inverted', name: 'Inverted Reality' },
  { id: 'picture', name: 'Picture' },
];

export const worldIndex = (id: PortalWorld): number =>
  Math.max(
    0,
    PORTAL_WORLDS.findIndex((w) => w.id === id),
  );

export const worldName = (id: PortalWorld): string => PORTAL_WORLDS[worldIndex(id)]?.name ?? id;

export function stepWorld(id: PortalWorld, step: number): PortalWorld {
  const n = PORTAL_WORLDS.length;
  return PORTAL_WORLDS[(((worldIndex(id) + step) % n) + n) % n]?.id ?? 'nebula';
}

export interface PortalUniforms extends CoverUniforms {
  uWorld: THREE.IUniform<number>;
  /** The other world's render target, or the picture (the surface's uMap is the source texture). */
  uWorldMap: THREE.IUniform<THREE.Texture | null>;
  uMapAspect: THREE.IUniform<number>;
}

export function portalUniforms(video: THREE.Texture | null): PortalUniforms {
  return {
    ...createCoverUniforms(video),
    uWorld: { value: 0 },
    uWorldMap: { value: null },
    uMapAspect: { value: 1.6 },
  };
}

const PORTAL_GLSL = /* glsl */ `
${COVER_UV_GLSL}
uniform float uWorld;
uniform sampler2D uWorldMap;
uniform float uMapAspect;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float portalAspect() { return (uSize.x * uScale.x) / (uSize.y * uScale.y); }

vec3 nebula(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(portalAspect(), 1.0) * 3.0;
  float t = uTime * 0.12;
  float r = length(p);
  float a = atan(p.y, p.x) + t * 2.0 - r * 0.9;
  vec2 q = vec2(cos(a), sin(a)) * r;
  float n = fbm(q + vec2(t, -t * 0.7));
  float m = fbm(q * 1.7 - n + t);
  vec3 col = mix(vec3(0.04, 0.01, 0.12), vec3(0.45, 0.1, 0.72), n);
  col = mix(col, vec3(0.1, 0.8, 0.92), smoothstep(0.55, 0.92, m));
  col += vec3(1.0, 0.45, 0.85) * smoothstep(0.7, 1.0, n * m * 1.6) * 0.6;
  // Stars: one in a few cells, a small soft dot at the cell centre, twinkling.
  vec2 cell = floor(p * 14.0);
  vec2 local = fract(p * 14.0) - 0.5;
  float rnd = hash2(cell);
  float star = step(0.93, rnd) * exp(-dot(local, local) * 90.0);
  col += vec3(star * (0.55 + 0.45 * sin(uTime * 2.5 + rnd * 60.0)));
  return col * (1.0 - 0.45 * smoothstep(0.6, 1.5, r));
}

vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

vec3 inverted(vec2 uv) {
  vec2 c = uv - 0.5;
  float d = length(c * vec2(portalAspect(), 1.0));
  vec2 ripple = normalize(c + 1e-5) * sin(d * 30.0 - uTime * 3.0) * 0.006;
  vec3 inv = 1.0 - texture2D(uVideo, coverUv(screenUv() + ripple)).rgb;
  float g = dot(inv, vec3(0.299, 0.587, 0.114));
  return mix(vec3(0.06, 0.0, 0.22), vec3(0.35, 1.0, 0.92), g) * 0.72 + inv * 0.28;
}

vec3 picture(vec2 uv) {
  float a = portalAspect();
  vec2 p = uv;
  if (a > uMapAspect) p.y = (p.y - 0.5) * uMapAspect / a + 0.5;
  else p.x = (p.x - 0.5) * a / uMapAspect + 0.5;
  return texture2D(uMap, p).rgb;
}

vec3 surfaceContent(vec2 uv) {
  int k = int(uWorld + 0.5);
  if (k == 1) return linearToSrgb(texture2D(uWorldMap, uv).rgb); // rendered in linear light
  if (k == 2) return inverted(uv);
  if (k == 3) return picture(uv);
  return nebula(uv);
}
`;

export function portalContent(uniforms: PortalUniforms): SurfaceContent {
  return { glsl: PORTAL_GLSL, uniforms: uniforms as unknown as Record<string, THREE.IUniform> };
}

/** A fixed pseudo-random sequence, so the other world looks the same every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CRYSTAL_COLORS = [0xb36bff, 0x21d4d8, 0xff3dcb, 0x4c7dff];

/** The Other World: rendered into a render target the portal shows. */
export class OtherWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1.25, 0.1, 300);
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly crystals: THREE.Mesh[] = [];
  private readonly spin: number[] = [];
  private readonly baseY: number[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const scene = this.scene;
    scene.background = new THREE.Color(0x05030f);
    scene.fog = new THREE.FogExp2(0x12062a, 0.022);
    const random = rng(7);

    // Starfield on a far shell.
    const starCount = 1600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = random() * 2 - 1;
      const a = random() * Math.PI * 2;
      const r = 90 + random() * 60;
      const s = Math.sqrt(1 - u * u);
      starPos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r - 30], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xe8e6ff, size: 0.7, fog: false });
    scene.add(new THREE.Points(starGeo, starMat));

    // A glowing planet far behind.
    const planetGeo = new THREE.SphereGeometry(14, 48, 32);
    const planetMat = new THREE.MeshStandardMaterial({
      color: 0x2a1060,
      emissive: 0x3b0f6e,
      emissiveIntensity: 0.6,
      roughness: 0.8,
    });
    const planet = new THREE.Mesh(planetGeo, planetMat);
    planet.position.set(-12, 8, -60);
    scene.add(planet);

    // Floating crystals.
    const shapes = [new THREE.OctahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0)];
    const mats = CRYSTAL_COLORS.map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: 0.35,
          metalness: 0.2,
          roughness: 0.25,
          flatShading: true,
        }),
    );
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(
        shapes[i % shapes.length] ?? shapes[0],
        mats[i % mats.length] ?? mats[0],
      );
      mesh.position.set((random() - 0.5) * 34, (random() - 0.5) * 18, -random() * 38 + 4);
      mesh.scale.set(0.6 + random() * 1.6, 1.2 + random() * 2.6, 0.6 + random() * 1.6);
      mesh.rotation.set(random() * 3, random() * 3, random() * 3);
      this.crystals.push(mesh);
      this.spin.push(0.2 + random() * 0.5);
      this.baseY.push(mesh.position.y);
      scene.add(mesh);
    }

    scene.add(new THREE.AmbientLight(0x6a5aa0, 0.8));
    const key = new THREE.PointLight(0x21d4d8, 60, 80);
    key.position.set(8, 6, 10);
    const rim = new THREE.PointLight(0xff3dcb, 50, 80);
    rim.position.set(-10, -4, -6);
    scene.add(key, rim);

    this.disposables.push(starGeo, starMat, planetGeo, planetMat, ...shapes, ...mats);
  }

  get currentTarget(): THREE.WebGLRenderTarget | null {
    return this.target;
  }

  /** The render target, sized for the quality level (re-made when that changes). */
  targetFor(longer: number, aspect: number): THREE.WebGLRenderTarget {
    const w = Math.round(aspect >= 1 ? longer : longer * aspect);
    const h = Math.round(aspect >= 1 ? longer / aspect : longer);
    const t = this.target;
    if (t && t.width === w && t.height === h) return t;
    t?.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    return this.target;
  }

  /** Draw the world into its target; `look` swings the camera (portal position, −1 … 1). */
  render(renderer: THREE.WebGLRenderer, seconds: number, look: Vec2, swing: number): void {
    const target = this.target;
    if (!target) return;
    const cam = this.camera;
    cam.position.set(
      Math.sin(seconds * 0.07) * 3 - look.x * swing,
      Math.cos(seconds * 0.05) * 1.5 - look.y * swing * 0.6,
      18,
    );
    cam.lookAt(0, 0, -12);
    for (let i = 0; i < this.crystals.length; i++) {
      const m = this.crystals[i];
      if (!m) continue;
      const s = this.spin[i] ?? 0.3;
      m.rotation.y = seconds * s;
      m.position.y = (this.baseY[i] ?? 0) + Math.sin(seconds * s + i) * 0.5; // gentle bobbing
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(previous);
  }

  /** Free the render target (leaving the experience); the scene stays for next time. */
  releaseTarget(): void {
    this.target?.dispose();
    this.target = null;
  }

  dispose(): void {
    this.releaseTarget();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
