// Experience 3 — Air Draw (§15): point with the dominant hand's index finger (others curled) and
// the fingertip draws glowing strokes; lower the finger or open the hand to lift the pen (D48 — the
// user's choice over the spec's pinch). Make a fist with the OTHER hand and the drawing fingertip
// becomes an eraser, wiping away every stroke it touches until the fist opens (D49); the Eraser tool
// (X) does the same while pointing. 8 neon colours, 3 widths, glow on / off; every stroke, erase and
// Clear is one undo step.

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
import { INDEX_TIP } from '@/vision/landmarks';
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
  /** An erase in progress: by the other hand's fist (D49) or by the Eraser tool + pointing. */
  private eraser: {
    side: HandSide;
    before: readonly Stroke[];
    byFist: boolean;
    /**
     * Strokes under the fingertip when the fist closed (e.g. the line just finished): safe until
     * the fingertip has left them, so making the fist never deletes what you were touching.
     */
    spared: Set<number>;
  } | null = null;
  /** A new stroke needs a fresh point: false after a stroke / erase until the finger is lowered. */
  private penArmed = true;
  /** The other hand is a fist this frame (with a short grace for tracking drop-outs). */
  private fist = false;
  private fistSeenAt = -Infinity;
  private hover: Stroke | null = null;
  private hasTip = false;
  /** The pen: the drawing hand's index fingertip this frame, view-normalized. */
  private readonly tip: Vec2 = { x: 0, y: 0 };
  /** A new tracker reading arrived this frame (not just a predicted in-between position). */
  private newReading = false;
  private lastReading = -1;
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

    // Precedence (§11 rule 2): no new stroke starts while both hands pinch (a two-hand gesture).
    const allowed = singleHandPinchAllowed(frame.gestures);
    const reading = frame.hands.inferenceTimestamp;
    this.newReading = reading !== this.lastReading;
    this.lastReading = reading;

    // The other hand's fist = eraser held down (D49). A fist that drops out for a moment (tracking)
    // neither ends the erase nor lets a line start.
    if (frame.gestures[other(frame.dominant)]?.grab.phase === 'active') this.fistSeenAt = this.now;
    this.fist = this.now - this.fistSeenAt <= D.fistGraceMs;

    const side = this.pen?.side ?? this.eraser?.side ?? frame.dominant;
    this.readTip(frame, side);
    const g = frame.gestures[side];
    const pointing = g?.point.phase === 'active';

    if (this.pen) {
      if (this.fist)
        this.endPen(true); // the fist takes over: keep the line, start erasing
      else this.continuePen(g);
    }
    if (this.eraser) this.continueEraser(pointing);
    if (!pointing) this.penArmed = true;
    if (!this.pen && !this.eraser && allowed && this.hasTip) {
      if (this.fist) this.startEraser(side, true);
      else if (pointing && this.penArmed) {
        if (this.tool === 'pen') this.startPen(side);
        else this.startEraser(side, false);
      }
    }

    this.hover =
      this.tool === 'eraser' && !this.fist && !this.eraser && allowed && this.hasTip
        ? this.strokeAt(this.tip)
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
    }
    // The pen tip follows the fingertip every frame, even between tracker readings.
    if (this.hasTip) {
      const erasing = this.eraser || this.fist || this.tool === 'eraser';
      r.drawCursor(c2d, vp, this.tip, erasing ? null : (this.pen?.look ?? this.look()));
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
    this.hasTip = false;
  }

  dispose(): void {
    this.renderer.dispose();
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------------------------

  /** The pen position: the hand's index fingertip (smoothed landmarks, view units). */
  private readTip(frame: InteractionFrame, side: HandSide): void {
    const tip = frame.hands[side]?.landmarks[INDEX_TIP];
    this.hasTip = !!tip;
    if (!tip) return;
    this.tip.x = tip.x;
    this.tip.y = tip.y;
  }

  private look(): StrokeLook {
    return { color: this.color, width: D.widths[this.width]?.size ?? 0.012, glow: this.glow };
  }

  private startPen(side: HandSide): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.capture.capture(side, PEN_ID, this.now, () => this.endPen(true))) return;
    this.pen = { side, look: this.look() };
    this.builder.begin(this.tip.x, this.tip.y, this.now);
  }

  private startEraser(side: HandSide, byFist: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.capture.capture(side, ERASER_ID, this.now, () => this.endEraser(true))) return;
    const spared = new Set<number>();
    if (byFist) for (const st of this.strokesAt(this.tip)) spared.add(st.id);
    this.eraser = { side, before: this.strokes, byFist, spared };
    this.eraseAt(this.tip);
  }

  private continuePen(g: HandGestures | undefined): void {
    const pen = this.pen;
    const ctx = this.ctx;
    if (!pen || !ctx) return;
    if (!g || g.point.phase !== 'active') {
      ctx.capture.release(pen.side, 'released'); // → endPen(true)
      return;
    }
    // Only real tracker readings go into the stroke: the predicted in-between positions overshoot
    // when the finger turns, which put bulges up to ~22 px into lines (D48).
    if (this.hasTip && this.newReading) {
      this.builder.add(this.tip.x, this.tip.y, this.now, ctx.viewport.videoAspect);
    }
  }

  /** Lift the pen: the stroke joins the drawing as one undo step (or is discarded). */
  private endPen(commit: boolean): void {
    const pen = this.pen;
    const ctx = this.ctx;
    if (!pen || !ctx) return;
    this.pen = null;
    this.penArmed = false;
    if (commit) {
      const before = this.strokes;
      const after = [...before, this.builder.finish(this.nextId++, pen.look)];
      this.setStrokes(after);
      ctx.history.push(new StrokeListCommand('Draw stroke', this.setStrokes, before, after));
    }
    if (ctx.capture.get(pen.side)?.targetId === PEN_ID) ctx.capture.release(pen.side, 'cancelled');
  }

  private continueEraser(pointing: boolean): void {
    const eraser = this.eraser;
    if (!eraser || !this.ctx) return;
    if (eraser.byFist ? !this.fist : !pointing) {
      this.ctx.capture.release(eraser.side, 'released'); // → endEraser(true)
      return;
    }
    if (this.hasTip) this.eraseAt(this.tip);
  }

  /** Every stroke touched during the erase goes, as one undo step (or all come back). */
  private endEraser(commit: boolean): void {
    const eraser = this.eraser;
    const ctx = this.ctx;
    if (!eraser || !ctx) return;
    this.eraser = null;
    this.penArmed = false;
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
    const spared = this.eraser?.spared;
    let hit = false;
    for (const st of this.strokes) {
      const touching = strokeHit(st, p.x, p.y, aspect);
      if (spared?.has(st.id)) {
        if (!touching) spared.delete(st.id); // the fingertip left it: erasable from now on
      } else if (touching) hit = true;
    }
    if (!hit) return;
    this.setStrokes(
      this.strokes.filter((st) => spared?.has(st.id) || !strokeHit(st, p.x, p.y, aspect)),
    );
  }

  private strokesAt(p: Vec2): Stroke[] {
    const aspect = this.ctx?.viewport.videoAspect ?? 1;
    return this.strokes.filter((st) => strokeHit(st, p.x, p.y, aspect));
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
    const off = other(dominant);
    if (this.pen) text = 'Drawing — lower your finger to lift the pen';
    else if (this.eraser?.byFist) {
      text = `Erasing — your ${dominant} fingertip wipes lines away; open your ${off} hand to stop`;
    } else if (this.eraser) text = 'Erasing — every stroke your fingertip touches goes';
    else if (!allowed) text = 'Both hands pinching — nothing is drawn';
    else if (this.tool === 'eraser') {
      text = 'Eraser — point at strokes to remove them (red = will go) · X for the pen';
    } else text = `Pen — point your ${dominant} index finger to draw · ${off} fist = eraser`;
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
