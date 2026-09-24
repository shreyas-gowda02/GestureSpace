// Who holds what (§11 precedence rules 3–4). A capture binds a hand (or both hands) to a target
// until it is released — so release events always go to the object that captured the gesture,
// even if the cursor has moved away. Nothing survives a mode switch or a lost hand.

import type { HandSide } from '@/core/types';

export type CaptureKey = HandSide | 'twoHand';
export type ReleaseReason = 'released' | 'lost' | 'modeSwitch' | 'ui' | 'cancelled';

export interface Capture {
  key: CaptureKey;
  targetId: string;
  startedAt: number;
  onRelease?: (reason: ReleaseReason) => void;
}

export class CaptureManager {
  private readonly captures = new Map<CaptureKey, Capture>();

  get count(): number {
    return this.captures.size;
  }

  /** Bind `key` to `targetId`. Returns false if that hand already holds something else. */
  capture(
    key: CaptureKey,
    targetId: string,
    now: number,
    onRelease?: (reason: ReleaseReason) => void,
  ): boolean {
    const existing = this.captures.get(key);
    if (existing && existing.targetId !== targetId) return false;
    this.captures.set(key, { key, targetId, startedAt: now, onRelease });
    return true;
  }

  get(key: CaptureKey): Capture | undefined {
    return this.captures.get(key);
  }

  /** Is `targetId` held by anyone? */
  isCaptured(targetId: string): boolean {
    for (const c of this.captures.values()) if (c.targetId === targetId) return true;
    return false;
  }

  release(key: CaptureKey, reason: ReleaseReason = 'released'): void {
    const c = this.captures.get(key);
    if (!c) return;
    this.captures.delete(key);
    c.onRelease?.(reason);
  }

  releaseTarget(targetId: string, reason: ReleaseReason = 'released'): void {
    for (const c of [...this.captures.values()]) {
      if (c.targetId === targetId) this.release(c.key, reason);
    }
  }

  releaseAll(reason: ReleaseReason): void {
    for (const key of [...this.captures.keys()]) this.release(key, reason);
  }

  /** Debug list, e.g. ["right → voxel-shape"]. */
  describe(): string[] {
    return [...this.captures.values()].map((c) => `${c.key} → ${c.targetId}`);
  }
}
