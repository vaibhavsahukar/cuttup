import { VEHICLES, getVehicle, statBars } from '../data/vehicles';
import { MAPS, getMap } from '../data/maps';
import { modelCatalog } from '../data/modelCatalog';
import { TIME_CHOICES, type TimeChoice } from '../world/TimeOfDay';
import { ACTIONS, DEFAULT_BINDINGS, DEFAULT_PAD, fmtPad, type Action } from '../input/Input';
import type { Save, RunEntry, QualityName } from '../storage/Save';
import type { Popup } from '../game/Scoring';
import type { RunResult } from '../game/Game';
import { MPH, KPH } from '../core/math';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export type ScreenId = 'menu' | 'garage' | 'models' | 'maps' | 'settings' | 'hud' | 'pause' | 'results' | 'crashui';

export interface UIHandlers {
  play(): void; garage(): void; models(): void; previewModel(key: string): void; maps(): void; settings(): void; quit(): void;
  selectVehicle(id: string): void; previewVehicle(id: string): void;
  selectMap(id: string): void; startMap(id: string): void;
  back(): void; resume(): void; restart(): void; toMenu(): void;
  settingsChanged(): void; click(): void;
}

const ARROWS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
const fmtKey = (c: string) => {
  if (!c) return '—';
  if (ARROWS[c]) return ARROWS[c];
  return c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^(Shift|Control|Alt)(Left|Right)$/, (_m, a, b) => `${b === 'Left' ? 'L' : 'R'}-${a === 'Control' ? 'CTRL' : a.toUpperCase()}`).toUpperCase();
};

export class UI {
  current: ScreenId = 'menu';
  private settingsReturn: ScreenId = 'menu';
  private previewId = '';
  private focusIdx = 0;

  constructor(public save: Save, public h: UIHandlers) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="menu" class="screen">
        <div class="col">
          <div class="logo">RECKLESS DRIVING:<span>THE GAME</span></div>
          <div class="tag">ENDLESS TRAFFIC · NO BRAKES ON FUN</div>
          <button data-a="play" class="primary">Play</button>
          <button data-a="garage">Vehicle Select</button>
          <button data-a="maps">Map Select</button>
          <button data-a="models">Model Viewer</button>
          <button data-a="settings">Settings</button>
          <button data-a="quit">Quit</button>
        </div>
        <div class="hint" id="menuHint"></div>
      </div>
      <div id="garage" class="screen">
        <div class="list panel"></div>
        <div class="info panel"></div>
        <div class="actions"><button data-a="back">Back</button><button data-a="choose" class="primary">Select vehicle</button></div>
      </div>
      <div id="models" class="screen">
        <div class="list panel"></div>
        <div class="info panel"></div>
        <div class="actions"><button data-a="prev">Previous</button><button data-a="next">Next</button><button data-a="back" class="primary">Back</button></div>
      </div>
      <div id="maps" class="screen"><div class="cards"></div>
        <div class="actions"><button data-a="back">Back</button><button data-a="go" class="primary">Start run</button></div></div>
      <div id="settings" class="screen"><div class="panel"></div></div>
      <div id="hud" class="screen">
        <div class="stars" title="Wanted level"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
        <div class="score"><div class="v">0</div><div class="m">x1.0</div><div class="combo"><i></i></div></div>
        <div class="fps" hidden></div>
        <div class="pops"></div>
        <div class="count"></div>
        <div class="bikehud" hidden>
          <div class="lights"><span data-l="abs">ABS</span><span data-l="tc">TC</span><span data-l="aw">AW</span></div>
          <div class="tyre"><label>TIRE</label><div class="bar"><i></i></div></div>
        </div>
        <div class="speedo"><span class="spd">0</span><span class="gear">1</span><div class="unit">MPH</div><div class="tach"><i></i></div></div>
      </div>
      <div id="crashui" class="screen letterbox"><div class="wreck">WRECKED</div><div class="shame"></div><div class="skip">A or Enter to continue</div></div>
      <div id="pause" class="screen"><div class="panel center">
        <h2>Paused</h2>
        <button data-a="resume" class="primary">Resume</button><button data-a="restart">Restart</button>
        <button data-a="settings">Settings</button><button data-a="menu">Quit to menu</button></div></div>
      <div id="results" class="screen"><div class="panel center"></div></div>
      <div id="flash"></div>`);

    $('#menu').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (!a) return;
      this.h.click();
      if (a === 'play') this.h.play(); else if (a === 'garage') this.h.garage(); else if (a === 'maps') this.h.maps(); else if (a === 'models') this.h.models();
      else if (a === 'settings') { this.settingsReturn = 'menu'; this.h.settings(); } else if (a === 'quit') this.h.quit();
    });
    $('#garage .actions').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      this.h.click();
      if (a === 'back') this.h.back(); else if (a === 'choose') this.h.selectVehicle(this.previewId);
    });
    $('#models .actions').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      this.h.click();
      if (a === 'back') this.h.back();
      else if (a === 'next' || a === 'prev') {
        const cat = modelCatalog();
        const i = cat.findIndex((m) => m.key === this.modelKey);
        this.previewModel(cat[(i + (a === 'next' ? 1 : cat.length - 1)) % cat.length].key);
      }
    });
    $('#maps .actions').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      this.h.click();
      if (a === 'back') this.h.back(); else if (a === 'go') this.h.startMap(this.save.data.settings.map);
    });
    $('#pause').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (!a) return;
      this.h.click();
      if (a === 'resume') this.h.resume(); else if (a === 'restart') this.h.restart(); else if (a === 'menu') this.h.toMenu();
      else if (a === 'settings') { this.settingsReturn = 'pause'; this.h.settings(); }
    });
    const hint = $('#menuHint');
    hint.textContent = `${getVehicle(this.save.data.settings.vehicle).name}  ·  ${getMap(this.save.data.settings.map).name}`;
  }

  show(id: ScreenId, extra: ScreenId[] = []) {
    this.current = id;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id || extra.includes(s.id as ScreenId)));
    if (id === 'garage') this.buildGarage();
    if (id === 'maps') this.buildMaps();
    if (id === 'models') this.buildModels();
    if (id === 'settings') this.buildSettings();
    if (id === 'menu') $('#menuHint').textContent = `${getVehicle(this.save.data.settings.vehicle).name}  ·  ${getMap(this.save.data.settings.map).name}   —   Arrow keys / D-pad + Enter / (A) to navigate`;
    this.focusIdx = -1; // no highlight until keyboard / pad navigation starts
    this.applyFocus();
  }
  get settingsBack() { return this.settingsReturn; }

  // ---------------- garage ----------------
  private buildGarage() {
    const list = $('#garage .list');
    const sel = this.save.data.settings.vehicle;
    this.previewId = sel;
    const grp = (kind: 'bike' | 'car', label: string) => `<div class="grp">${label}</div>` + VEHICLES.filter((v) => v.kind === kind).map((v) => `<button data-v="${v.id}" class="${v.id === sel ? 'sel' : ''}">${esc(v.name)}</button>`).join('');
    list.innerHTML = `<h2>Garage</h2>${grp('bike', 'MOTORCYCLES')}${grp('car', 'CARS')}`;
    list.onclick = (e) => {
      const id = (e.target as HTMLElement).dataset.v;
      if (!id) return;
      this.h.click();
      this.preview(id);
    };
    this.preview(sel);
  }
  preview(id: string) {
    this.previewId = id;
    document.querySelectorAll('#garage .list button').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.v === id));
    const v = getVehicle(id);
    const s = statBars(v);
    const bar = (label: string, x: number) => `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(x * 100)}%"></i></div></div>`;
    $('#garage .info').innerHTML = `
      <div class="name">${esc(v.name)}</div><div class="char">${esc(v.character)}</div>
      ${bar('TOP SPEED', s.speed)}${bar('ACCEL', s.accel)}${bar('HANDLING', s.handling)}${bar('BRAKING', s.braking)}${bar('CONTROL', s.control)}
      ${v.kind === 'bike' ? `<div class="char">Stock electronics: ABS ${v.electronics?.abs ? 'level ' + v.electronics.abs : 'none'} · Traction control ${v.electronics?.tc ? 'level ' + v.electronics.tc : 'none'} · Anti-wheelie ${v.electronics?.aw ? 'level ' + v.electronics.aw : 'none'}</div>` : ''}
      <div class="specs">
        <div><b>POWER</b>${v.hp} hp</div><div><b>WEIGHT</b>${v.kind === 'bike' ? v.massKg - 75 : v.massKg} kg</div>
        <div><b>DRIVE</b>${v.drive}</div><div><b>0-60 MPH</b>${v.zeroSixty.toFixed(1)} s</div>
        <div><b>TOP SPEED</b>${v.topSpeedMph} mph${v.limited ? ' (lim.)' : ''}</div><div><b>BEST (${esc(getMap(this.save.data.settings.map).name)})</b>${this.save.best(this.save.data.settings.map, v.id).toLocaleString()}</div>
      </div>`;
    this.h.previewVehicle(id);
  }

  // ---------------- model viewer ----------------
  private modelKey = '';
  private buildModels() {
    const cat = modelCatalog();
    const groups = ['Motorcycles', 'Cars', 'Traffic', 'Police'] as const;
    const list = $('#models .list');
    list.innerHTML = `<h2>Model Viewer</h2>` + groups.map((g) => `<div class="grp">${g.toUpperCase()}</div>` + cat.filter((m) => m.group === g).map((m) => `<button data-m="${m.key}">${esc(m.label)}</button>`).join('')).join('');
    list.onclick = (e) => {
      const k = (e.target as HTMLElement).dataset.m;
      if (!k) return;
      this.h.click();
      this.previewModel(k);
    };
    this.previewModel(this.modelKey || cat[0].key);
  }
  previewModel(key: string) {
    this.modelKey = key;
    const cat = modelCatalog();
    const m = cat.find((x) => x.key === key) ?? cat[0];
    document.querySelectorAll('#models .list button').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.m === m.key));
    const i = cat.indexOf(m);
    $('#models .info').innerHTML = `<div class="name">${esc(m.label)}</div><div class="char">${esc(m.note)}</div><div class="specs"><div><b>CATEGORY</b>${m.group}</div><div><b>MODEL</b>${i + 1} of ${cat.length}</div></div><div class="char" style="margin-top:14px">Drag to rotate the model.</div>`;
    this.h.previewModel(m.key);
  }

  // ---------------- maps ----------------
  private buildMaps() {
    const sel = this.save.data.settings.map;
    const grad: Record<string, string> = {
      city: 'linear-gradient(180deg,#2a2f4a 0%,#f08a4b 70%,#3a3a3c 71%,#222 100%)',
      country: 'linear-gradient(180deg,#5c9ae0 0%,#cfe3f2 60%,#6c8f3c 61%,#3f5a24 100%)',
      forest: 'linear-gradient(180deg,#9aa6a4 0%,#b8c2bf 45%,#2f4222 46%,#16210f 100%)',
    };
    const st = this.save.data.settings;
    $('#maps .cards').innerHTML = MAPS.map((m) => {
      const best = (this.save.data.leaderboard[m.id] ?? [])[0];
      return `<div class="card panel ${m.id === sel ? 'sel' : ''}" data-m="${m.id}">
        <div class="thumb" style="background:${grad[m.id]}"></div>
        <div class="t">${esc(m.name)}</div><div class="b">${esc(m.blurb)}</div>
        <div class="best">${best ? `BEST ${best.score.toLocaleString()} · ${esc(getVehicle(best.vehicle).name)}` : 'NO RUNS YET'}</div></div>`;
    }).join('');
    $('#maps .cards').insertAdjacentHTML('afterend', '');
    let tb = document.getElementById('todbar');
    if (!tb) { tb = document.createElement('div'); tb.id = 'todbar'; tb.className = 'panel todbar'; $('#maps').appendChild(tb); tb.onclick = (e) => { const t = (e.target as HTMLElement).dataset.t; if (t) { st.timeOfDay = t as TimeChoice; this.save.persist(); this.h.click(); this.buildMaps(); } }; }
    tb.innerHTML = `<span>Time of day</span>${TIME_CHOICES.map(([v, l]) => `<button class="small ${st.timeOfDay === v ? 'primary' : ''}" data-t="${v}">${l}</button>`).join('')}<span class="dim">${st.timeOfDay === 'auto' ? 'clock runs: dawn, day, dusk, night' : 'time is fixed'}</span>`;
    $('#maps .cards').onclick = (e) => {
      const t = (e.target as HTMLElement).dataset.t;
      if (t) { st.timeOfDay = t as TimeChoice; this.save.persist(); this.h.click(); this.buildMaps(); return; }
      const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!card) return;
      this.h.click();
      this.h.selectMap(card.dataset.m!);
      this.buildMaps();
    };
  }

  // ---------------- settings ----------------
  private waiting: { a: Action; i: number } | null = null; // i = 0 / 1 keyboard slots, 2 = gamepad
  captureKey: ((a: Action, i: number) => void) | null = null;
  capturePad: ((a: Action) => void) | null = null;
  cancelCapture: (() => void) | null = null;
  buildSettings() {
    const st = this.save.data.settings;
    const opt = (key: string, vals: [string, string][], cur: string) => `<div class="opts" data-k="${key}">${vals.map(([v, l]) => `<button class="${v === cur ? 'sel' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const res = ['native', '1280x720', '1600x900', '1920x1080', '2560x1440'];
    const w = (a: Action, i: number) => this.waiting !== null && this.waiting.a === a && this.waiting.i === i;
    const binds = `<div></div><div class="bh">Key</div><div class="bh">Alt key</div><div class="bh">Gamepad</div>` + ACTIONS.map((a) => `<div>${a.label}</div>${[0, 1].map((i) => `<button data-b="${a.id}" data-i="${i}" class="${w(a.id, i) ? 'wait' : ''}">${w(a.id, i) ? 'press a key…' : esc(fmtKey(st.bindings[a.id][i] ?? ''))}</button>`).join('')}<button data-b="${a.id}" data-i="2" class="${w(a.id, 2) ? 'wait' : ''}">${w(a.id, 2) ? 'press a button / move a stick…' : esc(fmtPad(st.padBindings[a.id] ?? ''))}</button>`).join('');
    const lv = (n: number, off = 'Off') => Array.from({ length: n + 1 }, (_, i) => [String(i), i === 0 ? off : String(i)] as [string, string]);
    $('#settings .panel').innerHTML = `
      <h2>Settings</h2>
      <div class="row"><span>Graphics quality</span>${opt('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], st.quality)}</div>
      <div class="row"><span>Resolution</span>${opt('resolution', res.map((r) => [r, r === 'native' ? 'Window' : r]), st.resolution)}</div>
      <div class="row"><span>Display</span>${opt('fullscreen', [['false', 'Windowed'], ['true', 'Fullscreen']], String(st.fullscreen))}</div>
      <div class="row"><span>Difficulty (traffic)</span>${opt('difficulty', [['0', 'Easy'], ['1', 'Normal'], ['2', 'Hard'], ['3', 'Insane']], String(st.difficulty))}</div>
      <div class="row"><span>FPS counter <small>(shows frame rate and render resolution)</small></span>${opt('showFps', [['false', 'Off'], ['true', 'On']], String(st.showFps))}</div>
      <div class="row"><span>Speed units</span>${opt('units', [['mph', 'MPH'], ['kph', 'KM/H']], st.units)}</div>
      <div class="row"><span>Default camera</span>${opt('camera', [['chase', 'Chase'], ['hood', 'Hood / Cockpit']], st.camera)}</div>
      <div class="row"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" data-vol="master" value="${st.volumes.master}"></div>
      <div class="row"><span>Engine volume</span><input type="range" min="0" max="1" step="0.05" data-vol="engine" value="${st.volumes.engine}"></div>
      <div class="row"><span>Effects volume</span><input type="range" min="0" max="1" step="0.05" data-vol="sfx" value="${st.volumes.sfx}"></div>
      <h2 style="margin-top:22px">Rider aids <span style="letter-spacing:0.05em;text-transform:none">(motorcycles · each bike's stock electronics cap how high an aid can go)</span></h2>
      <div class="row"><span>ABS <small>(2 = cornering ABS + rear-lift control)</small></span>${opt('abs', lv(2), String(st.aids.abs))}</div>
      <div class="row"><span>Traction control</span>${opt('tc', lv(3), String(st.aids.tc))}</div>
      <div class="row"><span>Anti-wheelie</span>${opt('aw', lv(3), String(st.aids.aw))}</div>
      <div class="row"><span>Engine braking</span>${opt('eb', [['0', 'Low'], ['1', 'Medium'], ['2', 'High']], String(st.aids.eb))}</div>
      <div class="row"><span>Riding style <small>(manual: you lean the bike and shift your weight yourself)</small></span>${opt('style', [['assisted', 'Assisted'], ['manual', 'Manual']], st.ridingStyle)}</div>
      <h2 style="margin-top:22px">Controls <span style="letter-spacing:0.05em;text-transform:none">(click a binding, then press a key or a gamepad button / stick · Esc cancels · bikes: hold brake while accelerating to pull a wheelie)</span></h2>
      <div class="binds">${binds}</div>
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
        <button data-x="reset">Reset controls</button><button data-x="back" class="primary">Done</button></div>`;
    const panel = $('#settings .panel');
    panel.onclick = (e) => {
      const el = e.target as HTMLElement;
      const k = (el.parentElement as HTMLElement | null)?.dataset.k;
      if (k && el.dataset.v !== undefined) {
        const v = el.dataset.v;
        this.h.click();
        if (k === 'quality') st.quality = v as QualityName;
        else if (k === 'resolution') st.resolution = v;
        else if (k === 'fullscreen') st.fullscreen = v === 'true';
        else if (k === 'difficulty') st.difficulty = Number(v);
        else if (k === 'showFps') st.showFps = v === 'true';
        else if (k === 'units') st.units = v as 'mph' | 'kph';
        else if (k === 'camera') st.camera = v as 'chase' | 'hood';
        else if (k === 'abs' || k === 'tc' || k === 'aw' || k === 'eb') st.aids[k] = Number(v);
        else if (k === 'style') st.ridingStyle = v as 'assisted' | 'manual';
        this.save.persist(); this.h.settingsChanged(); this.buildSettings();
        return;
      }
      if (el.dataset.b) {
        this.cancelCapture?.();
        this.waiting = { a: el.dataset.b as Action, i: Number(el.dataset.i) };
        this.buildSettings();
        if (this.waiting.i === 2) this.capturePad?.(this.waiting.a);
        else this.captureKey?.(this.waiting.a, this.waiting.i);
        return;
      }
      if (el.dataset.x === 'reset') { this.cancelCapture?.(); this.waiting = null; st.bindings = structuredClone(DEFAULT_BINDINGS); st.padBindings = structuredClone(DEFAULT_PAD); this.save.persist(); this.h.settingsChanged(); this.buildSettings(); }
      if (el.dataset.x === 'back') { this.cancelCapture?.(); this.waiting = null; this.h.click(); this.h.back(); }
    };
    panel.oninput = (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.vol) { (st.volumes as Record<string, number>)[el.dataset.vol] = Number(el.value); this.save.persist(); this.h.settingsChanged(); }
    };
  }
  padCaptured(a: Action, code: string) {
    const st = this.save.data.settings;
    // one gamepad input per action: take it off whatever had it before
    for (const other of Object.keys(st.padBindings) as Action[]) if (st.padBindings[other] === code) st.padBindings[other] = '';
    st.padBindings[a] = code;
    this.waiting = null;
    this.save.persist();
    this.h.settingsChanged();
    this.buildSettings();
  }
  keyCaptured(a: Action, i: number, code: string) {
    const st = this.save.data.settings;
    if (code !== 'Escape' || a === 'pause') {
      // unbind the key from other actions to avoid conflicts
      for (const other of Object.keys(st.bindings) as Action[]) st.bindings[other] = st.bindings[other].map((c) => (c === code ? '' : c));
      st.bindings[a][i] = code;
    }
    this.waiting = null;
    this.save.persist();
    this.h.settingsChanged();
    this.buildSettings();
  }

  // ---------------- HUD ----------------
  private lastHud = '';
  hud(speed: number, gear: number, rpmN: number, score: number, mult: number, combo: number, countdown: number, units: 'mph' | 'kph') {
    const k = units === 'mph' ? MPH : KPH;
    const spd = Math.round(Math.abs(speed) * k);
    const key = `${spd}|${gear}|${Math.round(rpmN * 50)}|${Math.round(score)}|${mult}|${Math.round(combo * 40)}|${Math.ceil(countdown)}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    $('#hud .spd').textContent = String(spd);
    $('#hud .gear').textContent = speed < -0.5 ? 'R' : String(gear);
    $('#hud .unit').textContent = units === 'mph' ? 'MPH' : 'KM/H';
    ($('#hud .tach i') as HTMLElement).style.width = `${Math.min(100, rpmN * 100)}%`;
    $('#hud .score .v').textContent = Math.round(score).toLocaleString();
    $('#hud .score .m').textContent = `x${mult.toFixed(1)}`;
    ($('#hud .combo i') as HTMLElement).style.width = `${combo * 100}%`;
    $('#hud .count').textContent = countdown > 0 ? String(Math.ceil(countdown)) : '';
  }
  popup(p: Popup) {
    const d = document.createElement('div');
    d.className = 'pop' + (p.big ? ' big' : '');
    d.style.color = p.color;
    d.innerHTML = `${esc(p.text)}${p.sub ? `<small>${esc(p.sub)}</small>` : ''}`;
    const box = $('#hud .pops');
    box.appendChild(d);
    while (box.children.length > 4) box.firstElementChild!.remove();
    setTimeout(() => d.remove(), 1600);
  }
  /** bike-only HUD: aid lights and tire temperature */
  bikeHud(on: boolean, abs = false, tc = false, aw = false, temp = 0, wear = 0) {
    const el = $('#hud .bikehud');
    el.hidden = !on;
    if (!on) return;
    el.querySelector('[data-l=abs]')!.classList.toggle('on', abs);
    el.querySelector('[data-l=tc]')!.classList.toggle('on', tc);
    el.querySelector('[data-l=aw]')!.classList.toggle('on', aw);
    const i = el.querySelector('.tyre i') as HTMLElement;
    i.style.width = `${Math.round(Math.min(1.3, temp) / 1.3 * 100)}%`;
    i.style.background = temp < 0.75 ? '#5ab0ff' : temp < 1.1 ? '#4dff88' : '#ff5a4d';
    i.style.opacity = String(1 - wear * 0.5);
  }
  private lastStars = -1;
  /** wanted level as filled stars (lower left); they flash red / blue while cops are on the road */
  stars(level: number, chased: boolean) {
    const el = $('#hud .stars');
    el.classList.toggle('chase', chased && level > 0);
    if (level === this.lastStars) return;
    if (level > this.lastStars && this.lastStars >= 0) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    this.lastStars = level;
    el.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i < level));
  }
  fps(on: boolean, fps: number, worstMs: number, scale: number) {
    const el = $('#hud .fps');
    el.hidden = !on;
    if (on) el.textContent = `${Math.round(fps)} FPS · worst frame ${Math.round(worstMs)} ms · render ${Math.round(scale * 100)}%`;
  }
  /** results screen controller shortcuts (A retry, X vehicle, Y map, B main menu) */
  resultsShortcut(a: 'retry' | 'vehicle' | 'map' | 'menu') {
    this.h.click();
    if (a === 'retry') this.h.restart(); else if (a === 'vehicle') this.h.garage(); else if (a === 'map') this.h.maps(); else this.h.toMenu();
  }
  crashMessage(text: string, caught = false) {
    const e = $('#crashui .shame'); e.textContent = text; e.hidden = !text;
    const w = $('#crashui .wreck'); w.textContent = caught ? 'CAUGHT' : 'WRECKED'; w.classList.toggle('caught', caught);
    // restart the banner animation for this crash
    w.style.animation = 'none'; void w.offsetWidth; w.style.animation = '';
  }
  flash(v: number) { ($('#flash') as HTMLElement).style.opacity = String(v); }

  // ---------------- results ----------------
  results(r: RunResult, mapId: string, vehicleId: string, rank: number, units: 'mph' | 'kph') {
    const k = units === 'mph' ? MPH : KPH;
    const board = this.save.data.leaderboard[mapId] ?? [];
    const dist = units === 'mph' ? `${(r.distance / 1609.34).toFixed(2)} mi` : `${(r.distance / 1000).toFixed(2)} km`;
    const how = r.caught ? 'Caught by the police' : { car: 'Rear-ended / side-swiped traffic', headon: 'Head-on collision', barrier: 'Hit the barrier', tree: 'Left the road', rock: 'Hit a rock', lowside: 'Lowside: the bike slid out from under you', highside: 'Highside: the rear grabbed and threw you', looped: 'Looped it: flipped over backwards', endo: 'Went over the bars', tipover: 'Fell over' }[r.crashKind];
    $('#results .panel').innerHTML = `
      <div>
        <h2>Run over · ${esc(getMap(mapId).name)}</h2>
        ${r.message ? `<div class="shame small">${esc(r.message)}</div>` : ''}
        <div class="big">${r.score.toLocaleString()}</div>
        ${rank === 0 ? '<div class="newbest">NEW MAP RECORD</div>' : rank > 0 ? `<div class="newbest">#${rank + 1} ON THE LEADERBOARD</div>` : ''}
        <div class="kv">
          <span>Vehicle</span><b>${esc(getVehicle(vehicleId).name)}</b>
          <span>Distance</span><b>${dist}</b>
          <span>Top speed</span><b>${Math.round(r.topSpeed * k)} ${units === 'mph' ? 'mph' : 'km/h'}</b>
          <span>Near misses</span><b>${r.nearMisses}</b>
          <span>Cut-ups</span><b>${r.cutUps}</b>
          <span>Time</span><b>${r.time.toFixed(1)} s</b>
          <span>Wreck</span><b>${how}</b>
        </div>
      </div>
      <div><h2>Best runs · local</h2>
        <table>${board.map((e: RunEntry, i) => `<tr class="${i === rank ? 'me' : ''}"><td>${i + 1}</td><td>${e.score.toLocaleString()}</td><td>${esc(getVehicle(e.vehicle).name)}</td><td>${Math.round(e.topSpeed * k)}</td></tr>`).join('') || '<tr><td>No runs</td></tr>'}</table></div>
      <div class="btns">
        <div class="rb"><button data-a="retry" class="primary">Retry</button><span class="padkey a" title="Controller A">A</span></div>
        <div class="rb"><button data-a="vehicle">Change vehicle</button><span class="padkey x" title="Controller X">X</span></div>
        <div class="rb"><button data-a="map">Change map</button><span class="padkey y" title="Controller Y">Y</span></div>
        <div class="rb"><button data-a="menu">Main menu</button><span class="padkey b" title="Controller B">B</span></div>
      </div>`;
    $('#results .panel').onclick = (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (!a) return;
      this.h.click();
      if (a === 'retry') this.h.restart(); else if (a === 'vehicle') this.h.garage(); else if (a === 'map') this.h.maps(); else this.h.toMenu();
    };
    this.show('results');
  }

  // ---------------- keyboard / gamepad menu navigation ----------------
  private buttons() {
    const scr = document.getElementById(this.current);
    if (!scr) return [];
    return [...scr.querySelectorAll('button, .card')].filter((b) => (b as HTMLElement).offsetParent !== null) as HTMLElement[];
  }
  private applyFocus() {
    const bs = this.buttons();
    bs.forEach((b, i) => b.classList.toggle('focus', i === this.focusIdx));
  }
  nav(dir: number) {
    const bs = this.buttons();
    if (!bs.length) return;
    this.focusIdx = this.focusIdx < 0 ? 0 : (this.focusIdx + dir + bs.length) % bs.length;
    this.applyFocus();
    bs[this.focusIdx].scrollIntoView({ block: 'nearest' });
  }
  activate() {
    const bs = this.buttons();
    bs[this.focusIdx]?.click();
  }
}
