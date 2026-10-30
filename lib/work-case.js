'use strict';

// Public shape of a work popup. The wall cover and the right column share one
// order: the piece marked as the main visual is first, then the rest in the
// order they were arranged. Empty left-column fields are left out.

function youtubeId(value) {
  const v = String(value || '').trim();
  const fromUrl = v.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  if (fromUrl) return fromUrl[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  return '';
}

function safeUrl(url) {
  const v = String(url ?? '').trim();
  if (!v || /^(javascript|data|vbscript):/i.test(v)) return '';
  return v;
}

function pieceKind(piece) {
  if (piece && (piece.kind === 'youtube' || piece.kind === 'pdf')) return piece.kind;
  return 'image';
}

function readyPiece(piece) {
  if (!piece || typeof piece !== 'object') return null;
  const kind = pieceKind(piece);
  const src = safeUrl(piece.src);
  if (!src) return null;
  if (kind === 'youtube') {
    const id = youtubeId(src);
    if (!id) return null;
    return { kind, src, youtubeId: id, hero: piece.hero === true };
  }
  return { kind, src, hero: piece.hero === true };
}

function orderedPieces(card) {
  const stored = card && Array.isArray(card.pieces);
  const raw = stored
    ? card.pieces
    : (card && card.image ? [{ kind: 'image', src: card.image, hero: true }] : []);
  const ready = [];
  raw.forEach((piece) => {
    const next = readyPiece(piece);
    if (next) ready.push(next);
  });
  if (!ready.length) return [];
  let heroIndex = ready.findIndex((piece) => piece.hero);
  if (heroIndex < 0) heroIndex = 0;
  const hero = ready[heroIndex];
  return [hero].concat(ready.filter((_, index) => index !== heroIndex));
}

function coverFor(card, pieces) {
  const hero = pieces[0];
  if (!hero) return card && Array.isArray(card.pieces) ? '' : safeUrl(card && card.image);
  if (hero.kind === 'image') return hero.src;
  if (hero.kind === 'youtube' && hero.youtubeId) return `https://i.ytimg.com/vi/${hero.youtubeId}/hqdefault.jpg`;
  return '';
}

function clean(value) {
  return String(value || '').trim();
}

function workCase(card) {
  const source = card && typeof card === 'object' ? card : {};
  const tags = Array.isArray(source.tags)
    ? source.tags.map((tag) => clean(tag)).filter(Boolean)
    : [];
  const sections = [];
  (Array.isArray(source.sections) ? source.sections : []).forEach((section) => {
    if (!section || typeof section !== 'object') return;
    const title = clean(section.title);
    const text = clean(section.text);
    if (!title && !text) return;
    sections.push({ title, text });
  });
  const pieces = orderedPieces(source).map((piece) => {
    const out = { kind: piece.kind, src: piece.src };
    if (piece.youtubeId) out.youtubeId = piece.youtubeId;
    return out;
  });
  return {
    title: clean(source.title) || clean(source.label),
    category: clean(source.category),
    year: clean(source.year),
    role: clean(source.role),
    output: clean(source.output),
    intro: clean(source.intro),
    tags,
    sections,
    pieces,
    cover: coverFor(source, pieces),
  };
}

module.exports = { workCase, orderedPieces, youtubeId };
