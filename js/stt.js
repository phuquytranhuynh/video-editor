/* Phụ đề tự động từ giọng nói (Whisper chạy trên máy): trích audio → nhận dạng → căn thời gian → xem lại/sửa → tạo caption */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;

  const LANGS = [['auto', 'Tự nhận diện'], ['vietnamese', 'Tiếng Việt'], ['english', 'English'], ['chinese', '中文'], ['japanese', '日本語'], ['korean', '한국어'],
    ['french', 'Français'], ['german', 'Deutsch'], ['spanish', 'Español'], ['thai', 'ไทย'], ['indonesian', 'Bahasa Indonesia'], ['russian', 'Русский']];
  const MODELS = [
    ['Xenova/whisper-tiny', 'Tiny – ~40 MB · nhanh nhất, độ chính xác thấp (chỉ để thử)'],
    ['Xenova/whisper-base', 'Base – ~80 MB · nhanh, độ chính xác trung bình'],
    ['Xenova/whisper-small', 'Small – ~250 MB · khuyên dùng cho tiếng Việt'],
  ];

  VE.stt = {};
  VE.stt.supported = () => typeof Worker !== 'undefined' && location.protocol !== 'file:';

  // ------------------------------------------------------------------ worker
  let worker = null, pending = null;
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('/js/vendor/stt-worker.mjs', { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (!pending) return;
      if (m.type === 'result') { const p = pending; pending = null; p.res(m); }
      else if (m.type === 'error') { const p = pending; pending = null; p.rej(new Error(m.message)); }
      else if (pending.onEvent) pending.onEvent(m);
    };
    worker.onerror = (e) => {
      const p = pending; pending = null;
      worker = null;
      if (p) p.rej(new Error('Không khởi động được bộ nhận dạng' + (e && e.message ? ': ' + e.message : '')));
    };
    return worker;
  }
  VE.stt._extract16k = (c) => extract16k(c);
  VE.stt.cancel = function () {
    if (worker) { worker.terminate(); worker = null; }
    if (pending) { const p = pending; pending = null; p.rej(new Error('cancel')); }
  };
  VE.stt.run = function (audio, o, onEvent) {
    return new Promise((res, rej) => {
      const w = ensureWorker();
      pending = { res, rej, onEvent };
      w.postMessage({
        type: 'transcribe', audio, language: o.language,
        cfg: { model: o.model, localModelPath: '/usermodels/', wasmPaths: '/js/vendor/ort/', threads: self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)) : 1 },
      }, [audio.buffer]);
    });
  };

  // ------------------------------------------------------------------ nguồn audio & trích mẫu 16 kHz
  function sources() {
    const out = new Map();
    VE.selected().forEach((c) => {
      let src = null;
      if (c.kind === 'audio') src = c;
      else if (c.kind === 'video') src = VE.linkedOf(c).find((x) => x.kind === 'audio') || c;
      if (!src) return;
      const m = VE.getMedia(src.mediaId);
      if (!m || m.sfx || (src.kind === 'video' && !m.hasAudio)) return;
      out.set(src.id, src);
    });
    return Array.from(out.values()).sort((a, b) => a.start - b.start);
  }

  var extract16k;
  extract16k = async function (clip) {
    const m = VE.getMedia(clip.mediaId);
    const ab = await m.file.arrayBuffer();
    const ac = VE.audio.ensure();
    const buf = await new Promise((res, rej) => ac.decodeAudioData(ab, res, rej));
    const srcDur = clip.dur * clip.speed;
    const off = new OfflineAudioContext(1, Math.max(1600, Math.ceil(srcDur * 16000)), 16000);
    const s = off.createBufferSource();
    s.buffer = buf;
    s.connect(off.destination);
    s.start(0, clip.in, srcDur);
    const out = (await off.startRendering()).getChannelData(0).slice();
    // chuẩn hoá âm lượng để nhận dạng tốt hơn với file nhỏ tiếng
    let mx = 0;
    for (let i = 0; i < out.length; i += 7) mx = Math.max(mx, Math.abs(out[i]));
    if (mx > 0 && mx < 0.4) { const k = Math.min(20, 0.5 / mx); for (let i = 0; i < out.length; i++) out[i] *= k; }
    return out;
  };

  const fmtMB = (b) => (b / 1048576).toFixed(0) + ' MB';

  // ------------------------------------------------------------------ hộp thoại
  VE.showSttDialog = function () {
    if (!VE.stt.supported()) {
      VE.modal({ title: 'Phụ đề tự động', width: 460, body: h('div', { class: 'hint big' }, 'Tính năng này chạy trong ứng dụng desktop (chạy bằng "npm start"). Khi mở trực tiếp file index.html bằng trình duyệt, bộ nhận dạng giọng nói không khả dụng.'), buttons: [{ label: 'Đóng', primary: true }] });
      return;
    }
    const src = sources();
    if (!src.length) return VE.toast('Chọn clip video hoặc audio có lời nói trên timeline trước');

    const lang = h('select', { class: 'sel wide' }, ...LANGS.map(([v, l]) => h('option', { value: v }, l)));
    lang.value = 'vietnamese';
    const model = h('select', { class: 'sel wide' }, ...MODELS.map(([v, l]) => h('option', { value: v }, l)));
    model.value = 'Xenova/whisper-small';
    const pre = h('select', { class: 'sel wide' }, ...VE.CAPTION_PRESETS.map((p) => h('option', { value: p.id }, p.name)));
    const maxW = h('input', { type: 'number', class: 'num', min: 2, max: 14, value: 5 });
    const maxD = h('input', { type: 'number', class: 'num', step: 0.2, min: 1, max: 8, value: 3.2 });
    const sfx = h('input', { type: 'checkbox', class: 'chk', checked: false });
    [maxW, maxD].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    const total = src.reduce((a, c) => a + c.dur, 0);
    const estimate = h('div', { class: 'hint' });
    const updEst = () => { estimate.textContent = 'Audio cần nhận dạng: ' + VE.fmtDur(total) + ' · thời gian xử lý ước tính ' + (model.value.includes('small') ? '1–3' : model.value.includes('base') ? '0.5–1' : '0.3–0.6') + '× thời lượng (tuỳ máy)'; };
    model.addEventListener('input', updEst); updEst();

    const view = h('div', { class: 'stt-view' });
    const modalApi = VE.modal({ title: 'Phụ đề tự động từ giọng nói', body: view, width: 620, buttons: [], closable: true });
    // đóng hộp thoại (nút X, nền mờ, Huỷ) luôn dừng tác vụ đang chạy
    let runId = 0;
    const origClose = modalApi.close;
    modalApi.close = () => { runId++; VE.stt.cancel(); origClose(); };
    const setView = (...kids) => { view.textContent = ''; view.append(...kids); };
    const foot = (...btns) => h('div', { class: 'modal-foot inview' }, ...btns);
    const btn = (label, fn, primary) => h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: fn }, label);

    // ---------- bước 1: cài đặt
    const stepSettings = () => {
      setView(
        h('div', { class: 'form' },
          h('div', { class: 'hint big' }, 'Nguồn: ' + src.map((c) => c.name).join(', ') + ' (' + src.length + ' clip)'),
          VE.fieldRow('Ngôn ngữ nói', lang),
          VE.fieldRow('Model nhận dạng', model),
          estimate,
          h('div', { class: 'hint' }, 'Lần đầu dùng mỗi model sẽ được tải từ Hugging Face (cần internet) rồi lưu lại, những lần sau chạy hoàn toàn offline. Model càng lớn càng chính xác nhưng càng chậm.'),
          h('div', { class: 'sepline' }),
          VE.fieldRow('Kiểu caption', pre),
          VE.fieldRow('Tối đa số từ mỗi dòng', maxW),
          VE.fieldRow('Tối đa thời lượng mỗi dòng (s)', maxD),
          VE.fieldRow('Chèn SFX cho mỗi caption', sfx)),
        foot(
          window.veNative ? btn('Mở thư mục model', () => window.veNative.openModelsDir && window.veNative.openModelsDir()) : null,
          h('span', { class: 'gap' }),
          btn('Huỷ', () => modalApi.close()),
          btn('Bắt đầu nhận dạng', start, true)));
    };

    // ---------- bước 2: chạy
    let results = null; // [{ clip, items(timeline) }]
    const start = async () => {
      const my = ++runId;
      const bar = h('div', { class: 'bar' });
      const label = h('div', { class: 'plabel' }, 'Đang chuẩn bị…');
      setView(h('div', { class: 'exporting' }, h('div', { class: 'progress' }, bar), label, h('div', { class: 'hint' }, 'Không đóng cửa sổ trong lúc xử lý. Có thể bấm Huỷ bất cứ lúc nào.')),
        foot(h('span', { class: 'gap' }), btn('Huỷ', () => { runId++; VE.stt.cancel(); stepSettings(); })));
      const all = [];
      try {
        for (let i = 0; i < src.length; i++) {
          const clip = src[i];
          const tag = src.length > 1 ? ' (' + (i + 1) + '/' + src.length + ')' : '';
          label.textContent = 'Đang trích audio' + tag + '…';
          bar.style.width = '3%';
          const audio = await extract16k(clip);
          if (my !== runId) return;
          const spans = VE.align.vadSpans(audio, 16000);
          const wins = VE.align.windows(spans, { total: audio.length / 16000 });
          if (!wins.length) continue;
          const opts = { maxWords: parseInt(maxW.value, 10) || 5, maxDur: parseFloat(maxD.value) || 3.2 };
          const items = [];
          for (let k = 0; k < wins.length; k++) {
            const w = wins[k];
            const slice = audio.slice(Math.floor(w.s * 16000), Math.ceil(w.e * 16000));
            if (my !== runId) return;
            const res = await VE.stt.run(slice, { model: model.value, language: lang.value }, (m) => {
              if (m.type === 'phase' && m.phase === 'loading') label.textContent = 'Đang nạp model…' + tag;
              else if (m.type === 'load-progress' && m.total > 0) { label.textContent = 'Đang tải model: ' + fmtMB(m.loaded) + ' / ' + fmtMB(m.total) + tag; bar.style.width = (5 + (m.loaded / m.total) * 35) + '%'; }
            });
            label.textContent = 'Đang nhận dạng… câu ' + (k + 1) + '/' + wins.length + tag;
            bar.style.width = (42 + ((k + 1) / wins.length) * 55) + '%';
            const rel = w.spans.map(([a, b]) => [a - w.s, b - w.s]);
            VE.align.align(res.chunks, rel, opts).forEach((it) => { it.start += w.s; items.push(it); });
          }
          // đổi sang thời gian timeline
          items.forEach((it) => { it.start = clip.start + it.start / clip.speed; it.dur = it.dur / clip.speed; });
          all.push(...items);
        }
      } catch (err) {
        if (err.message === 'cancel' || my !== runId) return;
        setView(h('div', { class: 'hint big err' }, 'Lỗi nhận dạng: ' + err.message),
          h('div', { class: 'hint' }, 'Nếu đây là lần đầu dùng model này, hãy kiểm tra kết nối internet (model được tải từ huggingface.co). Bạn cũng có thể đặt sẵn model vào thư mục model (nút "Mở thư mục model").'),
          foot(h('span', { class: 'gap' }), btn('Quay lại', stepSettings), btn('Đóng', () => modalApi.close())));
        return;
      }
      if (my !== runId) return;
      bar.style.width = '100%';
      results = all.sort((a, b) => a.start - b.start);
      if (!results.length) {
        setView(h('div', { class: 'hint big' }, 'Không nhận dạng được lời nói nào. Hãy kiểm tra clip có tiếng nói rõ, chọn đúng ngôn ngữ hoặc dùng model lớn hơn.'),
          foot(h('span', { class: 'gap' }), btn('Quay lại', stepSettings), btn('Đóng', () => modalApi.close())));
        return;
      }
      stepReview();
    };

    // ---------- bước 3: xem lại & sửa
    const stepReview = () => {
      const list = h('div', { class: 'stt-list' });
      const rowEls = [];
      const render = () => {
        list.textContent = '';
        rowEls.length = 0;
        results.forEach((it, i) => {
          const inp = h('input', { class: 'txtin', value: it.text });
          inp.addEventListener('input', () => (it.text = inp.value));
          inp.addEventListener('keydown', (e) => e.stopPropagation());
          const row = h('div', { class: 'stt-row' },
            h('button', { class: 'btn mini', title: 'Nhảy tới vị trí này', onclick: () => VE.seek(it.start) }, VE.tc(it.start).slice(3, 8) + '.' + String(Math.round((it.start % 1) * 10)).slice(0, 1)),
            inp,
            h('span', { class: 'unit' }, it.dur.toFixed(1) + 's'),
            h('button', { class: 'ib', title: 'Xoá dòng', html: VE.icon('close', 12), onclick: () => { results.splice(i, 1); render(); } }));
          list.append(row);
        });
        cnt.textContent = results.length + ' caption';
      };
      const cnt = h('span', { class: 'hint' });
      setView(
        h('div', { class: 'hint big' }, 'Xem lại và sửa lỗi nhận dạng trước khi tạo caption. Dùng *từ khoá* để tô khung highlight.'),
        list, cnt,
        foot(
          btn('Xuất .srt', () => VE.download(new Blob([VE.align.toSrt(results.map((r) => ({ start: r.start, dur: r.dur, text: r.text })))], { type: 'text/plain' }), S.settings.name + '.srt')),
          h('span', { class: 'gap' }),
          btn('← Nhận dạng lại', stepSettings),
          btn('Tạo caption trên timeline', async () => {
            const preset = VE.CAPTION_PRESETS.find((p) => p.id === pre.value);
            const items = results.filter((r) => r.text.trim()).map((r) => ({ start: r.start, dur: r.dur, text: r.text.trim() }));
            modalApi.close();
            const made = await VE.addCaptions(items, preset, { sfx: sfx.checked });
            VE.toast('Đã tạo ' + made.length + ' caption từ giọng nói');
            VE.timeline.fit();
          }, true)));
      render();
    };

    stepSettings();
  };
})();
