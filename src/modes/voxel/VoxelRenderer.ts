// Draws the voxel world (§13.2) under the mode's voxelRoot group: one InstancedMesh per material
// (solid / glass / glow) whose capacity doubles on overflow, per-instance colour, and an edge-shaded
// face texture so cubes read clearly over video. Also the ghost voxel / ghost column, the faint grid
// on the active build layer, and the cursor pick target (exact grid ray walk, not a mesh raycast).

import * as THREE from 'three';
import { TUNING } from '@/config/tuning';
import type { Vec3, VoxelMaterial } from '@/core/types';
import { disposeObject3D } from '@/scene/SceneManager';
import type { VoxelGrid, VoxelValue } from './VoxelGrid';
import { makeGridHit, raycastGrid, type GridHit } from './voxelMath';

const V = TUNING.voxel;
export const VOXEL_MATERIALS: readonly VoxelMaterial[] = ['solid', 'glass', 'emissive'];

/** Face texture: white with a darker border, multiplied by each instance's colour. */
function makeEdgeTexture(): THREE.DataTexture {
  const { texSize: n, borderPx: b, borderShade } = V.edge;
  const data = new Uint8Array(n * n * 4);
  const edge = Math.round(255 * borderShade);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const border = x < b || y < b || x >= n - b || y >= n - b;
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = border ? edge : 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Diffuse (Lambert) shading, not PBR: on the user's Intel iGPU at 1600×900, 5,000 voxels cost
 * ~8 ms per frame with Lambert vs ~18 ms with MeshStandardMaterial, and flat-lit faces suit blocks.
 */
function makeMaterial(kind: VoxelMaterial, map: THREE.Texture): THREE.Material {
  switch (kind) {
    case 'solid':
      return new THREE.MeshLambertMaterial({ map });
    case 'glass':
      return new THREE.MeshLambertMaterial({
        map,
        transparent: true,
        opacity: V.materials.glassOpacity,
        depthWrite: false,
      });
    case 'emissive':
      // Unlit: the instance colour at full brightness reads as a glowing block.
      return new THREE.MeshBasicMaterial({ map, toneMapped: false });
  }
}

/** One material's voxels in a single InstancedMesh; removal swaps the last instance in. */
class InstanceBatch {
  mesh: THREE.InstancedMesh;
  private readonly parent: THREE.Object3D;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private readonly keys: number[] = [];
  private readonly slots = new Map<number, number>();
  private dirty = false;

  constructor(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
  ) {
    this.parent = parent;
    this.geometry = geometry;
    this.material = material;
    this.mesh = this.makeMesh(V.initialInstanceCapacity);
    this.mesh.name = name;
    parent.add(this.mesh);
  }

  get count(): number {
    return this.keys.length;
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  add(key: number, matrix: THREE.Matrix4, color: THREE.Color): void {
    if (this.slots.has(key)) {
      this.recolor(key, color);
      return;
    }
    if (this.keys.length >= this.capacity) this.grow();
    const i = this.keys.length;
    this.keys.push(key);
    this.slots.set(key, i);
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    this.mesh.count = this.keys.length;
    this.dirty = true;
  }

  remove(key: number): void {
    const i = this.slots.get(key);
    if (i === undefined) return;
    const last = this.keys.length - 1;
    const lastKey = this.keys[last];
    if (i !== last && lastKey !== undefined) {
      const m = this.mesh.instanceMatrix.array;
      m.copyWithin(i * 16, last * 16, last * 16 + 16);
      const c = this.mesh.instanceColor?.array;
      c?.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.keys[i] = lastKey;
      this.slots.set(lastKey, i);
    }
    this.keys.pop();
    this.slots.delete(key);
    this.mesh.count = this.keys.length;
    this.dirty = true;
  }

  recolor(key: number, color: THREE.Color): void {
    const i = this.slots.get(key);
    if (i === undefined) return;
    this.mesh.setColorAt(i, color);
    this.dirty = true;
  }

  /** Upload changed instance data (once per frame at most). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }

  /** Double the capacity (§13.2): copy instance data into a bigger mesh, free the old buffers. */
  private grow(): void {
    const old = this.mesh;
    const mesh = this.makeMesh(old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    const oldColor = old.instanceColor?.array;
    if (oldColor) mesh.instanceColor?.array.set(oldColor);
    mesh.count = old.count;
    mesh.name = old.name;
    this.parent.add(mesh);
    old.removeFromParent();
    old.dispose();
    this.mesh = mesh;
    this.dirty = true;
  }

  private makeMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Created up front so the shader is compiled with per-instance colour from the first draw.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances move; the whole structure is small
    mesh.raycast = () => {}; // picking walks the grid instead (VoxelPickTarget)
    return mesh;
  }
}

/** Semi-transparent pulsing preview: one cell, or a column of cells (push/pull extrusion). */
class GhostVoxel {
  readonly group = new THREE.Group();
  private readonly fill: THREE.MeshBasicMaterial;
  private readonly lines: THREE.LineBasicMaterial;

  constructor(size: number) {
    const geo = new THREE.BoxGeometry(size * 1.04, size * 1.04, size * 1.04);
    this.fill = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: V.ghost.opacity,
      depthWrite: false,
    });
    this.lines = new THREE.LineBasicMaterial({ transparent: true, opacity: V.ghost.edgeOpacity });
    const box = new THREE.Mesh(geo, this.fill);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.lines);
    for (const o of [box, edges]) o.raycast = () => {};
    box.renderOrder = edges.renderOrder = 10; // after the voxels, so it tints what is behind it
    this.group.add(box, edges);
    this.group.name = 'VoxelGhost';
    this.group.visible = false;
  }

  /** Cells `start + dir × i` for i = 0 … count − 1, in cell units. */
  show(start: Vec3, dir: Vec3 | null, count: number, color: THREE.ColorRepresentation): void {
    const s = V.voxelSize;
    const k = dir ? (count - 1) / 2 : 0;
    const dx = dir?.x ?? 0;
    const dy = dir?.y ?? 0;
    const dz = dir?.z ?? 0;
    this.group.position.set((start.x + dx * k) * s, (start.y + dy * k) * s, (start.z + dz * k) * s);
    const n = Math.max(1, count);
    this.group.scale.set(dx ? n : 1, dy ? n : 1, dz ? n : 1);
    this.fill.color.set(color);
    this.lines.color.set(color);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  animate(now: number): void {
    if (!this.group.visible) return;
    const g = V.ghost;
    this.fill.opacity = g.opacity + g.pulse * Math.sin((now / 1000) * g.pulseHz * Math.PI * 2);
  }
}

/** Faint grid on the active layer's centre plane (§13.3 mechanism 1); flashes when it moves. */
class BuildPlaneGrid {
  readonly lines: THREE.LineSegments;
  private readonly material: THREE.LineBasicMaterial;
  private flashAt = -Infinity;

  constructor(cells: number, size: number) {
    const h = cells / 2;
    const lo = (-h - 0.5) * size;
    const hi = (h - 0.5) * size;
    const pts: number[] = [];
    for (let i = 0; i <= cells; i++) {
      const v = lo + i * size;
      pts.push(v, lo, 0, v, hi, 0, lo, v, 0, hi, v, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.material = new THREE.LineBasicMaterial({
      color: V.grid.color,
      transparent: true,
      opacity: V.grid.opacity,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.raycast = () => {};
    this.lines.name = 'VoxelBuildPlane';
  }

  setLayer(layer: number, now: number): void {
    this.lines.position.z = layer * V.voxelSize;
    this.flashAt = now;
  }

  animate(now: number): void {
    const g = V.grid;
    const t = Math.min(1, Math.max(0, (now - this.flashAt) / g.flashMs));
    this.material.opacity = g.opacity + (g.flashOpacity - g.opacity) * (1 - t) * (1 - t);
  }
}

/**
 * Cursor target for the whole voxel world (§13.6 step 1): instead of raycasting thousands of
 * instances, it walks the ray through the occupancy grid. The RaycastCursor sees an ordinary hit
 * (point, face normal, `gsKind: 'voxel'`); the mode uses `localRay` + `raycastGrid` directly.
 */
export class VoxelPickTarget extends THREE.Object3D {
  private readonly grid: VoxelGrid;
  private readonly occupied: (x: number, y: number, z: number) => boolean;
  private readonly hit: GridHit = makeGridHit();
  private readonly inverse = new THREE.Matrix4();
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly intersection: THREE.Intersection;

  constructor(grid: VoxelGrid) {
    super();
    this.grid = grid;
    this.occupied = (x, y, z) => grid.has(x, y, z);
    this.name = 'VoxelPickTarget';
    this.userData.gsId = 'voxels';
    this.userData.gsKind = 'voxel';
    this.intersection = {
      distance: 0,
      point: new THREE.Vector3(),
      object: this,
      face: { a: 0, b: 0, c: 0, normal: new THREE.Vector3(), materialIndex: 0 },
    };
  }

  /** A world ray in this object's cell units (origin + unit direction, written to `o` / `d`). */
  localRay(ray: THREE.Ray, o: THREE.Vector3, d: THREE.Vector3): void {
    this.updateWorldMatrix(true, false);
    this.inverse.copy(this.matrixWorld).invert();
    o.copy(ray.origin).applyMatrix4(this.inverse).divideScalar(V.voxelSize);
    d.copy(ray.direction).transformDirection(this.inverse);
  }

  pick(ray: THREE.Ray, out: GridHit): GridHit | null {
    this.localRay(ray, this.o, this.d);
    return raycastGrid(this.o, this.d, this.grid.half, this.occupied, out);
  }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const hit = this.pick(raycaster.ray, this.hit);
    if (!hit) return;
    const x = this.intersection;
    x.point
      .copy(this.d)
      .multiplyScalar(hit.t)
      .add(this.o)
      .multiplyScalar(V.voxelSize)
      .applyMatrix4(this.matrixWorld);
    x.distance = raycaster.ray.origin.distanceTo(x.point);
    x.face?.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    intersects.push(x); // reused: the cursor copies what it needs before the next cast
  }
}

/** Mirrors a VoxelGrid into instanced meshes under `root`; owns the ghost and the layer grid. */
export class VoxelRenderer {
  readonly ghost: GhostVoxel;
  readonly buildPlane: BuildPlaneGrid;
  readonly pickTarget: VoxelPickTarget;
  private readonly root: THREE.Group;
  private readonly grid: VoxelGrid;
  private readonly geometry: THREE.BoxGeometry;
  private readonly texture: THREE.DataTexture;
  private readonly materials: Record<VoxelMaterial, THREE.Material>;
  private readonly batches: Record<VoxelMaterial, InstanceBatch>;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(root: THREE.Group, grid: VoxelGrid) {
    this.root = root;
    this.grid = grid;
    const s = V.voxelSize;
    this.geometry = new THREE.BoxGeometry(s, s, s);
    this.texture = makeEdgeTexture();
    const content = new THREE.Group();
    content.name = 'VoxelContent';
    const tex = this.texture;
    this.materials = {
      solid: makeMaterial('solid', tex),
      glass: makeMaterial('glass', tex),
      emissive: makeMaterial('emissive', tex),
    };
    const make = (kind: VoxelMaterial): InstanceBatch =>
      new InstanceBatch(content, this.geometry, this.materials[kind], `Voxels:${kind}`);
    this.batches = { solid: make('solid'), glass: make('glass'), emissive: make('emissive') };
    this.ghost = new GhostVoxel(s);
    this.buildPlane = new BuildPlaneGrid(grid.size, s);
    this.pickTarget = new VoxelPickTarget(grid);
    root.add(content, this.buildPlane.lines, this.ghost.group, this.pickTarget);
    grid.listener = this.onChange;
    grid.forEach((key, value) => this.onChange(key, null, value));
  }

  /** Instances drawn per material (tests / debug). */
  counts(): Record<VoxelMaterial, number> {
    const b = this.batches;
    return { solid: b.solid.count, glass: b.glass.count, emissive: b.emissive.count };
  }

  capacity(kind: VoxelMaterial): number {
    return this.batches[kind].capacity;
  }

  mesh(kind: VoxelMaterial): THREE.InstancedMesh {
    return this.batches[kind].mesh;
  }

  /** Upload this frame's changes and animate the ghost / layer grid. */
  update(now: number): void {
    for (const kind of VOXEL_MATERIALS) this.batches[kind].flush();
    this.ghost.animate(now);
    this.buildPlane.animate(now);
  }

  dispose(): void {
    this.grid.listener = null;
    for (const kind of VOXEL_MATERIALS) {
      this.batches[kind].dispose();
      this.materials[kind].dispose();
    }
    this.geometry.dispose();
    this.texture.dispose();
    this.ghost.group.removeFromParent();
    disposeObject3D(this.ghost.group);
    this.buildPlane.lines.removeFromParent();
    disposeObject3D(this.buildPlane.lines);
    this.pickTarget.removeFromParent();
    this.root.getObjectByName('VoxelContent')?.removeFromParent();
  }

  private readonly onChange = (
    key: number,
    before: VoxelValue | null,
    after: VoxelValue | null,
  ): void => {
    if (before && (!after || after.material !== before.material)) {
      this.batches[before.material].remove(key);
    }
    if (!after) return;
    const g = this.grid;
    const s = V.voxelSize;
    this.color.setHex(after.color);
    if (before && before.material === after.material) {
      this.batches[after.material].recolor(key, this.color);
      return;
    }
    this.matrix.makeTranslation(g.keyX(key) * s, g.keyY(key) * s, g.keyZ(key) * s);
    this.batches[after.material].add(key, this.matrix, this.color);
  };
}
