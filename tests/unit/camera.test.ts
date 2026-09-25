import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyCameraError } from '@/core/camera';
import { FpsMeter, FramePacer, RenderLoop } from '@/core/renderLoop';

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

describe('FramePacer', () => {
  /** Draws a pacer allows while a display refreshes at `hz` for `ms` (optional ±jitter ms). */
  function drawsAt(pacer: FramePacer, hz: number, ms: number, jitter = 0, start = 0): number {
    let draws = 0;
    for (let i = 0, t = start; t < start + ms; i++, t = start + (i * 1000) / hz) {
      if (pacer.due(t + (i % 2 ? jitter : -jitter))) draws++;
    }
    return draws;
  }

  it('holds 60 draws/s on 144 Hz and 120 Hz screens', () => {
    expect(drawsAt(new FramePacer(60), 144, 1000)).toBeCloseTo(60, -1);
    expect(Math.abs(drawsAt(new FramePacer(60), 144, 10_000) - 600)).toBeLessThanOrEqual(1);
    expect(drawsAt(new FramePacer(60), 120, 1000)).toBe(60);
  });

  it('never drops frames on a 60 Hz or slower screen, even with vsync jitter', () => {
    expect(drawsAt(new FramePacer(60), 60, 1000, 0.8)).toBe(60);
    expect(drawsAt(new FramePacer(60), 59.9, 10_000)).toBe(599);
    expect(drawsAt(new FramePacer(60), 30, 1000)).toBe(30);
  });

  it('does not burst after a stall (hidden tab, long frame)', () => {
    const p = new FramePacer(60);
    drawsAt(p, 144, 500);
    // 5 s later the display resumes at 144 Hz: 100 ms should still hold ~6 draws, not 14.
    expect(drawsAt(p, 144, 100, 0, 5500)).toBeLessThanOrEqual(7);
  });

  it('draws every frame when uncapped', () => {
    expect(drawsAt(new FramePacer(0), 144, 1000)).toBe(144);
  });
});
