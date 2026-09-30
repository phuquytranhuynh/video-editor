/* Tự động lưu dự án (IndexedDB, chạy hoàn toàn trên máy) + lưu / mở file dự án */
(function () {
  const VE = window.VE;
  const S = VE.state;

  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const rq = indexedDB.open('veditor-local', 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('media', { keyPath: 'id' }); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  };
  const tx = (db, store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });

  const savedMedia = new Set();

  async function save() {
    try {
      const db = await open();
      const meta = S.media.map((m) => ({ id: m.id, name: m.name, kind: m.kind }));
      for (const m of S.media) {
        if (savedMedia.has(m.id)) continue;
        await tx(db, 'media', 'readwrite', (st) => st.put({ id: m.id, name: m.name, kind: m.kind, type: m.file.type, blob: m.file, hasAudio: m.hasAudio, markIn: m.markIn, markOut: m.markOut, sfx: m.sfx || null }));
        savedMedia.add(m.id);
      }
      const keep = new Set(Array.from(S.mediaStore.values()).filter((m) => !m.removed || S.clips.some((c) => c.mediaId === m.id)).map((m) => m.id));
      const all = await tx(db, 'media', 'readonly', (st) => st.getAllKeys());
      for (const k of all || []) if (!keep.has(k)) { await tx(db, 'media', 'readwrite', (st) => st.delete(k)); savedMedia.delete(k); }
      await tx(db, 'kv', 'readwrite', (st) => st.put({ project: VE.serialize(), media: meta, t: Date.now() }, 'project'));
    } catch (e) { /* lưu tự động là tuỳ chọn */ }
  }
  const saveSoon = VE.debounce(save, 1500);

  VE.persist = {
    start() { VE.on('change', saveSoon); VE.on('media', saveSoon); },
    async hasRecent() {
      try {
        const db = await open();
        const rec = await tx(db, 'kv', 'readonly', (st) => st.get('project'));
        return !!(rec && rec.project && rec.project.clips && rec.project.clips.length);
      } catch (e) { return false; }
    },
    async restore() {
      const db = await open();
      const rec = await tx(db, 'kv', 'readonly', (st) => st.get('project'));
      if (!rec) return false;
      VE.newProject(rec.project.settings);
      for (const mm of rec.media) {
        const r = await tx(db, 'media', 'readonly', (st) => st.get(mm.id));
        if (r) { try { await VE.restoreMedia(r); savedMedia.add(r.id); } catch (e) { VE.toast('Không mở lại được ' + mm.name); } }
      }
      VE.deserialize(rec.project);
      VE.history.clear();
      VE.emit('media');
      return true;
    },
    save,
  };

  // ---- lưu / mở file dự án (chỉ chứa timeline; media tham chiếu theo tên file)
  VE.saveProjectFile = function () {
    const o = VE.serialize();
    o.mediaMeta = S.media.map((m) => ({ id: m.id, name: m.name, kind: m.kind, sfx: m.sfx || null }));
    VE.download(new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' }), S.settings.name + '.vedit.json');
    VE.toast('Đã lưu file dự án (không chứa file media – khi mở lại cần nhập lại đúng media)');
  };
  VE.openProjectFile = async function (file) {
    try {
      const o = JSON.parse(await file.text());
      if (!o.settings || !o.clips) throw new Error('Không phải file dự án');
      // ánh xạ media theo tên
      const map = new Map();
      for (const mm of o.mediaMeta || []) {
        if (mm.sfx) { const sm = await VE.sfxMedia(mm.sfx); map.set(mm.id, sm.id); continue; }
        const m = S.media.find((x) => x.name === mm.name);
        if (m) map.set(mm.id, m.id);
      }
      let missing = 0;
      o.clips.forEach((c) => { if (c.mediaId) { if (map.has(c.mediaId)) c.mediaId = map.get(c.mediaId); else if (!VE.getMedia(c.mediaId)) missing++; } });
      if (missing) {
        const names = Array.from(new Set((o.mediaMeta || []).map((m) => m.name))).join(', ');
        if (!confirm(missing + ' clip thiếu media (' + names + '). Hãy nhập lại các file này trước rồi mở lại dự án. Vẫn mở (bỏ các clip thiếu)?')) return;
        o.clips = o.clips.filter((c) => !c.mediaId || VE.getMedia(c.mediaId));
      }
      VE.newProject(o.settings, { keepMedia: true });
      VE.deserialize(o);
      VE.history.clear();
      VE.seek(0);
    } catch (e) { VE.toast('Không mở được dự án: ' + e.message, 4500); }
  };
})();
