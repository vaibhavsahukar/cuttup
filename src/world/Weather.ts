import * as THREE from 'three';

export type WeatherChoice = 'changing' | 'clear' | 'rain';
export const WEATHER_CHOICES: [WeatherChoice, string][] = [['changing', 'Changing'], ['clear', 'Clear'], ['rain', 'Rain']];

const N = 1800; // rain streaks around the camera
const BOX = { x: 36, y: 22, z: 36 };

/**
 * Rain. `wet` (0..1) is how hard it is raining right now; everything else (grip, sky, fog, road sheen, sound) reads it.
 * 'changing' starts clear or wet at random and alternates dry and rainy spells during the run.
 */
export class Weather {
  wet = 0;
  private target = 0;
  private spellT = 0;
  private drops: Float32Array;
  private geo = new THREE.BufferGeometry();
  readonly lines: THREE.LineSegments;
  private mat: THREE.LineBasicMaterial;
  private seedPos: Float32Array;
  thunderIn = 25;
  /** a lightning flash (0..1) that the game adds to the sky light */
  flash = 0;

  constructor(public choice: WeatherChoice) {
    if (choice === 'rain') this.wet = this.target = 1;
    else if (choice === 'changing') { this.wet = this.target = Math.random() < 0.35 ? 0.6 + Math.random() * 0.4 : 0; this.spellT = 40 + Math.random() * 80; }
    this.seedPos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.seedPos[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.seedPos[i * 3 + 1] = Math.random() * BOX.y;
      this.seedPos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    }
    this.drops = new Float32Array(N * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.drops, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
  }

  /** grip multiplier for the tyres */
  get grip() { return 1 - 0.24 * this.wet; }

  update(dt: number, cam: THREE.Vector3, vel: THREE.Vector3, onThunder?: () => void) {
    if (this.choice === 'changing') {
      this.spellT -= dt;
      if (this.spellT <= 0) {
        const raining = this.target > 0;
        this.target = raining ? 0 : 0.45 + Math.random() * 0.55;
        this.spellT = raining ? 50 + Math.random() * 110 : 60 + Math.random() * 100;
      }
    }
    // rain builds and eases off over about 15 to 20 seconds
    this.wet += Math.max(-dt / 18, Math.min(dt / 15, this.target - this.wet));
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.wet > 0.7) {
      this.thunderIn -= dt;
      if (this.thunderIn <= 0) { this.thunderIn = 18 + Math.random() * 40; this.flash = 1; onThunder?.(); }
    }
    this.mat.opacity = Math.min(0.55, this.wet * 0.6);
    this.lines.visible = this.wet > 0.02;
    if (!this.lines.visible) return;
    // drops fall at 11 m/s with a little wind; they are stretched along their motion relative to the camera
    const t = performance.now() / 1000;
    const fall = 11, len = 0.55 + this.wet * 0.5;
    const rx = -vel.x * 0.04, rz = -vel.z * 0.04;
    const n = Math.floor(N * Math.min(1, 0.25 + this.wet));
    for (let i = 0; i < N; i++) {
      const o = i * 6;
      if (i >= n) { this.drops.fill(0, o, o + 6); continue; }
      const sx = this.seedPos[i * 3], sy = this.seedPos[i * 3 + 1], sz = this.seedPos[i * 3 + 2];
      // wrap each drop inside a box that moves with the camera
      const y = BOX.y - (((sy + t * fall) % BOX.y) + BOX.y) % BOX.y;
      const x = ((((sx - cam.x) % BOX.x) + BOX.x * 1.5) % BOX.x) - BOX.x / 2 + cam.x;
      const z = ((((sz - cam.z) % BOX.z) + BOX.z * 1.5) % BOX.z) - BOX.z / 2 + cam.z;
      const yy = cam.y - 6 + y;
      this.drops[o] = x; this.drops[o + 1] = yy; this.drops[o + 2] = z;
      this.drops[o + 3] = x + rx - 0.08; this.drops[o + 4] = yy - len; this.drops[o + 5] = z + rz;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
