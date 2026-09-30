/* Properties panel: Motion, Zoom, Fade, Speed, Audio, Text, Shape, Transition */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;
  const { clamp } = VE;

  VE.fonts = ['Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Roboto', 'Georgia', 'Times New Roman',
    'Palatino Linotype', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'Brush Script MT', 'system-ui', 'serif', 'sans-serif', 'monospace'];

  let body, binds = [], sigLast = '', G = null;

  VE.initInspector = function (panel) {
    panel.append(h('div', { class: 'ptitle' }, h('span', { class: 'ptitle-t' }, 'Properties')));
    body = h('div', { class: 'insp-body' });
    panel.append(body);
    panel.addEventListener('mousedown', () => (S.activePanel = 'props'));
    VE.on('select', rebuild);
    VE.on('change', () => { if (sig() !== sigLast) rebuild(); else refresh(); });
    VE.on('props', refresh);
    VE.on('settings', () => { if (!S.sel.size && !S.selTrans) rebuild(); });
    VE.on('playhead', (t, playing) => { if (!playing) return; });
    VE.on('focusText', () => setTimeout(() => { const ta = VE.$('.insp-body textarea.txt'); if (ta) { ta.focus(); ta.select(); } }, 30));
    rebuild();
  };

  function sig() {
    const sel = VE.selected();
    return [Array.from(S.sel).join(','), sel.map((c) => c.kind + (c.link ? 'L' : '') + (c.transIn ? 'T' : '')).join(','), S.selTrans, S.selTrans && VE.clip(S.selTrans) && VE.clip(S.selTrans).transIn ? 1 : 0,
      S.settings.width + 'x' + S.settings.height].join('|');
  }

  function refresh() {
    binds.forEach((b) => b());
  }

  // ------------------------------------------------------------------ control builders
  function sec(title, ...kids) {
    const d = h('details', { class: 'sec', open: true }, h('summary', {}, title), h('div', { class: 'sec-b' }, ...kids));
    return d;
  }
  const rowEl = (label, ...ctrls) => h('div', { class: 'r' }, h('span', { class: 'rl' }, label), h('div', { class: 'rc' }, ...ctrls));

  function num({ label, get, set, min, max, step = 1, slider = false, unit = '', group, struct = false, dec = 0, key, sMin, sMax }) {
    const input = h('input', { type: 'number', class: 'num', step });
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    const range = slider ? h('input', { type: 'range', class: 'rng', min: sMin != null ? sMin : min, max: sMax != null ? sMax : max, step }) : null;
    const apply = (v) => {
      if (isNaN(v)) return;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      VE.history.record((key || label) + ':' + Array.from(S.sel).join());
      group().forEach((c) => set(c, v));
      struct ? VE.emit('change') : VE.emit('props');
    };
    input.addEventListener('input', () => apply(parseFloat(input.value)));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    if (range) range.addEventListener('input', () => apply(parseFloat(range.value)));
    // kéo nhãn để tăng/giảm giá trị
    const lab = h('span', { class: 'rl scrub', title: 'Kéo ngang để thay đổi giá trị' }, label);
    lab.addEventListener('mousedown', (e) => {
      const x0 = e.clientX, v0 = parseFloat(input.value) || 0;
      const mv = (ev) => apply(Math.round((v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 0.1 : 1) * (Math.abs(max - min) > 500 ? 4 : 1)) / step) * step);
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
      e.preventDefault();
    });
    const upd = () => {
      const g = group();
      if (!g.length) return;
      const v = get(g[g.length - 1]);
      const s = Number(v).toFixed(dec);
      if (document.activeElement !== input) input.value = s;
      if (range) range.value = v;
    };
    binds.push(upd);
    upd();
    return h('div', { class: 'r' }, lab, h('div', { class: 'rc' }, input, unit ? h('span', { class: 'unit' }, unit) : null, range));
  }

  function color({ label, get, set, group, key }) {
    const input = h('input', { type: 'color', class: 'clr' });
    input.addEventListener('input', () => {
      VE.history.record((key || label) + ':' + Array.from(S.sel).join());
      group().forEach((c) => set(c, input.value));
      VE.emit('props');
    });
    const upd = () => { const g = group(); if (g.length) input.value = get(g[g.length - 1]); };
    binds.push(upd); upd();
    return rowEl(label, input);
  }

  function select({ label, options, get, set, group, struct }) {
    const el = h('select', { class: 'sel wide' }, ...options.map(([v, l]) => h('option', { value: v }, l)));
    el.addEventListener('change', () => {
      VE.history.record();
      group().forEach((c) => set(c, el.value));
      struct ? VE.emit('change') : VE.emit('props');
    });
    const upd = () => { const g = group(); if (g.length) el.value = get(g[g.length - 1]); };
    binds.push(upd); upd();
    return rowEl(label, el);
  }

  function toggle({ label, get, set, group, struct }) {
    const el = h('input', { type: 'checkbox', class: 'chk' });
    el.addEventListener('change', () => {
      VE.history.record();
      group().forEach((c) => set(c, el.checked));
      struct ? VE.emit('change') : VE.emit('props');
    });
    const upd = () => { const g = group(); if (g.length) el.checked = !!get(g[g.length - 1]); };
    binds.push(upd); upd();
    return rowEl(label, el);
  }

  const btnRow = (...btns) => h('div', { class: 'btn-row wrap' }, ...btns);
  const mini = (label, fn, title) => h('button', { class: 'btn mini', title, onclick: fn }, label);

  // ------------------------------------------------------------------ build
  function rebuild() {
    if (!body) return;
    binds = [];
    sigLast = sig();
    body.textContent = '';
    const sel = VE.selected();

    // transition được chọn
    if (S.selTrans) {
      const b = VE.clip(S.selTrans);
      if (b && b.transIn) { buildTransition(b); return; }
    }
    if (!sel.length) { buildSequence(); return; }

    const vis = sel.filter(VE.isVisual);
    const aud = sel.filter((c) => c.kind === 'audio');
    G = { vis, aud, all: sel };
    const gv = () => vis, ga = () => aud, gall = () => sel;
    const pv = vis[vis.length - 1], pa = aud[aud.length - 1];
    const prim = sel[sel.length - 1];

    // thông tin chung
    const nameIn = h('input', { class: 'txtin', value: prim.name });
    nameIn.addEventListener('input', () => { VE.history.record('name'); prim.name = nameIn.value; VE.emit('change'); });
    nameIn.addEventListener('keydown', (e) => e.stopPropagation());
    body.append(h('div', { class: 'insp-head' },
      h('div', { class: 'kindtag k-' + prim.kind }, sel.length > 1 ? sel.length + ' clip đã chọn' : ({ video: 'Video', audio: 'Audio', image: 'Ảnh', text: 'Text', shape: 'Shape' })[prim.kind]),
      nameIn));

    if (pv && pv.kind === 'text') buildText(pv);
    if (pv && pv.kind === 'shape') buildShape(pv);

    body.append(sec('Thời gian',
      num({ label: 'Bắt đầu (s)', get: (c) => c.start, set: (c, v) => { c.start = v; VE.overwriteRange(c.trackId, c.start, c.start + c.dur, [c.id]); }, min: 0, step: 0.04, dec: 2, group: gall, struct: true }),
      num({ label: 'Thời lượng (s)', get: (c) => c.dur, set: (c, v) => setDuration(c, v), min: 0.04, step: 0.04, dec: 2, group: () => [prim], struct: true }),
      (vis.some(VE.isMediaClip) || aud.length) ? num({ label: 'Tốc độ (%)', get: (c) => c.speed * 100, set: (c, v) => VE.setSpeed(c, v / 100), min: 10, max: 1600, step: 5, slider: true, sMin: 25, sMax: 400, group: () => sel.filter(VE.isMediaClip).slice(-1), struct: true, key: 'speed' }) : null,
      num({ label: 'Fade in (s)', get: (c) => c.fadeIn, set: (c, v) => VE.setFade(c, 'fadeIn', v), min: 0, max: prim.dur, step: 0.1, dec: 1, slider: true, group: gall, struct: true, key: 'fadein' }),
      num({ label: 'Fade out (s)', get: (c) => c.fadeOut, set: (c, v) => VE.setFade(c, 'fadeOut', v), min: 0, max: prim.dur, step: 0.1, dec: 1, slider: true, group: gall, struct: true, key: 'fadeout' })
    ));

    if (vis.length) {
      const motionBtns = [];
      if (vis.some((c) => c.kind === 'video' || c.kind === 'image')) {
        motionBtns.push(mini('Vừa khung', () => VE.applyFit('fit'), 'Thu/phóng để toàn bộ video nằm trong khung'), mini('Lấp đầy', () => VE.applyFit('fill'), 'Phóng để lấp đầy khung (cắt phần thừa)'), mini('100%', () => VE.applyFit('orig'), 'Kích thước gốc'));
      }
      motionBtns.push(mini('Đặt lại', () => { VE.history.record(); vis.forEach((c) => { c.x = 0; c.y = 0; c.rot = 0; c.opacity = 100; if (c.kind === 'video' || c.kind === 'image') { const m = VE.getMedia(c.mediaId); c.scale = VE.fitScale(m.width, m.height, S.settings.fitMode); c.fit = S.settings.fitMode === 'none' ? null : S.settings.fitMode; } else c.scale = 100; }); VE.emit('change'); }));
      body.append(sec('Chuyển động (Motion)',
        num({ label: 'Vị trí X', get: (c) => c.x, set: (c, v) => (c.x = v), min: -20000, max: 20000, step: 1, group: gv, key: 'x' }),
        num({ label: 'Vị trí Y', get: (c) => c.y, set: (c, v) => (c.y = v), min: -20000, max: 20000, step: 1, group: gv, key: 'y' }),
        alignRow(vis),
        num({ label: 'Hiển thị (%)', get: (c) => c.scale, set: (c, v) => { c.scale = v; c.fit = null; }, min: 1, max: 1000, step: 1, slider: true, sMin: 5, sMax: 400, dec: 1, group: gv, key: 'scale' }),
        num({ label: 'Xoay (°)', get: (c) => c.rot, set: (c, v) => (c.rot = v), min: -360, max: 360, step: 1, slider: true, group: gv, key: 'rot' }),
        num({ label: 'Độ mờ (%)', get: (c) => c.opacity, set: (c, v) => (c.opacity = v), min: 0, max: 100, step: 1, slider: true, group: gv, key: 'opacity' }),
        btnRow(...motionBtns)));

      body.append(sec('Zoom nhanh',
        select({ label: 'Kiểu', options: [['none', 'Không'], ['in', 'Zoom In'], ['out', 'Zoom Out']], get: (c) => c.zoom.type, set: (c, v) => (c.zoom.type = v), group: gv, struct: true }),
        num({ label: 'Mức zoom (%)', get: (c) => c.zoom.amount, set: (c, v) => (c.zoom.amount = v), min: 0, max: 300, step: 1, slider: true, sMax: 100, group: gv, key: 'zamt' }),
        select({ label: 'Làm mượt', options: [['smooth', 'Ease in-out (mượt)'], ['sine', 'Sine'], ['easeOut', 'Ease out'], ['easeIn', 'Ease in'], ['linear', 'Tuyến tính']], get: (c) => c.zoom.ease, set: (c, v) => (c.zoom.ease = v), group: gv }),
        select({ label: 'Vị trí', options: [['start', 'Từ đầu clip'], ['end', 'Ở cuối clip']], get: (c) => c.zoom.at || 'start', set: (c, v) => (c.zoom.at = v), group: gv }),
        num({ label: 'Thời gian zoom (s)', get: (c) => c.zoom.dur, set: (c, v) => (c.zoom.dur = v), min: 0, max: 60, step: 0.1, dec: 1, group: gv, key: 'zdur' }),
        h('div', { class: 'hint' }, '0 giây = zoom trải đều toàn bộ clip'),
        num({ label: 'Tâm zoom X', get: (c) => c.zoom.fx, set: (c, v) => (c.zoom.fx = v), min: -50, max: 50, step: 1, slider: true, group: gv, key: 'zfx' }),
        num({ label: 'Tâm zoom Y', get: (c) => c.zoom.fy, set: (c, v) => (c.zoom.fy = v), min: -50, max: 50, step: 1, slider: true, group: gv, key: 'zfy' })));
      body.append(animSection(vis, pv));
      if (vis.some((c) => c.kind === 'video' || c.kind === 'image')) body.append(cardSection(vis));
      body.append(sfxSection(pv, 'Sound effect đi kèm clip này'));
    }

    if (aud.length) {
      body.append(sec('Âm thanh',
        num({ label: 'Âm lượng (%)', get: (c) => c.volume, set: (c, v) => (c.volume = v), min: 0, max: 400, step: 1, slider: true, sMax: 200, group: ga, struct: true, key: 'vol' }),
        toggle({ label: 'Tắt tiếng clip', get: (c) => c.muted, set: (c, v) => (c.muted = v), group: ga, struct: true })));
    }
    if (vis.some((c) => c.kind === 'video')) {
      const v = vis.find((c) => c.kind === 'video');
      const m = VE.getMedia(v.mediaId);
      const partner = VE.linkedOf(v).find((x) => x.kind === 'audio');
      const items = [];
      if (partner) items.push(mini('Tách audio (Unlink)', () => VE.unlink(), 'Tách audio khỏi video để chỉnh riêng'));
      else if (v.link) items.push(mini('Tách (Unlink)', () => VE.unlink()));
      else if (m && m.hasAudio) items.push(mini('Trích xuất audio', () => VE.extractAudio(v), 'Tạo clip audio riêng từ video này'));
      if (items.length || v.link) body.append(sec('Audio của video', h('div', { class: 'hint' }, partner ? 'Audio đang liên kết với video: di chuyển/cắt cùng nhau.' : 'Audio đã tách khỏi video.'), btnRow(...items)));
    }

  }

  function setDuration(c, d) {
    const arr = [c].concat(S.linked ? VE.linkedOf(c) : []);
    arr.forEach((x) => {
      const lim = VE.mediaLimit(x);
      const maxD = lim.maxEnd - x.start;
      x.dur = clamp(d, VE.frame(), isFinite(maxD) ? maxD : 1e6);
      x.fadeIn = Math.min(x.fadeIn, x.dur);
      x.fadeOut = Math.min(x.fadeOut, x.dur);
      VE.overwriteRange(x.trackId, x.start, x.start + x.dur, [x.id]);
    });
    VE.cleanTransitions();
  }

  function alignRow(list) {
    const W = () => S.settings.width, H = () => S.settings.height;
    const al = (axis, pos) => () => {
      VE.history.record();
      list.forEach((c) => {
        const b = VE.clipBox(c), sc = c.scale / 100;
        const w = b.w * sc, hh = b.h * sc;
        if (axis === 'x') c.x = pos === 0 ? 0 : pos * (W() - w) / 2;
        else c.y = pos === 0 ? 0 : pos * (H() - hh) / 2;
      });
      VE.emit('props'); VE.emit('change');
    };
    return h('div', { class: 'r' }, h('span', { class: 'rl' }, 'Căn'),
      h('div', { class: 'rc' },
        mini('◧ Trái', al('x', -1)), mini('⬌ Giữa', al('x', 0)), mini('Phải ◨', al('x', 1)),
        mini('⬒ Trên', al('y', -1)), mini('⬍ Giữa', al('y', 0)), mini('Dưới ⬓', al('y', 1))));
  }

  const ensure = (c) => { if (!c.anim) c.anim = { in: { type: 'none', dur: 0.4 }, out: { type: 'none', dur: 0.3 }, loop: { type: 'none', amt: 1 } }; return c.anim; };

  // ---- animation xuất hiện / biến mất / lặp
  function animSection(vis, pv) {
    const gv = () => vis;
    const isText = pv.kind === 'text';
    const inOpts = VE.ANIM_IN.filter(([id]) => isText || !['typewriter', 'letterWave', 'letterPop', 'wordPop'].includes(id));
    const loopOpts = VE.ANIM_LOOP.filter(([id]) => isText || !['wave', 'echo'].includes(id));
    return sec('Hiệu ứng xuất hiện (Animation)',
      select({ label: 'Xuất hiện', options: inOpts, get: (c) => ensure(c).in.type, set: (c, v) => (ensure(c).in.type = v), group: gv }),
      num({ label: 'Thời gian (s)', get: (c) => ensure(c).in.dur, set: (c, v) => (ensure(c).in.dur = v), min: 0.05, max: 5, step: 0.05, dec: 2, slider: true, group: gv, key: 'ain' }),
      select({ label: 'Biến mất', options: VE.ANIM_OUT, get: (c) => ensure(c).out.type, set: (c, v) => (ensure(c).out.type = v), group: gv }),
      num({ label: 'Thời gian (s)', get: (c) => ensure(c).out.dur, set: (c, v) => (ensure(c).out.dur = v), min: 0.05, max: 5, step: 0.05, dec: 2, slider: true, group: gv, key: 'aout' }),
      select({ label: 'Hiệu ứng lặp', options: loopOpts, get: (c) => ensure(c).loop.type, set: (c, v) => (ensure(c).loop.type = v), group: gv }),
      num({ label: 'Cường độ lặp', get: (c) => ensure(c).loop.amt, set: (c, v) => (ensure(c).loop.amt = v), min: 0, max: 3, step: 0.1, dec: 1, slider: true, group: gv, key: 'aamt' }),
      btnRow(mini('▶ Xem thử', () => { VE.seek(pv.start); VE.play(); }, 'Phát từ đầu clip')));
  }

  // ---- thẻ b-roll (khung viền, nền blur)
  function cardSection(vis) {
    const gv = () => vis.filter((c) => c.kind === 'video' || c.kind === 'image');
    const cd = (c) => c.card || VE.defaultCard();
    const setCard = (c, key, v) => { if (!c.card) c.card = VE.defaultCard(); c.card[key] = v; };
    return sec('Thẻ / khung (B-roll card)',
      toggle({ label: 'Bật khung thẻ', get: (c) => !!c.card, set: (c, v) => (c.card = v ? VE.defaultCard() : null), group: gv }),
      color({ label: 'Màu viền', get: (c) => cd(c).border, set: (c, v) => setCard(c, 'border', v), group: gv }),
      num({ label: 'Độ dày viền', get: (c) => cd(c).bw, set: (c, v) => setCard(c, 'bw', v), min: 0, max: 40, step: 1, slider: true, group: gv, key: 'cbw' }),
      num({ label: 'Bo góc', get: (c) => cd(c).radius, set: (c, v) => setCard(c, 'radius', v), min: 0, max: 200, step: 1, slider: true, group: gv, key: 'crad' }),
      toggle({ label: 'Đổ bóng', get: (c) => cd(c).shadow, set: (c, v) => setCard(c, 'shadow', v), group: gv }),
      num({ label: 'Làm mờ cảnh nền (%)', get: (c) => cd(c).blurBg, set: (c, v) => setCard(c, 'blurBg', v), min: 0, max: 100, step: 5, slider: true, group: gv, key: 'cblur' }),
      btnRow(mini('Áp kiểu B-roll', () => VE.applyBrollCard(), 'Thu nhỏ vào khung, viền cam bo góc, nền blur, hiệu ứng pop')),
      h('div', { class: 'hint' }, 'Đặt clip b-roll ở track phía trên cảnh chính: cảnh chính phía dưới sẽ được làm mờ làm nền.'));
  }

  // ---- SFX bám theo clip (caption / transition / hình ảnh)
  function sfxSection(target, title) {
    const sel = h('select', { class: 'sel wide' }, h('option', { value: '' }, '— Không có SFX —'),
      ...VE.SFX.map((sf) => h('option', { value: sf.id }, sf.name)));
    const curId = () => { const f = VE.sfxOf(target); const m = f && VE.getMedia(f.mediaId); return m && m.sfx ? m.sfx : ''; };
    sel.addEventListener('change', async () => {
      if (!sel.value) { VE.removeSfx(target); return; }
      const f = VE.sfxOf(target);
      await VE.attachSfx(target, sel.value, { offset: f ? undefined : undefined, vol: f ? f.volume : 100 });
    });
    const offIn = h('input', { type: 'number', class: 'num', step: 0.05 });
    const volIn = h('input', { type: 'number', class: 'num', step: 5, min: 0, max: 400 });
    offIn.addEventListener('input', () => { const f = VE.sfxOf(target); if (f && !isNaN(parseFloat(offIn.value))) { VE.history.record('sfxoff'); f.follow.offset = parseFloat(offIn.value); VE.syncFollowers(); VE.emit('change'); } });
    volIn.addEventListener('input', () => { const f = VE.sfxOf(target); if (f && !isNaN(parseFloat(volIn.value))) { VE.history.record('sfxvol'); f.volume = parseFloat(volIn.value); VE.emit('change'); } });
    [offIn, volIn].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    binds.push(() => {
      const f = VE.sfxOf(target);
      sel.value = curId();
      if (document.activeElement !== offIn) offIn.value = f ? f.follow.offset.toFixed(2) : '';
      if (document.activeElement !== volIn) volIn.value = f ? f.volume : '';
    });
    return sec(title,
      rowEl('SFX', sel),
      rowEl('Lệch thời gian (s)', offIn, h('span', { class: 'unit' }, 'âm = sớm hơn')),
      rowEl('Âm lượng (%)', volIn),
      btnRow(mini('▶ Nghe thử', () => { const id = curId() || sel.value; if (id) VE.previewSfx(id); }), mini('Xoá SFX', () => VE.removeSfx(target))),
      h('div', { class: 'hint' }, 'SFX luôn đi theo vị trí bắt đầu của clip này (kéo clip thì SFX đi cùng).'));
  }

  // ---- text
  function buildText(pv) {
    const g = () => G.vis.filter((c) => c.kind === 'text');
    const ta = h('textarea', { class: 'txt', rows: 3, value: pv.text.content, spellcheck: false });
    ta.addEventListener('input', () => { VE.history.record('txt:' + pv.id); pv.text.content = ta.value; pv.name = 'Text'; VE.emit('change'); });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    binds.push(() => { if (document.activeElement !== ta) ta.value = pv.text.content; });

    const fontSel = h('select', { class: 'sel wide' });
    const fillFonts = () => {
      fontSel.textContent = '';
      VE.fonts.forEach((f) => fontSel.append(h('option', { value: f, style: { fontFamily: f } }, f)));
      if (!VE.fonts.includes(pv.text.font)) fontSel.append(h('option', { value: pv.text.font }, pv.text.font));
      fontSel.value = pv.text.font;
    };
    fillFonts();
    fontSel.addEventListener('change', () => { VE.history.record(); g().forEach((c) => (c.text.font = fontSel.value)); VE.emit('props'); });
    binds.push(() => { if (fontSel.value !== pv.text.font && [...fontSel.options].some((o) => o.value === pv.text.font)) fontSel.value = pv.text.font; });

    const fontFile = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: true });
    fontFile.addEventListener('change', async () => {
      for (const f of fontFile.files) {
        try {
          const name = f.name.replace(/\.[^.]+$/, '');
          const face = new FontFace(name, await f.arrayBuffer());
          await face.load();
          document.fonts.add(face);
          if (!VE.fonts.includes(name)) VE.fonts.unshift(name);
          g().forEach((c) => (c.text.font = name));
          VE.toast('Đã nạp font "' + name + '"');
          rebuild();
          VE.emit('props');
        } catch (e) { VE.toast('Không nạp được font: ' + f.name); }
      }
    });
    const sysFonts = async () => {
      if (!window.queryLocalFonts) return VE.toast('Trình duyệt không hỗ trợ đọc font hệ thống (dùng Chrome/Edge)');
      try {
        const list = await window.queryLocalFonts();
        const fams = Array.from(new Set(list.map((f) => f.family))).sort();
        fams.forEach((f) => { if (!VE.fonts.includes(f)) VE.fonts.push(f); });
        VE.toast('Đã nạp ' + fams.length + ' font hệ thống');
        rebuild();
      } catch (e) { VE.toast('Bạn chưa cấp quyền đọc font'); }
    };

    const presetSel = h('select', { class: 'sel wide' }, h('option', { value: '' }, '— Đổi kiểu caption —'), ...VE.CAPTION_PRESETS.map((p) => h('option', { value: p.id }, p.name)));
    presetSel.addEventListener('change', () => { const pr = VE.CAPTION_PRESETS.find((x) => x.id === presetSel.value); presetSel.value = ''; if (pr) VE.applyCaptionPreset(pr, G.vis.filter((c) => c.kind === 'text')); });
    const hlBtn = mini('✱ Tô highlight phần đang chọn', () => {
      let a = ta.selectionStart, b = ta.selectionEnd;
      const v = ta.value;
      if (a === b) { while (a > 0 && !/\s/.test(v[a - 1])) a--; while (b < v.length && !/\s/.test(v[b])) b++; }
      if (a === b) return VE.toast('Bôi đen từ khoá trong ô văn bản trước');
      ta.value = v.slice(0, a) + '*' + v.slice(a, b) + '*' + v.slice(b);
      ta.dispatchEvent(new Event('input'));
    }, 'Đặt dấu * quanh từ khoá để tô khung nổi bật');
    body.append(sec('Văn bản (Text)',
      rowEl('Kiểu', presetSel),
      ta,
      btnRow(hlBtn),
      rowEl('Font', fontSel),
      btnRow(mini('Nạp font từ file…', () => fontFile.click()), mini('Font hệ thống', sysFonts), fontFile),
      num({ label: 'Cỡ chữ', get: (c) => c.text.size, set: (c, v) => (c.text.size = v), min: 4, max: 800, step: 1, slider: true, sMax: 300, group: g, key: 'fsize' }),
      select({ label: 'Độ đậm', options: [['300', 'Mảnh'], ['400', 'Thường'], ['500', 'Vừa'], ['600', 'Bán đậm'], ['700', 'Đậm'], ['800', 'Rất đậm'], ['900', 'Đen']], get: (c) => String(c.text.weight), set: (c, v) => (c.text.weight = parseInt(v, 10)), group: g }),
      toggle({ label: 'In nghiêng', get: (c) => c.text.italic, set: (c, v) => (c.text.italic = v), group: g }),
      toggle({ label: 'VIẾT HOA', get: (c) => !!c.text.upper, set: (c, v) => (c.text.upper = v), group: g }),
      select({ label: 'Căn lề', options: [['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']], get: (c) => c.text.align, set: (c, v) => (c.text.align = v), group: g }),
      color({ label: 'Màu chữ', get: (c) => c.text.color, set: (c, v) => (c.text.color = v), group: g }),
      num({ label: 'Giãn dòng', get: (c) => c.text.lineH, set: (c, v) => (c.text.lineH = v), min: 0.6, max: 3, step: 0.05, dec: 2, group: g }),
      num({ label: 'Giãn chữ', get: (c) => c.text.letterSp, set: (c, v) => (c.text.letterSp = v), min: -20, max: 100, step: 1, group: g }),
      num({ label: 'Rộng tối đa (px)', get: (c) => c.text.wrapW, set: (c, v) => (c.text.wrapW = v), min: 0, max: 8000, step: 10, group: g, key: 'wrap' }),
      h('div', { class: 'hint' }, '0 = không tự xuống dòng')));
    body.append(sec('Highlight từ khoá (*từ*)',
      color({ label: 'Màu khung', get: (c) => c.text.hlBg || '#f59e0b', set: (c, v) => (c.text.hlBg = v), group: g }),
      color({ label: 'Màu chữ highlight', get: (c) => c.text.hlColor || '#ffffff', set: (c, v) => (c.text.hlColor = v), group: g }),
      num({ label: 'Độ mờ khung (%)', get: (c) => (c.text.hlOpacity == null ? 100 : c.text.hlOpacity), set: (c, v) => (c.text.hlOpacity = v), min: 0, max: 100, step: 1, slider: true, group: g }),
      num({ label: 'Đệm khung (px)', get: (c) => c.text.hlPad == null ? 10 : c.text.hlPad, set: (c, v) => (c.text.hlPad = v), min: 0, max: 100, step: 1, group: g }),
      num({ label: 'Bo góc khung (px)', get: (c) => c.text.hlRadius == null ? 10 : c.text.hlRadius, set: (c, v) => (c.text.hlRadius = v), min: 0, max: 100, step: 1, group: g }),
      toggle({ label: 'Khung quét vào', get: (c) => c.text.hlAnim !== false, set: (c, v) => (c.text.hlAnim = v), group: g }),
      h('div', { class: 'hint' }, 'Ví dụ: "MỖI VIDEO *3-4 TIẾNG*" → phần giữa 2 dấu * được tô khung.')));
    body.append(sec('Nền chữ (Background)',
      color({ label: 'Màu nền', get: (c) => c.text.bg, set: (c, v) => { c.text.bg = v; if (!c.text.bgOpacity) c.text.bgOpacity = 100; }, group: g }),
      num({ label: 'Độ mờ nền (%)', get: (c) => c.text.bgOpacity, set: (c, v) => (c.text.bgOpacity = v), min: 0, max: 100, step: 1, slider: true, group: g }),
      num({ label: 'Đệm (px)', get: (c) => c.text.bgPad, set: (c, v) => (c.text.bgPad = v), min: 0, max: 300, step: 1, group: g }),
      num({ label: 'Bo góc (px)', get: (c) => c.text.bgRadius, set: (c, v) => (c.text.bgRadius = v), min: 0, max: 300, step: 1, group: g })));
    body.append(sec('Viền & bóng',
      color({ label: 'Màu viền', get: (c) => c.text.stroke, set: (c, v) => { c.text.stroke = v; if (!c.text.strokeW) c.text.strokeW = 4; }, group: g }),
      num({ label: 'Độ dày viền', get: (c) => c.text.strokeW, set: (c, v) => (c.text.strokeW = v), min: 0, max: 100, step: 1, slider: true, sMax: 30, group: g }),
      toggle({ label: 'Đổ bóng', get: (c) => c.text.shadow, set: (c, v) => (c.text.shadow = v), group: g }),
      color({ label: 'Màu bóng', get: (c) => c.text.shadowColor, set: (c, v) => (c.text.shadowColor = v), group: g }),
      num({ label: 'Độ nhoè bóng', get: (c) => c.text.shadowBlur, set: (c, v) => (c.text.shadowBlur = v), min: 0, max: 100, step: 1, group: g })));
  }

  // ---- shape
  function buildShape(pv) {
    const g = () => G.vis.filter((c) => c.kind === 'shape');
    const isLine = () => pv.shape.type === 'line' || pv.shape.type === 'arrow';
    body.append(sec('Hình khối (Shape)',
      select({ label: 'Loại', options: [['rect', 'Chữ nhật'], ['round', 'Bo góc'], ['ellipse', 'Elip'], ['triangle', 'Tam giác'], ['star', 'Ngôi sao'], ['line', 'Đường thẳng'], ['arrow', 'Mũi tên']], get: (c) => c.shape.type, set: (c, v) => (c.shape.type = v), group: g, struct: true }),
      num({ label: 'Rộng (px)', get: (c) => c.shape.w, set: (c, v) => (c.shape.w = v), min: 1, max: 20000, step: 5, group: g, key: 'sw' }),
      num({ label: 'Cao / cỡ đầu mũi (px)', get: (c) => c.shape.h, set: (c, v) => (c.shape.h = v), min: 1, max: 20000, step: 5, group: g, key: 'sh' }),
      num({ label: 'Bo góc (px)', get: (c) => c.shape.radius, set: (c, v) => (c.shape.radius = v), min: 0, max: 1000, step: 1, group: g }),
      color({ label: 'Màu nền (fill)', get: (c) => c.shape.fill, set: (c, v) => { c.shape.fill = v; if (!c.shape.fillOpacity) c.shape.fillOpacity = 100; }, group: g }),
      num({ label: 'Độ mờ nền (%)', get: (c) => c.shape.fillOpacity, set: (c, v) => (c.shape.fillOpacity = v), min: 0, max: 100, step: 1, slider: true, group: g }),
      color({ label: 'Màu viền / line', get: (c) => c.shape.stroke, set: (c, v) => { c.shape.stroke = v; if (!c.shape.strokeW) c.shape.strokeW = 6; }, group: g }),
      num({ label: 'Độ dày viền / line', get: (c) => c.shape.strokeW, set: (c, v) => (c.shape.strokeW = v), min: 0, max: 200, step: 1, slider: true, sMax: 60, group: g }),
      h('div', { class: 'hint' }, 'Với "Đường thẳng" và "Mũi tên", màu line = màu viền (nếu độ dày = 0 sẽ dùng màu nền).')));
    void isLine;
  }

  // ---- transition
  function buildTransition(b) {
    const g = () => [b];
    body.append(h('div', { class: 'insp-head' }, h('div', { class: 'kindtag k-trans' }, 'Transition'), h('div', { class: 'tname' }, VE.transitionName(b.transIn.type))));
    body.append(sec('Chuyển cảnh giữa 2 clip',
      select({ label: 'Kiểu', options: VE.TRANSITIONS.map((t) => [t.id, t.name]), get: (c) => c.transIn.type, set: (c, v) => VE.setTransition(c, v), group: g, struct: true }),
      num({ label: 'Thời lượng (s)', get: (c) => c.transIn.dur, set: (c, v) => VE.setTransition(c, c.transIn.type, v), min: 0.1, max: 10, step: 0.1, dec: 2, slider: true, group: g, struct: true, key: 'tdur' }),
      h('div', { class: 'hint' }, 'Transition đặt tại điểm cắt: một nửa thời lượng nằm trước điểm cắt, một nửa nằm sau. Nếu clip không còn phần dư (handle), khung hình đầu/cuối sẽ được giữ tĩnh.'),
      btnRow(mini('Xoá transition', () => { VE.history.record(); VE.setTransition(b, null); VE.clearSelection(); VE.emit('change'); }))));
    body.append(sfxSection(b, 'Sound effect tại điểm chuyển cảnh'));
  }

  // ---- sequence (không chọn gì)
  function buildSequence() {
    const s = S.settings;
    body.append(h('div', { class: 'insp-head' }, h('div', { class: 'kindtag' }, 'Sequence'), h('div', { class: 'tname' }, s.name)));
    body.append(sec('Thông số vùng làm việc',
      h('div', { class: 'kv' }, h('span', {}, 'Kích thước'), h('b', {}, s.width + ' × ' + s.height)),
      h('div', { class: 'kv' }, h('span', {}, 'Tỉ lệ'), h('b', {}, ratio(s.width, s.height))),
      h('div', { class: 'kv' }, h('span', {}, 'Tốc độ khung'), h('b', {}, s.fps + ' fps')),
      h('div', { class: 'kv' }, h('span', {}, 'Thời lượng'), h('b', {}, VE.tc(VE.timelineEnd()))),
      btnRow(mini('Thiết lập Sequence…', () => VE.showSequenceDialog(false)), mini('Xuất video…', () => VE.showExportDialog()))));
    body.append(h('div', { class: 'hint pad' }, 'Chọn một clip trên timeline để chỉnh vị trí, % hiển thị, zoom, fade, âm lượng… hoặc chọn điểm giữa 2 clip để chỉnh transition.'));
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  function ratio(w, hh) { const d = gcd(w, hh); return w / d + ':' + hh / d; }
})();
