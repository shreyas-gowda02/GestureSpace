import { describe, expect, it } from 'vitest';
import { ViewportMapper } from '@/spatial/ViewportMapper';

/** CPU replica of COVER_UV_GLSL `coverUv(screenUv())` → video texture uv (y-up). */
function shaderVideoUv(m: ViewportMapper, sx: number, sy: number) {
  const su = { x: sx / m.viewWidth, y: 1 - sy / m.viewHeight };
  let u = su.x * m.coverScale.x + m.coverOffset.x;
  const v = su.y * m.coverScale.y + m.coverOffset.y;
  if (m.mirror) u = 1 - u;
  return { u, v };
}

const cases = [
  {
    name: 'landscape video in a wider viewport (crops top/bottom)',
    video: [1280, 720],
    view: [1920, 900],
  },
  {
    name: 'landscape video in a portrait viewport (crops sides)',
    video: [1280, 720],
    view: [600, 1000],
  },
  { name: 'equal aspect ratios (no crop)', video: [1280, 720], view: [640, 360] },
  { name: 'portrait video in a landscape viewport', video: [720, 1280], view: [1600, 900] },
] as const;

describe('ViewportMapper', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const m = new ViewportMapper();
      m.update(c.video[0], c.video[1], c.view[0], c.view[1]);

      it('covers the viewport completely (never letterboxes)', () => {
        expect(m.offsetX).toBeLessThanOrEqual(1e-9);
        expect(m.offsetY).toBeLessThanOrEqual(1e-9);
        expect(m.videoWidth * m.scale).toBeGreaterThanOrEqual(m.viewWidth - 1e-9);
        expect(m.videoHeight * m.scale).toBeGreaterThanOrEqual(m.viewHeight - 1e-9);
        // one axis fits exactly
        const fitsX = Math.abs(m.videoWidth * m.scale - m.viewWidth) < 1e-6;
        const fitsY = Math.abs(m.videoHeight * m.scale - m.viewHeight) < 1e-6;
        expect(fitsX || fitsY).toBe(true);
      });

      it('centres the crop', () => {
        const s = m.viewToScreen({ x: 0.5, y: 0.5 }, { x: 0, y: 0 });
        expect(s.x).toBeCloseTo(m.viewWidth / 2);
        expect(s.y).toBeCloseTo(m.viewHeight / 2);
      });

      it('round-trips view ↔ screen', () => {
        const out = { x: 0, y: 0 };
        for (const p of [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.75 },
          { x: 0.5, y: 0.01 },
        ]) {
          m.screenToView(m.viewToScreen(p, out), out);
          expect(out.x).toBeCloseTo(p.x);
          expect(out.y).toBeCloseTo(p.y);
        }
      });

      it('shader uniforms agree with viewToScreen (background ↔ overlay alignment)', () => {
        for (const mirror of [true, false]) {
          m.setMirror(mirror);
          for (const p of [
            { x: 0.3, y: 0.4 },
            { x: 0.72, y: 0.6 },
          ]) {
            const s = m.viewToScreen(p, { x: 0, y: 0 });
            const { u, v } = shaderVideoUv(m, s.x, s.y);
            // view space is the displayed (mirrored) image with y down; texture uv is y-up.
            expect(u).toBeCloseTo(mirror ? 1 - p.x : p.x);
            expect(v).toBeCloseTo(1 - p.y);
          }
        }
      });
    });
  }

  it('reports not-ready and identity uniforms before the video has a size', () => {
    const m = new ViewportMapper();
    m.update(0, 0, 800, 600);
    expect(m.ready).toBe(false);
    expect(m.coverScale).toEqual({ x: 1, y: 1 });
    expect(m.coverOffset).toEqual({ x: 0, y: 0 });
  });

  it('bumps version only on change', () => {
    const m = new ViewportMapper();
    expect(m.update(1280, 720, 800, 600)).toBe(true);
    const v = m.version;
    expect(m.update(1280, 720, 800, 600)).toBe(false);
    expect(m.version).toBe(v);
    m.setMirror(false);
    expect(m.version).toBe(v + 1);
  });

  it('maps tracker x to mirrored view x', () => {
    const m = new ViewportMapper();
    expect(m.trackerToViewX(0.2)).toBeCloseTo(0.8);
    m.setMirror(false);
    expect(m.trackerToViewX(0.2)).toBeCloseTo(0.2);
    expect(m.videoAspect).toBe(1);
  });
});
