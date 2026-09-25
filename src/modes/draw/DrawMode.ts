// Experience 3 — Air Draw (§15): pinch with the dominant hand to put the pen down, move to draw
// glowing strokes, release to lift it. 8 neon colours, 3 widths, glow on / off; the eraser removes
// whole strokes you touch; every stroke, erase and Clear is one undo step. The pen is the steady
// aim (D43), so a stroke starts where the cursor was, not where the pinching finger slid to.

import { TUNING } from '@/config/tuning';
import type {
  DrawTool,
  DrawUiState,
  HandGestures,
  HandSide,
  InteractionFrame,
  Vec2,
} from '@/core/types';
import { singleHandPinchAllowed } from '@/gestures/GestureEngine';
import type { ModeAction, ModeContext, SpatialMode } from '../types';
import {
  StrokeBuilder,
  strokeHit,
  StrokeListCommand,
  StrokeRenderer,
  type Stroke,
  type StrokeLook,
} from './strokes';

const D = TUNING.draw;
const PEN_ID = 'draw-pen';
const ERASER_ID = 'draw-eraser';

const other = (s: HandSide): HandSide => (s === 'right' ? 'left' : 'right');

export class DrawMode implements SpatialMode {
  readonly id = 'draw' as const;
  private ctx: ModeContext | null = null;
  private strokes: readonly Stroke[] = [];
  /** Bumps on every change of `strokes` (the renderer's cache key). */
  private revision = 0;
  private nextId = 1;

  private tool: DrawTool = 'pen';
  private color: string = D.palette[0]?.hex ?? '#2ef2ff';
  private width: number = D.defaultWidth;
  private glow = true;

  private readonly builder = new StrokeBuilder();
  private pen: { side: HandSide; look: StrokeLook } | null = null;
  private eraser: { side: HandSide; before: readonly Stroke[] } | null = null;
  private hover: Stroke | null = null;
  private hasAim = false;
  /** The pen position this frame, view-normalized. */
  private readonly aim: Vec2 = { x: 0, y: 0 };
  private readonly screen: Vec2 = { x: 0, y: 0 };
  private readonly renderer = new StrokeRenderer();

  private now = 0;
  private uiDirty = true;
  private lastUi = -Infinity;

  private readonly setStrokes = (list: readonly Stroke[]): void => {
    this.strokes = list;
    this.revision++;
    this.uiDirty = true;
  };

  /** The drawing (tests / debug). */
  get strokeList(): readonly Stroke[] {
    return this.strokes;
  }

  enter(ctx: ModeContext): void {
    this.ctx = ctx;
    this.uiDirty = true;
    this.flushUi(true);
  }

  update(frame: InteractionFrame): void {
    if (!this.ctx) return;
    this.now = frame.timestamp;

    const two = frame.gestures.twoHand;
    if (two.justStarted) {
      // Precedence (§11 rule 2): a second pinch right after the first means a two-hand gesture,
      // so the first hand's just-started stroke is taken back; a later one is kept.
      const first = two.cancelFirstHand;
      if (this.pen) this.endPen(this.pen.side !== first);
      if (this.eraser) this.endEraser(this.eraser.side !== first);
    }
    const allowed = singleHandPinchAllowed(frame.gestures);

    const side = this.pen?.side ?? this.eraser?.side ?? frame.dominant;
    this.readAim(frame, side);
    const g = frame.gestures[side];
    if (this.pen) this.continuePen(g);
    else if (this.eraser) this.continueEraser(g);
    else if (allowed && this.hasAim && g?.pinch.justStarted) this.start(side);

    this.hover =
      this.tool === 'eraser' && !this.eraser && allowed && this.hasAim
        ? this.strokeAt(this.aim)
        : null;
    this.updateStatus(allowed, frame.dominant);
    this.flushUi(false);
  }

  drawOverlay(c2d: CanvasRenderingContext2D): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.viewport.ready) return;
    const vp = ctx.viewport;
    const r = this.renderer;
    r.drawStrokes(c2d, ctx.overlay, vp, this.strokes, this.revision);
    if (this.hover) r.drawHighlight(c2d, vp, this.hover);
    if (this.pen) {
      r.drawLive(c2d, vp, this.pen.look, this.builder.points, this.builder.liveCount());
    } else if (this.hasAim) {
      r.drawCursor(c2d, vp, this.aim, this.tool === 'pen' ? this.look() : null);
    }
  }

  onAction(action: ModeAction): boolean {
    switch (action.type) {
      case 'toggleErase':
        this.tool = this.tool === 'eraser' ? 'pen' : 'eraser';
        break;
      case 'drawTool':
        this.tool = action.tool;
        break;
      case 'drawColor':
        if (!/^#[0-9a-f]{6}$/i.test(action.color)) return false;
        this.color = action.color.toLowerCase();
        break;
      case 'drawWidth':
        if (!Number.isInteger(action.width) || !D.widths[action.width]) return false;
        this.width = action.width;
        break;
      case 'drawGlow':
        this.glow = !this.glow;
        break;
      default:
        return false;
    }
    this.uiDirty = true;
    this.flushUi(true);
    return true;
  }

  onSidesSwapped(): void {
    if (this.pen) this.pen.side = other(this.pen.side);
    if (this.eraser) this.eraser.side = other(this.eraser.side);
  }

  /** Clear (C): the whole drawing, as one undoable step. */
  reset(): void {
    const ctx = this.ctx;
    if (!ctx || this.strokes.length === 0) return;
    ctx.history.execute(new StrokeListCommand('Clear drawing', this.setStrokes, this.strokes, []));
  }

  exit(): void {
    this.endPen(true);
    this.endEraser(true);
    this.hover = null;
    this.hasAim = false;
  }

  dispose(): void {
    this.renderer.dispose();
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------------------------

  /** The pen position: the hand's steady aim (cursor), in view units. */
  private readAim(frame: InteractionFrame, side: HandSide): void {
    const ctx = this.ctx;
    const cursor = frame.cursors[side];
    this.hasAim = !!ctx && !!cursor;
    if (!ctx || !cursor) return;
    ctx.coords.ndcToScreen(cursor.ndc, this.screen);
    ctx.viewport.screenToView(this.screen, this.aim);
  }

  private look(): StrokeLook {
    return { color: this.color, width: D.widths[this.width]?.size ?? 0.012, glow: this.glow };
  }

  private start(side: HandSide): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.tool === 'pen') {
      if (!ctx.capture.capture(side, PEN_ID, this.now, () => this.endPen(true))) return;
      this.pen = { side, look: this.look() };
      this.builder.begin(this.aim.x, this.aim.y, this.now);
    } else {
      if (!ctx.capture.capture(side, ERASER_ID, this.now, () => this.endEraser(true))) return;
      this.eraser = { side, before: this.strokes };
      this.eraseAt(this.aim);
    }
  }

  private continuePen(g: HandGestures | undefined): void {
    const pen = this.pen;
    const ctx = this.ctx;
    if (!pen || !ctx) return;
    if (!g || g.pinch.phase !== 'active') {
      ctx.capture.release(pen.side, 'released'); // → endPen(true)
      return;
    }
    if (this.hasAim) this.builder.add(this.aim.x, this.aim.y, this.now, ctx.viewport.videoAspect);
  }

  /** Lift the pen: the stroke joins the drawing as one undo step (or is discarded). */
  private endPen(commit: boolean): void {
    const pen = this.pen;
    const ctx = this.ctx;
    if (!pen || !ctx) return;
    this.pen = null;
    if (commit) {
      const before = this.strokes;
      const after = [...before, this.builder.finish(this.nextId++, pen.look)];
      this.setStrokes(after);
      ctx.history.push(new StrokeListCommand('Draw stroke', this.setStrokes, before, after));
    }
    if (ctx.capture.get(pen.side)?.targetId === PEN_ID) ctx.capture.release(pen.side, 'cancelled');
  }

  private continueEraser(g: HandGestures | undefined): void {
    const eraser = this.eraser;
    if (!eraser || !this.ctx) return;
    if (!g || g.pinch.phase !== 'active') {
      this.ctx.capture.release(eraser.side, 'released'); // → endEraser(true)
      return;
    }
    if (this.hasAim) this.eraseAt(this.aim);
  }

  /** Every stroke touched while the pinch was held goes, as one undo step (or all come back). */
  private endEraser(commit: boolean): void {
    const eraser = this.eraser;
    const ctx = this.ctx;
    if (!eraser || !ctx) return;
    this.eraser = null;
    if (!commit) this.setStrokes(eraser.before);
    else if (this.strokes !== eraser.before) {
      ctx.history.push(
        new StrokeListCommand('Erase strokes', this.setStrokes, eraser.before, this.strokes),
      );
    }
    if (ctx.capture.get(eraser.side)?.targetId === ERASER_ID) {
      ctx.capture.release(eraser.side, 'cancelled');
    }
  }

  private eraseAt(p: Vec2): void {
    const aspect = this.ctx?.viewport.videoAspect ?? 1;
    if (!this.strokes.some((s) => strokeHit(s, p.x, p.y, aspect))) return;
    this.setStrokes(this.strokes.filter((s) => !strokeHit(s, p.x, p.y, aspect)));
  }

  /** The top-most stroke under the eraser. */
  private strokeAt(p: Vec2): Stroke | null {
    const aspect = this.ctx?.viewport.videoAspect ?? 1;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s && strokeHit(s, p.x, p.y, aspect)) return s;
    }
    return null;
  }

  private updateStatus(allowed: boolean, dominant: HandSide): void {
    let text: string;
    if (this.pen) text = 'Drawing — release the pinch to lift the pen';
    else if (this.eraser) text = 'Erasing — every stroke you touch goes; release to finish';
    else if (!allowed) text = 'Both hands pinching — nothing is drawn';
    else if (this.tool === 'eraser') text = 'Eraser — pinch a stroke to remove it · X for the pen';
    else text = `Pen — pinch with your ${dominant} hand to draw · X for the eraser`;
    this.ctx?.emitStatus(text);
  }

  private uiState(): DrawUiState {
    return {
      tool: this.tool,
      color: this.color,
      width: this.width,
      glow: this.glow,
      count: this.strokes.length,
    };
  }

  /** Publish tool-panel state when it changed, at most `uiHz` (immediately for button / key use). */
  private flushUi(force: boolean): void {
    if (!this.uiDirty || !this.ctx) return;
    if (!force && this.now - this.lastUi < 1000 / D.uiHz) return;
    this.uiDirty = false;
    this.lastUi = this.now;
    this.ctx.publishUi('draw', this.uiState());
  }
}
