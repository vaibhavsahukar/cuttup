export type TimeChoice = 'auto' | 'dawn' | 'day' | 'dusk' | 'night';
export const TIME_CHOICES: [TimeChoice, string][] = [['auto', 'Natural clock'], ['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']];

/** 'auto' runs a natural day/night cycle from a map-specific start hour; a fixed choice freezes the clock. */
export function timeSetting(choice: TimeChoice | undefined, mapId: string) {
  switch (choice) {
    case 'dawn': return { hour: 6.9, cycle: false };
    case 'day': return { hour: 12.5, cycle: false };
    case 'dusk': return { hour: 18.6, cycle: false };
    case 'night': return { hour: 22.5, cycle: false };
    default: return { hour: mapId === 'city' ? 18.2 : mapId === 'country' ? 11 : 9.5, cycle: true };
  }
}
