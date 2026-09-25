// End-to-end left/right check on the user's REAL webcam recordings (tests/fixtures/landmarks/real,
// recorded 2026-09-25): each one is replayed at 60 Hz through `perceptionStep` — exactly what Core
// runs every display frame — and every moment of what the app would show is scored (D42).
//   right-only / left-only  only one real hand is in view, so its side is known for every frame.
//   both-crossing           an answer key built from MOTION ALONE (never MediaPipe's labels): seeded
//                           while the hands start apart and uncrossed (right hand on the right of
//                           the mirrored view), then each hand is followed by its predicted position
//                           through every cross. The key is itself checked before it is trusted.
// Run this after any change to tracking, smoothing or gestures.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FixturePlaybackSource,
  parseFixture,
  type LandmarkFixture,
  type RawDetection,
  type RawHand,
} from '@/core/input';
import type { HandFrame, HandSide } from '@/core/types';
import { GestureEngine, perceptionStep } from '@/gestures/GestureEngine';
import { HandNormalizer } from '@/vision/handPipeline';
import { WRIST } from '@/vision/landmarks';

const load = (name: string): LandmarkFixture =>
  parseFixture(
    JSON.parse(readFileSync(resolve(__dirname, `../fixtures/landmarks/real/${name}.json`), 'utf8')),
  );

const TICK_MS = 1000 / 60;
const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');

/** Replays a recording through the app's perception step; `visit` sees every display frame. */
function replay(
  fixture: LandmarkFixture,
  visit: (now: number, hands: HandFrame, latest: RawDetection | null) => void,
): number {
  const src = new FixturePlaybackSource(fixture, 0, false);
  const norm = new HandNormalizer();
  const engine = new GestureEngine();
  const aspect = fixture.videoWidth / fixture.videoHeight;
  let renames = 0;
  let latest: RawDetection | null = null;
  for (let now = 0; now <= src.duration + 400; now += TICK_MS) {
    const det = src.poll(now);
    if (det) latest = det;
    if (perceptionStep(norm, engine, det, true, aspect, now, false)) renames++;
    visit(now, norm.frame, latest);
  }
  return renames;
}

/** Longest run of consecutive frames for which `bad` held, in ms. */
function runTracker(): { add(bad: boolean): void; readonly longestMs: number } {
  let run = 0;
  let longest = 0;
  return {
    add(bad) {
      run = bad ? run + TICK_MS : 0;
      if (run > longest) longest = run;
    },
    get longestMs() {
      return longest;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Answer key for both-crossing (motion only)
// ---------------------------------------------------------------------------------------------

type Identity = HandSide | 'phantom';
/** Measured independently of the app: phantoms overlap a real hand ≥ 0.17, real hands ≤ 0.14. */
const KEY_PHANTOM_OVERLAP = 0.15;
const ASPECT = 16 / 9;

const viewX = (h: RawHand): number => 1 - (h.landmarks[WRIST]?.x ?? 0);
const viewY = (h: RawHand): number => h.landmarks[WRIST]?.y ?? 0;
const wristKey = (h: RawHand): string => `${h.landmarks[WRIST]?.x},${h.landmarks[WRIST]?.y}`;

function boxOverlap(a: RawHand, b: RawHand): number {
  const box = (h: RawHand) => {
    const xs = h.landmarks.map((p) => p.x);
    const ys = h.landmarks.map((p) => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  };
  const [a0, a1, a2, a3] = box(a);
  const [b0, b1, b2, b3] = box(b);
  const ix = Math.max(0, Math.min(a2, b2) - Math.max(a0, b0));
  const iy = Math.max(0, Math.min(a3, b3) - Math.max(a1, b1));
  const inter = ix * iy;
  return inter / ((a2 - a0) * (a3 - a1) + (b2 - b0) * (b3 - b1) - inter);
}

/** Raw wrist → identity for every hand in the recording, plus facts to sanity-check the key. */
function answerKey(fixture: LandmarkFixture) {
  const byWrist = new Map<string, Identity>();
  const tracks: Record<
    HandSide,
    { x: number; y: number; vx: number; vy: number; t: number } | null
  > = { left: null, right: null };
  let crossings = 0;
  let prevSign = 0;
  let agree = 0;
  let observed = 0;
  let lastPair: { right: RawHand; left: RawHand } | null = null;

  for (const fr of fixture.frames) {
    let hands = fr.hands;
    const [h0, h1] = hands;
    if (h0 && h1 && boxOverlap(h0, h1) > KEY_PHANTOM_OVERLAP) {
      const [keep, drop] = h0.score >= h1.score ? [h0, h1] : [h1, h0];
      byWrist.set(wristKey(drop), 'phantom');
      hands = [keep];
    }
    if (!tracks.left || !tracks.right) {
      const [a, b] = hands;
      if (!a || !b) continue;
      const [r, l] = viewX(a) > viewX(b) ? [a, b] : [b, a]; // start: apart, uncrossed
      tracks.right = { x: viewX(r), y: viewY(r), vx: 0, vy: 0, t: fr.timestamp };
      tracks.left = { x: viewX(l), y: viewY(l), vx: 0, vy: 0, t: fr.timestamp };
      byWrist.set(wristKey(r), 'right');
      byWrist.set(wristKey(l), 'left');
      continue;
    }
    const dist = (h: RawHand, s: HandSide): number => {
      const tr = tracks[s];
      if (!tr) return Infinity;
      const dt = Math.min((fr.timestamp - tr.t) / 1000, 0.15);
      const stale = fr.timestamp - tr.t > 400 ? 0.15 : 0;
      return (
        Math.hypot((viewX(h) - tr.x - tr.vx * dt) * ASPECT, viewY(h) - tr.y - tr.vy * dt) + stale
      );
    };
    const assign: [RawHand, HandSide][] = [];
    const [a, b] = hands;
    if (a && b) {
      const straight = dist(a, 'right') + dist(b, 'left');
      const crossed = dist(a, 'left') + dist(b, 'right');
      assign.push(
        ...((straight <= crossed
          ? [
              [a, 'right'],
              [b, 'left'],
            ]
          : [
              [a, 'left'],
              [b, 'right'],
            ]) as [RawHand, HandSide][]),
      );
    } else if (a) {
      assign.push([a, dist(a, 'right') <= dist(a, 'left') ? 'right' : 'left']);
    }
    for (const [h, s] of assign) {
      const tr = tracks[s];
      if (!tr) continue;
      const dt = (fr.timestamp - tr.t) / 1000;
      const k = dt > 0 && dt < 0.2 ? 0.5 : 0;
      tracks[s] = {
        x: viewX(h),
        y: viewY(h),
        vx: k ? (1 - k) * tr.vx + (k * (viewX(h) - tr.x)) / dt : 0,
        vy: k ? (1 - k) * tr.vy + (k * (viewY(h) - tr.y)) / dt : 0,
        t: fr.timestamp,
      };
      byWrist.set(wristKey(h), s);
      observed++;
      if (h.handedness.toLowerCase() === s) agree++;
    }
    const right = assign.find(([, s]) => s === 'right')?.[0];
    const left = assign.find(([, s]) => s === 'left')?.[0];
    if (right && left) {
      const sign = Math.sign(viewX(right) - viewX(left));
      if (prevSign && sign !== prevSign) crossings++;
      prevSign = sign;
      lastPair = { right, left };
    }
  }
  return { byWrist, crossings, mediaPipeAgreement: agree / observed, lastPair };
}

// ---------------------------------------------------------------------------------------------

describe('real recordings: which hand is which (end to end)', () => {
  for (const [name, truth] of [
    ['right-only', 'right'],
    ['left-only', 'left'],
  ] as const) {
    it(`${name}: the hand is always shown as ${truth}, never as a phantom second hand`, () => {
      let shownMs = 0;
      let misnamedMs = 0; // the real hand shown as the other side
      let extraMs = 0; // a second (phantom) hand on screen
      let hiddenMs = 0; // the hand is in view but not shown (waiting to be named)
      const wrong = runTracker();
      const renames = replay(load(name), (_now, hands, latest) => {
        const good = hands[truth];
        const bad = hands[other(truth)];
        if (latest?.hands.length && !good && !bad) hiddenMs += TICK_MS;
        if (good || bad) shownMs += TICK_MS;
        if (bad && good) extraMs += TICK_MS;
        if (bad && !good) misnamedMs += TICK_MS;
        wrong.add(!!bad);
      });
      console.info(
        `${name}: shown ${(shownMs / 1000).toFixed(1)} s · misnamed ${misnamedMs.toFixed(0)} ms · ` +
          `phantom second hand ${extraMs.toFixed(0)} ms · hidden ${hiddenMs.toFixed(0)} ms · longest wrong ${wrong.longestMs.toFixed(0)} ms · renames ${renames}`,
      );
      expect(shownMs).toBeGreaterThan(50_000); // the recording really was replayed
      expect(misnamedMs).toBe(0);
      expect(extraMs).toBe(0);
      // Waiting to name a new hand (D42) must stay rare and short. Measured: 0 / 383 ms.
      expect(hiddenMs).toBeLessThan(600);
    });
  }

  it('both-crossing: every hand shown as its true side through every cross', () => {
    const fixture = load('both-crossing');
    const key = answerKey(fixture);
    // Trust the key only if it passes its own checks.
    expect(key.crossings).toBeGreaterThanOrEqual(8); // ≥ 4 cross-and-uncross cycles found
    expect(key.mediaPipeAgreement).toBeGreaterThan(0.97);
    const end = key.lastPair;
    expect(end).not.toBeNull();
    if (end) expect(viewX(end.right)).toBeGreaterThan(viewX(end.left)); // ends uncrossed

    let shownMs = 0;
    let wrongMs = 0;
    let phantomMs = 0;
    let unknownMs = 0;
    let hiddenMs = 0;
    const wrong = runTracker();
    const renames = replay(fixture, (_now, hands, latest) => {
      let bad = false;
      const shownWrists = new Set(
        [hands.left, hands.right].map(
          (h) => h && `${h.rawLandmarks[WRIST]?.x},${h.rawLandmarks[WRIST]?.y}`,
        ),
      );
      for (const raw of latest?.hands ?? []) {
        const id = key.byWrist.get(wristKey(raw));
        if ((id === 'left' || id === 'right') && !shownWrists.has(wristKey(raw)))
          hiddenMs += TICK_MS;
      }
      for (const side of ['left', 'right'] as const) {
        const h = hands[side];
        if (!h) continue;
        shownMs += TICK_MS;
        const w = h.rawLandmarks[WRIST];
        const id = w ? key.byWrist.get(`${w.x},${w.y}`) : undefined;
        if (id === undefined) unknownMs += TICK_MS;
        else if (id === 'phantom') {
          phantomMs += TICK_MS;
          bad = true;
        } else if (id !== side) {
          wrongMs += TICK_MS;
          bad = true;
        }
      }
      wrong.add(bad);
    });
    console.info(
      `both-crossing: hand-time ${(shownMs / 1000).toFixed(1)} s · wrong side ${wrongMs.toFixed(0)} ms · ` +
        `phantom ${phantomMs.toFixed(0)} ms · hidden ${hiddenMs.toFixed(0)} ms · unkeyed ${unknownMs.toFixed(0)} ms · longest wrong ${wrong.longestMs.toFixed(0)} ms · renames ${renames}`,
    );
    expect(shownMs).toBeGreaterThan(100_000);
    expect(unknownMs).toBe(0);
    expect(wrongMs).toBe(0);
    expect(phantomMs).toBe(0);
    // 1.5 s was already lost before D42 (MediaPipe drops a hand while they overlap); D42 adds ~0.3 s.
    expect(hiddenMs).toBeLessThan(2200);
  });
});
