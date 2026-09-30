// Vỏ Electron: chạy giao diện trong cửa sổ riêng, hoàn toàn offline trên máy
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Giao thức app:// (thay cho file://) để Worker / WebAssembly / fetch hoạt động, kèm cách ly nguồn gốc cho WASM đa luồng
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

const ROOT = __dirname;
let MODELS_DIR = process.env.VE_MODELS_DIR || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

function serve(req) {
  try {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    let base = ROOT, rel = p;
    if (p.startsWith('/usermodels/')) { base = MODELS_DIR; rel = p.slice('/usermodels'.length); }
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(path.normalize(base))) return new Response('forbidden', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).then((res) => {
      const headers = new Headers(res.headers);
      const type = MIME[path.extname(file).toLowerCase()];
      if (type) headers.set('Content-Type', type);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, headers });
    });
  } catch (e) {
    return new Response('error', { status: 500 });
  }
}

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

ipcMain.handle('ve:caps', () => ({ ffmpeg: !!FFMPEG, modelsDir: MODELS_DIR }));
ipcMain.handle('ve:openModels', () => { fs.mkdirSync(MODELS_DIR, { recursive: true }); return shell.openPath(MODELS_DIR); });

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
  win.loadURL('app://local/index.html');
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
  if (!MODELS_DIR) MODELS_DIR = path.join(app.getPath('userData'), 'models');
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  protocol.handle('app', serve);
  Menu.setApplicationMenu(null); // dùng thanh menu riêng của ứng dụng
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
