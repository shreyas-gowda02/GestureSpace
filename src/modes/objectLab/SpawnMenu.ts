// The Object Lab's radial spawn menu (§20): hold the dominant hand open and still, a ring fills
// round the fingertip, and a menu of the five shapes opens there. Point at one and pinch to make it;
// a pinch anywhere else closes the menu, and so does leaving it alone. Drawn on the 2D overlay.

import { TUNING } from '@/config/tuning';
import type { HandSide, InteractionFrame, Vec2 } from '@/core/types';
import { palmCenterInto } from '../shared/TwoHandTransform';
import type { ModeContext } from '../types';
import { OBJECT_KINDS } from './objects';

const M = TUNING.objectLab.menu;
const HOLD_MS = TUNING.gestures.HOLD_MS;
const ACCENT = TUNING.objectLab.outline.selected;

export type MenuState = 'closed' | 'charging' | 'open';

/** `SpawnMenu.update()` results besides a picked item index (≥ 0). */
export const MENU_IDLE = -2;
/** A pinch closed the menu (the pinch is used up). */
export const MENU_CLOSED = -1;

const BOTTOM: Vec2 = { x: 0, y: -1 };

export class SpawnMenu {
  state: MenuState = 'closed';
  /** The hand that opened it. */
  side: HandSide = 'right';
  /** Middle of the ring (screen CSS px) — the fingertip when it opened (while charging: now). */
  readonly center: Vec2 = { x: 0, y: 0 };
  /** Sizes in CSS px, from the screen height when it opened. */
  radius = 0;
  itemRadius = 0;
  /** Index into OBJECT_KINDS under the fingertip, or −1. */
  hover = -1;
  /** Charging long enough that the ring shows. */
  showingCharge = false;
  private since = 0;
  private lastActive = 0;
  /** After the menu closes the hand must stop being open before it can charge again. */
  private needsRelease = false;
  /** Palm where charging began (aspect-corrected view units). */
  private readonly anchor: Vec2 = { x: 0, y: 0 };
  private readonly palm: Vec2 = { x: 0, y: 0 };
  private readonly point: Vec2 = { x: 0, y: 0 };

  /**
   * Once per frame. `blocked` = something else holds the hands (no charging). Returns MENU_IDLE,
   * MENU_CLOSED, or the index of the shape picked (the menu is closed then too).
   */
  update(frame: InteractionFrame, ctx: ModeContext, blocked: boolean): number {
    const now = frame.timestamp;
    this.showingCharge = false;
    if (this.state === 'open') return this.updateOpen(frame);
    const side = frame.dominant;
    const hand = frame.hands[side];
    const cursor = frame.cursors[side];
    const open = frame.gestures[side]?.openPalm.phase === 'active';
    if (!open) this.needsRelease = false;
    if (blocked || !hand || !cursor || !open || hand.lostForMs > 0 || this.needsRelease) {
      this.state = 'closed';
      return MENU_IDLE;
    }
    const aspect = ctx.viewport.videoAspect;
    palmCenterInto(this.palm, hand);
    const dx = this.palm.x * aspect - this.anchor.x;
    const dy = this.palm.y - this.anchor.y;
    this.center.x = cursor.screen.x;
    this.center.y = cursor.screen.y;
    if (this.state !== 'charging' || this.side !== side || dx * dx + dy * dy > M.stillRadius ** 2) {
      // (Re)start: the hand only just opened, or moved — it must be held still.
      this.state = 'charging';
      this.side = side;
      this.since = now;
      this.anchor.x = this.palm.x * aspect;
      this.anchor.y = this.palm.y;
      this.measure(ctx);
      return MENU_IDLE;
    }
    if (now - this.since >= HOLD_MS) {
      this.state = 'open';
      this.since = this.lastActive = now;
      this.hover = -1;
    } else this.showingCharge = now - this.since >= M.showAfterMs;
    return MENU_IDLE;
  }

  /** The screen's height in CSS px (menu sizes and tap distances are fractions of it). */
  screenHeight(ctx: ModeContext): number {
    return ctx.coords.ndcToScreen(BOTTOM, this.point).y;
  }

  close(): void {
    if (this.state === 'open') this.needsRelease = true;
    this.state = 'closed';
    this.hover = -1;
  }

  onSidesSwapped(): void {
    this.side = this.side === 'right' ? 'left' : 'right';
  }

  /** Where item `i` sits (screen CSS px): round the ring from the top, clockwise. */
  itemCenter(i: number, out: Vec2): Vec2 {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / OBJECT_KINDS.length;
    out.x = this.center.x + Math.cos(a) * this.radius;
    out.y = this.center.y + Math.sin(a) * this.radius;
    return out;
  }

  private updateOpen(frame: InteractionFrame): number {
    const now = frame.timestamp;
    const g = frame.gestures[this.side];
    const cursor = frame.cursors[this.side];
    if (!frame.hands[this.side] || !g || !cursor) {
      this.close();
      return MENU_IDLE;
    }
    let best = -1;
    let bestD = (this.itemRadius * 1.4) ** 2;
    for (let i = 0; i < OBJECT_KINDS.length; i++) {
      this.itemCenter(i, this.point);
      const dx = cursor.screen.x - this.point.x;
      const dy = cursor.screen.y - this.point.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best !== this.hover) {
      this.hover = best;
      this.lastActive = now;
    }
    if (g.pinch.justStarted) {
      const pick = this.hover;
      this.close();
      return pick >= 0 ? pick : MENU_CLOSED;
    }
    if (now - this.lastActive > M.closeMs) this.close();
    return MENU_IDLE;
  }

  private measure(ctx: ModeContext): void {
    const h = this.screenHeight(ctx);
    this.radius = M.radius * h;
    this.itemRadius = M.itemRadius * h;
  }

  // --- drawing (2D overlay, CSS px) ------------------------------------------------------------

  draw(c2d: CanvasRenderingContext2D, now: number, color: string): void {
    if (this.state === 'charging') this.drawCharge(c2d, now);
    else if (this.state === 'open') this.drawMenu(c2d, now, color);
  }

  /** A ring filling round the fingertip while the open hand is held still. */
  private drawCharge(c2d: CanvasRenderingContext2D, now: number): void {
    const t = now - this.since;
    if (t < M.showAfterMs) return;
    const k = Math.min(1, t / HOLD_MS);
    const { x, y } = this.center;
    const r = this.itemRadius * 0.8;
    c2d.save();
    c2d.lineWidth = 4;
    c2d.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    c2d.beginPath();
    c2d.arc(x, y, r, 0, Math.PI * 2);
    c2d.stroke();
    c2d.strokeStyle = ACCENT;
    c2d.beginPath();
    c2d.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    c2d.stroke();
    c2d.restore();
  }

  private drawMenu(c2d: CanvasRenderingContext2D, now: number, color: string): void {
    const t = Math.min(1, (now - this.since) / M.openMs);
    const k = 1 - (1 - t) ** 3; // ease out
    const { x, y } = this.center;
    const ir = this.itemRadius;
    c2d.save();
    c2d.globalAlpha = k;
    // Backdrop and the "close" middle.
    c2d.fillStyle = 'rgba(8, 12, 20, 0.55)';
    c2d.beginPath();
    c2d.arc(x, y, (this.radius + ir * 1.35) * k, 0, Math.PI * 2);
    c2d.fill();
    const cr = M.centerRadius * (ir / M.itemRadius) * 0.6;
    c2d.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    c2d.lineWidth = 2;
    c2d.beginPath();
    c2d.moveTo(x - cr, y - cr);
    c2d.lineTo(x + cr, y + cr);
    c2d.moveTo(x + cr, y - cr);
    c2d.lineTo(x - cr, y + cr);
    c2d.stroke();
    // Items.
    c2d.font = '600 15px system-ui, sans-serif';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    for (let i = 0; i < OBJECT_KINDS.length; i++) {
      const kind = OBJECT_KINDS[i];
      if (!kind) continue;
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / OBJECT_KINDS.length;
      const px = x + Math.cos(a) * this.radius * k;
      const py = y + Math.sin(a) * this.radius * k;
      const hot = i === this.hover;
      const r = ir * (hot ? 1.18 : 1) * k;
      c2d.fillStyle = hot ? 'rgba(30, 36, 50, 0.95)' : 'rgba(16, 20, 30, 0.85)';
      c2d.strokeStyle = hot ? ACCENT : 'rgba(255, 255, 255, 0.35)';
      c2d.lineWidth = hot ? 3 : 1.5;
      c2d.beginPath();
      c2d.arc(px, py, r, 0, Math.PI * 2);
      c2d.fill();
      c2d.stroke();
      drawIcon(c2d, kind.kind, px, py, r * 0.55, color);
      if (hot) {
        const label = kind.name;
        const w = c2d.measureText(label).width + 20;
        const ly = py + r + 18;
        c2d.fillStyle = 'rgba(10, 14, 22, 0.85)';
        c2d.beginPath();
        c2d.roundRect(px - w / 2, ly - 13, w, 26, 13);
        c2d.fill();
        c2d.fillStyle = '#ffffff';
        c2d.fillText(label, px, ly + 1);
      }
    }
    c2d.restore();
  }
}

/** A small flat picture of each shape, `r` ≈ its half size. */
function drawIcon(
  c: CanvasRenderingContext2D,
  kind: (typeof OBJECT_KINDS)[number]['kind'],
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  c.save();
  c.fillStyle = color;
  c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  c.lineWidth = 1.5;
  c.lineJoin = 'round';
  switch (kind) {
    case 'cube': {
      // Isometric cube: top (light), left, right (dark).
      const h = r * 0.58;
      const faces: [number, number][][] = [
        [
          [x, y - r],
          [x + r * 0.87, y - h],
          [x, y - h + (r - h)],
          [x - r * 0.87, y - h],
        ],
        [
          [x - r * 0.87, y - h],
          [x, y - h + (r - h)],
          [x, y + r],
          [x - r * 0.87, y + h],
        ],
        [
          [x + r * 0.87, y - h],
          [x + r * 0.87, y + h],
          [x, y + r],
          [x, y - h + (r - h)],
        ],
      ];
      const shade = [1, 0.75, 0.55];
      faces.forEach((f, i) => {
        c.globalAlpha = shade[i] ?? 1;
        c.beginPath();
        f.forEach(([px, py], j) => (j ? c.lineTo(px, py) : c.moveTo(px, py)));
        c.closePath();
        c.fill();
        c.globalAlpha = 1;
        c.stroke();
      });
      break;
    }
    case 'sphere': {
      const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, color);
      g.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      break;
    }
    case 'cylinder': {
      const w = r * 0.75;
      const e = r * 0.28;
      c.globalAlpha = 0.75;
      c.beginPath();
      c.moveTo(x - w, y - r + e);
      c.lineTo(x - w, y + r - e);
      c.ellipse(x, y + r - e, w, e, 0, Math.PI, 0, true);
      c.lineTo(x + w, y - r + e);
      c.fill();
      c.globalAlpha = 1;
      c.stroke();
      c.beginPath();
      c.ellipse(x, y - r + e, w, e, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      break;
    }
    case 'plane': {
      c.globalAlpha = 0.85;
      c.beginPath();
      c.moveTo(x - r, y + r * 0.35);
      c.lineTo(x - r * 0.35, y - r * 0.6);
      c.lineTo(x + r, y - r * 0.35);
      c.lineTo(x + r * 0.35, y + r * 0.6);
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
      c.stroke();
      break;
    }
    case 'torus': {
      c.beginPath();
      c.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
      c.ellipse(x, y, r * 0.42, r * 0.3, 0, 0, Math.PI * 2, true);
      c.fill('evenodd');
      c.stroke();
      break;
    }
  }
  c.restore();
}
