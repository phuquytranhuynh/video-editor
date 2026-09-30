// Đóng gói Worker nhận dạng giọng nói (transformers.js + onnxruntime-web) thành 1 file để chạy trong Worker/Electron
import { build } from 'esbuild';
import { mkdirSync, existsSync, copyFileSync } from 'fs';

mkdirSync('js/vendor', { recursive: true });
if (!existsSync('node_modules/@huggingface/transformers')) {
  console.log('[build-stt] chưa cài @huggingface/transformers – bỏ qua');
  process.exit(0);
}
await build({
  entryPoints: ['js/stt-worker.src.mjs'],
  outfile: 'js/vendor/stt-worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
// onnxruntime-web: file WebAssembly được nạp lúc chạy (không nằm trong bundle)
mkdirSync('js/vendor/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  copyFileSync('node_modules/onnxruntime-web/dist/' + f, 'js/vendor/ort/' + f);
}
console.log('[build-stt] đã tạo js/vendor/stt-worker.mjs và js/vendor/ort/*');
