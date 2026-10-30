const fs = require('fs');
const file = 'D:/portfolio/data/content.json';
const content = JSON.parse(fs.readFileSync(file, 'utf8'));

function layersOf(section) {
  return section && Array.isArray(section.layers) ? section.layers : [];
}

function byName(section, name) {
  return layersOf(section).find((layer) => layer && layer.name === name);
}

function alignHighlight(heading, highlight, oldSize) {
  const newSize = heading.size;
  const scale = newSize / oldSize;
  const height = Math.round(0.79 * newSize);
  const center = highlight.x + highlight.w / 2;
  const headingCenter = heading.x + heading.w / 2;
  const centered = heading.align === 'center' || Math.abs(center - headingCenter) < 30;
  const width = Math.max(48, Math.round(highlight.w * scale));
  highlight.h = height;
  highlight.y = Math.round(heading.y + newSize + 14 - height);
  if (centered) {
    highlight.w = width;
    highlight.x = Math.round(center - width / 2);
  } else {
    const outset = heading.x - highlight.x;
    highlight.w = width;
    highlight.x = Math.round(heading.x - outset);
  }
}

function fixHero(hero) {
  const name = byName(hero, 'Name');
  const tagline = byName(hero, 'Tagline');
  const big = byName(hero, 'Big word');
  if (tagline) {
    tagline.text = String(tagline.text || '').replace('Designer&', 'Designer &');
    if (name) tagline.x = Math.round(name.x + name.w - tagline.w);
    tagline.h = 56;
    tagline.lineHeight = 1.35;
  }
  if (big) {
    const canvasH = Number(hero.canvasHeight) || 983;
    big.x = 32;
    big.lineHeight = 1.15;
    big.h = Math.round(big.size * big.lineHeight);
    big.y = canvasH - 24 - big.h;
  }
}

function fixAbout(section) {
  const ghost = byName(section, 'Ghost word (top)');
  if (ghost) {
    ghost.size = 96;
    ghost.y = 24;
    ghost.h = 112;
    ghost.lineHeight = 1;
  }
  const intro = byName(section, 'Intro paragraph');
  const second = byName(section, 'Second paragraph');
  if (second) {
    if (intro) second.y = intro.y;
    second.size = 16;
    second.lineHeight = 1.55;
  }
}

function fixWorks(section) {
  const heading = byName(section, 'Heading');
  const highlight = byName(section, 'Heading highlight');
  if (heading && heading.size !== 48) {
    const oldSize = heading.size;
    heading.size = 48;
    if (highlight && oldSize) alignHighlight(heading, highlight, oldSize);
  }
  const description = byName(section, 'Description');
  if (description) description.lineHeight = 1.55;
  layersOf(section).forEach((layer) => {
    if (layer.type === 'gallery' && Number(layer.gap) === 5) layer.gap = 16;
  });
  const bottom = byName(section, 'Ghost word (bottom)');
  if (bottom) {
    const canvasH = Number(section.canvasHeight) || 1600;
    const maxY = canvasH - (Number(bottom.h) || 160) - 16;
    if (bottom.y > maxY) bottom.y = maxY;
  }
}

function fixHeader(section) {
  const title = byName(section, 'Title');
  const highlight = byName(section, 'Title highlight');
  if (title && title.size !== 48) {
    const oldSize = title.size;
    title.size = 48;
    if (highlight && oldSize) alignHighlight(title, highlight, oldSize);
  }
  const subtitle = byName(section, 'Subtitle');
  if (subtitle) {
    subtitle.font = 'var(--font-body)';
    subtitle.weight = 500;
    subtitle.lineHeight = 1.55;
    if (!subtitle.h || subtitle.h < 64) subtitle.h = 64;
  }
}

content.site.theme.marqueeText = '#FDFDFD';
fixHero(content.home.hero);
(content.home.sections || []).forEach((section) => {
  if (section && section.id === 's-about-canvas') fixAbout(section);
  if (section && section.id === 's-home-works') fixWorks(section);
});
if (content.home.works) fixWorks(content.home.works);
(content.pages || []).forEach((page) => {
  if (page && page.headerBoard) fixHeader(page.headerBoard);
});

fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');

function brief(section, names) {
  return names.map((name) => {
    const layer = byName(section, name);
    if (!layer) return name + ': missing';
    return [
      name,
      'x' + layer.x,
      'y' + layer.y,
      'w' + layer.w,
      'h' + layer.h,
      's' + (layer.size || ''),
      'lh' + (layer.lineHeight || ''),
      'gap' + (layer.gap || ''),
      layer.font || '',
      String(layer.text || '').slice(0, 42),
    ].join(' ');
  }).join('\n  ');
}

console.log('marquee', content.site.theme.marqueeText);
console.log('HERO\n  ' + brief(content.home.hero, ['Name', 'Tagline', 'Big word']));
const about = (content.home.sections || []).find((section) => section.id === 's-about-canvas');
console.log('ABOUT\n  ' + brief(about, ['Ghost word (top)', 'Heading "About Me"', 'Intro paragraph', 'Second paragraph']));
const works = (content.home.sections || []).find((section) => section.id === 's-home-works');
console.log('WORKS section\n  ' + brief(works, ['Heading', 'Heading highlight', 'Description', 'Category cards', 'Ghost word (bottom)']));
console.log('WORKS copy\n  ' + brief(content.home.works, ['Heading', 'Heading highlight', 'Description', 'Category cards', 'Ghost word (bottom)']));
(content.pages || []).forEach((page) => {
  console.log('PAGE ' + page.slug + '\n  ' + brief(page.headerBoard, ['Title', 'Title highlight', 'Subtitle']));
});
