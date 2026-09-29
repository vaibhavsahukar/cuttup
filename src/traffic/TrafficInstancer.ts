import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glbClone, glbSize } from '../vehicles/GlbLibrary';
import { TRAFFIC_MODELS, type TrafficType } from '../vehicles/Factory';

/**
 * Draws all live traffic with GPU instancing: one InstancedMesh per (model, material), so the
 * draw-call count no longer grows with the number of cars. Brake lights and indicators are
 * instanced unlit panels whose per-instance colour switches them on and off.
 */
interface Part { mesh: THREE.InstancedMesh }
interface TypeBatch { parts: Part[]; tail: THREE.InstancedMesh; sigL: THREE.InstancedMesh; sigR: THREE.InstancedMesh; n: number; size: THREE.Vector3 }

const CAP = 96;
const TAIL_ON = new THREE.Color(3, 0.1, 0.1), TAIL_OFF = new THREE.Color(0.35, 0.02, 0.02);
const SIG_ON = new THREE.Color(3, 1.6, 0.1), SIG_OFF = new THREE.Color(0.3, 0.16, 0.02);
const lightMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const m4 = new THREE.Matrix4(), lm = new THREE.Matrix4();

export class TrafficInstancer {
  root = new THREE.Group();
  private batches = new Map<TrafficType, TypeBatch>();

  constructor() {
    for (const type of Object.keys(TRAFFIC_MODELS) as TrafficType[]) this.batches.set(type, this.build(type));
  }

  private build(type: TrafficType): TypeBatch {
    const src = glbClone(TRAFFIC_MODELS[type]);
    src.updateMatrixWorld(true);
    // bake every mesh into model space and merge by material
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g.index ? g : g);
    });
    const parts: Part[] = [];
    for (const [mat, geos] of byMat) {
      // geometries must share attribute sets to merge; split into compatible groups
      const groups = new Map<string, THREE.BufferGeometry[]>();
      for (const g of geos) { const key = Object.keys(g.attributes).sort().join(',') + (g.index ? 'i' : 'n'); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(g); }
      for (const list of groups.values()) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false) ?? list[0];
        const mesh = new THREE.InstancedMesh(merged, mat, CAP);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.root.add(mesh);
        parts.push({ mesh });
      }
    }
    const size = glbSize(TRAFFIC_MODELS[type]);
    const panel = (w: number, h: number) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, 0.02), lightMat, CAP * 2);
      im.count = 0; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, TAIL_OFF);
      this.root.add(im);
      return im;
    };
    return { parts, tail: panel(size.x * 0.12, 0.05), sigL: panel(0.07, 0.04), sigR: panel(0.07, 0.04), n: 0, size };
  }

  begin() { for (const b of this.batches.values()) b.n = 0; }

  /** add one car this frame (root = its world transform) */
  add(type: TrafficType, root: THREE.Object3D, braking: boolean, sigLeft: boolean, sigRight: boolean) {
    const b = this.batches.get(type)!;
    if (b.n >= CAP) return;
    root.updateMatrix();
    const i = b.n++;
    for (const p of b.parts) p.mesh.setMatrixAt(i, root.matrix);
    const { x: W, y: H, z: L } = b.size;
    const ty = H * (H > 1.7 ? 0.5 : 0.62);
    for (const [k, sx] of [[0, 1], [1, -1]] as const) {
      m4.multiplyMatrices(root.matrix, lm.makeTranslation(sx * W * 0.3, ty, -L / 2 + 0.07));
      b.tail.setMatrixAt(i * 2 + k, m4);
      b.tail.setColorAt(i * 2 + k, braking ? TAIL_ON : TAIL_OFF);
    }
    m4.multiplyMatrices(root.matrix, lm.makeTranslation(W * 0.36, ty - 0.08, -L / 2 + 0.08));
    b.sigL.setMatrixAt(i * 2, m4); b.sigL.setColorAt(i * 2, sigLeft ? SIG_ON : SIG_OFF);
    m4.multiplyMatrices(root.matrix, lm.makeTranslation(W * 0.36, H * 0.42, L / 2 - 0.1));
    b.sigL.setMatrixAt(i * 2 + 1, m4); b.sigL.setColorAt(i * 2 + 1, sigLeft ? SIG_ON : SIG_OFF);
    m4.multiplyMatrices(root.matrix, lm.makeTranslation(-W * 0.36, ty - 0.08, -L / 2 + 0.08));
    b.sigR.setMatrixAt(i * 2, m4); b.sigR.setColorAt(i * 2, sigRight ? SIG_ON : SIG_OFF);
    m4.multiplyMatrices(root.matrix, lm.makeTranslation(-W * 0.36, H * 0.42, L / 2 - 0.1));
    b.sigR.setMatrixAt(i * 2 + 1, m4); b.sigR.setColorAt(i * 2 + 1, sigRight ? SIG_ON : SIG_OFF);
  }

  end() {
    for (const b of this.batches.values()) {
      for (const p of b.parts) { p.mesh.count = b.n; p.mesh.instanceMatrix.needsUpdate = true; }
      for (const im of [b.tail, b.sigL, b.sigR]) {
        im.count = b.n * 2;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  }
}
