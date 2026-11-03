# -*- coding: utf-8 -*-
"""Media library organize + PDF admin preview + cache5."""
from pathlib import Path
import re
import shutil
from datetime import datetime

ROOT = Path(r"D:\portfolio")
BACKUP = ROOT / "data" / f"patch-backup-media-org-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
BACKUP.mkdir(parents=True, exist_ok=True)

def backup(rel):
    src = ROOT / rel
    dst = BACKUP / rel.replace("\\", "/").replace("/", "__")
    shutil.copy2(src, dst)
    print(f"backup {rel} -> {dst.name}")

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, text):
    (ROOT / rel).write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {rel} ({len(text)} chars)")

# ---------------------------------------------------------------------------
# 1) server.js — media library API
# ---------------------------------------------------------------------------
backup("server.js")
server = read("server.js")

# Insert MEDIA_LIBRARY_FILE after LAYOUT_LIBRARY_FILE
needle = "const LAYOUT_LIBRARY_FILE = path.join(DATA_DIR, 'layouts.json');\nconst MAX_LIBRARY = 200;"
insert = """const LAYOUT_LIBRARY_FILE = path.join(DATA_DIR, 'layouts.json');
const MAX_LIBRARY = 200;
// Optional albums you create in Media library. Page folders stay virtual
# (derived from content); these are real labels you assign to files.
const MEDIA_LIBRARY_FILE = path.join(DATA_DIR, 'media-library.json');"""
# Fix the comment - I used # by mistake in the string above. Rewrite:
insert = """const LAYOUT_LIBRARY_FILE = path.join(DATA_DIR, 'layouts.json');
const MAX_LIBRARY = 200;
// Optional albums you create in Media library. Page folders stay virtual
// (derived from content); these are real labels you assign to files.
const MEDIA_LIBRARY_FILE = path.join(DATA_DIR, 'media-library.json');"""
if "MEDIA_LIBRARY_FILE" not in server:
    if needle not in server:
        raise SystemExit("LAYOUT_LIBRARY_FILE needle missing")
    server = server.replace(needle, insert, 1)
    print("inserted MEDIA_LIBRARY_FILE")
else:
    print("MEDIA_LIBRARY_FILE already present")

# Replace media section from "// Media uploads" through delete handler
old_start = "// Media uploads\n// ---------------------------------------------------------------------------"
old_end_marker = "// Contact form + messages\n// ---------------------------------------------------------------------------"

if old_start not in server or old_end_marker not in server:
    raise SystemExit("media section markers missing")

media_block = r'''// Media uploads
// ---------------------------------------------------------------------------

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.mp4', '.webm', '.pdf', '.woff', '.woff2', '.ttf', '.otf']);
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.webm']);

function mediaKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (FONT_EXT.has(ext)) return 'font';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'other';
}

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

function emptyMediaLibrary() {
  return { folders: [], assignments: {} };
}

function getMediaLibrary() {
  const raw = readJson(MEDIA_LIBRARY_FILE, emptyMediaLibrary());
  if (!raw || typeof raw !== 'object') return emptyMediaLibrary();
  const folders = Array.isArray(raw.folders)
    ? raw.folders
        .filter((f) => f && typeof f === 'object' && f.id && f.label)
        .map((f) => ({ id: String(f.id), label: String(f.label).trim().slice(0, 80) || 'Folder' }))
    : [];
  const assignments = {};
  if (raw.assignments && typeof raw.assignments === 'object') {
    for (const [name, folderId] of Object.entries(raw.assignments)) {
      if (typeof name === 'string' && typeof folderId === 'string' && folders.some((f) => f.id === folderId)) {
        assignments[path.basename(name)] = folderId;
      }
    }
  }
  return { folders, assignments };
}

function saveMediaLibrary(lib) {
  writeJsonAtomic(MEDIA_LIBRARY_FILE, {
    folders: lib.folders || [],
    assignments: lib.assignments || {},
  });
}

function rewriteUploadStrings(node, fromUrl, toUrl) {
  if (typeof node === 'string') return node === fromUrl ? toUrl : node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = rewriteUploadStrings(node[i], fromUrl, toUrl);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) node[key] = rewriteUploadStrings(node[key], fromUrl, toUrl);
  }
  return node;
}

function rewriteUploadInSavedContent(fromUrl, toUrl) {
  const content = getContent();
  rewriteUploadStrings(content, fromUrl, toUrl);
  writeJsonAtomic(CONTENT_FILE, content);
  contentCache = content;
  // Layout shelf may also reference the same upload URLs.
  if (fs.existsSync(LAYOUT_LIBRARY_FILE)) {
    const layouts = readJson(LAYOUT_LIBRARY_FILE, []);
    rewriteUploadStrings(layouts, fromUrl, toUrl);
    writeJsonAtomic(LAYOUT_LIBRARY_FILE, layouts);
  }
  return content;
}

function sanitizeUploadBase(name) {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'file';
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
// Library albums (from media-library.json) are extra labels you assign yourself.
function mediaFolders(content, lib) {
  const site = (content && content.site) || {};
  const folders = [{ id: 'home', label: site.homeNavLabel || 'Home', kind: 'page', node: content && content.home }];
  for (const page of (content && content.pages) || []) {
    folders.push({
      id: page.id || page.slug,
      label: page.navLabel || page.title || page.slug || 'Untitled page',
      kind: 'page',
      node: page,
    });
  }
  folders.push({ id: 'site', label: 'Site-wide (logo, socials)', kind: 'page', node: site });
  folders.push({ id: 'fonts', label: 'Fonts', kind: 'page', urls: new Set(listFontFiles().map((font) => font.url)) });
  const pageFolders = folders.map((f) => ({ id: f.id, label: f.label, kind: f.kind || 'page', urls: f.urls || collectStrings(f.node, new Set()) }));
  const library = (lib && lib.folders) || [];
  const libraryFolders = library.map((f) => ({
    id: `lib:${f.id}`,
    label: f.label,
    kind: 'library',
    libraryId: f.id,
    urls: new Set(
      Object.entries((lib && lib.assignments) || {})
        .filter(([, folderId]) => folderId === f.id)
        .map(([name]) => `/uploads/${name}`)
    ),
  }));
  return [...pageFolders, ...libraryFolders];
}

app.get('/api/fonts', requireAuth, (req, res) => {
  res.json(listFontFiles().map(({ name, url, family, css }) => ({ name, url, family, css })));
});

app.get('/api/media/folders', requireAuth, (req, res) => {
  const lib = getMediaLibrary();
  res.json(mediaFolders(getContent(), lib).map(({ id, label, kind, libraryId }) => ({
    id, label, kind: kind || 'page', ...(libraryId ? { libraryId } : {}),
  })));
});

app.post('/api/media/folders', requireAuth, (req, res) => {
  const label = String(req.body?.label || '').trim().slice(0, 80);
  if (!label) return res.status(400).json({ error: 'Folder name is required' });
  const lib = getMediaLibrary();
  if (lib.folders.length >= 40) return res.status(400).json({ error: 'Too many library folders (max 40)' });
  const folder = { id: crypto.randomBytes(4).toString('hex'), label };
  lib.folders.push(folder);
  saveMediaLibrary(lib);
  res.json({ id: `lib:${folder.id}`, libraryId: folder.id, label: folder.label, kind: 'library' });
});

app.patch('/api/media/folders/:id', requireAuth, (req, res) => {
  const libraryId = String(req.params.id || '').replace(/^lib:/, '');
  const label = String(req.body?.label || '').trim().slice(0, 80);
  if (!label) return res.status(400).json({ error: 'Folder name is required' });
  const lib = getMediaLibrary();
  const folder = lib.folders.find((f) => f.id === libraryId);
  if (!folder) return res.status(404).json({ error: 'Library folder not found' });
  folder.label = label;
  saveMediaLibrary(lib);
  res.json({ id: `lib:${folder.id}`, libraryId: folder.id, label: folder.label, kind: 'library' });
});

app.delete('/api/media/folders/:id', requireAuth, (req, res) => {
  const libraryId = String(req.params.id || '').replace(/^lib:/, '');
  const lib = getMediaLibrary();
  if (!lib.folders.some((f) => f.id === libraryId)) {
    return res.status(404).json({ error: 'Library folder not found' });
  }
  lib.folders = lib.folders.filter((f) => f.id !== libraryId);
  for (const [name, folderId] of Object.entries(lib.assignments)) {
    if (folderId === libraryId) delete lib.assignments[name];
  }
  saveMediaLibrary(lib);
  res.json({ ok: true });
});

app.get('/api/media', requireAuth, (req, res) => {
  const content = getContent();
  const lib = getMediaLibrary();
  const used = collectStrings(content, new Set());
  const folders = mediaFolders(content, lib);
  const fontsByUrl = new Map(listFontFiles().map((item) => [item.url, item]));
  const files = fs
    .readdirSync(UPLOAD_DIR)
    .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
    .map((name) => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, name));
      const url = `/uploads/${name}`;
      const font = fontsByUrl.get(url);
      const libraryId = lib.assignments[name] || null;
      return {
        name,
        url,
        size: stat.size,
        modified: stat.mtimeMs,
        used: used.has(url),
        kind: mediaKind(name),
        libraryId,
        folders: folders.filter((f) => f.urls.has(url)).map((f) => f.id),
        ...(font ? { fontFamily: font.css } : {}),
      };
    })
    .sort((a, b) => b.modified - a.modified);
  res.json(files);
});

app.patch('/api/media/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });

  const lib = getMediaLibrary();
  let nextName = name;
  let content = null;
  const body = req.body || {};

  if (typeof body.newName === 'string' && body.newName.trim()) {
    const ext = path.extname(name).toLowerCase();
    let base = path.basename(body.newName.trim(), path.extname(body.newName.trim()));
    base = sanitizeUploadBase(base);
    if (!base) return res.status(400).json({ error: 'Invalid file name' });
    nextName = `${base}${ext}`;
    if (nextName !== name) {
      const dest = path.join(UPLOAD_DIR, nextName);
      if (fs.existsSync(dest)) {
        return res.status(409).json({ error: `A file named "${nextName}" already exists` });
      }
      fs.renameSync(file, dest);
      const fromUrl = `/uploads/${name}`;
      const toUrl = `/uploads/${nextName}`;
      content = rewriteUploadInSavedContent(fromUrl, toUrl);
      if (lib.assignments[name]) {
        lib.assignments[nextName] = lib.assignments[name];
        delete lib.assignments[name];
      }
    }
  }

  if ('folderId' in body) {
    let folderId = body.folderId;
    if (folderId == null || folderId === '' || folderId === 'none') {
      delete lib.assignments[nextName];
    } else {
      folderId = String(folderId).replace(/^lib:/, '');
      if (!lib.folders.some((f) => f.id === folderId)) {
        return res.status(400).json({ error: 'Unknown library folder' });
      }
      lib.assignments[nextName] = folderId;
    }
  }

  saveMediaLibrary(lib);
  const stat = fs.statSync(path.join(UPLOAD_DIR, nextName));
  const url = `/uploads/${nextName}`;
  const used = collectStrings(content || getContent(), new Set());
  res.json({
    ok: true,
    name: nextName,
    url,
    size: stat.size,
    modified: stat.mtimeMs,
    used: used.has(url),
    kind: mediaKind(nextName),
    libraryId: lib.assignments[nextName] || null,
    rewritten: Boolean(content),
    content: content || undefined,
  });
});

app.post('/api/media/delete', requireAuth, (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names.map((n) => path.basename(String(n || ''))) : [];
  const force = Boolean(req.body?.force);
  if (!names.length) return res.status(400).json({ error: 'No files selected' });
  const used = collectStrings(getContent(), new Set());
  const lib = getMediaLibrary();
  const blocked = [];
  const deleted = [];
  for (const name of names) {
    const file = path.join(UPLOAD_DIR, name);
    if (!name || !fs.existsSync(file)) continue;
    if (used.has(`/uploads/${name}`) && !force) {
      blocked.push(name);
      continue;
    }
    fs.unlinkSync(file);
    delete lib.assignments[name];
    deleted.push(name);
  }
  saveMediaLibrary(lib);
  if (!deleted.length && blocked.length) {
    return res.status(409).json({
      error: `${blocked.length} file(s) are still used on the site. Remove them from pages first, or force delete.`,
      blocked,
    });
  }
  res.json({ ok: true, deleted, blocked });
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
  const lib = getMediaLibrary();
  if (lib.assignments[name]) {
    delete lib.assignments[name];
    saveMediaLibrary(lib);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
'''

i0 = server.index(old_start)
i1 = server.index(old_end_marker)
server = server[:i0] + media_block + old_end_marker + server[i1 + len(old_end_marker):]
write("server.js", server)

# Seed empty media-library.json if missing
mlib = ROOT / "data" / "media-library.json"
if not mlib.exists():
    mlib.write_text('{\n  "folders": [],\n  "assignments": {}\n}\n', encoding="utf-8")
    print("created data/media-library.json")

print("server done")

# ---------------------------------------------------------------------------
# 2) admin.js — helpers + viewMedia rewrite
# ---------------------------------------------------------------------------
backup("admin/admin.js")
admin = read("admin/admin.js")

# isPdf helper next to isFontFile
if "const isPdf =" not in admin:
    admin = admin.replace(
        "const isFontFile = (url) => /\\.(woff2?|ttf|otf)(\\?|$)/i.test(url || '');",
        "const isFontFile = (url) => /\\.(woff2?|ttf|otf)(\\?|$)/i.test(url || '');\n"
        "  const isPdf = (url) => /\\.pdf(\\?|$)/i.test(url || '');\n"
        "  const mediaKindOf = (url) => {\n"
        "    if (isFontFile(url)) return 'font';\n"
        "    if (isVideo(url)) return 'video';\n"
        "    if (isPdf(url)) return 'pdf';\n"
        "    return 'image';\n"
        "  };",
        1,
    )
    print("added isPdf/mediaKindOf")

# mediaPreview: PDF + kind-aware
old_preview = """  function mediaPreview(url) {
    if (!url) return document.createTextNode('No image');
    if (isVideo(url)) return h('video', { src: url, muted: true, preload: 'metadata' });
    if (isFontFile(url)) {
      const hit = (window.CanvasFonts || []).find((font) => font.url === url);
      return h('span', { class: 'font-sample', style: hit ? `font-family:${hit.css}` : '' }, 'Ag');
    }
    return h('img', { src: url, alt: '', loading: 'lazy' });
  }"""

new_preview = """  function mediaPreview(url) {
    if (!url) return document.createTextNode('No image');
    if (isVideo(url)) return h('video', { src: url, muted: true, preload: 'metadata' });
    if (isPdf(url)) {
      return h('div', { class: 'pdf-thumb' },
        h('iframe', { src: url, title: 'PDF', loading: 'lazy', tabindex: '-1' }),
        h('span', { class: 'pdf-badge' }, 'PDF'));
    }
    if (isFontFile(url)) {
      const hit = (window.CanvasFonts || []).find((font) => font.url === url);
      return h('span', { class: 'font-sample', style: hit ? `font-family:${hit.css}` : '' }, 'Ag');
    }
    return h('img', { src: url, alt: '', loading: 'lazy' });
  }

  function rewriteUploadUrls(node, fromUrl, toUrl) {
    if (typeof node === 'string') return node === fromUrl ? toUrl : node;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = rewriteUploadUrls(node[i], fromUrl, toUrl);
      return node;
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) node[key] = rewriteUploadUrls(node[key], fromUrl, toUrl);
    }
    return node;
  }

  function applyMediaRenameLocally(fromUrl, toUrl) {
    if (!content || !fromUrl || !toUrl || fromUrl === toUrl) return;
    rewriteUploadUrls(content, fromUrl, toUrl);
    try {
      const saved = JSON.parse(savedJson);
      rewriteUploadUrls(saved, fromUrl, toUrl);
      savedJson = JSON.stringify(saved);
    } catch { /* ignore */ }
    changed();
  }"""

if "function mediaPreview(url)" not in admin:
    raise SystemExit("mediaPreview missing")
if "pdf-thumb" not in admin:
    if old_preview not in admin:
        # try looser match
        m = re.search(r"  function mediaPreview\(url\) \{.*?\n  \}\n", admin, re.S)
        if not m:
            raise SystemExit("mediaPreview block not found for replace")
        admin = admin[:m.start()] + new_preview + "\n" + admin[m.end():]
    else:
        admin = admin.replace(old_preview, new_preview, 1)
    print("replaced mediaPreview")
else:
    print("mediaPreview already has pdf-thumb")

# Replace viewMedia section: from ALL_FOLDER comment through end of viewMedia
start_marker = "  // Folders are virtual: the server tags each file with the pages that use it."
end_marker = "  async function viewBackups(container) {"

if start_marker not in admin or end_marker not in admin:
    raise SystemExit("viewMedia markers missing")

new_media_ui = r'''  // Folders are virtual: the server tags each file with the pages that use it.
  // Library albums (lib:*) are labels you create and assign yourself.
  const ALL_FOLDER = 'all';
  const UNUSED_FOLDER = 'unused';
  let mediaFolder = ALL_FOLDER;
  let mediaTypeFilter = 'all';
  let mediaSort = 'newest';
  const mediaSelected = new Set();

  function mediaFolderList(pageFolders) {
    const pages = (pageFolders || []).filter((f) => f.kind !== 'library');
    const library = (pageFolders || []).filter((f) => f.kind === 'library');
    return [
      { id: ALL_FOLDER, label: 'All files', kind: 'system' },
      ...pages,
      ...library,
      { id: UNUSED_FOLDER, label: 'Unused', kind: 'system' },
    ];
  }

  function inMediaFolder(file, folderId) {
    if (folderId === ALL_FOLDER) return true;
    if (folderId === UNUSED_FOLDER) return !file.used;
    return (file.folders || []).includes(folderId);
  }

  function fileMatchesType(file, type) {
    if (type === 'all') return true;
    const kind = file.kind || mediaKindOf(file.url || file.name);
    return kind === type;
  }

  function sortMediaFiles(list, sort) {
    const out = list.slice();
    if (sort === 'oldest') out.sort((a, b) => (a.modified || 0) - (b.modified || 0));
    else if (sort === 'name-asc') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'name-desc') out.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'size') out.sort((a, b) => (b.size || 0) - (a.size || 0));
    else out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    return out;
  }

  async function viewMedia(container) {
    mount(container, h('p', { class: 'muted' }, 'Loading…'));
    let files;
    let folders;
    try {
      const [fileList, pageFolders] = await Promise.all([api('GET', '/api/media'), api('GET', '/api/media/folders')]);
      files = fileList;
      folders = mediaFolderList(pageFolders);
    } catch (err) {
      mount(container, h('p', { class: 'muted' }, err.message));
      return;
    }
    if (!folders.some((f) => f.id === mediaFolder)) mediaFolder = ALL_FOLDER;
    mediaSelected.clear();
    const folderLabels = new Map(folders.map((f) => [f.id, f.label]));
    const usedOn = (file) => (file.folders || [])
      .filter((id) => !String(id).startsWith('lib:'))
      .map((id) => folderLabels.get(id))
      .filter(Boolean)
      .join(', ');
    const libraryLabel = (file) => {
      if (!file.libraryId) return '';
      const hit = folders.find((f) => f.libraryId === file.libraryId || f.id === `lib:${file.libraryId}`);
      return hit ? hit.label : '';
    };

    const search = h('input', { type: 'search', placeholder: 'Filter by file name…', style: 'max-width:260px' });
    const typeSel = h('select', { 'aria-label': 'File type' },
      h('option', { value: 'all' }, 'All types'),
      h('option', { value: 'image' }, 'Images'),
      h('option', { value: 'video' }, 'Videos'),
      h('option', { value: 'pdf' }, 'PDFs'),
      h('option', { value: 'font' }, 'Fonts'));
    typeSel.value = mediaTypeFilter;
    const sortSel = h('select', { 'aria-label': 'Sort' },
      h('option', { value: 'newest' }, 'Newest first'),
      h('option', { value: 'oldest' }, 'Oldest first'),
      h('option', { value: 'name-asc' }, 'Name A–Z'),
      h('option', { value: 'name-desc' }, 'Name Z–A'),
      h('option', { value: 'size' }, 'Largest first'));
    sortSel.value = mediaSort;

    const grid = h('div', { class: 'media-grid' });
    const folderNav = h('nav', { class: 'media-folders', 'aria-label': 'Folders' });
    const bulkBar = h('div', { class: 'media-bulk', hidden: true });
    const fileIn = h('input', {
      type: 'file',
      accept: 'image/*,video/mp4,video/webm,application/pdf,.pdf,.woff,.woff2,.ttf,.otf',
      multiple: true,
      hidden: true,
    });
    fileIn.addEventListener('change', async () => {
      const urls = await uploadFiles(fileIn.files);
      fileIn.value = '';
      if (urls.length) viewMedia(container);
    });

    const visibleList = () => {
      const q = search.value.trim().toLowerCase();
      return sortMediaFiles(
        files.filter((x) =>
          x.name.toLowerCase().includes(q)
          && inMediaFolder(x, mediaFolder)
          && fileMatchesType(x, mediaTypeFilter)),
        mediaSort);
    };

    const syncBulk = () => {
      const n = mediaSelected.size;
      bulkBar.hidden = n === 0;
      if (!n) return;
      mount(bulkBar,
        h('span', null, `${n} selected`),
        h('button', {
          class: 'btn small danger', type: 'button',
          onclick: async () => {
            const picked = files.filter((f) => mediaSelected.has(f.name));
            if (!picked.length) return;
            const usedCount = picked.filter((f) => f.used).length;
            const msg = usedCount
              ? `${picked.length} file(s) selected; ${usedCount} still used on the website. Delete anyway?`
              : `Delete ${picked.length} file(s) permanently?`;
            if (!confirm(msg)) return;
            try {
              const res = await api('POST', '/api/media/delete', {
                names: picked.map((f) => f.name),
                force: usedCount > 0,
              });
              const gone = new Set(res.deleted || []);
              files = files.filter((f) => !gone.has(f.name));
              mediaSelected.clear();
              drawFolders();
              draw();
              syncBulk();
              toast(gone.size ? `Deleted ${gone.size}.` : 'Nothing deleted.');
            } catch (err) { toast(err.message, true); }
          },
        }, 'Delete selected'),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: () => { mediaSelected.clear(); draw(); syncBulk(); },
        }, 'Clear'));
    };

    const libraryFolders = () => folders.filter((f) => f.kind === 'library');

    const renameFile = async (file) => {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const base = file.name.slice(0, file.name.length - ext.length);
      const next = prompt('Rename file (extension stays the same):', base);
      if (next == null) return;
      const cleaned = next.trim();
      if (!cleaned || cleaned === base) return;
      try {
        const res = await api('PATCH', `/api/media/${encodeURIComponent(file.name)}`, { newName: cleaned + ext });
        if (res.rewritten && res.url !== file.url) applyMediaRenameLocally(file.url, res.url);
        Object.assign(file, {
          name: res.name,
          url: res.url,
          size: res.size,
          modified: res.modified,
          used: res.used,
          kind: res.kind,
          libraryId: res.libraryId,
        });
        // Refresh folder tags from server for this file
        const fresh = await api('GET', '/api/media');
        const hit = fresh.find((f) => f.name === res.name);
        if (hit) Object.assign(file, hit);
        files = files.map((f) => (f.name === file.name || f.url === res.url ? { ...f, ...file } : f));
        // Deduplicate after rename
        const byName = new Map();
        files.forEach((f) => byName.set(f.name, f));
        files = [...byName.values()];
        drawFolders();
        draw();
        toast(res.rewritten ? 'Renamed — website links updated. Save if you still have other unsaved edits.' : 'Renamed.');
      } catch (err) { toast(err.message, true); }
    };

    const moveFile = async (file) => {
      const libs = libraryFolders();
      if (!libs.length) {
        toast('Create a library folder first (New folder in the sidebar).', true);
        return;
      }
      const choices = ['(none — remove from album)', ...libs.map((f) => f.label)];
      const pick = prompt(
        `Move to library folder:\n${choices.map((c, i) => `${i}: ${c}`).join('\n')}\n\nEnter number:`,
        '0');
      if (pick == null) return;
      const idx = Number(pick);
      if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) {
        toast('Invalid choice.', true);
        return;
      }
      const folderId = idx === 0 ? null : (libs[idx - 1].libraryId || String(libs[idx - 1].id).replace(/^lib:/, ''));
      try {
        const res = await api('PATCH', `/api/media/${encodeURIComponent(file.name)}`, { folderId });
        file.libraryId = res.libraryId;
        const fresh = await api('GET', '/api/media');
        const hit = fresh.find((f) => f.name === file.name);
        if (hit) Object.assign(file, hit);
        drawFolders();
        draw();
        toast(folderId ? 'Moved to folder.' : 'Removed from library folder.');
      } catch (err) { toast(err.message, true); }
    };

    const drawFolders = () => {
      const pageOnes = folders.filter((f) => f.kind === 'page' || f.kind === 'system' || !f.kind);
      const libOnes = folders.filter((f) => f.kind === 'library');
      mount(folderNav,
        pageOnes.map((folder) => h('button', {
          class: `media-folder${folder.id === mediaFolder ? ' active' : ''}`,
          type: 'button',
          title: folder.label,
          onclick: () => {
            mediaFolder = folder.id;
            drawFolders();
            draw();
          },
        },
        h('span', { class: 'label' }, folder.label),
        h('span', { class: 'count' }, files.filter((x) => inMediaFolder(x, folder.id)).length))),
        h('div', { class: 'media-folder-sep' }, 'Library albums'),
        libOnes.length ? null : h('p', { class: 'muted small', style: 'margin:4px 8px 8px' }, 'Create albums to group files (separate from pages).'),
        libOnes.map((folder) => h('div', { class: 'media-folder-row' },
          h('button', {
            class: `media-folder${folder.id === mediaFolder ? ' active' : ''}`,
            type: 'button',
            title: folder.label,
            onclick: () => {
              mediaFolder = folder.id;
              drawFolders();
              draw();
            },
          },
          h('span', { class: 'label' }, folder.label),
          h('span', { class: 'count' }, files.filter((x) => inMediaFolder(x, folder.id)).length)),
          h('button', {
            class: 'btn tiny', type: 'button', title: 'Rename folder',
            onclick: async (e) => {
              e.stopPropagation();
              const next = prompt('Rename folder:', folder.label);
              if (next == null || !next.trim() || next.trim() === folder.label) return;
              try {
                const res = await api('PATCH', `/api/media/folders/${encodeURIComponent(folder.libraryId || folder.id)}`, { label: next.trim() });
                folder.label = res.label;
                folderLabels.set(folder.id, res.label);
                drawFolders();
                draw();
              } catch (err) { toast(err.message, true); }
            },
          }, '✎'),
          h('button', {
            class: 'btn tiny danger', type: 'button', title: 'Delete folder',
            onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`Delete album "${folder.label}"? Files stay; only the album is removed.`)) return;
              try {
                await api('DELETE', `/api/media/folders/${encodeURIComponent(folder.libraryId || folder.id)}`);
                folders = folders.filter((f) => f.id !== folder.id);
                if (mediaFolder === folder.id) mediaFolder = ALL_FOLDER;
                files.forEach((f) => {
                  if (f.libraryId && (`lib:${f.libraryId}` === folder.id || f.libraryId === folder.libraryId)) {
                    f.libraryId = null;
                    f.folders = (f.folders || []).filter((id) => id !== folder.id);
                  }
                });
                drawFolders();
                draw();
              } catch (err) { toast(err.message, true); }
            },
          }, '×'))),
        h('button', {
          class: 'btn small', type: 'button', style: 'margin-top:8px',
          onclick: async () => {
            const label = prompt('New library album name:');
            if (label == null || !label.trim()) return;
            try {
              const res = await api('POST', '/api/media/folders', { label: label.trim() });
              const unusedAt = folders.findIndex((f) => f.id === UNUSED_FOLDER);
              if (unusedAt >= 0) folders.splice(unusedAt, 0, res);
              else folders.push(res);
              folderLabels.set(res.id, res.label);
              mediaFolder = res.id;
              drawFolders();
              draw();
              toast('Album created.');
            } catch (err) { toast(err.message, true); }
          },
        }, '+ New folder'));
    };

    const kindPill = (file) => {
      const kind = file.kind || mediaKindOf(file.url);
      return h('span', { class: `pill kind-${kind}` }, kind);
    };

    const draw = () => {
      const list = visibleList();
      // Drop selections that are no longer visible/present
      [...mediaSelected].forEach((name) => {
        if (!files.some((f) => f.name === name)) mediaSelected.delete(name);
      });
      mount(grid,
        list.length ? null : h('p', { class: 'muted' }, search.value.trim() ? 'No files match.' : 'This folder is empty.'),
        list.map((file) => {
          const selected = mediaSelected.has(file.name);
          return h('div', { class: `media-card${selected ? ' selected' : ''}` },
            h('label', { class: 'media-check', title: 'Select' },
              h('input', {
                type: 'checkbox',
                checked: selected,
                onchange: (e) => {
                  if (e.target.checked) mediaSelected.add(file.name);
                  else mediaSelected.delete(file.name);
                  draw();
                  syncBulk();
                },
              })),
            h('div', { class: 'tile-img' }, mediaPreview(file.url)),
            h('div', { class: 'media-info' },
              h('span', { class: 'name', title: file.name }, file.name),
              h('div', { class: 'row' },
                h('span', null, formatSize(file.size)),
                kindPill(file)),
              h('div', { class: 'row' },
                h('span', { class: `pill${file.used ? '' : ' unused'}` }, file.used ? 'In use' : 'Unused'),
                libraryLabel(file) ? h('span', { class: 'pill album' }, libraryLabel(file)) : null),
              usedOn(file) ? h('span', { class: 'used-on', title: `Used on: ${usedOn(file)}` }, usedOn(file)) : null,
              h('div', { class: 'row media-actions' },
                h('button', {
                  class: 'btn small', type: 'button',
                  onclick: async () => {
                    await navigator.clipboard.writeText(file.url).catch(() => {});
                    toast(`Copied ${file.url}`);
                  },
                }, 'Copy'),
                h('button', { class: 'btn small', type: 'button', onclick: () => renameFile(file) }, 'Rename'),
                h('button', { class: 'btn small', type: 'button', onclick: () => moveFile(file) }, 'Move'),
                h('button', {
                  class: 'btn small danger', type: 'button',
                  onclick: async () => {
                    const msg = file.used
                      ? `"${file.name}" is still used on your website. Deleting it will leave an empty spot. Delete anyway?`
                      : `Delete "${file.name}" permanently?`;
                    if (!confirm(msg)) return;
                    try {
                      await api('DELETE', `/api/media/${encodeURIComponent(file.name)}${file.used ? '?force=1' : ''}`);
                      files = files.filter((x) => x.name !== file.name);
                      mediaSelected.delete(file.name);
                      drawFolders();
                      draw();
                      syncBulk();
                      toast('Deleted.');
                    } catch (err) { toast(err.message, true); }
                  },
                }, 'Delete'))));
        }));
      syncBulk();
    };

    search.addEventListener('input', draw);
    typeSel.addEventListener('change', () => { mediaTypeFilter = typeSel.value; draw(); });
    sortSel.addEventListener('change', () => { mediaSort = sortSel.value; draw(); });

    const zone = h('div', { class: 'dropzone', style: 'margin-bottom:16px' },
      h('span', null, 'Drop files here to upload, or'),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => fileIn.click() }, 'Choose files'),
      fileIn);
    addFileDrop(zone, async (dropped) => {
      const urls = await uploadFiles(dropped);
      if (urls.length) viewMedia(container);
    });

    const total = files.reduce((n, x) => n + x.size, 0);
    mount(container,
      h('p', { class: 'intro' },
        `${files.length} files · ${formatSize(total)}. Page folders follow what is saved on the website. `
        + 'Library albums are yours to organize. Rename updates saved links; Save if you still have other unsaved edits.'),
      zone,
      h('div', { class: 'media-layout' },
        folderNav,
        h('div', { class: 'media-main' },
          h('div', { class: 'list-tools media-tools', style: 'margin-bottom:14px' },
            search, typeSel, sortSel),
          bulkBar,
          grid)));
    drawFolders();
    draw();
  }

'''

a0 = admin.index(start_marker)
a1 = admin.index(end_marker)
admin = admin[:a0] + new_media_ui + end_marker + admin[a1 + len(end_marker):]

write("admin/admin.js", admin)
print("admin.js done")

# ---------------------------------------------------------------------------
# 3) admin.css — media organize styles
# ---------------------------------------------------------------------------
backup("admin/admin.css")
css = read("admin/admin.css")
marker = "/* Picker dialog */"
extra_css = r'''
.media-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.media-tools select { width: auto; min-width: 130px; }
.media-bulk {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-bottom: 12px; padding: 8px 10px; border: 1px solid var(--line);
  border-radius: 8px; background: #f4f7fb; font-size: 13px;
}
.media-card { position: relative; }
.media-card.selected { outline: 2px solid var(--accent); outline-offset: -1px; }
.media-check {
  position: absolute; top: 8px; left: 8px; z-index: 2;
  background: rgba(255,255,255,.92); border-radius: 4px; padding: 2px 4px;
  box-shadow: 0 1px 3px rgba(10,25,47,.15);
}
.media-actions { flex-wrap: wrap; justify-content: flex-start !important; gap: 4px !important; }
.media-folder-sep {
  margin: 14px 8px 6px; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: #7a879a;
}
.media-folder-row { display: flex; align-items: center; gap: 2px; }
.media-folder-row .media-folder { flex: 1; min-width: 0; }
.btn.tiny {
  flex: none; padding: 2px 6px; font-size: 11px; line-height: 1.2;
  border-radius: 4px; min-width: 22px;
}
.pill.kind-image { background: #e8f1ff; color: #2457a6; }
.pill.kind-video { background: #f3e8ff; color: #6b21a8; }
.pill.kind-pdf { background: #ffe8e8; color: #b42318; }
.pill.kind-font { background: #e7f8ef; color: #0f7a45; }
.pill.album { background: #fff4df; color: #9a6700; }
.pdf-thumb {
  position: relative; width: 100%; height: 100%; min-height: 110px;
  background: #eef1f6; overflow: hidden;
}
.pdf-thumb iframe {
  width: 180%; height: 180%; border: 0; transform: scale(.55);
  transform-origin: top left; pointer-events: none; background: #fff;
}
.pdf-badge {
  position: absolute; right: 6px; bottom: 6px; padding: 2px 6px;
  border-radius: 4px; background: rgba(10,25,47,.78); color: #fff;
  font-size: 10px; font-weight: 600; letter-spacing: .03em;
}
.cv-pdf-frame {
  width: 100%; height: 100%; border: 0; background: #f0f2f5; pointer-events: none;
}

'''
if ".media-bulk" not in css:
    if marker not in css:
        raise SystemExit("picker dialog marker missing in css")
    css = css.replace(marker, extra_css + marker, 1)
    write("admin/admin.css", css)
else:
    print("media css already present")

# ---------------------------------------------------------------------------
# 4) canvas-editor.js — PDF iframe preview
# ---------------------------------------------------------------------------
backup("admin/canvas-editor.js")
ce = read("admin/canvas-editor.js")
old_pdf = """    if (l.type === 'pdf') {
      if (!l.src) return [h('div', { class: 'cv-placeholder' }, 'Add a PDF')];
      return [h('div', { class: 'cv-placeholder' }, 'PDF')];
    }"""
new_pdf = """    if (l.type === 'pdf') {
      if (!l.src) return [h('div', { class: 'cv-placeholder' }, 'Add a PDF')];
      return [h('iframe', {
        class: 'cv-pdf-frame',
        src: safeUrl(l.src),
        title: l.name || 'PDF',
        loading: 'lazy',
        tabindex: '-1',
      })];
    }"""
if "cv-pdf-frame" not in ce:
    if old_pdf not in ce:
        raise SystemExit("pdf placeholder block missing in canvas-editor")
    ce = ce.replace(old_pdf, new_pdf, 1)
    write("admin/canvas-editor.js", ce)
    print("canvas pdf preview updated")
else:
    print("canvas pdf preview already present")

# ---------------------------------------------------------------------------
# 5) cache bump cache4 -> cache5
# ---------------------------------------------------------------------------
for rel in [
    "admin/index.html",
    "views/partials/head.ejs",
    "views/partials/footer.ejs",
]:
    backup(rel)
    text = read(rel)
    if "cache4" in text:
        text = text.replace("cache4", "cache5")
        write(rel, text)
    elif "cache5" in text:
        print(f"{rel} already cache5")
    else:
        print(f"WARN: no cache4 in {rel}")

print("ALL DONE", BACKUP)
