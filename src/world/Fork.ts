import * as THREE from 'three';
import { RoadPath, projectToRoad, type Frame } from './RoadPath';
import type { Layout, MapSpec } from '../data/maps';
import { smoothstep } from '../core/math';
import { TRAFFIC_COLORS, TRAFFIC_TYPES, type TrafficType } from '../vehicles/Factory';

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
/** the new highway's road beyond the bridge's west end (on the ground, out into the fog) */
const WEST_ROAD = 450;
/** the bridge's west approach: from the deck down to the ground */
const WEST_SLOPE = 140;
/** deck cars ride the new highway east of the join (while it is not the player's road) out to here */
const DECK_EAST = 650;

/** a car on the new highway outside the simulated road: over the bridge, or ahead on the branch the player is not on */
export interface DeckCar { t: number; d: number; v: number; dir: 1 | -1; lane: number; type: TrafficType; color: number; obj: THREE.Object3D }

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
  /** x (m along the ramp) where the ramp has pulled clear of the highway's wall: before it the two are joined (wall sunk, you can cross) */
  sepX = 0;

  constructor(readonly main: RoadPath, readonly map: MapSpec, readonly layout: Layout, readonly sF: number, roadMat?: THREE.Material) {
    const L = layout;
    this.dC = L.laneCenter(4) - L.laneWidth / 2;
    // the other lanes open out right where the ramp becomes the new highway's right lane (the bridge deck ends at that line)
    this.uA = sF + JOIN_H2 - 4; this.uB = sF + JOIN_H2 + 4;
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
    const E = L.roadHalfWidth - 1;
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
    this.sepX = JOIN_H2;
    for (let i = 0; i < this.mIn.length; i++) if (this.mIn[i] > E + 2.2) { this.sepX = i * STEP; break; }
    this.buildSeams();
    this.buildBridge(roadMat);
  }

  /** climb of the ramp above the old road's level at x metres along it */
  rise(x: number) { return this.H * smoothstep(COMMIT_X + 20, TURN[1] - 40, x) * (1 - smoothstep(JOIN_H2 + 260, JOIN_H2 + 560, x)); }

  private build() {
    const { main, sF, layout: L } = this;
    main.frame(sF, fr);
    // the branch's lane 4 starts right outside the main shoulder: its centre line sits that far left of it
    const rampC = L.laneCenter(4) + L.laneWidth + 0.1;
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
      // props and far ground (well beyond the road's right edge) are not part of the taper
      if (x >= TAPER || (!terrain && d > this.dC + 12)) return d;
      return terrain ? (x < 0 ? this.dC : this.dC + (d - this.dC) * (x >= TAPER - 8 ? 1 : 0)) : this.dC + (d - this.dC) * smoothstep(0, TAPER, x);
    }
    const edge = this.layout.roadHalfWidth - 1;
    // the ground beside the new highway's left edge travels with that edge as it opens out (it is not stretched across the lanes)
    if (terrain && d <= -edge + 0.001) return this.dC + (-edge - this.dC) * this.unfold(s) + (d + edge);
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
        if (db <= (this.unfold(p.s) > 0.02 ? dm : 0.5)) { lim = Math.max(E + 2, d); break; }
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
        if (dm <= lo - d) { lim = Math.min(lo - 2, d); break; }
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
  /** how far the new highway stands above the old road's level here (the retaining walls beside it are this tall) */
  raised(s: number) { return this.rise(s - this.sF); }
  /** branch ground beside the raised ramp and road lies at the old road's level, below its retaining walls */
  branchLift(s: number, d: number) {
    const r = this.rise(s - this.sF);
    if (r <= 0) return 0;
    const a = Math.abs(d) - (this.layout.roadHalfWidth - 1);
    return -r * smoothstep(1.85, 1.95, a);
  }
  /** main road: keep its right side clear where the ramp tapers out of it */
  taperClear(s: number, d: number) { const x = s - this.sF; return x > -90 && x < TAPER + 30 && d > 0 && d < this.layout.roadHalfWidth + 70; }
  /** main road scenery: is main (s, d) on or right beside the new highway's bridge or its road beyond the bridge */
  onDeck(s: number, d: number) {
    const D = this.deck;
    this.main.toWorld(s, d, 0, v3);
    const px = v3.x - D.ox, pz = v3.z - D.oz;
    const t = px * D.fx + pz * D.fz, l = px * D.rx + pz * D.rz;
    return t > D.tWest - 20 && t < 30 && l > D.dLo - 14 && l < D.dHi + 14;
  }
  /** main road: the right barrier is open where the ramp touches the highway */
  mainBarrierDrop(s: number) {
    const x = s - this.sF;
    if (x < -8 || x > this.sepX + 18) return 0;
    return -7 * Math.min(1, smoothstep(-8, 0, x) * (1 - smoothstep(this.sepX + 4, this.sepX + 16, x)));
  }
  /** branch: its median barrier (the ramp's inner rail while folded) is sunk where the ramp still touches the highway */
  branchMedianDrop(s: number) {
    const x = s - this.sF;
    const joined = x < this.sepX + 10 ? -7 * (1 - smoothstep(this.sepX - 4, this.sepX + 10, x)) : 0;
    // the ramp's left barrier ends just before the join; the highway's own median starts right after
    const wedge = -7 * smoothstep(this.uA - 10, this.uA - 4, s) * (1 - smoothstep(this.uB + 4, this.uB + 10, s));
    return Math.min(joined, wedge);
  }
  /** branch: while the left side opens out at the join its pieces sweep across the lanes: sink them under the deck */
  wedgeSink(s: number, d: number) { return s > this.uA - 1 && s < this.uB + 1 && d < this.dC - 0.05 ? -7 : 0; }
  /** branch coordinates: lowest drivable d at s (the folded left side is not there yet) */
  branchMin(s: number) { return this.fold(s, this.layout.playerMin); }

  /**
   * The new highway west of where the ramp joins it: a straight deck back over the old road, an earth ramp down to the
   * ground on the far side and the road carrying on from there. Its eastbound side has four lanes: the ramp comes in
   * alongside as the fifth (the right lane) at the join. Everything is placed along the deck line: t metres from the
   * join (negative = west), d across it in the new highway's coordinates.
   */
  deck = { ox: 0, oz: 0, y: 0, fx: 0, fz: 0, rx: 0, rz: 0, heading: 0, yRoad: 0, groundRoad: 0, t0: 0, t1: 12, tSlope: 0, tWest: 0, dLo: 0, dHi: 0 };
  private buildBridge(roadMat?: THREE.Material) {
    const L = this.layout, E = L.roadHalfWidth - 1, M = L.medianHalf;
    const b = this.branch, sJ = this.sF + JOIN_H2;
    b.frame(sJ, fr);
    const fx = Math.sin(fr.heading), fz = Math.cos(fr.heading);
    const rx = -Math.cos(fr.heading), rz = Math.sin(fr.heading);
    const o = b.toWorld(sJ, 0, 0, new THREE.Vector3());
    const yRoad = o.y - 0.02; // a hair under the branch's own surface where the two overlap at the join
    // distance back from the join to the old road's centre line, along the deck
    const cx = this.main.frame(this.sX);
    const back = (o.x - cx.x) * fx + (o.z - cx.z) * fz;
    const t1 = 12, t0 = -(back + E + 150); // past the join a little: it covers the strip where the new highway's left side opens out
    const ground = cx.y, groundRoad = ground + 0.3; // city ground stands about 0.25 m above the road level
    const tSlope = t0 - WEST_SLOPE, tWest = tSlope - WEST_ROAD;
    const eR = this.dC - 0.15; // right edge of the eastbound side (four lanes); the ramp is the fifth
    const dLo = -(E + 1.6), dHi = eR + 0.5;
    this.deck = { ox: o.x, oz: o.z, y: o.y, fx, fz, rx, rz, heading: fr.heading, yRoad, groundRoad, t0, t1, tSlope, tWest, dLo, dHi };
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
    const WS = dHi - dLo, dS = (dLo + dHi) / 2;
    /** carriageways (with lane markings), median strip and barrier for a straight section from tA (height yA) to tB (yB) */
    const surface = (tA: number, tB: number, yA: number, yB: number) => {
      const run = tB - tA, len = Math.hypot(run, yB - yA), pitch = -Math.atan2(yB - yA, run);
      const tm = (tA + tB) / 2, ym = (yA + yB) / 2;
      if (roadMat) {
        for (const [d0, d1] of [[-E, -M], [M, eR]] as const) {
          const w = d1 - d0;
          const geo = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2);
          const uv = geo.attributes.uv as THREE.BufferAttribute;
          const pos = geo.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) {
            // local +x is the road's left once yawed; u runs from the median edge (0) to the outer edge (1)
            const dd = (d0 + d1) / 2 - pos.getX(i);
            uv.setXY(i, (Math.abs(dd) - M) / (E - M), pos.getZ(i) / 12);
          }
          put(geo, roadMat, tm, (d0 + d1) / 2, ym, pitch);
        }
      }
      put(new THREE.BoxGeometry(2 * M, 0.06, len), dark, tm, 0, ym - 0.01, pitch);
      put(new THREE.BoxGeometry(0.7, 0.95, len), concrete, tm, 0, ym + 0.46, pitch);
    };
    // the deck: slab, road, parapets (the right one stops where the ramp comes in alongside)
    const len = t1 - t0, tm = (t0 + t1) / 2;
    put(new THREE.BoxGeometry(WS, 1.3, len), concrete, tm, dS, yRoad - 0.7);
    surface(t0, t1, yRoad, yRoad);
    put(new THREE.BoxGeometry(0.4, 1.1, len), concrete, tm, -(E + 1.0), yRoad + 0.55);
    const rEnd = t1 - 60;
    put(new THREE.BoxGeometry(0.4, 1.1, rEnd - t0), concrete, (t0 + rEnd) / 2, eR + 0.3, yRoad + 0.55);
    // the west approach: an earth ramp between retaining walls, then the road on the ground
    const drop = yRoad - 0.05 - (ground - 0.5);
    const prof = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(WEST_SLOPE, 0), new THREE.Vector2(WEST_SLOPE, drop), new THREE.Vector2(0, groundRoad - 0.05 - (ground - 0.5))]);
    const wedge = new THREE.ExtrudeGeometry(prof, { depth: WS, bevelEnabled: false }).translate(0, 0, -WS / 2).rotateY(-Math.PI / 2);
    put(wedge, concrete, tSlope, dS, ground - 0.5);
    surface(tSlope, t0, groundRoad, yRoad);
    for (const [d, a2, b2] of [[-(E + 1.0), tSlope, t0], [eR + 0.3, tSlope, t0]] as const) {
      const run = b2 - a2, rise = yRoad - groundRoad;
      put(new THREE.BoxGeometry(0.4, 1.1, Math.hypot(run, rise)), concrete, (a2 + b2) / 2, d, (groundRoad + yRoad) / 2 + 0.55, -Math.atan2(rise, run));
    }
    surface(tWest, tSlope, groundRoad, groundRoad);
    // piers: never on the old road's lanes
    const pier = new THREE.BoxGeometry(1.7, 1, 1.7).translate(0, 0.5, 0);
    for (let t = t0 + 12; t < -10; t += 28) {
      for (const d of [-E * 0.55, E * 0.55]) {
        v3.set(o.x + fx * t + rx * d, 0, o.z + fz * t + rz * d);
        const p = projectToRoad(this.main, v3, this.sX);
        if (Math.abs(p.d) > M - 0.2 && Math.abs(p.d) < E + 2.5) continue;
        const mesh = put(pier, concrete, t, d, ground - 0.5);
        mesh.scale.y = yRoad - 1.35 - (ground - 0.5);
      }
    }
    this.fillDeck();
  }

  /** height of the new highway's surface at deck position t (west of the join) */
  private deckY(t: number) {
    const D = this.deck;
    if (t >= D.t0) return D.yRoad;
    if (t >= D.tSlope) return D.groundRoad + ((t - D.tSlope) / (D.t0 - D.tSlope)) * (D.yRoad - D.groundRoad);
    return D.groundRoad;
  }

  // ---------------- traffic on the new highway outside the simulated road ----------------
  /** cars over the bridge (both ways), and on the new highway east of the join while the player is not on it */
  deckCars: DeckCar[] = [];
  private nextIn = new Map<string, number>();
  private newDeckCar(t: number, dir: 1 | -1, lane: number, v: number, type?: TrafficType, color?: number): DeckCar {
    const L = this.layout;
    let ty = type ?? TRAFFIC_TYPES[Math.floor(Math.random() * TRAFFIC_TYPES.length)];
    if (!type && ty === 'schoolbus' && Math.random() < 0.8) ty = 'sedan';
    const col = color ?? (ty === 'schoolbus' ? 0xf2b400 : TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)]);
    const c: DeckCar = { t, d: dir > 0 ? L.laneCenter(lane) : -L.laneCenter(lane), v, dir, lane, type: ty, color: col, obj: new THREE.Object3D() };
    this.deckCars.push(c);
    return c;
  }
  /** the flow speed of a deck lane (left lanes run faster, like the real traffic) */
  private laneSpeed(flow: number, lane: number) { return flow * (1.06 - lane * 0.035) * (0.93 + Math.random() * 0.1); }
  /** start with the bridge already busy */
  private fillDeck(flow = 27) {
    const D = this.deck;
    for (const [dir, lanes] of [[1, 4], [-1, 5]] as const) {
      for (let l = 0; l < lanes; l++) {
        for (let t = D.tWest + Math.random() * 120; t < DECK_EAST; t += 70 + Math.random() * 160) this.newDeckCar(t, dir, l, this.laneSpeed(flow, l));
      }
    }
  }
  /**
   * Move the deck cars. `taken`: the player is on the new highway, so it is simulated east of the join and deck cars
   * hand over to the real traffic there (`handIn`, true once taken over); real oncoming cars come back to the deck
   * through `adoptOncoming`.
   */
  updateDeck(dt: number, flow: number, taken: boolean, handIn: (c: DeckCar, s: number) => boolean) {
    const D = this.deck, sJ = this.sF + JOIN_H2;
    const cars = this.deckCars;
    // follow the car ahead in the lane (no overtaking on the deck)
    for (const c of cars) {
      let gap = Infinity, vA = c.v;
      for (const o of cars) {
        if (o === c || o.dir !== c.dir || o.lane !== c.lane) continue;
        const g2 = (o.t - c.t) * c.dir;
        if (g2 > 0 && g2 < gap) { gap = g2; vA = o.v; }
      }
      if (gap < 26) c.v = Math.min(c.v, vA * 0.98);
      c.t += c.v * c.dir * dt;
    }
    // hand over, retire, and feed new cars in at the far ends
    this.deckCars = cars.filter((c) => {
      // (handIn says no while the player is right where the car would appear: it stays a deck car a little longer)
      if (taken && c.dir > 0 && c.t >= 6) return !handIn(c, sJ + c.t);
      if (taken && c.dir < 0 && c.t > 12) return !handIn(c, sJ + c.t);
      return c.dir > 0 ? c.t < DECK_EAST : c.t > D.tWest - 5;
    });
    for (const [dir, lanes] of [[1, 4], [-1, 5]] as const) {
      if (dir < 0 && taken) continue; // the real oncoming traffic feeds the deck now
      for (let l = 0; l < lanes; l++) {
        const key = `${dir}:${l}`;
        const left = (this.nextIn.get(key) ?? 0) - dt;
        this.nextIn.set(key, left);
        if (left > 0) continue;
        const t = dir > 0 ? D.tWest : DECK_EAST;
        if (this.deckCars.some((c) => c.dir === dir && c.lane === l && Math.abs(c.t - t) < 40)) continue;
        this.newDeckCar(t, dir, l, this.laneSpeed(flow, l));
        this.nextIn.set(key, (70 + Math.random() * 170) / flow);
      }
    }
    // place them
    for (const c of this.deckCars) {
      if (c.t <= D.t1) {
        c.obj.position.set(D.ox + D.fx * c.t + D.rx * c.d, this.deckY(c.t), D.oz + D.fz * c.t + D.rz * c.d);
        const slope = c.t > D.tSlope && c.t < D.t0 ? (D.yRoad - D.groundRoad) / (D.t0 - D.tSlope) : 0;
        c.obj.rotation.set(-Math.atan(slope) * c.dir, D.heading + (c.dir < 0 ? Math.PI : 0), 0, 'YXZ');
      } else {
        this.branch.frame(sJ + c.t, fr);
        this.branch.toWorld(sJ + c.t, c.d, 0, c.obj.position, fr);
        c.obj.rotation.set(-Math.atan(fr.grade) * c.dir, fr.heading + (c.dir < 0 ? Math.PI : 0), 0, 'YXZ');
      }
    }
  }
  /** a real oncoming car reaching the join carries on west over the bridge as a deck car */
  adoptOncoming(s: number, lane: number, v: number, type: TrafficType, color: number) {
    this.newDeckCar(s - (this.sF + JOIN_H2), -1, lane, v, type, color);
  }
}
