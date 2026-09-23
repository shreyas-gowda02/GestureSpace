import { describe, expect, it } from 'vitest';
import { clamp, invLerp, lerp, unwrapAngle, wrapAngle } from '@/utils/math';
import { angle2, dist2, midpointInto, vec2 } from '@/utils/vectors';

describe('math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it('lerps and inverse-lerps', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(invLerp(0, 10, 2.5)).toBe(0.25);
    expect(invLerp(3, 3, 3)).toBe(0);
  });

  it('wraps angles into (-π, π]', () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2);
  });

  it('unwraps across the ±π seam without jumping', () => {
    const prev = Math.PI - 0.1;
    const next = -Math.PI + 0.1; // raw atan2 flipped sign
    expect(unwrapAngle(prev, next)).toBeCloseTo(Math.PI + 0.1);
    expect(unwrapAngle(-prev, -next)).toBeCloseTo(-Math.PI - 0.1);
  });
});

describe('vectors', () => {
  it('computes aspect-corrected distance', () => {
    expect(dist2(vec2(0, 0), vec2(0.5, 0), 16 / 9)).toBeCloseTo(0.5 * (16 / 9));
    expect(dist2(vec2(0, 0), vec2(0, 0.5), 16 / 9)).toBeCloseTo(0.5);
  });

  it('writes midpoints into a reused output', () => {
    const out = vec2();
    const r = midpointInto(out, vec2(0, 0), vec2(1, 2));
    expect(r).toBe(out);
    expect(out).toEqual({ x: 0.5, y: 1 });
  });

  it('computes angles', () => {
    expect(angle2(vec2(0, 0), vec2(1, 0))).toBeCloseTo(0);
    expect(angle2(vec2(0, 0), vec2(0, 1))).toBeCloseTo(Math.PI / 2);
  });
});
