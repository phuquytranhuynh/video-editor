/* Xuất video: ghép toàn bộ timeline ra canvas + audio, ghi bằng MediaRecorder với thông số tuỳ chỉnh */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;

  const FORMATS = [
    { id: 'mp4a', label: 'MP4 (H.264 + AAC)', mime: 'video/mp4;codecs=avc1.640033,mp4a.40.2', ext: 'mp4' },
    { id: 'mp4b', label: 'MP4 (H.264 + AAC)', mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
    { id: 'mp4c', label: 'MP4', mime: 'video/mp4', ext: 'mp4' },
    { id: 'webm9', label: 'WebM (VP9 + Opus)', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { id: 'webm8', label: 'WebM (VP8 + Opus)', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { id: 'webm1', label: 'WebM (AV1 + Opus)', mime: 'video/webm;codecs=av1,opus', ext: 'webm' },
  ];
  function supportedFormats() {
    const seen = new Set();
    const list = FORMATS.filter((f) => {
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(f.mime)) return false;
      const k = f.label;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Bản desktop: ghi WebM chất lượng cao rồi chuyển sang MP4 (H.264 + AAC) bằng ffmpeg
    const webm = list.find((f) => f.ext === 'webm');
    if (window.veNative && VE.nativeCaps && VE.nativeCaps.ffmpeg && webm && !list.some((f) => f.ext === 'mp4')) {
      list.unshift({ id: 'mp4ff', label: 'MP4 (H.264 + AAC) – chuyển bằng ffmpeg', mime: webm.mime, ext: 'mp4', native: 'mp4' });
    }
    return list;
  }

  VE.showExportDialog = function () {
    const fmts = supportedFormats();
    if (!fmts.length) return VE.toast('Trình duyệt không hỗ trợ MediaRecorder');
    if (!VE.timelineEnd()) return VE.toast('Timeline đang trống – hãy thêm clip trước khi xuất');
    VE.pause();
    const cur = S.settings;
    const start = VE.PRESETS.find((p) => p.id === cur.preset) || VE.PRESETS.find((p) => p.w === cur.width && p.h === cur.height && p.fps === cur.fps);
    const base = start && start.id !== 'custom' ? start : { id: 'custom', w: cur.width, h: cur.height, fps: cur.fps, vbr: cur.width * cur.height > 2100000 ? 30 : 10, abr: 192 };

    const name = h('input', { class: 'txtin', value: cur.name.replace(/[\\/:*?"<>|]/g, '_') });
    const fmt = h('select', { class: 'sel wide' }, ...fmts.map((f) => h('option', { value: f.id }, f.label)));
    const inW = h('input', { type: 'number', class: 'num', min: 16, max: 8192, value: base.w });
    const inH = h('input', { type: 'number', class: 'num', min: 16, max: 8192, value: base.h });
    const fpsIn = h('select', { class: 'sel' }, ...VE.FPS_LIST.map((f) => h('option', { value: f }, f + ' fps')));
    fpsIn.value = String(base.fps);
    const vbr = h('input', { type: 'number', class: 'num', min: 0.5, max: 200, step: 0.5, value: base.vbr });
    const abr = h('select', { class: 'sel' }, ...[96, 128, 160, 192, 256, 320].map((v) => h('option', { value: v }, v + ' kbps')));
    abr.value = String(base.abr);
    const fitSel = h('select', { class: 'sel wide' },
      h('option', { value: 'fit' }, 'Vừa khung (có viền đen nếu khác tỉ lệ)'),
      h('option', { value: 'fill' }, 'Lấp đầy (cắt phần thừa)'),
      h('option', { value: 'stretch' }, 'Kéo giãn'));
    const range = h('select', { class: 'sel wide' }, h('option', { value: 'all' }, 'Toàn bộ timeline'), S.range ? h('option', { value: 'range' }, 'Work area (' + VE.tc(S.range.in) + ' → ' + VE.tc(S.range.out) + ')') : null);
    const est = h('div', { class: 'hint' });
    const presetSel = VE.presetSelect(base.id, (p) => {
      if (p.id === 'custom') return;
      inW.value = p.w; inH.value = p.h; fpsIn.value = String(p.fps); vbr.value = p.vbr; abr.value = String(p.abr); upd();
    });
    const duration = () => (range.value === 'range' && S.range ? S.range.out - S.range.in : VE.timelineEnd());
    const upd = () => {
      const mb = ((parseFloat(vbr.value) || 0) + parseInt(abr.value, 10) / 1000) * duration() / 8;
      est.textContent = 'Thời lượng ' + VE.fmtDur(duration()) + ' · dung lượng ước tính ≈ ' + (mb >= 1 ? mb.toFixed(1) + ' MB' : (mb * 1024).toFixed(0) + ' KB');
    };
    [inW, inH, fpsIn].forEach((i) => i.addEventListener('input', () => { presetSel.value = 'custom'; }));
    [vbr, abr, range].forEach((i) => i.addEventListener('input', upd));
    upd();

    const body = h('div', { class: 'form' },
      VE.fieldRow('Tên file', name),
      VE.fieldRow('Cài đặt sẵn', presetSel),
      VE.fieldRow('Định dạng', fmt),
      VE.fieldRow('Rộng × Cao (px)', h('div', { class: 'inline' }, inW, h('span', {}, '×'), inH)),
      VE.fieldRow('Tốc độ khung', fpsIn),
      VE.fieldRow('Bitrate video (Mbps)', vbr),
      VE.fieldRow('Bitrate audio', abr),
      VE.fieldRow('Khi khác tỉ lệ sequence', fitSel),
      VE.fieldRow('Phạm vi', range),
      est,
      h('div', { class: 'hint' }, 'Video được dựng và mã hoá theo thời gian thực (mất khoảng bằng thời lượng video). Không thu nhỏ/đổi cửa sổ trong lúc xuất.'));

    VE.modal({
      title: 'Xuất video', body, width: 540,
      buttons: [
        { label: 'Huỷ' },
        { label: 'Xuất', primary: true, action: () => {
          const f = fmts.find((x) => x.id === fmt.value);
          const w = Math.max(16, (parseInt(inW.value, 10) || 1920) & ~1), hh = Math.max(16, (parseInt(inH.value, 10) || 1080) & ~1);
          runExport({
            file: (name.value.trim() || 'video') + '.' + f.ext, fmt: f, w, h: hh, fps: parseInt(fpsIn.value, 10) || 30,
            vbps: Math.round((parseFloat(vbr.value) || 8) * 1e6), abps: parseInt(abr.value, 10) * 1000, fit: fitSel.value,
            start: range.value === 'range' && S.range ? S.range.in : 0, end: range.value === 'range' && S.range ? S.range.out : VE.timelineEnd(),
          });
        } },
      ],
    });
  };

  async function runExport(o) {
    const actx = VE.audio.ensure();
    await actx.resume();
    const canvas = h('canvas');
    canvas.width = o.w; canvas.height = o.h;
    const dest = actx.createMediaStreamDestination();
    const player = new VE.Player(canvas, { audioOut: dest, fit: o.fit });
    player.startTime = o.start;
    player.endTime = o.end;
    player.time = o.start;

    const stream = new MediaStream([...canvas.captureStream(o.fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: o.fmt.mime, videoBitsPerSecond: o.vbps, audioBitsPerSecond: o.abps });
    } catch (e) {
      VE.toast('Không tạo được bộ mã hoá: ' + e.message, 5000);
      player.dispose();
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    // hộp thoại tiến trình
    const bar = h('div', { class: 'bar' });
    const label = h('div', { class: 'plabel' }, 'Đang chuẩn bị…');
    canvas.className = 'exp-preview';
    let cancelled = false, finished = false;
    const modal = VE.modal({
      title: 'Đang xuất: ' + o.file, width: 460, closable: false,
      body: h('div', { class: 'exporting' }, canvas, h('div', { class: 'progress' }, bar), label,
        h('div', { class: 'hint' }, o.w + '×' + o.h + ' · ' + o.fps + 'fps · ' + (o.vbps / 1e6).toFixed(1) + ' Mbps')),
      buttons: [{ label: 'Huỷ xuất', action: () => { cancelled = true; cleanup(); } }],
    });

    const t0 = performance.now();
    const cleanup = () => {
      try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ }
      player.dispose();
      stream.getTracks().forEach((t) => t.stop());
    };

    rec.onstop = () => {
      if (cancelled || finished) return;
      finished = true;
      const blob = new Blob(chunks, { type: o.fmt.mime.split(';')[0] });
      player.dispose();
      if (window.veNative) {
        label.textContent = o.fmt.native === 'mp4' ? 'Đang chuyển sang MP4 bằng ffmpeg… (chọn nơi lưu)' : 'Chọn nơi lưu file…';
        bar.style.width = '100%';
        blob.arrayBuffer().then((buf) => window.veNative.finalize(buf, {
          name: o.file, mode: o.fmt.native === 'mp4' ? 'mp4' : (VE.nativeCaps && VE.nativeCaps.ffmpeg && o.fmt.ext === 'webm' ? 'remux' : 'raw'),
          vbps: o.vbps, abps: o.abps, fps: o.fps,
        })).then((r) => {
          modal.close();
          if (r.canceled) VE.toast('Đã huỷ lưu file');
          else if (r.ok) VE.toast('Xuất xong: ' + r.path + (r.note ? ' – ' + r.note : ''), 8000);
          else VE.toast('Lỗi: ' + r.error, 9000);
        }).catch((er) => { modal.close(); VE.toast('Lỗi lưu file: ' + er.message, 8000); });
        return;
      }
      modal.close();
      VE.download(blob, o.file);
      VE.toast('Xuất xong: ' + o.file + ' (' + VE.fmtSize(blob.size) + ')', 6000);
    };

    player.onTime = (t) => {
      const p = Math.min(1, (t - o.start) / Math.max(0.001, o.end - o.start));
      bar.style.width = p * 100 + '%';
      const el = (performance.now() - t0) / 1000;
      label.textContent = Math.round(p * 100) + '% · ' + VE.tc(t) + ' / ' + VE.tc(o.end) + ' · đã chạy ' + el.toFixed(0) + 's';
    };
    player.onEnd = () => {
      label.textContent = 'Đang hoàn tất file…';
      bar.style.width = '100%';
      setTimeout(() => { if (!cancelled && rec.state !== 'inactive') rec.stop(); }, 500);
    };

    try {
      player.manage(o.start);
      await player.preroll();
      if (cancelled) return;
      rec.start(1000);
      player.play();
    } catch (e) {
      console.error(e);
      VE.toast('Lỗi khi xuất: ' + e.message, 6000);
      cancelled = true;
      cleanup();
      modal.close();
    }
  }
})();
