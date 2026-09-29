// HUD screenshots: hud-shot.ts <outDir> [id:units,...]   e.g. zr1:mph,r6:kph
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const cases = (process.argv[3] ?? 'zr1:mph,r6:kph').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const c of cases) {
  const [id, units] = c.split(':');
  await page.evaluate(([id, units]) => {
    const a = (window as any).__app;
    (window as any).__forceSeed = 7;
    a.save.data.settings.units = units; a.save.data.settings.timeOfDay = 'day';
    a.startGame('country', id);
    const g = a.game; g.startCrash = () => undefined;
    for (const t of g.traffic.cars) t.s += 9000;
    a.advance(4, 1 / 30);
    g.scoring.score = 12480;
    g.player.phys.v = 47;
    a.advance(2, 1 / 30);
    a.advance(0.5, 1 / 30);
    // popups normally vanish after 1.6 s, which is shorter than a software rendered screenshot takes: keep them
    const st = window.setTimeout; (window as any).setTimeout = () => 0;
    for (const p of [{ text: 'CUT UP!', sub: '+12 points', color: '#ffe25a' }, { text: 'NEAR MISS', color: '#2de2e6' }, { text: 'POLICE PURSUIT', sub: 'Interceptor unit', color: '#ff4040', big: true }]) g.onPopup?.(p);
    (window as any).setTimeout = st;
    document.querySelectorAll<HTMLElement>('.pop').forEach((e) => { e.style.animation = 'none'; });
  }, [id, units]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/hud_${id}_${units}.png` });
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
