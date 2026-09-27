// Experience 4 — Hand Strings (§16): a glowing particle on every hand joint, joined by elastic
// threads that sag and wobble (one spring-damper midpoint per thread), fading trails behind the
// fingertips, colours slowly drifting through the rainbow, and everything brighter and bigger the
// faster a joint moves. Styles: skeleton (the hand's bones) · web (+ a ring through each hand's
// fingertips, and each fingertip to its twin on the other hand) · full mesh (+ every fingertip to
// every other). A pure visual: nothing to grab. It draws the hands itself, so Core hides the usual
// skeleton, gesture indicators and cursor rings. All buffers are made once and updated in place.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { TUNING } from '@/config/tuning';
import type {
  InteractionFrame,
  StringsStyle,
  StringsUiState,
  TrackedHand,
  TrailLength,
  Vec2,
} from '@/core/types';
import { clamp } from '@/utils/math';
import { FINGERTIPS, LANDMARK_COUNT } from '@/vision/landmarks';
import type { ModeAction, ModeContext, SpatialMode } from '../types';
import {
  buildThreads,
  fingerOf,
  SpringField,
  TrailRing,
  writeCurve,
  type ThreadTable,
} from './springs';

const S = TUNING.strings;
const SIDES = ['left', 'right'] as const;
const J = LANDMARK_COUNT;
const TIPS = FINGERTIPS.length;
const MAX_THREADS = buildThreads('mesh').length / 4;
const MAX_TRAIL_SEGMENTS = 2 * TIPS * (S.trail.samples - 1);
const GRACE = TUNING.confidence.HAND_LOSS_GRACE_MS;
const POINT_ATTRIBUTES = ['position', 'tint', 'size'] as const;

const TRAIL_LIFE: Record<TrailLength, number> = {
  off: 0,
  short: S.trail.shortMs,
  long: S.trail.longMs,
};

const POINT_VERT = /* glsl */ `
attribute float size;
attribute vec3 tint;
uniform float uPixelRatio;
varying vec3 vTint;
void main() {
  vTint = tint;
  gl_PointSize = size * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 16.0);
  float halo = exp(-r2 * 3.5) * 0.6;
  gl_FragColor = vec4(vTint * (halo + core) + vec3(core * 0.5), 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Fat lines (three's LineSegments2) without their round end caps: a thread is many short
 * segments, and overlapping caps drew a brighter "bead" at every joint. Bends are gentle, so the
 * tiny wedges left open are invisible.
 */
function lineMaterial(width: number, opacity: number, blending: THREE.Blending): LineMaterial {
  const m = new LineMaterial({
    linewidth: width,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('if ( len2 > 1.0 ) discard;', 'discard;');
  };
  m.customProgramCacheKey = () => 'gs-line-nocaps';
  return m;
}

/** One line geometry (positions + colours, made once) drawn with one or more materials. */
class LineLayer {
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly geometry = new LineSegmentsGeometry();
  readonly lines: LineSegments2[];
  private readonly buffers: THREE.InterleavedBuffer[];

  constructor(name: string, capacity: number, materials: readonly LineMaterial[]) {
    this.pos = new Float32Array(capacity * 6);
    this.col = new Float32Array(capacity * 6);
    this.geometry.setPositions(this.pos);
    this.geometry.setColors(this.col);
    this.geometry.instanceCount = 0;
    this.buffers = ['instanceStart', 'instanceColorStart'].map(
      (n) => (this.geometry.getAttribute(n) as THREE.InterleavedBufferAttribute).data,
    );
    this.lines = materials.map((m, i) => {
      const l = new LineSegments2(this.geometry, m);
      l.name = `${name}${i}`;
      l.frustumCulled = false;
      l.renderOrder = i;
      return l;
    });
  }

  /** Draw the first `count` segments written this frame. */
  upload(count: number): void {
    this.geometry.instanceCount = count;
    for (const b of this.buffers) b.needsUpdate = true;
  }

  setResolution(w: number, h: number): void {
    for (const l of this.lines) {
      if (l.material.resolution.x !== w || l.material.resolution.y !== h) {
        l.material.resolution.set(w, h);
      }
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const l of this.lines) l.material.dispose();
  }
}

export class StringsMode implements SpatialMode {
  readonly id = 'strings' as const;
  readonly drawsHands = true;
  private ctx: ModeContext | null = null;
  private root: THREE.Group | null = null;

  private style: StringsStyle = 'web';
  private trails: TrailLength = 'short';
  private threads: ThreadTable = buildThreads('web');
  private readonly springs = new SpringField(MAX_THREADS);
  private readonly rings: TrailRing[] = Array.from(
    { length: 2 * TIPS },
    () => new TrailRing(S.trail.samples),
  );

  // Per hand (0 left, 1 right): joints in scene units, their speed, their colour this frame.
  private readonly joints = new Float32Array(2 * J * 3);
  private readonly prev = new Float32Array(2 * J * 3);
  private readonly speed = new Float32Array(2 * J);
  private readonly tint = new Float32Array(2 * J * 3);
  private readonly present = new Uint8Array(2);
  private readonly seen = new Uint8Array(2);
  private readonly fade = new Float32Array(2);

  // GPU: joint particles; threads = a soft additive glow under a solid core; trails = additive
  // (they fade to nothing, which a solid line can't).
  private readonly pointPos = new Float32Array(2 * J * 3);
  private readonly pointTint = new Float32Array(2 * J * 3);
  private readonly pointSize = new Float32Array(2 * J);
  private pointGeo: THREE.BufferGeometry | null = null;
  private pointMat: THREE.ShaderMaterial | null = null;
  private threadLayer: LineLayer | null = null;
  private trailLayer: LineLayer | null = null;

  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;
  // Scratch.
  private readonly ndc: Vec2 = { x: 0, y: 0 };
  private readonly hit = new THREE.Vector3();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly color = new THREE.Color();

  /** What was drawn last frame (tests). */
  pointCount = 0;
  threadSegments = 0;
  trailSegments = 0;

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    if (!this.root) this.build(ctx);
    if (this.root) this.root.visible = true;
    this.uiDirty = true;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.root) return;
    this.now = frame.timestamp;
    const dt = clamp(frame.dt, 0, 0.1);
    const hue = ((frame.timestamp / 1000) * S.hueSpeed) % 1;
    for (let h = 0; h < 2; h++) this.readHand(h, frame.hands[SIDES[h] ?? 'left'], dt, hue);

    this.pointCount = this.writePoints();
    this.threadSegments = this.writeThreads(dt);
    this.trailSegments = this.writeTrails();
    this.upload(ctx);
    this.updateStatus(ctx);
    this.flushUi(false);
  }

  onAction(action: ModeAction): boolean {
    switch (action.type) {
      case 'stringsStyle':
        if (action.style === this.style) return true;
        this.style = action.style;
        this.threads = buildThreads(action.style);
        this.springs.reset();
        break;
      case 'stringsTrails':
        this.trails = action.trails;
        break;
      default:
        return false;
    }
    this.uiDirty = true;
    this.flushUi(true);
    return true;
  }

  /** Clear (C): let every thread settle again and wipe the trails. */
  reset(): void {
    this.settle();
  }

  /** Reset (R): same as Clear — there is nothing to move back. */
  resetView(): void {
    this.settle();
  }

  exit(): void {
    this.settle();
    this.seen.fill(0);
    if (this.root) this.root.visible = false;
  }

  dispose(): void {
    this.root?.removeFromParent();
    this.pointGeo?.dispose();
    this.pointMat?.dispose();
    this.threadLayer?.dispose();
    this.trailLayer?.dispose();
    this.root = this.pointGeo = this.pointMat = this.threadLayer = this.trailLayer = null;
    this.ctx = null;
  }

  private settle(): void {
    this.springs.reset();
    for (const r of this.rings) r.clear();
  }

  /** Joints of one hand in scene units (on the z = 0 plane under the hand), speeds, colours. */
  private readHand(h: number, hand: TrackedHand | undefined, dt: number, hue: number): void {
    const ctx = this.ctx;
    if (!ctx || !hand) {
      this.present[h] = this.seen[h] = 0;
      return;
    }
    this.present[h] = 1;
    this.fade[h] = hand.lostForMs > 0 ? clamp(1 - hand.lostForMs / GRACE, 0, 1) : 1;
    const { joints, prev, speed, tint } = this;
    const fresh = !this.seen[h];
    this.seen[h] = 1;
    const smooth = 1 - Math.exp(-2 * Math.PI * S.speedCutoff * dt);
    for (let j = 0; j < J; j++) {
      const lm = hand.landmarks[j];
      const o = (h * J + j) * 3;
      if (lm) {
        ctx.coords.viewToNdc(lm, this.ndc);
        if (ctx.coords.ndcToPlane(this.ndc, this.plane, this.hit)) {
          joints[o] = this.hit.x;
          joints[o + 1] = this.hit.y;
          joints[o + 2] = this.hit.z;
        }
      }
      const i = h * J + j;
      if (fresh || dt <= 0) {
        speed[i] = 0;
      } else {
        const dx = (joints[o] ?? 0) - (prev[o] ?? 0);
        const dy = (joints[o + 1] ?? 0) - (prev[o + 1] ?? 0);
        const dz = (joints[o + 2] ?? 0) - (prev[o + 2] ?? 0);
        const inst = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
        speed[i] = (speed[i] ?? 0) + (inst - (speed[i] ?? 0)) * smooth;
      }
      prev[o] = joints[o] ?? 0;
      prev[o + 1] = joints[o + 1] ?? 0;
      prev[o + 2] = joints[o + 2] ?? 0;
      const fast = clamp((speed[i] ?? 0) / S.speedFull, 0, 1);
      const bright = (S.brightRest + (S.brightFast - S.brightRest) * fast) * (this.fade[h] ?? 1);
      this.color.setHSL(
        (hue + h * S.handHue + fingerOf(j) * S.fingerHue) % 1,
        S.saturation,
        S.lightness,
      );
      tint[o] = this.color.r * bright;
      tint[o + 1] = this.color.g * bright;
      tint[o + 2] = this.color.b * bright;
    }
  }

  private writePoints(): number {
    let n = 0;
    for (let h = 0; h < 2; h++) {
      if (!this.present[h]) continue;
      for (let j = 0; j < J; j++) {
        const src = (h * J + j) * 3;
        const dst = n * 3;
        for (let k = 0; k < 3; k++) {
          this.pointPos[dst + k] = this.joints[src + k] ?? 0;
          this.pointTint[dst + k] = this.tint[src + k] ?? 0;
        }
        const fast = clamp((this.speed[h * J + j] ?? 0) / S.speedFull, 0, 1);
        const tip = (FINGERTIPS as readonly number[]).includes(j) ? S.tipScale : 1;
        this.pointSize[n] = (S.pointSize + S.pointSizeFast * fast) * tip * (this.fade[h] ?? 1);
        n++;
      }
    }
    return n;
  }

  /** Each thread whose two hands are in view: step its spring, write its curve. */
  private writeThreads(dt: number): number {
    const layer = this.threadLayer;
    if (!layer) return 0;
    const t = this.threads;
    const { joints, tint, springs } = this;
    springs.dt = dt;
    let seg = 0;
    for (let i = 0; i < t.length / 4; i++) {
      const ha = t[i * 4] ?? 0;
      const hb = t[i * 4 + 2] ?? 0;
      if (!this.present[ha] || !this.present[hb]) {
        springs.live[i] = 0;
        continue;
      }
      const a = (ha * J + (t[i * 4 + 1] ?? 0)) * 3;
      const b = (hb * J + (t[i * 4 + 3] ?? 0)) * 3;
      springs.step(i, joints, a, b);
      seg += writeCurve(
        layer.pos,
        layer.col,
        seg,
        S.segments,
        joints,
        a,
        springs.pos,
        i * 3,
        joints,
        b,
        tint,
        a,
        tint,
        b,
      );
    }
    return seg;
  }

  /** Fingertip trails: segments between recent samples, fading with age. */
  private writeTrails(): number {
    const layer = this.trailLayer;
    if (!layer) return 0;
    const life = TRAIL_LIFE[this.trails];
    let seg = 0;
    for (let h = 0; h < 2; h++) {
      for (let f = 0; f < TIPS; f++) {
        const ring = this.rings[h * TIPS + f];
        if (!ring) continue;
        if (life === 0) {
          ring.clear();
          continue;
        }
        const o = (h * J + (FINGERTIPS[f] ?? 0)) * 3;
        if (this.present[h]) {
          ring.push(
            this.joints[o] ?? 0,
            this.joints[o + 1] ?? 0,
            this.joints[o + 2] ?? 0,
            this.now,
            S.trail.stepMs,
          );
        }
        for (let age = 0; age < ring.count - 1; age++) {
          const s0 = ring.slot(age);
          const s1 = ring.slot(age + 1);
          const older = this.now - (ring.times[s1] ?? 0);
          if (older >= life) break;
          const k0 = Math.pow(1 - clamp((this.now - (ring.times[s0] ?? 0)) / life, 0, 1), 1.5);
          const k1 = Math.pow(1 - older / life, 1.5);
          const p = seg * 6;
          for (let k = 0; k < 3; k++) {
            layer.pos[p + k] = ring.data[s0 * 3 + k] ?? 0;
            layer.pos[p + 3 + k] = ring.data[s1 * 3 + k] ?? 0;
          }
          for (let k = 0; k < 3; k++) {
            // The fingertip's own colour, fading along the trail.
            const c = this.tint[o + k] ?? 0;
            layer.col[p + k] = c * k0;
            layer.col[p + 3 + k] = c * k1;
          }
          seg++;
        }
      }
    }
    return seg;
  }

  private upload(ctx: ModeContext): void {
    const { pointGeo, pointMat, threadLayer, trailLayer } = this;
    if (!pointGeo || !pointMat || !threadLayer || !trailLayer) return;
    pointGeo.setDrawRange(0, this.pointCount);
    for (const name of POINT_ATTRIBUTES) {
      const attr = pointGeo.getAttribute(name);
      if (attr) attr.needsUpdate = true;
    }
    threadLayer.upload(this.threadSegments);
    trailLayer.upload(this.trailSegments);
    const { viewWidth: w, viewHeight: h } = ctx.viewport;
    if (w > 0 && h > 0) {
      threadLayer.setResolution(w, h);
      trailLayer.setResolution(w, h);
    }
    const ratio =
      typeof ctx.renderer.getPixelRatio === 'function' ? ctx.renderer.getPixelRatio() : 1;
    const u = pointMat.uniforms.uPixelRatio;
    if (u) u.value = ratio;
  }

  private updateStatus(ctx: ModeContext): void {
    const both = this.present[0] && this.present[1];
    let text: string;
    if (!this.present[0] && !this.present[1]) text = 'Show your hands to the camera';
    else if (both && this.style !== 'skeleton') {
      text = 'Strings link your fingertips across both hands — move, stretch, weave';
    } else if (both) text = 'Move your hands — threads stretch along your fingers';
    else text = 'Bring your other hand in to link fingertips across';
    ctx.emitStatus(text);
  }

  private uiState(): StringsUiState {
    return { style: this.style, trails: this.trails };
  }

  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / S.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('strings', this.uiState());
  }

  private build(ctx: ModeContext): void {
    const root = new THREE.Group();
    root.name = 'Mode:strings';

    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    pointGeo.setAttribute('tint', new THREE.BufferAttribute(this.pointTint, 3));
    pointGeo.setAttribute('size', new THREE.BufferAttribute(this.pointSize, 1));
    pointGeo.setDrawRange(0, 0);
    const pointMat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pointGeo, pointMat);
    points.name = 'StringsJoints';
    points.frustumCulled = false;
    points.renderOrder = 3;

    const threadLayer = new LineLayer('StringsThreads', MAX_THREADS * S.segments, [
      lineMaterial(S.glowWidth, S.glowOpacity, THREE.AdditiveBlending),
      lineMaterial(S.coreWidth, S.coreOpacity, THREE.NormalBlending),
    ]);
    const trailLayer = new LineLayer('StringsTrails', MAX_TRAIL_SEGMENTS, [
      lineMaterial(S.trailWidth, S.trailOpacity, THREE.AdditiveBlending),
    ]);
    for (const l of trailLayer.lines) l.renderOrder = 2;

    root.add(...threadLayer.lines, ...trailLayer.lines, points);
    ctx.scene.add(root);
    this.root = root;
    this.pointGeo = pointGeo;
    this.pointMat = pointMat;
    this.threadLayer = threadLayer;
    this.trailLayer = trailLayer;
  }
}
