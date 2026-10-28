# -*- coding: utf-8 -*-
from pathlib import Path
import re
p = Path(r"D:\portfolio\admin\canvas-editor.js")
t = p.read_text(encoding="utf-8")
pat = re.compile(r"\? 'Background is locked[^']*'")
repl = "? 'Background is locked - cannot move, replace, or remove. Drag empty board to rubber-band select layers. Unlock to slide or change the photo. Drag the bottom edge to change height.'"
nt, n = pat.subn(repl, t, count=1)
print("replacements", n)
if n != 1:
    # show nearby lines for debug
    for i, line in enumerate(t.splitlines(), 1):
        if "Background is locked" in line:
            print(i, repr(line[:160]))
    raise SystemExit("failed")
p.write_text(nt, encoding="utf-8", newline="\n")
print("hint fixed OK")
