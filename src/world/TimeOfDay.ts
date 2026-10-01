export type TimeChoice = 'auto' | 'dawn' | 'day' | 'dusk' | 'night';
export const TIME_CHOICES: [TimeChoice, string][] = [['auto', 'Natural clock'], ['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']];

/** 'auto' runs a natural day/night cycle from a map-specific start hour; a fixed choice freezes the clock. */
export function timeSetting(choice: TimeChoice | undefined, mapId: string) {
  switch (choice) {
    case 'dawn': return { hour: 6.9, cycle: false };
    case 'day': return { hour: 12.5, cycle: false };
    case 'dusk': return { hour: 18.6, cycle: false };
    case 'night': return { hour: 22.5, cycle: false };
    // the natural clock starts at a random hour on every run (each map has its own random start)
    default: { void mapId; return { hour: Math.random() * 24, cycle: true }; }
  }
}
