import { describe, expect, it } from 'vitest';
import { createRefCounted } from '@/app/bootstrap';

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
