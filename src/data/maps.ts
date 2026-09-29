export type RoadType = 'highway' | 'backroad';
export type MapId = 'city' | 'country' | 'forest';

export interface MapSpec {
  id: MapId;
  name: string;
  blurb: string;
  road: RoadType;
  seed: number;
  /** curvature control-point spacing range (m) and max curvature (1/m) */
  curveSeg: [number, number];
  maxCurv: number;
  straightChance: number;
  gradeSeg: [number, number];
  maxGrade: number;
  flowSpeed: number; // m/s typical traffic speed
  fogNear: number;
  fogFar: number;
  sky: number;
  skyHorizon: number;
  fog: number;
  ground: number;
  sunColor: number;
  sunIntensity: number;
  ambient: number;
  hemiGround: number;
}

export const MAPS: MapSpec[] = [
  {
    id: 'city', name: 'City Highway', blurb: '5-lane urban freeway, skyline, overpasses. Dusk or night.',
    road: 'highway', seed: 1337, curveSeg: [250, 500], maxCurv: 1 / 900, straightChance: 0.35,
    gradeSeg: [200, 400], maxGrade: 0.02, flowSpeed: 30, fogNear: 120, fogFar: 520,
    sky: 0x2a2f4a, skyHorizon: 0xf08a4b, fog: 0x6b5a66, ground: 0x3a3a3c,
    sunColor: 0xffb27a, sunIntensity: 1.4, ambient: 0.55, hemiGround: 0x2b2522,
  },
  {
    id: 'country', name: 'Countryside Highway', blurb: 'Rolling hills, farms, power lines, mountains. Daytime.',
    road: 'highway', seed: 4242, curveSeg: [250, 550], maxCurv: 1 / 800, straightChance: 0.3,
    gradeSeg: [150, 350], maxGrade: 0.035, flowSpeed: 31, fogNear: 200, fogFar: 700,
    sky: 0x5c9ae0, skyHorizon: 0xcfe3f2, fog: 0xbcd3e6, ground: 0x6c8f3c,
    sunColor: 0xfff3dc, sunIntensity: 2.4, ambient: 0.8, hemiGround: 0x4a5a2a,
  },
  {
    id: 'forest', name: 'Forest Backroad', blurb: 'Winding two-lane road, hills, fog. Overtake at your own risk.',
    road: 'backroad', seed: 777, curveSeg: [60, 160], maxCurv: 1 / 75, straightChance: 0.15,
    gradeSeg: [60, 140], maxGrade: 0.07, flowSpeed: 21, fogNear: 25, fogFar: 260,
    sky: 0x9aa6a4, skyHorizon: 0xb8c2bf, fog: 0xa5b0ad, ground: 0x2f4222,
    sunColor: 0xe8f0e6, sunIntensity: 1.3, ambient: 0.75, hemiGround: 0x283520,
  },
];
export const getMap = (id: string) => MAPS.find((m) => m.id === id) ?? MAPS[0];
/**
 * A map for one run: the spec above with a fresh random seed, so the road, hills, scenery and traffic are different every
 * time. (`window.__forceSeed` pins it for reproducible test runs.)
 */
export function newRunMap(id: string): MapSpec {
  const forced = (globalThis as { __forceSeed?: number }).__forceSeed;
  return { ...getMap(id), seed: forced ?? 1 + Math.floor(Math.random() * 99999) };
}

/** Cross-section layout. d is lateral offset from road reference line, +d = right of travel. */
export interface Layout {
  lanes: number; // player-direction lanes
  laneWidth: number;
  /** centre offset of player-direction lane i (0 = leftmost / fast lane) */
  laneCenter(i: number): number;
  oncomingLanes: number;
  oncomingCenter(i: number): number;
  playerMin: number; // hard limits for player lateral position (barrier / walls)
  playerMax: number;
  softMin: number; // off-tarmac limits (grass slow-down) for backroad
  softMax: number;
  medianHalf: number;
  roadHalfWidth: number; // total paved half width incl. both carriageways (for scenery clearance)
}

export function makeLayout(road: RoadType): Layout {
  if (road === 'highway') {
    const lw = 3.7, median = 1.6, shoulderIn = 1.2, shoulderOut = 3.0;
    const inner = median + shoulderIn; // edge of lane 0
    return {
      lanes: 5, laneWidth: lw,
      laneCenter: (i) => inner + lw * (i + 0.5),
      oncomingLanes: 5,
      oncomingCenter: (i) => -(inner + lw * (i + 0.5)),
      playerMin: median + 0.35, playerMax: inner + lw * 5 + shoulderOut - 0.3,
      softMin: -999, softMax: 999, medianHalf: median,
      roadHalfWidth: inner + lw * 5 + shoulderOut + 1,
    };
  }
  // two wide lanes with a strip of paved verge each side; the grass (and its slow-down) starts at the verge edge
  const lw = 4.2, verge = 0.6;
  return {
    lanes: 1, laneWidth: lw,
    laneCenter: () => lw / 2,
    oncomingLanes: 1,
    oncomingCenter: () => -lw / 2,
    playerMin: -lw - verge - 3.2, playerMax: lw + verge + 3.2,
    softMin: -lw - verge, softMax: lw + verge, medianHalf: 0,
    roadHalfWidth: lw + verge + 1,
  };
}
