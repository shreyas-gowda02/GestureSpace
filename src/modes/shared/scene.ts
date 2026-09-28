// Scene-file helpers shared by the experiences (§22): each experience turns its content into plain
// JSON (`SpatialMode.serialize`) and back into an undoable command (`SpatialMode.sceneCommand`).
// Scene data comes from files people import, so everything read back is checked first.

import type * as THREE from 'three';
import type { Command } from '@/core/types';
import { applyPose, clonePose, makePose, readPose, type Pose } from './TwoHandTransform';

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** A pose as 10 plain numbers: position (3), quaternion (4), scale (3). */
export function poseToJson(p: Pose): number[] {
  const q = p.quaternion;
  return [
    p.position.x,
    p.position.y,
    p.position.z,
    q.x,
    q.y,
    q.z,
    q.w,
    p.scale.x,
    p.scale.y,
    p.scale.z,
  ];
}

export const objectPoseToJson = (o: THREE.Object3D): number[] =>
  poseToJson(readPose(o, makePose()));

/**
 * An untrusted pose into `out`: 10 finite numbers, positions within ±1000, scales 0.001–1000, a
 * quaternion that isn't zero (it is normalised). False (and `out` untouched) if it isn't one.
 */
export function poseFromJson(raw: unknown, out: Pose): boolean {
  if (!Array.isArray(raw) || raw.length !== 10) return false;
  const n: number[] = [];
  for (const v of raw as unknown[]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    n.push(v);
  }
  const [px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, qw = 1, sx = 1, sy = 1, sz = 1] = n;
  if (Math.max(Math.abs(px), Math.abs(py), Math.abs(pz)) > 1000) return false;
  if (Math.min(sx, sy, sz) < 0.001 || Math.max(sx, sy, sz) > 1000) return false;
  const len = Math.hypot(qx, qy, qz, qw);
  if (len < 1e-6) return false;
  out.position.set(px, py, pz);
  out.quaternion.set(qx, qy, qz, qw);
  if (Math.abs(len - 1) > 1e-9) out.quaternion.normalize(); // unit already: kept bit for bit
  out.scale.set(sx, sy, sz);
  return true;
}

/**
 * The usual "load" command for an experience whose content is a little state plus the pose of one
 * object: `apply(state)` sets the state; the object goes to `after` (undo: back to where it was).
 */
export function stateCommand<T>(
  object: THREE.Object3D,
  apply: (state: T) => void,
  before: T,
  after: T,
  afterPose: Pose,
): Command {
  const poseBefore = readPose(object, makePose());
  const poseAfter = clonePose(afterPose);
  return {
    label: 'Load scene',
    do: () => {
      apply(after);
      applyPose(object, poseAfter);
    },
    undo: () => {
      apply(before);
      applyPose(object, poseBefore);
    },
  };
}
