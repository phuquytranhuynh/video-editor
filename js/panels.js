/* Project panel (quản lý source), Effects & Graphics panel, thanh công cụ */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;

  // ------------------------------------------------------------------ tools
  const TOOLS = [
    { id: 'select', icon: 'select', tip: 'Selection (V) – chọn, kéo thả, kéo cạnh để dài/ngắn' },
    { id: 'ripple', icon: 'ripple', tip: 'Ripple Edit (B) – kéo cạnh clip và dồn các clip phía sau' },
    { id: 'razor', icon: 'razor', tip: 'Razor (C) – nhấp vào clip để cắt (Shift = cắt mọi track)' },
    { id: 'hand', icon: 'hand', tip: 'Hand (H) – kéo để cuộn timeline' },
    { id: 'text', icon: 'text', tip: 'Text (T) – nhấp lên video để thêm chữ' },
    { id: 'shape', icon: 'shape', tip: 'Shape (R) – nhấp lên video để thêm hình chữ nhật' },
  ];
  VE.setTool = function (id) {
    S.tool = id;
    VE.$$('#toolbar .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    VE.emit('tool');
  };
  VE.initToolbar = function (el) {
    TOOLS.forEach((t) => el.append(h('button', { class: 'tool', title: t.tip, html: VE.icon(t.icon, 20), dataset: { tool: t.id }, onclick: () => VE.setTool(t.id) })));
    VE.setTool('select');
  };

  VE.applyFit = function (mode) {
    const list = VE.selected().filter((c) => c.kind === 'video' || c.kind === 'image');
    if (!list.length) return VE.toast('Chọn clip video/ảnh trước');
    VE.history.record();
    list.forEach((c) => {
      const m = VE.getMedia(c.mediaId);
      c.scale = VE.fitScale(m.width, m.height, mode === 'orig' ? 'none' : mode);
      c.fit = mode === 'orig' ? null : mode;
      c.x = 0; c.y = 0;
    });
    VE.emit('change');
  };

  // ------------------------------------------------------------------ Project panel
  let selMedia = new Set();
  let viewMode = 'list';
  let filter = '';
  let listEl, countEl, nameEl;

  const KIND_ICON = { video: 'film', audio: 'music', image: 'image' };

  VE.initProject = function (panel) {
    nameEl = h('span', { class: 'ptitle-t' }, 'Project: ' + S.settings.name);
    panel.append(h('div', { class: 'ptitle' }, nameEl));
    const search = h('input', { class: 'search-in', placeholder: 'Tìm media…', oninput: (e) => { filter = e.target.value.toLowerCase(); render(); } });
    countEl = h('span', { class: 'count' }, '0 mục');
    panel.append(h('div', { class: 'proj-bar' },
      h('div', { class: 'search' }, h('span', { html: VE.icon('search', 14) }), search),
      h('button', { class: 'ib', title: 'Nhập media (Ctrl+I)', html: VE.icon('import', 16), onclick: () => VE.pickFiles() }),
      countEl));
    listEl = h('div', { class: 'proj-list' });
    panel.append(listEl);
    const listBtn = h('button', { class: 'ib', title: 'Dạng danh sách', html: VE.icon('list', 16), onclick: () => { viewMode = 'list'; render(); } });
    const gridBtn = h('button', { class: 'ib', title: 'Dạng biểu tượng', html: VE.icon('grid', 16), onclick: () => { viewMode = 'grid'; render(); } });
    panel.append(h('div', { class: 'proj-foot' },
      listBtn, gridBtn, h('span', { class: 'gap' }),
      h('button', { class: 'ib', title: 'Thêm vào timeline (Overwrite)', html: VE.icon('overwrite', 16), onclick: () => addSelected('overwrite') }),
      h('button', { class: 'ib', title: 'Chèn vào timeline (Insert)', html: VE.icon('insert', 16), onclick: () => addSelected('insert') }),
      h('button', { class: 'ib', title: 'Xoá media đã chọn', html: VE.icon('trash', 16), onclick: () => removeSelected() })));
    panel.addEventListener('mousedown', () => (S.activePanel = 'project'));
    listEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    listEl.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); VE.importFiles(e.dataTransfer.files); } });
    listEl.addEventListener('dblclick', (e) => { if (e.target === listEl || e.target.classList.contains('empty')) VE.pickFiles(); });
    listEl.addEventListener('mousedown', (e) => { if (e.target === listEl) { selMedia.clear(); markSel(); } });
    VE.on('media', render);
    VE.on('settings', () => (nameEl.textContent = 'Project: ' + S.settings.name));
    VE.on('thumbs', render);
    render();
  };

  function addSelected(mode) {
    const id = Array.from(selMedia)[0];
    if (!id) return VE.toast('Chọn media trước');
    const created = VE.placeMedia(id, { mode, start: S.playhead });
    if (created.length) { VE.select(created.map((c) => c.id)); VE.seek(Math.max(...created.map((c) => c.start + c.dur))); }
  }
  function removeSelected() {
    const ids = Array.from(selMedia);
    if (!ids.length) return;
    const used = ids.filter((id) => S.clips.some((c) => c.mediaId === id));
    if (used.length && !confirm('Media đang dùng trong timeline. Xoá media sẽ xoá luôn các clip liên quan. Tiếp tục?')) return;
    ids.forEach((id) => VE.removeMedia(id));
    selMedia.clear();
  }

  function markSel() { VE.$$('.pitem', listEl).forEach((n) => n.classList.toggle('sel', selMedia.has(n.dataset.id))); }
  function usage(m) { return S.clips.filter((c) => c.mediaId === m.id).length; }

  function render() {
    if (!listEl) return;
    listEl.textContent = '';
    const visible = S.media.filter((m) => !m.sfx);
    const items = visible.filter((m) => !filter || m.name.toLowerCase().includes(filter));
    countEl.textContent = visible.length + ' mục';
    listEl.className = 'proj-list ' + viewMode;
    if (!visible.length) {
      listEl.append(h('div', { class: 'empty' }, h('div', { html: VE.icon('import', 34) }), h('p', {}, 'Kéo thả file video / audio / ảnh vào đây'), h('button', { class: 'btn', onclick: () => VE.pickFiles() }, 'Nhập media…')));
      return;
    }
    if (viewMode === 'list') {
      listEl.append(h('div', { class: 'prow head' }, h('span', { class: 'c-name' }, 'Tên'), h('span', { class: 'c-dur' }, 'Thời lượng'), h('span', { class: 'c-info' }, 'Thông tin')));
    }
    items.forEach((m) => {
      const info = m.kind === 'audio' ? 'Audio' : m.width + '×' + m.height + (m.kind === 'video' ? '' : ' · ảnh');
      const thumb = m.thumb ? h('img', { src: m.thumb, draggable: false }) : h('span', { class: 'ph', html: VE.icon(KIND_ICON[m.kind], 22) });
      const dur = m.kind === 'image' ? 'Ảnh' : VE.fmtDur(m.duration);
      const used = usage(m);
      const el = h('div', { class: 'pitem' + (selMedia.has(m.id) ? ' sel' : ''), draggable: true, title: m.name + '\nKéo vào timeline • Nhấp đúp để xem ở Source' },
        viewMode === 'list'
          ? [h('span', { class: 'c-name' }, h('span', { class: 'th' }, thumb), h('span', { class: 'kind ' + m.kind, html: VE.icon(KIND_ICON[m.kind], 13) }), h('span', { class: 'nm' }, m.name), used ? h('em', { class: 'used' }, '●') : null),
            h('span', { class: 'c-dur' }, dur), h('span', { class: 'c-info' }, info)]
          : [h('div', { class: 'gth' }, thumb, m.kind !== 'image' ? h('span', { class: 'gdur' }, dur) : null), h('div', { class: 'gnm' }, m.name)]);
      el.classList.add(viewMode === 'list' ? 'prow' : 'ptile');
      el.dataset.id = m.id;
      el.addEventListener('mousedown', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) { selMedia.has(m.id) ? selMedia.delete(m.id) : selMedia.add(m.id); }
        else selMedia = new Set([m.id]);
        markSel();
      });
      el.addEventListener('dblclick', () => VE.source && VE.source.load(m.id));
      el.addEventListener('dragstart', (e) => {
        VE.drag = { type: 'media', id: m.id };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', m.id);
      });
      el.addEventListener('dragend', () => (VE.drag = null));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selMedia = new Set([m.id]);
        markSel();
        VE.popupMenu(e.clientX, e.clientY, [
          { label: 'Xem ở Source monitor', action: () => VE.source.load(m.id) },
          { label: 'Overwrite vào timeline tại playhead', action: () => addSelected('overwrite') },
          { label: 'Insert vào timeline tại playhead', action: () => addSelected('insert') },
          { sep: true },
          { label: 'Đổi tên…', action: () => { const n = prompt('Tên mới', m.name); if (n) { m.name = n; render(); } } },
          { label: 'Xoá khỏi project', action: () => removeSelected() },
        ]);
      });
      listEl.append(el);
    });
  }

  // ------------------------------------------------------------------ Effects / Graphics panel
  const ZOOMS = [
    { name: 'Zoom In nhẹ (10%)', zoomType: 'in', amount: 10 },
    { name: 'Zoom In (20%)', zoomType: 'in', amount: 20 },
    { name: 'Zoom In mạnh (40%)', zoomType: 'in', amount: 40 },
    { name: 'Zoom Out nhẹ (10%)', zoomType: 'out', amount: 10 },
    { name: 'Zoom Out (20%)', zoomType: 'out', amount: 20 },
    { name: 'Zoom Out mạnh (40%)', zoomType: 'out', amount: 40 },
    { name: 'Punch-in nhanh (30% / 0.4s đầu)', zoomType: 'in', amount: 30, dur: 0.4, at: 'start' },
    { name: 'Punch-out nhanh (30% / 0.4s đầu)', zoomType: 'out', amount: 30, dur: 0.4, at: 'start' },
    { name: 'Không zoom', zoomType: 'none', amount: 0 },
  ];
  const FADES = [
    { name: 'Fade In 0.5s', which: 'in', dur: 0.5 },
    { name: 'Fade Out 0.5s', which: 'out', dur: 0.5 },
    { name: 'Fade 2 đầu 0.5s', which: 'both', dur: 0.5 },
    { name: 'Fade 2 đầu 1s', which: 'both', dur: 1 },
    { name: 'Fade 2 đầu 2s', which: 'both', dur: 2 },
    { name: 'Bỏ fade', which: 'both', dur: 0 },
  ];

  VE.TEXT_STYLES = [
    { name: 'Tiêu đề', over: { content: 'TIÊU ĐỀ', size: 120, weight: 800, color: '#ffffff', strokeW: 6, stroke: '#000000' } },
    { name: 'Caption TikTok', over: { content: 'Caption nổi bật', size: 76, weight: 800, color: '#ffffff', strokeW: 7, stroke: '#000000', wrapW: 900 } },
    { name: 'Phụ đề nền đen', over: { content: 'Phụ đề ở đây', size: 56, weight: 600, color: '#ffffff', bg: '#000000', bgOpacity: 70, bgPad: 20, bgRadius: 14, wrapW: 1300 } },
    { name: 'Vàng nổi bật', over: { content: 'HOT!', font: 'Impact', size: 140, weight: 400, color: '#ffd400', strokeW: 9, stroke: '#000000' } },
    { name: 'Neon', over: { content: 'NEON', size: 120, weight: 800, color: '#8cff7a', shadow: true, shadowColor: '#39ff14', shadowBlur: 28 } },
    { name: 'Chữ thường', over: { content: 'Nhập văn bản', size: 64, weight: 400, color: '#ffffff' } },
  ];
  const SHAPES = [
    ['rect', 'Chữ nhật'], ['round', 'Bo góc'], ['ellipse', 'Elip / tròn'], ['triangle', 'Tam giác'], ['star', 'Ngôi sao'], ['line', 'Đường thẳng'], ['arrow', 'Mũi tên'],
  ];

  function shapeIcon(t) {
    const P = {
      rect: '<rect x="4" y="6" width="16" height="12"/>', round: '<rect x="4" y="6" width="16" height="12" rx="4"/>',
      ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>', triangle: '<path d="M12 5l8 14H4z"/>',
      star: '<path d="M12 3l2.7 6 6.3.6-4.8 4.3 1.5 6.3L12 17l-5.7 3.2 1.5-6.3L3 9.6 9.3 9z"/>',
      line: '<path d="M4 18L20 6"/>', arrow: '<path d="M4 12h15M14 6l6 6-6 6"/>',
    };
    return '<svg width="30" height="30" viewBox="0 0 24 24" fill="' + (t === 'line' || t === 'arrow' ? 'none' : 'currentColor') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + P[t] + '</svg>';
  }

  function addShape(type) {
    const isLine = type === 'line' || type === 'arrow';
    const over = { type };
    if (isLine) Object.assign(over, { w: 500, h: 80, strokeW: 10, stroke: '#ffffff', fill: '#ffffff' });
    if (type === 'ellipse' || type === 'star' || type === 'triangle') Object.assign(over, { w: 320, h: 320 });
    VE.addGraphic('shape', { shape: VE.defaultShape(type, over) });
  }
  VE.addText = (style) => {
    VE.addGraphic('text', { text: VE.defaultText(style ? style.over : {}), name: 'Text' });
    VE.emit('focusText');
  };

  VE.initEffects = function (panel) {
    const tabs = h('div', { class: 'tabs' });
    const body = h('div', { class: 'eff-body' });
    const tabDefs = [['fx', 'Hiệu ứng'], ['cap', 'Caption'], ['auto', 'Tự động'], ['sfx', 'SFX'], ['gfx', 'Text/Shape']];
    const FN = { fx: fxTab, cap: captionTab, auto: autoTab, sfx: sfxTab, gfx: gfxTab };
    let cur = 'fx';
    const draw = () => {
      VE.$$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.t === cur));
      body.textContent = '';
      FN[cur](body);
    };
    VE.showEffectsTab = (id) => { cur = id; draw(); };
    tabDefs.forEach(([id, l]) => tabs.append(h('button', { class: 'tab', dataset: { t: id }, onclick: () => { cur = id; draw(); } }, l)));
    panel.append(h('div', { class: 'ptitle' }, tabs), body);
    panel.addEventListener('mousedown', () => (S.activePanel = 'effects'));
    draw();
  };

  function fxItem(label, drag, apply, extraCls) {
    const el = h('div', { class: 'fxitem ' + (extraCls || ''), draggable: true, title: 'Nhấp để áp dụng cho clip đang chọn • Kéo thả lên clip (nửa trái = đầu clip, nửa phải = cuối clip)' }, h('span', { class: 'fxi' }), label);
    el.addEventListener('click', apply);
    el.addEventListener('dragstart', (e) => { VE.drag = drag; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', label); });
    el.addEventListener('dragend', () => (VE.drag = null));
    return el;
  }

  function applyTransitionClick(type) {
    if (S.selTrans) {
      const b = VE.clip(S.selTrans);
      VE.history.record();
      VE.setTransition(b, type);
      VE.emit('change');
      return;
    }
    const list = VE.selected();
    if (!list.length) return VE.toast('Chọn một clip (hoặc điểm giữa 2 clip liền kề) để áp transition');
    VE.history.record();
    const done = new Set();
    let n = 0;
    list.forEach((c) => {
      if (done.has(c.id)) return;
      const cs = VE.clipsOnTrack(c.trackId);
      const i = cs.indexOf(c);
      let target = null;
      if (VE.adjacent(cs[i - 1], c)) target = c;
      else if (VE.adjacent(c, cs[i + 1])) target = cs[i + 1];
      if (target) { VE.setTransition(target, type); done.add(target.id); n++; }
      else if (VE.isVisual(c) || c.kind === 'audio') { VE.setFade(c, 'fadeIn', Math.min(S.fxDur, c.dur / 2)); n++; }
    });
    VE.emit('change');
    if (n) VE.toast('Đã áp dụng ' + n + ' transition');
  }

  function fxTab(body) {
    const durIn = h('input', { type: 'number', min: 0.1, max: 10, step: 0.1, value: S.fxDur, class: 'num sm', onchange: (e) => (S.fxDur = Math.max(0.1, parseFloat(e.target.value) || 1)) });
    body.append(h('div', { class: 'eff-sec' }, 'Video Transitions – ' + VE.TRANSITIONS.length + ' kiểu chuyển cảnh giữa 2 clip liền kề'),
      h('div', { class: 'eff-note' }, 'Thời lượng mặc định (giây): ', durIn));
    body.append(h('label', { class: 'eff-note chk-row' }, h('input', { type: 'checkbox', class: 'chk', checked: S.autoTransSfx, onchange: (e) => (S.autoTransSfx = e.target.checked) }), ' Tự chèn SFX (whoosh, glitch…) tại điểm chuyển cảnh'));
    let lastCat = null;
    VE.TRANSITIONS.forEach((t) => {
      if (t.cat !== lastCat) { lastCat = t.cat; body.append(h('div', { class: 'eff-sub' }, t.cat)); }
      body.append(fxItem(t.name, { type: 'fx', fx: 'transition', id: t.id }, () => applyTransitionClick(t.id), 'fx-trans'));
    });
    body.append(h('div', { class: 'eff-sec' }, 'Zoom nhanh (mượt, ease in-out)'));
    ZOOMS.forEach((z) => body.append(fxItem(z.name, Object.assign({ type: 'fx', fx: 'zoom' }, z), () => {
      const list = VE.selected().filter(VE.isVisual);
      if (!list.length) return VE.toast('Chọn clip hình ảnh trước');
      VE.history.record();
      list.forEach((c) => VE.applyFxDropRaw(c, Object.assign({ fx: 'zoom' }, z)));
      VE.emit('change');
    }, 'zoom')));
    body.append(h('div', { class: 'eff-sec' }, 'Fade in / out ở 2 đầu clip'));
    FADES.forEach((f) => body.append(fxItem(f.name, Object.assign({ type: 'fx', fx: 'fade' }, f), () => {
      const list = VE.selected();
      if (!list.length) return VE.toast('Chọn clip trước');
      VE.history.record();
      list.forEach((c) => VE.applyFxDropRaw(c, Object.assign({ fx: 'fade' }, f)));
      VE.emit('change');
    }, 'fade')));
  }
  VE.applyFxDropRaw = function (c, d) {
    if (d.fx === 'zoom') {
      c.zoom.type = d.zoomType; c.zoom.amount = d.amount || c.zoom.amount;
      c.zoom.dur = d.dur != null ? d.dur : 0;
      c.zoom.at = d.at || 'start';
    } else if (d.fx === 'fade') {
      if (d.which === 'in' || d.which === 'both') VE.setFade(c, 'fadeIn', Math.min(d.dur, c.dur / 2));
      if (d.which === 'out' || d.which === 'both') VE.setFade(c, 'fadeOut', Math.min(d.dur, c.dur / 2));
    }
  };

  // ---- tab Caption: preset caption kiểu CapCut ----
  function captionTab(body) {
    body.append(
      h('div', { class: 'eff-sec' }, 'Caption / Keyword nổi bật'),
      h('label', { class: 'eff-note chk-row' }, h('input', { type: 'checkbox', class: 'chk', checked: S.autoSfx, onchange: (e) => (S.autoSfx = e.target.checked) }), ' Tự chèn SFX đúng lúc caption xuất hiện'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => VE.showSttDialog() }, 'Phụ đề tự động từ giọng nói…'),
        h('button', { class: 'btn', onclick: () => VE.showCaptionImport() }, 'Nhập phụ đề hàng loạt…')),
      h('div', { class: 'eff-note' }, 'Bấm "+" để thêm tại playhead, "Áp" để đổi kiểu cho caption đang chọn. Gõ *từ khoá* (đặt giữa 2 dấu sao) để tô khung highlight.'));
    VE.CAPTION_PRESETS.forEach((pr) => {
      const t = pr.text;
      const prev = h('span', { class: 'tprev', style: {
        color: t.color, fontFamily: t.font || 'Arial', fontWeight: t.weight, fontStyle: t.italic ? 'italic' : 'normal', background: t.bgOpacity ? t.bg : 'transparent',
        borderRadius: t.bgOpacity ? '10px' : '0', WebkitTextStroke: t.strokeW ? '1px ' + t.stroke : '0', textShadow: t.shadow ? '0 0 6px ' + t.shadowColor : 'none', padding: t.bgOpacity ? '0 6px' : '0',
      } }, 'Aa');
      const sfxDef = pr.sfx && VE.sfxDef(pr.sfx);
      body.append(h('div', { class: 'fxitem cap' }, prev, h('span', { class: 'grow' }, pr.name, sfxDef ? h('em', { class: 'tag' }, '♪ ' + sfxDef.name.split(' ')[0]) : null),
        h('button', { class: 'btn mini', title: 'Thêm caption mới tại playhead', onclick: () => VE.addCaption(pr) }, '+'),
        h('button', { class: 'btn mini', title: 'Áp kiểu này cho caption đang chọn', onclick: () => VE.applyCaptionPreset(pr) }, 'Áp')));
    });
  }

  // ---- tab Tự động: cắt khoảng lặng / jump-cut zoom / ducking ----
  function autoTab(body) {
    const card = (title, desc, btn, fn) => h('div', { class: 'autocard' }, h('div', { class: 'at' }, title), h('div', { class: 'ad' }, desc),
      h('button', { class: 'btn primary', onclick: fn }, btn));
    body.append(
      h('div', { class: 'eff-sec' }, 'Dựng nhanh video nói chuyện (talking-head)'),
      h('div', { class: 'eff-note' }, 'Quy trình gợi ý: ① cắt khoảng lặng → ② jump-cut zoom → ③ thêm caption + SFX → ④ thêm nhạc nền rồi bật ducking. Chọn clip trên timeline trước khi dùng.'),
      card('✂ Tự cắt khoảng lặng', 'Dò đoạn im lặng giữa các câu nói từ waveform, xem trước vùng bị cắt, rồi xoá và dồn clip lại. Có tuỳ chọn zoom xen kẽ ngay sau khi cắt.', 'Cắt khoảng lặng…', () => VE.showSilenceDialog()),
      card('🔍 Jump-cut zoom', 'Phóng to xen kẽ giữa các đoạn (thường ↔ zoom vào khuôn mặt) để video có nhịp như CapCut. Có thể tự chia clip dài thành các đoạn ngắn, ưu tiên cắt ở chỗ ngắt nghỉ.', 'Áp zoom xen kẽ…', () => VE.showJumpZoomDialog()),
      card('💬 Phụ đề tự động từ giọng nói', 'Nhận dạng lời nói bằng Whisper chạy ngay trên máy (không upload), tự tạo caption đúng thời điểm nói, cho bạn xem lại và sửa trước khi đưa lên timeline. Hỗ trợ tiếng Việt và nhiều ngôn ngữ khác.', 'Tạo phụ đề tự động…', () => VE.showSttDialog()),
      card('🎚 Hạ nhạc nền khi có lời nói', 'Nhạc nền tự nhỏ lại khi track lời thoại có tiếng và to lên khi im lặng. Chọn clip nhạc rồi bật; đường vàng trên clip nhạc thể hiện mức âm lượng thực tế.', 'Bật ducking…', () => VE.showDuckDialog()));
  }

  // ---- tab SFX ----
  function sfxTab(body) {
    body.append(
      h('div', { class: 'eff-sec' }, 'Sound effect (tự tạo, không bản quyền)'),
      h('div', { class: 'eff-note' }, '▶ nghe thử · "+" thêm tại playhead · hoặc kéo thả xuống timeline. Muốn SFX đi theo caption/transition: chọn clip rồi mở mục "Sound effect" ở bảng Properties.'));
    let last = null;
    VE.SFX.forEach((sf) => {
      if (sf.cat !== last) { last = sf.cat; body.append(h('div', { class: 'eff-sub' }, sf.cat)); }
      const it = h('div', { class: 'fxitem sfx', draggable: true, title: 'Kéo vào track audio của timeline' },
        h('button', { class: 'btn mini play', title: 'Nghe thử', onclick: (e) => { e.stopPropagation(); VE.previewSfx(sf.id); } }, '▶'),
        h('span', { class: 'grow' }, sf.name), h('em', { class: 'tag' }, sf.dur.toFixed(1) + 's'),
        h('button', { class: 'btn mini', title: 'Thêm tại playhead (chọn track audio trống)', onclick: async (e) => {
          e.stopPropagation();
          const m = await VE.sfxMedia(sf.id);
          const tr = VE.freeAudioTrack(S.playhead, m.duration);
          const created = VE.placeMedia(m.id, { start: Math.max(0, S.playhead - sf.lead), aTrack: tr.id });
          if (created.length) VE.select(created.map((c) => c.id));
        } }, '+'));
      it.addEventListener('dragstart', (e) => { VE.drag = { type: 'sfx', id: sf.id }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', sf.id); });
      it.addEventListener('dragend', () => (VE.drag = null));
      body.append(it);
    });
  }

  function gfxTab(body) {
    body.append(h('div', { class: 'eff-sec' }, 'Text'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => VE.addText() }, '+ Thêm Text tại playhead')),
      h('div', { class: 'eff-note' }, 'Kiểu có sẵn (sau đó chỉnh font, màu, nền, viền ở bảng Properties):'));
    VE.TEXT_STYLES.forEach((s) => {
      const o = s.over;
      const prev = h('span', { class: 'tprev', style: { color: o.color, fontFamily: o.font || 'Arial', fontWeight: o.weight, background: o.bgOpacity ? 'rgba(0,0,0,.7)' : 'transparent', WebkitTextStroke: o.strokeW ? '1px #000' : '0', textShadow: o.shadow ? '0 0 8px ' + o.shadowColor : 'none' } }, 'Aa');
      const it = h('div', { class: 'fxitem', onclick: () => VE.addText(s) }, prev, s.name);
      body.append(it);
    });
    body.append(h('div', { class: 'eff-sec' }, 'Shape (hình khối)'));
    const grid = h('div', { class: 'shape-grid' });
    SHAPES.forEach(([t, n]) => grid.append(h('button', { class: 'shape-btn', title: 'Thêm ' + n, html: shapeIcon(t) + '<span>' + n + '</span>', onclick: () => addShape(t) })));
    body.append(grid);
  }
})();
