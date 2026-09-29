// The crash ear-ring must respect the master / effects volume: count oscillators wired straight to the output.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(() => {
  const app = (window as any).__app; app.startGame('city', 'zr1');
  const audio = app.game.audio;
  const res: any = {};
  const orig = AudioNode.prototype.connect as any;
  let direct = 0, peak = 0;
  (AudioNode.prototype as any).connect = function (dest: any, ...r: any[]) {
    if (dest === audio.ctx.destination && !(this instanceof DynamicsCompressorNode)) { direct++; }
    return orig.call(this, dest, ...r);
  };
  for (const [m, s] of [[0, 0.8], [0.8, 0], [0.8, 0.8], [0.4, 0.8]] as const) {
    audio.volumes.master = m; audio.volumes.sfx = s; direct = 0;
    audio.crash(1);
    res[`master ${m} sfx ${s}`] = direct;
  }
  (AudioNode.prototype as any).connect = orig; void peak;
  return JSON.stringify(res);
}));
await b.close();
