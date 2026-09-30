/* Trạng thái dự án + các thao tác chỉnh sửa (cắt, ghép, trim, overwrite, undo/redo) */
(function () {
  const VE = window.VE;
  const S = (VE.state = {
    media: [], // danh sách hiển thị trong Project panel
    mediaStore: new Map(), // id -> media (kể cả đã xoá, để undo)
    tracks: [],
    clips: [],
    markers: [],
    range: null, // {in,out} work area
    sel: new Set(),
    selTrans: null, // id clip B của transition đang chọn
    playhead: 0,
    tool: 'select',
    snap: true,
    linked: true,
    pps: 40, // pixel / giây
    settings: null,
    targetV: 'V1',
    targetA: 'A1',
    clipboard: null,
    activePanel: 'timeline',
    fxDur: 1, // thời lượng transition mặc định
    autoSfx: true, // tự chèn SFX khi tạo caption
    autoTransSfx: true, // tự chèn SFX khi thêm transition
  });

  // ------------------------------------------------------------------ presets
  VE.PRESETS = [
    { id: 'tiktok', name: 'TikTok (9:16) · 1080×1920 · 30fps', w: 1080, h: 1920, fps: 30, vbr: 8, abr: 192 },
    { id: 'shorts', name: 'YouTube Shorts (9:16) · 1080×1920 · 30fps', w: 1080, h: 1920, fps: 30, vbr: 10, abr: 192 },
    { id: 'reels', name: 'Instagram Reels (9:16) · 1080×1920 · 30fps', w: 1080, h: 1920, fps: 30, vbr: 8, abr: 192 },
    { id: 'yt1080', name: 'YouTube 1080p (16:9) · 1920×1080 · 30fps', w: 1920, h: 1080, fps: 30, vbr: 12, abr: 192 },
    { id: 'yt1080_60', name: 'YouTube 1080p 60fps (16:9) · 1920×1080', w: 1920, h: 1080, fps: 60, vbr: 16, abr: 192 },
    { id: 'yt720', name: 'YouTube 720p (16:9) · 1280×720 · 30fps', w: 1280, h: 720, fps: 30, vbr: 6, abr: 160 },
    { id: 'yt4k', name: 'YouTube 4K (16:9) · 3840×2160 · 30fps', w: 3840, h: 2160, fps: 30, vbr: 40, abr: 256 },
    { id: 'square', name: 'Instagram vuông (1:1) · 1080×1080 · 30fps', w: 1080, h: 1080, fps: 30, vbr: 8, abr: 192 },
    { id: 'portrait', name: 'Instagram dọc (4:5) · 1080×1350 · 30fps', w: 1080, h: 1350, fps: 30, vbr: 8, abr: 192 },
    { id: 'custom', name: 'Tuỳ chỉnh…', w: 1920, h: 1080, fps: 30, vbr: 10, abr: 192 },
  ];
  VE.FPS_LIST = [24, 25, 30, 50, 60];

  // ------------------------------------------------------------------ helpers
  VE.getMedia = (id) => S.mediaStore.get(id);
  VE.clip = (id) => S.clips.find((c) => c.id === id);
  VE.track = (id) => S.tracks.find((t) => t.id === id);
  VE.tracksOf = (type) => S.tracks.filter((t) => t.type === type);
  VE.trackName = (t) => (t.type === 'video' ? 'V' : 'A') + (VE.tracksOf(t.type).indexOf(t) + 1);
  VE.clipsOnTrack = (trackId) => S.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  VE.clipEnd = (c) => c.start + c.dur;
  VE.frame = () => 1 / (S.settings.fps || 30);
  VE.timelineEnd = () => S.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
  VE.isVisual = (c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'text' || c.kind === 'shape';
  VE.isMediaClip = (c) => c.kind === 'video' || c.kind === 'audio';
  VE.linkedOf = (c) => (c.link ? S.clips.filter((x) => x.link === c.link && x !== c) : []);
  VE.selected = () => Array.from(S.sel).map(VE.clip).filter(Boolean);
  VE.primary = () => {
    const a = VE.selected();
    return a.length ? a[a.length - 1] : null;
  };

  const adj = (a, b) => a && b && Math.abs(a.start + a.dur - b.start) < VE.frame() * 0.75;
  VE.adjacent = adj;
  // nửa độ dài vùng transition giữa a và b (b.transIn)
  VE.transHalf = (a, b) => Math.max(0.02, Math.min(b.transIn.dur / 2, a.dur, b.dur));

  // ------------------------------------------------------------------ tracks
  let trackCounter = { video: 0, audio: 0 };
  VE.addTrack = function (type, opts = {}) {
    const n = ++trackCounter[type];
    const t = { id: (type === 'video' ? 'V' : 'A') + n, type, locked: false, muted: false, hidden: false, solo: false, h: type === 'video' ? 60 : 52 };
    S.tracks.push(t);
    if (!opts.silent) { VE.history.record(); VE.emit('change'); }
    return t;
  };
  VE.deleteTrack = function (id) {
    const t = VE.track(id);
    if (!t) return;
    if (VE.tracksOf(t.type).length <= 1) { VE.toast('Cần giữ lại ít nhất 1 track mỗi loại'); return; }
    VE.history.record();
    S.clips = S.clips.filter((c) => c.trackId !== id);
    S.tracks = S.tracks.filter((x) => x.id !== id);
    if (S.targetV === id) S.targetV = VE.tracksOf('video')[0].id;
    if (S.targetA === id) S.targetA = VE.tracksOf('audio')[0].id;
    cleanSel();
    VE.emit('change');
  };
  function defaultTracks() {
    trackCounter = { video: 0, audio: 0 };
    S.tracks = [];
    for (let i = 0; i < 3; i++) VE.addTrack('video', { silent: true });
    for (let i = 0; i < 3; i++) VE.addTrack('audio', { silent: true });
    S.targetV = 'V1';
    S.targetA = 'A1';
  }

  // ------------------------------------------------------------------ project
  VE.newProject = function (settings, opts = {}) {
    S.settings = Object.assign(
      { name: 'Sequence 01', width: 1920, height: 1080, fps: 30, bg: '#000000', fitMode: 'fit', stillDur: 5, preset: 'yt1080' },
      settings || {}
    );
    S.clips = [];
    S.markers = [];
    S.range = null;
    S.sel = new Set();
    S.selTrans = null;
    S.playhead = 0;
    if (!opts.keepMedia) {
      S.media = [];
      S.mediaStore = new Map();
    }
    defaultTracks();
    VE.history.clear();
    VE.emit('settings');
    VE.emit('media');
    VE.emit('change');
    VE.emit('select');
  };

  VE.applySettings = function (ns, refit) {
    VE.history.record();
    const old = S.settings;
    S.settings = Object.assign({}, old, ns);
    if (refit) {
      S.clips.forEach((c) => {
        if ((c.kind === 'video' || c.kind === 'image') && c.fit) {
          const m = VE.getMedia(c.mediaId);
          if (m) { c.scale = VE.fitScale(m.width, m.height, c.fit); c.x = 0; c.y = 0; }
        }
      });
    }
    VE.emit('settings');
    VE.emit('change');
  };

  VE.fitScale = function (w, h, mode) {
    const s = S.settings;
    if (!w || !h) return 100;
    const sx = s.width / w, sy = s.height / h;
    if (mode === 'fill') return Math.max(sx, sy) * 100;
    if (mode === 'fit') return Math.min(sx, sy) * 100;
    return 100;
  };

  // ------------------------------------------------------------------ clip factory
  VE.newClip = function (kind, props) {
    const base = {
      id: VE.uid(), kind, trackId: null, mediaId: null, name: '',
      start: 0, dur: 5, in: 0, speed: 1, link: null,
      fadeIn: 0, fadeOut: 0, transIn: null,
      x: 0, y: 0, scale: 100, rot: 0, opacity: 100, fit: null,
      zoom: { type: 'none', amount: 20, dur: 0, ease: 'smooth', fx: 0, fy: 0, at: 'start' },
      volume: 100, muted: false,
      anim: { in: { type: 'none', dur: 0.4 }, out: { type: 'none', dur: 0.3 }, loop: { type: 'none', amt: 1 } },
      card: null, follow: null, duck: null,
    };
    return Object.assign(base, props);
  };
  VE.cloneClip = (c) => JSON.parse(JSON.stringify(c));

  VE.defaultText = (over) => Object.assign({
    content: 'Nhập văn bản', font: 'Arial', size: 96, weight: 700, italic: false, color: '#ffffff', align: 'center',
    lineH: 1.2, letterSp: 0, wrapW: 0,
    bg: '#000000', bgOpacity: 0, bgPad: 16, bgRadius: 12,
    stroke: '#000000', strokeW: 0,
    shadow: false, shadowColor: '#000000', shadowBlur: 8,
    upper: false, hlColor: '#ffffff', hlBg: '#f59e0b', hlPad: 10, hlRadius: 10, hlOpacity: 100, hlAnim: true,
  }, over || {});
  VE.defaultShape = (type, over) => Object.assign({
    type: type || 'rect', w: 400, h: 240, fill: '#3b82f6', fillOpacity: 100, stroke: '#ffffff', strokeW: 0, radius: 24,
  }, over || {});

  // ------------------------------------------------------------------ selection
  function cleanSel() {
    S.sel.forEach((id) => { if (!VE.clip(id)) S.sel.delete(id); });
    if (S.selTrans && !VE.clip(S.selTrans)) S.selTrans = null;
  }
  VE.select = function (ids, opts = {}) {
    ids = Array.isArray(ids) ? ids : ids ? [ids] : [];
    if (S.linked && !opts.noLink) {
      const ex = new Set(ids);
      ids.forEach((id) => { const c = VE.clip(id); if (c) VE.linkedOf(c).forEach((l) => ex.add(l.id)); });
      ids = Array.from(ex);
    }
    if (!opts.add && !opts.toggle) S.sel = new Set();
    if (opts.toggle) {
      const allIn = ids.every((i) => S.sel.has(i));
      ids.forEach((i) => (allIn ? S.sel.delete(i) : S.sel.add(i)));
    } else ids.forEach((i) => S.sel.add(i));
    S.selTrans = null;
    VE.emit('select');
  };
  VE.selectTransition = function (clipId) {
    S.sel = new Set();
    S.selTrans = clipId;
    VE.emit('select');
  };
  VE.clearSelection = function () {
    if (!S.sel.size && !S.selTrans) return;
    S.sel = new Set();
    S.selTrans = null;
    VE.emit('select');
  };

  // ------------------------------------------------------------------ core edit ops
  const EPS = 1e-4;

  // Xoá/cắt các clip trên track trong khoảng [s,e] (kiểu overwrite)
  VE.overwriteRange = function (trackId, s, e, exclude = []) {
    const ex = new Set(exclude);
    for (const c of VE.clipsOnTrack(trackId)) {
      if (ex.has(c.id)) continue;
      const cs = c.start, ce = c.start + c.dur;
      if (ce <= s + EPS || cs >= e - EPS) continue;
      if (cs >= s - EPS && ce <= e + EPS) {
        S.clips = S.clips.filter((x) => x !== c);
      } else if (cs < s - EPS && ce > e + EPS) {
        const c2 = VE.cloneClip(c);
        c2.id = VE.uid();
        c2.start = e;
        c2.in = c.in + (e - cs) * c.speed;
        c2.dur = ce - e;
        c2.link = null; c2.transIn = null; c2.fadeIn = 0; c2.follow = null;
        c.dur = s - cs;
        c.fadeOut = 0;
        S.clips.push(c2);
      } else if (cs < s - EPS) {
        c.dur = s - cs;
        c.fadeOut = Math.min(c.fadeOut, c.dur);
      } else {
        const cut = e - cs;
        c.in += cut * c.speed;
        c.start = e;
        c.dur -= cut;
        c.transIn = null;
        c.fadeIn = Math.min(c.fadeIn, c.dur);
      }
    }
  };

  // dời toàn bộ clip từ t trở đi (trên các track không khoá) một khoảng d
  VE.insertGap = function (t, d) {
    S.clips.slice().forEach((c) => {
      const tr = VE.track(c.trackId);
      if (tr.locked) return;
      if (c.start < t - EPS && c.start + c.dur > t + EPS) VE.splitRaw(c, t, true);
    });
    S.clips.forEach((c) => {
      const tr = VE.track(c.trackId);
      if (!tr.locked && c.start >= t - EPS) c.start += d;
    });
  };

  // cắt clip tại t (raw, không ghi history). Trả về clip mới (nửa sau)
  const linkMap = new Map();
  VE.splitRaw = function (c, t, keepLinks) {
    if (t <= c.start + EPS || t >= c.start + c.dur - EPS) return null;
    const c2 = VE.cloneClip(c);
    c2.id = VE.uid();
    c2.start = t;
    c2.in = c.in + (t - c.start) * c.speed;
    c2.dur = c.start + c.dur - t;
    c2.transIn = null;
    c2.fadeIn = 0;
    c2.follow = null;
    c.dur = t - c.start;
    c.fadeOut = 0;
    if (c.link && !keepLinks) {
      if (!linkMap.has(c.link)) linkMap.set(c.link, VE.uid());
      c2.link = linkMap.get(c.link);
    } else if (c.link && keepLinks) {
      c2.link = null; // clip bị cắt do insert: bỏ liên kết nửa sau
    }
    S.clips.push(c2);
    return c2;
  };

  // Cắt tất cả clip (trên các track trackIds) tại các thời điểm times; giữ đúng cặp liên kết video/audio
  VE.splitTimes = function (times, trackIds, record) {
    const tr = new Set(trackIds);
    if (record !== false) VE.history.record();
    let n = 0;
    times.slice().sort((a, b) => a - b).forEach((t) => {
      linkMap.clear();
      S.clips.slice().forEach((c) => {
        if (tr.has(c.trackId) && !VE.track(c.trackId).locked && t > c.start + EPS && t < c.start + c.dur - EPS) { if (VE.splitRaw(c, t)) n++; }
      });
    });
    linkMap.clear();
    return n;
  };

  // Xoá các khoảng thời gian [s,e] trên các track trackIds và dồn phần phía sau lại (ripple)
  VE.removeRanges = function (ranges, trackIds) {
    const tr = new Set(trackIds.filter((id) => !VE.track(id).locked));
    const rs = ranges.filter((r) => r[1] - r[0] > 1e-3).sort((a, b) => b[0] - a[0]); // từ cuối về đầu
    if (!rs.length || !tr.size) return 0;
    VE.history.record();
    rs.forEach(([s, e]) => {
      const d = e - s;
      [e, s].forEach((t) => {
        linkMap.clear();
        S.clips.slice().forEach((c) => { if (tr.has(c.trackId) && t > c.start + EPS && t < c.start + c.dur - EPS) VE.splitRaw(c, t); });
      });
      linkMap.clear();
      S.clips = S.clips.filter((c) => !(tr.has(c.trackId) && c.start >= s - EPS && c.start + c.dur <= e + EPS));
      S.clips.forEach((c) => { if (tr.has(c.trackId) && c.start >= e - EPS) c.start -= d; });
    });
    VE.cleanTransitions();
    cleanSel();
    VE.emit('change');
    VE.emit('select');
    return rs.length;
  };

  // Cắt tại playhead: clip đang chọn (+ liên kết) hoặc mọi track không khoá
  VE.splitAt = function (t, ids) {
    let targets;
    if (ids && ids.length) targets = ids.map(VE.clip).filter(Boolean);
    else if (S.sel.size) targets = VE.selected();
    else targets = S.clips.filter((c) => !VE.track(c.trackId).locked);
    targets = targets.filter((c) => !VE.track(c.trackId).locked && t > c.start + EPS && t < c.start + c.dur - EPS);
    if (!targets.length) return [];
    VE.history.record();
    linkMap.clear();
    const created = targets.map((c) => VE.splitRaw(c, t)).filter(Boolean);
    linkMap.clear();
    VE.emit('change');
    return created;
  };

  // Xoá clip (ripple: dồn các clip phía sau trên cùng track)
  VE.deleteClips = function (ids, ripple) {
    let list = ids.map(VE.clip).filter((c) => c && !VE.track(c.trackId).locked);
    if (!list.length) return;
    VE.history.record();
    const removed = list.map((c) => ({ trackId: c.trackId, s: c.start, e: c.start + c.dur, id: c.id }));
    const gone = new Set(list.map((c) => c.id));
    S.clips = S.clips.filter((c) => !gone.has(c.id) && !(c.follow && gone.has(c.follow.id) && !ripple));
    if (ripple) {
      const byTrack = {};
      removed.forEach((r) => (byTrack[r.trackId] = byTrack[r.trackId] || []).push(r));
      Object.keys(byTrack).forEach((tid) => {
        const rs = byTrack[tid].sort((a, b) => b.s - a.s);
        rs.forEach((r) => {
          S.clips.forEach((c) => { if (c.trackId === tid && c.start >= r.e - EPS) c.start -= r.e - r.s; });
        });
      });
    }
    VE.cleanTransitions();
    cleanSel();
    VE.emit('change');
    VE.emit('select');
  };

  VE.cleanTransitions = function () {
    if (VE.syncFollowers) VE.syncFollowers();
    VE.tracksOf('video').concat(VE.tracksOf('audio')).forEach((tr) => {
      const cs = VE.clipsOnTrack(tr.id);
      cs.forEach((c, i) => { if (c.transIn && !adj(cs[i - 1], c)) c.transIn = null; });
    });
  };

  // ---- đặt media lên timeline
  VE.placeMedia = function (mediaId, opt = {}) {
    const m = VE.getMedia(mediaId);
    if (!m) return [];
    const start = opt.start != null ? opt.start : S.playhead;
    let inP = 0, dur;
    if (m.kind === 'image') dur = S.settings.stillDur;
    else {
      inP = opt.in != null ? opt.in : m.markIn || 0;
      const outP = opt.out != null ? opt.out : m.markOut != null ? m.markOut : m.duration;
      dur = Math.max(VE.frame(), outP - inP);
    }
    let vt = opt.vTrack ? VE.track(opt.vTrack) : VE.track(S.targetV);
    let at = opt.aTrack ? VE.track(opt.aTrack) : null;
    if (!at) {
      if (opt.vTrack && vt) {
        const idx = VE.tracksOf('video').indexOf(vt);
        at = VE.tracksOf('audio')[idx] || VE.track(S.targetA);
      } else at = VE.track(S.targetA);
    }
    const wantsV = m.kind === 'video' || m.kind === 'image';
    const wantsA = m.kind === 'audio' || (m.kind === 'video' && m.hasAudio);
    if ((wantsV && vt.locked) || (wantsA && at.locked)) { VE.toast('Track đang bị khoá'); return []; }
    VE.history.record();
    if (opt.mode === 'insert') VE.insertGap(start, dur);
    const created = [];
    const link = wantsV && wantsA ? VE.uid() : null;
    if (wantsV) {
      const c = VE.newClip(m.kind, {
        trackId: vt.id, mediaId: m.id, name: m.name, start, dur, in: inP, link,
        fit: S.settings.fitMode !== 'none' ? S.settings.fitMode : null,
        scale: VE.fitScale(m.width, m.height, S.settings.fitMode),
      });
      created.push(c);
    }
    if (wantsA) {
      created.push(VE.newClip('audio', { trackId: at.id, mediaId: m.id, name: m.name, start, dur, in: inP, link }));
    }
    created.forEach((c) => {
      if (opt.mode !== 'insert') VE.overwriteRange(c.trackId, c.start, c.start + c.dur);
      S.clips.push(c);
    });
    VE.cleanTransitions();
    VE.emit('change');
    return created;
  };

  // Thêm text / shape lên track video còn trống (track phía trên V1), tạo track mới nếu cần
  VE.addGraphic = function (kind, props, start, dur) {
    start = start != null ? start : S.playhead;
    dur = dur || 5;
    VE.history.record();
    const vts = VE.tracksOf('video');
    let target = null;
    for (let i = 1; i < vts.length; i++) {
      const free = !VE.clipsOnTrack(vts[i].id).some((c) => c.start < start + dur - EPS && c.start + c.dur > start + EPS);
      if (free && !vts[i].locked) { target = vts[i]; break; }
    }
    if (!target) target = VE.addTrack('video', { silent: true });
    const c = VE.newClip(kind, Object.assign({ trackId: target.id, start, dur, name: kind === 'text' ? 'Text' : 'Shape' }, props));
    S.clips.push(c);
    VE.emit('change');
    VE.select([c.id]);
    return c;
  };

  // Di chuyển nhiều clip (items: [{c, start, trackId}])
  VE.applyMove = function (items) {
    const ids = items.map((i) => i.c.id);
    items.forEach((i) => { i.c.start = Math.max(0, i.start); i.c.trackId = i.trackId; });
    items.forEach((i) => VE.overwriteRange(i.c.trackId, i.c.start, i.c.start + i.c.dur, ids));
    VE.cleanTransitions();
  };

  // ---- trim
  VE.mediaLimit = function (c) {
    if (!VE.isMediaClip(c)) return { minStart: -Infinity, maxEnd: Infinity };
    const m = VE.getMedia(c.mediaId);
    const md = m && isFinite(m.duration) ? m.duration : Infinity;
    return { minStart: c.start - c.in / c.speed, maxEnd: c.start + (md - c.in) / c.speed };
  };
  // khoảng delta cho phép khi kéo cạnh (side 'l'|'r') của clip gốc orig
  VE.trimLimits = function (c, side, orig, ripple) {
    const f = VE.frame();
    const lim = VE.mediaLimit(Object.assign({}, c, orig));
    const cs = VE.clipsOnTrack(c.trackId);
    const i = cs.indexOf(c);
    let lo, hi;
    if (side === 'l') {
      lo = Math.max(lim.minStart, 0) - orig.start;
      if (!ripple && i > 0) lo = Math.max(lo, cs[i - 1].start + cs[i - 1].dur - orig.start);
      hi = orig.dur - f;
    } else {
      lo = -(orig.dur - f);
      hi = lim.maxEnd - (orig.start + orig.dur);
      if (!ripple && cs[i + 1]) hi = Math.min(hi, cs[i + 1].start - (orig.start + orig.dur));
    }
    return { lo, hi };
  };
  VE.setTrim = function (c, orig, side, delta, ripple) {
    if (side === 'l') {
      if (ripple) {
        c.start = orig.start;
        c.in = orig.in + delta * orig.speed;
        c.dur = orig.dur - delta;
      } else {
        c.start = orig.start + delta;
        c.in = orig.in + delta * orig.speed;
        c.dur = orig.dur - delta;
      }
    } else {
      c.dur = orig.dur + delta;
    }
    c.fadeIn = Math.min(orig.fadeIn, c.dur);
    c.fadeOut = Math.min(orig.fadeOut, c.dur);
  };

  // Đổi tốc độ clip (giữ nguyên đoạn nguồn)
  VE.setSpeed = function (c, sp) {
    sp = VE.clamp(sp, 0.1, 16);
    const targets = [c].concat(S.linked ? VE.linkedOf(c) : []).filter((x) => VE.isMediaClip(x));
    targets.forEach((x) => {
      const src = x.dur * x.speed;
      x.speed = sp;
      x.dur = src / sp;
      x.fadeIn = Math.min(x.fadeIn, x.dur);
      x.fadeOut = Math.min(x.fadeOut, x.dur);
    });
    targets.forEach((x) => VE.overwriteRange(x.trackId, x.start, x.start + x.dur, [x.id]));
    VE.cleanTransitions();
  };

  // ---- link / unlink / extract audio
  VE.unlink = function (ids) {
    const list = (ids || Array.from(S.sel)).map(VE.clip).filter(Boolean);
    const groups = new Set(list.map((c) => c.link).filter(Boolean));
    if (!groups.size) return;
    VE.history.record();
    S.clips.forEach((c) => { if (groups.has(c.link)) c.link = null; });
    VE.emit('change');
  };
  VE.linkSelected = function () {
    const list = VE.selected();
    if (list.length < 2) return;
    VE.history.record();
    const id = VE.uid();
    list.forEach((c) => (c.link = id));
    VE.emit('change');
  };
  VE.extractAudio = function (c) {
    const m = VE.getMedia(c.mediaId);
    if (!m || m.kind !== 'video' || !m.hasAudio) { VE.toast('Clip này không có audio'); return; }
    const partner = VE.linkedOf(c).find((x) => x.kind === 'audio');
    VE.history.record();
    if (partner) { partner.link = null; c.link = null; VE.toast('Đã tách audio (Unlink) – audio và video có thể chỉnh riêng'); VE.emit('change'); return; }
    let at = VE.track(S.targetA);
    if (at.locked) { VE.toast('Track audio đang khoá'); return; }
    const a = VE.newClip('audio', { trackId: at.id, mediaId: c.mediaId, name: c.name, start: c.start, dur: c.dur, in: c.in, speed: c.speed });
    VE.overwriteRange(at.id, a.start, a.start + a.dur);
    S.clips.push(a);
    VE.emit('change');
    VE.select([a.id], { noLink: true });
  };

  // ---- copy / paste
  VE.copySel = function () {
    const list = VE.selected();
    if (!list.length) return;
    const t0 = Math.min(...list.map((c) => c.start));
    S.clipboard = { t0, clips: list.map((c) => VE.cloneClip(c)) };
    VE.toast('Đã copy ' + list.length + ' clip');
  };
  VE.paste = function () {
    if (!S.clipboard) return;
    VE.history.record();
    const lm = new Map();
    const created = S.clipboard.clips.map((src) => {
      const c = VE.cloneClip(src);
      c.id = VE.uid();
      c.start = S.playhead + (src.start - S.clipboard.t0);
      if (c.link) { if (!lm.has(c.link)) lm.set(c.link, VE.uid()); c.link = lm.get(c.link); }
      c.transIn = null;
      if (!VE.track(c.trackId)) c.trackId = VE.tracksOf(VE.isVisual(c) ? 'video' : 'audio')[0].id;
      return c;
    });
    created.forEach((c) => VE.overwriteRange(c.trackId, c.start, c.start + c.dur));
    S.clips.push(...created);
    VE.emit('change');
    VE.select(created.map((c) => c.id), { noLink: true });
  };

  // ---- markers
  VE.addMarker = function (t) {
    VE.history.record();
    S.markers.push({ id: VE.uid(), time: t != null ? t : S.playhead, name: '', color: '#3aa3ff' });
    VE.emit('change');
  };
  VE.deleteMarker = function (id) {
    VE.history.record();
    S.markers = S.markers.filter((m) => m.id !== id);
    VE.emit('change');
  };

  // ------------------------------------------------------------------ fx application (transition / zoom / fade)
  VE.TRANSITIONS = [
    { id: 'dissolve', name: 'Cross Dissolve (mờ chuyển)', cat: 'Cơ bản' },
    { id: 'dipBlack', name: 'Dip to Black (qua màu đen)', cat: 'Cơ bản' },
    { id: 'dipWhite', name: 'Dip to White (qua màu trắng)', cat: 'Cơ bản' },
    { id: 'flash', name: 'Flash (loé sáng trắng)', cat: 'Cơ bản' },
    { id: 'slideLeft', name: 'Slide ← (trượt vào từ phải)', cat: 'Trượt & đẩy' },
    { id: 'slideRight', name: 'Slide → (trượt vào từ trái)', cat: 'Trượt & đẩy' },
    { id: 'slideUp', name: 'Slide ↑ (trượt vào từ dưới)', cat: 'Trượt & đẩy' },
    { id: 'slideDown', name: 'Slide ↓ (trượt vào từ trên)', cat: 'Trượt & đẩy' },
    { id: 'pushLeft', name: 'Push ← (đẩy sang trái)', cat: 'Trượt & đẩy' },
    { id: 'pushRight', name: 'Push → (đẩy sang phải)', cat: 'Trượt & đẩy' },
    { id: 'pushUp', name: 'Push ↑ (đẩy lên)', cat: 'Trượt & đẩy' },
    { id: 'pushDown', name: 'Push ↓ (đẩy xuống)', cat: 'Trượt & đẩy' },
    { id: 'whipLeft', name: 'Whip Pan ← (vụt mờ sang trái)', cat: 'Trượt & đẩy' },
    { id: 'whipRight', name: 'Whip Pan → (vụt mờ sang phải)', cat: 'Trượt & đẩy' },
    { id: 'wipeRight', name: 'Wipe → (quét sang phải)', cat: 'Quét & hình khối' },
    { id: 'wipeLeft', name: 'Wipe ← (quét sang trái)', cat: 'Quét & hình khối' },
    { id: 'wipeDown', name: 'Wipe ↓ (quét xuống)', cat: 'Quét & hình khối' },
    { id: 'wipeUp', name: 'Wipe ↑ (quét lên)', cat: 'Quét & hình khối' },
    { id: 'wipeDiag', name: 'Wipe chéo', cat: 'Quét & hình khối' },
    { id: 'irisOpen', name: 'Iris – mở tròn từ tâm', cat: 'Quét & hình khối' },
    { id: 'clock', name: 'Clock Wipe (quét kim đồng hồ)', cat: 'Quét & hình khối' },
    { id: 'blindsV', name: 'Blinds dọc (rèm đứng)', cat: 'Quét & hình khối' },
    { id: 'blindsH', name: 'Blinds ngang (rèm ngang)', cat: 'Quét & hình khối' },
    { id: 'splitH', name: 'Mở cửa ngang (từ giữa ra)', cat: 'Quét & hình khối' },
    { id: 'splitV', name: 'Mở cửa dọc (từ giữa ra)', cat: 'Quét & hình khối' },
    { id: 'zoomIn', name: 'Zoom In (phóng vào)', cat: 'Zoom & xoay' },
    { id: 'zoomOut', name: 'Zoom Out (thu ra)', cat: 'Zoom & xoay' },
    { id: 'spin', name: 'Spin (xoay)', cat: 'Zoom & xoay' },
    { id: 'flipH', name: 'Flip (lật thẻ)', cat: 'Zoom & xoay' },
    { id: 'blur', name: 'Blur Dissolve (nhoè chuyển)', cat: 'Zoom & xoay' },
    { id: 'glitch', name: 'Glitch (giật nhiễu)', cat: 'Hiệu ứng' },
    { id: 'pixelate', name: 'Pixelate (vỡ hạt)', cat: 'Hiệu ứng' },
    { id: 'shake', name: 'Shake (rung)', cat: 'Hiệu ứng' },
  ];
  VE.transitionName = (id) => (VE.TRANSITIONS.find((t) => t.id === id) || {}).name || id;

  // Áp transition tại điểm cắt trước clip b (b.transIn), đồng bộ cho clip liên kết
  VE.setTransition = function (b, type, dur) {
    const cs = VE.clipsOnTrack(b.trackId);
    const prev = cs[cs.indexOf(b) - 1];
    if (!adj(prev, b)) return false;
    const apply = (x) => {
      if (type == null) x.transIn = null;
      else x.transIn = { type, dur: dur != null ? dur : x.transIn ? x.transIn.dur : S.fxDur };
    };
    const prevType = b.transIn ? b.transIn.type : null;
    apply(b);
    if (type == null) {
      const f = VE.sfxOf && VE.sfxOf(b);
      if (f) S.clips = S.clips.filter((c) => c !== f);
    } else if (type !== prevType && S.autoTransSfx && VE.TRANSITION_SFX && VE.TRANSITION_SFX[type]) {
      VE.attachSfx(b, VE.TRANSITION_SFX[type], { noRecord: true });
    }
    if (S.linked) {
      VE.linkedOf(b).forEach((l) => {
        const lc = VE.clipsOnTrack(l.trackId);
        if (adj(lc[lc.indexOf(l) - 1], l)) apply(l);
      });
    }
    return true;
  };

  // Áp fx theo cạnh của clip: side 'start'|'end'
  VE.applyTransitionAtEdge = function (c, side, type) {
    const cs = VE.clipsOnTrack(c.trackId);
    const i = cs.indexOf(c);
    if (side === 'start') {
      if (adj(cs[i - 1], c)) return VE.setTransition(c, type);
      const d = Math.min(S.fxDur, c.dur / 2);
      [c].concat(S.linked ? VE.linkedOf(c) : []).forEach((x) => (x.fadeIn = d));
      return true;
    }
    if (adj(c, cs[i + 1])) return VE.setTransition(cs[i + 1], type);
    const d = Math.min(S.fxDur, c.dur / 2);
    [c].concat(S.linked ? VE.linkedOf(c) : []).forEach((x) => (x.fadeOut = d));
    return true;
  };

  VE.setFade = function (c, which, d) {
    const arr = [c].concat(S.linked ? VE.linkedOf(c) : []);
    arr.forEach((x) => { x[which] = VE.clamp(d, 0, x.dur); });
  };

  // ------------------------------------------------------------------ history (undo / redo)
  const undoStack = [], redoStack = [];
  let lastKey = null, lastTime = 0;
  const snapshot = () => JSON.stringify({
    settings: S.settings, tracks: S.tracks, clips: S.clips, markers: S.markers, range: S.range,
    targetV: S.targetV, targetA: S.targetA, tc: trackCounter,
  });
  const restore = (json) => {
    const o = JSON.parse(json);
    const sizeChanged = !S.settings || o.settings.width !== S.settings.width || o.settings.height !== S.settings.height || o.settings.fps !== S.settings.fps;
    S.settings = o.settings; S.tracks = o.tracks; S.clips = o.clips; S.markers = o.markers; S.range = o.range;
    S.targetV = o.targetV; S.targetA = o.targetA; trackCounter = o.tc;
    S.clips.forEach((c) => { const m = VE.getMedia(c.mediaId); if (m && m.removed) { m.removed = false; if (!S.media.includes(m)) S.media.push(m); } });
    cleanSel();
    if (sizeChanged) VE.emit('settings');
    VE.emit('media');
    VE.emit('change');
    VE.emit('select');
  };
  VE.history = {
    record(key) {
      const now = performance.now();
      if (key && key === lastKey && now - lastTime < 1200) { lastTime = now; return; }
      lastKey = key || null;
      lastTime = now;
      undoStack.push(snapshot());
      if (undoStack.length > 120) undoStack.shift();
      redoStack.length = 0;
    },
    undo() {
      if (!undoStack.length) return VE.toast('Không còn gì để hoàn tác');
      redoStack.push(snapshot());
      restore(undoStack.pop());
      lastKey = null;
    },
    redo() {
      if (!redoStack.length) return VE.toast('Không còn gì để làm lại');
      undoStack.push(snapshot());
      restore(redoStack.pop());
      lastKey = null;
    },
    clear() { undoStack.length = 0; redoStack.length = 0; lastKey = null; },
  };

  // ------------------------------------------------------------------ serialize
  VE.serialize = () => JSON.parse(snapshot());
  VE.deserialize = (o) => restore(JSON.stringify(o));
  VE.setPlayhead = (t) => { S.playhead = Math.max(0, t); };
})();
