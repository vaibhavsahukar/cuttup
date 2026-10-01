// Frames for a looping GIF: the city highway at dusk, clear, chase camera at 80 mph. gif-frames.ts <outDir> [frames]
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const N = Number(process.argv[3] ?? 120), FPS = 20;
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.addStyleTag({ content: '#hud, #hud * { visibility: hidden !important }' });
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 11;
  const st = a.save.data.settings; st.quality = 'high'; st.weather = 'clear'; st.timeOfDay = 'dusk'; st.difficulty = 0;
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1; a.advance(3.2, 1 / 30);
  const ph = g.player.phys; ph.d = g.layout.laneCenter(2);
  // run up to speed first (80 mph = 35.76 m/s)
  for (let i = 0; i < 240; i++) { ph.v = 35.76; ph.d += (g.layout.laneCenter(2) - ph.d) * 0.1; ph.psi = 0; a.advance(1 / 60, 1 / 60); }
});
for (let f = 0; f < N; f++) {
  await page.evaluate((fps) => {
    const a = (window as any).__app, g = a.game, ph = g.player.phys;
    for (let i = 0; i < 60 / fps; i++) { ph.v = 35.76; ph.psi = 0; ph.vl = 0; ph.d += (g.layout.laneCenter(2) - ph.d) * 0.1; g.fuel = 1; a.advance(1 / 60, 1 / 60); }
    g.render();
  }, FPS);
  await page.screenshot({ path: `${out}/f${String(f).padStart(3, '0')}.png` });
}
await b.close();
