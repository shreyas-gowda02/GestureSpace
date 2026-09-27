// Filter Lab (§18) and Portal (§19), Phase 10: the preset / world lists, the lens shader wiring,
// and both experiences driven frame by frame with two pinching hands (ModeRig + a real
// TwoHandTracker). The lens's pixel alignment with the background is measured in a real browser
// (see CLAUDE.md D54): it is the same coverUv(screenUv()) the background uses.

import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TUNING } from '@/config/tuning';
import type { FilterUiState, PortalUiState, Vec2 } from '@/core/types';
import type { FilterLabMode } from '@/modes/filter/FilterLabMode';
import {
  FILTER_PRESETS,
  lensContent,
  lensUniforms,
  presetName,
  stepPreset,
} from '@/modes/filter/filters';
import { PORTAL_WORLDS, stepWorld } from '@/modes/portal/portalContent';
import type { PortalMode } from '@/modes/portal/PortalMode';
import { baseContext, ModeRig } from '../fixtures/modeHarness';

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

/** One thumb-pinky tap by one hand. */
function tap(rig: ModeRig, side: 'left' | 'right'): void {
  const g = rig.gestures(side).thumbPinky;
  g.phase = 'active';
  g.justStarted = true;
  rig.step();
  g.justStarted = false;
  g.phase = 'idle';
}

describe('Filter Lab presets (§18.3)', () => {
  it('13 presets with names, cycling both ways', () => {
    expect(FILTER_PRESETS.map((p) => p.id)).toEqual([
      'none',
      'thermal',
      'sketch',
      'pixelate',
      'glitch',
      'red',
      'edge',
      'blur',
      'cartoon',
      'rainbow',
      'invert',
      'rgbSplit',
      'popArt',
    ]);
    expect(stepPreset('none', 1)).toBe('thermal');
    expect(stepPreset('none', -1)).toBe('popArt');
    expect(stepPreset('popArt', 1)).toBe('none');
    expect(presetName('rgbSplit')).toBe('RGB split');
  });

  it('the lens shader has a branch for every preset and reads the camera behind the lens', () => {
    const glsl = lensContent(lensUniforms(null)).glsl;
    for (let k = 1; k < FILTER_PRESETS.length; k++) expect(glsl).toContain(`k == ${k}`);
    expect(glsl).toContain('coverUv(screenUv())'); // same mapping as the camera background
  });
});

function filterRig() {
  const rig = new ModeRig('filter');
  rig.trackTwoHands();
  const mode = rig.mc.activeMode as FilterLabMode;
  const lens = rig.base.scene.getObjectByName('Mode:filter');
  const mesh = lens?.getObjectByName('Mode:filterSurface') as THREE.Mesh | undefined;
  if (!lens || !mesh) throw new Error('lens missing');
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
  const ui = (): FilterUiState | undefined => rig.ui.filter((u) => u.filter).at(-1)?.filter;
  return { rig, mode, lens, uniforms, ui };
}

// The resting lens covers view x ≈ 0.33–0.67, y ≈ 0.38–0.56.
const LENS_L = { x: 0.37, y: 0.47 };
const LENS_R = { x: 0.63, y: 0.47 };

describe('Filter Lab (§18)', () => {
  it('thumb-pinky: the building hand = next, the other = previous; ← / → too; a toast names it', () => {
    const { rig, mode, uniforms, ui } = filterRig();
    expect(ui()).toMatchObject({ preset: 'thermal', source: 'lens', held: false });
    rig.show('left', 0.2, 0.8);
    rig.show('right', 0.8, 0.8);
    rig.step();
    tap(rig, 'right');
    expect(mode.currentPreset).toBe('sketch');
    expect(uniforms.uPreset?.value).toBe(2);
    tap(rig, 'left');
    tap(rig, 'left');
    expect(mode.currentPreset).toBe('none');
    rig.mc.handleAction({ type: 'filterPrev' });
    expect(mode.currentPreset).toBe('popArt');
    rig.mc.handleAction({ type: 'filterNext' });
    rig.mc.handleAction({ type: 'filterPreset', preset: 'glitch' });
    expect(ui()?.preset).toBe('glitch');

    // The toast: the name above the lens, gone after toastMs.
    const texts: string[] = [];
    const c2d = {
      save() {},
      restore() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      stroke() {},
      measureText: (t: string) => ({ width: t.length * 9 }),
      fillText: (t: string) => texts.push(t),
    } as unknown as CanvasRenderingContext2D;
    rig.mc.drawOverlay(c2d);
    expect(texts).toEqual(['Glitch']);
    rig.run(Math.ceil(TUNING.ui.toastMs / (1000 / 60)) + 1);
    rig.mc.drawOverlay(c2d);
    expect(texts).toEqual(['Glitch']);
  });

  it('both hands pinch on the lens: it moves and widens — width only — one undo step', () => {
    const { rig, lens } = filterRig();
    const start = lens.matrixWorld.clone();
    hands(rig, LENS_L, LENS_R, true, 2);
    expect(rig.base.capture.get('twoHand')?.targetId).toBe('filter-lens');
    for (let i = 1; i <= 30; i++) {
      hands(
        rig,
        { x: 0.37 - (0.12 * i) / 30, y: 0.47 },
        { x: 0.63 + (0.12 * i) / 30, y: 0.47 },
        true,
      );
    }
    hands(rig, { x: 0.25, y: 0.47 }, { x: 0.75, y: 0.47 }, true, 20);
    expect(lens.scale.x).toBeCloseTo(0.5 / 0.26, 1);
    expect(lens.scale.y).toBe(1); // a strip: it only gets wider
    hands(rig, { x: 0.25, y: 0.47 }, { x: 0.75, y: 0.47 }, false, 3);
    expect(rig.mc.history?.undoLabel).toBe('Move lens');
    rig.mc.undo();
    expect(lens.matrixWorld.equals(start)).toBe(true);
    rig.mc.resetView();
    expect(rig.mc.history?.canUndo).toBe(false); // already at rest: nothing to undo
  });

  it('sources: live lens, a picture, your own file; a frozen frame needs the camera', () => {
    const { rig, uniforms, ui } = filterRig();
    expect(rig.mc.handleAction({ type: 'filterSource', source: 'frozen' })).toBe(false);
    expect(rig.statuses.at(-1)).toBe('Start the camera first');
    rig.mc.handleAction({ type: 'filterSource', source: 'picture' });
    rig.step();
    expect(ui()?.source).toBe('picture');
    expect(uniforms.uSource?.value).toBe(2);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    rig.mc.handleAction({ type: 'filterFile', url: 'blob:me', name: 'me.png' });
    expect(ui()).toMatchObject({ source: 'file', fileName: 'me.png' });
    rig.mc.handleAction({ type: 'filterSource', source: 'lens' });
    rig.step();
    expect(revoke).toHaveBeenCalledWith('blob:me');
    expect(uniforms.uSource?.value).toBe(0);
    revoke.mockRestore();
  });

  it('the lens follows the camera mapping and the quality setting', () => {
    const { rig, uniforms } = filterRig();
    rig.base.viewport.update(1280, 720, 1000, 800); // a taller window: cover-crop changes
    rig.step();
    const scale = uniforms.uCoverScale?.value as THREE.Vector2;
    expect(scale.x).toBeCloseTo(rig.base.viewport.coverScale.x, 6);
    expect(scale.y).toBeCloseTo(rig.base.viewport.coverScale.y, 6);
    expect(uniforms.uMirror?.value).toBe(1);
    expect(uniforms.uQuality?.value).toBe(1);
    (rig.base.settings as { quality: string }).quality = 'low';
    rig.step();
    expect(uniforms.uQuality?.value).toBe(0);
  });
});

describe('Portal worlds (§19)', () => {
  it('four worlds, cycling both ways', () => {
    expect(PORTAL_WORLDS.map((w) => w.id)).toEqual(['nebula', 'otherWorld', 'inverted', 'picture']);
    expect(stepWorld('nebula', -1)).toBe('picture');
    expect(stepWorld('picture', 1)).toBe('nebula');
  });
});

/** A renderer that records render-target use (the Other World draws off-screen). */
function fakeRenderer() {
  let target: THREE.WebGLRenderTarget | null = null;
  const log: string[] = [];
  return {
    log,
    renderer: {
      getRenderTarget: () => target,
      setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
        target = t;
        log.push(t ? 'target' : 'screen');
      },
      render: () => log.push('render'),
      getPixelRatio: () => 1,
    } as unknown as THREE.WebGLRenderer,
  };
}

function portalRig(withRenderer = false) {
  const fake = fakeRenderer();
  const base = baseContext([], []);
  const statuses: string[] = [];
  const ui: Partial<Record<'portal', PortalUiState>>[] = [];
  const rig = new ModeRig('portal', {
    ...base,
    renderer: withRenderer ? fake.renderer : base.renderer,
    emitStatus: (t) => statuses.push(t),
    publishUi: (id, state) => ui.push({ [id]: state }),
  });
  rig.trackTwoHands();
  const mode = rig.mc.activeMode as PortalMode;
  const portal = rig.base.scene.getObjectByName('Mode:portal');
  const mesh = portal?.getObjectByName('Mode:portalSurface') as THREE.Mesh | undefined;
  if (!portal || !mesh) throw new Error('portal missing');
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
  const lastUi = (): PortalUiState | undefined => ui.filter((u) => u.portal).at(-1)?.portal;
  return { rig, mode, portal, uniforms, statuses, ui: lastUi, log: fake.log };
}

// The portal (shut or open) sits at view x ≈ 0.37–0.63, y ≈ 0.28–0.60.
const P_L = { x: 0.4, y: 0.45 };
const P_R = { x: 0.6, y: 0.45 };

describe('Portal (§19)', () => {
  it('starts shut as a line; the first two-hand pinch opens it, eased, over openMs', () => {
    const { rig, mode, uniforms, statuses, ui } = portalRig();
    rig.step();
    expect(mode.openness).toBe(0);
    expect(uniforms.uOpen?.value).toBe(0);
    expect(statuses.at(-1)).toMatch(/glowing line/);
    hands(rig, P_L, P_R, true, 2);
    expect(rig.base.capture.get('twoHand')?.targetId).toBe('portal');
    const early = mode.openness;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.3);
    hands(rig, P_L, P_R, true, Math.ceil(TUNING.portal.openMs / (1000 / 60)));
    expect(mode.openness).toBe(1);
    expect(ui()).toMatchObject({ open: true, held: true });
  });

  it('Reset brings it back to the middle, shut again; the move is one undo step', () => {
    const { rig, mode, portal } = portalRig();
    hands(rig, P_L, P_R, true, 60);
    for (let i = 1; i <= 20; i++)
      hands(rig, { x: 0.4 + i * 0.005, y: 0.45 }, { x: 0.6 + i * 0.005, y: 0.45 }, true);
    hands(rig, { x: 0.5, y: 0.45 }, { x: 0.7, y: 0.45 }, false, 3);
    expect(portal.position.x).toBeGreaterThan(1);
    rig.mc.resetView();
    expect(portal.position.x).toBe(0);
    expect(mode.openness).toBe(0);
    expect(rig.mc.history?.undoLabel).toBe('Reset portal');
  });

  it('worlds switch by button, ← / → and thumb-pinky', () => {
    const { rig, mode, uniforms } = portalRig();
    rig.show('left', 0.2, 0.8);
    rig.show('right', 0.8, 0.8);
    rig.step();
    tap(rig, 'right');
    expect(mode.worldShown).toBe('otherWorld');
    expect(uniforms.uWorld?.value).toBe(1);
    tap(rig, 'left');
    expect(mode.worldShown).toBe('nebula');
    rig.mc.handleAction({ type: 'filterPrev' });
    expect(mode.worldShown).toBe('picture');
    rig.mc.handleAction({ type: 'portalWorld', world: 'inverted' });
    expect(uniforms.uWorld?.value).toBe(2);
  });

  it('the Other World renders off-screen only while it shows, swings with the portal, frees its target on exit', () => {
    const { rig, mode, portal, log } = portalRig(true);
    rig.mc.handleAction({ type: 'portalWorld', world: 'otherWorld' });
    rig.step();
    rig.mc.render();
    expect(log).toEqual([]); // shut: nothing to see through
    hands(rig, P_L, P_R, true, 60); // opens
    rig.mc.render();
    expect(log).toEqual(['target', 'render', 'screen']);
    expect(mode.worldTarget).not.toBeNull();
    const camX = mode.worldCamera?.position.x ?? 0;
    portal.position.x += 6; // the portal moves right…
    portal.updateMatrixWorld();
    rig.mc.render();
    expect(mode.worldCamera?.position.x ?? 0).toBeLessThan(camX - 1); // …the view swings the other way
    rig.mc.handleAction({ type: 'portalWorld', world: 'nebula' });
    log.length = 0;
    rig.mc.render();
    expect(log).toEqual([]); // not showing: not rendered
    rig.mc.handleAction({ type: 'portalWorld', world: 'otherWorld' });
    rig.mc.render();
    rig.mc.switchTo('voxel');
    expect(mode.worldTarget).toBeNull(); // freed on exit
  });
});
