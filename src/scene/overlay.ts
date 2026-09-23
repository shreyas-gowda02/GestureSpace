// 2D overlay layer above the WebGL canvas (§5 layering): hand skeletons now; Air Draw strokes and
// HUD hints later. Everything is positioned with ViewportMapper.viewToScreen so it lines up exactly
// with the cover-cropped, mirrored camera background.

import { TUNING } from '@/config/tuning';
import type { HandSide, TrackedHand, Vec2 } from '@/core/types';
import type { ViewportMapper } from '@/spatial/ViewportMapper';
import { FINGERTIPS, HAND_CONNECTIONS, LANDMARK_COUNT, WRIST } from '@/vision/landmarks';

export class OverlayCanvas2D {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** CSS px. Draw in CSS px — the context is pre-scaled by devicePixelRatio. */
  width = 0;
  height = 0;
  private dpr = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gs-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  setSize(width: number, height: number, dpr: number): void {
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  dispose(): void {
    this.canvas.remove();
  }
}

// Scratch buffers: screen positions of the 21 landmarks (reused every frame).
const pts: Vec2[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }));
const TIP_SET = new Set<number>(FINGERTIPS);

// Label strings are cached per side and only rebuilt when the rounded score changes.
const labelCache: Record<HandSide, { pct: number; text: string }> = {
  left: { pct: -1, text: '' },
  right: { pct: -1, text: '' },
};

function labelFor(hand: TrackedHand): string {
  const pct = Math.round(hand.score * 100);
  const c = labelCache[hand.side];
  if (c.pct !== pct) {
    c.pct = pct;
    c.text = `${hand.side === 'right' ? 'Right' : 'Left'} ${pct}%`;
  }
  return c.text;
}

/** Draw one hand's skeleton + joints + side label, aligned to the video. */
export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: TrackedHand,
  viewport: ViewportMapper,
): void {
  const o = TUNING.overlay;
  const color = o.colors[hand.side];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const lm = hand.landmarks[i];
    const p = pts[i];
    if (lm && p) viewport.viewToScreen(lm, p);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = o.lineWidth;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  ctx.globalAlpha = 1;
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = pts[i];
    if (!p) continue;
    const tip = TIP_SET.has(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, tip ? o.tipRadius : o.jointRadius, 0, Math.PI * 2);
    ctx.fillStyle = tip ? color : '#ffffff';
    ctx.fill();
  }

  // Side label under the wrist.
  const w = pts[WRIST];
  if (!w) return;
  const text = labelFor(hand);
  ctx.font = '600 12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const x = w.x - tw / 2 - 8;
  const y = w.y + 14;
  ctx.fillStyle = 'rgba(5, 7, 11, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, tw + 16, 22, 11);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 8, y + 11);
}
