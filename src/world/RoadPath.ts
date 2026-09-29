import { mulberry32, range, type Rng } from '../core/math';
import type { MapSpec } from '../data/maps';
import * as THREE from 'three';

/**
 * Infinite seeded road centre line. Curvature and grade are defined by random
 * control points interpolated with a C1 smooth (cosine) blend, then integrated,
 * so heading/position/elevation are smooth and continuous at every chunk seam.
 * Samples are generated lazily ahead at fixed spacing DS.
 */
export const DS = 2;
const S0 = -600; // first sample s

export interface Frame {
  x: number; y: number; z: number;
  heading: number; // radians, 0 = +z
  k: number; // curvature (1/m), + = turns left
  grade: number; // dy/ds
}

export class RoadPath {
  private xs: number[] = [];
  private ys: number[] = [];
  private zs: number[] = [];
  private hs: number[] = [];
  private ks: number[] = [];
  private gs: number[] = [];
  private rngC: Rng;
  private rngG: Rng;
  private cPts: { s: number; v: number }[] = [];
  private gPts: { s: number; v: number }[] = [];

  constructor(private map: MapSpec) {
    this.rngC = mulberry32(map.seed);
    this.rngG = mulberry32(map.seed * 31 + 7);
    this.cPts.push({ s: S0, v: 0 }, { s: 150, v: 0 }); // straight start
    this.gPts.push({ s: S0, v: 0 }, { s: 150, v: 0 });
    this.xs.push(0); this.zs.push(S0); this.ys.push(0); this.hs.push(0);
    this.ks.push(0); this.gs.push(0);
  }

  private ctrl(pts: { s: number; v: number }[], s: number, gen: () => { s: number; v: number }) {
    while (pts[pts.length - 1].s < s + 1) pts.push(gen());
    // binary-ish search from end (queries are mostly near the frontier)
    let i = pts.length - 2;
    while (i > 0 && pts[i].s > s) i--;
    const a = pts[i], b = pts[i + 1];
    const t = (s - a.s) / (b.s - a.s);
    const u = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
    return a.v + (b.v - a.v) * u;
  }

  private genCurve = () => {
    const m = this.map, r = this.rngC;
    const last = this.cPts[this.cPts.length - 1];
    const len = range(r, m.curveSeg[0], m.curveSeg[1]);
    let v = r() < m.straightChance ? 0 : range(r, -1, 1) * m.maxCurv;
    if (Math.abs(v) < m.maxCurv * 0.3 && v !== 0) v = Math.sign(v) * m.maxCurv * 0.3;
    return { s: last.s + len, v };
  };
  private genGrade = () => {
    const m = this.map, r = this.rngG;
    const last = this.gPts[this.gPts.length - 1];
    // keep absolute height bounded: steer grade back toward zero height
    const h = this.ys[this.ys.length - 1];
    const bias = Math.max(-0.6, Math.min(0.6, -h / 60)) * m.maxGrade;
    return { s: last.s + range(r, m.gradeSeg[0], m.gradeSeg[1]), v: Math.max(-m.maxGrade, Math.min(m.maxGrade, range(r, -1, 1) * m.maxGrade + bias)) };
  };

  private ensure(s: number) {
    const need = Math.ceil((s - S0) / DS) + 2;
    while (this.xs.length < need) {
      const i = this.xs.length - 1;
      const sm = S0 + (i + 0.5) * DS;
      const k = this.ctrl(this.cPts, sm, this.genCurve);
      const g = this.ctrl(this.gPts, sm, this.genGrade);
      const h = this.hs[i] + k * DS; // heading
      const hm = (this.hs[i] + h) / 2;
      this.xs.push(this.xs[i] + Math.sin(hm) * DS);
      this.zs.push(this.zs[i] + Math.cos(hm) * DS);
      this.ys.push(this.ys[i] + g * DS);
      this.hs.push(h);
      this.ks.push(k);
      this.gs.push(g);
    }
  }

  frame(s: number, out: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 }): Frame {
    this.ensure(s + DS * 2);
    const f = Math.max(0, (s - S0) / DS);
    const i = Math.floor(f), t = f - i;
    const L = (a: number[]) => a[i] + (a[i + 1] - a[i]) * t;
    out.x = L(this.xs); out.y = L(this.ys); out.z = L(this.zs);
    out.heading = L(this.hs); out.k = L(this.ks); out.grade = L(this.gs);
    return out;
  }

  /** World position of road coordinate (s,d) at lateral offset d (+ = right) and height offset h. */
  toWorld(s: number, d: number, h: number, out: THREE.Vector3, f: Frame = this.frame(s)) {
    // right vector R = (-cos θ, sin θ)
    out.set(f.x - Math.cos(f.heading) * d, f.y + h, f.z + Math.sin(f.heading) * d);
    return out;
  }
}

const pf: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
/** Project a world point to road coordinates near sGuess (Newton-style refinement). */
export function projectToRoad(path: RoadPath, p: THREE.Vector3, sGuess: number) {
  let s = sGuess;
  for (let i = 0; i < 4; i++) {
    path.frame(s, pf);
    const dx = p.x - pf.x, dz = p.z - pf.z;
    s += dx * Math.sin(pf.heading) + dz * Math.cos(pf.heading);
  }
  path.frame(s, pf);
  const d = -(p.x - pf.x) * Math.cos(pf.heading) + (p.z - pf.z) * Math.sin(pf.heading);
  return { s, d, y: pf.y };
}
