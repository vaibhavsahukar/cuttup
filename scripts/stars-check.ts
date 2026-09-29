// Wanted stars + police tiers: set the score, let the game run, screenshot the HUD.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1000, height: 560 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => { const a = (window as any).__app; a.save.data.settings.timeOfDay = 'day'; a.startGame('city', 'zr1'); a.game.startCrash = () => undefined; a.advance(3.3, 1 / 30); });
for (const score of [4000, 5200, 10200, 26000]) {
  const r = await page.evaluate((score) => {
    const a = (window as any).__app, g = a.game;
    g.scoring.score = score;
    for (let i = 0; i < 200; i++) { g.player.phys.v = 40; g.player.phys.d = g.layout.laneCenter(2); g.player.phys.psi = 0; g.scoring.score = Math.max(g.scoring.score, score); a.advance(1 / 30, 1 / 30); }
    return { wanted: g.police.wanted, cops: g.police.cops.length, stars: document.querySelectorAll('#hud .stars span.on').length };
  }, score);
  console.log(score, JSON.stringify(r));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/stars_${score}.png`, clip: { x: 0, y: 0, width: 520, height: 130 } });
}
await b.close();
