
from pathlib import Path
t = Path(r"D:\portfolio\admin\canvas-editor.js").read_text(encoding="utf-8")
start = t.index("const canPanBg")
print(t[start:start+280])
assert "canPanBg && !e.altKey" in t
assert "title: locked ? 'Background is locked' :" in t
assert "\ufffd" not in t
css = Path(r"D:\portfolio\admin\admin.css").read_text(encoding="utf-8")
assert ".cv-board.has-photo:not(.bg-locked) { cursor: crosshair; }" not in css
assert ".cv-board.has-photo { cursor: grab; }" in css
idx = Path(r"D:\portfolio\admin\index.html").read_text(encoding="utf-8")
assert "bg-lock2" in idx
print("ALL CHECKS PASS")
