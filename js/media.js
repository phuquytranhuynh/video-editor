/* Nhập & quản lý media: metadata, thumbnail, waveform */
(function () {
  const VE = window.VE;
  const S = VE.state;

  const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i;
  const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

  function kindOf(f) {
    if (f.type.startsWith('video/')) return 'video';
    if (f.type.startsWith('audio/')) return 'audio';
    if (f.type.startsWith('image/')) return 'image';
    if (VIDEO_EXT.test(f.name)) return 'video';
    if (AUDIO_EXT.test(f.name)) return 'audio';
    if (IMAGE_EXT.test(f.name)) return 'image';
    return null;
  }

  function loadMeta(kind, url) {
    return new Promise((resolve, reject) => {
      if (kind === 'image') {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, duration: Infinity, img });
        img.onerror = () => reject(new Error('Không đọc được ảnh'));
        img.src = url;
        return;
      }
      const el = document.createElement(kind === 'video' ? 'video' : 'audio');
      el.preload = 'metadata';
      el.muted = true;
      const t = setTimeout(() => reject(new Error('Hết thời gian đọc metadata')), 20000);
      el.onloadedmetadata = () => {
        const done = () => { clearTimeout(t); resolve({ width: el.videoWidth || 0, height: el.videoHeight || 0, duration: el.duration }); };
        if (isFinite(el.duration)) return done();
        // WebM thiếu metadata thời lượng (vd. file từ MediaRecorder): tua tới cuối để trình duyệt tính ra
        el.ondurationchange = () => { if (isFinite(el.duration)) { el.ondurationchange = null; el.currentTime = 0; done(); } };
        el.currentTime = 1e7;
      };
      el.onerror = () => { clearTimeout(t); reject(new Error('Trình duyệt không hỗ trợ định dạng/codec này')); };
      el.src = url;
    });
  }

  // Giải mã audio để lấy waveform + biết có audio hay không
  async function analyseAudio(file, duration) {
    const PPS = 60; // số mẫu peak mỗi giây
    try {
      if (file.size > 600e6) return { hasAudio: true, peaks: null };
      const ab = await file.arrayBuffer();
      const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
      const buf = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
      const n = Math.max(1, Math.ceil(buf.duration * PPS));
      const peaks = new Float32Array(n);
      const chs = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
      const per = buf.length / n;
      for (let i = 0; i < n; i++) {
        const a = Math.floor(i * per), b = Math.min(buf.length, Math.floor((i + 1) * per));
        let mx = 0;
        const step = Math.max(1, Math.floor((b - a) / 64));
        for (const d of chs) for (let j = a; j < b; j += step) { const v = Math.abs(d[j]); if (v > mx) mx = v; }
        peaks[i] = mx;
      }
      return { hasAudio: true, peaks, peakPps: PPS };
    } catch (e) {
      return { hasAudio: false, peaks: null };
    }
  }

  function grabFrame(video, t, W) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish(null), 4000);
      video.onseeked = () => {
        clearTimeout(timer);
        try {
          const H = Math.max(1, Math.round((W * video.videoHeight) / video.videoWidth));
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          cv.getContext('2d').drawImage(video, 0, 0, W, H);
          const img = new Image();
          img.onload = () => finish({ t, img, url: cv.toDataURL('image/jpeg', 0.6) });
          img.src = cv.toDataURL('image/jpeg', 0.6);
        } catch (e) { finish(null); }
      };
      video.currentTime = t;
    });
  }

  async function makeThumbs(m) {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = m.url;
    await new Promise((r) => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 6000); });
    if (!v.videoWidth) return;
    const first = await grabFrame(v, Math.min(m.duration * 0.05, 0.5), 160);
    if (first) { m.thumb = first.url; m.thumbs = [first]; VE.emit('media'); }
    const n = Math.min(40, Math.max(2, Math.ceil(m.duration / 2)));
    const thumbs = [];
    for (let i = 0; i < n; i++) {
      const t = Math.min(m.duration - 0.05, (i + 0.5) * (m.duration / n));
      const th = await grabFrame(v, Math.max(0, t), 160);
      if (th) thumbs.push(th);
      if (m.removed) break;
    }
    if (thumbs.length) { m.thumbs = thumbs; VE.emit('media'); VE.emit('thumbs'); }
    v.removeAttribute('src'); v.load();
  }

  VE.importFiles = async function (files) {
    files = Array.from(files || []);
    let added = 0;
    for (const f of files) {
      const kind = kindOf(f);
      if (!kind) { VE.toast('Bỏ qua file không hỗ trợ: ' + f.name); continue; }
      const url = URL.createObjectURL(f);
      try {
        const meta = await loadMeta(kind, url);
        const m = {
          id: VE.uid(), name: f.name, kind, file: f, url,
          duration: meta.duration, width: meta.width, height: meta.height,
          hasAudio: kind === 'audio', peaks: null, thumb: null, thumbs: [], img: meta.img || null,
          size: f.size, markIn: null, markOut: null,
        };
        if (kind === 'image') m.thumb = url;
        S.mediaStore.set(m.id, m);
        S.media.push(m);
        added++;
        VE.emit('media');
        VE.emit('mediaAdded', m);
        if (kind === 'video') {
          makeThumbs(m);
          analyseAudio(f, m.duration).then((a) => { m.hasAudio = a.hasAudio; m.peaks = a.peaks; m.peakPps = a.peakPps; VE.emit('media'); VE.emit('thumbs'); });
        } else if (kind === 'audio') {
          analyseAudio(f, m.duration).then((a) => { m.peaks = a.peaks; m.peakPps = a.peakPps; VE.emit('thumbs'); });
        }
      } catch (err) {
        URL.revokeObjectURL(url);
        VE.toast('Không nhập được "' + f.name + '": ' + err.message, 4500);
      }
    }
    return added;
  };

  // Khôi phục media từ Blob (persist)
  VE.restoreMedia = async function (rec) {
    const file = new File([rec.blob], rec.name, { type: rec.type });
    const url = URL.createObjectURL(file);
    const meta = await loadMeta(rec.kind, url);
    const m = {
      id: rec.id, name: rec.name, kind: rec.kind, file, url,
      duration: meta.duration, width: meta.width, height: meta.height,
      hasAudio: rec.hasAudio, peaks: null, thumb: rec.kind === 'image' ? url : null, thumbs: [], img: meta.img || null,
      size: file.size, markIn: rec.markIn, markOut: rec.markOut,
    };
    S.mediaStore.set(m.id, m);
    S.media.push(m);
    if (rec.kind === 'video') makeThumbs(m);
    if (rec.kind !== 'image') analyseAudio(file, m.duration).then((a) => { m.peaks = a.peaks; m.peakPps = a.peakPps; VE.emit('thumbs'); });
    return m;
  };

  VE.removeMedia = function (id) {
    const m = VE.getMedia(id);
    if (!m) return;
    const used = S.clips.filter((c) => c.mediaId === id);
    VE.history.record();
    if (used.length) {
      S.clips = S.clips.filter((c) => c.mediaId !== id);
      VE.cleanTransitions();
    }
    m.removed = true;
    S.media = S.media.filter((x) => x.id !== id);
    VE.emit('media');
    VE.emit('change');
    VE.emit('select');
  };

  // Ảnh thumbnail gần nhất với thời điểm nguồn t
  VE.thumbAt = function (m, t) {
    if (!m.thumbs || !m.thumbs.length) return null;
    let best = m.thumbs[0], bd = Infinity;
    for (const th of m.thumbs) { const d = Math.abs(th.t - t); if (d < bd) { bd = d; best = th; } }
    return best;
  };
})();
