// Input layer (§9): where raw hand detections come from.
//   LiveTrackerSource     — the one HandTracker running on the live <video>
//   FixturePlaybackSource — replays recorded JSON (tests, demos, debugging without a camera)
//   FixtureRecorder       — dev tool that records live detections to downloadable JSON
// Everything downstream (normalizer → smoothing → gestures → modes) is identical for both sources.

import { TUNING } from '@/config/tuning';
import type { Vec3 } from '@/core/types';
import type { InferenceStats } from '@/core/renderLoop';
import type { HandTracker, TrackerResult } from '@/vision/HandTracker';
import { LANDMARK_COUNT, makeLandmarkBuffer } from '@/vision/landmarks';

/** One detected hand exactly as the tracker reported it (un-mirrored, tracker-native). */
export interface RawHand {
  /** MediaPipe handedness label ("Left" / "Right"), before our swap correction. */
  handedness: string;
  score: number;
  landmarks: Vec3[];
  worldLandmarks?: Vec3[];
}

/** One inference result. Serializable — this is also the fixture frame format. */
export interface RawDetection {
  /** ms; live = performance.now(), fixtures = relative to the first frame. */
  timestamp: number;
  videoWidth: number;
  videoHeight: number;
  hands: RawHand[];
}

export interface InputSource {
  readonly kind: 'live' | 'fixture';
  /** Returns a NEW detection if one is due this frame, else null. Result may be reused next call. */
  poll(now: number): RawDetection | null;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------------------------

function makeRawHand(): RawHand {
  return {
    handedness: '',
    score: 0,
    landmarks: makeLandmarkBuffer(),
    worldLandmarks: makeLandmarkBuffer(),
  };
}

function copyPoints(dst: Vec3[], src: readonly { x: number; y: number; z: number }[]): void {
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const s = src[i];
    const d = dst[i];
    if (!s || !d) continue;
    d.x = s.x;
    d.y = s.y;
    d.z = s.z;
  }
}

export class LiveTrackerSource implements InputSource {
  readonly kind = 'live';
  private readonly tracker: HandTracker;
  private readonly video: HTMLVideoElement;
  private readonly stats: InferenceStats;
  private intervalMs = 1000 / TUNING.tracker.defaultInferenceHz;
  private lastInferAt = -Infinity;
  private lastTimestamp = 0;

  // New-frame detection: requestVideoFrameCallback where available, else currentTime.
  private newFrame = false;
  private lastVideoTime = -1;
  private presentedFrames = 0;
  private presentedAtLastInference = -1;
  private rvfcId = 0;

  /** Reused every inference (no per-frame allocation). */
  private readonly detection: RawDetection = {
    timestamp: 0,
    videoWidth: 0,
    videoHeight: 0,
    hands: [],
  };
  private readonly handPool: RawHand[] = [makeRawHand(), makeRawHand()];

  constructor(tracker: HandTracker, video: HTMLVideoElement, stats: InferenceStats) {
    this.tracker = tracker;
    this.video = video;
    this.stats = stats;
    if ('requestVideoFrameCallback' in video) {
      this.rvfcId = video.requestVideoFrameCallback(this.onVideoFrame);
    }
  }

  setRate(hz: number): void {
    this.intervalMs = 1000 / hz;
  }

  poll(now: number): RawDetection | null {
    const v = this.video;
    if (!this.tracker.ready || v.readyState < 2 || v.videoWidth === 0) return null;
    if (now - this.lastInferAt < this.intervalMs * TUNING.tracker.throttleSlack) return null;
    if (!this.consumeNewFrame()) return null; // never re-run inference on a stale frame

    // MediaPipe requires strictly increasing timestamps.
    const ts = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    this.lastTimestamp = ts;
    this.lastInferAt = now;

    const t0 = performance.now();
    const result = this.tracker.detect(v, ts);
    this.stats.record(now, performance.now() - t0);
    if (this.presentedAtLastInference >= 0) {
      const skipped = this.presentedFrames - this.presentedAtLastInference - 1;
      if (skipped > 0) this.stats.skippedFrames += skipped;
    }
    this.presentedAtLastInference = this.presentedFrames;

    return this.fill(result, ts, v.videoWidth, v.videoHeight);
  }

  dispose(): void {
    if (this.rvfcId) this.video.cancelVideoFrameCallback(this.rvfcId);
    this.rvfcId = 0;
  }

  private fill(result: TrackerResult, ts: number, w: number, h: number): RawDetection {
    const det = this.detection;
    det.timestamp = ts;
    det.videoWidth = w;
    det.videoHeight = h;
    det.hands.length = 0;
    const n = Math.min(result.landmarks.length, this.handPool.length);
    for (let i = 0; i < n; i++) {
      const hand = this.handPool[i];
      const lms = result.landmarks[i];
      if (!hand || !lms) continue;
      const cat = result.handedness[i]?.[0];
      hand.handedness = cat?.categoryName ?? '';
      hand.score = cat?.score ?? 0;
      copyPoints(hand.landmarks, lms);
      const world = result.worldLandmarks[i];
      if (world && hand.worldLandmarks) copyPoints(hand.worldLandmarks, world);
      det.hands.push(hand);
    }
    return det;
  }

  private consumeNewFrame(): boolean {
    if (this.rvfcId) {
      if (!this.newFrame) return false;
      this.newFrame = false;
      return true;
    }
    const t = this.video.currentTime;
    if (t === this.lastVideoTime) return false;
    this.lastVideoTime = t;
    return true;
  }

  private readonly onVideoFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
    this.newFrame = true;
    this.presentedFrames = meta.presentedFrames;
    this.rvfcId = this.video.requestVideoFrameCallback(this.onVideoFrame);
  };
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

export interface LandmarkFixture {
  version: 1;
  name: string;
  recordedAt: string;
  videoWidth: number;
  videoHeight: number;
  /** Timestamps relative to the first frame (ms). */
  frames: RawDetection[];
}

/** Replays a fixture in real time (optionally looping). Pure — runs in Node tests too. */
export class FixturePlaybackSource implements InputSource {
  readonly kind = 'fixture';
  readonly fixture: LandmarkFixture;
  private readonly loop: boolean;
  private startAt: number;
  private cursor = 0;
  private finished = false;

  constructor(fixture: LandmarkFixture, startAt: number, loop = true) {
    this.fixture = fixture;
    this.startAt = startAt;
    this.loop = loop;
  }

  get duration(): number {
    const last = this.fixture.frames[this.fixture.frames.length - 1];
    return last ? last.timestamp : 0;
  }

  get done(): boolean {
    return this.finished;
  }

  /** 0..1 through the current pass. */
  get progress(): number {
    const n = this.fixture.frames.length;
    return n > 0 ? this.cursor / n : 0;
  }

  poll(now: number): RawDetection | null {
    const frames = this.fixture.frames;
    if (frames.length === 0 || this.finished) return null;

    let elapsed = now - this.startAt;
    if (this.cursor >= frames.length) {
      if (!this.loop) {
        this.finished = true;
        return null;
      }
      // Restart one average frame-interval after the last frame.
      const gap = frames.length > 1 ? this.duration / (frames.length - 1) : 33;
      this.startAt += this.duration + gap;
      this.cursor = 0;
      elapsed = now - this.startAt;
    }

    let due: RawDetection | null = null;
    while (this.cursor < frames.length) {
      const f = frames[this.cursor];
      if (!f || f.timestamp > elapsed) break;
      due = f; // if several are due (slow frame), jump to the newest
      this.cursor++;
    }
    return due;
  }

  dispose(): void {}
}

const round = (v: number): number => Math.round(v * 1e5) / 1e5;

function clonePoints(src: readonly Vec3[]): Vec3[] {
  return src.map((p) => ({ x: round(p.x), y: round(p.y), z: round(p.z) }));
}

/** Dev-only recorder (toggled from the debug panel). Deep-copies detections as they arrive. */
export class FixtureRecorder {
  private frames: RawDetection[] = [];
  private t0 = 0;
  private active = false;

  get recording(): boolean {
    return this.active;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  start(): void {
    this.frames = [];
    this.active = true;
  }

  record(det: RawDetection): void {
    if (!this.active) return;
    if (this.frames.length === 0) this.t0 = det.timestamp;
    this.frames.push({
      timestamp: Math.round(det.timestamp - this.t0),
      videoWidth: det.videoWidth,
      videoHeight: det.videoHeight,
      hands: det.hands.map((h) => ({
        handedness: h.handedness,
        score: round(h.score),
        landmarks: clonePoints(h.landmarks),
        ...(h.worldLandmarks ? { worldLandmarks: clonePoints(h.worldLandmarks) } : {}),
      })),
    });
  }

  /** Stops recording; returns null if nothing was captured. */
  stop(name: string): LandmarkFixture | null {
    this.active = false;
    const first = this.frames[0];
    if (!first) return null;
    const fixture: LandmarkFixture = {
      version: 1,
      name,
      recordedAt: new Date().toISOString(),
      videoWidth: first.videoWidth,
      videoHeight: first.videoHeight,
      frames: this.frames,
    };
    this.frames = [];
    return fixture;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPoints(v: unknown): v is Vec3[] {
  return (
    Array.isArray(v) &&
    v.length === LANDMARK_COUNT &&
    v.every(
      (p) =>
        isObj(p) && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number',
    )
  );
}

/** Validate untrusted JSON (e.g. a file the user picked) into a fixture. Throws on bad input. */
export function parseFixture(data: unknown): LandmarkFixture {
  if (!isObj(data) || data.version !== 1 || !Array.isArray(data.frames)) {
    throw new Error('Not a GestureSpace landmark fixture (version 1).');
  }
  const { videoWidth, videoHeight } = data;
  if (typeof videoWidth !== 'number' || typeof videoHeight !== 'number') {
    throw new Error('Fixture is missing videoWidth / videoHeight.');
  }
  const frames: RawDetection[] = data.frames.map((f: unknown, i: number) => {
    if (!isObj(f) || typeof f.timestamp !== 'number' || !Array.isArray(f.hands)) {
      throw new Error(`Fixture frame ${i} is malformed.`);
    }
    const hands: RawHand[] = f.hands.map((h: unknown) => {
      if (!isObj(h) || typeof h.handedness !== 'string' || typeof h.score !== 'number') {
        throw new Error(`Fixture frame ${i} has a malformed hand.`);
      }
      if (!isPoints(h.landmarks)) throw new Error(`Fixture frame ${i}: need 21 landmarks.`);
      return {
        handedness: h.handedness,
        score: h.score,
        landmarks: h.landmarks,
        ...(isPoints(h.worldLandmarks) ? { worldLandmarks: h.worldLandmarks } : {}),
      };
    });
    return { timestamp: f.timestamp, videoWidth, videoHeight, hands };
  });
  return {
    version: 1,
    name: typeof data.name === 'string' ? data.name : 'fixture',
    recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : '',
    videoWidth,
    videoHeight,
    frames,
  };
}

/** User-triggered download of a recorded fixture. */
export function downloadFixture(fixture: LandmarkFixture): void {
  const blob = new Blob([JSON.stringify(fixture)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fixture.name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
