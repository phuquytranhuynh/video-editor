/* Engine phát & dựng hình: ghép layer bằng Canvas 2D, trộn audio bằng WebAudio */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const { clamp, lerp } = VE;

  // ------------------------------------------------------------------ audio graph (preview + meter)
  VE.audio = {
    ctx: null, master: null, anL: null, anR: null,
    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      const split = this.ctx.createChannelSplitter(2);
      this.anL = this.ctx.createAnalyser();
      this.anR = this.ctx.createAnalyser();
      this.anL.fftSize = this.anR.fftSize = 1024;
      this.master.connect(this.ctx.destination);
      this.master.connect(split);
      split.connect(this.anL, 0);
      split.connect(this.anR, 1);
      return this.ctx;
    },
    resume() { const c = this.ensure(); if (c.state === 'suspended') c.resume(); },
  };

  // ------------------------------------------------------------------ layout helpers
  const measCtx = document.createElement('canvas').getContext('2d');
  const textCache = new WeakMap();

  const fontStr = (t) => {
    const fam = /[",]/.test(t.font) || !/\s/.test(t.font) ? t.font : '"' + t.font + '"';
    return (t.italic ? 'italic ' : '') + t.weight + ' ' + t.size + 'px ' + fam + ', sans-serif';
  };

  const isSp = (x) => /^\s+$/.test(x);
  // tách nội dung thành từng đoạn → danh sách token {s, hl}; phần nằm giữa 2 dấu * là highlight
  function tokensOf(t) {
    const src = t.upper ? String(t.content).toUpperCase() : String(t.content);
    return src.split('\n').map((para) => {
      const toks = [];
      let hl = false;
      para.split('*').forEach((seg, i) => {
        if (i > 0) hl = !hl;
        seg.split(/(\s+)/).forEach((w) => { if (w !== '') toks.push({ s: w, hl }); });
      });
      return toks;
    });
  }

  function textLayout(c) {
    const t = c.text;
    const key = JSON.stringify([t.content, t.upper, t.font, t.size, t.weight, t.italic, t.wrapW, t.lineH, t.letterSp, t.bgPad]);
    const hit = textCache.get(c);
    if (hit && hit.key === key) return hit;
    measCtx.font = fontStr(t);
    if ('letterSpacing' in measCtx) measCtx.letterSpacing = (t.letterSp || 0) + 'px';
    const mw = (x) => measCtx.measureText(x).width;
    const lines = [];
    tokensOf(t).forEach((para) => {
      let cur = { toks: [], w: 0 };
      const push = () => {
        while (cur.toks.length && isSp(cur.toks[cur.toks.length - 1].s)) cur.w -= cur.toks.pop().w;
        lines.push(cur);
        cur = { toks: [], w: 0 };
      };
      para.forEach((tok) => {
        tok.w = mw(tok.s);
        const sp = isSp(tok.s);
        if (t.wrapW > 0 && !sp && cur.w + tok.w > t.wrapW && cur.toks.some((x) => !isSp(x.s))) push();
        if (sp && !cur.toks.length) return;
        cur.toks.push(tok);
        cur.w += tok.w;
      });
      push();
    });
    const lh = t.size * t.lineH;
    const w = t.wrapW > 0 ? t.wrapW : Math.max(10, ...lines.map((l) => l.w));
    const pad = t.bgPad || 0;
    const r = { key, lines, lh, w, boxW: w + pad * 2, boxH: lines.length * lh + pad * 2 };
    textCache.set(c, r);
    return r;
  }
  VE.textLayout = textLayout;

  VE.clipBox = function (c) {
    if (c.kind === 'video' || c.kind === 'image') {
      const m = VE.getMedia(c.mediaId);
      return { w: (m && m.width) || 1920, h: (m && m.height) || 1080 };
    }
    if (c.kind === 'text') { const L = textLayout(c); return { w: L.boxW, h: L.boxH }; }
    if (c.kind === 'shape') {
      const s = c.shape;
      if (s.type === 'line') return { w: s.w, h: Math.max(24, s.strokeW + 16) };
      return { w: s.w, h: s.h };
    }
    return { w: 100, h: 100 };
  };

  function shapePath(s) {
    const p = new Path2D();
    const w = s.w, h = s.h;
    switch (s.type) {
      case 'round': {
        const r = Math.min(s.radius, w / 2, h / 2);
        const x = -w / 2, y = -h / 2;
        p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.arcTo(x + w, y, x + w, y + r, r);
        p.lineTo(x + w, y + h - r); p.arcTo(x + w, y + h, x + w - r, y + h, r);
        p.lineTo(x + r, y + h); p.arcTo(x, y + h, x, y + h - r, r);
        p.lineTo(x, y + r); p.arcTo(x, y, x + r, y, r); p.closePath();
        break;
      }
      case 'ellipse': p.ellipse(0, 0, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2); break;
      case 'triangle': p.moveTo(0, -h / 2); p.lineTo(w / 2, h / 2); p.lineTo(-w / 2, h / 2); p.closePath(); break;
      case 'star': {
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1;
          const x = Math.cos(a) * r * (w / 2), y = Math.sin(a) * r * (h / 2);
          i ? p.lineTo(x, y) : p.moveTo(x, y);
        }
        p.closePath();
        break;
      }
      case 'line': p.moveTo(-w / 2, 0); p.lineTo(w / 2, 0); break;
      case 'arrow': {
        const hl = Math.min(h / 2, w * 0.4);
        p.moveTo(-w / 2, 0); p.lineTo(w / 2, 0);
        p.moveTo(w / 2 - hl, -hl * 0.75); p.lineTo(w / 2, 0); p.lineTo(w / 2 - hl, hl * 0.75);
        break;
      }
      default: p.rect(-w / 2, -h / 2, w, h);
    }
    return p;
  }

  // ------------------------------------------------------------------ zoom / fade / transition maths
  VE.zoomFactor = function (c, t) {
    const z = c.zoom;
    if (!z || z.type === 'none' || !z.amount) return 1;
    const zd = z.dur > 0 ? Math.min(z.dur, c.dur) : c.dur;
    const t0 = z.at === 'end' ? c.start + c.dur - zd : c.start;
    const p = clamp((t - t0) / zd, 0, 1);
    const e = (VE.ease[z.ease] || VE.ease.smooth)(p);
    const a = z.amount / 100;
    return z.type === 'in' ? 1 + a * e : 1 + a * (1 - e);
  };

  // khoảng thời gian hiệu dụng (gồm phần mở rộng của transition)
  function effSpan(c, cs) {
    cs = cs || VE.clipsOnTrack(c.trackId);
    const i = cs.indexOf(c);
    const prev = cs[i - 1], next = cs[i + 1];
    const inT = c.transIn && VE.adjacent(prev, c);
    const outT = next && next.transIn && VE.adjacent(c, next);
    const hs = inT ? VE.transHalf(prev, c) : 0;
    const he = outT ? VE.transHalf(c, next) : 0;
    return { s: c.start - hs, e: c.start + c.dur + he, hs, he, inT, outT, prev, next };
  }
  VE.effSpan = effSpan;

  function applyTrans(L, role, type, p, W, H) {
    const E2 = VE.ease, PI = Math.PI;
    const isIn = role === 'in';
    const hard = isIn ? p >= 0.5 : p < 0.5; // hiển thị khi chuyển "cắt cứng" ở giữa
    const mid = Math.sin(PI * p);
    const rectClip = (x, y, w, h2) => (ctx) => ctx.rect(x, y, w, h2);
    switch (type) {
      case 'dissolve': if (isIn) L.alpha *= p; break;
      case 'dipBlack': L.alpha *= isIn ? clamp(2 * p - 1, 0, 1) : clamp(1 - 2 * p, 0, 1); break;
      case 'dipWhite':
        L.alpha *= isIn ? clamp(2 * p - 1, 0, 1) : clamp(1 - 2 * p, 0, 1);
        if (isIn) L.overlay = { color: '#fff', alpha: 1 - Math.abs(2 * p - 1) };
        break;
      case 'flash':
        L.alpha *= hard ? 1 : 0;
        if (isIn) L.overlay = { color: '#fff', alpha: Math.pow(1 - Math.abs(2 * p - 1), 1.6) };
        break;
      case 'wipeRight': if (isIn) L.clipFn = rectClip(0, 0, W * p, H); break;
      case 'wipeLeft': if (isIn) L.clipFn = rectClip(W * (1 - p), 0, W * p, H); break;
      case 'wipeDown': if (isIn) L.clipFn = rectClip(0, 0, W, H * p); break;
      case 'wipeUp': if (isIn) L.clipFn = rectClip(0, H * (1 - p), W, H * p); break;
      case 'wipeDiag': if (isIn) {
        const sv = 2 * p;
        L.clipFn = (ctx) => {
          if (sv <= 1) { ctx.moveTo(0, 0); ctx.lineTo(W * sv, 0); ctx.lineTo(0, H * sv); } else { ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * (sv - 1)); ctx.lineTo(W * (sv - 1), H); ctx.lineTo(0, H); }
          ctx.closePath();
        };
      } break;
      case 'irisOpen': if (isIn) { const R = (Math.hypot(W, H) / 2) * E2.easeOut(p); L.clipFn = (ctx) => ctx.arc(W / 2, H / 2, Math.max(0.01, R), 0, PI * 2); } break;
      case 'clock': if (isIn) L.clipFn = (ctx) => { const R = Math.hypot(W, H); ctx.moveTo(W / 2, H / 2); ctx.lineTo(W / 2, H / 2 - R); ctx.arc(W / 2, H / 2, R, -PI / 2, -PI / 2 + p * PI * 2); ctx.closePath(); }; break;
      case 'blindsV': if (isIn) L.clipFn = (ctx) => { const n = 8; for (let i = 0; i < n; i++) ctx.rect((i * W) / n, 0, (W / n) * p + 0.5, H); }; break;
      case 'blindsH': if (isIn) L.clipFn = (ctx) => { const n = 10; for (let i = 0; i < n; i++) ctx.rect(0, (i * H) / n, W, (H / n) * p + 0.5); }; break;
      case 'splitH': if (isIn) L.clipFn = rectClip((W * (1 - p)) / 2, 0, W * p, H); break;
      case 'splitV': if (isIn) L.clipFn = rectClip(0, (H * (1 - p)) / 2, W, H * p); break;
      case 'slideLeft': if (isIn) { L.slideClip = true; L.dx = W * (1 - p); } break;
      case 'slideRight': if (isIn) { L.slideClip = true; L.dx = -W * (1 - p); } break;
      case 'slideUp': if (isIn) { L.slideClip = true; L.dy = H * (1 - p); } break;
      case 'slideDown': if (isIn) { L.slideClip = true; L.dy = -H * (1 - p); } break;
      case 'pushLeft': L.slideClip = true; L.dx = isIn ? W * (1 - p) : -W * p; break;
      case 'pushRight': L.slideClip = true; L.dx = isIn ? -W * (1 - p) : W * p; break;
      case 'pushUp': L.slideClip = true; L.dy = isIn ? H * (1 - p) : -H * p; break;
      case 'pushDown': L.slideClip = true; L.dy = isIn ? -H * (1 - p) : H * p; break;
      case 'whipLeft': L.slideClip = true; L.dx = isIn ? W * (1 - p) : -W * p; L.blur = 30 * mid; break;
      case 'whipRight': L.slideClip = true; L.dx = isIn ? -W * (1 - p) : W * p; L.blur = 30 * mid; break;
      case 'zoomIn':
        L.blur = 16 * mid;
        if (isIn) { L.scaleMul = lerp(1.9, 1, E2.easeOut(p)); L.alpha *= p; } else L.scaleMul = 1 + 0.9 * E2.easeIn(p);
        break;
      case 'zoomOut':
        if (isIn) { L.scaleMul = lerp(0.55, 1, E2.easeOut(p)); L.alpha *= p; } else L.scaleMul = 1 - 0.45 * E2.easeIn(p);
        break;
      case 'spin':
        if (isIn) { L.rotAdd = -50 * (1 - E2.easeOut(p)); L.scaleMul = lerp(1.7, 1, E2.easeOut(p)); L.alpha *= p; } else { L.rotAdd = 50 * E2.easeIn(p); L.scaleMul = 1 + 0.7 * p; }
        break;
      case 'flipH':
        L.alpha *= hard ? 1 : 0;
        L.flipX = isIn ? (p < 0.5 ? 0 : -Math.cos(PI * p)) : (p < 0.5 ? Math.cos(PI * p) : 0);
        break;
      case 'blur':
        L.blur = isIn ? 26 * (1 - E2.sine(p)) : 26 * E2.sine(p);
        if (isIn) L.alpha *= p;
        break;
      case 'glitch': L.alpha *= hard ? 1 : 0; L.glitch = Math.max(L.glitch, 1 - Math.abs(2 * p - 1)); break;
      case 'pixelate': L.alpha *= hard ? 1 : 0; L.pixel = Math.max(L.pixel, 1 - Math.abs(2 * p - 1)); break;
      case 'shake':
        if (isIn) L.alpha *= p;
        { const k = Math.floor(p * 36); L.dx += (VE.noise(k) - 0.5) * 70 * mid; L.dy += (VE.noise(k + 7) - 0.5) * 70 * mid; L.scaleMul *= 1 + 0.08 * mid; L.blur = Math.max(L.blur, 6 * mid); }
        break;
    }
  }

  // Danh sách layer hiển thị tại thời điểm t (dưới lên trên)
  VE.visibleLayers = function (t) {
    const out = [];
    const W = S.settings.width, H = S.settings.height;
    for (const tr of S.tracks) {
      if (tr.type !== 'video' || tr.hidden) continue;
      const cs = VE.clipsOnTrack(tr.id);
      for (const c of cs) {
        const sp = effSpan(c, cs);
        if (t < sp.s || t >= sp.e) continue;
        const s = c.start, e = c.start + c.dur;
        const L = { clip: c, alpha: c.opacity / 100, dx: 0, dy: 0, clipFn: null, overlay: null, scaleMul: 1, rotAdd: 0, blur: 0, flipX: 1, glitch: 0, pixel: 0 };
        if (!sp.inT && c.fadeIn > 0 && t < s + c.fadeIn) L.alpha *= clamp((t - s) / c.fadeIn, 0, 1);
        if (!sp.outT && c.fadeOut > 0 && t > e - c.fadeOut) L.alpha *= clamp((e - t) / c.fadeOut, 0, 1);
        if (sp.inT && t < s + sp.hs) applyTrans(L, 'in', c.transIn.type, clamp((t - (s - sp.hs)) / (2 * sp.hs), 0, 1), W, H);
        if (sp.outT && t >= e - sp.he) applyTrans(L, 'out', sp.next.transIn.type, clamp((t - (e - sp.he)) / (2 * sp.he), 0, 1), W, H);
        out.push(L);
      }
    }
    return out;
  };

  // Hệ số âm lượng của clip audio tại thời điểm t
  VE.audioGain = function (c, t, cs) {
    const tr = VE.track(c.trackId);
    if (!tr || tr.muted || c.muted) return 0;
    if (S.tracks.some((x) => x.type === 'audio' && x.solo) && !tr.solo) return 0;
    let g = c.volume / 100;
    const sp = effSpan(c, cs);
    const s = c.start, e = c.start + c.dur;
    if (!sp.inT && c.fadeIn > 0 && t < s + c.fadeIn) g *= clamp((t - s) / c.fadeIn, 0, 1);
    if (!sp.outT && c.fadeOut > 0 && t > e - c.fadeOut) g *= clamp((e - t) / c.fadeOut, 0, 1);
    if (sp.inT && t < s + sp.hs) g *= Math.sqrt(clamp((t - (s - sp.hs)) / (2 * sp.hs), 0, 1));
    if (sp.outT && t >= e - sp.he) g *= Math.sqrt(1 - clamp((t - (e - sp.he)) / (2 * sp.he), 0, 1));
    return g;
  };

  // ------------------------------------------------------------------ Player
  class Player {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.audioOut = opts.audioOut || null; // AudioNode đích (mặc định master của preview)
      this.outMode = opts.fit || 'fit'; // cách khớp khung khi kích thước canvas ≠ sequence
      this.slots = new Map();
      this.free = { v: [], a: [] };
      this.time = 0;
      this.playing = false;
      this.rate = 1;
      this.endTime = null;
      this.onTime = null;
      this.onEnd = null;
      this.silent = !!opts.silent;
      this._tick = this._tick.bind(this);
      this._dirty = false;
    }

    setSize(w, h) {
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
    }

    // ---- media slots
    _makeSlot(kind) {
      const el = document.createElement(kind === 'v' ? 'video' : 'audio');
      el.preload = 'auto';
      if (kind === 'v') { el.muted = true; el.playsInline = true; }
      const slot = { el, kind, clipId: null, mediaId: null, gain: null, node: null };
      if (kind === 'a') {
        const actx = VE.audio.ensure();
        slot.node = actx.createMediaElementSource(el);
        slot.gain = actx.createGain();
        slot.gain.gain.value = 0;
        slot.node.connect(slot.gain);
        slot.gain.connect(this.audioOut || VE.audio.master);
      }
      const dirty = () => this.markDirty();
      el.addEventListener('seeked', dirty);
      el.addEventListener('loadeddata', dirty);
      return slot;
    }
    acquire(kind, c) {
      let slot = this.slots.get(c.id);
      if (slot) return slot;
      const m = VE.getMedia(c.mediaId);
      if (!m) return null;
      const list = this.free[kind];
      let idx = list.findIndex((s) => s.mediaId === c.mediaId);
      slot = idx >= 0 ? list.splice(idx, 1)[0] : list.pop() || this._makeSlot(kind);
      if (slot.mediaId !== c.mediaId) {
        slot.el.src = m.url;
        slot.mediaId = c.mediaId;
      }
      slot.clipId = c.id;
      this.slots.set(c.id, slot);
      return slot;
    }
    _release(id) {
      const slot = this.slots.get(id);
      if (!slot) return;
      slot.el.pause();
      if (slot.gain) slot.gain.gain.value = 0;
      slot.clipId = null;
      this.slots.delete(id);
      this.free[slot.kind].push(slot);
    }
    dispose() {
      this.pause();
      Array.from(this.slots.keys()).forEach((id) => this._release(id));
      ['v', 'a'].forEach((k) => this.free[k].forEach((s) => {
        s.el.pause(); s.el.removeAttribute('src'); s.el.load();
        if (s.gain) { s.gain.disconnect(); s.node.disconnect(); }
      }));
      this.free = { v: [], a: [] };
    }

    _syncSlot(slot, c, t, active, span) {
      const m = VE.getMedia(c.mediaId);
      const el = slot.el;
      const md = m && isFinite(m.duration) ? m.duration : 1e9;
      const tt = clamp(t, span.s, span.e);
      const raw = c.in + (tt - c.start) * c.speed;
      const target = clamp(raw, 0, Math.max(0, md - 0.04));
      const rate = clamp(c.speed * this.rate, 0.0625, 16);
      if (Math.abs(el.playbackRate - rate) > 0.001) el.playbackRate = rate;
      const inRange = raw >= 0 && raw < md - 0.05;
      if (active && this.playing && inRange) {
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
          const p = el.play();
          if (p && p.catch) p.catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.002 && !(el.seeking && Math.abs((el._seekTo || 0) - target) < 0.002)) {
          el._seekTo = target;
          el.currentTime = target;
        }
      }
    }

    // đồng bộ tất cả element với thời gian t
    manage(t) {
      const look1 = t + (this.playing ? 1.5 : 0.3);
      const want = new Set();
      const byTrack = new Map();
      for (const c of S.clips) {
        if (!VE.isMediaClip(c)) continue;
        const tr = VE.track(c.trackId);
        if (!tr) continue;
        if (c.kind === 'video' && tr.hidden) continue;
        if (c.kind === 'audio' && this.silent) continue;
        let cs = byTrack.get(c.trackId);
        if (!cs) { cs = VE.clipsOnTrack(c.trackId); byTrack.set(c.trackId, cs); }
        const sp = effSpan(c, cs);
        const active = t >= sp.s && t < sp.e;
        if (!active && !(sp.s <= look1 && sp.e > t - 0.3)) continue;
        const kind = c.kind === 'video' ? 'v' : 'a';
        const slot = this.acquire(kind, c);
        if (!slot) continue;
        want.add(c.id);
        this._syncSlot(slot, c, t, active, sp);
        if (kind === 'a') {
          const g = active && this.playing ? VE.audioGain(c, t, cs) : 0;
          const ac = VE.audio.ctx;
          slot.gain.gain.setTargetAtTime(g, ac.currentTime, 0.008);
        }
      }
      Array.from(this.slots.keys()).forEach((id) => { if (!want.has(id)) this._release(id); });
    }

    markDirty() {
      if (this._dirty) return;
      this._dirty = true;
      requestAnimationFrame(() => { this._dirty = false; if (!this.playing) this.render(this.time); });
    }

    // ---- transport
    seek(t) {
      this.time = Math.max(0, t);
      if (this.playing) { this.t0 = this.time; this.w0 = performance.now(); }
      this.refresh();
    }
    refresh() { this.manage(this.time); this.render(this.time); }
    play() {
      if (this.playing) return;
      if (!this.silent) VE.audio.resume();
      const end = this.endTime != null ? this.endTime : VE.timelineEnd();
      if (this.time >= end - 0.02) this.time = this.startTime || 0;
      this.playing = true;
      this.t0 = this.time;
      this.w0 = performance.now();
      this.raf = requestAnimationFrame(this._tick);
    }
    pause() {
      if (!this.playing) return;
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.manage(this.time);
      this.render(this.time);
    }
    _tick() {
      if (!this.playing) return;
      let t = this.t0 + ((performance.now() - this.w0) / 1000) * this.rate;
      const end = this.endTime != null ? this.endTime : VE.timelineEnd();
      if (t >= end) {
        this.time = end;
        this.render(end);
        this.playing = false;
        this.manage(end);
        if (this.onTime) this.onTime(end);
        if (this.onEnd) this.onEnd();
        return;
      }
      this.time = t;
      this.manage(t);
      this.render(t);
      if (this.onTime) this.onTime(t);
      this.raf = requestAnimationFrame(this._tick);
    }

    // chờ các video đang hiển thị sẵn sàng khung hình (dùng khi export)
    async preroll() {
      this.manage(this.time);
      const waits = [];
      for (const slot of this.slots.values()) {
        const el = slot.el;
        if (!el.seeking && el.readyState >= 2) continue;
        waits.push(new Promise((res) => {
          const done = () => { if (!el.seeking && el.readyState >= 2) { cleanup(); res(); } };
          const cleanup = () => ['seeked', 'canplay', 'loadeddata'].forEach((e) => el.removeEventListener(e, done));
          ['seeked', 'canplay', 'loadeddata'].forEach((e) => el.addEventListener(e, done));
          setTimeout(() => { cleanup(); res(); }, 5000);
        }));
      }
      await Promise.all(waits);
      this.render(this.time);
    }

    // ---- drawing
    render(t) {
      if (t == null) t = this.time;
      const ctx = this.ctx;
      const W = S.settings.width, H = S.settings.height;
      const cw = this.canvas.width, ch = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      let sx = cw / W, sy = ch / H, ox = 0, oy = 0;
      if (this.outMode !== 'stretch') {
        const s = this.outMode === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy);
        sx = sy = s;
        ox = (cw - W * s) / 2;
        oy = (ch - H * s) / 2;
      }
      ctx.save();
      ctx.setTransform(sx, 0, 0, sy, ox, oy);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      ctx.fillStyle = S.settings.bg;
      ctx.fillRect(0, 0, W, H);
      let pixel = 0;
      for (const L of VE.visibleLayers(t)) { this._drawLayer(ctx, L, t, W, H); if (L.pixel > pixel) pixel = L.pixel; }
      ctx.restore();
      if (pixel > 0.03) {
        const f = 1 + pixel * 38;
        const sw = Math.max(4, Math.round(cw / f)), sh = Math.max(4, Math.round(ch / f));
        if (!this._tmp) this._tmp = document.createElement('canvas');
        const tc = this._tmp;
        if (tc.width !== sw || tc.height !== sh) { tc.width = sw; tc.height = sh; }
        const tctx = tc.getContext('2d');
        tctx.globalCompositeOperation = 'copy';
        tctx.drawImage(this.canvas, 0, 0, sw, sh);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tc, 0, 0, cw, ch);
        ctx.imageSmoothingEnabled = true;
      }
    }

    _blurBackdrop(ctx, alpha, amt) {
      const cw = this.canvas.width, ch = this.canvas.height;
      const k = 6 + 14 * clamp(amt, 0, 1);
      const sw = Math.max(8, Math.round(cw / k)), sh = Math.max(8, Math.round(ch / k));
      if (!this._tmp) this._tmp = document.createElement('canvas');
      const tc = this._tmp;
      if (tc.width !== sw || tc.height !== sh) { tc.width = sw; tc.height = sh; }
      const tctx = tc.getContext('2d');
      tctx.globalCompositeOperation = 'copy';
      tctx.drawImage(this.canvas, 0, 0, sw, sh);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tc, 0, 0, cw, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    _drawLayer(ctx, L, t, W, H) {
      const c = L.clip;
      const A = VE.animState(c, t, W, H);
      const alpha = L.alpha * A.alpha;
      if (alpha > 0.001) {
        ctx.save();
        if (L.clipFn) { ctx.beginPath(); L.clipFn(ctx); ctx.clip(); }
        if (L.slideClip) { ctx.beginPath(); ctx.rect(L.dx, L.dy, W, H); ctx.clip(); } // hình trượt theo đúng khung, không tràn ra ngoài
        if (c.card && c.card.blurBg > 0) this._blurBackdrop(ctx, alpha, c.card.blurBg / 100);
        ctx.globalAlpha = clamp(alpha, 0, 1);
        const px = this.canvas.width / W;
        const blur = (L.blur + A.blur) * px;
        if (blur > 0.3) ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
        const box = VE.clipBox(c);
        const zm = VE.zoomFactor(c, t);
        const draw = (extraDx) => {
          ctx.save();
          ctx.translate(W / 2 + c.x + L.dx + A.dx + extraDx, H / 2 + c.y + L.dy + A.dy);
          const rot = c.rot + L.rotAdd + A.rot;
          if (rot) ctx.rotate((rot * Math.PI) / 180);
          const sc = (c.scale / 100) * L.scaleMul * A.scale;
          if (L.flipX !== 1) ctx.scale(Math.max(0.001, L.flipX), 1);
          ctx.scale(sc, sc);
          if (zm !== 1) {
            const fx = ((c.zoom.fx || 0) / 100) * box.w, fy = ((c.zoom.fy || 0) / 100) * box.h;
            ctx.translate(fx, fy); ctx.scale(zm, zm); ctx.translate(-fx, -fy);
          }
          this._drawContent(ctx, c, box, t, A);
          ctx.restore();
        };
        if (L.glitch > 0.02) {
          const n = 9, seed = Math.floor(t * 30);
          for (let i = 0; i < n; i++) {
            ctx.save();
            ctx.beginPath(); ctx.rect(0, (H * i) / n, W, H / n + 1); ctx.clip();
            draw((VE.noise(i * 3.7 + seed * 11) - 0.5) * L.glitch * W * 0.16);
            ctx.restore();
          }
        } else draw(0);
        ctx.restore();
      }
      if (L.overlay) {
        ctx.save();
        ctx.globalAlpha = clamp(L.overlay.alpha, 0, 1);
        ctx.fillStyle = L.overlay.color;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    _drawContent(ctx, c, box, t, A) {
      if (c.kind === 'video' || c.kind === 'image') {
        let src = null;
        if (c.kind === 'video') {
          let slot = this.slots.get(c.id);
          if (!slot) slot = this.acquire('v', c);
          if (slot && slot.el.readyState >= 2) src = slot.el;
        } else {
          const m = VE.getMedia(c.mediaId);
          if (m && m.img) src = m.img;
        }
        if (!src) return;
        const cd = c.card;
        if (!cd) { ctx.drawImage(src, -box.w / 2, -box.h / 2, box.w, box.h); return; }
        const k = 100 / Math.max(1, c.scale);
        const r = (cd.radius || 0) * k;
        const path = () => {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(-box.w / 2, -box.h / 2, box.w, box.h, r); else ctx.rect(-box.w / 2, -box.h / 2, box.w, box.h);
        };
        if (cd.shadow) {
          ctx.save(); path();
          ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40 * k; ctx.shadowOffsetY = 12 * k;
          ctx.fillStyle = '#000'; ctx.fill();
          ctx.restore();
        }
        ctx.save(); path(); ctx.clip();
        ctx.drawImage(src, -box.w / 2, -box.h / 2, box.w, box.h);
        ctx.restore();
        if (cd.bw > 0) { path(); ctx.lineWidth = cd.bw * k; ctx.strokeStyle = cd.border || '#f5a524'; ctx.stroke(); }
      } else if (c.kind === 'text') this._drawText(ctx, c, t, A);
      else if (c.kind === 'shape') this._drawShape(ctx, c);
    }

    _drawText(ctx, c, t, A) {
      const tx = c.text, L = textLayout(c);
      ctx.font = fontStr(tx);
      if ('letterSpacing' in ctx) ctx.letterSpacing = (tx.letterSp || 0) + 'px';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      if (tx.bgOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= tx.bgOpacity / 100;
        ctx.fillStyle = tx.bg;
        const r = Math.min(tx.bgRadius || 0, L.boxW / 2, L.boxH / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-L.boxW / 2, -L.boxH / 2, L.boxW, L.boxH, r);
        else ctx.rect(-L.boxW / 2, -L.boxH / 2, L.boxW, L.boxH);
        ctx.fill();
        ctx.restore();
      }
      if (A.echo) {
        const e = VE.ease.easeOut(clamp(A.rel / 0.5, 0, 1));
        for (let k = 6; k >= 1; k--) {
          const sg = k % 2 ? -1 : 1;
          ctx.save();
          ctx.translate(sg * k * tx.size * 0.26 * e, sg * k * tx.size * 0.11 * e * (k % 3 === 0 ? -1 : 1));
          ctx.rotate((sg * (5 + k * 4) * e * Math.PI) / 180);
          const sc = 1 - k * 0.09;
          ctx.scale(sc, sc);
          ctx.globalAlpha *= Math.max(0, 0.6 - k * 0.08) * e;
          this._textPass(ctx, c, L, t, { unit: null, wave: false, rel: A.rel }, true);
          ctx.restore();
        }
      }
      this._textPass(ctx, c, L, t, A, false);
    }

    _fillToken(ctx, tx, s, x, y, col) {
      if (tx.strokeW > 0) {
        ctx.lineWidth = tx.strokeW * 2; ctx.strokeStyle = tx.stroke; ctx.lineJoin = 'round';
        ctx.strokeText(s, x, y);
      }
      if (tx.shadow) { ctx.shadowColor = tx.shadowColor; ctx.shadowBlur = tx.shadowBlur; ctx.shadowOffsetY = Math.round(tx.size * 0.04); }
      ctx.fillStyle = col;
      ctx.fillText(s, x, y);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }

    _textPass(ctx, c, L, t, A, ghost) {
      const tx = c.text, rel = t - c.start, size = tx.size;
      const y0 = -L.boxH / 2 + (tx.bgPad || 0) + (L.lh - size) / 2;
      const perChar = !!A.unit || A.wave;
      const mode = A.unit ? A.unit.mode : null;
      let nUnits = 0;
      if (A.unit) L.lines.forEach((l) => l.toks.forEach((tok) => { if (!isSp(tok.s)) nUnits += mode === 'wordPop' ? 1 : [...tok.s].length; }));
      const hlCol = tx.hlColor || '#ffffff', hlBg = tx.hlBg || '#f59e0b';
      const hp = tx.hlAnim === false ? 1 : VE.ease.easeOut(clamp((rel - 0.1) / 0.3, 0, 1));
      let idx = 0;
      L.lines.forEach((line, li) => {
        const y = y0 + li * L.lh;
        const x0 = tx.align === 'left' ? -L.w / 2 : tx.align === 'right' ? L.w / 2 - line.w : -line.w / 2;
        if (!ghost) {
          // khung highlight nằm dưới chữ
          let gx = null, cx = x0;
          const flush = (endX) => {
            if (gx == null) return;
            const pad = tx.hlPad || 0, w = (endX - gx + pad * 2) * hp;
            ctx.save();
            ctx.globalAlpha *= (tx.hlOpacity == null ? 100 : tx.hlOpacity) / 100;
            ctx.fillStyle = hlBg;
            ctx.beginPath();
            const bh = size * 1.22, by = y + size / 2 - bh / 2;
            if (ctx.roundRect) ctx.roundRect(gx - pad, by, w, bh, Math.min(tx.hlRadius || 0, bh / 2)); else ctx.rect(gx - pad, by, w, bh);
            ctx.fill();
            ctx.restore();
            gx = null;
          };
          line.toks.forEach((tok) => { if (tok.hl) { if (gx == null) gx = cx; } else flush(cx); cx += tok.w; });
          flush(cx);
        }
        let cx = x0;
        line.toks.forEach((tok) => {
          const sp = isSp(tok.s);
          const col = tok.hl ? hlCol : tx.color;
          if (sp) { cx += tok.w; return; }
          if (!perChar) { this._fillToken(ctx, tx, tok.s, cx, y, col); cx += tok.w; return; }
          const drawUnit = (str, ux, n, isChar) => {
            let a = 1, dy = 0, sc = 1;
            const p = A.unit ? A.unit.p : 1;
            const u = nUnits > 1 ? idx / nUnits : 0;
            if (mode === 'typewriter') a = idx < Math.ceil(p * nUnits) ? 1 : 0;
            else if (mode === 'letterWave') { const lp = clamp((p - u * 0.6) / 0.4, 0, 1); dy -= (1 - VE.ease.bounce(lp)) * size * 0.9; a = clamp(lp * 5, 0, 1); }
            else if (mode === 'letterPop' || mode === 'wordPop') { const lp = clamp((p - u * 0.6) / 0.4, 0, 1); sc = Math.max(0, VE.ease.outBack(lp)); a = clamp(lp * 4, 0, 1); }
            if (A.wave) dy += Math.sin((rel * 1.3 - idx * 0.14) * Math.PI * 2) * size * 0.12;
            idx++;
            if (a <= 0.001) return;
            const w = ctx.measureText(str).width;
            ctx.save();
            ctx.globalAlpha *= a;
            ctx.translate(ux + w / 2, y + size / 2 + dy);
            if (sc !== 1) ctx.scale(sc, sc);
            this._fillToken(ctx, tx, str, -w / 2, -size / 2, col);
            ctx.restore();
            return w;
          };
          if (mode === 'wordPop') { drawUnit(tok.s, cx, 1, false); cx += tok.w; return; }
          for (const ch of tok.s) { const w = ctx.measureText(ch).width; drawUnit(ch, cx, 1, true); cx += w; }
        });
      });
    }

    _drawShape(ctx, c) {
      const s = c.shape;
      const path = shapePath(s);
      const strokeOnly = s.type === 'line' || s.type === 'arrow';
      if (!strokeOnly && s.fillOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= s.fillOpacity / 100;
        ctx.fillStyle = s.fill;
        ctx.fill(path);
        ctx.restore();
      }
      const sw = strokeOnly ? Math.max(1, s.strokeW) : s.strokeW;
      if (sw > 0) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = strokeOnly && !s.strokeW ? s.fill : s.stroke;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(path);
      }
    }

    // chọn clip visual trên cùng tại điểm (px,py) toạ độ sequence
    hitTest(px, py, t) {
      const W = S.settings.width, H = S.settings.height;
      const layers = VE.visibleLayers(t);
      for (let i = layers.length - 1; i >= 0; i--) {
        const L = layers[i], c = L.clip;
        if (L.alpha <= 0.01) continue;
        const box = VE.clipBox(c);
        let x = px - (W / 2 + c.x + L.dx), y = py - (H / 2 + c.y + L.dy);
        const a = (-c.rot * Math.PI) / 180;
        const rx = x * Math.cos(a) - y * Math.sin(a), ry = x * Math.sin(a) + y * Math.cos(a);
        const sc = c.scale / 100;
        if (Math.abs(rx / sc) <= box.w / 2 && Math.abs(ry / sc) <= box.h / 2) return c;
      }
      return null;
    }
  }

  VE.Player = Player;
})();
