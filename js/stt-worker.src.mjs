// Worker nhận dạng giọng nói (Whisper chạy bằng WebAssembly qua transformers.js) – chạy hoàn toàn trên máy.
// Model được tải 1 lần từ Hugging Face rồi lưu đệm trong máy; cũng có thể đặt sẵn vào thư mục models để dùng offline.
import { pipeline, env } from '@huggingface/transformers';

let asr = null;
let loadedModel = null;

const send = (msg) => self.postMessage(msg);

async function load(cfg) {
  if (asr && loadedModel === cfg.model) return;
  asr = null;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.localModelPath = cfg.localModelPath;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = cfg.wasmPaths;
  env.backends.onnx.wasm.numThreads = cfg.threads || 1;
  const files = {};
  asr = await pipeline('automatic-speech-recognition', cfg.model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        const all = Object.values(files);
        send({ type: 'load-progress', loaded: all.reduce((a, f) => a + f.loaded, 0), total: all.reduce((a, f) => a + f.total, 0), file: p.file });
      } else if (p.status === 'initiate' || p.status === 'download') send({ type: 'load-status', file: p.file });
    },
  });
  loadedModel = cfg.model;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'transcribe') {
      send({ type: 'phase', phase: 'loading' });
      await load(m.cfg);
      send({ type: 'phase', phase: 'transcribing' });
      const dur = m.audio.length / 16000;
      const chunkLen = 30, stride = 5;
      const total = Math.max(1, Math.ceil(Math.max(0, dur - stride) / (chunkLen - 2 * stride)));
      let done = 0;
      const opt = {
        task: 'transcribe',
        chunk_length_s: chunkLen,
        stride_length_s: stride,
        return_timestamps: true,
        chunk_callback: () => { done++; send({ type: 'progress', done: Math.min(done, total), total }); },
      };
      if (m.language && m.language !== 'auto') opt.language = m.language;
      const out = await asr(m.audio, opt);
      const chunks = (out.chunks || []).map((c) => ({ text: c.text, start: c.timestamp[0] == null ? 0 : c.timestamp[0], end: c.timestamp[1] == null ? c.timestamp[0] + 2 : c.timestamp[1] }));
      send({ type: 'result', text: out.text, chunks });
    }
  } catch (err) {
    send({ type: 'error', message: (err && err.message) || String(err) });
  }
};

send({ type: 'ready' });
