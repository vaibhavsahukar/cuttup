/**
 * Difficulty levels. Each one changes how much traffic there is and how fast it flows, how many drivers are
 * aggressive or jumpy, how soon and how hard the police come, and pays more score the harder it is.
 */
export interface Difficulty {
  name: string;
  density: number; // traffic cars per km
  flow: number; // multiplier on the map's typical traffic speed
  fast: number; // share of aggressive drivers (the rest split between slow and scared)
  scared: number; // share of jumpy drivers
  copTier: number; // multiplier on the score thresholds of the police tiers (lower = police arrive sooner)
  copSpeed: number; // multiplier on cop top speed and acceleration
  copMax: number; // most cops alive at once
  scoreK: number; // multiplier on every score gain
  growth: number; // how fast traffic thickens with distance (1 = default)
  fuelBurn: number; // multiplier on how fast the tank empties
}
export const DIFFICULTIES: Difficulty[] = [
  { name: 'Easy', density: 0.75, flow: 0.92, fast: 0.14, scared: 0.18, copTier: 1.5, copSpeed: 0.88, copMax: 3, scoreK: 0.8, growth: 0.6, fuelBurn: 0.92 },
  { name: 'Normal', density: 1, flow: 1, fast: 0.22, scared: 0.26, copTier: 1, copSpeed: 1, copMax: 5, scoreK: 1, growth: 1, fuelBurn: 1 },
  { name: 'Hard', density: 1.25, flow: 1.08, fast: 0.3, scared: 0.3, copTier: 0.8, copSpeed: 1.06, copMax: 5, scoreK: 1.25, growth: 1.25, fuelBurn: 1.1 },
  { name: 'Insane', density: 1.55, flow: 1.16, fast: 0.38, scared: 0.34, copTier: 0.6, copSpeed: 1.12, copMax: 5, scoreK: 1.6, growth: 1.5, fuelBurn: 1.2 },
];
export const difficultyOf = (i: number) => DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, Math.round(i)))];
