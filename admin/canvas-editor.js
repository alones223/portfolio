// ===========================================================================
// The layout editor UI: a "template canvas" where layers can be moved,
// resized and styled, a layer list, and an inspector for the selected layer.
//
// The live site always lays a canvas section out at 1425px wide, so the board
// here uses that same width and pixel coordinates. What you arrange is what
// visitors see.
//
// Two rules keep the editor usable:
//   1. A render never rebuilds a layer box that is being dragged. The board is
//      patched in place, so the element under the pointer survives.
//   2. Every setting writes to the layer object first, then repaints. The DOM
//      is always a picture of the data, never a source of truth.
// ===========================================================================

window.CanvasEditorUI = (function () {
  'use strict';

  const M = window.CanvasEditor;

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

  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const round = (n) => Math.round(n);
  // Keep an angle in the -180..180 range the inspector shows.
  function normDeg(n) {
    const wrapped = ((Number(n) || 0) + 180) % 360;
    return Math.round(((wrapped < 0 ? wrapped + 360 : wrapped) - 180) * 10) / 10;
  }
  // Board-pixel drag, expressed along a layer that may be rotated.
  function localDelta(dx, dy, deg) {
    const θ = (Number(deg) || 0) * Math.PI / 180;
    const c = Math.cos(θ);
    const s = Math.sin(θ);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }
  // A board point, written in the layer's own box (origin at the top left).
  function boardToLocal(l, bx, by) {
    const θ = (Number(l.rotate) || 0) * Math.PI / 180;
    const c = Math.cos(θ);
    const s = Math.sin(θ);
    const dx = bx - (l.x + l.w / 2);
    const dy = by - (l.y + (Number(l.h) || 0) / 2);
    return {
      x: dx * c + dy * s + l.w / 2,
      y: -dx * s + dy * c + (Number(l.h) || 0) / 2,
    };
  }
  // Resize while the opposite edge or corner stays where it is, even when the
  // layer is rotated around its centre.
  function placeFromAnchor(l, lead, dir, newW, newH) {
    const θ = (Number(lead.rotate) || 0) * Math.PI / 180;
    const c = Math.cos(θ);
    const s = Math.sin(θ);
    const axSign = dir.includes('e') ? -1 : dir.includes('w') ? 1 : 0;
    const aySign = dir.includes('s') ? -1 : dir.includes('n') ? 1 : 0;
    const ocx = lead.x + lead.w / 2;
    const ocy = lead.y + lead.h / 2;
    const lx0 = axSign * lead.w / 2;
    const ly0 = aySign * lead.h / 2;
    const ax = ocx + lx0 * c - ly0 * s;
    const ay = ocy + lx0 * s + ly0 * c;
    const lx1 = axSign * newW / 2;
    const ly1 = aySign * newH / 2;
    l.w = newW;
    l.h = newH;
    l.x = Math.round(ax - (lx1 * c - ly1 * s) - newW / 2);
    l.y = Math.round(ay - (lx1 * s + ly1 * c) - newH / 2);
  }
  function layerTurn(l) {
    const n = Number(l.rotate) || 0;
    return n ? `;transform:rotate(${n}deg);transform-origin:center center` : '';
  }
  const isTextual = (l) => l.type === 'heading' || l.type === 'text';
  // Original shape means each picture keeps its own proportions. The group
  // grows with those pictures instead of cropping them into the layer box.
  const naturalGallery = (l) => l.type === 'gallery' && (!l.aspect || l.aspect === 'natural');

  function safeUrl(url) {
    const value = String(url || '').trim();
    if (/^\s*(javascript|data|vbscript):/i.test(value)) return '#';
    return value;
  }

  // Which handles a layer offers. Text boxes that follow their own height only
  // get corner handles, because their height is decided by the words inside.
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const SHAPE_KINDS = ['rect', 'circle', 'triangle', 'star', 'custom'];
  const shapeKind = (l) => (SHAPE_KINDS.includes(l.shape) ? l.shape : 'rect');
  const clippedShape = (l) => l.type === 'shape' && shapeKind(l) !== 'rect';

  function safeCssColor(value) {
    const v = String(value ?? '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    if (/^rgba?\(\s*[\d.%,\s]+\)$/i.test(v)) return v;
    return '';
  }

  const DEFAULT_CUSTOM = [[50, 8], [92, 92], [8, 92]];

  function parseShapePoints(value) {
    const raw = String(value || '').trim();
    if (!raw || /^[Mm]/.test(raw)) return null;
    const nums = raw.match(/-?\d*\.?\d+/g) || [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([clamp(x, 0, 100), clamp(y, 0, 100)]);
    }
    return pts.length >= 3 ? pts : null;
  }

  function formatShapePoints(pts) {
    return pts.map(([x, y]) => `${Math.round(x * 10) / 10}, ${Math.round(y * 10) / 10}`).join('\n');
  }

  // A custom shape is always a polygon. An empty or unreadable value starts as
  // a triangle so there are points on the canvas to drag.
  function customPoints(l) {
    return parseShapePoints(l.shapePoints) || DEFAULT_CUSTOM.map((p) => p.slice());
  }

  // Outer tips stay at 46 inside the 100×100 box. The inner radius is a
  // percentage of that reach: 41 is the original star, lower is sharper.
  // Keep this in step with starPointList() in server.js.
  function starInnerPct(l) {
    const n = Number(l && l.starInner);
    const pct = Number.isFinite(n) ? n : 41;
    return Math.min(90, Math.max(8, pct));
  }

  // How many tips the star has. 5 is the original star.
  // Keep this in step with starCornerCount() in server.js.
  function starCornerCount(l) {
    const n = Number(l && l.starCount);
    const count = Number.isFinite(n) ? Math.round(n) : 5;
    return Math.min(16, Math.max(3, count));
  }

  function starPoints(l) {
    const outer = 46;
    const inner = outer * (starInnerPct(l) / 100);
    const count = starCornerCount(l);
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

  function shapeOutline(l) {
    const kind = shapeKind(l);
    if (kind === 'triangle') return [[50, 8], [92, 92], [8, 92]];
    if (kind === 'custom') return customPoints(l);
    return null;
  }

  function drawShapeGraphic(l) {
    const kind = shapeKind(l);
    if (kind === 'rect') return [];
    const fill = safeCssColor(l.bg) || '#E1E5EB';
    const stroke = safeCssColor(l.borderColor) || '#0A192F';
    const width = clamp(Number(l.borderWidth) || 0, 0, 40);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cv-shape-svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    let node;
    if (kind === 'circle') {
      svg.setAttribute('viewBox', '0 0 100 100');
      node = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      node.setAttribute('cx', '50');
      node.setAttribute('cy', '50');
      node.setAttribute('rx', '46');
      node.setAttribute('ry', '46');
    } else if (kind === 'star') {
      const w = clamp(Number(l.w) || 100, 10, 8000);
      const h = clamp(Number(l.h) || 100, 2, 6000);
      svg.setAttribute('viewBox', `0 0 ${fmtShape(w)} ${fmtShape(h)}`);
      const pts = starPoints(l).map(([x, y]) => [(x / 100) * w, (y / 100) * h]);
      const radius = clamp(Number(l.radius) || 0, 0, 500);
      node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('d', roundedPolygonPath(pts, radius));
    } else {
      svg.setAttribute('viewBox', '0 0 100 100');
      const pts = shapeOutline(l);
      if (!pts) return [svg];
      node = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      node.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));
    }
    node.setAttribute('fill', fill);
    if (width > 0) {
      node.setAttribute('stroke', stroke);
      node.setAttribute('stroke-width', String(width));
      node.setAttribute('vector-effect', 'non-scaling-stroke');
      node.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(node);
    return [svg];
  }

  function layerStyle(l) {
    const parts = [];
    // Circle, triangle, star and custom shapes paint their own fill, so the
    // box behind them stays clear instead of showing a rectangle.
    if (clippedShape(l)) return '';
    if (l.bg) parts.push(`background:${l.bg}`);
    if (l.color) parts.push(`color:${l.color}`);
    if (l.font) parts.push(`font-family:${l.font}`);
    if (l.size) parts.push(`font-size:${Number(l.size)}px`);
    if (l.weight) parts.push(`font-weight:${Number(l.weight)}`);
    if (l.lineHeight) parts.push(`line-height:${Number(l.lineHeight)}`);
    if (l.letterSpacing) parts.push(`letter-spacing:${Number(l.letterSpacing)}px`);
    if (l.type !== 'button' && l.type !== 'divider' && l.align) parts.push(`text-align:${l.align}`);
    if (l.textShadow) parts.push('text-shadow:0 0 6px rgba(0,0,0,.55),0 1px 2px rgba(0,0,0,.6)');
    if (l.radius) parts.push(`border-radius:${Number(l.radius)}px`);
    if (l.borderWidth) parts.push(`border:${Number(l.borderWidth)}px solid ${l.borderColor || '#0A192F'}`);
    return parts.join(';');
  }

  function drawLayerContent(l) {
    if (l.type === 'heading' || l.type === 'text') {
      const text = String(l.text ?? '');
      if (!text.trim()) return [h('div', { class: 'cv-placeholder' }, l.type === 'heading' ? 'Empty heading' : 'Empty text box')];
      return text.split('\n').map((line) => h('div', null, line || '\u00a0'));
    }
    if (l.type === 'image') {
      if (!l.src) return [h('div', { class: 'cv-placeholder' }, 'No image yet')];
      const fit = ['cover', 'contain', 'fill'].includes(l.fit) ? l.fit : 'cover';
      const mediaStyle = `border-radius:${Math.max(0, Number(l.radius) || 0)}px;object-fit:${fit}`;
      const media = /\.(mp4|webm)(\?|$)/i.test(l.src)
        ? h('video', { src: safeUrl(l.src), muted: true, playsinline: true, preload: 'metadata', style: mediaStyle })
        : h('img', { src: safeUrl(l.src), alt: '', draggable: 'false', style: mediaStyle });
      const sub = String(l.subtitle || '').trim();
      if (!sub) return [media];
      return [media, h('div', { class: 'cv-image-sub' }, sub)];
    }
    if (l.type === 'gallery') {
      const images = l.images || [];
      if (l.freeform) {
        const board = h('div', { class: 'cv-free' });
        if (!images.length) board.append(h('div', { class: 'cv-placeholder' }, 'No images yet'));
        images.forEach((item, index) => {
          const cell = h('div', {
            class: 'cv-free-item',
            'data-free': String(index),
            style: `left:${Number(item.x) || 0}px;top:${Number(item.y) || 0}px;width:${Math.max(20, Number(item.w) || 80)}px;height:${Math.max(20, Number(item.h) || 80)}px`,
          }, item.image
            ? h('img', { src: safeUrl(item.image), alt: '', draggable: 'false', style: `object-fit:${l.fit || 'cover'}` })
            : h('span', null, 'Empty'));
          cell.append(h('span', { class: 'cv-free-resize', 'data-free': String(index), title: 'Drag to resize this image' }));
          board.append(cell);
        });
        return [board];
      }
      const cols = clamp(Number(l.columns) || 3, 1, 4);
      const gap = Number(l.gap) || 16;
      const natural = naturalGallery(l);
      const aspect = !natural && l.aspect ? l.aspect.replace(':', '/') : '';
      const grid = h('div', {
        class: natural ? 'cv-gallery is-natural' : 'cv-gallery',
        style: `grid-template-columns:repeat(${cols},1fr);gap:${gap}px`,
      });
      if (!images.length) grid.append(h('div', { class: 'cv-placeholder' }, 'No images yet'));
      images.forEach((item) => {
        grid.append(item.image
          ? h('div', { class: 'cv-gal-cell', style: aspect ? `aspect-ratio:${aspect}` : '' },
            h('img', {
              src: safeUrl(item.image),
              alt: '',
              draggable: 'false',
              style: natural ? '' : `object-fit:${l.fit || 'cover'}`,
            }))
          : h('div', { class: 'cv-placeholder' }, 'Empty'));
      });
      return [grid];
    }
    if (l.type === 'shape') return drawShapeGraphic(l);
    if (l.type === 'button') {
      const kind = l.buttonStyle === 'solid' ? 'solid' : l.buttonStyle === 'outline' ? 'outline' : 'pill';
      return [h('span', {
        class: `cv-btn ${kind}`,
        style: `color:${l.color || '#fff'};${l.bg ? `background:${l.bg}` : ''};font-size:${Number(l.size) || 16}px;font-weight:${Number(l.weight) || 600}${l.font ? `;font-family:${l.font}` : ''}`,
      }, l.text || 'Button')];
    }
    return [];
  }

  // One block on the board, with its resize handles. The element carries only
  // position and size; everything visual lives on the inner box.
  function drawLayer(l) {
    const el = h('div', {
      class: `cv-layer cv-t-${l.type}${l.hidden ? ' is-hidden' : ''}${l.locked ? ' is-locked' : ''}`,
      'data-id': l.id,
      style: `left:${l.x}px;top:${l.y}px;width:${l.w}px;z-index:${Number(l.z) || 0}${(isTextual(l) && l.hugging) || naturalGallery(l) ? '' : `;height:${l.h}`}${layerTurn(l)}`,
    });
    if (isTextual(l) && l.hugging) el.classList.add('cv-hug');
    const box = h('div', { class: 'cv-layer-box', style: layerStyle(l) }, ...drawLayerContent(l));
    el.append(box);
    if (l.type === 'divider') el.append(h('span', { class: 'cv-divider-fill', style: `background:${l.color || '#0A192F'}` }));
    el.append(h('span', { class: 'cv-rotate', title: 'Drag to rotate. Hold Shift to snap every 15°.' }));
    for (const dir of HANDLES) {
      const corner = dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw';
      el.append(h('span', {
        class: `cv-resize cv-resize-${dir}`,
        'data-resize': dir,
        title: isTextual(l) && corner
          ? 'Drag to scale the text'
          : (l.type === 'shape' ? 'Drag to resize. Hold Shift for a square.' : 'Drag to resize'),
      }));
    }
    if (l.type === 'gallery' || l.type === 'image' || isTextual(l)) el.classList.add('cv-has-size');
    if (naturalGallery(l)) el.classList.add('cv-natural-gallery');
    return el;
  }

  // Point handles sit on the layer itself (not inside the clipped box) so they
  // stay grabbable at the edges. Edge marks sit halfway between two points.
  function syncShapeHandles(el, l) {
    const show = l.type === 'shape' && shapeKind(l) === 'custom';
    const pts = show ? customPoints(l) : [];
    let nodes = [...el.querySelectorAll('.cv-shape-point')];
    let edges = [...el.querySelectorAll('.cv-shape-edge')];
    if (nodes.length !== pts.length || edges.length !== pts.length) {
      nodes.forEach((n) => n.remove());
      edges.forEach((n) => n.remove());
      pts.forEach((_, i) => {
        el.append(h('span', {
          class: 'cv-shape-point',
          'data-point': String(i),
          title: 'Drag to move this point. Double-click to remove it.',
        }));
        el.append(h('span', {
          class: 'cv-shape-edge',
          'data-edge': String(i),
          title: 'Drag to add a point on this edge',
        }));
      });
      nodes = [...el.querySelectorAll('.cv-shape-point')];
      edges = [...el.querySelectorAll('.cv-shape-edge')];
    }
    pts.forEach(([x, y], i) => {
      nodes[i].style.left = `${x}%`;
      nodes[i].style.top = `${y}%`;
      const next = pts[(i + 1) % pts.length];
      edges[i].style.left = `${(x + next[0]) / 2}%`;
      edges[i].style.top = `${(y + next[1]) / 2}%`;
    });
  }

  // =========================================================================

  function createLayoutEditor(opts) {
    const section = opts.section;
    const onChange = opts.onChange;
    const onRequestImage = opts.onRequestImage; // async () => url | null
    const onRequestFiles = opts.onRequestFiles; // async (files) => [urls]

    let selectedIds = new Set();
    let dragging = null;      // { layer, el, mode, ... } while a drag is running
    // Zoom: null means "as wide as the panel allows", otherwise a fixed factor.
    let fixedScale = null;

    const layers = () => (section.layers = section.layers || []);
    const boardHeight = () => Number(section.canvasHeight) || M.CANVAS_H;
    const WIDTH_MIN = 480;
    const WIDTH_MAX = 4000;
    const boardWidth = () => {
      const n = Number(section.canvasWidth);
      if (!Number.isFinite(n) || n <= 0) return M.CANVAS_W;
      return clamp(Math.round(n), WIDTH_MIN, WIDTH_MAX);
    };
    const ordered = () => [...layers()].sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
    const byId = (id) => layers().find((l) => l.id === id) || null;
    const selectedLayers = () => layers().filter((l) => selectedIds.has(l.id));
    const primary = () => byId([...selectedIds][selectedIds.size - 1]) || null;

    // ------------------------------------------------------------- history
    //
    // Undo/redo stores snapshots of the layer data. It deliberately does NOT
    // store the section or the layers array itself: the admin keys its editors
    // and open panels by object reference, so the section and its array have to
    // stay the same objects for the life of the editor. A snapshot is therefore
    // just a deep copy of the layers, and restoring means writing that copy back
    // INTO the existing array.
    //
    // Rapid changes that belong to one gesture (a drag, a burst of typing) are
    // coalesced, so one drag is one undo step rather than one per pointermove.
    let history = [];
    let historyAt = -1;
    let gestureOpen = false;   // true while a drag or a typing burst is running
    let typingTimer = null;
    const HISTORY_MAX = 100;

    const snapshot = () => JSON.parse(JSON.stringify(layers()));

    // Called before a change lands. Fills in the rest of the list each time, so
    // redoing after an undo and then editing starts a fresh branch.
    function record() {
      const snap = snapshot();
      const last = history[historyAt];
      if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
      history = history.slice(0, historyAt + 1);
      history.push(snap);
      if (history.length > HISTORY_MAX) history.shift();
      historyAt = history.length - 1;
      paintToolbar();
    }

    // A gesture is one visual operation that may fire many small changes. The
    // flag stays open until the gesture ends, so everything inside it collapses
    // into the single snapshot taken when it opened. The timer is a safety net
    // for gestures that never call endGesture (a colour picker, say).
    function beginGesture() {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { gestureOpen = false; }, 600);
      if (gestureOpen) return;
      gestureOpen = true;
      record();
    }

    function endGesture() {
      clearTimeout(typingTimer);
      gestureOpen = false;
    }

    // Field edits arrive as a change per keystroke. The timer closes the burst
    // shortly after typing stops, so the whole edit is a single undo step.
    function beginTyping() {
      clearTimeout(typingTimer);
      if (!gestureOpen) {
        gestureOpen = true;
        record();
      }
      typingTimer = setTimeout(() => { gestureOpen = false; }, 500);
    }

    // Writes a snapshot back over the live layer objects. The array is spliced
    // in place and each layer object's properties are reassigned, so nothing
    // that holds a reference to a layer is left pointing at a stale object.
    function restore(snap) {
      const list = layers();
      const wanted = new Map(snap.map((l) => [l.id, l]));
      // Drop anything the snapshot does not have.
      for (let i = list.length - 1; i >= 0; i--) {
        if (!wanted.has(list[i].id)) list.splice(i, 1);
      }
      snap.forEach((src, index) => {
        let live = list.find((l) => l.id === src.id);
        if (!live) {
          live = {};
          list.splice(index, 0, live);
        }
        // Replace the contents rather than the object, so anything holding a
        // reference to this layer keeps working.
        Object.keys(live).forEach((k) => { if (!(k in src)) delete live[k]; });
        Object.assign(live, JSON.parse(JSON.stringify(src)));
      });
      // Keep the list in the snapshot's order: z values follow list order.
      list.sort((a, b) => snap.findIndex((s) => s.id === a.id) - snap.findIndex((s) => s.id === b.id));
      // A restored board may not hold the layer that is selected any more.
      const ids = new Set(list.map((l) => l.id));
      selectedIds = new Set([...selectedIds].filter((id) => ids.has(id)));
    }

    function applyHistory(index) {
      if (index < 0 || index >= history.length) return;
      historyAt = index;
      gestureOpen = false;
      restore(history[historyAt]);
      render();
      onChange();
    }

    const canUndo = () => historyAt > 0;
    const canRedo = () => historyAt >= 0 && historyAt < history.length - 1;

    function undo() {
      if (!canUndo()) return;
      applyHistory(historyAt - 1);
    }

    function redo() {
      if (!canRedo()) return;
      applyHistory(historyAt + 1);
    }

    // The element for a layer, looked up fresh: a render may have replaced it.
    const elFor = (id) => board.querySelector(`.cv-layer[data-id="${id}"]`);
    // Natural image groups size themselves from the pictures, so alignment and
    // the inspector read the box on the board rather than the stored height.
    function boxHeight(l) {
      if (!naturalGallery(l)) return Number(l.h) || 0;
      const el = elFor(l.id);
      const measured = el ? el.offsetHeight : 0;
      return measured > 0 ? measured : Number(l.h) || 0;
    }

    const toolbar = h('div', { class: 'cv-toolbar' });
    const paneLeft = h('div', { class: 'cv-pane' });
    const paneRight = h('div', { class: 'cv-pane cv-inspector' });
    // Clicking a number field's arrows focuses it, and the browser then scrolls
    // the panel to bring that field to the top. Handle the arrows here so the
    // number changes and the panel stays where it is.
    paneRight.addEventListener('pointerdown', (e) => {
      const input = e.target.closest('input[type="number"]');
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const onArrow = e.clientX >= rect.right - 18;
      const panelTop = paneRight.scrollTop;
      const pageTop = window.scrollY;
      const restore = () => {
        if (paneRight.scrollTop !== panelTop) paneRight.scrollTop = panelTop;
        if (window.scrollY !== pageTop) window.scrollTo(window.scrollX, pageTop);
      };
      if (onArrow) {
        e.preventDefault();
        const dir = e.clientY < rect.top + rect.height / 2 ? 1 : -1;
        const tick = () => {
          if (dir > 0) input.stepUp(); else input.stepDown();
          input.dispatchEvent(new Event('change', { bubbles: true }));
          restore();
        };
        tick();
        let repeat = setTimeout(() => { repeat = setInterval(tick, 80); }, 400);
        const stopRepeat = () => {
          clearTimeout(repeat);
          clearInterval(repeat);
          window.removeEventListener('pointerup', stopRepeat);
        };
        window.addEventListener('pointerup', stopRepeat);
      }
      paneRight.addEventListener('scroll', restore);
      window.addEventListener('scroll', restore);
      const stop = () => {
        paneRight.removeEventListener('scroll', restore);
        window.removeEventListener('scroll', restore);
        window.removeEventListener('pointerup', stop);
        requestAnimationFrame(restore);
      };
      window.addEventListener('pointerup', stop);
    });
    const board = h('div', { class: 'cv-board' });
    // Guides start hidden: they only show while a layer snaps to something.
    const guideX = h('div', { class: 'cv-guide cv-guide-v', hidden: true });
    const guideY = h('div', { class: 'cv-guide cv-guide-h', hidden: true });
    const widthLeft = h('div', { class: 'cv-width-handle cv-width-left', title: 'Drag to change the page width' });
    const widthRight = h('div', { class: 'cv-width-handle cv-width-right', title: 'Drag to change the page width' });
    const stage = h('div', { class: 'cv-stage' }, board, guideX, guideY, widthLeft, widthRight);
    const onWidthDown = (edge, e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = boardWidth();
      const origin = layers().map((l) => ({ id: l.id, x: l.x }));
      beginGesture();
      const move = (ev) => {
        const dx = (ev.clientX - startX) / scale();
        const raw = edge === 'right' ? startW + dx : startW - dx;
        const next = clamp(Math.round(raw), WIDTH_MIN, WIDTH_MAX);
        section.canvasWidth = next;
        if (edge === 'left') {
          const shift = next - startW;
          layers().forEach((l) => {
            const was = origin.find((item) => item.id === l.id);
            if (was) l.x = Math.round(was.x + shift);
          });
        }
        onChange();
        paintBoard();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        endGesture();
        paintInspector();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    widthLeft.addEventListener('pointerdown', (e) => onWidthDown('left', e));
    widthRight.addEventListener('pointerdown', (e) => onWidthDown('right', e));
    const viewport = h('div', { class: 'cv-viewport' }, stage);
    const zoomLabel = h('span', { class: 'cv-hint cv-zoomlabel' });
    const root = h('div', { class: 'cv', tabindex: '0' },
      toolbar,
      h('div', { class: 'cv-panes' },
        paneLeft,
        viewport,
        paneRight));

    // -------------------------------------------------------------- geometry

    // The widest scale that still fits the board in the panel.
    function fitScale() {
      const avail = viewport.clientWidth - 24 - 2;
      if (avail <= 0) return 1;
      return clamp(Number((avail / boardWidth()).toFixed(3)), 0.2, 1);
    }

    const scale = () => fixedScale || fitScale();

    let zoomTimer = null;
    function setScale(next, refit) {
      fixedScale = refit ? null : clamp(Number(next.toFixed(3)), 0.1, 4);
      paintBoard();
      paintToolbar();
    }

    function zoomBy(factor) {
      setScale(scale() * factor, false);
    }

    function zoomStep(direction) {
      const stops = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
      const current = scale();
      const next = direction > 0
        ? stops.find((s) => s > current + 0.001)
        : [...stops].reverse().find((s) => s < current - 0.001);
      setScale(next || (direction > 0 ? 3 : 0.25), false);
    }

    // ------------------------------------------------------------ selection

    function cellBox(l, index) {
      const cols = clamp(Number(l.columns) || 3, 1, 4);
      const gap = Number(l.gap) || 0;
      const count = Math.max(1, (l.images || []).length);
      const rows = Math.max(1, Math.ceil(count / cols));
      const cellW = Math.max(20, (Number(l.w) - gap * (cols - 1)) / cols);
      const cellH = Math.max(20, (Number(l.h) - gap * (rows - 1)) / rows);
      const col = index % cols;
      const row = Math.floor(index / cols);
      return {
        x: Math.round(col * (cellW + gap)),
        y: Math.round(row * (cellH + gap)),
        w: Math.round(cellW),
        h: Math.round(cellH),
      };
    }

    function layoutFreeform(l) {
      (l.images || []).forEach((item, index) => {
        const box = cellBox(l, index);
        if (item.x == null) item.x = box.x;
        if (item.y == null) item.y = box.y;
        if (!item.w) item.w = box.w;
        if (!item.h) item.h = box.h;
      });
    }

    function separateGallery(l) {
      const images = l.images || [];
      if (!images.length) return;
      record();
      const list = layers();
      const index = list.findIndex((item) => item.id === l.id);
      if (index < 0) return;
      const made = images.map((item, i) => {
        const grid = cellBox(l, i);
        return M.defaultLayer('image', {
          name: item.caption || `Image ${i + 1}`,
          src: item.image || '',
          alt: item.caption || '',
          link: item.link || '',
          fit: l.fit || 'cover',
          x: Math.round(l.x + (l.freeform ? (Number(item.x) || 0) : grid.x)),
          y: Math.round(l.y + (l.freeform ? (Number(item.y) || 0) : grid.y)),
          w: Math.max(20, Math.round(l.freeform ? (Number(item.w) || grid.w) : grid.w)),
          h: Math.max(20, Math.round(l.freeform ? (Number(item.h) || grid.h) : grid.h)),
        });
      });
      list.splice(index, 1, ...made);
      applyOrder(ordered());
      onChange();
      selectOnly(made[0] ? made[0].id : null);
    }

    function selectOnly(id) {
      selectedIds = new Set(id ? [id] : []);
      paintBoard();
      paintList();
      paintInspector();
    }

    function toggleSelect(id) {
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      paintBoard();
      paintList();
      paintInspector();
    }

    function selectAllLayers() {
      selectedIds = new Set(layers().map((l) => l.id));
      paintBoard();
      paintList();
      paintInspector();
    }

    function nextZ() {
      return layers().reduce((m, l) => Math.max(m, Number(l.z) || 0), 0) + 1;
    }

    // ---------------------------------------------------------- add / remove

    function addLayer(type) {
      const layer = M.defaultLayer(type, {
        z: nextZ(),
        x: 60,
        y: clamp(60 + layers().length * 16, 0, Math.max(0, boardHeight() - 120)),
        name: `${M.layerTypeLabel(type)} ${layers().length + 1}`,
      });
      if (type === 'gallery') layer.images = [{ image: '', caption: '', link: '' }];
      record();
      layers().push(layer);
      selectOnly(layer.id);
      onChange();
    }

    function duplicateLayer(id) {
      const list = layers();
      const i = list.findIndex((l) => l.id === id);
      if (i < 0) return;
      const copy = JSON.parse(JSON.stringify(list[i]));
      copy.id = `l-${Math.random().toString(36).slice(2, 9)}`;
      copy.name = `${list[i].name} copy`;
      copy.x += 24;
      copy.y += 24;
      copy.z = nextZ();
      record();
      list.splice(i + 1, 0, copy);
      selectOnly(copy.id);
      onChange();
    }

    function removeLayer(id) {
      const list = layers();
      const i = list.findIndex((l) => l.id === id);
      if (i < 0) return;
      if (!confirm(`Delete the layer "${list[i].name}"?`)) return;
      record();
      list.splice(i, 1);
      selectedIds.delete(id);
      onChange();
      render();
    }

    function copyLayerToClipboard(l) {
      try {
        navigator.clipboard?.writeText(JSON.stringify(l));
      } catch { /* clipboard may be blocked; the offset copy still works */ }
    }

    // ------------------------------------------------------------ ordering

    // Layers are drawn back to front. Ordering is expressed by rewriting every
    // z value from the list order, which keeps the numbers unique and small —
    // swapping two values that happen to be equal would do nothing at all.
    //
    // `ordered()` is back-to-front (lowest z first). Every control that moves a
    // layer works in that same direction: a positive `dir` moves it one step
    // towards the front, a negative one towards the back.
    function applyOrder(list) {
      list.forEach((l, i) => { l.z = i + 1; });
    }

    function moveLayer(id, dir) {
      const list = ordered();
      const i = list.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
      applyOrder(list);
      record();
      onChange();
      paintBoard();
      paintList();
      paintInspector();
    }

    // 'front' / 'back' jump straight to one end of the stack.
    function setZ(id, where) {
      const layer = byId(id);
      if (!layer) return;
      const rest = ordered().filter((l) => l.id !== id);
      const list = where === 'front' ? [...rest, layer] : [layer, ...rest];
      applyOrder(list);
      record();
      onChange();
      paintBoard();
      paintList();
      paintInspector();
    }

    function bringForward(id) { moveLayer(id, 1); }
    function sendBackward(id) { moveLayer(id, -1); }

    // The list is drawn front to back. Dropping a row writes that order back
    // onto z, so the board and the list stay in step.
    function reorderFront(fromId, toId) {
      if (!fromId || !toId || fromId === toId) return;
      const front = ordered().slice().reverse();
      const from = front.findIndex((l) => l.id === fromId);
      const to = front.findIndex((l) => l.id === toId);
      if (from < 0 || to < 0) return;
      const [item] = front.splice(from, 1);
      front.splice(to, 0, item);
      applyOrder(front.slice().reverse());
      record();
      onChange();
      paintBoard();
      paintList();
      paintInspector();
    }

    // ------------------------------------------------------------- alignment

    // Everything works in board pixels. `bounds` is either the board or the
    // tightest box around the selected layers.
    function alignBox(targets) {
      if (!targets.length) return null;
      const minX = Math.min(...targets.map((l) => l.x));
      const minY = Math.min(...targets.map((l) => l.y));
      const maxX = Math.max(...targets.map((l) => l.x + l.w));
      const maxY = Math.max(...targets.map((l) => l.y + l.h));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // withOthers: "align to the group" when more than one layer is selected,
    // otherwise "align to the board".
    function runAlign(edge, withOthers) {
      const targets = selectedLayers();
      if (!targets.length) return;
      const useGroup = withOthers && targets.length > 1;
      const box = useGroup
        ? alignBox(targets)
        : { x: 0, y: 0, w: boardWidth(), h: boardHeight() };

      switch (edge) {
        case 'left': targets.forEach((l) => { l.x = box.x; }); break;
        case 'hcenter': targets.forEach((l) => { l.x = round(box.x + (box.w - l.w) / 2); }); break;
        case 'right': targets.forEach((l) => { l.x = round(box.x + box.w - l.w); }); break;
        case 'top': targets.forEach((l) => { l.y = box.y; }); break;
        case 'vcenter': targets.forEach((l) => { l.y = round(box.y + (box.h - boxHeight(l)) / 2); }); break;
        case 'bottom': targets.forEach((l) => { l.y = round(box.y + box.h - boxHeight(l)); }); break;
        case 'distribute-x': {
          if (targets.length < 3) return;
          const sorted = [...targets].sort((a, b) => a.x - b.x);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          const span = (last.x + last.w) - first.x;
          const used = sorted.reduce((sum, l) => sum + l.w, 0);
          const gap = (span - used) / (sorted.length - 1);
          let cursor = first.x;
          sorted.forEach((l) => { l.x = round(cursor); cursor += l.w + gap; });
          break;
        }
        case 'distribute-y': {
          if (targets.length < 3) return;
          const sorted = [...targets].sort((a, b) => a.y - b.y);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          const span = (last.y + boxHeight(last)) - first.y;
          const used = sorted.reduce((sum, l) => sum + boxHeight(l), 0);
          const gap = (span - used) / (sorted.length - 1);
          let cursor = first.y;
          sorted.forEach((l) => { l.y = round(cursor); cursor += boxHeight(l) + gap; });
          break;
        }
        default: return;
      }
      record();
      onChange();
      paintBoard();
      paintInspector();
    }

    // ------------------------------------------------------- snapping guides

    function showGuides(l, others) {
      const vLines = [0, round(boardWidth() / 2), boardWidth()];
      const hLines = [0, round(boardHeight() / 2), boardHeight()];
      others.forEach((o) => {
        vLines.push(o.x, round(o.x + o.w / 2), round(o.x + o.w));
        hLines.push(o.y, round(o.y + o.h / 2), round(o.y + o.h));
      });
      const vTargets = [l.x, round(l.x + l.w / 2), round(l.x + l.w)];
      const hTargets = [l.y, round(l.y + l.h / 2), round(l.y + l.h)];
      const near = (list, value) => list.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), list[0]);

      let vx = null;
      vTargets.forEach((value) => {
        const match = others.length ? near(vLines.slice(3), value) : near(vLines, value);
        if (Math.abs(match - value) <= 4) vx = match;
      });
      let hy = null;
      hTargets.forEach((value) => {
        const match = others.length ? near(hLines.slice(3), value) : near(hLines, value);
        if (Math.abs(match - value) <= 4) hy = match;
      });
      if (vx == null) vTargets.forEach((value) => {
        const match = near(vLines, value);
        if (Math.abs(match - value) <= 4) vx = match;
      });
      if (hy == null) hTargets.forEach((value) => {
        const match = near(hLines, value);
        if (Math.abs(match - value) <= 4) hy = match;
      });

      guideX.hidden = vx == null;
      guideY.hidden = hy == null;
      // The guides live in the stage, outside the scaled board, so board pixels
      // have to be converted to screen pixels here.
      if (vx != null) guideX.style.left = `${vx * scale()}px`;
      if (hy != null) guideY.style.top = `${hy * scale()}px`;
      return { x: vx, y: hy };
    }

    function hideGuides() {
      guideX.hidden = true;
      guideY.hidden = true;
    }

    // ---------------------------------------------------------------- fields

    function field(label, control, wide) {
      return h('label', { class: `cv-field${wide ? ' wide' : ''}` }, label ? h('span', null, label) : null, control);
    }

    // One wheel notch moves the control by its own step. The listener sits on
    // the control, so the wheel still scrolls the panel everywhere else.
    function bindWheel(input, onStep) {
      input.addEventListener('wheel', (e) => {
        e.preventDefault();
        onStep(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      input.title = input.title
        ? `${input.title} Scroll to adjust.`
        : 'Scroll to adjust.';
    }

    function roundToStep(value, step) {
      const decimals = (String(step).split('.')[1] || '').length;
      return Number((Math.round(value / step) * step).toFixed(decimals));
    }

    function numField(l, key, label, min, max, step, fallback) {
      const stride = step || 1;
      const read = () => {
        const n = Number(l[key]);
        return Number.isFinite(n) ? n : (fallback ?? 0);
      };
      const input = h('input', { type: 'number', value: read(), min, max, step: stride });
      const apply = (value) => {
        l[key] = clamp(roundToStep(value, stride), min, max);
        input.value = String(l[key]);
        onChange();
        paintBoard();
        const hint = paneRight.querySelector('.cv-pane-head .cv-hint');
        if (hint && primary()?.id === l.id) hint.textContent = `${round(l.w)}×${round(l.h)}`;
      };
      input.addEventListener('change', () => {
        record();
        apply(Number(input.value) || 0);
      });
      bindWheel(input, (dir) => {
        beginGesture();
        apply(read() + dir * stride);
      });
      return field(label, input);
    }

    function textField(l, key, label, placeholder) {
      const input = h('input', { type: 'text', value: l[key] ?? '', placeholder: placeholder || '' });
      input.addEventListener('input', () => {
        beginTyping();
        l[key] = input.value;
        onChange();
        paintBoard();
        paintList();
      });
      return field(label, input, true);
    }

    function areaField(l, key, label, rows) {
      const input = h('textarea', { rows: rows || 4 });
      input.value = l[key] ?? '';
      input.addEventListener('input', () => {
        beginTyping();
        l[key] = input.value;
        onChange();
        paintBoard();
        paintList();
      });
      return field(label, input, true);
    }

    function fontChoices() {
      const custom = (window.CanvasFonts || []).map((font) => [font.css, font.family]);
      return [...M.FONTS, ...custom];
    }

    function fontField(l) {
      const wrap = h('div', { class: 'cv-font-pick' });
      const btn = h('button', { class: 'cv-font-btn', type: 'button' });
      const menu = h('div', { class: 'cv-font-menu', hidden: true });
      const choices = fontChoices();
      const current = choices.find(([value]) => value === (l.font || ''));
      btn.textContent = current ? current[1] : 'Choose a font';
      if (current) btn.style.fontFamily = current[0];
      choices.forEach(([value, text]) => {
        const opt = h('button', {
          class: `cv-font-opt${l.font === value ? ' is-on' : ''}`,
          type: 'button',
        }, text);
        opt.style.fontFamily = value;
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          record();
          l.font = value;
          onChange();
          render();
        });
        menu.append(opt);
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        document.querySelectorAll('.cv-font-menu').forEach((node) => { node.hidden = true; });
        menu.hidden = !willOpen;
      });
      if (!window.__cvFontCloser) {
        window.__cvFontCloser = true;
        document.addEventListener('click', () => {
          document.querySelectorAll('.cv-font-menu').forEach((node) => { node.hidden = true; });
        });
      }
      wrap.append(btn, menu);
      return field('Font', wrap);
    }

    function selectField(l, key, label, options, numeric) {
      const sel = h('select', null, options.map(([value, text]) =>
        h('option', { value: String(value), selected: String(l[key] ?? '') === String(value) }, text)));
      sel.addEventListener('change', () => {
        record();
        l[key] = numeric ? Number(sel.value) : sel.value;
        onChange();
        render();
      });
      return field(label, sel);
    }

    // Split a stored colour into a solid hex (what the native picker can show)
    // and an opacity from 0 to 1. Anything it cannot read falls back to black.
    function parseColor(value) {
      const v = String(value || '').trim();
      const hex6 = /^#([0-9a-f]{6})$/i.exec(v);
      if (hex6) return { hex: `#${hex6[1].toUpperCase()}`, alpha: 1 };
      const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(v);
      if (hex8) return { hex: `#${hex8[1].toUpperCase()}`, alpha: parseInt(hex8[2], 16) / 255 };
      const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
      if (rgb) {
        const hex = '#' + [rgb[1], rgb[2], rgb[3]]
          .map((n) => clamp(Number(n), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
        const alpha = rgb[4] == null ? 1 : clamp(Number(rgb[4]), 0, 1);
        return { hex, alpha };
      }
      return { hex: '#000000', alpha: 1 };
    }

    // A fully solid colour stays a plain hex code. Anything see-through is
    // stored as rgba(), which the live site already accepts.
    function formatColor(hex, alpha) {
      const solid = hex.toUpperCase();
      if (alpha >= 0.995) return solid;
      const r = parseInt(solid.slice(1, 3), 16);
      const g = parseInt(solid.slice(3, 5), 16);
      const b = parseInt(solid.slice(5, 7), 16);
      const a = Math.round(clamp(alpha, 0, 1) * 100) / 100;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    function colorField(l, key, label) {
      const parsed = parseColor(l[key]);
      const swatch = h('input', { type: 'color', value: parsed.hex });
      const text = h('input', { type: 'text', value: l[key] || '', placeholder: 'default' });
      const alpha = h('input', {
        type: 'range', min: '0', max: '100', step: '1',
        value: String(Math.round(parsed.alpha * 100)),
        title: 'Opacity. Drag left to make the colour see-through.',
      });
      const alphaRead = h('span', { class: 'cv-alpha-read' }, `${Math.round(parsed.alpha * 100)}%`);

      // While either control is dragged only the board is repainted. Rebuilding
      // the inspector here would destroy the control under the pointer.
      const writeLive = () => {
        beginGesture();
        const next = formatColor(swatch.value, Number(alpha.value) / 100);
        l[key] = next;
        text.value = next;
        alphaRead.textContent = `${alpha.value}%`;
        onChange();
        paintBoard();
      };
      const commit = () => { endGesture(); paintToolbar(); };

      swatch.addEventListener('input', writeLive);
      swatch.addEventListener('change', commit);
      alpha.addEventListener('input', writeLive);
      alpha.addEventListener('change', commit);
      bindWheel(alpha, (dir) => {
        alpha.value = String(clamp(Number(alpha.value) + dir, 0, 100));
        writeLive();
      });
      text.addEventListener('change', () => {
        record();
        l[key] = text.value.trim();
        const next = parseColor(l[key]);
        if (/^(#|rgba?\()/i.test(l[key])) {
          swatch.value = next.hex;
          alpha.value = String(Math.round(next.alpha * 100));
          alphaRead.textContent = `${alpha.value}%`;
        }
        onChange();
        render();
      });
      return field(label, h('div', { class: 'cv-color' },
        swatch,
        text,
        h('label', { class: 'cv-alpha' }, 'Opacity', alpha, alphaRead)));
    }

    function toggleField(l, key, label) {
      const cb = h('input', { type: 'checkbox', checked: Boolean(l[key]) });
      cb.addEventListener('change', () => { record(); l[key] = cb.checked; onChange(); render(); });
      return h('label', { class: 'cv-check' }, cb, label);
    }

    // ------------------------------------------------------------- images

    // Choosing an image for an image layer. Dropping a file straight onto the
    // thumbnail uploads it, so replacing a picture takes one gesture.
    function imageField(l, key, label) {
      const thumb = h('button', {
        class: 'cv-thumb', type: 'button',
        title: 'Click to choose an image, or drop a file here',
      }, l[key] ? h('img', { src: safeUrl(l[key]), alt: '' }) : h('span', null, 'None'));
      thumb.addEventListener('click', async () => {
        const url = await onRequestImage();
        if (url) { l[key] = url; onChange(); render(); }
      });

      const choose = h('button', { class: 'btn small', type: 'button' }, l[key] ? 'Replace image' : 'Choose image');
      choose.addEventListener('click', async () => {
        const url = await onRequestImage();
        if (url) { l[key] = url; onChange(); render(); }
      });
      const upload = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm', hidden: true });
      upload.addEventListener('change', async () => {
        const urls = await onRequestFiles([...upload.files]);
        upload.value = '';
        if (urls.length) { l[key] = urls[0]; onChange(); render(); }
      });
      const uploadBtn = h('button', { class: 'btn small', type: 'button', onclick: () => upload.click() }, 'Upload new');
      const clear = h('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      clear.addEventListener('click', () => { l[key] = ''; onChange(); render(); });

      return field(label,
        h('div', { class: 'cv-imgrow' },
          thumb,
          h('div', { class: 'cv-imgrow-side' }, choose, uploadBtn, clear),
          upload),
        true);
    }

    function galleryField(l) {
      l.images = l.images || [];
      const list = h('div', { class: 'cv-gal-list' });
      const fileIn = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm', multiple: true, hidden: true });
      fileIn.addEventListener('change', async () => {
        const urls = await onRequestFiles([...fileIn.files]);
        fileIn.value = '';
        urls.forEach((url) => l.images.push({ image: url, caption: '', link: '' }));
        if (urls.length) { onChange(); render(); }
      });
      const swap = (i, j) => {
        if (j < 0 || j >= l.images.length) return;
        const [item] = l.images.splice(i, 1);
        l.images.splice(j, 0, item);
        onChange();
        render();
      };
      list.append(
        ...l.images.map((item, i) => {
          const thumb = h('button', {
            class: 'cv-thumb small', type: 'button',
            title: 'Click to choose a different image',
          }, item.image ? h('img', { src: safeUrl(item.image), alt: '' }) : h('span', null, 'Empty'));
          thumb.addEventListener('click', async () => {
            const url = await onRequestImage();
            if (url) { item.image = url; onChange(); render(); }
          });
          const itemUpload = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm', hidden: true });
          itemUpload.addEventListener('change', async () => {
            const urls = await onRequestFiles([...itemUpload.files]);
            itemUpload.value = '';
            if (urls.length) { item.image = urls[0]; onChange(); render(); }
          });
          return h('div', { class: 'cv-gal-item' },
            thumb,
            h('div', { class: 'cv-gal-side' },
              h('input', { type: 'text', value: item.caption || '', placeholder: 'Caption (optional)', oninput: (e) => { item.caption = e.target.value; onChange(); paintBoard(); } }),
              h('input', { type: 'text', value: item.link || '', placeholder: 'Link, e.g. YouTube (optional)', oninput: (e) => { item.link = e.target.value; onChange(); } })),
            h('div', { class: 'cv-gal-btns' },
              h('button', { class: 'icon-btn', type: 'button', title: 'Upload a replacement', onclick: () => itemUpload.click() }, '⤒'),
              h('button', { class: 'icon-btn', type: 'button', title: 'Move earlier', disabled: i === 0, onclick: () => swap(i, i - 1) }, '←'),
              h('button', { class: 'icon-btn', type: 'button', title: 'Move later', disabled: i === l.images.length - 1, onclick: () => swap(i, i + 1) }, '→'),
              h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove image', onclick: () => { l.images.splice(i, 1); onChange(); render(); } }, '✕')),
            itemUpload);
        }),
        h('div', { class: 'cv-gal-actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => fileIn.click() }, 'Upload images'),
          h('button', {
            class: 'btn small', type: 'button',
            onclick: async () => { const url = await onRequestImage(); if (url) { l.images.push({ image: url, caption: '', link: '' }); onChange(); render(); } },
          }, 'Add from library'),
          fileIn));
      return list;
    }

    // ---------------------------------------------------------------- paints

    // The board is patched rather than rebuilt: an element that is already
    // correct is left alone, so a layer under the pointer is never torn down.
    function paintBoard() {
      const s = scale();
      board.style.width = `${boardWidth()}px`;
      board.style.height = `${boardHeight()}px`;
      board.style.backgroundColor = section.canvasBg || '';
      const bgUrl = safeUrl(section.canvasImage || '');
      board.style.backgroundImage = bgUrl && bgUrl !== '#' ? `url("${bgUrl.replace(/"/g, '')}")` : '';
      board.style.backgroundSize = 'cover';
      board.style.backgroundPosition = 'center';
      board.style.backgroundRepeat = 'no-repeat';
      board.style.transform = `scale(${s})`;
      board.style.transformOrigin = 'top left';
      stage.style.width = `${boardWidth() * s}px`;
      stage.style.height = `${boardHeight() * s}px`;
      // Handles and guides are drawn inside the scaled board, so they carry the
      // inverse factor to stay a constant size on screen at any zoom.
      root.style.setProperty('--cv-inv', String(1 / s));

      const list = ordered();
      list.forEach((l, index) => {
        let el = elFor(l.id);
        if (!el) {
          el = drawLayer(l);
          board.append(el);
        }
        // Re-order cheaply: only move when the element is out of place.
        const current = board.children[index];
        if (current !== el) board.insertBefore(el, current || null);
        el.classList.toggle('selected', selectedIds.has(l.id));
        el.classList.toggle('primary', primary()?.id === l.id);
        el.classList.toggle('is-hidden', Boolean(l.hidden));
        el.classList.toggle('is-locked', Boolean(l.locked));
        el.classList.toggle('dragging', dragging?.layer?.id === l.id);
        const size = `left:${l.x}px;top:${l.y}px;width:${l.w}px;z-index:${Number(l.z) || 0}`;
        const lockHeight = (isTextual(l) && l.hugging) || naturalGallery(l);
        el.style.cssText = lockHeight ? `${size}${layerTurn(l)}` : `${size};height:${l.h}px${layerTurn(l)}`;
        el.classList.toggle('cv-hug', isTextual(l) && Boolean(l.hugging));
        el.classList.toggle('cv-natural-gallery', naturalGallery(l));
        const box = el.querySelector('.cv-layer-box');
        if (box) {
          box.style.cssText = layerStyle(l);
          // Text and image content only changes when the data does; rebuilding it
          // on every pointer move would restart image loads for no reason.
          const signature = contentSignature(l);
          if (el.dataset.signature !== signature) {
            el.dataset.signature = signature;
            box.replaceChildren(...drawLayerContent(l));
          }
        }
        const divider = el.querySelector('.cv-divider-fill');
        if (divider) divider.style.background = l.color || '#0A192F';
        syncShapeHandles(el, l);
        el.querySelectorAll('.cv-resize').forEach((handle) => {
          const corner = ['nw', 'ne', 'se', 'sw'].includes(handle.dataset.resize);
          handle.title = naturalGallery(l)
            ? 'Drag to change the width. Height stays locked to the original image shape.'
            : (isTextual(l) && corner
              ? 'Drag to scale the text'
              : (l.type === 'shape' ? 'Drag to resize. Hold Shift for a square.' : 'Drag to resize'));
        });
      });
      // Anything left over is a deleted layer.
      [...board.children].forEach((el) => { if (!list.some((l) => l.id === el.dataset.id)) el.remove(); });
      list.forEach((l) => {
        if (!naturalGallery(l)) return;
        const el = elFor(l.id);
        if (!el) return;
        el.querySelectorAll('img').forEach((img) => {
          if (img.dataset.lockLoad) return;
          img.dataset.lockLoad = '1';
          if (!img.complete) img.addEventListener('load', () => refreshLockedHeight(l), { once: true });
        });
        refreshLockedHeight(l);
      });
    }

    function refreshLockedHeight(l) {
      if (!l || !naturalGallery(l) || primary()?.id !== l.id) return;
      const px = String(round(boxHeight(l)));
      const hint = paneRight.querySelector('.cv-pane-head .cv-hint');
      if (hint) hint.textContent = `${round(l.w)}×${px}`;
      const input = paneRight.querySelector('[data-locked-height]');
      if (input) input.value = px;
    }

    function contentSignature(l) {
      if (l.type === 'heading' || l.type === 'text') return `${l.type}:${l.text}`;
      if (l.type === 'image') return `image:${l.src}:${l.fit}:${l.radius}:${l.subtitle || ''}`;
      if (l.type === 'gallery') {
        return `gallery:${l.freeform ? 1 : 0}:${l.columns}:${l.gap}:${l.aspect}:${l.fit}:${(l.images || []).map((i) => i.image).join('|')}`;
      }
      if (l.type === 'button') return `button:${l.text}:${l.buttonStyle}:${l.color}:${l.bg}:${l.size}:${l.weight}:${l.font}`;
      if (l.type === 'shape') return `shape:${l.shape}:${l.shapePoints}:${l.bg}:${l.borderWidth}:${l.borderColor}:${l.radius}:${l.starInner}:${l.starCount}:${l.w}:${l.h}`;
      return l.type;
    }

    function paintToolbar() {
      const zoomPct = Math.round(scale() * 100);
      zoomLabel.textContent = `${zoomPct}%${fixedScale == null ? ' (fit)' : ''}`;

      const addSel = h('select', { class: 'cv-add' },
        h('option', { value: '' }, '+ Add a layer…'),
        M.LAYER_TYPES.map(([value, text]) => h('option', { value }, text)));
      addSel.addEventListener('change', () => { if (addSel.value) { addLayer(addSel.value); addSel.value = ''; } });

      const zoomMenu = h('select', { class: 'cv-add', title: 'Zoom the board' },
        h('option', { value: 'fit' }, 'Fit to panel'),
        [25, 50, 75, 100, 150, 200, 300].map((p) => h('option', { value: String(p) }, `${p}%`)));
      zoomMenu.value = fixedScale == null ? 'fit' : String(Math.round(scale() * 100));
      zoomMenu.addEventListener('change', () => {
        if (zoomMenu.value === 'fit') setScale(1, true); else setScale(Number(zoomMenu.value) / 100, false);
      });

      toolbar.replaceChildren(
        h('div', { class: 'cv-tools' },
          h('button', { class: 'btn small', type: 'button', title: 'Undo (Ctrl + Z)', disabled: !(opts.canUndo ? opts.canUndo() : canUndo()), onclick: () => (opts.onUndo ? opts.onUndo() : undo()) }, '↶ Undo'),
          h('button', { class: 'btn small', type: 'button', title: 'Redo (Ctrl + Y)', disabled: !(opts.canRedo ? opts.canRedo() : canRedo()), onclick: () => (opts.onRedo ? opts.onRedo() : redo()) }, '↷ Redo'),
          addSel,
          h('button', { class: 'btn small', type: 'button', onclick: () => addLayer('text') }, '+ Text'),
          h('button', { class: 'btn small', type: 'button', onclick: () => addLayer('image') }, '+ Image'),
          h('button', { class: 'btn small', type: 'button', onclick: () => addLayer('gallery') }, '+ Image group'),
          h('button', { class: 'btn small', type: 'button', onclick: () => addLayer('button') }, '+ Button')),
        h('div', { class: 'cv-tools cv-zoom' },
          h('span', { class: 'cv-hint' }, 'Zoom'),
          h('button', { class: 'btn small', type: 'button', title: 'Zoom out (Ctrl + scroll down)', onclick: () => zoomStep(-1) }, '−'),
          h('button', { class: 'btn small', type: 'button', title: 'Zoom in (Ctrl + scroll up)', onclick: () => zoomStep(1) }, '+'),
          zoomLabel,
          zoomMenu,
          h('button', { class: 'btn small', type: 'button', title: 'Show the board at its real size', onclick: () => setScale(1, false) }, '100%'),
          h('button', { class: 'btn small', type: 'button', title: 'Fit the whole board in the panel', onclick: () => setScale(1, true) }, 'Fit')));
    }

    const ICONS = { heading: 'T', text: '¶', image: '▣', gallery: '▦', button: '⬭', divider: '—', shape: '▭' };

    function paintList() {
      const list = ordered().slice().reverse();
      paneLeft.replaceChildren(
        h('div', { class: 'cv-pane-head' },
          h('strong', null, `Layers (${layers().length})`),
          h('span', { class: 'cv-hint' }, 'Top of the list is in front. Drag ⋮⋮ to reorder.')),
        layers().length ? null : h('p', { class: 'cv-hint' }, 'No layers yet — use the buttons above the board.'),
        h('ul', { class: 'cv-layers' }, list.map((l) => {
          const row = h('li', {
            class: `cv-layer-row${selectedIds.has(l.id) ? ' selected' : ''}${l.hidden ? ' is-hidden' : ''}`,
            'data-id': l.id,
            onclick: (e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(l.id); else selectOnly(l.id);
            },
          });
          const handle = h('span', { class: 'cv-drag', title: 'Drag to reorder' }, '⋮⋮');
          handle.draggable = true;
          handle.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', l.id);
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('is-dragging');
          });
          handle.addEventListener('dragend', () => row.classList.remove('is-dragging'));
          row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('is-drop');
          });
          row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
          row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('is-drop');
            reorderFront(e.dataTransfer.getData('text/plain'), l.id);
          });
          row.append(
            handle,
            h('span', { class: 'cv-layer-icon' }, ICONS[l.type] || '•'),
          h('span', { class: 'cv-layer-name', title: l.name }, l.name || M.layerTypeLabel(l.type)),
          h('span', { class: 'cv-layer-tools' },
            h('button', { class: 'icon-btn', type: 'button', title: 'Move forward', onclick: (e) => { e.stopPropagation(); bringForward(l.id); } }, '↑'),
            h('button', { class: 'icon-btn', type: 'button', title: 'Move backward', onclick: (e) => { e.stopPropagation(); sendBackward(l.id); } }, '↓'),
            h('button', { class: 'icon-btn', type: 'button', title: l.hidden ? 'Show on the website' : 'Hide from the website', onclick: (e) => { e.stopPropagation(); l.hidden = !l.hidden; onChange(); render(); } }, l.hidden ? '◌' : '●'),
            h('button', { class: 'icon-btn', type: 'button', title: l.locked ? 'Unlock so it can be moved' : 'Lock in place', onclick: (e) => { e.stopPropagation(); l.locked = !l.locked; onChange(); render(); } }, l.locked ? '🔒' : '🔓'),
            h('button', { class: 'icon-btn', type: 'button', title: 'Duplicate this layer', onclick: (e) => { e.stopPropagation(); duplicateLayer(l.id); } }, '⧉'),
            h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete this layer', onclick: (e) => { e.stopPropagation(); removeLayer(l.id); } }, '✕')));
          return row;
        })));
    }

    function popupMenu(label, items) {
      const wrap = h('div', { class: 'cv-pop' });
      const btn = h('button', { class: 'btn small', type: 'button' }, label);
      const menu = h('div', { class: 'cv-pop-menu', hidden: true });
      items.filter(Boolean).forEach((item) => {
        const choice = h('button', {
          class: `cv-pop-item${item.danger ? ' danger' : ''}${item.on ? ' is-on' : ''}`,
          type: 'button',
        }, item.label);
        choice.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.hidden = true;
          item.run();
        });
        menu.append(choice);
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        document.querySelectorAll('.cv-pop-menu').forEach((node) => { node.hidden = true; });
        if (!willOpen) return;
        const rect = btn.getBoundingClientRect();
        menu.hidden = false;
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;
      });
      if (!window.__cvPopCloser) {
        window.__cvPopCloser = true;
        document.addEventListener('click', () => {
          document.querySelectorAll('.cv-pop-menu').forEach((node) => { node.hidden = true; });
        });
      }
      wrap.append(btn, menu);
      return wrap;
    }

    function layerMenu(ids, extra) {
      return popupMenu('Layer', [
        { label: 'Bring to front', run: () => { ids.forEach((id) => setZ(id, 'front')); } },
        { label: 'Send to back', run: () => { ids.forEach((id) => setZ(id, 'back')); } },
        { label: 'Forward', run: () => { ids.forEach((id) => bringForward(id)); } },
        { label: 'Backward', run: () => { ids.forEach((id) => sendBackward(id)); } },
        ...(extra || []),
      ]);
    }

    // Alignment acts on the selection. With several layers selected the arrows
    // line them up to each other; with one, they line it up on the board.
    function alignPanel(count) {
      const box = h('div', { class: 'cv-align' });
      const add = (edge, label, title, withOthers) => {
        const btn = h('button', { class: 'cv-align-btn', type: 'button', title, onclick: () => runAlign(edge, withOthers) }, label);
        box.append(btn);
        return btn;
      };
      const rows = [];
      if (count > 1) {
        // `true` is what makes these line the layers up with each other rather
        // than with the board; without it every button did the same thing.
        rows.push(h('p', { class: 'cv-hint' }, 'Lining up the selected layers with each other.'));
        rows.push(h('div', { class: 'cv-align-row' },
          add('left', '⇤', 'Line up their left edges', true),
          add('hcenter', '⇹', 'Line up their centres', true),
          add('right', '⇥', 'Line up their right edges', true),
          add('top', '⤒', 'Line up their top edges', true),
          add('vcenter', '⇳', 'Line up their middles', true),
          add('bottom', '⤓', 'Line up their bottom edges', true)));
        if (count > 2) {
          rows.push(h('div', { class: 'cv-align-row' },
            h('button', { class: 'btn small', type: 'button', onclick: () => runAlign('distribute-x') }, 'Space evenly across'),
            h('button', { class: 'btn small', type: 'button', onclick: () => runAlign('distribute-y') }, 'Space evenly down')));
        }
        const boxed = alignBox(selectedLayers());
        rows.push(h('p', { class: 'cv-hint' }, `Selection: ${boxed.w} × ${boxed.h} px, at ${boxed.x}, ${boxed.y}.`));
      } else {
        rows.push(h('p', { class: 'cv-hint' }, 'Lining the layer up on the board. Select more layers with Shift-click to line them up with each other.'));
      }
      const boardRow = h('div', { class: 'cv-align-row' },
        add('left', '⇤', 'Line up on the left edge of the board', false),
        add('hcenter', '⇹', 'Centre on the board', false),
        add('right', '⇥', 'Line up on the right edge of the board', false),
        add('top', '⤒', 'Line up on the top of the board', false),
        add('vcenter', '⇳', 'Centre vertically on the board', false),
        add('bottom', '⤓', 'Line up on the bottom of the board', false));
      rows.push(count > 1 ? h('p', { class: 'cv-hint' }, 'Lining up on the board:') : null);
      rows.push(boardRow);
      return h('div', { class: 'cv-group' }, h('h4', null, 'Align'), ...rows.filter(Boolean));
    }

    function paintInspector() {
      const scrollTop = paneRight.scrollTop;
      const finish = () => { paneRight.scrollTop = scrollTop; };
      const l = primary();
      const boardSettings = [
        field('Board height', (() => {
          const input = h('input', { type: 'number', value: boardHeight(), min: 200, max: 4000, step: 10 });
          const apply = (value) => {
            section.canvasHeight = clamp(roundToStep(value, 10), 200, 4000);
            input.value = String(section.canvasHeight);
            onChange();
            paintBoard();
          };
          input.addEventListener('change', () => { record(); apply(Number(input.value) || M.CANVAS_H); });
          bindWheel(input, (dir) => { beginGesture(); apply(boardHeight() + dir * 10); });
          return input;
        })()),
        colorField(section, 'canvasBg', 'Board background'),
        imageField(section, 'canvasImage', 'Background image'),
        field('Board width', (() => {
          const input = h('input', { type: 'number', value: boardWidth(), min: WIDTH_MIN, max: WIDTH_MAX, step: 10 });
          const apply = (value) => {
            section.canvasWidth = clamp(roundToStep(value, 10), WIDTH_MIN, WIDTH_MAX);
            input.value = String(section.canvasWidth);
            onChange();
            paintBoard();
          };
          input.addEventListener('change', () => { record(); apply(Number(input.value) || M.CANVAS_W); });
          bindWheel(input, (dir) => { beginGesture(); apply(boardWidth() + dir * 10); });
          return input;
        })()),
        h('p', { class: 'cv-hint' }, 'Drag the left or right edge of the board to change the page width. Height stays in the number above. On the website the board scales down to fit the screen.'),
      ];

      if (!l) {
        paneRight.replaceChildren(
          h('div', { class: 'cv-pane-head' }, h('strong', null, 'Layout settings')),
          h('div', { class: 'cv-group' }, h('h4', null, 'Board'), ...boardSettings),
          h('p', { class: 'cv-hint' }, 'Select a layer on the board or in the list to edit its text, colours and animation.'));
        finish();
        return;
      }

      const count = selectedIds.size;
      const groups = [h('div', { class: 'cv-pane-head' },
        h('strong', null, count > 1 ? `${count} layers selected` : M.layerTypeLabel(l.type)),
        h('span', { class: 'cv-hint' }, count > 1 ? '' : `${round(l.w)}×${round(boxHeight(l))}`))];

      if (count > 1) {
        groups.push(h('div', { class: 'cv-group' }, h('h4', null, 'Selection'), layerMenu([...selectedIds])));
        groups.push(alignPanel(count));
        groups.push(h('div', { class: 'cv-group' }, h('h4', null, 'Board'), ...boardSettings));
        paneRight.replaceChildren(...groups);
        finish();
        return;
      }

      const pos = h('div', { class: 'cv-group' },
        h('h4', null, 'Position and size'),
        textField(l, 'name', 'Layer name (only you see this)'),
        h('div', { class: 'cv-grid2' },
          numField(l, 'x', 'X', -4000, 6000),
          numField(l, 'y', 'Y', -2000, 4000),
          numField(l, 'w', 'Width', 20, 6000),
          naturalGallery(l)
            ? field('Height', h('input', {
              type: 'number',
              value: round(boxHeight(l)),
              disabled: true,
              'data-locked-height': '1',
              title: 'Locked to the original image shape',
            }))
            : numField(l, 'h', 'Height', 2, 4000),
          numField(l, 'rotate', 'Rotation (°)', -360, 360, 1, 0)),
        h('p', { class: 'cv-hint' }, 'Drag the round handle above the layer to rotate it. Hold Shift to snap every 15°.'),
        isTextual(l) ? toggleField(l, 'hugging', 'Height follows the text') : null,
        isTextual(l) ? h('p', { class: 'cv-hint' }, 'Drag a corner to scale the text. Drag an edge to change the box without changing the type size.') : null,
        h('div', { class: 'cv-btnrow' },
          isTextual(l) ? h('button', { class: 'btn small', type: 'button', title: 'Shrink the box to fit the text', onclick: () => {
            record();
            const el = elFor(l.id);
            const box = el && el.querySelector('.cv-layer-box');
            if (box) {
              const prev = box.style.cssText;
              box.style.width = 'max-content';
              box.style.height = 'auto';
              const measuredW = Math.min(Math.max(box.scrollWidth + 4, 20), 6000);
              const measuredH = Math.max(box.scrollHeight + 4, 20);
              box.style.cssText = prev;
              l.w = measuredW;
              l.h = measuredH;
            }
            onChange(); render();
          } }, 'Auto-fit size') : null,
          isTextual(l) ? popupMenu('Align', [
            { label: 'Left', on: l.align === 'left', run: () => { record(); l.align = 'left'; onChange(); render(); } },
            { label: 'Centre', on: l.align === 'center', run: () => { record(); l.align = 'center'; onChange(); render(); } },
            { label: 'Right', on: l.align === 'right', run: () => { record(); l.align = 'right'; onChange(); render(); } },
          ]) : null,
          layerMenu([l.id], [
            { label: 'Duplicate layer', run: () => duplicateLayer(l.id) },
            { label: 'Delete layer', danger: true, run: () => removeLayer(l.id) },
          ])));
      groups.push(pos);
      groups.push(alignPanel(1));

      const content = [];
      if (isTextual(l)) content.push(areaField(l, 'text', 'Text', l.type === 'heading' ? 2 : 5), h('p', { class: 'cv-hint' }, 'Enter makes a new line; a blank line starts a new paragraph.'));
      if (l.type === 'button') {
        content.push(
          textField(l, 'text', 'Button label'),
          textField(l, 'link', 'Link', '/portfolio or https://…'),
          selectField(l, 'buttonStyle', 'Button look', [['pill', 'Rounded pill'], ['solid', 'Rectangle'], ['outline', 'Outline']]),
          toggleField(l, 'newTab', 'Open in a new tab'));
      }
      if (l.type === 'image') {
        content.push(
          imageField(l, 'src', 'Image'),
          textField(l, 'alt', 'Description for screen readers'),
          textField(l, 'subtitle', 'Subtitle under the image'),
          selectField(l, 'fit', 'How the image fills its box', M.FITS),
          numField(l, 'radius', 'Rounded corners', 0, 200));
      }
      if (l.type === 'gallery') {
        content.push(h('div', { class: 'cv-grid2' },
          selectField(l, 'columns', 'Columns', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], true),
          selectField(l, 'aspect', 'Image shape', [['natural', 'Original shape'], ['square', 'Square'], ['4:3', '4:3'], ['16:9', '16:9'], ['4:5', '4:5'], ['3:4', '3:4']]),
          naturalGallery(l) ? null : selectField(l, 'fit', 'How images fill each cell', M.FITS),
          numField(l, 'gap', 'Gap between images', 0, 120)));
        if (naturalGallery(l)) {
          content.push(h('p', { class: 'cv-hint' }, 'Original shape locks every image to its own proportions. The height of the group follows the pictures, so they are not cropped.'));
        }
        content.push(galleryField(l));
        content.push((() => {
          const box = h('input', { type: 'checkbox', checked: Boolean(l.freeform) });
          box.addEventListener('change', () => {
            record();
            l.freeform = box.checked;
            if (l.freeform) layoutFreeform(l);
            onChange();
            render();
          });
          return h('label', { class: 'cv-check' }, box, 'Freeform layout');
        })());
        content.push(h('p', { class: 'cv-hint' }, 'Freeform lets you drag each image inside the group, and drag its corner to resize it. Turning it on starts from the current grid.'));
        content.push(h('button', {
          class: 'btn small', type: 'button',
          onclick: () => separateGallery(l),
        }, 'Separate into images'));
      }
      if (l.type === 'shape') {
        const shapeSel = h('select', null, [
          ['rect', 'Rectangle'],
          ['circle', 'Circle'],
          ['triangle', 'Triangle'],
          ['star', 'Star'],
          ['custom', 'Custom'],
        ].map(([value, text]) => h('option', { value, selected: shapeKind(l) === value }, text)));
        shapeSel.addEventListener('change', () => {
          record();
          l.shape = shapeSel.value;
          if (l.shape === 'custom' && !parseShapePoints(l.shapePoints)) {
            l.shapePoints = formatShapePoints(DEFAULT_CUSTOM);
          }
          onChange();
          render();
        });
        content.push(field('Shape', shapeSel));
        content.push(h('p', { class: 'cv-hint' }, (shapeKind(l) === 'rect'
          ? 'A rectangle. Rounded corners are under Style. '
          : shapeKind(l) === 'star'
            ? 'Corners, inner radius and rounded corners are under Style. '
            : shapeKind(l) === 'custom'
              ? 'Drag the points on the canvas. Drag a mark on an edge to add a point, and double-click a point to remove it. '
              : 'The shape stretches to fill its box. Fill and border are under Style. ') + 'Hold Shift while resizing to make it a square.'));
      }
      if (content.length) groups.push(h('div', { class: 'cv-group' }, h('h4', null, 'Content'), ...content));

      const style = [];
      if (isTextual(l) || l.type === 'button') {
        style.push(
          fontField(l),
          h('div', { class: 'cv-grid2' },
            numField(l, 'size', 'Text size', 8, 200),
            numField(l, 'weight', 'Weight (400 normal, 700 bold)', 100, 900, 100),
            numField(l, 'lineHeight', 'Line spacing', 0.8, 3, 0.05),
            numField(l, 'letterSpacing', 'Letter spacing', -10, 40, 0.5)),
          selectField(l, 'align', 'Text alignment', [['left', 'Left'], ['center', 'Centred'], ['right', 'Right']]),
          colorField(l, 'color', 'Text colour'),
          toggleField(l, 'textShadow', 'Shadow behind the text'));
      }
      if (l.type !== 'image') style.push(colorField(l, 'bg', l.type === 'divider' ? 'Line colour' : (clippedShape(l) ? 'Fill colour' : 'Background colour')));
      if (l.type === 'shape' && shapeKind(l) === 'star') {
        style.push(h('div', { class: 'cv-grid2' },
          numField(l, 'starCount', 'Corners', 3, 16, 1, 5),
          numField(l, 'starInner', 'Inner radius', 8, 90, 1, 41),
          numField(l, 'radius', 'Rounded corners', 0, 300)));
        style.push(h('p', { class: 'cv-hint' }, 'Corners sets how many tips the star has. A lower inner radius makes it sharper. Rounded corners soften every tip and valley. Scroll a number to nudge it.'));
      }
      if (clippedShape(l)) style.push(numField(l, 'borderWidth', 'Border width', 0, 40));
      else if (l.type !== 'divider' && l.type !== 'gallery') style.push(h('div', { class: 'cv-grid2' },
        numField(l, 'radius', 'Rounded corners', 0, 300),
        numField(l, 'borderWidth', 'Border width', 0, 40)));
      if (l.type !== 'text' && l.type !== 'heading') style.push(colorField(l, 'borderColor', 'Border colour'));
      if (l.type === 'shape') {
        style.push(toggleField(l, 'radiusLock', 'Lock radius'));
        style.push(h('p', { class: 'cv-hint' }, 'Lock radius keeps the corner roundness in proportion while you drag a resize handle.'));
      }
      groups.push(h('div', { class: 'cv-group' }, h('h4', null, 'Style'), ...style.filter(Boolean)));

      groups.push(h('div', { class: 'cv-group' },
        h('h4', null, 'Animation'),
        selectField(l, 'anim', 'Effect', M.ANIMATIONS),
        h('div', { class: 'cv-grid2' },
          numField(l, 'delay', 'Delay (seconds)', 0, 5, 0.1),
          numField(l, 'duration', 'Duration (seconds)', 0.1, 5, 0.1)),
        toggleField(l, 'animated', 'Play when the visitor scrolls to it'),
        h('p', { class: 'cv-hint' }, l.anim === 'float' || l.anim === 'pulse' ? 'This effect loops forever.' : 'This effect plays once, when the section scrolls into view.')));

      groups.push(h('div', { class: 'cv-group cv-group-muted' }, h('h4', null, 'Board'), ...boardSettings));

      paneRight.replaceChildren(...groups);
      finish();
    }

    function render() {
      paintToolbar();
      paintBoard();
      paintList();
      paintInspector();
    }

    // -------------------------------------------------------------- dragging

    function onPointerDown(e) {
      if (e.button !== 0) return;
      const layerEl = e.target.closest('.cv-layer');
      if (!layerEl) {
        if (e.target.closest('.cv-board') || e.target.closest('.cv-stage')) selectOnly(null);
        return;
      }
      const layer = byId(layerEl.dataset.id);
      if (!layer) return;

      const handle = e.target.closest('.cv-resize');
      const rotateHandle = e.target.closest('.cv-rotate');
      const pointHandle = e.target.closest('.cv-shape-point');
      const edgeHandle = e.target.closest('.cv-shape-edge');
      // Shift on a resize handle squares the shape, so it must not also toggle
      // the selection off before the drag starts.
      const additive = e.ctrlKey || e.metaKey || (e.shiftKey && !handle && !rotateHandle);
      if (additive) toggleSelect(layer.id);
      else if (!selectedIds.has(layer.id)) selectOnly(layer.id);

      if (layer.locked) return;
      const freeResize = e.target.closest('.cv-free-resize');
      const freeItem = freeResize ? null : e.target.closest('.cv-free-item');
      if ((freeResize || freeItem) && layer.type === 'gallery' && layer.freeform) {
        const index = Number((freeResize || freeItem).dataset.free);
        const item = (layer.images || [])[index];
        if (item) {
          if (!selectedIds.has(layer.id)) selectOnly(layer.id);
          beginGesture();
          const live = elFor(layer.id);
          dragging = {
            lead: layer,
            el: live,
            mode: freeResize ? 'free-resize' : 'free',
            freeIndex: index,
            dir: null,
            startX: e.clientX,
            startY: e.clientY,
            startAngle: 0,
            origin: {
              x: Number(item.x) || 0,
              y: Number(item.y) || 0,
              w: Number(item.w) || 80,
              h: Number(item.h) || 80,
            },
            items: [],
          };
          live?.classList.add('dragging');
          e.preventDefault();
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          return;
        }
      }
      // Selection repainted the board, so look the element up again before
      // keeping a reference to it.
      const el = elFor(layer.id);
      if (!el) return;
      // One undo step per drag: the snapshot is taken here, before the pointer
      // starts moving, and the gesture is closed in onPointerUp.
      beginGesture();
      let mode = rotateHandle ? 'rotate' : handle ? 'resize' : 'move';
      let pointIndex = null;
      const corner = ['nw', 'ne', 'se', 'sw'].includes(handle?.dataset.resize);
      // A corner drag scales the text, so the box height has to be a real
      // number first. While height follows the words, read it off the board.
      if (mode === 'resize' && corner && isTextual(layer) && layer.hugging) {
        const measured = el.offsetHeight;
        if (measured > 2) layer.h = measured;
      }
      const editingPoints = !additive && !rotateHandle && shapeKind(layer) === 'custom' && (pointHandle || edgeHandle);
      if (editingPoints && edgeHandle) {
        const pts = customPoints(layer).map((p) => p.slice());
        if (pts.length < 24) {
          const i = Number(edgeHandle.dataset.edge);
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          pts.splice(i + 1, 0, [
            Math.round(((a[0] + b[0]) / 2) * 10) / 10,
            Math.round(((a[1] + b[1]) / 2) * 10) / 10,
          ]);
          layer.shapePoints = formatShapePoints(pts);
          pointIndex = i + 1;
          mode = 'point';
        }
      } else if (editingPoints && pointHandle) {
        mode = 'point';
        pointIndex = Number(pointHandle.dataset.point);
      }
      dragging = {
        lead: layer,
        el,
        mode,
        dir: handle?.dataset.resize || null,
        pointIndex,
        startX: e.clientX,
        startY: e.clientY,
        startAngle: 0,
        // Every selected layer remembers where it began, so the whole group
        // moves together and the pointer can be dragged back to the start.
        items: selectedLayers().map((l) => ({
          l, x: l.x, y: l.y, w: l.w, h: l.h,
          size: Number(l.size) || 0,
          rotate: Number(l.rotate) || 0,
          radius: Number(l.radius) || 0,
        })),
      };
      if (mode === 'rotate') {
        const boardRect = board.getBoundingClientRect();
        const s0 = scale();
        const px = (e.clientX - boardRect.left) / s0;
        const py = (e.clientY - boardRect.top) / s0;
        const cx = layer.x + layer.w / 2;
        const cy = layer.y + (Number(layer.h) || 0) / 2;
        dragging.startAngle = Math.atan2(px - cx, -(py - cy)) * 180 / Math.PI;
      }
      el.classList.add('dragging');
      e.preventDefault();
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      if (mode === 'point') paintBoard();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const s = scale();
      const rawDx = (e.clientX - dragging.startX) / s;
      const rawDy = (e.clientY - dragging.startY) / s;
      const snap = e.shiftKey;
      const lead = dragging.items.find((item) => item.l === dragging.lead) || dragging.items[0];

      if (dragging.mode === 'free' || dragging.mode === 'free-resize') {
        const item = (dragging.lead.images || [])[dragging.freeIndex];
        if (item) {
          const dx = (e.clientX - dragging.startX) / s;
          const dy = (e.clientY - dragging.startY) / s;
          if (dragging.mode === 'free') {
            item.x = Math.round(dragging.origin.x + dx);
            item.y = Math.round(dragging.origin.y + dy);
          } else {
            item.w = Math.max(20, Math.round(dragging.origin.w + dx));
            item.h = Math.max(20, Math.round(dragging.origin.h + dy));
          }
          const node = dragging.el?.querySelector(`.cv-free-item[data-free="${dragging.freeIndex}"]`);
          if (node) {
            node.style.left = `${item.x}px`;
            node.style.top = `${item.y}px`;
            node.style.width = `${item.w}px`;
            node.style.height = `${item.h}px`;
          }
        }
        onChange();
        return;
      }

      if (dragging.mode === 'point') {
        const l = dragging.lead;
        let x;
        let y;
        if (Number(l.rotate)) {
          const boardRect = board.getBoundingClientRect();
          const local = boardToLocal(l, (e.clientX - boardRect.left) / s, (e.clientY - boardRect.top) / s);
          x = clamp(l.w ? (local.x / l.w) * 100 : 0, 0, 100);
          y = clamp(l.h ? (local.y / l.h) * 100 : 0, 0, 100);
        } else {
          const rect = dragging.el.getBoundingClientRect();
          x = clamp(rect.width ? ((e.clientX - rect.left) / rect.width) * 100 : 0, 0, 100);
          y = clamp(rect.height ? ((e.clientY - rect.top) / rect.height) * 100 : 0, 0, 100);
        }
        const pts = customPoints(l).map((p) => p.slice());
        if (pts[dragging.pointIndex]) {
          pts[dragging.pointIndex] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
          l.shapePoints = formatShapePoints(pts);
        }
        paintBoard();
        onChange();
        return;
      }

      if (dragging.mode === 'rotate') {
        const boardRect = board.getBoundingClientRect();
        const px = (e.clientX - boardRect.left) / s;
        const py = (e.clientY - boardRect.top) / s;
        const cx = lead.x + lead.w / 2;
        const cy = lead.y + lead.h / 2;
        const angle = Math.atan2(px - cx, -(py - cy)) * 180 / Math.PI;
        let delta = angle - dragging.startAngle;
        if (snap) delta = Math.round((lead.rotate + delta) / 15) * 15 - lead.rotate;
        dragging.items.forEach((item) => {
          item.l.rotate = normDeg((item.rotate || 0) + delta);
        });
        paintBoard();
        paintInspector();
        onChange();
        return;
      }

      if (dragging.mode === 'resize') {
        const l = dragging.lead;
        const dir = dragging.dir;
        // rawDx/rawDy are already board pixels (they were divided by the zoom
        // factor above). Dividing again here would make the box jump by
        // 1/zoom² per pixel, which is what made resizing feel broken.
        const local = localDelta(rawDx, rawDy, lead.rotate);
        let w = lead.w;
        let h = lead.h;
        if (dir.includes('e')) w = lead.w + local.x;
        if (dir.includes('w')) w = lead.w - local.x;
        if (dir.includes('s')) h = lead.h + local.y;
        if (dir.includes('n')) h = lead.h - local.y;
        const corner = dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw';
        if (naturalGallery(l)) {
          // Width can change. Height stays locked to the pictures' own shape,
          // so a drag cannot crop them back into the layer box.
          if (dir === 'n' || dir === 's') return;
          if (snap) w = round(w / M.GRID) * M.GRID;
          w = clamp(round(w), 20, 6000);
          placeFromAnchor(l, lead, dir, w, lead.h);
        } else if (e.shiftKey && l.type === 'shape') {
          // Shift locks every shape to a square. Side handles follow the axis
          // being dragged; corners follow whichever axis moved further.
          let size;
          if (dir === 'e' || dir === 'w') size = w;
          else if (dir === 'n' || dir === 's') size = h;
          else size = Math.abs(w - lead.w) >= Math.abs(h - lead.h) ? w : h;
          size = clamp(round(size), 20, 4000);
          placeFromAnchor(l, lead, dir, size, size);
        } else if (corner && isTextual(l)) {
          // A corner scales the words with the box. Edges still change only
          // the box, so a line can reflow without the type size changing.
          const sx = w / Math.max(lead.w, 1);
          const sy = h / Math.max(lead.h, 1);
          let scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
          const base = lead.size || (l.type === 'heading' ? 46 : 18);
          if (!(scale > 0)) scale = 1;
          scale = clamp(scale, Math.max(20 / lead.w, 20 / Math.max(lead.h, 1), 8 / base), Math.min(6000 / lead.w, 4000 / Math.max(lead.h, 1), 300 / base));
          l.hugging = false;
          l.size = clamp(round(base * scale), 8, 300);
          placeFromAnchor(l, lead, dir, clamp(round(lead.w * scale), 20, 6000), clamp(round(lead.h * scale), 20, 4000));
        } else {
          if (snap) { w = round(w / M.GRID) * M.GRID; h = round(h / M.GRID) * M.GRID; }
          w = clamp(round(w), 20, 6000);
          h = clamp(round(h), 2, 4000);
          placeFromAnchor(l, lead, dir, w, h);
        }
        if (l.type === 'shape' && l.radiusLock) {
          const sx = l.w / Math.max(lead.w, 1);
          const sy = (Number(l.h) || 0) / Math.max(lead.h, 1);
          l.radius = clamp(Math.round((Number(lead.radius) || 0) * Math.min(sx, sy)), 0, 500);
        }
      } else {
        // Move the lead layer to where the pointer is, let it snap to guides,
        // then move everything else by the same corrected amount.
        const others = layers().filter((o) => !selectedIds.has(o.id) && !o.hidden);
        let dx = snap ? round(rawDx / M.GRID) * M.GRID : rawDx;
        let dy = snap ? round(rawDy / M.GRID) * M.GRID : rawDy;
        let nx = round(lead.x + dx);
        let ny = round(lead.y + dy);
        if (!snap) {
          const leadH = naturalGallery(dragging.lead) ? boxHeight(dragging.lead) : lead.h;
          const guide = showGuides({ x: nx, y: ny, w: lead.w, h: leadH }, others.map((o) => ({ x: o.x, y: o.y, w: o.w, h: boxHeight(o) })));
          if (guide.x != null) {
            if (Math.abs(guide.x - nx) <= 4) nx = guide.x;
            else if (Math.abs(guide.x - (nx + lead.w)) <= 4) nx = guide.x - lead.w;
            else if (Math.abs(guide.x - (nx + lead.w / 2)) <= 4) nx = Math.round(guide.x - lead.w / 2);
          }
          if (guide.y != null) {
            if (Math.abs(guide.y - ny) <= 4) ny = guide.y;
            else if (Math.abs(guide.y - (ny + leadH)) <= 4) ny = guide.y - leadH;
            else if (Math.abs(guide.y - (ny + leadH / 2)) <= 4) ny = Math.round(guide.y - leadH / 2);
          }
        } else {
          hideGuides();
        }
        dx = nx - lead.x;
        dy = ny - lead.y;
        dragging.items.forEach((item) => {
          item.l.x = round(item.x + dx);
          item.l.y = round(item.y + dy);
        });
      }
      paintBoard();
      if (dragging.mode === 'resize' || dragging.mode === 'rotate') paintInspector();
      onChange();
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging.el?.classList.remove('dragging');
      dragging = null;
      hideGuides();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      endGesture();
      paintBoard();
      paintList();
      paintInspector();
      onChange();
      paintToolbar();
    }

    function onKeyDown(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+Z and Ctrl+Y are handled for the whole admin, so a canvas edit and
      // a text edit share one undo stack.
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllLayers(); return; }
      if (mod && e.key.toLowerCase() === 'd') {
        const l = primary();
        if (l) { e.preventDefault(); duplicateLayer(l.id); }
        return;
      }
      if (e.key === 'Escape') { selectOnly(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const l = primary();
        if (!l) return;
        e.preventDefault();
        removeLayer(l.id);
        return;
      }
      const step = e.shiftKey ? M.GRID : M.SNAP;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[e.key];
      if (!move) return;
      const targets = selectedLayers().filter((l) => !l.locked);
      if (!targets.length) return;
      e.preventDefault();
      beginTyping();
      targets.forEach((l) => {
        l.x = round(l.x + move[0]);
        l.y = round(l.y + move[1]);
      });
      onChange();
      paintBoard();
      paintInspector();
    }

    // Ctrl + wheel zooms; a plain wheel scrolls the panel as usual. Holding
    // Shift while scrolling moves sideways, which is how a zoomed-in board is
    // panned without a horizontal scrollbar gesture.
    viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        fixedScale = clamp(scale() * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.1, 4);
        paintBoard();
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(paintToolbar, 120);
        return;
      }
      // Shift + wheel pans sideways.
      if (e.shiftKey && e.deltaY) {
        e.preventDefault();
        viewport.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Middle-button drag, or space-held left drag, pans the board.
    let panning = null;
    let spaceDown = false;
    function startPan(e) {
      panning = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.classList.add('is-panning');
      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', endPan);
    }
    function onPanMove(e) {
      if (!panning) return;
      viewport.scrollLeft = panning.left - (e.clientX - panning.x);
      viewport.scrollTop = panning.top - (e.clientY - panning.y);
    }
    function endPan() {
      panning = null;
      viewport.classList.remove('is-panning');
      window.removeEventListener('pointermove', onPanMove);
      window.removeEventListener('pointerup', endPan);
    }
    viewport.addEventListener('pointerdown', (e) => {
      // Space + drag, or the middle mouse button, pans. Left drag still selects.
      if (spaceDown || e.button === 1) {
        e.preventDefault();
        startPan(e);
      }
    });
    // Stop the middle-click autoscroll widget from appearing.
    viewport.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

    root.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        spaceDown = true;
        e.preventDefault();
      }
    });
    root.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
    window.addEventListener('blur', () => { spaceDown = false; });

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('dblclick', (e) => {
      const handle = e.target.closest('.cv-shape-point');
      if (!handle) return;
      const layer = byId(handle.closest('.cv-layer')?.dataset.id);
      if (!layer || layer.locked || shapeKind(layer) !== 'custom') return;
      const pts = customPoints(layer).map((p) => p.slice());
      if (pts.length <= 3) return;
      if (dragging) {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        dragging.el?.classList.remove('dragging');
        dragging = null;
      }
      if (!gestureOpen) record();
      pts.splice(Number(handle.dataset.point), 1);
      layer.shapePoints = formatShapePoints(pts);
      onChange();
      paintBoard();
      endGesture();
    });
    root.addEventListener('keydown', onKeyDown);

    // Fit the board to the panel when the panel is narrow, and follow it while
    // the window is resized. The viewport scrolls once the board is wider than
    // the panel, which changes its own width — so only repaint when the fitted
    // scale actually moved, otherwise the two would keep triggering each other.
    let lastFit = null;
    const resizeObserver = new ResizeObserver(() => {
      if (fixedScale != null) return;
      const next = fitScale();
      if (lastFit != null && Math.abs(next - lastFit) < 0.001) return;
      lastFit = next;
      paintBoard();
      paintToolbar();
    });

    // The state the panel opened with is the first history entry, so the first
    // undo always returns to what was there before editing began — including
    // undoing the very first change, not just changes after it.
    record();

    render();
    resizeObserver.observe(viewport);

    return {
      element: root,
      render,
      selectLayer: (id) => selectOnly(id),
      isGesturing: () => gestureOpen,
      destroy: () => {
        resizeObserver.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointermove', onPanMove);
        window.removeEventListener('pointerup', endPan);
        clearTimeout(zoomTimer);
        // Undo history belongs to this mounted editor only.
        clearTimeout(typingTimer);
        history = [];
        historyAt = -1;
        gestureOpen = false;
      },
    };
  }

  return { createLayoutEditor, h, drawLayer, layerStyle, safeUrl };
})();
