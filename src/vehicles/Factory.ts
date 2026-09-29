import type { VehicleSpec } from '../data/vehicles';
import type { VehicleModel } from './ModelKit';
import { buildFromShape, getShape } from './ShapeBuilder';
import { buildPanelCar } from './PanelBuilder';

/** cars with hand-made signature details (others get the generic panel build; bikes keep ShapeBuilder) */
export const DESIGNED = new Set(['zr1', 'm4', 'huracan', 'c63', 'civic', 'tesla']);
const build = (id: string, color: number, lite: boolean, shadows: boolean) => {
  const sh = getShape(id)!;
  return sh.bike ? buildFromShape(sh, color, lite, shadows) : buildPanelCar(sh, color, lite, shadows);
};

/**
 * Every vehicle is modelled by the game itself (ShapeBuilder) from measurements taken off the
 * reference models the user supplied (src/data/shapes/*.json). Nothing is loaded at runtime.
 */
export function buildPlayerModel(spec: VehicleSpec, shadows = true): VehicleModel {
  return build(spec.model, spec.color, false, shadows);
}

/** Traffic types -> measured shape ids. */
export const TRAFFIC_SHAPES = {
  sedan: 't_sedan', hatch: 't_hatch', suv: 't_lexus', crossover: 't_crv', pickup: 't_pickup',
  van: 't_van', boxtruck: 't_boxtruck', tesla: 'tesla', civic: 'civic',
} as const;
export type TrafficType = keyof typeof TRAFFIC_SHAPES;
export const TRAFFIC_TYPES = Object.keys(TRAFFIC_SHAPES) as TrafficType[];
/** traffic paint colours (real-world popular car colours) */
export const TRAFFIC_COLORS = [0xe8e8e8, 0x1b1c1e, 0x8f9499, 0x5a6068, 0x9b1b1f, 0x1f3e7a, 0x2c4a33, 0xc9bfa8, 0x6d2a1c, 0xd6d0c4, 0x2f6fa8, 0x3d434b];

export function buildTrafficModel(type: TrafficType, color = 0xffffff, _shadows = false): VehicleModel {
  const m = build(TRAFFIC_SHAPES[type], type === 'boxtruck' ? 0xeeeeee : color, true, false);
  return m;
}
export function trafficDims(type: TrafficType) {
  const s = getShape(TRAFFIC_SHAPES[type])!;
  return { length: s.length, width: s.width, height: s.height };
}

export type CopType = 'cop_basic' | 'cop_charger';
export function buildCopModel(type: CopType): VehicleModel {
  return build(type, type === 'cop_charger' ? 0x16181b : 0x1d1f22, true, false);
}
export function copDims(type: CopType) {
  const s = getShape(type)!;
  return { length: s.length, width: s.width, height: s.height };
}
