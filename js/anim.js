/* Animation xuất hiện / biến mất / lặp cho clip hình ảnh & text, preset caption kiểu CapCut */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const { clamp, lerp } = VE;

  // ------------------------------------------------------------------ easing bổ sung
  const c1 = 1.70158, c3 = c1 + 1;
  Object.assign(VE.ease, {
    outBack: (p) => 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2),
    inBack: (p) => c3 * p * p * p - c1 * p * p,
    expoOut: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    bounce: (p) => {
      const n1 = 7.5625, d1 = 2.75;
      if (p < 1 / d1) return n1 * p * p;
      if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
      if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
      return n1 * (p -= 2.625 / d1) * p + 0.984375;
    },
  });
  const E = VE.ease;
  // nhiễu giả ngẫu nhiên, ổn định theo n
  VE.noise = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

  // ------------------------------------------------------------------ danh sách hiển thị trong UI
  VE.ANIM_IN = [
    ['none', 'Không'], ['fade', 'Mờ dần (Fade)'], ['pop', 'Bật lên (Pop)'], ['slam', 'Đập xuống (Slam)'], ['zoom', 'Zoom vào'],
    ['slideUp', 'Trượt lên'], ['slideDown', 'Trượt xuống'], ['slideLeft', 'Trượt từ phải sang'], ['slideRight', 'Trượt từ trái sang'],
    ['spin', 'Xoay vào'], ['blur', 'Mờ → nét'], ['drop', 'Rơi xuống nảy'], ['glitch', 'Giật (Glitch)'],
    ['typewriter', 'Gõ chữ (chỉ text)'], ['letterWave', 'Từng ký tự nảy (chỉ text)'], ['letterPop', 'Từng ký tự bật (chỉ text)'], ['wordPop', 'Từng từ bật (chỉ text)'],
  ];
  VE.ANIM_OUT = [
    ['none', 'Không'], ['fade', 'Mờ dần (Fade)'], ['pop', 'Thu nhỏ (Pop)'], ['zoom', 'Zoom ra + mờ'], ['slideUp', 'Trượt lên'], ['slideDown', 'Trượt xuống'],
    ['slideLeft', 'Trượt sang trái'], ['slideRight', 'Trượt sang phải'], ['spin', 'Xoay đi'], ['blur', 'Nét → mờ'], ['drop', 'Rơi xuống'],
  ];
  VE.ANIM_LOOP = [
    ['none', 'Không'], ['pulse', 'Nhịp phồng (Pulse)'], ['float', 'Lơ lửng'], ['shake', 'Rung'], ['wobble', 'Lắc'], ['flicker', 'Nhấp nháy'],
    ['wave', 'Sóng chữ (chỉ text)'], ['echo', 'Lặp hình toả ra (Echo, chỉ text)'],
  ];
  const UNIT_MODES = new Set(['typewriter', 'letterWave', 'letterPop', 'wordPop']);

  // ------------------------------------------------------------------ trạng thái animation tại thời điểm t
  const IN = {
    fade: (p, r) => { r.alpha *= E.sine(p); },
    pop: (p, r) => { r.scale *= Math.max(0, E.outBack(p)); r.alpha *= clamp(p * 4, 0, 1); },
    slam: (p, r) => { r.scale *= lerp(3, 1, E.expoOut(p)); r.alpha *= clamp(p * 5, 0, 1); r.dx += (VE.noise(Math.floor(p * 40)) - 0.5) * 16 * (1 - p); r.dy += (VE.noise(Math.floor(p * 40) + 9) - 0.5) * 16 * (1 - p); },
    zoom: (p, r) => { r.scale *= lerp(1.8, 1, E.outBack(Math.min(1, p))); r.alpha *= clamp(p * 2.5, 0, 1); },
    slideUp: (p, r, x) => { r.dy += (1 - E.expoOut(p)) * x.H * 0.09; r.alpha *= clamp(p * 3, 0, 1); },
    slideDown: (p, r, x) => { r.dy -= (1 - E.expoOut(p)) * x.H * 0.09; r.alpha *= clamp(p * 3, 0, 1); },
    slideLeft: (p, r, x) => { r.dx += (1 - E.expoOut(p)) * x.W * 0.25; r.alpha *= clamp(p * 3, 0, 1); },
    slideRight: (p, r, x) => { r.dx -= (1 - E.expoOut(p)) * x.W * 0.25; r.alpha *= clamp(p * 3, 0, 1); },
    spin: (p, r) => { r.rot -= (1 - E.outBack(Math.min(1, p))) * 40; r.scale *= lerp(0.4, 1, E.outBack(Math.min(1, p))); r.alpha *= clamp(p * 3, 0, 1); },
    blur: (p, r) => { r.blur += (1 - p) * 26; r.alpha *= clamp(p * 2, 0, 1); },
    drop: (p, r, x) => { r.dy -= (1 - E.bounce(p)) * x.H * 0.22; r.alpha *= clamp(p * 4, 0, 1); },
    glitch: (p, r, x) => {
      const k = Math.floor(x.rel * 30);
      r.dx += (VE.noise(k) - 0.5) * 60 * (1 - p);
      r.alpha *= VE.noise(k + 3) > 0.25 * (1 - p) ? 1 : 0.15;
    },
  };
  const OUT = {
    fade: (q, r) => { r.alpha *= 1 - E.sine(q); },
    pop: (q, r) => { r.scale *= Math.max(0, 1 - E.easeIn(q)); r.alpha *= 1 - q * q; },
    zoom: (q, r) => { r.scale *= lerp(1, 1.6, q); r.alpha *= 1 - q; },
    slideUp: (q, r, x) => { r.dy -= E.easeIn(q) * x.H * 0.09; r.alpha *= 1 - q; },
    slideDown: (q, r, x) => { r.dy += E.easeIn(q) * x.H * 0.09; r.alpha *= 1 - q; },
    slideLeft: (q, r, x) => { r.dx -= E.easeIn(q) * x.W * 0.25; r.alpha *= 1 - q; },
    slideRight: (q, r, x) => { r.dx += E.easeIn(q) * x.W * 0.25; r.alpha *= 1 - q; },
    spin: (q, r) => { r.rot += E.easeIn(q) * 40; r.scale *= 1 - 0.6 * q; r.alpha *= 1 - q; },
    blur: (q, r) => { r.blur += q * 26; r.alpha *= 1 - q; },
    drop: (q, r, x) => { r.dy += q * q * x.H * 0.3; r.alpha *= 1 - q * q; },
  };

  VE.animState = function (c, t, W, H) {
    const r = { alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, blur: 0, unit: null, echo: false, wave: false, rel: t - c.start };
    const a = c.anim;
    if (!a) return r;
    const rel = t - c.start, rem = c.start + c.dur - t;
    const x = { W, H, rel };
    if (a.in && a.in.type !== 'none' && a.in.dur > 0) {
      const p = clamp(rel / a.in.dur, 0, 1);
      if (UNIT_MODES.has(a.in.type)) { if (p < 1) r.unit = { mode: a.in.type, p }; }
      else if (p < 1 && IN[a.in.type]) IN[a.in.type](p, r, x);
    }
    if (a.out && a.out.type !== 'none' && a.out.dur > 0 && rem < a.out.dur && OUT[a.out.type]) {
      OUT[a.out.type](clamp(1 - rem / a.out.dur, 0, 1), r, x);
    }
    const lp = a.loop;
    if (lp && lp.type !== 'none') {
      const amt = lp.amt == null ? 1 : lp.amt;
      switch (lp.type) {
        case 'pulse': r.scale *= 1 + 0.05 * amt * Math.sin(rel * Math.PI * 3.2); break;
        case 'float': r.dy += 14 * amt * Math.sin(rel * Math.PI * 1.6); break;
        case 'shake': { const k = Math.floor(rel * 24); r.dx += (VE.noise(k) - 0.5) * 10 * amt; r.dy += (VE.noise(k + 5) - 0.5) * 10 * amt; break; }
        case 'wobble': r.rot += 3 * amt * Math.sin(rel * Math.PI * 2.4); break;
        case 'flicker': r.alpha *= 0.78 + 0.22 * VE.noise(Math.floor(rel * 18)); break;
        case 'wave': r.wave = true; break;
        case 'echo': r.echo = true; break;
      }
    }
    return r;
  };

  // ------------------------------------------------------------------ preset caption (kích thước theo khung 1080)
  VE.CAPTION_PRESETS = [
    { id: 'sub', name: 'Phụ đề cam (subtitle)', y: 0.27, dur: 2.5, sfx: null,
      text: { content: 'Phụ đề hiển thị ở đây', size: 54, weight: 900, italic: true, color: '#f5a524', strokeW: 5, stroke: '#2a1600', upper: true, wrapW: 900, shadow: true, shadowColor: '#000000', shadowBlur: 6 },
      anim: { in: { type: 'fade', dur: 0.2 }, out: { type: 'fade', dur: 0.2 } } },
    { id: 'kw-white', name: 'Keyword trắng lớn (pop)', y: 0.24, dur: 1.6, sfx: 'pop',
      text: { content: 'KEYWORD', size: 100, weight: 900, color: '#ffffff', upper: true, shadow: true, shadowColor: '#000000', shadowBlur: 10, strokeW: 0 },
      anim: { in: { type: 'pop', dur: 0.25 }, out: { type: 'fade', dur: 0.15 } } },
    { id: 'kw-hl', name: 'Keyword + khung highlight cam', y: 0.24, dur: 2.2, sfx: 'ting',
      text: { content: 'MỖI VIDEO\n*3-4 TIẾNG*', size: 84, weight: 900, color: '#ffffff', hlColor: '#ffffff', hlBg: '#f59e0b', upper: true, shadow: true, shadowColor: '#000000', shadowBlur: 8 },
      anim: { in: { type: 'pop', dur: 0.25 }, out: { type: 'fade', dur: 0.15 } } },
    { id: 'pill', name: 'Hộp trắng bo tròn (pill)', y: 0.25, dur: 2.4, sfx: 'pop',
      text: { content: 'AI CHỈ LÀ NHÂN VIÊN CỦA BẠN', size: 44, weight: 900, color: '#111111', bg: '#ffffff', bgOpacity: 100, bgPad: 24, bgRadius: 60, upper: true, wrapW: 760 },
      anim: { in: { type: 'pop', dur: 0.22 }, out: { type: 'pop', dur: 0.18 } } },
    { id: 'wave', name: 'Chữ nảy từng ký tự (wave)', y: 0.2, dur: 2, sfx: 'swoosh',
      text: { content: 'CĂNG THẲNG', size: 92, weight: 900, color: '#ffffff', strokeW: 6, stroke: '#000000', upper: true },
      anim: { in: { type: 'letterWave', dur: 0.8 }, out: { type: 'fade', dur: 0.15 }, loop: { type: 'wave', amt: 1 } } },
    { id: 'echo', name: 'Lặp hình toả ra (HÀNG LOẠT)', y: 0.22, dur: 2, sfx: 'whoosh',
      text: { content: 'HÀNG LOẠT', size: 84, weight: 900, color: '#ffffff', upper: true, shadow: true, shadowColor: '#000000', shadowBlur: 6 },
      anim: { in: { type: 'pop', dur: 0.2 }, out: { type: 'fade', dur: 0.2 }, loop: { type: 'echo', amt: 1 } } },
    { id: 'type', name: 'Gõ chữ kiểu lệnh (typewriter)', y: 0.24, dur: 2.6, sfx: 'typing',
      text: { content: '> NHẮN 1 CÂU LỆNH', size: 58, weight: 800, color: '#ffffff', bg: '#000000', bgOpacity: 70, bgPad: 16, bgRadius: 6, upper: true },
      anim: { in: { type: 'typewriter', dur: 1.2 }, out: { type: 'fade', dur: 0.2 } } },
    { id: 'slam', name: 'Đập xuống vàng (Impact)', y: 0.2, dur: 1.8, sfx: 'impact',
      text: { content: 'QUAN TRỌNG', font: 'Impact', size: 140, weight: 400, color: '#ffd400', strokeW: 9, stroke: '#000000', upper: true },
      anim: { in: { type: 'slam', dur: 0.3 }, out: { type: 'fade', dur: 0.15 } } },
    { id: 'neon', name: 'Neon phát sáng', y: 0.2, dur: 2, sfx: 'ting',
      text: { content: 'NEON', size: 120, weight: 800, color: '#8cff7a', upper: true, shadow: true, shadowColor: '#39ff14', shadowBlur: 30 },
      anim: { in: { type: 'blur', dur: 0.4 }, out: { type: 'fade', dur: 0.2 }, loop: { type: 'flicker', amt: 1 } } },
  ];

  const unit = () => Math.min(S.settings.width, S.settings.height) / 1080;
  const PX_KEYS = ['size', 'strokeW', 'bgPad', 'bgRadius', 'wrapW', 'shadowBlur', 'hlPad', 'hlRadius'];

  // Tạo object text theo preset, co giãn theo kích thước khung
  VE.presetText = function (p, content) {
    const k = unit();
    const t = VE.defaultText(Object.assign({}, p.text, content != null ? { content } : {}));
    PX_KEYS.forEach((key) => { if (typeof t[key] === 'number') t[key] = Math.round(t[key] * k * 10) / 10; });
    return t;
  };
  VE.presetAnim = (p) => Object.assign({ in: { type: 'none', dur: 0.4 }, out: { type: 'none', dur: 0.3 }, loop: { type: 'none', amt: 1 } }, JSON.parse(JSON.stringify(p.anim || {})));

  // Thêm 1 caption từ preset tại playhead
  VE.addCaption = async function (preset, opts = {}) {
    const start = opts.start != null ? opts.start : S.playhead;
    const dur = opts.dur || preset.dur || 2.5;
    const c = VE.addGraphic('text', {
      text: VE.presetText(preset, opts.content), anim: VE.presetAnim(preset), y: Math.round(preset.y * S.settings.height), name: 'Caption', captionPreset: preset.id,
    }, start, dur);
    if (S.autoSfx && preset.sfx && opts.sfx !== false) await VE.attachSfx(c, preset.sfx, { silent: false, noRecord: true });
    VE.emit('focusText');
    return c;
  };

  // Áp kiểu preset lên các caption đang chọn (giữ nguyên nội dung)
  VE.applyCaptionPreset = function (preset, clips) {
    const list = (clips || VE.selected()).filter((c) => c.kind === 'text');
    if (!list.length) return VE.toast('Chọn một clip Text trước');
    VE.history.record();
    list.forEach((c) => {
      const keep = c.text.content;
      c.text = VE.presetText(preset, keep);
      c.anim = VE.presetAnim(preset);
      c.y = Math.round(preset.y * S.settings.height);
      c.captionPreset = preset.id;
    });
    VE.emit('change');
  };

  // Tạo nhiều caption cùng lúc: items [{start,dur,text}]
  VE.addCaptions = async function (items, preset, opts = {}) {
    if (!items.length) return [];
    VE.history.record();
    const s0 = Math.min(...items.map((i) => i.start)), e0 = Math.max(...items.map((i) => i.start + i.dur));
    const vts = VE.tracksOf('video');
    let tr = null;
    for (let i = 1; i < vts.length; i++) {
      if (!vts[i].locked && !S.clips.some((c) => c.trackId === vts[i].id && c.start < e0 && c.start + c.dur > s0)) { tr = vts[i]; break; }
    }
    if (!tr) tr = VE.addTrack('video', { silent: true });
    const y = Math.round(preset.y * S.settings.height);
    const made = items.map((it) => {
      const c = VE.newClip('text', { trackId: tr.id, start: it.start, dur: Math.max(0.1, it.dur), name: 'Caption', text: VE.presetText(preset, it.text), anim: VE.presetAnim(preset), y, captionPreset: preset.id });
      S.clips.push(c);
      return c;
    });
    if (opts.sfx && preset.sfx) for (const c of made) await VE.attachSfx(c, preset.sfx, { silent: true, noRecord: true });
    VE.emit('change');
    VE.select(made.map((c) => c.id), { noLink: true });
    return made;
  };

  VE.defaultCard = () => ({ border: '#f5a524', bw: 6, radius: 28, shadow: true, blurBg: 85 });
  // Biến clip video/ảnh thành "thẻ" b-roll: nền blur từ cảnh phía dưới + khung viền bo góc (như video mẫu)
  VE.applyBrollCard = function () {
    const list = VE.selected().filter((c) => c.kind === 'video' || c.kind === 'image');
    if (!list.length) return VE.toast('Chọn clip video/ảnh trên track phía trên cảnh chính (V2, V3…)');
    VE.history.record();
    list.forEach((c) => {
      const m = VE.getMedia(c.mediaId);
      c.card = VE.defaultCard();
      c.scale = VE.fitScale(m.width, m.height, 'fit') * 0.86;
      c.fit = null; c.x = 0; c.y = 0;
      c.anim = VE.presetAnim({ anim: { in: { type: 'pop', dur: 0.35 }, out: { type: 'fade', dur: 0.2 } } });
    });
    VE.emit('change');
  };

  // SRT hoặc mỗi dòng một caption
  VE.parseCaptionText = function (raw, startAt, lineDur, gap) {
    const toSec = (s) => { const m = s.trim().replace(',', '.').match(/(\d+):(\d+):(\d+(?:\.\d+)?)/); return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : NaN; };
    const items = [];
    if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(raw)) {
      raw.replace(/\r/g, '').split(/\n{2,}/).forEach((blk) => {
        const lines = blk.split('\n').filter((l) => l.trim() !== '');
        const ti = lines.findIndex((l) => l.includes('-->'));
        if (ti < 0) return;
        const [a, b] = lines[ti].split('-->');
        const s = toSec(a), e = toSec(b);
        const text = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
        if (!isNaN(s) && !isNaN(e) && text) items.push({ start: s + startAt, dur: Math.max(0.2, e - s), text });
      });
    } else {
      let t = startAt;
      raw.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
        items.push({ start: t, dur: lineDur, text: l });
        t += lineDur + gap;
      });
    }
    return items;
  };
})();
