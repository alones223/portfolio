# -*- coding: utf-8 -*-
"""Layers panel: Shift range / Ctrl-Cmd toggle multi-select. UTF-8 safe."""
from pathlib import Path

ROOT = Path(r"D:\portfolio")
EDITOR = ROOT / "admin" / "canvas-editor.js"
INDEX = ROOT / "admin" / "index.html"
VER = "layers-sel1"

def main():
    js = EDITOR.read_text(encoding="utf-8")
    orig = js

    # 1) Anchor next to selectedIds
    old_sel = "let selectedIds = new Set();"
    new_sel = "let selectedIds = new Set();\n    let selectionAnchorId = null;"
    if "selectionAnchorId" not in js:
        if old_sel not in js:
            raise SystemExit("selectedIds decl not found")
        js = js.replace(old_sel, new_sel, 1)

    # 2) selectOnly sets anchor
    old_only = """    function selectOnly(id) {
      selectedIds = new Set(id ? [id] : []);
      paintBoard();
      paintList();
      paintInspector();
    }"""
    new_only = """    function selectOnly(id) {
      selectedIds = new Set(id ? [id] : []);
      selectionAnchorId = id || null;
      paintBoard();
      paintList();
      paintInspector();
    }"""
    if old_only not in js:
        raise SystemExit("selectOnly block not found")
    js = js.replace(old_only, new_only, 1)

    # 3) toggleSelect updates anchor (Ctrl/Cmd click)
    old_tog = """    function toggleSelect(id) {
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      paintBoard();
      paintList();
      paintInspector();
    }"""
    new_tog = """    function toggleSelect(id) {
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      selectionAnchorId = id || null;
      paintBoard();
      paintList();
      paintInspector();
    }

    /** Layers list order (top = front). Shift+click range from anchor. */
    function selectRangeInList(id) {
      const ids = ordered().slice().reverse().map((l) => l.id);
      if (!ids.includes(id)) {
        selectOnly(id);
        return;
      }
      let a = selectionAnchorId;
      if (!a || !ids.includes(a)) a = id;
      const i0 = ids.indexOf(a);
      const i1 = ids.indexOf(id);
      const lo = Math.min(i0, i1);
      const hi = Math.max(i0, i1);
      selectedIds = new Set(ids.slice(lo, hi + 1));
      paintBoard();
      paintList();
      paintInspector();
    }"""
    if old_tog not in js:
        raise SystemExit("toggleSelect block not found")
    if "function selectRangeInList" not in js:
        js = js.replace(old_tog, new_tog, 1)

    # 4) Layer row click: Shift=range, Ctrl/Cmd=toggle, else only
    old_click = """            onclick: (e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(l.id); else selectOnly(l.id);
            },"""
    new_click = """            onclick: (e) => {
              if (e.shiftKey) selectRangeInList(l.id);
              else if (e.ctrlKey || e.metaKey) toggleSelect(l.id);
              else selectOnly(l.id);
            },"""
    if old_click not in js:
        raise SystemExit("layer row onclick not found")
    js = js.replace(old_click, new_click, 1)

    # 5) Shortcuts sheet: mention Layers panel
    old_ms = "['Multi-select', 'Shift / Ctrl / \\u2318+click'],"
    # also try already-decoded form
    old_ms2 = "['Multi-select', 'Shift / Ctrl / ⌘+click'],"
    new_ms = "['Multi-select', 'Shift / Ctrl / \\u2318+click (canvas & Layers)'],"
    new_ms2 = "['Multi-select', 'Shift / Ctrl / ⌘+click (canvas & Layers)'],"
    if old_ms in js:
        js = js.replace(old_ms, new_ms, 1)
    elif old_ms2 in js:
        js = js.replace(old_ms2, new_ms2, 1)
    elif "Multi-select" in js and "Layers" not in js[js.find("Multi-select"):js.find("Multi-select")+120]:
        # fallback: extend the keys string
        import re
        js2, n = re.subn(
            r"(\['Multi-select',\s*')([^']+)('\])",
            r"\1\2 (canvas & Layers)\3",
            js,
            count=1,
        )
        if n != 1:
            raise SystemExit("Multi-select row not patched")
        js = js2
    else:
        print("note: Multi-select already mentions Layers or missing; skipping sheet tweak")

    if js == orig:
        raise SystemExit("no changes applied")

    EDITOR.write_text(js, encoding="utf-8", newline="\n")
    print(f"patched {EDITOR}")

    # 6) Bump cache on index.html only
    html = INDEX.read_text(encoding="utf-8")
    html2 = html.replace("?v=shortcuts1", f"?v={VER}").replace("?v=layers-sel1", f"?v={VER}")
    # also if somehow already mixed
    if f"?v={VER}" not in html2:
        import re
        html2, n = re.subn(r"(\?v=)[A-Za-z0-9_-]+", rf"\1{VER}", html, count=0)
        # only touch the four admin asset lines — safer explicit
        for name in ("admin.css", "canvas.css", "canvas-editor.js", "admin.js"):
            html2 = re.sub(
                rf'({name}\?v=)[A-Za-z0-9_-]+',
                rf'\1{VER}',
                html2,
                count=1,
            )
    if html2 == html and f"?v={VER}" not in html:
        raise SystemExit("index.html version bump failed")
    INDEX.write_text(html2, encoding="utf-8", newline="\n")
    print(f"bumped index.html to ?v={VER}")

    # verify
    vjs = EDITOR.read_text(encoding="utf-8")
    assert "function selectRangeInList" in vjs
    assert "if (e.shiftKey) selectRangeInList(l.id);" in vjs
    assert "selectionAnchorId" in vjs
    vhtml = INDEX.read_text(encoding="utf-8")
    assert f"canvas-editor.js?v={VER}" in vhtml
    print("OK verify")

if __name__ == "__main__":
    main()
