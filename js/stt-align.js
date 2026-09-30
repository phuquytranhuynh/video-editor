/* Căn thời gian phụ đề: dùng khoảng lặng thật của audio để sửa mốc thời gian thô của Whisper,
   rồi chia văn bản thành các caption ngắn. Thuần logic (không phụ thuộc giao diện) nên kiểm thử được bằng Node. */
(function (root) {
  const AL = {};

  // ---- dò đoạn có tiếng (VAD) từ mẫu 16kHz mono. Trả về [[start,end],...] (giây, tương đối đầu mẫu)
  AL.vadSpans = function (samples, sr, opt) {
    opt = Object.assign({ frame: 0.02, mergeGap: 0.18, minSpan: 0.08 }, opt || {});
    const fl = Math.max(1, Math.round(sr * opt.frame));
    const n = Math.floor(samples.length / fl);
    const en = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * fl; j < (i + 1) * fl; j++) s += samples[j] * samples[j]; en[i] = Math.sqrt(s / fl); }
    const sorted = Array.from(en).sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(n - 1, Math.floor(n * p))] || 0;
    const noise = Math.max(1e-4, q(0.12)), speech = Math.max(noise * 2, q(0.92));
    const th = opt.th != null ? opt.th : Math.min(0.2, Math.max(0.003, noise * Math.pow(speech / noise, 0.32)));
    const spans = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      if (en[i] > th) { if (cur && (i - cur[1]) * opt.frame > opt.mergeGap) { spans.push(cur); cur = null; } if (!cur) cur = [i, i]; cur[1] = i; }
    }
    if (cur) spans.push(cur);
    return spans.map(([a, b]) => [a * opt.frame, (b + 1) * opt.frame]).filter(([a, b]) => b - a >= opt.minSpan);
  };

  const CJK = /[぀-ヿ㐀-鿿가-힯]/;
  const SENT_END = /[.!?…。！？]["')\]]*$/;
  const SOFT_END = /[,;:，、；：]["')\]]*$/;

  function splitWords(text) {
    const t = text.trim();
    const ws = t.split(/\s+/).filter(Boolean);
    if (ws.length <= 1 && CJK.test(t) && t.length > 6) return { words: Array.from(t.replace(/\s+/g, '')), noSpace: true };
    return { words: ws, noSpace: false };
  }

  // thời gian trên trục "chỉ tính lúc có tiếng": p (0..L) → giây thật
  function mapActive(spans, p) {
    let acc = 0;
    for (const [a, b] of spans) {
      const len = b - a;
      if (p <= acc + len + 1e-9) return a + Math.max(0, p - acc);
      acc += len;
    }
    const last = spans[spans.length - 1];
    return last[1];
  }

  // chunks: [{text,start,end}] từ Whisper · spans: VAD · o: {maxWords,maxDur,minDur}
  AL.align = function (chunks, spans, o) {
    o = Object.assign({ maxWords: 5, maxDur: 3.2, minDur: 0.5, snapRange: 1.6 }, o || {});
    const segs = chunks.map((c) => ({ text: String(c.text).trim(), s: c.start, e: Math.max(c.end, c.start + 0.1) })).filter((c) => c.text);
    if (!segs.length || !spans.length) return [];
    const gaps = [];
    for (let i = 0; i + 1 < spans.length; i++) if (spans[i + 1][0] - spans[i][1] >= 0.2) gaps.push((spans[i][1] + spans[i + 1][0]) / 2);
    const activeIn = (lo, hi) => spans.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b - a > 1e-3);
    const start0 = spans[0][0], end0 = spans[spans.length - 1][1];
    // ranh giới giữa các đoạn: lấy mốc Whisper rồi hút vào khoảng lặng gần nhất
    const bounds = [start0];
    for (let i = 0; i + 1 < segs.length; i++) {
      let b = (segs[i].e + segs[i + 1].s) / 2;
      let best = null, bd = o.snapRange;
      gaps.forEach((m) => { const d = Math.abs(m - b); if (d < bd && m > bounds[bounds.length - 1] + 0.3 && m < end0 - 0.3) { bd = d; best = m; } });
      if (best != null) b = best;
      b = Math.min(Math.max(b, bounds[bounds.length - 1] + 0.05), end0);
      bounds.push(b);
    }
    bounds.push(end0);
    const words = []; // {w, s, e, brk}
    segs.forEach((seg, i) => {
      const act = activeIn(bounds[i], bounds[i + 1]);
      const L = act.reduce((a, [x, y]) => a + (y - x), 0);
      if (L < 0.15) return; // không có tiếng: bỏ (thường là ảo giác của Whisper)
      const { words: ws } = splitWords(seg.text);
      const wt = ws.map((w) => w.length + 0.6 + (SENT_END.test(w) ? 1.2 : SOFT_END.test(w) ? 0.6 : 0));
      const tot = wt.reduce((a, b) => a + b, 0);
      let cum = 0;
      ws.forEach((w, k) => {
        const s = mapActive(act, (cum / tot) * L);
        cum += wt[k];
        const e = mapActive(act, (cum / tot) * L);
        words.push({ w, s, e, seg: i });
      });
    });
    if (!words.length) return [];
    const { noSpace } = splitWords(segs.map((s) => s.text).join(' '));
    const join = (arr) => arr.map((x) => x.w).join(noSpace ? '' : ' ');
    // gom từ thành caption
    const groups = [];
    let cur = [];
    words.forEach((wd, k) => {
      cur.push(wd);
      const next = words[k + 1];
      const dur = wd.e - cur[0].s;
      const gap = next ? next.s - wd.e : 9;
      const cjkMax = noSpace ? o.maxWords * 2 : o.maxWords;
      const brk = !next || cur.length >= cjkMax || dur >= o.maxDur || gap > 0.45 || (SENT_END.test(wd.w) && cur.length >= 2) || (SOFT_END.test(wd.w) && cur.length >= Math.ceil(cjkMax * 0.7)) || (next && next.seg !== wd.seg && cur.length >= 2);
      if (brk) { groups.push(cur); cur = []; }
    });
    // tránh caption chỉ có 1 từ lẻ ở cuối
    for (let i = groups.length - 1; i > 0; i--) {
      if (groups[i].length === 1 && groups[i - 1].length < o.maxWords + 1 && groups[i][0].s - groups[i - 1][groups[i - 1].length - 1].e < 0.4 && groups[i - 1][0].seg === groups[i][0].seg) { groups[i - 1] = groups[i - 1].concat(groups[i]); groups.splice(i, 1); }
    }
    const items = groups.map((g) => ({ start: g[0].s, end: g[g.length - 1].e, text: join(g) }));
    // giữ caption thêm chút sau khi nói xong, không chồng lấn, tối thiểu minDur
    items.forEach((it, i) => {
      const nextStart = i + 1 < items.length ? items[i + 1].start : Infinity;
      let end = Math.max(it.end + 0.2, it.start + o.minDur);
      end = Math.min(end, nextStart - 0.02);
      if (end < it.end) end = it.end;
      it.dur = Math.max(0.15, end - it.start);
      delete it.end;
    });
    return items;
  };


  // Chia audio thành các cụm câu nói: nối các đoạn có tiếng cách nhau < gap giây, mỗi cụm dài tối đa max giây.
  // Trả về [{s,e,spans}] (giây tuyệt đối; s/e đã cộng đệm pad, spans là các đoạn có tiếng nằm trong cụm)
  AL.windows = function (spans, o) {
    o = Object.assign({ gap: 0.7, max: 28, pad: 0.25, minLen: 0.35, total: Infinity }, o || {});
    const groups = [];
    spans.forEach((sp) => {
      const last = groups[groups.length - 1];
      if (last && sp[0] - last.spans[last.spans.length - 1][1] < o.gap && sp[1] - last.spans[0][0] <= o.max) last.spans.push(sp);
      else groups.push({ spans: [sp] });
    });
    return groups
      .map((g) => ({ s: Math.max(0, g.spans[0][0] - o.pad), e: Math.min(o.total, g.spans[g.spans.length - 1][1] + o.pad), spans: g.spans }))
      .filter((w) => w.spans.reduce((a, [x, y]) => a + (y - x), 0) >= o.minLen);
  };

  AL.toSrt = function (items) {
    const tc = (t) => { t = Math.max(0, t); const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return p(h) + ':' + p(m) + ':' + p(s) + ',' + p(ms % 1000, 3); };
    return items.map((it, i) => (i + 1) + '\n' + tc(it.start) + ' --> ' + tc(it.start + it.dur) + '\n' + it.text.replace(/\*/g, '') + '\n').join('\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AL;
  else (root.VE = root.VE || {}).align = AL;
})(typeof window !== 'undefined' ? window : globalThis);
