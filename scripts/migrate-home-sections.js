// One-off migration: turn the Home "About Me" block into a layout canvas
// section so it can be rearranged in the admin panel.
// Run once:  node scripts/migrate-home-sections.js
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'content.json');
const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));

if (!content.home || !content.home.about) {
  console.log('Nothing to do: content.json has no home.about block.');
  process.exit(0);
}

const box = (x, y, w, h) => ({ x, y, w, h });

const about = {
  id: 's-about-canvas',
  name: 'About Me',
  heading: 'About Me',
  layout: 'canvas',
  canvasHeight: 820,
  canvasBg: '#E1E5EB',
  layers: [
    {
      id: 'l-decor-top', type: 'heading', name: 'Ghost word (top)',
      ...box(60, 30, 1305, 210), text: 'ABOUT ME', size: 200, weight: 700,
      align: 'center', color: '#F2F4F7', letterSpacing: 4, anim: 'none', animated: false,
    },
    {
      id: 'l-heading', type: 'heading', name: 'Heading "About Me"',
      ...box(255, 230, 700, 80), text: 'About Me', size: 54, weight: 700,
      align: 'left', color: '#0A192F', anim: 'up', duration: 0.9, delay: 0,
    },
    {
      id: 'l-rule', type: 'divider', name: 'Accent bar',
      ...box(255, 318, 230, 8), color: '#95B8FE', anim: 'up', duration: 0.9, delay: 0.15,
    },
    {
      id: 'l-intro', type: 'text', name: 'Intro paragraph',
      ...box(255, 360, 520, 220), hugging: true, size: 17, lineHeight: 1.55,
      color: '#4F5E75', anim: 'up', duration: 0.9, delay: 0.25,
      text: content.home.about.intro,
    },
    {
      id: 'l-outro', type: 'text', name: 'Second paragraph',
      ...box(833, 360, 520, 220), hugging: true, size: 17, lineHeight: 1.55,
      color: '#4F5E75', anim: 'up', duration: 0.9, delay: 0.4,
      text: content.home.about.outro,
    },
  ],
};

content.home.sections = content.home.sections || [];
if (!content.home.sections.some((s) => s.id === about.id)) content.home.sections.unshift(about);
delete content.home.about;   // the About block is now the canvas section above

fs.writeFileSync(FILE, JSON.stringify(content, null, 2) + '\n', 'utf8');
console.log('Added home.sections:', content.home.sections.length, 'section(s)');
