'use strict';

// ===========================================================================
// Ready-made layouts for a section's board.
//
// A preset is a whole section object with no ids. When the admin asks for a
// new section the server copies the preset and gives the section and every
// layer a fresh id, so two sections can never end up sharing one.
//
// The field names match admin/canvas-model.js exactly; that file is the editor
// side of the same contract, this one is the server side.
// ===========================================================================

const LAYER_TYPE_LABELS = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  gallery: 'Image group',
  button: 'Button',
  divider: 'Divider line',
  shape: 'Shape',
};

const DEFAULT_BOX = {
  heading: { w: 900, h: 90, size: 46, anim: 'up' },
  text: { w: 560, h: 160, size: 18, weight: 400, anim: 'fade' },
  image: { w: 460, h: 320, radius: 10, anim: 'zoom' },
  gallery: { w: 900, h: 420, anim: 'up' },
  button: { w: 200, h: 54, size: 16, weight: 600, align: 'center', anim: 'up' },
  divider: { w: 420, h: 2, color: '#0A192F', anim: 'fade' },
  shape: { w: 420, h: 220, bg: '#E1E5EB', radius: 12, anim: 'fade', shape: 'rect', shapePoints: '' },
};

function layer(type, patch) {
  const base = {
    type,
    name: LAYER_TYPE_LABELS[type] || 'Layer',
    x: 60,
    y: 60,
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
    aspect: 'square',
    hugging: false,
    buttonStyle: 'pill',
    newTab: true,
  };
  return Object.assign(base, DEFAULT_BOX[type] || {}, patch || {});
}

// Six empty image slots: the board shows placeholders the designer fills in,
// and the live site skips the ones with no image.
function emptyCells(n) {
  return Array.from({ length: n }, () => ({ image: '', caption: '', link: '' }));
}

const PRESETS = [
  {
    id: 'blank-canvas',
    name: 'Blank board',
    description: 'An empty board with a heading and one text box to start from.',
    build: () => ({
      heading: 'New section',
      align: 'left',
      text: '',
      textAfter: '',
      layout: 'canvas',
      canvasHeight: 640,
      canvasBg: '',
      layers: [
        layer('heading', { name: 'Heading', text: 'New section', x: 60, y: 70, w: 900, h: 80 }),
        layer('text', { name: 'Text', text: 'Write something here.', x: 60, y: 170, w: 620, h: 120, hugging: true }),
      ],
      columns: 3,
      aspect: 'square',
      items: [],
      buttons: [],
    }),
  },
  {
    id: 'two-column-about',
    name: 'Two-column about',
    description: 'A large faint word behind the section, a heading, an accent bar and two text columns.',
    build: () => ({
      heading: 'About Me',
      align: 'left',
      text: '',
      textAfter: '',
      layout: 'canvas',
      canvasHeight: 820,
      canvasBg: '#E1E5EB',
      layers: [
        layer('heading', {
          name: 'Faint background word',
          text: 'ABOUT ME',
          x: 60,
          y: 30,
          w: 1305,
          h: 210,
          size: 200,
          align: 'center',
          color: '#F2F4F7',
          letterSpacing: 4,
          anim: 'none',
          animated: false,
        }),
        layer('heading', { name: 'Heading', text: 'About Me', x: 255, y: 230, w: 700, h: 80, size: 54 }),
        layer('divider', { name: 'Accent bar', x: 255, y: 318, w: 230, h: 8, color: '#95B8FE', delay: 0.15 }),
        layer('text', {
          name: 'Left column',
          text: 'Introduce yourself here.',
          x: 255,
          y: 360,
          w: 520,
          h: 220,
          hugging: true,
          size: 17,
          lineHeight: 1.55,
          color: '#4F5E75',
          delay: 0.25,
        }),
        layer('text', {
          name: 'Right column',
          text: 'What you care about, and how you work.',
          x: 833,
          y: 360,
          w: 520,
          h: 220,
          hugging: true,
          size: 17,
          lineHeight: 1.55,
          color: '#4F5E75',
          delay: 0.4,
        }),
      ],
      columns: 3,
      aspect: 'square',
      items: [],
      buttons: [],
    }),
  },
  {
    id: 'feature-banner',
    name: 'Feature banner',
    description: 'One wide image with a heading over it and a button underneath — good for a single hero piece.',
    build: () => ({
      heading: 'Featured work',
      align: 'left',
      text: '',
      textAfter: '',
      layout: 'canvas',
      canvasHeight: 700,
      canvasBg: '#0A192F',
      layers: [
        layer('image', { name: 'Banner image', x: 0, y: 0, w: 1425, h: 700, radius: 0, anim: 'fade' }),
        layer('shape', {
          name: 'Caption panel',
          x: 80,
          y: 420,
          w: 620,
          h: 210,
          bg: 'rgba(10, 25, 47, 0.72)',
          radius: 16,
          anim: 'up',
          delay: 0.25,
        }),
        layer('heading', {
          name: 'Title',
          text: 'Featured work',
          x: 120,
          y: 455,
          w: 545,
          h: 70,
          size: 40,
          color: '#FFFFFF',
          delay: 0.35,
        }),
        layer('button', {
          name: 'Button',
          text: 'See the project',
          link: '',
          x: 120,
          y: 540,
          w: 220,
          h: 54,
          align: 'left',
          bg: '#FF5722',
          buttonStyle: 'pill',
          delay: 0.5,
        }),
      ],
      columns: 3,
      aspect: 'square',
      items: [],
      buttons: [],
    }),
  },
  {
    id: 'heading-and-gallery',
    name: 'Heading + plain gallery',
    description: 'The simple image layout: a heading and a grid of pictures with captions.',
    build: () => ({
      heading: 'New gallery',
      align: 'left',
      text: '',
      textAfter: '',
      layout: 'gallery',
      columns: 3,
      aspect: 'square',
      items: emptyCells(6),
      buttons: [],
    }),
  },
];

function previewSection(section) {
  const src = section && typeof section === 'object' ? section : {};
  return {
    layout: src.layout || 'canvas',
    canvasHeight: Number(src.canvasHeight) || 640,
    canvasBg: typeof src.canvasBg === 'string' ? src.canvasBg.slice(0, 40) : '',
    columns: Number(src.columns) || 3,
    items: Array.isArray(src.items) ? src.items.length : 0,
    heading: typeof src.heading === 'string' ? src.heading.slice(0, 48) : '',
    layers: (Array.isArray(src.layers) ? src.layers : []).slice(0, 16).map((l) => ({
      type: l.type,
      x: Number(l.x) || 0,
      y: Number(l.y) || 0,
      w: Number(l.w) || 40,
      h: Number(l.h) || 20,
      text: String(l.text || '').slice(0, 48),
      color: typeof l.color === 'string' ? l.color.slice(0, 40) : '',
      bg: typeof l.bg === 'string' ? l.bg.slice(0, 40) : '',
      columns: Number(l.columns) || 3,
      images: Array.isArray(l.images) ? Math.min(l.images.length, 8) : 0,
    })),
  };
}

function presetSummaries() {
  return PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    preview: previewSection(p.build()),
  }));
}

function findPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// The home hero and the page header, kept as the starting templates in
// Section layouts. A saved edit with the same id replaces the built-in copy.
function defaultTemplates() {
  const hero = {
    id: 's-default-hero',
    heading: 'Hero',
    align: 'left',
    text: '',
    textAfter: '',
    layout: 'canvas',
    canvasLock: true,
    canvasHeight: 774,
    canvasBg: '#617092',
    canvasImage: '/uploads/0b0535_3503c79805ef4c88a6c371464ba316f1.jpg',
    layers: [
      layer('shape', {
        name: 'Title highlight', x: 347, y: 306, w: 730, h: 42,
        bg: '#95B8FE', radius: 4, shape: 'rect', z: 2, animated: true, anim: 'up', duration: 0.9, delay: 0,
      }),
      layer('heading', {
        name: 'Title', text: 'ILLUSTRATOR WORK', x: 262, y: 281, w: 900, h: 64,
        size: 53, weight: 400, align: 'center', color: '#0A192F', font: 'var(--font-display)',
        lineHeight: 1, z: 3, anim: 'up', duration: 0.9, delay: 0,
      }),
      layer('divider', {
        name: 'Rule', x: 686, y: 384, w: 54, h: 2, color: '#FFFFFF',
        z: 4, animated: true, anim: 'fade', duration: 0.9, delay: 0.1,
      }),
      layer('text', {
        name: 'Subtitle', text: 'A selection of my works using illustrator to create.',
        x: 262, y: 456, w: 900, h: 32, size: 18, weight: 900, align: 'center',
        color: '#FDFDFD', font: 'Arial, Helvetica, sans-serif', lineHeight: 1.1,
        textShadow: true, z: 5, anim: 'up', duration: 0.9, delay: 0.15,
      }),
    ],
    columns: 3,
    aspect: 'square',
    items: [],
    buttons: [],
  };
  const pageTitle = 'PAGE TITLE';
  const barW = Math.min(1100, Math.max(120, Math.round(pageTitle.length * 36 + 16)));
  const barX = Math.round((1425 - barW) / 2);
  const page = {
    id: 's-default-page',
    heading: 'Page header',
    align: 'left',
    text: '',
    textAfter: '',
    layout: 'canvas',
    canvasLock: true,
    canvasHeight: 774,
    canvasBg: '#617092',
    layers: [
      layer('shape', {
        name: 'Title highlight', x: barX, y: 306, w: barW, h: 42,
        bg: '#95B8FE', radius: 4, shape: 'rect', z: 2, animated: true, anim: 'up', duration: 0.9, delay: 0,
      }),
      layer('heading', {
        name: 'Title', text: pageTitle, x: 262, y: 281, w: 900, h: 64,
        size: 53, weight: 400, align: 'center', color: '#0A192F', font: 'var(--font-display)',
        lineHeight: 1, z: 3, anim: 'up', duration: 0.9, delay: 0,
      }),
      layer('divider', {
        name: 'Rule', x: 686, y: 384, w: 54, h: 2, color: '#FFFFFF',
        z: 4, animated: true, anim: 'fade', duration: 0.9, delay: 0.1,
      }),
      layer('text', {
        name: 'Subtitle', text: 'Subtitle',
        x: 262, y: 456, w: 900, h: 80, size: 18, weight: 900, align: 'center',
        color: '#FDFDFD', font: 'Arial, Helvetica, sans-serif', lineHeight: 1.1,
        textShadow: true, z: 5, anim: 'up', duration: 0.9, delay: 0.15,
      }),
    ],
    columns: 3,
    aspect: 'square',
    items: [],
    buttons: [],
  };
  return [
    { id: 'tpl-default-hero', name: 'Hero', kind: 'hero', page: '', savedAt: '', builtin: true, section: hero },
    { id: 'tpl-default-page', name: 'Page settings', kind: 'page', page: '', savedAt: '', builtin: true, section: page },
  ];
}

module.exports = { PRESETS, presetSummaries, findPreset, layer, defaultTemplates };
