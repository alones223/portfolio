// Downloads every image referenced in data/content.json that is missing from
// public/uploads, using the original files hosted on Wix.
//
// Local files are named like "0b0535_<hash>.jpg"; on Wix the same file is
// "0b0535_<hash>~mv2.jpg". Run with:  npm run fetch-images

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'data', 'content.json');
const UPLOADS = path.join(ROOT, 'public', 'uploads');
const WIX_MEDIA = 'https://static.wixstatic.com/media/';
// Very large photos are resized on Wix's side so the site stays fast.
const MAX_SIZE = 2400;

function collectUploads(node, out = new Set()) {
  if (typeof node === 'string') {
    if (node.startsWith('/uploads/')) out.add(node.slice('/uploads/'.length));
  } else if (Array.isArray(node)) {
    node.forEach((n) => collectUploads(n, out));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((n) => collectUploads(n, out));
  }
  return out;
}

function wixUrl(file) {
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const wixName = `${base}~mv2${ext}`;
  // Animated GIFs must be fetched untouched, otherwise Wix flattens them.
  if (ext.toLowerCase() === '.gif') return WIX_MEDIA + wixName;
  return `${WIX_MEDIA}${wixName}/v1/fit/w_${MAX_SIZE},h_${MAX_SIZE},q_90/${wixName}`;
}

async function download(file) {
  const dest = path.join(UPLOADS, file);
  if (fs.existsSync(dest)) return 'skip';
  // Ask for the original format (no AVIF/WebP conversion).
  const res = await fetch(wixUrl(file), { headers: { Accept: 'image/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return `${(buf.length / 1024).toFixed(0)} KB`;
}

async function main() {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
  const files = [...collectUploads(content)].filter((f) => /^0b0535_[0-9a-f]+\.\w+$/.test(f));
  console.log(`Found ${files.length} Wix images referenced in content.json`);

  let failed = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      try {
        const result = await download(file);
        console.log(`  ${result === 'skip' ? 'exists ' : 'saved  '} ${file}${result === 'skip' ? '' : ` (${result})`}`);
      } catch (err) {
        failed++;
        console.error(`  FAILED  ${file}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(failed ? `\nDone with ${failed} failures.` : '\nAll images downloaded.');
  process.exitCode = failed ? 1 : 0;
}

main();
