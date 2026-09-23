// The ONE requestAnimationFrame loop (§5) + FPS measurement.
// Browsers stop rAF in hidden tabs, so render (and later inference) pauses automatically on
// `visibilitychange`; dt is clamped so resuming never produces a huge step.

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
