"""Layout algebra regression (not Yoga/visual acceptance).
Usage: python tests/runtime-layout-math.py <adapter> <lupa-package-directory>
Real-engine acceptance lives in adapter/LayoutChecks.lua and must run separately.
"""
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[2])
from lupa.lua54 import LuaRuntime

adapter = Path(sys.argv[1])
lua = LuaRuntime(unpack_returned_tuples=True)
lua.globals().adapter_read = lambda name: (adapter / name).read_text(encoding="utf-8-sig")
lua.execute(r'''
table.insert(package.searchers, 1, function(name)
    if name:sub(1,4) == "LUI." then return assert(load(adapter_read(name:sub(5)..".lua"),"@"..name)) end
end)
local Widget={}
function Widget:GetChildren() return self.children end
function Widget:GetLayout() return {x=0,y=0,w=17,h=19} end
function Widget:GetAbsoluteLayout()
    local l=self:GetLayout()
    if self.renderOffsetX_ then return {x=self.renderOffsetX_,y=self.renderOffsetY_,w=self.renderWidth_,h=self.renderHeight_} end
    return l
end
function Widget:AddChild(child) self.children[#self.children+1]=child; child.parent=self end
function Widget:Render() end
function Widget:SetStyle(props) for k,v in pairs(props) do self.props[k]=v end end
function Widget:SetText(text) self.props.text=text end
function Widget:SetVisible(value) self.props.visible=value end
function Widget:GetRenderChildren() return self.children end
function Widget.ResolveGradientDirection(direction,x,y,w,h)
    local radians=math.rad((tonumber(direction) or 90)-90)
    local dx,dy=math.cos(radians),math.sin(radians)
    local cx,cy=x+w/2,y+h/2
    local extent=math.abs(dx)*w/2+math.abs(dy)*h/2
    return cx-dx*extent,cy-dy*extent,cx+dx*extent,cy+dy*extent
end
local function make(props)
    local self=setmetatable({props=props or {},children={}},{__index=Widget})
    for _,child in ipairs(self.props.children or {}) do self:AddChild(child) end
    return self
end
package.loaded["urhox-libs/UI/Core/Widget"]=Widget
local drawCalls={}
for _,name in ipairs({"nvgSave","nvgRestore","nvgIntersectScissor","nvgFontFace","nvgFontSize","nvgTextLetterSpacing","nvgFillColor","nvgTextAlign","nvgText"}) do
 _G[name]=function(...) drawCalls[name]={...} end
end
function nvgRGBA(...) return {...} end
NVG_ALIGN_LEFT,NVG_ALIGN_CENTER_VISUAL,NVG_ALIGN_RIGHT,NVG_ALIGN_MIDDLE=1,2,4,16
local UI={Panel=make,Label=make,Button=make,ScrollView=make,Theme={FontSize=function(v) return v*4/3 end,FontFace=function() return "sans" end}}
function UI.MeasureTextFit(text, options)
    local size=options.fontSize
    local natural=utf8.len(text)*size/2
    local width=options.width or natural
    local lines=options.multiline and math.max(1,math.ceil(natural/math.max(1,width))) or 1
    return {width=math.min(natural,width),height=text=="" and 0 or size*(options.lineHeight or 1)*lines}
end
function UI.MeasureTextWidth(text,size) return utf8.len(text)*size/2 end
package.loaded["urhox-libs/UI"]=UI
package.loaded["Presentation.Components"]={}
local Runtime=require("LUI.Runtime")
local Parser=require("LUI.Parser")
local runtime=setmetatable({isV2_=true,config_={componentDirectories={}}},Runtime)
local liveSource={view={value="初始"}}
local componentRuntime=setmetatable({
 isV2_=true,
 LoadCode=function()
  return {Properties={["值"]={type="string",default="默认"}},New=function(_,_,_,props) return props end}
 end,
},Runtime)
local liveProps=componentRuntime:CreateComponent("virtual.lui",liveSource,{["值"]="初始"},nil,
 {["值"]="初始"},{["值"]="{绑定 view.value, 模式=单向}"})
assert(liveProps["值"]=="初始","component binding reads current source")
liveSource.view.value=""
assert(liveProps["值"]=="","empty string is a value")
liveSource.view.value=nil
assert(liveProps["值"]=="默认","nil returns schema default instead of construction snapshot")
local compositeDoc=assert(Parser.Parse('<控件 名称="Composite"><按钮><文本 文本="条目" /></按钮></控件>', 'composite.lui'))
local composite=runtime:BuildNode(compositeDoc.children[1], {})
assert(composite.props.text=="", "composite must not draw the fallback button label")
local titledDoc=assert(Parser.Parse('<控件 名称="Titled"><按钮 文本="标题"><文本 文本="副文" /></按钮></控件>', 'titled.lui'))
local titled=runtime:BuildNode(titledDoc.children[1], {})
assert(titled.props.text=="标题", "composite retains explicitly authored title")
assert(titled.children[1].props.fontWeight=="bold","composite child text inherits button weight")
local function render(widget)
    if widget.props.visible==false or widget.props.visibility=="hidden" then return end
    widget:Render(0)
    if widget.CustomRenderChildren then widget:CustomRenderChildren(0,function(child)render(child)end)
    else for _,child in ipairs(widget:GetChildren()) do render(child) end end
end
local function near(a,b,label) assert(math.abs(a-b)<0.001,label..": "..tostring(a).." != "..tostring(b)) end
-- Real adapter text calls, all nine anchors in the border+padding content box.
for xi,x in ipairs({"左","居中","右"}) do for yi,y in ipairs({"上","居中","下"}) do
 local d=assert(Parser.Parse('<控件 名称="Caption"><按钮 文本="对齐" 宽度="200" 高度="80" 字号="20" 内边距="10,7,20,11" 边框宽度="2" 文字左右对齐="'..x..'" 文字上下对齐="'..y..'" /></控件>'))
 local button=runtime:BuildNode(d.children[1],{})
 function button:GetAbsoluteLayout() return {x=30,y=40,w=200,h=80} end
 button:Render(0)
 near(drawCalls.nvgText[2],42+166*(xi-1)/2,"caption x")
 near(drawCalls.nvgText[3],49+(58-29)*(yi-1)/2+29/2,"caption y")
 assert(drawCalls.nvgText[4]=="对齐" and button.props.text=="对齐","caption restored after native render")
 assert(drawCalls.nvgIntersectScissor[4]==166 and drawCalls.nvgIntersectScissor[5]==58,"content clipping")
 button.props.disabled=true; button:Render(0)
 assert(drawCalls.nvgFillColor[2][1]==158,"disabled caption color")
end end
local capContext={view={x="左",y="上",title="初始"}}
local capDoc=assert(Parser.Parse('<控件 名称="LiveCaption"><按钮 文本="{绑定 view.title}" 文字左右对齐="{绑定 view.x}" 文字上下对齐="{绑定 view.y}" /></控件>'))
local liveCaption=runtime:BuildNode(capDoc.children[1],capContext)
function liveCaption:GetAbsoluteLayout() return {x=0,y=0,w=300,h=90} end
liveCaption:Render(0); capContext.view.x="右";capContext.view.y="下";capContext.view.title="更新后的长文字"
liveCaption:Render(0)
assert(liveCaption.props.textHorizontalAlignment=="右" and liveCaption.props.textVerticalAlignment=="下")
assert(drawCalls.nvgText[4]=="更新后的长文字","caption binding refresh")
capContext.view.x="invalid"
assert(not pcall(function()liveCaption:Render(0)end),"invalid bound alignment is reported")
-- Never leak the temporary blank caption on a native-render failure.
local broken=make({text="keep"});function broken:Render()error("native failure")end
require("LUI.ButtonCaption").Attach(broken)
assert(not pcall(function()broken:Render(0)end) and broken.props.text=="keep")
local singleContext={view={x="左"}}
local onceDoc=assert(Parser.Parse('<控件 名称="Once"><按钮 文本="单次" 文字左右对齐="{绑定 view.x, 模式=单次}" /></控件>'))
local onceCaption=runtime:BuildNode(onceDoc.children[1],singleContext)
singleContext.view.x="右";onceCaption:Render(0)
assert(onceCaption.props.textHorizontalAlignment=="左","single binding does not refresh")
local sizeContext={view={title="短"},refs={}}
local sizeDoc=assert(Parser.Parse('<控件 名称="Sized"><按钮 引用="caption" 文本="{绑定 view.title}" 垂直对齐="左" /></控件>'))
local sizeRoot=runtime:BuildNode(sizeDoc,sizeContext)
function sizeRoot:GetAbsoluteLayout()return{x=0,y=0,w=300,h=80}end
sizeRoot:Render(0)
local beforeWidth=sizeContext.refs.caption:GetLayout().w
sizeContext.view.title="更新文字后立即重新测量"
sizeRoot:Render(0)
assert(sizeContext.refs.caption:GetLayout().w>beforeWidth,"bound title invalidates root cache in the same frame")
local Contract=require("LUI.Contract")
assert(Contract.defaults.lineHeight==1.45,"shared line-height contract")
assert(Contract.defaults.button.minHeight==36,"shared button height contract")
assert(Contract.defaults.scroll.scrollbarThickness==8,"shared scrollbar contract")
assert(Contract.renderFidelity.borderAlign=="inside" and Contract.renderFidelity.defaultBoxShadow==false,"shared border and shadow contract")
assert(Contract.renderFidelity.typography.fontSynthesis=="none","shared typography contract")
local document=assert(Parser.Parse([[
<控件 名称="Math" 宽度="340" 高度="794">
 <容器 子项排列="垂直" 垂直间隔="10">
  <容器 引用="header" 高度="40">
   <文本 引用="caption" 文本="title" 字号="20" 水平对齐="居中" 垂直对齐="左" />
   <按钮 引用="back" 文本="back" 宽度="52" 高度="36" 水平对齐="居中" 垂直对齐="右" />
  </容器>
  <容器 引用="main" 填充="是" 子项排列="垂直" 垂直间隔="10">
   <卡片 高度="90" />
   <滚动区 引用="scroll" 填充="是" 最小高度="0" 垂直滚动条可见性="显示"><容器 引用="scrollContent" 高度="1200" /></滚动区>
   <卡片 高度="100" />
  </容器>
  <容器 引用="bottom" 高度="36" 子项排列="水平" 水平间隔="6">
   <按钮 引用="a" 文本="A" 填充="是" /><按钮 引用="b" 文本="B" 填充="是" />
  </容器>
 </容器>
</控件>]],"math.lui"))
local refs={}
local root=runtime:BuildNode(document,{refs=refs})
assert(runtime:FindByRef(root,"back")==refs.back,"runtime can find a stable authored reference")
assert(runtime:GetReferenceRect(root,"missing")==nil,"missing references are safe")
require("LUI.Measure").Frame(root,0,0,340,794)
for frame=1,30 do
 render(root)
 near(refs.back:GetLayout().x,288,"right")
 near(refs.back:GetLayout().y,2,"middle Y")
 near(refs.main:GetLayout().h,698,"fill")
 near(refs.scroll:GetLayout().h,488,"scroll fill")
 near(refs.scrollContent:GetLayout().w,314,"visible scrollbar reserves an 8px content gutter")
 near(refs.bottom:GetLayout().y,758,"fixed bottom")
 near(refs.a:GetLayout().w,167,"equal A")
 near(refs.b:GetLayout().w,167,"equal B")
 assert(refs.main.props.width==nil and refs.main.props.height==nil,"arrange must not mutate declarations")
end
local Measure=require("LUI.Measure")
local warm=Measure.stats.measurements
for frame=1,60 do render(root) end
assert(Measure.stats.measurements==warm,"idle frames must not measure again")
refs.caption:SetText("updated title")
render(root)
assert(Measure.stats.measurements>warm,"text update must invalidate ancestor measurements")
near(refs.caption:GetLayout().w,130,"updated intrinsic text width")
near(refs.caption.luiTextLayout_.logicalLineHeight,29,"20px text uses 1.45 line box")
runtime.fontFiles_={["sans:normal"]="Fonts/LUI/MiSans-Regular.ttf",["sans:bold"]="Fonts/LUI/MiSans-Bold.ttf"}
refs.caption.props.fontFamily,refs.caption.props.fontWeight="sans","bold"
local nodes=runtime:LayoutProbe(root)
local ids={}
for _,node in ipairs(nodes) do
 if node.sourcePath then assert(node.nodePath and not ids[node.instancePath],"stable unique instance identity"); ids[node.instancePath]=true end
 if node.fontFile=="Fonts/LUI/MiSans-Bold.ttf" then
  assert(node.dpr==1 and node.resolvedFontWeight=="bold","probe reports DPR and resolved font")
  assert(node.borderAlign=="inside" and node.colorSpace=="srgb" and node.alphaMode=="straight","probe reports rendering fidelity")
 end
end
local equipmentDoc=assert(Parser.Parse([[
<控件 名称="Equipment" 宽度="200" 高度="56">
 <容器 子项排列="水平" 水平间隔="4">
  <按钮 引用="weapon" 填充="是" 子项排列="自由" 内边距="8,5,8,5">
   <文本 引用="weaponTitle" 文本="武器槽" 字号="10" 垂直对齐="右" 水平对齐="上" />
   <容器 引用="weaponInfo" 宽度="75%" 垂直对齐="左" 水平对齐="上" 子项排列="垂直" 垂直间隔="1">
    <文本 引用="weaponName" 文本="示例武器" 字号="14" /><文本 引用="weaponStatus" 文本="等级 1 · 武器" 字号="10" />
   </容器>
  </按钮>
  <按钮 引用="armor" 填充="是" 子项排列="自由" 内边距="8,5,8,5"><文本 文本="护甲槽" 字号="10" 垂直对齐="右" 水平对齐="上" /></按钮>
 </容器>
</控件>]],"equipment.lui"))
local equipmentRefs={}
local equipment=runtime:BuildNode(equipmentDoc,{refs=equipmentRefs})
require("LUI.Measure").Frame(equipment,0,0,200,56)
for frame=1,3 do render(equipment) end
assert(equipmentRefs.weaponTitle:GetLayout().x > equipmentRefs.weaponInfo:GetLayout().x,"slot title anchors right of information")
near(equipmentRefs.weaponName:GetLayout().y,0,"name starts at information top")
assert(equipmentRefs.weaponStatus:GetLayout().y >= equipmentRefs.weaponName:GetLayout().h + 1,"information rows flow vertically")
assert(equipmentRefs.weapon.props.height==nil,"composite button remains content-measured")
local plainDoc=assert(Parser.Parse('<控件 名称="Plain"><按钮 引用="plain" 文本="按钮" /></控件>',"plain.lui"))
local plainRefs={}; runtime:BuildNode(plainDoc,{refs=plainRefs})
near(plainRefs.plain.props.height,36,"native theme cannot inject 44px into plain button")
assert(plainRefs.plain.props.borderAlign=="inside" and plainRefs.plain.props.boxShadow==false,"all visual controls opt into inside borders and contract shadows")
-- Percentages are relative to the parent once, in both flow directions.
local percentDoc=assert(Parser.Parse([[
<控件 名称="Percent"><容器 引用="flow" 子项排列="水平">
 <容器 引用="half" 宽度="50%" 子项排列="垂直"><文本 引用="text" 文本="abcdefghijabcdefghij" 字号="20" /></容器>
</容器></控件>]],"percent.lui"))
local percentRefs={}; local percent=runtime:BuildNode(percentDoc,{refs=percentRefs})
for _,width in ipairs({200,400,300,200}) do
 Measure.Frame(percent,0,0,width,100); render(percent)
 near(percentRefs.half:GetLayout().w,width/2,"parent-relative percent width")
 near(percentRefs.text:GetLayout().w,width/2,"text uses allocated width")
end
local nestedDoc=assert(Parser.Parse('<控件 名称="Nested"><容器 宽度="50%"><容器 引用="inner" 宽度="50%" /></容器></控件>',"nested.lui"))
local nestedRefs={}; local nested=runtime:BuildNode(nestedDoc,{refs=nestedRefs})
Measure.Frame(nested,0,0,400,100); render(nested); near(nestedRefs.inner:GetLayout().w,100,"nested percent applies once per parent")
UI.Slider=make; UI.Toggle=make; UI.ProgressBar=make
local called={}
local eventsContext={view={click=function(row) called.row=row end, change=function(value) called.value=value end,min=10,max=80},item={id="original"},refs={}}
local eventsDoc=assert(Parser.Parse([[
<控件 名称="Events"><按钮 引用="button" 点击="{绑定 view.click}" /><滑块 引用="slider" 最小值="{绑定 view.min}" 最大值="{绑定 view.max}" 变更="{绑定 view.change}" /></控件>
]],"events.lui"))
runtime:BuildNode(eventsDoc,eventsContext)
eventsContext.refs.button.props.onClick({},{}); assert(called.row==eventsContext.item,"bound function keeps original row")
assert(eventsContext.refs.slider.props.min==10 and eventsContext.refs.slider.props.max==80,"slider resolves bound limits")
eventsContext.refs.slider.props.onChange({},42); assert(called.value==42,"bound change function")
local properties=require("LUI.Properties").Apply({["点击"]={type="event"}},{["点击"]=eventsContext.view.click})
assert(properties["点击"]==eventsContext.view.click,"public event function survives forwarding")
local importedDoc=assert(Parser.Parse('<控件 名称="Imported" 高度="56" 内边距="8"><文本 文本="root" /></控件>',"imported.lui"))
local importer=setmetatable({isV2_=true,config_={componentDirectories={}},
 LoadDirectoryComponent=function() return importedDoc,nil,"imported.lui" end,
 CreateComponent=function(self) local root=self:BuildNode(importedDoc,{}); return {GetRoot=function() return root end} end},Runtime)
local importDoc=assert(Parser.Parse('<控件 名称="Outer"><s:Imported /></控件>',"outer.lui"))
local imported=importer:BuildNode(importDoc,{imports={s="sample"}})
Measure.Frame(imported,0,0,400,80); render(imported)
local inner=imported.children[1].children[1]
near(inner:GetLayout().h,56,"import preserves root declared height")
near(inner:GetLayout().w,400,"import stretches automatic root width")
near(inner.children[1]:GetLayout().x,8,"import preserves root padding")
local draws={}
nvgRGBA=function(...) return {...} end
nvgBeginPath=function() end; nvgRoundedRect=function(_,x,y,w,h,r) draws[#draws+1]={w=w,h=h,r=r} end
nvgFillColor=function(_,c) draws[#draws].color=c end; nvgFill=function() end
nvgLinearGradient=function(_,x,y,ex,ey,from,to) return {x=x,ex=ex,from=from,to=to} end
nvgFillPaint=function(_,paint) draws[#draws].paint=paint end
local progressDoc=assert(Parser.Parse('<控件 名称="Progress"><进度条 引用="bar" 值="50" /></控件>',"progress.lui"))
local progressRefs={}; local progress=runtime:BuildNode(progressDoc,{refs=progressRefs})
Measure.Frame(progressRefs.bar,0,0,200,10); progressRefs.bar:Render(0)
near(draws[2].w,100,"default max matches Studio's 100")
assert(draws[1].color[1]==57 and draws[2].paint.from[1]==139 and draws[2].paint.to[1]==213,"shared gradient and track reach draw calls")
progressRefs.bar.props.value=0; draws={}; progressRefs.bar:Render(0); assert(#draws==1,"empty progress has track only")
progressRefs.bar.props.value=200; draws={}; progressRefs.bar:Render(0); near(draws[2].w,200,"progress clamps overflow")
-- Actual adapter arrangement, not constructor-only assertions.
for _,mode in ipairs({"垂直","水平","自由"}) do
 local context={view={show=false},refs={}}
 local doc=assert(Parser.Parse('<控件 名称="Collapse"><容器 引用="group" 子项排列="'..mode..'" 垂直间隔="10" 水平间隔="10"><容器 引用="optional" 宽度="60" 高度="60" 可见性="{绑定 view.show}"/><容器 引用="fixed" 宽度="30" 高度="30"/></容器></控件>'))
 local root=runtime:BuildNode(doc,context);Measure.Frame(root,0,0,300,200);render(root)
 local original=context.refs.optional
 near(context.refs.optional:GetLayout().h,0,'collapsed zero frame')
 local _,height=context.refs.group:luiMeasure_(300,200)
 near(height,30,'collapsed excluded from intrinsic height')
 context.view.show=true;render(root)
 assert(context.refs.optional==original and context.refs.optional:GetLayout().h==60,'expand preserves identity')
 context.view.show=false;render(root);near(context.refs.optional:GetLayout().h,0,'collapse again')
end
local context={view={left=21,top=296,width=348,height=56},refs={}}
local canvasDoc=assert(Parser.Parse('<控件 名称="CanvasTest"><画布><容器 引用="hole" 画布.左="{绑定 view.left}" 画布.上="{绑定 view.top}" 宽度="{绑定 view.width}" 高度="{绑定 view.height}"/></画布></控件>'))
local canvasRoot=runtime:BuildNode(canvasDoc,context);Measure.Frame(canvasRoot,0,0,390,800)
for frame=1,4 do render(canvasRoot);local box=context.refs.hole:GetAbsoluteLayout();near(box.x,21,'canvas x survives render');near(box.y,296,'canvas y survives render');near(box.w,348,'canvas bound width');near(box.h,56,'canvas bound height') end
context.view.left=35;context.view.width=100;render(canvasRoot);near(context.refs.hole:GetAbsoluteLayout().x,35,'canvas refreshes coordinates')
local calledAfter=false
runtime:AfterLayout(canvasRoot,function()near(context.refs.hole:GetAbsoluteLayout().x,35,'layout completion follows children');calledAfter=true end)
render(canvasRoot);assert(calledAfter,'after-layout callback executes')
-- Data-to-view refresh must apply scalar values, not merely invalidate layout.
UI.TextField=make
local live={view={text='起始标题',tint='#112233',fill='#334455',disabled=false},refs={}}
local liveDoc=assert(Parser.Parse('<控件 名称="Live"><容器 子项排列="垂直"><文本 引用="label" 文本="{绑定 view.text}" 颜色="{绑定 view.tint}"/><文本 引用="once" 文本="{绑定 view.text, 模式=单次}"/><按钮 引用="button" 文本="{绑定 view.text}" 背景="{绑定 view.fill}" 禁用="{绑定 view.disabled}"/><文本框 引用="input" 文本="{绑定 view.text}" 颜色="{绑定 view.tint}"/></容器></控件>'))
local liveRoot=runtime:BuildNode(liveDoc,live);Measure.Frame(liveRoot,0,0,390,800);render(liveRoot)
local input=live.refs.input
input.state={focused=true,cursorPos=4,selectionStart=0,selectionEnd=4}
input.SetValue=function()error('source refresh must not dispatch business input')end
live.view.text='新';live.view.tint='#AABBCC';live.view.fill='linear-gradient(90deg, #112233 0%, #445566 100%)';live.view.disabled=true
render(liveRoot)
assert(live.refs.label.props.text=='新' and live.refs.label.props.fontColor[1]==170,'bound label text/color refresh')
assert(live.refs.once.props.text=='起始标题','one-time text remains frozen')
assert(live.refs.button.props.disabled==true and live.refs.button.props.backgroundGradient,'bound button disabled/gradient refresh')
assert(live.refs.input==input and input.props.value=='新' and input.props.textColor[3]==204,'native input value/color mapping refresh')
assert(input.state.focused and input.state.cursorPos==1,'input focus preserved and caret clamped')
live.view.text=nil;live.view.tint=nil;live.view.fill='#112233';live.view.disabled=false;render(liveRoot)
assert(live.refs.label.props.text=='' and input.props.value=='' and input.props.textColor==nil,'nil clears source values')
assert(live.refs.button.props.backgroundGradient==nil and live.refs.button.props.backgroundColor[1]==17,'gradient-to-solid clears obsolete paint')
assert(live.refs.button.props.disabled==false,'false re-enables button')
live.view.text='0012';render(liveRoot)
assert(live.refs.label.props.text=='0012' and input.props.value=='0012','text refresh preserves numeric-looking names and leading zeroes')
print('Runtime live scalar binding PASS: text/color/nil/one-time/disabled/gradient/native input/focus; no synthetic input events.')
print("Runtime arrangement PASS: collapsed/free/flow/cache/identity, bound canvas rectangles survive recursive rendering, post-child layout callback.")
print("Runtime parity PASS: resizing, nested percentages, bound function clicks, public event forwarding, bound slider limits, real adapter gradient drawing calls (no GPU).")
print("Runtime algebra PASS: shared 1.45 line boxes/36px buttons/live defaults/falsey values/button inheritance/free-flow-fill/8px purple scrollbar contract/equipment anchors/30 frames/immutable declarations/identities; not a Yoga or visual result.")
''')
