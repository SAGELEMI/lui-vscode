"""Exercise adapter stroke policy and the real Label Lua draw path with NanoVG stubs.
Usage: python scripts/test-text-stroke-lua.py <Maker project root>
This verifies draw calls/colors, not GPU rasterization or pixel parity.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path("artifacts/python").resolve()))
from lupa import LuaRuntime

project = Path(sys.argv[1])
adapter = Path("packages/runtime-urhox-lua/adapter")
lua = LuaRuntime(unpack_returned_tuples=True)
lua.globals().read_adapter = lambda name: (adapter / (name + ".lua")).read_text(encoding="utf-8-sig")
lua.execute('''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=="LUI." then return assert(load(read_adapter(name:sub(5)),"@"..name)) end
end)
package.loaded['urhox-libs/UI/Core/Widget']={Extend=function() return {} end,GetParentOverride=function() return nil end}
package.loaded['urhox-libs/UI/Core/Theme']={FontSize=function(v) return v end,FontFace=function() return "MiSans" end}
package.loaded['urhox-libs/UI/Core/Style']={}
package.loaded['urhox-libs/UI/Core/UI']={GetFontVersion=function() return 1 end,defaultAutoFitText=false}
''')
lua.globals().NativeLabel = lua.execute((project / "urhox-libs/UI/Widgets/Label.lua").read_text(encoding="utf-8-sig"))
lua.globals().NativeStyle = lua.execute((project / "urhox-libs/UI/Core/Style.lua").read_text(encoding="utf-8-sig"))
lua.execute('''
local Typography=require('LUI.Typography')
local Parser=require('LUI.Parser')
local document=assert(Parser.Parse('<控件 名称="Stroke"><文本 文字描边颜色="#10091C" 文字描边宽度="1" /></控件>'))
assert(document.children[1].attrs.TextStrokeColor=='#10091C' and document.children[1].attrs.TextStrokeWidth=='1')
local ordinary={fontWeight='bold',textStroke={width=2,color={255,255,255,255}}}
Typography.ApplyLabel(ordinary)
assert(ordinary.textStroke==nil and ordinary.luiTextRasterMode=='nanovg-single-pass')
local props={textStrokeColor='#10091C80',textStrokeWidth='1.25'}
Typography.ApplyLabel(props)
assert(props.textStroke.width==1.25 and props.textStroke.color[1]==16 and props.textStroke.color[4]==128)
NativeStyle.NormalizeColorProps(props)
assert(type(props.textStrokeColor)=='table','real native constructor normalizes all *Color props')
Typography.ApplyLabel(props)
assert(props.textStroke.color[1]==16 and props.textStroke.color[4]==128,'render after native normalization preserves explicit outline')
for _,invalid in ipairs({{1,2},{1,2,300},{1,2,3,-1},{1,2,3,0/0},{'1',2,3},{1,2,3,4,5}}) do
 assert(not pcall(Typography.ApplyLabel,{textStrokeWidth=1,textStrokeColor=invalid}))
end
for _,invalid in ipairs({-1,math.huge,0/0,'bad','20%'}) do
 local ok,err=pcall(Typography.ApplyLabel,{textStrokeWidth=invalid,textStrokeColor='#10091C'})
 assert(not ok and tostring(err):find('文字描边宽度',1,true))
end
local ok,err=pcall(Typography.ApplyLabel,{textStrokeWidth=1,textStrokeColor='red'})
assert(not ok and tostring(err):find('文字描边颜色',1,true))
for _,disabled in ipairs({{textStrokeColor='#10091C',textStrokeWidth=0},{textStrokeWidth=1},{textStrokeColor='#10091C'},{}}) do
 Typography.ApplyLabel(disabled); assert(disabled.textStroke==nil)
end
local draws,currentColor={},{}
nvgRGBA=function(r,g,b,a) return {r,g,b,a} end
nvgFillColor=function(_,color) currentColor=color end
nvgText=function(_,x,y,text) draws[#draws+1]={x=x,y=y,text=text,color=currentColor} end
for _,name in ipairs({'nvgFontFace','nvgFontSize','nvgTextLineHeight','nvgTextLetterSpacing','nvgTextAlign','nvgSave','nvgRestore','nvgIntersectScissor'}) do _G[name]=function() end end
NVG_ALIGN_LEFT,NVG_ALIGN_TOP,NVG_ALIGN_BOTTOM,NVG_ALIGN_MIDDLE=1,8,16,32
local label={props={text='清晰正文',fontSize=12,fontColor={242,234,255,255},textStrokeColor='#10091C',textStrokeWidth=1},fontVersion_=1,
 GetAbsoluteLayout=function() return {x=8,y=8,w=260,h=18} end,
 GetProps=function(self) return self.props end,Render=NativeLabel.Render}
Typography.AttachLabel(label)
Typography.AttachLabel(label)
NativeStyle.NormalizeColorProps(label.props)
label:Render({})
assert(#draws==9,'outline is eight offset draws and one fill, never fake single-pass')
for i=1,8 do assert(draws[i].color[1]==16 and draws[i].color[2]==9 and draws[i].color[3]==28) end
assert(draws[9].color[1]==242 and draws[9].x==8)
draws={}; label.props.textStrokeWidth=0; label:Render({})
assert(#draws==1 and label.props.textStroke==nil,'live disable restores ordinary single fill')
draws={}; label.props.textStrokeWidth=2; label.props.textStrokeColor='#001122'; label:Render({})
assert(#draws==9 and draws[1].color[2]==17 and label.props.textStroke.width==2)
draws={}; label.props.textStrokeColor=nil; label:Render({})
assert(#draws==1,'removing one explicit property clears stale native outline')
''')
print("Text stroke: Chinese parser aliases, explicit policy, invalid binding values, native Label 8+1 draws, live color/width/disable passed (NanoVG stubbed).")
