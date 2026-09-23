import { describe, expect, it } from 'vitest';
import { acquireCore, getDebugCounters, releaseCore } from '@/app/bootstrap';

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('bootstrap core singleton', () => {
  it('survives a StrictMode-style mount → unmount → mount without re-creating', async () => {
    const before = getDebugCounters().coreCreated;
    const a = acquireCore();
    releaseCore(); // StrictMode cleanup
    const b = acquireCore(); // StrictMode re-run
    await flush();
    expect(b).toBe(a);
    expect(getDebugCounters().coreCreated).toBe(before + 1);
    releaseCore();
    await flush();
    expect(getDebugCounters().coreDisposed).toBeGreaterThanOrEqual(1);
  });

  it('shares one core across concurrent consumers', async () => {
    const a = acquireCore();
    const b = acquireCore();
    expect(b).toBe(a);
    releaseCore();
    await flush();
    const disposedMid = getDebugCounters().coreDisposed;
    releaseCore();
    await flush();
    expect(getDebugCounters().coreDisposed).toBe(disposedMid + 1);
  });
});
