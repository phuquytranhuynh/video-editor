/* Thư viện sound effect tự tổng hợp (WebAudio) + gắn SFX tự động theo caption / transition */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const SR = 44100;

  // ---- bộ tạo âm nhỏ ----
  function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function noiseBuf(ctx, dur, seed) {
    const r = rng(seed || 7), b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur) + 1, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    return b;
  }
  // tone: dao động với bao hình tấn công nhanh + suy giảm mũ
  function tone(ctx, o) {
    const t0 = o.t0 || 0, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.sweep || o.dur));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol == null ? 1 : o.vol, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }
  // noise: nhiễu qua bộ lọc, tần số quét f0→f1, bao hình theo các điểm [t,gain]
  function noise(ctx, o) {
    const t0 = o.t0 || 0, src = ctx.createBufferSource();
    src.buffer = noiseBuf(ctx, o.dur + 0.1, o.seed);
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.sweep || o.dur));
    const g = ctx.createGain();
    const shape = o.shape || [[0, 0], [0.004, 1], [o.dur, 0]];
    g.gain.setValueAtTime((o.vol == null ? 1 : o.vol) * shape[0][1], t0 + shape[0][0]);
    shape.slice(1).forEach(([t, v]) => g.gain.linearRampToValueAtTime((o.vol == null ? 1 : o.vol) * v, t0 + t));
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t0); src.stop(t0 + o.dur + 0.05);
  }
  const bell = (ctx, f, t0, dur, vol) => {
    [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]].forEach(([m, v], i) => tone(ctx, { f0: f * m, t0, dur: dur / (1 + i * 0.7), vol: vol * v }));
  };

  // lead = thời điểm (giây) "sự kiện chính" của âm thanh tính từ đầu file → dùng để căn đúng lúc caption/transition xuất hiện
  VE.SFX = [
    { id: 'pop', name: 'Pop (bật)', dur: 0.25, lead: 0.01, cat: 'Caption', build: (c) => { tone(c, { f0: 700, f1: 160, sweep: 0.09, dur: 0.2 }); noise(c, { type: 'highpass', f0: 3500, dur: 0.03, vol: 0.5 }); } },
    { id: 'ting', name: 'Ting (chuông nhỏ)', dur: 1.0, lead: 0.01, cat: 'Caption', build: (c) => { tone(c, { f0: 2093, dur: 0.9, vol: 0.8 }); tone(c, { f0: 3136, dur: 0.5, vol: 0.4 }); tone(c, { f0: 4186, dur: 0.3, vol: 0.25 }); } },
    { id: 'ding', name: 'Ding (chuông)', dur: 1.6, lead: 0.01, cat: 'Caption', build: (c) => bell(c, 880, 0, 1.5, 0.8) },
    { id: 'notify', name: 'Thông báo (2 nốt)', dur: 0.8, lead: 0.01, cat: 'Caption', build: (c) => { tone(c, { f0: 1319, dur: 0.35, vol: 0.7 }); tone(c, { f0: 1760, t0: 0.13, dur: 0.6, vol: 0.7 }); } },
    { id: 'sparkle', name: 'Lấp lánh (sparkle)', dur: 1.1, lead: 0.01, cat: 'Caption', build: (c) => { [2637, 3136, 3951, 5274, 6272].forEach((f, i) => tone(c, { f0: f, t0: i * 0.07, dur: 0.5, vol: 0.45 })); } },
    { id: 'click', name: 'Click', dur: 0.08, lead: 0.005, cat: 'Caption', build: (c) => noise(c, { type: 'highpass', f0: 2500, dur: 0.05, vol: 0.9, shape: [[0, 0], [0.002, 1], [0.05, 0]] }) },
    { id: 'typing', name: 'Gõ phím', dur: 1.0, lead: 0.01, cat: 'Caption', build: (c) => { [0, 0.11, 0.2, 0.33, 0.41, 0.55, 0.64, 0.78].forEach((t, i) => { noise(c, { t0: t, type: 'bandpass', f0: 1400 + (i % 3) * 400, q: 2, dur: 0.05, vol: 0.8, seed: i + 3, shape: [[0, 0], [0.002, 1], [0.05, 0]] }); tone(c, { t0: t, f0: 220, f1: 110, dur: 0.05, vol: 0.4 }); }); } },
    { id: 'shutter', name: 'Chụp ảnh (shutter)', dur: 0.25, lead: 0.01, cat: 'Caption', build: (c) => { noise(c, { type: 'highpass', f0: 2000, dur: 0.04, vol: 0.9 }); noise(c, { t0: 0.07, type: 'bandpass', f0: 3000, dur: 0.06, vol: 0.7 }); } },
    { id: 'hit', name: 'Hit (nhấn mạnh)', dur: 0.4, lead: 0.01, cat: 'Nhấn mạnh', build: (c) => { tone(c, { f0: 170, f1: 48, dur: 0.32, vol: 1 }); noise(c, { type: 'lowpass', f0: 500, dur: 0.12, vol: 0.6 }); } },
    { id: 'impact', name: 'Impact (đập mạnh)', dur: 1.3, lead: 0.01, cat: 'Nhấn mạnh', build: (c) => { tone(c, { f0: 120, f1: 36, sweep: 0.5, dur: 1.15, vol: 1 }); noise(c, { type: 'lowpass', f0: 700, dur: 0.35, vol: 0.7 }); } },
    { id: 'glitch', name: 'Glitch (nhiễu giật)', dur: 0.45, lead: 0.02, cat: 'Chuyển cảnh', build: (c) => { const r = rng(11); for (let k = 0; k < 9; k++) tone(c, { t0: k * 0.045, f0: 120 + r() * 1800, type: r() > 0.5 ? 'square' : 'sawtooth', dur: 0.04, vol: 0.3, attack: 0.001 }); noise(c, { type: 'highpass', f0: 4000, dur: 0.4, vol: 0.25, shape: [[0, 0], [0.05, 1], [0.4, 0]] }); } },
    { id: 'whoosh', name: 'Whoosh (vút)', dur: 0.8, lead: 0.4, cat: 'Chuyển cảnh', build: (c) => noise(c, { f0: 300, f1: 6000, q: 1.1, dur: 0.8, shape: [[0, 0], [0.4, 1], [0.8, 0]] }) },
    { id: 'swoosh', name: 'Swoosh (quét nhanh)', dur: 0.4, lead: 0.08, cat: 'Chuyển cảnh', build: (c) => noise(c, { f0: 5000, f1: 600, q: 1.2, dur: 0.4, shape: [[0, 0], [0.08, 0.9], [0.4, 0]] }) },
    { id: 'whip', name: 'Whip (vụt nhanh)', dur: 0.36, lead: 0.2, cat: 'Chuyển cảnh', build: (c) => noise(c, { f0: 800, f1: 9000, q: 1.4, dur: 0.36, shape: [[0, 0], [0.2, 1], [0.36, 0]] }) },
    { id: 'zoomfx', name: 'Zoom whoosh', dur: 0.55, lead: 0.42, cat: 'Chuyển cảnh', build: (c) => { noise(c, { f0: 400, f1: 8000, q: 1, dur: 0.5, shape: [[0, 0], [0.42, 1], [0.5, 0]] }); tone(c, { f0: 80, f1: 220, dur: 0.45, vol: 0.4 }); } },
    { id: 'flash', name: 'Flash (loé sáng)', dur: 0.7, lead: 0.02, cat: 'Chuyển cảnh', build: (c) => { noise(c, { type: 'highpass', f0: 5000, dur: 0.5, vol: 0.5, shape: [[0, 0], [0.01, 1], [0.5, 0]] }); tone(c, { f0: 1800, dur: 0.45, vol: 0.35 }); } },
    { id: 'riser', name: 'Riser (dâng cao)', dur: 1.6, lead: 1.5, cat: 'Chuyển cảnh', build: (c) => noise(c, { f0: 200, f1: 7000, q: 1.5, dur: 1.6, shape: [[0, 0], [1.5, 1], [1.6, 0]] }) },
  ];
  VE.sfxDef = (id) => VE.SFX.find((s) => s.id === id);
  // SFX gợi ý cho từng transition
  VE.TRANSITION_SFX = { slideLeft: 'swoosh', slideRight: 'swoosh', slideUp: 'swoosh', slideDown: 'swoosh', pushLeft: 'whoosh', pushRight: 'whoosh', pushUp: 'whoosh', pushDown: 'whoosh',
    whipLeft: 'whip', whipRight: 'whip', wipeRight: 'swoosh', wipeLeft: 'swoosh', wipeDown: 'swoosh', wipeUp: 'swoosh', wipeDiag: 'swoosh', irisOpen: 'zoomfx', clock: 'whoosh',
    zoomIn: 'zoomfx', zoomOut: 'zoomfx', spin: 'whoosh', flipH: 'swoosh', blur: 'whoosh', glitch: 'glitch', pixelate: 'glitch', shake: 'hit', flash: 'flash' };

  // ---- render + cache ----
  const bufCache = new Map();
  VE.sfxBuffer = function (id) {
    if (bufCache.has(id)) return bufCache.get(id);
    const def = VE.sfxDef(id);
    const p = (async () => {
      const ctx = new OfflineAudioContext(1, Math.ceil(SR * def.dur), SR);
      def.build(ctx);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let mx = 0; for (let i = 0; i < d.length; i++) mx = Math.max(mx, Math.abs(d[i]));
      if (mx > 0) { const k = 0.9 / mx; for (let i = 0; i < d.length; i++) d[i] *= k; }
      return buf;
    })();
    bufCache.set(id, p);
    return p;
  };

  function wavBlob(buf) {
    const d = buf.getChannelData(0), n = d.length, out = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    return new Blob([out.buffer], { type: 'audio/wav' });
  }

  VE.previewSfx = async function (id) {
    const buf = await VE.sfxBuffer(id);
    const ctx = VE.audio.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(VE.audio.master);
    s.start();
  };

  // Tạo (hoặc lấy) media trong project cho SFX
  const mediaPromises = new Map();
  VE.sfxMedia = function (id) {
    const ex = S.media.find((m) => m.sfx === id);
    if (ex) return Promise.resolve(ex);
    if (mediaPromises.has(id)) return mediaPromises.get(id);
    const p = (async () => {
      const def = VE.sfxDef(id);
      const buf = await VE.sfxBuffer(id);
      const file = new File([wavBlob(buf)], 'sfx-' + id + '.wav', { type: 'audio/wav' });
      const PPS = 60, d = buf.getChannelData(0), n = Math.ceil(buf.duration * PPS), peaks = new Float32Array(n), per = d.length / n;
      for (let i = 0; i < n; i++) { let mx = 0; for (let j = Math.floor(i * per); j < Math.min(d.length, Math.floor((i + 1) * per)); j++) mx = Math.max(mx, Math.abs(d[j])); peaks[i] = mx; }
      const m = { id: VE.uid(), name: 'SFX: ' + def.name, kind: 'audio', file, url: URL.createObjectURL(file), duration: buf.duration, width: 0, height: 0, hasAudio: true,
        peaks, peakPps: PPS, thumb: null, thumbs: [], img: null, size: file.size, markIn: null, markOut: null, sfx: id };
      S.mediaStore.set(m.id, m);
      S.media.push(m);
      VE.emit('media');
      mediaPromises.delete(id);
      return m;
    })();
    mediaPromises.set(id, p);
    return p;
  };

  // Track audio trống để đặt SFX (ưu tiên track không phải A1, nơi thường để lời thoại)
  VE.freeAudioTrack = function (start, dur, ignore) {
    const ats = VE.tracksOf('audio');
    const order = ats.slice(1).concat(ats.slice(0, 1));
    for (const t of order) {
      if (t.locked) continue;
      if (!S.clips.some((c) => c.trackId === t.id && c !== ignore && c.start < start + dur - 1e-3 && c.start + c.dur > start + 1e-3)) return t;
    }
    return VE.addTrack('audio', { silent: true });
  };

  VE.sfxOf = (clip) => S.clips.find((x) => x.follow && x.follow.id === clip.id);

  // Gắn SFX vào clip: SFX luôn đi theo vị trí bắt đầu của clip (follow)
  VE.attachSfx = async function (target, sfxId, opts = {}) {
    const def = VE.sfxDef(sfxId);
    if (!def) return null;
    const m = await VE.sfxMedia(sfxId);
    if (!opts.noRecord) VE.history.record();
    const offset = opts.offset != null ? opts.offset : -def.lead;
    const vol = opts.vol != null ? opts.vol : 100;
    const start = Math.max(0, target.start + offset);
    let f = VE.sfxOf(target);
    if (f) {
      f.mediaId = m.id; f.name = m.name; f.dur = m.duration; f.in = 0; f.volume = vol; f.follow.offset = offset; f.start = start;
    } else {
      const tr = VE.freeAudioTrack(start, m.duration);
      f = VE.newClip('audio', { trackId: tr.id, mediaId: m.id, name: m.name, start, dur: m.duration, volume: vol, follow: { id: target.id, offset } });
      S.clips.push(f);
    }
    if (!opts.silent) VE.emit('change');
    return f;
  };
  VE.removeSfx = function (target) {
    const f = VE.sfxOf(target);
    if (!f) return;
    VE.history.record();
    S.clips = S.clips.filter((c) => c !== f);
    VE.emit('change');
  };

  // Đồng bộ vị trí SFX theo clip mà nó bám theo; xoá liên kết nếu clip gốc đã mất
  VE.syncFollowers = function () {
    S.clips.forEach((c) => {
      if (!c.follow) return;
      const t = VE.clip(c.follow.id);
      if (!t) { c.follow = null; return; }
      c.start = Math.max(0, t.start + c.follow.offset);
    });
  };
})();
