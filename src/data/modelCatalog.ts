import { VEHICLES } from './vehicles';

/** Every vehicle model in the game, for the Model Viewer (drivable, traffic and police). */
export interface ModelEntry { key: string; label: string; group: 'Motorcycles' | 'Cars' | 'Traffic' | 'Police'; note: string }

export const TRAFFIC_LABELS: Record<string, [string, string]> = {
  sedan: ['Sedan', 'Everyday family saloon'],
  hatch: ['Hatchback', 'Compact city hatch'],
  suv: ['SUV', 'Large luxury SUV'],
  crossover: ['Crossover', 'Mid size crossover'],
  pickup: ['Pickup truck', 'Full size pickup with open bed'],
  van: ['Van', 'Delivery van'],
  boxtruck: ['Box truck', 'Heavy cargo truck'],
  schoolbus: ['School bus', 'Yellow bus, rare, slow and always careful'],
  tesla: ['Tesler (traffic)', 'The Tesler as it appears in traffic'],
  civic: ['Honder Civiz (traffic)', 'The Honder Civiz as it appears in traffic'],
};

export function modelCatalog(): ModelEntry[] {
  const list: ModelEntry[] = [];
  for (const v of VEHICLES.filter((x) => x.kind === 'bike')) list.push({ key: `v:${v.id}`, label: v.name, group: 'Motorcycles', note: v.character });
  for (const v of VEHICLES.filter((x) => x.kind === 'car')) list.push({ key: `v:${v.id}`, label: v.name, group: 'Cars', note: v.character });
  for (const [id, [label, note]] of Object.entries(TRAFFIC_LABELS)) list.push({ key: `t:${id}`, label, group: 'Traffic', note });
  list.push({ key: 'c:cop_basic', label: 'Police cruiser', group: 'Police', note: 'Standard patrol car, joins the chase from 5,000 points' });
  list.push({ key: 'c:cop_moto', label: 'Police motorcycle', group: 'Police', note: 'Fast, agile CCR650 unit, joins the chase from 10,000 points' });
  list.push({ key: 'c:cop_samurai', label: 'Police Samurai', group: 'Police', note: 'High tier ZR6X Samurai unit: highways from 20,000 points (riders only), backroads from 15,000' });
  list.push({ key: 'c:cop_charger', label: 'Police interceptor', group: 'Police', note: 'Conquette pursuit unit: one at a time, highways at five stars, backroads from 20,000 points' });
  return list;
}
