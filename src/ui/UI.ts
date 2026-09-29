import { VEHICLES, getVehicle, statBars } from '../data/vehicles';
import { MAPS, getMap } from '../data/maps';
import { ACTIONS, DEFAULT_BINDINGS, type Action } from '../input/Input';
import type { Save, RunEntry, QualityName } from '../storage/Save';
import type { Popup } from '../game/Scoring';
import type { RunResult } from '../game/Game';
import { MPH, KPH } from '../core/math';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export type ScreenId = 'menu' | 'garage' | 'maps' | 'settings' | 'hud' | 'pause' | 'results' | 'crashui';

export interface UIHandlers {
  play(): void; garage(): void; maps(): void; settings(): void; quit(): void;
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
          <div class="logo">CUT-UP</div>
          <div class="tag">ENDLESS TRAFFIC · NO BRAKES ON FUN</div>
          <button data-a="play" class="primary">Play</button>
          <button data-a="garage">Vehicle Select</button>
          <button data-a="maps">Map Select</button>
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
      <div id="maps" class="screen"><div class="cards"></div>
        <div class="actions"><button data-a="back">Back</button><button data-a="go" class="primary">Start run</button></div></div>
      <div id="settings" class="screen"><div class="panel"></div></div>
      <div id="hud" class="screen">
        <div class="ctrl" id="ctrlHint"></div>
        <div class="score"><div class="v">0</div><div class="m">x1.0</div><div class="combo"><i></i></div></div>
        <div class="pops"></div>
        <div class="count"></div>
        <div class="dist"></div>
        <div class="speedo"><span class="spd">0</span><span class="gear">1</span><div class="unit">MPH</div><div class="tach"><i></i></div></div>
      </div>
      <div id="crashui" class="screen letterbox"><div class="wreck">WRECKED</div><div class="skip">PRESS SPACE / ESC TO SKIP</div></div>
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
      if (a === 'play') this.h.play(); else if (a === 'garage') this.h.garage(); else if (a === 'maps') this.h.maps();
      else if (a === 'settings') { this.settingsReturn = 'menu'; this.h.settings(); } else if (a === 'quit') this.h.quit();
    });
    $('#garage .actions').addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      this.h.click();
      if (a === 'back') this.h.back(); else if (a === 'choose') this.h.selectVehicle(this.previewId);
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
    if (id === 'settings') this.buildSettings();
    if (id === 'menu') $('#menuHint').textContent = `${getVehicle(this.save.data.settings.vehicle).name}  ·  ${getMap(this.save.data.settings.map).name}   —   Arrow keys / D-pad + Enter / (A) to navigate`;
    this.focusIdx = 0;
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
      <div class="specs">
        <div><b>POWER</b>${v.hp} hp</div><div><b>WEIGHT</b>${v.kind === 'bike' ? v.massKg - 75 : v.massKg} kg</div>
        <div><b>DRIVE</b>${v.drive}</div><div><b>0-60 MPH</b>${v.zeroSixty.toFixed(1)} s</div>
        <div><b>TOP SPEED</b>${v.topSpeedMph} mph${v.limited ? ' (lim.)' : ''}</div><div><b>BEST (${esc(getMap(this.save.data.settings.map).name)})</b>${this.save.best(this.save.data.settings.map, v.id).toLocaleString()}</div>
      </div>`;
    this.h.previewVehicle(id);
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
        ${m.id === 'city' ? `<div class="opts" style="margin-bottom:10px">Time: <button class="small ${st.cityTime === 'dusk' ? 'primary' : ''}" data-t="dusk">Dusk</button> <button class="small ${st.cityTime === 'night' ? 'primary' : ''}" data-t="night">Night</button></div>` : ''}
        <div class="best">${best ? `BEST ${best.score.toLocaleString()} · ${esc(getVehicle(best.vehicle).name)}` : 'NO RUNS YET'}</div></div>`;
    }).join('');
    $('#maps .cards').onclick = (e) => {
      const t = (e.target as HTMLElement).dataset.t;
      if (t) { st.cityTime = t as 'dusk' | 'night'; this.save.persist(); this.h.click(); this.buildMaps(); return; }
      const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!card) return;
      this.h.click();
      this.h.selectMap(card.dataset.m!);
      this.buildMaps();
    };
  }

  // ---------------- settings ----------------
  private waiting: { a: Action; i: number } | null = null;
  captureKey: ((a: Action, i: number) => void) | null = null;
  buildSettings() {
    const st = this.save.data.settings;
    const opt = (key: string, vals: [string, string][], cur: string) => `<div class="opts" data-k="${key}">${vals.map(([v, l]) => `<button class="${v === cur ? 'sel' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const res = ['native', '1280x720', '1600x900', '1920x1080', '2560x1440'];
    const binds = ACTIONS.map((a) => `<div>${a.label}</div>${[0, 1].map((i) => `<button data-b="${a.id}" data-i="${i}" class="${this.waiting && this.waiting.a === a.id && this.waiting.i === i ? 'wait' : ''}">${this.waiting && this.waiting.a === a.id && this.waiting.i === i ? 'press a key…' : esc(fmtKey(st.bindings[a.id][i] ?? ''))}</button>`).join('')}`).join('');
    $('#settings .panel').innerHTML = `
      <h2>Settings</h2>
      <div class="row"><span>Graphics quality</span>${opt('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], st.quality)}</div>
      <div class="row"><span>Resolution</span>${opt('resolution', res.map((r) => [r, r === 'native' ? 'Window' : r]), st.resolution)}</div>
      <div class="row"><span>Display</span>${opt('fullscreen', [['false', 'Windowed'], ['true', 'Fullscreen']], String(st.fullscreen))}</div>
      <div class="row"><span>Difficulty (traffic)</span>${opt('difficulty', [['0', 'Easy'], ['1', 'Normal'], ['2', 'Hard'], ['3', 'Insane']], String(st.difficulty))}</div>
      <div class="row"><span>Speed units</span>${opt('units', [['mph', 'MPH'], ['kph', 'KM/H']], st.units)}</div>
      <div class="row"><span>Default camera</span>${opt('camera', [['chase', 'Chase'], ['hood', 'Hood / Cockpit']], st.camera)}</div>
      <div class="row"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" data-vol="master" value="${st.volumes.master}"></div>
      <div class="row"><span>Engine volume</span><input type="range" min="0" max="1" step="0.05" data-vol="engine" value="${st.volumes.engine}"></div>
      <div class="row"><span>Effects volume</span><input type="range" min="0" max="1" step="0.05" data-vol="sfx" value="${st.volumes.sfx}"></div>
      <h2 style="margin-top:22px">Controls <span style="letter-spacing:0.05em;text-transform:none">(click a key to rebind · gamepad: RT/LT throttle/brake, left stick steer, A handbrake, Y camera, B look back, Start pause)</span></h2>
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
        else if (k === 'units') st.units = v as 'mph' | 'kph';
        else if (k === 'camera') st.camera = v as 'chase' | 'hood';
        this.save.persist(); this.h.settingsChanged(); this.buildSettings();
        return;
      }
      if (el.dataset.b) {
        this.waiting = { a: el.dataset.b as Action, i: Number(el.dataset.i) };
        this.buildSettings();
        this.captureKey?.(this.waiting.a, this.waiting.i);
        return;
      }
      if (el.dataset.x === 'reset') { st.bindings = structuredClone(DEFAULT_BINDINGS); this.save.persist(); this.h.settingsChanged(); this.buildSettings(); }
      if (el.dataset.x === 'back') { this.h.click(); this.h.back(); }
    };
    panel.oninput = (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.vol) { (st.volumes as Record<string, number>)[el.dataset.vol] = Number(el.value); this.save.persist(); this.h.settingsChanged(); }
    };
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
  hud(speed: number, gear: number, rpmN: number, score: number, mult: number, combo: number, dist: number, countdown: number, units: 'mph' | 'kph', top: number) {
    const k = units === 'mph' ? MPH : KPH;
    const spd = Math.round(Math.abs(speed) * k);
    const key = `${spd}|${gear}|${Math.round(rpmN * 50)}|${Math.round(score)}|${mult}|${Math.round(combo * 40)}|${Math.round(dist)}|${Math.ceil(countdown)}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    $('#hud .spd').textContent = String(spd);
    $('#hud .gear').textContent = speed < -0.5 ? 'R' : String(gear);
    $('#hud .unit').textContent = units === 'mph' ? 'MPH' : 'KM/H';
    ($('#hud .tach i') as HTMLElement).style.width = `${Math.min(100, rpmN * 100)}%`;
    $('#hud .score .v').textContent = Math.round(score).toLocaleString();
    $('#hud .score .m').textContent = `x${mult.toFixed(1)}`;
    ($('#hud .combo i') as HTMLElement).style.width = `${combo * 100}%`;
    const distStr = units === 'mph' ? `${(dist / 1609.34).toFixed(2)} mi` : `${(dist / 1000).toFixed(2)} km`;
    $('#hud .dist').innerHTML = `DISTANCE <b>${distStr}</b><br>TOP <b>${Math.round(top * k)}</b>`;
    $('#hud .count').textContent = countdown > 0 ? String(Math.ceil(countdown)) : '';
  }
  controlsHint() {
    const b = this.save.data.settings.bindings;
    const f = (a: Action) => fmtKey(b[a][0]);
    $('#ctrlHint').innerHTML = `${f('throttle')}/${f('brake')} GAS/BRAKE · ${f('left')}/${f('right')} STEER · ${f('handbrake')} HANDBRAKE · ${f('camera')} CAMERA · ${f('pause')} PAUSE`;
  }
  popup(p: Popup) {
    const d = document.createElement('div');
    d.className = 'pop' + (p.big ? ' big' : '');
    d.style.color = p.color;
    d.innerHTML = `${esc(p.text)}${p.sub ? `<small>${esc(p.sub)}</small>` : ''}`;
    const box = $('#hud .pops');
    box.appendChild(d);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => d.remove(), 1300);
  }
  flash(v: number) { ($('#flash') as HTMLElement).style.opacity = String(v); }

  // ---------------- results ----------------
  results(r: RunResult, mapId: string, vehicleId: string, rank: number, units: 'mph' | 'kph') {
    const k = units === 'mph' ? MPH : KPH;
    const board = this.save.data.leaderboard[mapId] ?? [];
    const dist = units === 'mph' ? `${(r.distance / 1609.34).toFixed(2)} mi` : `${(r.distance / 1000).toFixed(2)} km`;
    const how = { car: 'Rear-ended / side-swiped traffic', headon: 'Head-on collision', barrier: 'Hit the barrier', tree: 'Left the road' }[r.crashKind];
    $('#results .panel').innerHTML = `
      <div>
        <h2>Run over · ${esc(getMap(mapId).name)}</h2>
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
      <div class="btns"><button data-a="retry" class="primary">Retry</button><button data-a="vehicle">Change vehicle</button><button data-a="map">Change map</button><button data-a="menu">Main menu</button></div>`;
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
    this.focusIdx = (this.focusIdx + dir + bs.length) % bs.length;
    this.applyFocus();
    bs[this.focusIdx].scrollIntoView({ block: 'nearest' });
  }
  activate() {
    const bs = this.buttons();
    bs[this.focusIdx]?.click();
  }
}
