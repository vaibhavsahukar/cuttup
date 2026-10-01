import * as THREE from 'three';
import { RoadPath, projectToRoad, type Frame } from '../world/RoadPath';
import { ChunkManager } from '../world/ChunkManager';
import { Environment } from '../world/Environment';
import { newRunMap, makeLayout, type Layout, type MapSpec } from '../data/maps';
import { getVehicle, type VehicleSpec } from '../data/vehicles';
import { Player } from './Player';
import type { Controls } from '../physics/VehiclePhysics';
import { Traffic, type TrafficCar, type PlayerProxy } from '../traffic/Traffic';
import { Particles } from './Particles';
import { CrashScene, type CrashKind } from './Crash';
import { Scoring, type Popup } from './Scoring';
import { CameraRig } from './CameraRig';
import type { Input } from '../input/Input';
import type { AudioEngine } from '../audio/AudioEngine';
import { QUALITY, type Settings } from '../storage/Save';
import { clamp } from '../core/math';
import { Police } from '../traffic/Police';
import { randomCrashMessage } from '../data/crashMessages';
import { difficultyOf } from '../data/difficulty';
import { timeSetting } from '../world/TimeOfDay';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface RunResult { prevBest: number; score: number; distance: number; topSpeed: number; nearMisses: number; cutUps: number; time: number; crashKind: CrashKind; message: string; caught: boolean }

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const PHYS_DT = 1 / 240;
/** seconds after a crash before A / Enter can continue (the crash screen's prompt fades in at the same moment) */
export const CRASH_PROMPT_DELAY = 1.2;

/** One run on one map with one vehicle. Owns its scene. */
export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  map: MapSpec; spec: VehicleSpec; layout: Layout;
  path: RoadPath; chunks: ChunkManager; env: Environment;
  player: Player; traffic: Traffic; particles: Particles; crash: CrashScene; scoring: Scoring; rig: CameraRig;
  state: 'countdown' | 'driving' | 'crash' | 'done' = 'countdown';
  countdown = 2.6;
  private proxy: PlayerProxy;
  scrape = 0;
  crashTimer = 0;
  result: RunResult | null = null;
  onPopup: ((p: Popup) => void) | null = null;
  private sGuess = 0;
  gameTime = 0;
  private bumpCd = 0;
  highBeamOn = false;
  /** seconds the player has been scraping a highway wall; five in a row wrecks the run */
  private wallT = 0;
  private wallContact = false;
  /** best score on this map with this vehicle before the run (0 = none), and whether the record popup has been shown */
  prevBest = 0;
  private prDone = false;
  private fireT = 0;
  private boomT = 99;
  private boomLight = new THREE.PointLight(0xff7a22, 0, 90, 2);
  private skidAcc = 0;
  private tmpV = new THREE.Vector3();
  private lampLights: THREE.PointLight[] = [];
  private hornCd = 0;
  police: Police;
  private bloom?: UnrealBloomPass;

  /** push the time of day into everything that depends on light level */
  private applyLight() {
    const n = this.env.nightFactor;
    this.scene.environmentIntensity = (this.map.id === 'city' ? 0.5 : 0.8) * (1 - n) + 0.12 * n;
    this.chunks.lampMaterial.emissiveIntensity = 0.3 + 2.7 * n;
    if (this.chunks.buildingMaterial) this.chunks.buildingMaterial.emissiveIntensity = 0.25 + 0.6 * n;
    for (const l of this.lampLights) l.intensity = 160 * Math.max(0, n - 0.3) / 0.7;
    if (this.player.headlight) this.player.headlight.intensity = (this.map.id === 'forest' ? 220 : 0) + 950 * n;
    this.nightNow = n;
    // fewer cars on the road at night (new spawns; cars already out there drive on)
    this.traffic.density = 1 - 0.4 * n;
    if (this.bloom) { this.bloom.strength = 0.12 + 0.18 * n; this.bloom.threshold = 3 - 1.2 * n; }
  }

  constructor(public renderer: THREE.WebGLRenderer, public audio: AudioEngine, public input: Input, public settings: Settings, mapId: string, vehicleId: string, pmrem: THREE.Texture) {
    const q = QUALITY[settings.quality];
    this.map = newRunMap(mapId);
    this.spec = getVehicle(vehicleId);
    this.layout = makeLayout(this.map.road);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
    this.path = new RoadPath(this.map);
    const tod = timeSetting(settings.timeOfDay, this.map.id);
    this.env = new Environment(this.scene, this.map, tod.hour, tod.cycle, q.shadows, q.drawDist);
    const night = this.env.night;
    this.scene.environment = pmrem;
    this.chunks = new ChunkManager(this.path, this.map, this.layout, { chunksAhead: Math.ceil((this.map.fogFar * q.drawDist) / 64) + 1, propDensity: q.propDensity, shadows: q.shadows });
    this.scene.add(this.chunks.root);
    for (let i = 0; i < 40; i++) this.chunks.update(0);

    this.player = new Player(this.spec, this.path, true, q.shadows);
    this.player.model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = q.shadows; });
    this.scene.add(this.player.model.root);
    const startLane = this.map.road === 'highway' ? 2 : 0;
    this.player.phys.reset(0, this.layout.laneCenter(startLane), 22);
    this.player.phys.setAids({ ...settings.aids, manual: settings.ridingStyle === 'manual' });

    this.traffic = new Traffic(this.path, this.map, this.layout, settings.difficulty, q.drawDist);
    this.traffic.night = night;
    this.scene.add(this.traffic.root);
    this.proxy = { s: 0, d: this.player.phys.d, v: 22, L: this.player.collL, W: this.player.collW, alive: true };
    this.traffic.populate(0);
    this.traffic.prewarm(this.map.road === 'highway' ? 12 : 4);
    this.traffic.onHonk = (c, intensity) => {
      const rel = c.s - this.player.phys.s;
      const dist = Math.hypot(rel, c.d - this.player.phys.d);
      this.audio.honk(intensity * clamp(1 - dist / 120, 0, 1), clamp((this.player.phys.d - c.d) / 10, -1, 1));
    };

    this.particles = new Particles();
    this.scene.add(this.particles.root, this.boomLight);
    const ground = (p: THREE.Vector3) => this.groundAt(p);
    this.particles.groundY = ground;
    this.crash = new CrashScene(this.scene, this.path, this.particles, ground);
    if (this.map.road === 'highway') this.crash.bounds = { min: this.layout.playerMin, max: this.layout.playerMax };
    this.crash.onPileup = (v) => { this.audio.crash(clamp(v / 40, 0.2, 0.7)); this.rig.addShake(0.5); };
    this.police = new Police(this.traffic, this.path, this.map, this.layout, this.particles, ground);
    this.police.diff = difficultyOf(settings.difficulty);
    this.police.onCleared = () => this.onPopup?.({ text: 'WANTED LEVEL CLEARED', sub: 'You lost them', color: '#6cf', big: true });
    this.police.playerIsBike = this.spec.kind === 'bike';
    this.police.onWreck = (k) => { this.audio.crash(k * 0.6); this.onPopup?.({ text: 'COP DOWN', sub: 'another unit is coming', color: '#6cf' }); };
    this.police.onDispatch = (n, charger, moto) => this.onPopup?.({ text: charger ? 'INTERCEPTOR DISPATCHED' : n === 1 ? 'POLICE PURSUIT' : `${n} UNITS IN PURSUIT`, sub: charger ? 'Interceptor unit' : moto ? 'Motorcycle unit' : undefined, color: '#ff4040', big: true });
    this.scoring = new Scoring();
    this.scoring.scoreK = difficultyOf(settings.difficulty).scoreK;
    this.scoring.distK = this.map.road === 'backroad' ? 1.5 : 1;
    this.scoring.onPopup = (p) => this.onPopup?.(p);
    this.rig = new CameraRig(this.camera);
    this.rig.mode = settings.camera;
    this.audio.reset();
    this.audio.startEngine(this.spec);
    this.player.sync(1 / 60);
    this.traffic.sync(0, 0);
    this.applyLight();
    if (settings.quality !== 'low') {
      const size = renderer.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(size, night ? 0.3 : 0.12, 0.35, night ? 1.8 : 3);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    // Warm up before the 3-2-1: compile every shader and upload every buffer now, in one pause before the countdown
    // starts, instead of during the first frames of it (which is where the frame rate used to collapse).
    this.rig.update(1 / 60, this.player, false, 0);
    this.traffic.sync(0, 0);
    this.renderer.compile(this.scene, this.camera);
    for (let i = 0; i < 2; i++) this.render();
  }

  groundAt(p: THREE.Vector3) {
    const pr = projectToRoad(this.path, p, this.sGuess);
    const edge = this.layout.roadHalfWidth - 1;
    return pr.y + (Math.abs(pr.d) > edge ? this.chunks.terrainH(pr.s, pr.d) : 0);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }

  /** returns true while the run continues */
  update(realDt: number) {
    const input = this.input;
    let dt = realDt;
    if (this.state === 'crash') dt = realDt * this.crash.updateTimeScale(realDt);
    this.gameTime += dt;
    if (input.pressed('camera') && this.state !== 'crash') { this.rig.mode = this.rig.mode === 'chase' ? 'hood' : 'chase'; this.settings.camera = this.rig.mode; }

    const p = this.player;
    const ph = p.phys;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'driving';
    }
    if (this.state === 'driving' || this.state === 'countdown') {
      // bikes: holding the (keyboard) brake while accelerating pulls back for a wheelie instead of braking
      const bike = p.bike;
      const keyPull = bike && input.throttle > 0.5 && input.brakeKey > 0.5;
      const c: Controls = this.state === 'countdown'
        ? { throttle: 0.35, brake: 0, steer: 0, handbrake: false }
        : {
          throttle: input.throttle, brake: keyPull ? input.brakePad : input.brake, frontBrake: input.frontBrake, steer: input.steer, handbrake: input.handbrake,
          hang: input.hang, pull: bike ? Math.max(input.wheelie, keyPull ? 1 : 0) : 0,
        };
      // Split the frame into equal sub-steps that add up to exactly this frame's time. A fixed step with a
      // leftover accumulator makes the car's drawn position wobble by up to one step from frame to frame
      // (3 steps one frame, 5 the next), which reads as stutter; equal sub-steps keep physics time == render time.
      let sPrev = ph.s;
      let ds = 0;
      const n = Math.max(1, Math.ceil(dt / PHYS_DT - 1e-6)), h = dt / n;
      for (let i = 0; i < n; i++) {
        p.step(h, c);
        if (ph.fall && this.state === 'driving') { this.startCrash(ph.fall, Math.max(8, ph.speed), null); break; }
        this.edges();
        this.rockHits();
        ds += ph.s - sPrev;
        sPrev = ph.s;
      }
      this.sGuess = ph.s;
      this.proxy.s = ph.s; this.proxy.d = ph.d; this.proxy.v = ph.v;
      if (this.state === 'driving') { this.scoring.update(dt, ds, ph.v); if (p.bike) this.scoring.wheelie(dt, ph.wheelieT, ph.wheelie); }
      this.collide();
      this.nearMisses();
      this.horn(dt);
      this.bumpCd -= dt;
      this.driverAids(dt, realDt);
    } else if (this.state === 'crash') {
      this.crashFx(dt);
      this.proxy.alive = false;
      this.crash.update(dt, this.traffic);
      this.crashTimer += realDt;
      // The wreck plays out and the crash screen stays until the player continues (A or Enter, see continueCrash)
    }

    this.traffic.update(dt, this.proxy, this.scoring.distance);
    this.police.update(dt, this.proxy, ph.dDot, this.scoring.score, this.state === 'driving');
    this.audio.siren(this.police.cops.length > 0 && this.state !== 'done' && !(this.state === 'crash' && this.crashTimer > 6) ? clamp(1 - this.police.nearest(ph.s) / 250, 0.1, 1) : 0);
    this.chunks.update(this.state === 'crash' ? this.crash.wrecks[0]?.s ?? ph.s : ph.s);
    if (this.state !== 'crash') p.sync(dt);
    this.traffic.sync(dt, ph.s);
    this.particles.update(dt);

    if (this.state === 'crash') {
      this.rig.crash(realDt, this.crash.focus, this.crash.camAngle, this.crash.t, this.groundAt(this.crash.focus), this.crash.camSide);
      // keep the cinematic camera on the player's side of the barriers (never inside walls / pillars)
      const pr = projectToRoad(this.path, this.camera.position, this.crash.focus ? this.crash.wrecks[0]?.s ?? ph.s : ph.s);
      const lo = this.map.road === 'highway' ? this.layout.playerMin + 0.6 : -30, hi = this.map.road === 'highway' ? this.layout.playerMax - 0.6 : 30;
      if (pr.d < lo || pr.d > hi) {
        const nd = Math.max(lo, Math.min(hi, pr.d));
        const y = this.camera.position.y;
        this.path.toWorld(pr.s, nd, 0, this.camera.position);
        this.camera.position.y = Math.max(y, this.camera.position.y + 0.6);
        this.camera.lookAt(this.rig.focus);
      }
    } else this.rig.update(realDt, p, input.lookback, input.lookYaw);
    this.env.tick(realDt);
    if (this.env.cycle) this.applyLight();
    this.env.update(this.camera.position, p.model.root.position);
    if (this.lampLights.length) {
      const first = Math.floor((ph.s - 10 - 8) / 32) + 1;
      for (let i = 0; i < this.lampLights.length; i++) {
        const k = first + (i >> 1);
        this.path.toWorld(k * 32 + 8, (i & 1 ? 1 : -1) * 2.9, 10.3, this.lampLights[i].position);
      }
    }
    this.audio.update(ph.rpm, this.state === 'driving' ? ph.throttle : 0.2, Math.abs(ph.v), ph.slip + ph.wheelspin * 0.4 + (ph.onGrass ? 0.2 : 0) * 0, this.scrape, this.state !== 'crash' && this.state !== 'done');
    this.scrape = Math.max(0, this.scrape - realDt * 4);
    return this.state !== 'done';
  }

  nightNow = 0;
  /** high beam toggle, wall scraping, record popup and drift effects: everything that happens only while driving */
  private driverAids(dt: number, realDt: number) {
    const ph = this.player.phys;
    if (this.state === 'driving' && this.input.pressed('highbeam')) this.highBeamOn = !this.highBeamOn;
    const hb = this.highBeamOn && this.state === 'driving';
    if (this.player.highBeam) this.player.highBeam.intensity = hb ? 1500 : 0;
    this.traffic.highBeam = hb;
    // scraping a highway wall for five seconds in a row wrecks you (touching it for a moment does not)
    if (this.map.road === 'highway' && this.state === 'driving' && this.wallContact && ph.speed > 6) {
      this.wallT += realDt;
      if (this.wallT > 5) { this.wallT = 0; this.startCrash('barrier', Math.max(14, ph.speed * 0.6), null); return; }
    } else this.wallT = Math.max(0, this.wallT - realDt * 2);
    this.wallContact = false;
    // beating the previous best on this map and vehicle
    if (!this.prDone && this.prevBest > 0 && this.scoring.score > this.prevBest) {
      this.prDone = true;
      this.onPopup?.({ text: 'NEW PERSONAL BEST', sub: `beat your ${this.prevBest.toLocaleString()}`, color: '#ffd23f', big: true });
    }
    this.driftFx(dt);
  }

  /** tyre smoke and skid marks while the car or bike is sliding sideways (the drift itself is plain physics) */
  private driftFx(dt: number) {
    const ph = this.player.phys;
    const beta = Math.abs(Math.atan2(ph.vl, Math.max(1, Math.abs(ph.v))));
    const thresh = this.player.bike ? 0.12 : 0.15;
    if (beta < thresh || ph.speed < 9 || ph.onGrass) { this.skidAcc = 0; return; }
    const amount = Math.min(1, (beta - thresh) / 0.25 + 0.3);
    const rear = this.player.model.wheels.filter((w) => !w.front);
    this.skidAcc += ph.speed * dt;
    const mark = this.skidAcc > 0.6;
    if (mark) this.skidAcc = 0;
    const vel = this.player.worldVel;
    const yaw = Math.atan2(vel.x, vel.z);
    for (const w of rear) {
      w.obj.getWorldPosition(this.tmpV);
      const gy = this.player.model.root.position.y;
      this.tmpV.y = gy + 0.05;
      this.particles.smoke(this.tmpV, vel, 2, 1.6, 0.45 + 0.25 * amount, 3.4, 0.95);
      if (Math.random() < amount * 25 * dt) this.particles.spark(this.tmpV, vel, 1, 2.5);
      if (mark) { this.tmpV.y = gy + 0.03; this.particles.skids.add(this.tmpV, yaw, 0.9 + ph.speed * 0.03, this.player.bike ? 0.14 : 0.3); }
    }
  }

  /** the fireball light and the fire that keeps burning on a wreck */
  private crashFx(dt: number) {
    this.boomT += dt;
    this.boomLight.intensity = this.boomT < 3 ? 1800 * Math.exp(-this.boomT * 2.6) : 0;
    if (this.fireT > 0) {
      this.fireT -= dt;
      this.tmpV.copy(this.crash.focus); this.tmpV.y += 0.4;
      this.particles.fire(this.tmpV, Math.random() < 0.7 ? 3 : 1);
    }
  }

  /** barriers / road edges */
  private edges() {
    const ph = this.player.phys;
    const L = this.layout;
    const half = this.player.collW / 2;
    ph.onGrass = ph.d < L.softMin || ph.d > L.softMax;
    const lo = L.playerMin + half, hi = L.playerMax - half;
    if (ph.d <= lo + 0.1 || ph.d >= hi - 0.1) this.wallContact = true;
    if (ph.d < lo || ph.d > hi) {
      const side = ph.d < lo ? -1 : 1;
      const into = ph.dDot * side; // speed into the wall
      const speed = Math.abs(ph.v);
      const angle = Math.abs(Math.sin(ph.psi));
      ph.d = side < 0 ? lo : hi;
      const hard = this.map.road === 'backroad'; // trees
      if ((into > 9 && speed > 22) || (hard && into > 5 && speed > 14) || (angle > 0.5 && speed > 25)) {
        this.startCrash(hard ? 'tree' : 'barrier', Math.max(into * 1.6, speed * 0.5), null);
        return;
      }
      // glance off: kill lateral velocity into the wall, scrub speed, straighten
      ph.psi *= 0.6;
      ph.vl *= -0.2;
      ph.r *= 0.5;
      ph.v *= 1 - clamp(into * 0.012, 0.002, 0.2);
      this.scrape = Math.min(1, 0.4 + into * 0.1);
      if (into > 1.5 && this.bumpCd <= 0) { this.audio.thud(clamp(into / 8, 0.2, 1)); this.rig.addShake(0.3); this.scoring.bump(); this.bumpCd = 0.5; }
      if (Math.random() < 0.5) {
        const pos = this.player.model.root.position.clone();
        const right = new THREE.Vector3(-Math.cos(this.path.frame(ph.s, fr).heading), 0, Math.sin(fr.heading));
        pos.addScaledVector(right, side * half).y += 0.3;
        this.particles.spark(pos, this.player.worldVel, 3, 3);
      }
      if (into > 3 && this.bumpCd <= 0) { this.audio.thud(into / 10); this.rig.addShake(0.4); this.scoring.bump(); this.bumpCd = 0.5; }
    }
  }

  /** player vs the roadside rocks: a solid hit at speed ends the run, a glancing one scrapes and slows */
  private rockHits() {
    if (this.state !== 'driving' || this.map.road !== 'backroad') return;
    const ph = this.player.phys;
    const rocks = this.chunks.rocksNear(ph.s, 14);
    if (!rocks.length) return;
    const pL = this.player.collL / 2, pW = this.player.collW / 2;
    const ca = Math.cos(ph.psi), sa = Math.sin(ph.psi); // player forward axis in (s, d) is (cos, -sin)
    const pvS = ph.v * ca - ph.vl * sa, pvD = ph.dDot;
    for (const r of rocks) {
      const dS = r.s - ph.s, dD = r.d - ph.d;
      const u = dS * ca - dD * sa, w = dS * sa + dD * ca; // rock centre in the player's frame
      const cu = clamp(u, -pL, pL), cw = clamp(w, -pW, pW);
      const gx = u - cu, gy = w - cw;
      const dist = Math.hypot(gx, gy);
      if (dist >= r.r) continue;
      // contact normal pointing from the player to the rock, back in road coordinates
      let nu = gx, nw = gy;
      if (dist < 1e-4) { nu = u; nw = w; }
      const nl = Math.hypot(nu, nw) || 1; nu /= nl; nw /= nl;
      const nS = nu * ca + nw * sa, nD = -nu * sa + nw * ca;
      const into = pvS * nS + pvD * nD; // speed into the rock
      if (into > 4.5 || (into > 2.5 && Math.abs(ph.v) > 20)) { this.startCrash('rock', Math.max(into * 1.6, Math.abs(ph.v) * 0.5), null); return; }
      // a scrape: push clear of the rock, lose a little speed
      const push = r.r - dist;
      ph.s -= nS * push; ph.d -= nD * push;
      ph.v *= 1 - clamp(0.0012 + Math.max(0, into) * 0.006, 0, 0.08); // runs every physics step
      ph.psi *= 0.9;
      this.scrape = Math.min(1, 0.4 + Math.max(0, into) * 0.1);
      if (into > 1.5 && this.bumpCd <= 0) { this.audio.thud(clamp(into / 8, 0.2, 1)); this.rig.addShake(0.4); this.scoring.bump(); this.bumpCd = 0.5; }
    }
  }

  /** player vs traffic, SAT on oriented boxes in road coordinates */
  private collide() {
    const ph = this.player.phys;
    const pL = this.player.collL / 2, pW = this.player.collW / 2;
    const pa = [Math.cos(ph.psi), -Math.sin(ph.psi)]; // (s,d) forward axis
    const pb = [-pa[1], pa[0]];
    const pvS = ph.v * Math.cos(ph.psi) - ph.vl * Math.sin(ph.psi), pvD = ph.dDot;
    for (const c of this.traffic.cars) {
      if (!c.alive || c.wrecked) continue;
      const dS = c.s - ph.s, dD = c.d - ph.d;
      if (Math.abs(dS) > 10 || Math.abs(dD) > 5) continue;
      const ca = [Math.cos(c.yaw), -Math.sin(c.yaw)];
      const cb = [-ca[1], ca[0]];
      let minOv = 1e9, nS = 0, nD = 0;
      let sep = false;
      for (const ax of [pa, pb, ca, cb]) {
        const dist = Math.abs(dS * ax[0] + dD * ax[1]);
        const rp = pL * Math.abs(pa[0] * ax[0] + pa[1] * ax[1]) + pW * Math.abs(pb[0] * ax[0] + pb[1] * ax[1]);
        const rc = (c.L / 2) * Math.abs(ca[0] * ax[0] + ca[1] * ax[1]) + (c.W / 2) * Math.abs(cb[0] * ax[0] + cb[1] * ax[1]);
        const ov = rp + rc - dist;
        if (ov <= 0) { sep = true; break; }
        if (ov < minOv) { minOv = ov; const sg = Math.sign(dS * ax[0] + dD * ax[1]) || 1; nS = ax[0] * sg; nD = ax[1] * sg; }
      }
      if (sep) continue;
      // relative velocity along the contact normal (player -> car)
      const rvS = pvS - c.v * c.dir, rvD = pvD;
      const vn = rvS * nS + rvD * nD;
      const rel = Math.hypot(rvS, rvD);
      // only a hard hit wrecks: a gentle nudge or a low speed scrape is a bump (and resets the combo)
      if (vn > 6.5 || rel > 15 || (c.dir < 0 && rel > 12)) {
        this.startCrash(c.dir < 0 ? 'headon' : 'car', Math.max(vn, rel * 0.8), c);
        return;
      }
      // light bump: separate and exchange a little speed
      ph.s -= nS * minOv * 0.6; ph.d -= nD * minOv * 0.6;
      c.s += nS * minOv * 0.4; c.d += nD * minOv * 0.4;
      ph.v -= Math.max(0, vn) * nS * 0.8;
      ph.vl += nD * vn * 0.5;
      c.v = Math.max(0, c.v + Math.max(0, vn) * nS * 0.4);
      c.panicT = 1.2; c.swerveTarget = Math.sign(nD) * 0.8;
      this.scoring.bump(); // the streak resets on every bump, even in the cooldown
      if (this.bumpCd <= 0) { this.audio.thud(0.5); this.rig.addShake(0.5); this.bumpCd = 0.6; this.traffic.onHonk?.(c, 1); }
    }
  }

  /** player horn: scared drivers just ahead flinch */
  private horn(dt: number) {
    this.hornCd -= dt;
    if (!this.input.horn || this.hornCd > 0) return;
    this.hornCd = 0.45;
    this.audio.honk(0.9, 0);
    const ph = this.player.phys;
    for (const c of this.traffic.cars) {
      if (c.wrecked || c.dir < 0 || c.driver !== 'scared') continue;
      const rel = c.s - ph.s;
      if (rel > 0 && rel < 45 && c.panicT <= 0) { c.panicT = 1; c.swerveTarget = (Math.sign(c.d - ph.d) || 1) * 0.8; }
    }
  }

  private nearMisses() {
    const ph = this.player.phys;
    if (this.state !== 'driving' || Math.abs(ph.v) < 15) return;
    for (const c of this.traffic.cars) {
      if (!c.alive || c.wrecked) continue;
      const rel = c.s - ph.s;
      const sign = Math.sign(rel);
      if (c.passedSign !== 0 && sign !== c.passedSign && !c.nearMissed && Math.abs(rel) < 8) {
        const relSpeed = c.dir > 0 ? ph.v - c.v : ph.v + c.v;
        const clearance = Math.abs(c.d - ph.d) - (c.W + this.player.collW) / 2;
        // Oncoming cars pass close by just because you are in your own lane (the backroad is two lanes wide), so
        // they only count when you deliberately hug the centre line; otherwise the backroad out-scores every map.
        const limit = c.dir < 0 ? 0.6 : 1.4;
        if (relSpeed > 4 && clearance > -0.05 && clearance < limit && c.passedSign > 0) {
          c.nearMissed = true;
          this.scoring.nearMiss(Math.max(0, clearance), relSpeed, c.dir < 0);
          this.audio.whoosh(relSpeed / 30);
          this.rig.addShake(0.25);
        }
      }
      c.passedSign = sign;
    }
  }

  startCrash(kind: CrashKind, impact: number, hit: TrafficCar | null) {
    if (this.state === 'crash' || this.state === 'done') return;
    this.state = 'crash';
    this.crashTimer = 0;
    const ph = this.player.phys;
    this.player.sync(1 / 60);
    const contact = this.player.model.root.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    if (hit) {
      const hp = this.path.toWorld(hit.s, hit.d, 0.6, new THREE.Vector3());
      contact.lerp(hp, 0.5);
    }
    this.crash.start(this.player, kind, impact, hit, this.traffic, contact);
    this.rig.snapCrash(this.crash.focus, this.crash.camAngle);
    this.rig.addShake(0.8);
    this.audio.stopEngine();
    this.audio.crash(clamp(impact / 30, 0.4, 1.5));
    // a really bad one ends in a fireball
    const fall = ['lowside', 'highside', 'looped', 'endo', 'tipover'].includes(kind);
    if (impact > (fall ? 55 : 38) && kind !== 'rock') {
      const power = clamp((impact - 30) / 30, 0.8, 2);
      this.particles.explode(contact, power);
      this.audio.explosion();
      this.rig.addShake(1.5);
      this.boomT = 0; this.fireT = 9;
      this.boomLight.position.copy(contact); this.boomLight.position.y += 1.5;
    }
    // hitting traffic gets a line about the other people; a solo crash gets one about you
    const message = randomCrashMessage({ map: this.map.id, kind, victim: hit?.type, cop: !!hit?.cop, wanted: this.police.wanted > 0, bike: this.player.bike });
    const caught = !!hit?.cop && (kind === 'car' || kind === 'headon');
    this.onCrash?.(message, caught);
    this.result = {
      score: Math.round(this.scoring.score), distance: this.scoring.distance, topSpeed: this.player.topSpeed,
      nearMisses: this.scoring.nearMisses, cutUps: this.scoring.cutUps, time: this.scoring.time, crashKind: kind, message, caught, prevBest: this.prevBest,
    };
    void ph;
  }
  onCrash: ((message: string, caught: boolean) => void) | null = null;

  finish() { this.state = 'done'; }
  /** the player pressed A / Enter on the crash screen; ignored for the first moments so a mashed button cannot skip the impact */
  continueCrash() { if (this.state === 'crash' && this.crashTimer > CRASH_PROMPT_DELAY) this.finish(); }

  /** bloom on lights / sun glints, then tone mapping + sRGB via OutputPass */
  private composer?: EffectComposer;
  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    this.audio.stopEngine();
    this.crash.clear();
    this.police.clear();
    this.audio.siren(0);
    this.traffic.clear();
    this.chunks.dispose();
    this.env.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose?.(); });
  }
}
