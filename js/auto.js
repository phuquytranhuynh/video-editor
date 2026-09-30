/* Công cụ tự động: cắt khoảng lặng, jump-cut zoom, hạ nhạc nền khi có lời nói (ducking) */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;
  const { clamp } = VE;

  // ================================================================== phân tích giọng nói từ waveform
  // Trả về các đoạn CÓ TIẾNG (thời gian timeline) của 1 clip audio. Dựa vào peaks đã tính lúc nhập media.
  //  th: ngưỡng biên độ (0..1) · gap: khoảng nghỉ ngắn hơn mức này thì nối 2 đoạn · pad: nới rộng mỗi đầu
  VE.activityIntervals = function (c, { th, gap, pad }) {
    const m = VE.getMedia(c.mediaId);
    if (!m || !m.peaks) return null;
    const pps = m.peakPps || 60, pk = m.peaks;
    const i0 = Math.max(0, Math.floor(c.in * pps)), i1 = Math.min(pk.length, Math.ceil((c.in + c.dur * c.speed) * pps));
    const gapF = Math.max(1, Math.round(gap * pps * c.speed));
    const segs = [];
    let cur = null, last = -1e9;
    for (let i = i0; i < i1; i++) {
      if (pk[i] > th) {
        if (cur && i - last > gapF) { segs.push(cur); cur = null; }
        if (!cur) cur = [i, i];
        cur[1] = i; last = i;
      }
    }
    if (cur) segs.push(cur);
    const c0 = c.start, c1 = c.start + c.dur;
    const toT = (src) => c0 + (src - c.in) / c.speed;
    const out = [];
    segs.forEach(([a, b]) => {
      let s = toT(a / pps) - pad, e = toT((b + 1) / pps) + pad;
      s = Math.max(c0, s); e = Math.min(c1, e);
      if (e > s) { if (out.length && s <= out[out.length - 1][1] + 1e-3) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e); else out.push([s, e]); }
    });
    return out;
  };

  // Ngưỡng tự động: nằm giữa mức nền (nhiễu) và mức tiếng nói trong clip
  VE.autoThreshold = function (c) {
    const m = VE.getMedia(c.mediaId);
    if (!m || !m.peaks) return 0.02;
    const pps = m.peakPps || 60;
    const a = Math.floor(c.in * pps), b = Math.min(m.peaks.length, Math.ceil((c.in + c.dur * c.speed) * pps));
    const v = Array.from(m.peaks.subarray(a, b)).sort((x, y) => x - y);
    if (v.length < 10) return 0.02;
    const noise = Math.max(1e-4, v[Math.floor(v.length * 0.12)]), speech = Math.max(noise * 2, v[Math.floor(v.length * 0.92)]);
    return clamp(noise * Math.pow(speech / noise, 0.32), 0.004, 0.25);
  };
  const toDb = (x) => 20 * Math.log10(Math.max(1e-5, x));
  const fromDb = (d) => Math.pow(10, d / 20);

  // clip audio (có waveform, không phải SFX) của phần đang chọn: audio được chọn + audio liên kết với video được chọn
  function sourceAudio() {
    const out = new Set();
    VE.selected().forEach((c) => {
      if (c.kind === 'audio') out.add(c);
      else if (c.kind === 'video') VE.linkedOf(c).filter((x) => x.kind === 'audio').forEach((a) => out.add(a));
    });
    return Array.from(out).filter((a) => { const m = VE.getMedia(a.mediaId); return m && m.peaks && !m.sfx; });
  }
  function groupTracks() {
    const ids = new Set();
    VE.selected().forEach((c) => { ids.add(c.trackId); VE.linkedOf(c).forEach((l) => ids.add(l.trackId)); });
    return Array.from(ids);
  }

  // ================================================================== 1) TỰ CẮT KHOẢNG LẶNG
  VE.silenceRanges = function (audio, p) {
    const all = [];
    audio.forEach((c) => {
      const act = VE.activityIntervals(c, { th: p.th, gap: p.minSil, pad: p.pad }) || [];
      const c0 = c.start, c1 = c.start + c.dur;
      let pos = c0;
      const push = (a, b) => { if (b - a >= 0.08) all.push([a, b]); };
      act.forEach(([s, e]) => { if (s > pos && (pos > c0 || p.edges)) push(pos, s); else if (s > pos && pos === c0 && !p.edges) { /* giữ đầu clip */ } pos = Math.max(pos, e); });
      if (pos < c1 && p.edges) push(pos, c1);
      if (!act.length && !p.edges) { /* toàn im lặng: không cắt */ }
    });
    all.sort((a, b) => a[0] - b[0]);
    const merged = [];
    all.forEach((r) => { if (merged.length && r[0] <= merged[merged.length - 1][1] + 1e-3) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]); else merged.push(r.slice()); });
    return merged;
  };

  VE.showSilenceDialog = function () {
    const audio = sourceAudio();
    if (!audio.length) return VE.toast('Chọn clip video/audio có lời nói trên timeline (cần có waveform)');
    const ref = audio[0];
    const th0 = VE.autoThreshold(ref);
    const cv = h('canvas', { width: 520, height: 80, class: 'wavepv' });
    const stat = h('div', { class: 'hint big' });
    const thIn = h('input', { type: 'range', class: 'rng', min: -60, max: -10, step: 1, value: Math.round(toDb(th0)) });
    const thLb = h('span', { class: 'unit' });
    const minSil = h('input', { type: 'number', class: 'num', step: 0.05, min: 0.1, max: 5, value: 0.35 });
    const pad = h('input', { type: 'number', class: 'num', step: 0.02, min: 0, max: 1, value: 0.08 });
    const edges = h('input', { type: 'checkbox', class: 'chk', checked: true });
    const allTr = h('input', { type: 'checkbox', class: 'chk' });
    const zoomOn = h('input', { type: 'checkbox', class: 'chk', checked: false });
    const zoomAmt = h('input', { type: 'number', class: 'num', step: 1, min: 3, max: 80, value: 15 });
    const params = () => ({ th: fromDb(parseFloat(thIn.value)), minSil: parseFloat(minSil.value) || 0.35, pad: parseFloat(pad.value) || 0, edges: edges.checked });
    const upd = () => {
      const p = params();
      thLb.textContent = thIn.value + ' dB';
      const rs = VE.silenceRanges(audio, p);
      const saved = rs.reduce((a, r) => a + (r[1] - r[0]), 0);
      stat.textContent = rs.length + ' khoảng lặng · sẽ bỏ ' + saved.toFixed(1) + 's (' + VE.fmtDur(VE.timelineEnd()) + ' → ' + VE.fmtDur(VE.timelineEnd() - saved) + ')';
      // vẽ waveform + vùng bị cắt
      const x = cv.getContext('2d'), W = cv.width, H = cv.height;
      x.clearRect(0, 0, W, H); x.fillStyle = '#141414'; x.fillRect(0, 0, W, H);
      const t0 = ref.start, t1 = ref.start + ref.dur, m = VE.getMedia(ref.mediaId), pps = m.peakPps || 60;
      x.fillStyle = '#58c98c';
      for (let px = 0; px < W; px++) {
        const a = ref.in + (px / W) * ref.dur * ref.speed, b = ref.in + ((px + 1) / W) * ref.dur * ref.speed;
        let mx = 0;
        for (let i = Math.floor(a * pps); i < Math.max(Math.floor(a * pps) + 1, Math.ceil(b * pps)) && i < m.peaks.length; i++) mx = Math.max(mx, m.peaks[i]);
        const hh = Math.max(1, Math.min(H / 2, mx * H * 0.95));
        x.fillRect(px, H / 2 - hh / 2, 1, hh);
      }
      x.strokeStyle = '#ffd23f'; x.beginPath();
      const yth = H / 2 - Math.min(H / 2, p.th * H * 0.95) / 2; x.moveTo(0, yth); x.lineTo(W, yth); x.moveTo(0, H - yth); x.lineTo(W, H - yth); x.stroke();
      x.fillStyle = 'rgba(229,67,45,.45)';
      rs.forEach(([a, b]) => { if (b < t0 || a > t1) return; x.fillRect(((Math.max(a, t0) - t0) / (t1 - t0)) * W, 0, Math.max(1, ((Math.min(b, t1) - Math.max(a, t0)) / (t1 - t0)) * W), H); });
    };
    [thIn, minSil, pad, edges].forEach((i) => i.addEventListener('input', upd));
    const autoBtn = h('button', { class: 'btn mini', onclick: () => { thIn.value = Math.round(toDb(VE.autoThreshold(ref))); upd(); } }, 'Tự dò ngưỡng');
    [minSil, pad, zoomAmt].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    const body = h('div', { class: 'form' },
      cv, stat,
      VE.fieldRow('Ngưỡng im lặng', h('div', { class: 'inline grow' }, thIn, thLb, autoBtn)),
      VE.fieldRow('Lặng ít nhất (giây)', minSil),
      VE.fieldRow('Giữ đệm mỗi đầu (giây)', pad),
      VE.fieldRow('Cắt cả đầu/cuối clip', edges),
      VE.fieldRow('Áp dụng cho MỌI track', allTr),
      VE.fieldRow('Sau đó: zoom xen kẽ (jump-cut)', h('div', { class: 'inline' }, zoomOn, h('span', {}, 'mức'), zoomAmt, h('span', {}, '%'))),
      h('div', { class: 'hint' }, 'Vùng đỏ trên waveform là phần sẽ bị cắt, vạch vàng là ngưỡng. Mặc định chỉ cắt các track của clip đang chọn (video + audio đi kèm); bật "MỌI track" nếu muốn giữ đồng bộ caption/b-roll (nhạc nền cũng sẽ bị cắt).'));
    upd();
    VE.modal({
      title: 'Tự cắt khoảng lặng', body, width: 580,
      buttons: [
        { label: 'Huỷ' },
        { label: 'Cắt khoảng lặng', primary: true, action: () => {
          const rs = VE.silenceRanges(audio, params());
          if (!rs.length) { VE.toast('Không tìm thấy khoảng lặng nào – thử nâng ngưỡng hoặc giảm độ dài tối thiểu'); return false; }
          const tracks = allTr.checked ? S.tracks.map((t) => t.id) : groupTracks();
          const vtrack = VE.selected().filter((c) => c.kind === 'video').map((c) => c.trackId)[0];
          const span = [Math.min(...audio.map((a) => a.start)), Math.max(...audio.map((a) => a.start + a.dur))];
          const saved = rs.reduce((a, r) => a + (r[1] - r[0]), 0);
          const n = VE.removeRanges(rs, tracks);
          if (zoomOn.checked && vtrack) {
            const newEnd = span[1] - saved;
            const vclips = VE.clipsOnTrack(vtrack).filter((c) => c.kind === 'video' && c.start >= span[0] - 0.01 && c.start < newEnd - 0.01);
            VE.jumpZoomApply(vclips, { amt: parseFloat(zoomAmt.value) || 15, mode: 'alt2', punch: 0.25, fy: -8 });
          }
          VE.toast('Đã cắt ' + n + ' khoảng lặng (bỏ ' + saved.toFixed(1) + 's)');
          VE.timeline.fit();
        } },
      ],
    });
  };

  // ================================================================== 2) JUMP-CUT ZOOM
  // Áp zoom xen kẽ cho các clip video liên tiếp: vd 100% → 115% → 100% → 115%...
  VE.jumpZoomApply = function (clips, o) {
    const levels = o.mode === 'alt3' ? [0, o.amt, o.amt * 1.75] : [0, o.amt];
    const dur = o.punch > 0 ? o.punch : 0.02;
    clips.forEach((c, i) => {
      const L = levels[i % levels.length];
      if (L === 0) { c.zoom.type = 'none'; return; }
      c.zoom = Object.assign({}, c.zoom, { type: 'in', amount: Math.round(L * 10) / 10, dur, at: 'start', ease: o.punch > 0 ? 'easeOut' : 'linear', fx: o.fx || 0, fy: o.fy == null ? -8 : o.fy });
    });
    VE.emit('change');
  };

  // Tìm các điểm chia clip dài: khoảng mỗi `seg` giây, ưu tiên rơi vào chỗ ngắt nghỉ của lời nói
  function splitPoints(clip, seg, preferPause, audio) {
    const pts = [];
    const rs = preferPause && audio ? VE.silenceRanges([audio], { th: VE.autoThreshold(audio), minSil: 0.18, pad: 0, edges: false }) : [];
    let t = clip.start + seg;
    let k = 0;
    while (t < clip.start + clip.dur - seg * 0.5) {
      let best = t;
      const near = rs.filter((r) => (r[0] + r[1]) / 2 > t - seg * 0.35 && (r[0] + r[1]) / 2 < t + seg * 0.35).sort((a, b) => Math.abs((a[0] + a[1]) / 2 - t) - Math.abs((b[0] + b[1]) / 2 - t))[0];
      if (near) best = (near[0] + near[1]) / 2;
      else best = t + (VE.noise(k * 3.3) - 0.5) * seg * 0.3;
      pts.push(best);
      t = best + seg * (0.85 + 0.3 * VE.noise(k * 7.1 + 2));
      k++;
    }
    return pts;
  }

  VE.showJumpZoomDialog = function () {
    const vids = VE.selected().filter((c) => c.kind === 'video');
    if (!vids.length) return VE.toast('Chọn clip video (người nói) trên timeline');
    const vt = vids[0].trackId;
    const span = [Math.min(...vids.map((c) => c.start)), Math.max(...vids.map((c) => c.start + c.dur))];
    const audio = sourceAudio()[0];
    const segIn = h('input', { type: 'number', class: 'num', step: 0.5, min: 1, max: 30, value: 4 });
    const split = h('input', { type: 'checkbox', class: 'chk', checked: vids.length === 1 && vids[0].dur > 8 });
    const pause = h('input', { type: 'checkbox', class: 'chk', checked: !!audio });
    const amt = h('input', { type: 'number', class: 'num', step: 1, min: 3, max: 120, value: 15 });
    const mode = h('select', { class: 'sel wide' }, h('option', { value: 'alt2' }, 'Xen kẽ 2 mức: thường ↔ zoom'), h('option', { value: 'alt3' }, 'Xen kẽ 3 mức: thường → zoom → zoom mạnh'));
    const punch = h('select', { class: 'sel wide' }, h('option', { value: '0' }, 'Nhảy tức thì (jump cut)'), h('option', { value: '0.25' }, 'Punch-in mượt 0.25s'), h('option', { value: '0.5' }, 'Zoom mượt 0.5s'));
    punch.value = '0.25';
    const fy = h('input', { type: 'number', class: 'num', step: 1, min: -50, max: 50, value: -8 });
    const info = h('div', { class: 'hint big' });
    [segIn, amt, fy].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    const upd = () => {
      const n = VE.clipsOnTrack(vt).filter((c) => c.kind === 'video' && c.start >= span[0] - 0.01 && c.start < span[1] - 0.01).length;
      const extra = split.checked ? Math.max(0, Math.round((span[1] - span[0]) / (parseFloat(segIn.value) || 4)) - vids.length) : 0;
      info.textContent = 'Vùng áp dụng: ' + VE.tc(span[0]).slice(0, 8) + ' → ' + VE.tc(span[1]).slice(0, 8) + ' · khoảng ' + (n + extra) + ' đoạn';
    };
    [segIn, split].forEach((i) => i.addEventListener('input', upd));
    upd();
    VE.modal({
      title: 'Jump-cut zoom (phóng to xen kẽ giữa các câu)', width: 540,
      body: h('div', { class: 'form' },
        info,
        VE.fieldRow('Tự chia clip dài thành đoạn', h('div', { class: 'inline' }, split, h('span', {}, 'mỗi'), segIn, h('span', {}, 'giây'))),
        VE.fieldRow('Ưu tiên cắt ở chỗ ngắt nghỉ', pause),
        VE.fieldRow('Kiểu zoom', mode),
        VE.fieldRow('Mức zoom (%)', amt),
        VE.fieldRow('Chuyển động', punch),
        VE.fieldRow('Hướng zoom lên/xuống', h('div', { class: 'inline' }, fy, h('span', { class: 'unit' }, '(âm = hướng về phía trên, nơi có khuôn mặt)'))),
        h('div', { class: 'hint' }, 'Dùng sau khi "Tự cắt khoảng lặng" hoặc trên clip đã có nhiều đoạn cắt. Các đoạn lẻ giữ khung gốc, các đoạn chẵn zoom vào khuôn mặt để tạo nhịp như video CapCut.')),
      buttons: [
        { label: 'Huỷ' },
        { label: 'Áp dụng', primary: true, action: () => {
          VE.history.record();
          if (split.checked) {
            const pts = [];
            vids.forEach((c) => pts.push(...splitPoints(c, parseFloat(segIn.value) || 4, pause.checked, audio && audio.start <= c.start + c.dur && audio.start + audio.dur >= c.start ? audio : null)));
            VE.splitTimes(pts, groupTracks(), false);
          }
          const clips = VE.clipsOnTrack(vt).filter((c) => c.kind === 'video' && c.start >= span[0] - 0.01 && c.start < span[1] - 0.01);
          VE.jumpZoomApply(clips, { amt: parseFloat(amt.value) || 15, mode: mode.value, punch: parseFloat(punch.value), fy: parseFloat(fy.value) || 0 });
          VE.toast('Đã áp zoom xen kẽ cho ' + clips.length + ' đoạn');
        } },
      ],
    });
  };

  // ================================================================== 3) DUCKING
  // clip.duck = { on, tracks:[audioTrackId...], amt(dB<0), th(biên độ), att, rel, gap }
  VE.defaultDuck = (c) => {
    const voice = VE.tracksOf('audio').filter((t) => t.id !== c.trackId && S.clips.some((x) => x.trackId === t.id && x.kind === 'audio' && !(VE.getMedia(x.mediaId) || {}).sfx));
    return { on: true, tracks: voice.length ? [voice[0].id] : [], amt: -16, th: 0.03, att: 0.2, rel: 0.5, gap: 0.4 };
  };

  const duckCache = new Map();
  function duckIntervals(c) {
    const d = c.duck;
    const hit = duckCache.get(c.id);
    if (hit && hit.ver === VE.ver) return hit.ints;
    const ints = [];
    (d.tracks || []).forEach((tid) => {
      const tr = VE.track(tid);
      if (!tr || tr.muted || tid === c.trackId) return;
      S.clips.forEach((x) => {
        if (x.trackId !== tid || x.kind !== 'audio' || x.muted || x.volume <= 0) return;
        const a = VE.activityIntervals(x, { th: d.th, gap: d.gap, pad: 0 });
        if (a) ints.push(...a);
      });
    });
    ints.sort((a, b) => a[0] - b[0]);
    const merged = [];
    ints.forEach((r) => { if (merged.length && r[0] <= merged[merged.length - 1][1] + d.gap * 0.5) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]); else merged.push(r.slice()); });
    duckCache.set(c.id, { ver: VE.ver, ints: merged });
    return merged;
  }
  // Hệ số âm lượng (1 = giữ nguyên, nhỏ hơn = đã hạ) tại thời điểm t
  VE.duckFactor = function (c, t) {
    const d = c.duck;
    if (!d || !d.on || !d.tracks || !d.tracks.length) return 1;
    const ints = duckIntervals(c);
    if (!ints.length) return 1;
    let lo = 0, hi = ints.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ints[mid][0] <= t + d.att) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    let cov = 0;
    for (let i = Math.max(0, idx - 3); i <= Math.min(ints.length - 1, idx + 1); i++) {
      const [s, e] = ints[i];
      const v = t < s ? clamp(1 - (s - t) / Math.max(0.01, d.att), 0, 1) : t <= e ? 1 : clamp(1 - (t - e) / Math.max(0.01, d.rel), 0, 1);
      if (v > cov) cov = v;
    }
    const g = Math.pow(10, d.amt / 20);
    return 1 - (1 - g) * (cov * cov * (3 - 2 * cov)); // smoothstep cho mượt
  };

  VE.showDuckDialog = function () {
    const music = VE.selected().filter((c) => c.kind === 'audio' && !(VE.getMedia(c.mediaId) || {}).sfx);
    if (!music.length) return VE.toast('Chọn clip nhạc nền (audio) trên timeline trước');
    const base = VE.defaultDuck(music[0]);
    const ats = VE.tracksOf('audio');
    const boxes = ats.map((t) => ({ t, el: h('input', { type: 'checkbox', class: 'chk', checked: base.tracks.includes(t.id) }) }));
    const amt = h('input', { type: 'range', class: 'rng', min: -40, max: -3, step: 1, value: base.amt });
    const amtLb = h('span', { class: 'unit' });
    const sens = h('input', { type: 'range', class: 'rng', min: -60, max: -15, step: 1, value: Math.round(toDb(base.th)) });
    const sensLb = h('span', { class: 'unit' });
    const att = h('input', { type: 'number', class: 'num', step: 0.05, min: 0.02, max: 2, value: base.att });
    const rel = h('input', { type: 'number', class: 'num', step: 0.05, min: 0.05, max: 3, value: base.rel });
    [att, rel].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    const upd = () => { amtLb.textContent = amt.value + ' dB'; sensLb.textContent = sens.value + ' dB'; };
    [amt, sens].forEach((i) => i.addEventListener('input', upd)); upd();
    VE.modal({
      title: 'Tự hạ nhạc nền khi có lời nói (Ducking)', width: 520,
      body: h('div', { class: 'form' },
        h('div', { class: 'hint' }, 'Áp dụng cho ' + music.length + ' clip nhạc nền đang chọn. Nhạc sẽ tự nhỏ lại khi track lời thoại có tiếng nói và to lên khi im lặng – cả lúc xem trước lẫn khi xuất.'),
        VE.fieldRow('Track lời thoại', h('div', { class: 'checks' }, ...boxes.map(({ t, el }) => h('label', { class: 'chk-row' }, el, ' ' + VE.trackName(t))))),
        VE.fieldRow('Hạ nhạc xuống', h('div', { class: 'inline grow' }, amt, amtLb)),
        VE.fieldRow('Độ nhạy lời nói', h('div', { class: 'inline grow' }, sens, sensLb)),
        VE.fieldRow('Hạ nhạc trong (giây)', att),
        VE.fieldRow('Nhạc to lại sau (giây)', rel)),
      buttons: [
        { label: 'Huỷ' },
        { label: 'Bật ducking', primary: true, action: () => {
          const tracks = boxes.filter((b) => b.el.checked).map((b) => b.t.id);
          if (!tracks.length) { VE.toast('Chọn ít nhất một track lời thoại'); return false; }
          VE.history.record();
          music.forEach((c) => { c.duck = { on: true, tracks: tracks.filter((id) => id !== c.trackId), amt: parseFloat(amt.value), th: fromDb(parseFloat(sens.value)), att: parseFloat(att.value) || 0.2, rel: parseFloat(rel.value) || 0.5, gap: 0.4 }; });
          VE.emit('change');
          VE.toast('Đã bật ducking cho ' + music.length + ' clip');
        } },
      ],
    });
  };

  VE.toDb = toDb;
  VE.fromDb = fromDb;

  VE.removeDuck = function (clips) {
    VE.history.record();
    clips.forEach((c) => (c.duck = null));
    VE.emit('change');
  };
})();
