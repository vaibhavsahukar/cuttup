// Live probe: crash into the roadside with and without a wanted level and read the crash line from the UI.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => (window as any).__app);
const out: any[] = [];
for (const score of [0, 6000]) for (let k = 0; k < 12; k++) {
  const r = await page.evaluate((score) => {
    const app = (window as any).__app;
    app.startGame('city', 'zr1');
    const g = app.game;
    app.advance(2);
    g.scoring.score = score;
    app.advance(1);
    g.startCrash('barrier', 30, null); // a roadside crash: no cop involved
    return { score, wanted: g.police.wanted, state: g.state, kind: g.result?.crashKind, text: g.result?.message };
  }, score);
  out.push(r);
}
for (const r of out) console.log(JSON.stringify(r));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
