// Rain: in game screenshots (city and forest) and the Map Select weather picker. rain-shot.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.click('#menu button[data-a="maps"]');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/maps_weather.png` });
for (const map of ['city', 'forest']) {
  const grip = await page.evaluate((map) => {
    const a = (window as any).__app; (window as any).__forceSeed = 5;
    a.save.data.settings.weather = 'rain'; a.save.data.settings.timeOfDay = 'day';
    a.startGame(map, 'zr1'); const g = a.game; g.startCrash = () => undefined;
    a.advance(4, 1 / 30); g.player.phys.v = 30; a.advance(1, 1 / 30);
    return { wet: g.weather.wet, grip: g.player.phys.gripScale, fogFar: Math.round(g.env.fog.far) };
  }, map);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/rain_${map}.png` });
  console.log(map, JSON.stringify(grip));
}
await page.evaluate(() => { (window as any).__app.save.data.settings.weather = 'changing'; });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
