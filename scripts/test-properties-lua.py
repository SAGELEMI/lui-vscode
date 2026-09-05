"""Execute production property/path/parser/runtime context code on Lua 5.4.
UI is stubbed: verifies data and lifecycle interfaces, not NanoVG rendering.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path('artifacts/python').resolve()))
from lupa import LuaRuntime
lua=LuaRuntime(unpack_returned_tuples=True)
adapter=Path('packages/runtime-urhox-lua/adapter')
lua.globals().read_adapter=lambda name:(adapter/(name+'.lua')).read_text(encoding='utf-8-sig')
lua.execute('''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=="LUI." then return assert(load(read_adapter(name:sub(5)),"@"..name)) end
end)
package.loaded['urhox-libs/UI']={}
package.loaded['urhox-libs/UI/Core/Widget']={ResolveGradientDirection=function(_,x,y,w,h)return x,y,x+w,y end}
package.loaded['Presentation.Components']={}
''')
runtime=lua.execute((adapter/'Runtime.lua').read_text(encoding='utf-8'))
lua.globals().Runtime=runtime
lua.execute('''
local Typography=require('LUI.Typography')
local draws=0
nvgFillColor=function() end
nvgRGBA=function(r,g,b,a) return {r,g,b,a} end
nvgText=function() draws=draws+1 end
assert(Typography.TextRasterMode()=="nanovg-single-pass")
assert(Typography.InkCompensation({fontWeight="bold"})==0)
assert(Typography.DrawSingleLine({},1,2,"清晰",{255,255,255,255},{fontWeight="bold"})==0 and draws==1)
local Measure=require('LUI.Measure')
local nativeLeaf={props={height=40,minWidth=80},GetLayout=function() return {w=0,h=0} end}
local measuredWidth,measuredHeight=Measure.Leaf(nativeLeaf,nil)
assert(measuredWidth==80 and measuredHeight==40)
local minimumLeaf={props={minWidth=72,minHeight=24},GetLayout=function() return {w=0,h=0} end}
measuredWidth,measuredHeight=Measure.Leaf(minimumLeaf,nil)
assert(measuredWidth==72 and measuredHeight==24)
local P=require('LUI.Properties'); local Paths=require('LUI.Paths')
local schema={ ["标题"]={type="string",default="默认"}, ["Title"]={type="number",default=3}, ["启用"]={type="boolean",default=false}, ["条目"]={type="table",default={{text="一"}}}, ["确认"]={type="event"} }
local a=P.Apply(schema,{["确认"]="{动作 Confirm}"}); local b=P.Apply(schema,{})
assert(a["标题"]=="默认" and a.Title==3 and a["启用"]==false)
a["条目"][1].text="改"; assert(b["条目"][1].text=="一")
assert(P.Apply(schema,{Title="9",["启用"]="是"}).Title==9)
assert(not pcall(P.Apply,schema,{["未声明"]="1"}))
assert(not pcall(P.Apply,schema,{Title="坏"}))
assert(not pcall(P.Apply,{["宽度"]={type="number"}},{}))
local data={props={["标题"]="原",nested={["内容"]="深"}}}
assert(Paths.Get(data,"props['标题']")=="原")
assert(Paths.Set(data,"props['标题']","新")); assert(data.props["标题"]=="新")
assert(Paths.Get(data,"props.nested['内容']")=="深")
assert(not Paths.Keys("props[os.execute('bad')]"))
local runtime=setmetatable({},Runtime)
local notices={}; local context=assert(runtime:CreateMarkupContext({attrs={}}, {props=data.props,OnBindingChanged=function(path) notices[#notices+1]=path end}))
context.bindings.pending["props['标题']"]="提交"
assert(context.bindings:Commit("props['标题']")); assert(context.props["标题"]=="提交")
assert(notices[1]=="props['标题']")
context.bindings.pending["props['标题']"]=false
assert(context.bindings:Commit("props['标题']")); assert(context.props["标题"]==false)
-- Component constructor receives defaults before initialization, exact UTF-8 props and slots.
local calls=0
runtime.LoadCode=function() return {Properties=schema,New=function(parent,rt,descriptor,props,slots)
  calls=calls+1; assert(props["标题"]=="默认" and props.Title==8 and props["确认"]=="{动作 Confirm}")
  assert(slots.Content[1]=="内容"); return {props=props} end} end
local instance=runtime:CreateComponent('Components/C.lui',context,{Title='legacy'}, {Content={'内容'}},{Title='8',["确认"]='{动作 Confirm}'})
assert(calls==1 and instance.props.Title==8)
runtime.LoadCode=function() return {Properties={["文本"]={type="string"}},New=function(_,_,_,props) return {props=props} end} end
local parent=assert(runtime:CreateMarkupContext({attrs={}}, {view={value="父级"},OnBindingChanged=function(path) notices[#notices+1]=path end}))
local linked=runtime:CreateComponent('C.lui',parent,{}, {},{["文本"]="父级"},{["文本"]="{绑定 view.value, 模式=双向}"})
local child=assert(runtime:CreateMarkupContext({attrs={}}, {props=linked.props}))
child.bindings.pending["props['文本']"]="子级提交"; assert(child.bindings:Commit("props['文本']"))
assert(parent.view.value=="子级提交" and notices[#notices]=="view.value")
parent.view.value="父级刷新"; assert(linked.props["文本"]=="父级刷新")
local once=runtime:CreateComponent('C.lui',parent,{}, {},{["文本"]="快照"},{["文本"]="{绑定 view.value, 模式=单次}"})
assert(once.props["文本"]=="快照")
''')
print('Lua 5.4: single-pass text, native leaf sizing, exact UTF-8 properties, bindings and component initialization passed (UI stubbed).')
