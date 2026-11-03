const ejs = require('ejs');
const fs = require('fs');
const content = JSON.parse(fs.readFileSync('data/content.json', 'utf8'));
const pages = content.pages.filter((p) => p.showInNav !== false);
ejs.renderFile('views/home.ejs', {
  site: content.site,
  home: content.home,
  pages,
  nav: [{ label: 'Home', href: '/#home', active: true }],
  pageTitle: 'Home',
  esc: (s) => String(s || ''),
  safeColor: () => null,
  paragraphs: () => '',
  lines: () => '',
  isExternal: () => false,
}, (err, str) => {
  if (err) {
    console.error(err.stack || err);
    process.exit(1);
  }
  console.log('ok', str.length, str.includes('id="artworks"'));
});
