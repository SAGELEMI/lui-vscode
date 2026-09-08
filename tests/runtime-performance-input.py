"""Formal adapter + verified official native ScrollView state methods.
Input coordinates are simulated after native DPR/ancestor conversion. This is
a deterministic CPU/input regression, not phone FPS or GPU acceptance.
"""
import runpy
from pathlib import Path

env = runpy.run_path(str(Path(__file__).with_name("runtime-native-controls.py")))
env["lua"].execute(r'''
local Runtime,Parser,Paths,Refresh=require('LUI.Runtime'),require('LUI.Parser'),require('LUI.Paths'),require('LUI.Refresh')
local runtime=setmetatable({isV2_=true,config_={componentDirectories={}}},Runtime)
local view={show=false,text='初始',once='固定',value=1}
local context={view=view,refs={}}
local node=assert(Parser.Parse([[<控件 名称="Perf"><容器 引用="Hidden" 可见性="{绑定 view.show}"><文本 引用="Text" 文本="{绑定 view.text, 预览内容='很长的设计器示例，不应逐帧解析'}"/></容器><文本 引用="Once" 文本="{绑定 view.once, 模式=单次}"/><文本 引用="Live" 文本="{绑定 view.value}"/></控件>]]))
local root=runtime:BuildNode(node,context)
Refresh.Subtree(root)
local parses,paths=Runtime.stats.bindingParses,Paths.stats.parses
view.text='隐藏期更新';view.once='不能改变'
for i=1,200 do view.value=i;Refresh.Subtree(root) end
assert(context.refs.Text.props.text=='初始' and context.refs.Live.props.text=='200')
assert(Runtime.stats.bindingParses==parses and Paths.stats.parses==paths,'warm refresh must not reparse binding syntax or paths')
view.show=true;Refresh.Subtree(root)
assert(context.refs.Text.props.text=='隐藏期更新' and context.refs.Once.props.text=='固定')
view.text=nil;Refresh.Subtree(root);assert(context.refs.Text.props.text=='')
local keys=Paths.Keys('view.value');keys[1]='poison';assert(Paths.Get({view={value=7}},'view.value')==7)
local a,b={props={},children={}},{props={},children={}}
a.children={b};function a:GetChildren()return self.children end;function b:GetChildren()return self.children end
local n,c=0,0;function b:luiRefreshLayout_()n=n+1 end;function b:luiRefreshCaption_()c=c+1 end
Refresh.Render(a,function()Refresh.Render(b,function()Refresh.Caption(b)end)end)
assert(n==1 and c==1,'nested component roots/captions refresh once per render traversal')
assert(not pcall(function()Refresh.Render(a,function()error('fixture render failure')end)end))
Refresh.Render(a,function()end);assert(n==3,'render exceptions must release the active pass')
function a:GetHitTestChildren()return self.children end
b.children={a}
Refresh.Subtree(a,true);assert(n==4 and c==4,'forced refresh deduplicates native hit-test children and cycles')
print('Performance PASS: zero warm binding/path parsing, live/nil/once values, collapsed restoration, nested dedup and error cleanup.')

local UI=require('urhox-libs/UI')
MOUSEB_LEFT,MOUSEB_MIDDLE,MOUSEB_RIGHT=0,1,2
package.loaded['urhox-libs/UI/Core/PointerEvent']=assert(load(native_read('urhox-libs/UI/Core/PointerEvent')))()
UI.Input=assert(load(native_read('urhox-libs/UI/Core/Input')))()
local Widget=require('urhox-libs/UI/Core/Widget')
function Widget:OnPointerUp()end
function Widget:OnPointerCancel()end
local cancels=0;UI.CancelPointer=function()cancels=cancels+1 end
local Scroll=assert(load(native_read('urhox-libs/UI/Widgets/ScrollView'),'@official/ScrollView.lua'))()
local Input=require('LUI.ScrollInput')
local function fixture()
 local s=Scroll({scrollY=true,scrollX=false,bounces=false,scrollbarInteractive=true})
 s.layout={x=0,y=0,w=300,h=300};s.contentWidth_,s.contentHeight_=300,10000
 function s:UpdateContentSize()end
 Input.Attach(s)
 return s
end
local function event(y,t,id,kind)return{x=40,y=y,timestamp=t,pointerId=id or 1,pointerType=kind or 'touch'}end
for _,dpr in ipairs({1,2,3})do for _,scale in ipairs({0.5,1,1.5})do
 local s=fixture();s:SetScroll(0,500)
 local start=600/(dpr*scale)
 assert(s:OnPanStart(event(start,0)))
 s:OnPanMove(event(start-60/(dpr*scale),100))
 assert(math.abs((s.state.scrollY-500)*dpr*scale-60)<0.00001,'local input must not be scaled twice')
 s:OnPanMove(event(start-200,120,2));assert(s.luiScrollPointerId_==1,'second touch cannot steal a drag')
 s:OnPanEnd(event(start,300));assert(s.state.velocityY==0 and not s.state.isDragging,'pause before release stops stale momentum')
end end
local distances={}
local legacyDistances={}
for _,fps in ipairs({30,60,120})do
 local old=Scroll({scrollY=true,scrollX=false,bounces=false})
 old.layout={x=0,y=0,w=300,h=300};old.contentWidth_,old.contentHeight_=300,10000
 function old:UpdateContentSize()end
 old.state.velocityY=10 -- native pre-fix px per nominal 60 Hz frame
 for i=1,fps do old:Update(1/fps)end
 legacyDistances[#legacyDistances+1]=old.state.scrollY
 local s=fixture();s.state.velocityY=600
 for i=1,fps do s:Update(1/fps)end
 distances[#distances+1]=s.state.scrollY
end
assert(math.abs(distances[1]-distances[2])<0.000001 and math.abs(distances[2]-distances[3])<0.000001,'momentum depends on elapsed time, not frame count')
local speeds={}
for _,hz in ipairs({30,60,120})do
 local s=fixture();s:SetScroll(0,100);s:OnPanStart(event(500,0))
 for i=1,hz do s:OnPanMove(event(500-300*i/hz,1000*i/hz))end
 speeds[#speeds+1]=s.state.velocityY
end
assert(math.abs(speeds[1]-speeds[3])<0.00001,'velocity uses input elapsed time')
local shifted=fixture();shifted:SetScroll(0,2000);shifted:OnPanStart(event(500,0))
shifted:OnPanMove(event(490,16));shifted:luiShiftScrollOrigin_(0,212.25);shifted:SetScrollDirect(0,2222.25)
shifted:OnPanMove(event(480,32));assert(math.abs(shifted.state.scrollY-2232.25)<0.00001,'height refinement cannot reverse the next drag step')
local mouse=fixture();assert(mouse:OnPanStart(event(500,0,0,'mouse')));mouse:OnPanMove(event(450,16,0,'mouse'));assert(mouse.state.scrollY==50)
mouse:OnPointerCancel(event(450,17,0,'mouse'));assert(not mouse.state.isDragging and mouse.state.velocityY==0)
mouse.parent={props={visible=false}};mouse.state.velocityY=300;mouse:Update(1/60);assert(mouse.state.velocityY==0)
local cancel=fixture();cancel:OnPanStart(event(300,0));cancel:OnPanMove(event(260,16))
local listener=cancel.luiCancelListener_;assert(listener)
local following=0
UI.Input.On(UI.Input.PointerCancel,function()following=following+1 end,-100)
UI.Input.Emit(UI.Input.PointerCancel,{pointerId=1,pointerType='touch'})
assert(not cancel.state.isDragging and cancel.state.velocityY==0 and following==1,'cancel runs before native PanEnd without skipping dispatch listeners')
cancel:Update(1/60);assert(not cancel.luiCancelListener_,'captured cancel subscription releases next update')
cancel.state.velocityY=600;input={focus=false};cancel:Update(1/60);input=nil
assert(cancel.state.velocityY==0,'focus loss cancels momentum even after release')
assert(cancels>=12,'content pan cancels child press/click candidates')

for _,name in ipairs({'nvgBeginPath','nvgRoundedRect','nvgFillColor','nvgFill'})do _G[name]=function()end end
function nvgRGBA(...)return{...}end
local bar=fixture();require('LUI.Scrollbars').Attach(bar,'禁用','显示');bar:RenderScrollbars({})
local track,thumb=bar.vTrackBounds_,bar.vScrollbarBounds_
local down={x=thumb.x+4,y=thumb.y+thumb.h/2,timestamp=0,pointerId=1,pointerType='touch'}
assert(bar:OnPointerDown(down));assert(bar.scrollbarDragTrackRangeV_==track.h-thumb.h)
bar:OnPanStart(down);assert(bar.isDraggingScrollbarV_ and bar.state.isDragging)
bar:OnPointerMove({x=down.x,y=down.y+(track.h-thumb.h)/2,pointerId=1,pointerType='touch'})
assert(math.abs(bar.state.scrollY-4850)<0.00001,'thumb movement uses the rendered travel range')
bar:OnPointerCancel(down);assert(not bar.isDraggingScrollbarV_ and not bar.state.isDragging)
bar:OnPointerDown(down);bar:OnPointerUp(down);assert(not bar.isDraggingScrollbarV_)
print(string.format('Input PASS: DPR 1/2/3, scale .5/1/1.5, touch/mouse, pointer ownership/cancel, geometry and 30/60/120 FPS distance %.6f / %.6f / %.6f.',table.unpack(distances)))
print(string.format('Before: native 10 px/nominal frame for 1s at 30/60/120 FPS: %.6f / %.6f / %.6f.',table.unpack(legacyDistances)))
PerformanceMetrics={fps={30,60,120},before=legacyDistances,after=distances,warmBindingParses=0,warmPathParses=0}
''')

import hashlib
import json
import subprocess
root = Path(__file__).resolve().parents[1]
# Pin the pre-optimization source so committing the fix does not change the
# comparison baseline or turn its expected old work count into zero.
baseline_commit='5429c4d486f9a6b1bfbe98b7259f79da7ae66695'
baseline_runtime=subprocess.check_output(['git','show',baseline_commit+':packages/runtime-urhox-lua/adapter/Runtime.lua'],cwd=root).decode('utf-8')
baseline_paths=subprocess.check_output(['git','show',baseline_commit+':packages/runtime-urhox-lua/adapter/Paths.lua'],cwd=root).decode('utf-8')
assert 'local function bindingSpec(value)' in baseline_runtime and 'function Paths.Keys(path)' in baseline_paths
env['lua'].globals().baseline_runtime_source=baseline_runtime.replace('if not body then return nil end',
    'if not body then return nil end\n    Runtime.stats.bindingParses=Runtime.stats.bindingParses+1',1)
env['lua'].globals().baseline_paths_source=baseline_paths.replace('function Paths.Keys(path)',
    'function Paths.Keys(path)\n    Paths.stats.parses=Paths.stats.parses+1',1)
env['lua'].execute(r'''
local currentPaths,currentRuntime=require('LUI.Paths'),require('LUI.Runtime')
local oldPaths=assert(load(baseline_paths_source,'@baseline/Paths.lua'))();oldPaths.stats={parses=0}
package.loaded['LUI.Paths']=oldPaths
local oldRuntime=assert(load(baseline_runtime_source,'@baseline/Runtime.lua'))();oldRuntime.stats={bindingParses=0}
local function workload(Runtime,Paths)
 local runtime=setmetatable({isV2_=true,config_={componentDirectories={}}},Runtime)
 local view={a='start',b='start'}
 local node=assert(require('LUI.Parser').Parse([[<控件 名称="Compare"><文本 文本="{绑定 view.a, 预览内容='相同的长设计器示例，在每次刷新时不应重新解析'}"/><文本 文本="{绑定 view.b}"/></控件>]]))
 local root=runtime:BuildNode(node,{view=view,refs={}})
 local Refresh=require('LUI.Refresh');Refresh.Subtree(root)
 local bindings,paths=Runtime.stats.bindingParses,Paths.stats.parses
 for i=1,200 do view.a=tostring(i);view.b='value'..i;Refresh.Subtree(root)end
 return Runtime.stats.bindingParses-bindings,Paths.stats.parses-paths
end
local oldBindings,oldPathCount=workload(oldRuntime,oldPaths)
package.loaded['LUI.Paths']=currentPaths
local newBindings,newPathCount=workload(currentRuntime,currentPaths)
assert(oldBindings>0 and oldPathCount>0 and newBindings==0 and newPathCount==0)
PerformanceMetrics.beforeWarmBindings,PerformanceMetrics.beforeWarmPaths=oldBindings,oldPathCount
PerformanceMetrics.afterWarmBindings,PerformanceMetrics.afterWarmPaths=newBindings,newPathCount
print(string.format('Same-tree 200 live refreshes: baseline/current binding parses %d/%d; path parses %d/%d. Work counts, not CPU/FPS.',oldBindings,newBindings,oldPathCount,newPathCount))
''')
metrics = env['lua'].globals().PerformanceMetrics
report = {key: list(metrics[key].values()) for key in ('fps', 'before', 'after')}
report.update(scope='Verified official native ScrollView, same Lupa process and bounds; initial old 10 px/nominal 60Hz frame corresponds to new 600 px/s; 1 second simulated, not measured phone FPS',
              warmBindingParses=metrics['warmBindingParses'], warmPathParses=metrics['warmPathParses'])
report['bindingWorkload']={'baselineCommit':baseline_commit,'refreshes':200,'scope':'same two live text nodes and current traversal; isolated cache work, not hidden-tree or frame-time comparison',
                         'beforeBindingParses':metrics['beforeWarmBindings'],'afterBindingParses':metrics['afterWarmBindings'],
                         'beforePathParses':metrics['beforeWarmPaths'],'afterPathParses':metrics['afterWarmPaths']}
adapter=Path(__file__).resolve().parents[1]/'packages/runtime-urhox-lua/adapter'
report['adapterHashes']={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in adapter.glob('*.lua')}
output=Path(__file__).resolve().parents[1]/'artifacts/runtime-performance-input'
output.mkdir(parents=True,exist_ok=True)
(output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
