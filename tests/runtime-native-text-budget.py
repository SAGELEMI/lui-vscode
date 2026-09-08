"""Exact NanoVG text-call quota, phase progress, and native state restoration.
Uses a stateful NanoVG test boundary, not UI helper counts or phone timings.
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
 if name:sub(1,4)=='LUI.' then return assert(load(adapter_read(name:sub(5)..'.lua'),'@'..name))end
end)
local ctx={};local depth,calls,clock,cost,fontVersion=0,0,0,0,1;local drawScale=1;local scaleStack={}
NVG_ALIGN_LEFT,NVG_ALIGN_TOP=1,2
function nvgSave()depth=depth+1;scaleStack[depth]=drawScale end
function nvgRestore()assert(depth>0,'unmatched native restore');drawScale=scaleStack[depth];scaleStack[depth]=nil;depth=depth-1 end
function nvgResetTransform()drawScale=1 end
function nvgScale(_,x)drawScale=drawScale*x end
function nvgFontFace()end
function nvgFontSize()end
function nvgTextLetterSpacing()end
function nvgTextLineHeight()end
function nvgTextAlign()end
function nvgFontBlur()end
function nvgBeginFrame()end
local function native()calls=calls+1;clock=clock+cost end
function nvgTextBounds(_,x,y,text)native();return #text*8,{x,y,x+#text*8,y+14}end
function nvgTextBoxBounds(_,x,y,width,text)native();return{x,y,x+math.min(width,#text*8),y+math.ceil(#text*8/width)*16+(drawScale~=1 and .424 or 0)}end
function nvgTextMetrics()native();return 12,-4,16 end
-- Model the official paired-i18n bridge: a default fit may make two private
-- source/target C measurements that bypass the public global function.
local rawBounds=nvgTextBounds;local rawBox=nvgTextBoxBounds;local lastDrawText
local function translate(text)return text=='t_pair' and 'translated' or text end
local function fitPair(ctx,text,fit)
 if text=='t_pair' and fit~=false then rawBounds(ctx,0,0,'source');rawBounds(ctx,0,0,'target')end
end
function nvgTextBounds(ctx,x,y,text,last,bounds,fit)fitPair(ctx,text,fit);return rawBounds(ctx,x,y,translate(text))end
function nvgTextBoxBounds(ctx,x,y,width,text,last,bounds,fit)fitPair(ctx,text,fit);return rawBox(ctx,x,y,width,translate(text))end
function nvgText(ctx,x,y,text,last,fit)fitPair(ctx,text,fit);lastDrawText=translate(text)end
function nvgTextBox(ctx,x,y,width,text,last,fit)fitPair(ctx,text,fit);lastDrawText=translate(text)end
local UI={Theme={GetScale=function()return 1 end},GetFontVersion=function()return fontVersion end,GetNVGContext=function()return ctx end}
local originalWidth=0
function UI.MeasureTextWidth(text)originalWidth=originalWidth+1;return #text*8 end
function UI.MeasureTextFit()error('active helper must not touch UI private saveDepth')end
function UI.MeasureTextBaseline()return 12 end
package.loaded['urhox-libs/UI']=UI
local Budget=require('LUI.MeasureBudget');local Native=require('LUI.NativeText');Native.Install()
local rt={luiMeasureBudget_={clock=function()return clock end,seconds=.002,limit=64,calls=0,rows=0,frame=0,overrunMilliseconds=0}}
local b=Budget.Get(rt);local owner={}
assert(UI.MeasureTextWidth('outside')==56 and originalWidth==1,'nonactive helpers remain native')
local before=calls
local label=Native.Construct(function()
 assert(UI.MeasureTextWidth('cold')==0 and UI.MeasureTextBaseline(16)==0)
 local root={children={{fontVersion_=1,children={}}}}
 function root:GetChildren()return self.children end
 return root
end)
assert(calls==before and label.children[1].fontVersion_==-1,'constructor never consumes native measurement and defers baseline')
-- Exact quota: each single-line fixed-size fit starts Bounds + Metrics.
Budget.BeginFrame(rt,1)
local complete=Budget.Guard(b,function()
 for i=1,100 do UI.MeasureTextFit('unique-'..i,{fontSize=16,width=200})end
end,owner)
assert(not complete and b.calls==64 and calls-before==64 and depth==0,'quota must count C boundaries, not helper calls')
-- Completed first C phase survives a later timeout and makes forward progress.
owner={};cost=.003;Budget.BeginFrame(rt,2);local start=calls
local ok=Budget.Guard(b,function()return UI.MeasureTextFit('slow',{fontSize=16,width=200})end,owner)
assert(not ok and calls-start==1 and b.calls==1 and depth==0)
Budget.BeginFrame(rt,3)
local good,result=Budget.Guard(b,function()return UI.MeasureTextFit('slow',{fontSize=16,width=200})end,owner)
assert(good and result.width==32 and result.height==16 and calls-start==2 and b.calls==1,'retry replays successful Bounds then starts Metrics once')
assert(b.overrunMilliseconds>=.999 and depth==0)
-- An exhausted cached render performs no new C calls and remains drawable.
start=calls
assert(Budget.Guard(b,function()return UI.MeasureTextFit('slow',{fontSize=16,width=200})end,owner))
assert(calls==start and b.calls==1 and depth==0)
-- Native Label's result table is a zero-allocation hot path, and is committed
-- only after every native phase completes.
local cache=result;local hits=Native.stats.cacheHits
assert(Budget.Guard(b,function()return UI.MeasureTextFit('slow',{fontSize=16,width=200,cache=cache})end,owner))
assert(Native.stats.cacheHits==hits and calls==start,'metadata hit avoids even phase signature work')
Budget.BeginFrame(rt,31);cost=0
assert(Budget.Guard(b,function()return UI.MeasureTextFit('slow',{fontSize=17,width=200,cache=cache})end,owner))
assert(cache.baseFontSize==17 and cache.fontVersion==fontVersion and cache.context==ctx)
-- Direct Label decoration/overhang calls can pause after a raw clip save.
cost=0;Budget.BeginFrame(rt,4);b.calls=64
local paused=Budget.Guard(b,function()nvgSave(ctx);nvgTextBounds(ctx,0,0,'direct');nvgRestore(ctx)end,{})
assert(not paused and depth==0 and Native.stats.restoredOnError==1,'raw native render state is restored after cancellation')
-- Nested guards restore only their own pushes, preserving caller state.
Budget.BeginFrame(rt,5)
assert(Budget.Guard(b,function()
 nvgSave(ctx);b.calls=64
 assert(not Budget.Guard(b,function()nvgSave(ctx);nvgTextMetrics(ctx);nvgRestore(ctx)end,{}))
 assert(depth==1);nvgRestore(ctx)
end,{}))
assert(depth==0)
-- Memo identity includes font reload, transform, and actual native arguments.
Budget.BeginFrame(rt,6);owner={};start=calls
local function draw()nvgFontSize(ctx,16);return nvgTextBounds(ctx,0,0,'same')end
assert(Budget.Guard(b,draw,owner));assert(Budget.Guard(b,draw,owner));assert(calls==start+1)
fontVersion=2;assert(Budget.Guard(b,draw,owner));assert(calls==start+2)
nvgScale(ctx,2,2);assert(Budget.Guard(b,draw,owner));assert(calls==start+3)
-- Per-owner completed phase storage has a fixed capacity.
for frame=7,10 do
 Budget.BeginFrame(rt,frame)
 Budget.Guard(b,function()for i=1,100 do nvgTextBounds(ctx,0,0,'bounded-'..frame..'-'..i)end end,owner)
 assert(owner.luiNativeTextPhases_.count<=64 and b.calls<=64)
end
-- A native Menu's constructor-only width is retried incrementally. Even more
-- than 64 distinct labels progress without retaining an unbounded phase cache.
cost=0;local items={};for i=1,100 do items[i]={label=string.rep('a',i),shortcut='XY'}end
local menu={items_=items,props={width=20},minWidth_=20,paddingLeft_=2,paddingRight_=3,fontSize_=16,
 Render=function(self)self.drawn=true end,SetStyle=function(self,props)self.props.width=props.width end}
Native.AttachMenu(menu,true,rt);b.limit=2
local finished=false
for frame=11,150 do
 Budget.BeginFrame(rt,frame)
 finished=Budget.Guard(b,function()return menu:Render(ctx)end,menu)
 assert(b.calls<=2 and depth==0)
 if finished then break end
end
assert(finished and menu.drawn and menu.props.width==832 and menu.luiMenuMeasure_==nil,'Menu width phases must converge and commit their real intrinsic width')
-- Modal animation scale must never pollute a declared Text's logical bounds,
-- native multiline cache, or actual drawing transform, including cancellation.
b.limit=64;owner={luiText_='Text'};Budget.BeginFrame(rt,151);nvgResetTransform(ctx);nvgScale(ctx,.9)
local start=calls
local ok,small=Budget.Guard(b,function()return nvgTextBoxBounds(ctx,0,0,100,'authored text')end,owner)
assert(ok and drawScale==.9 and depth==0)
nvgResetTransform(ctx)
local ok,full=Budget.Guard(b,function()return nvgTextBoxBounds(ctx,0,0,100,'authored text')end,owner)
assert(ok and full[4]==small[4] and calls==start+1,'animation and settled logical measurement must share the identity phase cache')
Budget.BeginFrame(rt,152);b.calls=64;nvgScale(ctx,.9)
assert(not Budget.Guard(b,function()return nvgTextBoxBounds(ctx,0,0,100,'new authored text')end,owner))
assert(drawScale==.9 and depth==0,'cancelled normalized measurement must preserve native draw scale and save stack')
Budget.BeginFrame(rt,153);owner={};local beforePair=calls
assert(Budget.Guard(b,function()
 assert(nvgTextBounds(ctx,0,0,'t_pair')==80)
 nvgTextBoxBounds(ctx,0,0,100,'t_pair')
 nvgText(ctx,0,0,'t_pair');assert(lastDrawText=='translated')
 nvgTextBox(ctx,0,0,100,'t_pair');assert(lastDrawText=='translated')
end,owner))
assert(b.calls==2 and calls-beforePair==2,'guarded i18n translation must not expand private source/target measurement or change translated content')
beforePair=calls;nvgTextBounds(ctx,0,0,'t_pair');nvgText(ctx,0,0,'t_pair')
assert(calls-beforePair==5,'non-LUI paired translation fit retains its native behavior and argument defaults')
print('runtime native text budget tests passed')
''')
