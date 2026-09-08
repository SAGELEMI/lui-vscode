"""Single-line tail ellipsis: UTF-8 boundaries, cache invalidation, shared C quota,
deadline progress, and Measure's draw-only override including render errors.
The NanoVG boundary is stateful; this is not a substitute for actual font QA.
"""
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[2])
from lupa.lua54 import LuaRuntime

adapter = Path(sys.argv[1])
lua = LuaRuntime(unpack_returned_tuples=True)
lua.globals().adapter_read = lambda name: (adapter / name).read_text(encoding="utf-8-sig")
lua.execute(r'''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=='LUI.'then return assert(load(adapter_read(name:sub(5)..'.lua'),'@'..name))end
end)
local ctx={};local calls,now,cost,version,scale,size,depth=0,0,0,1,1,10,0;local stack={}
NVG_ALIGN_LEFT,NVG_ALIGN_TOP=1,2
function nvgSave()depth=depth+1;stack[depth]=size end
function nvgRestore()assert(depth>0);size=stack[depth];stack[depth]=nil;depth=depth-1 end
function nvgResetTransform()end
function nvgFontFace()end
function nvgFontSize(_,value)size=value end
function nvgTextLetterSpacing()end
function nvgTextLineHeight()end
function nvgTextAlign()end
function nvgBeginFrame()end
local function width(text)
 local result=0
 for _,code in utf8.codes(text)do
  if code==0x200D or code>=0x0300 and code<=0x036F or code>=0xFE00 and code<=0xFE0F or code>=0x1F3FB and code<=0x1F3FF then
  else result=result+(code<128 and .5 or 1)*size end
 end
 return result
end
function nvgTextBounds(_,x,y,text)calls=calls+1;now=now+cost;local w=width(text);return w,{x,y,x+w,y+size}end
function nvgTextMetrics()calls=calls+1;now=now+cost;return size*.8,-size*.2,size end
function nvgTextBoxBounds(_,x,y,w,text)calls=calls+1;now=now+cost;return{x,y,x+math.min(w,width(text)),y+size}end
local UI={Theme={GetScale=function()return scale end,FontSize=function(value)return value*scale end,FontFace=function(f,w)return f..tostring(w or '')end},
 GetFontVersion=function()return version end,GetNVGContext=function()return ctx end}
function UI.MeasureTextWidth(text)return width(text)end
function UI.MeasureTextBaseline()return size*.8 end
function UI.MeasureTextFit()return{width=20,height=10}end
package.loaded['urhox-libs/UI']=UI
package.loaded['LUI.Refresh']={Caption=function()end}
local Budget=require('LUI.MeasureBudget');local Native=require('LUI.NativeText');Native.Install()
local Trimming=require('LUI.TextTrimming');local Measure=require('LUI.Measure')
local rt={luiMeasureBudget_={clock=function()return now end,seconds=.002,limit=64,calls=0,rows=0,frame=0,overrunMilliseconds=0}}
local budget=Budget.Get(rt);local frame=0
local function resolve(widget,text,w,font,face,spacing)
 return Budget.Guard(budget,function()return Trimming.Resolve(widget,text,w,font or 10,face or 'sans',spacing)end,widget)
end
local function nextFrame()frame=frame+1;Budget.BeginFrame(rt,frame)end
nextFrame();local owner={};local ok,text=resolve(owner,'abcdefghij',35)
assert(ok and text=='abcde…','Latin prefix and ellipsis must occupy exactly the available width')
assert(width(text)<=35)
local before=calls;for i=1,300 do assert(select(2,resolve(owner,'abcdefghij',35))==text)end
assert(calls==before,'300 stable resolves must perform zero additional native measurements')
assert(select(2,resolve(owner,'abcdefghij',50))=='abcdefghij','resize wide restores the complete text')
assert(select(2,resolve(owner,'中文标题测试',35))=='中文…','Chinese truncation keeps complete codepoints')
assert(select(2,resolve(owner,'abcdef',0))=='' and select(2,resolve(owner,'abcdef',9))=='','too narrow for ellipsis draws no malformed fragment')
assert(select(2,resolve(owner,'abcdef',10))=='…','an ellipsis fits on its own')
assert(select(2,resolve(owner,'a\nb',100))=='a b','single-line contract cannot draw a second explicit line')
_tr=function(text)return text=='t_title' and '中文标题测试' or text end
assert(select(2,resolve(owner,'t_title',35))=='中文…','truncate translated display content, never a translation key')
_tr=function(text)return text=='t_title' and 'abcdefghij' or text end
assert(select(2,resolve(owner,'t_title',35))=='abcde…','language change invalidates the visible result')
_tr=nil
for _,cluster in ipairs({'👨‍👩‍👧‍👦','👍🏽','🇨🇳','é','1️⃣'})do
 nextFrame();local value=cluster..'abcdef';local full=width(cluster)
 local _,result=resolve({},value,full+10)
 assert(result==cluster..'…','emoji/combining cluster may not be partially trimmed: '..result)
 local _,narrow=resolve({},value,math.max(10,full+9))
 assert(narrow=='…' or narrow==cluster..'…','no half ZWJ/skin-tone/flag/combining cluster may survive')
 assert(utf8.len(result)~=nil)
end
nextFrame();owner={};resolve(owner,'abcdefghij',35);before=calls
resolve(owner,'ABCDEFGHIJ',35);assert(calls>before,'dynamic text must invalidate the result')
before=calls;resolve(owner,'ABCDEFGHIJ',35,12);assert(calls>before,'font size must invalidate the result')
before=calls;resolve(owner,'ABCDEFGHIJ',35,12,'other-font');assert(calls>before,'font face must invalidate native phases')
before=calls;resolve(owner,'ABCDEFGHIJ',35,12,'other-font',1);assert(calls>before,'letter spacing must invalidate native phases')
version=version+1;before=calls;resolve(owner,'ABCDEFGHIJ',35,12,'other-font',1);assert(calls>before,'font reload must invalidate native phases')
scale=2;before=calls;resolve(owner,'ABCDEFGHIJ',35,12,'other-font',1);assert(calls>before,'scale must invalidate native phases')
-- One slow C measurement per frame still advances a long binary search.
owner={};cost=.003;budget.limit=64;local done=false;local start=calls
for i=1,30 do nextFrame();local success,value=resolve(owner,string.rep('wide',1024),75)
 assert(budget.calls<=1 and depth==0,'next C start must wait after the soft deadline')
 if success then assert(value=='widewidewidew…');done=true;break end
end
assert(done and calls-start<20,'completed search phases must survive budget deferral and converge')
-- Separate text owners consume the same hard C-call allowance.
cost=0;nextFrame();local owners={}
for i=1,200 do owners[i]={};resolve(owners[i],string.rep('item'..i,10),25)end
assert(budget.calls==64 and depth==0,'all independent labels share the 64-start budget')
-- Integration: complete bindings/display state survive both drawing and an
-- interrupted native draw. Geometry is a single authored line, no font shrink.
scale=1;nextFrame();local drawn;local fail=false
local label={luiText_='Text',props={text='完整标题abcdef',fontSize=10,fontFamily='sans',maxLines=1,lineHeight=1.4},displayText_='完整标题abcdef',fontVersion_=version}
function label:GetAbsoluteLayout()return{x=0,y=0,w=45,h=14}end
function label:Render()
 drawn={text=self.displayText_,binding=self.props.text,font=self.props.fontSize,min=self.props.minFontSize,whiteSpace=self.props.whiteSpace}
 if fail=='budget' then nvgTextBounds(ctx,0,0,'uncached native draw phase')
 elseif fail then error('draw failure')end
end
Measure.AttachText(label)
assert(Budget.Guard(budget,function()label:Render(ctx)end,label))
assert(drawn.text=='完整标…' and drawn.binding=='完整标题abcdef' and drawn.font==10 and drawn.min==10 and drawn.whiteSpace=='nowrap')
assert(label.props.text=='完整标题abcdef' and label.displayText_=='完整标题abcdef' and label.props.minFontSize==nil)
before=calls;for i=1,300 do nextFrame();assert(Budget.Guard(budget,function()label:Render(ctx)end,label))end
assert(calls==before,'stable integrated rendering reuses all layout/trimming phases')
fail=true;local good=pcall(function()Budget.Guard(budget,function()label:Render(ctx)end,label)end)
assert(not good and label.displayText_=='完整标题abcdef' and label.props.text=='完整标题abcdef' and label.props.whiteSpace==nil and label.props.minFontSize==nil)
fail='budget';nextFrame();budget.calls=64
assert(not Budget.Guard(budget,function()label:Render(ctx)end,label),'native draw may defer after trimming has completed')
assert(label.displayText_=='完整标题abcdef' and label.props.text=='完整标题abcdef' and label.props.whiteSpace==nil and label.props.minFontSize==nil)
nextFrame();assert(Budget.Guard(budget,function()label:Render(ctx)end,label),'deferred trimmed draw must resume next frame')
assert(label.luiTextLayout_.singleLine and depth==0)
print('TextTrimming PASS: Latin/Chinese/emoji clusters; narrow/resize/text/font/spacing/scale; bounded search progress/shared exact C quota; 300 stable draws; full binding and render-state restoration.')
''')
