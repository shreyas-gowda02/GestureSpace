// Perception: RawDetection → HandFrame (§8, §10). Per inference:
//   1. confidence gate            drop detections below MIN_HAND_SCORE
//   2. main-user lock             of up to 4 detected hands, keep ONE person's pair (continuity
//                                 with tracked hands → largest hand → a plausible partner)
//   3. side assignment            MediaPipe labels, with hysteresis; locked during captures
//   4. jump rejection             ignore a single impossible wrist jump
//   5. One Euro smoothing         visual + trigger profiles
// Every render frame, `tick()` predicts the visual landmarks to "now" (render 60 Hz vs inference
// 30 Hz) and runs the loss grace period (freeze, then remove).
// All objects are preallocated and reused — no per-frame allocation.

import { TUNING } from '@/config/tuning';
import type { HandFrame, HandSide, TrackedHand, Vec2, Vec3 } from '@/core/types';
import type { RawDetection, RawHand } from '@/core/input';
import { boundsInto, LANDMARK_COUNT, makeLandmarkBuffer, palmScale, WRIST } from './landmarks';
import { LandmarkSmoother, smoothingToMinCutoff, type SmoothingMode } from './smoothing';

const SIDES: readonly HandSide[] = ['right', 'left'];
const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');
const MAX_CANDIDATES = 4;

/** Mutable backing object for a TrackedHand (consumers see the readonly interface). */
export class HandSlot implements TrackedHand {
  side: HandSide;
  score = 0;
  readonly rawLandmarks: Vec3[] = makeLandmarkBuffer();
  readonly landmarks: Vec3[] = makeLandmarkBuffer();
  readonly triggerLandmarks: Vec3[] = makeLandmarkBuffer();
  readonly worldLandmarks: Vec3[] = makeLandmarkBuffer();
  palmScale = 0;
  readonly bbox: { min: Vec2; max: Vec2 } = { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  lostForMs = 0;
  /** MediaPipe's original label (debug only). */
  rawLabel = '';

  // --- pipeline state (not part of TrackedHand) ---
  present = false;
  lostSince = -1;
  /** Unsmoothed view-space wrist of the last accepted sample (continuity + jump checks). */
  readonly lastWrist: Vec2 = { x: 0, y: 0 };
  jumpCount = 0;
  /** Render time of the last accepted sample (prediction horizon starts here). */
  sampledAt = 0;
  readonly viewRaw: Vec3[] = makeLandmarkBuffer();
  readonly smoother = new LandmarkSmoother();

  constructor(side: HandSide) {
    this.side = side;
  }
}

/**
 * Map a MediaPipe handedness label to the user's PHYSICAL hand.
 * `swap` is TUNING.tracker.HANDEDNESS_LABEL_SWAP (false: verified on a real webcam, D16).
 */
export function labelToSide(label: string, swap: boolean): HandSide | null {
  const l = label.toLowerCase();
  if (l !== 'left' && l !== 'right') return null;
  const side: HandSide = l;
  if (!swap) return side;
  return side === 'left' ? 'right' : 'left';
}

interface Candidate {
  raw: RawHand | null;
  /** Wrist in view space (mirrored if the view is). */
  x: number;
  y: number;
  palm: number;
  label: HandSide | null;
  used: boolean;
}

interface Selection {
  cand: Candidate | null;
  /** Side this detection continues from (null = newly acquired). */
  prev: HandSide | null;
  side: HandSide | null;
}

export interface NormalizerOptions {
  swapLabels?: boolean;
}

export class HandNormalizer {
  /** Reused output — valid until the next `process()` / `tick()`. */
  readonly frame: HandFrame = { timestamp: 0, inferenceTimestamp: 0 };
  readonly slots: Readonly<Record<HandSide, HandSlot>> = {
    left: new HandSlot('left'),
    right: new HandSlot('right'),
  };

  /** Debug: hands reported by the tracker / that passed the gate / used (main user). */
  detectedCount = 0;
  gatedCount = 0;
  usedCount = 0;
  /** While true (a gesture capture is active), sides follow proximity only — labels are ignored. */
  identityLocked = false;
  /** Visual landmark mode: raw ('off'), filtered ('smooth') or filtered + predicted ('predict'). */
  smoothingMode: SmoothingMode = 'predict';

  private readonly swap: boolean;
  private readonly cands: Candidate[] = Array.from({ length: MAX_CANDIDATES }, () => ({
    raw: null,
    x: 0,
    y: 0,
    palm: 0,
    label: null,
    used: false,
  }));
  private candCount = 0;
  private readonly sel: Selection[] = [
    { cand: null, prev: null, side: null },
    { cand: null, prev: null, side: null },
  ];
  private selCount = 0;
  private labelDisagree = 0;

  constructor(opts: NormalizerOptions = {}) {
    this.swap = opts.swapLabels ?? TUNING.tracker.HANDEDNESS_LABEL_SWAP;
  }

  setIdentityLock(locked: boolean): void {
    this.identityLocked = locked;
  }

  /** Apply the Settings "Smoothing" slider (0..1) to the visual profile of both hands. */
  setSmoothing(slider: number): void {
    const hz = smoothingToMinCutoff(slider);
    for (const s of SIDES) this.slots[s].smoother.setVisualMinCutoff(hz);
  }

  get visualMinCutoff(): number {
    return this.slots.right.smoother.visualMinCutoff;
  }

  /** Debug-panel switch to compare raw vs smoothed vs smoothed + predicted visuals live. */
  setSmoothingMode(mode: SmoothingMode): void {
    this.smoothingMode = mode;
  }

  /**
   * @param mirror whether the view is mirrored (selfie); view x = mirror ? 1 - x : x
   * @param now render timestamp (ms)
   */
  process(det: RawDetection, mirror: boolean, now: number): HandFrame {
    this.frame.inferenceTimestamp = det.timestamp;
    const aspect = det.videoHeight > 0 ? det.videoWidth / det.videoHeight : 1;

    this.gather(det, mirror, aspect);
    this.select(aspect);
    this.assignSides();

    let forRight: Selection | null = null;
    let forLeft: Selection | null = null;
    for (let i = 0; i < this.selCount; i++) {
      const s = this.sel[i];
      if (s?.side === 'right') forRight = s;
      else if (s?.side === 'left') forLeft = s;
    }

    // Assigned → new sample; unassigned but present → start the grace period.
    for (const side of SIDES) {
      const slot = this.slots[side];
      const s = side === 'right' ? forRight : forLeft;
      if (s?.cand?.raw) {
        this.updateSlot(slot, s.cand.raw, s.prev === side, mirror, aspect, det.timestamp, now);
      } else if (slot.present && slot.lostSince < 0) {
        slot.lostSince = now;
      }
    }
    return this.tick(now);
  }

  /** Every render frame: predict visual landmarks to `now`; advance the loss grace period. */
  tick(now: number): HandFrame {
    const f = this.frame;
    f.timestamp = now;
    const predict = this.smoothingMode === 'predict';
    for (const side of SIDES) {
      const slot = this.slots[side];
      if (slot.present && slot.lostSince >= 0) {
        slot.lostForMs = now - slot.lostSince;
        if (slot.lostForMs > TUNING.confidence.HAND_LOSS_GRACE_MS) this.dropSlot(slot);
        else if (predict) slot.smoother.predictVisual(slot.landmarks, 0); // freeze, no drift
      } else if (slot.present && predict) {
        const ahead = Math.min(
          Math.max(now - slot.sampledAt, 0),
          TUNING.smoothing.predict.maxAheadMs,
        );
        slot.smoother.predictVisual(slot.landmarks, ahead);
        boundsInto(slot.bbox, slot.landmarks);
      }
      f[side] = slot.present ? slot : undefined;
    }
    return f;
  }

  /** Mark hands as not visible (e.g. camera stopped, input switched). */
  clear(now: number): HandFrame {
    for (const side of SIDES) this.dropSlot(this.slots[side]);
    this.labelDisagree = 0;
    this.detectedCount = this.gatedCount = this.usedCount = 0;
    this.frame.timestamp = now;
    this.frame.left = undefined;
    this.frame.right = undefined;
    return this.frame;
  }

  // -------------------------------------------------------------------------------------------

  /** 1. Confidence gate → candidates. */
  private gather(det: RawDetection, mirror: boolean, aspect: number): void {
    this.detectedCount = det.hands.length;
    let n = 0;
    for (const raw of det.hands) {
      if (n >= MAX_CANDIDATES) break;
      if (raw.score < TUNING.confidence.MIN_HAND_SCORE) continue;
      const c = this.cands[n];
      const w = raw.landmarks[WRIST];
      if (!c || !w) continue;
      c.raw = raw;
      c.x = mirror ? 1 - w.x : w.x;
      c.y = w.y;
      c.palm = palmScale(raw.landmarks, aspect); // mirror-invariant
      c.label = labelToSide(raw.handedness, this.swap);
      c.used = false;
      n++;
    }
    this.candCount = n;
    this.gatedCount = n;
  }

  /** 2. Main-user lock: pick ≤ 2 candidates belonging to one person. */
  private select(aspect: number): void {
    this.selCount = 0;
    const dist = (ax: number, ay: number, bx: number, by: number): number => {
      const dx = (ax - bx) * aspect;
      const dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // a) Continuity: keep following hands we already track (closest pairs first).
    let takenRight = false;
    let takenLeft = false;
    for (let round = 0; round < 2; round++) {
      let best: Candidate | null = null;
      let bestSide: HandSide | null = null;
      let bestD: number = TUNING.userLock.matchMaxDist;
      for (const side of SIDES) {
        const slot = this.slots[side];
        if (!slot.present || (side === 'right' ? takenRight : takenLeft)) continue;
        for (let i = 0; i < this.candCount; i++) {
          const c = this.cands[i];
          if (!c || c.used) continue;
          const d = dist(c.x, c.y, slot.lastWrist.x, slot.lastWrist.y);
          if (d < bestD) {
            bestD = d;
            best = c;
            bestSide = side;
          }
        }
      }
      if (!best || !bestSide) break;
      best.used = true;
      if (bestSide === 'right') takenRight = true;
      else takenLeft = true;
      this.pushSel(best, bestSide);
    }

    // b) Fresh acquisition: the largest hand = the person closest to the camera.
    if (this.selCount === 0) {
      let anchor: Candidate | null = null;
      for (let i = 0; i < this.candCount; i++) {
        const c = this.cands[i];
        if (c && !c.used && (!anchor || c.palm > anchor.palm)) anchor = c;
      }
      if (anchor) {
        anchor.used = true;
        this.pushSel(anchor, null);
      }
    }

    // c) Partner: a second hand of plausibly the same person (similar size, within reach).
    const anchor = this.selCount === 1 ? this.sel[0]?.cand : null;
    if (anchor && anchor.palm > 0) {
      const ul = TUNING.userLock;
      let best: Candidate | null = null;
      let bestScore = Infinity;
      for (let i = 0; i < this.candCount; i++) {
        const c = this.cands[i];
        if (!c || c.used) continue;
        const ratio = c.palm / anchor.palm;
        if (ratio < ul.partnerScaleRatio.min || ratio > ul.partnerScaleRatio.max) continue;
        const palms = dist(c.x, c.y, anchor.x, anchor.y) / anchor.palm;
        if (palms > ul.partnerMaxDistPalms) continue;
        const labelPenalty = c.label && anchor.label && c.label === anchor.label ? 0.5 : 0;
        const score = Math.abs(Math.log(ratio)) + 0.05 * palms + labelPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) {
        best.used = true;
        this.pushSel(best, null);
      }
    }
    this.usedCount = this.selCount;
  }

  private pushSel(cand: Candidate, prev: HandSide | null): void {
    const s = this.sel[this.selCount];
    if (!s) return;
    s.cand = cand;
    s.prev = prev;
    s.side = null;
    this.selCount++;
  }

  /** 3. Sides: labels propose, continuity holds; flips need `labelSwitchFrames` agreement. */
  private assignSides(): void {
    const a = this.sel[0];
    const b = this.sel[1];
    if (!a?.cand || !b || this.selCount === 0) return;
    const pair = this.selCount === 2 && b.cand !== null;

    // Proposal from MediaPipe labels.
    let pa: HandSide;
    let pb: HandSide | null = null;
    if (pair && b.cand) {
      const la = a.cand.label;
      const lb = b.cand.label;
      if (la && lb && la !== lb) {
        pa = la;
        pb = lb;
      } else {
        // Ambiguous: the hand displayed on the right is the right hand (the view is a mirror).
        pa = a.cand.x >= b.cand.x ? 'right' : 'left';
        pb = other(pa);
      }
    } else {
      pa = a.cand.label ?? (a.cand.x >= 0.5 ? 'right' : 'left');
    }

    // Continuation from already-tracked hands.
    let ca: HandSide | null = a.prev;
    let cb: HandSide | null = pair ? b.prev : null;
    if (pair) {
      if (ca && !cb) cb = other(ca);
      else if (cb && !ca) ca = other(cb);
    }

    if (!ca) {
      a.side = pa;
      b.side = pb;
      this.labelDisagree = 0;
      return;
    }
    const agrees = ca === pa && (!pair || cb === pb);
    if (this.identityLocked || agrees) {
      this.labelDisagree = 0;
    } else if (++this.labelDisagree >= TUNING.userLock.labelSwitchFrames) {
      this.labelDisagree = 0;
      a.side = pa;
      b.side = pb;
      return;
    }
    a.side = ca;
    b.side = cb;
  }

  /** 4 + 5. Jump rejection, smoothing, metrics. */
  private updateSlot(
    slot: HandSlot,
    raw: RawHand,
    continuing: boolean,
    mirror: boolean,
    aspect: number,
    t: number,
    now: number,
  ): void {
    const w = raw.landmarks[WRIST];
    if (!w) return;
    const vx = mirror ? 1 - w.x : w.x;

    let restart = !continuing || !slot.present;
    if (!restart) {
      const dx = (vx - slot.lastWrist.x) * aspect;
      const dy = w.y - slot.lastWrist.y;
      if (Math.sqrt(dx * dx + dy * dy) > TUNING.confidence.MAX_JUMP) {
        if (++slot.jumpCount < TUNING.confidence.JUMP_ACCEPT_AFTER) return; // glitch: ignore once
        restart = true; // persistent → a real move; restart the filters
      }
    }
    slot.jumpCount = 0;
    if (restart) slot.smoother.reset();

    slot.score = raw.score;
    slot.rawLabel = raw.handedness;
    for (let j = 0; j < LANDMARK_COUNT; j++) {
      const s = raw.landmarks[j];
      const r = slot.rawLandmarks[j];
      const v = slot.viewRaw[j];
      if (!s || !r || !v) continue;
      r.x = s.x;
      r.y = s.y;
      r.z = s.z;
      v.x = mirror ? 1 - s.x : s.x;
      v.y = s.y;
      v.z = s.z;
      const sw = raw.worldLandmarks?.[j];
      const dw = slot.worldLandmarks[j];
      if (sw && dw) {
        dw.x = sw.x;
        dw.y = sw.y;
        dw.z = sw.z;
      }
    }
    slot.smoother.apply(slot.viewRaw, slot.landmarks, slot.triggerLandmarks, t);
    if (this.smoothingMode === 'off') {
      for (let j = 0; j < LANDMARK_COUNT; j++) {
        const v = slot.viewRaw[j];
        const d = slot.landmarks[j];
        if (v && d) {
          d.x = v.x;
          d.y = v.y;
          d.z = v.z;
        }
      }
    }
    slot.sampledAt = now;
    slot.palmScale = palmScale(slot.landmarks, aspect);
    boundsInto(slot.bbox, slot.landmarks);
    slot.lastWrist.x = vx;
    slot.lastWrist.y = w.y;
    slot.present = true;
    slot.lostSince = -1;
    slot.lostForMs = 0;
  }

  private dropSlot(slot: HandSlot): void {
    slot.present = false;
    slot.lostSince = -1;
    slot.lostForMs = 0;
    slot.jumpCount = 0;
    slot.smoother.reset();
  }
}
