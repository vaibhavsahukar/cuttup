import * as THREE from 'three';
import { RoadPath, projectToRoad, type Frame } from './RoadPath';
import type { Layout, MapSpec } from '../data/maps';
import { smoothstep } from '../core/math';

/** how long the fork's footprint is (m), counted from where the ramp leaves the shoulder */
export const FORK_SPAN = 1300;
/** past this point on the ramp the choice is made (the world switches to the new highway) */
export const COMMIT_X = 240;
/** the ramp touches the highway (barrier open, you can cross) for this first stretch */
export const JOIN_X = 100;
/** the ramp widens from nothing at the highway's edge to a full lane over this distance */
const TAPER = 110;

/** the ramp: diverge gently, straighten while it climbs, then a right hand loop onto the new highway */
const DIVERGE: [number, number] = [100, 300];
const TURN: [number, number] = [380, 720];
/** where the ramp has turned a full right angle and joins the new highway */
const JOIN_H2 = TURN[1];
/** the new highway's deck clears the old one by this much where it crosses over it */
const CLEARANCE = 8.2;

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const v3 = new THREE.Vector3();
const STEP = 4;

/** a smooth bump of curvature: 0 at a, full by a+e, full until b-e, 0 at b */
const bump = (x: number, a: number, b: number, e: number) => {
  if (x <= a || x >= b) return 0;
  if (x < a + e) return 0.5 - 0.5 * Math.cos(Math.PI * (x - a) / e);
  if (x > b - e) return 0.5 - 0.5 * Math.cos(Math.PI * (b - x) / e);
  return 1;
};
/** integral of bump over its whole length */
const bumpArea = (a: number, b: number, e: number) => b - a - e;

/**
 * A city highway interchange. An exit ramp peels off the right lane of the highway, climbs, and loops right onto a
 * NEW highway that crosses over the old one at a right angle on a bridge. The ramp is the right lane of the new road
 * (its own endless road with its own curves): its other lanes, median and oncoming side are folded onto the ramp until
 * it joins, then unfold. Stay on the main road and you pass under the bridge; take the ramp and, past COMMIT_X, the
 * main road is spliced onto the branch: it becomes the road from then on.
 */
export class Fork {
  readonly branch: RoadPath;
  state: 'open' | 'main' | 'branch' = 'open';
  /** branch lane 4's left edge in branch coordinates: everything left of it is folded onto this line until it unfolds */
  readonly dC: number;
  /** the branch unfolds into a full highway between these branch s values */
  readonly uA: number; readonly uB: number;
  /** main road s where the new highway crosses over it */
  sX = 0;
  /** the bridge carrying the new highway over the old one (world space; the game adds and removes it) */
  readonly bridge = new THREE.Group();
  /** samples along the branch (every STEP m of branch s): where its ramp edges are in MAIN road coordinates */
  private mS: number[] = []; private mIn: number[] = []; private mOut: number[] = []; private mRise: number[] = [];
  /** scenery seams: main road s -> how far right the main road's ground reaches; branch s -> how far left the branch's does */
  private seamM: number[] = []; private seamB: number[] = [];
  private H = CLEARANCE;
  /** after this x the ramp is far off the highway (exiting traffic leaves the main road's books here) */
  readonly releaseX: number;

  constructor(readonly main: RoadPath, readonly map: MapSpec, readonly layout: Layout, readonly sF: number, roadMat?: THREE.Material) {
    const L = layout;
    this.dC = L.laneCenter(4) - L.laneWidth / 2;
    this.uA = sF + JOIN_H2 - 40; this.uB = sF + JOIN_H2 + 120;
    // build once, measure how high the deck sits over the old road, correct the climb and build again
    this.branch = this.build();
    for (let it = 0; it < 2; it++) {
      const gap = this.crossing();
      this.H += CLEARANCE - gap;
      (this as { branch: RoadPath }).branch = this.build();
    }
    this.crossing();
    // where the ramp is, seen from the main road
    let sg = sF;
    let rel = Infinity;
    for (let s = sF; s <= sF + JOIN_H2; s += STEP) {
      this.branch.toWorld(s, this.dC, 0, v3);
      const pin = projectToRoad(main, v3, sg);
      this.branch.toWorld(s, this.fold(s, L.playerMax), 0, v3);
      const pout = projectToRoad(main, v3, pin.s);
      sg = pin.s;
      this.mS.push(pin.s); this.mIn.push(pin.d); this.mOut.push(pout.d); this.mRise.push(this.rise(s - sF));
      if (!isFinite(rel) && pin.d > L.roadHalfWidth + 26) rel = s - sF;
    }
    this.releaseX = isFinite(rel) ? rel : 400;
    this.buildSeams();
    this.buildBridge(roadMat);
  }

  /** climb of the ramp above the old road's level at x metres along it */
  rise(x: number) { return this.H * smoothstep(COMMIT_X + 20, TURN[1] - 40, x) * (1 - smoothstep(JOIN_H2 + 260, JOIN_H2 + 560, x)); }

  private build() {
    const { main, sF, layout: L } = this;
    main.frame(sF, fr);
    // the branch's lane 4 starts right outside the main shoulder: its centre line sits that far left of it
    const rampC = L.playerMax + 0.4 + L.laneWidth / 2;
    const d0 = rampC - L.laneCenter(4);
    main.toWorld(sF, d0, 0, v3, fr);
    const heading0 = fr.heading;
    // relative to the main road: bear right a little (negative curvature), straighten, then a right angle loop
    const thetaD = 0.12, eD = 60, eT = 110;
    const kD = thetaD / bumpArea(DIVERGE[0], DIVERGE[1], eD);
    const kT = (Math.PI / 2 - thetaD) / bumpArea(TURN[0], TURN[1], eT);
    const relK = (x: number) => -kD * bump(x, DIVERGE[0], DIVERGE[1], eD) - kT * bump(x, TURN[0], TURN[1], eT);
    const curve: { s: number; v: number }[] = [];
    // hold the heading relative to the main road exactly: correct for its own bends as they come
    for (let x = 0; x <= 1150; x += 10) curve.push({ s: sF + x, v: (x < JOIN_H2 ? main.frame(sF + Math.min(x, 400)).k : 0) + relK(x) });
    const grade: { s: number; v: number }[] = [];
    for (let x = 0; x <= FORK_SPAN + 400; x += 10) {
      const slope = (this.rise(x + 5) - this.rise(x - 5)) / 10;
      const base = main.frame(sF + x).grade;
      grade.push({ s: sF + x, v: base + slope });
    }
    return new RoadPath({ ...this.map, seed: this.map.seed + 911 }, { s0: sF, x: v3.x, y: v3.y, z: v3.z, heading: heading0, curve, grade });
  }

  /** where the new highway's centre line crosses the main road, and how far above it the deck is there */
  private crossing() {
    const b = this.branch, L = this.layout;
    const sJ = this.sF + JOIN_H2;
    b.frame(sJ, fr);
    const hx = Math.sin(fr.heading), hz = Math.cos(fr.heading);
    const c = b.toWorld(sJ, 0, 0, new THREE.Vector3());
    // walk back along the new highway's line until it is over the main road's centre
    let t = 0, s = this.sF + 400, prev = Infinity;
    for (let i = 0; i < 400; i++) {
      v3.set(c.x - hx * t, 0, c.z - hz * t);
      const p = projectToRoad(this.main, v3, s); s = p.s;
      if (Math.abs(p.d) < 0.5 || (p.d < 0 && prev > 0)) break;
      prev = p.d;
      t += Math.max(0.3, Math.min(8, p.d * 0.8));
    }
    this.sX = s;
    void L;
    return c.y - this.main.frame(s).y;
  }

  /** 0..1: how far the branch has unfolded at branch s */
  unfold(s: number) { return smoothstep(this.uA, this.uB, s); }
  /** branch coordinates: fold everything left of lane 4 onto its left edge, opening out as the branch unfolds */
  fold(s: number, d: number, terrain = false) {
    if (d >= this.dC) {
      // the ramp grows out of the highway's edge as a taper (its ground only appears once it is full width)
      const x = s - this.sF;
      if (x >= TAPER) return d;
      return terrain ? (x < 0 ? this.dC : this.dC + (d - this.dC) * (x >= TAPER - 8 ? 1 : 0)) : this.dC + (d - this.dC) * smoothstep(0, TAPER, x);
    }
    return this.dC + (d - this.dC) * this.unfold(s);
  }
  /** interpolate a main road coordinate table at main road s */
  private lookup(tab: number[], s: number) {
    const a = this.mS;
    if (s <= a[0]) return tab[0];
    if (s >= a[a.length - 1]) return tab[tab.length - 1];
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= s) lo = m; else hi = m; }
    const t = (s - a[lo]) / Math.max(1e-6, a[hi] - a[lo]);
    return tab[lo] + (tab[hi] - tab[lo]) * t;
  }
  /** main road coordinates of the ramp's inner and outer drivable edges at main s */
  rampIn(s: number) { return this.lookup(this.mIn, s); }
  rampOut(s: number) { return this.lookup(this.mOut, s); }

  /**
   * The ground between the two roads is split between them: each road's terrain reaches out until the other road is
   * nearer (where the branch is still folded into a single ramp, the main road's ground runs right up to its edge).
   */
  private buildSeams() {
    const L = this.layout, E = L.roadHalfWidth - 1, b = this.branch, m = this.main;
    const bLo = (sb: number) => this.fold(sb, -E - 1.6), bHi = E + 1.4;
    const bEnd = this.sF + FORK_SPAN + 600;
    let gb = this.sF;
    for (let s = this.sF - 60; s <= this.sF + FORK_SPAN; s += 8) {
      let lim = Infinity;
      for (let d = E + 2; d <= E + 420; d += 5) {
        m.toWorld(s, d, 0, v3);
        const p = projectToRoad(b, v3, gb);
        if (p.s < this.sF || p.s > bEnd) continue;
        if (d === E + 2) gb = p.s;
        const db = p.d > bHi ? p.d - bHi : p.d < bLo(p.s) ? bLo(p.s) - p.d : 0;
        const dm = d - E;
        if (db <= (this.unfold(p.s) > 0.02 ? dm : 0.5)) { lim = Math.max(E + 2, d - (db > 0 ? 2.5 : 5)); break; }
      }
      this.seamM.push(lim);
    }
    let gm = this.sF;
    for (let s = this.sF; s <= this.sF + FORK_SPAN; s += 8) {
      let lim = -Infinity;
      const lo = bLo(s);
      for (let d = lo - 2; d >= lo - 420; d -= 5) {
        b.toWorld(s, d, 0, v3);
        const p = projectToRoad(m, v3, gm);
        if (d === lo - 2) gm = p.s;
        const dm = Math.max(0, Math.abs(p.d) - E);
        if (dm <= lo - d) { lim = Math.min(lo - 2, d + 2.5); break; }
      }
      this.seamB.push(lim);
    }
  }
  private seam(tab: number[], s: number, s0: number, out: number) {
    const i = (s - s0) / 8;
    if (i < 0 || i >= tab.length - 1) return out;
    const a = tab[Math.floor(i)], c = tab[Math.floor(i) + 1];
    if (!isFinite(a) || !isFinite(c)) return isFinite(a) ? a : isFinite(c) ? c : out;
    return a + (c - a) * (i - Math.floor(i));
  }
  /** main road coordinates: how far right the main road's scenery reaches at main s */
  midMain(s: number) { if (s - this.sF < TAPER - 8) return Infinity; return this.seam(this.seamM, s, this.sF - 60, Infinity); }
  /** branch coordinates: how far left the branch's scenery reaches at branch s */
  midBranch(s: number) { return this.seam(this.seamB, s, this.sF, -Infinity); }
  /** main road ground rises to meet the climbing ramp beside it (an embankment) */
  mainLift(s: number, d: number) {
    const x = s - this.sF;
    if (x < 0 || x > JOIN_H2 + 300 || d <= 0) return 0;
    const lim = this.midMain(s);
    if (!isFinite(lim)) return 0;
    // the ramp's rise beside this point of the main road
    const r = this.lookup(this.mRise, s);
    return r * smoothstep(lim - 40, lim - 1, d) * smoothstep(JOIN_X, JOIN_X + 60, x);
  }
  /** branch ground falls away from the raised ramp and road to the old road's level */
  branchLift(s: number, d: number) {
    const r = this.rise(s - this.sF);
    if (r <= 0) return 0;
    const a = Math.abs(d) - (this.layout.roadHalfWidth - 1);
    return -r * smoothstep(3, 45, a);
  }
  /** main road: keep its right side clear where the ramp tapers out of it */
  taperClear(s: number, d: number) { const x = s - this.sF; return x > -90 && x < TAPER + 30 && d > 0 && d < this.layout.roadHalfWidth + 70; }
  /** main road: no scenery under the bridge */
  underBridge(s: number) { return Math.abs(s - this.sX) < 40; }
  /** main road: the right barrier is open where the ramp touches the highway */
  mainBarrierDrop(s: number) {
    const x = s - this.sF;
    if (x < -8 || x > JOIN_X + 12) return 0;
    return -7 * Math.min(1, smoothstep(-8, 0, x) * (1 - smoothstep(JOIN_X - 6, JOIN_X + 8, x)));
  }
  /** branch: its median barrier (the ramp's inner rail while folded) is sunk where the ramp still touches the highway */
  branchMedianDrop(s: number) {
    const x = s - this.sF;
    return x < JOIN_X + 10 ? -7 * (1 - smoothstep(JOIN_X - 4, JOIN_X + 10, x)) : 0;
  }
  /** branch coordinates: lowest drivable d at s (the folded left side is not there yet) */
  branchMin(s: number) { return this.fold(s, this.layout.playerMin); }

  /** the new highway west of where the ramp joins it: a straight bridge back over the old road and down the far side */
  private buildBridge(roadMat?: THREE.Material) {
    const L = this.layout, E = L.roadHalfWidth - 1, M = L.medianHalf;
    const b = this.branch, sJ = this.sF + JOIN_H2;
    b.frame(sJ, fr);
    const fx = Math.sin(fr.heading), fz = Math.cos(fr.heading);
    const rx = -Math.cos(fr.heading), rz = Math.sin(fr.heading);
    const o = b.toWorld(sJ, 0, 0, new THREE.Vector3());
    const yTop = o.y - 0.04;
    // distance back from the join to the far side of the old road
    const cx = this.main.frame(this.sX);
    const back = (o.x - cx.x) * fx + (o.z - cx.z) * fz;
    const t0 = -(back + E + 150), t1 = 140;
    const ground = cx.y;
    const g = this.bridge;
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, t: number, d: number, y: number, pitch = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(o.x + fx * t + rx * d, y, o.z + fz * t + rz * d);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = fr.heading; mesh.rotation.x = pitch;
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8c88, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 1 });
    const len = t1 - t0, tm = (t0 + t1) / 2;
    const W = 2 * E + 3.2;
    // slab, then the two carriageways with lane markings, the median and its barrier, parapets
    put(new THREE.BoxGeometry(W, 1.3, len), concrete, tm, -0.2, yTop - 0.7);
    if (roadMat) {
      for (const side of [1, -1]) {
        const geo = new THREE.PlaneGeometry(E - M, len).rotateX(-Math.PI / 2);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          // u runs from the median edge (0) to the outer edge (1); plane x runs left to right in this frame
          // local +x is the road's left once yawed, so the right carriageway's outer edge is at -x
          const xl = pos.getX(i) / (E - M);
          uv.setXY(i, side > 0 ? 0.5 - xl : 0.5 + xl, pos.getZ(i) / 12);
        }
        put(geo, roadMat, tm, side * (M + E) / 2, yTop + 0.02);
      }
    }
    put(new THREE.BoxGeometry(2 * M, 0.06, len), dark, tm, 0, yTop + 0.01);
    put(new THREE.BoxGeometry(0.7, 0.95, len), concrete, tm, 0, yTop + 0.48);
    for (const d of [-(E + 1.0), E + 0.9]) put(new THREE.BoxGeometry(0.4, 1.1, len), concrete, tm, d, yTop + 0.55);
    // down to the ground on the far side
    const rampLen = 140, drop = yTop - ground + 0.3;
    const pitch = Math.atan2(drop, rampLen);
    put(new THREE.BoxGeometry(W, 1.3, Math.hypot(rampLen, drop)), dark, t0 - rampLen / 2, -0.2, ground + drop / 2 - 0.7, -pitch);
    // piers: never on the old road's lanes
    const pier = new THREE.BoxGeometry(1.7, 1, 1.7).translate(0, 0.5, 0);
    for (let t = t0 + 12; t < -10; t += 28) {
      for (const d of [-E * 0.55, E * 0.55]) {
        v3.set(o.x + fx * t + rx * d, 0, o.z + fz * t + rz * d);
        const p = projectToRoad(this.main, v3, this.sX);
        if (Math.abs(p.d) > M - 0.2 && Math.abs(p.d) < E + 2.5) continue;
        const h = yTop - 1.3 - (ground - 0.5);
        const mesh = put(pier, concrete, t, d, ground - 0.5);
        mesh.scale.y = h;
      }
    }
  }
}
