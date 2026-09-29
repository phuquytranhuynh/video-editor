// Vỏ Electron: chạy giao diện trong cửa sổ riêng, hoàn toàn offline trên máy
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---- tìm ffmpeg (ffmpeg-static đi kèm, hoặc ffmpeg có sẵn trong PATH) ----
function findFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p) {
      p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* không có ffmpeg-static */ }
  const r = spawnSync('ffmpeg', ['-version']);
  return r.status === 0 ? 'ffmpeg' : null;
}
const FFMPEG = findFfmpeg();

ipcMain.handle('ve:caps', () => ({ ffmpeg: !!FFMPEG }));

ipcMain.handle('ve:finalize', async (e, buffer, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const ext = opts.mode === 'mp4' ? 'mp4' : 'webm';
  const base = (opts.name || 'video').replace(/\.[^.]+$/, '');
  const res = await dialog.showSaveDialog(win, {
    title: 'Lưu video', defaultPath: path.join(app.getPath('videos'), base + '.' + ext),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  const data = Buffer.from(buffer);
  if (opts.mode === 'raw' || !FFMPEG) { fs.writeFileSync(res.filePath, data); return { ok: true, path: res.filePath, note: opts.mode !== 'raw' ? 'Không có ffmpeg: đã lưu nguyên bản WebM' : '' }; }
  const tmp = path.join(os.tmpdir(), 've-' + Date.now() + '.webm');
  fs.writeFileSync(tmp, data);
  const args = ['-y', '-i', tmp];
  if (opts.mode === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-b:v', String(opts.vbps || 8e6), '-maxrate', String(Math.round((opts.vbps || 8e6) * 1.5)), '-bufsize', String((opts.vbps || 8e6) * 2),
      '-pix_fmt', 'yuv420p', '-r', String(opts.fps || 30), '-c:a', 'aac', '-b:a', String(opts.abps || 192000), '-movflags', '+faststart');
  } else args.push('-c', 'copy'); // remux: thêm metadata thời lượng cho WebM
  args.push(res.filePath);
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (er) => { fs.rmSync(tmp, { force: true }); resolve({ ok: false, error: er.message }); });
    p.on('close', (code) => {
      fs.rmSync(tmp, { force: true });
      if (code === 0) resolve({ ok: true, path: res.filePath });
      else { fs.writeFileSync(res.filePath.replace(/\.[^.]+$/, '') + '.raw.webm', data); resolve({ ok: false, error: 'ffmpeg lỗi (' + code + '): ' + err.slice(-300) + ' – đã lưu bản WebM gốc cạnh file đích' }); }
    });
  });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 650,
    backgroundColor: '#161616',
    title: 'Video Editor Local',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // giữ tốc độ dựng/xuất khi cửa sổ bị che
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.maximize();

  // hỏi trước khi đóng nếu timeline còn nội dung
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Ở lại', 'Thoát'], defaultId: 0, cancelId: 0,
      title: 'Thoát', message: 'Dự án đang mở đã được tự động lưu. Bạn muốn thoát?',
    });
    if (choice === 1) e.preventDefault();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // dùng thanh menu riêng của ứng dụng
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
