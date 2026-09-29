/* Engine phát & dựng hình: ghép layer bằng Canvas 2D, trộn audio bằng WebAudio */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const { clamp } = VE;

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

  function textLayout(c) {
    const t = c.text;
    const key = JSON.stringify([t.content, t.font, t.size, t.weight, t.italic, t.wrapW, t.lineH, t.letterSp, t.bgPad]);
    const hit = textCache.get(c);
    if (hit && hit.key === key) return hit;
    measCtx.font = fontStr(t);
    if ('letterSpacing' in measCtx) measCtx.letterSpacing = (t.letterSp || 0) + 'px';
    let lines = [];
    String(t.content).split('\n').forEach((para) => {
      if (t.wrapW > 0) {
        let cur = '';
        para.split(/(\s+)/).forEach((w) => {
          const test = cur + w;
          if (cur && measCtx.measureText(test.trimEnd()).width > t.wrapW) { lines.push(cur.trimEnd()); cur = w.trimStart(); } else cur = test;
        });
        lines.push(cur.trimEnd());
      } else lines.push(para);
    });
    const lh = t.size * t.lineH;
    const w = t.wrapW > 0 ? t.wrapW : Math.max(10, ...lines.map((l) => measCtx.measureText(l).width));
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
    switch (type) {
      case 'dissolve': if (role === 'in') L.alpha *= p; break;
      case 'dipBlack': L.alpha *= role === 'in' ? clamp(2 * p - 1, 0, 1) : clamp(1 - 2 * p, 0, 1); break;
      case 'dipWhite':
        L.alpha *= role === 'in' ? clamp(2 * p - 1, 0, 1) : clamp(1 - 2 * p, 0, 1);
        if (role === 'in') L.overlay = { color: '#fff', alpha: 1 - Math.abs(2 * p - 1) };
        break;
      case 'wipeRight': if (role === 'in') L.wipe = [0, 0, W * p, H]; break;
      case 'wipeLeft': if (role === 'in') L.wipe = [W * (1 - p), 0, W * p, H]; break;
      case 'wipeDown': if (role === 'in') L.wipe = [0, 0, W, H * p]; break;
      case 'wipeUp': if (role === 'in') L.wipe = [0, H * (1 - p), W, H * p]; break;
      case 'slideLeft': if (role === 'in') L.dx = W * (1 - p); break;
      case 'slideRight': if (role === 'in') L.dx = -W * (1 - p); break;
      case 'pushLeft': L.dx = role === 'in' ? W * (1 - p) : -W * p; break;
      case 'pushRight': L.dx = role === 'in' ? -W * (1 - p) : W * p; break;
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
        const L = { clip: c, alpha: c.opacity / 100, dx: 0, dy: 0, wipe: null, overlay: null };
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
      for (const L of VE.visibleLayers(t)) this._drawLayer(ctx, L, t, W, H);
      ctx.restore();
    }

    _drawLayer(ctx, L, t, W, H) {
      const c = L.clip;
      if (L.alpha > 0.001) {
        ctx.save();
        if (L.wipe) { ctx.beginPath(); ctx.rect(L.wipe[0], L.wipe[1], L.wipe[2], L.wipe[3]); ctx.clip(); }
        ctx.globalAlpha = clamp(L.alpha, 0, 1);
        ctx.translate(W / 2 + c.x + L.dx, H / 2 + c.y + L.dy);
        if (c.rot) ctx.rotate((c.rot * Math.PI) / 180);
        const sc = c.scale / 100;
        ctx.scale(sc, sc);
        const box = VE.clipBox(c);
        const zm = VE.zoomFactor(c, t);
        if (zm !== 1) {
          const fx = ((c.zoom.fx || 0) / 100) * box.w, fy = ((c.zoom.fy || 0) / 100) * box.h;
          ctx.translate(fx, fy); ctx.scale(zm, zm); ctx.translate(-fx, -fy);
        }
        this._drawContent(ctx, c, box);
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

    _drawContent(ctx, c, box) {
      if (c.kind === 'video') {
        let slot = this.slots.get(c.id);
        if (!slot) slot = this.acquire('v', c);
        if (slot && slot.el.readyState >= 2) ctx.drawImage(slot.el, -box.w / 2, -box.h / 2, box.w, box.h);
      } else if (c.kind === 'image') {
        const m = VE.getMedia(c.mediaId);
        if (m && m.img) ctx.drawImage(m.img, -box.w / 2, -box.h / 2, box.w, box.h);
      } else if (c.kind === 'text') this._drawText(ctx, c);
      else if (c.kind === 'shape') this._drawShape(ctx, c);
    }

    _drawText(ctx, c) {
      const t = c.text, L = textLayout(c);
      ctx.font = fontStr(t);
      if ('letterSpacing' in ctx) ctx.letterSpacing = (t.letterSp || 0) + 'px';
      ctx.textBaseline = 'top';
      ctx.textAlign = t.align;
      if (t.bgOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= t.bgOpacity / 100;
        ctx.fillStyle = t.bg;
        const r = Math.min(t.bgRadius || 0, L.boxW / 2, L.boxH / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-L.boxW / 2, -L.boxH / 2, L.boxW, L.boxH, r);
        else ctx.rect(-L.boxW / 2, -L.boxH / 2, L.boxW, L.boxH);
        ctx.fill();
        ctx.restore();
      }
      const x = t.align === 'left' ? -L.w / 2 : t.align === 'right' ? L.w / 2 : 0;
      const y0 = -L.boxH / 2 + (t.bgPad || 0) + (L.lh - t.size) / 2;
      L.lines.forEach((line, i) => {
        const y = y0 + i * L.lh;
        if (t.strokeW > 0) {
          ctx.lineWidth = t.strokeW * 2;
          ctx.strokeStyle = t.stroke;
          ctx.lineJoin = 'round';
          ctx.strokeText(line, x, y);
        }
        if (t.shadow) { ctx.shadowColor = t.shadowColor; ctx.shadowBlur = t.shadowBlur; ctx.shadowOffsetY = Math.round(t.size * 0.04); }
        ctx.fillStyle = t.color;
        ctx.fillText(line, x, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
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
