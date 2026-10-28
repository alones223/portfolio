# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"D:\portfolio\admin\canvas-editor.js")
t = p.read_text(encoding="utf-8")
orig = t

# Restore short thumb title
old_title = "title: locked ? 'Background is locked - cannot move, replace, or remove. Drag empty board to rubber-band select layers. Unlock to slide or change the photo. Drag the bottom edge to change height.' : 'Click to choose an image, or drop a file here',"
new_title = "title: locked ? 'Background is locked' : 'Click to choose an image, or drop a file here',"
if old_title not in t:
    # maybe already short
    if "title: locked ? 'Background is locked' :" in t:
        print("thumb title already short")
    else:
        raise SystemExit("thumb title pattern not found")
else:
    t = t.replace(old_title, new_title, 1)
    print("thumb title restored")

# Fix locked board hint: match line containing Background is locked and cannot move inside cv-hint ternary
# Find the bgLocked hint specifically (indented with ? ')
import re
# Match the ternary branch for bgLocked hint - the long one after bgLocked
pat = re.compile(
    r"(bgLocked\s*\n\s*\? ')Background is locked.*?(')",
    re.DOTALL,
)
m = pat.search(t)
if not m:
    raise SystemExit("bgLocked hint branch not found")
print("matched hint:", repr(m.group(0)[:120]))
repl = m.group(1) + "Background is locked - cannot move, replace, or remove. Drag empty board to rubber-band select layers. Unlock to slide or change the photo. Drag the bottom edge to change height." + m.group(2)
t2, n = pat.subn(repl, t, count=1)
if n != 1:
    raise SystemExit(f"hint replace count {n}")
t = t2
print("locked hint fixed")

if t == orig:
    print("WARNING no net change")
p.write_text(t, encoding="utf-8", newline="\n")

# verify
lines = t.splitlines()
for i in (1822, 2285):
    print(i+1, repr(lines[i][:130]))
print("OK")
