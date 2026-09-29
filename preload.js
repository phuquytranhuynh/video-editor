const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veNative', {
  caps: () => ipcRenderer.invoke('ve:caps'),
  // buffer: ArrayBuffer webm từ MediaRecorder; opts: {name, mode: 'raw'|'remux'|'mp4', vbps, abps, fps}
  finalize: (buffer, opts) => ipcRenderer.invoke('ve:finalize', buffer, opts),
});
