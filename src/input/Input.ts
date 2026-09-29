import { clamp } from '../core/math';

export type Action = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'camera' | 'pause' | 'lookback' | 'horn';
export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'throttle', label: 'Accelerate' }, { id: 'brake', label: 'Brake / Reverse' },
  { id: 'left', label: 'Steer left' }, { id: 'right', label: 'Steer right' },
  { id: 'handbrake', label: 'Handbrake' }, { id: 'camera', label: 'Toggle camera' },
  { id: 'lookback', label: 'Look back' }, { id: 'horn', label: 'Horn' }, { id: 'pause', label: 'Pause' },
];
export type Bindings = Record<Action, string[]>;
export const DEFAULT_BINDINGS: Bindings = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space', ''], camera: ['KeyC', ''], lookback: ['ShiftLeft', 'KeyQ'], horn: ['KeyH', 'ControlLeft'], pause: ['Escape', 'KeyP'],
};

/** Keyboard + XInput gamepad (standard mapping). Produces smoothed analog controls. */
export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<Action>();
  bindings: Bindings;
  steer = 0; throttle = 0; brake = 0; handbrake = false; lookback = false; horn = false;
  usingPad = false;
  private padPrev: boolean[] = [];
  captureCb: ((code: string) => void) | null = null;

  constructor(b: Bindings) {
    this.bindings = b;
    addEventListener('keydown', (e) => {
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

  update(dt: number) {
    let tSteer = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
    let thr = this.held('throttle') ? 1 : 0;
    let brk = this.held('brake') ? 1 : 0;
    let hb = this.held('handbrake');
    let lb = this.held('lookback');
    let horn = this.held('horn');
    let analogSteer = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] ?? 0;
      const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      if (Math.abs(ax) > 0.12 || rt > 0.05 || lt > 0.05 || p.buttons.some((b) => b.pressed)) this.usingPad = true;
      if (Math.abs(ax) > 0.12) { tSteer = -Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4); analogSteer = true; }
      thr = Math.max(thr, rt, btn(0) && false ? 1 : 0);
      brk = Math.max(brk, lt);
      hb = hb || btn(0) || btn(5);
      lb = lb || btn(1);
      horn = horn || btn(10);
      const edges: [number, Action][] = [[3, 'camera'], [9, 'pause'], [8, 'pause']];
      for (const [i, a] of edges) { if (btn(i) && !this.padPrev[i]) this.pressedOnce.add(a); }
      this.padPrev = p.buttons.map((b) => b.pressed);
      break;
    }
    if (analogSteer) this.steer = tSteer;
    else {
      const rate = tSteer === 0 || Math.sign(tSteer) !== Math.sign(this.steer) ? 10 : 7;
      this.steer += clamp(tSteer - this.steer, -rate * dt, rate * dt);
    }
    this.throttle = thr; this.brake = brk; this.handbrake = hb; this.lookback = lb; this.horn = horn;
  }

  /** menu navigation from gamepad (edge-triggered) */
  anyConfirm() { return this.pressed('handbrake'); }
}
