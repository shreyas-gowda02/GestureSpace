// Spatial Panel (Phase 7, §14) + the shared Texture Surface (§17): a real ModeController drives the
// panel frame by frame with two pinching hands (ModeRig, real TwoHandTracker); checks are in view
// and screen terms where it matters.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { PanelUiState, Vec2 } from '@/core/types';
import {
  imageSource,
  liveCameraSource,
  proceduralSource,
  TextureSurface,
} from '@/modes/shared/TextureSurface';
import { ModeRig, VIEW_H, VIEW_W } from '../fixtures/modeHarness';

const P = TUNING.panel;

function panelRig() {
  const rig = new ModeRig('panel');
  rig.trackTwoHands();
  const object = rig.base.scene.getObjectByName('Mode:panel');
  const mesh = object?.getObjectByName('Mode:panelSurface') as THREE.Mesh | undefined;
  if (!object || !mesh) throw new Error('panel missing');
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
  /** Where the panel's centre is drawn, in view units (0..1). */
  const centreView = (): Vec2 => {
    const p = object.getWorldPosition(new THREE.Vector3()).project(rig.base.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  };
  const ui = (): PanelUiState | undefined => rig.ui.filter((u) => u.panel).at(-1)?.panel;
  return { rig, object, mesh, uniforms, centreView, ui };
}

/** Both hands at view points, pinching or not, for `frames` frames. */
function hands(rig: ModeRig, l: Vec2, r: Vec2, pinching: boolean, frames = 1): void {
  for (let i = 0; i < frames; i++) {
    rig.show('left', l.x, l.y);
    rig.show('right', r.x, r.y);
    rig.pinch('left', pinching);
    rig.pinch('right', pinching);
    rig.step();
  }
}

// The resting panel covers view x ≈ 0.32–0.68, y ≈ 0.26–0.66.
const ON_L = { x: 0.36, y: 0.46 };
const ON_R = { x: 0.64, y: 0.46 };

describe('Spatial Panel: grab with both hands (§14)', () => {
  it('both pinches on the panel grab it: it follows, grows and turns; let go = one undo step', () => {
    const { rig, object, centreView } = panelRig();
    const start = object.matrixWorld.clone();
    hands(rig, ON_L, ON_R, false, 3);
    hands(rig, ON_L, ON_R, true, 2);
    expect(rig.base.capture.get('twoHand')?.targetId).toBe('panel');
    expect(object.matrixWorld.equals(start)).toBe(true); // no jump on grab
    // Move right and up, spread ×1.5, tilt the hand line.
    for (let i = 1; i <= 40; i++) {
      const k = i / 40;
      const cx = 0.5 + 0.1 * k;
      const cy = 0.46 - 0.05 * k;
      const half = 0.14 * (1 + 0.5 * k);
      hands(rig, { x: cx - half, y: cy + 0.03 * k }, { x: cx + half, y: cy - 0.03 * k }, true);
    }
    hands(rig, { x: 0.39, y: 0.44 }, { x: 0.81, y: 0.38 }, true, 20);
    const c = centreView();
    expect(c.x).toBeCloseTo(0.6, 2);
    expect(object.scale.x).toBeCloseTo(1.5, 1);
    // The right hand ended higher: the panel turned anticlockwise by the hand line's tilt.
    expect(object.rotation.z).toBeCloseTo(Math.atan2(0.06, (0.42 * VIEW_W) / VIEW_H), 3);
    expect(rig.statuses.at(-1)).toMatch(/Holding the panel/);
    hands(rig, { x: 0.39, y: 0.44 }, { x: 0.81, y: 0.38 }, false, 3);
    expect(rig.base.capture.count).toBe(0);
    expect(rig.mc.history?.undoLabel).toBe('Move panel');
    rig.mc.undo();
    expect(object.matrixWorld.equals(start)).toBe(true);
  });

  it('a two-hand pinch away from the panel does not grab it', () => {
    const { rig, object } = panelRig();
    const start = object.matrixWorld.clone();
    hands(rig, { x: 0.12, y: 0.85 }, { x: 0.3, y: 0.9 }, true, 3);
    expect(rig.base.capture.count).toBe(0);
    expect(rig.statuses.at(-1)).toMatch(/Pinch on the panel/);
    hands(rig, { x: 0.2, y: 0.8 }, { x: 0.5, y: 0.9 }, true, 10);
    expect(object.matrixWorld.equals(start)).toBe(true);
  });

  it('a pinch just outside the edge still grabs it (capture margin)', () => {
    const { rig } = panelRig();
    const margin = (P.captureMargin * 0.8) / 18.65; // view heights, inside the margin
    const edge = 0.5 - (P.size / 2 / 18.65) * (VIEW_H / VIEW_W); // left edge in view x
    hands(rig, { x: edge - (margin * VIEW_H) / VIEW_W, y: 0.46 }, ON_R, true, 2);
    expect(rig.base.capture.get('twoHand')?.targetId).toBe('panel');
  });

  it('the handles glow when a hand is in reach, fully while held', () => {
    const { rig, uniforms } = panelRig();
    const glow = (): number[] => (uniforms.uHandles?.value as THREE.Vector2).toArray();
    rig.step();
    expect(glow()).toEqual([P.handleGlow.idle, P.handleGlow.idle]);
    rig.show('left', ON_L.x, ON_L.y);
    rig.step();
    expect(glow()).toEqual([P.handleGlow.near, P.handleGlow.idle]); // left hand on the left half
    hands(rig, ON_L, ON_R, false);
    expect(glow()).toEqual([P.handleGlow.near, P.handleGlow.near]);
    expect(rig.statuses.at(-1)).toMatch(/Both hands on the panel/);
    hands(rig, ON_L, ON_R, true, 2);
    expect(glow()).toEqual([P.handleGlow.held, P.handleGlow.held]);
  });

  it('Reset (R) puts it back in the middle as an undo step; Clear leaves it alone', () => {
    const { rig, object } = panelRig();
    const rest = object.matrixWorld.clone();
    hands(rig, ON_L, ON_R, true, 2);
    for (let i = 1; i <= 20; i++)
      hands(rig, { x: 0.36 + 0.01 * i, y: 0.46 }, { x: 0.64 + 0.01 * i, y: 0.46 }, true);
    hands(rig, ON_L, ON_R, false, 2);
    const moved = object.matrixWorld.clone();
    expect(moved.equals(rest)).toBe(false);
    rig.mc.clear();
    expect(object.matrixWorld.equals(moved)).toBe(true);
    rig.mc.resetView();
    expect(object.matrixWorld.equals(rest)).toBe(true);
    expect(rig.mc.history?.undoLabel).toBe('Reset panel');
    rig.mc.undo();
    expect(object.matrixWorld.equals(moved)).toBe(true);
  });
});

describe('Spatial Panel: content', () => {
  it('starts on the first sample; buttons switch pictures and the animated pattern', () => {
    const { rig, ui, uniforms } = panelRig();
    expect(ui()).toMatchObject({ content: 'aurora', fileName: null, held: false });
    expect(uniforms.uMode?.value).toBe(2); // waiting for the picture (none loads in Node)
    expect(rig.mc.handleAction({ type: 'panelContent', content: 'animated' })).toBe(true);
    expect(ui()?.content).toBe('animated');
    expect(uniforms.uMode?.value).toBe(1);
    expect(rig.mc.handleAction({ type: 'panelContent', content: 'sunset' })).toBe(true);
    expect(ui()?.content).toBe('sunset');
  });

  it('camera content needs a running camera', () => {
    const { rig, ui } = panelRig();
    expect(rig.mc.handleAction({ type: 'panelContent', content: 'snapshot' })).toBe(false);
    expect(rig.mc.handleAction({ type: 'panelContent', content: 'camera' })).toBe(false);
    expect(rig.statuses.at(-1)).toBe('Start the camera first');
    expect(ui()?.content).toBe('aurora');
  });

  it("the user's own picture: shown by name, its object URL revoked when replaced", () => {
    const { rig, ui } = panelRig();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    rig.mc.handleAction({ type: 'panelFile', url: 'blob:holiday', name: 'holiday.jpg' });
    expect(ui()).toMatchObject({ content: 'file', fileName: 'holiday.jpg' });
    rig.mc.handleAction({ type: 'panelContent', content: 'animated' });
    expect(revoke).toHaveBeenCalledWith('blob:holiday');
    expect(ui()?.fileName).toBeNull();
    revoke.mockRestore();
  });
});

describe('TextureSurface (§17)', () => {
  it('takes the content’s shape: the longer side is panel.size, the glow margin around it', () => {
    const s = new TextureSurface('T');
    s.setSource(liveCameraSource(new THREE.Texture(), 4 / 3, true));
    expect(s.size.x).toBeCloseTo(P.size);
    expect(s.size.y).toBeCloseTo(P.size * 0.75);
    expect(s.mesh.scale.x).toBeCloseTo(P.size + 2 * P.glowMargin);
    s.setSource(liveCameraSource(new THREE.Texture(), 0.5, false)); // portrait
    expect(s.size.y).toBeCloseTo(P.size);
    expect(s.size.x).toBeCloseTo(P.size / 2);
    const u = (s.mesh.material as THREE.ShaderMaterial).uniforms;
    expect(u.uMirrorX?.value).toBe(0);
    expect(u.uMode?.value).toBe(0);
    s.dispose();
  });

  it('maps a ray to fractions of the picture, wherever the surface is and however it is turned', () => {
    const s = new TextureSurface('T');
    s.setSource(proceduralSource()); // 12 × 7.5
    s.object.position.set(3, -2, -4);
    s.object.rotation.set(0.3, -0.5, 0.8);
    s.object.scale.setScalar(1.7);
    s.object.updateMatrixWorld();
    const target = s.object.localToWorld(new THREE.Vector3(0.25 * 12, -0.4 * 7.5, 0));
    const origin = new THREE.Vector3(1, 2, 20);
    const ray = new THREE.Ray(origin, target.clone().sub(origin).normalize());
    const out = { x: 0, y: 0 };
    expect(s.localPoint(ray, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.25, 6);
    expect(out.y).toBeCloseTo(-0.4, 6);
    expect(s.within(ray, 0, out)).toBe(true);
    const outside = s.object.localToWorld(new THREE.Vector3(0.5 * 12 + 1, 0, 0));
    const ray2 = new THREE.Ray(origin, outside.clone().sub(origin).normalize());
    // 1 unit past the edge at scale 1.7 = 1.7 scene units: the margin is in scene units.
    expect(s.within(ray2, 1.5, out)).toBe(false);
    expect(s.within(ray2, 1.9, out)).toBe(true);
    s.dispose();
  });

  it('a picture arriving after the surface was switched away is freed at once', () => {
    // Node loads nothing; the contract is that dispose() before load leaves nothing behind.
    const src = imageSource('textures/aurora.svg');
    src.dispose();
    expect(src.texture).toBeNull();
  });

  it('dispose frees the current source, geometry and material', () => {
    const s = new TextureSurface('T');
    const tex = new THREE.Texture();
    const disposeTex = vi.spyOn(tex, 'dispose');
    s.setSource({
      kind: 'snapshot',
      texture: tex,
      aspect: 1.5,
      mirrorX: false,
      version: 1,
      dispose: () => tex.dispose(),
    });
    const geo = vi.spyOn(s.mesh.geometry, 'dispose');
    const mat = vi.spyOn(s.mesh.material as THREE.Material, 'dispose');
    s.dispose();
    expect(disposeTex).toHaveBeenCalled();
    expect(geo).toHaveBeenCalled();
    expect(mat).toHaveBeenCalled();
  });
});
