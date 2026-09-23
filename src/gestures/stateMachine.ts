// Generic gesture lifecycle (§11): idle → candidate → active → released → idle.
//  • hysteresis: separate start / end thresholds, so a value hovering near one threshold can't flicker
//  • minimum hold (candidateMs) before a gesture becomes active
//  • release debounce (releaseMs) before it ends
//  • optional cooldown after activation (thumb-pinky taps)
// `justStarted` / `justEnded` are true for exactly one update. Allocation-free.

import type { GestureState } from '@/core/types';

export interface MachineConfig {
  /** Threshold to enter (candidate → active). */
  start: number;
  /** Threshold to leave. For `below` gestures end > start; otherwise end < start. */
  end: number;
  /** true: the gesture is "on" when the value is BELOW start (distances, e.g. pinch). */
  below: boolean;
  candidateMs: number;
  releaseMs: number;
  cooldownMs?: number;
}

export function makeGestureState(): GestureState {
  return { phase: 'idle', startedAt: 0, justStarted: false, justEnded: false, value: 0 };
}

export class GestureStateMachine {
  readonly state: GestureState = makeGestureState();
  readonly config: MachineConfig;
  private candidateSince = -1;
  private releaseSince = -1;
  private cooldownUntil = -Infinity;

  constructor(config: MachineConfig) {
    this.config = config;
  }

  get active(): boolean {
    return this.state.phase === 'active';
  }

  update(value: number, now: number): GestureState {
    const s = this.state;
    const c = this.config;
    s.justStarted = false;
    s.justEnded = false;
    s.value = value;
    const on = c.below ? value < c.start : value > c.start;
    const off = c.below ? value > c.end : value < c.end;

    if (s.phase === 'released') s.phase = 'idle';

    switch (s.phase) {
      case 'idle':
        if (on && now >= this.cooldownUntil) {
          s.phase = 'candidate';
          this.candidateSince = now;
          if (c.candidateMs <= 0) this.activate(now);
        }
        break;
      case 'candidate':
        if (!on) {
          s.phase = 'idle';
          this.candidateSince = -1;
        } else if (now - this.candidateSince >= c.candidateMs) {
          this.activate(now);
        }
        break;
      case 'active':
        if (off) {
          if (this.releaseSince < 0) this.releaseSince = now;
          if (now - this.releaseSince >= c.releaseMs) this.release();
        } else {
          this.releaseSince = -1;
        }
        break;
    }
    return s;
  }

  /** The hand vanished (after its grace period): end immediately, emitting `justEnded` if active. */
  forceRelease(): GestureState {
    const s = this.state;
    s.justStarted = false;
    s.justEnded = false;
    if (s.phase === 'active') this.release();
    else {
      s.phase = 'idle';
      this.candidateSince = -1;
    }
    return s;
  }

  reset(): void {
    const s = this.state;
    s.phase = 'idle';
    s.justStarted = s.justEnded = false;
    s.value = 0;
    this.candidateSince = this.releaseSince = -1;
    this.cooldownUntil = -Infinity;
  }

  private activate(now: number): void {
    const s = this.state;
    s.phase = 'active';
    s.startedAt = now;
    s.justStarted = true;
    this.candidateSince = -1;
    this.releaseSince = -1;
    this.cooldownUntil = now + (this.config.cooldownMs ?? 0);
  }

  private release(): void {
    this.state.phase = 'released';
    this.state.justEnded = true;
    this.releaseSince = -1;
  }
}
