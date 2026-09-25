// Perception: RawDetection → HandFrame (§8, §10). Per inference:
//   1. confidence gate            drop detections below MIN_HAND_SCORE
//   2. phantom filter             drop the less confident of two heavily overlapping detections
//                                 (MediaPipe sometimes reports one hand twice — D42)
//   3. main-user lock             keep ONE person's pair (continuity with tracked hands → largest
//                                 hand → a plausible partner)
//   4. sides by evidence          every tracked hand collects two confidence-weighted votes —
//                                 MediaPipe's label and the 3D "thumb check" (chirality) — and is
//                                 renamed only on clear evidence. A rename SWAPS the two slots, so the
//                                 hand keeps its smoothing and identity; Core moves gestures,
//                                 captures and depth with it (`takeSwap()`, D42). A hand that just
//                                 came into view waits (≤ maxNamingWaitMs) until its side is clear
//   5. jump rejection             ignore a single impossible wrist jump
//   6. One Euro smoothing         visual + trigger profiles
// Every render frame, `tick()` predicts the visual landmarks to "now" (render 60 Hz vs inference
// 30 Hz) and runs the loss grace period (freeze, then remove).
// All objects are preallocated and reused — no per-frame allocation.

import { TUNING } from '@/config/tuning';
import type { HandFrame, HandSide, TrackedHand, Vec2, Vec3 } from '@/core/types';
import type { RawDetection, RawHand } from '@/core/input';
import { clamp } from '@/utils/math';
import {
  boundsInto,
  INDEX_MCP,
  LANDMARK_COUNT,
  makeLandmarkBuffer,
  palmScale,
  PINKY_MCP,
  THUMB_CMC,
  WRIST,
} from './landmarks';
import { LandmarkSmoother, smoothingToMinCutoff, type SmoothingMode } from './smoothing';

const SIDES: readonly HandSide[] = ['right', 'left'];
const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');
const MAX_CANDIDATES = 4;
/** Evidence this close to zero is "no evidence" (a brand-new hand falls back to label/position). */
const NO_EVIDENCE = 0.05;

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
  /** Running handedness votes (D42), > 0 = physical right: MediaPipe label · 3D thumb check. */
  voteLabel = 0;
  vote3d = 0;

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

/**
 * The 3D "thumb check" (D42): signed, normalised volume spanned by the hand's own axes —
 * wrist → index knuckle, wrist → little-finger knuckle, wrist → thumb base — in MediaPipe's world
 * (3D) landmarks. Turning, tilting or flipping the hand rotates all three together, so the sign
 * never changes; only the mirror-image hand flips it. > 0 = right hand (un-mirrored camera),
 * ≈ 0 = flat / edge-on (uninformative), NaN = no 3D data (e.g. synthetic fixtures).
 */
export function handChirality(world: readonly Vec3[] | undefined): number {
  const w = world?.[WRIST];
  const i = world?.[INDEX_MCP];
  const p = world?.[PINKY_MCP];
  const t = world?.[THUMB_CMC];
  if (!w || !i || !p || !t) return NaN;
  const ux = i.x - w.x;
  const uy = i.y - w.y;
  const uz = i.z - w.z;
  const vx = p.x - w.x;
  const vy = p.y - w.y;
  const vz = p.z - w.z;
  const tx = t.x - w.x;
  const ty = t.y - w.y;
  const tz = t.z - w.z;
  const volume = ux * (vy * tz - vz * ty) - uy * (vx * tz - vz * tx) + uz * (vx * ty - vy * tx);
  const norm = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) * Math.hypot(tx, ty, tz);
  return norm > 0 ? volume / norm : 0;
}

const ramp = (v: number, r: { min: number; full: number }): number =>
  clamp((v - r.min) / (r.full - r.min), 0, 1);

/** One inference's MediaPipe-label vote: ±1 when confident, → 0 when it is a coin flip. */
function labelVote(side: HandSide | null, score: number): number {
  if (!side) return 0;
  const w = ramp(score, TUNING.handedness.labelScore);
  return side === 'right' ? w : -w;
}

/** One inference's 3D thumb-check vote: ±1 when the hand's 3D shape is clear, → 0 when flat. */
function chiralityVote(chirality: number, swap: boolean): number {
  if (!Number.isFinite(chirality)) return 0;
  const w = ramp(Math.abs(chirality), TUNING.handedness.chirality);
  // A pre-mirrored camera (swap) mirrors the 3D landmarks exactly like it swaps the labels.
  return chirality > 0 !== swap ? w : -w;
}

interface Candidate {
  raw: RawHand | null;
  score: number;
  /** Wrist in view space (mirrored if the view is). */
  x: number;
  y: number;
  palm: number;
  label: HandSide | null;
  chirality: number;
  /** This inference's votes on their own (> 0 = right). */
  voteLabel: number;
  vote3d: number;
  /** Landmark bounds in raw image space (for the phantom test). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  phantom: boolean;
  used: boolean;
}

/** Box overlap (intersection over union) of two candidates. */
function overlap(a: Candidate, b: Candidate): number {
  const ix = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const iy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const union = (a.maxX - a.minX) * (a.maxY - a.minY) + (b.maxX - b.minX) * (b.maxY - b.minY);
  return union - inter > 0 ? inter / (union - inter) : 0;
}

interface Selection {
  cand: Candidate | null;
  /** Side this detection continues from (null = newly acquired). */
  prev: HandSide | null;
  side: HandSide | null;
  /** Votes a NEW hand already gathered while waiting to be named (see `Pending`). */
  baseLabel: number;
  base3d: number;
  /** When this hand was first seen (new hands only). */
  since: number;
  /** Running votes including this inference (written to the slot if the sample is accepted). */
  voteLabel: number;
  vote3d: number;
}

/** A hand that came into view but whose side is not yet clear — not shown yet (D42). */
interface Pending {
  active: boolean;
  x: number;
  y: number;
  voteLabel: number;
  vote3d: number;
  since: number;
}

const makeSelection = (): Selection => ({
  cand: null,
  prev: null,
  side: null,
  baseLabel: 0,
  base3d: 0,
  since: 0,
  voteLabel: 0,
  vote3d: 0,
});

export interface NormalizerOptions {
  swapLabels?: boolean;
}

export class HandNormalizer {
  /** Reused output — valid until the next `process()` / `tick()`. */
  readonly frame: HandFrame = { timestamp: 0, inferenceTimestamp: 0 };
  /** Slots are keyed by side; a rename swaps the two slot objects (the hand keeps its state). */
  readonly slots: Record<HandSide, HandSlot> = {
    left: new HandSlot('left'),
    right: new HandSlot('right'),
  };

  /** Debug: hands reported / that passed the gate / dropped as phantoms / used (main user). */
  detectedCount = 0;
  gatedCount = 0;
  phantomCount = 0;
  usedCount = 0;

  /** Debug: hands in view whose side is not clear yet (not shown until it is). */
  get pendingCount(): number {
    let n = 0;
    for (const p of this.pending) if (p.active) n++;
    return n;
  }
  /** A gesture holds something: renames need stronger evidence, including the 3D vote (D42). */
  identityLocked = false;
  /** Visual landmark mode: raw ('off'), filtered ('smooth') or filtered + predicted ('predict'). */
  smoothingMode: SmoothingMode = 'predict';

  private readonly swap: boolean;
  private readonly cands: Candidate[] = Array.from({ length: MAX_CANDIDATES }, () => ({
    raw: null,
    score: 0,
    x: 0,
    y: 0,
    palm: 0,
    label: null,
    chirality: NaN,
    voteLabel: 0,
    vote3d: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    phantom: false,
    used: false,
  }));
  private candCount = 0;
  private readonly sel: Selection[] = [makeSelection(), makeSelection()];
  private selCount = 0;
  private readonly pending: Pending[] = Array.from({ length: 2 }, () => ({
    active: false,
    x: 0,
    y: 0,
    voteLabel: 0,
    vote3d: 0,
    since: 0,
  }));
  private swapped = false;

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
   * True once after an inference that renamed a tracked hand (left ↔ right). The caller must move
   * everything it keeps per side (gesture machines, captures, depth…) so it follows the hand.
   */
  takeSwap(): boolean {
    const s = this.swapped;
    this.swapped = false;
    return s;
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
    this.matchPending(aspect, now);
    this.vote();
    this.holdBackUnclear(now);
    this.decideSides();
    this.applyRenames();

    // Assigned → new sample; unassigned but present → start the grace period.
    for (const side of SIDES) {
      const slot = this.slots[side];
      let s: Selection | null = null;
      for (let i = 0; i < this.selCount; i++)
        if (this.sel[i]?.side === side) s = this.sel[i] ?? null;
      if (s?.cand?.raw) {
        this.updateSlot(slot, s, mirror, aspect, det.timestamp, now);
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
    for (const p of this.pending) p.active = false;
    this.swapped = false;
    this.detectedCount = this.gatedCount = this.phantomCount = this.usedCount = 0;
    this.frame.timestamp = now;
    this.frame.left = undefined;
    this.frame.right = undefined;
    return this.frame;
  }

  // -------------------------------------------------------------------------------------------

  /** 1 + 2. Confidence gate → candidates, then drop phantom duplicates. */
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
      c.score = raw.score;
      c.x = mirror ? 1 - w.x : w.x;
      c.y = w.y;
      c.palm = palmScale(raw.landmarks, aspect); // mirror-invariant
      c.label = labelToSide(raw.handedness, this.swap);
      c.chirality = handChirality(raw.worldLandmarks);
      c.voteLabel = labelVote(c.label, c.score);
      c.vote3d = chiralityVote(c.chirality, this.swap);
      c.minX = c.minY = Infinity;
      c.maxX = c.maxY = -Infinity;
      for (const p of raw.landmarks) {
        if (p.x < c.minX) c.minX = p.x;
        if (p.y < c.minY) c.minY = p.y;
        if (p.x > c.maxX) c.maxX = p.x;
        if (p.y > c.maxY) c.maxY = p.y;
      }
      c.phantom = false;
      c.used = false;
      n++;
    }
    this.gatedCount = n;

    // MediaPipe sometimes reports one hand twice; two real hands never overlap this much.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.cands[i];
        const b = this.cands[j];
        if (!a || !b || a.phantom || b.phantom) continue;
        if (overlap(a, b) > TUNING.handedness.phantomOverlap) {
          (a.score >= b.score ? b : a).phantom = true;
        }
      }
    }
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const c = this.cands[i];
      if (!c || c.phantom) continue;
      const t = this.cands[kept];
      if (t) this.cands[i] = t;
      this.cands[kept++] = c;
    }
    this.phantomCount = n - kept;
    this.candCount = kept;
  }

  /** 3. Main-user lock: pick ≤ 2 candidates belonging to one person. */
  private select(aspect: number): void {
    this.selCount = 0;
    const dist = (ax: number, ay: number, bx: number, by: number): number => {
      const dx = (ax - bx) * aspect;
      const dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // a) Continuity: keep following hands we already track (cheapest pairs first). With both
    //    hands tracked (e.g. crossing close together), a detection whose own votes clearly
    //    contradict a track's settled side prefers the other track (D42). This only chooses
    //    BETWEEN tracks — it never turns a tracked hand into a new one.
    const h = TUNING.handedness;
    const bothTracked = this.slots.left.present && this.slots.right.present;
    let takenRight = false;
    let takenLeft = false;
    for (let round = 0; round < 2; round++) {
      let best: Candidate | null = null;
      let bestSide: HandSide | null = null;
      let bestCost = Infinity;
      for (const side of SIDES) {
        const slot = this.slots[side];
        if (!slot.present || (side === 'right' ? takenRight : takenLeft)) continue;
        const belief = slot.voteLabel + slot.vote3d;
        for (let i = 0; i < this.candCount; i++) {
          const c = this.cands[i];
          if (!c || c.used) continue;
          const d = dist(c.x, c.y, slot.lastWrist.x, slot.lastWrist.y);
          if (d >= TUNING.userLock.matchMaxDist) continue;
          const own = c.voteLabel + c.vote3d;
          const contradicts =
            bothTracked &&
            own * belief < 0 &&
            Math.abs(own) >= h.contradictVote &&
            Math.abs(belief) >= h.switchMargin;
          const cost = d + (contradicts ? h.contradictPenalty : 0);
          if (cost < bestCost) {
            bestCost = cost;
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

  /** 4a. A new hand may be one that was waiting to be named: pick up its votes and start time. */
  private matchPending(aspect: number, now: number): void {
    for (let i = 0; i < this.selCount; i++) {
      const s = this.sel[i];
      const c = s?.cand;
      if (!s || !c) continue;
      s.baseLabel = s.base3d = 0;
      s.since = now;
      if (s.prev) continue;
      let best: Pending | null = null;
      let bestD: number = TUNING.userLock.matchMaxDist;
      for (const p of this.pending) {
        if (!p.active) continue;
        const d = Math.hypot((c.x - p.x) * aspect, c.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) continue;
      best.active = false; // claimed; re-stored below if it must keep waiting
      s.baseLabel = best.voteLabel;
      s.base3d = best.vote3d;
      s.since = best.since;
    }
    for (const p of this.pending) p.active = false; // unclaimed: the hand is gone
  }

  /** 4b. Add this inference's two votes to each hand's running evidence. */
  private vote(): void {
    const h = TUNING.handedness;
    for (let i = 0; i < this.selCount; i++) {
      const s = this.sel[i];
      const c = s?.cand;
      if (!s || !c) continue;
      const slot = s.prev ? this.slots[s.prev] : null;
      const baseLabel = slot ? slot.voteLabel : s.baseLabel;
      const base3d = slot ? slot.vote3d : s.base3d;
      s.voteLabel = clamp(baseLabel * h.decay + c.voteLabel, -h.cap, h.cap);
      s.vote3d = clamp(base3d * h.decay + c.vote3d, -h.cap, h.cap);
    }
  }

  /**
   * 4c. A hand that just came into view is not shown until its side is clear (or it has waited
   * `maxNamingWaitMs`): a hand entering edge-on can give weak, wrong votes for a few frames.
   */
  private holdBackUnclear(now: number): void {
    const h = TUNING.handedness;
    let kept = 0;
    for (let i = 0; i < this.selCount; i++) {
      const s = this.sel[i];
      if (!s) continue;
      const unclear =
        !s.prev &&
        s.cand !== null &&
        Math.abs(s.voteLabel + s.vote3d) < h.commitVote &&
        now - s.since < h.maxNamingWaitMs;
      if (unclear && s.cand) {
        for (const p of this.pending) {
          if (p.active) continue;
          p.active = true;
          p.x = s.cand.x;
          p.y = s.cand.y;
          p.voteLabel = s.voteLabel;
          p.vote3d = s.vote3d;
          p.since = s.since;
          break;
        }
        continue;
      }
      const t = this.sel[kept];
      if (t && t !== s) {
        this.sel[kept] = s;
        this.sel[i] = t;
      }
      kept++;
    }
    this.selCount = kept;
    this.usedCount = kept;
  }

  /**
   * 4d. Sides from evidence. A tracked hand keeps its side unless the evidence clearly says
   * otherwise; while a gesture holds something the bar is higher and the 3D vote must agree on
   * its own (MediaPipe's labels are least reliable exactly then — crossed hands).
   */
  private decideSides(): void {
    const a = this.sel[0];
    const b = this.sel[1];
    if (this.selCount === 0 || !a?.cand) return;
    const h = TUNING.handedness;
    const locked = this.identityLocked;
    const margin = locked ? h.lockedSwitchMargin : h.switchMargin;
    const renameJustified = (against: number, against3d: number): boolean =>
      against > margin && (!locked || against3d > h.locked3dMargin);
    const rightness = (s: Selection): number => s.voteLabel + s.vote3d;

    if (this.selCount === 2 && b?.cand) {
      if (a.prev || b.prev) {
        // Keep the tracked hand's side (the other hand takes the other side)…
        a.side = a.prev ?? other(b.prev ?? 'right');
        b.side = other(a.side);
        // …unless the one shown on the left is clearly the more "right" of the two.
        const [l, r] = a.side === 'left' ? [a, b] : [b, a];
        if (renameJustified((rightness(l) - rightness(r)) / 2, (l.vote3d - r.vote3d) / 2)) {
          a.side = other(a.side);
          b.side = other(b.side);
        }
      } else {
        // Two new hands: the more "right" one is right. No evidence at all → screen position (D21).
        const d = (rightness(a) - rightness(b)) / 2;
        const aRight = Math.abs(d) > NO_EVIDENCE ? d > 0 : a.cand.x >= b.cand.x;
        a.side = aRight ? 'right' : 'left';
        b.side = other(a.side);
      }
      return;
    }

    if (a.prev) {
      const sign = a.prev === 'right' ? -1 : 1; // evidence AGAINST the current side is positive
      a.side = renameJustified(sign * rightness(a), sign * a.vote3d) ? other(a.prev) : a.prev;
    } else {
      const r = rightness(a);
      a.side =
        r > NO_EVIDENCE
          ? 'right'
          : r < -NO_EVIDENCE
            ? 'left'
            : (a.cand.label ?? (a.cand.x >= 0.5 ? 'right' : 'left'));
    }
  }

  /**
   * 4e. If a tracked hand was renamed, swap the two slot objects so the hand keeps its smoothing,
   * votes and continuity (no restart, no leftover ghost). Core moves the rest (`takeSwap()`).
   */
  private applyRenames(): void {
    let rename = false;
    for (let i = 0; i < this.selCount; i++) {
      const s = this.sel[i];
      if (s?.cand && s.prev && s.side && s.side !== s.prev) rename = true;
    }
    if (!rename) return;
    const { left, right } = this.slots;
    // A hand not seen this inference must not be carried across as a ghost.
    if (!this.continues('left')) this.dropSlot(left);
    if (!this.continues('right')) this.dropSlot(right);
    this.slots.left = right;
    this.slots.right = left;
    right.side = 'left';
    left.side = 'right';
    this.swapped = true;
  }

  private continues(side: HandSide): boolean {
    for (let i = 0; i < this.selCount; i++) if (this.sel[i]?.prev === side) return true;
    return false;
  }

  /** 5 + 6. Jump rejection, smoothing, metrics. */
  private updateSlot(
    slot: HandSlot,
    s: Selection,
    mirror: boolean,
    aspect: number,
    t: number,
    now: number,
  ): void {
    const raw = s.cand?.raw;
    const w = raw?.landmarks[WRIST];
    if (!raw || !w) return;
    const vx = mirror ? 1 - w.x : w.x;

    let restart = s.prev === null || !slot.present;
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
    slot.voteLabel = s.voteLabel;
    slot.vote3d = s.vote3d;
    for (let j = 0; j < LANDMARK_COUNT; j++) {
      const src = raw.landmarks[j];
      const r = slot.rawLandmarks[j];
      const v = slot.viewRaw[j];
      if (!src || !r || !v) continue;
      r.x = src.x;
      r.y = src.y;
      r.z = src.z;
      v.x = mirror ? 1 - src.x : src.x;
      v.y = src.y;
      v.z = src.z;
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
    slot.voteLabel = slot.vote3d = 0;
    slot.smoother.reset();
  }
}
