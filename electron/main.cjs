const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
function create() {
  win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#07080c', title: 'CUT-UP',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

const saveFile = () => path.join(app.getPath('userData'), 'cutup-save.json');
ipcMain.handle('save:read', () => { try { return fs.readFileSync(saveFile(), 'utf8'); } catch { return null; } });
ipcMain.handle('save:write', (_e, data) => { fs.writeFileSync(saveFile(), String(data)); return true; });
ipcMain.handle('win:fullscreen', (_e, on) => { win.setFullScreen(!!on); return true; });
ipcMain.handle('win:resolution', (_e, w, h) => { if (!win.isFullScreen()) { win.setContentSize(w | 0, h | 0); win.center(); } return true; });
ipcMain.handle('app:quit', () => app.quit());

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
