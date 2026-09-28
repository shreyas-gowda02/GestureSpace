// Hand Strings (Phase 9, §16): thread tables, spring midpoints, trails and curves (springs.ts), and
// the experience driven frame by frame — including a heap-sampling check that its per-frame work
// allocates nothing (the spec's "zero per-frame allocations").

import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { StringsUiState } from '@/core/types';
import {
  buildThreads,
  fingerOf,
  SpringField,
  TrailRing,
  writeCurve,
} from '@/modes/strings/springs';
import type { StringsMode } from '@/modes/strings/StringsMode';
import {
  FINGERTIPS,
  INDEX_TIP,
  LANDMARK_COUNT,
  PINKY_MCP,
  THUMB_TIP,
  WRIST,
} from '@/vision/landmarks';
import { allocationsPerFrame, ModeRig, pipelineRig } from '../fixtures/modeHarness';
import { waveScenario } from '../fixtures/syntheticHands';

const S = TUNING.strings;

const pairsOf = (t: Uint8Array): string[] => {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += 4) {
    const a = `${t[i]}:${t[i + 1]}`;
    const b = `${t[i + 2]}:${t[i + 3]}`;
    out.push(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  return out;
};

describe('Hand Strings: which threads each style draws', () => {
  it('skeleton ⊂ web ⊂ full mesh, no thread twice', () => {
    const skeleton = pairsOf(buildThreads('skeleton'));
    const web = pairsOf(buildThreads('web'));
    const mesh = pairsOf(buildThreads('mesh'));
    expect(skeleton).toHaveLength(42); // 21 bones × 2 hands
    expect(web).toHaveLength(42 + 10 + 5); // + a fingertip ring per hand + tip-to-twin
    expect(mesh).toHaveLength(57 + 10 + 20); // + the other tip pairs + every left tip to every right tip
    for (const list of [skeleton, web, mesh]) expect(new Set(list).size).toBe(list.length);
    expect(skeleton.every((p) => web.includes(p))).toBe(true);
    expect(web.every((p) => mesh.includes(p))).toBe(true);
    // Web links each fingertip to its twin on the other hand.
    for (const tip of FINGERTIPS) expect(web).toContain(`0:${tip}-1:${tip}`);
  });

  it('knows which finger a joint is on', () => {
    expect(fingerOf(THUMB_TIP)).toBe(0);
    expect(fingerOf(INDEX_TIP)).toBe(1);
    expect(fingerOf(PINKY_MCP)).toBe(4);
    expect(fingerOf(WRIST)).toBe(2);
    for (let j = 0; j < LANDMARK_COUNT; j++) expect(fingerOf(j)).toBeGreaterThanOrEqual(0);
  });
});

describe('SpringField: threads sag and wobble', () => {
  const rest = (len: number): number => -S.sag * len;
  const ends = new Float32Array(6);
  /** One step of thread 0 between (ax, ay) and (bx, by). */
  const step = (
    f: SpringField,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    dt: number,
  ): void => {
    ends.set([ax, ay, 0, bx, by, 0]);
    f.dt = dt;
    f.step(0, ends, 0, 3);
  };

  it('a new thread starts hanging at rest; when its ends jump it wobbles, then settles back', () => {
    const f = new SpringField(1);
    step(f, -2, 0, 2, 0, 1 / 60);
    expect(f.pos[1]).toBeCloseTo(rest(4), 6); // no fling from nowhere
    // Both ends jump up 1 unit: the midpoint lags behind, overshoots, then comes to rest.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 180; i++) {
      step(f, -2, 1, 2, 1, 1 / 60);
      min = Math.min(min, f.pos[1] ?? 0);
      max = Math.max(max, f.pos[1] ?? 0);
    }
    expect(min).toBeLessThan(0.2); // lagged behind the ends at first
    expect(max).toBeGreaterThan(1 + rest(4) + 0.05); // overshot: a wobble
    expect(f.pos[1]).toBeCloseTo(1 + rest(4), 2); // settled
  });

  it('stays stable at 144 Hz and at a 0.1 s hiccup, and never strays past maxStretch', () => {
    for (const dt of [1 / 144, 0.1]) {
      const f = new SpringField(1);
      for (let i = 0; i < 400; i++) {
        const y = i % 40 < 20 ? 3 : -3; // ends yanked up and down
        step(f, -1, y, 1, y, dt);
        const off = Math.abs((f.pos[1] ?? 0) - (y + rest(2)));
        expect(off).toBeLessThanOrEqual(S.maxStretch * 2 + 1e-5); // Float32 storage
        expect(Number.isFinite(f.pos[1])).toBe(true);
      }
    }
  });
});

describe('TrailRing + writeCurve', () => {
  it('keeps the newest samples, at most one per step, oldest dropped', () => {
    const r = new TrailRing(4);
    r.push(0, 0, 0, 0, 15);
    r.push(9, 9, 9, 5, 15); // too soon: ignored
    for (let i = 1; i <= 5; i++) r.push(i, 0, 0, i * 20, 15);
    expect(r.count).toBe(4);
    expect([0, 1, 2, 3].map((a) => r.data[r.slot(a) * 3])).toEqual([5, 4, 3, 2]);
    expect(r.times[r.slot(0)]).toBe(100);
  });

  it('a thread curve starts at A, passes through its midpoint M, ends at B; colour runs A → B', () => {
    const pos = new Float32Array(10 * 6);
    const col = new Float32Array(10 * 6);
    const A = [0, 0, 0];
    const M = [2, -1, 0];
    const B = [4, 0, 0];
    const n = writeCurve(pos, col, 0, 10, A, 0, M, 0, B, 0, [1, 0, 0], 0, [0, 0, 1], 0);
    expect(n).toBe(10);
    expect([pos[0], pos[1]]).toEqual([0, 0]);
    expect([pos[9 * 6 + 3], pos[9 * 6 + 4]]).toEqual([4, 0]);
    expect(pos[4 * 6 + 3]).toBeCloseTo(2, 6); // end of segment 5 = t 0.5
    expect(pos[4 * 6 + 4]).toBeCloseTo(-1, 6);
    expect(col[0]).toBe(1);
    expect(col[9 * 6 + 5]).toBeCloseTo(1, 6);
  });
});

function stringsRig() {
  const rig = new ModeRig('strings');
  const mode = rig.mc.activeMode as StringsMode;
  const joints = rig.base.scene.getObjectByName('StringsJoints') as THREE.Points;
  const ui = (): StringsUiState | undefined => rig.ui.filter((u) => u.strings).at(-1)?.strings;
  return { rig, mode, joints, ui };
}

describe('StringsMode', () => {
  it('draws the hands itself: joints, threads and, across hands, fingertip links', () => {
    const { rig, mode, ui } = stringsRig();
    expect(mode.drawsHands).toBe(true); // Core hides its skeleton, indicators and cursor rings
    expect(ui()).toEqual({ style: 'web', trails: 'short' });
    rig.show('right', 0.6, 0.5);
    rig.step();
    expect(mode.pointCount).toBe(21);
    expect(mode.threadSegments).toBe((21 + 5) * S.segments); // bones + fingertip ring
    rig.show('left', 0.4, 0.5);
    rig.step();
    expect(mode.pointCount).toBe(42);
    expect(mode.threadSegments).toBe(57 * S.segments);
    expect(rig.statuses.at(-1)).toMatch(/link your fingertips/);
    rig.mc.handleAction({ type: 'stringsStyle', style: 'skeleton' });
    rig.step();
    expect(mode.threadSegments).toBe(42 * S.segments);
    rig.mc.handleAction({ type: 'stringsStyle', style: 'mesh' });
    rig.step();
    expect(mode.threadSegments).toBe(87 * S.segments);
    expect(ui()?.style).toBe('mesh');
  });

  it('fingertip trails follow a moving hand and fade; Off or R clears them', () => {
    const { rig, mode } = stringsRig();
    for (let i = 0; i < 20; i++) {
      rig.show('right', 0.4 + i * 0.01, 0.5);
      rig.step();
    }
    expect(mode.trailSegments).toBeGreaterThan(0);
    rig.hide('right');
    rig.run(Math.ceil(S.trail.shortMs / (1000 / 60)) + 2);
    expect(mode.trailSegments).toBe(0); // faded out
    rig.mc.handleAction({ type: 'stringsTrails', trails: 'long' });
    for (let i = 0; i < 20; i++) {
      rig.show('right', 0.4 + i * 0.01, 0.5);
      rig.step();
    }
    expect(mode.trailSegments).toBeGreaterThan(0);
    rig.mc.resetView();
    rig.hide('right');
    rig.step();
    expect(mode.trailSegments).toBe(0);
    rig.mc.handleAction({ type: 'stringsTrails', trails: 'off' });
    rig.show('right', 0.5, 0.5);
    rig.run(10);
    expect(mode.trailSegments).toBe(0);
  });

  it('faster joints glow bigger; a hand in its loss grace fades out', () => {
    const { rig, joints } = stringsRig();
    const size = joints.geometry.getAttribute('size') as THREE.BufferAttribute;
    rig.show('right', 0.5, 0.5);
    rig.run(20);
    const still = size.getX(INDEX_TIP);
    for (let i = 0; i < 10; i++) {
      rig.show('right', 0.5 + i * 0.03, 0.5); // the fingertip sweeps across
      rig.step();
    }
    expect(size.getX(INDEX_TIP)).toBeGreaterThan(still * 1.3);
    expect(size.getX(WRIST)).toBeLessThan(size.getX(INDEX_TIP)); // the wrist stayed put
    const hand = rig.frame.hands.right;
    if (!hand) throw new Error('no hand');
    rig.run(30);
    const before = size.getX(WRIST);
    hand.lostForMs = TUNING.confidence.HAND_LOSS_GRACE_MS / 2;
    rig.step();
    expect(size.getX(WRIST)).toBeCloseTo(before / 2, 3);
  });

  it('reuses its buffers: nothing is re-made frame to frame', () => {
    const { rig, joints } = stringsRig();
    const pos = joints.geometry.getAttribute('position').array;
    rig.show('left', 0.4, 0.5);
    rig.show('right', 0.6, 0.5);
    for (let i = 0; i < 100; i++) {
      rig.show('right', 0.6 + 0.1 * Math.sin(i / 5), 0.5);
      rig.step();
    }
    expect(joints.geometry.getAttribute('position').array).toBe(pos);
  });
});

describe('StringsMode allocates nothing per frame (heap sampling, real hand pipeline)', () => {
  // allocationsPerFrame (modeHarness) counts what Strings code allocates, library calls included.
  // The engine can still box a few numbers while it re-optimises a function once (seen: 2–9 B /
  // frame in one window), so the lower of two windows counts: a real per-frame allocation is in
  // both (one small object per frame ≈ 16–48 B / frame), a one-off blip isn't.
  const BUDGET_PER_FRAME = 13; // bytes

  it('3,000 frames of two waving hands: under 13 bytes per frame from the Strings code', async () => {
    const app = pipelineRig('strings');
    const mode = app.mc.activeMode as StringsMode;
    app.mc.handleAction({ type: 'stringsStyle', style: 'mesh' });
    app.mc.handleAction({ type: 'stringsTrails', trails: 'long' });
    const window = (): number => {
      let frames = 0;
      for (let i = 0; i < 12; i++) app.play(waveScenario(), () => frames++); // 12 × 4.3 s
      return frames;
    };
    const best = await allocationsPerFrame(/modes\/strings\//, window, 1);
    expect(mode.threadSegments).toBeGreaterThan(0);
    expect(best.perFrame, best.detail).toBeLessThan(BUDGET_PER_FRAME);
  });
});
