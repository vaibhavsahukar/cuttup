import type { VehicleSpec } from '../data/vehicles';
import type { VehicleModel } from './ModelKit';
import { buildFromShape, getShape } from './ShapeBuilder';
import { buildPanelCar } from './PanelBuilder';
import { buildBike } from './BikeBuilder';
import { buildZ350 } from './Z350Builder';
import { buildC6 } from './C6Builder';
import { buildSchoolBus, BUS_DIMS } from './SchoolBus';

/** cars with hand-made signature details (others get the generic panel build; bikes keep ShapeBuilder) */
export const DESIGNED = new Set(['zr1', 'c8', 'gt3rs', 'urus', 'models', 'z350', 'm4', 'huracan', 'c63', 'civic', 'tesla']);
const build = (id: string, color: number, lite: boolean, shadows: boolean, livery?: 'police', player = false) => {
  const sh = getShape(id)!;
  return sh.bike ? buildFromShape(sh, color, lite, shadows) : buildPanelCar(sh, color, lite, shadows, livery, player);
};

/**
 * Every vehicle is modelled by the game itself (ShapeBuilder) from measurements taken off the
 * reference models the user supplied (src/data/shapes/*.json). Nothing is loaded at runtime.
 */
export function buildPlayerModel(spec: VehicleSpec, shadows = true): VehicleModel {
  if (spec.kind === 'bike') return buildBike(spec.model, spec.color, shadows, undefined, spec.paint);
  if (spec.model === 'z350') return buildZ350(spec.color, shadows);
  if (spec.id === 'zr1') return buildC6(spec.color, shadows);
  return build(spec.model, spec.color, false, shadows, undefined, true);
}

/** Traffic types -> measured shape ids. */
export const TRAFFIC_SHAPES = {
  sedan: 't_sedan', hatch: 't_hatch', suv: 't_lexus', pickup: 't_pickup',
  van: 't_van', boxtruck: 't_boxtruck', schoolbus: 't_boxtruck', tesla: 'tesla', civic: 'civic',
} as const;
export type TrafficType = keyof typeof TRAFFIC_SHAPES;
export const TRAFFIC_TYPES = Object.keys(TRAFFIC_SHAPES) as TrafficType[];
/** traffic paint colours (real-world popular car colours) */
export const TRAFFIC_COLORS = [0xe8e8e8, 0x1b1c1e, 0x8f9499, 0x5a6068, 0x9b1b1f, 0x1f3e7a, 0x2c4a33, 0xc9bfa8, 0x6d2a1c, 0xd6d0c4, 0x2f6fa8, 0x3d434b];

/** full-quality model for any key of the Model Viewer ('v:<vehicle>', 't:<traffic type>', 'c:<cop>') */
export function buildViewerModel(key: string, drivable: (id: string) => VehicleSpec): VehicleModel {
  const [kind, id] = key.split(':');
  if (kind === 'v') return buildPlayerModel(drivable(id), true);
  if (kind === 't') return id === 'schoolbus' ? buildSchoolBus(0xf2b400, true) : build(TRAFFIC_SHAPES[id as TrafficType], id === 'boxtruck' ? 0xeeeeee : 0x8f9499, false, true);
  const cop = id as CopType;
  if (cop === 'cop_moto') return buildBike('cbr650', COP_MOTO_COLOR, true, 'police');
  if (cop === 'cop_samurai') return buildBike('zx6r', COP_MOTO_COLOR, true, 'police');
  return build(COP_SHAPES[cop], COP_COLORS[cop], false, true, 'police');
}

export function buildTrafficModel(type: TrafficType, color = 0xffffff, _shadows = false): VehicleModel {
  if (type === 'schoolbus') return buildSchoolBus(color);
  const m = build(TRAFFIC_SHAPES[type], type === 'boxtruck' ? 0xeeeeee : color, true, false);
  return m;
}
export function trafficDims(type: TrafficType) {
  if (type === 'schoolbus') return BUS_DIMS;
  const s = getShape(TRAFFIC_SHAPES[type])!;
  return { length: s.length, width: s.width, height: s.height };
}

export type CopType = 'cop_basic' | 'cop_charger' | 'cop_moto' | 'cop_samurai';
/** the slower patrol car is a hatchback, the fast interceptor is built on the Conquette; both black with white doors */
const COP_SHAPES: Record<'cop_basic' | 'cop_charger', string> = { cop_basic: 't_hatch', cop_charger: 'zr1' };
const COP_COLORS: Record<'cop_basic' | 'cop_charger', number> = { cop_basic: 0x17191c, cop_charger: 0x101114 };
/** the police motorcycle is the CCR650 in white and black */
const COP_MOTO_COLOR = 0xf0f1f3;
export function buildCopModel(type: CopType): VehicleModel {
  if (type === 'cop_moto') return buildBike('cbr650', COP_MOTO_COLOR, false, 'police');
  if (type === 'cop_samurai') return buildBike('zx6r', COP_MOTO_COLOR, false, 'police');
  return build(COP_SHAPES[type], COP_COLORS[type], true, false, 'police');
}
export function copDims(type: CopType) {
  if (type === 'cop_moto' || type === 'cop_samurai') return { length: 2.03, width: 0.72, height: 1.13 };
  const s = getShape(COP_SHAPES[type])!;
  return { length: s.length, width: s.width, height: s.height };
}
