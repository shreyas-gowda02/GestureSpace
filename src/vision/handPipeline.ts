// Perception: RawDetection → HandFrame (§8, §10).
// Phase 2: handedness correction + mirrored view-normalized coordinates + metrics.
// Phase 3 adds One Euro smoothing, confidence gate, jump rejection and the loss grace period here.
// All TrackedHand objects and landmark arrays are preallocated and reused (no per-frame allocation).

import { TUNING } from '@/config/tuning';
import type { HandFrame, HandSide, TrackedHand, Vec2, Vec3 } from '@/core/types';
import type { RawDetection, RawHand } from '@/core/input';
import { boundsInto, LANDMARK_COUNT, makeLandmarkBuffer, palmScale, WRIST } from './landmarks';

/** Mutable backing object for a TrackedHand (consumers see the readonly interface). */
export class HandSlot implements TrackedHand {
  side: HandSide;
  score = 0;
  readonly rawLandmarks: Vec3[] = makeLandmarkBuffer();
  readonly landmarks: Vec3[] = makeLandmarkBuffer();
  readonly worldLandmarks: Vec3[] = makeLandmarkBuffer();
  palmScale = 0;
  readonly bbox: { min: Vec2; max: Vec2 } = { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  lostForMs = 0;
  /** MediaPipe's original label, before swap correction (debug only). */
  rawLabel = '';

  constructor(side: HandSide) {
    this.side = side;
  }
}

/**
 * Map a MediaPipe handedness label to the user's PHYSICAL hand.
 * MediaPipe assumes a mirrored (selfie) input; we feed the raw video, so labels are swapped.
 */
export function labelToSide(label: string, swap: boolean): HandSide | null {
  const l = label.toLowerCase();
  if (l !== 'left' && l !== 'right') return null;
  const side: HandSide = l;
  if (!swap) return side;
  return side === 'left' ? 'right' : 'left';
}

export interface NormalizerOptions {
  swapLabels?: boolean;
}

export class HandNormalizer {
  /** Reused output — valid until the next `process()` call. */
  readonly frame: HandFrame = { timestamp: 0, inferenceTimestamp: 0 };
  readonly slots: Readonly<Record<HandSide, HandSlot>> = {
    left: new HandSlot('left'),
    right: new HandSlot('right'),
  };
  private readonly swap: boolean;
  private readonly assigned: (HandSide | null)[] = [null, null];

  constructor(opts: NormalizerOptions = {}) {
    this.swap = opts.swapLabels ?? TUNING.tracker.HANDEDNESS_LABEL_SWAP;
  }

  /**
   * @param mirror whether the view is mirrored (selfie); view x = mirror ? 1 - x : x
   * @param now render timestamp (ms)
   */
  process(det: RawDetection, mirror: boolean, now: number): HandFrame {
    const f = this.frame;
    f.timestamp = now;
    f.inferenceTimestamp = det.timestamp;
    f.left = undefined;
    f.right = undefined;

    const a = det.hands[0];
    const b = det.hands[1];
    this.assignSides(a, b);

    const aspect = det.videoHeight > 0 ? det.videoWidth / det.videoHeight : 1;
    for (let i = 0; i < 2; i++) {
      const raw = i === 0 ? a : b;
      const side = this.assigned[i];
      if (!raw || !side) continue;
      const slot = this.slots[side];
      this.fillSlot(slot, raw, mirror, aspect);
      f[side] = slot;
    }
    return f;
  }

  /** Mark hands as not visible (e.g. camera stopped). */
  clear(now: number): HandFrame {
    this.frame.timestamp = now;
    this.frame.left = undefined;
    this.frame.right = undefined;
    return this.frame;
  }

  private assignSides(a: RawHand | undefined, b: RawHand | undefined): void {
    let sa = a ? labelToSide(a.handedness, this.swap) : null;
    let sb = b ? labelToSide(b.handedness, this.swap) : null;
    if (a && b && (sa === sb || !sa || !sb)) {
      // Ambiguous labels: decide by position. From the user's point of view their right hand is
      // on the right, i.e. LOWER raw (un-mirrored) x. Independent of the display mirror setting.
      const aIsRight = (a.landmarks[WRIST]?.x ?? 0) < (b.landmarks[WRIST]?.x ?? 0);
      sa = aIsRight ? 'right' : 'left';
      sb = aIsRight ? 'left' : 'right';
    }
    this.assigned[0] = sa;
    this.assigned[1] = sb;
  }

  private fillSlot(slot: HandSlot, raw: RawHand, mirror: boolean, aspect: number): void {
    slot.score = raw.score;
    slot.rawLabel = raw.handedness;
    slot.lostForMs = 0;
    for (let j = 0; j < LANDMARK_COUNT; j++) {
      const s = raw.landmarks[j];
      const r = slot.rawLandmarks[j];
      const v = slot.landmarks[j];
      if (!s || !r || !v) continue;
      r.x = s.x;
      r.y = s.y;
      r.z = s.z;
      v.x = mirror ? 1 - s.x : s.x;
      v.y = s.y;
      v.z = s.z;
      const w = raw.worldLandmarks?.[j];
      const sw = slot.worldLandmarks[j];
      if (w && sw) {
        sw.x = w.x;
        sw.y = w.y;
        sw.z = w.z;
      }
    }
    slot.palmScale = palmScale(slot.landmarks, aspect);
    boundsInto(slot.bbox, slot.landmarks);
  }
}
