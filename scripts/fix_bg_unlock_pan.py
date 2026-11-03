# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"D:\portfolio")
ce = ROOT / "admin" / "canvas-editor.js"
css = ROOT / "admin" / "admin.css"
idx = ROOT / "admin" / "index.html"

text = ce.read_text(encoding="utf-8")
orig = text

# 1) Restore plain-drag photo pan when unlocked; Alt+drag = marquee when unlocked+photo
old_ptr = """          const onBoard = e.target.closest('.cv-board');
          // Alt + drag slides an unlocked background photo; plain drag rubber-bands.
          if (onBoard && section.canvasImage && !section.backgroundLocked && e.altKey) {
            selectOnly(null);
            beginPhotoPan(e);
          } else {
            beginMarquee(e);
          }"""

new_ptr = """          const onBoard = e.target.closest('.cv-board');
          // Unlocked + photo: plain drag slides the photo (pre-lock behavior).
          // Alt+drag (or locked / no photo) rubber-band selects layers.
          const canPanBg = Boolean(onBoard && section.canvasImage && !section.backgroundLocked);
          if (canPanBg && !e.altKey) {
            selectOnly(null);
            beginPhotoPan(e);
          } else {
            beginMarquee(e);
          }"""

if old_ptr not in text:
    raise SystemExit("onPointerDown pan/marquee branch not found")
text = text.replace(old_ptr, new_ptr, 1)

# 2) Hint copy
old_hint = """            : 'Drag empty board to rubber-band select layers. Hold Alt and drag to slide the photo. Across and Down also move it. Drag the bottom edge to change height.')"""
new_hint = """            : 'Drag empty board to slide the photo. Hold Alt and drag to rubber-band select layers. Across and Down also move it. Drag the bottom edge to change height.')"""
if old_hint not in text:
    raise SystemExit("unlocked hint not found")
text = text.replace(old_hint, new_hint, 1)

# Locked hint can stay mostly; make clear unlock restores drag-to-slide
old_locked_hint = """            ? 'Background is locked. Unlock to replace it or slide it. Drag an empty part of the board to rubber-band select layers. Drag the bottom edge to change height.'"""
new_locked_hint = """            ? 'Background is locked — cannot move, replace, or remove. Drag empty board to rubber-band select layers. Unlock to slide or change the photo. Drag the bottom edge to change height.'"""
if old_locked_hint not in text:
    raise SystemExit("locked hint not found")
text = text.replace(old_locked_hint, new_locked_hint, 1)

if text == orig:
    raise SystemExit("no canvas-editor changes")
ce.write_text(text, encoding="utf-8", newline="\n")
print("canvas-editor.js OK")

# 3) CSS: do not force crosshair when unlocked; keep grab for has-photo
css_text = css.read_text(encoding="utf-8")
old_css = """.cv-board.bg-locked { cursor: crosshair; }
.cv-board.has-photo:not(.bg-locked) { cursor: crosshair; }
.cv-imgrow .btn[disabled], .cv-thumb[disabled] { opacity: 0.45; pointer-events: none; cursor: not-allowed; }"""
new_css = """.cv-board.bg-locked { cursor: crosshair; }
.cv-board.bg-locked.has-photo { cursor: crosshair; }
.cv-imgrow .btn[disabled], .cv-thumb[disabled] { opacity: 0.45; pointer-events: none; cursor: not-allowed; }"""
if old_css not in css_text:
    raise SystemExit("css lock cursor block not found")
css.write_text(css_text.replace(old_css, new_css, 1), encoding="utf-8", newline="\n")
print("admin.css OK")

# 4) Cache bust
idx_text = idx.read_text(encoding="utf-8")
if "bg-lock1" not in idx_text and "bg-lock2" not in idx_text:
    raise SystemExit(f"unexpected cache tags in index.html")
idx_text2 = idx_text.replace("bg-lock1", "bg-lock2")
if idx_text2 == idx_text and "bg-lock2" in idx_text:
    print("index.html already bg-lock2")
else:
    idx.write_text(idx_text2, encoding="utf-8", newline="\n")
    print("index.html -> bg-lock2")

print("DONE")
