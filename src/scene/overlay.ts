// 2D overlay layer above the WebGL canvas (§5 layering): hand skeletons now; Air Draw strokes and
// HUD hints later. Everything is positioned with ViewportMapper.viewToScreen so it lines up exactly
// with the cover-cropped, mirrored camera background.

import { TUNING } from '@/config/tuning';
import type { GestureFrame, HandFrame, HandSide, TrackedHand, Vec2 } from '@/core/types';
import { pinchPointInto } from '@/gestures/twoHand';
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

  // A hand in its loss grace period is drawn faded ("frozen").
  const alpha = hand.lostForMs > 0 ? 0.35 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = o.lineWidth;
  ctx.globalAlpha = 0.9 * alpha;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  ctx.globalAlpha = alpha;
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
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Gesture feedback (§21.5): pinch rings + the two-hand line / centre / scale·angle readout.
// ---------------------------------------------------------------------------------------------

const pinchView: Record<HandSide, Vec2> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
const pinchScreen: Record<HandSide, Vec2> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
const centerScreen: Vec2 = { x: 0, y: 0 };
const twoHandLabel = { scale: -1, deg: -9999, text: '' };

function twoHandText(scale: number, rotation: number): string {
  const s = Math.round(scale * 100);
  const d = Math.round((rotation * 180) / Math.PI);
  if (s !== twoHandLabel.scale || d !== twoHandLabel.deg) {
    twoHandLabel.scale = s;
    twoHandLabel.deg = d;
    twoHandLabel.text = `×${(s / 100).toFixed(2)}  ${d > 0 ? '+' : ''}${d}°`;
  }
  return twoHandLabel.text;
}

export function drawGestureIndicators(
  ctx: CanvasRenderingContext2D,
  hands: HandFrame,
  gestures: GestureFrame,
  bothVisible: boolean,
  viewport: ViewportMapper,
): void {
  const colors = TUNING.overlay.colors;
  for (const side of ['left', 'right'] as const) {
    const hand = hands[side];
    const g = gestures[side];
    if (!hand || !g) continue;
    viewport.viewToScreen(pinchPointInto(pinchView[side], hand), pinchScreen[side]);
    const p = pinchScreen[side];
    const phase = g.pinch.phase;
    if (phase === 'candidate') {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = colors[side];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (phase === 'active') {
      ctx.fillStyle = colors[side];
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const l = pinchScreen.left;
  const r = pinchScreen.right;
  const two = gestures.twoHand;
  if (!bothVisible || !hands.left || !hands.right) return;
  ctx.strokeStyle = two.active ? '#ffffff' : 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = two.active ? 2.5 : 1.5;
  if (!two.active) ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(l.x, l.y);
  ctx.lineTo(r.x, r.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!two.active) return;

  viewport.viewToScreen(two.center, centerScreen);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(centerScreen.x, centerScreen.y, 5, 0, Math.PI * 2);
  ctx.fill();
  const text = twoHandText(two.scale, two.rotation);
  ctx.font = '600 13px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(5, 7, 11, 0.72)';
  ctx.beginPath();
  ctx.roundRect(centerScreen.x - tw / 2 - 9, centerScreen.y - 38, tw + 18, 24, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerScreen.x - tw / 2, centerScreen.y - 26);
}
