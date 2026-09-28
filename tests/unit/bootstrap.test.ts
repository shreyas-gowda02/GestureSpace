import { describe, expect, it } from 'vitest';
import { createRefCounted, onlyLeftSeen, stepMet, type OnboardingSnap } from '@/app/bootstrap';
import { TUNING } from '@/config/tuning';

const flush = () => new Promise<void>((r) => queueMicrotask(r));

function makeHolder() {
  const stats = { created: 0, disposed: 0 };
  const holder = createRefCounted(() => {
    stats.created++;
    return { dispose: () => void stats.disposed++ };
  });
  return { holder, stats };
}

describe('createRefCounted (core singleton guard)', () => {
  it('survives a StrictMode mount → unmount → mount without re-creating', async () => {
    const { holder, stats } = makeHolder();
    const a = holder.acquire();
    holder.release(); // StrictMode cleanup
    const b = holder.acquire(); // StrictMode re-run
    await flush();
    expect(b).toBe(a);
    expect(stats).toEqual({ created: 1, disposed: 0 });

    holder.release();
    await flush();
    expect(stats).toEqual({ created: 1, disposed: 1 });
    expect(holder.peek()).toBeNull();
  });

  it('shares one instance across consumers and disposes after the last release', async () => {
    const { holder, stats } = makeHolder();
    expect(holder.acquire()).toBe(holder.acquire());
    holder.release();
    await flush();
    expect(stats.disposed).toBe(0);
    holder.release();
    await flush();
    expect(stats.disposed).toBe(1);
    holder.release(); // extra release is a no-op
    await flush();
    expect(stats.disposed).toBe(1);
  });
});

describe('first-run walkthrough checks', () => {
  const snap = (p: Partial<OnboardingSnap>): OnboardingSnap => ({
    right: false,
    left: false,
    pinch: false,
    spread: 0,
    ...p,
  });

  it('each step waits for its own hand check', () => {
    expect(stepMet('hand', snap({ right: true }))).toBe(true);
    expect(stepMet('hand', snap({ left: true }))).toBe(false);
    expect(stepMet('pinch', snap({ pinch: true }))).toBe(true);
    expect(stepMet('spread', snap({ spread: TUNING.onboarding.spread - 0.01 }))).toBe(false);
    expect(stepMet('spread', snap({ spread: TUNING.onboarding.spread }))).toBe(true);
    expect(stepMet('welcome', snap({ right: true, pinch: true, spread: 9 }))).toBe(false);
    expect(stepMet('done', snap({ right: true }))).toBe(false);
  });

  it('asked for the right hand but only a "left" one is seen → the swap hint', () => {
    expect(onlyLeftSeen(snap({ left: true }))).toBe(true);
    expect(onlyLeftSeen(snap({ left: true, right: true }))).toBe(false);
    expect(onlyLeftSeen(snap({}))).toBe(false);
  });
});
