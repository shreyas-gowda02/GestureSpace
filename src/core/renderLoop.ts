// The ONE requestAnimationFrame loop (§5) + draw pacing + FPS measurement.
// Browsers stop rAF in hidden tabs, so render (and later inference) pauses automatically on
// `visibilitychange`; dt is clamped so resuming never produces a huge step.

import { TUNING } from '@/config/tuning';

const MAX_DT_S = 0.1;

/** Frames-per-second over a rolling window. Allocation-free. */
export class FpsMeter {
  fps = 0;
  private frames = 0;
  private windowStart = -1;
  private readonly windowMs: number;

  constructor(windowMs = 500) {
    this.windowMs = windowMs;
  }

  /** Call once per frame. Returns true when `fps` was refreshed. */
  tick(now: number): boolean {
    if (this.windowStart < 0) {
      this.windowStart = now;
      return false;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return false;
    this.fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.windowStart = now;
    return true;
  }

  reset(): void {
    this.fps = 0;
    this.frames = 0;
    this.windowStart = -1;
  }
}

/**
 * Caps how often the loop DRAWS (D40) while the rest of the frame still runs on every display
 * frame. Advances on a fixed grid, so the average is exact on any refresh rate (60 of 144 Hz
 * frames; every frame on a ≤ 60 Hz screen). Allocation-free.
 */
export class FramePacer {
  private intervalMs = 0;
  private next = -1;

  constructor(maxFps: number = TUNING.scene.maxRenderFps) {
    this.setMaxFps(maxFps);
  }

  /** `maxFps` ≤ 0 disables the cap. */
  setMaxFps(maxFps: number): void {
    this.intervalMs = maxFps > 0 ? 1000 / maxFps : 0;
    this.next = -1;
  }

  /** Call once per display frame. Returns true if this frame should draw. */
  due(now: number): boolean {
    const interval = this.intervalMs;
    if (interval <= 0) return true;
    if (this.next >= 0 && now < this.next - interval * TUNING.scene.renderPacingSlack) return false;
    // After a stall (hidden tab, long frame) restart the grid instead of drawing a catch-up burst.
    this.next =
      this.next < 0 || now - this.next >= interval ? now + interval : this.next + interval;
    return true;
  }

  reset(): void {
    this.next = -1;
  }
}

export type FrameCallback = (now: number, dt: number) => void;

export class RenderLoop {
  private rafId = 0;
  private last = -1;
  private active = false;
  private readonly onFrame: FrameCallback;

  constructor(onFrame: FrameCallback) {
    this.onFrame = onFrame;
  }

  get running(): boolean {
    return this.active;
  }

  /** Idempotent: calling start() on a running loop never creates a second loop. */
  start(): boolean {
    if (this.active) return false;
    this.active = true;
    this.last = -1;
    this.rafId = requestAnimationFrame(this.frame);
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.active) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = this.last < 0 ? 0 : Math.min((now - this.last) / 1000, MAX_DT_S);
    this.last = now;
    this.onFrame(now, dt);
  };
}

/** Hand-tracker timing for the debug panel. Allocation-free. */
export class InferenceStats {
  /** Inferences per second over a rolling window. */
  fps = 0;
  /** Exponential moving average of detectForVideo() wall time (ms). */
  avgMs = 0;
  lastMs = 0;
  count = 0;
  /** Camera frames that arrived but were never run through the tracker. */
  skippedFrames = 0;
  private windowStart = -1;
  private windowCount = 0;

  record(now: number, ms: number): void {
    this.lastMs = ms;
    const k = TUNING.perf.inferenceMsEma;
    this.avgMs = this.count === 0 ? ms : this.avgMs * (1 - k) + ms * k;
    this.count++;
    if (this.windowStart < 0) {
      this.windowStart = now; // the first sample opens the window; it isn't an interval
      return;
    }
    this.windowCount++;
    const elapsed = now - this.windowStart;
    if (elapsed >= TUNING.perf.inferenceFpsWindowMs) {
      this.fps = (this.windowCount * 1000) / elapsed;
      this.windowCount = 0;
      this.windowStart = now;
    }
  }

  reset(): void {
    this.fps = this.avgMs = this.lastMs = 0;
    this.count = this.skippedFrames = this.windowCount = 0;
    this.windowStart = -1;
  }
}
