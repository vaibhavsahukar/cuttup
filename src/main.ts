import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './ui/style.css';
import { Save, QUALITY } from './storage/Save';
import { Input } from './input/Input';
import { AudioEngine } from './audio/AudioEngine';
import { UI } from './ui/UI';
import { PreviewStage } from './ui/PreviewStage';
import { Game } from './game/Game';
import { getVehicle, VEHICLES } from './data/vehicles';

const params = new URLSearchParams(location.search);

async function boot() {
  if (params.get('shape')) { const { shapeCompare } = await import('./dev/shapeCompare'); await shapeCompare(params.get('shape')!.split(','), params.get('ref') === '1', Number(params.get('rot') ?? 0), parseInt(params.get('color') ?? '0c0c0e', 16)); return; }
  const save = new Save();
  await save.load();
  const st = save.data.settings;
  const q = QUALITY[st.quality];

  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
  renderer.domElement.id = 'gl';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const loadingEl = document.getElementById('loading');
  // saved vehicle may no longer exist (roster changed)
  if (!VEHICLES.some((v) => v.id === st.vehicle)) st.vehicle = 'zr1';
  loadingEl?.remove();

  const pmrem = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const input = new Input(st.bindings, st.padBindings);
  const audio = new AudioEngine();
  audio.volumes = st.volumes;
  audio.applyVolumes();
  const preview = new PreviewStage(pmrem);
  preview.show(st.vehicle);

  let game: Game | null = null;
  let mode: 'menu' | 'game' | 'paused' | 'results' = 'menu';
  let lastRun = { map: st.map, vehicle: st.vehicle };

  let renderScale = 1;
  const basePR = () => Math.min(devicePixelRatio, 2) * QUALITY[st.quality].pixelRatio;
  const setRenderScale = () => { renderer.setPixelRatio(basePR() * renderScale); resize(); };
  const applyDisplay = () => {
    const qq = QUALITY[st.quality];
    renderer.setPixelRatio(basePR() * renderScale);
    renderer.shadowMap.enabled = qq.shadows;
    window.native?.setFullscreen(st.fullscreen);
    if (!window.native && st.fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined);
    if (!window.native && !st.fullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    if (st.resolution !== 'native') {
      const [w, h] = st.resolution.split('x').map(Number);
      window.native?.setResolution(w, h);
    }
    resize();
  };
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    game?.resize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);

  const startGame = (mapId: string, vehicleId: string) => {
    game?.dispose();
    renderScale = 1; renderer.setPixelRatio(basePR());
    lastRun = { map: mapId, vehicle: vehicleId };
    st.map = mapId; st.vehicle = vehicleId; save.persist();
    audio.resume();
    input.captureCb = null; input.padCaptureCb = null;
    game = new Game(renderer, audio, input, st, mapId, vehicleId, pmrem);
    game.onPopup = (p) => ui.popup(p);
    game.onCrash = (msg, caught) => { ui.crashMessage(msg, caught); ui.show('crashui'); flashT = 0.6; };
    game.resize(innerWidth, innerHeight);
    input.clearPressed();
    ui.show('hud');
    mode = 'game';
    (window as any).__game = game;
  };
  const endGame = () => {
    if (!game || !game.result) return;
    const r = game.result;
    const rank = save.addRun(lastRun.map, { score: r.score, distance: r.distance, topSpeed: r.topSpeed, nearMisses: r.nearMisses, vehicle: lastRun.vehicle, date: Date.now() });
    mode = 'results';
    ui.results(r, lastRun.map, lastRun.vehicle, rank, st.units);
  };
  const toMenuScene = () => { game?.dispose(); game = null; mode = 'menu'; };

  const ui: UI = new UI(save, {
    play: () => startGame(st.map, st.vehicle),
    garage: () => { toMenuScene(); preview.show(st.vehicle); ui.show('garage'); },
    models: () => { toMenuScene(); ui.show('models'); },
    previewModel: (key) => preview.showModel(key),
    maps: () => { toMenuScene(); ui.show('maps'); },
    settings: () => ui.show('settings'),
    quit: () => { if (window.native) window.native.quit(); else ui.show('menu'); },
    selectVehicle: (id) => { st.vehicle = id; save.persist(); ui.show('menu'); },
    previewVehicle: (id) => preview.show(id),
    selectMap: (id) => { st.map = id; save.persist(); },
    startMap: (id) => startGame(id, st.vehicle),
    back: () => {
      if (ui.current === 'settings') { if (ui.settingsBack === 'pause') { ui.show('pause'); return; } }
      preview.show(st.vehicle);
      ui.show('menu');
    },
    resume: () => { mode = 'game'; ui.show('hud'); input.clearPressed(); },
    restart: () => startGame(lastRun.map, lastRun.vehicle),
    toMenu: () => { toMenuScene(); preview.show(st.vehicle); ui.show('menu'); },
    settingsChanged: () => {
      audio.volumes = st.volumes; audio.applyVolumes();
      input.bindings = st.bindings; input.pad = st.padBindings;
      applyDisplay();
    },
    click: () => { audio.resume(); audio.click(); },
  });
  ui.captureKey = (a, i) => { input.captureCb = (code) => ui.keyCaptured(a, i, code); };
  ui.capturePad = (a) => input.capturePad((code) => ui.padCaptured(a, code));
  ui.cancelCapture = () => { input.captureCb = null; input.padCaptureCb = null; };
  ui.show('menu');
  applyDisplay();
  addEventListener('pointerdown', () => audio.resume());
  addEventListener('keydown', (e) => {
    audio.resume();
    if (mode === 'game' || input.captureCb || input.padCaptureCb || input.menuBlock > 0) return;
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS') { ui.nav(1); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW') { ui.nav(-1); e.preventDefault(); }
    else if (e.code === 'Enter') { ui.activate(); e.preventDefault(); }
    else if (e.code === 'Escape') {
      if (mode === 'paused') { if (ui.current === 'settings') ui.show('pause'); else { mode = 'game'; ui.show('hud'); input.clearPressed(); } }
      else if (ui.current !== 'menu' && ui.current !== 'results') ui.h.back();
    }
  });
  // crash screen: stays until the player presses Enter or the gamepad A button
  addEventListener('keydown', (e) => { if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && mode === 'game' && game?.state === 'crash') { game.continueCrash(); e.preventDefault(); } });
  let padAHeld = true; // a fresh press is needed: A held while driving must not count
  const pollCrashPad = () => {
    const p = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
    const a = !!p?.buttons[0]?.pressed;
    if (a && !padAHeld && game?.state === 'crash') game.continueCrash();
    padAHeld = a;
  };
  // gamepad menu navigation
  let padPrev: boolean[] = [];
  const pollPadMenu = () => {
    const p = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
    if (!p) return;
    if (input.padCaptureCb || input.menuBlock > 0) { padPrev = p.buttons.map((x) => x.pressed); return; }
    const b = p.buttons.map((x) => x.pressed);
    const edge = (i: number) => b[i] && !padPrev[i];
    if (edge(12) || edge(14)) ui.nav(-1);
    if (edge(13) || edge(15)) ui.nav(1);
    if (mode === 'results') {
      // results screen: A retry, X change vehicle, Y change map, B main menu (badges under the buttons)
      if (edge(0)) ui.resultsShortcut('retry'); else if (edge(2)) ui.resultsShortcut('vehicle'); else if (edge(3)) ui.resultsShortcut('map'); else if (edge(1)) ui.resultsShortcut('menu');
      padPrev = b;
      return;
    }
    if (edge(0)) ui.activate();
    if (edge(1)) { if (mode === 'paused') { mode = 'game'; ui.show('hud'); } else if (ui.current !== 'menu' && ui.current !== 'results') ui.h.back(); }
    padPrev = b;
  };

  let flashT = 0;
  let last = -1;
  let fpsAcc = 0, fpsN = 0, worst = 0;
  (window as any).__fps = 0;
  // Adaptive resolution: if the GPU can't hold ~60 fps the frame pacing goes uneven, which feels like
  // stutter. Watch the frame interval and lower / raise the render resolution to keep it steady.
  let baseline = 1 / 60; // fastest steady interval seen (the display's refresh)
  const win: number[] = [];
  let checkT = 0, goodChecks = 0;
  const frame = (ts: number) => {
    requestAnimationFrame(frame);
    // the rAF timestamp is the frame's vsync-aligned start time, much steadier than performance.now()
    if (last < 0) last = ts;
    const rawDt = (ts - last) / 1000;
    last = ts;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    fpsAcc += rawDt; fpsN++; worst = Math.max(worst, rawDt);
    if (fpsAcc > 1) {
      (window as any).__fps = fpsN / fpsAcc;
      ui.fps(st.showFps, fpsN / fpsAcc, worst * 1000, renderScale);
      fpsAcc = 0; fpsN = 0; worst = 0;
    }
    if (mode === 'game' && rawDt < 1) {
      win.push(rawDt); if (win.length > 45) win.shift();
      baseline = Math.min(baseline * 1.0005, Math.max(0.004, rawDt));
      checkT += rawDt;
      if (checkT > 0.75 && win.length >= 8) {
        checkT = 0;
        const avg = [...win].sort((a, b) => a - b)[win.length >> 1]; // median: one hitch doesn't count
        if (avg > 1 / 55 && avg > baseline * 1.2 && renderScale > 0.5) { renderScale = Math.max(0.5, renderScale - 0.1); goodChecks = 0; setRenderScale(); win.length = 0; }
        else if (avg < baseline * 1.1 && renderScale < 1) { if (++goodChecks >= 8) { renderScale = Math.min(1, renderScale + 0.05); goodChecks = 0; setRenderScale(); win.length = 0; } }
        else goodChecks = 0;
      }
    }
    input.update(dt);
    if (mode !== 'game') pollPadMenu(); else pollCrashPad();
    if (game && (mode === 'game')) {
      if (input.pressed('pause') && game.state !== 'crash') { mode = 'paused'; ui.show('pause'); }
      else {
        const alive = game.update(dt);
        const ph = game.player.phys;
        ui.bikeHud(game.player.bike, ph.absOn, ph.tcOn, ph.awOn, ph.tyreTemp, ph.tyreWear);
        ui.hud(ph.v, ph.gear, ph.rpm / game.spec.redline, game.scoring.score, game.scoring.multiplier, Math.max(0, game.scoring.comboTimer / game.scoring.COMBO_TIME), game.state === 'countdown' ? game.countdown : 0, st.units);
        ui.stars(game.police.wanted, game.police.cops.length > 0);
        if (!alive) endGame();
      }
    }
    if (flashT > 0) { flashT = Math.max(0, flashT - dt * 3); ui.flash(flashT); }
    if (game && mode !== 'menu') game.render();
    else {
      preview.offsetX = ui.current === 'garage' || ui.current === 'models' ? 0 : ui.current === 'menu' ? -2.2 : 0;
      preview.update(dt, innerWidth, innerHeight);
      renderer.render(preview.scene, preview.camera);
    }
  };
  frame(performance.now());
  /** test hook: advance the simulation without rendering (headless software GL is too slow for real time) */
  const advance = (seconds: number, stepDt = 1 / 60) => {
    for (let t = 0; t < seconds && game && mode === 'game'; t += stepDt) {
      input.update(stepDt);
      const alive = game.update(stepDt);
      if (!alive) { endGame(); break; }
    }
  };
  (window as any).__app = { startGame, ui, save, input, advance, preview, renderer, get game() { return game; }, get mode() { return mode; } };
  void getVehicle;
}
boot();
