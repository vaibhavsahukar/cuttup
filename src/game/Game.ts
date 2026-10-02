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
import { Haptics } from '../input/Haptics';
import type { AudioEngine } from '../audio/AudioEngine';
import { QUALITY, type Settings } from '../storage/Save';
import { clamp, smoothstep } from '../core/math';
import { Police } from '../traffic/Police';
import { randomCrashMessage } from '../data/crashMessages';
import { difficultyOf } from '../data/difficulty';
import { Weather } from '../world/Weather';
import { Features } from '../world/Features';
import { StationRenderer } from '../world/Stations';
import { Fork, FORK_SPAN, COMMIT_X, type DeckCar } from '../world/Fork';
import { FlyCam } from '../dev/FlyCam';
import { type ChunkMods } from '../world/ChunkManager';
import { timeSetting } from '../world/TimeOfDay';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface RunResult { prevBest: number; score: number; distance: number; topSpeed: number; nearMisses: number; cutUps: number; time: number; crashKind: CrashKind; message: string; caught: boolean; electric?: boolean }

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
  readonly haptics = new Haptics();
  private cdLast = -1;
  crashTimer = 0;
  result: RunResult | null = null;
  onPopup: ((p: Popup) => void) | null = null;
  private sGuess = 0;
  gameTime = 0;
  private bumpCd = 0;
  highBeamOn = false;
  private headBase = 0;
  /** seconds the player has been scraping a highway wall; five in a row wrecks the run */
  private wallT = 0;
  private wallContact = false;
  /** best score on this map with this vehicle before the run (0 = none), and whether the record popup has been shown */
  prevBest = 0;
  private prDone = false;
  private fireT = 0;
  private boomT = 99;
  private boomLight = new THREE.PointLight(0xff7a22, 0, 90, 2);
  weather: Weather;
  features: Features;
  stations: StationRenderer;
  /** fuel left, 0..1 (a full tank lasts roughly 7 to 8 miles of hard driving) */
  fuel = 1;
  /** the tank empties faster on the harder difficulties */
  private fuelBurn = 1;
  /** what the fuel gauge says at a gas station: filling at the pump, or filled (until you have left the pumps) */
  fuelStatus: 'filling' | 'filled' | null = null;
  /** an electric car: the "fuel" is a battery (10 miles), recharged in 20 seconds stopped beside the green pump */
  get electric() { return !!this.player.spec.electric; }
  private evDead = false;
  private pumpAway = 99; // seconds since the car was last in a pump lane
  private tankFullShown = false;
  private lowFuelWarned = false;
  private stallT = 0;
  /** the run ended because the tank ran dry (the car just sits there; no crash cinematic) */
  stalled = false;
  /** the fork being approached or driven through, the new highway's scenery, and road scenery on its way out */
  fork: Fork | null = null;
  private branchChunks: ChunkManager | null = null;
  private oldChunks: { cm: ChunkManager; until: number }[] = [];
  /** interchange bridges standing in the world until the player is well past them */
  private bridges: { g: THREE.Group; until: number; fk: Fork }[] = [];
  /** the fork whose branch the active scenery belongs to (its folded start shapes it) */
  private chunksFork: Fork | null = null;
  private quality!: { chunksAhead: number; propDensity: number; shadows: boolean };
  private skidAcc = 0;
  /** seconds into the current burnout, and the timer that lays the tyre marks */
  private burnT = 0;
  private burnPopped = false;
  private markT = 0;
  private tmpF = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private lampLights: THREE.PointLight[] = [];
  private hornCd = 0;
  police: Police;
  private bloom?: UnrealBloomPass;

  /** push the time of day into everything that depends on light level */
  private applyLight() {
    const n = this.env.nightFactor;
    this.scene.environmentIntensity = (this.map.id === 'city' ? 0.5 : 0.8) * (1 - n) + 0.12 * n;
    for (const cm of this.allChunks()) {
      cm.lampMaterial.emissiveIntensity = 0.3 + 2.7 * n;
      if (cm.buildingMaterial) cm.buildingMaterial.emissiveIntensity = 0.25 + 0.6 * n;
    }
    for (const l of this.lampLights) l.intensity = 160 * Math.max(0, n - 0.3) / 0.7;
    // headlights: 30% dimmer than they were; the high beam replaces them while it is on
    this.headBase = ((this.map.id === 'forest' ? 220 : 0) + 950 * n) * 0.7;
    if (this.player.headlight) this.player.headlight.intensity = this.highBeamOn && this.state === 'driving' ? 0 : this.headBase;
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
    this.weather = new Weather(settings.difficulty === 0 ? 'clear' : (settings.weather ?? 'changing')) // easy mode is always dry;
    this.scene.add(this.weather.lines);
    const night = this.env.night;
    this.scene.environment = pmrem;
    // where the run starts: at a gas station on the city and countryside highways, in a roadside lot on the backroad
    const startAtStation = true;
    this.features = new Features(this.map, this.layout, null);
    const startPose = startAtStation ? this.features.startPose({ s0: 0, ramp: this.map.road === 'highway' }) : null;
    if (startPose) this.features = new Features(this.map, this.layout, -startPose.x);
    this.stations = new StationRenderer(this.path, this.features);
    this.scene.add(this.stations.root);
    this.quality = { chunksAhead: Math.ceil((this.map.fogFar * q.drawDist) / 64) + 1, propDensity: q.propDensity, shadows: q.shadows };
    this.chunks = new ChunkManager(this.path, this.map, this.layout, this.quality, this.features, this.chunkMods(null));
    this.scene.add(this.chunks.root);
    for (let i = 0; i < 40; i++) this.chunks.update(0);

    this.player = new Player(this.spec, this.path, true, q.shadows);
    this.player.model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = q.shadows; });
    this.scene.add(this.player.model.root);
    // a standing start
    const startD = startPose ? startPose.d : this.layout.playerMax - 1.6;
    this.player.phys.reset(0, startD, 0);
    this.player.phys.setAids({ ...settings.aids, manual: settings.ridingStyle === 'manual' });

    this.traffic = new Traffic(this.path, this.map, this.layout, settings.difficulty, q.drawDist);
    this.traffic.night = night;
    this.scene.add(this.traffic.root);
    this.stations.update(0);
    this.proxy = { s: 0, d: this.player.phys.d, v: 0, L: this.player.collL, W: this.player.collW, alive: true };
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
    if (this.map.road === 'highway') this.crash.range = (s2, d2) => this.driveRange(s2, d2, this.layout.playerMin, this.layout.playerMax);
    this.crash.onPileup = (v) => { this.audio.crash(clamp(v / 40, 0.2, 0.7)); this.rig.addShake(0.5); };
    this.police = new Police(this.traffic, this.path, this.map, this.layout, this.particles, ground);
    this.police.diff = difficultyOf(settings.difficulty);
    // cops drive wherever the player can: into gas stations, up the fork's ramp
    this.police.range = (s2, d2, lo, hi) => this.driveRange(s2, d2, lo, hi);
    this.police.onRage = (on) => this.onPopup?.(on ? { text: 'ROAD RAGE!', sub: 'The driver you cut off is coming after you', color: '#ff7a1a', big: true } : { text: 'THEY GAVE UP', sub: 'Road rage over', color: '#9ad' });
    this.police.onCleared = () => this.onPopup?.({ text: 'WANTED LEVEL CLEARED', sub: 'You lost them', color: '#6cf', big: true });
    this.police.playerIsBike = this.spec.kind === 'bike';
    this.police.onWreck = (k, copDown) => { this.audio.crash(k * 0.6); if (copDown) this.onPopup?.({ text: 'COP DOWN', sub: 'another unit is coming', color: '#6cf' }); };
    this.police.onDispatch = (n, kind) => this.onPopup?.({ text: kind === 'interceptor' ? 'INTERCEPTOR DISPATCHED' : this.map.road === 'backroad' ? 'POLICE PURSUIT' : n === 1 ? 'POLICE PURSUIT' : `${n} UNITS IN PURSUIT`, sub: kind === 'interceptor' ? 'Conquette interceptor' : kind === 'samurai' ? 'Samurai motorcycle unit' : kind === 'moto' ? 'Motorcycle unit' : undefined, color: '#ff4040', big: true });
    this.scoring = new Scoring();
    this.scoring.scoreK = difficultyOf(settings.difficulty).scoreK;
    this.fuelBurn = difficultyOf(settings.difficulty).fuelBurn;
    this.scoring.distK = this.map.road === 'backroad' ? 3 : 1;
    this.scoring.passK = this.map.road === 'backroad' ? 2.5 : 1;
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
      const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: settings.quality === 'medium' ? 2 : 4 });
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
    if (this.dev) return this.devStep(realDt);
    let dt = realDt;
    if (this.state === 'crash') dt = realDt * this.crash.updateTimeScale(realDt);
    this.gameTime += dt;
    if (input.pressed('camera') && this.state !== 'crash') { this.rig.mode = this.rig.mode === 'chase' ? 'hood' : this.rig.mode === 'hood' ? 'far' : 'chase'; this.settings.camera = this.rig.mode; }

    const p = this.player;
    const ph = p.phys;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      // a tick of rumble on each of 3, 2, 1 and a firmer one on GO
      const cd = Math.max(0, Math.ceil(this.countdown));
      if (cd !== this.cdLast) { this.haptics.pulse(cd > 0 ? 0.2 : 0.42, cd > 0 ? 0.28 : 0.42, cd > 0 ? 0.14 : 0.3); this.cdLast = cd; }
      if (this.countdown <= 0) this.state = 'driving';
    }
    if (this.state === 'driving' || this.state === 'countdown') {
      // bikes: holding the (keyboard) brake while accelerating pulls back for a wheelie instead of braking
      const bike = p.bike;
      const keyPull = bike && input.throttle > 0.5 && input.brakeKey > 0.5;
      const c: Controls = this.state === 'countdown'
        ? { throttle: 0, brake: 0.45, frontBrake: 0.45, steer: 0, handbrake: false } // held on the brakes (a full pedal at a standstill would select reverse)
        : {
          throttle: this.fuel > 0 ? input.throttle : 0,
          // parked with no pedal pressed: the brakes hold the car (no rolling back down a slope)
          ...(input.throttle < 0.05 && input.brake < 0.05 && Math.abs(ph.v) < 1 ? { brake: 0.35 } : {}), brake: keyPull ? input.brakePad : input.brake, frontBrake: input.frontBrake, steer: input.steer, handbrake: input.handbrake,
          hang: input.hang, pull: bike && input.push < 0.3 ? Math.max(input.wheelie, keyPull ? 1 : 0) : 0, push: bike ? input.push : 0,
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
      this.fuelStep(dt, ds);
    } else if (this.state === 'crash') {
      this.crashFx(dt);
      this.proxy.alive = false;
      if (!this.stalled) this.crash.update(dt, this.traffic);
      else this.stallWait(dt);
      this.crashTimer += realDt;
      // The wreck plays out and the crash screen stays until the player continues (A or Enter, see continueCrash)
    }

    this.traffic.update(dt, this.proxy, this.scoring.distance);
    this.police.update(dt, this.proxy, ph.dDot, this.scoring.score, this.state === 'driving');
    this.audio.siren(this.police.cops.length > 0 && this.state !== 'done' && !(this.state === 'crash' && this.crashTimer > 6) ? clamp(1 - this.police.nearest(ph.s) / 250, 0.1, 1) : 0);
    this.chunks.update(this.state === 'crash' && !this.stalled ? this.crash.wrecks[0]?.s ?? ph.s : ph.s);
    this.stations.update(ph.s);
    this.forkStep(ph.s);
    if (this.state !== 'crash') p.sync(dt);
    this.deckTraffic(dt);
    this.traffic.sync(dt, ph.s);
    this.particles.update(dt);

    if (this.state === 'crash' && !this.stalled) {
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
    this.ambient(realDt, ph.s, p.model.root.position);
    this.audio.update(ph.rpm, this.state === 'driving' ? ph.throttle : 0.2, Math.abs(ph.v), ph.slip + ph.wheelspin * 0.4 + ph.burnout * 0.5, this.scrape, this.state !== 'crash' && this.state !== 'done');
    // rumble: shake on the grass (not when stopped), grinding along a wall, a juddering slide, and a bike leaning hard
    const live = this.state === 'driving';
    const moving = Math.abs(ph.v) > 2;
    const spdK = clamp(Math.abs(ph.v) / 45, 0.25, 1);
    // lean: nothing until it is well past a normal corner, then rising with the angle
    const leanK = ph.bike ? clamp((Math.abs(ph.bikeLean) - 0.5) / 0.45, 0, 1) : 0;
    this.haptics.enabled = this.settings.vibration !== false;
    // everything here is a further 30% down (20% before that) (wall grinding goes with the bumps and stays as it was)
    const brakeK = live && Math.abs(ph.v) > 5 ? clamp(Math.max(input.brake, input.frontBrake), 0, 1) : 0;
    this.haptics.set(live ? clamp(this.scrape * 0.7 + (ph.onGrass && moving ? 0.14 * spdK : 0) + clamp(ph.slip, 0, 1) * 0.14 + brakeK * 0.021 + ph.burnout * 0.12, 0, 1) : 0,
      live ? clamp((ph.onGrass && moving ? 0.112 * spdK : 0) + (moving ? leanK * 0.196 : 0) + brakeK * 0.035 + ph.burnout * 0.1, 0, 0.6) : 0);
    this.haptics.update(realDt);
    this.scrape = Math.max(0, this.scrape - realDt * 4);
    return this.state !== 'done';
  }


  /** time of day, weather, sky and lamp lights: everything that carries on around the camera */
  private ambient(realDt: number, sView: number, focus: THREE.Vector3) {
    const p = this.player;
    this.env.tick(realDt);
    // weather: rain builds and eases off; grip, sky, fog, the road surface and the sound all follow it
    this.weather.update(realDt, this.camera.position, this.player.worldVel, () => this.audio.thunder());
    const w = this.weather.wet;
    if (Math.abs(w - this.env.wet) > 0.002 || this.weather.flash > 0) {
      this.env.wet = w;
      this.env.applyHour();
      this.env.hemi.intensity += this.weather.flash * 2.5;
      for (const cm of this.allChunks()) { const rm = cm.roadMat; rm.roughness = 0.92 - 0.5 * w; rm.metalness = 0.12 * w; rm.color.setScalar(1 - 0.3 * w); }
      this.applyLight();
    } else if (this.env.cycle) this.applyLight();
    this.player.phys.gripScale = this.weather.grip;
    this.traffic.wet = w;
    this.audio.rain(this.state === 'done' ? 0 : w);
    this.env.update(this.camera.position, focus);
    if (this.lampLights.length) {
      const first = Math.floor((sView - 10 - 8) / 32) + 1;
      for (let i = 0; i < this.lampLights.length; i++) {
        const k = first + (i >> 1);
        this.path.toWorld(k * 32 + 8, (i & 1 ? 1 : -1) * 2.9, 10.3, this.lampLights[i].position);
      }
    }
  }

  /** DEV MODE: a free flying camera over a frozen world (the map still builds around the camera) */
  dev = false;
  private fly = new FlyCam();
  setDev(on: boolean) {
    if (on === this.dev) return;
    this.dev = on;
    if (on) this.fly.enable(this.camera, this.renderer.domElement); else { this.fly.disable(); this.env.fogMul = 1; this.env.applyHour(); this.rig.update(1 / 60, this.player, false, 0); }
  }
  private devStep(realDt: number) {
    if (this.fly.taps.has('KeyF')) { this.env.fogMul = this.env.fogMul > 1 ? 1 : 12; this.env.applyHour(); }
    this.fly.taps.clear();
    this.fly.update(realDt, this.camera);
    const pr = projectToRoad(this.path, this.camera.position, this.sGuess);
    this.sGuess = pr.s;
    this.chunks.update(pr.s);
    this.stations.update(pr.s);
    this.forkStep(pr.s, true);
    this.ambient(realDt, pr.s, this.camera.position);
    this.audio.update(0, 0, 0, 0, 0, false);
    return true;
  }

  nightNow = 0;
  /** high beam toggle, wall scraping, record popup and drift effects: everything that happens only while driving */
  private driverAids(dt: number, realDt: number) {
    const ph = this.player.phys;
    if (this.state === 'driving' && this.input.pressed('highbeam')) this.highBeamOn = !this.highBeamOn;
    const hb = this.highBeamOn && this.state === 'driving';
    if (this.player.highBeam) this.player.highBeam.intensity = hb ? 1500 : 0;
    if (this.player.headlight) this.player.headlight.intensity = hb ? 0 : this.headBase;
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

  /** a burnout: thick white smoke off the driven tyres, black tyre marks laid on the road, a popup after a moment */
  private burnoutFx(dt: number) {
    const ph = this.player.phys, drive = this.player.spec.drive;
    this.burnT += dt;
    if (this.burnT > 1.2 && !this.burnPopped) { this.burnPopped = true; this.onPopup?.({ text: 'BURNOUT', color: '#ff9a3d' }); }
    this.markT -= dt;
    const mark = this.markT <= 0;
    if (mark) this.markT = 0.04;
    const root = this.player.model.root;
    this.tmpF.set(0, 0, 1).applyQuaternion(root.quaternion);
    const yaw = Math.atan2(this.tmpF.x, this.tmpF.z);
    const vel = this.player.worldVel;
    for (const w of this.player.model.wheels) {
      if (!(drive === 'AWD' || (drive === 'FWD' ? w.front : !w.front))) continue;
      w.obj.getWorldPosition(this.tmpV);
      this.tmpV.y = root.position.y + 0.05;
      this.particles.smoke(this.tmpV, vel, Math.random() < 0.6 ? 2 : 1, 1.4, 0.4, 4, 0.92);
      this.particles.darkSpark(this.tmpV, vel, 2, 2.5);
      if (mark) { this.tmpV.y = root.position.y + 0.02; this.particles.skids.add(this.tmpV, yaw, 0.75, 0.3); }
    }
  }

  /** tyre smoke and skid marks while the car or bike is sliding sideways (the drift itself is plain physics) */
  private driftFx(dt: number) {
    const ph = this.player.phys;
    if (ph.burnout > 0.3) this.burnoutFx(dt); else { this.burnT = 0; this.burnPopped = false; }
    const beta = Math.abs(Math.atan2(ph.vl, Math.max(1, Math.abs(ph.v))));
    const thresh = this.player.bike ? 0.12 : 0.15;
    if (beta < thresh || ph.speed < 9 || ph.onGrass) { this.skidAcc = 0; return; }
    const amount = Math.min(1, (beta - thresh) / 0.25 + 0.3);
    const rear = this.player.model.wheels.filter((w) => !w.front);
    const vel = this.player.worldVel;
    for (const w of rear) {
      w.obj.getWorldPosition(this.tmpV);
      const gy = this.player.model.root.position.y;
      this.tmpV.y = gy + 0.05;
      // black sparks flying off the tyres, the same spray as scraping a wall but dark
      this.particles.darkSpark(this.tmpV, vel, Math.round(1 + amount * 3), 3.5);
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

  /** fuel use, refuelling in the pump lane, the low fuel warning, and running dry */
  private fuelStep(dt: number, ds: number) {
    const ph = this.player.phys;
    if (this.state !== 'driving') return;
    if (this.electric) { this.batteryStep(dt, ds); return; }
    const range = this.player.bike ? 14500 : 15600; // metres on a tank at the base burn rate: about 7 to 8 miles driven hard
    // the pump lane fills the tank quickly at anything under about 50 mph (no need to stop)
    const inLane = this.features.inRefuel(ph.s, ph.d);
    const atPump = inLane && Math.abs(ph.v) < 22;
    if (ph.burnout > 0.3) this.fuel = Math.max(0, this.fuel - dt * 0.008 * this.fuelBurn); // a burnout drinks fuel
    if (!atPump) this.fuel = Math.max(0, this.fuel - (Math.max(0, ds) / range) * (0.5 + 0.8 * ph.throttle) * this.fuelBurn - dt * 0.0003);
    else if (this.fuel < 1) {
      this.fuel = 1; // instant: the tank fills the moment you reach the pumps
      // one TANK FULL per visit to the pumps
      if (this.fuel >= 1 && !this.tankFullShown) { this.tankFullShown = true; this.onPopup?.({ text: 'TANK FULL', color: '#4dff88' }); }
    }
    this.pumpAway = inLane ? 0 : this.pumpAway + dt;
    if (this.pumpAway > 3) this.tankFullShown = false;
    this.fuelStatus = atPump && this.fuel < 0.999 ? 'filling' : this.fuel >= 0.995 && this.pumpAway < 3 ? 'filled' : null;
    if (this.fuel > 0.4) this.lowFuelWarned = false;
    if (!this.lowFuelWarned && this.fuel < 0.25) {
      this.lowFuelWarned = true;
      this.onPopup?.({ text: 'LOW FUEL', sub: 'take the next gas station exit', color: '#ffb020', big: true });
    }
    // out of gas: the engine cuts and the car coasts (a dead engine drags it down within about 20 seconds); once it
    // stops the run is over (the cops collect you if you are wanted)
    if (this.fuel <= 0) ph.v = Math.sign(ph.v) * Math.max(0, Math.abs(ph.v) - 1.1 * dt);
    if (this.fuel <= 0 && Math.abs(ph.v) < 0.8) {
      if (this.police.wanted <= 0) this.stall(false);
      else { this.stallT += dt; if (this.police.nearest(ph.s) < 14 || this.stallT > 25) this.stall(true); }
    }
  }
  /** the battery: about 10 miles of driving, drained like the tank; stopped beside the green pump it recharges in 20 seconds */
  private batteryStep(dt: number, ds: number) {
    const ph = this.player.phys;
    const range = 17200; // metres at the base drain rate: about 10 miles
    const stopped = Math.abs(ph.v) < 0.8 && ph.burnout < 0.1;
    const atCharger = stopped && !this.evDead && this.features.inCharger(ph.s, ph.d);
    if (atCharger) {
      if (this.fuel < 1) this.fuel = Math.min(1, this.fuel + dt / 20);
      if (this.fuel >= 1 && !this.tankFullShown) { this.tankFullShown = true; this.onPopup?.({ text: 'FULLY CHARGED', color: '#4dff88' }); }
    } else {
      if (ph.burnout > 0.3) this.fuel = Math.max(0, this.fuel - dt * 0.008 * this.fuelBurn);
      this.fuel = Math.max(0, this.fuel - (Math.max(0, ds) / range) * (0.5 + 0.8 * ph.throttle) * this.fuelBurn - dt * 0.0003);
    }
    if (this.fuel <= 0) this.evDead = true;
    const inLane = this.features.inRefuel(ph.s, ph.d);
    this.pumpAway = inLane ? 0 : this.pumpAway + dt;
    if (this.pumpAway > 3 || this.fuel < 0.98) this.tankFullShown = false;
    this.fuelStatus = atCharger ? (this.fuel < 0.999 ? 'filling' : 'filled') : this.fuel >= 0.995 && this.pumpAway < 3 ? 'filled' : null;
    if (this.fuel > 0.4) this.lowFuelWarned = false;
    if (!this.lowFuelWarned && this.fuel < 0.25) {
      this.lowFuelWarned = true;
      this.onPopup?.({ text: 'LOW BATTERY', sub: 'find the green pump at the next station', color: '#ffb020', big: true });
    }
    // flat: the motor cuts and the car coasts to a stop, which ends the run (no recharging once it is dead)
    if (this.fuel <= 0) ph.v = Math.sign(ph.v) * Math.max(0, Math.abs(ph.v) - 1.1 * dt);
    if (this.fuel <= 0 && Math.abs(ph.v) < 0.8) {
      if (this.police.wanted <= 0) this.stall(false);
      else { this.stallT += dt; if (this.police.nearest(ph.s) < 14 || this.stallT > 25) this.stall(true); }
    }
  }
  /** while stalled with a wanted level the run waits for a cop to roll up (handled in stall itself) */
  private stallWait(dt: number) { void dt; }
  private stall(caught: boolean) {
    if (this.state !== 'driving') return;
    this.state = 'crash';
    this.stalled = true;
    this.crashTimer = 0;
    this.audio.stopEngine();
    const message = randomCrashMessage({ map: this.map.id, kind: 'fuel', cop: caught, bike: this.player.bike, wanted: caught, ev: this.electric });
    this.onCrash?.(message, caught, caught ? 'CAUGHT' : this.electric ? 'OUT OF CHARGE' : 'OUT OF GAS');
    this.result = {
      score: Math.round(this.scoring.score), distance: this.scoring.distance, topSpeed: this.player.topSpeed,
      nearMisses: this.scoring.nearMisses, cutUps: this.scoring.cutUps, time: this.scoring.time, crashKind: 'fuel', message, caught, prevBest: this.prevBest, electric: this.electric,
    };
  }

  /** every scenery manager alive (active, the branch being approached, roads on their way out) */
  private allChunks() {
    const out = [this.chunks];
    if (this.branchChunks) out.push(this.branchChunks);
    for (const o of this.oldChunks) out.push(o.cm);
    return out;
  }

  /**
   * Scenery adjustments for a road. `own` = the fork this road is the branch of (fold its left side until it unfolds,
   * keep its scenery off the road it left); every road also keeps its right side clear of the fork currently ahead.
   */
  private chunkMods(own: Fork | null): ChunkMods {
    const ahead = () => { const f = this.features.fork; return f && f !== own && f.state !== 'branch' ? f : null; };
    return {
      lateral: (s, d, terrain) => {
        return own ? own.fold(s, d, terrain) : d; // the two roads' ground overlaps at one level (no clipping against each other)
      },
      medianDrop: own ? (s) => own.branchMedianDrop(s) : undefined,
      roadLift: own ? (s) => (s - own.sF < 260 ? 0.02 : 0) : undefined,
      // the new highway's far side wall only rises once its lanes have unfolded (folded, it would wall off the ramp)
      leftDrop: own ? (s) => -7 * (1 - smoothstep(own.uB + 2, own.uB + 8, s)) : undefined,
      roadSink: own ? (s, d) => own.wedgeSink(s, d) : undefined,
      noProps: (s, d) => {
        if (own && Math.abs(d) < 6 && own.unfold(s) < 1) return true; // the median (lamp posts) is not there yet while the road is folded
        if (own && d < 0 && (own.unfold(s) < 1 || d < own.midBranch(s) + 24)) return true;
        const f = ahead();
        return !!f && ((d > 0 && d > f.midMain(s) - 24) || f.onDeck(s, d) || f.taperClear(s, d));
      },
      noOverpass: own ? (s) => s < own.sF + FORK_SPAN + 100 : undefined,
      // the raised ramp and new highway stand between retaining walls: their own ground lies at the old road's level
      lift: own ? (s, d) => own.branchLift(s, d) : undefined,
      skirt: own ? (s) => own.raised(s) : undefined,
    };
  }

  /** forks: build the branch ahead of time, decide which road the player took, and retire the other one */
  private forkStep(s: number, view = false) {
    const ph = this.player.phys;
    const pd = view ? this.layout.laneCenter(2) : ph.d;
    for (const o of this.oldChunks) if (s > o.until) { this.scene.remove(o.cm.root); o.cm.dispose(); }
    this.oldChunks = this.oldChunks.filter((o) => s <= o.until);
    for (const o of this.bridges) if (s > o.until) this.scene.remove(o.g);
    this.bridges = this.bridges.filter((o) => s <= o.until);
    if (!this.fork) {
      const sF = this.features.forkAfter(s);
      if (sF - s > 1900 || !isFinite(sF)) return;
      const fk = new Fork(this.path, this.map, this.layout, sF, this.chunks.roadMat);
      this.scene.add(fk.bridge);
      this.bridges.push({ g: fk.bridge, until: sF + FORK_SPAN, fk });
      this.fork = fk;
      this.features.fork = fk;
      // the new highway builds further ahead than the road: its far side must already be there when the bridge over the old road is in view
      const cm = new ChunkManager(fk.branch, this.map, this.layout, { ...this.quality, chunksAhead: this.quality.chunksAhead + 10 }, this.features, this.chunkMods(fk));
      cm.minIndex = Math.floor(sF / 64);
      cm.minS = sF;
      this.branchChunks = cm;
      this.scene.add(cm.root);
      this.applyLight();
      return;
    }
    const fk = this.fork;
    this.branchChunks?.update(s);
    const x = s - fk.sF;
    // traffic routing: about a third of the cars in the right lane take the ramp
    if (fk.state === 'open') {
      for (const c of this.traffic.cars) {
        if (c.dir < 0 || c.cop || c.rage || c.exitFork !== undefined) continue;
        if (c.s > fk.sF - 260 && c.s < fk.sF - 120 && c.lane === 4 && c.lcT >= 1 && c.pendingLane < 0) c.exitFork = Math.random() < 0.35;
      }
    }
    // exiting cars hold their lane until the ramp starts, then drift over onto it as it widens (no snapping across early)
    if (fk.state !== 'branch') this.traffic.forkTarget = (c) => {
      const cx = c.s - fk.sF;
      if (cx < 0) return null; // (past releaseX they keep following the ramp until the loop below drops them: no hop back onto the highway)
      const lane4 = this.layout.laneCenter(4);
      return lane4 + (fk.rampIn(c.s) + this.layout.laneWidth / 2 + 0.3 - lane4) * smoothstep(0, 130, cx);
    };
    if (fk.state !== 'branch') for (const c of this.traffic.cars) if (c.exitFork && c.s > fk.sF + fk.releaseX) this.traffic.release(c);
    if (fk.state === 'open' && (this.state === 'driving' || view)) {
      if (!view && x > COMMIT_X && pd > this.layout.playerMax + 0.5) this.takeFork(fk);
      else if (x > Math.max(fk.sepX + 30, 130) && pd <= this.layout.playerMax + 0.5) {
        // stayed on the main road: the branch drifts off and goes when it is out of sight
        fk.state = 'main';
        // cars that took the ramp keep following it until they are gone
        if (this.branchChunks) { this.branchChunks.frozen = true; this.oldChunks.push({ cm: this.branchChunks, until: fk.sF + FORK_SPAN }); this.branchChunks = null; }
      }
    }
    if (fk.state !== 'open' && x > FORK_SPAN + 50) {
      this.fork = null;
      if (this.features.fork === fk) this.features.fork = null;
      this.traffic.forkTarget = null;
    }
    // traffic and cops on the new highway stay off its folded up lanes
    const cf = this.chunksFork;
    if (cf && s < cf.uB + 600) {
      for (const c of this.traffic.cars) {
        if (c.cop || c.rage || c.wrecked || c.s <= cf.sF || c.s >= cf.uB || c.d >= cf.branchMin(c.s) - 0.5) continue;
        // oncoming traffic reaching the join carries on west over the bridge
        if (c.dir < 0) cf.adoptOncoming(c.s, c.lane, c.v, c.type, c.color ?? 0xffffff);
        this.traffic.release(c);
      }
    } else if (cf) { this.chunksFork = null; this.traffic.spawnOk = null; this.police.minD = null; }
  }

  /** traffic over the interchange bridges (and on a new highway the player is not on); drawn with the real traffic */
  private deckTraffic(dt: number) {
    const ghosts: DeckCar[] = [];
    for (const b of this.bridges) {
      const fk = b.fk;
      // on the new highway, deck cars that reach the simulated road become real traffic there
      fk.updateDeck(dt, this.traffic.flow, fk.state === 'branch', (c, s) => {
        const ph = this.player.phys;
        if (Math.abs(s - ph.s) < 9 && Math.abs(c.d - ph.d) < 2.6) return false;
        if (s > ph.s - 250 && s < ph.s + this.traffic.spawnAhead + 200) this.traffic.adopt(c.dir, s, c.lane, c.v, c.type, c.color);
        return true;
      });
      for (const c of fk.deckCars) ghosts.push(c);
    }
    this.traffic.ghosts = ghosts;
  }

  /** the player took the ramp: from the fork on, the road IS the new highway */
  private takeFork(fk: Fork) {
    const ph = this.player.phys;
    // world positions before the road changes under everything
    const pw = this.player.model.root.position.clone();
    const yaw = this.path.frame(ph.s).heading + ph.psi;
    const movers = this.traffic.cars.filter((c) => (c.cop || c.rage || (c.exitFork && c.s > fk.sF)) && !c.wrecked).map((c) => ({ c, p: this.path.toWorld(c.s, c.d, 0, new THREE.Vector3()) }));
    // cars still on the old highway at or past the fork are left behind with it
    for (const c of this.traffic.cars) if (!c.cop && !c.rage && !(c.exitFork && c.s > fk.sF) && c.s > fk.sF - 400) this.traffic.release(c);
    this.path.splice(fk.branch, fk.sF);
    fk.state = 'branch';
    const pr = projectToRoad(this.path, pw, ph.s);
    ph.s = pr.s; ph.d = pr.d;
    ph.psi = yaw - this.path.frame(ph.s).heading;
    this.sGuess = ph.s;
    for (const m of movers) {
      const q2 = projectToRoad(this.path, m.p, m.c.s); m.c.s = q2.s; m.c.d = Math.max(q2.d, fk.branchMin(q2.s) + 1.2);
      // a cop or rager that was still on the old highway (not on the ramp) would land on the grass: it follows the
      // player up the ramp instead, a little way behind
      if ((m.c.cop || m.c.rage) && (q2.d < fk.branchMin(q2.s) + 0.5 || q2.d > this.layout.playerMax - 0.5 || q2.s > ph.s - 8)) {
        m.c.d = this.layout.laneCenter(4); m.c.s = ph.s - 30 - 14 * movers.indexOf(m); m.c.yaw = 0;
      }
      if (m.c.exitFork) { m.c.exitFork = false; m.c.lane = 4; m.c.targetLane = 4; m.c.lcT = 1; }
    }
    this.traffic.forkTarget = null;
    // scenery: the new highway's becomes the live one; the old road stays put until it is out of sight
    this.chunks.frozen = true;
    this.oldChunks.push({ cm: this.chunks, until: fk.sF + FORK_SPAN });
    this.chunks = this.branchChunks!;
    this.branchChunks = null;
    this.chunksFork = fk;
    this.traffic.spawnOk = (s2, d2) => !(s2 > fk.sF - 50 && s2 < fk.uB + 40 && d2 < fk.branchMin(s2) + 1);
    // the new highway's traffic, spread out ahead (the old road's cars past the fork were left behind with it)
    this.traffic.populate(ph.s, this.scoring.distance, 60);
    this.police.minD = (s2) => (s2 > fk.sF && s2 < fk.uB + 40 ? fk.branchMin(s2) : -999);
    this.onPopup?.({ text: 'NEW HIGHWAY', sub: 'you took the fork', color: '#6cf', big: true });
  }

  /**
   * Where a vehicle at (s, d) can drive (the edges of the paved, walled area): the road itself (lo..hi), widened by a
   * gas station's ramp or lot, the fork's ramp while it is open, and the new highway's open part after a fork.
   * The player, the cops and the wrecks all use it.
   */
  driveRange(s: number, d: number, lo: number, hi: number) {
    const lim = this.features.limits(s, d, lo, hi);
    let rlo = lim ? lim.lo : lo, rhi = lim ? lim.hi : hi;
    const fk = this.fork;
    if (fk && fk.state === 'open') {
      // the fork's ramp: open to the highway at first, then walled off behind its island
      const x = s - fk.sF;
      if (x > 0 && x < fk.sepX) rhi = Math.max(rhi, fk.rampOut(s));
      else if (x >= fk.sepX && x < FORK_SPAN && d > this.layout.playerMax + 0.5) { rlo = fk.rampIn(s); rhi = fk.rampOut(s); }
    }
    // the new highway's folded up left side is not drivable yet
    const cf = this.chunksFork;
    if (cf && s < cf.uB + 20 && s > cf.sF) rlo = Math.max(rlo, cf.branchMin(s));
    return { lo: rlo, hi: rhi };
  }

  /** barriers / road edges */
  private edges() {
    const ph = this.player.phys;
    const L = this.layout;
    const half = this.player.collW / 2;
    // a gas station is solid: any contact with its posts, pumps or shop wrecks the car in a fireball
    if (this.state === 'driving' && this.features.hitStation(ph.s, ph.d, half, this.player.collL / 2)) { this.startCrash('barrier', 70, null); return; }
    // the grass wedge between the highway's wall and the ramp's wall (where they split) is a corner: running into it wrecks you
    const fk = this.fork;
    if (fk && fk.state === 'open' && this.state === 'driving') {
      const x = ph.s - fk.sF;
      if (x > 0 && x < FORK_SPAN) {
        const wedgeHi = fk.rampIn(ph.s);
        const overlap = Math.min(ph.d + half, wedgeHi) - Math.max(ph.d - half, L.playerMax);
        if (wedgeHi > L.playerMax + 0.05 && overlap > 0.15 && Math.abs(ph.v) > 5) { this.startCrash('barrier', Math.max(14, Math.abs(ph.v) * 0.6), null); return; }
      }
    }
    ph.onGrass = (ph.d < L.softMin || ph.d > L.softMax) && !this.features.paved(ph.s, ph.d);
    const { lo: rlo, hi: rhi } = this.driveRange(ph.s, ph.d, L.playerMin, L.playerMax);
    const lo = rlo + half, hi = rhi - half;
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
      if (ph.bike) {
        // a bike's yaw comes straight from its lean: holding the bars into the wall would keep turning it back in
        // and pin it there, so the wall takes the lean (and any yaw) pointing into it
        if (ph.lean * -side > 0) ph.lean *= 0.3;
        if (ph.r * -side > 0) ph.r = 0;
        if (ph.psi * -side > 0) ph.psi = 0;
        // and the rider rolls a touch away from the wall, so a bike held against it peels off instead of riding it
        if (ph.lean * side < 0.08) ph.lean += side * 0.0015;
      }
      // a bike grazing along a wall barely loses speed (it used to bleed to a crawl, as if stuck to it)
      ph.v *= 1 - clamp(into * 0.012, ph.bike ? 0.0004 : 0.002, 0.2);
      this.scrape = speed > 3 ? Math.min(1, 0.4 + into * 0.1) : 0; // resting against a wall is silent
      if (into > 1.5 && this.bumpCd <= 0) { this.thud(clamp(into / 8, 0.2, 1)); this.rig.addShake(0.3); this.scoring.bump(); this.bumpCd = 0.5; }
      if (speed > 4 && Math.random() < 0.5) { // sparks only while actually scraping
        const pos = this.player.model.root.position.clone();
        const right = new THREE.Vector3(-Math.cos(this.path.frame(ph.s, fr).heading), 0, Math.sin(fr.heading));
        pos.addScaledVector(right, side * half).y += 0.3;
        this.particles.spark(pos, this.player.worldVel, 3, 3);
      }
      if (into > 3 && this.bumpCd <= 0) { this.thud(into / 10); this.rig.addShake(0.4); this.scoring.bump(); this.bumpCd = 0.5; }
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
      if (into > 1.5 && this.bumpCd <= 0) { this.thud(clamp(into / 8, 0.2, 1)); this.rig.addShake(0.4); this.scoring.bump(); this.bumpCd = 0.5; }
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
      if (!c.alive) continue;
      const dS = c.s - ph.s, dD = c.d - ph.d;
      if (Math.abs(dS) > 10 || Math.abs(dD) > 5) continue;
      // a wreck lying on the road is solid too; its box follows the tumbling body's heading
      let yaw = c.yaw;
      if (c.wrecked) {
        const r = c.model.root;
        const fw = this.tmpV.set(0, 0, 1).applyQuaternion(r.quaternion);
        yaw = Math.atan2(fw.x, fw.z) - this.path.frame(c.s, fr).heading - (c.dir < 0 ? Math.PI : 0);
      }
      const ca = [Math.cos(yaw), -Math.sin(yaw)];
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
      const cv = c.wrecked ? 0 : c.v;
      const rvS = pvS - cv * c.dir, rvD = pvD;
      const vn = rvS * nS + rvD * nD;
      const rel = Math.hypot(rvS, rvD);
      // only a hard hit wrecks: a gentle nudge or a low speed scrape is a bump (and resets the combo)
      if (vn > (c.wrecked ? 9 : 6.5) || (!c.wrecked && (rel > 15 || (c.dir < 0 && rel > 12)))) {
        // out of gas and a cop rolls up: that is the end of the road, not a crash
        if (c.cop && this.fuel <= 0) { this.stall(true); return; }
        this.startCrash(c.dir < 0 ? 'headon' : 'car', Math.max(vn, rel * 0.8), c);
        return;
      }
      // light bump: push fully apart (nothing ever overlaps) and take out the speed into the contact
      const share = c.wrecked ? 1 : 0.65;
      ph.s -= nS * (minOv + 0.02) * share; ph.d -= nD * (minOv + 0.02) * share;
      if (!c.wrecked) { c.s += nS * (minOv + 0.02) * (1 - share); c.d += nD * (minOv + 0.02) * (1 - share); }
      ph.v -= Math.max(0, vn) * nS * 1.05;
      ph.vl += nD * Math.max(0, vn) * 0.6;
      if (!c.wrecked) {
        c.v = Math.max(0, c.v + Math.max(0, vn) * nS * 0.4);
        c.panicT = 1.2; c.swerveTarget = Math.sign(nD) * 0.8;
      }
      this.scoring.bump(); // the streak resets on every bump, even in the cooldown
      if (this.bumpCd <= 0) { this.thud(0.5); this.rig.addShake(0.5); this.bumpCd = 0.6; if (!c.wrecked) this.traffic.onHonk?.(c, 1); }
    }
  }

  /** player horn: scared drivers just ahead flinch */
  private horn(dt: number) {
    this.hornCd -= dt;
    this.audio.hornHeld(this.input.horn && this.state === 'driving'); // sounds for as long as it is held
    if (!this.input.horn || this.hornCd > 0) return;
    this.hornCd = 0.45;
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
          const cut = c.dir > 0 && this.scoring.time - this.scoring.lastNearMissT < 1.4;
          const insane = clamp(1 - Math.max(0, clearance) / 1.4, 0, 1) > 0.7;
          this.scoring.nearMiss(Math.max(0, clearance), relSpeed, c.dir < 0);
          // very rarely, the driver you just carved up snaps and comes after you
          if ((cut || insane) && c.dir > 0 && !c.cop && Math.random() < 0.012) this.police.startRage(c);
          this.audio.whoosh(relSpeed / 30);
          this.rig.addShake(0.25);
        }
      }
      c.passedSign = sign;
    }
  }

  /** impact thump: sound plus rumble */
  private thud(k: number) { this.audio.thud(k); this.haptics.pulse(clamp(0.35 + k * 0.5, 0, 1), clamp(0.2 + k * 0.4, 0, 1), 0.18); }

  startCrash(kind: CrashKind, impact: number, hit: TrafficCar | null) {
    if (this.state === 'crash' || this.state === 'done') return;
    this.state = 'crash';
    this.audio.hornHeld(false);
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
    this.haptics.pulse(1, 1, 0.7);
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
    const message = randomCrashMessage({ map: this.map.id, kind, victim: hit?.type, cop: !!hit?.cop, rage: !!hit?.rage, wanted: this.police.wanted > 0, bike: this.player.bike });
    const caught = !!hit?.cop && (kind === 'car' || kind === 'headon');
    this.onCrash?.(message, caught, caught ? 'CAUGHT' : 'WRECKED');
    this.result = {
      score: Math.round(this.scoring.score), distance: this.scoring.distance, topSpeed: this.player.topSpeed,
      nearMisses: this.scoring.nearMisses, cutUps: this.scoring.cutUps, time: this.scoring.time, crashKind: kind, message, caught, prevBest: this.prevBest,
    };
    void ph;
  }
  onCrash: ((message: string, caught: boolean, banner: string) => void) | null = null;

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
    this.haptics.stop();
    // the composer's passes own render targets (the bloom has a dozen): free them explicitly
    for (const p of this.composer?.passes ?? []) (p as { dispose?: () => void }).dispose?.();
    this.composer?.renderTarget1.dispose(); this.composer?.renderTarget2.dispose();
    this.composer?.dispose();
    this.audio.stopEngine();
    this.crash.clear();
    this.police.clear();
    this.audio.siren(0);
    this.traffic.clear();
    for (const cm of this.allChunks()) cm.dispose();
    this.env.dispose();
    // free everything this run uploaded to the GPU (geometries, materials and their textures): left alone it piled up
    // with every restart until the GPU ran short of memory. Anything shared is simply uploaded again when next used.
    const seen = new Set<unknown>();
    const freeMat = (m: THREE.Material) => {
      if (seen.has(m)) return; seen.add(m);
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      m.dispose();
    };
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose?.(); }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(freeMat); else if (mat) freeMat(mat);
    });
    this.bridges.forEach((b) => b.g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }));
  }
}
