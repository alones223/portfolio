// ===========================================================================
// Visual layout editor ("template canvas") for page sections.
//
// A canvas section is a fixed-height board. On that board the user places
// layers: headings, text, images, image groups, buttons, dividers or shapes.
// Each layer stores its position/size in pixels plus font, colour and
// animation settings. Sections are independent: every section owns its own
// board and its own layers.
//
// This file only talks to the rest of the admin panel through the small API
// object handed to createLayoutEditor(), so it can be edited on its own.
// ===========================================================================

window.CanvasEditor = (function () {
  'use strict';

  const CANVAS_W = 1425;      // board width used on the live site
  const CANVAS_H = 720;       // default board height
  const SNAP = 6;             // arrow keys move by this many pixels
  const GRID = 20;            // holding Shift snaps dragging to this grid

  const LAYER_TYPES = [
    ['heading', 'Heading'],
    ['text', 'Text'],
    ['paragraph', 'Paragraph'],
    ['image', 'Image'],
    ['gallery', 'Image group'],
    ['group', 'Group'],
    ['button', 'Button'],
    ['divider', 'Divider line'],
    ['shape', 'Shape / block'],
  ];

  // Animation names must match the CSS in public/css/canvas.css
  const ANIMATIONS = [
    ['none', 'None'],
    ['fade', 'Fade in'],
    ['up', 'Slide up'],
    ['down', 'Slide down'],
    ['left', 'Slide in from left'],
    ['right', 'Slide in from right'],
    ['zoom', 'Zoom in'],
    ['zoomOut', 'Zoom out'],
    ['float', 'Float gently (always moving)'],
    ['pulse', 'Pulse (always moving)'],
  ];

  const FONTS = [
    ['var(--font-display)', 'Display (Krona One)'],
    ['var(--font-serif)', 'Serif (Playfair)'],
    ['var(--font-body)', 'Body (Zen Kaku)'],
    ['Georgia, serif', 'Georgia'],
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['"Courier New", monospace', 'Courier'],
  ];

  const FITS = [
    ['cover', 'Fill the box (crop)'],
    ['contain', 'Fit inside (no crop)'],
    ['fill', 'Stretch'],
  ];

  const MAX_TEXT = 2600;

  let sealCounter = 0;
  const seal = (text) => ({ __html: String(text), __id: `h${++sealCounter}` });

  function layerTypeLabel(type) {
    const found = LAYER_TYPES.find(([v]) => v === type);
    return found ? found[1] : 'Layer';
  }

  function defaultLayer(type, patch) {
    const base = {
      id: `l-${Math.random().toString(36).slice(2, 9)}`,
      type,
      name: layerTypeLabel(type),
      x: 60 + (Math.random() * 40 | 0),
      y: 60 + (Math.random() * 40 | 0),
      w: 520,
      h: 200,
      text: '',
      src: '',
      alt: '',
      link: '',
      hidden: false,
      locked: false,
      z: 0,
      color: '',
      bg: '',
      font: '',
      size: 28,
      weight: 700,
      align: 'left',
      lineHeight: 1.25,
      letterSpacing: 0,
      radius: 0,
      borderWidth: 0,
      borderColor: '',
      fit: 'cover',
      animated: true,
      anim: 'fade',
      delay: 0,
      duration: 0.9,
      images: [],
      columns: 3,
      gap: 16,
      aspect: 'natural',
      hugging: false, // text boxes grow with their content
      buttonStyle: 'pill',
      newTab: true,
    };
    if (type === 'heading') Object.assign(base, { text: 'New heading', size: 46, weight: 700, anim: 'up', color: '' });
    if (type === 'text') Object.assign(base, { text: 'Write something here.', size: 18, weight: 400, w: 560, h: 160, anim: 'fade', hugging: false });
    if (type === 'paragraph') Object.assign(base, {
      text: 'This is a paragraph. The words wrap inside the box.\n\nLeave a blank line to start the next paragraph.',
      size: 18, weight: 400, w: 480, h: 180, lineHeight: 1.55,
      font: 'var(--font-body)', color: '#4F5E75', align: 'left',
      anim: 'fade', hugging: true, autoFit: false,
    });
    if (type === 'image') Object.assign(base, { w: 460, h: 320, radius: 10, anim: 'zoom' });
    if (type === 'gallery') Object.assign(base, { w: 900, h: 420, anim: 'up', images: [] });
    if (type === 'group') Object.assign(base, { w: 200, h: 200, anim: 'none', children: [] });
    if (type === 'button') Object.assign(base, { text: 'Read more', w: 200, h: 54, size: 16, weight: 600, align: 'center', anim: 'up' });
    if (type === 'divider') Object.assign(base, { w: 420, h: 2, color: '#0A192F', anim: 'fade' });
    if (type === 'shape') Object.assign(base, { w: 420, h: 220, bg: '#E1E5EB', radius: 12, anim: 'fade', shape: 'rect', shapePoints: '' });
    return Object.assign(base, patch || {});
  }

  // One palette for every colour field. Recent colours are remembered as they
  // are used. Saved colours stay until the user removes them.
  const PALETTE_RECENT = 'portfolio-recent-colors';
  const PALETTE_SAVED = 'portfolio-saved-colors';
  const PALETTE_MAX = 12;

  function paletteRead(key) {
    try {
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(list) ? list.map(paletteNorm).filter(Boolean) : [];
    } catch (err) {
      return [];
    }
  }

  function paletteWrite(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list.slice(0, PALETTE_MAX))); } catch (err) { /* storage may be blocked */ }
  }

  function paletteNorm(value) {
    const v = String(value || '').trim();
    const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
    if (hex) {
      const body = hex[1].toUpperCase();
      if (!hex[2] || /^ff$/i.test(hex[2])) return `#${body}`;
      return `#${body}${hex[2].toUpperCase()}`;
    }
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
    if (!rgb) return '';
    const parts = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Math.max(0, Math.round(Number(n)))));
    if (rgb[4] == null || Number(rgb[4]) >= 0.995) {
      return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }
    const alpha = Math.round(Math.min(1, Math.max(0, Number(rgb[4]))) * 100) / 100;
    return `rgba(${parts.join(', ')}, ${alpha})`;
  }

  function paletteRemember(value) {
    const color = paletteNorm(value);
    if (!color) return;
    const list = paletteRead(PALETTE_RECENT).filter((item) => item !== color);
    list.unshift(color);
    paletteWrite(PALETTE_RECENT, list);
  }

  function paletteSave(value) {
    const color = paletteNorm(value);
    if (!color) return false;
    const list = paletteRead(PALETTE_SAVED).filter((item) => item !== color);
    list.unshift(color);
    paletteWrite(PALETTE_SAVED, list);
    paletteRemember(color);
    return true;
  }

  function paletteUnsave(value) {
    const color = paletteNorm(value);
    paletteWrite(PALETTE_SAVED, paletteRead(PALETTE_SAVED).filter((item) => item !== color));
  }

  function paletteSwatches(colors, removable, onPick, paint) {
    const wrap = document.createElement('div');
    wrap.className = 'color-palette-swatches';
    colors.forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch';
      btn.style.background = color;
      btn.title = removable ? `${color}. Click to use it again.` : color;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick(color);
      });
      if (removable) {
        const remove = document.createElement('span');
        remove.className = 'color-swatch-x';
        remove.textContent = '×';
        remove.title = 'Remove saved colour';
        remove.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          paletteUnsave(color);
          paint();
        });
        btn.append(remove);
      }
      wrap.append(btn);
    });
    return wrap;
  }

  function paletteMount({ getColor, onPick }) {
    const root = document.createElement('div');
    root.className = 'color-palette';
    const paint = () => {
      root.replaceChildren();
      const recent = paletteRead(PALETTE_RECENT);
      const recentBlock = document.createElement('div');
      recentBlock.className = 'color-palette-block';
      const recentLabel = document.createElement('span');
      recentLabel.className = 'color-palette-label';
      recentLabel.textContent = 'Recent';
      recentBlock.append(recentLabel);
      if (recent.length) recentBlock.append(paletteSwatches(recent, false, onPick, paint));
      else {
        const empty = document.createElement('span');
        empty.className = 'color-palette-empty';
        empty.textContent = 'None yet';
        recentBlock.append(empty);
      }
      const savedHead = document.createElement('div');
      savedHead.className = 'color-palette-head';
      const savedLabel = document.createElement('span');
      savedLabel.className = 'color-palette-label';
      savedLabel.textContent = 'Saved';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn small';
      saveBtn.textContent = 'Save colour';
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (paletteSave(getColor())) paint();
      });
      savedHead.append(savedLabel, saveBtn);
      const saved = paletteRead(PALETTE_SAVED);
      root.append(recentBlock, savedHead);
      if (saved.length) root.append(paletteSwatches(saved, true, onPick, paint));
    };
    paint();
    return { el: root, paint };
  }

  return {
    LAYER_TYPES, ANIMATIONS, FONTS, FITS, CANVAS_W, CANVAS_H, SNAP, GRID, MAX_TEXT,
    seal, defaultLayer, layerTypeLabel,
    palette: { remember: paletteRemember, save: paletteSave, mount: paletteMount, norm: paletteNorm },
  };
})();
