// Owns the object-fit: cover crop + selfie mirror between the video image and the viewport (§8).
// The SAME numbers drive the camera background shader, every lens shader, and all overlays,
// which guarantees pixel-perfect alignment. Pure (no DOM / Three.js) and unit-tested.
//
// Spaces:
//   view-normalized  x,y ∈ [0,1] of the DISPLAYED (mirrored when `mirror`) video image, y down
//   screen           CSS px of the viewport, y down
//   screenUv         gl_FragCoord / resolution, y UP (shader side)

import type { Vec2 } from '@/core/types';

export class ViewportMapper {
  videoWidth = 0;
  videoHeight = 0;
  viewWidth = 0;
  viewHeight = 0;
  mirror = true;

  /** CSS px per video px. */
  scale = 1;
  /** Screen position (CSS px) of the displayed video's top-left corner (≤ 0 when cropped). */
  offsetX = 0;
  offsetY = 0;

  /** Shader mapping: displayUv = screenUv * coverScale + coverOffset (both y-up). */
  readonly coverScale: Vec2 = { x: 1, y: 1 };
  readonly coverOffset: Vec2 = { x: 0, y: 0 };

  /** Bumps whenever the mapping changes, so consumers can re-sync cheaply. */
  version = 0;

  get ready(): boolean {
    return this.videoWidth > 0 && this.videoHeight > 0 && this.viewWidth > 0 && this.viewHeight > 0;
  }

  /** Video image aspect (w/h); multiply view-normalized x by this before measuring distances. */
  get videoAspect(): number {
    return this.videoHeight > 0 ? this.videoWidth / this.videoHeight : 1;
  }

  /** Returns true if anything changed. */
  update(videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number): boolean {
    if (
      videoWidth === this.videoWidth &&
      videoHeight === this.videoHeight &&
      viewWidth === this.viewWidth &&
      viewHeight === this.viewHeight
    ) {
      return false;
    }
    this.videoWidth = videoWidth;
    this.videoHeight = videoHeight;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.recompute();
    return true;
  }

  setMirror(mirror: boolean): void {
    if (mirror === this.mirror) return;
    this.mirror = mirror;
    this.version++;
  }

  /** Tracker-native x (un-mirrored video image) → view-normalized x. y is unchanged. */
  trackerToViewX(x: number): number {
    return this.mirror ? 1 - x : x;
  }

  viewToScreen(v: Vec2, out: Vec2): Vec2 {
    out.x = this.offsetX + v.x * this.videoWidth * this.scale;
    out.y = this.offsetY + v.y * this.videoHeight * this.scale;
    return out;
  }

  screenToView(s: Vec2, out: Vec2): Vec2 {
    const dw = this.videoWidth * this.scale;
    const dh = this.videoHeight * this.scale;
    out.x = dw > 0 ? (s.x - this.offsetX) / dw : 0;
    out.y = dh > 0 ? (s.y - this.offsetY) / dh : 0;
    return out;
  }

  private recompute(): void {
    this.version++;
    if (!this.ready) {
      this.scale = 1;
      this.offsetX = this.offsetY = 0;
      this.coverScale.x = this.coverScale.y = 1;
      this.coverOffset.x = this.coverOffset.y = 0;
      return;
    }
    this.scale = Math.max(this.viewWidth / this.videoWidth, this.viewHeight / this.videoHeight);
    const dw = this.videoWidth * this.scale;
    const dh = this.videoHeight * this.scale;
    this.offsetX = (this.viewWidth - dw) / 2;
    this.offsetY = (this.viewHeight - dh) / 2;

    // x: displayU = (sx - offsetX) / dw, with sx = screenUv.x * viewWidth
    this.coverScale.x = this.viewWidth / dw;
    this.coverOffset.x = -this.offsetX / dw;
    // y (flip to y-up): displayV = 1 - (sy - offsetY) / dh, with sy = (1 - screenUv.y) * viewHeight
    this.coverScale.y = this.viewHeight / dh;
    this.coverOffset.y = 1 - this.viewHeight / dh + this.offsetY / dh;
  }
}
