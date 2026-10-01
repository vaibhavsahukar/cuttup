import * as THREE from 'three';
import { RoadPath, projectToRoad, type Frame } from './RoadPath';
import type { Layout, MapSpec } from '../data/maps';
import { smoothstep } from '../core/math';

/** how long the fork's footprint is (m), counted from where the ramp leaves the shoulder */
export const FORK_SPAN = 1300;
/** the branch starts as a single ramp lane and unfolds into a full highway between these distances */
export const UNFOLD_A = 380, UNFOLD_B = 720;
/** past this point on the ramp the choice is made (the world switches to the new highway) */
export const COMMIT_X = 240;
/** the ramp touches the highway (barrier open, you can cross) for this first stretch */
export const JOIN_X = 80;

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const v3 = new THREE.Vector3();
const STEP = 4;

/**
 * A city highway fork. The right lane of a NEW highway (the branch, its own endless road with its own curves) begins
 * just outside the main highway's right shoulder: it peels away as an exit ramp, and once it is well clear its other
 * lanes, median and oncoming carriageway unfold beside it. Stay on the main road and the branch drifts out of sight;
 * take the ramp and, past COMMIT_X, the main road is spliced onto the branch: it becomes the road from then on.
 */
export class Fork {
  readonly branch: RoadPath;
  state: 'open' | 'main' | 'branch' = 'open';
  /** branch lane 4's left edge in branch coordinates: everything left of it is folded onto this line until it unfolds */
  readonly dC: number;
  /** samples along the branch (every STEP m of branch s): where its ramp edges are in MAIN road coordinates */
  private mS: number[] = []; private mIn: number[] = []; private mOut: number[] = []; private mC: number[] = [];

  constructor(readonly main: RoadPath, readonly map: MapSpec, readonly layout: Layout, readonly sF: number) {
    const L = layout;
    this.dC = L.laneCenter(4) - L.laneWidth / 2;
    main.frame(sF, fr);
    // the branch's lane 4 starts right outside the main shoulder: its centre line sits that far left of it
    const rampC = L.playerMax + 0.4 + L.laneWidth / 2;
    const d0 = rampC - L.laneCenter(4);
    main.toWorld(sF, d0, 0, v3, fr);
    // relative to the main road (whose own bends are added in): bear right (negative curvature), then straighten out
    // parallel, then the new highway's own random curves take over
    const k = 1 / 620;
    const rel: [number, number][] = [[0, 0], [70, 0], [230, -k], [330, -k], [490, k * 0.95], [590, k * 0.95], [760, 0], [1150, 0]];
    const relK = (x: number) => {
      for (let i = 0; i < rel.length - 1; i++) if (x <= rel[i + 1][0]) { const t = (x - rel[i][0]) / (rel[i + 1][0] - rel[i][0]); const u = 0.5 - 0.5 * Math.cos(Math.PI * t); return rel[i][1] + (rel[i + 1][1] - rel[i][1]) * u; }
      return 0;
    };
    const curve: { s: number; v: number }[] = [];
    for (let x = 0; x <= 1150; x += 20) curve.push({ s: sF + x, v: main.frame(sF + x).k + relK(x) });
    const grade: { s: number; v: number }[] = [];
    for (let s = sF; s <= sF + FORK_SPAN + 400; s += 60) grade.push({ s, v: main.frame(s).grade });
    this.branch = new RoadPath({ ...map, seed: map.seed + 911 }, {
      s0: sF, x: v3.x, y: v3.y, z: v3.z, heading: fr.heading,
      curve, grade,
    });
    // where the ramp is, seen from the main road
    let sg = sF;
    for (let s = sF; s <= sF + FORK_SPAN; s += STEP) {
      this.branch.toWorld(s, this.dC, 0, v3);
      const pin = projectToRoad(main, v3, sg);
      this.branch.toWorld(s, L.playerMax, 0, v3);
      const pout = projectToRoad(main, v3, pin.s);
      this.branch.toWorld(s, 0, 0, v3);
      const pc = projectToRoad(main, v3, pin.s);
      sg = pin.s;
      this.mS.push(pin.s); this.mIn.push(pin.d); this.mOut.push(pout.d); this.mC.push(pc.d);
    }
  }

  /** 0..1: how far the branch has unfolded at branch s */
  unfold(s: number) { return smoothstep(this.sF + UNFOLD_A, this.sF + UNFOLD_B, s); }
  /** branch coordinates: fold everything left of lane 4 onto its left edge, opening out as the branch unfolds */
  fold(s: number, d: number) {
    if (d >= this.dC) return d;
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
  /** main road coordinate of the branch centre line (how far away the new highway is) */
  branchCentre(s: number) { return this.lookup(this.mC, s); }
  /** main road coordinates: where the two roads' scenery meet (halfway between the main edge and the branch's left edge) */
  midMain(s: number) {
    const x = s - this.sF;
    if (x < -50 || x > FORK_SPAN) return Infinity;
    const L = this.layout;
    const c = this.branchCentre(s);
    const t = this.unfold(s);
    const branchLeft = c + this.dC + (-(L.roadHalfWidth + 2) - this.dC) * t; // left edge of the branch, walls included
    return Math.max(L.roadHalfWidth + 2, (L.roadHalfWidth + branchLeft) / 2);
  }
  /** branch coordinates: the same seam, seen from the branch (so its scenery stops where the main road's starts) */
  midBranch(s: number) {
    const m = this.midMain(s);
    if (!isFinite(m)) return -Infinity;
    return m - this.branchCentre(s);
  }
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
}
