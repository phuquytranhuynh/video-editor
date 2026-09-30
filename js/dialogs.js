/* Hộp thoại: thiết lập Sequence / dự án mới, phím tắt, giới thiệu */
(function () {
  const VE = window.VE;
  const S = VE.state;
  const h = VE.h;

  // Dùng chung cho dialog Sequence & Export: nhóm trường kích thước / fps
  VE.presetSelect = function (selectedId, onPick) {
    const sel = h('select', { class: 'sel wide' }, ...VE.PRESETS.map((p) => h('option', { value: p.id }, p.name)));
    sel.value = selectedId || 'custom';
    sel.onchange = () => onPick(VE.PRESETS.find((p) => p.id === sel.value));
    return sel;
  };

  VE.showSequenceDialog = function (isNew) {
    const cur = isNew ? { name: 'Sequence 01', width: 1080, height: 1920, fps: 30, bg: '#000000', fitMode: 'fit', stillDur: 5, preset: 'tiktok' } : Object.assign({}, S.settings);
    const inName = h('input', { class: 'txtin', value: cur.name });
    const inW = h('input', { type: 'number', class: 'num', min: 16, max: 8192, value: cur.width });
    const inH = h('input', { type: 'number', class: 'num', min: 16, max: 8192, value: cur.height });
    const fpsSel = h('select', { class: 'sel' }, ...VE.FPS_LIST.map((f) => h('option', { value: f }, f + ' fps')));
    fpsSel.value = String(cur.fps);
    if (fpsSel.value !== String(cur.fps)) { fpsSel.append(h('option', { value: cur.fps }, cur.fps + ' fps')); fpsSel.value = String(cur.fps); }
    const bg = h('input', { type: 'color', class: 'clr', value: cur.bg });
    const fit = h('select', { class: 'sel wide' },
      h('option', { value: 'fit' }, 'Vừa khung (toàn bộ video nằm trong khung)'),
      h('option', { value: 'fill' }, 'Lấp đầy khung (cắt phần thừa)'),
      h('option', { value: 'none' }, 'Giữ kích thước gốc (100%)'));
    fit.value = cur.fitMode;
    const still = h('input', { type: 'number', class: 'num', min: 0.5, max: 60, step: 0.5, value: cur.stillDur });
    const refit = h('input', { type: 'checkbox', class: 'chk', checked: true });
    const info = h('div', { class: 'hint' });
    const upd = () => {
      const w = parseInt(inW.value, 10) || 0, hh = parseInt(inH.value, 10) || 0;
      info.textContent = 'Tỉ lệ khung: ' + (hh ? (w / hh).toFixed(3) : '-') + (w % 2 || hh % 2 ? '  ⚠ nên dùng số chẵn' : '');
    };
    const presetSel = VE.presetSelect(cur.preset, (p) => {
      if (p.id === 'custom') return;
      inW.value = p.w; inH.value = p.h; fpsSel.value = String(p.fps); upd();
    });
    [inW, inH].forEach((i) => i.addEventListener('input', () => { presetSel.value = 'custom'; upd(); }));
    upd();
    const body = h('div', { class: 'form' },
      VE.fieldRow('Tên sequence', inName),
      VE.fieldRow('Cài đặt sẵn', presetSel),
      VE.fieldRow('Rộng × Cao (px)', h('div', { class: 'inline' }, inW, h('span', {}, '×'), inH)),
      info,
      VE.fieldRow('Tốc độ khung', fpsSel),
      VE.fieldRow('Màu nền', bg),
      VE.fieldRow('Khi thêm clip', fit),
      VE.fieldRow('Thời lượng ảnh (s)', still),
      isNew ? null : VE.fieldRow('Fit lại clip theo khung mới', refit),
      h('div', { class: 'hint' }, isNew ? 'Thông số này thiết lập vùng làm việc (Program monitor). Bạn vẫn có thể đổi khi xuất video.' : 'Thay đổi kích thước sẽ cập nhật ngay vùng làm việc.'));
    VE.modal({
      title: isNew ? 'Dự án mới – thông số video đầu ra' : 'Sequence Settings', body, width: 520,
      buttons: [
        { label: 'Huỷ' },
        { label: isNew ? 'Tạo dự án' : 'Áp dụng', primary: true, action: () => {
          const s = {
            name: inName.value.trim() || 'Sequence 01', width: Math.max(16, parseInt(inW.value, 10) || 1920), height: Math.max(16, parseInt(inH.value, 10) || 1080),
            fps: parseInt(fpsSel.value, 10) || 30, bg: bg.value, fitMode: fit.value, stillDur: parseFloat(still.value) || 5, preset: presetSel.value,
          };
          if (isNew) {
            if (S.clips.length || S.media.length) { if (!confirm('Tạo dự án mới sẽ xoá nội dung hiện tại. Tiếp tục?')) return false; }
            VE.newProject(s);
            VE.seek(0);
          } else VE.applySettings(s, refit.checked);
        } },
      ],
    });
  };

  VE.showShortcuts = function () {
    const rows = [
      ['Space', 'Phát / dừng'], ['K / L', 'Dừng / phát (L nhấn nhiều lần: nhanh hơn)'], ['← →', 'Lùi / tiến 1 frame (Shift: 1 giây)'], ['↑ ↓', 'Nhảy tới điểm cắt trước / sau'],
      ['Home / End', 'Về đầu / cuối'], ['V', 'Công cụ Selection'], ['B', 'Ripple Edit'], ['C', 'Razor (cắt)'], ['H', 'Hand'], ['T', 'Text'], ['R', 'Shape'],
      ['Ctrl+K', 'Cắt clip tại playhead'], ['Delete', 'Xoá clip'], ['Shift+Delete', 'Xoá và dồn khoảng trống'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Hoàn tác / làm lại'], ['Ctrl+C / X / V', 'Copy / cắt / dán clip tại playhead'], ['Ctrl+A', 'Chọn tất cả'],
      ['Ctrl+I', 'Nhập media'], ['Ctrl+M', 'Xuất video'], ['M', 'Thêm marker'], ['I / O', 'Điểm In / Out (Source hoặc work area)'],
      [', / .', 'Insert / Overwrite từ Source monitor'], ['S', 'Bật/tắt Snap'], ['+ / −', 'Phóng to / thu nhỏ timeline'], ['\\', 'Timeline vừa khít'],
      ['Alt + kéo', 'Kéo clip không snap / chọn 1 clip không kéo theo liên kết'], ['Ctrl + thả clip', 'Thả từ Project với chế độ Insert'], ['Ctrl + lăn chuột', 'Thu phóng timeline'],
    ];
    VE.modal({ title: 'Phím tắt', width: 560, body: h('div', { class: 'keys' }, ...rows.map(([k, d]) => h('div', { class: 'k' }, h('kbd', {}, k), h('span', {}, d)))), buttons: [{ label: 'Đóng', primary: true }] });
  };

  VE.showAbout = function () {
    VE.modal({ title: 'Về phần mềm', width: 460, body: h('div', { class: 'about' },
      h('p', {}, h('b', {}, 'Video Editor Local')),
      h('p', {}, 'Phần mềm dựng video chạy hoàn toàn trên máy của bạn – không upload, không cần server. Bố cục tham khảo Adobe Premiere Pro.'),
      h('p', { class: 'hint' }, 'Xử lý bằng Chromium (Canvas / WebAudio / MediaRecorder). Video được ghép và mã hoá theo thời gian thực khi xuất.')), buttons: [{ label: 'Đóng', primary: true }] });
  };

  // Nhập nhiều caption một lần: mỗi dòng một caption hoặc file SRT
  VE.showCaptionImport = function () {
    const ta = h('textarea', { class: 'big', placeholder: 'Mỗi dòng là một caption. Dùng *từ khoá* để tô highlight.\nHoặc dán nội dung file .srt (có mốc thời gian).' });
    const fileIn = h('input', { type: 'file', accept: '.srt,.txt', hidden: true });
    fileIn.onchange = async () => { const f = fileIn.files[0]; if (f) ta.value = await f.text(); };
    const pre = h('select', { class: 'sel wide' }, ...VE.CAPTION_PRESETS.map((p) => h('option', { value: p.id }, p.name)));
    const start = h('input', { type: 'number', class: 'num', step: 0.1, min: 0, value: S.playhead.toFixed(2) });
    const dur = h('input', { type: 'number', class: 'num', step: 0.1, min: 0.3, value: 2.5 });
    const gap = h('input', { type: 'number', class: 'num', step: 0.1, min: 0, value: 0 });
    const sfx = h('input', { type: 'checkbox', class: 'chk', checked: S.autoSfx });
    const body = h('div', { class: 'form' },
      ta,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn mini', onclick: () => fileIn.click() }, 'Mở file .srt / .txt…'), fileIn),
      VE.fieldRow('Kiểu caption', pre),
      VE.fieldRow('Bắt đầu tại (giây)', start),
      VE.fieldRow('Thời lượng mỗi dòng (s)', dur),
      VE.fieldRow('Khoảng nghỉ giữa các dòng (s)', gap),
      VE.fieldRow('Chèn SFX cho mỗi caption', sfx),
      h('div', { class: 'hint' }, 'Nếu dán SRT, thời gian lấy theo file SRT (cộng thêm "Bắt đầu tại"); thời lượng mỗi dòng và khoảng nghỉ chỉ dùng cho chế độ mỗi dòng một caption.'));
    VE.modal({
      title: 'Nhập phụ đề hàng loạt', body, width: 560,
      buttons: [
        { label: 'Huỷ' },
        { label: 'Tạo caption', primary: true, action: () => {
          const preset = VE.CAPTION_PRESETS.find((p) => p.id === pre.value);
          const items = VE.parseCaptionText(ta.value, parseFloat(start.value) || 0, parseFloat(dur.value) || 2.5, parseFloat(gap.value) || 0);
          if (!items.length) { VE.toast('Chưa có nội dung caption'); return false; }
          VE.addCaptions(items, preset, { sfx: sfx.checked }).then((m) => VE.toast('Đã tạo ' + m.length + ' caption'));
        } },
      ],
    });
  };

  // Hộp thoại khởi động
  VE.showStartup = function (hasRecent, onRestore) {
    const body = h('div', { class: 'startup' },
      h('p', {}, 'Bắt đầu bằng cách nhập thông số video đầu ra (TikTok, Shorts, YouTube… hoặc tuỳ chỉnh). Thông số này sẽ thiết lập vùng làm việc.'));
    const m = VE.modal({
      title: 'Chào mừng', body, width: 480, closable: false,
      buttons: [
        hasRecent && { label: 'Mở lại dự án gần nhất', action: () => { onRestore(); } },
        { label: 'Dự án mới…', primary: true, action: () => { setTimeout(() => VE.showSequenceDialog(true), 0); } },
        { label: 'Dùng mặc định (YouTube 1080p)' },
      ].filter(Boolean),
    });
    return m;
  };
})();
