import { clamp } from '../core/math';

export type Action = 'throttle' | 'brake' | 'frontBrake' | 'left' | 'right' | 'wheelie' | 'leanLeft' | 'leanRight' | 'handbrake' | 'camera' | 'pause' | 'lookback' | 'lookLeft' | 'lookRight' | 'horn' | 'highbeam';
export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'throttle', label: 'Accelerate' }, { id: 'brake', label: 'Brake / Reverse (bike: rear brake)' },
  { id: 'frontBrake', label: 'Bike front brake' },
  { id: 'left', label: 'Steer left' }, { id: 'right', label: 'Steer right' },
  { id: 'wheelie', label: 'Bike: pull back (wheelie)' },
  { id: 'leanLeft', label: 'Bike: shift weight left' }, { id: 'leanRight', label: 'Bike: shift weight right' },
  { id: 'handbrake', label: 'Handbrake' }, { id: 'camera', label: 'Toggle camera' },
  { id: 'lookback', label: 'Look back' }, { id: 'lookLeft', label: 'Look left (camera)' }, { id: 'lookRight', label: 'Look right (camera)' }, { id: 'horn', label: 'Horn' }, { id: 'highbeam', label: 'High beam (toggle)' }, { id: 'pause', label: 'Pause' },
];
export type Bindings = Record<Action, string[]>;
export const DEFAULT_BINDINGS: Bindings = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], frontBrake: ['KeyE', ''], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  wheelie: ['', ''], leanLeft: ['KeyZ', ''], leanRight: ['KeyX', ''],
  handbrake: ['Space', ''], camera: ['KeyC', ''], lookback: ['ShiftLeft', 'KeyQ'], lookLeft: ['KeyJ', 'Numpad4'], lookRight: ['KeyL', 'Numpad6'], highbeam: ['KeyF', ''], horn: ['KeyH', 'ControlLeft'], pause: ['Escape', 'KeyP'],
};

/**
 * Gamepad bindings (standard mapping): 'B<n>' = button n (triggers are analog),
 * 'A<n>+' / 'A<n>-' = axis n pushed positive / negative.
 */
export type PadBindings = Record<Action, string>;
export const DEFAULT_PAD: PadBindings = {
  throttle: 'B7', brake: 'B6', frontBrake: 'B5', left: 'A0-', right: 'A0+', wheelie: 'A1+', leanLeft: 'B14', leanRight: 'B15',
  handbrake: 'B0', camera: 'B3', lookback: 'B1', lookLeft: 'A2-', lookRight: 'A2+', highbeam: 'B4', horn: 'B10', pause: 'B9',
};
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home'];
const AXIS_NAMES = [['Left stick left', 'Left stick right'], ['Left stick up', 'Left stick down'], ['Right stick left', 'Right stick right'], ['Right stick up', 'Right stick down']];
export function fmtPad(code: string) {
  if (!code) return '—';
  if (code[0] === 'B') return PAD_NAMES[Number(code.slice(1))] ?? `Button ${code.slice(1)}`;
  const n = Number(code.slice(1, -1)), pos = code.endsWith('+');
  return AXIS_NAMES[n]?.[pos ? 1 : 0] ?? `Axis ${n}${pos ? '+' : '-'}`;
}
const DEAD = 0.15;

/** Keyboard + gamepad (standard mapping), both rebindable. Produces smoothed analog controls. */
export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<Action>();
  bindings: Bindings;
  pad: PadBindings;
  steer = 0; throttle = 0; brake = 0; frontBrake = 0; handbrake = false; lookback = false; horn = false;
  /** camera look angle in radians, + = to the right: keys show 90 degrees to either side, the right stick swings the view up to 135 degrees */
  lookYaw = 0;
  /** bikes: pull back (0..1), rider weight shift (+ left), keyboard-only brake (S) for the S-while-accelerating wheelie */
  wheelie = 0; hang = 0; brakeKey = 0; brakePad = 0;
  usingPad = false;
  private padPrev = new Map<Action, boolean>();
  captureCb: ((code: string) => void) | null = null;
  /** waiting for a gamepad button / axis to bind */
  padCaptureCb: ((code: string) => void) | null = null;
  private padBase: number[] = [];
  /** menu gamepad navigation is paused briefly after a rebind so the press doesn't also click */
  menuBlock = 0;

  constructor(b: Bindings, pad: PadBindings) {
    this.bindings = b;
    this.pad = pad;
    addEventListener('keydown', (e) => {
      if (this.padCaptureCb && e.code === 'Escape') { e.preventDefault(); this.padCaptureCb = null; this.menuBlock = 0.3; return; }
      if (this.captureCb) { e.preventDefault(); const cb = this.captureCb; this.captureCb = null; cb(e.code); return; }
      if (!this.down.has(e.code)) for (const a of Object.keys(this.bindings) as Action[]) if (this.bindings[a].includes(e.code)) this.pressedOnce.add(a);
      this.down.add(e.code);
      this.usingPad = false;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  held(a: Action) { return this.bindings[a].some((c) => c && this.down.has(c)); }
  /** true once per physical press */
  pressed(a: Action) { const had = this.pressedOnce.has(a); this.pressedOnce.delete(a); return had; }
  clearPressed() { this.pressedOnce.clear(); }

  /** start listening for a gamepad input to bind */
  capturePad(cb: (code: string) => void) {
    const p = this.firstPad();
    this.padBase = p ? [...p.buttons.map((b) => b.value), ...p.axes.map((x) => Math.abs(x))] : [];
    this.padCaptureCb = cb;
  }

  private firstPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** analog value 0..1 of a pad binding */
  private padValue(p: Gamepad, code: string) {
    if (!code) return 0;
    if (code[0] === 'B') { const b = p.buttons[Number(code.slice(1))]; return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0; }
    const x = p.axes[Number(code.slice(1, -1))] ?? 0;
    const v = code.endsWith('+') ? x : -x;
    return v > DEAD ? (v - DEAD) / (1 - DEAD) : 0;
  }

  update(dt: number) {
    this.menuBlock = Math.max(0, this.menuBlock - dt);
    const key = (a: Action) => (this.held(a) ? 1 : 0);
    let tSteer = key('left') - key('right');
    let thr = key('throttle'), brk = key('brake'), fbrk = key('frontBrake');
    let hb = this.held('handbrake'), lb = this.held('lookback'), horn = this.held('horn');
    let wh = key('wheelie'), hang = key('leanLeft') - key('leanRight');
    let look = (key('lookRight') - key('lookLeft')) * (Math.PI / 2);
    this.brakeKey = brk; this.brakePad = 0;
    let analogSteer = false;
    const p = this.firstPad();
    if (p) {
      // rebinding: the first fresh button press or a stick pushed well past the baseline
      if (this.padCaptureCb) {
        let code = '';
        p.buttons.forEach((b, i) => { if (!code && b.value > 0.6 && (this.padBase[i] ?? 0) < 0.3) code = `B${i}`; });
        p.axes.forEach((x, i) => { if (!code && Math.abs(x) > 0.7 && (this.padBase[p.buttons.length + i] ?? 0) < 0.4) code = `A${i}${x > 0 ? '+' : '-'}`; });
        if (code) { const cb = this.padCaptureCb; this.padCaptureCb = null; this.menuBlock = 0.4; cb(code); }
        this.padPrev.clear();
        for (const a of Object.keys(this.pad) as Action[]) this.padPrev.set(a, this.padValue(p, this.pad[a]) > 0.5);
      } else {
        const v = (a: Action) => this.padValue(p, this.pad[a]);
        const pl = v('left'), pr = v('right');
        if (pl > 0 || pr > 0 || p.buttons.some((b) => b.pressed)) this.usingPad = true;
        if (pl > 0 || pr > 0) { const s = pl - pr; tSteer = Math.sign(s) * Math.pow(Math.abs(s), 1.4); analogSteer = true; }
        thr = Math.max(thr, v('throttle'));
        this.brakePad = v('brake');
        brk = Math.max(brk, this.brakePad);
        fbrk = Math.max(fbrk, v('frontBrake'));
        wh = Math.max(wh, v('wheelie'));
        const ph = v('leanLeft') - v('leanRight');
        if (Math.abs(ph) > Math.abs(hang)) hang = ph;
        hb = hb || v('handbrake') > 0.5;
        lb = lb || v('lookback') > 0.5 || p.axes[3] > 0.6; // right stick pulled down looks behind
        const pLook = (v('lookRight') - v('lookLeft')) * Math.PI * 0.75;
        if (Math.abs(pLook) > Math.abs(look)) look = pLook;
        horn = horn || v('horn') > 0.5;
        for (const a of ['camera', 'pause', 'handbrake', 'highbeam'] as Action[]) {
          const on = v(a) > 0.5;
          if (on && !this.padPrev.get(a)) this.pressedOnce.add(a);
          this.padPrev.set(a, on);
        }
      }
    }
    if (analogSteer) this.steer = tSteer;
    else {
      const rate = tSteer === 0 || Math.sign(tSteer) !== Math.sign(this.steer) ? 10 : 7;
      this.steer += clamp(tSteer - this.steer, -rate * dt, rate * dt);
    }
    this.throttle = thr; this.brake = brk; this.frontBrake = fbrk; this.handbrake = hb; this.lookback = lb; this.horn = horn;
    this.wheelie = wh; this.hang = clamp(hang, -1, 1);
    this.lookYaw = look;
  }

  /** menu navigation from gamepad (edge-triggered) */
  anyConfirm() { return this.pressed('handbrake'); }
}
