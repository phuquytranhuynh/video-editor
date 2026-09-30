/* Timeline: track, clip, kéo thả / trim / cắt / fade, ruler, playhead */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;
  const { clamp } = VE;
  const HEAD_W = 150, RULER_H = 26;

  const T = (VE.timeline = {});
  let root, body, content, headers, headC, rulerWrap, rulerC, rulerCv, tcInput, playheadEl, rulerHead, snapLineEl, marqueeEl, razorEl, ghostEl, zoomSlider;
  let layout = {};
  const clipEls = new Map();
  let drag = null;

  const q = (t) => Math.round(t * S.settings.fps) / S.settings.fps; // làm tròn theo frame
  const pps2slider = (p) => (Math.log(p) - Math.log(3)) / (Math.log(800) - Math.log(3));
  const slider2pps = (v) => Math.exp(Math.log(3) + v * (Math.log(800) - Math.log(3)));

  // ------------------------------------------------------------------ init
  T.init = function (panel) {
    root = panel;
    root.classList.add('tl');
    tcInput = h('input', { class: 'tc-input', value: '00:00:00:00', spellcheck: false, title: 'Timecode – gõ để nhảy tới vị trí' });
    tcInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = VE.parseTc(tcInput.value); if (!isNaN(t)) VE.seek(t); tcInput.blur(); }
      if (e.key === 'Escape') tcInput.blur();
    });
    tcInput.addEventListener('blur', () => (tcInput.value = VE.tc(S.playhead)));
    tcInput.addEventListener('focus', () => tcInput.select());

    const mkTog = (id, icon, title, get, set) => {
      const b = h('button', { class: 'ib tog', title, html: VE.icon(icon, 16), onclick: () => { set(!get()); refreshToggles(); } });
      b.dataset.id = id;
      return b;
    };
    const top = h('div', { class: 'tl-top' },
      tcInput,
      h('div', { class: 'tl-tools' },
        mkTog('snap', 'magnet', 'Snap – tự hút vào cạnh clip / playhead (S)', () => S.snap, (v) => (S.snap = v)),
        mkTog('link', 'link', 'Linked selection – chọn/di chuyển video & audio liên kết cùng lúc', () => S.linked, (v) => (S.linked = v)),
        h('button', { class: 'ib', title: 'Thêm marker (M)', html: VE.icon('marker', 16), onclick: () => VE.addMarker() }),
        h('button', { class: 'ib', title: 'Cắt tại playhead (Ctrl+K)', html: VE.icon('razor', 16), onclick: () => VE.splitAt(S.playhead) }),
        h('span', { class: 'gap' }),
        h('button', { class: 'ib txt', title: 'Thêm track video', onclick: () => VE.addTrack('video') }, '+V'),
        h('button', { class: 'ib txt', title: 'Thêm track audio', onclick: () => VE.addTrack('audio') }, '+A')
      ),
      h('div', { class: 'tl-seq' }, h('span', { class: 'seqtab' }, '', h('b', { id: 'seqName' }, 'Sequence 01')))
    );

    rulerCv = h('canvas', { class: 'ruler-cv' });
    rulerHead = h('div', { class: 'rhead' });
    rulerC = h('div', { class: 'tl-rulerc' }, rulerCv, rulerHead);
    rulerWrap = h('div', { class: 'tl-rulerwrap' }, rulerC);
    headC = h('div', { class: 'tl-headc' });
    headers = h('div', { class: 'tl-headers' }, headC);
    playheadEl = h('div', { class: 'playhead' });
    snapLineEl = h('div', { class: 'snapline' });
    marqueeEl = h('div', { class: 'marquee' });
    razorEl = h('div', { class: 'razorline' });
    ghostEl = h('div', { class: 'dropghost' });
    content = h('div', { class: 'tl-content' });
    body = h('div', { class: 'tl-body' }, content);
    zoomSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, class: 'zoom-slider', title: 'Thu phóng timeline' });
    zoomSlider.value = pps2slider(S.pps);
    zoomSlider.addEventListener('input', () => T.setPps(slider2pps(parseFloat(zoomSlider.value))));
    const foot = h('div', { class: 'tl-foot' },
      h('span', { class: 'lb' }, 'Zoom'),
      h('button', { class: 'ib', html: VE.icon('minus', 14), onclick: () => T.setPps(S.pps / 1.4) }),
      zoomSlider,
      h('button', { class: 'ib', html: VE.icon('plus', 14), onclick: () => T.setPps(S.pps * 1.4) }),
      h('button', { class: 'ib txt', title: 'Vừa khít nội dung (\\)', onclick: () => T.fit() }, 'Fit'));
    const grid = h('div', { class: 'tl-grid' }, h('div', { class: 'tl-corner' }), rulerWrap, headers, body);
    root.append(top, grid, foot);

    body.addEventListener('scroll', () => {
      rulerWrap.scrollLeft = body.scrollLeft;
      headers.scrollTop = body.scrollTop;
      drawRuler();
    });
    body.addEventListener('wheel', onWheel, { passive: false });
    headers.addEventListener('wheel', (e) => { body.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
    body.addEventListener('mousedown', onBodyDown);
    body.addEventListener('mousemove', onBodyHover);
    body.addEventListener('contextmenu', onContext);
    body.addEventListener('dblclick', onDbl);
    rulerWrap.addEventListener('mousedown', onRulerDown);
    rulerWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = rulerTime(e);
      const mk = S.markers.find((m) => Math.abs(m.time - t) * S.pps < 8);
      VE.popupMenu(e.clientX, e.clientY, [
        { label: 'Thêm marker tại đây', action: () => VE.addMarker(t) },
        mk && { label: 'Xoá marker này', action: () => VE.deleteMarker(mk.id) },
        { sep: true },
        { label: 'Đặt điểm In (work area)', action: () => { VE.history.record(); S.range = { in: t, out: S.range ? Math.max(S.range.out, t + 0.1) : t + 1 }; VE.emit('change'); } },
        { label: 'Đặt điểm Out (work area)', action: () => { VE.history.record(); S.range = { in: S.range ? Math.min(S.range.in, t - 0.1) : 0, out: t }; VE.emit('change'); } },
        { label: 'Xoá work area', action: () => { S.range = null; VE.emit('change'); } },
      ]);
    });
    body.addEventListener('dragover', onDragOver);
    body.addEventListener('dragleave', (e) => { if (e.target === body) clearGhost(); });
    body.addEventListener('drop', onDrop);

    new ResizeObserver(() => { drawRuler(); }).observe(rulerWrap);

    VE.on('change', render);
    VE.on('settings', () => { render(); });
    VE.on('select', updateSelection);
    VE.on('playhead', T.updatePlayhead);
    VE.on('thumbs', () => S.clips.forEach((c) => drawClipCanvas(c)));
    VE.on('tool', () => { root.dataset.tool = S.tool; });
    root.dataset.tool = S.tool;
    refreshToggles();
    render();
  };

  function refreshToggles() {
    VE.$$('.tl-tools .tog', root).forEach((b) => {
      const on = b.dataset.id === 'snap' ? S.snap : S.linked;
      b.classList.toggle('on', on);
    });
  }
  T.refreshToggles = refreshToggles;

  // ------------------------------------------------------------------ render
  function contentWidth() {
    const vw = body.clientWidth || 800;
    return Math.max(vw, VE.timelineEnd() * S.pps + vw * 0.6);
  }

  function render() {
    if (!body) return;
    document.getElementById('seqName').textContent = S.settings.name;
    layout = {};
    const order = VE.tracksOf('video').slice().reverse().concat(VE.tracksOf('audio'));
    let y = 0;
    order.forEach((tr) => { layout[tr.id] = { top: y, h: tr.h }; y += tr.h; });
    const cw = contentWidth();
    content.style.width = cw + 'px';
    content.style.height = y + 40 + 'px';
    rulerC.style.width = cw + 'px';
    headC.style.height = y + 40 + 'px';
    content.textContent = '';
    headC.textContent = '';
    clipEls.clear();

    // rows + headers
    order.forEach((tr) => {
      const L = layout[tr.id];
      const row = h('div', { class: 'tl-row ' + tr.type + (tr.locked ? ' locked' : ''), style: { top: L.top + 'px', height: L.h + 'px' } });
      row.dataset.track = tr.id;
      content.append(row);
      headC.append(buildHeader(tr, L));
    });
    const gapLine = VE.tracksOf('video').length * 0; // (giữ chỗ)
    void gapLine;

    // clips
    S.clips.forEach((c) => { if (layout[c.trackId]) { const el = buildClip(c); content.append(el); } });
    // transitions
    S.clips.forEach((c) => {
      if (!c.transIn || !layout[c.trackId]) return;
      const cs = VE.clipsOnTrack(c.trackId);
      const prev = cs[cs.indexOf(c) - 1];
      if (!VE.adjacent(prev, c)) return;
      const half = VE.transHalf(prev, c);
      const L = layout[c.trackId];
      const el = h('div', { class: 'trans' + (S.selTrans === c.id ? ' sel' : ''), title: VE.transitionName(c.transIn.type) + ' – ' + c.transIn.dur.toFixed(2) + 's (click để chỉnh)',
        style: { left: (c.start - half) * S.pps + 'px', width: Math.max(8, half * 2 * S.pps) + 'px', top: L.top + 3 + 'px', height: L.h - 6 + 'px' } }, h('i', {}, '⧓'));
      el.dataset.trans = c.id;
      content.append(el);
    });
    // markers + range trên ruler
    VE.$$('.rmark,.rangebar', rulerC).forEach((n) => n.remove());
    S.markers.forEach((m) => {
      const el = h('div', { class: 'rmark', title: m.name || 'Marker', style: { left: m.time * S.pps + 'px', color: m.color } }, h('i', { html: VE.icon('marker', 12) }));
      el.dataset.marker = m.id;
      rulerC.append(el);
    });
    if (S.range) rulerC.append(h('div', { class: 'rangebar', style: { left: S.range.in * S.pps + 'px', width: Math.max(2, (S.range.out - S.range.in) * S.pps) + 'px' } }));
    content.append(playheadEl, snapLineEl, marqueeEl, razorEl, ghostEl);
    T.updatePlayhead(S.playhead);
    updateSelection();
    drawRuler();
    zoomSlider.value = pps2slider(S.pps);
  }

  function buildHeader(tr, L) {
    const isV = tr.type === 'video';
    const target = (isV ? S.targetV : S.targetA) === tr.id;
    const el = h('div', { class: 'th ' + tr.type, style: { height: L.h + 'px' } });
    el.dataset.track = tr.id;
    el.append(
      h('button', { class: 'tgt' + (target ? ' on' : ''), title: 'Đặt làm track đích khi thêm clip', onclick: () => { if (isV) S.targetV = tr.id; else S.targetA = tr.id; render(); } }, VE.trackName(tr)),
      h('button', { class: 'ib' + (tr.locked ? ' on' : ''), title: tr.locked ? 'Mở khoá track' : 'Khoá track', html: VE.icon(tr.locked ? 'lock' : 'unlock', 14),
        onclick: () => { VE.history.record(); tr.locked = !tr.locked; VE.emit('change'); } })
    );
    if (isV) {
      el.append(h('button', { class: 'ib' + (tr.hidden ? ' off' : ''), title: 'Hiện / ẩn track video', html: VE.icon(tr.hidden ? 'eyeoff' : 'eye', 14),
        onclick: () => { tr.hidden = !tr.hidden; VE.emit('change'); } }));
    } else {
      el.append(
        h('button', { class: 'ib txt' + (tr.muted ? ' on mute' : ''), title: 'Mute track', onclick: () => { tr.muted = !tr.muted; VE.emit('change'); } }, 'M'),
        h('button', { class: 'ib txt' + (tr.solo ? ' on solo' : ''), title: 'Solo track', onclick: () => { tr.solo = !tr.solo; VE.emit('change'); } }, 'S'),
        h('span', { class: 'mic', html: VE.icon('mic', 14) })
      );
    }
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      VE.popupMenu(e.clientX, e.clientY, [
        { label: 'Thêm track video', action: () => VE.addTrack('video') },
        { label: 'Thêm track audio', action: () => VE.addTrack('audio') },
        { sep: true },
        { label: 'Chiều cao: nhỏ', action: () => { tr.h = isV ? 40 : 36; VE.emit('change'); } },
        { label: 'Chiều cao: vừa', action: () => { tr.h = isV ? 60 : 52; VE.emit('change'); } },
        { label: 'Chiều cao: lớn', action: () => { tr.h = isV ? 90 : 80; VE.emit('change'); } },
        { sep: true },
        { label: 'Xoá track ' + VE.trackName(tr), action: () => { if (!S.clips.some((c) => c.trackId === tr.id) || confirm('Track có clip – xoá cả clip?')) VE.deleteTrack(tr.id); } },
      ]);
    });
    return el;
  }

  function buildClip(c) {
    const L = layout[c.trackId];
    const tr = VE.track(c.trackId);
    const mm = c.mediaId ? VE.getMedia(c.mediaId) : null;
    const el = h('div', { class: 'clip k-' + c.kind + (tr.locked ? ' locked' : '') + (mm && mm.sfx ? ' is-sfx' : '') });
    el.dataset.id = c.id;
    const cv = h('canvas', { class: 'cv' });
    const fin = h('div', { class: 'fade fin' });
    const fout = h('div', { class: 'fade fout' });
    const lbl = h('div', { class: 'lbl' });
    el.append(cv, fin, fout, lbl,
      h('div', { class: 'edge l', dataset: { edge: 'l' } }),
      h('div', { class: 'edge r', dataset: { edge: 'r' } }));
    if (c.kind !== 'text' || true) {
      el.append(h('div', { class: 'fh in', dataset: { fade: 'fadeIn' }, title: 'Kéo để tạo fade in' }),
        h('div', { class: 'fh out', dataset: { fade: 'fadeOut' }, title: 'Kéo để tạo fade out' }));
    }
    clipEls.set(c.id, el);
    positionClip(c, el);
    return el;
  }

  function clipLabel(c) {
    let s = c.name || c.kind;
    if (c.kind === 'video') s += ' [V]';
    else if (c.kind === 'audio') s += ' [A]';
    else if (c.kind === 'text') s = 'T: ' + (c.text.content || '').split('\n')[0].slice(0, 40);
    const tags = [];
    if (c.speed !== 1) tags.push(Math.round(c.speed * 100) + '%');
    if (c.zoom && c.zoom.type !== 'none') tags.push('🔍' + (c.zoom.type === 'in' ? '+' : '−'));
    return s + (tags.length ? '  · ' + tags.join(' ') : '');
  }

  function positionClip(c, el) {
    const L = layout[c.trackId];
    if (!L) return;
    const w = Math.max(2, c.dur * S.pps);
    el.style.left = c.start * S.pps + 'px';
    el.style.width = w + 'px';
    el.style.top = L.top + 2 + 'px';
    el.style.height = L.h - 4 + 'px';
    const fin = el.querySelector('.fin'), fout = el.querySelector('.fout');
    fin.style.width = c.fadeIn * S.pps + 'px';
    fout.style.width = c.fadeOut * S.pps + 'px';
    fin.style.display = c.fadeIn > 0 ? '' : 'none';
    fout.style.display = c.fadeOut > 0 ? '' : 'none';
    el.querySelector('.fh.in').style.left = Math.max(0, c.fadeIn * S.pps - 5) + 'px';
    el.querySelector('.fh.out').style.right = Math.max(0, c.fadeOut * S.pps - 5) + 'px';
    el.classList.toggle('has-fade-in', c.fadeIn > 0);
    el.classList.toggle('has-fade-out', c.fadeOut > 0);
    el.classList.toggle('narrow', w < 34);
    el.querySelector('.lbl').textContent = clipLabel(c);
    drawClipCanvas(c);
  }
  T.positionClip = (c) => { const el = clipEls.get(c.id); if (el) positionClip(c, el); };

  function drawClipCanvas(c) {
    const el = clipEls.get(c.id);
    if (!el) return;
    const cv = el.querySelector('canvas.cv');
    const L = layout[c.trackId];
    if (!L) return;
    const cssW = Math.max(2, c.dur * S.pps), cssH = L.h - 4;
    const w = Math.min(Math.ceil(cssW), 3200), hgt = cssH;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== hgt) cv.height = hgt;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, hgt);
    const sx = w / cssW;
    const m = c.mediaId ? VE.getMedia(c.mediaId) : null;
    if ((c.kind === 'video' || c.kind === 'image') && m) {
      const th = hgt - 14;
      const asp = m.width && m.height ? m.width / m.height : 16 / 9;
      const tw = Math.max(20, th * asp);
      for (let x = 0; x < cssW; x += tw) {
        let img = null;
        if (c.kind === 'image') img = m.img;
        else {
          const srcT = c.in + ((x + tw / 2) / S.pps) * c.speed;
          const t = VE.thumbAt(m, srcT);
          img = t && t.img;
        }
        if (img && (img.complete !== false)) ctx.drawImage(img, x * sx, 14, tw * sx, th);
      }
    } else if (c.kind === 'audio' && m && m.peaks) {
      const pk = m.peaks, pps = m.peakPps || 60;
      const mid = hgt / 2 + 6, amp = (hgt - 14) / 2;
      ctx.fillStyle = 'rgba(210,255,225,.85)';
      const vol = Math.min(2, c.volume / 100);
      for (let x = 0; x < w; x++) {
        const t0 = c.in + (x / w) * c.dur * c.speed, t1 = c.in + ((x + 1) / w) * c.dur * c.speed;
        let a = Math.floor(t0 * pps), b = Math.max(a + 1, Math.ceil(t1 * pps));
        let mx = 0;
        for (let i = a; i < b && i < pk.length; i++) if (pk[i] > mx) mx = pk[i];
        const hh = Math.max(1, Math.min(amp, mx * vol * amp * 1.05));
        ctx.fillRect(x, mid - hh, 1, hh * 2);
      }
    } else if (c.kind === 'audio') {
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath(); ctx.moveTo(0, hgt / 2 + 6); ctx.lineTo(w, hgt / 2 + 6); ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ selection / playhead / ruler
  function updateSelection() {
    clipEls.forEach((el, id) => el.classList.toggle('sel', S.sel.has(id)));
    VE.$$('.trans', content).forEach((el) => el.classList.toggle('sel', el.dataset.trans === S.selTrans));
  }

  T.updatePlayhead = function (t, playing) {
    if (!playheadEl) return;
    const x = t * S.pps;
    playheadEl.style.transform = 'translateX(' + x + 'px)';
    rulerHead.style.transform = 'translateX(' + x + 'px)';
    if (document.activeElement !== tcInput) tcInput.value = VE.tc(t);
    if (playing) {
      const vw = body.clientWidth;
      if (x > body.scrollLeft + vw - 40) body.scrollLeft = x - 80;
      else if (x < body.scrollLeft) body.scrollLeft = Math.max(0, x - 80);
    }
  };
  T.scrollToTime = (t) => {
    const x = t * S.pps;
    if (x < body.scrollLeft || x > body.scrollLeft + body.clientWidth - 30) body.scrollLeft = Math.max(0, x - 100);
  };

  function drawRuler() {
    if (!rulerCv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = rulerWrap.clientWidth, hh = RULER_H;
    if (!w) return;
    rulerCv.style.left = body.scrollLeft + 'px';
    rulerCv.style.width = w + 'px';
    rulerCv.style.height = hh + 'px';
    rulerCv.width = w * dpr;
    rulerCv.height = hh * dpr;
    const ctx = rulerCv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hh);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    let step = steps.find((s) => s * S.pps >= 90) || 3600;
    const sub = step >= 1 ? (step % 5 === 0 || step === 1 ? 5 : 4) : 5;
    const t0 = body.scrollLeft / S.pps, t1 = (body.scrollLeft + w) / S.pps;
    ctx.fillStyle = '#9a9a9a';
    ctx.strokeStyle = '#6a6a6a';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const start = Math.floor(t0 / step) * step;
    ctx.beginPath();
    for (let t = start; t <= t1 + step; t += step) {
      const x = Math.round(t * S.pps - body.scrollLeft) + 0.5;
      ctx.moveTo(x, hh - 11); ctx.lineTo(x, hh);
      for (let k = 1; k < sub; k++) {
        const xs = Math.round((t + (step * k) / sub) * S.pps - body.scrollLeft) + 0.5;
        ctx.moveTo(xs, hh - 5); ctx.lineTo(xs, hh);
      }
    }
    ctx.stroke();
    for (let t = start; t <= t1 + step; t += step) {
      const x = t * S.pps - body.scrollLeft;
      const label = step < 1 ? VE.tc(t) : VE.tc(t).slice(0, 8);
      ctx.fillText(label, x + 3, 4);
    }
  }

  T.setPps = function (p, anchorX) {
    p = clamp(p, 3, 800);
    const ax = anchorX != null ? anchorX : body.clientWidth / 2;
    const tAnchor = (body.scrollLeft + ax) / S.pps;
    S.pps = p;
    render();
    body.scrollLeft = Math.max(0, tAnchor * p - ax);
    rulerWrap.scrollLeft = body.scrollLeft;
    drawRuler();
    T.updatePlayhead(S.playhead);
  };
  T.fit = function () {
    const end = Math.max(VE.timelineEnd(), 5);
    T.setPps(((body.clientWidth - 40) / end), 0);
    body.scrollLeft = 0;
  };

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = body.getBoundingClientRect();
      T.setPps(S.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      body.scrollLeft += e.deltaX || e.deltaY;
    }
  }

  // ------------------------------------------------------------------ coordinates & snapping
  const evTime = (e) => { const r = body.getBoundingClientRect(); return Math.max(0, (e.clientX - r.left + body.scrollLeft) / S.pps); };
  const rulerTime = (e) => { const r = rulerWrap.getBoundingClientRect(); return Math.max(0, (e.clientX - r.left + rulerWrap.scrollLeft) / S.pps); };
  const evY = (e) => e.clientY - body.getBoundingClientRect().top + body.scrollTop;
  function trackAtY(y) {
    for (const id in layout) { const L = layout[id]; if (y >= L.top && y < L.top + L.h) return VE.track(id); }
    return null;
  }
  function snapPoints(excl) {
    const pts = [0, S.playhead];
    S.clips.forEach((c) => { if (!excl.has(c.id)) { pts.push(c.start, c.start + c.dur); } });
    S.markers.forEach((m) => pts.push(m.time));
    if (S.range) pts.push(S.range.in, S.range.out);
    return pts;
  }
  function snapDelta(edges, pts, tolPx) {
    let best = null, bd = tolPx / S.pps;
    for (const e of edges) for (const p of pts) {
      const d = p - e;
      if (Math.abs(d) < bd) { bd = Math.abs(d); best = { d, at: p }; }
    }
    return best;
  }
  function showSnap(t) { snapLineEl.style.display = 'block'; snapLineEl.style.left = t * S.pps + 'px'; }
  function hideSnap() { snapLineEl.style.display = 'none'; }

  // ------------------------------------------------------------------ ruler interaction
  function onRulerDown(e) {
    if (e.button !== 0) return;
    const mk = e.target.closest('.rmark');
    if (mk) { const m = S.markers.find((x) => x.id === mk.dataset.marker); if (m) VE.seek(m.time); return; }
    const move = (ev) => {
      let t = q(rulerTime(ev));
      if (S.snap) {
        const sn = snapDelta([t], snapPoints(new Set()).filter((p) => p !== S.playhead), 8);
        if (sn) { t = sn.at; showSnap(t); } else hideSnap();
      }
      VE.seek(t);
    };
    move(e);
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); hideSnap(); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
    e.preventDefault();
  }

  // ------------------------------------------------------------------ body interaction
  function onBodyHover(e) {
    if (S.tool === 'razor') {
      const t = evTime(e);
      razorEl.style.display = 'block';
      razorEl.style.left = t * S.pps + 'px';
    } else razorEl.style.display = 'none';
  }

  function onBodyDown(e) {
    if (e.button !== 0) return;
    VE.closeMenu();
    S.activePanel = 'timeline';
    const clipEl = e.target.closest('.clip');
    const transEl = e.target.closest('.trans');
    const tool = S.tool;
    if (tool === 'hand') { startPan(e); return; }
    if (transEl) { VE.selectTransition(transEl.dataset.trans); return; }
    if (clipEl) {
      const c = VE.clip(clipEl.dataset.id);
      if (!c) return;
      const locked = VE.track(c.trackId).locked;
      if (tool === 'razor') {
        const t = q(evTime(e));
        if (e.shiftKey) VE.splitAt(t, S.clips.filter((x) => !VE.track(x.trackId).locked).map((x) => x.id));
        else VE.splitAt(t, [c.id].concat(S.linked && !e.altKey ? VE.linkedOf(c).map((x) => x.id) : []));
        return;
      }
      if (e.target.dataset.fade && !locked) { startFade(c, e.target.dataset.fade, e); return; }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!S.sel.has(c.id)) VE.select([c.id], { add: additive, noLink: e.altKey });
      else if (additive) { VE.select([c.id], { toggle: true, noLink: e.altKey }); return; }
      if (locked) return;
      const edge = e.target.dataset.edge;
      if (edge) startTrim(c, edge, e, tool === 'ripple');
      else if (tool === 'select' || tool === 'ripple') startMove(c, e);
      return;
    }
    if (tool === 'razor') return;
    // vùng trống: marquee
    startMarquee(e);
  }

  function onDbl(e) {
    const clipEl = e.target.closest('.clip');
    if (!clipEl) return;
    const c = VE.clip(clipEl.dataset.id);
    if (c && VE.isVisual(c)) { VE.seek(clamp(S.playhead, c.start, c.start + c.dur - VE.frame())); }
  }

  function startPan(e) {
    const x0 = e.clientX, y0 = e.clientY, sl = body.scrollLeft, st = body.scrollTop;
    const move = (ev) => { body.scrollLeft = sl - (ev.clientX - x0); body.scrollTop = st - (ev.clientY - y0); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  // ---- marquee select
  function startMarquee(e) {
    const r = body.getBoundingClientRect();
    const x0 = e.clientX - r.left + body.scrollLeft, y0 = e.clientY - r.top + body.scrollTop;
    const base = e.shiftKey ? new Set(S.sel) : new Set();
    if (!e.shiftKey) VE.clearSelection();
    let moved = false;
    const move = (ev) => {
      const x1 = ev.clientX - r.left + body.scrollLeft, y1 = ev.clientY - r.top + body.scrollTop;
      if (!moved && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 4) return;
      moved = true;
      const L = Math.min(x0, x1), Rr = Math.max(x0, x1), Tp = Math.min(y0, y1), B = Math.max(y0, y1);
      Object.assign(marqueeEl.style, { display: 'block', left: L + 'px', top: Tp + 'px', width: Rr - L + 'px', height: B - Tp + 'px' });
      const ids = [];
      S.clips.forEach((c) => {
        const ly = layout[c.trackId];
        if (!ly) return;
        if (c.start * S.pps < Rr && (c.start + c.dur) * S.pps > L && ly.top < B && ly.top + ly.h > Tp) ids.push(c.id);
      });
      S.sel = new Set(base);
      VE.select(ids, { add: true });
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      marqueeEl.style.display = 'none';
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  // ---- move
  function startMove(c, e) {
    const moving = VE.selected().filter((x) => !VE.track(x.trackId).locked);
    // SFX bám theo caption/transition di chuyển cùng clip gốc
    VE.selected().forEach((c0) => S.clips.forEach((f) => { if (f.follow && f.follow.id === c0.id && !moving.includes(f) && !VE.track(f.trackId).locked) moving.push(f); }));
    if (!moving.length) return;
    const ids = new Set(moving.map((x) => x.id));
    const st = drag = {
      x0: e.clientX, y0: e.clientY, moving, ids, moved: false,
      orig: moving.map((x) => ({ c: x, start: x.start, trackId: x.trackId })),
      primary: c, dt: 0, trackDelta: 0, pts: null,
    };
    const minStart = Math.min(...moving.map((x) => x.start));
    const move = (ev) => {
      const dx = ev.clientX - st.x0, dy = ev.clientY - st.y0;
      if (!st.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!st.moved) { st.moved = true; VE.history.record(); st.pts = snapPoints(ids); clipEls.forEach((el, id) => ids.has(id) && el.classList.add('dragging')); }
      let dt = dx / S.pps;
      dt = Math.max(dt, -minStart);
      // snap
      hideSnap();
      let snapped = false;
      if (S.snap && !ev.altKey) {
        const edges = [];
        moving.forEach((x) => { edges.push(x.start + dt, x.start + dt + x.dur); });
        const sn = snapDelta(edges, st.pts, 9);
        if (sn) { dt += sn.d; showSnap(sn.at); snapped = true; }
      }
      if (!snapped) dt = q(minStart + dt) - minStart;
      dt = Math.max(dt, -minStart);
      // track delta
      const hov = trackAtY(evY(ev));
      let td = 0;
      const pt = VE.track(st.primary.trackId);
      if (hov && hov.type === pt.type) td = VE.tracksOf(pt.type).indexOf(hov) - VE.tracksOf(pt.type).indexOf(pt);
      const ok = moving.every((x) => {
        const tt = VE.track(x.trackId);
        const list = VE.tracksOf(tt.type);
        const dest = list[list.indexOf(tt) + td];
        return dest && !dest.locked;
      });
      if (!ok) td = 0;
      st.dt = dt; st.trackDelta = td;
      moving.forEach((x, i) => {
        const tt = VE.track(x.trackId);
        const list = VE.tracksOf(tt.type);
        const dest = list[list.indexOf(tt) + td];
        const el = clipEls.get(x.id);
        el.style.left = (st.orig[i].start + dt) * S.pps + 'px';
        el.style.top = layout[dest.id].top + 2 + 'px';
      });
      autoScroll(ev);
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      hideSnap();
      drag = null;
      if (!st.moved) return;
      const items = moving.map((x, i) => {
        const tt = VE.track(st.orig[i].trackId);
        const list = VE.tracksOf(tt.type);
        const dest = list[list.indexOf(tt) + st.trackDelta] || tt;
        return { c: x, start: st.orig[i].start + st.dt, trackId: dest.id };
      });
      VE.applyMove(items);
      VE.emit('change');
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  function autoScroll(ev) {
    const r = body.getBoundingClientRect();
    if (ev.clientX > r.right - 28) body.scrollLeft += 18;
    else if (ev.clientX < r.left + 28) body.scrollLeft -= 18;
  }

  // ---- trim
  function startTrim(c, side, e, ripple) {
    let targets = VE.selected().filter((x) => !VE.track(x.trackId).locked);
    if (!targets.includes(c)) targets = [c];
    const orig = new Map(targets.map((x) => [x.id, { start: x.start, in: x.in, dur: x.dur, speed: x.speed, fadeIn: x.fadeIn, fadeOut: x.fadeOut }]));
    const o = orig.get(c.id);
    const edgeT = side === 'l' ? o.start : o.start + o.dur;
    let lo = -Infinity, hi = Infinity;
    targets.forEach((x) => {
      const l = VE.trimLimits(x, side, orig.get(x.id), ripple);
      lo = Math.max(lo, l.lo); hi = Math.min(hi, l.hi);
    });
    // clip phía sau sẽ được dồn (ripple)
    let later = [];
    if (ripple) {
      const origEnds = new Map(targets.map((x) => [x.trackId, orig.get(x.id).start + orig.get(x.id).dur]));
      later = S.clips.filter((x) => !targets.includes(x) && origEnds.has(x.trackId) && x.start >= origEnds.get(x.trackId) - 1e-4).map((x) => ({ c: x, start: x.start }));
    }
    const pts = snapPoints(new Set(targets.map((x) => x.id)));
    const ids = new Set(targets.map((x) => x.id));
    let moved = false;
    const x0 = e.clientX;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved) { moved = true; VE.history.record(); }
      let t = edgeT + (ev.clientX - x0) / S.pps;
      hideSnap();
      if (S.snap && !ev.altKey) {
        const sn = snapDelta([t], pts, 9);
        if (sn) { t = sn.at; showSnap(t); } else t = q(t);
      } else t = q(t);
      let d = clamp(t - edgeT, lo, hi);
      targets.forEach((x) => { VE.setTrim(x, orig.get(x.id), side, d, ripple); T.positionClip(x); });
      if (ripple) later.forEach((l) => { l.c.start = l.start + (side === 'l' ? -d : d); T.positionClip(l.c); });
      VE.emit('props');
      autoScroll(ev);
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      hideSnap();
      if (moved) { VE.cleanTransitions(); VE.emit('change'); }
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  // ---- fade handle
  function startFade(c, which, e) {
    let moved = false;
    const move = (ev) => {
      if (!moved) { moved = true; VE.history.record(); }
      const t = evTime(ev);
      let d = which === 'fadeIn' ? t - c.start : c.start + c.dur - t;
      const other = which === 'fadeIn' ? c.fadeOut : c.fadeIn;
      d = q(clamp(d, 0, Math.max(0, c.dur - other)));
      VE.setFade(c, which, d);
      [c].concat(S.linked ? VE.linkedOf(c) : []).forEach((x) => T.positionClip(x));
      VE.emit('props');
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (moved) VE.emit('change'); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    e.preventDefault();
  }

  // ------------------------------------------------------------------ context menu
  function onContext(e) {
    e.preventDefault();
    const clipEl = e.target.closest('.clip');
    const transEl = e.target.closest('.trans');
    if (transEl) {
      VE.selectTransition(transEl.dataset.trans);
      const b = VE.clip(transEl.dataset.trans);
      VE.popupMenu(e.clientX, e.clientY, [
        ...VE.TRANSITIONS.map((t) => ({ label: t.name, checked: b.transIn && b.transIn.type === t.id, action: () => { VE.history.record(); VE.setTransition(b, t.id); VE.emit('change'); } })),
        { sep: true },
        { label: 'Xoá transition', action: () => { VE.history.record(); VE.setTransition(b, null); VE.emit('change'); } },
      ]);
      return;
    }
    if (clipEl) {
      const c = VE.clip(clipEl.dataset.id);
      if (!S.sel.has(c.id)) VE.select([c.id]);
      const t = q(evTime(e));
      const vis = VE.isVisual(c);
      const m = c.mediaId && VE.getMedia(c.mediaId);
      VE.popupMenu(e.clientX, e.clientY, [
        { label: 'Cắt tại vị trí con trỏ', shortcut: 'C', action: () => VE.splitAt(t, VE.selected().map((x) => x.id)) },
        { label: 'Cắt tại playhead', shortcut: 'Ctrl+K', action: () => VE.splitAt(S.playhead) },
        { sep: true },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => VE.copySel() },
        { label: 'Xoá', shortcut: 'Del', action: () => VE.deleteClips(Array.from(S.sel)) },
        { label: 'Xoá & dồn khoảng trống (Ripple)', shortcut: 'Shift+Del', action: () => VE.deleteClips(Array.from(S.sel), true) },
        { sep: true },
        c.link ? { label: 'Tách audio khỏi video (Unlink)', action: () => VE.unlink() } : { label: 'Liên kết clip đã chọn (Link)', disabled: S.sel.size < 2, action: () => VE.linkSelected() },
        c.kind === 'video' && { label: 'Trích xuất audio (Extract Audio)', disabled: !(m && m.hasAudio), action: () => VE.extractAudio(c) },
        { sep: true },
        { label: 'Fade in 0.5s', action: () => { VE.history.record(); VE.setFade(c, 'fadeIn', Math.min(0.5, c.dur / 2)); VE.emit('change'); } },
        { label: 'Fade out 0.5s', action: () => { VE.history.record(); VE.setFade(c, 'fadeOut', Math.min(0.5, c.dur / 2)); VE.emit('change'); } },
        { label: 'Xoá fade', action: () => { VE.history.record(); VE.setFade(c, 'fadeIn', 0); VE.setFade(c, 'fadeOut', 0); VE.emit('change'); } },
        vis && { label: 'Zoom nhanh', sub: [
          { label: 'Zoom In 20%', action: () => setZoomQuick(c, 'in', 20) },
          { label: 'Zoom In 40%', action: () => setZoomQuick(c, 'in', 40) },
          { label: 'Zoom Out 20%', action: () => setZoomQuick(c, 'out', 20) },
          { label: 'Zoom Out 40%', action: () => setZoomQuick(c, 'out', 40) },
          { label: 'Không zoom', action: () => setZoomQuick(c, 'none', 0) },
        ] },
        (c.kind === 'video' || c.kind === 'image') && { label: 'Vừa khung (Fit)', action: () => VE.applyFit('fit') },
        (c.kind === 'video' || c.kind === 'image') && { label: 'Lấp đầy khung (Fill)', action: () => VE.applyFit('fill') },
      ]);
      return;
    }
    const tr = trackAtY(evY(e));
    VE.popupMenu(e.clientX, e.clientY, [
      { label: 'Dán tại playhead', shortcut: 'Ctrl+V', disabled: !S.clipboard, action: () => VE.paste() },
      { label: 'Thêm marker tại playhead', shortcut: 'M', action: () => VE.addMarker() },
      { label: 'Thêm track video', action: () => VE.addTrack('video') },
      { label: 'Thêm track audio', action: () => VE.addTrack('audio') },
      tr && { label: 'Xoá track ' + VE.trackName(tr), action: () => VE.deleteTrack(tr.id) },
    ]);
  }

  function setZoomQuick(c, type, amount) {
    VE.history.record();
    VE.selected().filter(VE.isVisual).forEach((x) => { x.zoom.type = type; if (amount) x.zoom.amount = amount; });
    VE.emit('change');
  }

  // ------------------------------------------------------------------ drag & drop from panels
  function clearGhost() { ghostEl.style.display = 'none'; VE.$$('.fx-target', content).forEach((n) => n.classList.remove('fx-target', 'fx-l', 'fx-r')); }

  function onDragOver(e) {
    const d = VE.drag;
    if (!d) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    clearGhost();
    if (d.type === 'media' || d.type === 'sfx') {
      const m = d.type === 'sfx' ? { kind: 'audio', duration: VE.sfxDef(d.id).dur, markIn: 0, markOut: null } : VE.getMedia(d.id);
      if (!m) return;
      let t = evTime(e);
      const dur = m.kind === 'image' ? S.settings.stillDur : (m.markOut != null ? m.markOut : m.duration) - (m.markIn || 0);
      if (S.snap) { const sn = snapDelta([t, t + dur], snapPoints(new Set()), 9); if (sn) t += sn.d; else t = q(t); } else t = q(t);
      let tr = trackAtY(evY(e));
      const wantType = m.kind === 'audio' ? 'audio' : 'video';
      if (!tr || tr.type !== wantType) tr = VE.track(wantType === 'audio' ? S.targetA : S.targetV);
      const L = layout[tr.id];
      Object.assign(ghostEl.style, { display: 'block', left: t * S.pps + 'px', top: L.top + 2 + 'px', width: Math.max(4, dur * S.pps) + 'px', height: L.h - 4 + 'px' });
    } else if (d.type === 'fx') {
      const clipEl = e.target.closest('.clip');
      if (clipEl) {
        const c = VE.clip(clipEl.dataset.id);
        const r = clipEl.getBoundingClientRect();
        const left = e.clientX - r.left < r.width / 2;
        clipEl.classList.add('fx-target', left ? 'fx-l' : 'fx-r');
      }
    }
  }

  function onDrop(e) {
    const d = VE.drag;
    if (!d) return;
    e.preventDefault();
    const insert = e.ctrlKey || e.metaKey;
    clearGhost();
    if (d.type === 'sfx') {
      const def = VE.sfxDef(d.id);
      let t = evTime(e);
      if (S.snap) { const sn = snapDelta([t, t + def.dur], snapPoints(new Set()), 9); if (sn) t += sn.d; else t = q(t); } else t = q(t);
      const tr0 = trackAtY(evY(e));
      const aTrack = tr0 && tr0.type === 'audio' ? tr0.id : null;
      VE.sfxMedia(d.id).then((m) => {
        const created = VE.placeMedia(m.id, { start: Math.max(0, t), aTrack: aTrack || VE.freeAudioTrack(t, m.duration).id });
        if (created.length) VE.select(created.map((c) => c.id));
      });
      VE.drag = null;
      return;
    }
    if (d.type === 'media') {
      const m = VE.getMedia(d.id);
      if (!m) return;
      let t = evTime(e);
      const dur = m.kind === 'image' ? S.settings.stillDur : (m.markOut != null ? m.markOut : m.duration) - (m.markIn || 0);
      if (S.snap) { const sn = snapDelta([t, t + dur], snapPoints(new Set()), 9); if (sn) t += sn.d; else t = q(t); } else t = q(t);
      let tr = trackAtY(evY(e));
      const wantType = m.kind === 'audio' ? 'audio' : 'video';
      const opt = { start: Math.max(0, t), mode: insert ? 'insert' : 'overwrite' };
      if (tr && tr.type === wantType) { if (wantType === 'video') opt.vTrack = tr.id; else opt.aTrack = tr.id; }
      const created = VE.placeMedia(d.id, opt);
      if (created.length) VE.select(created.map((c) => c.id));
    } else if (d.type === 'fx') {
      const clipEl = e.target.closest('.clip');
      if (clipEl) {
        const c = VE.clip(clipEl.dataset.id);
        const r = clipEl.getBoundingClientRect();
        const left = e.clientX - r.left < r.width / 2;
        VE.applyFxDrop(c, d, left ? 'start' : 'end');
      }
    }
    VE.drag = null;
  }

  // Dùng bởi Effects panel: áp fx được kéo thả lên clip
  VE.applyFxDrop = function (c, d, side) {
    VE.history.record();
    if (d.fx === 'transition') {
      VE.applyTransitionAtEdge(c, side, d.id);
    } else if (d.fx === 'zoom' || d.fx === 'fade') {
      if (d.fx === 'zoom' && !VE.isVisual(c)) { VE.toast('Zoom chỉ áp dụng cho clip hình ảnh'); return; }
      VE.applyFxDropRaw(c, d);
    }
    VE.emit('change');
  };
})();
