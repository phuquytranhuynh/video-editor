/* Program monitor (preview + điều khiển transform trực tiếp), Source monitor, audio meter, transport */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;
  const { clamp } = VE;

  let canvas, wrap, view, ovl, selbox, guideV, guideH, tcCur, tcDur, zoomSel, qualSel, scrubEl, scrubHead, scrubRange, playBtn, titleEl;
  let zoomMode = 'fit'; // 'fit' | number (0.25...)
  let quality = 1;
  let disp = 1; // css px / sequence px

  // ------------------------------------------------------------------ transport (dùng chung)
  VE.seek = function (t) {
    t = Math.max(0, t);
    S.playhead = t;
    if (VE.player) VE.player.seek(t);
    VE.emit('playhead', t);
  };
  VE.isPlaying = () => !!(VE.player && VE.player.playing);
  VE.play = function () {
    if (!VE.player) return;
    if (VE.source && VE.source.playing()) VE.source.pause();
    VE.player.rate = 1;
    VE.player.play();
    updatePlayBtn();
  };
  VE.pause = function () { if (VE.player) VE.player.pause(); updatePlayBtn(); };
  VE.togglePlay = function () { VE.isPlaying() ? VE.pause() : VE.play(); };
  VE.step = (n) => VE.seek(clamp(S.playhead + n * VE.frame(), 0, 1e6));
  function updatePlayBtn() {
    if (playBtn) playBtn.innerHTML = VE.icon(VE.isPlaying() ? 'pause' : 'play', 18);
  }

  const mkBtn = (icon, title, fn, cls) => h('button', { class: 'ib ' + (cls || ''), title, html: VE.icon(icon, 18), onclick: fn });

  // ------------------------------------------------------------------ Program monitor
  VE.initProgram = function (panel) {
    titleEl = h('span', { class: 'ptitle-t' }, 'Program: Sequence 01');
    panel.append(h('div', { class: 'ptitle' }, titleEl));
    canvas = h('canvas', { class: 'pcanvas' });
    guideV = h('div', { class: 'guide v' });
    guideH = h('div', { class: 'guide h' });
    selbox = h('div', { class: 'selbox' },
      ...['nw', 'ne', 'sw', 'se'].map((p) => h('i', { class: 'hd ' + p, dataset: { h: p } })),
      h('i', { class: 'hd rot', dataset: { h: 'rot' }, title: 'Xoay (giữ Shift: bước 15°)' }));
    ovl = h('div', { class: 'ovl' }, guideV, guideH, selbox);
    wrap = h('div', { class: 'canvas-wrap' }, canvas, ovl);
    view = h('div', { class: 'mon-view' }, wrap);
    panel.append(view);

    tcCur = h('span', { class: 'tc cur' }, '00:00:00:00');
    tcDur = h('span', { class: 'tc dur' }, '00:00:00:00');
    zoomSel = h('select', { class: 'sel', title: 'Phóng to / thu nhỏ vùng xem' },
      ...[['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['2', '200%']].map(([v, l]) => h('option', { value: v }, l)));
    zoomSel.onchange = () => { zoomMode = zoomSel.value === 'fit' ? 'fit' : parseFloat(zoomSel.value); layoutMon(); };
    qualSel = h('select', { class: 'sel', title: 'Chất lượng xem trước (không ảnh hưởng file xuất)' },
      ...[['1', 'Full'], ['0.5', '1/2'], ['0.25', '1/4']].map(([v, l]) => h('option', { value: v }, l)));
    qualSel.onchange = () => { quality = parseFloat(qualSel.value); VE.player.setSize(...psize()); VE.player.refresh(); };
    panel.append(h('div', { class: 'mon-times' }, tcCur, h('span', { class: 'gap' }), zoomSel, qualSel, h('span', { class: 'gap' }), tcDur));

    scrubHead = h('div', { class: 'scrub-head' });
    scrubRange = h('div', { class: 'scrub-range' });
    scrubEl = h('div', { class: 'scrub' }, scrubRange, scrubHead);
    panel.append(scrubEl);
    playBtn = mkBtn('play', 'Phát / dừng (Space)', () => VE.togglePlay(), 'play');
    panel.append(h('div', { class: 'transport' },
      mkBtn('markIn', 'Đặt điểm In cho work area (I)', () => setSeqMark('in')),
      mkBtn('markOut', 'Đặt điểm Out cho work area (O)', () => setSeqMark('out')),
      h('span', { class: 'sp' }),
      mkBtn('toStart', 'Về đầu (Home)', () => VE.seek(0)),
      mkBtn('stepBack', 'Lùi 1 frame (←)', () => VE.step(-1)),
      playBtn,
      mkBtn('stepFwd', 'Tiến 1 frame (→)', () => VE.step(1)),
      mkBtn('toEnd', 'Tới cuối (End)', () => VE.seek(VE.timelineEnd())),
      h('span', { class: 'sp' }),
      h('button', { class: 'ib txt', title: 'Chụp khung hình hiện tại thành PNG', onclick: snapshotPng }, 'PNG')));

    // player
    VE.audio.ensure();
    VE.player = new VE.Player(canvas);
    VE.player.onTime = (t) => { S.playhead = t; VE.emit('playhead', t, true); };
    VE.player.onEnd = () => updatePlayBtn();
    VE.player.setSize(...psize());

    // scrub
    scrubEl.addEventListener('mousedown', (e) => {
      const move = (ev) => {
        const r = scrubEl.getBoundingClientRect();
        const dur = Math.max(VE.timelineEnd(), 1);
        VE.seek(clamp((ev.clientX - r.left) / r.width, 0, 1) * dur);
      };
      move(e);
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });

    new ResizeObserver(layoutMon).observe(view);
    canvas.addEventListener('mousedown', onCanvasDown);
    selbox.addEventListener('mousedown', onSelDown);
    view.addEventListener('mousedown', (e) => { if (e.target === view || e.target === wrap) { S.activePanel = 'program'; } });
    panel.addEventListener('mousedown', () => (S.activePanel = 'program'));

    VE.on('settings', () => { VE.player.setSize(...psize()); layoutMon(); VE.player.refresh(); });
    VE.on('change', () => { VE.player.refresh(); updateOverlay(); updateDur(); updateRange(); });
    VE.on('props', () => { VE.player.refresh(); updateOverlay(); });
    VE.on('select', updateOverlay);
    VE.on('playhead', (t, playing) => {
      tcCur.textContent = VE.tc(t);
      updateScrub();
      if (!playing) updateOverlay();
      else if (selbox.style.display !== 'none') updateOverlay();
      if (!playing) updatePlayBtn();
    });
    VE.on('tool', () => { view.dataset.tool = S.tool; });
    layoutMon();
  };

  function psize() {
    const w = Math.max(2, Math.round(S.settings.width * quality));
    const h2 = Math.max(2, Math.round(S.settings.height * quality));
    return [w, h2];
  }
  VE.setPreviewQuality = (q) => { quality = q; qualSel.value = String(q); VE.player.setSize(...psize()); VE.player.refresh(); };

  function layoutMon() {
    if (!view) return;
    const W = S.settings.width, H = S.settings.height;
    const aw = Math.max(50, view.clientWidth - 16), ah = Math.max(50, view.clientHeight - 16);
    const k = zoomMode === 'fit' ? Math.min(aw / W, ah / H) : zoomMode;
    disp = k;
    wrap.style.width = W * k + 'px';
    wrap.style.height = H * k + 'px';
    titleEl.textContent = 'Program: ' + S.settings.name + '  —  ' + W + '×' + H + ' · ' + S.settings.fps + 'fps';
    updateOverlay();
    updateDur();
    updateRange();
    updateScrub();
    tcCur.textContent = VE.tc(S.playhead);
  }
  function updateDur() { if (tcDur) tcDur.textContent = VE.tc(VE.timelineEnd()); updateScrub(); }
  function updateScrub() {
    if (!scrubHead) return;
    const dur = Math.max(VE.timelineEnd(), 1);
    scrubHead.style.left = clamp(S.playhead / dur, 0, 1) * 100 + '%';
  }
  function updateRange() {
    if (!scrubRange) return;
    if (!S.range) { scrubRange.style.display = 'none'; return; }
    const dur = Math.max(VE.timelineEnd(), 1);
    scrubRange.style.display = 'block';
    scrubRange.style.left = (S.range.in / dur) * 100 + '%';
    scrubRange.style.width = ((S.range.out - S.range.in) / dur) * 100 + '%';
  }
  function setSeqMark(which) {
    VE.history.record();
    const t = S.playhead;
    if (which === 'in') S.range = { in: t, out: S.range && S.range.out > t ? S.range.out : Math.max(VE.timelineEnd(), t + 1) };
    else S.range = { in: S.range && S.range.in < t ? S.range.in : 0, out: t };
    VE.emit('change');
  }
  VE.setSeqMark = setSeqMark;

  function snapshotPng() {
    const c = document.createElement('canvas');
    c.width = S.settings.width; c.height = S.settings.height;
    const p = new VE.Player(c, {});
    p.silent = true;
    p.time = S.playhead;
    const done = () => {
      p.render(S.playhead);
      c.toBlob((b) => { VE.download(b, S.settings.name + '_' + VE.tc(S.playhead).replace(/:/g, '-') + '.png'); p.dispose(); });
    };
    p.manage(S.playhead);
    p.preroll().then(done);
  }

  // ------------------------------------------------------------------ overlay (selection box)
  const primaryVisual = () => VE.selected().filter(VE.isVisual).pop() || null;
  function activeVisualPrimary() {
    const c = primaryVisual();
    if (!c) return null;
    const t = S.playhead;
    if (t < c.start - 1e-6 || t >= c.start + c.dur + 1e-6) return null;
    return c;
  }
  function updateOverlay() {
    if (!selbox) return;
    const c = activeVisualPrimary();
    if (!c || VE.track(c.trackId).hidden) { selbox.style.display = 'none'; return; }
    const W = S.settings.width, H = S.settings.height;
    const box = VE.clipBox(c);
    const sc = c.scale / 100;
    const w = box.w * sc * disp, hh = box.h * sc * disp;
    const cx = (W / 2 + c.x) * disp, cy = (H / 2 + c.y) * disp;
    Object.assign(selbox.style, {
      display: 'block', left: cx - w / 2 + 'px', top: cy - hh / 2 + 'px', width: w + 'px', height: hh + 'px',
      transform: 'rotate(' + c.rot + 'deg)',
    });
    selbox.classList.toggle('locked', VE.track(c.trackId).locked);
  }

  const toSeq = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * S.settings.width, y: ((e.clientY - r.top) / r.height) * S.settings.height };
  };

  function onCanvasDown(e) {
    if (e.button !== 0) return;
    S.activePanel = 'program';
    const p = toSeq(e);
    if (S.tool === 'text') {
      VE.addGraphic('text', { text: VE.defaultText(), x: Math.round(p.x - S.settings.width / 2), y: Math.round(p.y - S.settings.height / 2) }, S.playhead, 5);
      VE.setTool('select');
      VE.emit('focusText');
      return;
    }
    if (S.tool === 'shape') {
      VE.addGraphic('shape', { shape: VE.defaultShape('rect'), x: Math.round(p.x - S.settings.width / 2), y: Math.round(p.y - S.settings.height / 2) }, S.playhead, 5);
      VE.setTool('select');
      return;
    }
    const hit = VE.player.hitTest(p.x, p.y, S.playhead);
    if (!hit) { VE.clearSelection(); return; }
    if (!S.sel.has(hit.id)) VE.select([hit.id]);
    startMoveDrag(e);
  }
  function onSelDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    S.activePanel = 'program';
    const hd = e.target.dataset.h;
    if (hd === 'rot') startRotDrag(e);
    else if (hd) startScaleDrag(e);
    else startMoveDrag(e);
  }

  const targets = () => VE.selected().filter((c) => VE.isVisual(c) && !VE.track(c.trackId).locked);

  function startMoveDrag(e) {
    const list = targets();
    if (!list.length) return;
    const orig = list.map((c) => ({ c, x: c.x, y: c.y }));
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
      if (!moved) { moved = true; VE.history.record(); }
      let dx = (ev.clientX - x0) / disp, dy = (ev.clientY - y0) / disp;
      const tol = 7 / disp;
      guideV.style.display = guideH.style.display = 'none';
      if (!ev.altKey) {
        const p0 = orig[orig.length - 1];
        if (Math.abs(p0.x + dx) < tol) { dx = -p0.x; guideV.style.display = 'block'; }
        if (Math.abs(p0.y + dy) < tol) { dy = -p0.y; guideH.style.display = 'block'; }
      }
      orig.forEach((o) => { o.c.x = Math.round(o.x + dx); o.c.y = Math.round(o.y + dy); });
      VE.emit('props');
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      guideV.style.display = guideH.style.display = 'none';
      if (moved) VE.emit('change');
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    e.preventDefault();
  }

  function centerPx(c) {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((S.settings.width / 2 + c.x) / S.settings.width) * r.width, y: r.top + ((S.settings.height / 2 + c.y) / S.settings.height) * r.height };
  }
  function startScaleDrag(e) {
    const list = targets();
    const c = primaryVisual();
    if (!list.length || !c) return;
    const C = centerPx(c);
    const d0 = Math.max(4, Math.hypot(e.clientX - C.x, e.clientY - C.y));
    const orig = list.map((x) => ({ c: x, s: x.scale }));
    let moved = false;
    const move = (ev) => {
      if (!moved) { moved = true; VE.history.record(); }
      const k = Math.hypot(ev.clientX - C.x, ev.clientY - C.y) / d0;
      orig.forEach((o) => { o.c.scale = Math.max(1, Math.round(o.s * k * 10) / 10); o.c.fit = null; });
      VE.emit('props');
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (moved) VE.emit('change'); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    e.preventDefault();
  }
  function startRotDrag(e) {
    const list = targets();
    const c = primaryVisual();
    if (!list.length || !c) return;
    const C = centerPx(c);
    const a0 = Math.atan2(e.clientY - C.y, e.clientX - C.x);
    const orig = list.map((x) => ({ c: x, r: x.rot }));
    let moved = false;
    const move = (ev) => {
      if (!moved) { moved = true; VE.history.record(); }
      let d = ((Math.atan2(ev.clientY - C.y, ev.clientX - C.x) - a0) * 180) / Math.PI;
      orig.forEach((o) => {
        let r = o.r + d;
        if (ev.shiftKey) r = Math.round(r / 15) * 15;
        r = ((r + 540) % 360) - 180;
        o.c.rot = Math.round(r * 10) / 10;
      });
      VE.emit('props');
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (moved) VE.emit('change'); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    e.preventDefault();
  }

  // ------------------------------------------------------------------ Source monitor
  VE.initSource = function (panel) {
    const title = h('div', { class: 'ptitle' }, h('span', { class: 'ptitle-t', id: 'srcTitle' }, 'Source: (no clips)'));
    const vid = h('video', { class: 'src-video', playsInline: true });
    const img = h('img', { class: 'src-img' });
    const ph = h('div', { class: 'src-ph' }, 'Nhấp đúp vào một media ở Project để xem ở đây');
    const box = h('div', { class: 'mon-view' }, h('div', { class: 'src-stage' }, vid, img, ph));
    const cur = h('span', { class: 'tc cur' }, '00:00:00:00');
    const dur = h('span', { class: 'tc dur' }, '00:00:00:00');
    const scrubHd = h('div', { class: 'scrub-head' });
    const rng = h('div', { class: 'scrub-range' });
    const scrub = h('div', { class: 'scrub' }, rng, scrubHd);
    const sPlay = mkBtn('play', 'Phát / dừng', () => toggle(), 'play');
    let media = null;

    const upd = () => {
      if (!media) return;
      const d = media.duration;
      const t = vid.currentTime || 0;
      cur.textContent = VE.tc(t);
      if (isFinite(d)) {
        scrubHd.style.left = clamp(t / d, 0, 1) * 100 + '%';
        const a = media.markIn || 0, b = media.markOut != null ? media.markOut : d;
        if (media.markIn != null || media.markOut != null) {
          rng.style.display = 'block'; rng.style.left = (a / d) * 100 + '%'; rng.style.width = ((b - a) / d) * 100 + '%';
        } else rng.style.display = 'none';
      }
      sPlay.innerHTML = VE.icon(vid.paused ? 'play' : 'pause', 18);
    };
    vid.addEventListener('timeupdate', upd);
    vid.addEventListener('play', upd);
    vid.addEventListener('pause', upd);
    vid.addEventListener('seeked', upd);
    const toggle = () => {
      if (!media || media.kind === 'image') return;
      if (vid.paused) { VE.pause(); const b = media.markOut != null ? media.markOut : media.duration; if (vid.currentTime >= b - 0.05) vid.currentTime = media.markIn || 0; vid.play(); } else vid.pause();
    };
    scrub.addEventListener('mousedown', (e) => {
      if (!media || media.kind === 'image') return;
      const move = (ev) => { const r = scrub.getBoundingClientRect(); vid.currentTime = clamp((ev.clientX - r.left) / r.width, 0, 1) * media.duration; };
      move(e);
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    const setMark = (which) => {
      if (!media || media.kind === 'image') return;
      const t = vid.currentTime;
      if (which === 'in') { media.markIn = t; if (media.markOut != null && media.markOut <= t) media.markOut = null; }
      else { media.markOut = t; if (media.markIn != null && media.markIn >= t) media.markIn = null; }
      upd();
    };
    const place = (mode) => {
      if (!media) return;
      const created = VE.placeMedia(media.id, { mode, start: S.playhead });
      if (created.length) {
        const end = Math.max(...created.map((c) => c.start + c.dur));
        VE.select(created.map((c) => c.id));
        VE.seek(end);
        VE.timeline.scrollToTime(end);
      }
    };
    panel.append(title, box, h('div', { class: 'mon-times' }, cur, h('span', { class: 'gap' }), dur), scrub,
      h('div', { class: 'transport' },
        mkBtn('markIn', 'Đặt điểm In (I)', () => setMark('in')),
        mkBtn('markOut', 'Đặt điểm Out (O)', () => setMark('out')),
        h('button', { class: 'ib txt', title: 'Xoá In/Out', onclick: () => { if (media) { media.markIn = media.markOut = null; upd(); } } }, '✕'),
        h('span', { class: 'sp' }),
        mkBtn('stepBack', 'Lùi 1 frame', () => { if (media) vid.currentTime = Math.max(0, vid.currentTime - VE.frame()); }),
        sPlay,
        mkBtn('stepFwd', 'Tiến 1 frame', () => { if (media) vid.currentTime += VE.frame(); }),
        h('span', { class: 'sp' }),
        mkBtn('insert', 'Insert – chèn tại playhead và đẩy các clip phía sau (,)', () => place('insert')),
        mkBtn('overwrite', 'Overwrite – ghi đè tại playhead (.)', () => place('overwrite'))));
    panel.addEventListener('mousedown', () => (S.activePanel = 'source'));

    VE.source = {
      load(id) {
        const m = VE.getMedia(id);
        if (!m) return;
        media = m;
        document.getElementById('srcTitle').textContent = 'Source: ' + m.name;
        ph.style.display = 'none';
        dur.textContent = m.kind === 'image' ? '—' : VE.tc(m.duration);
        vid.pause();
        if (m.kind === 'image') { vid.style.display = 'none'; img.style.display = 'block'; img.src = m.url; }
        else { img.style.display = 'none'; vid.style.display = 'block'; vid.classList.toggle('audio-only', m.kind === 'audio'); vid.src = m.url; vid.currentTime = m.markIn || 0; }
        upd();
      },
      playing: () => !vid.paused,
      pause: () => vid.pause(),
      toggle, setMark, place,
      current: () => media,
      clear(id) { if (media && media.id === id) { media = null; vid.removeAttribute('src'); vid.load(); ph.style.display = ''; img.style.display = 'none'; document.getElementById('srcTitle').textContent = 'Source: (no clips)'; } },
    };
    VE.on('media', () => { if (media && media.removed) VE.source.clear(media.id); });
  };

  // ------------------------------------------------------------------ Audio meter
  VE.initMeter = function (panel) {
    const cv = h('canvas', { class: 'meter-cv' });
    panel.append(cv);
    const holds = [-90, -90], levels = [-90, -90];
    const bufL = new Float32Array(1024), bufR = new Float32Array(1024);
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) { requestAnimationFrame(draw); return; }
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const a = VE.audio;
      const vals = [-90, -90];
      if (a.anL && VE.isPlaying()) {
        a.anL.getFloatTimeDomainData(bufL); a.anR.getFloatTimeDomainData(bufR);
        [bufL, bufR].forEach((b, i) => { let m = 0; for (let j = 0; j < b.length; j++) m = Math.max(m, Math.abs(b[j])); vals[i] = m > 0 ? 20 * Math.log10(m) : -90; });
      }
      const top = 8, bot = H - 22, range = 60;
      const y = (db) => top + (bot - top) * (1 - clamp((db + range) / range, 0, 1));
      const bx = 8, bw = 14, gap = 4;
      for (let i = 0; i < 2; i++) {
        levels[i] = Math.max(vals[i], levels[i] - 1.2);
        if (vals[i] > holds[i]) holds[i] = vals[i]; else holds[i] -= 0.25;
        const x = bx + i * (bw + gap);
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(x, top, bw, bot - top);
        const g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, '#e5432d'); g.addColorStop(0.12, '#f2c230'); g.addColorStop(0.35, '#3ec259'); g.addColorStop(1, '#2a8f42');
        ctx.fillStyle = g;
        ctx.fillRect(x, y(levels[i]), bw, bot - y(levels[i]));
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y(holds[i]), bw, 2);
        ctx.fillStyle = '#9a9a9a'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(i ? 'R' : 'L', x + bw / 2, H - 8);
      }
      ctx.textAlign = 'left'; ctx.fillStyle = '#9a9a9a'; ctx.strokeStyle = '#444';
      for (let db = 0; db >= -54; db -= 6) {
        const yy = y(db);
        ctx.beginPath(); ctx.moveTo(bx + 2 * (bw + gap) - 2, yy); ctx.lineTo(bx + 2 * (bw + gap) + 3, yy); ctx.stroke();
        ctx.fillText(String(db), bx + 2 * (bw + gap) + 6, yy + 3);
      }
      ctx.fillText('dB', bx + 2 * (bw + gap) + 6, bot + 12);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  };
})();
