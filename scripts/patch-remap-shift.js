const fs = require('fs');
const p = 'D:/portfolio/admin/canvas-editor.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('function remapLayersX(list, oldW, newW)');
if (start < 0) { console.error('fn not found'); process.exit(1); }
// include the comment block just above
const commentStart = s.lastIndexOf('// Keep layer X positions', start);
const from = commentStart >= 0 && start - commentStart < 200 ? commentStart : start;
const endMarker = '\n    function layerSpanX';
const end = s.indexOf(endMarker, start);
if (end < 0) { console.error('end not found'); process.exit(1); }

const neu = `// Keep layer layout when the board width changes: SHIFT (recenter), never
    // scale. Scaling x/w without scaling font-size tears title highlights off
    // the glyphs (peach bar wider / skewed vs the heading).
    function remapLayersX(list, oldW, newW) {
      if (!Array.isArray(list) || !(oldW > 0) || !(newW > 0) || oldW === newW) return false;
      const dx = Math.round((newW - oldW) / 2);
      if (!dx) return false;
      const shift = (n) => (Number(n) || 0) + dx;
      list.forEach((l) => {
        if (!l) return;
        if (l.x != null) l.x = shift(l.x);
        // widths stay put — shapes/text keep their designed hug
        (l.children || []).forEach((c) => {
          if (!c) return;
          if (c.x != null) c.x = shift(c.x);
        });
        (l.images || []).forEach((item) => {
          if (!item || item.x == null) return;
          item.x = shift(item.x);
        });
      });
      return true;
    }
`;

s = s.slice(0, from) + neu + s.slice(end);
fs.writeFileSync(p, s, 'utf8');
console.log('patched', from, '->', end, 'newLen', s.length);
// verify
const v = fs.readFileSync(p,'utf8');
console.log('has shift', v.includes('SHIFT (recenter)'));
console.log('has scale sx', v.includes('const sx = newW / oldW'));
