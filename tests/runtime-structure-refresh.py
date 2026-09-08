"""Real Runtime keyed branches/components; native widget operations are doubles.
Usage: python tests/runtime-structure-refresh.py <adapter> <lupa-package-directory>
"""
import runpy
from pathlib import Path

env = runpy.run_path(str(Path(__file__).with_name("runtime-layout-math.py")))
env["lua"].execute(r'''
local Runtime,Parser,Dirty,Refresh,Measure,Expressions,Paths=
 require('LUI.Runtime'),require('LUI.Parser'),require('LUI.Dirty'),require('LUI.Refresh'),require('LUI.Measure'),require('LUI.LayoutExpressions'),require('LUI.Paths')
local Widget=require('urhox-libs/UI/Core/Widget')
function Widget:RemoveChild(child)
 for i,value in ipairs(self.children)do if value==child then table.remove(self.children,i);child.parent=nil;return end end
end
local destroyed=0
function Widget:Destroy()
 destroyed=destroyed+1;self.destroyed=true
 for i=#self.children,1,-1 do self.children[i]:Destroy()end
 if self.parent then self.parent:RemoveChild(self)end
end
local function render(widget)
 if widget.props.visible==false or widget.props.visibility=='hidden' then return end
 widget:Render(0)
 if widget.CustomRenderChildren then widget:CustomRenderChildren(0,render)
 else for _,child in ipairs(widget:GetChildren())do render(child)end end
end
local directoryComponents={Fixture={Row={markup='Fixture/Row.lui',code='Fixture/Row.lui.lua'}}}
local registry={GetDirectoryComponent=function(_,directory,name)
 local entries=directoryComponents[directory];return entries and entries[name]
end}
local runtime=setmetatable({isV2_=true,registry_=registry,config_={sourceRoots={'Fixture'},changeTracking='notify',componentDirectories={'Fixture'}},documents_={},code_={}},Runtime)
local rowDocument=assert(Parser.Parse([[<控件 名称="Row" 副名称="Row"><按钮 引用="button" 文本="{绑定 props.Data.label}" 背景="{绑定 props.Data.tint}" 点击="{绑定 props.Invoke}"/></控件>]],'Fixture/Row.lui'))
runtime.documents_['Fixture/Row.lui']=rowDocument
local instances,disposed=0,0
runtime.code_['Fixture/Row.lui.lua']={Properties={Data={type='table'},Invoke={type='event'}},New=function(parent,rt,descriptor,properties,slots)
 instances=instances+1
 local self={}
 self.root,self.context=rt:RenderMarkup(descriptor.markup,{view={},props=properties,slots=slots,actions={},refs={},owner=self},parent)
 function self:GetRoot()return self.root end
 function self:Dispose()disposed=disposed+1 end
 return self
end}
local created=0
local build=runtime.BuildNode
function runtime:BuildNode(...)created=created+1;return build(self,...)end
local clicked
local function row(key,label)return{key=key,label=label,callback=function(value)clicked=value end}end
local view={rows={row('a','A'),row('b','B')},show=false}
local document=assert(Parser.Parse([[<控件 名称="Structure" 宽度="390" 高度="200" 目录:x="Fixture">
 <容器 引用="holder" 子项排列="垂直">
  <文本 引用="stable" 文本="unchanged" 字号="12"/>
  <重复项 集合="{绑定 view.rows}" 循环项="item"><x:Row Data="{绑定 item}" Invoke="{绑定 item.callback}"/></重复项>
  <条件 条件="{绑定 view.show}"><x:Row 引用="optional" Data="{绑定 view.optional}" Invoke="{绑定 view.optional.callback}"/></条件>
 </容器>
</控件>]],'Fixture/Main.lui'))
runtime.documents_['Fixture/Main.lui']=document
view.optional=row('o','Optional')
local root,context=runtime:RenderMarkup('Fixture/Main.lui',{view=view,refs={},actions={}})
assert(root,context);Measure.Frame(root,0,0,390,200)
for i=1,3 do render(root)end
local holder=context.refs.holder
assert(#holder.children==3 and instances==2)
local a,b=holder.children[2],holder.children[3]
local instanceA,instanceB=a.luiComponentInstance_,b.luiComponentInstance_
local buttonA=instanceA.context.refs.button
local stable=context.refs.stable
local initialCreated,initialInstances=created,instances
local stableRevision=Measure.Revision(stable)
for i=1,200 do
 view.rows={row('a','A '..i),row('b','B '..i)}
 runtime:NotifyChanged(context,'view.rows');render(root)
 assert(holder.children[2]==a and holder.children[3]==b,'same key retains imported layout hosts')
 assert(a.luiComponentInstance_==instanceA and b.luiComponentInstance_==instanceB,'same key retains component instances')
 buttonA.props.onClick(buttonA,{})
 assert(clicked==view.rows[1] and buttonA.props.text=='A '..i,'retained component caption/callback read latest row scope')
 assert(Measure.Revision(stable)==stableRevision,'unrelated sibling measurement stays valid')
end
assert(created==initialCreated and instances==initialInstances,'200 same-key data replacements create no widgets/components')
render(root);render(root)
local colorMeasurements,colorArrangements=Measure.stats.measurements,Measure.stats.arrangements
view.rows[1].tint='#223344';runtime:NotifyChanged(context,'view.rows[1].tint');render(root)
assert(buttonA.props.backgroundColor[1]==34 and Measure.stats.measurements==colorMeasurements and Measure.stats.arrangements==colorArrangements,'a public row-data paint update does not invalidate component host geometry')
render(root)
local warmCreated,warmParses,warmPaths,warmExpressions,warmNodes=created,Runtime.stats.bindingParses,Paths.stats.parses,Expressions.stats.parses,Refresh.stats.nodes
for i=1,300 do render(root)end
assert(created==warmCreated and Runtime.stats.bindingParses==warmParses and Paths.stats.parses==warmPaths and Expressions.stats.parses==warmExpressions)
assert(Refresh.stats.nodes==warmNodes,'300 static frames create/parse/refresh nothing')
view.rows={view.rows[2],view.rows[1]};runtime:NotifyChanged(context,'view.rows');render(root)
assert(holder.children[2]==b and holder.children[3]==a and created==warmCreated,'reorder moves existing widgets')
local beforeAdd=instances
view.rows[#view.rows+1]=row('c','C');runtime:NotifyChanged(context,'view.rows');render(root)
local c=holder.children[4]
assert(c and c~=a and c~=b and instances==beforeAdd+1,'append constructs only the added component')
local beforeRemove=disposed
table.remove(view.rows,1);runtime:NotifyChanged(context,'view.rows');render(root)
assert(b.destroyed and disposed==beforeRemove+1 and holder.children[2]==a and holder.children[3]==c,'remove disposes only removed subtree')
assert(Measure.Revision(stable)==stableRevision,'add/reorder/remove preserve unrelated leaf cache')
view.show=true;runtime:NotifyChanged(context,'view.show');render(root)
local optional=context.refs.optional
assert(optional and not optional.destroyed)
view.show=false;runtime:NotifyChanged(context,'view.show');render(root)
assert(context.refs.optional==nil and optional.destroyed,'If removal releases imported caller reference')
view.show=true;runtime:NotifyChanged(context,'view.show');render(root)
assert(context.refs.optional and context.refs.optional~=optional,'If restore recreates reference without conflict')
local duplicate=view.rows
view.rows={row('x','X'),row('x','duplicate')};runtime:NotifyChanged(context,'view.rows')
assert(not pcall(render,root),'duplicate stable keys reject before altering the visible child list')
assert(holder.children[2]==a and holder.children[3]==c)
view.rows=duplicate;runtime:NotifyChanged(context,'view.rows');render(root)
local constant=assert(Parser.Parse('<控件 名称="Constant"><条件 条件="{布局 true}"><文本 文本="constant"/></条件></控件>'))
local constantRoot=runtime:BuildNode(constant,Dirty.Configure({refs={}},true));render(constantRoot);constantRoot:Destroy()
local slot=assert(Parser.Parse('<控件 名称="Slot"><内容呈现器/></控件>'))
local slotRoot=runtime:BuildNode(slot,Dirty.Configure({refs={},slots={Content={}}},true));render(slotRoot);slotRoot:Destroy()
-- Slot declarations bind to their author, even inside a component whose own
-- view shadows the caller view. Their conditions/repeats need that same owner.
local caller=Dirty.Configure({view={rows={row('slot-a','Slot A')}},refs={}},true)
local content=assert(Parser.Parse('<控件 名称="Content"><重复项 集合="{绑定 view.rows}"><文本 文本="{绑定 item.label}"/></重复项></控件>')).children
content.luiCallerContext_=caller
local callee=Dirty.Configure(setmetatable({view={},refs={},slots={Content=content}},{__index=caller}),true)
local liveSlot=runtime:BuildNode(slot,callee);render(liveSlot)
local originalSlot=liveSlot.children[1]
assert(originalSlot.props.text=='Slot A')
caller.view.rows={row('slot-a','Slot changed'),row('slot-b','Slot B')};runtime:NotifyChanged(caller,'view.rows');render(liveSlot)
assert(#liveSlot.children==2 and liveSlot.children[1]==originalSlot and originalSlot.props.text=='Slot changed','slot structure notifications use caller scope')
liveSlot:Destroy()
-- Missing preview collections/conditions identify the declaration, while
-- ordinary runtime nil and explicit empty preview arrays remain valid.
for _,fixture in ipairs({
 {tag='重复项',attribute='集合',canonical='In',binding='view.missing'},
 {tag='条件',attribute='条件',canonical='Test',binding='view.missing'},
})do
 local source='Fixture/Missing'..fixture.canonical..'.lui'
 local missing=assert(Parser.Parse('<控件 名称="Missing"><'..fixture.tag..' '..fixture.attribute..'="{绑定 '..fixture.binding..'}"><文本 文本="sample"/></'..fixture.tag..'></控件>',source))
 local ok,err=pcall(runtime.BuildNode,runtime,missing,Dirty.Configure({view={},refs={},luiPreview_=true},true))
 assert(not ok and tostring(err):find(source,1,true) and tostring(err):find('#0/1',1,true) and tostring(err):find('attrs.'..fixture.canonical,1,true) and tostring(err):find(fixture.binding,1,true),'preview error must locate missing structural binding: '..tostring(err))
 local ordinary=runtime:BuildNode(missing,Dirty.Configure({view={},refs={}},true));ordinary:Destroy()
end
local empty=assert(Parser.Parse('<控件 名称="Empty"><重复项 集合="{绑定 view.rows, 预览内容=[]}"><文本 文本="sample"/></重复项></控件>','Fixture/Empty.lui'))
cjson=cjson or {decode=function(value)assert(value=='[]');return{}end}
local emptyRoot=runtime:BuildNode(empty,Dirty.Configure({view={},refs={},luiPreview_=true},true));emptyRoot:Destroy()
local lazy=assert(Parser.Parse('<控件 名称="Lazy"><条件 条件="{布局 count(view.missing) > 0}"><文本 文本="sample"/></条件></控件>','Fixture/Lazy.lui'))
local lazyRoot=runtime:BuildNode(lazy,Dirty.Configure({view={},refs={},luiPreview_=true},true));lazyRoot:Destroy()
-- Framework layout props are forwarded even when the component declares no
-- business property with that name. Resizing retains both host and instance.
directoryComponents.Fixture.LayoutBox={markup='Fixture/LayoutBox.lui',code='Fixture/LayoutBox.lui.lua'}
runtime.documents_['Fixture/LayoutBox.lui']=assert(Parser.Parse('<控件 名称="LayoutBox" 副名称="LayoutBox" 宽度="{绑定 props[\'宽度\']}" 高度="{绑定 props[\'高度\']}"><文本 文本="box"/></控件>','Fixture/LayoutBox.lui'))
runtime.code_['Fixture/LayoutBox.lui.lua']={Properties={},New=runtime.code_['Fixture/Row.lui.lua'].New}
runtime.documents_['Fixture/LayoutHost.lui']=assert(Parser.Parse('<控件 名称="LayoutHost" 宽度="390" 高度="200" 目录:x="Fixture"><x:LayoutBox 引用="box" 宽度="{绑定 view.w}" 高度="{布局 view.h * 2}"/></控件>','Fixture/LayoutHost.lui'))
local layoutView={w=100,h=20}
local layoutRoot,layoutContext=runtime:RenderMarkup('Fixture/LayoutHost.lui',{view=layoutView,refs={}})
render(layoutRoot)
local layoutHost=layoutContext.refs.box.luiComponentHost_ or layoutContext.refs.box
local layoutInstance=layoutHost.luiComponentInstance_
assert(layoutInstance.root.props.height==40 and layoutInstance.root.props.width==100)
layoutView.h,layoutView.w=40,120;runtime:NotifyChanged(layoutContext,{'view.h','view.w'});render(layoutRoot)
assert(layoutHost.luiComponentInstance_==layoutInstance and layoutInstance.root.props.height==80 and layoutInstance.root.props.width==120,'notified bound/expression framework props reach the existing component inner root')
layoutRoot:Destroy()
root:Destroy()
local retained=Dirty.stats.subscriptions
for i=1,100 do
 local fresh,freshContext=runtime:RenderMarkup('Fixture/Main.lui',{view={rows={row('one','One')},show=true,optional=row('option','Option')},refs={},actions={}})
 render(fresh);fresh:Destroy()
 assert(Dirty.stats.subscriptions==retained,'page disposal releases all dependency subscriptions')
end
assert(disposed==instances,'every removed/imported component is disposed exactly once')
local budget=require('LUI.MeasureBudget').Get(runtime)
HandleLuiRuntimeBeginFrame(nil,{GetInt=function(_,name)assert(name=='FrameNumber');return 123456 end})
local budgetFrame=budget.frame
budget.calls=12
HandleLuiRuntimeUpdate(nil,{GetFloat=function()return 1/60 end})
assert(budget.calls==12 and budget.frame==budgetFrame,'Update cannot reset the budget already used by native UI.Update')
HandleLuiRuntimeBeginFrame(nil,{GetInt=function()return 123456 end})
assert(budget.calls==12 and budget.frame==budgetFrame,'duplicate BeginFrame token cannot grant another budget')
HandleLuiRuntimeBeginFrame(nil,{GetInt=function()return 123457 end})
assert(budget.calls==0 and budget.frame==budgetFrame+1,'a new physical frame starts one shared Update/Render budget')
local loader,loads=Parser.Load,0
Parser.Load=function(path)loads=loads+1;return {kind='Element',tag='lui:Component',attrs={Name=path},children={}}end
local cached=setmetatable({documents_={}},Runtime)
local retainedDocument=cached:LoadDocument('Fixture/retained.lui')
for i=1,256 do cached:LoadDocument('Fixture/cache-'..i..'.lui')end
assert(cached.documentCount_==256 and cached.documents_['Fixture/retained.lui']==nil and retainedDocument.attrs.Name=='Fixture/retained.lui','document cache is bounded without destroying live declaration references')
local warmLoads=loads
for i=1,300 do cached:LoadDocument('Fixture/cache-1.lui')end
assert(loads==warmLoads,'warm declaration accesses never reparse')
cached:LoadDocument('Fixture/cache-257.lui')
assert(cached.documents_['Fixture/cache-1.lui'] and not cached.documents_['Fixture/cache-2.lui'],'document eviction preserves recently used declarations')
cached:LoadDocument('Fixture/retained.lui')
assert(loads==warmLoads+2 and cached.documentCount_==256,'evicted declarations load again within the same capacity')
Parser.Load=loader
print('Structure PASS: 200 same-key replacements retain widgets/components and latest clicks; reorder/add/remove/If refs; 300 idle frames; unchanged sibling cache; 100 mount/dispose cycles without subscription growth.')
''')
