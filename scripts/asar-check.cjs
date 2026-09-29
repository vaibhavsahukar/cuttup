// Launch the packaged-mode app (dist via file://) under Electron and report page errors + state.
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '/home/user/cuttup/release/win-unpacked/resources/app.asar'], cwd: '/home/user/cuttup', executablePath: require('electron') });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForFunction(() => window.__app, null, { timeout: 30000 });
  await win.waitForTimeout(1500);
  const url = win.url();
  const hasNative = await win.evaluate(() => !!window.native);
  await win.evaluate(() => { window.__app.startGame('forest', 'smc'); window.__app.advance(5); });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: '/tmp/claude-0/s2/asar_forest.png' });
  const st = await win.evaluate(() => { const g = window.__app.game; return { state: g.state, v: g.player.phys.v }; });
  // persistence through the Electron IPC save file
  await win.evaluate(() => window.__app.save.persist());
  const saved = await win.evaluate(() => window.native.readSave());
  console.log(JSON.stringify({ url, hasNative, st, savedBytes: saved && saved.length, errors }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
