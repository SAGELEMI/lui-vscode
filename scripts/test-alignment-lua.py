"""Compare production Lua Axis with frames measured by the real Studio browser test.

Requires lupa (Lua 5.4); this tests arrangement arithmetic, not engine Yoga/NanoVG.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('artifacts/python').resolve()))
from lupa import LuaRuntime

lua = LuaRuntime(unpack_returned_tuples=True)
axis = lua.execute(Path('packages/runtime-urhox-lua/adapter/Alignment.lua').read_text(encoding='utf-8')).Axis
report = json.loads(Path('artifacts/vscode-document-2.3.2.json').read_text(encoding='utf-8'))
for case in report['alignment']:
    horizontal = case['value'] if case['axis'] == '水平对齐' else '拉伸'
    vertical = case['value'] if case['axis'] == '垂直对齐' else '左'
    x, w = axis(5, 286, 40, 40, 0, None, vertical)
    y, h = axis(7, 162, 20, 20, 0, None, horizontal)
    for key, value in dict(x=x, y=y, width=w, height=h).items():
        assert abs(value - case[key]) <= 1, (case, key, value)
assert axis(0, 300, 20, None, 0, None, '拉伸') == (0, 300)
assert axis(0, 300, 20, None, 60, 120, '居中') == (120, 60)
assert axis(0, 300, 20, 200, 60, 120, '右') == (180, 120)
print(f'Lua {lua.eval("_VERSION")}: {len(report["alignment"])} browser frames match; auto/min/max checks passed.')
