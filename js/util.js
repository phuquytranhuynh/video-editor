/* Tiện ích chung: DOM helper, event bus, timecode, menu, modal, toast */
(function () {
  const VE = (window.VE = window.VE || {});

  VE.$ = (s, r = document) => r.querySelector(s);
  VE.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  VE.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && k !== 'list') {
          try { el[k] = v; } catch (e) { el.setAttribute(k, v); }
        } else el.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat(Infinity).forEach((c) => {
      if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    });
    return el;
  };

  // ---- event bus ----
  const handlers = {};
  VE.on = (e, f) => ((handlers[e] = handlers[e] || []).push(f), f);
  VE.ver = 0;
  const VER_EVENTS = new Set(['change', 'props', 'media', 'thumbs', 'settings']);
  VE.emit = (e, ...a) => { if (VER_EVENTS.has(e)) VE.ver++; return emitRaw(e, ...a); };
  const emitRaw = (e, ...a) => (handlers[e] || []).slice().forEach((f) => {
    try { f(...a); } catch (err) { console.error('[' + e + ']', err); }
  });

  VE.uid = () => 'i' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  VE.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  VE.lerp = (a, b, t) => a + (b - a) * t;
  VE.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  // ---- easing ----
  VE.ease = {
    linear: (t) => t,
    smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), // easeInOutCubic
    easeIn: (t) => t * t * t,
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  };

  // ---- timecode ----
  VE.tc = function (sec, fps) {
    fps = Math.round(fps || (VE.state.settings && VE.state.settings.fps) || 30);
    sec = Math.max(0, sec || 0);
    const total = Math.round(sec * fps);
    const f = total % fps;
    let s = Math.floor(total / fps);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return p(hh) + ':' + p(mm) + ':' + p(ss) + ':' + p(f);
  };
  VE.parseTc = function (str, fps) {
    fps = Math.round(fps || VE.state.settings.fps || 30);
    str = String(str).trim();
    if (!str) return NaN;
    if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    const parts = str.split(/[:;]/).map((x) => parseInt(x, 10));
    if (parts.some(isNaN)) return NaN;
    if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return NaN;
  };
  VE.fmtDur = (s) => {
    if (!isFinite(s)) return '--:--';
    s = Math.max(0, s);
    const m = Math.floor(s / 60);
    const ss = (s % 60).toFixed(1).padStart(4, '0');
    return m + ':' + ss;
  };
  VE.fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' KB');

  // ---- download ----
  VE.download = (blob, name) => {
    const a = VE.h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };

  // ---- toast ----
  let toastTimer;
  VE.toast = (msg, ms = 2600) => {
    const t = VE.$('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  };

  // ---- popup / context menu ----
  let openMenu = null;
  VE.closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  VE.popupMenu = function (x, y, items) {
    VE.closeMenu();
    const menu = VE.h('div', { class: 'ctxmenu' });
    const build = (its, host) => {
      its.forEach((it) => {
        if (!it) return;
        if (it.sep) { host.append(VE.h('div', { class: 'sep' })); return; }
        const row = VE.h('div', { class: 'mi' + (it.disabled ? ' dis' : '') + (it.sub ? ' has-sub' : '') },
          VE.h('span', { class: 'ck' }, it.checked ? '✓' : ''),
          VE.h('span', { class: 'lb' }, it.label),
          VE.h('span', { class: 'sc' }, it.sub ? '▸' : it.shortcut || ''));
        if (it.sub) {
          const sub = VE.h('div', { class: 'ctxmenu subm' });
          build(it.sub, sub);
          row.append(sub);
        } else if (!it.disabled) {
          row.addEventListener('click', (e) => { e.stopPropagation(); VE.closeMenu(); it.action && it.action(); });
        }
        host.append(row);
      });
    };
    build(items, menu);
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(0, Math.min(x, innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(0, Math.min(y, innerHeight - r.height - 4)) + 'px';
    if (x + r.width * 2 > innerWidth) menu.classList.add('flip');
    openMenu = menu;
    setTimeout(() => {
      const off = (e) => {
        if (openMenu && !openMenu.contains(e.target)) VE.closeMenu();
        if (!openMenu) removeEventListener('mousedown', off, true);
      };
      addEventListener('mousedown', off, true);
    }, 0);
    return menu;
  };

  // ---- modal ----
  VE.modal = function ({ title, body, buttons = [], width = 520, cls = '', closable = true }) {
    const back = VE.h('div', { class: 'modal-back' });
    const box = VE.h('div', { class: 'modal ' + cls, style: { width: width + 'px' } });
    const head = VE.h('div', { class: 'modal-head' }, VE.h('span', {}, title || ''));
    const api = { el: box, body: null, close: () => back.remove() };
    if (closable) head.append(VE.h('button', { class: 'x', onclick: () => api.close(), html: VE.icon('close', 14) }));
    const bd = VE.h('div', { class: 'modal-body' });
    if (typeof body === 'string') bd.innerHTML = body; else if (body) bd.append(body);
    api.body = bd;
    const foot = VE.h('div', { class: 'modal-foot' });
    buttons.forEach((b) => {
      const btn = VE.h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => {
        const r = b.action ? b.action(api) : undefined;
        if (r !== false) api.close();
      } }, b.label);
      foot.append(btn);
    });
    box.append(head, bd);
    if (buttons.length) box.append(foot);
    back.append(box);
    document.body.append(back);
    if (closable) back.addEventListener('mousedown', (e) => { if (e.target === back) api.close(); });
    return api;
  };

  // ---- form field helpers used by dialogs & inspector ----
  VE.fieldRow = (label, control, cls) => VE.h('label', { class: 'frow ' + (cls || '') }, VE.h('span', { class: 'fl' }, label), control);

  VE.debug = () => ({ state: VE.state });
})();
