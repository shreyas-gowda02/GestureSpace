import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { HandFrame, TrackedHand, Vec3 } from '@/core/types';
import { CaptureManager } from '@/spatial/CaptureManager';
import { CoordinateMapper, InteractionPlane, RaycastCursor } from '@/spatial/CoordinateMapper';
import { DepthEstimator, StepQuantizer } from '@/spatial/DepthEstimator';
import { ViewportMapper } from '@/spatial/ViewportMapper';
import { INDEX_TIP, makeLandmarkBuffer } from '@/vision/landmarks';

/** 1280×720 video in a 1280×720 view, default camera at z = 20 looking down −Z. */
function setup() {
  const viewport = new ViewportMapper();
  viewport.update(1280, 720, 1280, 720);
  const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 1000);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const coords = new CoordinateMapper(viewport, camera, { width: 1280, height: 720 });
  return { viewport, camera, coords };
}

/** A hand whose (view-space) index fingertip is at (x, y). */
function handAt(x: number, y: number, palmScale = 0.16, tipZ = 0): TrackedHand {
  const lms: Vec3[] = makeLandmarkBuffer();
  lms[INDEX_TIP] = { x, y, z: tipZ };
  return {
    side: 'right',
    score: 1,
    rawLandmarks: lms,
    landmarks: lms,
    triggerLandmarks: lms,
    palmScale,
    bbox: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
    lostForMs: 0,
  };
}

describe('CoordinateMapper', () => {
  it('maps the view centre to NDC (0, 0) and screen corners to ±1', () => {
    const { coords } = setup();
    const n = coords.viewToNdc({ x: 0.5, y: 0.5 }, { x: 9, y: 9 });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(0);
    expect(coords.screenToNdc({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: -1, y: 1 });
    expect(coords.ndcToScreen({ x: 1, y: -1 }, { x: 0, y: 0 })).toEqual({ x: 1280, y: 720 });
  });

  it('rays hit the z = 0 plane and project back to the same screen point', () => {
    const { coords } = setup();
    const plane = new InteractionPlane();
    const p = new THREE.Vector3();
    const ndc = { x: 0.4, y: -0.3 };
    expect(coords.ndcToPlane(ndc, plane.plane, p)).toBe(true);
    expect(p.z).toBeCloseTo(0);
    const s = coords.worldToScreen(p, { x: 0, y: 0 });
    const back = coords.screenToNdc(s, { x: 0, y: 0 });
    expect(back.x).toBeCloseTo(0.4);
    expect(back.y).toBeCloseTo(-0.3);
  });

  it('camera-facing plane through a point contains that point', () => {
    const { camera } = setup();
    const plane = new InteractionPlane();
    const pt = new THREE.Vector3(2, -1, 5);
    plane.setThrough(pt, camera);
    expect(plane.plane.distanceToPoint(pt)).toBeCloseTo(0);
    expect(plane.plane.normal.z).toBeCloseTo(1);
  });
});

describe('RaycastCursor', () => {
  it('hits a registered target (with its gsId), else the interaction plane', () => {
    const { coords } = setup();
    const cursors = new RaycastCursor(coords);
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
    box.userData.gsId = 'box';
    box.updateMatrixWorld();
    cursors.addTarget(box);

    const frame: HandFrame = { timestamp: 0, inferenceTimestamp: 0, right: handAt(0.5, 0.5) };
    const c = cursors.update(frame).right;
    expect(c?.hit?.kind).toBe('object');
    expect(c?.hit?.objectId).toBe('box');
    expect(c?.hit?.point.z).toBeCloseTo(2); // front face of the box
    expect(c?.hit?.normal?.z).toBeCloseTo(1);

    frame.right = handAt(0.9, 0.1); // far corner: misses the box
    const miss = cursors.update(frame).right;
    expect(miss?.hit?.kind).toBe('plane');
    expect(miss?.hit?.objectId).toBeUndefined();
    expect(miss?.hit?.point.z).toBeCloseTo(0);

    cursors.clearTargets();
    frame.right = handAt(0.5, 0.5);
    expect(cursors.update(frame).right?.hit?.kind).toBe('plane');
    expect(cursors.update({ timestamp: 0, inferenceTimestamp: 0 }).right).toBeUndefined();
  });

  it('the cursor sits exactly under the fingertip on screen', () => {
    const { coords } = setup();
    const cursors = new RaycastCursor(coords);
    const c = cursors.update({
      timestamp: 0,
      inferenceTimestamp: 0,
      right: handAt(0.25, 0.8),
    }).right;
    const hit = c?.hit?.point;
    expect(hit).toBeDefined();
    const s = coords.worldToScreen(hit ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo(0.25 * 1280, 0);
    expect(s.y).toBeCloseTo(0.8 * 720, 0);
  });
});

describe('StepQuantizer', () => {
  it('ignores the dead zone and needs hysteresis + dwell to step', () => {
    const q = new StepQuantizer(0.1, 0.02, 100, 0.03);
    expect(q.update(0.02, 0)).toBe(0); // dead zone
    expect(q.update(0.06, 0)).toBe(0); // past 0.05 but not by the 0.02 hysteresis
    expect(q.update(0.08, 0)).toBe(0); // clear intent… dwell starts
    expect(q.update(0.08, 60)).toBe(0);
    expect(q.update(0.08, 100)).toBe(1); // held 100 ms → step
    expect(q.update(0.045, 150)).toBe(1); // back inside hysteresis band: stays
    q.update(-0.2, 200);
    expect(q.update(-0.2, 300)).toBe(-2); // big move lands on the right step after dwell
  });

  it('a brief overshoot shorter than the dwell never steps', () => {
    const q = new StepQuantizer(0.1, 0.02, 100, 0.03);
    q.update(0.2, 0);
    q.update(0.2, 50);
    expect(q.update(0.01, 80)).toBe(0);
    expect(q.update(0.2, 120)).toBe(0); // dwell restarted
  });
});

describe('DepthEstimator', () => {
  it('moving closer (bigger palm) gives a positive signal and depth steps', () => {
    const d = new DepthEstimator();
    d.update(handAt(0.5, 0.5, 0.16), 0); // baseline
    let s = 0;
    for (let t = 16; t < 2000; t += 16) s = d.update(handAt(0.5, 0.5, 0.24), t); // +50 % palm
    expect(s).toBeGreaterThan(0.25);
    expect(d.steps).toBeGreaterThanOrEqual(2);
  });

  it('a finger "poke" toward the camera (tip z decreases) adds to the signal', () => {
    const d = new DepthEstimator();
    d.update(handAt(0.5, 0.5, 0.16, 0), 0);
    let s = 0;
    for (let t = 16; t < 1500; t += 16) s = d.update(handAt(0.5, 0.5, 0.16, -0.05), t);
    expect(s).toBeGreaterThan(0.05);
  });

  it('losing the hand or resetting the baseline starts from zero again', () => {
    const d = new DepthEstimator();
    d.update(handAt(0.5, 0.5, 0.16), 0);
    for (let t = 16; t < 1000; t += 16) d.update(handAt(0.5, 0.5, 0.24), t);
    expect(d.update(undefined, 1000)).toBe(0);
    expect(d.update(handAt(0.5, 0.5, 0.24), 1016)).toBeCloseTo(0);
    d.resetBaseline();
    expect(d.update(handAt(0.5, 0.5, 0.3), 1032)).toBeCloseTo(0);
  });
});

describe('CaptureManager', () => {
  it('binds a hand to one target and notifies the captor on release', () => {
    const cm = new CaptureManager();
    const reasons: string[] = [];
    expect(cm.capture('right', 'box', 0, (r) => reasons.push(r))).toBe(true);
    expect(cm.capture('right', 'other', 1)).toBe(false); // hand already busy
    expect(cm.isCaptured('box')).toBe(true);
    expect(cm.describe()).toEqual(['right → box']);
    cm.release('right');
    expect(reasons).toEqual(['released']);
    expect(cm.count).toBe(0);
  });

  it('swapSides: whatever a hand holds moves with it when left/right are renamed (D42)', () => {
    const cm = new CaptureManager();
    const got: string[] = [];
    cm.capture('right', 'box', 0, (r) => got.push(r));
    cm.capture('twoHand', 'panel', 0);
    cm.swapSides();
    expect(cm.get('right')).toBeUndefined();
    expect(cm.get('left')?.targetId).toBe('box');
    expect(cm.get('left')?.key).toBe('left');
    expect(cm.get('twoHand')?.targetId).toBe('panel'); // two-hand captures are side-less
    cm.release('left');
    expect(got).toEqual(['released']); // the original captor still gets its release
  });

  it('releaseAll / releaseTarget deliver the reason to every captor', () => {
    const cm = new CaptureManager();
    const got: string[] = [];
    cm.capture('left', 'a', 0, (r) => got.push(`a:${r}`));
    cm.capture('twoHand', 'b', 0, (r) => got.push(`b:${r}`));
    cm.releaseTarget('b', 'lost');
    cm.releaseAll('modeSwitch');
    expect(got).toEqual(['b:lost', 'a:modeSwitch']);
    cm.release('right'); // no-op
    expect(cm.count).toBe(0);
  });
});
