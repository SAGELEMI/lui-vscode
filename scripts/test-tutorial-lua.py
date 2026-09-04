"""Run shipped tutorial with production Lua 5.4 Parser/Runtime; UI/resource services are doubles.

Use a Python with lupa installed, or install it under artifacts/python.
This verifies data flow and lifecycle, not device rendering.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "artifacts/python"))
from lupa.lua54 import LuaRuntime

lua = LuaRuntime(unpack_returned_tuples=True)
adapter = ROOT / "packages/runtime-urhox-lua/adapter"
tutorial = ROOT / "examples/tutorial"

def read_source(path):
    if path == "LUI/lui.project.json":
        return (tutorial / "lui.project.json").read_text(encoding="utf-8")
    if path.startswith("Presentation/"):
        return (tutorial / path.removeprefix("Presentation/")).read_text(encoding="utf-8")
    raise ValueError(path)

def to_lua(value):
    if isinstance(value, dict):
        return lua.table_from({key: to_lua(item) for key, item in value.items()})
    if isinstance(value, list):
        return lua.table_from([to_lua(item) for item in value])
    return value

lua.globals().read_source = read_source
lua.globals().decode_json = lambda value: to_lua(json.loads(value))
lua.execute("""
cache = {
  Exists = function(_, path) return pcall(read_source, path) end,
  GetFile = function(_, path) return {
    IsOpen = function() return true end,
    ReadString = function() return read_source(path) end,
    Close = function() end,
  } end,
}
cjson = { decode = function(value) return decode_json(value) end }
local Widget = {}
function Widget:GetChildren() return self.children end
function Widget:AddChild(child) self.children[#self.children + 1] = child end
function Widget:SetStyle(props) for k,v in pairs(props) do self.props[k] = v end end
function Widget:SetText(text) self.props.text = text end
function Widget:GetLayout() return self.layout end
function Widget:GetAbsoluteLayout() return self.layout end
function Widget:Render() end
local UI = setmetatable({}, { __index = function(_, kind)
  return function(props) return setmetatable({ kind=kind, props=props or {},
    children=props and props.children or {}, layout={x=0,y=0,w=0,h=0} }, {__index=Widget}) end
end })
function UI.SetRoot(root) UI.root = root end
package.loaded['urhox-libs/UI'] = UI
package.loaded['Presentation.Components'] = {}
""")
for name in ["Controls", "Alignment", "Paths", "Properties", "Parser", "Scrollbars", "Runtime"]:
    lua.globals().package.loaded["LUI." + name] = lua.execute((adapter / (name + ".lua")).read_text(encoding="utf-8"))
lua.globals().package.loaded["LUI"] = lua.execute((adapter / "init.lua").read_text(encoding="utf-8"))
lua.globals().package.loaded["LUI.Registry"] = lua.execute((tutorial / "Registry.lua").read_text(encoding="utf-8"))
lua.globals().Tutorial = lua.execute((tutorial / "Start.lua").read_text(encoding="utf-8"))

lua.execute("""
assert(_VERSION == 'Lua 5.4')
local function descendants(root, kind, result)
  result = result or {}
  if root.kind == kind then result[#result+1] = root end
  for _, child in ipairs(root:GetChildren()) do descendants(child, kind, result) end
  return result
end
local function click(root, text)
  for _, b in ipairs(descendants(root, 'Button')) do
    if b.props.text == text then b.props.onClick(b, {}); return end
  end
  error('button not found: '..text)
end
local host = Tutorial.New()
local welcome = host.current_
assert(welcome.context_.refs.CounterText.props.text == '点击次数：0')
click(welcome:GetRoot(), '增加一次')
assert(welcome.view_.count == 1)
assert(welcome.context_.refs.CounterText.props.text == '点击次数：1')
click(welcome:GetRoot(), '查看物品')
assert(welcome.root_ == nil and welcome.context_ == nil, 'old page disposed')
local inventory = host.current_
assert(inventory.context_.refs.DetailText.props.text == '请选择物品')
assert(#descendants(inventory:GetRoot(), 'Button') == 4, 'two rows, confirm and back')
click(inventory:GetRoot(), '确认')
assert(inventory.context_.refs.DetailText.props.text == '请选择有效物品')
click(inventory:GetRoot(), '药水')
assert(inventory.view_.selectedId == 'potion')
assert(inventory.context_.refs.DetailText.props.text == '已选择：药水')
click(inventory:GetRoot(), '确认')
assert(inventory.context_.refs.DetailText.props.text == '已确认：药水', 'component event forwarded')
inventory.context_.actions.Select({ id='key', title='forged' })
assert(inventory.view_.selectedId == 'potion', 'only original item accepted')
inventory.view_.rows = {}
inventory.context_.actions.Confirm()
assert(inventory.view_.selectedId == '' and inventory.view_.detail == '请选择有效物品')
-- Structural changes need a deliberate rebuild; the document contains no empty placeholder.
local emptyRoot = assert(host.runtime_:RenderMarkup(inventory.descriptor_.markup, inventory:CreateContext()))
assert(#descendants(emptyRoot, 'Button') == 2)
local first = host.runtime_:CreateComponent('Presentation/Components/ActionCard.lui', inventory.context_, {['确认']='{动作 Confirm}'}, {})
local second = host.runtime_:CreateComponent('Presentation/Components/ActionCard.lui', inventory.context_, {['标题']='另一卡片',['确认']='{动作 Confirm}'}, {})
assert(first.props_['标题'] == '操作' and second.props_['标题'] == '另一卡片')
assert(first.context_.refs ~= second.context_.refs, 'refs belong to each instance')
first:Dispose(); second:Dispose()
click(inventory:GetRoot(), '返回')
assert(inventory.root_ == nil and host.current_.view_.count == 0)
host:Dispose()
assert(host.current_ == nil)
""")
print("Lua 5.4 tutorial passed: production parsing/loading, page initialization, count refresh, directory component, event forwarding, original row identity, empty list, invalid selection, per-instance refs and disposal (UI stubbed).")
