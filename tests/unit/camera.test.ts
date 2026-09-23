import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyCameraError } from '@/core/camera';
import { FpsMeter, RenderLoop } from '@/core/renderLoop';

describe('classifyCameraError', () => {
  const dom = (name: string) => new DOMException('msg', name);

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'insecure'],
    ['NotFoundError', 'notFound'],
    ['OverconstrainedError', 'notFound'],
    ['NotReadableError', 'inUse'],
    ['AbortError', 'inUse'],
    ['NotSupportedError', 'unsupported'],
    ['SomethingElse', 'unknown'],
  ])('%s → %s', (name, kind) => {
    expect(classifyCameraError(dom(name)).kind).toBe(kind);
  });

  it('handles TypeError and non-errors', () => {
    expect(classifyCameraError(new TypeError('no gUM')).kind).toBe('unsupported');
    expect(classifyCameraError('boom')).toEqual({ kind: 'unknown', message: 'boom' });
    expect(classifyCameraError({ name: 'NotAllowedError' }).kind).toBe('denied');
  });
});

describe('FpsMeter', () => {
  it('measures a steady 60 Hz', () => {
    const m = new FpsMeter(500);
    let updated = false;
    for (let i = 0; i <= 60; i++) updated = m.tick(i * (1000 / 60)) || updated;
    expect(updated).toBe(true);
    expect(m.fps).toBeCloseTo(60, 0);
    m.reset();
    expect(m.fps).toBe(0);
  });
});

describe('RenderLoop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is idempotent and passes clamped dt', () => {
    const queue: ((t: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => queue.splice(0));

    const dts: number[] = [];
    const loop = new RenderLoop((_now, dt) => dts.push(dt));
    expect(loop.start()).toBe(true);
    expect(loop.start()).toBe(false); // no second loop
    expect(queue).toHaveLength(1);

    queue.shift()?.(1000);
    queue.shift()?.(1016);
    queue.shift()?.(5000); // tab was hidden: dt must be clamped
    expect(dts[0]).toBe(0);
    expect(dts[1]).toBeCloseTo(0.016);
    expect(dts[2]).toBeCloseTo(0.1);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(queue).toHaveLength(0);
  });
});
