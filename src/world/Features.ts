import type { Layout, MapSpec } from '../data/maps';
import { mulberry32, smoothstep, type Rng } from '../core/math';
import { FORK_SPAN, type Fork } from './Fork';

/**
 * Gas stations along the road, in road coordinates (s along, d across, + = right).
 *
 * Highways get an off ramp: a lane peels away from the right shoulder, runs past the pumps behind a grass island, and
 * merges back onto the highway. Backroads get a paved pull in lot on the right. Stations come every 2 to 3 miles (the
 * gap is random each time), and the first one can be placed where the run starts.
 */
export interface Station { s0: number; ramp: boolean }

export const RAMP_LEN = 520;
export const LOT_LEN = 200;
const LANE_W = 5.2;
const OUT = 13; // how far the ramp lane swings out from the shoulder

export class Features {
  stations: Station[] = [];
  /** city only: where forks leave the highway (every 4 to 5 miles) */
  forkS: number[] = [];
  private nextFork = Infinity;
  /** the fork currently being driven through (its geometry shapes the main road around it) */
  fork: Fork | null = null;
  private rng: Rng;
  private rngF: Rng;
  private nextS: number;
  readonly ramp: boolean;
  /** inner edge of the paved road on the right (shoulder edge / verge edge) */
  readonly edge: number;

  constructor(public map: MapSpec, public layout: Layout, firstStation: number | null) {
    this.rng = mulberry32((map.seed * 13 + 5) >>> 0);
    this.ramp = map.road === 'highway';
    this.edge = this.ramp ? layout.playerMax : layout.softMax;
    this.rngF = mulberry32((map.seed * 29 + 3) >>> 0);
    if (map.id === 'city') this.nextFork = 2000 + this.rngF() * 1200;
    if (firstStation !== null) { this.stations.push({ s0: firstStation, ramp: this.ramp }); this.nextS = firstStation + this.gap(); }
    else this.nextS = 2200 + this.rng() * 2200;
  }
  /** 2 to 3 miles */
  private gap() { return 3200 + this.rng() * 1650; }
  private ensure(s: number) {
    while (this.nextFork < s + 9000) { this.forkS.push(this.nextFork); this.nextFork += 3400 + this.rngF() * 1400; } // 2 to 3 miles
    while (this.nextS < s + 4000) {
      // a station never sits inside a fork
      const f = this.forkS.find((x) => this.nextS > x - 800 && this.nextS < x + FORK_SPAN + 300);
      if (f !== undefined) { this.nextS = f + FORK_SPAN + 300; continue; }
      this.stations.push({ s0: this.nextS, ramp: this.ramp }); this.nextS += this.gap();
    }
  }
  /** the next fork start after s (Infinity on maps without forks) */
  forkAfter(s: number) { this.ensure(s); return this.forkS.find((x) => x > s) ?? Infinity; }
  /** no overpass across a fork (it would cross the new highway) or a gas station */
  noOverpass(s: number) {
    this.ensure(s);
    // its cross street would run through a gas station
    return this.forkS.some((x) => s > x - 200 && s < x + FORK_SPAN) || this.stations.some((st) => s > st.s0 - 160 && s < st.s0 + this.len(st) + 160);
  }
  len(st: Station) { return st.ramp ? RAMP_LEN : LOT_LEN; }
  /** the station whose stretch of road (plus a margin) contains s */
  at(s: number, margin = 0): Station | undefined {
    this.ensure(s);
    for (const st of this.stations) if (s >= st.s0 - margin && s <= st.s0 + this.len(st) + margin) return st;
    return undefined;
  }
  next(s: number): Station {
    this.ensure(s);
    return this.stations.find((st) => st.s0 + this.len(st) * 0.5 > s)!;
  }
  /** station start positions within [a, b] (for the renderer) */
  between(a: number, b: number) {
    this.ensure(b);
    return this.stations.filter((st) => st.s0 + this.len(st) > a && st.s0 < b);
  }

  // ---------------- ramp (highways) ----------------
  /** ramp lane centre and width at x metres into the station stretch */
  rampLane(x: number) {
    const out = smoothstep(100, 200, x) * (1 - smoothstep(330, 430, x));
    const w = LANE_W * smoothstep(0, 100, x) * (1 - smoothstep(420, RAMP_LEN, x));
    // the lane grows outwards from the shoulder edge (its inner edge stays on the highway while it is joined)
    const inner = this.edge + out * OUT;
    return { c: inner + w / 2, w, inner, outer: inner + w };
  }
  /** the ramp lane touches the highway (no island between): here the barrier is open and you can cross */
  rampJoined(x: number) { return this.rampLane(x).inner <= this.edge + 0.4; }

  // ---------------- lot (backroads) ----------------
  lotWidth(x: number) { return 14 * smoothstep(0, 40, x) * (1 - smoothstep(160, LOT_LEN, x)); }

  // ---------------- queries used by the world, physics and props ----------------
  /** right hand barrier hidden (sunk into the ground) here: the ramp openings */
  barrierDrop(s: number) {
    const fk = this.fork && this.fork.state !== 'branch' ? this.fork.mainBarrierDrop(s) : 0;
    if (fk) return fk;
    const st = this.at(s, 5);
    if (!st || !st.ramp) return 0;
    const x = s - st.s0;
    // open over the joined parts of the ramp, closing smoothly at both ends of each opening
    // open wherever the lane still overlaps the wall (its inner edge within about two metres of it): tied to the lane
    // itself, so the wall can never stand in the lane however the ramp is shaped
    const clear = smoothstep(this.edge + 2.4, this.edge + 3.6, this.rampLane(x).inner);
    return -7 * smoothstep(-6, 0, x) * (1 - smoothstep(RAMP_LEN, RAMP_LEN + 6, x)) * (1 - clear);
  }
  /** 0..1: how much the ground right of the road is flattened to road level (station area) */
  flatten(s: number, d: number) {
    if (d < 0) return 0;
    const st = this.at(s, 40);
    if (!st) return 0;
    const x = s - st.s0, L = this.len(st);
    const along = smoothstep(-40, 0, x) * (1 - smoothstep(L, L + 40, x));
    const reach = st.ramp ? this.edge + OUT + 34 : this.edge + 36;
    return along * (1 - smoothstep(reach, reach + 25, d));
  }
  /** keep scenery (buildings, trees, rocks, fences) out of the station area */
  noProps(s: number, d: number) {
    if (d < 0) return false;
    const st = this.at(s, 45);
    if (!st) return false;
    return d < (st.ramp ? this.edge + OUT + 40 : this.edge + 42);
  }
  /** backroad lot: paved, not grass */
  paved(s: number, d: number) {
    const st = this.at(s);
    if (!st || st.ramp) return false;
    return d > 0 && d < this.edge + this.lotWidth(s - st.s0);
  }
  /**
   * Where the player can be (raw extents, before the vehicle's half width) at s for a vehicle currently at d.
   * null = the normal road limits.
   */
  limits(s: number, d: number, lo: number, hi: number): { lo: number; hi: number } | null {
    const st = this.at(s);
    if (!st) return null;
    const x = s - st.s0;
    if (!st.ramp) return { lo, hi: Math.max(hi, this.edge + this.lotWidth(x)) };
    const r = this.rampLane(x);
    if (r.w < 0.5) return null;
    if (this.rampJoined(x)) return { lo, hi: Math.max(hi, r.outer) };
    // separated by the island: on whichever side the vehicle already is
    return d > hi + 0.5 ? { lo: r.inner, hi: r.outer } : null;
  }
  /** the pump lane: driving through here fills the tank */
  inRefuel(s: number, d: number) {
    const st = this.at(s);
    if (!st) return false;
    const x = s - st.s0;
    if (st.ramp) { const r = this.rampLane(x); return x > 180 && x < 335 && Math.abs(d - r.c) < 3.8; }
    return x > 45 && x < 155 && d > this.edge + 0.5 && d < this.edge + 13.5;
  }
  /** where a run that starts at a station puts the car (x into the stretch, d) */
  startPose(st: Station) {
    if (st.ramp) { const x = 230; return { x, d: this.rampLane(x).c }; }
    return { x: 70, d: this.edge + 6.5 };
  }
}
