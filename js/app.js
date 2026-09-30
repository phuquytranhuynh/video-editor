/* Khởi động ứng dụng: menu, bố cục, splitter, phím tắt, kéo thả file */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;

  VE.pickFiles = () => VE.$('#fileInput').click();

  // ------------------------------------------------------------------ menus
  const sel = () => S.sel.size > 0;
  function menus() {
    return [
      ['Tệp', () => [
        { label: 'Dự án mới…', action: () => VE.showSequenceDialog(true) },
        { label: 'Nhập media…', shortcut: 'Ctrl+I', action: VE.pickFiles },
        { sep: true },
        { label: 'Mở file dự án…', action: () => VE.$('#projInput').click() },
        { label: 'Lưu file dự án (.json)', shortcut: 'Ctrl+S', action: VE.saveProjectFile },
        { sep: true },
        { label: 'Xuất video…', shortcut: 'Ctrl+M', action: VE.showExportDialog },
      ]],
      ['Chỉnh sửa', () => [
        { label: 'Hoàn tác', shortcut: 'Ctrl+Z', action: VE.history.undo },
        { label: 'Làm lại', shortcut: 'Ctrl+Shift+Z', action: VE.history.redo },
        { sep: true },
        { label: 'Cắt (Cut)', shortcut: 'Ctrl+X', disabled: !sel(), action: () => { VE.copySel(); VE.deleteClips(Array.from(S.sel)); } },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !sel(), action: VE.copySel },
        { label: 'Dán tại playhead', shortcut: 'Ctrl+V', disabled: !S.clipboard, action: VE.paste },
        { label: 'Xoá', shortcut: 'Del', disabled: !sel(), action: () => VE.deleteClips(Array.from(S.sel)) },
        { label: 'Xoá & dồn (Ripple Delete)', shortcut: 'Shift+Del', disabled: !sel(), action: () => VE.deleteClips(Array.from(S.sel), true) },
        { sep: true },
        { label: 'Chọn tất cả', shortcut: 'Ctrl+A', action: () => VE.select(S.clips.map((c) => c.id)) },
      ]],
      ['Clip', () => [
        { label: 'Cắt tại playhead', shortcut: 'Ctrl+K', action: () => VE.splitAt(S.playhead) },
        { sep: true },
        { label: 'Tách audio khỏi video (Unlink)', disabled: !sel(), action: () => VE.unlink() },
        { label: 'Liên kết clip đã chọn (Link)', disabled: S.sel.size < 2, action: VE.linkSelected },
        { label: 'Trích xuất audio', disabled: !VE.selected().some((c) => c.kind === 'video'), action: () => VE.selected().filter((c) => c.kind === 'video').forEach(VE.extractAudio) },
        { sep: true },
        { label: 'Vừa khung (Fit)', action: () => VE.applyFit('fit') },
        { label: 'Lấp đầy khung (Fill)', action: () => VE.applyFit('fill') },
        { label: 'Kích thước gốc (100%)', action: () => VE.applyFit('orig') },
        { sep: true },
        { label: 'Tự cắt khoảng lặng…', action: () => VE.showSilenceDialog() },
        { label: 'Jump-cut zoom…', action: () => VE.showJumpZoomDialog() },
        { label: 'Hạ nhạc nền khi có lời (Ducking)…', action: () => VE.showDuckDialog() },
        { label: 'Phụ đề tự động từ giọng nói…', action: () => VE.showSttDialog() },
      ]],
      ['Sequence', () => [
        { label: 'Thiết lập Sequence…', action: () => VE.showSequenceDialog(false) },
        { sep: true },
        { label: 'Thêm track video', action: () => VE.addTrack('video') },
        { label: 'Thêm track audio', action: () => VE.addTrack('audio') },
        { sep: true },
        { label: 'Snap', shortcut: 'S', checked: S.snap, action: () => { S.snap = !S.snap; VE.timeline.refreshToggles(); } },
        { label: 'Linked selection', checked: S.linked, action: () => { S.linked = !S.linked; VE.timeline.refreshToggles(); } },
        { sep: true },
        { label: 'Đặt điểm In (work area)', shortcut: 'I', action: () => VE.setSeqMark('in') },
        { label: 'Đặt điểm Out (work area)', shortcut: 'O', action: () => VE.setSeqMark('out') },
        { label: 'Xoá work area', shortcut: 'Alt+X', action: () => { S.range = null; VE.emit('change'); } },
      ]],
      ['Marker', () => [
        { label: 'Thêm marker tại playhead', shortcut: 'M', action: () => VE.addMarker() },
        { label: 'Marker tiếp theo', action: () => { const m = S.markers.filter((x) => x.time > S.playhead + 0.01).sort((a, b) => a.time - b.time)[0]; if (m) VE.seek(m.time); } },
        { label: 'Marker trước đó', action: () => { const m = S.markers.filter((x) => x.time < S.playhead - 0.01).sort((a, b) => b.time - a.time)[0]; if (m) VE.seek(m.time); } },
      ]],
      ['Text & Shape', () => [
        { label: 'Thêm Text', action: () => VE.addText() },
        { sep: true },
        ...[['rect', 'Chữ nhật'], ['round', 'Bo góc'], ['ellipse', 'Elip'], ['triangle', 'Tam giác'], ['star', 'Ngôi sao'], ['line', 'Đường thẳng'], ['arrow', 'Mũi tên']].map(([t, n]) => ({
          label: 'Thêm ' + n,
          action: () => {
            const isLine = t === 'line' || t === 'arrow';
            const o = { type: t };
            if (isLine) Object.assign(o, { w: 500, h: 80, strokeW: 10, stroke: '#ffffff', fill: '#ffffff' });
            if (['ellipse', 'star', 'triangle'].includes(t)) Object.assign(o, { w: 320, h: 320 });
            VE.addGraphic('shape', { shape: VE.defaultShape(t, o) });
          },
        })),
      ]],
      ['Xem', () => [
        { label: 'Phóng to timeline', shortcut: '+', action: () => VE.timeline.setPps(S.pps * 1.4) },
        { label: 'Thu nhỏ timeline', shortcut: '−', action: () => VE.timeline.setPps(S.pps / 1.4) },
        { label: 'Timeline vừa khít', shortcut: '\\', action: () => VE.timeline.fit() },
        { sep: true },
        { label: 'Chất lượng xem trước: Full', action: () => VE.setPreviewQuality(1) },
        { label: 'Chất lượng xem trước: 1/2', action: () => VE.setPreviewQuality(0.5) },
        { label: 'Chất lượng xem trước: 1/4', action: () => VE.setPreviewQuality(0.25) },
      ]],
      ['Cửa sổ', () => [
        { label: 'Đặt lại bố cục panel', action: () => { localStorage.removeItem('ve.layout'); location.reload(); } },
      ]],
      ['Trợ giúp', () => [
        { label: 'Phím tắt', action: VE.showShortcuts },
        { label: 'Giới thiệu', action: VE.showAbout },
      ]],
    ];
  }

  function buildMenubar() {
    const bar = VE.$('#menubar');
    let openIdx = -1;
    const items = menus().map(([label, get], i) => {
      const b = h('div', { class: 'mb-item' }, label);
      const show = () => {
        const r = b.getBoundingClientRect();
        VE.popupMenu(r.left, r.bottom, get());
        openIdx = i;
        VE.$$('.mb-item', bar).forEach((x, j) => x.classList.toggle('open', j === i));
      };
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); if (openIdx === i && VE.$('.ctxmenu')) { VE.closeMenu(); openIdx = -1; b.classList.remove('open'); } else show(); });
      b.addEventListener('mouseenter', () => { if (openIdx >= 0 && VE.$('.ctxmenu') && openIdx !== i) show(); });
      bar.append(b);
      return b;
    });
    addEventListener('mousedown', () => setTimeout(() => { if (!VE.$('.ctxmenu')) { openIdx = -1; items.forEach((x) => x.classList.remove('open')); } }, 0));
  }

  function buildWorkspace() {
    const ws = VE.$('#workspace');
    ws.append(
      h('div', { class: 'ws-home', html: VE.icon('home', 20) }),
      h('div', { class: 'ws-tabs' },
        h('button', { class: 'ws-tab', onclick: VE.pickFiles }, 'Nhập'),
        h('button', { class: 'ws-tab on' }, 'Chỉnh sửa'),
        h('button', { class: 'ws-tab', onclick: VE.showExportDialog }, 'Xuất')),
      h('div', { class: 'ws-title', id: 'wsTitle' }, ''),
      h('div', { class: 'ws-right' },
        h('button', { class: 'ib', title: 'Hoàn tác (Ctrl+Z)', html: VE.icon('undo', 18), onclick: VE.history.undo }),
        h('button', { class: 'ib', title: 'Làm lại (Ctrl+Shift+Z)', html: VE.icon('redo', 18), onclick: VE.history.redo }),
        h('button', { class: 'ib', title: 'Thiết lập Sequence', html: VE.icon('gear', 18), onclick: () => VE.showSequenceDialog(false) }),
        h('button', { class: 'btn primary ws-export', onclick: VE.showExportDialog }, 'Xuất video')));
    const upd = () => { VE.$('#wsTitle').textContent = S.settings.name + '  ·  ' + S.settings.width + '×' + S.settings.height + '  ·  ' + S.settings.fps + 'fps'; };
    VE.on('settings', upd);
    upd();
  }

  // ------------------------------------------------------------------ splitters
  const LAYOUT = {
    leftW: { def: 380, min: 240, max: 700, axis: 'x', sign: 1, target: '#main' },
    projH: { def: 330, min: 120, max: 900, axis: 'y', sign: 1, target: '#colLeft' },
    topH: { def: 430, min: 220, max: 1000, axis: 'y', sign: 1, target: '#colRight' },
    srcW: { def: 380, min: 200, max: 900, axis: 'x', sign: 1, target: '#rowTop' },
    propW: { def: 310, min: 220, max: 600, axis: 'x', sign: -1, target: '#rowTop' },
  };
  function initSplitters() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ve.layout') || '{}'); } catch (e) { /* ignore */ }
    const root = document.documentElement;
    Object.keys(LAYOUT).forEach((k) => root.style.setProperty('--' + k, (saved[k] || LAYOUT[k].def) + 'px'));
    VE.$$('.split').forEach((sp) => {
      const k = sp.dataset.split, cfg = LAYOUT[k];
      sp.addEventListener('mousedown', (e) => {
        const v0 = parseFloat(getComputedStyle(root).getPropertyValue('--' + k));
        const p0 = cfg.axis === 'x' ? e.clientX : e.clientY;
        document.body.classList.add('resizing-' + cfg.axis);
        const move = (ev) => {
          const d = ((cfg.axis === 'x' ? ev.clientX : ev.clientY) - p0) * cfg.sign;
          const v = Math.min(cfg.max, Math.max(cfg.min, v0 + d));
          root.style.setProperty('--' + k, v + 'px');
          saved[k] = v;
          window.dispatchEvent(new Event('resize'));
        };
        const up = () => {
          removeEventListener('mousemove', move); removeEventListener('mouseup', up);
          document.body.classList.remove('resizing-x', 'resizing-y');
          try { localStorage.setItem('ve.layout', JSON.stringify(saved)); } catch (e) { /* ignore */ }
        };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
        e.preventDefault();
      });
    });
  }

  // ------------------------------------------------------------------ keyboard
  function jumpEdge(dir) {
    const pts = new Set([0]);
    S.clips.forEach((c) => { pts.add(c.start); pts.add(c.start + c.dur); });
    const arr = Array.from(pts).sort((a, b) => a - b);
    const e = VE.frame() / 2;
    const t = dir > 0 ? arr.find((p) => p > S.playhead + e) : arr.slice().reverse().find((p) => p < S.playhead - e);
    if (t != null) VE.seek(t);
  }

  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (!(tag === 'input' && ['range', 'checkbox', 'color'].includes(e.target.type))) return;
    }
    if (document.querySelector('.modal-back')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const srcActive = S.activePanel === 'source' && VE.source && VE.source.current();

    if (ctrl) {
      if (k === 'z') { e.shiftKey ? VE.history.redo() : VE.history.undo(); }
      else if (k === 'y') VE.history.redo();
      else if (k === 'c') VE.copySel();
      else if (k === 'x') { VE.copySel(); VE.deleteClips(Array.from(S.sel)); }
      else if (k === 'v') VE.paste();
      else if (k === 'a') VE.select(S.clips.map((c) => c.id));
      else if (k === 'k') VE.splitAt(S.playhead);
      else if (k === 'i') VE.pickFiles();
      else if (k === 'm') VE.showExportDialog();
      else if (k === 's') VE.saveProjectFile();
      else return;
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case ' ': srcActive ? VE.source.toggle() : VE.togglePlay(); break;
      case 'ArrowLeft': VE.step(e.shiftKey ? -VE.state.settings.fps : -1); break;
      case 'ArrowRight': VE.step(e.shiftKey ? VE.state.settings.fps : 1); break;
      case 'ArrowUp': jumpEdge(-1); break;
      case 'ArrowDown': jumpEdge(1); break;
      case 'Home': VE.seek(0); break;
      case 'End': VE.seek(VE.timelineEnd()); break;
      case 'Delete': case 'Backspace': VE.deleteClips(Array.from(S.sel), e.shiftKey); if (S.selTrans) { const b = VE.clip(S.selTrans); if (b) { VE.history.record(); VE.setTransition(b, null); VE.clearSelection(); VE.emit('change'); } } break;
      case 'Escape': VE.clearSelection(); VE.closeMenu(); break;
      case '\\': VE.timeline.fit(); break;
      case '+': case '=': VE.timeline.setPps(S.pps * 1.4); break;
      case '-': case '_': VE.timeline.setPps(S.pps / 1.4); break;
      case ',': srcActive ? VE.source.place('insert') : null; break;
      case '.': srcActive ? VE.source.place('overwrite') : null; break;
      default:
        switch (k) {
          case 'k': VE.pause(); break;
          case 'l': if (VE.isPlaying()) VE.player.rate = Math.min(4, VE.player.rate * 2); else VE.play(); break;
          case 'j': VE.seek(S.playhead - 1); break;
          case 'v': VE.setTool('select'); break;
          case 'b': VE.setTool('ripple'); break;
          case 'c': VE.setTool('razor'); break;
          case 'h': VE.setTool('hand'); break;
          case 't': VE.setTool('text'); break;
          case 'r': VE.setTool('shape'); break;
          case 's': S.snap = !S.snap; VE.timeline.refreshToggles(); break;
          case 'm': VE.addMarker(); break;
          case 'i': srcActive ? VE.source.setMark('in') : VE.setSeqMark('in'); break;
          case 'o': srcActive ? VE.source.setMark('out') : VE.setSeqMark('out'); break;
          case 'x': if (e.altKey) { S.range = null; VE.emit('change'); } break;
          default: return;
        }
    }
    e.preventDefault();
  }

  // ------------------------------------------------------------------ init
  function init() {
    VE.newProject({ name: 'Sequence 01', width: 1920, height: 1080, fps: 30, preset: 'yt1080' });
    buildMenubar();
    buildWorkspace();
    initSplitters();
    VE.initToolbar(VE.$('#toolbar'));
    VE.initProject(VE.$('#pProject'));
    VE.initEffects(VE.$('#pEffects'));
    VE.initSource(VE.$('#pSource'));
    VE.initProgram(VE.$('#pProgram'));
    VE.initInspector(VE.$('#pProps'));
    VE.timeline.init(VE.$('#pTimeline'));
    VE.initMeter(VE.$('#pMeter'));

    VE.$('#fileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      const n = await VE.importFiles(files);
      if (n) VE.toast('Đã nhập ' + n + ' file');
    });
    VE.$('#projInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) VE.openProjectFile(f); });

    // kéo thả file vào cửa sổ
    const ov = VE.$('#dropOverlay');
    let dragDepth = 0;
    addEventListener('dragenter', (e) => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) { dragDepth++; ov.classList.add('show'); } });
    addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ov.classList.remove('show'); });
    addEventListener('dragover', (e) => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    addEventListener('drop', async (e) => {
      dragDepth = 0; ov.classList.remove('show');
      if (e.dataTransfer && e.dataTransfer.files.length) {
        e.preventDefault();
        const n = await VE.importFiles(e.dataTransfer.files);
        if (n) VE.toast('Đã nhập ' + n + ' file');
      }
    });
    addEventListener('keydown', onKey);
    addEventListener('contextmenu', (e) => { if (!e.target.closest('.tl-body,.tl-headers,.tl-rulerwrap,.pitem')) e.preventDefault(); });
    addEventListener('beforeunload', (e) => { if (S.clips.length && !window.__veNoPrompt) { e.preventDefault(); e.returnValue = ''; } });

    if (window.veNative) window.veNative.caps().then((c) => (VE.nativeCaps = c));
    VE.timeline.fit();
    VE.emit('settings');
    VE.persist.start();
    VE.persist.hasRecent().then((has) => {
      if (window.__veSkipStartup) return;
      VE.showStartup(has, async () => {
        VE.toast('Đang mở lại dự án…');
        await VE.persist.restore();
        VE.seek(0);
        VE.timeline.fit();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
