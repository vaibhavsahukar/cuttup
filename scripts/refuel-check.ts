// Drive through a highway station's pump lane at 40 mph: how fast it fills, TANK FULL count, FILLING/FILLED sequence. refuel-check.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const [map, v] of [['country', 18], ['city', 21], ['forest', 15]] as const) {
  console.log(map, await page.evaluate(([map, v]) => {
    const a = (window as any).__app; (window as any).__forceSeed = 8; a.startGame(map, 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
    const F = g.features, ph = g.player.phys;
    const st = F.next(ph.s + 600);
    let full = 0; const prev = g.onPopup; g.onPopup = (p: any) => { if (p.text === 'TANK FULL') full++; prev?.(p); };
    g.fuel = 0.2;
    const len = st.ramp ? 400 : 190;
    ph.s = st.s0 + (st.ramp ? 120 : 20);
    const seq: string[] = []; let firstFill = -1, fullAt = -1;
    for (let i = 0; i < 900 && ph.s - st.s0 < len; i++) {
      const x = ph.s - st.s0;
      ph.d = st.ramp ? F.rampLane(x).c : F.edge + 6.5; ph.psi = 0; ph.vl = 0; ph.v = v as number;
      a.advance(1 / 30, 1 / 30);
      const s = g.fuelStatus ?? '-';
      if (seq[seq.length - 1] !== s) seq.push(s);
      if (firstFill < 0 && s === 'filling') firstFill = Math.round(ph.s - st.s0);
      if (fullAt < 0 && g.fuel >= 1) fullAt = Math.round(ph.s - st.s0);
    }
    return `fuel=${g.fuel.toFixed(2)} firstFillX=${firstFill} fullAtX=${fullAt} tankFullPopups=${full} statuses=${seq.join('>')} hud=${(document.querySelector('#hud .fuel .nx') as HTMLElement)?.textContent}`;
  }, [map, v] as const));
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
