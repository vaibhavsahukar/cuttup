/**
 * Gamepad rumble. Short pulses (impacts, near misses) decay on their own; the continuous layer (engine, road edge,
 * sliding) is set every frame. Both motors are driven through the Gamepad vibrationActuator where the browser has one.
 */
export class Haptics {
  enabled = true;
  private pulseS = 0; private pulseW = 0; private pulseT = 0; private pulseLen = 0.2;
  private contS = 0; private contW = 0;
  private sendT = 0;

  /** a one shot rumble: strong (low frequency) and weak (high frequency) motors, 0..1, lasting `sec` */
  pulse(strong: number, weak: number, sec = 0.2) {
    if (strong * 1 >= this.pulseS * (this.pulseT / this.pulseLen) || weak >= this.pulseW * (this.pulseT / this.pulseLen)) {
      this.pulseS = Math.min(1, strong); this.pulseW = Math.min(1, weak); this.pulseLen = Math.max(0.05, sec); this.pulseT = this.pulseLen;
    }
  }
  /** the steady layer for this frame */
  set(strong: number, weak: number) { this.contS = strong; this.contW = weak; }
  stop() { this.pulseT = 0; this.contS = this.contW = 0; this.send(0, 0); }

  update(dt: number) {
    this.pulseT = Math.max(0, this.pulseT - dt);
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 0.06;
    const k = this.pulseLen > 0 ? this.pulseT / this.pulseLen : 0;
    this.send(this.enabled ? Math.max(this.contS, this.pulseS * k) : 0, this.enabled ? Math.max(this.contW, this.pulseW * k) : 0);
  }

  private send(strong: number, weak: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      const a = (p as any)?.vibrationActuator;
      if (!p || !p.connected || !a?.playEffect) continue;
      try { a.playEffect('dual-rumble', { startDelay: 0, duration: 120, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch { /* no rumble on this pad */ }
    }
  }
}
