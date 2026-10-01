import { clamp } from '../core/math';
import type { VehicleSpec } from '../data/vehicles';

/** All sound is synthesised with WebAudio: engine (RPM-driven), wind, tyre squeal, horns, crash. */
export class AudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private muffle: BiquadFilterNode;
  private sfx: GainNode;
  private engineBus: GainNode;
  private noise: AudioBuffer;
  private eng?: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; lp: BiquadFilterNode; g: GainNode; am: GainNode; lfo: OscillatorNode; lfoG: GainNode; nG: GainNode; nf: BiquadFilterNode; spec: VehicleSpec };
  private wind: GainNode; private windF: BiquadFilterNode;
  private rainG!: GainNode;
  private squeal: GainNode;
  private scrape: GainNode;
  volumes = { master: 0.8, engine: 0.8, sfx: 0.8 };

  constructor() {
    this.ctx = new AudioContext();
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = c.createGain();
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.engineBus = c.createGain(); this.engineBus.connect(this.master);
    // shared white noise
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // wind
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.6;
    this.wind = c.createGain(); this.wind.gain.value = 0;
    this.loopNoise().connect(this.windF).connect(this.wind).connect(this.sfx);
    // tyre squeal: resonant noise + wavering tone
    const sq = c.createBiquadFilter(); sq.type = 'bandpass'; sq.frequency.value = 1700; sq.Q.value = 9;
    this.squeal = c.createGain(); this.squeal.gain.value = 0;
    this.loopNoise().connect(sq).connect(this.squeal);
    const so = c.createOscillator(); so.type = 'triangle'; so.frequency.value = 880;
    const vib = c.createOscillator(); vib.frequency.value = 7; const vg = c.createGain(); vg.gain.value = 25;
    vib.connect(vg).connect(so.frequency); vib.start();
    const soG = c.createGain(); soG.gain.value = 0.25; so.connect(soG).connect(this.squeal); so.start();
    this.squeal.connect(this.sfx);
    // barrier scrape
    const sc = c.createBiquadFilter(); sc.type = 'highpass'; sc.frequency.value = 2500;
    this.scrape = c.createGain(); this.scrape.gain.value = 0;
    this.loopNoise().connect(sc).connect(this.scrape).connect(this.sfx);
    // rain: a hiss of high noise over a soft low patter
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    const rh = c.createBiquadFilter(); rh.type = 'highpass'; rh.frequency.value = 1800;
    const rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 600;
    const rlG = c.createGain(); rlG.gain.value = 0.6;
    this.loopNoise().connect(rh).connect(this.rainG);
    this.loopNoise().connect(rl).connect(rlG).connect(this.rainG);
    this.rainG.connect(this.sfx);
    this.applyVolumes();
  }
  /** rain loudness 0..1 */
  rain(level: number) { this.rainG.gain.setTargetAtTime(level * 0.22, this.ctx.currentTime, 0.3); }
  /** a distant thunder roll */
  thunder() {
    const d = Math.random() * 1.5;
    this.burst(3.5, 120, 'lowpass', 0.9, d, 0.7);
    this.burst(1.2, 300, 'lowpass', 0.5, d + 0.1);
  }

  private loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random());
    return s;
  }

  private paused = false;
  resume() { if (!this.paused && this.ctx.state !== 'running') this.ctx.resume(); }
  /** the whole sound world freezes while the game is paused (engine, rain, siren and any sound still ringing out) */
  setPaused(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    if (on) this.ctx.suspend(); else this.ctx.resume();
  }

  applyVolumes() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.volumes.engine * 0.5, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  startEngine(spec: VehicleSpec) {
    this.stopEngine();
    const c = this.ctx;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const o3 = c.createOscillator(); o3.type = 'sawtooth';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    const am = c.createGain(); am.gain.value = 1;
    const lfo = c.createOscillator(); lfo.type = 'sine';
    const lfoG = c.createGain(); lfoG.gain.value = spec.engine.roughness * 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const g = c.createGain(); g.gain.value = 0;
    const m1 = c.createGain(); m1.gain.value = 0.5;
    const m2 = c.createGain(); m2.gain.value = 0.35;
    const m3 = c.createGain(); m3.gain.value = 0.2;
    o1.connect(m1).connect(shaper); o2.connect(m2).connect(shaper); o3.connect(m3).connect(shaper);
    shaper.connect(lp).connect(am).connect(g).connect(this.engineBus);
    // intake / exhaust noise
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.5;
    const nG = c.createGain(); nG.gain.value = 0;
    this.loopNoise().connect(nf).connect(nG).connect(g);
    for (const o of [o1, o2, o3, lfo]) o.start();
    this.eng = { o1, o2, o3, lp, g, am, lfo, lfoG, nG, nf, spec };
  }
  stopEngine() {
    if (!this.eng) return;
    const e = this.eng;
    e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const stopAt = this.ctx.currentTime + 0.3;
    for (const o of [e.o1, e.o2, e.o3, e.lfo]) o.stop(stopAt);
    this.eng = undefined;
  }

  /** per-frame update of continuous sounds */
  update(rpm: number, throttle: number, speed: number, slip: number, scrape: number, running: boolean) {
    const t = this.ctx.currentTime;
    const e = this.eng;
    if (e) {
      const sp = e.spec;
      // electric motors (0 cylinders) whine instead of firing pulses
      const fire = sp.engine.cylinders === 0 ? 90 + (rpm / sp.redline) * 900 : (rpm / 60) * (sp.engine.cylinders / 2) * 0.5; // perceived fundamental
      const f = clamp(fire * sp.engine.tone, 20, 1200);
      e.o1.frequency.setTargetAtTime(f, t, 0.02);
      e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.02);
      e.o3.frequency.setTargetAtTime(f * 1.01 * 2, t, 0.02);
      e.lfo.frequency.setTargetAtTime(Math.max(4, f * 0.25), t, 0.02);
      e.lp.frequency.setTargetAtTime(400 + throttle * 2600 + rpm / sp.redline * 1500, t, 0.03);
      e.nf.frequency.setTargetAtTime(f * 3, t, 0.03);
      e.nG.gain.setTargetAtTime(0.08 + throttle * 0.15, t, 0.05);
      e.g.gain.setTargetAtTime(running ? 0.22 + throttle * 0.4 : 0, t, 0.06);
    }
    this.wind.gain.setTargetAtTime(0, t, 0.1); // the speed wind (a white noise hiss) is switched off
    this.windF.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
    this.squeal.gain.setTargetAtTime(running ? clamp(slip - 0.15, 0, 1) * 0.35 : 0, t, 0.05);
    this.scrape.gain.setTargetAtTime(running ? clamp(scrape, 0, 1) * 0.5 : 0, t, 0.03);
  }

  private burst(dur: number, freq: number, type: BiquadFilterType, gain: number, when = 0, q = 1) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const t0 = c.currentTime + when;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
    return f;
  }
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, endFreq?: number, pan = 0) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    const t0 = c.currentTime + when;
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const p = c.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  crash(intensity: number) {
    const k = clamp(intensity, 0.3, 1.5);
    this.burst(1.2 * k, 900, 'lowpass', 1.2 * k);
    this.burst(0.5, 3000, 'bandpass', 0.6 * k, 0.02, 2);
    this.tone(70, 0.8, 0.9 * k, 'sine', 0, 35);
    for (let i = 0; i < 8; i++) this.burst(0.15 + Math.random() * 0.2, 4000 + Math.random() * 4000, 'highpass', 0.25 * k, 0.05 + Math.random() * 0.6); // glass
    this.burst(1.5, 400, 'lowpass', 0.4 * k, 0.4); // secondary tumble
    // muffled ear-ring ring-out
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(20000, t);
    this.muffle.frequency.exponentialRampToValueAtTime(500, t + 0.35);
    this.muffle.frequency.setValueAtTime(500, t + 3.2);
    this.muffle.frequency.exponentialRampToValueAtTime(20000, t + 5.5);
    // The ring goes straight to the output (past the muffle, so it stays sharp), which also skips the volume buses,
    // so scale it by the master and effects volumes here and drop it completely when either is off.
    const level = 0.08 * (this.volumes.master / 0.8) * (this.volumes.sfx / 0.8);
    if (level < 0.002) return;
    const c = this.ctx;
    const o = c.createOscillator(); o.frequency.value = 3150;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + 4.6);
  }
  /** a fireball: deep boom, rumble and a crackle */
  explosion() {
    this.burst(1.8, 180, 'lowpass', 1.3);
    this.tone(60, 1.3, 1, 'sine', 0, 26);
    this.burst(0.7, 2600, 'highpass', 0.45, 0.05);
    this.burst(1.2, 700, 'bandpass', 0.35, 0.3);
  }
  thud(intensity: number) { this.tone(90, 0.3, 0.4 * clamp(intensity, 0.1, 1), 'sine', 0, 45); this.burst(0.25, 700, 'lowpass', 0.3 * intensity); }
  /**
   * One car horn: the usual pair of reed horns a major third apart (about 415 and 520 Hz). Each is a buzzy saw plus a
   * slightly detuned square (the beating is what makes it sound like two diaphragms, not a synth), with a touch of the
   * octave, driven through soft clipping and shaped by the resonances of the horn's bell. The diaphragm starts a little
   * sharp and settles, and the level has a firm attack and a short release. Returns a function that releases it.
   */
  private hornVoice(volume: number, pan: number, pitch = 1) {
    const c = this.ctx, t0 = c.currentTime;
    const out = c.createGain(); out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + 0.014);
    // soft clipping: the harmonics of an overdriven reed
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) { const x = (i / 255.5) - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve; shaper.oversample = '2x';
    // the bell: two resonances, and the top rolled off
    const r1 = c.createBiquadFilter(); r1.type = 'peaking'; r1.frequency.value = 1150; r1.Q.value = 1.4; r1.gain.value = 7;
    const r2 = c.createBiquadFilter(); r2.type = 'peaking'; r2.frequency.value = 2350; r2.Q.value = 1.2; r2.gain.value = 5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.Q.value = 0.5;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const p = c.createStereoPanner(); p.pan.value = pan;
    shaper.connect(r1).connect(r2).connect(lp).connect(hp).connect(out).connect(p).connect(this.sfx);
    // a faint buzz from the diaphragm
    const buzz = c.createOscillator(); buzz.frequency.value = 83;
    const buzzG = c.createGain(); buzzG.gain.value = 0.06;
    const am = c.createGain(); am.gain.value = 0.94;
    buzz.connect(buzzG).connect(am.gain);
    const oscs: OscillatorNode[] = [buzz];
    am.connect(shaper);
    for (const [f, lvl] of [[415 * pitch, 1], [521 * pitch, 0.9]] as const) {
      const base = f * (0.992 + Math.random() * 0.016); // no two horns are quite alike
      for (const [type, mult, det, g] of [['sawtooth', 1, 0, 0.5], ['square', 1, 5, 0.3], ['sawtooth', 2, -3, 0.12]] as const) {
        const o = c.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(base * mult * 1.035, t0);
        o.frequency.exponentialRampToValueAtTime(base * mult, t0 + 0.06);
        o.detune.value = det;
        const og = c.createGain(); og.gain.value = g * lvl * 0.5;
        o.connect(og).connect(am);
        o.start(t0);
        oscs.push(o);
      }
    }
    buzz.start(t0);
    let done = false;
    return (when = 0) => {
      if (done) return; done = true;
      const t = c.currentTime + when;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(0.0002, out.gain.value), t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      for (const o of oscs) o.stop(t + 0.09);
    };
  }
  /** a horn blast from other traffic: one long honk, or sometimes a short double tap */
  honk(volume: number, pan: number) {
    const v = clamp(volume, 0, 1) * 0.3;
    if (v < 0.01) return;
    const pitch = 0.92 + Math.random() * 0.2; // different cars, different horns
    if (Math.random() < 0.3) {
      const a = this.hornVoice(v, pan, pitch); a(0.16);
      setTimeout(() => { const b = this.hornVoice(v, pan, pitch); b(0.2); }, 260);
    } else {
      const stop = this.hornVoice(v, pan, pitch);
      stop(0.3 + Math.random() * 0.45);
    }
  }
  private horn?: () => void;
  private hornFrom = 0;
  /** the player's horn: sounds for exactly as long as the button is held (at least a short blip) */
  hornHeld(on: boolean) {
    const now = this.ctx.currentTime;
    if (on && !this.horn) { this.horn = this.hornVoice(0.34, 0); this.hornFrom = now; }
    else if (!on && this.horn && now - this.hornFrom > 0.12) { this.horn(); this.horn = undefined; }
  }
  whoosh(intensity: number) {
    const f = this.burst(0.45, 400, 'bandpass', 0.5 * clamp(intensity, 0.3, 1), 0, 2);
    f.frequency.exponentialRampToValueAtTime(2200, this.ctx.currentTime + 0.2);
    f.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.45);
  }
  private sir?: { o: OscillatorNode; lfo: OscillatorNode; g: GainNode };
  /** two-tone wail; level 0 = off */
  siren(level: number) {
    const c = this.ctx;
    if (!this.sir && level > 0) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 900;
      const lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.45;
      const lg = c.createGain(); lg.gain.value = 320;
      lfo.connect(lg).connect(o.frequency);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.2;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(f).connect(g).connect(this.sfx);
      o.start(); lfo.start();
      this.sir = { o, lfo, g };
    }
    if (this.sir) this.sir.g.gain.setTargetAtTime(level * 0.12, c.currentTime, 0.1);
  }
  click() { this.tone(1200, 0.05, 0.1, 'square'); }
  reset() {
    if (this.horn) { this.horn(); this.horn = undefined; }
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(20000, t);
  }
}
