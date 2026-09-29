// Model Viewer: open from the home screen and screenshot several entries.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.click('#menu button[data-a="models"]');
await page.waitForTimeout(800);
const n = await page.evaluate(() => document.querySelectorAll('#models .list button').length);
console.log('entries:', n);
for (const key of ['v:r6', 't:boxtruck', 'c:cop_charger', 't:pickup']) {
  await page.click(`#models .list button[data-m="${key}"]`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/vw_${key.replace(':', '_')}.png` });
}
// walk every entry with Next to make sure each one builds
const built = await page.evaluate(async () => {
  const btn = document.querySelector('#models .actions button[data-a="next"]') as HTMLElement;
  let ok = 0; for (let i = 0; i < 40; i++) { btn.click(); ok++; }
  return ok;
});
console.log('next clicks:', built, 'errors:', errors.length ? errors : 'none');
await b.close();
