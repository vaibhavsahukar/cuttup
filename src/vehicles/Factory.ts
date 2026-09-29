import type { VehicleSpec } from '../data/vehicles';
import { buildCar, CAR_DEFS, TRAFFIC_DEFS } from './CarBuilder';
import { buildBike } from './BikeBuilder';
import type { VehicleModel } from './ModelKit';

export function buildPlayerModel(spec: VehicleSpec, shadows = true): VehicleModel {
  if (spec.kind === 'bike') return buildBike(spec.model, spec.color, shadows);
  return buildCar(CAR_DEFS[spec.model], spec.color, shadows);
}

export type TrafficType = keyof typeof TRAFFIC_DEFS;
export const TRAFFIC_TYPES = Object.keys(TRAFFIC_DEFS) as TrafficType[];
export const TRAFFIC_COLORS = [0xe6e6e6, 0x1a1a1a, 0x8c9096, 0x5a5f66, 0x9a1b1b, 0x1c3f86, 0x2b5d34, 0xc8b89a, 0x6b2e1a, 0xd9d0c0, 0x2f7fb8, 0x444a52];

export function buildTrafficModel(type: TrafficType, color: number, shadows = false): VehicleModel {
  const d = TRAFFIC_DEFS[type];
  return buildCar(d, type === 'boxtruck' ? 0xe0e0e0 : color, shadows, true);
}
export function trafficDims(type: TrafficType) {
  const d = TRAFFIC_DEFS[type];
  return { length: d.L, width: d.W, height: d.H };
}
