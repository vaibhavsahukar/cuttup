import * as THREE from 'three';
import { RoadPath, type Frame } from './RoadPath';
import { Ribbon, outline, type ProfilePt } from './Ribbon';
import type { MapSpec, Layout } from '../data/maps';
import { highwayTexture, backroadTexture, concreteTexture, windowTextures } from './Textures';
import * as P from './Props';
import { mulberry32, noise2, hash2, smoothstep, clamp, range, type Rng } from '../core/math';

export const CHUNK = 64;
const ROWS = 17;

class PropPool {
  mesh: THREE.InstancedMesh;
  private cur = 0;
  private end = 0;
  private static zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public slots: number, public cap: number, colored = false) {
    this.mesh = new THREE.InstancedMesh(geo, mat, slots * cap);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < slots * cap; i++) this.mesh.setMatrixAt(i, PropPool.zero);
    if (colored) for (let i = 0; i < slots * cap; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  begin(slot: number) { this.cur = slot * this.cap; this.end = this.cur + this.cap; }
  add(m: THREE.Matrix4, c?: THREE.Color) {
    if (this.cur >= this.end) return false;
    this.mesh.setMatrixAt(this.cur, m);
    if (c && this.mesh.instanceColor) this.mesh.setColorAt(this.cur, c);
    this.cur++;
    return true;
  }
  finish() {
    while (this.cur < this.end) this.mesh.setMatrixAt(this.cur++, PropPool.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Slot {
  index: number;
  group: THREE.Group;
  ribbons: Ribbon[];
  walls: THREE.Object3D[];
  wires?: THREE.LineSegments;
}

export interface Quality { chunksAhead: number; propDensity: number; shadows: boolean }

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const sc = new THREE.Vector3();
const eul = new THREE.Euler();
const col = new THREE.Color();
const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };

export class ChunkManager {
  root = new THREE.Group();
  private slots: Slot[] = [];
  private pools: Record<string, PropPool> = {};
  private behind = 2;
  lampMaterial: THREE.MeshStandardMaterial;
  buildingMaterial?: THREE.MeshStandardMaterial;
  private edge: number;

  constructor(public path: RoadPath, public map: MapSpec, public layout: Layout, public quality: Quality) {
    const nSlots = quality.chunksAhead + this.behind + 1;
    const hw = map.road === 'highway';
    this.edge = layout.roadHalfWidth - 1;
    this.lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
    const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const pool = (name: string, geo: THREE.BufferGeometry, cap: number, mat: THREE.Material = vcMat, colored = false) => {
      const p = new PropPool(geo, mat, nSlots, cap, colored);
      p.mesh.castShadow = quality.shadows;
      p.mesh.receiveShadow = false;
      this.pools[name] = p;
      this.root.add(p.mesh);
      return p;
    };
    const dens = quality.propDensity;
    if (map.id === 'city') {
      const win = windowTextures();
      const bm = new THREE.MeshStandardMaterial({ map: win.map, emissiveMap: win.emissive, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.2 });
      bm.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
          vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec2 fuv = abs(normal.x) > 0.5 ? uv * isc.zy : (abs(normal.z) > 0.5 ? uv * isc.xy : vec2(0.02, 0.0));
          fuv /= vec2(28.0, 112.0);
          vMapUv = fuv; vEmissiveMapUv = fuv;`);
      };
      this.buildingMaterial = bm;
      pool('building', new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), Math.ceil(14 * Math.max(0.6, dens)), bm, true);
      pool('streetlight', P.streetLightGeo(), 2);
      pool('lamp', P.lampHeadGeo(), 2, this.lampMaterial);
      pool('overpass', P.overpassGeo(2 * layout.roadHalfWidth + 8), 1);
      pool('sign', P.signGeo(), 1);
    } else if (map.id === 'country') {
      pool('barn', P.barnGeo(), 2);
      pool('house', P.houseGeo(), 2);
      pool('pole', P.powerPoleGeo(), 1);
      pool('tree', P.broadleafGeo(), Math.ceil(16 * dens), vcMat, true);
      pool('bale', P.hayBaleGeo(), 6);
      pool('sign', P.signGeo(), 1);
    } else {
      pool('conifer', P.coniferGeo(), Math.ceil(70 * dens), vcMat, true);
      pool('tree', P.broadleafGeo(), Math.ceil(14 * dens), vcMat, true);
      pool('rock', P.rockGeo(), 8, vcMat, true);
    }

    // ---- ribbon materials ----
    const roadMat = hw
      ? new THREE.MeshStandardMaterial({ map: highwayTexture(layout.medianHalf, layout.roadHalfWidth - 1, [0, 1, 2, 3, 4, 5].map((i) => layout.laneCenter(0) - layout.laneWidth / 2 + i * layout.laneWidth), layout.laneCenter(4) + layout.laneWidth / 2), roughness: 0.92 })
      : new THREE.MeshStandardMaterial({ map: backroadTexture(layout.roadHalfWidth, layout.laneWidth), roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const medianMat = new THREE.MeshStandardMaterial({ color: map.id === 'city' ? 0x55565a : 0x4d6a2c, roughness: 1 });
    const wireMat = new THREE.LineBasicMaterial({ color: 0x222222 });

    for (let i = 0; i < nSlots; i++) {
      const group = new THREE.Group();
      const ribbons: Ribbon[] = [];
      const walls: THREE.Object3D[] = [];
      const add = (r: Ribbon, shadow = false) => { r.mesh.receiveShadow = true; r.mesh.castShadow = shadow; ribbons.push(r); group.add(r.mesh); return r; };
      const E = this.edge;
      if (hw) {
        const M = layout.medianHalf;
        add(new Ribbon([{ d: M, h: 0, u: 0 }, { d: E, h: 0, u: 1 }], ROWS, roadMat));
        add(new Ribbon([{ d: -E, h: 0, u: 1 }, { d: -M, h: 0, u: 0 }], ROWS, roadMat));
        add(new Ribbon([{ d: -M, h: -0.02, u: 0 }, { d: M, h: -0.02, u: 1 }], ROWS, medianMat));
        // jersey barrier
        add(new Ribbon(outline([[-0.4, 0], [-0.3, 0.25], [-0.12, 0.95], [0.12, 0.95], [0.3, 0.25], [0.4, 0]]), ROWS, concrete, { vScale: 4 }), true);
        if (map.id === 'city') {
          const wallL = add(new Ribbon(outline([[0, 0], [0, 4.2], [0.35, 4.2], [0.35, 0]], E + 1.2), ROWS, concrete, { vScale: 4 }), true);
          const wallR = add(new Ribbon(outline([[0, 0], [0, 4.2], [0.35, 4.2], [0.35, 0]], -E - 1.55), ROWS, concrete, { vScale: 4 }), true);
          walls.push(wallL.mesh, wallR.mesh);
        } else {
          const rail: [number, number][] = [[0, 0.55], [0.05, 0.62], [0.02, 0.7], [0.05, 0.78], [0, 0.85]];
          add(new Ribbon(outline(rail, E + 0.2), ROWS, metal, { vScale: 4 }));
          add(new Ribbon(outline(rail, -E - 0.2, true), ROWS, metal, { vScale: 4 }));
        }
      } else {
        add(new Ribbon([{ d: -E, h: 0, u: 0 }, { d: E, h: 0, u: 1 }], ROWS, roadMat));
      }
      // terrain both sides
      const tw = hw ? [0, 2, 6, 12, 22, 36, 55, 80, 115, 160, 220, 300, 400] : [0, 1.2, 2.5, 5, 9, 15, 24, 36, 52, 75];
      const hfn = (s: number, d: number) => this.terrainH(s, d);
      const cfn = (s: number, d: number, h: number, out: THREE.Color) => this.terrainColor(s, d, h, out);
      const right: ProfilePt[] = tw.map((w, j) => ({ d: E + w, h: j === 0 ? -0.03 : 0, u: 0 }));
      const left: ProfilePt[] = tw.slice().reverse().map((w) => ({ d: -E - w, h: 0, u: 0 }));
      left[left.length - 1].h = -0.03;
      add(new Ribbon(right, ROWS, terrainMat, { heightFn: hfn, colorFn: cfn }));
      add(new Ribbon(left, ROWS, terrainMat, { heightFn: hfn, colorFn: cfn }));
      let wires: THREE.LineSegments | undefined;
      if (map.id === 'country') {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 10 * 2 * 3), 3));
        wires = new THREE.LineSegments(g, wireMat);
        wires.frustumCulled = false;
        group.add(wires);
      }
      this.root.add(group);
      this.slots.push({ index: -99999, group, ribbons, walls, wires });
    }
  }

  /** terrain height relative to road height at s; continuous everywhere. */
  terrainH(s: number, d: number) {
    const a = Math.abs(d) - this.edge;
    const seed = this.map.seed;
    if (this.map.id === 'city') return -0.05 + smoothstep(8, 30, a) * 0.3;
    if (this.map.id === 'country') {
      const hills = noise2(s / 260, d / 260, seed) * 26 + noise2(s / 90, d / 90, seed + 3) * 6;
      return -0.05 - smoothstep(0, 5, a) * 0.8 + smoothstep(8, 90, a) * (hills + 4);
    }
    const n = noise2(s / 70, d / 50, seed) * 10 + noise2(s / 23, d / 23, seed + 1) * 2.5;
    return -0.05 - smoothstep(0, 1.6, a) * 0.5 + smoothstep(2.5, 28, a) * (n + 3);
  }

  private terrainColor(s: number, d: number, h: number, out: THREE.Color) {
    const seed = this.map.seed;
    const n = noise2(s / 18, d / 18, seed + 9) * 0.5 + 0.5;
    if (this.map.id === 'city') {
      out.setRGB(0.2 + n * 0.05, 0.2 + n * 0.05, 0.19 + n * 0.04);
      if (Math.abs(d) - this.edge < 5) out.setRGB(0.28, 0.3, 0.2);
    } else if (this.map.id === 'country') {
      const a = Math.abs(d) - this.edge;
      if (a < 10) { out.setRGB(0.3 + n * 0.08, 0.45 + n * 0.08, 0.16); return; }
      const f = hash2(Math.floor(s / 140), Math.floor(d / 90) + seed);
      const stripe = Math.sin(s * 0.6) * 0.03;
      if (f < 0.3) out.setRGB(0.72 + stripe, 0.62 + stripe, 0.3); // wheat
      else if (f < 0.55) out.setRGB(0.3, 0.5 + stripe, 0.15); // pasture
      else if (f < 0.72) out.setRGB(0.42 + stripe, 0.33, 0.22); // ploughed
      else out.setRGB(0.36 + n * 0.1, 0.56, 0.2);
    } else {
      out.setRGB(0.16 + n * 0.06, 0.22 + n * 0.07, 0.1 + n * 0.03);
      if (Math.abs(d) - this.edge < 2.5) out.setRGB(0.35, 0.32, 0.25);
    }
  }

  update(playerS: number) {
    const cur = Math.floor(playerS / CHUNK);
    const lo = cur - this.behind, hi = cur + this.quality.chunksAhead;
    const needed = new Set<number>();
    for (let i = lo; i <= hi; i++) needed.add(i);
    const free: Slot[] = [];
    for (const s of this.slots) { if (!needed.has(s.index)) free.push(s); else needed.delete(s.index); }
    // build nearest missing chunks first; at most 2 per frame to avoid hitches
    const missing = [...needed].sort((a, b) => a - b);
    let built = 0;
    for (const idx of missing) {
      const slot = free.shift();
      if (!slot) break;
      this.build(slot, idx);
      if (++built >= 2 && idx > cur + 1) break;
    }
  }

  private place(pool: PropPool | undefined, s: number, d: number, yaw: number, sx: number, sy: number, sz: number, c?: THREE.Color, yOff = 0) {
    if (!pool) return;
    this.path.frame(s, fr);
    this.path.toWorld(s, d, this.terrainH(s, d) + yOff, v3, fr);
    eul.set(0, fr.heading + yaw, 0);
    q.setFromEuler(eul);
    m4.compose(v3, q, sc.set(sx, sy, sz));
    pool.add(m4, c);
  }

  private build(slot: Slot, index: number) {
    slot.index = index;
    const s0 = index * CHUNK;
    for (const r of slot.ribbons) r.update(this.path, s0, CHUNK);
    const si = this.slots.indexOf(slot);
    const rng = mulberry32(Math.floor(hash2(index, this.map.seed) * 4294967296));
    for (const k in this.pools) this.pools[k].begin(si);
    const E = this.edge;
    const dens = this.quality.propDensity;
    const side = () => (rng() < 0.5 ? -1 : 1);

    if (this.map.id === 'city') {
      const wallsOn = hash2(Math.floor(index / 3), 99) < 0.6;
      for (const w of slot.walls) w.visible = wallsOn;
      const bp = this.pools.building;
      const nb = Math.round(10 * Math.max(0.6, dens));
      for (let i = 0; i < nb; i++) {
        const sd = side();
        const w = range(rng, 14, 38), dep = range(rng, 14, 38);
        const far = rng() < 0.45;
        const d = sd * (E + 10 + w / 2 + (far ? range(rng, 40, 170) : range(rng, 0, 30)));
        const h = far ? range(rng, 40, 190) : range(rng, 12, 60);
        const t = 0.55 + rng() * 0.45;
        col.setRGB(t * range(rng, 0.8, 1), t * range(rng, 0.85, 1), t);
        this.place(bp, s0 + rng() * CHUNK, d, 0, w, h, dep, col, -1);
      }
      for (let k = 0; k < 2; k++) this.place(this.pools.streetlight, s0 + k * 32 + 8, 0, 0, 1, 1, 1);
      for (let k = 0; k < 2; k++) this.place(this.pools.lamp, s0 + k * 32 + 8, 0, 0, 1, 1, 1);
      if (index > 2 && hash2(index, 5) < 0.14 && hash2(index - 1, 5) >= 0.14) this.place(this.pools.overpass, s0 + 32, 0, 0, 1, 1, 1);
      else if (hash2(index, 6) < 0.1) this.place(this.pools.sign, s0 + 20, (E - 4) * 0.5 + 2, 0, 1.3, 1, 1, undefined, 0.2);
    } else if (this.map.id === 'country') {
      for (let k = 0; k < 2; k++) if (rng() < 0.25) {
        const sd = side();
        this.place(this.pools.barn, s0 + rng() * CHUNK, sd * (E + range(rng, 45, 260)), rng() * 6, 1, 1, 1);
      }
      if (rng() < 0.3) this.place(this.pools.house, s0 + rng() * CHUNK, side() * (E + range(rng, 30, 200)), rng() * 6, 1, 1, 1);
      const tp = this.pools.tree;
      const nt = Math.round(10 * dens);
      for (let i = 0; i < nt; i++) {
        const t = 0.8 + rng() * 0.4;
        col.setRGB(t, t * range(rng, 0.9, 1.1), t);
        const sc2 = range(rng, 0.8, 1.6);
        this.place(tp, s0 + rng() * CHUNK, side() * (E + range(rng, 12, 330)), rng() * 6, sc2, sc2, sc2, col);
      }
      if (rng() < 0.4) for (let i = 0; i < 5; i++) this.place(this.pools.bale, s0 + rng() * CHUNK, E + 60 + rng() * 60, rng() * 3, 1, 1, 1);
      // power line: one pole per chunk, wires to the next chunk's pole
      const poleD = E + 14;
      this.place(this.pools.pole, s0 + 10, poleD, 0, 1, 1, 1);
      if (slot.wires) this.buildWires(slot.wires, s0 + 10, s0 + 10 + CHUNK, poleD);
      if (hash2(index, 6) < 0.07) this.place(this.pools.sign, s0 + 20, E - 4, 0, 1.3, 1, 1, undefined, 0.2);
    } else {
      const cp = this.pools.conifer;
      const n = Math.round(60 * dens);
      for (let i = 0; i < n; i++) {
        const sd = side();
        const d = sd * (E + 3.5 + Math.pow(rng(), 1.4) * 70);
        const t = 0.7 + rng() * 0.5;
        col.setRGB(t, t, t);
        const s2 = range(rng, 0.75, 1.7);
        this.place(cp, s0 + rng() * CHUNK, d, rng() * 6, s2, s2 * range(rng, 0.9, 1.3), s2, col, -0.2);
      }
      for (let i = 0; i < Math.round(10 * dens); i++) {
        const t = 0.7 + rng() * 0.5;
        col.setRGB(t * 1.1, t, t * 0.8);
        const s2 = range(rng, 0.8, 1.4);
        this.place(this.pools.tree, s0 + rng() * CHUNK, side() * (E + 4 + rng() * 50), rng() * 6, s2, s2, s2, col, -0.2);
      }
      for (let i = 0; i < 4; i++) {
        col.setRGB(1, 1, 1);
        const s2 = range(rng, 0.5, 2);
        this.place(this.pools.rock, s0 + rng() * CHUNK, side() * (E + 2.5 + rng() * 25), rng() * 6, s2, s2, s2, col, -0.1);
      }
    }
    for (const k in this.pools) this.pools[k].finish();
  }

  private buildWires(line: THREE.LineSegments, sA: number, sB: number, d: number) {
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let k = 0;
    const N = 10;
    for (const off of [-1.4, 0, 1.4]) {
      for (let i = 0; i < N; i++) {
        for (const t of [i / N, (i + 1) / N]) {
          const s = sA + (sB - sA) * t;
          const hA = this.terrainH(s, d);
          this.path.toWorld(s, d + off, 0, a);
          const sag = Math.sin(Math.PI * t) * 1.6;
          // interpolate pole-top heights linearly between endpoints
          this.path.toWorld(sA, d, this.terrainH(sA, d) + 11.6, b);
          const yA = b.y;
          this.path.toWorld(sB, d, this.terrainH(sB, d) + 11.6, b);
          const y = yA + (b.y - yA) * t - sag;
          void hA;
          pos.setXYZ(k++, a.x, y, a.z);
        }
      }
    }
    pos.needsUpdate = true;
  }

  setShadows(on: boolean) {
    for (const k in this.pools) this.pools[k].mesh.castShadow = on;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
export type { Rng };
export const _unused = clamp;
