import * as THREE from 'three';

/**
 * DEV MODE free camera. Keyboard: W A S D (or arrows) move, Space / E up, Ctrl / Q down, Shift fast, Alt slow.
 * Mouse: hold a button and drag to look, wheel changes the speed. Gamepad: left stick moves, right stick looks,
 * RT / LT up and down, RB fast, LB slow.
 */
export class FlyCam {
  speed = 60; // m/s
  yaw = 0; pitch = 0;
  private keys = new Set<string>();
  /** keys pressed since the last update (one shot) */
  taps = new Set<string>();
  private drag = false;
  private on = false;
  private el: HTMLElement | null = null;
  private readonly kd = (e: KeyboardEvent) => { if (!e.repeat) { this.keys.add(e.code); this.taps.add(e.code); } if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); };
  private readonly ku = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private readonly md = (e: MouseEvent) => { this.drag = true; e.preventDefault(); };
  private readonly mu = () => { this.drag = false; };
  private readonly mm = (e: MouseEvent) => { if (this.drag) { this.yaw -= e.movementX * 0.0035; this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0035)); } };
  private readonly wh = (e: WheelEvent) => { this.speed = Math.max(4, Math.min(1500, this.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); };
  private readonly cm = (e: Event) => e.preventDefault();

  enable(camera: THREE.Camera, el: HTMLElement) {
    if (this.on) return;
    this.on = true; this.el = el;
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    addEventListener('keydown', this.kd); addEventListener('keyup', this.ku);
    el.addEventListener('mousedown', this.md); addEventListener('mouseup', this.mu); addEventListener('mousemove', this.mm);
    el.addEventListener('wheel', this.wh, { passive: true }); el.addEventListener('contextmenu', this.cm);
  }
  disable() {
    if (!this.on) return;
    this.on = false; this.keys.clear(); this.drag = false;
    removeEventListener('keydown', this.kd); removeEventListener('keyup', this.ku);
    this.el?.removeEventListener('mousedown', this.md); removeEventListener('mouseup', this.mu); removeEventListener('mousemove', this.mm);
    this.el?.removeEventListener('wheel', this.wh); this.el?.removeEventListener('contextmenu', this.cm);
  }
  private static dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);

  update(dt: number, camera: THREE.Camera) {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    let fwd = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    let strafe = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    let up = k('Space') + k('KeyE') - k('ControlLeft') - k('KeyQ');
    let boost = (k('ShiftLeft') || k('ShiftRight') ? 4 : 1) * (k('AltLeft') ? 0.2 : 1);
    const pad = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
    if (pad) {
      fwd -= FlyCam.dead(pad.axes[1] ?? 0); strafe += FlyCam.dead(pad.axes[0] ?? 0);
      this.yaw -= FlyCam.dead(pad.axes[2] ?? 0) * 2.2 * dt;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - FlyCam.dead(pad.axes[3] ?? 0) * 1.8 * dt));
      up += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      if (pad.buttons[5]?.pressed) boost *= 4; if (pad.buttons[4]?.pressed) boost *= 0.2;
    }
    const cp = Math.cos(this.pitch);
    const f = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const v = f.multiplyScalar(fwd).addScaledVector(r, strafe).addScaledVector(new THREE.Vector3(0, 1, 0), up);
    camera.position.addScaledVector(v, this.speed * boost * dt);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
