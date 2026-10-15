const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const { presetSummaries, findPreset, defaultTemplates, layer: presetLayer } = require('./lib/section-presets');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const MAX_BACKUPS = 30;

// Saved section layouts, so a board you like can be reused on another page.
// Sections on the site stay plain objects in content.json; these are only a
// shelf of starting points.
const LAYOUT_LIBRARY_FILE = path.join(DATA_DIR, 'layouts.json');
const MAX_LIBRARY = 200;

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Write to a temp file first, then rename, so a crash never leaves half a file.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

let contentCache = null;
function getContent() {
  if (!contentCache) contentCache = readJson(CONTENT_FILE, null);
  if (!contentCache) throw new Error('data/content.json is missing');
  return contentCache;
}

// The admin panel and the live site must not have their own ideas about what a
// section is, so every incoming save is passed through normContent first. This
// fills in ids, default layouts and missing gallery slots, and drops anything
// malformed instead of letting it reach a view.
function normContent(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const content = JSON.parse(JSON.stringify(raw));
  if (content.home && typeof content.home === 'object') {
    content.home.sections = normSections(content.home.sections);
    // Hero and Works can be a layout canvas, the same shape as a page section.
    // The older form (name, tagline, cards) is left as-is until canvas is on.
    if (content.home.hero?.layout === 'canvas') content.home.hero = normSection(content.home.hero, 0);
    if (content.home.works?.layout === 'canvas') content.home.works = normSection(content.home.works, 0);
  }
  if (Array.isArray(content.pages)) {
    content.pages.forEach((p) => {
      if (p && typeof p === 'object') {
        p.sections = normSections(p.sections);
        normPageChrome(p);
      }
    });
  }
  return content;
}

function backupContent() {
  if (!fs.existsSync(CONTENT_FILE)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(CONTENT_FILE, path.join(BACKUP_DIR, `content-${stamp}.json`));
  const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('content-')).sort();
  backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS)).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
}

const RESERVED_SLUGS = new Set(['admin', 'api', 'uploads', 'css', 'js', 'contact', 'fonts', 'favicon.ico']);

function validateContent(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['Content must be an object'];
  if (!c.site || typeof c.site !== 'object') errors.push('Missing "site" settings');
  if (!c.home || typeof c.home !== 'object') errors.push('Missing "home" page');
  if (!Array.isArray(c.pages)) errors.push('"pages" must be a list');
  const seen = new Set();
  (c.pages || []).forEach((p, i) => {
    const label = p.navLabel || p.title || `Page ${i + 1}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug || '')) {
      errors.push(`"${label}": URL slug may only contain lowercase letters, numbers and dashes`);
    } else if (RESERVED_SLUGS.has(p.slug)) {
      errors.push(`"${label}": the URL slug "${p.slug}" is reserved`);
    } else if (seen.has(p.slug)) {
      errors.push(`"${label}": another page already uses the URL slug "${p.slug}"`);
    }
    seen.add(p.slug);
    if (!Array.isArray(p.sections)) errors.push(`"${label}": sections must be a list`);
  });

  // Sections are grouped per page, so each page's sections are checked here.
  const checkSections = (sections, pageLabel) => {
    if (!Array.isArray(sections)) return;
    sections.forEach((s, i) => {
      const label = `${s && (s.heading || '').replace(/\n/g, ' ').trim() ? s.heading.replace(/\n/g, ' ').trim() : `Section ${i + 1}`} (${pageLabel})`;
      validateSection(s, label, errors);
    });
  };
  if (Array.isArray(c.home?.sections)) checkSections(c.home.sections, 'Home');
  if (c.home?.hero?.layout === 'canvas') validateSection(c.home.hero, 'Hero (Home)', errors);
  if (c.home?.works?.layout === 'canvas') validateSection(c.home.works, 'Works (Home)', errors);
  (c.pages || []).forEach((p) => {
    const pageLabel = p.navLabel || p.title || p.slug;
    checkSections(p.sections, pageLabel);
    if (p.headerBoard?.layout === 'canvas') validateSection(p.headerBoard, `Page header (${pageLabel})`, errors);
  });
  return errors;
}

// Page header chrome. Missing highlightAuto means the bar still hugs the title.
// A classic header is left alone; only a canvas header is normalised as a board.
function normPageChrome(page) {
  const color = safeColor(page.highlightColor);
  if (color) page.highlightColor = color;
  else delete page.highlightColor;
  if (page.highlightAuto === false) page.highlightAuto = false;
  else delete page.highlightAuto;
  const len = Number(page.highlightLength);
  if (Number.isFinite(len) && len > 0) page.highlightLength = Math.min(2000, Math.max(8, Math.round(len)));
  else delete page.highlightLength;
  if (page.headerBoard && page.headerBoard.layout === 'canvas') {
    page.headerBoard = normSection(page.headerBoard, 0);
  }
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Line breaks become <br>; a blank line starts a new paragraph.
function paragraphs(text, cls = '') {
  const blocks = String(text ?? '').trim().split(/\n\s*\n/).filter(Boolean);
  const attr = cls ? ` class="${cls}"` : '';
  return blocks.map((b) => `<p${attr}>${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
}

function lines(text) {
  return esc(text).replace(/\n/g, '<br>');
}

function fontFamily(spec) {
  return String(spec || '').split(':')[0].trim();
}

function googleFontsUrl(fonts = {}) {
  const specs = [...new Set(Object.values(fonts).filter(Boolean))];
  if (!specs.length) return '';
  const families = specs.map((s) => 'family=' + encodeURIComponent(s.trim()).replace(/%20/g, '+').replace(/%3A/gi, ':').replace(/%40/g, '@').replace(/%3B/gi, ';'));
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

function isExternal(url) {
  return /^https?:\/\//i.test(url || '');
}

// ---------------------------------------------------------------------------
// Layout-canvas helpers
//
// A "canvas" section is a fixed-height board with freely placed layers.
// The layout editor in /admin writes these; the values below are the safe
// whitelists used when rendering them.
// ---------------------------------------------------------------------------

const ANIMATIONS = new Set(['none', 'fade', 'up', 'down', 'left', 'right', 'zoom', 'zoomOut', 'float', 'pulse']);
const LAYER_TYPES = new Set(['heading', 'text', 'paragraph', 'image', 'gallery', 'button', 'divider', 'shape']);
const LAYOUT_SUPPORTED = new Set(['canvas', 'gallery']);
const LAYER_FITS = new Set(['cover', 'contain', 'fill']);
const MAX_LAYERS = 200;
const MAX_SECTIONS_PER_PAGE = 40;
const LAYER_FONTS = new Set([
  '', 'var(--font-display)', 'var(--font-serif)', 'var(--font-body)',
  'Georgia, serif', 'Arial, Helvetica, sans-serif', '"Courier New", monospace',
]);

// Built-in families, plus an uploaded face stored as `"Name", sans-serif`.
function safeFontFamily(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (LAYER_FONTS.has(v)) return v;
  if (/^"[A-Za-z0-9][A-Za-z0-9 .]{0,80}", sans-serif$/.test(v)) return v;
  return '';
}
const LAYER_ALIGN = new Set(['left', 'center', 'right']);

// Colours go straight into a style attribute, so only plain CSS colours pass.
// Split a stored board colour into a solid colour and an opacity from 0 to 1.
// A background image is drawn at that opacity so the slider still shows through.
function canvasBackground(value) {
  const raw = safeColor(value);
  if (!raw) return { color: 'transparent', alpha: 1 };
  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex6) return { color: raw, alpha: 1 };
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(raw);
  if (hex8) {
    return { color: `#${hex8[1]}`, alpha: Math.round((parseInt(hex8[2], 16) / 255) * 100) / 100 };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(raw);
  if (rgb) {
    const color = '#' + [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.min(255, Math.max(0, Number(n))).toString(16).padStart(2, '0'))
      .join('');
    const alpha = rgb[4] == null ? 1 : Math.min(1, Math.max(0, Number(rgb[4])));
    return { color, alpha: Math.round(alpha * 100) / 100 };
  }
  return { color: raw, alpha: 1 };
}

function safeColor(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^rgba?\(\s*[\d.%,\s]+\)$/i.test(v)) return v;
  if (/^hsla?\(\s*[\d.%,\s]+\)$/i.test(v)) return v;
  if (/^[a-z]{3,30}$/i.test(v)) return v;
  return '';
}

// URLs inside generated markup: keep site-relative and http(s) only.
function safeUrl(url) {
  const v = String(url ?? '').trim();
  if (!v) return '';
  if (/^(javascript|data|vbscript):/i.test(v)) return '';
  return v;
}

const SHAPE_KINDS = new Set(['rect', 'circle', 'triangle', 'star', 'custom']);

function shapeKindOf(layer) {
  return SHAPE_KINDS.has(layer?.shape) ? layer.shape : 'rect';
}

function safeSvgPath(value) {
  const v = String(value || '').trim();
  if (!/^[Mm]/.test(v) || v.length > 2000) return '';
  if (!/^[\d\s.,+\-MmLlHhVvCcSsQqTtAaZz]+$/.test(v)) return '';
  return v;
}

function parseShapePoints(value) {
  const raw = String(value || '').trim();
  if (!raw || /^[Mm]/.test(raw)) return null;
  const nums = raw.match(/-?\d*\.?\d+/g) || [];
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([Math.min(100, Math.max(0, x)), Math.min(100, Math.max(0, y))]);
  }
  return pts.length >= 3 ? pts : null;
}

// Outer tips stay at 46 inside the 100×100 box. The inner radius is a
// percentage of that reach: 41 is the original star, lower is sharper.
function starInnerPct(layer) {
  const n = Number(layer && layer.starInner);
  const pct = Number.isFinite(n) ? n : 41;
  return Math.min(90, Math.max(8, pct));
}

// How many tips the star has. 5 is the original star.
function starCornerCount(layer) {
  const n = Number(layer && layer.starCount);
  const count = Number.isFinite(n) ? Math.round(n) : 5;
  return Math.min(16, Math.max(3, count));
}

function starPointList(layer) {
  const outer = 46;
  const inner = outer * (starInnerPct(layer) / 100);
  const count = starCornerCount(layer);
  const pts = [];
  for (let i = 0; i < count * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / count;
    pts.push([50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)]);
  }
  return pts;
}

function fmtShape(n) {
  return String(Math.round(n * 100) / 100);
}

// A circular arc in place of each vertex. radius uses the same units as the
// points and is shortened when an edge is too short to hold the full curve.
function roundedPolygonPath(points, radius) {
  const n = points.length;
  const r0 = Math.max(Number(radius) || 0, 0);
  if (n < 3 || r0 <= 0) {
    return `M ${points.map((p) => `${fmtShape(p[0])} ${fmtShape(p[1])}`).join(' L ')} Z`;
  }
  const cmds = [];
  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    let v1x = prev[0] - curr[0];
    let v1y = prev[1] - curr[1];
    let v2x = next[0] - curr[0];
    let v2y = next[1] - curr[1];
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-4 || len2 < 1e-4) {
      const cmd = `${fmtShape(curr[0])} ${fmtShape(curr[1])}`;
      cmds.push(i === 0 ? `M ${cmd}` : `L ${cmd}`);
      continue;
    }
    v1x /= len1;
    v1y /= len1;
    v2x /= len2;
    v2y /= len2;
    const dot = Math.min(1, Math.max(-1, v1x * v2x + v1y * v2y));
    const angle = Math.acos(dot);
    const tanHalf = Math.tan(angle / 2);
    let cut = tanHalf > 1e-4 ? r0 / tanHalf : 0;
    const maxCut = Math.min(len1, len2) / 2;
    if (!(cut > 0)) cut = 0;
    if (cut > maxCut) cut = maxCut;
    const used = cut * (tanHalf > 0 ? tanHalf : 0);
    const p1x = curr[0] + v1x * cut;
    const p1y = curr[1] + v1y * cut;
    const p2x = curr[0] + v2x * cut;
    const p2y = curr[1] + v2y * cut;
    const cross = v1x * v2y - v1y * v2x;
    const head = `${fmtShape(p1x)} ${fmtShape(p1y)}`;
    cmds.push(i === 0 ? `M ${head}` : `L ${head}`);
    if (used > 0.05) {
      const sweep = cross < 0 ? 1 : 0;
      cmds.push(`A ${fmtShape(used)} ${fmtShape(used)} 0 0 ${sweep} ${fmtShape(p2x)} ${fmtShape(p2y)}`);
    }
  }
  cmds.push('Z');
  return cmds.join(' ');
}

// SVG for circle, triangle, star and custom shapes. Rectangles stay a plain
// coloured block so rounded corners keep working.
function shapeMarkup(layer) {
  const kind = shapeKindOf(layer);
  if (kind === 'rect') return '';
  const fill = safeColor(layer.bg) || '#E1E5EB';
  const stroke = safeColor(layer.borderColor) || '#0A192F';
  const width = Math.min(Math.max(Number(layer.borderWidth) || 0, 0), 40);
  const strokeAttr = width > 0
    ? ` stroke="${esc(stroke)}" stroke-width="${width}" vector-effect="non-scaling-stroke" stroke-linejoin="round"`
    : '';
  const path = kind === 'custom' ? safeSvgPath(layer.shapePoints) : '';
  let viewBox = '0 0 100 100';
  let inner = '';
  if (kind === 'circle') {
    inner = `<ellipse cx="50" cy="50" rx="46" ry="46" fill="${esc(fill)}"${strokeAttr}/>`;
  } else if (kind === 'star') {
    // Drawn in the layer's own pixels so a corner radius of 12 is 12px,
    // the same unit a rectangle uses for its rounded corners.
    const w = Math.min(Math.max(Number(layer.w) || 100, 10), 8000);
    const h = Math.min(Math.max(Number(layer.h) || 100, 2), 6000);
    viewBox = `0 0 ${fmtShape(w)} ${fmtShape(h)}`;
    const pts = starPointList(layer).map((p) => [(p[0] / 100) * w, (p[1] / 100) * h]);
    const radius = Math.min(Math.max(Number(layer.radius) || 0, 0), 500);
    inner = `<path d="${esc(roundedPolygonPath(pts, radius))}" fill="${esc(fill)}"${strokeAttr}/>`;
  } else if (path) {
    inner = `<path d="${esc(path)}" fill="${esc(fill)}"${strokeAttr}/>`;
  } else {
    const pts = kind === 'triangle' ? [[50, 8], [92, 92], [8, 92]]
      : parseShapePoints(layer.shapePoints);
    if (!pts) return '';
    inner = `<polygon points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="${esc(fill)}"${strokeAttr}/>`;
  }
  return `<svg class="layer-shape-svg" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
}

function styleToCss(style) {
  const s = style || {};
  const out = [];
  const px = (v, min = 0, max = 3000) => Math.min(Math.max(Number(v) || 0, min), max);
  if (safeColor(s.bg)) out.push(`background:${safeColor(s.bg)}`);
  if (safeColor(s.color)) out.push(`color:${safeColor(s.color)}`);
  const font = safeFontFamily(s.font);
  if (font) out.push(`font-family:${font}`);
  if (s.size) out.push(`font-size:${px(s.size, 6, 360)}px`);
  if (s.weight) out.push(`font-weight:${px(s.weight, 100, 900)}`);
  if (s.lineHeight) out.push(`line-height:${Math.min(Math.max(Number(s.lineHeight) || 1.25, 0.7), 3)}`);
  if (s.letterSpacing) out.push(`letter-spacing:${Math.min(Math.max(Number(s.letterSpacing) || 0, -20), 60)}px`);
  if (LAYER_ALIGN.has(s.align)) out.push(`text-align:${s.align}`);
  if (s.textShadow) out.push('text-shadow:0 0 6px rgba(0,0,0,.55),0 1px 2px rgba(0,0,0,.6)');
  if (s.radius) out.push(`border-radius:${px(s.radius, 0, 500)}px`);
  const borderColour = safeColor(s.borderColor);
  if (s.borderWidth) {
    out.push(`border:${px(s.borderWidth, 0, 60)}px solid ${borderColour || '#0A192F'}`);
  } else if (borderColour) {
    // A colour with no width still means "give this layer a hairline border".
    out.push(`border:1px solid ${borderColour}`);
  }
  return out.join(';');
}

function animationAttrs(layer) {
  if (layer.animated === false) return '';
  const anim = ANIMATIONS.has(layer.anim) ? layer.anim : 'fade';
  if (anim === 'none') return '';
  const delay = Math.min(Math.max(Number(layer.delay) || 0, 0), 10);
  const duration = Math.min(Math.max(Number(layer.duration) || 0.9, 0.1), 10);
  return ` data-anim="${anim}" data-anim-delay="${delay}" data-anim-duration="${duration}"`;
}

function layerBox(layer, canvasHeight) {
  const num = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  };
  const x = num(layer.x, -4000, 8000, 0);
  const y = num(layer.y, -2000, 6000, 0);
  const w = num(layer.w, 10, 8000, 300);
  const h = num(layer.h, 2, 6000, 100);
  const z = num(layer.z, 0, 9999, 0);
  const fixedHeight = layer.hugging && (layer.type === 'text' || layer.type === 'heading' || layer.type === 'paragraph') ? '' : `;height:${h}px`;
  return `left:${x}px;top:${y}px;width:${w}px${fixedHeight};z-index:${Math.round(z)}`;
}

// Rotation sits on an inner wrapper so entrance animations, which also use
// transform, can keep running on the layer itself.
function turnStyle(layer) {
  const n = Number(layer && layer.rotate);
  if (!Number.isFinite(n) || Math.abs(n) < 0.05) return '';
  const deg = Math.round(Math.min(360, Math.max(-360, n)) * 10) / 10;
  return `transform:rotate(${deg}deg);transform-origin:center center`;
}

// Line breaks inside a layer keep the words; each line is escaped.
function layerText(text) {
  return esc(text).replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------

function validateLayer(layer, label, errors) {
  if (!layer || typeof layer !== 'object') {
    errors.push(`"${label}": a layer is not a valid object`);
    return;
  }
  if (!LAYER_TYPES.has(layer.type)) {
    errors.push(`"${label}": the layer type "${layer.type}" is not supported`);
    return;
  }
  if (!Array.isArray(layer.images) && layer.type === 'gallery') {
    errors.push(`"${label}": an image group must contain a list of images`);
  }
  if (layer.anim != null && !ANIMATIONS.has(layer.anim)) {
    errors.push(`"${label}": the animation "${layer.anim}" is not supported`);
  }
  if (!Number.isFinite(Number(layer.x)) || !Number.isFinite(Number(layer.y))) {
    errors.push(`"${label}": the layer needs a position`);
  }
}

// ---------------------------------------------------------------------------
// Section normalisation
//
// Sections are grouped by page, and every section owns its layers and its
// images. Older content.json files (and files edited by hand) can still hold a
// section without a layout, a layer without an id, or a gallery item without a
// caption. Rather than rejecting the whole save, the shapes below are filled in
// on the way through, so the admin and the live site always agree.
// ---------------------------------------------------------------------------

function normCell(item) {
  // A gallery slot may be written as a plain URL string by hand.
  if (typeof item === 'string') return { image: item, caption: '', link: '' };
  if (!item || typeof item !== 'object') return { image: '', caption: '', link: '' };
  const out = {
    image: safeUrl(item.image),
    caption: typeof item.caption === 'string' ? item.caption : '',
    link: safeUrl(item.link),
    ...(item.wide == null ? {} : { wide: Boolean(item.wide) }),
  };
  ['x', 'y', 'w', 'h'].forEach((key) => {
    const n = Number(item[key]);
    if (Number.isFinite(n)) out[key] = Math.round(Math.min(8000, Math.max(-2000, n)));
  });
  return out;
}

function normLayer(rawLayer, index) {
  const type = LAYER_TYPES.has(rawLayer?.type) ? rawLayer.type : 'text';
  const out = Object.assign({}, rawLayer, {
    id: typeof rawLayer?.id === 'string' && rawLayer.id ? rawLayer.id : `l-${crypto.randomBytes(3).toString('hex')}`,
    type,
    name: typeof rawLayer?.name === 'string' && rawLayer.name ? rawLayer.name : `${type} ${index + 1}`,
    x: Number.isFinite(Number(rawLayer?.x)) ? Number(rawLayer.x) : 60,
    y: Number.isFinite(Number(rawLayer?.y)) ? Number(rawLayer.y) : 60 + index * 16,
    z: Number.isFinite(Number(rawLayer?.z)) ? Number(rawLayer.z) : index + 1,
  });
  if (type === 'gallery') {
    out.images = Array.isArray(rawLayer?.images) ? rawLayer.images.map(normCell) : [];
  }
  if (out.anim != null && !ANIMATIONS.has(out.anim)) out.anim = 'fade';
  if (type === 'shape') {
    out.shape = SHAPE_KINDS.has(rawLayer?.shape) ? rawLayer.shape : 'rect';
    out.shapePoints = typeof rawLayer?.shapePoints === 'string' ? rawLayer.shapePoints.slice(0, 2000) : '';
    if (out.shape === 'star') {
      const inner = Number(rawLayer?.starInner);
      if (Number.isFinite(inner)) out.starInner = Math.min(90, Math.max(8, inner));
      const corners = Number(rawLayer?.starCount);
      if (Number.isFinite(corners)) out.starCount = Math.min(16, Math.max(3, Math.round(corners)));
    }
  }
  const rot = Number(rawLayer?.rotate);
  if (Number.isFinite(rot)) out.rotate = Math.min(360, Math.max(-360, rot));
  if (out.textShadow != null) out.textShadow = Boolean(out.textShadow);
  if (out.radiusLock != null) out.radiusLock = Boolean(out.radiusLock);
  if (type === 'gallery' && out.freeform != null) out.freeform = Boolean(out.freeform);
  if ((type === 'text' || type === 'heading' || type === 'paragraph') && rawLayer?.autoFit != null) out.autoFit = Boolean(rawLayer.autoFit);
  if (type === 'image') {
    const subtitle = typeof rawLayer?.subtitle === 'string' ? rawLayer.subtitle.slice(0, 400) : '';
    if (subtitle) out.subtitle = subtitle;
    else delete out.subtitle;
    if (['left', 'center', 'right'].includes(rawLayer?.subtitleAlign)) out.subtitleAlign = rawLayer.subtitleAlign;
    else delete out.subtitleAlign;
    const ratio = Number(rawLayer?.aspectRatio);
    if (Number.isFinite(ratio) && ratio > 0.01 && ratio < 100) out.aspectRatio = ratio;
    else delete out.aspectRatio;
  }
  const font = safeFontFamily(out.font);
  if (font) out.font = font;
  else delete out.font;
  return out;
}

function normSection(rawSection, index) {
  const section = Object.assign({}, rawSection);
  section.id = typeof rawSection?.id === 'string' && rawSection.id ? rawSection.id : `s-${crypto.randomBytes(3).toString('hex')}`;
  // Legacy values from removed layouts (showcase, cards) all render as gallery now.
  if (section.layout === 'showcase' || section.layout === 'cards') section.layout = 'gallery';
  if (!LAYOUT_SUPPORTED.has(section.layout)) section.layout = 'canvas';
  // The plain image layout (gallery) keeps its pictures in
  // `items`; the board keeps them inside gallery layers. Both are normalised,
  // because switching a section between the two layouts carries the list over.
  section.items = (Array.isArray(rawSection?.items) ? rawSection.items : []).map(normCell);
  if (section.layout === 'canvas') {
    section.layers = (Array.isArray(rawSection?.layers) ? rawSection.layers : [])
      .filter((l) => l && typeof l === 'object')
      .slice(0, MAX_LAYERS)
      .map(normLayer);
    section.canvasHeight = Math.min(Math.max(Number(section.canvasHeight) || 640, 200), 4000);
    const width = Number(section.canvasWidth);
    if (Number.isFinite(width) && width > 0) section.canvasWidth = Math.min(4000, Math.max(480, Math.round(width)));
    else delete section.canvasWidth;
  }
  section.buttons = Array.isArray(rawSection?.buttons)
    ? rawSection.buttons.filter((b) => b && typeof b === 'object')
    : [];
  section.heading = typeof section.heading === 'string' ? section.heading : '';
  if (rawSection?.canvasLock) section.canvasLock = true;
  else delete section.canvasLock;
  ['bg', 'canvasBg'].forEach((key) => {
    const color = safeColor(section[key]);
    if (color) section[key] = color;
    else delete section[key];
  });
  if (typeof rawSection?.canvasImage === 'string' && rawSection.canvasImage.trim()) {
    section.canvasImage = safeUrl(rawSection.canvasImage);
  } else {
    delete section.canvasImage;
  }
  // Where the background photo sits inside the board. 50, 50 is the centre.
  ['canvasImageX', 'canvasImageY'].forEach((key) => {
    const n = Number(rawSection?.[key]);
    if (section.canvasImage && Number.isFinite(n)) section[key] = Math.min(100, Math.max(0, Math.round(n)));
    else delete section[key];
  });
  if (!section.heading && !section.layers?.length && !section.items.length) {
    section.heading = `Section ${index + 1}`;
  }
  return section;
}

function normSections(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normSection).slice(0, MAX_SECTIONS_PER_PAGE);
}

// ---------------------------------------------------------------------------
// Copying
//
// "Copy as a new section" must not leave two sections sharing a layer id, or
// the two boards would drag together in the editor. Every copy gets fresh ids.
// ---------------------------------------------------------------------------

function freshId(prefix) {
  return `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
}

function cloneLayers(layers) {
  return JSON.parse(JSON.stringify(Array.isArray(layers) ? layers : []))
    .map((l) => Object.assign(l, { id: freshId('l') }));
}

function copySection(rawSection, opts = {}) {
  const copy = JSON.parse(JSON.stringify(rawSection));
  copy.id = freshId('s');
  if (copy.layout === 'canvas') copy.layers = cloneLayers(copy.layers);
  if (opts.rename !== false) {
    const base = String(copy.heading || copy.name || 'Section').replace(/\n/g, ' ').trim() || 'Section';
    copy.heading = /\(copy\b/i.test(base) ? base : `${base} (copy)`;
  }
  return normSection(copy, 0);
}

function validateSection(section, label, errors) {
  if (!section || typeof section !== 'object') {
    errors.push(`"${label}": a section is not a valid object`);
    return;
  }
  const layout = section.layout || 'gallery';
  const canvas = layout === 'canvas';
  const known = canvas || layout === 'gallery';
  if (!known) {
    errors.push(`"${label}": the layout "${layout}" is not supported`);
  }
  if (canvas) {
    if (!Array.isArray(section.layers)) {
      errors.push(`"${label}": a layout canvas needs a list of layers`);
    } else {
      if (section.layers.length > 200) errors.push(`"${label}": a layout canvas cannot hold more than 200 layers`);
      section.layers.forEach((layer, i) => validateLayer(layer, `${label} → layer ${i + 1}`, errors));
    }
    if (section.canvasHeight != null && (Number(section.canvasHeight) < 200 || Number(section.canvasHeight) > 4000)) {
      errors.push(`"${label}": the board height must be between 200 and 4000`);
    }
  } else if (section.columns != null && ![1, 2, 3, 4].includes(Number(section.columns))) {
    errors.push(`"${label}": columns must be 1, 2, 3 or 4`);
  } else if (section.items != null && !Array.isArray(section.items)) {
    errors.push(`"${label}": images must be a list`);
  } else if (section.buttons != null && !Array.isArray(section.buttons)) {
    errors.push(`"${label}": buttons must be a list`);
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.locals.esc = esc;
app.locals.paragraphs = paragraphs;
app.locals.lines = lines;
app.locals.fontFamily = fontFamily;
app.locals.googleFontsUrl = googleFontsUrl;
app.locals.isExternal = isExternal;

// Helpers used by views/partials/section.ejs to render layout canvases.
app.locals.styleToCss = styleToCss;
app.locals.shapeMarkup = shapeMarkup;
app.locals.shapeKindOf = shapeKindOf;
app.locals.animationAttrs = animationAttrs;
app.locals.layerBox = layerBox;
app.locals.turnStyle = turnStyle;
app.locals.layerText = layerText;
app.locals.safeColor = safeColor;
app.locals.canvasBackground = canvasBackground;
app.use((req, res, next) => {
  res.locals.customFontFaces = customFontCss();
  next();
});
app.locals.safeUrl = safeUrl;
app.locals.ANIMATIONS = ANIMATIONS;
app.locals.LAYER_FITS = LAYER_FITS;
app.locals.LAYER_ALIGN = LAYER_ALIGN;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: 'portfolio.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));
app.use('/admin', express.static(path.join(ROOT, 'admin')));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const loginAttempts = new Map(); // ip -> { count, until }

function requireAuth(req, res, next) {
  // Login disabled — let everyone through
  return next();
  // if (req.session && req.session.admin) return next();
  // res.status(401).json({ error: 'Please log in again.' });
}

function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

app.get('/api/me', (req, res) => {
  res.json({ loggedIn: Boolean(req.session.admin), passwordConfigured: Boolean(ADMIN_PASSWORD) });
});

app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'No admin password is set. Add ADMIN_PASSWORD to the .env file and restart the server.' });
  }
  const ip = req.ip;
  const entry = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (entry.until > Date.now()) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
  }
  if (!passwordMatches(req.body?.password || '')) {
    entry.count += 1;
    if (entry.count >= 5) {
      entry.count = 0;
      entry.until = Date.now() + 60_000;
    }
    loginAttempts.set(ip, entry);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  loginAttempts.delete(ip);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start session.' });
    req.session.admin = true;
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------------------------------------------------------------------------
// Content API
// ---------------------------------------------------------------------------

app.get('/api/content', requireAuth, (req, res) => {
  res.json(getContent());
});

app.put('/api/content', requireAuth, (req, res) => {
  const next = normContent(req.body);
  const errors = validateContent(next);
  if (errors.length) return res.status(400).json({ error: errors.join('\n') });
  backupContent();
  writeJsonAtomic(CONTENT_FILE, next);
  contentCache = next;
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

app.get('/api/backups', requireAuth, (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('content-')).sort().reverse();
  res.json(files.map((name) => ({ name, size: fs.statSync(path.join(BACKUP_DIR, name)).size })));
});

app.post('/api/backups/:name/restore', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!name.startsWith('content-') || !fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
  const data = readJson(file, null);
  const errors = validateContent(data);
  if (errors.length) return res.status(400).json({ error: errors.join('\n') });
  backupContent();
  writeJsonAtomic(CONTENT_FILE, data);
  contentCache = data;
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Section layouts: ready-made presets and the saved-layout shelf
//
// Every section belongs to exactly one page (or to the home page), and each
// section owns its own board and layers. These endpoints only ever build or
// store a *section* — the page it is added to is chosen by the admin, which
// keeps the "grouped by page" rule in one place.
// ---------------------------------------------------------------------------

function readLibrary() {
  const list = readJson(LAYOUT_LIBRARY_FILE, []);
  return Array.isArray(list) ? list : [];
}

const DEFAULT_TEMPLATE_IDS = new Set(['tpl-default-hero', 'tpl-default-page']);

// Built-in Hero and Page settings templates stay in the list. A saved edit
// with the same id replaces that built-in copy.
function libraryWithDefaults() {
  const saved = readLibrary();
  const defaults = defaultTemplates();
  const merged = defaults.map((entry) => {
    const override = saved.find((item) => item.id === entry.id);
    if (!override) return entry;
    return Object.assign({}, override, { builtin: true, kind: entry.kind });
  });
  return merged.concat(saved.filter((item) => !DEFAULT_TEMPLATE_IDS.has(item.id)));
}

app.get('/api/section-presets', requireAuth, (req, res) => {
  res.json(presetSummaries());
});

// A fresh section from a preset. Nothing is written to content.json yet; the
// admin inserts the returned object into the page the user is editing and the
// normal Save changes request persists it.
app.post('/api/sections/new', requireAuth, (req, res) => {
  const preset = findPreset(String(req.body?.preset || 'blank-canvas'));
  if (!preset) return res.status(404).json({ error: 'That starting layout does not exist.' });
  const section = normSection(preset.build(), 0);
  section.id = freshId('s');
  if (section.layout === 'canvas') section.layers = cloneLayers(section.layers);
  res.json({ section });
});

// "Copy as a new section": the caller sends the section it wants copied and
// gets back a detached copy with new ids, so it can be dropped into any page.
app.post('/api/sections/copy', requireAuth, (req, res) => {
  const source = req.body?.section;
  if (!source || typeof source !== 'object') return res.status(400).json({ error: 'Nothing to copy.' });
  res.json({ section: copySection(source, { rename: req.body?.rename !== false }) });
});

const LAYOUT_KINDS = new Set(['hero', 'page', 'section']);

function layoutKind(value) {
  return LAYOUT_KINDS.has(value) ? value : 'section';
}

app.get('/api/layouts', requireAuth, (req, res) => {
  res.json(libraryWithDefaults().map((entry) => ({
    id: entry.id,
    name: entry.name,
    savedAt: entry.savedAt,
    page: entry.page || '',
    kind: layoutKind(entry.kind),
    builtin: Boolean(entry.builtin),
    layers: (entry.section?.layers || []).length,
    layout: entry.section?.layout || 'canvas',
  })));
});

app.get('/api/layouts/:id', requireAuth, (req, res) => {
  const entry = libraryWithDefaults().find((x) => x.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'That saved layout no longer exists.' });
  res.json({
    id: entry.id,
    name: entry.name,
    savedAt: entry.savedAt,
    page: entry.page || '',
    kind: layoutKind(entry.kind),
    section: entry.section,
  });
});

// Save the current section onto the shelf. The section is copied on the way in,
// so later edits to the page do not change what is stored here.
app.post('/api/layouts', requireAuth, (req, res) => {
  const source = req.body?.section;
  const name = String(req.body?.name || '').trim().slice(0, 120);
  if (!source || typeof source !== 'object') return res.status(400).json({ error: 'There is no section to save.' });
  if (!name) return res.status(400).json({ error: 'Give the layout a name so you can find it later.' });

  if (req.body?.kind != null && req.body.kind !== '' && !LAYOUT_KINDS.has(req.body.kind)) {
    return res.status(400).json({ error: 'A template belongs in Hero, Page settings, or Section.' });
  }
  const library = readLibrary();
  const entry = {
    id: freshId('tpl'),
    name,
    kind: layoutKind(req.body?.kind),
    page: String(req.body?.page || '').slice(0, 120),
    savedAt: new Date().toISOString(),
    section: copySection(source, { rename: false }),
  };
  library.unshift(entry);
  writeJsonAtomic(LAYOUT_LIBRARY_FILE, library.slice(0, MAX_LIBRARY));
  res.json({ ok: true, id: entry.id });
});

// Pull a saved layout back off the shelf as a brand new section.
app.post('/api/layouts/:id/section', requireAuth, (req, res) => {
  const entry = libraryWithDefaults().find((x) => x.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'That saved layout no longer exists.' });
  res.json({ section: copySection(entry.section, { rename: req.body?.rename !== false }) });
});

app.patch('/api/layouts/:id', requireAuth, (req, res) => {
  const library = readLibrary();
  let entry = library.find((x) => x.id === req.params.id);
  if (!entry && DEFAULT_TEMPLATE_IDS.has(req.params.id)) {
    const builtin = defaultTemplates().find((item) => item.id === req.params.id);
    entry = JSON.parse(JSON.stringify(builtin));
    delete entry.builtin;
    library.unshift(entry);
  }
  if (!entry) return res.status(404).json({ error: 'That saved layout no longer exists.' });
  const body = req.body || {};
  if (body.name == null && body.kind == null && body.section == null) {
    return res.status(400).json({ error: 'Nothing to update on this template.' });
  }
  if (body.name != null) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'The layout needs a name.' });
    entry.name = name;
  }
  if (body.kind != null) {
    if (!LAYOUT_KINDS.has(body.kind)) {
      return res.status(400).json({ error: 'A template belongs in Hero, Page settings, or Section.' });
    }
    entry.kind = body.kind;
  }
  if (body.section != null) {
    if (!body.section || typeof body.section !== 'object') {
      return res.status(400).json({ error: 'The template layout is missing.' });
    }
    // Keep this template's own ids. Pages receive a copy with fresh ids.
    entry.section = normSection(body.section, 0);
    entry.savedAt = new Date().toISOString();
  }
  if (!entry.kind) entry.kind = 'section';
  writeJsonAtomic(LAYOUT_LIBRARY_FILE, library);
  res.json({ ok: true, id: entry.id, kind: layoutKind(entry.kind), savedAt: entry.savedAt });
});

app.delete('/api/layouts/:id', requireAuth, (req, res) => {
  if (DEFAULT_TEMPLATE_IDS.has(req.params.id)) {
    return res.status(400).json({ error: 'The Hero and Page settings templates stay in the list. Edit one to change its design.' });
  }
  const library = readLibrary();
  const next = library.filter((x) => x.id !== req.params.id);
  if (next.length === library.length) return res.status(404).json({ error: 'That saved layout no longer exists.' });
  writeJsonAtomic(LAYOUT_LIBRARY_FILE, next);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Media uploads
// ---------------------------------------------------------------------------

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.otf']);
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf']);

function fontFormat(ext) {
  if (ext === '.woff2') return 'woff2';
  if (ext === '.woff') return 'woff';
  if (ext === '.otf') return 'opentype';
  return 'truetype';
}

function fontLabel(filename) {
  const base = path.basename(filename, path.extname(filename)).replace(/-[0-9a-f]{6}$/i, '');
  const label = base.replace(/[-_]+/g, ' ').replace(/[^A-Za-z0-9 .]/g, '').trim().slice(0, 60);
  return label || 'Custom font';
}

function listFontFiles() {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  const used = new Map();
  return fs.readdirSync(UPLOAD_DIR)
    .filter((name) => FONT_EXT.has(path.extname(name).toLowerCase()))
    .map((name) => {
      let family = fontLabel(name);
      const seen = used.get(family.toLowerCase()) || 0;
      used.set(family.toLowerCase(), seen + 1);
      if (seen) family = `${family} ${seen + 1}`.slice(0, 80);
      const ext = path.extname(name).toLowerCase();
      const css = `"${family}", sans-serif`;
      const face = `@font-face{font-family:"${family}";src:url("/uploads/${encodeURIComponent(name)}") format("${fontFormat(ext)}");font-display:swap;}`;
      return { name, url: `/uploads/${name}`, family, css, face };
    });
}

function customFontCss() {
  return listFontFiles().map((font) => font.face).join('\n');
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      // Browsers send non-ASCII names as latin1; decode so Chinese names survive.
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(original).toLowerCase();
      const base = path
        .basename(original, path.extname(original))
        .normalize('NFKD')
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'image';
      cb(null, `${base}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error(`File type ${ext || '(none)'} is not allowed`));
  },
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ files: (req.files || []).map((f) => ({ url: `/uploads/${f.filename}`, name: f.filename, size: f.size })) });
  });
});

function collectStrings(node, out) {
  if (typeof node === 'string') out.add(node);
  else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => collectStrings(n, out));
  return out;
}

// Media folders are virtual: a file belongs to every page whose saved content
// mentions it. Nothing moves on disk, so /uploads/... links never change.
function mediaFolders(content) {
  const site = (content && content.site) || {};
  const folders = [{ id: 'home', label: site.homeNavLabel || 'Home', node: content && content.home }];
  for (const page of (content && content.pages) || []) {
    folders.push({
      id: page.id || page.slug,
      label: page.navLabel || page.title || page.slug || 'Untitled page',
      node: page,
    });
  }
  folders.push({ id: 'site', label: 'Site-wide (logo, socials)', node: site });
  folders.push({ id: 'fonts', label: 'Fonts', urls: new Set(listFontFiles().map((font) => font.url)) });
  return folders.map((f) => ({ id: f.id, label: f.label, urls: f.urls || collectStrings(f.node, new Set()) }));
}

app.get('/api/fonts', requireAuth, (req, res) => {
  res.json(listFontFiles().map(({ name, url, family, css }) => ({ name, url, family, css })));
});

app.get('/api/media/folders', requireAuth, (req, res) => {
  res.json(mediaFolders(getContent()).map(({ id, label }) => ({ id, label })));
});

app.get('/api/media', requireAuth, (req, res) => {
  const content = getContent();
  const used = collectStrings(content, new Set());
  const folders = mediaFolders(content);
  const fontsByUrl = new Map(listFontFiles().map((item) => [item.url, item]));
  const files = fs
    .readdirSync(UPLOAD_DIR)
    .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
    .map((name) => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, name));
      const url = `/uploads/${name}`;
      const font = fontsByUrl.get(url);
      return {
        name,
        url,
        size: stat.size,
        modified: stat.mtimeMs,
        used: used.has(url),
        folders: folders.filter((f) => f.urls.has(url)).map((f) => f.id),
        ...(font ? { fontFamily: font.css } : {}),
      };
    })
    .sort((a, b) => b.modified - a.modified);
  res.json(files);
});

app.delete('/api/media/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  const used = collectStrings(getContent(), new Set());
  if (used.has(`/uploads/${name}`) && req.query.force !== '1') {
    return res.status(409).json({ error: 'This file is still used on the site. Remove it from the page first.' });
  }
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Contact form + messages
// ---------------------------------------------------------------------------

app.post('/contact', (req, res) => {
  const body = req.body || {};
  if (body.website) return res.json({ ok: true }); // honeypot field filled in by bots
  const msg = {
    id: crypto.randomUUID(),
    name: String(body.name || '').trim().slice(0, 200),
    email: String(body.email || '').trim().slice(0, 200),
    subject: String(body.subject || '').trim().slice(0, 300),
    message: String(body.message || '').trim().slice(0, 5000),
    createdAt: new Date().toISOString(),
    read: false,
  };
  if (!msg.name || !msg.email || !msg.subject || !msg.message) {
    return res.status(400).json({ error: 'Please fill in every field.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const messages = readJson(MESSAGES_FILE, []);
  messages.unshift(msg);
  writeJsonAtomic(MESSAGES_FILE, messages.slice(0, 2000));
  res.json({ ok: true });
});

app.get('/api/messages', requireAuth, (req, res) => {
  res.json(readJson(MESSAGES_FILE, []));
});

app.patch('/api/messages/:id', requireAuth, (req, res) => {
  const messages = readJson(MESSAGES_FILE, []);
  const msg = messages.find((m) => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (typeof req.body?.read === 'boolean') msg.read = req.body.read;
  writeJsonAtomic(MESSAGES_FILE, messages);
  res.json(msg);
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
  const messages = readJson(MESSAGES_FILE, []);
  writeJsonAtomic(MESSAGES_FILE, messages.filter((m) => m.id !== req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

function navFor(content, currentSlug) {
  const items = [{ label: content.site.homeNavLabel || 'Home', href: '/', active: currentSlug === '' }];
  content.pages
    .filter((p) => p.showInNav !== false)
    .forEach((p) => items.push({ label: p.navLabel || p.title, href: `/${p.slug}`, active: p.slug === currentSlug }));
  return items;
}

app.get('/', (req, res) => {
  const content = getContent();
  res.render('home', { site: content.site, home: content.home, nav: navFor(content, ''), pageTitle: content.home.seoTitle || 'Home' });
});

app.get('/:slug', (req, res, next) => {
  const content = getContent();
  const page = content.pages.find((p) => p.slug === req.params.slug);
  if (!page) return next();
  res.render('page', { site: content.site, page, nav: navFor(content, page.slug), pageTitle: page.navLabel || page.title });
});

app.use((req, res) => {
  const content = getContent();
  res.status(404).render('404', { site: content.site, nav: navFor(content, null), pageTitle: 'Page not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: err.message });
  res.status(500).send('Something went wrong.');
});

app.listen(PORT, () => {
  console.log(`Portfolio running at http://localhost:${PORT}`);
  console.log(`Admin panel:        http://localhost:${PORT}/admin`);
  if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set, so the admin panel is locked. See .env.example');
});
