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
  const isPdf = (url) => /\.pdf(\?|$)/i.test(url || '');

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
      return res.files.map((f) => f.url);
    } catch (err) {
      toast(`Upload failed: ${err.message}`, true);
      return [];
    }
  }

  function mediaPreview(url) {
    if (!url) return document.createTextNode('No image');
    if (isVideo(url)) return h('video', { src: url, muted: true, preload: 'metadata' });
    if (isPdf(url)) return h('span', { class: 'pdf-badge' }, 'PDF');
    return h('img', { src: url, alt: '', loading: 'lazy' });
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
  // Live layout editors, held outside the content object so they are never saved.
  const editors = new WeakMap();

  const isDirty = () => content && JSON.stringify(content) !== savedJson;

  let sidebarTimer;
  function changed() {
    const dirty = isDirty();
    $('#save').disabled = !dirty;
    $('#discard').hidden = !dirty;
    const state = $('#save-state');
    state.textContent = dirty ? 'Unsaved changes' : hasSavedOnce ? 'All changes saved' : '';
    state.classList.toggle('dirty', dirty);
    clearTimeout(sidebarTimer);
    sidebarTimer = setTimeout(renderSidebar, 150);
    schedulePreview();
  }

  let previewTimer = 0;
  let previewToken = 0;
  function schedulePreview() {
    const view = currentView();
    if (view !== 'home' && !view.startsWith('page:')) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { refreshPreview(); }, 700);
  }

  async function refreshPreview() {
    const frame = document.querySelector('#live-preview');
    if (!frame || !content) return;
    const token = ++previewToken;
    const view = currentView();
    let path = '/preview';
    if (view.startsWith('page:')) {
      const page = content.pages.find((p) => p.id === view.slice(5));
      if (!page || !page.slug) return;
      path = `/preview/${page.slug}`;
    }
    try {
      await api('POST', '/api/preview', content);
    } catch (err) {
      return;
    }
    if (token !== previewToken) return;
    frame.src = `${path}?t=${Date.now()}`;
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
      changed();
    });
    let control = input;
    if (opts.prefix) control = h('div', { class: 'prefix-input' }, h('span', null, opts.prefix), input);
    return wrapField(label, control, opts, id);
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

  function colorField(obj, key, label, opts = {}) {
    const id = uid();
    const color = h('input', { type: 'color', value: obj[key] || '#000000', 'aria-label': `${label} color picker` });
    const text = h('input', { id, type: 'text', value: obj[key] || '' });
    color.addEventListener('input', () => { obj[key] = color.value.toUpperCase(); text.value = obj[key]; changed(); });
    text.addEventListener('input', () => {
      obj[key] = text.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(obj[key])) color.value = obj[key];
      changed();
    });
    return wrapField(label, h('div', { class: 'color-input' }, color, text), { span: 2, ...opts }, id);
  }

  function imageField(obj, key, label, opts = {}) {
    const thumb = h('div', { class: 'img-thumb', title: 'Click to choose an image, or drop a file here' });
    const url = h('input', { type: 'text', placeholder: '/uploads/… or https://…', 'aria-label': `${label} URL` });
    const paint = () => {
      thumb.replaceChildren(mediaPreview(obj[key]));
      url.value = obj[key] || '';
    };
    const set = (v) => { obj[key] = v; paint(); changed(); };
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

    const addUrls = (urls, at = arr.length) => {
      const items = urls.map((url) => {
        const item = { image: url, [captionKey]: '', link: '' };
        if (opts.showWide) item.wide = false;
        return item;
      });
      arr.splice(at, 0, ...items);
      changed();
      draw();
    };

    function tile(item, i) {
      const img = h('div', { class: 'tile-img', title: 'Click to replace this image, or drop a file on it' },
        mediaPreview(item.image),
        h('span', { class: 'num' }, pad2(i + 1)));
      img.addEventListener('click', async () => {
        const url = await pickImage();
        if (url) { item.image = url; changed(); draw(); }
      });
      addFileDrop(img, async (files) => {
        const [url] = await uploadFiles(files.slice(0, 1));
        if (url) { item.image = url; changed(); draw(); }
      });

      const caption = h('textarea', { rows: 2, placeholder: opts.captionLabel || 'Caption (optional)', 'aria-label': 'Caption' });
      caption.value = item[captionKey] || '';
      caption.addEventListener('input', () => { item[captionKey] = caption.value; changed(); });

      let link = null;
      if (opts.showLink !== false) {
        const pages = [{ value: '/', label: 'Home' }, ...(content?.pages || []).map((p) => ({
          value: `/${p.slug}`,
          label: p.navLabel || p.title || p.slug,
        }))];
        const known = pages.some((p) => p.value === (item.link || ''));
        const pagePick = h('select', { 'aria-label': 'Site page' },
          h('option', { value: '' }, 'Choose a page…'),
          pages.map((p) => h('option', { value: p.value, selected: item.link === p.value }, `${p.label} (${p.value})`)),
          !known && item.link ? h('option', { value: item.link, selected: true }, item.link) : null);
        pagePick.addEventListener('change', () => {
          if (!pagePick.value) return;
          item.link = pagePick.value;
          link.value = item.link;
          changed();
        });
        link = h('input', { type: 'text', placeholder: opts.linkPlaceholder || 'Or type a link', 'aria-label': 'Link', list: 'page-links' });
        link.value = item.link || '';
        link.addEventListener('input', () => {
          item.link = link.value.trim();
          pagePick.value = pages.some((p) => p.value === item.link) ? item.link : '';
          changed();
        });
        link = h('div', { class: 'tile-link' }, pagePick, link);
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
            iconBtn('←', 'Move earlier', () => { move(arr, i, i - 1); changed(); draw(); }, { disabled: i === 0 }),
            iconBtn('→', 'Move later', () => { move(arr, i, i + 1); changed(); draw(); }, { disabled: i === arr.length - 1 })),
          h('span', { class: 'group-btns' },
            iconBtn('✕', 'Remove from page', () => { arr.splice(i, 1); changed(); draw(); }, { danger: true }))));

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
          changed();
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
    navy: 'Headings & main text',
    slate: 'Body text',
    headerBg: 'Header background',
    highlight: 'Heading highlight bar',
    heroBg: 'Behind hero images',
    aboutBg: 'About section background',
    pageBg: 'Page background',
    decorText: 'Big faint text ("ABOUT ME", "WORKS")',
    bigWord: 'Big hero word ("portfolio")',
    button: 'Submit button',
    marqueeBg: 'Scrolling band background',
    marqueeText: 'Scrolling band text',
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
        fields(Object.keys(THEME_LABELS).map((k) => colorField(s.theme, k, THEME_LABELS[k])))),
      card('Fonts',
        h('p', { class: 'hint', style: 'margin-bottom:12px' },
          'Any font from fonts.google.com. Type the exact name, optionally followed by weights, e.g. "Playfair Display:wght@400;500".'),
        fields(
          textField(s.fonts, 'display', 'Display font (menu, page titles)', { span: 4 }),
          textField(s.fonts, 'serif', 'Decorative serif (big words, product titles)', { span: 4 }),
          textField(s.fonts, 'body', 'Body text font', { span: 4 }))),
    ];
  }

  function viewHome() {
    const home = content.home;
    home.sections = home.sections || [];
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
            openPanels.add(s);
            changed();
            drawSections();
          },
        }, '+ Add section'));
    };
    drawSections();

    return [
      card('Hero (top of the page)',
        fields(
          imageField(home.hero, 'image', 'Background image'),
          textField(home.hero, 'name', 'Large name', { span: 2 }),
          textField(home.hero, 'tagline', 'Tagline', { span: 2 }),
          textField(home.hero, 'bigWord', 'Big colored word at the bottom', { span: 2 }),
          textField(home, 'seoTitle', 'Browser tab title for this page', { span: 2 }))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', null, `Sections (${home.sections.length})`),
          h('div', { class: 'list-tools' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { home.sections.forEach((s) => openPanels.add(s)); drawSections(); } }, 'Expand all'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { home.sections.forEach((s) => openPanels.delete(s)); drawSections(); } }, 'Collapse all'))),
        h('p', { class: 'hint', style: 'margin-bottom:12px' },
          'The part of the page between the hero and "Works". Each section is its own board: put text, images and image groups anywhere on it. Use ⧉ to copy a section as a new one and then change the copy — the original is left untouched. ⧉ keeps its own layers, so the two boards never move together.'),
        sectionsWrap),
      card('Works',
        fields(
          textField(home.works, 'heading', 'Heading', { span: 2 }),
          textField(home.works, 'decorText', 'Big faint background text', { span: 2, multiline: true, rows: 2 }),
          textField(home.works, 'description', 'Description', { multiline: true, rows: 3 }),
          h('div', { class: 'span-4' },
            tilesEditor(home.works.cards, {
              label: 'Category cards',
              captionKey: 'label',
              captionLabel: 'Card title',
              linkPlaceholder: 'Or paste a link',
            })))),
      card('Contact section',
        fields(
          textField(home.contact, 'heading', 'Heading', { span: 2 }),
          textField(home.contact, 'emailLine', 'Email line', { span: 2 }),
          textField(home.contact, 'text', 'Text', { multiline: true, rows: 3 }),
          textField(home.contact, 'labelName', 'Form label: name', { span: 1 }),
          textField(home.contact, 'labelEmail', 'Form label: email', { span: 1 }),
          textField(home.contact, 'labelSubject', 'Form label: subject', { span: 1 }),
          textField(home.contact, 'labelMessage', 'Form label: message', { span: 1 }),
          textField(home.contact, 'labelSubmit', 'Submit button text', { span: 1 }),
          textField(home.contact, 'successMessage', 'Message shown after sending', { span: 3 }))),
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
  function chooseSectionLayout({ title, includeSaved }) {
    return new Promise((resolve) => {
      const dlg = h('dialog', { class: 'picker section-picker' });
      const list = h('div', { class: 'tpl-grid' });
      const close = (value) => { dlg.close(); dlg.remove(); resolve(value); };

      const draw = (presets, saved) => {
        mount(list, 
          h('div', { class: 'tpl-section' }, h('h4', null, 'Start from a layout'),
            h('div', { class: 'tpl-cards' }, presets.map((p) => h('button', {
              class: 'tpl-card', type: 'button', onclick: () => close({ kind: 'preset', id: p.id }),
            }, h('strong', null, p.name), h('span', null, p.description))))),
          includeSaved && saved.length ? h('div', { class: 'tpl-section' }, h('h4', null, 'Saved layouts'),
            h('div', { class: 'tpl-cards' }, saved.map((t) => h('button', {
              class: 'tpl-card', type: 'button', onclick: () => close({ kind: 'saved', id: t.id }),
            }, h('strong', null, t.name),
              h('span', null, `${t.layers} layer${t.layers === 1 ? '' : 's'}${t.page ? ` · from ${t.page}` : ''}`))))) : null,
          includeSaved && !saved.length
            ? h('p', { class: 'hint' }, 'Layouts you save from a section appear here, ready to reuse on any page.')
            : null);
      };

      dlg.append(
        h('div', { class: 'picker-head' },
          h('h3', null, title),
          h('button', { class: 'btn small', type: 'button', onclick: () => close(null) }, 'Cancel')),
        h('p', { class: 'hint', style: 'margin-bottom:12px' }, 'Every section is separate: adding or copying one only affects the page you are on.'),
        list);
      dlg.addEventListener('close', () => { if (dlg.isConnected) dlg.remove(); resolve(null); });
      document.body.append(dlg);
      dlg.showModal();
      draw([], []);

      api('GET', '/api/section-presets')
        .then((presets) => (includeSaved ? api('GET', '/api/layouts').then((saved) => draw(presets, saved)) : draw(presets, [])))
        .catch((err) => mount(list, h('p', { class: 'muted' }, err.message)));
    });
  }

  // "Save this layout" — keeps a copy on the server so it can be reused on any
  // page later. The name is asked for first, so a half-saved layout never lands
  // on the shelf.
  async function saveSectionLayout(section, pageLabel) {
    const suggested = String(section.heading || section.name || 'Section').replace(/\n/g, ' ').trim();
    const name = prompt('Save this layout as:', suggested || 'My layout');
    if (name == null) return;
    if (!name.trim()) return toast('Give the layout a name so you can find it later.', true);
    try {
      await api('POST', '/api/layouts', { section, name: name.trim(), page: pageLabel || '' });
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
  function blankCasePage() {
    const page = {
      id: `p-${rand()}`, slug: uniqueSlug('case-study'), navLabel: 'Case study', showInNav: true,
      title: 'Case study', subtitle: '', heroImage: '',
      kind: 'case', role: '', brief: '', process: '', outcome: '',
      sections: [newSection()],
    };
    openPanels.add(page.sections[0]);
    content.pages.push(page);
    changed();
    go(`page:${page.id}`);
  }

  function newPage() {
    const page = {
      id: `p-${rand()}`, slug: uniqueSlug('new-page'), navLabel: 'New page', showInNav: true,
      title: 'NEW PAGE', subtitle: '', heroImage: '', sections: [newSection()],
    };
    openPanels.add(page.sections[0]);
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
    openPanels.add(s);
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
      : `${(s.items || []).length} image${(s.items || []).length === 1 ? '' : 's'}`;
    return `${name} · ${count}`;
  };

  function sectionPanel(page, s, i, redraw, pageLabel) {
    const sections = page.sections;
    const titleEl = h('span', { class: 'panel-title' }, (s.heading || '').replace(/\n/g, ' ') || '(untitled section)');
    const metaEl = h('span', { class: 'panel-meta' }, sectionMeta(s));
    const panel = h('div', { class: `panel${openPanels.has(s) ? ' open' : ''}` });
    const head = h('div', { class: 'panel-head', role: 'button', tabindex: '0', 'aria-expanded': String(openPanels.has(s)) },
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
          openPanels.delete(s);
          openPanels.add(copy);
          changed();
          redraw();
        }),
        iconBtn('✕', 'Delete section', () => {
          const what = (s.layout || 'gallery') === 'canvas' ? `${(s.layers || []).length} layers` : `${(s.items || []).length} images`;
          if (!confirm(`Delete the section "${s.heading || 'untitled'}" and its ${what} from this page?\n(The image files stay in the media library.)`)) return;
          const editor = editors.get(s);
          if (editor) { editor.destroy(); editors.delete(s); }
          sections.splice(i, 1);
          changed();
          redraw();
        }, { danger: true })));

    const toggle = () => {
      if (openPanels.has(s)) openPanels.delete(s); else openPanels.add(s);
      redraw();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    panel.append(head);

    if (openPanels.has(s)) {
      s.items = s.items || [];
      s.buttons = s.buttons || [];
      s.layers = s.layers || [];

      // Switching layout must not throw work away: the editor redraws in place
      // and the other layout's data is kept for when you switch back.
      const refreshMeta = () => { metaEl.textContent = sectionMeta(s); };

      const editorHost = h('div', { class: 'canvas-host' });

      const mountCanvas = () => {
        const existing = editors.get(s);
        if (existing && !existing.destroyed) return;
        if (existing) editors.delete(s);
        const editor = window.CanvasEditorUI.createLayoutEditor({
          section: s,
          onChange: () => { changed(); refreshMeta(); },
          onRequestImage: () => pickImage(),
          onRequestFiles: (files) => uploadFiles(files),
        });
        editor.destroyed = false;
        editors.set(s, editor);
        editorHost.replaceChildren(editor.element);
      };

      const unmountCanvas = () => {
        const editor = editors.get(s);
        if (!editor) return;
        editor.destroy();
        editor.destroyed = true;   // keeps the cached instance from being reused
        editorHost.replaceChildren();
      };

      const classicFields = () => [
        selectField(s, 'columns', 'Columns', [[1, '1 column'], [2, '2 columns'], [3, '3 columns'], [4, '4 columns']], { span: 1, number: true }),
        selectField(s, 'aspect', 'Image shape', ASPECTS, { span: 1 }),
        textField(s, 'text', 'Text above the images', { multiline: true, rows: 3, span: 2 }),
        textField(s, 'textAfter', 'Text below the images', { multiline: true, rows: 3, span: 2 }),
        h('div', { class: 'span-4' }, tilesEditor(s.items, {
          showWide: true,
          captionLabel: 'Caption (optional)',
          linkPlaceholder: 'Link, e.g. YouTube (optional)',
        })),
        rowList(s.buttons, {
          label: 'Buttons (e.g. "Demo Full Video")',
          addLabel: '+ Add button',
          empty: 'No buttons in this section.',
          create: () => ({ label: 'Watch video', url: '' }),
          row: (b) => [
            textField(b, 'label', 'Button text', { span: 1 }),
            textField(b, 'url', 'Link', { span: 2, placeholder: 'https://youtu.be/…', list: 'page-links' }),
          ],
        }),
      ];

      // The shared top fields, then either the board or the simple image list.
      const body = h('div', { class: 'panel-body' });
      const draw = () => {
        const isCanvas = (s.layout || 'gallery') === 'canvas';
        if (isCanvas) {
          // An image section switched to a board starts from its own content.
          if (!s.layers.length && ((s.heading || '') || (s.text || '') || (s.items || []).length || (s.textAfter || '') || (s.buttons || []).length)) {
            seedCanvasFromClassic(s);
          }
          s.canvasHeight = Number(s.canvasHeight) || 640;
          mountCanvas();
          mount(body, 
            fields(
              textField(s, 'heading', 'Section name (for your reference)', {
                multiline: true, rows: 1, span: 3,
                onInput: (v) => { titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; },
              }),
              selectField(s, 'layout', 'Image layout', LAYOUTS, { span: 1, onChange: draw }),
              h('div', { class: 'span-4' }, editorHost)),
            h('p', { class: 'hint', style: 'margin-top:10px' },
              'Each section is its own board. Drag layers to move them, drag the blue corner to resize, and hold Shift while dragging to snap to the grid. Arrow keys nudge the selected layer.'),
            h('div', { class: 'cv-btnrow', style: 'margin-top:8px' },
              h('button', { class: 'btn small', type: 'button', onclick: () => saveSectionLayout(s, pageLabel) }, 'Save this layout'),
              h('button', {
                class: 'btn small', type: 'button',
                onclick: async () => {
                  const copy = await copySectionOnServer(s);
                  sections.splice(i + 1, 0, copy);
                  openPanels.add(copy);
                  changed();
                  redraw();
                  toast('Copied as a new section below this one.');
                },
              }, 'Copy as a new section')));
        } else {
          unmountCanvas();
          mount(body, 
            fields(
              textField(s, 'heading', 'Section heading', {
                multiline: true, rows: 1, span: 3,
                onInput: (v) => { titleEl.textContent = v.replace(/\n/g, ' ') || '(untitled section)'; },
              }),
              selectField(s, 'align', 'Heading alignment', [['left', 'Left'], ['center', 'Centered']], { span: 1 }),
              selectField(s, 'layout', 'Image layout', LAYOUTS, { span: 2, onChange: draw }),
              ...classicFields()));
        }
        refreshMeta();
      };
      draw();
      panel.append(body);
    }
    return panel;
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
            openPanels.add(s);
            changed();
            drawSections();
          },
        }, '+ Add section'));
    };
    drawSections();

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
          checkField(page, 'showInNav', 'Show this page in the menu', { span: 4 }),
          textField(page, 'title', 'Page title (big heading)', { span: 2 }),
          textField(page, 'subtitle', 'Subtitle', { span: 2, multiline: true, rows: 2 }),
          imageField(page, 'heroImage', 'Header background image'),
          h('div', { class: 'field span-4' },
            h('label', { class: 'field check' },
              (() => {
                const input = h('input', { type: 'checkbox', checked: page.kind === 'case' });
                input.addEventListener('change', () => {
                  page.kind = input.checked ? 'case' : '';
                  changed();
                  render();
                });
                return input;
              })(),
              'Case study (brief, process, outcome)')),
          page.kind === 'case' ? textField(page, 'role', 'Role', { span: 4, placeholder: 'e.g. Animator & Illustrator' }) : null,
          page.kind === 'case' ? textField(page, 'brief', 'Brief', { span: 4, multiline: true, rows: 4 }) : null,
          page.kind === 'case' ? textField(page, 'process', 'Process', { span: 4, multiline: true, rows: 4 }) : null,
          page.kind === 'case' ? textField(page, 'outcome', 'Outcome', { span: 4, multiline: true, rows: 3 }) : null)),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', null, `Sections (${page.sections.length})`),
          h('div', { class: 'list-tools' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { page.sections.forEach((s) => openPanels.add(s)); drawSections(); } }, 'Expand all'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { page.sections.forEach((s) => openPanels.delete(s)); drawSections(); } }, 'Collapse all'))),
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
  const ALL_FOLDER = 'all';
  const UNUSED_FOLDER = 'unused';
  let mediaFolder = ALL_FOLDER;

  // Every folder the media views can show: "All files", one per page, "Unused".
  function mediaFolderList(pageFolders) {
    return [{ id: ALL_FOLDER, label: 'All files' }, ...pageFolders, { id: UNUSED_FOLDER, label: 'Unused' }];
  }

  function inMediaFolder(file, folderId) {
    if (folderId === ALL_FOLDER) return true;
    if (folderId === UNUSED_FOLDER) return !file.used;
    return (file.folders || []).includes(folderId);
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
    const folderLabels = new Map(folders.map((f) => [f.id, f.label]));
    const usedOn = (file) => (file.folders || []).map((id) => folderLabels.get(id)).filter(Boolean).join(', ');

    const search = h('input', { type: 'search', placeholder: 'Filter by file name…', style: 'max-width:320px' });
    const grid = h('div', { class: 'media-grid' });
    const folderNav = h('nav', { class: 'media-folders', 'aria-label': 'Folders' });
    const fileIn = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm,application/pdf,.pdf', multiple: true, hidden: true });
    fileIn.addEventListener('change', async () => {
      const urls = await uploadFiles(fileIn.files);
      fileIn.value = '';
      if (urls.length) viewMedia(container);
    });

    const drawFolders = () => {
      mount(folderNav, folders.map((folder) => h('button', {
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
      h('span', { class: 'count' }, files.filter((x) => inMediaFolder(x, folder.id)).length))));
    };

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const list = files.filter((x) => x.name.toLowerCase().includes(q) && inMediaFolder(x, mediaFolder));
      mount(grid, 
        list.length ? null : h('p', { class: 'muted' }, q ? 'No files match.' : 'This folder is empty.'),
        list.map((file) => h('div', { class: 'media-card' },
          h('div', { class: 'tile-img' }, mediaPreview(file.url)),
          h('div', { class: 'media-info' },
            h('span', { class: 'name', title: file.name }, file.name),
            h('div', { class: 'row' },
              h('span', null, formatSize(file.size)),
              h('span', { class: `pill${file.used ? '' : ' unused'}` }, file.used ? 'In use' : 'Unused')),
            usedOn(file) ? h('span', { class: 'used-on', title: `Used on: ${usedOn(file)}` }, usedOn(file)) : null,
            h('div', { class: 'row' },
              h('button', {
                class: 'btn small', type: 'button',
                onclick: async () => {
                  await navigator.clipboard.writeText(file.url).catch(() => {});
                  toast(`Copied ${file.url}`);
                },
              }, 'Copy link'),
              h('button', {
                class: 'btn small danger', type: 'button',
                onclick: async () => {
                  const msg = file.used
                    ? `"${file.name}" is still used on your website. Deleting it will leave an empty spot. Delete anyway?`
                    : `Delete "${file.name}" permanently?`;
                  if (!confirm(msg)) return;
                  try {
                    await api('DELETE', `/api/media/${encodeURIComponent(file.name)}${file.used ? '?force=1' : ''}`);
                    files = files.filter((x) => x !== file);
                    drawFolders();
                    draw();
                    toast('Deleted.');
                  } catch (err) { toast(err.message, true); }
                },
              }, 'Delete'))))));
    };
    search.addEventListener('input', draw);

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
      h('p', { class: 'intro' }, `${files.length} files · ${formatSize(total)}. Folders follow the pages on your saved website: a file sits in the folder of every page that uses it. New uploads stay in "Unused" until you place them on a page.`),
      zone,
      h('div', { class: 'media-layout' },
        folderNav,
        h('div', { class: 'media-main' },
          h('div', { class: 'list-tools', style: 'margin-bottom:14px' }, search),
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

  async function viewLayouts(container) {
    mount(container, h('p', { class: 'muted' }, 'Loading…'));
    let layouts;
    try {
      layouts = await api('GET', '/api/layouts');
    } catch (err) {
      mount(container, h('p', { class: 'muted' }, err.message));
      return;
    }

    const fileIn = h('input', { type: 'file', accept: 'application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files?.[0];
      fileIn.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const section = parsed.section || parsed;
        const name = String(parsed.name || file.name.replace(/\.json$/i, '')).slice(0, 120);
        await api('POST', '/api/layouts', { section, name, page: 'Imported' });
        toast(`Imported "${name}".`);
        viewLayouts(container);
      } catch (err) {
        toast(`Could not import that file: ${err.message}`, true);
      }
    });

    const draw = () => {
      mount(container, 
        h('p', { class: 'intro' },
          'Layouts you saved from a section. They are kept apart from your pages, so reusing one never changes the section it came from. Add one to any page with "Add section".'),
        h('div', { class: 'list-tools', style: 'margin-bottom:14px' },
          h('button', { class: 'btn small primary', type: 'button', onclick: () => fileIn.click() }, 'Import a layout file'),
          fileIn),
        layouts.length ? null : h('div', { class: 'card muted' }, 'Nothing saved yet. Open a section and click "Save this layout".'),
        layouts.map((t) => h('div', { class: 'card', style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;margin-bottom:10px' },
          h('span', null,
            h('strong', null, t.name),
            h('span', { class: 'muted small' },
              `  ·  ${t.layers} layer${t.layers === 1 ? '' : 's'}${t.layout === 'canvas' ? '' : ` · ${t.layout}`}${t.page ? ` · from ${t.page}` : ''}  ·  ${new Date(t.savedAt).toLocaleDateString()}`)),
          h('span', { class: 'group-btns' },
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
                  const blob = new Blob([JSON.stringify({ name: t.name, section: res.section }, null, 2)], { type: 'application/json' });
                  const a = h('a', { href: URL.createObjectURL(blob), download: `${t.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json` });
                  document.body.append(a);
                  a.click();
                  a.remove();
                } catch (err) { toast(err.message, true); }
              },
            }, 'Export'),
            h('button', {
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
      h('button', { class: 'nav-item nav-add', type: 'button', onclick: blankCasePage }, '+ New case study'),
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

  function withPreview(nodes) {
    const view = currentView();
    if (view !== 'home' && !view.startsWith('page:')) return nodes;
    const frame = h('iframe', { id: 'live-preview', title: 'Live preview of this page' });
    return [h('div', { class: 'editor-with-preview' },
      h('div', { class: 'editor-main' }, ...nodes.filter(Boolean)),
      h('aside', { class: 'live-preview' },
        h('div', { class: 'live-preview-bar' },
          h('strong', null, 'Live preview'),
          h('button', { class: 'btn small', type: 'button', onclick: () => refreshPreview() }, 'Refresh')),
        frame))];
  }

  function render() {
    const view = currentView();
    const editor = $('#editor');
    const title = $('#view-title');
    renderSidebar();
    window.scrollTo(0, 0);

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
      mount(editor, datalist, ...withPreview(viewPage(page)));
    } else {
      title.textContent = 'Home page';
      mount(editor, datalist, ...withPreview(viewHome()));
    }
    updateViewLink();
    if (view === 'home' || view.startsWith('page:')) refreshPreview();
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
    savedJson = JSON.stringify(content);
    $('#login').hidden = true;
    $('#app').hidden = false;
    changed();
    render();
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && content) {
      e.preventDefault();
      save();
    }
  });

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
