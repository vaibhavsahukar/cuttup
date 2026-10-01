import * as THREE from 'three';
import type { RoadPath, Frame } from './RoadPath';
import { Ribbon, outline } from './Ribbon';
import { Features, RAMP_LEN, LOT_LEN, CHARGER_K, type Station } from './Features';

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const v3 = new THREE.Vector3();

/** "GAS" lettering on a canvas, used by the pylon and the shop */
function label(text: string, bg: string, fg: string, w = 256, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.62)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/**
 * Builds and drops the gas station meshes (ramp or lot surface, rails, canopy, pumps, shop, signs) as the player
 * approaches and leaves each station.
 */
export class StationRenderer {
  root = new THREE.Group();
  private built = new Map<number, THREE.Group>();
  private asphalt = new THREE.MeshStandardMaterial({ color: 0x3b3c3f, roughness: 0.9 });
  private paint = new THREE.MeshBasicMaterial({ color: 0xe9e9e2 });
  private metal = new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
  private white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  private red = new THREE.MeshStandardMaterial({ color: 0xd8262b, roughness: 0.5 });
  /** the electric charger: one pump of every station is green */
  private green = new THREE.MeshStandardMaterial({ color: 0x1fc45a, roughness: 0.5, emissive: 0x0b7a30, emissiveIntensity: 0.5 });
  private dark = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.7 });
  private glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.6 });
  private gasTex = label('GAS', '#d8262b', '#ffffff');
  private exitTex = label('GAS  EXIT  ›', '#1d6b3a', '#ffffff', 512, 128);
  private gasMat = new THREE.MeshStandardMaterial({ map: this.gasTex, emissive: 0xffffff, emissiveMap: this.gasTex, emissiveIntensity: 0.6 });
  private exitMat = new THREE.MeshStandardMaterial({ map: this.exitTex, emissive: 0xffffff, emissiveMap: this.exitTex, emissiveIntensity: 0.25 });

  constructor(public path: RoadPath, public f: Features) {}

  update(playerS: number) {
    const want = this.f.between(playerS - 350, playerS + 1100);
    const keys = new Set(want.map((st) => st.s0));
    for (const [k, g] of this.built) if (!keys.has(k)) { this.root.remove(g); g.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); this.built.delete(k); }
    for (const st of want) if (!this.built.has(st.s0)) { const g = this.build(st); this.built.set(st.s0, g); this.root.add(g); }
  }

  /** a box standing on the road surface at (s, d), turned with the road */
  private box(g: THREE.Group, mat: THREE.Material, s: number, d: number, w: number, h: number, l: number, y = 0) {
    this.path.frame(s, fr);
    this.path.toWorld(s, d, y + h / 2, v3, fr);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.copy(v3); m.rotation.y = fr.heading;
    m.castShadow = true;
    g.add(m);
    return m;
  }

  private build(st: Station) {
    const g = new THREE.Group();
    const F = this.f, s0 = st.s0;
    if (st.ramp) {
      const rows = Math.round(RAMP_LEN / 4) + 1;
      const lane = (s: number) => F.rampLane(s - s0);
      // lane surface, painted edge lines, and a guard rail on the outside (and along the island once it separates)
      const surf = new Ribbon([{ d: 0, h: 0.035, u: 0 }, { d: 1, h: 0.035, u: 1 }], rows, this.asphalt, { lateralFn: (s, t) => { const r = lane(s); return r.inner + t * r.w; } });
      surf.update(this.path, s0, RAMP_LEN);
      const edgeL = new Ribbon([{ d: 0, h: 0.045, u: 0 }, { d: 0.16, h: 0.045, u: 1 }], rows, this.paint, { lateralFn: (s, d) => { const r = lane(s); return r.w < 0.3 ? r.inner : r.outer - 0.35 + d; } });
      edgeL.update(this.path, s0, RAMP_LEN);
      const rail: [number, number][] = [[0, 0.55], [0.05, 0.62], [0.02, 0.7], [0.05, 0.78], [0, 0.85]];
      const outer = new Ribbon(outline(rail), rows, this.metal, { lateralFn: (s, d) => lane(s).outer + 0.25 + d, heightFn: (s) => (lane(s).w < 1 || (s - s0 > 228 && s - s0 < 292) ? -3 : 0) }); // open alongside the pumps
      outer.update(this.path, s0, RAMP_LEN);
      const island = new Ribbon(outline(rail, 0, true), rows, this.metal, { lateralFn: (s, d) => lane(s).inner - 0.25 + d, heightFn: (s) => (F.rampJoined(s - s0) || lane(s).w < 1 ? -3 : 0) });
      island.update(this.path, s0, RAMP_LEN);
      for (const r of [surf, edgeL, outer, island]) { r.mesh.receiveShadow = true; g.add(r.mesh); }
      // the forecourt: canopy over the pump lane, pumps on an island to the right of it, the shop behind
      const xs = 260, c = lane(s0 + xs).c;
      this.forecourt(g, s0 + xs, c, 1);
      this.pylon(g, s0 + 140, lane(s0 + 140).outer + 5);
      // advance sign beside the highway, past the barrier
      const sg = this.box(g, this.exitMat, s0 - 420, F.edge + 6, 7, 1.8, 0.15, 4.4);
      sg.rotation.y += Math.PI; // face oncoming drivers
      this.box(g, this.dark, s0 - 420, F.edge + 3.6, 0.15, 6, 0.15);
      this.box(g, this.dark, s0 - 420, F.edge + 8.4, 0.15, 6, 0.15);
    } else {
      const rows = Math.round(LOT_LEN / 4) + 1;
      const lot = new Ribbon([{ d: 0, h: 0.03, u: 0 }, { d: 1, h: 0.03, u: 1 }], rows, this.asphalt, { lateralFn: (s, t) => F.edge - 0.4 + t * (F.lotWidth(s - s0) + 0.4) });
      lot.update(this.path, s0, LOT_LEN);
      lot.mesh.receiveShadow = true;
      g.add(lot.mesh);
      this.forecourt(g, s0 + 100, F.edge + 4.5, 1);
      this.pylon(g, s0 + 18, F.edge + 16);
    }
    return g;
  }

  /** canopy, pumps and shop around a pump lane centred at lateral c */
  private forecourt(g: THREE.Group, s: number, c: number, side: number) {
    const L = 46;
    // canopy roof with a lit underside, on four posts
    this.box(g, this.white, s, c + side * 3.2, 13, 0.8, L, 5.6);
    this.box(g, this.red, s, c + side * 3.2, 13.1, 0.35, L + 0.1, 6.05);
    this.box(g, this.glow, s, c + side * 3.2, 11, 0.05, L - 4, 5.57);
    for (const ds of [-L / 2 + 2, L / 2 - 2]) for (const dd of [-2.2, 8.6]) this.box(g, this.white, s + ds, c + side * dd, 0.45, 5.6, 0.45);
    // pump island and pumps
    this.box(g, this.white, s, c + side * 4.3, 1.6, 0.25, L - 8);
    for (let k = -1.5; k <= 1.5; k++) {
      this.box(g, k === CHARGER_K ? this.green : this.red, s + k * 9, c + side * 4.3, 0.8, 1.7, 1.1, 0.25);
      this.box(g, this.glow, s + k * 9, c + side * 4.3, 0.82, 0.35, 0.6, 1.35);
    }
    // shop with a lit window and the brand on the roof edge
    this.box(g, this.white, s + 4, c + side * 19, 11, 4.6, 22);
    this.box(g, this.glow, s + 4, c + side * 13.4, 0.1, 1.8, 16, 0.9);
    // flat on the shop front, facing the road (it used to be turned edge on and sank into the wall)
    this.box(g, this.gasMat, s + 4, c + side * 13.3, 0.12, 1.3, 5, 3.4);
  }

  /** tall roadside pylon with the GAS panel, visible from far off */
  private pylon(g: THREE.Group, s: number, d: number) {
    this.box(g, this.dark, s, d, 0.5, 13, 0.5);
    const p = this.box(g, this.gasMat, s, d, 0.4, 3, 4.2, 12);
    p.rotation.y += Math.PI / 2;
    const q = this.box(g, this.gasMat, s, d, 0.4, 3, 4.2, 12);
    q.rotation.y -= Math.PI / 2;
  }

  dispose() { for (const g of this.built.values()) g.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); this.built.clear(); }
}
