// Air Draw strokes (§15): the model, pen sampling + smoothing, Catmull-Rom curves, the eraser's hit
// test, the undo command and the 2D renderer. Points are VIEW-normalized (the displayed camera
// image, 0..1) and widths are fractions of the video height, so a drawing stays glued to the scene
// through any resize or crop change — every frame maps them to screen px with the ViewportMapper.

import { TUNING } from '@/config/tuning';
import type { Command, Vec2 } from '@/core/types';
import type { ViewportMapper } from '@/spatial/ViewportMapper';
import { OneEuroFilter } from '@/vision/smoothing';

const D = TUNING.draw;

/** A finished stroke. Immutable, so undo snapshots can share it. */
export interface Stroke {
  readonly id: number;
  readonly color: string;
  /** Line width as a fraction of the video height. */
  readonly width: number;
  readonly glow: boolean;
  /** x0, y0, x1, y1 … view-normalized; `count` points. */
  readonly points: Float32Array;
  readonly count: number;
  /** Bounds (view units) for quick eraser rejection. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** What the renderer needs to draw a stroke (finished, or live from the builder). */
export interface StrokeLook {
  readonly color: string;
  readonly width: number;
  readonly glow: boolean;
}

/**
 * The stroke being drawn: every frame gets the pen position; it is smoothed (One Euro, on top of
 * the hand smoothing) and kept as a point only after moving MIN_STROKE_STEP (§15), so a still pen
 * adds nothing. The latest smoothed position is the `tail`, drawn live so the line never lags the
 * pen by a step. Allocation-free per frame (the buffer doubles when full).
 */
export class StrokeBuilder {
  private buf = new Float32Array(D.initialPoints * 2);
  count = 0;
  readonly tail: Vec2 = { x: 0, y: 0 };
  private readonly fx = new OneEuroFilter({ ...D.oneEuro });
  private readonly fy = new OneEuroFilter({ ...D.oneEuro });

  get points(): Float32Array {
    return this.buf;
  }

  begin(x: number, y: number, now: number): void {
    this.fx.reset();
    this.fy.reset();
    this.count = 0;
    this.tail.x = this.fx.filter(x, now);
    this.tail.y = this.fy.filter(y, now);
    this.push(this.tail.x, this.tail.y);
  }

  /** Feed the pen position (view units). Returns true when a new point was kept. */
  add(x: number, y: number, now: number, aspect: number): boolean {
    const sx = (this.tail.x = this.fx.filter(x, now));
    const sy = (this.tail.y = this.fy.filter(y, now));
    const i = (this.count - 1) * 2;
    const dx = (sx - (this.buf[i] ?? sx)) * aspect;
    const dy = sy - (this.buf[i + 1] ?? sy);
    if (dx * dx + dy * dy < D.MIN_STROKE_STEP * D.MIN_STROKE_STEP) return false;
    this.push(sx, sy);
    return true;
  }

  /**
   * Points to draw right now: the kept points plus the live tail (written just past `count`, so
   * the line reaches the pen instead of stopping at the last kept point).
   */
  liveCount(): number {
    const i = (this.count - 1) * 2;
    if (this.buf[i] === this.tail.x && this.buf[i + 1] === this.tail.y) return this.count;
    this.ensure(this.count + 1);
    this.buf[this.count * 2] = this.tail.x;
    this.buf[this.count * 2 + 1] = this.tail.y;
    return this.count + 1;
  }

  /** The finished stroke, ending where the pen lifted (the tail, if it moved at all). */
  finish(id: number, look: StrokeLook): Stroke {
    const i = (this.count - 1) * 2;
    if (this.buf[i] !== this.tail.x || this.buf[i + 1] !== this.tail.y) {
      const dx = this.tail.x - (this.buf[i] ?? 0);
      const dy = this.tail.y - (this.buf[i + 1] ?? 0);
      if (dx * dx + dy * dy > 1e-10) this.push(this.tail.x, this.tail.y);
    }
    const points = this.buf.slice(0, this.count * 2);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < points.length; k += 2) {
      const x = points[k] ?? 0;
      const y = points[k + 1] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { id, ...look, points, count: this.count, minX, minY, maxX, maxY };
  }

  private ensure(points: number): void {
    if (points * 2 <= this.buf.length) return;
    const bigger = new Float32Array(this.buf.length * 2);
    bigger.set(this.buf);
    this.buf = bigger;
  }

  private push(x: number, y: number): void {
    this.ensure(this.count + 1);
    this.buf[this.count * 2] = x;
    this.buf[this.count * 2 + 1] = y;
    this.count++;
  }
}

// ---------------------------------------------------------------------------------------------
// Curves + hit test
// ---------------------------------------------------------------------------------------------

/** The subset of a 2D context a path is traced into (tests pass a recorder). */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
}

/**
 * Trace points as a Catmull-Rom spline through every point (§15), converted to cubic Béziers for
 * the canvas: segment i → i+1 uses controls p[i] + (p[i+1] − p[i−1]) / 6 and
 * p[i+1] − (p[i+2] − p[i]) / 6. `map(x, y, out)` converts view units to screen px.
 */
export function traceCatmullRom(
  sink: PathSink,
  pts: ArrayLike<number>,
  count: number,
  map: (x: number, y: number, out: Vec2) => Vec2,
): void {
  if (count < 1) return;
  const a = map(pts[0] ?? 0, pts[1] ?? 0, P0);
  sink.moveTo(a.x, a.y);
  if (count === 1) {
    sink.lineTo(a.x, a.y);
    return;
  }
  for (let i = 0; i < count - 1; i++) {
    const prev = Math.max(0, i - 1) * 2;
    const next2 = Math.min(count - 1, i + 2) * 2;
    map(pts[prev] ?? 0, pts[prev + 1] ?? 0, P0);
    map(pts[i * 2] ?? 0, pts[i * 2 + 1] ?? 0, P1);
    map(pts[i * 2 + 2] ?? 0, pts[i * 2 + 3] ?? 0, P2);
    map(pts[next2] ?? 0, pts[next2 + 1] ?? 0, P3);
    sink.bezierCurveTo(
      P1.x + (P2.x - P0.x) / 6,
      P1.y + (P2.y - P0.y) / 6,
      P2.x - (P3.x - P1.x) / 6,
      P2.y - (P3.y - P1.y) / 6,
      P2.x,
      P2.y,
    );
  }
}

const P0: Vec2 = { x: 0, y: 0 };
const P1: Vec2 = { x: 0, y: 0 };
const P2: Vec2 = { x: 0, y: 0 };
const P3: Vec2 = { x: 0, y: 0 };

/** Does the eraser at (x, y) touch this stroke? Distances in video heights (x × aspect). */
export function strokeHit(stroke: Stroke, x: number, y: number, aspect: number): boolean {
  const reach = D.eraserRadius + stroke.width / 2;
  const rx = reach / aspect;
  if (x < stroke.minX - rx || x > stroke.maxX + rx) return false;
  if (y < stroke.minY - reach || y > stroke.maxY + reach) return false;
  const p = stroke.points;
  const r2 = reach * reach;
  let ax = (p[0] ?? 0) * aspect;
  let ay = p[1] ?? 0;
  const px = x * aspect;
  if (stroke.count === 1) return (px - ax) ** 2 + (y - ay) ** 2 <= r2;
  for (let i = 1; i < stroke.count; i++) {
    const bx = (p[i * 2] ?? 0) * aspect;
    const by = p[i * 2 + 1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / len2)) : 0;
    if ((px - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r2) return true;
    ax = bx;
    ay = by;
  }
  return false;
}

/** Undo step: the stroke list before and after (strokes are immutable, so this is cheap). */
export class StrokeListCommand implements Command {
  readonly label: string;
  private readonly apply: (list: readonly Stroke[]) => void;
  private readonly before: readonly Stroke[];
  private readonly after: readonly Stroke[];

  constructor(
    label: string,
    apply: (list: readonly Stroke[]) => void,
    before: readonly Stroke[],
    after: readonly Stroke[],
  ) {
    this.label = label;
    this.apply = apply;
    this.before = before;
    this.after = after;
  }

  do(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }
}

// ---------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------

/** The subset of CanvasRenderingContext2D the renderer uses (tests pass a recorder). */
export type Canvas2D = PathSink &
  Pick<
    CanvasRenderingContext2D,
    | 'beginPath'
    | 'stroke'
    | 'fill'
    | 'arc'
    | 'save'
    | 'restore'
    | 'setTransform'
    | 'clearRect'
    | 'drawImage'
    | 'setLineDash'
    | 'strokeStyle'
    | 'fillStyle'
    | 'lineWidth'
    | 'lineCap'
    | 'lineJoin'
    | 'globalAlpha'
    | 'globalCompositeOperation'
  >;

export interface OverlaySize {
  /** CSS px. */
  width: number;
  height: number;
  pixelRatio: number;
}

/** '#rrggbb' mixed toward white — the hot core of a neon line. */
export function whiten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number): number => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Does `list` begin with exactly the strokes of `prefix`? */
function startsWith(list: readonly Stroke[], prefix: readonly Stroke[]): boolean {
  if (prefix.length > list.length) return false;
  for (let i = 0; i < prefix.length; i++) if (list[i] !== prefix[i]) return false;
  return true;
}

type CacheFactory = () => { canvas: HTMLCanvasElement; ctx: Canvas2D } | null;

function browserCache(): { canvas: HTMLCanvasElement; ctx: Canvas2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/**
 * Draws strokes on the 2D overlay. Finished strokes live in an offscreen canvas that is blitted every
 * frame (0.4 ms for 200 glowing strokes vs ~32 ms to repaint them); the live stroke, eraser highlight
 * and cursor go on top.
 */
export class StrokeRenderer {
  private readonly makeCache: CacheFactory;
  private cache: { canvas: HTMLCanvasElement; ctx: Canvas2D } | null | undefined;
  /** What the cache currently shows. */
  private cached: readonly Stroke[] = [];
  private cachedRevision = -1;
  private viewKey = '';
  private readonly coreColors = new Map<string, string>();
  private viewport: ViewportMapper | null = null;
  private readonly map = (x: number, y: number, out: Vec2): Vec2 => {
    const v = this.viewport;
    if (!v) return out;
    out.x = v.offsetX + x * v.videoWidth * v.scale;
    out.y = v.offsetY + y * v.videoHeight * v.scale;
    return out;
  };

  constructor(makeCache: CacheFactory = browserCache) {
    this.makeCache = makeCache;
  }

  /** Screen px per video height (= per unit of stroke width). */
  static pxPerUnit(viewport: ViewportMapper): number {
    return viewport.videoHeight * viewport.scale;
  }

  /** All finished strokes (cached), then optionally a highlighted one. */
  drawStrokes(
    ctx: Canvas2D,
    size: OverlaySize,
    viewport: ViewportMapper,
    strokes: readonly Stroke[],
    revision: number,
  ): void {
    this.viewport = viewport;
    if (this.cache === undefined) this.cache = this.makeCache();
    const cache = this.cache;
    if (!cache) {
      for (const s of strokes) this.paint(ctx, s, s.points, s.count, viewport);
      return;
    }
    const dpr = size.pixelRatio;
    const viewKey = `${viewport.version}|${size.width}|${size.height}|${dpr}`;
    if (revision !== this.cachedRevision || viewKey !== this.viewKey) {
      // A new stroke on the end (the usual change) is painted on top of the cache; anything else
      // (erase, undo, clear, resize) repaints it from scratch.
      const append = viewKey === this.viewKey && startsWith(strokes, this.cached);
      this.cachedRevision = revision;
      this.viewKey = viewKey;
      if (!append) {
        const w = Math.max(1, Math.round(size.width * dpr));
        const h = Math.max(1, Math.round(size.height * dpr));
        if (cache.canvas.width !== w || cache.canvas.height !== h) {
          cache.canvas.width = w;
          cache.canvas.height = h;
        }
        cache.ctx.setTransform(1, 0, 0, 1, 0, 0);
        cache.ctx.clearRect(0, 0, w, h);
        cache.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      for (let i = append ? this.cached.length : 0; i < strokes.length; i++) {
        const s = strokes[i];
        if (s) this.paint(cache.ctx, s, s.points, s.count, viewport);
      }
      this.cached = strokes;
    }
    if (strokes.length > 0) ctx.drawImage(cache.canvas, 0, 0, size.width, size.height);
  }

  /** The stroke being drawn, including its live tail. */
  drawLive(
    ctx: Canvas2D,
    viewport: ViewportMapper,
    look: StrokeLook,
    points: Float32Array,
    count: number,
  ): void {
    this.viewport = viewport;
    this.paint(ctx, look, points, count, viewport);
  }

  /** Eraser hover: the stroke that a pinch would remove, outlined. */
  drawHighlight(ctx: Canvas2D, viewport: ViewportMapper, stroke: Stroke): void {
    this.viewport = viewport;
    const w = Math.max(2, stroke.width * StrokeRenderer.pxPerUnit(viewport));
    const h = D.eraseHighlight;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = h.color; // a red halo: "this goes"
    ctx.globalAlpha = h.alpha;
    ctx.lineWidth = w + h.pad;
    ctx.beginPath();
    traceCatmullRom(ctx, stroke.points, stroke.count, this.map);
    ctx.stroke();
    ctx.lineCap = 'butt'; // …and a thin dashed line along it
    ctx.setLineDash(h.dash);
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /** Brush preview (pen) or eraser ring at the pen position (view units). */
  drawCursor(ctx: Canvas2D, viewport: ViewportMapper, at: Vec2, look: StrokeLook | null): void {
    this.viewport = viewport;
    const p = this.map(at.x, at.y, P0);
    const k = StrokeRenderer.pxPerUnit(viewport);
    ctx.save();
    ctx.beginPath();
    if (look) {
      ctx.arc(p.x, p.y, Math.max(2, (look.width * k) / 2), 0, Math.PI * 2);
      ctx.fillStyle = look.color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
    } else {
      ctx.arc(p.x, p.y, D.eraserRadius * k, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
    }
    ctx.restore();
  }

  dispose(): void {
    if (this.cache) {
      this.cache.canvas.width = 0;
      this.cache.canvas.height = 0;
    }
    this.cache = undefined;
    this.cached = [];
    this.cachedRevision = -1;
    this.viewKey = '';
  }

  private paint(
    ctx: Canvas2D,
    look: StrokeLook,
    pts: Float32Array,
    count: number,
    viewport: ViewportMapper,
  ): void {
    if (count < 1) return;
    const w = Math.max(1, look.width * StrokeRenderer.pxPerUnit(viewport));
    const g = D.glow;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = look.color;
    ctx.beginPath();
    traceCatmullRom(ctx, pts, count, this.map);
    if (look.glow) {
      // One path, stroked several times: see-through halos, then the line, then a hot core.
      ctx.globalCompositeOperation = 'lighter';
      for (const layer of g.layers) {
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth = w * layer.width;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = w;
    ctx.stroke();
    if (look.glow) {
      ctx.strokeStyle = this.core(look.color);
      ctx.lineWidth = w * g.core;
      ctx.stroke();
    }
    ctx.restore();
  }

  private core(color: string): string {
    let c = this.coreColors.get(color);
    if (!c) {
      c = whiten(color, D.glow.coreWhite);
      this.coreColors.set(color, c);
    }
    return c;
  }
}
