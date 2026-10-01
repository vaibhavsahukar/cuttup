import * as THREE from 'three';
import type { RoadPath, Frame } from './RoadPath';

export interface ProfilePt { d: number; h: number; u: number }
export interface RibbonOpts {
  vScale?: number; // metres per texture v unit
  heightFn?: (s: number, d: number) => number;
  colorFn?: (s: number, d: number, h: number, out: THREE.Color) => void;
  /** maps a profile column's d to the real lateral position at s (for strips that wander, like a ramp lane) */
  lateralFn?: (s: number, d: number) => number;
}

const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const VREP = 3072; // v wraps every 3072 m (multiple of chunk length) to keep float precision

/** A pooled strip mesh swept along the road. Vertex count is fixed so the buffers are rewritten in place. */
export class Ribbon {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private uv: Float32Array;
  private col?: Float32Array;

  constructor(public profile: ProfilePt[], public rows: number, material: THREE.Material, public opts: RibbonOpts = {}) {
    const cols = profile.length;
    const n = rows * cols;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.uv = new Float32Array(n * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (opts.colorFn) {
      this.col = new Float32Array(n * 3);
      this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, cc = a + cols, dd = cc + 1;
        idx.push(a, b, cc, b, dd, cc);
      }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false; // chunks are always near the camera; avoids bounds recompute
    this.mesh.matrixAutoUpdate = false;
  }

  update(path: RoadPath, s0: number, len: number) {
    const { rows, profile, opts } = this;
    const cols = profile.length;
    const vs = opts.vScale ?? 12;
    for (let r = 0; r < rows; r++) {
      const s = s0 + (len * r) / (rows - 1);
      path.frame(s, fr);
      const v = (((s % VREP) + VREP) % VREP) / vs;
      const vFix = r === rows - 1 && v === 0 ? VREP / vs : v; // keep last row continuous at wrap
      for (let c = 0; c < cols; c++) {
        const p = profile[c];
        const dd = opts.lateralFn ? opts.lateralFn(s, p.d) : p.d;
        const h = p.h + (opts.heightFn ? opts.heightFn(s, dd) : 0);
        path.toWorld(s, dd, h, tmpV, fr);
        const i = r * cols + c;
        this.pos[i * 3] = tmpV.x; this.pos[i * 3 + 1] = tmpV.y; this.pos[i * 3 + 2] = tmpV.z;
        this.uv[i * 2] = p.u; this.uv[i * 2 + 1] = vFix;
        if (this.col && opts.colorFn) {
          opts.colorFn(s, dd, h, tmpC);
          this.col[i * 3] = tmpC.r; this.col[i * 3 + 1] = tmpC.g; this.col[i * 3 + 2] = tmpC.b;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    if (this.col) this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

/** Build a closed-ish profile for an extruded barrier from (d,h) outline points. */
export function outline(pts: [number, number][], dOffset = 0, mirror = false): ProfilePt[] {
  let acc = 0;
  const out: ProfilePt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    out.push({ d: (mirror ? -pts[i][0] : pts[i][0]) + dOffset, h: pts[i][1], u: acc });
  }
  if (mirror) out.reverse();
  return out;
}
