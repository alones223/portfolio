(() => {
  'use strict';

  // =========================================================================
  // Small helpers
  // =========================================================================

  const $ = (sel, root = document) => root.querySelector(sel);
  let uidCounter = 0;
  const uid = () => `f${++uidCounter}`;
  const rand = () => Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isVideo = (url) => /\.(mp4|webm)(\?|$)/i.test(url || '');
  const isFontFile = (url) => /\.(woff2?|ttf|otf)(\?|$)/i.test(url || '');
  const isPdf = (url) => /\.pdf(\?|$)/i.test(url || '');
  const mediaKindOf = (url) => {
    if (isFontFile(url)) return 'font';
    if (isVideo(url)) return 'video';
    if (isPdf(url)) return 'pdf';
    return 'image';
  };

  // Tiny DOM builder: h('div', { class: 'x', onclick: fn }, child, 'text', ...)
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (['value', 'checked', 'disabled', 'hidden', 'multiple', 'selected'].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // Replace an element's children, accepting the same kinds of value h() does:
  // arrays are flattened, and null / undefined / false are skipped. Passing an
  // array straight to replaceChildren() would stringify it ("[object
  // HTMLButtonElement]"), and a null would show as the literal word "null".
  function mount(target, ...children) {
    target.replaceChildren(
      ...children.flat(Infinity).filter((c) => c != null && c !== false)
    );
    return target;
  }

  function move(arr, from, to) {
    if (to < 0 || to >= arr.length || from === to) return;
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
  }

  function formatSize(bytes) {
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 2800);
  }

  async function api(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && url !== '/api/login') {
      showLogin();
      throw new Error('Your session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function uploadFiles(files) {
    files = [...files];
    if (!files.length) return [];
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    toast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    try {
      const res = await api('POST', '/api/upload', fd);
      toast(`Uploaded ${res.files.length} file${res.files.length > 1 ? 's' : ''}.`);
      if (res.files.some((f) => isFontFile(f.url))) await loadCustomFonts();
      return res.files.map((f) => f.url);
    } catch (err) {
      toast(`Upload failed: ${err.message}`, true);
      return [];
    }
  }

  function mediaPreview(url) {
    if (!url) return document.createTextNode('No image');
    if (isVideo(url)) return h('video', { src: url, muted: true, preload: 'metadata' });
    if (isPdf(url)) {
      return h('div', { class: 'pdf-thumb' },
        h('iframe', { src: url, title: 'PDF', loading: 'lazy', tabindex: '-1' }),
        h('span', { class: 'pdf-badge' }, 'PDF'));
    }
    if (isFontFile(url)) {
      const hit = (window.CanvasFonts || []).find((font) => font.url === url);
      return h('span', { class: 'font-sample', style: hit ? `font-family:${hit.css}` : '' }, 'Ag');
    }
    return h('img', { src: url, alt: '', loading: 'lazy' });
  }

  function rewriteUploadUrls(node, fromUrl, toUrl) {
    if (typeof node === 'string') return node === fromUrl ? toUrl : node;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = rewriteUploadUrls(node[i], fromUrl, toUrl);
      return node;
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) node[key] = rewriteUploadUrls(node[key], fromUrl, toUrl);
    }
    return node;
  }

  function applyMediaRenameLocally(fromUrl, toUrl) {
    if (!content || !fromUrl || !toUrl || fromUrl === toUrl) return;
    rewriteUploadUrls(content, fromUrl, toUrl);
    try {
      const saved = JSON.parse(savedJson);
      rewriteUploadUrls(saved, fromUrl, toUrl);
      savedJson = JSON.stringify(saved);
    } catch { /* ignore */ }
    changed();
  }

  async function loadCustomFonts() {
    try {
      window.CanvasFonts = await api('GET', '/api/fonts');
    } catch (err) {
      window.CanvasFonts = window.CanvasFonts || [];
      return;
    }
    let style = document.getElementById('custom-fonts');
    if (!style) {
      style = document.createElement('style');
      style.id = 'custom-fonts';
      document.head.append(style);
    }
    style.textContent = (window.CanvasFonts || []).map((font) => {
      const family = String(font.family || '').replace(/[^A-Za-z0-9 .]/g, '').trim();
      const url = String(font.url || '');
      if (!family || !url.startsWith('/uploads/')) return '';
      const ext = (url.split('.').pop() || '').toLowerCase();
      const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype';
      return `@font-face{font-family:"${family}";src:url("${url}") format("${format}");font-display:swap;}`;
    }).join('\n');

    if (document.fonts && document.fonts.load) {
      await Promise.all((window.CanvasFonts || []).map((font) => {
        const family = String(font.family || '').replace(/[^A-Za-z0-9 ._-]/g, '').trim();
        if (!family) return null;
        return document.fonts.load('16px "' + family + '"').catch(() => {});
      }).filter(Boolean));
    }
    liveEditors.forEach((editor) => {
      try { if (editor && typeof editor.refitAutoFits === 'function') editor.refitAutoFits(); } catch (err) { /* ignore */ }
    });
  }

  const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');

  // Let users drop image files onto an element.
  function addFileDrop(el, onFiles) {
    el.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop');
      onFiles([...e.dataTransfer.files]);
    });
  }

  // Stop the browser from opening a file if it is dropped outside a drop area.
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

  // =========================================================================
  // State
  // =========================================================================

  let content = null;     // working copy being edited
  let savedJson = '';     // last saved version, to detect unsaved changes
  let hasSavedOnce = false;
  let unread = 0;
  const openPanels = new WeakSet(); // which section panels are expanded
  const openPanelIds = new Set();   // same set, by id, so undo can reopen them
  const editorMode = new Map();     // section id -> 'form' | 'canvas' (admin only)
  function setPanelOpen(s, open) {
    if (!s) return;
    if (open) {
      openPanels.add(s);
      if (s.id) openPanelIds.add(s.id);
    } else {
      openPanels.delete(s);
      if (s.id) openPanelIds.delete(s.id);
    }
  }
  function panelIsOpen(s) {
    if (!s) return false;
    if (s.id && openPanelIds.has(s.id)) {
      openPanels.add(s);
      return true;
    }
    return openPanels.has(s);
  }
  // Live layout editors, held outside the content object so they are never saved.
  const editors = new WeakMap();
  const liveEditors = new Set();

  const isDirty = () => content && JSON.stringify(content) !== savedJson;

  let sidebarTimer;
  // One undo stack for the whole admin. A burst of typing or a drag is one
  // step; a button, a menu, or a new layer is its own step.
  let editHistory = [];
  let editAt = -1;
  let editCoalesce = false;
  let editTimer = null;
  let restoringEdit = false;
  const EDIT_MAX = 100;

  function resetEditHistory() {
    editHistory = content ? [JSON.stringify(content)] : [];
    editAt = editHistory.length - 1;
    editCoalesce = false;
    clearTimeout(editTimer);
  }

  function armEditCoalesce() {
    editCoalesce = true;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => { editCoalesce = false; }, 500);
  }

  function recordEdit(coalesce) {
    if (restoringEdit || !content) return;
    const snap = JSON.stringify(content);
    if (editHistory[editAt] === snap) {
      if (coalesce) armEditCoalesce();
      return;
    }
    if (coalesce && editCoalesce) {
      editHistory[editAt] = snap;
    } else {
      editHistory = editHistory.slice(0, editAt + 1);
      editHistory.push(snap);
      if (editHistory.length > EDIT_MAX) editHistory.shift();
      editAt = editHistory.length - 1;
    }
    if (coalesce) armEditCoalesce();
    else {
      editCoalesce = false;
      clearTimeout(editTimer);
    }
  }

  function destroyLiveEditors() {
    liveEditors.forEach((editor) => {
      try { editor.destroy(); editor.destroyed = true; } catch (err) { /* already gone */ }
    });
    liveEditors.clear();
  }

  function applyEditSnapshot(snap) {
    restoringEdit = true;
    editCoalesce = false;
    clearTimeout(editTimer);
    content = JSON.parse(snap);
    changed();
    render({ keepScroll: true });
    restoringEdit = false;
  }

  function undoEdit() {
    if (editAt <= 0) return;
    editAt -= 1;
    applyEditSnapshot(editHistory[editAt]);
  }

  function redoEdit() {
    if (editAt < 0 || editAt >= editHistory.length - 1) return;
    editAt += 1;
    applyEditSnapshot(editHistory[editAt]);
  }

  function changed(opts) {
    const dirty = isDirty();
    $('#save').disabled = !dirty;
    $('#discard').hidden = !dirty;
    const state = $('#save-state');
    state.textContent = dirty ? 'Unsaved changes' : hasSavedOnce ? 'All changes saved' : '';
    state.classList.toggle('dirty', dirty);
    clearTimeout(sidebarTimer);
    sidebarTimer = setTimeout(renderSidebar, 150);
    recordEdit(Boolean(opts && opts.coalesce));
  }

  async function save() {
    if (!isDirty()) return;
    $('#save').disabled = true;
    $('#save-state').textContent = 'Saving…';
    try {
      await api('PUT', '/api/content', content);
      savedJson = JSON.stringify(content);
      hasSavedOnce = true;
      toast('Saved — your website is updated.');
    } catch (err) {
      toast(err.message, true);
    }
    changed();
  }

  function discard() {
    if (!confirm('Throw away all unsaved changes?')) return;
    content = JSON.parse(savedJson);
    changed();
    render();
  }

  // =========================================================================
  // Form field builders. Each one edits obj[key] in place.
  // =========================================================================

  function wrapField(label, control, opts = {}, id) {
    return h('div', { class: `field span-${opts.span || 4}` },
      label ? h('label', { class: 'field-label', for: id }, label) : null,
      control,
      opts.hint ? h('p', { class: 'hint' }, opts.hint) : null);
  }

  function textField(obj, key, label, opts = {}) {
    const id = uid();
    const input = opts.multiline
      ? h('textarea', { id, rows: opts.rows || 3 })
      : h('input', { id, type: 'text' });
    input.value = obj[key] ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.list) input.setAttribute('list', opts.list);
    input.addEventListener('input', () => {
      let v = input.value;
      if (opts.transform) {
        const t = opts.transform(v);
        if (t !== v) {
          const pos = input.selectionStart - (v.length - t.length);
          input.value = t;
          input.setSelectionRange(pos, pos);
          v = t;
        }
      }
      obj[key] = v;
      if (opts.onInput) opts.onInput(v);
      changed({ coalesce: true });
    });
    let control = input;
    if (opts.prefix) control = h('div', { class: 'prefix-input' }, h('span', null, opts.prefix), input);
    return wrapField(label, control, opts, id);
  }

  function modeSelect(current, label, options, onPick) {
    const id = uid();
    const sel = h('select', { id },
      options.map(([value, text]) => h('option', { value: String(value), selected: current === String(value) }, text)));
    sel.addEventListener('change', () => onPick(sel.value));
    return wrapField(label, sel, { span: 2 }, id);
  }

  function selectField(obj, key, label, options, opts = {}) {
    const id = uid();
    const sel = h('select', { id },
      options.map(([value, text]) => h('option', { value: String(value), selected: String(obj[key]) === String(value) }, text)));
    sel.addEventListener('change', () => {
      obj[key] = opts.number ? Number(sel.value) : sel.value;
      changed();
      if (opts.onChange) opts.onChange(obj[key]);
    });
    return wrapField(label, sel, opts, id);
  }

  function checkField(obj, key, label, opts = {}) {
    // A missing value counts as "on" (e.g. pages show in the menu unless turned off).
    const input = h('input', { type: 'checkbox', checked: obj[key] !== false });
    input.addEventListener('change', () => {
      obj[key] = input.checked;
      if (opts.onChange) opts.onChange(obj[key]);
      changed();
    });
    return h('div', { class: `field span-${opts.span || 4}` },
      h('label', { class: 'field check' }, input, label),
      opts.hint ? h('p', { class: 'hint' }, opts.hint) : null);
  }

  function numField(obj, key, label, opts = {}) {
    const id = uid();
    const input = h('input', {
      id, type: 'number',
      min: opts.min != null ? String(opts.min) : '',
      max: opts.max != null ? String(opts.max) : '',
      step: opts.step != null ? String(opts.step) : '1',
    });
    input.value = obj[key] ?? '';
    input.addEventListener('input', () => {
      if (input.value === '') obj[key] = '';
      else {
        const n = Number(input.value);
        if (Number.isFinite(n)) obj[key] = n;
      }
      if (opts.onInput) opts.onInput(obj[key]);
      changed({ coalesce: true });
    });
    return wrapField(label, input, opts, id);
  }

  function parseCssColor(value) {
    const v = String(value || '').trim();
    const hex6 = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex6) return { hex: `#${hex6[1].toUpperCase()}`, alpha: 1 };
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
    if (rgb) {
      const hex = '#' + [rgb[1], rgb[2], rgb[3]]
        .map((n) => Math.min(255, Math.max(0, Number(n))).toString(16).padStart(2, '0')).join('').toUpperCase();
      const alpha = rgb[4] == null ? 1 : Math.min(1, Math.max(0, Number(rgb[4])));
      return { hex, alpha };
    }
    return { hex: '#FDFDFD', alpha: 1 };
  }

  function formatCssColor(hex, alpha) {
    const solid = String(hex || '#FDFDFD').toUpperCase();
    if (alpha >= 0.995) return solid;
    const r = parseInt(solid.slice(1, 3), 16);
    const g = parseInt(solid.slice(3, 5), 16);
    const b = parseInt(solid.slice(5, 7), 16);
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function colorAlphaField(obj, key, label, opts = {}) {
    const parsed = parseCssColor(obj[key]);
    const color = h('input', { type: 'color', value: parsed.hex, 'aria-label': `${label} colour` });
    const text = h('input', { type: 'text', value: obj[key] || '', placeholder: 'None' });
    const alpha = h('input', {
      type: 'range', min: '0', max: '100', step: '1',
      value: String(Math.round((obj[key] ? parsed.alpha : 1) * 100)),
      'aria-label': `${label} opacity`,
    });
    const read = h('span', { class: 'alpha-read' }, `${alpha.value}%`);
    const write = () => {
      obj[key] = formatCssColor(color.value, Number(alpha.value) / 100);
      text.value = obj[key];
      read.textContent = `${alpha.value}%`;
      if (opts.onInput) opts.onInput(obj[key]);
      changed({ coalesce: true });
    };
    color.addEventListener('input', write);
    alpha.addEventListener('input', write);
    text.addEventListener('input', () => {
      obj[key] = text.value.trim();
      const next = parseCssColor(obj[key]);
      if (obj[key]) {
        color.value = next.hex;
        alpha.value = String(Math.round(next.alpha * 100));
        read.textContent = `${alpha.value}%`;
      }
      if (opts.onInput) opts.onInput(obj[key]);
      changed({ coalesce: true });
    });
    text.addEventListener('change', () => {
      if (!text.value.trim()) {
        obj[key] = '';
        read.textContent = '100%';
        if (opts.onInput) opts.onInput('');
        changed();
      }
    });
    const palette = window.CanvasEditor.palette.mount({
      getColor: () => formatCssColor(color.value, Number(alpha.value) / 100),
      onPick: (value) => {
        obj[key] = value;
        text.value = value;
        const next = parseCssColor(value);
        color.value = next.hex;
        alpha.value = String(Math.round(next.alpha * 100));
        read.textContent = `${alpha.value}%`;
        window.CanvasEditor.palette.remember(value);
        palette.paint();
        if (opts.onInput) opts.onInput(value);
        changed();
      },
    });
    const noteColor = (value) => {
      window.CanvasEditor.palette.remember(value);
      palette.paint();
    };
    color.addEventListener('change', () => noteColor(formatCssColor(color.value, Number(alpha.value) / 100)));
    alpha.addEventListener('change', () => noteColor(formatCssColor(color.value, Number(alpha.value) / 100)));
    return wrapField(label, h('div', { class: 'color-input' }, color, text, alpha, read, palette.el), {
      span: 2,
      hint: 'The slider sets how see-through the background is. Clear the text to remove it.',
      ...opts,
    });
  }

  function colorField(obj, key, label, opts = {}) {
    const id = uid();
    const shown = obj[key] || opts.fallback || '#000000';
    const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(shown) ? shown : '#000000', 'aria-label': `${label} color picker` });
    const text = h('input', { id, type: 'text', value: obj[key] || opts.fallback || '' });
    const palette = window.CanvasEditor.palette.mount({
      getColor: () => color.value,
      onPick: (value) => {
        const hex = /^#([0-9a-f]{6})/i.exec(value);
        obj[key] = hex ? `#${hex[1].toUpperCase()}` : value;
        text.value = obj[key];
        if (hex) color.value = obj[key];
        window.CanvasEditor.palette.remember(obj[key]);
        palette.paint();
        changed();
      },
    });
    color.addEventListener('input', () => { obj[key] = color.value.toUpperCase(); text.value = obj[key]; changed({ coalesce: true }); });
    color.addEventListener('change', () => { window.CanvasEditor.palette.remember(obj[key]); palette.paint(); });
    text.addEventListener('input', () => {
      obj[key] = text.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(obj[key])) color.value = obj[key];
      changed({ coalesce: true });
    });
    text.addEventListener('change', () => { window.CanvasEditor.palette.remember(obj[key]); palette.paint(); });
    return wrapField(label, h('div', { class: 'color-input' }, color, text, palette.el), { span: 2, ...opts }, id);
  }

  function imageField(obj, key, label, opts = {}) {
    const thumb = h('div', { class: 'img-thumb', title: 'Click to choose an image, or drop a file here' });
    const url = h('input', { type: 'text', placeholder: '/uploads/… or https://…', 'aria-label': `${label} URL` });
    const paint = () => {
      thumb.replaceChildren(mediaPreview(obj[key]));
      url.value = obj[key] || '';
    };
    const set = (v) => { obj[key] = v; paint(); changed(); if (opts.onChange) opts.onChange(v); };
    const choose = async () => { const v = await pickImage(); if (v) set(v); };
    thumb.addEventListener('click', choose);
    addFileDrop(thumb, async (files) => { const [v] = await uploadFiles(files.slice(0, 1)); if (v) set(v); });
    url.addEventListener('change', () => set(url.value.trim()));
    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
    fileIn.addEventListener('change', async () => {
      const [v] = await uploadFiles(fileIn.files);
      fileIn.value = '';
      if (v) set(v);
    });
    paint();
    return wrapField(label,
      h('div', { class: 'img-field' },
        thumb,
        h('div', { class: 'img-side' },
          h('div', { class: 'img-buttons' },
            h('button', { class: 'btn small', type: 'button', onclick: choose }, 'Choose from library'),
            h('button', { class: 'btn small', type: 'button', onclick: () => fileIn.click() }, 'Upload new'),
            opts.removable === false ? null : h('button', { class: 'btn small danger', type: 'button', onclick: () => set('') }, 'Remove'),
            fileIn),
          url)),
      opts);
  }

  function iconBtn(symbol, title, onclick, opts = {}) {
    return h('button', {
      class: `icon-btn${opts.danger ? ' danger' : ''}`,
      type: 'button', title, 'aria-label': title, disabled: opts.disabled,
      onclick: (e) => { e.stopPropagation(); onclick(e); },
    }, symbol);
  }

  // A simple list of rows (social links, buttons…)
  function rowList(arr, { label, row, create, addLabel, empty }) {
    const wrap = h('div', { class: 'list' });
    const draw = () => {
      mount(wrap,
        h('div', { class: 'list-head' },
          h('span', { class: 'field-label' }, label),
          h('button', { class: 'btn small', type: 'button', onclick: () => { arr.push(create()); changed(); draw(); } }, addLabel)),
        arr.length ? null : h('div', { class: 'list-empty' }, empty || 'Nothing here yet.'),
        arr.map((item, i) =>
          h('div', { class: 'panel flat' },
            h('div', { class: 'panel-body' },
              h('div', { class: 'fields' },
                row(item, i),
                h('div', { class: 'field span-1', style: 'flex-direction:row;align-items:flex-end;gap:4px' },
                  iconBtn('↑', 'Move up', () => { move(arr, i, i - 1); changed(); draw(); }, { disabled: i === 0 }),
                  iconBtn('↓', 'Move down', () => { move(arr, i, i + 1); changed(); draw(); }, { disabled: i === arr.length - 1 }),
                  iconBtn('✕', 'Remove', () => { arr.splice(i, 1); changed(); draw(); }, { danger: true })))))));
    };
    draw();
    return wrap;
  }

  // Grid of image tiles with captions: drag to reorder, drop files to add.
  let drag = null;
  function tilesEditor(arr, opts = {}) {
    const captionKey = opts.captionKey || 'caption';
    const wrap = h('div', { class: 'list' });
    const touch = (arg) => { changed(arg); if (opts.onEdit) opts.onEdit(); };

    const addUrls = (urls, at = arr.length) => {
      const items = urls.map((url) => {
        const item = { image: url, [captionKey]: '', link: '' };
        if (opts.showWide) item.wide = false;
        return item;
      });
      arr.splice(at, 0, ...items);
      touch();
      draw();
    };

    function tile(item, i) {
      const img = h('div', { class: 'tile-img', title: 'Click to replace this image, or drop a file on it' },
        mediaPreview(item.image),
        h('span', { class: 'num' }, pad2(i + 1)));
      img.addEventListener('click', async () => {
        const url = await pickImage();
        if (url) { item.image = url; touch(); draw(); }
      });
      addFileDrop(img, async (files) => {
        const [url] = await uploadFiles(files.slice(0, 1));
        if (url) { item.image = url; touch(); draw(); }
      });

      const caption = h('textarea', { rows: 2, placeholder: opts.captionLabel || 'Caption (optional)', 'aria-label': 'Caption' });
      caption.value = item[captionKey] || '';
      caption.addEventListener('input', () => { item[captionKey] = caption.value; touch({ coalesce: true }); });

      let link = null;
      if (opts.showLink !== false) {
        link = h('input', { type: 'text', placeholder: opts.linkPlaceholder || 'Link (optional)', 'aria-label': 'Link', list: 'page-links' });
        link.value = item.link || '';
        link.addEventListener('input', () => { item.link = link.value.trim(); touch({ coalesce: true }); });
      }

      let wide = null;
      if (opts.showWide) {
        const cb = h('input', { type: 'checkbox', checked: !!item.wide });
        cb.addEventListener('change', () => { item.wide = cb.checked; changed(); });
        wide = h('label', { class: 'field check' }, cb, 'Full width');
      }

      const handle = h('span', { class: 'icon-btn tile-drag', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⠿');
      const el = h('div', { class: 'tile' },
        img,
        h('div', { class: 'tile-body' }, caption, link, wide),
        h('div', { class: 'tile-bar' },
          h('span', { class: 'group-btns' },
            handle,
            iconBtn('←', 'Move earlier', () => { move(arr, i, i - 1); touch(); draw(); }, { disabled: i === 0 }),
            iconBtn('→', 'Move later', () => { move(arr, i, i + 1); touch(); draw(); }, { disabled: i === arr.length - 1 })),
          h('span', { class: 'group-btns' },
            iconBtn('✕', 'Remove from page', () => { arr.splice(i, 1); touch(); draw(); }, { danger: true }))));

      // Only the handle starts a drag, so text in the caption can still be selected.
      handle.addEventListener('mousedown', () => { el.draggable = true; });
      el.addEventListener('dragstart', (e) => {
        drag = { arr, from: i };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('dragging'); drag = null; });
      el.addEventListener('dragover', (e) => {
        if (drag && drag.arr === arr) { e.preventDefault(); el.classList.add('drag-over'); }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('drag-over');
        if (drag && drag.arr === arr) {
          e.preventDefault();
          move(arr, drag.from, i);
          drag = null;
          touch();
          draw();
        }
      });
      return el;
    }

    function dropzone() {
      const fileIn = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm', multiple: true, hidden: true });
      fileIn.addEventListener('change', async () => {
        const urls = await uploadFiles(fileIn.files);
        fileIn.value = '';
        if (urls.length) addUrls(urls);
      });
      const zone = h('div', { class: 'dropzone' },
        h('span', null, 'Drop images here, or'),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => fileIn.click() }, 'Upload images'),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: async () => { const url = await pickImage(); if (url) addUrls([url]); },
        }, 'Choose from library'),
        fileIn);
      addFileDrop(zone, async (files) => {
        const urls = await uploadFiles(files);
        if (urls.length) addUrls(urls);
      });
      return zone;
    }

    function draw() {
      mount(wrap,
        h('div', { class: 'list-head' },
          h('span', { class: 'field-label' }, `${opts.label || 'Images'} (${arr.length})`),
          arr.length > 1 ? h('span', { class: 'hint' }, 'Drag ⠿ or use the arrows to reorder.') : null),
        h('div', { class: 'tiles' }, arr.map(tile), dropzone()));
    }

    draw();
    return wrap;
  }

  // =========================================================================
  // Media picker dialog
  // =========================================================================

  let pickerResolve = null;
  const picker = $('#picker');

  function finishPick(url) {
    const resolve = pickerResolve;
    pickerResolve = null;
    if (picker.open) picker.close();
    if (resolve) resolve(url);
  }

  picker.addEventListener('close', () => finishPick(null));
  $('#picker-close').addEventListener('click', () => finishPick(null));
  $('#picker-upload').addEventListener('change', async (e) => {
    const urls = await uploadFiles(e.target.files);
    e.target.value = '';
    if (urls.length) finishPick(urls[0]);
  });
  addFileDrop(picker, async (files) => {
    const urls = await uploadFiles(files.slice(0, 1));
    if (urls.length) finishPick(urls[0]);
  });

  async function pickImage() {
    const grid = $('#picker-grid');
    const search = $('#picker-search');
    const folderSel = $('#picker-folder');
    search.value = '';
    mount(folderSel, h('option', { value: ALL_FOLDER }, 'All files'));
    mount(grid, h('p', { class: 'muted' }, 'Loading…'));
    picker.showModal();
    const result = new Promise((resolve) => { pickerResolve = resolve; });
    try {
      const [files, pageFolders] = await Promise.all([api('GET', '/api/media'), api('GET', '/api/media/folders')]);
      mount(folderSel, mediaFolderList(pageFolders).map((folder) => h('option', { value: folder.id },
        `${folder.label} (${files.filter((f) => inMediaFolder(f, folder.id)).length})`)));
      folderSel.value = ALL_FOLDER;
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const list = files.filter((f) => f.name.toLowerCase().includes(q) && inMediaFolder(f, folderSel.value));
        mount(grid, 
          list.length ? null : h('p', { class: 'muted' }, 'No images found. Upload one with the button above, or drop a file here.'),
          list.map((f) => h('button', { type: 'button', title: f.name, onclick: () => finishPick(f.url) },
            h('div', { class: 'tile-img' }, mediaPreview(f.url)))));
      };
      search.oninput = draw;
      folderSel.onchange = draw;
      draw();
    } catch (err) {
      mount(grid, h('p', { class: 'muted' }, err.message));
    }
    return result;
  }

  // =========================================================================
  // Views
  // =========================================================================

  const LAYOUTS = [
    ['canvas', 'Layout canvas: freely placed text, images and image groups on a board'],
    ['gallery', 'Gallery: tiles, number and caption on hover, click to enlarge'],
    ['case', 'Case study: brief, process and outcome'],
    ['works', 'Cell grid'],
  ];
  const ASPECTS = [
    ['square', 'Square crop'],
    ['natural', 'Original shape (no crop)'],
    ['4:3', '4:3 landscape'],
    ['16:9', '16:9 wide'],
    ['4:5', '4:5 portrait'],
    ['3:4', '3:4 portrait'],
  ];
  const SOCIAL_TYPES = [
    ['instagram', 'Instagram'], ['x', 'X (Twitter)'], ['facebook', 'Facebook'], ['youtube', 'YouTube'],
    ['pixiv', 'pixiv'], ['behance', 'Behance'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'],
    ['email', 'Email'], ['website', 'Other website'],
  ];
  const THEME_LABELS = {
    headerBg: 'Menu bar background',
    menuText: 'Menu text',
  };

  const card = (title, ...children) => h('section', { class: 'card' }, title ? h('h3', null, title) : null, ...children);
  const fields = (...children) => h('div', { class: 'fields' }, ...children);

  function viewSite() {
    const s = content.site;
    s.theme = s.theme || {};
    s.fonts = s.fonts || {};
    s.socials = s.socials || [];
    return [
      h('p', { class: 'intro' }, 'Settings shared by every page: the header, footer, colors and fonts.'),
      card('General',
        fields(
          textField(s, 'title', 'Website name (shown in the browser tab)', { span: 2 }),
          textField(s, 'name', 'Your name (footer)', { span: 2 }),
          imageField(s, 'logo', 'Logo (top-left of every page)', { span: 4 }),
          textField(s, 'email', 'Email address', { span: 2 }),
          textField(s, 'footerContactTitle', 'Footer contact heading', { span: 2 }),
          textField(s, 'copyright', 'Copyright line', { span: 3 }),
          textField(s, 'homeNavLabel', 'Menu label for the home page', { span: 1 }))),
      card('Social links',
        h('p', { class: 'hint', style: 'margin-bottom:12px' }, 'Shown in the contact section and the footer.'),
        fields(rowList(s.socials, {
          label: 'Links',
          addLabel: '+ Add link',
          create: () => ({ type: 'instagram', url: '' }),
          row: (item) => [
            selectField(item, 'type', 'Type', SOCIAL_TYPES, { span: 1 }),
            textField(item, 'url', 'URL', { span: 2, placeholder: 'https://…  (for email use mailto:you@example.com)' }),
          ],
        }))),
      card('Colors',
        h('p', { class: 'hint', style: 'margin-bottom:12px' }, 'These colours only change the menu bar at the top of the site.'),
        fields(
          colorField(s.theme, 'headerBg', THEME_LABELS.headerBg),
          colorField(s.theme, 'menuText', THEME_LABELS.menuText, { fallback: s.theme.navy || '#0A192F' }))),
      card('Fonts',
        h('p', { class: 'hint', style: 'margin-bottom:12px' },
          'Any font from fonts.google.com. Type the exact name, optionally followed by weights, e.g. "Playfair Display:wght@400;500".'),
        fields(
          textField(s.fonts, 'display', 'Display font (menu, page titles)', { span: 4 }),
          textField(s.fonts, 'serif', 'Decorative serif (big words, product titles)', { span: 4 }),
          textField(s.fonts, 'body', 'Body text font', { span: 4 }))),
    ];
  }

  // The same layout board used by page sections, mounted on the home Hero and
  // Works cards. One editor instance per section object, dropped on the next
  // full redraw so it is never saved with the content.
  function attachCanvasEditor(section, host, onEdit, editorOpts = {}) {
    if (section && section.id) host.dataset.canvasKey = section.id;
    const existing = editors.get(section);
    if (existing && !existing.destroyed) {
      if (existing.element.parentNode !== host) host.replaceChildren(existing.element);
      return;
    }
    if (existing) editors.delete(section);
    const editor = window.CanvasEditorUI.createLayoutEditor({
      section,
      lockWidthToScreen: editorOpts.lockWidthToScreen,
      fixedBoard: editorOpts.fixedBoard === true,
      onChange: () => {
        const current = editors.get(section);
        changed({ coalesce: Boolean(current && current.isGesturing()) });
        if (onEdit) onEdit();
      },
      onUndo: () => undoEdit(),
      onRedo: () => redoEdit(),
      canUndo: () => editAt > 0,
      canRedo: () => editAt >= 0 && editAt < editHistory.length - 1,
      onRequestImage: () => pickImage(),
      onRequestFiles: (files) => uploadFiles(files),
    });
    editor.destroyed = false;
    editors.set(section, editor);
    liveEditors.add(editor);
    host.replaceChildren(editor.element);
  }

  // Default hero: the teal water photograph, "ILLUSTRATOR WORK" with the
  // light-blue bar behind the lower half of the title, a short white rule,
  // and the subtitle. Positions are on the 1425×774 board.
  const HERO_WATER = '/uploads/0b0535_3503c79805ef4c88a6c371464ba316f1.jpg';

  function seedHeroCanvas(hero) {
    hero.id = hero.id || 's-home-hero';
    hero.heading = hero.heading || 'Hero';
    hero.layout = 'canvas';
    hero.canvasLock = true;
    hero.layers = Array.isArray(hero.layers) ? hero.layers : [];
    if (hero.layers.length) {
      hero.canvasHeight = Number(hero.canvasHeight) || 774;
      hero.canvasImage = hero.canvasImage || HERO_WATER;
      return;
    }
    hero.canvasHeight = 774;
    hero.canvasBg = '';
    hero.canvasImage = HERO_WATER;
    const add = (type, patch) => hero.layers.push(window.CanvasEditor.defaultLayer(type, patch));
    add('shape', {
      name: 'Title highlight', x: 347, y: 306, w: 730, h: 42,
      bg: '#95B8FE', radius: 4, shape: 'rect', z: 2, animated: true, anim: 'up', duration: 0.9, delay: 0,
    });
    add('heading', {
      name: 'Title', text: 'ILLUSTRATOR WORK', x: 262, y: 281, w: 900, h: 64,
      size: 53, weight: 400, align: 'center', color: '#0A192F', font: 'var(--font-display)',
      lineHeight: 1, z: 3, anim: 'up', duration: 0.9, delay: 0,
    });
    add('divider', {
      name: 'Rule', x: 686, y: 384, w: 54, h: 2, color: '#FFFFFF',
      z: 4, animated: true, anim: 'fade', duration: 0.9, delay: 0.1,
    });
    add('text', {
      name: 'Subtitle', text: 'A selection of my works using illustrator to create.',
      x: 262, y: 456, w: 900, h: 32, size: 18, weight: 900, align: 'center',
      color: '#FDFDFD', font: 'Arial, Helvetica, sans-serif', lineHeight: 1.1,
      textShadow: true, z: 5, anim: 'up', duration: 0.9, delay: 0.15,
    });
  }

  // Works starts from the heading, faint word, description and category cards
  // already on the home page, placed on the same 1425px board.
  function seedWorksCanvas(works) {
    works.id = works.id || 's-home-works';
    works.heading = works.heading || 'Works';
    works.layout = 'canvas';
    works.canvasLock = true;
    works.layers = Array.isArray(works.layers) ? works.layers : [];
    if (works.layers.length) {
      works.canvasHeight = Number(works.canvasHeight) || 1600;
      return;
    }
    works.canvasHeight = 1600;
    works.canvasBg = '';
    const add = (type, patch) => works.layers.push(window.CanvasEditor.defaultLayer(type, patch));
    const decor = works.decorText || 'WO\nRKS';
    add('heading', {
      name: 'Ghost word', text: decor, x: 10, y: 20, w: 500, h: 340,
      size: 148, weight: 500, align: 'right', color: '#F2F4F7', font: 'var(--font-serif)',
      lineHeight: 0.9, letterSpacing: 2, rotate: 180, z: 1, animated: false, anim: 'none',
    });
    add('shape', {
      name: 'Heading highlight', x: 71, y: 293, w: 232, h: 42,
      bg: '#95B8FE', radius: 4, shape: 'rect', z: 2, animated: true, anim: 'up', duration: 0.9, delay: 0,
    });
    add('heading', {
      name: 'Heading', text: works.heading || 'Works', x: 79, y: 268, w: 420, h: 70,
      size: 53, weight: 400, align: 'left', color: '#0A192F', font: 'var(--font-display)',
      lineHeight: 1, z: 3, anim: 'up', duration: 0.9, delay: 0,
    });
    add('text', {
      name: 'Description', text: works.description || '', x: 79, y: 400, w: 390, h: 200,
      size: 18, weight: 400, align: 'left', color: '#4F5E75', lineHeight: 1.35,
      hugging: true, z: 4, anim: 'fade', duration: 0.9, delay: 0.15,
    });
    add('gallery', {
      name: 'Category cards', x: 545, y: 165, w: 857, h: 1290,
      columns: 2, gap: 5, aspect: 'square', fit: 'cover', z: 5, anim: 'up', duration: 0.9, delay: 0.1,
      images: (works.cards || []).map((c) => ({ image: c.image || '', caption: c.label || '', link: c.link || '' })),
    });
    add('heading', {
      name: 'Ghost word (bottom)', text: decor, x: 23, y: 1220, w: 460, h: 300,
      size: 140, weight: 500, align: 'left', color: '#F2F4F7', font: 'var(--font-serif)',
      lineHeight: 0.9, z: 1, animated: false, anim: 'none',
    });
  }

  // The hero is always a canvas. Apply, save, and copy sit under the board.
  function homeCanvasCard({ title, block, seed, hint, extra, sections, layoutPage, layoutKind, layoutName }) {
    seed(block);
    const host = h('div', { class: 'canvas-host' });
    attachCanvasEditor(block, host);
    const rerender = () => render({ keepScroll: true, scrollY: window.scrollY });
    const layoutButtons = h('div', { class: 'cv-btnrow', style: 'margin-top:8px' },
      h('button', {
        class: 'btn small', type: 'button',
        onclick: async () => {
          try {
            const id = await applySavedLayout(block);
            if (!id) return;
            block.layout = 'canvas';
            changed();
            rerender();
            toast('Applied a copy of that layout. The template itself is unchanged.');
          } catch (err) { toast(err.message, true); }
        },
      }, 'Apply a saved layout'),
      h('button', {
        class: 'btn small', type: 'button',
        onclick: () => {
          const payload = clone(block);
          payload.layout = 'canvas';
          saveSectionLayout(payload, layoutPage || 'Home', {
            suggested: layoutName || block.heading || title || 'Hero',
            kind: layoutKind || 'hero',
          });
        },
      }, 'Save this layout'),
      sections ? h('button', {
        class: 'btn small', type: 'button',
        onclick: async () => {
          const copy = await copySectionOnServer(block);
          copy.layout = 'canvas';
          sections.push(copy);
          setPanelOpen(copy, true);
          changed();
          rerender();
          toast('Copied the hero as a new section under the hero.');
        },
      }, 'Copy as a new section') : null);
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', null, title)),
      h('p', { class: 'hint', style: 'margin-bottom:12px' }, hint),
      host,
      layoutButtons,
      h('p', { class: 'hint', style: 'margin-top:10px' },
        'Drag a layer in any direction. Arrow keys nudge it. Drag a corner to resize it, and the round handle above it to rotate it.'),
      extra || null);
  }

  // This card belongs to this portfolio only. It is not a canvas section and
  // it is not offered in the section template library.
  function aboutCardFields(home) {
    const data = home.aboutCard && typeof home.aboutCard === 'object' ? home.aboutCard : { intro: '', video: '' };
    home.aboutCard = data;
    const board = data.board && typeof data.board === 'object' ? data.board : {};
    data.board = board;
    board.id = board.id || 'about-card-front';
    board.layout = 'canvas';
    board.heading = board.heading || 'About card';
    // Same size as the public card (.namecard max-width 640, 640x400 board).
    board.canvasWidth = 640;
    board.canvasHeight = 400;
    delete board.canvasWidthMode;
    if (typeof board.canvasBg !== 'string') board.canvasBg = '';
    board.layers = Array.isArray(board.layers) ? board.layers : [];
    board.layers = board.layers.filter((l) => !(l && l.type === 'gallery'
      && !(l.images || []).some((i) => i && i.image)));
    if (!board.layers.length) {
      const add = (type, patch) => board.layers.push(window.CanvasEditor.defaultLayer(type, patch));
      add('text', {
        name: 'Intro', text: data.intro || '', x: 28, y: 28, w: 584, h: 260,
        size: 14, weight: 400, lineHeight: 1.5, align: 'left', hugging: false, z: 1, animated: false, anim: 'none',
      });
      add('text', {
        name: 'Email', x: 28, y: 310, w: 400, h: 30,
        size: 16, weight: 600, align: 'left', hugging: false, z: 2, animated: false, anim: 'none',
      });
      add('text', {
        name: 'Socials', x: 28, y: 348, w: 300, h: 32,
        size: 16, weight: 400, align: 'left', hugging: false, z: 3, animated: false, anim: 'none',
      });
    }
    const host = h('div', { class: 'canvas-host about-card-host' });
    attachCanvasEditor(board, host, null, { fixedBoard: true });
    const url = h('input', { type: 'text', placeholder: 'https://… or /uploads/….mp4', 'aria-label': 'Motion graphic address' });
    url.value = data.video || '';
    url.addEventListener('input', () => {
      data.video = url.value.trim();
      changed({ coalesce: true });
    });
    const fileIn = h('input', { type: 'file', accept: 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov', hidden: true });
    fileIn.addEventListener('change', async () => {
      const [next] = await uploadFiles(fileIn.files);
      fileIn.value = '';
      if (!next) return;
      data.video = next;
      url.value = next;
      changed();
    });
    return [
      h('p', { class: 'hint' }, 'Drag the introduction, the Email layer, and the Socials layer. Font size, alignment, and position are on each layer. On the site, Email shows the address from Site settings, and Socials shows those icons. Keep those two layer names. This board is only for this card. It is not in the shared template library.'),
      host,
      fields(wrapField('Motion graphic', h('div', { class: 'img-buttons' },
        url,
        h('button', { type: 'button', class: 'btn small', onclick: () => fileIn.click() }, 'Upload video'),
        fileIn), { span: 4, hint: 'About 15 seconds. Visitors hover the card to see this side, then press play. It plays on the card.' })),
    ];
  }

  function viewHome() {
    const home = content.home;
    home.sections = home.sections || [];
    // Works is one of the home sections, so it shares their list and order.
    if (home.works && typeof home.works === 'object') {
      home.works.id = home.works.id || 's-home-works';
      home.works.heading = home.works.heading || 'Works';
      const at = home.sections.findIndex((s) => s && s.id === home.works.id);
      if (at < 0) home.sections.push(home.works);
      else if (home.sections[at] !== home.works) home.sections[at] = home.works;
    }
    const sectionsWrap = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
    const drawSections = () => {
      mount(sectionsWrap, 
        home.sections.map((s, i) => sectionPanel(home, s, i, drawSections, 'Home')),
        h('button', {
          class: 'btn', type: 'button', style: 'align-self:flex-start',
          onclick: async () => {
            const pick = await chooseSectionLayout({ title: 'Add a section to the home page', includeSaved: true });
            if (!pick) return;
            const s = pick.kind === 'preset'
              ? await makeSection(pick.id)
              : (await api('POST', `/api/layouts/${encodeURIComponent(pick.id)}/section`, { rename: false })).section;
            home.sections.push(s);
            setPanelOpen(s, true);
            changed();
            drawSections();
          },
        }, '+ Add section'));
    };
    drawSections();

    return [
      homeCanvasCard({
        title: 'Hero (top of the page)',
        block: home.hero,
        seed: seedHeroCanvas,
        hint: 'The hero is a canvas. Drag the name, the tagline and the big word. Leave words a visitor should replace as “our text here” when you save this as the default template.',
        extra: fields(textField(home, 'seoTitle', 'Browser tab title for this page', { span: 2 })),
        sections: home.sections,
        layoutPage: 'Home',
        layoutKind: 'hero',
        layoutName: 'Hero',
      }),
      card('About card', aboutCardFields(home)),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', null, `Sections (${home.sections.length})`),
          h('div', { class: 'list-tools' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { home.sections.forEach((s) => setPanelOpen(s, true)); drawSections(); } }, 'Expand all'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { home.sections.forEach((s) => setPanelOpen(s, false)); drawSections(); } }, 'Collapse all'))),
        h('p', { class: 'hint', style: 'margin-bottom:12px' },
          'The About card is edited above this list. Works is the cell grid. Other sections are a canvas or a cell grid, one at a time.'),
        sectionsWrap),
      card('Contact',
        h('p', { class: 'hint', style: 'margin-bottom:12px' }, 'Form edit. This text and these field names appear in the contact section on the home page.'),
        fields(
          textField(home.contact, 'heading', 'Heading', { span: 2 }),
          textField(home.contact, 'emailLine', 'Email line', { span: 2 }),
          textField(home.contact, 'text', 'Text', { multiline: true, rows: 3 }),
          textField(home.contact, 'labelName', 'Field: name', { span: 1 }),
          textField(home.contact, 'labelEmail', 'Field: email', { span: 1 }),
          textField(home.contact, 'labelSubject', 'Field: subject', { span: 1 }),
          textField(home.contact, 'labelMessage', 'Field: message', { span: 1 }),
          textField(home.contact, 'labelSubmit', 'Submit button', { span: 1 }),
          textField(home.contact, 'successMessage', 'Message after sending', { span: 3 }))),
      card('Scrolling text band',
        fields(textField(home, 'marquee', 'Text', { hint: 'Repeats endlessly across the screen.' }))),
    ];
  }

  // =========================================================================
  // Section layouts
  //
  // Sections are grouped by the page they belong to: the home page has its own
  // list, and every page has its own. A section owns its board and its layers,
  // so copying one never affects the original.
  // =========================================================================

  const SECTION_FALLBACK = () => ({
    id: `s-${rand()}`, heading: 'New section', align: 'left', text: '', textAfter: '',
    layout: 'canvas', canvasHeight: 640, canvasBg: '',
    layers: [
      window.CanvasEditor.defaultLayer('heading', { name: 'Heading', text: 'New section', x: 60, y: 70, w: 900, h: 80, anim: 'up' }),
      window.CanvasEditor.defaultLayer('text', { name: 'Text', text: 'Write something here.', x: 60, y: 170, w: 620, h: 120, hugging: true }),
    ],
    columns: 3, aspect: 'square', items: [], buttons: [],
  });
  const newSection = SECTION_FALLBACK;

  // Ask the server for a ready-made section. The server owns the preset list,
  // so the editor and the backend cannot drift apart. If the request fails we
  // still give the user a usable board rather than an empty card.
  async function makeSection(preset) {
    try {
      const res = await api('POST', '/api/sections/new', { preset: preset || 'blank-canvas' });
      return res.section;
    } catch (err) {
      toast(`Could not build that layout: ${err.message}`, true);
      return newSection();
    }
  }

  async function copySectionOnServer(section) {
    try {
      const res = await api('POST', '/api/sections/copy', { section, rename: true });
      return res.section;
    } catch (err) {
      // Fall back to a local copy so the button still works offline.
      const copy = clone(section);
      copy.id = `s-${rand()}`;
      const label = String(section.heading || section.name || 'Section').replace(/\n/g, ' ');
      copy.heading = /\(copy\b/i.test(label) ? label : `${label} (copy)`;
      (copy.layers || []).forEach((l) => { l.id = `l-${rand()}`; });
      return copy;
    }
  }

  // A dialog that lists the starting layouts and the ones you saved earlier.
  function chooseSectionLayout({ title, includeSaved, savedOnly }) {
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'picker section-picker' });
      const list = h('div', { class: 'tpl-grid' });
      const previewPop = h('div', { class: 'tpl-preview', hidden: true });
      const close = (value) => { dlg.close(); dlg.remove(); resolve(value); };
      const previewColor = (value, fallback) => {
        const v = String(value || '').trim();
        if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
        if (/^rgba?\(\s*[\d.%,\s]+\)$/i.test(v)) return v;
        return fallback;
      };
      const renderPreview = (section) => {
        const boardW = 1425;
        const height = Math.min(4000, Math.max(200, Number(section.canvasHeight) || 640));
        const viewW = 280;
        const scale = viewW / boardW;
        const board = h('div', {
          class: 'tpl-preview-board',
          style: `height:${Math.round(height * scale)}px;background:${previewColor(section.canvasBg, '#fff')}`,
        });
        if ((section.layout || 'canvas') !== 'canvas') {
          const cols = Math.min(4, Math.max(1, Number(section.columns) || 3));
          const count = Math.max(section.items || 0, 3);
          board.append(h('div', { class: 'tpl-prev tpl-prev-heading', style: 'left:12px;top:14px;width:180px;height:16px' }, section.heading || 'Heading'));
          const grid = h('div', { class: 'tpl-prev-grid', style: `left:12px;top:40px;width:${viewW - 24}px;grid-template-columns:repeat(${cols},1fr)` });
          for (let i = 0; i < Math.min(count, cols * 2); i += 1) grid.append(h('div', { class: 'tpl-prev-cell' }));
          board.append(grid);
        } else {
          (section.layers || []).forEach((l) => {
            const chip = h('div', {
              class: `tpl-prev tpl-prev-${l.type || 'text'}`,
              style: `left:${(Number(l.x) || 0) * scale}px;top:${(Number(l.y) || 0) * scale}px;width:${Math.max(4, (Number(l.w) || 40) * scale)}px;height:${Math.max(3, (Number(l.h) || 20) * scale)}px`,
            });
            if (l.bg) chip.style.background = previewColor(l.bg, '');
            if (l.color) chip.style.color = previewColor(l.color, '');
            if (l.type === 'heading' || l.type === 'text' || l.type === 'paragraph' || l.type === 'button') {
              chip.textContent = l.text || '';
              chip.style.fontSize = `${Math.max(6, Math.min(18, (Number(l.size) || 16) * scale * 2.2))}px`;
            }
            if (l.type === 'gallery') {
              const cols = Math.min(4, Math.max(1, Number(l.columns) || 3));
              const imageCount = Array.isArray(l.images) ? l.images.length : Number(l.images) || 0;
              const cells = Math.max(1, imageCount || cols);
              chip.style.display = 'grid';
              chip.style.gridTemplateColumns = `repeat(${cols},1fr)`;
              chip.style.gap = '2px';
              chip.style.padding = '2px';
              for (let i = 0; i < Math.min(cells, cols * 2); i += 1) chip.append(h('div', { class: 'tpl-prev-cell' }));
            }
            board.append(chip);
          });
        }
        return h('div', { class: 'tpl-preview-card' }, board);
      };
      const placePreview = (card) => {
        const dlgBox = dlg.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        const width = 300;
        let left = cardBox.right - dlgBox.left + 12;
        let top = cardBox.top - dlgBox.top;
        if (left + width > dlgBox.width - 8) left = cardBox.left - dlgBox.left - width - 12;
        if (left < 8) left = 8;
        const popH = previewPop.offsetHeight || 180;
        if (top + popH > dlgBox.height - 8) top = Math.max(8, dlgBox.height - popH - 8);
        previewPop.style.left = `${left}px`;
        previewPop.style.top = `${top}px`;
      };
      const showPreview = (card, section) => {
        if (!section) return;
        previewPop.replaceChildren(renderPreview(section));
        previewPop.hidden = false;
        placePreview(card);
      };
      const hidePreview = () => { previewPop.hidden = true; };
      const watchPreview = (card, getSection) => {
        card.addEventListener('mouseenter', async () => {
          const section = await getSection();
          if (!card.matches(':hover')) return;
          showPreview(card, section);
        });
        card.addEventListener('mouseleave', hidePreview);
      };
      const savedCard = (t) => {
        const card = h('button', {
          class: 'tpl-card', type: 'button', onclick: () => close({ kind: 'saved', id: t.id }),
        }, h('strong', null, t.name),
          h('span', null, `${t.layers} layer${t.layers === 1 ? '' : 's'}${t.page ? ` · from ${t.page}` : ''}`));
        watchPreview(card, async () => {
          if (t.preview) return t.preview;
          const full = await api('GET', `/api/layouts/${encodeURIComponent(t.id)}`);
          t.preview = full.section;
          return t.preview;
        });
        return card;
      };

      const draw = (presets, saved) => {
        const groups = LAYOUT_GROUPS.map(([kind, label]) => {
          const rows = saved.filter((t) => (t.kind || 'section') === kind);
          if (!rows.length) return null;
          return h('div', { class: 'tpl-section' }, h('h4', null, label),
            h('div', { class: 'tpl-cards' }, rows.map(savedCard)));
        });
        mount(list,
          savedOnly ? null : h('div', { class: 'tpl-section' }, h('h4', null, 'Start from a layout'),
            h('div', { class: 'tpl-cards' }, presets.map((p) => {
              const card = h('button', {
                class: 'tpl-card', type: 'button', onclick: () => close({ kind: 'preset', id: p.id }),
              }, h('strong', null, p.name), h('span', null, p.description));
              watchPreview(card, async () => p.preview);
              return card;
            }))),
          includeSaved ? groups : null,
          includeSaved && !saved.length
            ? h('p', { class: 'hint' }, 'Layouts you save from a section, or templates you make on Section layouts, appear here.')
            : null);
      };

      dlg.append(
        h('div', { class: 'picker-head' },
          h('h3', null, title),
          h('button', { class: 'btn small', type: 'button', onclick: () => close(null) }, 'Cancel')),
        h('p', { class: 'hint', style: 'margin:0 20px 12px' }, 'Every section is separate: adding or copying one only affects the page you are on. Hover a layout to see a preview.'),
        h('div', { class: 'tpl-scroll' }, list),
        previewPop);
      dlg.addEventListener('close', () => { if (dlg.isConnected) dlg.remove(); resolve(null); });
      document.body.append(dlg);
      dlg.showModal();
      draw([], []);

      const loadSaved = includeSaved ? api('GET', '/api/layouts') : Promise.resolve([]);
      const loadPresets = savedOnly ? Promise.resolve([]) : api('GET', '/api/section-presets');
      Promise.all([loadPresets, loadSaved])
        .then(([presets, saved]) => draw(presets, saved))
        .catch((err) => mount(list, h('p', { class: 'muted' }, err.message)));
    });
  }

  // Drop a saved template onto this building block. The section keeps its id
  // and, when it already has one, its name. The template on Section layouts
  // is not changed — this is a copy with its own layer ids.
  async function applySavedLayout(s) {
    const pick = await chooseSectionLayout({
      title: 'Apply a saved layout',
      includeSaved: true,
      savedOnly: true,
    });
    if (!pick || pick.kind !== 'saved') return null;
    const res = await api('POST', `/api/layouts/${encodeURIComponent(pick.id)}/section`, { rename: false });
    const incoming = res.section;
    const keepId = s.id;
    const keepHeading = String(s.heading || '').trim();
    const editor = editors.get(s);
    if (editor) {
      editor.destroy();
      editor.destroyed = true;
      editors.delete(s);
      liveEditors.delete(editor);
    }
    Object.keys(s).forEach((key) => { delete s[key]; });
    Object.assign(s, incoming, {
      id: keepId,
      heading: keepHeading || incoming.heading || '',
      templateId: pick.id,
    });
    return pick.id;
  }

  // "Save this layout" — keeps a copy on the server so it can be reused on any
  // page later. The name is asked for first, so a half-saved layout never lands
  // on the shelf.
  async function saveSectionLayout(section, pageLabel, opts = {}) {
    const suggested = String(opts.suggested || section.heading || section.name || 'Section').replace(/\n/g, ' ').trim();
    const name = prompt('Save this layout as:', suggested || 'My layout');
    if (name == null) return;
    if (!name.trim()) return toast('Give the layout a name so you can find it later.', true);
    try {
      await api('POST', '/api/layouts', {
        section, name: name.trim(), page: pageLabel || '', kind: opts.kind || 'section',
      });
      toast(`Saved the layout "${name.trim()}". Add it to any page with "+ Add section".`);
    } catch (err) {
      toast(err.message, true);
    }
  }


  function uniqueSlug(base) {
    const taken = new Set(content.pages.map((p) => p.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  // Add a new page, starting from the same blank section as before. Use
  // "Add a section" on the new page to swap in another layout afterwards.
  function newPage() {
    const page = {
      id: `p-${rand()}`, slug: uniqueSlug('new-page'), navLabel: 'New page', showInNav: true,
      title: 'NEW PAGE', subtitle: '', heroImage: '', sections: [newSection()],
    };
    setPanelOpen(page.sections[0], true);
    content.pages.push(page);
    changed();
    go(`page:${page.id}`);
  }

  // Add a new page and start it from a chosen layout instead of a blank board.
  async function newPageFromLayout() {
    const pick = await chooseSectionLayout({ title: 'Start a new page from a layout', includeSaved: true });
    if (!pick) return;
    const page = {
      id: `p-${rand()}`, slug: uniqueSlug('new-page'), navLabel: 'New page', showInNav: true,
      title: 'NEW PAGE', subtitle: '', heroImage: '', sections: [],
    };
    const s = pick.kind === 'preset'
      ? await makeSection(pick.id)
      : (await api('POST', `/api/layouts/${encodeURIComponent(pick.id)}/section`, { rename: false })).section;
    page.sections.push(s);
    setPanelOpen(s, true);
    content.pages.push(page);
    changed();
    go(`page:${page.id}`);
  }

  // Switching an existing image section to a layout board should not start from
  // a blank page: the heading, text and images are placed as layers you can then
  // move, restyle and animate. The original image list is kept, so switching
  // back to gallery still shows it.
  function seedCanvasFromClassic(s) {
    s.layers = [];
    let y = 70;
    const add = (type, patch) => s.layers.push(window.CanvasEditor.defaultLayer(type, patch));

    if (s.heading) {
      add('heading', { name: 'Heading', text: s.heading, x: 60, y, w: 900, h: 90, size: 46, anim: 'up' });
      y += 120;
    }
    if (s.text) {
      add('text', { name: 'Intro text', text: s.text, x: 60, y, w: 820, h: 120, hugging: true, anim: 'fade' });
      y += 170;
    }
    if ((s.items || []).length) {
      add('gallery', {
        name: 'Images', x: 60, y, w: 1305, h: 460,
        columns: Number(s.columns) || 3, aspect: s.aspect || 'square', anim: 'up',
        images: s.items.map((i) => ({ image: i.image, caption: i.caption || '', link: i.link || '' })),
      });
      y += 500;
    }
    if (s.textAfter) {
      add('text', { name: 'Closing text', text: s.textAfter, x: 60, y, w: 820, h: 120, hugging: true, anim: 'fade' });
      y += 160;
    }
    (s.buttons || []).forEach((b, i) => {
      add('button', { name: `Button: ${b.label}`, text: b.label, link: b.url, x: 60 + i * 230, y, w: 210, h: 54, anim: 'up' });
    });

    s.canvasHeight = Math.max(520, y + 120);
  }

  const sectionMeta = (s) => {
    const layout = s.layout || 'gallery';
    const name = (LAYOUTS.find(([v]) => v === layout) || LAYOUTS[0])[1].split(':')[0];
    const count = layout === 'canvas'
      ? `${(s.layers || []).length} layer${(s.layers || []).length === 1 ? '' : 's'}`
      : Array.isArray(s.cards)
        ? `${s.cards.length} card${s.cards.length === 1 ? '' : 's'}`
        : `${(s.items || []).length} image${(s.items || []).length === 1 ? '' : 's'}`;
    return `${name} · ${count}`;
  };

  function isGhostLayer(l) {
    return /ghost/i.test(l.name || '') || (l.type === 'heading' && Number(l.size) >= 100);
  }

  function defaultEditorMode(s) {
    if (!s) return 'canvas';
    if (s.layout === 'case' || s.layout === 'gallery' || s.layout === 'form' || s.layout === 'works') return 'form';
    if (Array.isArray(s.cards)) return 'form';
    if (s.layout === 'canvas') {
      const layers = s.layers || [];
      const textCount = layers.filter((l) => (l.type === 'text' || l.type === 'heading') && !isGhostLayer(l)).length;
      const pictureCount = layers.filter((l) => l.type === 'image' || l.type === 'gallery').length;
      if (textCount && pictureCount <= 1) return 'form';
    }
    return 'canvas';
  }

  function sectionEditorMode(s) {
    if (s.layout === 'case') return 'form';
    if (s.id && editorMode.has(s.id)) return editorMode.get(s.id);
    return defaultEditorMode(s);
  }

  // Works cards and the canvas gallery are the same list. Form edits write both.
  function syncWorksLayers(works) {
    (works.layers || []).forEach((l) => {
      if (l.type === 'heading' && l.name === 'Heading') l.text = works.heading || '';
      if (l.name === 'Description') l.text = works.description || '';
      if (/ghost/i.test(l.name || '')) l.text = works.decorText || '';
      if (l.type === 'gallery') {
        l.images = (works.cards || []).map((c) => ({
          image: c.image || '',
          caption: c.label || '',
          link: c.link || '',
        }));
      }
    });
  }

  const WORK_KINDS = [
    ['work', 'Work'],
    ['image', 'Image'],
    ['text', 'Text'],
    ['youtube', 'YouTube'],
    ['pdf', 'PDF'],
  ];
  function parseWorkSize(size) {
    const match = /^([1-3])x([1-3])$/.exec(size || '');
    return match ? { w: Number(match[1]), h: Number(match[2]) } : { w: 1, h: 1 };
  }

  function blankWorkBlock(kind) {
    return {
      blockType: kind || 'work',
      size: '1x1',
      image: '',
      label: '',
      title: '',
      category: '',
      year: '',
      role: '',
      output: '',
      intro: '',
      text: '',
      youtube: '',
      pdf: '',
      link: '',
      featured: false,
      tags: [],
      sections: [
        { title: '', text: '' },
        { title: '', text: '' },
        { title: '', text: '' },
      ],
      pieces: [],
    };
  }

  let openWorkCard = null;
  let workDragMoved = false;

  function workSpan(card) {
    return parseWorkSize(card.size);
  }

  // Same packing as the public wall: a block that does not fit moves to the next row.
  function packWorkBlocks(cards) {
    const cols = 3;
    const occ = [];
    const taken = (r, c) => occ[r] && occ[r][c];
    const fits = (r, c, w, h) => {
      if (c + w > cols) return false;
      for (let rr = r; rr < r + h; rr++) {
        for (let cc = c; cc < c + w; cc++) if (taken(rr, cc)) return false;
      }
      return true;
    };
    const mark = (r, c, w, h) => {
      for (let rr = r; rr < r + h; rr++) {
        occ[rr] = occ[rr] || [];
        for (let cc = c; cc < c + w; cc++) occ[rr][cc] = 1;
      }
    };
    let row = 0;
    let col = 0;
    const placed = cards.map((card) => {
      const span = workSpan(card);
      let guard = 0;
      while (guard < 400) {
        while (taken(row, col)) {
          col += 1;
          if (col >= cols) { col = 0; row += 1; }
        }
        if (fits(row, col, span.w, span.h)) break;
        row += 1;
        col = 0;
        guard += 1;
      }
      const item = { card, row, col, ...span };
      mark(row, col, span.w, span.h);
      col += span.w;
      if (col >= cols) { col = 0; row += 1; }
      return item;
    });
    const reading = [...placed].sort((a, b) => a.row - b.row || a.col - b.col);
    reading.forEach((item, i) => { item.num = pad2(i + 1); });
    return placed;
  }

  // The board matches the public grid. A block stays closed until it is clicked.
  function workTagName(card) {
    return card.title || card.label || 'Work';
  }

  function worksTagEditor(section) {
    const cards = () => (Array.isArray(section.cards) ? section.cards : []).filter((card) => card.blockType !== 'image' && card.blockType !== 'text' && card.blockType !== 'youtube' && card.blockType !== 'pdf');
    const host = h('div', { class: 'work-tags-panel' });
    const catalogBox = h('div', { class: 'tag-editor' });
    const rows = h('div', { class: 'work-tag-rows' });
    const input = h('input', { type: 'text', placeholder: 'New tag' });

    function catalog() {
      const names = [];
      const push = (tag) => {
        const name = String(tag || '').trim();
        if (name && !names.includes(name)) names.push(name);
      };
      (Array.isArray(section.tags) ? section.tags : []).forEach(push);
      (section.cards || []).forEach((card) => (Array.isArray(card.tags) ? card.tags : []).forEach(push));
      return names;
    }

    function keepCatalog() {
      section.tags = catalog();
      return section.tags;
    }

    function paint() {
      const names = catalog();
      catalogBox.replaceChildren(...names.map((tag) => {
        const remove = h('button', { type: 'button', class: 'tag-remove', 'aria-label': `Remove ${tag}` }, '×');
        remove.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          section.tags = keepCatalog().filter((item) => item !== tag);
          (section.cards || []).forEach((card) => {
            if (Array.isArray(card.tags)) card.tags = card.tags.filter((item) => item !== tag);
          });
          changed();
          paint();
        });
        return h('span', { class: 'tag-chip is-on' }, tag, remove);
      }));
      rows.replaceChildren(...cards().map((card) => {
        const chips = h('div', { class: 'tag-editor' });
        names.forEach((tag) => {
          const on = Array.isArray(card.tags) && card.tags.includes(tag);
          const btn = h('button', {
            type: 'button',
            class: on ? 'tag-chip is-on' : 'tag-chip',
            'aria-pressed': on ? 'true' : 'false',
          }, tag);
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            keepCatalog();
            const list = Array.isArray(card.tags) ? card.tags.slice() : [];
            const next = list.includes(tag) ? list.filter((item) => item !== tag) : list.concat(tag);
            card.tags = next;
            const pressed = next.includes(tag);
            btn.classList.toggle('is-on', pressed);
            btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
            changed();
          });
          chips.append(btn);
        });
        return h('div', { class: 'work-tag-row' },
          h('span', { class: 'work-tag-name' }, workTagName(card)),
          chips);
      }));
    }

    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const names = keepCatalog();
      if (!names.includes(name)) names.push(name);
      section.tags = names;
      input.value = '';
      changed();
      paint();
    });

    host.append(
      h('div', { class: 'list-head' }, h('span', { class: 'field-label' }, 'Tags')),
      h('p', { class: 'hint' }, 'These are the filters on the site. Add a tag here, then turn it on for each work. Turning it off a work keeps the tag in this list.'),
      catalogBox,
      input,
      rows);
    paint();
    return {
      el: host,
      refresh() {
        const typed = input.value;
        const focused = document.activeElement === input;
        paint();
        input.value = typed;
        if (focused) input.focus();
      },
    };
  }

  function worksBlocksEditor(arr, hooks = {}) {
    const wrap = h('div', { class: 'list' });
    const touch = () => changed();
    if (openWorkCard && !arr.includes(openWorkCard)) openWorkCard = null;

    function draw() {
      arr.forEach((card) => {
        card.blockType = WORK_KINDS.some(([kind]) => kind === card.blockType) ? card.blockType : 'work';
        card.size = /^[1-3]x[1-3]$/.test(card.size) ? card.size : '1x1';
        if (card.blockType === 'work' && !card.title && card.label) card.title = card.label;
        if (card.blockType !== 'work') card.featured = false;
      });
      let featuredLeft = 3;
      arr.forEach((card) => {
        if (card.featured !== true) return;
        if (featuredLeft > 0) featuredLeft -= 1;
        else card.featured = false;
      });
      const placed = packWorkBlocks(arr);
      let editorRow = null;
      if (openWorkCard) {
        const open = placed.find((item) => item.card === openWorkCard);
        if (open) {
          editorRow = open.row + open.h;
          placed.forEach((item) => { if (item.row >= editorRow) item.row += 1; });
        }
      }
      const board = h('div', { class: 'work-board' });
      placed.forEach((item) => board.append(face(item)));
      if (openWorkCard && editorRow != null) {
        const editor = editPanel(openWorkCard);
        editor.style.gridColumn = '1 / -1';
        editor.style.gridRow = String(editorRow + 1);
        board.append(editor);
      }
      mount(wrap,
        h('div', { class: 'list-head' },
          h('span', { class: 'field-label' }, `Blocks (${arr.length})`),
          h('span', { class: 'group-btns' },
            ...WORK_KINDS.map(([kind, label]) => h('button', {
              class: 'btn small', type: 'button',
              onclick: () => {
                const card = blankWorkBlock(kind);
                arr.push(card);
                openWorkCard = card;
                touch();
                draw();
              },
            }, `+ ${label}`)))),
        h('div', { class: 'work-board-wrap' }, board));
      if (hooks.onStructure) hooks.onStructure();
    }

    function face(item) {
      const card = item.card;
      const kind = card.blockType;
      const title = card.title || card.label || '';
      const meta = [card.category, card.year].filter(Boolean).join(' · ');
      const showImage = (kind === 'work' || kind === 'image') && card.image;
      const copy = kind === 'text'
        ? (card.text || 'Text')
        : kind === 'youtube'
          ? (card.youtube || 'YouTube')
          : kind === 'pdf'
            ? (card.pdf || 'PDF')
            : title;
      const el = h('div', {
        class: `work-face${openWorkCard === card ? ' is-open' : ''}`,
        'data-size': card.size,
        'data-kind': kind,
        role: 'button',
        tabindex: '0',
        title: 'Drag to reorder. Click to edit.',
        style: `grid-column: ${item.col + 1} / span ${item.w}; grid-row: ${item.row + 1} / span ${item.h};`,
      },
        showImage ? h('img', { src: card.image, alt: '' }) : null,
        card.featured ? h('span', { class: 'work-face-feature' }, 'Feature Work') : null,
        h('span', { class: 'work-face-num' }, item.num),
        h('span', { class: 'work-face-copy' },
          kind === 'work' && meta ? h('span', { class: 'work-face-meta' }, meta) : null,
          h('span', { class: 'work-face-title' }, copy || WORK_KINDS.find(([k]) => k === kind)[1]),
          kind === 'work' && card.intro ? h('span', { class: 'work-face-intro' }, card.intro) : null,
          kind === 'work' ? h('span', { class: 'work-face-view' }, 'View Project') : null));

      const index = () => arr.indexOf(card);
      const toggle = () => {
        openWorkCard = openWorkCard === card ? null : card;
        draw();
      };
      el.addEventListener('click', () => { if (!workDragMoved) toggle(); });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      el.addEventListener('dragstart', (e) => {
        workDragMoved = true;
        drag = { arr, from: index() };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index()));
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        drag = null;
        setTimeout(() => { workDragMoved = false; }, 0);
      });
      el.addEventListener('dragover', (e) => {
        if (drag && drag.arr === arr) { e.preventDefault(); el.classList.add('drag-over'); }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('drag-over');
        if (drag && drag.arr === arr) {
          e.preventDefault();
          e.stopPropagation();
          move(arr, drag.from, index());
          drag = null;
          touch();
          draw();
        }
      });
      el.draggable = true;
      const img = el.querySelector('img');
      if (img) img.draggable = false;
      return el;
    }

    function spanPicker(card) {
      const current = parseWorkSize(card.size);
      const cells = [];
      let hover = null;
      const grid = h('div', { class: 'span-picker', role: 'grid', 'aria-label': 'Cell size, up to 3 by 3' });
      const paint = () => {
        const w = hover ? hover.w : current.w;
        const h = hover ? hover.h : current.h;
        cells.forEach((btn, i) => {
          const on = (i % 3) < w && Math.floor(i / 3) < h;
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      };
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const btn = h('button', {
            type: 'button',
            class: 'span-picker-cell',
            'aria-label': `${c + 1} by ${r + 1}`,
          });
          btn.addEventListener('mouseenter', () => { hover = { w: c + 1, h: r + 1 }; paint(); });
          btn.addEventListener('focus', () => { hover = { w: c + 1, h: r + 1 }; paint(); });
          btn.addEventListener('click', () => {
            card.size = `${c + 1}x${r + 1}`;
            changed();
            draw();
          });
          cells.push(btn);
          grid.append(btn);
        }
      }
      grid.addEventListener('mouseleave', () => { hover = null; paint(); });
      paint();
      return wrapField('Cell size', grid, { span: 2 });
    }

    function featureField(card) {
      const othersOn = arr.filter((item) => item !== card && item.blockType === 'work' && item.featured === true).length;
      const blocked = othersOn >= 3 && card.featured !== true;
      const input = h('input', { type: 'checkbox', checked: card.featured === true, disabled: blocked });
      input.addEventListener('change', () => {
        const stillOn = arr.filter((item) => item !== card && item.blockType === 'work' && item.featured === true).length;
        if (input.checked && stillOn >= 3) {
          input.checked = false;
          return;
        }
        card.featured = input.checked;
        changed();
        draw();
      });
      return h('div', { class: 'field span-4' },
        h('label', { class: 'field check' }, input, 'Feature'),
        blocked ? h('p', { class: 'hint' }, 'Three features are already on. Turn one off before choosing another.') : null);
    }

    function youtubeIdOf(value) {
      const v = String(value || '').trim();
      const fromUrl = v.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
      if (fromUrl) return fromUrl[1];
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      return '';
    }

    // The main visual is the wall cover. A video uses its thumbnail. A PDF has no still.
    function syncWorkCover(card) {
      if (!Array.isArray(card.pieces)) return;
      const ready = card.pieces.filter((piece) => {
        const src = String(piece.src || '').trim();
        if (!src) return false;
        if (piece.kind === 'youtube') return !!youtubeIdOf(src);
        return true;
      });
      const hero = ready.find((piece) => piece.hero) || ready[0];
      if (!hero) {
        card.image = '';
        return;
      }
      const pieceKind = hero.kind === 'youtube' || hero.kind === 'pdf' ? hero.kind : 'image';
      if (pieceKind === 'image') card.image = String(hero.src).trim();
      else if (pieceKind === 'youtube') {
        const id = youtubeIdOf(hero.src);
        card.image = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
      } else card.image = '';
    }

    function sectionsEditor(card) {
      const list = Array.isArray(card.sections)
        ? card.sections
        : [{ title: '', text: '' }, { title: '', text: '' }, { title: '', text: '' }];
      const host = h('div', { class: 'case-edit' });
      const commit = () => { card.sections = list; };
      const drawSections = () => {
        const rows = list.map((section, i) => {
          const title = h('input', { type: 'text', placeholder: 'Section title', 'aria-label': `Section ${i + 1} title` });
          title.value = section.title || '';
          title.addEventListener('input', () => {
            commit();
            section.title = title.value;
            changed({ coalesce: true });
          });
          const text = h('textarea', { rows: 4, placeholder: 'Section text', 'aria-label': `Section ${i + 1} text` });
          text.value = section.text || '';
          text.addEventListener('input', () => {
            commit();
            section.text = text.value;
            changed({ coalesce: true });
          });
          return h('div', { class: 'case-edit-block' },
            h('div', { class: 'case-edit-bar' },
              h('span', { class: 'field-label' }, `Section ${i + 1}`),
              h('span', { class: 'group-btns' },
                h('button', {
                  type: 'button', class: 'btn small',
                  onclick: () => {
                    commit();
                    list.splice(i, 0, { title: '', text: '' });
                    changed();
                    drawSections();
                  },
                }, 'Insert above'),
                iconBtn('↑', 'Move section up', () => {
                  commit();
                  move(list, i, i - 1);
                  changed();
                  drawSections();
                }, { disabled: i === 0 }),
                iconBtn('↓', 'Move section down', () => {
                  commit();
                  move(list, i, i + 1);
                  changed();
                  drawSections();
                }, { disabled: i === list.length - 1 }),
                iconBtn('✕', 'Remove section', () => {
                  commit();
                  list.splice(i, 1);
                  changed();
                  drawSections();
                }, { danger: true }))),
            title,
            text);
        });
        mount(host,
          h('div', { class: 'list-head' }, h('span', { class: 'field-label' }, 'Sections')),
          h('p', { class: 'hint' }, 'Each section is a line, a title, and a paragraph. Empty ones stay in this list and stay off the site. Insert above a section, or at the end, and move them up or down.'),
          rows,
          h('button', {
            type: 'button', class: 'btn small',
            onclick: () => {
              commit();
              list.push({ title: '', text: '' });
              changed();
              drawSections();
            },
          }, 'Insert section at the end'));
      };
      drawSections();
      return host;
    }

    function piecesEditor(card, onCover) {
      const list = Array.isArray(card.pieces)
        ? card.pieces
        : (card.image ? [{ kind: 'image', src: card.image, hero: true }] : []);
      const host = h('div', { class: 'case-edit' });
      const commit = () => { card.pieces = list; };
      const pieceKindOf = (piece) => (piece.kind === 'youtube' || piece.kind === 'pdf' ? piece.kind : 'image');
      const touchCover = () => { syncWorkCover(card); if (onCover) onCover(); };
      const addPiece = (kind) => {
        commit();
        list.push({ kind, src: '', hero: list.length === 0 });
        changed();
        drawPieces();
        touchCover();
      };

      function drawPieces() {
        const rows = list.map((piece, i) => {
          const kind = pieceKindOf(piece);
          const kindSel = h('select', { 'aria-label': `Piece ${i + 1} type` },
            [['image', 'Image'], ['youtube', 'YouTube'], ['pdf', 'PDF']].map(([value, text]) =>
              h('option', { value, selected: kind === value }, text)));
          kindSel.addEventListener('change', () => {
            commit();
            piece.kind = kindSel.value;
            piece.src = '';
            changed();
            drawPieces();
            touchCover();
          });
          let source = null;
          if (kind === 'image') {
            source = imageField(piece, 'src', 'Image', {
              span: 4,
              onChange: () => { commit(); touchCover(); changed(); },
            });
          } else if (kind === 'youtube') {
            const input = h('input', {
              type: 'text',
              placeholder: 'https://www.youtube.com/watch?v=…',
              'aria-label': `Piece ${i + 1} YouTube link`,
            });
            input.value = piece.src || '';
            input.addEventListener('input', () => {
              commit();
              piece.src = input.value;
              changed({ coalesce: true });
              touchCover();
            });
            source = wrapField('YouTube link', input, { span: 4 });
          } else {
            const input = h('input', {
              type: 'text',
              placeholder: '/uploads/….pdf',
              'aria-label': `Piece ${i + 1} PDF address`,
            });
            input.value = piece.src || '';
            input.addEventListener('input', () => {
              commit();
              piece.src = input.value;
              changed({ coalesce: true });
              touchCover();
            });
            const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
            fileIn.addEventListener('change', async () => {
              const [url] = await uploadFiles(fileIn.files);
              fileIn.value = '';
              if (!url) return;
              commit();
              piece.src = url;
              changed();
              drawPieces();
              touchCover();
            });
            source = wrapField('PDF', h('div', { class: 'img-buttons' },
              input,
              h('button', { type: 'button', class: 'btn small', onclick: () => fileIn.click() }, 'Upload PDF'),
              fileIn), { span: 4 });
          }
          const heroBtn = h('button', {
            type: 'button',
            class: piece.hero ? 'btn small primary' : 'btn small',
            'aria-pressed': piece.hero ? 'true' : 'false',
          }, 'Main visual');
          heroBtn.addEventListener('click', () => {
            if (piece.hero) return;
            commit();
            list.forEach((item) => { item.hero = item === piece; });
            changed();
            drawPieces();
            touchCover();
          });
          return h('div', { class: 'case-edit-block' },
            h('div', { class: 'case-edit-bar' },
              h('span', { class: 'field-label' }, `Piece ${i + 1}`),
              h('span', { class: 'group-btns' },
                kindSel,
                heroBtn,
                iconBtn('↑', 'Move piece up', () => {
                  commit();
                  move(list, i, i - 1);
                  changed();
                  drawPieces();
                }, { disabled: i === 0 }),
                iconBtn('↓', 'Move piece down', () => {
                  commit();
                  move(list, i, i + 1);
                  changed();
                  drawPieces();
                }, { disabled: i === list.length - 1 }),
                iconBtn('✕', 'Remove piece', () => {
                  commit();
                  const wasHero = piece.hero;
                  list.splice(i, 1);
                  if (wasHero && list.length && !list.some((item) => item.hero)) list[0].hero = true;
                  changed();
                  drawPieces();
                  touchCover();
                }, { danger: true }))),
            source);
        });
        mount(host,
          h('div', { class: 'list-head' },
            h('span', { class: 'field-label' }, 'Pieces'),
            h('span', { class: 'group-btns' },
              h('button', { type: 'button', class: 'btn small', onclick: () => addPiece('image') }, '+ Image'),
              h('button', { type: 'button', class: 'btn small', onclick: () => addPiece('youtube') }, '+ YouTube'),
              h('button', { type: 'button', class: 'btn small', onclick: () => addPiece('pdf') }, '+ PDF'))),
          h('p', { class: 'hint' }, 'One piece is the main visual. On the site it is the wall cover and the first piece in the popup. The others follow this order.'),
          rows.length ? rows : h('div', { class: 'list-empty' }, 'No pieces yet.'));
      }
      drawPieces();
      return host;
    }

    function editPanel(card) {
      const i = arr.indexOf(card);
      const kind = card.blockType;
      const fieldsForKind = [];
      const paintFace = () => {
        const node = wrap.querySelector('.work-face.is-open .work-face-title');
        if (!node) return;
        if (kind === 'text') node.textContent = card.text || 'Text';
        else if (kind === 'youtube') node.textContent = card.youtube || 'YouTube';
        else if (kind === 'pdf') node.textContent = card.pdf || 'PDF';
        else node.textContent = card.title || card.label || 'Work';
      };
      const paintCover = () => {
        const face = wrap.querySelector('.work-face.is-open');
        if (!face) return;
        let img = face.querySelector('img');
        if (card.image) {
          if (!img) {
            img = h('img', { alt: '' });
            face.prepend(img);
          }
          img.src = card.image;
          img.draggable = false;
        } else if (img) img.remove();
      };
      if (kind === 'work') {
        fieldsForKind.push(
          textField(card, 'title', 'Title', { span: 2, onInput: () => { paintFace(); if (hooks.onStructure) hooks.onStructure(); } }),
          textField(card, 'category', 'Category', { span: 1 }),
          textField(card, 'year', 'Year', { span: 1 }),
          textField(card, 'role', 'Role', { span: 2, placeholder: 'Optional' }),
          textField(card, 'output', 'Output', { span: 2, placeholder: 'Optional' }),
          textField(card, 'intro', 'Short introduction', { span: 4, multiline: true, rows: 3 }));
      } else if (kind === 'image') {
        fieldsForKind.push(imageField(card, 'image', 'Image', { span: 4, onChange: () => draw() }));
      } else if (kind === 'text') {
        fieldsForKind.push(textField(card, 'text', 'Text', { span: 4, multiline: true, rows: 4, onInput: paintFace }));
      } else if (kind === 'youtube') {
        fieldsForKind.push(textField(card, 'youtube', 'YouTube link', { span: 4, placeholder: 'https://www.youtube.com/watch?v=…', onInput: paintFace }));
      } else {
        fieldsForKind.push(textField(card, 'pdf', 'PDF file address', { span: 4, placeholder: '/uploads/….pdf', onInput: paintFace }));
      }
      return h('div', { class: 'work-editor' },
        h('div', { class: 'work-editor-bar' },
          h('span', { class: 'field-label' }, 'Edit block'),
          h('span', { class: 'group-btns' },
            iconBtn('↑', 'Move earlier', () => { move(arr, i, i - 1); touch(); draw(); }, { disabled: i <= 0 }),
            iconBtn('↓', 'Move later', () => { move(arr, i, i + 1); touch(); draw(); }, { disabled: i < 0 || i >= arr.length - 1 }),
            iconBtn('✕', 'Remove from the grid', () => {
              arr.splice(i, 1);
              openWorkCard = null;
              touch();
              draw();
            }, { danger: true }),
            h('button', { class: 'btn small', type: 'button', onclick: () => { openWorkCard = null; draw(); } }, 'Done'))),
        fields(
          selectField(card, 'blockType', 'Block', WORK_KINDS, { span: 2, onChange: () => draw() }),
          spanPicker(card),
          kind === 'work' ? featureField(card) : null),
        fields(...fieldsForKind),
        kind === 'work' ? sectionsEditor(card) : null,
        kind === 'work' ? piecesEditor(card, paintCover) : null);
    }

    draw();
    return wrap;
  }

  function sectionPanel(page, s, i, redraw, pageLabel) {
    const sections = page.sections;
    const titleEl = h('span', { class: 'panel-title', title: 'Double-click to rename' }, (s.heading || '').replace(/\n/g, ' ') || '(untitled section)');
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const input = h('input', { class: 'panel-rename', type: 'text', value: s.heading || '' });
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        if (save) {
          s.heading = input.value;
          titleEl.textContent = input.value.replace(/\n/g, ' ') || '(untitled section)';
          changed();
        }
        if (input.isConnected) input.replaceWith(titleEl);
      };
      input.addEventListener('click', (ev) => ev.stopPropagation());
      input.addEventListener('dblclick', (ev) => ev.stopPropagation());
      input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      titleEl.replaceWith(input);
      input.focus();
      input.select();
    });
    const metaEl = h('span', { class: 'panel-meta' }, sectionMeta(s));
    const panel = h('div', { class: `panel${panelIsOpen(s) ? ' open' : ''}` });
    const head = h('div', { class: 'panel-head', role: 'button', tabindex: '0', 'aria-expanded': String(panelIsOpen(s)) },
      h('span', { class: 'chev' }, '▶'),
      titleEl,
      metaEl,
      h('span', { class: 'panel-actions' },
        iconBtn('↑', 'Move section up', () => { move(sections, i, i - 1); changed(); redraw(); }, { disabled: i === 0 }),
        iconBtn('↓', 'Move section down', () => { move(sections, i, i + 1); changed(); redraw(); }, { disabled: i === sections.length - 1 }),
        iconBtn('✎', 'Save this layout to reuse on another page', () => saveSectionLayout(s, pageLabel)),
        iconBtn('⧉', 'Copy this section', async () => {
          // The copy is made on the server so it gets its own section id and its
          // own layer ids; nothing in it is shared with the original.
          const copy = await copySectionOnServer(s);
          sections.splice(i + 1, 0, copy);
          setPanelOpen(s, false);
          setPanelOpen(copy, true);
          changed();
          redraw();
        }),
        iconBtn('✕', 'Delete section', () => {
          const what = (s.layout || 'gallery') === 'canvas' ? `${(s.layers || []).length} layers` : `${(s.items || s.cards || []).length} images`;
          if (!confirm(`Delete the section "${s.heading || 'untitled'}" and its ${what} from this page?\n(The image files stay in the media library.)`)) return;
          if (page.works && s === page.works) page.works = null;
          const editor = editors.get(s);
          if (editor) { editor.destroy(); editors.delete(s); }
          sections.splice(i, 1);
          changed();
          redraw();
        }, { danger: true })));

    const toggle = () => {
      if (panelIsOpen(s)) setPanelOpen(s, false); else setPanelOpen(s, true);
      redraw();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    panel.append(head);

    if (panelIsOpen(s)) {
      s.items = s.items || [];
      s.buttons = s.buttons || [];
      s.layers = s.layers || [];

      // Switching layout must not throw work away: the editor redraws in place
      // and the other layout's data is kept for when you switch back.
      const refreshMeta = () => { metaEl.textContent = sectionMeta(s); };

      const editorHost = h('div', { class: 'canvas-host' });

      const mountCanvas = () => attachCanvasEditor(s, editorHost, refreshMeta);

      // The shared top fields, then the board. A section that is still a form
      // is opened as a canvas; the form editor is gone.
      const body = h('div', { class: 'panel-body' });
      const isWorks = page.works && s === page.works;
      const draw = () => {
        // A section is either the cell grid or a canvas. The other payload stays
        // stored, and visitors only see the one that is selected.
        if (isWorks || s.layout === 'works') {
          s.cards = Array.isArray(s.cards) ? s.cards : [];
          if (isWorks && !s.cards.length) {
            const gal = (s.layers || []).find((l) => l.type === 'gallery');
            if (gal && Array.isArray(gal.images)) {
              s.cards = gal.images.map((item) => ({ label: item.caption || '', image: item.image || '', link: item.link || '' }));
            }
          }
          const tagsUi = worksTagEditor(s);
          const useCanvas = isWorks ? null : h('button', {
            class: 'btn small', type: 'button',
            onclick: () => {
              s.layout = 'canvas';
              s.layers = Array.isArray(s.layers) ? s.layers : [];
              if (!s.layers.length) seedCanvasFromClassic(s);
              if (s.id) editorMode.set(s.id, 'canvas');
              changed();
              redraw();
            },
          }, 'Canvas');
          mount(body,
            useCanvas ? h('div', { class: 'list-tools', style: 'margin-bottom:12px' }, useCanvas) : null,
            h('p', { class: 'hint' }, isWorks
              ? 'This section is the cell grid. Its previous canvas stays stored and is not shown to visitors.'
              : 'Visitors see this grid only. Canvas layers on this section stay stored until you switch this section to Canvas.'),
            fields(
              textField(s, 'heading', 'Heading', { onInput: (v) => { titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; } })),
            tagsUi.el,
            worksBlocksEditor(s.cards, { onStructure: () => tagsUi.refresh() }),
            h('p', { class: 'hint' }, 'The grid matches the site. Drag a block onto another to change the order. Click a block to edit it. Up to three works can be Feature. They stay in this grid as well.'));
          refreshMeta();
          return;
        }
        const mode = sectionEditorMode(s);
        const switcher = s.layout === 'case' ? null : h('div', { class: 'list-tools', style: 'margin-bottom:12px' },
          h('button', {
            class: mode === 'form' ? 'btn small primary' : 'btn small', type: 'button',
            onclick: () => { if (s.id) editorMode.set(s.id, 'form'); redraw(); },
          }, 'Form edit'),
          h('button', {
            class: mode === 'canvas' ? 'btn small primary' : 'btn small', type: 'button',
            onclick: () => {
              if (s.layout !== 'canvas') {
                s.layout = 'canvas';
                s.layers = s.layers || [];
                if (!s.layers.length) seedCanvasFromClassic(s);
              }
              if (s.id) editorMode.set(s.id, 'canvas');
              changed();
              redraw();
            },
          }, 'Canvas'),
          h('button', {
            class: 'btn small', type: 'button',
            onclick: () => {
              s.layout = 'works';
              if (!Array.isArray(s.cards)) s.cards = [];
              if (s.id) editorMode.delete(s.id);
              changed();
              redraw();
            },
          }, 'Cell grid'));

        if (mode === 'form') {
          if (s.layout === 'case') {
            mount(body,
              fields(
                textField(s, 'heading', 'Title', { onInput: (v) => { titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; } }),
                textField(s, 'role', 'Role (optional)', { placeholder: 'For example, Animator' }),
                textField(s, 'brief', 'Brief', { multiline: true, rows: 6 }),
                textField(s, 'process', 'Process', { multiline: true, rows: 6 }),
                textField(s, 'outcome', 'Outcome', { multiline: true, rows: 6 })),
              h('p', { class: 'hint' }, 'Visitors only see the parts that are filled in.'));
            refreshMeta();
            return;
          }
          const textLayers = (s.layers || []).filter((l) => (l.type === 'text' || l.type === 'heading') && !isGhostLayer(l));
          const galleries = (s.layers || []).filter((l) => l.type === 'gallery');
          const blocks = [switcher];
          if (s.layout !== 'canvas' || !textLayers.length) {
            blocks.push(fields(
              textField(s, 'heading', 'Heading', { onInput: (v) => { titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; } }),
              textField(s, 'text', 'Text', { multiline: true, rows: 6 }),
              textField(s, 'textAfter', 'Text after', { multiline: true, rows: 4 })));
          } else {
            blocks.push(fields(
              ...textLayers.map((l) => textField(l, 'text', l.name || (l.type === 'heading' ? 'Heading' : 'Text'), {
                multiline: true,
                rows: l.type === 'heading' ? 2 : 6,
                onInput: l.type === 'heading' ? (v) => { s.heading = v; titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; } : undefined,
              }))));
          }
          if (galleries.length) {
            galleries.forEach((l) => {
              l.images = l.images || [];
              blocks.push(tilesEditor(l.images, { label: l.name || 'Images', captionLabel: 'Caption', linkPlaceholder: 'Link (optional)' }));
            });
          } else if (s.layout !== 'canvas') {
            s.items = s.items || [];
            blocks.push(tilesEditor(s.items, { label: 'Images', captionLabel: 'Caption', showWide: true }));
          }
          blocks.push(h('p', { class: 'hint' }, 'The form edits this section’s text and images. The hero and freeform layouts use the canvas.'));
          mount(body, ...blocks);
          refreshMeta();
          return;
        }

        if (s.layout !== 'canvas') {
          s.layout = 'canvas';
          s.layers = s.layers || [];
          if (!s.layers.length) {
            if (isWorks) seedWorksCanvas(s);
            else seedCanvasFromClassic(s);
          }
        }
        s.canvasHeight = Number(s.canvasHeight) || 640;
        mountCanvas();
        mount(body,
            switcher,
            fields(
              textField(s, 'heading', 'Section name (for your reference)', {
                multiline: true, rows: 1, span: 4,
                onInput: (v) => { titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; },
              }),
              colorAlphaField(s, 'canvasBg', 'Background', {
                onInput: () => { const editor = editors.get(s); if (editor) editor.render(); },
              }),
              h('div', { class: 'span-4' }, editorHost)),
            h('p', { class: 'hint', style: 'margin-top:10px' },
              'Each section is its own board. Image, YouTube and PDF are layers on this board. Drag a layer in any direction. Arrow keys nudge it. Drag a corner to resize, and drag the round handle above a layer to rotate it. Hold Shift while dragging to snap to the grid. Cell grid is a separate mode for this section. A saved template stays as it is here — change the template itself on Section layouts.'),
            h('div', { class: 'cv-btnrow', style: 'margin-top:8px' },
              h('button', {
                class: 'btn small', type: 'button',
                onclick: async () => {
                  try {
                    const id = await applySavedLayout(s);
                    if (!id) return;
                    changed();
                    redraw();
                    toast('Applied a copy of that layout. The template itself is unchanged.');
                  } catch (err) { toast(err.message, true); }
                },
              }, 'Apply a saved layout'),
              h('button', { class: 'btn small', type: 'button', onclick: () => saveSectionLayout(s, pageLabel) }, 'Save this layout'),
              h('button', {
                class: 'btn small', type: 'button',
                onclick: async () => {
                  const copy = await copySectionOnServer(s);
                  sections.splice(i + 1, 0, copy);
                  setPanelOpen(copy, true);
                  changed();
                  redraw();
                  toast('Copied as a new section below this one.');
                },
              }, 'Copy as a new section')));
        refreshMeta();
      };
      draw();
      panel.append(body);
    }
    return panel;
  }

  // First open copies the form header onto a board. Later opens keep the layers.
  function seedPageCanvas(page) {
    const board = page.headerBoard && typeof page.headerBoard === 'object' ? page.headerBoard : {};
    page.headerBoard = board;
    board.id = board.id || `s-${String(page.id || 'page').replace(/[^a-z0-9-]/gi, '')}-header`;
    board.heading = board.heading || 'Page header';
    board.layout = 'canvas';
    board.canvasLock = true;
    board.layers = Array.isArray(board.layers) ? board.layers : [];
    board.canvasHeight = Number(board.canvasHeight) || 774;
    if (typeof board.canvasBg !== 'string') board.canvasBg = '';
    if (!board.canvasImage && page.heroImage) board.canvasImage = page.heroImage;
    if (board.layers.length) return;
    const add = (type, patch) => board.layers.push(window.CanvasEditor.defaultLayer(type, patch));
    const title = page.title || 'TITLE';
    const barW = page.highlightAuto === false && Number(page.highlightLength) > 0
      ? Math.min(1200, Math.max(40, Math.round(Number(page.highlightLength))))
      : Math.min(1100, Math.max(120, Math.round(title.length * 36 + 16)));
    const barX = Math.round((1425 - barW) / 2);
    add('shape', {
      name: 'Title highlight', x: barX, y: 306, w: barW, h: 42,
      bg: page.highlightColor || '#95B8FE', radius: 4, shape: 'rect',
      z: 2, animated: true, anim: 'up', duration: 0.9, delay: 0,
    });
    add('heading', {
      name: 'Title', text: title, x: 262, y: 281, w: 900, h: 64,
      size: 53, weight: 400, align: 'center', color: '#0A192F', font: 'var(--font-display)',
      lineHeight: 1, z: 3, anim: 'up', duration: 0.9, delay: 0,
    });
    add('divider', {
      name: 'Rule', x: 686, y: 384, w: 54, h: 2, color: '#FFFFFF',
      z: 4, animated: true, anim: 'fade', duration: 0.9, delay: 0.1,
    });
    add('text', {
      name: 'Subtitle', text: page.subtitle || '',
      x: 262, y: 456, w: 900, h: 80, size: 18, weight: 900, align: 'center',
      color: '#FDFDFD', font: 'Arial, Helvetica, sans-serif', lineHeight: 1.1,
      textShadow: true, z: 5, anim: 'up', duration: 0.9, delay: 0.15,
    });
  }

  function pageUsesCanvasHeader(page) {
    const board = page && page.headerBoard;
    return !!(board && typeof board === 'object' && board.layout === 'canvas');
  }

  function viewPage(page) {
    const idx = content.pages.indexOf(page);
    const sectionsWrap = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
    const drawSections = () => {
      mount(sectionsWrap, 
        page.sections.map((s, i) => sectionPanel(page, s, i, drawSections, page.navLabel || page.title)),
        h('button', {
          class: 'btn', type: 'button', style: 'align-self:flex-start',
          onclick: async () => {
            const pick = await chooseSectionLayout({ title: `Add a section to "${page.navLabel || page.title}"`, includeSaved: true });
            if (!pick) return;
            const s = pick.kind === 'preset'
              ? await makeSection(pick.id)
              : (await api('POST', `/api/layouts/${encodeURIComponent(pick.id)}/section`, { rename: false })).section;
            page.sections.push(s);
            setPanelOpen(s, true);
            changed();
            drawSections();
          },
        }, '+ Add section'));
    };
    drawSections();

    const useCanvasHeader = pageUsesCanvasHeader(page);
    let headerBlock;
    if (useCanvasHeader) {
      seedPageCanvas(page);
      const headerHost = h('div', { class: 'canvas-host' });
      attachCanvasEditor(page.headerBoard, headerHost);
      headerBlock = [
        h('p', { class: 'hint', style: 'margin:12px 0' },
          'Title is on the canvas — edit layers there. The classic title, subtitle and hero image fields are hidden because they no longer show on the live site. Menu label and address stay above.'),
        headerHost,
        h('div', { class: 'cv-btnrow', style: 'margin-top:8px' },
          h('button', {
            class: 'btn small', type: 'button',
            onclick: async () => {
              try {
                if (!page.headerBoard) return;
                const id = await applySavedLayout(page.headerBoard);
                if (!id) return;
                page.headerBoard.layout = 'canvas';
                changed();
                render({ keepScroll: true, scrollY: window.scrollY });
                toast('Applied a copy of that layout. The template itself is unchanged.');
              } catch (err) { toast(err.message, true); }
            },
          }, 'Apply a saved layout'),
          h('button', {
            class: 'btn small', type: 'button',
            onclick: () => saveSectionLayout(page.headerBoard, page.navLabel || page.title, {
              suggested: page.navLabel || page.title || 'Page header',
              kind: 'page',
            }),
          }, 'Save this layout'),
          h('button', {
            class: 'btn small', type: 'button',
            onclick: async () => {
              const copy = await copySectionOnServer(page.headerBoard);
              page.sections.push(copy);
              setPanelOpen(copy, true);
              changed();
              render({ keepScroll: true, scrollY: window.scrollY });
              toast('Copied the header as a new section at the bottom of this page.');
            },
          }, 'Copy as a new section')),
      ];
    } else {
      headerBlock = [
        fields(
          textField(page, 'title', 'Page title', { span: 2 }),
          textField(page, 'subtitle', 'Subtitle', { span: 2 }),
          imageField(page, 'heroImage', 'Hero image', { span: 4 })),
        h('p', { class: 'hint', style: 'margin:12px 0' },
          'This page still uses the classic header (title, subtitle, hero image). Those fields show on the live site until you switch the header to a canvas.'),
        h('button', {
          class: 'btn small', type: 'button', style: 'margin-bottom:8px',
          onclick: () => {
            seedPageCanvas(page);
            page.headerBoard.layout = 'canvas';
            changed();
            render({ keepScroll: true, scrollY: window.scrollY });
            toast('Header switched to canvas. Edit the title on the board below.');
          },
        }, 'Switch header to canvas'),
      ];
    }

    return [
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', null, 'Page settings'),
          h('div', { class: 'list-tools' },
            h('button', { class: 'btn small', type: 'button', disabled: idx === 0, onclick: () => { move(content.pages, idx, idx - 1); changed(); render(); } }, '↑ Earlier in menu'),
            h('button', { class: 'btn small', type: 'button', disabled: idx === content.pages.length - 1, onclick: () => { move(content.pages, idx, idx + 1); changed(); render(); } }, '↓ Later in menu'),
            h('button', {
              class: 'btn small', type: 'button',
              onclick: () => {
                const copy = clone(page);
                copy.id = `p-${rand()}`;
                copy.slug = uniqueSlug(`${page.slug}-copy`);
                copy.navLabel = `${page.navLabel} (copy)`;
                copy.sections.forEach((s) => { s.id = `s-${rand()}`; });
                if (copy.headerBoard && typeof copy.headerBoard === 'object') {
                  copy.headerBoard.id = `s-${rand()}`;
                  if (Array.isArray(copy.headerBoard.layers)) {
                    copy.headerBoard.layers.forEach((layer) => { layer.id = `l-${rand()}`; });
                  }
                }
                content.pages.splice(idx + 1, 0, copy);
                changed();
                go(`page:${copy.id}`);
              },
            }, 'Duplicate page'),
            h('button', {
              class: 'btn small danger', type: 'button',
              onclick: () => {
                if (!confirm(`Delete the page "${page.navLabel}"? You can still undo with "Discard changes" until you save.`)) return;
                content.pages.splice(idx, 1);
                changed();
                go('home');
              },
            }, 'Delete page'))),
        fields(
          textField(page, 'navLabel', 'Menu label', { span: 2 }),
          textField(page, 'slug', 'Page address', {
            span: 2, prefix: `${location.origin}/`,
            transform: (v) => v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
            hint: 'Lowercase letters, numbers and dashes only.',
            onInput: updateViewLink,
          }),
          checkField(page, 'showInNav', 'Show this page in the menu', { span: 2 })),
        ...headerBlock),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', null, `Sections (${page.sections.length})`),
          h('div', { class: 'list-tools' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { page.sections.forEach((s) => setPanelOpen(s, true)); drawSections(); } }, 'Expand all'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { page.sections.forEach((s) => setPanelOpen(s, false)); drawSections(); } }, 'Collapse all'))),
        h('p', { class: 'hint', style: 'margin-bottom:12px' },
          'The building blocks of this page, in the order visitors scroll through them. Sections belong to this page only — another page has its own list. Open one to edit it, or use ⧉ to copy it as a new section.'),
        sectionsWrap),
    ];
  }

  async function viewMessages(container) {
    mount(container, h('p', { class: 'muted' }, 'Loading…'));
    let messages;
    try {
      messages = await api('GET', '/api/messages');
    } catch (err) {
      mount(container, h('p', { class: 'muted' }, err.message));
      return;
    }
    const open = new Set();
    const draw = () => {
      unread = messages.filter((m) => !m.read).length;
      renderSidebar();
      mount(container, 
        h('p', { class: 'intro' }, 'Messages sent through the contact form on your home page.'),
        messages.length ? null : h('div', { class: 'card muted' }, 'No messages yet.'),
        messages.map((m) => {
          const isOpen = open.has(m.id);
          return h('div', { class: `msg${m.read ? '' : ' unread'}` },
            h('div', {
              class: 'msg-head',
              onclick: async () => {
                if (isOpen) open.delete(m.id); else open.add(m.id);
                if (!m.read) {
                  m.read = true;
                  api('PATCH', `/api/messages/${m.id}`, { read: true }).catch((e) => toast(e.message, true));
                }
                draw();
              },
            },
              h('strong', null, `${m.name} <${m.email}>`),
              h('span', { class: 'date' }, new Date(m.createdAt).toLocaleString()),
              h('span', { class: 'subject' }, m.subject)),
            isOpen ? h('div', { class: 'msg-body' }, m.message) : null,
            isOpen ? h('div', { class: 'msg-actions' },
              h('a', { class: 'btn small primary', href: `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject}`)}` }, 'Reply by email'),
              h('button', {
                class: 'btn small', type: 'button',
                onclick: async () => { m.read = false; open.delete(m.id); draw(); await api('PATCH', `/api/messages/${m.id}`, { read: false }); },
              }, 'Mark as unread'),
              h('button', {
                class: 'btn small danger', type: 'button',
                onclick: async () => {
                  if (!confirm('Delete this message?')) return;
                  await api('DELETE', `/api/messages/${m.id}`);
                  messages = messages.filter((x) => x.id !== m.id);
                  draw();
                },
              }, 'Delete')) : null);
        }));
    };
    draw();
  }

  // Folders are virtual: the server tags each file with the pages that use it.
  // Library albums (lib:*) are labels you create and assign yourself.
  const ALL_FOLDER = 'all';
  const UNUSED_FOLDER = 'unused';
  let mediaFolder = ALL_FOLDER;
  let mediaTypeFilter = 'all';
  let mediaSort = 'newest';
  const mediaSelected = new Set();

  function mediaFolderList(pageFolders) {
    const pages = (pageFolders || []).filter((f) => f.kind !== 'library');
    const library = (pageFolders || []).filter((f) => f.kind === 'library');
    return [
      { id: ALL_FOLDER, label: 'All files', kind: 'system' },
      ...pages,
      ...library,
      { id: UNUSED_FOLDER, label: 'Unused', kind: 'system' },
    ];
  }

  function inMediaFolder(file, folderId) {
    if (folderId === ALL_FOLDER) return true;
    if (folderId === UNUSED_FOLDER) return !file.used;
    return (file.folders || []).includes(folderId);
  }

  function fileMatchesType(file, type) {
    if (type === 'all') return true;
    const kind = file.kind || mediaKindOf(file.url || file.name);
    return kind === type;
  }

  function sortMediaFiles(list, sort) {
    const out = list.slice();
    if (sort === 'oldest') out.sort((a, b) => (a.modified || 0) - (b.modified || 0));
    else if (sort === 'name-asc') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'name-desc') out.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'size') out.sort((a, b) => (b.size || 0) - (a.size || 0));
    else out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    return out;
  }

  async function viewMedia(container) {
    mount(container, h('p', { class: 'muted' }, 'Loading…'));
    let files;
    let folders;
    try {
      const [fileList, pageFolders] = await Promise.all([api('GET', '/api/media'), api('GET', '/api/media/folders')]);
      files = fileList;
      folders = mediaFolderList(pageFolders);
    } catch (err) {
      mount(container, h('p', { class: 'muted' }, err.message));
      return;
    }
    if (!folders.some((f) => f.id === mediaFolder)) mediaFolder = ALL_FOLDER;
    mediaSelected.clear();
    const folderLabels = new Map(folders.map((f) => [f.id, f.label]));
    const usedOn = (file) => (file.folders || [])
      .filter((id) => !String(id).startsWith('lib:'))
      .map((id) => folderLabels.get(id))
      .filter(Boolean)
      .join(', ');
    const libraryLabel = (file) => {
      if (!file.libraryId) return '';
      const hit = folders.find((f) => f.libraryId === file.libraryId || f.id === `lib:${file.libraryId}`);
      return hit ? hit.label : '';
    };

    const search = h('input', { type: 'search', placeholder: 'Filter by file name…', style: 'max-width:260px' });
    const typeSel = h('select', { 'aria-label': 'File type' },
      h('option', { value: 'all' }, 'All types'),
      h('option', { value: 'image' }, 'Images'),
      h('option', { value: 'video' }, 'Videos'),
      h('option', { value: 'pdf' }, 'PDFs'),
      h('option', { value: 'font' }, 'Fonts'));
    typeSel.value = mediaTypeFilter;
    const sortSel = h('select', { 'aria-label': 'Sort' },
      h('option', { value: 'newest' }, 'Newest first'),
      h('option', { value: 'oldest' }, 'Oldest first'),
      h('option', { value: 'name-asc' }, 'Name A–Z'),
      h('option', { value: 'name-desc' }, 'Name Z–A'),
      h('option', { value: 'size' }, 'Largest first'));
    sortSel.value = mediaSort;

    const grid = h('div', { class: 'media-grid' });
    const folderNav = h('nav', { class: 'media-folders', 'aria-label': 'Folders' });
    const bulkBar = h('div', { class: 'media-bulk', hidden: true });
    const fileIn = h('input', {
      type: 'file',
      accept: 'image/*,video/mp4,video/webm,application/pdf,.pdf,.woff,.woff2,.ttf,.otf',
      multiple: true,
      hidden: true,
    });
    fileIn.addEventListener('change', async () => {
      const urls = await uploadFiles(fileIn.files);
      fileIn.value = '';
      if (urls.length) viewMedia(container);
    });

    const visibleList = () => {
      const q = search.value.trim().toLowerCase();
      return sortMediaFiles(
        files.filter((x) =>
          x.name.toLowerCase().includes(q)
          && inMediaFolder(x, mediaFolder)
          && fileMatchesType(x, mediaTypeFilter)),
        mediaSort);
    };

    const syncBulk = () => {
      const n = mediaSelected.size;
      bulkBar.hidden = n === 0;
      if (!n) return;
      mount(bulkBar,
        h('span', null, `${n} selected`),
        h('button', {
          class: 'btn small danger', type: 'button',
          onclick: async () => {
            const picked = files.filter((f) => mediaSelected.has(f.name));
            if (!picked.length) return;
            const usedCount = picked.filter((f) => f.used).length;
            const msg = usedCount
              ? `${picked.length} file(s) selected; ${usedCount} still used on the website. Delete anyway?`
              : `Delete ${picked.length} file(s) permanently?`;
            if (!confirm(msg)) return;
            try {
              const res = await api('POST', '/api/media/delete', {
                names: picked.map((f) => f.name),
                force: usedCount > 0,
              });
              const gone = new Set(res.deleted || []);
              files = files.filter((f) => !gone.has(f.name));
              mediaSelected.clear();
              drawFolders();
              draw();
              syncBulk();
              toast(gone.size ? `Deleted ${gone.size}.` : 'Nothing deleted.');
            } catch (err) { toast(err.message, true); }
          },
        }, 'Delete selected'),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: () => { mediaSelected.clear(); draw(); syncBulk(); },
        }, 'Clear'));
    };

    const libraryFolders = () => folders.filter((f) => f.kind === 'library');

    const renameFile = async (file) => {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const base = file.name.slice(0, file.name.length - ext.length);
      const next = prompt('Rename file (extension stays the same):', base);
      if (next == null) return;
      const cleaned = next.trim();
      if (!cleaned || cleaned === base) return;
      try {
        const res = await api('PATCH', `/api/media/${encodeURIComponent(file.name)}`, { newName: cleaned + ext });
        if (res.rewritten && res.url !== file.url) applyMediaRenameLocally(file.url, res.url);
        Object.assign(file, {
          name: res.name,
          url: res.url,
          size: res.size,
          modified: res.modified,
          used: res.used,
          kind: res.kind,
          libraryId: res.libraryId,
        });
        // Refresh folder tags from server for this file
        const fresh = await api('GET', '/api/media');
        const hit = fresh.find((f) => f.name === res.name);
        if (hit) Object.assign(file, hit);
        files = files.map((f) => (f.name === file.name || f.url === res.url ? { ...f, ...file } : f));
        // Deduplicate after rename
        const byName = new Map();
        files.forEach((f) => byName.set(f.name, f));
        files = [...byName.values()];
        drawFolders();
        draw();
        toast(res.rewritten ? 'Renamed — website links updated. Save if you still have other unsaved edits.' : 'Renamed.');
      } catch (err) { toast(err.message, true); }
    };

    const moveFile = async (file) => {
      const libs = libraryFolders();
      if (!libs.length) {
        toast('Create a library folder first (New folder in the sidebar).', true);
        return;
      }
      const choices = ['(none — remove from album)', ...libs.map((f) => f.label)];
      const pick = prompt(
        `Move to library folder:\n${choices.map((c, i) => `${i}: ${c}`).join('\n')}\n\nEnter number:`,
        '0');
      if (pick == null) return;
      const idx = Number(pick);
      if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) {
        toast('Invalid choice.', true);
        return;
      }
      const folderId = idx === 0 ? null : (libs[idx - 1].libraryId || String(libs[idx - 1].id).replace(/^lib:/, ''));
      try {
        const res = await api('PATCH', `/api/media/${encodeURIComponent(file.name)}`, { folderId });
        file.libraryId = res.libraryId;
        const fresh = await api('GET', '/api/media');
        const hit = fresh.find((f) => f.name === file.name);
        if (hit) Object.assign(file, hit);
        drawFolders();
        draw();
        toast(folderId ? 'Moved to folder.' : 'Removed from library folder.');
      } catch (err) { toast(err.message, true); }
    };

    const drawFolders = () => {
      const pageOnes = folders.filter((f) => f.kind === 'page' || f.kind === 'system' || !f.kind);
      const libOnes = folders.filter((f) => f.kind === 'library');
      mount(folderNav,
        pageOnes.map((folder) => h('button', {
          class: `media-folder${folder.id === mediaFolder ? ' active' : ''}`,
          type: 'button',
          title: folder.label,
          onclick: () => {
            mediaFolder = folder.id;
            drawFolders();
            draw();
          },
        },
        h('span', { class: 'label' }, folder.label),
        h('span', { class: 'count' }, files.filter((x) => inMediaFolder(x, folder.id)).length))),
        h('div', { class: 'media-folder-sep' }, 'Library albums'),
        libOnes.length ? null : h('p', { class: 'muted small', style: 'margin:4px 8px 8px' }, 'Create albums to group files (separate from pages).'),
        libOnes.map((folder) => h('div', { class: 'media-folder-row' },
          h('button', {
            class: `media-folder${folder.id === mediaFolder ? ' active' : ''}`,
            type: 'button',
            title: folder.label,
            onclick: () => {
              mediaFolder = folder.id;
              drawFolders();
              draw();
            },
          },
          h('span', { class: 'label' }, folder.label),
          h('span', { class: 'count' }, files.filter((x) => inMediaFolder(x, folder.id)).length)),
          h('button', {
            class: 'btn tiny', type: 'button', title: 'Rename folder',
            onclick: async (e) => {
              e.stopPropagation();
              const next = prompt('Rename folder:', folder.label);
              if (next == null || !next.trim() || next.trim() === folder.label) return;
              try {
                const res = await api('PATCH', `/api/media/folders/${encodeURIComponent(folder.libraryId || folder.id)}`, { label: next.trim() });
                folder.label = res.label;
                folderLabels.set(folder.id, res.label);
                drawFolders();
                draw();
              } catch (err) { toast(err.message, true); }
            },
          }, '✎'),
          h('button', {
            class: 'btn tiny danger', type: 'button', title: 'Delete folder',
            onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`Delete album "${folder.label}"? Files stay; only the album is removed.`)) return;
              try {
                await api('DELETE', `/api/media/folders/${encodeURIComponent(folder.libraryId || folder.id)}`);
                folders = folders.filter((f) => f.id !== folder.id);
                if (mediaFolder === folder.id) mediaFolder = ALL_FOLDER;
                files.forEach((f) => {
                  if (f.libraryId && (`lib:${f.libraryId}` === folder.id || f.libraryId === folder.libraryId)) {
                    f.libraryId = null;
                    f.folders = (f.folders || []).filter((id) => id !== folder.id);
                  }
                });
                drawFolders();
                draw();
              } catch (err) { toast(err.message, true); }
            },
          }, '×'))),
        h('button', {
          class: 'btn small', type: 'button', style: 'margin-top:8px',
          onclick: async () => {
            const label = prompt('New library album name:');
            if (label == null || !label.trim()) return;
            try {
              const res = await api('POST', '/api/media/folders', { label: label.trim() });
              const unusedAt = folders.findIndex((f) => f.id === UNUSED_FOLDER);
              if (unusedAt >= 0) folders.splice(unusedAt, 0, res);
              else folders.push(res);
              folderLabels.set(res.id, res.label);
              mediaFolder = res.id;
              drawFolders();
              draw();
              toast('Album created.');
            } catch (err) { toast(err.message, true); }
          },
        }, '+ New folder'));
    };

    const kindPill = (file) => {
      const kind = file.kind || mediaKindOf(file.url);
      return h('span', { class: `pill kind-${kind}` }, kind);
    };

    const draw = () => {
      const list = visibleList();
      // Drop selections that are no longer visible/present
      [...mediaSelected].forEach((name) => {
        if (!files.some((f) => f.name === name)) mediaSelected.delete(name);
      });
      mount(grid,
        list.length ? null : h('p', { class: 'muted' }, search.value.trim() ? 'No files match.' : 'This folder is empty.'),
        list.map((file) => {
          const selected = mediaSelected.has(file.name);
          return h('div', { class: `media-card${selected ? ' selected' : ''}` },
            h('label', { class: 'media-check', title: 'Select' },
              h('input', {
                type: 'checkbox',
                checked: selected,
                onchange: (e) => {
                  if (e.target.checked) mediaSelected.add(file.name);
                  else mediaSelected.delete(file.name);
                  draw();
                  syncBulk();
                },
              })),
            h('div', { class: 'tile-img' }, mediaPreview(file.url)),
            h('div', { class: 'media-info' },
              h('span', { class: 'name', title: file.name }, file.name),
              h('div', { class: 'row' },
                h('span', null, formatSize(file.size)),
                kindPill(file)),
              h('div', { class: 'row' },
                h('span', { class: `pill${file.used ? '' : ' unused'}` }, file.used ? 'In use' : 'Unused'),
                libraryLabel(file) ? h('span', { class: 'pill album' }, libraryLabel(file)) : null),
              usedOn(file) ? h('span', { class: 'used-on', title: `Used on: ${usedOn(file)}` }, usedOn(file)) : null,
              h('div', { class: 'row media-actions' },
                h('button', {
                  class: 'btn small', type: 'button',
                  onclick: async () => {
                    await navigator.clipboard.writeText(file.url).catch(() => {});
                    toast(`Copied ${file.url}`);
                  },
                }, 'Copy'),
                h('button', { class: 'btn small', type: 'button', onclick: () => renameFile(file) }, 'Rename'),
                h('button', { class: 'btn small', type: 'button', onclick: () => moveFile(file) }, 'Move'),
                h('button', {
                  class: 'btn small danger', type: 'button',
                  onclick: async () => {
                    const msg = file.used
                      ? `"${file.name}" is still used on your website. Deleting it will leave an empty spot. Delete anyway?`
                      : `Delete "${file.name}" permanently?`;
                    if (!confirm(msg)) return;
                    try {
                      await api('DELETE', `/api/media/${encodeURIComponent(file.name)}${file.used ? '?force=1' : ''}`);
                      files = files.filter((x) => x.name !== file.name);
                      mediaSelected.delete(file.name);
                      drawFolders();
                      draw();
                      syncBulk();
                      toast('Deleted.');
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Delete'))));
        }));
      syncBulk();
    };

    search.addEventListener('input', draw);
    typeSel.addEventListener('change', () => { mediaTypeFilter = typeSel.value; draw(); });
    sortSel.addEventListener('change', () => { mediaSort = sortSel.value; draw(); });

    const zone = h('div', { class: 'dropzone', style: 'margin-bottom:16px' },
      h('span', null, 'Drop files here to upload, or'),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => fileIn.click() }, 'Choose files'),
      fileIn);
    addFileDrop(zone, async (dropped) => {
      const urls = await uploadFiles(dropped);
      if (urls.length) viewMedia(container);
    });

    const total = files.reduce((n, x) => n + x.size, 0);
    mount(container,
      h('p', { class: 'intro' },
        `${files.length} files · ${formatSize(total)}. Page folders follow what is saved on the website. `
        + 'Library albums are yours to organize. Rename updates saved links; Save if you still have other unsaved edits.'),
      zone,
      h('div', { class: 'media-layout' },
        folderNav,
        h('div', { class: 'media-main' },
          h('div', { class: 'list-tools media-tools', style: 'margin-bottom:14px' },
            search, typeSel, sortSel),
          bulkBar,
          grid)));
    drawFolders();
    draw();
  }

  async function viewBackups(container) {
    mount(container, h('p', { class: 'muted' }, 'Loading…'));
    let backups;
    try {
      backups = await api('GET', '/api/backups');
    } catch (err) {
      mount(container, h('p', { class: 'muted' }, err.message));
      return;
    }
    const parseDate = (name) => {
      const m = name.match(/content-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)/);
      return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`).toLocaleString() : name;
    };
    mount(container, 
      h('p', { class: 'intro' }, 'A copy of your website content is saved automatically every time you click "Save changes". The 30 most recent copies are kept. Restoring replaces the current text and layout (image files are not affected).'),
      backups.length ? null : h('div', { class: 'card muted' }, 'No backups yet. One is created the first time you save.'),
      backups.map((b) => h('div', { class: 'card', style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;margin-bottom:10px' },
        h('span', null, h('strong', null, parseDate(b.name)), h('span', { class: 'muted small' }, `  ·  ${formatSize(b.size)}`)),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: async () => {
            if (!confirm(`Restore the version from ${parseDate(b.name)}?${isDirty() ? '\nYour unsaved changes will be lost.' : ''}`)) return;
            try {
              await api('POST', `/api/backups/${encodeURIComponent(b.name)}/restore`);
              content = await api('GET', '/api/content');
              savedJson = JSON.stringify(content);
              changed();
              toast('Restored. The website now shows that version.');
              viewBackups(container);
            } catch (err) { toast(err.message, true); }
          },
        }, 'Restore this version'))));
  }

  const LAYOUT_GROUPS = [
    ['hero', 'Hero', 'The default hero board is here. Leave words a visitor should replace as “our text here”, and leave pictures blank. Back to default restores this board.'],
    ['page', 'Page settings', 'The default page header is here. Leave words a visitor should replace as “our text here”, and leave pictures blank. Back to default restores this board.'],
    ['section', 'Section', 'Templates for a building block. Leave words a visitor should replace as “our text here”, and leave pictures blank.'],
  ];
  const DEFAULT_TEMPLATE_IDS = new Set(['tpl-default-hero', 'tpl-default-page']);

  function blankTemplateSection(kind) {
    const heading = kind === 'hero' ? 'Hero' : kind === 'page' ? 'Page header' : 'New section';
    return {
      id: `s-${rand()}`,
      heading,
      align: 'left',
      text: '',
      textAfter: '',
      layout: 'canvas',
      canvasHeight: kind === 'section' ? 640 : 774,
      canvasBg: '',
      canvasLock: true,
      layers: [
        window.CanvasEditor.defaultLayer('heading', {
          name: 'Heading', text: 'our text here', x: 80, y: 80, w: 900, h: 80, anim: 'up',
        }),
      ],
      columns: 3,
      aspect: 'square',
      items: [],
      buttons: [],
    };
  }

  async function viewLayouts(container) {
    mount(container, h('p', { class: 'muted' }, 'Loading…'));
    let layouts;
    try {
      layouts = await api('GET', '/api/layouts');
    } catch (err) {
      mount(container, h('p', { class: 'muted' }, err.message));
      return;
    }

    let editing = null;
    let editingBase = '';
    let tplEditor = null;

    const closeTplEditor = () => {
      if (window.__templateEditorUndo && window.__templateEditorUndo.editor === tplEditor) {
        window.__templateEditorUndo = null;
      }
      if (!tplEditor) return;
      try { tplEditor.destroy(); tplEditor.destroyed = true; } catch (err) { /* already gone */ }
      liveEditors.delete(tplEditor);
      tplEditor = null;
    };

    const fileIn = h('input', { type: 'file', accept: 'application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files?.[0];
      fileIn.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const section = parsed.section || parsed;
        const name = String(parsed.name || file.name.replace(/\.json$/i, '')).slice(0, 120);
        const kind = ['hero', 'page', 'section'].includes(parsed.kind) ? parsed.kind : 'section';
        await api('POST', '/api/layouts', { section, name, kind, page: 'Imported' });
        toast(`Imported "${name}".`);
        viewLayouts(container);
      } catch (err) {
        toast(`Could not import that file: ${err.message}`, true);
      }
    });

    const templateDirty = () => editing && JSON.stringify({
      name: editing.name, kind: editing.kind, section: editing.section,
    }) !== editingBase;

    const draw = () => {
      closeTplEditor();
      if (editing) {
        const host = h('div', { class: 'canvas-host' });
        const nameInput = h('input', { type: 'text', value: editing.name, 'aria-label': 'Template name' });
        nameInput.addEventListener('input', () => { editing.name = nameInput.value; });
        const kindSel = h('select', { 'aria-label': 'Template group' },
          LAYOUT_GROUPS.map(([id, label]) => h('option', { value: id, selected: editing.kind === id }, label)));
        kindSel.addEventListener('change', () => { editing.kind = kindSel.value; });
        mount(container,
          h('div', { class: 'list-tools', style: 'margin-bottom:12px' },
            h('button', {
              class: 'btn small', type: 'button',
              onclick: () => {
                if (templateDirty() && !confirm('Leave without saving this template?')) return;
                editing = null;
                draw();
              },
            }, 'Back to templates'),
            h('button', {
              class: 'btn small primary', type: 'button',
              onclick: async () => {
                const name = String(editing.name || '').trim();
                if (!name) return toast('Give the template a name.', true);
                try {
                  const res = await api('PATCH', `/api/layouts/${encodeURIComponent(editing.id)}`, {
                    name, kind: editing.kind, section: editing.section,
                  });
                  editing.name = name;
                  editingBase = JSON.stringify({ name, kind: editing.kind, section: editing.section });
                  const row = layouts.find((t) => t.id === editing.id);
                  if (row) {
                    row.name = name;
                    row.kind = editing.kind;
                    row.layers = (editing.section.layers || []).length;
                    row.layout = editing.section.layout || 'canvas';
                    row.savedAt = res.savedAt || row.savedAt;
                  }
                  toast(`Saved the template "${name}".`);
                } catch (err) { toast(err.message, true); }
              },
            }, 'Save template'),
            DEFAULT_TEMPLATE_IDS.has(editing.id) ? h('button', {
              class: 'btn small', type: 'button',
              onclick: async () => {
                if (!confirm('Put this default back? Your saved changes to this template are removed. Pages that already use a copy are not changed.')) return;
                try {
                  const res = await api('POST', `/api/layouts/${encodeURIComponent(editing.id)}/reset`);
                  editing.name = res.name;
                  editing.kind = res.kind;
                  editing.section = res.section;
                  editingBase = JSON.stringify({ name: editing.name, kind: editing.kind, section: editing.section });
                  const row = layouts.find((t) => t.id === editing.id);
                  if (row) {
                    row.name = res.name;
                    row.savedAt = '';
                    row.layers = (res.section.layers || []).length;
                  }
                  toast('Restored the default.');
                  draw();
                } catch (err) { toast(err.message, true); }
              },
            }, 'Back to default') : null),
          h('p', { class: 'hint', style: 'margin-bottom:12px' },
            DEFAULT_TEMPLATE_IDS.has(editing.id)
              ? 'This is the default. Leave words a visitor should replace as “our text here”, and leave pictures blank. Back to default restores that starting board. A page that already uses a copy keeps its own layers.'
              : 'This is the template. Saving here updates the template only. Leave words a visitor should replace as “our text here”, and leave pictures blank. A page that already uses a copy keeps its own layers.'),
          h('div', { class: 'fields', style: 'margin-bottom:12px' },
            h('div', { class: 'field span-2' }, h('label', { class: 'field-label' }, 'Template name'), nameInput),
            h('div', { class: 'field span-2' }, h('label', { class: 'field-label' }, 'Group'), kindSel)),
          host);
        tplEditor = window.CanvasEditorUI.createLayoutEditor({
          section: editing.section,
          onChange: () => {},
          onRequestImage: () => pickImage(),
          onRequestFiles: (files) => uploadFiles(files),
        });
        window.__templateEditorUndo = {
          editor: tplEditor,
          undo: () => tplEditor.undo(),
          redo: () => tplEditor.redo(),
        };
        tplEditor.destroyed = false;
        liveEditors.add(tplEditor);
        host.replaceChildren(tplEditor.element);
        return;
      }

      mount(container,
        h('p', { class: 'intro' },
          'Templates live here, apart from your pages. Edit a template on this page. Adding one to a page gives that page its own copy, so the template stays fixed while you edit building blocks.'),
        h('div', { class: 'list-tools', style: 'margin-bottom:14px' },
          h('button', { class: 'btn small', type: 'button', onclick: () => fileIn.click() }, 'Import a layout file'),
          fileIn),
        LAYOUT_GROUPS.map(([kind, title, blurb]) => {
          const rows = layouts.filter((t) => (t.kind || 'section') === kind);
          return h('section', { class: 'card', style: 'margin-bottom:16px' },
            h('div', { class: 'card-head' },
              h('h3', null, title),
              h('button', {
                class: 'btn small primary', type: 'button',
                onclick: async () => {
                  const suggested = kind === 'hero' ? 'Hero' : kind === 'page' ? 'Page header' : 'New section';
                  const name = prompt('Name this template:', suggested);
                  if (name == null || !name.trim()) return;
                  try {
                    const created = await api('POST', '/api/layouts', {
                      section: blankTemplateSection(kind), name: name.trim(), kind, page: '',
                    });
                    const full = await api('GET', `/api/layouts/${encodeURIComponent(created.id)}`);
                    layouts.unshift({
                      id: full.id, name: full.name, kind: full.kind || kind, page: full.page || '',
                      savedAt: full.savedAt, layers: (full.section?.layers || []).length,
                      layout: full.section?.layout || 'canvas',
                    });
                    editing = { id: full.id, name: full.name, kind: full.kind || kind, section: full.section };
                    editingBase = JSON.stringify({ name: editing.name, kind: editing.kind, section: editing.section });
                    draw();
                  } catch (err) { toast(err.message, true); }
                },
              }, 'New template')),
            h('p', { class: 'hint', style: 'margin-bottom:12px' }, blurb),
            rows.length ? null : h('p', { class: 'muted' }, 'No templates in this group yet.'),
            rows.map((t) => h('div', { class: 'card', style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;margin-bottom:10px' },
              h('span', null,
                h('strong', null, t.name),
                t.builtin ? h('span', { class: 'tag' }, 'Default') : null,
                h('span', { class: 'muted small' },
                  `  ·  ${t.layers} layer${t.layers === 1 ? '' : 's'}${t.layout === 'canvas' ? '' : ` · ${t.layout}`}${t.page ? ` · from ${t.page}` : ''}${t.savedAt ? `  ·  ${new Date(t.savedAt).toLocaleDateString()}` : ''}`)),
              h('span', { class: 'group-btns' },
                h('button', {
                  class: 'btn small primary', type: 'button',
                  onclick: async () => {
                    try {
                      const full = await api('GET', `/api/layouts/${encodeURIComponent(t.id)}`);
                      editing = {
                        id: full.id,
                        name: full.name,
                        kind: full.kind || 'section',
                        section: full.section,
                      };
                      editingBase = JSON.stringify({ name: editing.name, kind: editing.kind, section: editing.section });
                      draw();
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Edit'),
                t.builtin ? h('button', {
                  class: 'btn small', type: 'button',
                  onclick: async () => {
                    if (!confirm(`Put “${t.name}” back to the default? Your saved changes to this template are removed. Pages that already use a copy are not changed.`)) return;
                    try {
                      await api('POST', `/api/layouts/${encodeURIComponent(t.id)}/reset`);
                      toast('Restored the default.');
                      viewLayouts(container);
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Back to default') : null,
                h('button', {
                  class: 'btn small', type: 'button',
                  onclick: async () => {
                    const name = prompt('Rename this layout:', t.name);
                    if (name == null || !name.trim()) return;
                    try {
                      await api('PATCH', `/api/layouts/${encodeURIComponent(t.id)}`, { name: name.trim() });
                      t.name = name.trim();
                      draw();
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Rename'),
                h('button', {
                  class: 'btn small', type: 'button',
                  onclick: async () => {
                    try {
                      const res = await api('POST', `/api/layouts/${encodeURIComponent(t.id)}/section`, { rename: false });
                      const blob = new Blob([JSON.stringify({ name: t.name, kind: t.kind || 'section', section: res.section }, null, 2)], { type: 'application/json' });
                      const a = h('a', { href: URL.createObjectURL(blob), download: `${t.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json` });
                      document.body.append(a);
                      a.click();
                      a.remove();
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Export'),
                t.builtin ? null : h('button', {
                  class: 'btn small danger', type: 'button',
                  onclick: async () => {
                    if (!confirm(`Delete the saved layout "${t.name}"? Sections already on your pages are not affected.`)) return;
                    try {
                      await api('DELETE', `/api/layouts/${encodeURIComponent(t.id)}`);
                      layouts = layouts.filter((x) => x.id !== t.id);
                      draw();
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Delete')))));
        }));
    };
    draw();
  }

  // =========================================================================
  // Navigation + rendering
  // =========================================================================

  const currentView = () => decodeURIComponent(location.hash.slice(1)) || 'home';
  const go = (view) => {
    if (currentView() === view) render();
    else location.hash = view;
  };
  window.addEventListener('hashchange', () => { if (content) render(); });

  function navItem(view, label, extra) {
    return h('button', {
      class: `nav-item${currentView() === view ? ' active' : ''}`,
      type: 'button',
      onclick: () => go(view),
    }, h('span', null, label), extra);
  }

  function renderSidebar() {
    if (!content) return;
    mount($('#sidebar-nav'),
      h('div', { class: 'nav-heading' }, 'Website'),
      navItem('home', 'Home page'),
      h('div', { class: 'nav-heading' }, 'Pages'),
      content.pages.map((p) => navItem(`page:${p.id}`, p.navLabel || p.title || '(untitled)',
        p.showInNav === false ? h('span', { class: 'tag' }, 'hidden') : null)),
      h('button', { class: 'nav-item nav-add', type: 'button', onclick: newPageFromLayout }, '+ New page'),
      h('div', { class: 'nav-heading' }, 'Settings & files'),
      navItem('site', 'Site settings'),
      navItem('layouts', 'Section layouts'),
      navItem('media', 'Media library'),
      navItem('messages', 'Messages', unread ? h('span', { class: 'badge' }, unread) : null),
      navItem('backups', 'Backups'));
  }

  function updateViewLink() {
    const link = $('#view-link');
    const view = currentView();
    let href = null;
    if (view === 'home') href = '/';
    else if (view.startsWith('page:')) {
      const page = content.pages.find((p) => p.id === view.slice(5));
      if (page) href = `/${page.slug}`;
    }
    link.hidden = !href;
    if (href) link.href = href;
    link.textContent = isDirty() ? 'View on website (save first to see changes) ↗' : 'View on website ↗';
  }

  // Undo rebuilds the editor. The page and each board viewport must come back
  // to the same place: a new canvas starts scrolled to the top, and Chrome
  // also jumps the page when the focused field is removed.
  function captureScrollState() {
    return {
      x: window.scrollX,
      y: window.scrollY,
      canvases: [...document.querySelectorAll('.canvas-host')].map((host, index) => {
        const viewport = host.querySelector('.cv-viewport');
        const inspector = host.querySelector('.cv-inspector');
        const layers = host.querySelector('.cv-layers');
        return {
          key: host.dataset.canvasKey || '',
          index,
          left: viewport ? viewport.scrollLeft : 0,
          top: viewport ? viewport.scrollTop : 0,
          inspector: inspector ? inspector.scrollTop : 0,
          layers: layers ? layers.scrollTop : 0,
        };
      }),
    };
  }

  function restoreScrollState(state) {
    if (!state) return;
    window.scrollTo(state.x, state.y);
    const hosts = [...document.querySelectorAll('.canvas-host')];
    state.canvases.forEach((saved) => {
      const host = (saved.key && hosts.find((el) => el.dataset.canvasKey === saved.key)) || hosts[saved.index];
      if (!host) return;
      const viewport = host.querySelector('.cv-viewport');
      const inspector = host.querySelector('.cv-inspector');
      const layers = host.querySelector('.cv-layers');
      if (viewport) {
        viewport.scrollLeft = saved.left;
        viewport.scrollTop = saved.top;
      }
      if (inspector) inspector.scrollTop = saved.inspector;
      if (layers) layers.scrollTop = saved.layers;
    });
  }

  function render(opts = {}) {
    const view = currentView();
    const editor = $('#editor');
    const title = $('#view-title');
    const scroll = opts.keepScroll ? captureScrollState() : null;
    if (scroll && opts.scrollY != null) scroll.y = opts.scrollY;
    if (scroll) {
      const active = document.activeElement;
      if (active && active !== document.body && editor.contains(active)) active.blur();
    }
    destroyLiveEditors();
    renderSidebar();
    if (scroll) restoreScrollState(scroll);

    // Suggestions for link fields: all page addresses.
    const datalist = h('datalist', { id: 'page-links' },
      h('option', { value: '/' }), content.pages.map((p) => h('option', { value: `/${p.slug}` })));

    if (view === 'site') {
      title.textContent = 'Site settings';
      mount(editor, datalist, ...viewSite());
    } else if (view === 'messages') {
      title.textContent = 'Messages';
      viewMessages(editor);
    } else if (view === 'media') {
      title.textContent = 'Media library';
      viewMedia(editor);
    } else if (view === 'layouts') {
      title.textContent = 'Section layouts';
      viewLayouts(editor);
    } else if (view === 'backups') {
      title.textContent = 'Backups';
      viewBackups(editor);
    } else if (view.startsWith('page:')) {
      const page = content.pages.find((p) => p.id === view.slice(5));
      if (!page) return go('home');
      title.textContent = page.navLabel || page.title;
      mount(editor, datalist, ...viewPage(page));
    } else {
      title.textContent = 'Home page';
      mount(editor, datalist, ...viewHome());
    }
    updateViewLink();
    if (scroll) {
      restoreScrollState(scroll);
      // The browser scrolls again after this handler, once the focused node
      // is gone. Put the page and the boards back on the next frames.
      requestAnimationFrame(() => {
        restoreScrollState(scroll);
        requestAnimationFrame(() => restoreScrollState(scroll));
      });
      setTimeout(() => restoreScrollState(scroll), 0);
    }
  }

  // =========================================================================
  // Login + startup
  // =========================================================================

  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    $('#password').focus();
  }

  async function startApp() {
    content = await api('GET', '/api/content');
    await loadCustomFonts();
    savedJson = JSON.stringify(content);
    resetEditHistory();
    $('#login').hidden = true;
    $('#app').hidden = false;
    changed();
    render();
    liveEditors.forEach((editor) => {
      try { if (editor && typeof editor.refitAutoFits === 'function') editor.refitAutoFits(); } catch (err) { /* ignore */ }
    });
    api('GET', '/api/messages')
      .then((list) => { unread = list.filter((m) => !m.read).length; renderSidebar(); })
      .catch(() => {});
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('POST', '/api/login', { password: $('#password').value });
      $('#password').value = '';
      await startApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    if (isDirty() && !confirm('You have unsaved changes. Log out anyway?')) return;
    await api('POST', '/api/logout').catch(() => {});
    content = null;
    showLogin();
  });

  $('#save').addEventListener('click', save);
  $('#discard').addEventListener('click', discard);

  document.addEventListener('keydown', (e) => {
    if (!content || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      save();
      return;
    }
    // A section-layout template keeps its own undo stack. Ctrl+Z there must
    // not step through the page history, which never recorded those edits.
    const templateUndo = window.__templateEditorUndo;
    if (templateUndo && templateUndo.editor && !templateUndo.editor.destroyed) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      e.preventDefault();
      if (key === 'z' && !e.shiftKey) templateUndo.undo();
      else if (key === 'y' || (key === 'z' && e.shiftKey)) templateUndo.redo();
      return;
    }
    // Undo and redo cover every edit on the site, including fields and the canvas.
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redoEdit(); }
  }, true);

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Login disabled — go straight to the editor
  (async () => {
    try {
      await startApp();
    } catch (err) {
      showLogin(err.message);
    }
  })();
})();
