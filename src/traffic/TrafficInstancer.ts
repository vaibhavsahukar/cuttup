import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildTrafficModel, trafficDims, TRAFFIC_SHAPES, type TrafficType } from '../vehicles/Factory';

/**
 * Draws all live traffic with GPU instancing: per vehicle type one instanced body (paint colour per
 * car via instance colour), one instanced wheel set, and instanced lamps whose per-instance colour
 * switches brake lights and indicators. Draw calls stay constant however many cars are on the road.
 */
interface TypeBatch { body: THREE.InstancedMesh; wheels?: THREE.InstancedMesh; head?: THREE.InstancedMesh; tail?: THREE.InstancedMesh; sigL: THREE.InstancedMesh; sigR: THREE.InstancedMesh; n: number; size: { length: number; width: number; height: number } }

const CAP = 96;
const TAIL_ON = new THREE.Color(3, 0.15, 0.12), TAIL_OFF = new THREE.Color(0.45, 0.03, 0.03);
const SIG_ON = new THREE.Color(3, 1.6, 0.1), SIG_OFF = new THREE.Color(0.3, 0.16, 0.02);
const HEAD = new THREE.Color(1.6, 1.6, 1.5);
const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const m4 = new THREE.Matrix4(), lm = new THREE.Matrix4(), col = new THREE.Color();

export class TrafficInstancer {
  root = new THREE.Group();
  private batches = new Map<TrafficType, TypeBatch>();

  constructor() {
    for (const type of Object.keys(TRAFFIC_SHAPES) as TrafficType[]) this.batches.set(type, this.build(type));
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cap: number, colored: boolean) {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.count = 0;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colored) im.setColorAt(0, new THREE.Color(1, 1, 1));
    this.root.add(im);
    return im;
  }

  private build(type: TrafficType): TypeBatch {
    // a reference build in white paint: instance colour then tints the paint per car
    const model = buildTrafficModel(type, 0xffffff);
    model.root.updateMatrixWorld(true);
    const body = this.inst(model.body.geometry, model.body.material as THREE.Material, CAP, true);
    // wheels: merge the four wheel meshes into one geometry (keeps rubber / metal groups)
    let wheels: THREE.InstancedMesh | undefined;
    const wg: THREE.BufferGeometry[] = [];
    let wmat: THREE.Material | THREE.Material[] | undefined;
    for (const w of model.wheels) {
      const mesh = w.spin.children[0] as THREE.Mesh;
      mesh.updateMatrixWorld(true);
      wg.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      wmat = mesh.material;
    }
    if (wg.length) wheels = this.inst(mergeGeometries(wg, true)!, wmat!, CAP, false);
    const lamp = (meshes: THREE.Mesh[]) => (meshes.length ? this.inst(meshes[0].geometry, lampMat, CAP, true) : undefined);
    const box = new THREE.BoxGeometry(0.08, 0.045, 0.03);
    return {
      body, wheels, head: lamp(model.heads), tail: lamp(model.brake),
      sigL: this.inst(box, lampMat, CAP * 2, true), sigR: this.inst(box, lampMat, CAP * 2, true),
      n: 0, size: trafficDims(type),
    };
  }

  begin() { for (const b of this.batches.values()) b.n = 0; }

  /** add one car this frame (root = its world transform) */
  add(type: TrafficType, root: THREE.Object3D, color: number, braking: boolean, sigLeft: boolean, sigRight: boolean) {
    const b = this.batches.get(type)!;
    if (b.n >= CAP) return;
    root.updateMatrix();
    const i = b.n++;
    b.body.setMatrixAt(i, root.matrix);
    b.body.setColorAt(i, col.setHex(color));
    b.wheels?.setMatrixAt(i, root.matrix);
    if (b.head) { b.head.setMatrixAt(i, root.matrix); b.head.setColorAt(i, HEAD); }
    if (b.tail) { b.tail.setMatrixAt(i, root.matrix); b.tail.setColorAt(i, braking ? TAIL_ON : TAIL_OFF); }
    const { length: L, width: W, height: H } = b.size;
    for (const [im, sx, on] of [[b.sigL, 1, sigLeft], [b.sigR, -1, sigRight]] as const) {
      for (const [k, sz] of [[0, 1], [1, -1]] as const) {
        m4.multiplyMatrices(root.matrix, lm.makeTranslation(sx * W * 0.4, H * 0.45, sz * (L / 2 - 0.04)));
        im.setMatrixAt(i * 2 + k, m4);
        im.setColorAt(i * 2 + k, on ? SIG_ON : SIG_OFF);
      }
    }
  }

  end() {
    for (const b of this.batches.values()) {
      for (const im of [b.body, b.wheels, b.head, b.tail]) {
        if (!im) continue;
        im.count = b.n;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
      for (const im of [b.sigL, b.sigR]) { im.count = b.n * 2; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
  }
}
