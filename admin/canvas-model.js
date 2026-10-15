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
    ['image', 'Image'],
    ['gallery', 'Image group'],
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
    ['', 'Same as the rest of the site'],
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
    if (type === 'image') Object.assign(base, { w: 460, h: 320, radius: 10, anim: 'zoom' });
    if (type === 'gallery') Object.assign(base, { w: 900, h: 420, anim: 'up', images: [] });
    if (type === 'button') Object.assign(base, { text: 'Read more', w: 200, h: 54, size: 16, weight: 600, align: 'center', anim: 'up' });
    if (type === 'divider') Object.assign(base, { w: 420, h: 2, color: '#0A192F', anim: 'fade' });
    if (type === 'shape') Object.assign(base, { w: 420, h: 220, bg: '#E1E5EB', radius: 12, anim: 'fade', shape: 'rect', shapePoints: '' });
    return Object.assign(base, patch || {});
  }

  return {
    LAYER_TYPES, ANIMATIONS, FONTS, FITS, CANVAS_W, CANVAS_H, SNAP, GRID, MAX_TEXT,
    seal, defaultLayer, layerTypeLabel,
  };
})();
