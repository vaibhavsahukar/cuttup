// Hunt for black frames: render every frame at the end of the update and sample the screen. black-check.ts [scenario]
import { chromium } from 'playwright';
const only = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 480, height: 270 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (/error|warn|lost|invalid|nan/i.test(m.text()) && !/AudioContext|PCFSoft/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const scenarios: Record<string, string> = {
  night_wall: `
    st.timeOfDay = 'night'; st.weather = 'clear'; start('city'); g.highBeamOn = true;
    drive(600, (i) => { ph.v = 38; ph.psi = 0; ph.vl = 0; ph.d = g.layout.playerMax - 0.6; });`,
  night_fork: `
    st.timeOfDay = 'night'; st.weather = 'clear'; start('city');
    const sF = g.features.forkAfter(0); ph.s = sF - 600; for (const c of g.traffic.cars) c.s += 99999;
    drive(900, (i) => { ph.v = 30; ph.psi = 0; ph.vl = 0; const fk = g.fork; if (fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); } else if (fk && fk.state === 'branch') ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(2) - ph.d)); else ph.d = g.layout.laneCenter(4); });`,
  rain_thunder: `
    st.timeOfDay = 'dusk'; st.weather = 'rain'; start('country');
    drive(900, (i) => { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); if (i % 150 === 5) g.weather.flash = 1; });`,
  crash_boom: `
    st.timeOfDay = 'night'; st.weather = 'clear'; start('city');
    drive(60, (i) => { ph.v = 40; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); });
    g.startCrash('car', 60, g.traffic.cars.find((c) => c.dir > 0) ?? null);
    drive(300, () => {});`,
  restarts: `
    for (let r = 0; r < 6; r++) { st.timeOfDay = r % 2 ? 'night' : 'day'; start(r % 3 === 0 ? 'city' : r % 3 === 1 ? 'country' : 'forest'); drive(40, () => { ph.v = 30; ph.psi = 0; ph.vl = 0; }); }`,
};
for (const [name, body] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  const res = await page.evaluate(([body]) => {
    const a = (window as any).__app; const st = a.save.data.settings; (window as any).__forceSeed = 31;
    let g: any, ph: any;
    const gl = a.renderer.getContext();
    const px = new Uint8Array(4);
    const W = a.renderer.domElement.width, H = a.renderer.domElement.height;
    const sample = () => {
      let lum = 0, dark = 0; const n = 8 * 5;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) { gl.readPixels(Math.floor((x + 0.5) * W / 8), Math.floor((y + 0.5) * H / 5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const l = px[0] + px[1] + px[2]; lum += l; if (l < 6) dark++; }
      return { lum: lum / n, dark: dark / n };
    };
    const log: string[] = []; let prev = -1, frames = 0, flashes = 0;
    const start = (map: string) => { a.startGame(map, 'zr1'); g = a.game; ph = g.player.phys; g.fuel = 1; a.advance(3.2, 1 / 30); };
    const drive = (n: number, f: (i: number) => void) => {
      for (let i = 0; i < n; i++) {
        f(i); g.fuel = 1; if (g.state === 'driving') g.scoring.score = 0;
        a.advance(1 / 30, 1 / 30);
        g.render();
        const s = sample(); frames++;
        if (prev > 25 && s.lum < prev * 0.35) { flashes++; if (log.length < 6) log.push(`frame ${frames}: lum ${s.lum.toFixed(0)} (was ${prev.toFixed(0)}) dark=${s.dark.toFixed(2)} s=${Math.round(ph.s)} state=${g.state}`); }
        prev = s.lum;
      }
    };
    // evaluate the scenario text with live bindings
    eval(`(function(){ ${body} })()`);
    return `frames=${frames} suddenDarkFrames=${flashes}${log.length ? '\n    ' + log.join('\n    ') : ''}`;
  }, [body] as const).catch((e) => 'ERR ' + e.message.slice(0, 300));
  console.log(name, res);
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
