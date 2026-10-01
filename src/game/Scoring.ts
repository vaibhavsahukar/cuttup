import { clamp } from '../core/math';

export interface Popup { text: string; sub?: string; color: string; big?: boolean }

/**
 * Score = distance points (scaled by speed) + sustained high-speed bonus + near-miss / cut-up bonuses,
 * all multiplied by a combo multiplier that builds with near misses and decays without them.
 */
export class Scoring {
  score = 0;
  distance = 0;
  nearMisses = 0;
  multiplier = 1;
  comboTimer = 0;
  highSpeedTime = 0;
  lastNearMissT = -10;
  time = 0;
  cutUps = 0;
  onPopup: ((p: Popup) => void) | null = null;
  readonly COMBO_TIME = 5;
  /** per map multiplier on distance points (the backroad's winding, slow roads need a boost to keep pace) */
  distK = 1;
  /** per map multiplier on near miss points */
  passK = 1;
  /** difficulty multiplier on every score gain */
  scoreK = 1;

  update(dt: number, ds: number, speed: number) {
    this.time += dt;
    if (ds > 0) this.distance += ds;
    const speedK = speed < 20 ? 0.2 : (speed / 30) ** 1.6;
    this.score += (Math.max(0, ds) * speedK * this.multiplier * 0.5 * this.distK) * this.scoreK;
    // sustained speed (> ~100 mph)
    if (speed > 44.7) {
      this.highSpeedTime += dt;
      this.score += (dt * 15 * (1 + Math.min(3, this.highSpeedTime / 10)) * this.multiplier) * this.scoreK;
      if (Math.floor(this.highSpeedTime / 10) !== Math.floor((this.highSpeedTime - dt) / 10)) this.onPopup?.({ text: 'SPEED STREAK', sub: `${Math.floor(this.highSpeedTime)}s over 100 mph`, color: '#6cf' });
    } else this.highSpeedTime = Math.max(0, this.highSpeedTime - dt * 3);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.multiplier > 1) { this.multiplier = 1; this.onPopup?.({ text: 'COMBO LOST', color: '#888' }); }
    }
  }

  /** clearance in metres, relative speed m/s */
  nearMiss(clearance: number, relSpeed: number, oncoming: boolean) {
    const close = clamp(1 - clearance / 1.4, 0, 1);
    // Oncoming passes (backroad) come far more often than overtakes and have a huge closing speed, so they pay
    // less per pass, build the combo slowly and can't chain into cut-ups; otherwise that map out-scores the rest.
    const pts = Math.round((150 + 450 * close * close) * clamp(relSpeed / 18, 0.5, oncoming ? 2 : 3) * (oncoming ? 1.4 : 1) * 0.6 * this.passK);
    this.score += (pts * this.multiplier) * this.scoreK;
    this.nearMisses++;
    const cut = !oncoming && this.time - this.lastNearMissT < 1.4;
    this.lastNearMissT = this.time;
    this.multiplier = Math.min(10, this.multiplier + (oncoming ? 0.25 : cut ? 1 : 0.5));
    this.comboTimer = this.COMBO_TIME;
    const label = cut ? 'CUT UP!' : oncoming ? 'ONCOMING!' : close > 0.7 ? 'INSANE MISS' : close > 0.4 ? 'CLOSE CALL' : 'NEAR MISS';
    if (cut) { this.cutUps++; this.score += (250 * this.multiplier) * this.scoreK; }
    this.onPopup?.({ text: label, sub: `+${Math.round(pts * this.multiplier + (cut ? 250 * this.multiplier : 0))}  x${this.multiplier.toFixed(1)}`, color: cut ? '#ff4fd8' : oncoming ? '#ffb020' : '#4dff88', big: cut || close > 0.7 });
  }

  private wheelieBest = 0;
  /** bikes: points for time on the back wheel, a popup every couple of seconds */
  wheelie(dt: number, t: number, pitch: number) {
    if (t <= 0) {
      if (this.wheelieBest > 1.5) this.onPopup?.({ text: 'WHEELIE', sub: `${this.wheelieBest.toFixed(1)}s`, color: '#ffd23f' });
      this.wheelieBest = 0;
      return;
    }
    this.wheelieBest = t;
    this.score += (dt * (40 + 200 * Math.min(1, pitch / 0.6)) * this.multiplier) * this.scoreK;
    if (Math.floor(t / 3) !== Math.floor((t - dt) / 3)) { this.comboTimer = this.COMBO_TIME; this.onPopup?.({ text: 'WHEELIE', sub: `${Math.floor(t)}s  x${this.multiplier.toFixed(1)}`, color: '#ffd23f' }); }
  }

  bump() {
    if (this.multiplier > 1) this.onPopup?.({ text: 'BUMP - COMBO LOST', color: '#f66' });
    this.multiplier = 1; this.comboTimer = 0;
  }
}
