"""Notified dependency/refresh and native-measure budget work counts.
Usage: python tests/runtime-dirty-refresh.py <adapter> <lupa-package-directory>
Deterministic Lua fixtures; this does not measure a phone's CPU, GPU or FPS.
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
 if name:sub(1,4)=='LUI.' then return assert(load(adapter_read(name:sub(5)..'.lua'),'@'..name)) end
end)
local Widget={}
function Widget:GetChildren()return self.children end
function Widget:GetLayout()return{x=0,y=0,w=self.props.width or 100,h=30}end
function Widget:GetAbsoluteLayout()return self:GetLayout()end
function Widget:SetStyle(style)for key,value in pairs(style)do self.props[key]=value end end
function Widget:SetText(text)self.props.text=text end
function Widget:SetVisible(visible)self.props.visible=visible end
function Widget:Destroy()self.destroyed=true end
function Widget:Render()end
local nativeCalls,tick,cost=0,0,0
local UI={Theme={FontSize=function(size)return size end,FontFace=function()return'sans'end}}
function UI.MeasureTextWidth(text,size)
 nativeCalls=nativeCalls+1;tick=tick+cost;return #text*size/2
end
function UI.MeasureTextFit(text,options)
 nativeCalls=nativeCalls+1;tick=tick+cost
 local natural=#text*options.fontSize/2
 local lines=options.multiline and math.ceil(natural/options.width) or 1
 return{width=math.min(options.width,natural),height=options.fontSize*(options.lineHeight or 1)*lines}
end
package.loaded['urhox-libs/UI']=UI
package.loaded['urhox-libs/UI/Core/Widget']=Widget
local Dirty,Refresh,Measure,LiveProps,Budget=require('LUI.Dirty'),require('LUI.Refresh'),require('LUI.Measure'),require('LUI.LiveProps'),require('LUI.MeasureBudget')
-- The real resource loader caches normalized slash names; Refresh must use
-- late require, not silently disable batching when the dot cache key is absent.
local originalRequire=require
package.loaded['LUI/Measure']=Measure;package.loaded['LUI.Measure']=nil
require=function(name)if name=='LUI.Measure'then return Measure end;return originalRequire(name)end
local function node(context,deps,parent,update,props)
 local widget=setmetatable({props=props or {},children={},updates=0,captions=0},{__index=Widget})
 if parent then widget.parent=parent;parent.children[#parent.children+1]=widget end
 function widget:luiRefreshLayout_()self.updates=self.updates+1;if update then update(self)end end
 function widget:luiRefreshCaption_()self.captions=self.captions+1 end
 Measure.Observe(widget);Dirty.Track(widget,context,deps)
 return widget
end
local function render(root)Refresh.Render(root,function()end)end
local context=Dirty.Configure({view={left='L',right='R',show=false,hiddenText='H',user={name='N'}}},true)
local root=node(context,{})
local scoped=setmetatable({instancePath='scope'},{__index=context})
local left=node(scoped,{'view.left'},root,function(w)w.props.text=context.view.left end)
local right=node(context,{'view.right'},root,function(w)w.props.text=context.view.right end)
local aggregate=node(context,{'view.user'},root)
local userName=node(context,{'view.user.name'},root)
render(root)
local warmNodes,warmCaptions=Refresh.stats.nodes,Refresh.stats.captions
for i=1,200 do render(root);Refresh.Caption(left)end
assert(Refresh.stats.nodes==warmNodes and Refresh.stats.captions==warmCaptions,'notified warm frames perform no binding/caption tree visits')
local nativeRoot=node(context,{})
local internal=setmetatable({props={},children={},parent=nativeRoot},{__index=Widget})
nativeRoot.children={internal}
local nativeBound=node(context,{'view.right'},internal,function(w)w.props.text=context.view.right end)
render(nativeRoot);local nativeWarm=Refresh.stats.nodes
for i=1,200 do render(nativeRoot)end
assert(Refresh.stats.nodes==nativeWarm,'untracked native internal panels do not force the notified page into legacy scanning')
context.view.right='native latest';Dirty.Notify(context,'view.right');render(nativeRoot)
assert(nativeBound.props.text=='native latest','dirty branch crosses native infrastructure when values change')
render(root)
local rightUpdates,rootUpdates=right.updates,root.updates
context.view.left='changed';Dirty.Notify(context,'view.left');render(root)
assert(left.props.text=='changed' and right.updates==rightUpdates and root.updates==rootUpdates,'leaf dependency visits route through ancestors without evaluating siblings/ancestors')
local previous=left.updates;context.view.left=nil;Dirty.Notify(scoped,{'view.left'});render(root)
assert(left.updates==previous+1 and left.props.text==nil,'scoped inherited owner and nil update')
local aggregateBefore,nameBefore=aggregate.updates,userName.updates
Dirty.Notify(context,'view.user.name');render(root)
assert(aggregate.updates==aggregateBefore+1 and userName.updates==nameBefore+1,'leaf notification includes an aggregate dependency')
Dirty.Notify(context,'view.user');render(root)
assert(userName.updates==nameBefore+2,'parent replacement invalidates nested paths')
local childProps=setmetatable({},{__index=function(_,key)return context.view[key]end})
Dirty.Alias(childProps,'left',context,'view.left')
Dirty.Alias(childProps,'computed',context,{'view.left','view.right'})
local component=Dirty.Configure(setmetatable({props=childProps,view={}},{__index=context}),nil)
local imported=node(component,{'props.left'},root)
local expression=node(component,{'props.computed'},root)
render(root);local importedBefore,expressionBefore=imported.updates,expression.updates
Dirty.Notify(context,'view.left');render(root)
assert(imported.updates==importedBefore+1 and expression.updates==expressionBefore+1,'component props aliases forward parent notifications')
Dirty.Notify(context,'view.right');render(root)
assert(imported.updates==importedBefore+1 and expression.updates==expressionBefore+2,'multi-dependency prop expression keeps each parent dependency')
local shadow=Dirty.Configure(setmetatable({view={left='local'}},{__index=context}),nil)
local shadowNode=node(shadow,{'view.left'},root)
render(root);local shadowBefore=shadowNode.updates
Dirty.Notify(context,'view.left');render(root);assert(shadowNode.updates==shadowBefore,'own child view is not parent view')
Dirty.Notify(shadow,'view.left');render(root);assert(shadowNode.updates==shadowBefore+1)
local collapsed=node(context,{'view.show'},root,function(w)w:SetVisible(context.view.show)end,{visible=false})
local suspended=node(context,{'view.hiddenText'},collapsed,function(w)w.props.text=context.view.hiddenText end)
local hidden=node(context,{},root,nil,{visibility='hidden'})
local hiddenChild=node(context,{'view.hiddenText'},hidden,function(w)w.props.text=context.view.hiddenText end)
Dirty.Mark(root);render(root)
local suspendedBefore=suspended.updates
context.view.hiddenText='pending';Dirty.Notify(context,'view.hiddenText');render(root)
assert(suspended.updates==suspendedBefore and hiddenChild.props.text=='pending','collapsed suspends, hidden occupying layout stays live')
context.view.show=true;Dirty.Notify(context,'view.show');render(root)
assert(suspended.props.text=='pending','reopen refreshes suspended descendants before layout')
context.view.show=false;Dirty.Notify(context,'view.show');render(root);render(root)
local idleCollapsed=Refresh.stats.nodes
Dirty.Mark(collapsed,true);render(root);local settled=Refresh.stats.nodes;render(root)
assert(Refresh.stats.nodes==settled,'forced collapsed branch does not become a permanent hot branch')
local scanContext={view={value=1}}
local scan=node(scanContext,{'view.value'},nil,function(w)w.props.value=scanContext.view.value end)
render(scan);scanContext.view.value=2;render(scan);assert(scan.props.value==2,'legacy direct writes retain scan compatibility')
local subscriptions=Dirty.stats.subscriptions
imported:Destroy();Dirty.Notify(context,'view.left')
assert(Dirty.stats.subscriptions==subscriptions-1 and not imported.luiDirtySelf_,'destroy removes subscriptions')
local listenerCalls=0
local owner=node(context,{})
local unsubscribe=Dirty.Subscribe(context,{'view.left','view.right'},function()listenerCalls=listenerCalls+1 end,owner)
Dirty.Track(owner,context,{})
Dirty.Notify(context,{'view.left','view.right'});assert(listenerCalls==1,'independent listener survives Track and coalesces paths')
local withListener=Dirty.stats.subscriptions
owner:Destroy();unsubscribe();Dirty.Notify(context,{'view.left','view.right'})
assert(listenerCalls==1 and Dirty.stats.subscriptions==withListener-2,'owner disposal and explicit unsubscribe are idempotent')
local longLivedContext=Dirty.Configure({view={rows={}}},true)
local retiredNodes=setmetatable({},{__mode='v'})
local recycled=node(longLivedContext,{})
for i=1,1000 do
 Dirty.Track(recycled,longLivedContext,{'view.rows['..i..'].label'})
 retiredNodes[i]=recycled.luiDirtySubscriptions_[1]
end
Dirty.Untrack(recycled)
collectgarbage('collect');collectgarbage('collect')
assert(next(retiredNodes)==nil,'reused slots release obsolete dependency paths while their document remains alive')
local surviving=node(longLivedContext,{'view.rows[1001].label'})
Dirty.Track(recycled,longLivedContext,{'view.rows[1001].label'})
Dirty.Untrack(recycled)
surviving.luiDirtySelf_=nil
Dirty.Notify(longLivedContext,'view.rows[1001].label')
assert(surviving.luiDirtySelf_,'pruning preserves shared live subscriptions')
surviving:Destroy();recycled:Destroy()
local rowsOwner=Dirty.Configure({view={rows={{label='a'},{label='b'}},selected='a'}},true)
local rowsNode=node(rowsOwner,{'view.rows','view.selected'})
render(rowsNode)
Dirty.Notify(rowsOwner,{'view.rows[1].label','view.rows[2].labelColor'})
local changes=Dirty.RelativeChanges(rowsNode,rowsOwner,'view.rows')
assert(#changes==2 and changes[1][1]==1 and changes[1][2]=='label' and changes[2][1]==2 and changes[2][2]=='labelColor','coalesced notifications retain every relative item path')
render(rowsNode)
Dirty.Notify(rowsOwner,'view.selected')
assert(#Dirty.RelativeChanges(rowsNode,rowsOwner,'view.rows')==0,'an unrelated selected-state notification must not reset Items')
render(rowsNode)
local rowProps={rows=rowsOwner.view.rows}
local rowsComponent=Dirty.Configure(setmetatable({props=rowProps},{__index=rowsOwner}),true)
Dirty.Alias(rowProps,'rows',rowsOwner,'view.rows')
local forwarded=node(rowsComponent,{'props.rows'})
render(forwarded)
Dirty.Notify(rowsOwner,'view.rows[2].label')
changes=Dirty.RelativeChanges(forwarded,rowsComponent,'props.rows')
assert(#changes==1 and changes[1][1]==2 and changes[1][2]=='label','relative paths resolve through imported component props')
render(rowsNode);render(forwarded)
Dirty.Notify(rowsOwner,'view')
assert(Dirty.RelativeChanges(forwarded,rowsComponent,'props.rows')==nil,'parent replacement safely requests a full collection update')
rowsNode:Destroy();forwarded:Destroy()
local fails=true
local errorNode=node(context,{'view.right'},root,function()if fails then error('expected refresh failure')end end)
Dirty.Mark(root);assert(not pcall(render,root));fails=false;render(root)
assert(errorNode.updates==2,'failed refresh releases active traversal and batch')

local measureRoot=node({},{});local a=node({}, {},measureRoot);local b=node({}, {},measureRoot)
local before=Measure.stats.invalidations
Measure.BeginBatch();Measure.Invalidate(a);Measure.BeginBatch();Measure.Invalidate(b);Measure.EndBatch();Measure.Invalidate(a);Measure.EndBatch()
assert(Measure.stats.invalidations-before==3,'a batch invalidates each shared ancestor once')
local label=node({}, {},measureRoot,nil,{text='short',fontSize=10,width=100,padding=2})
label.luiText_='Text'
Measure.Leaf(label,100)
local initialRevision=Measure.Revision(label)
local initialMeasurements=Measure.stats.measurements
assert(LiveProps.Apply(label,'Text',{Color={value='#112233'},Opacity={value=.5}},{fontColor={17,34,51,255},opacity=.5})=='paint')
Measure.Leaf(label,100)
assert(Measure.Revision(label)==initialRevision and Measure.stats.measurements==initialMeasurements,'paint update preserves text and desired caches')
assert(LiveProps.Apply(label,'Text',{Width={value=80},Padding={value=4}},{width=80,padding=4})=='geometry')
assert(label.props.width==80 and label.props.padding==4 and Measure.Revision(label)~=initialRevision,'geometry detected before props writes')
local widthRevision=Measure.Revision(label)
LiveProps.Apply(label,'Text',{Width={value=nil}},{})
assert(label.props.width==nil and Measure.Revision(label)~=widthRevision,'nil-removal remains a geometry change')
local virtual=node({}, {})
local called={};virtual.luiVirtualList_={SetItems=function(_,v)called.items=v end,SetState=function(_,v)called.state=v end,SetSelectedKey=function(_,v)called.selected=v end}
local items={{key='a'}};local state={scrollY=5}
assert(LiveProps.Apply(virtual,'VirtualList',{Items={value=items},ScrollState={value=state},SelectedKey={value='a'}},{})=='structure')
assert(called.items==items and called.state==state and called.selected=='a','virtual-list data is forwarded to the shared controller')

-- Every list in both runtimes and both passes consumes the same VM-wide slice.
local firstRuntime,secondRuntime={},{}
local shared=Budget.Get(firstRuntime)
assert(shared==Budget.Get(secondRuntime),'production runtimes share a VM budget')
local realClock=shared.clock
shared.clock=function()return tick end
Budget.BeginFrame(firstRuntime,100)
local sharedFrame=shared.frame
for call=1,64 do
 local owner=call%2==0 and firstRuntime or secondRuntime
 local pass=call%3==0 and Budget.Guard or Budget.Run
 assert(pass(Budget.Get(owner),function()return Budget.Native(function()return call end)end))
 Budget.BeginFrame(owner,100)
end
assert(shared.calls==64 and shared.frame==sharedFrame,'same frame across runtimes cannot reset the 64-start limit')
for _,owner in ipairs({firstRuntime,secondRuntime})do
 assert(not Budget.Guard(Budget.Get(owner),function()Budget.Native(function()error('must not start')end)end))
end
Budget.BeginFrame(secondRuntime,101)
assert(shared.calls==0 and shared.frame==sharedFrame+1 and Budget.CanStart(shared),'next frame restores all runtime budgets together')
local timeCalls=0
local function timedNative()timeCalls=timeCalls+1;tick=tick+.001 end
assert(Budget.Run(Budget.Get(firstRuntime),function()Budget.Native(timedNative)end))
Budget.BeginFrame(secondRuntime,101)
assert(Budget.Guard(Budget.Get(secondRuntime),function()Budget.Native(timedNative)end))
assert(not Budget.Guard(Budget.Get(firstRuntime),function()Budget.Native(timedNative)end)
 and timeCalls==2 and shared.calls==2,'2ms deadline also spans different runtimes and Update/Render scopes')
Budget.BeginFrame(firstRuntime,102)
assert(Budget.Guard(Budget.Get(secondRuntime),function()Budget.Native(timedNative)end),'next frame resumes time-deferred work')
shared.clock=realClock
local injected={clock=function()return tick end,seconds=.002,limit=64,calls=0,rows=0,frame=0,overrunMilliseconds=0}
assert(Budget.Get({luiMeasureBudget_=injected})==injected and Budget.Get(firstRuntime)==shared,'explicit deterministic test budgets do not replace production shared state')
local retired=setmetatable({firstRuntime,secondRuntime},{__mode='v'})
firstRuntime,secondRuntime=nil,nil
collectgarbage('collect');collectgarbage('collect')
assert(next(retired)==nil,'the shared budget never retains its runtimes')

-- Every native phase costs more than the frame slice; completed phases must
-- survive postponement or this one leaf could never finish on a slow device.
local runtime={luiMeasureBudget_=injected};local budget=Budget.Get(runtime)
cost=.003
local expensive=node({}, {},nil,nil,{text='abcdefgh',fontSize=10})
expensive.luiText_='Text'
local startCalls=nativeCalls
for frame=1,3 do
 Budget.BeginFrame(runtime,frame)
 local ok,w,h=Budget.Run(budget,function()return Measure.Leaf(expensive,20)end)
 assert(ok==(frame==3),'budget retry must make finite progress without caching incomplete geometry')
 if ok then assert(w==20 and h>0)end
 assert(budget.calls==1 and budget.overrunMilliseconds>0,'only one non-preemptible call starts per exhausted slice')
end
assert(nativeCalls-startCalls==3,'native measurement phases are not repeated after a yield')
local finalCalls=nativeCalls
Measure.Leaf(expensive,20);assert(nativeCalls==finalCalls,'successful leaf is cached')
cost=0
Budget.BeginFrame(runtime,4);budget.limit=2
local another=node({}, {},nil,nil,{text='abcdefgh',fontSize=10});another.luiText_='Text'
local third=node({}, {},nil,nil,{text='third',fontSize=10});third.luiText_='Text'
assert(not Budget.Run(budget,function()return Measure.Leaf(another,20)end))
assert(not Budget.Run(budget,function()return Measure.Leaf(third,20)end) and budget.calls==2,'multiple jobs consume one runtime budget')
assert(not pcall(function()Budget.BeginFrame(runtime,5);Budget.Run(budget,function()error('native implementation error')end)end),'ordinary errors are not swallowed as budget yields')
local renderSentinel={}
local interrupted=node({}, {},nil,nil,{text='hello',fontSize=12,lineHeight=1.45,whiteSpace='normal',verticalAlign='middle',minFontSize=8})
interrupted.luiText_='Text'
function interrupted:Render()assert(self.props.minFontSize==12,'native draw uses measured authored font size');error(renderSentinel,0)end
Measure.AttachText(interrupted)
local rendered,renderError=pcall(interrupted.Render,interrupted,0)
assert(not rendered and renderError==renderSentinel and interrupted.props.minFontSize==8 and interrupted.props.lineHeight==1.45 and interrupted.props.whiteSpace=='normal' and interrupted.props.verticalAlign=='middle','deferred/failed native draw restores all authored text properties')
local RenderBudget=require('LUI.RenderBudget')
local deferredCount,paintedChildren=0,0
local guarded=node({}, {},nil,nil,{})
local guardedChild=node({}, {},guarded,nil,{})
function guarded:HitTest()return true end
function guarded:CustomRenderChildren()paintedChildren=paintedChildren+1 end
function guarded:Render()
 if not self.firstPhase then Budget.Native(function()end);self.firstPhase=true end
 Budget.Native(function()end);self.finished=true
end
budget.limit=1;Budget.BeginFrame(runtime,6)
RenderBudget.AttachTree(guarded,runtime,function()deferredCount=deferredCount+1 end)
local originalGuard=guarded.Render
RenderBudget.AttachTree(guarded,runtime)
assert(guarded.Render==originalGuard,'tree attachment is idempotent and preserves a registered deferred callback')
guarded:Render();guarded:CustomRenderChildren()
assert(not guarded.finished and #guarded:GetRenderChildren()==0 and #guarded:GetHitTestChildren()==0 and not guarded:HitTest(),'incomplete layout is hidden from both drawing and direct hit testing')
assert(deferredCount==1 and paintedChildren==0,'deferred subtree never renders its children')
Budget.BeginFrame(runtime,7)
assert(not guarded:HitTest() and #guarded:GetRenderChildren()==0,'input before the next render must not expose yesterday\'s incomplete geometry')
guarded:Render();guarded:CustomRenderChildren()
assert(guarded.finished and guarded:HitTest() and guarded:GetRenderChildren()[1]==guardedChild and paintedChildren==1,'a completed retry restores the original children and hit testing')
print('Dirty refresh PASS: zero warm visits/captions, selective paths, scope/shadow/props aliases, hidden/collapsed restoration, legacy scan, disposal and exception cleanup.')
print('Measure performance PASS: paint-only zero measurement, prewrite/nil geometry invalidation, shared ancestors once, VM-wide multi-runtime Update/Render budget, frame deduplication and finite multi-frame phase progress. Work counts only, not phone FPS.')
''')
