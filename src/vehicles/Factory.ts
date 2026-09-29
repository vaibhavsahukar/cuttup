import * as THREE from 'three';
import type { VehicleSpec } from '../data/vehicles';
import type { VehicleModel } from './ModelKit';
import { MAT } from './Materials';
import { glbClone, glbSize } from './GlbLibrary';

/**
 * Every vehicle is an imported model (see GlbLibrary / scripts/process-models.ts), wrapped in the
 * VehicleModel structure the game expects. Brake lights, indicators and headlight lenses are small
 * emissive panels fitted to the model's bounding box so they can be switched per car.
 */
function lightPanels(chassis: THREE.Group, size: THREE.Vector3, bike: boolean) {
  const L = size.z, W = size.x, H = size.y;
  const brake: THREE.Mesh[] = [], sigL: THREE.Mesh[] = [], sigR: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  if (bike) {
    const t = new THREE.Mesh(box(0.1, 0.04, 0.02), MAT.tailOff); t.position.set(0, H * 0.62, -L / 2 + 0.02); brake.push(t);
    for (const sx of [1, -1]) {
      const s = new THREE.Mesh(box(0.04, 0.03, 0.02), MAT.sigOff); s.position.set(sx * 0.1, H * 0.6, -L / 2 + 0.03);
      (sx > 0 ? sigL : sigR).push(s);
    }
  } else {
    const ty = H * (H > 1.7 ? 0.5 : 0.62);
    for (const sx of [1, -1]) {
      const t = new THREE.Mesh(box(W * 0.12, 0.05, 0.02), MAT.tailOff); t.position.set(sx * W * 0.3, ty, -L / 2 + 0.07); brake.push(t);
      const s = new THREE.Mesh(box(0.07, 0.04, 0.02), MAT.sigOff); s.position.set(sx * W * 0.36, ty - 0.08, -L / 2 + 0.08);
      const f = new THREE.Mesh(box(0.06, 0.03, 0.02), MAT.sigOff); f.position.set(sx * W * 0.36, H * 0.42, L / 2 - 0.1);
      (sx > 0 ? sigL : sigR).push(s, f);
    }
  }
  // brake lights sit just behind the model's own tail lamps; slightly inset so they don't float
  for (const m of [...brake, ...sigL, ...sigR, ...heads]) chassis.add(m);
  return { brake, sigL, sigR, heads };
}

function wrap(glbId: string, bike: boolean, color: number): VehicleModel {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  const model = glbClone(glbId);
  const size = glbSize(glbId);
  let lean: THREE.Group | undefined;
  if (bike) { lean = new THREE.Group(); root.add(lean); lean.add(chassis); } else root.add(chassis);
  chassis.add(model);
  // "body" = biggest mesh; the crash code dents its (cloned) geometry
  let body: THREE.Mesh | undefined, best = -1;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const n = m.geometry.attributes.position.count;
    if (n > best) { best = n; body = m; }
  });
  const lights = lightPanels(chassis, size, bike);
  return {
    root, chassis, body: body!, wheels: [],
    brake: lights.brake, sigL: lights.sigL, sigR: lights.sigR, heads: lights.heads,
    length: size.z, width: size.x, height: size.y, color,
    bike: bike ? { lean: lean!, fork: new THREE.Group() } : undefined,
    lod: [],
  };
}

export function buildPlayerModel(spec: VehicleSpec, _shadows = true): VehicleModel {
  return wrap(spec.model, spec.kind === 'bike', spec.color);
}

/** Traffic types -> imported model ids. */
export const TRAFFIC_MODELS = {
  sedan: 't_sedan', hatch: 't_hatch', suv: 't_lexus', crossover: 't_crv', pickup: 't_pickup',
  van: 't_van', boxtruck: 't_boxtruck', tesla: 't_tesla', civic: 't_civic',
} as const;
export type TrafficType = keyof typeof TRAFFIC_MODELS;
export const TRAFFIC_TYPES = Object.keys(TRAFFIC_MODELS) as TrafficType[];
/** kept for API compatibility; imported models keep their own paint */
export const TRAFFIC_COLORS = [0xffffff];

export function buildTrafficModel(type: TrafficType, color = 0xffffff, _shadows = false): VehicleModel {
  const m = wrap(TRAFFIC_MODELS[type], false, color);
  m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  return m;
}
export function trafficDims(type: TrafficType) {
  const s = glbSize(TRAFFIC_MODELS[type]);
  return { length: s.z, width: s.x, height: s.y };
}

export type CopType = 'cop_basic' | 'cop_charger';
export function buildCopModel(type: CopType): VehicleModel {
  const m = wrap(type, false, 0x111111);
  m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  return m;
}
export function copDims(type: CopType) {
  const s = glbSize(type);
  return { length: s.z, width: s.x, height: s.y };
}

/** every model id that must be preloaded before a run */
export const ALL_MODEL_IDS = ['zr1', 'm4', 'huracan', 'c63', 'civic', 'tesla', 'cbr650', ...Object.values(TRAFFIC_MODELS), 'cop_basic', 'cop_charger'];
