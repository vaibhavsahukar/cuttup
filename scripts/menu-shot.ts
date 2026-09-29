// Main menu screenshot: menu-shot.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.waitForTimeout(1500);
console.log('title:', await page.title());
await page.screenshot({ path: `${out}/menu.png` });
await b.close();
