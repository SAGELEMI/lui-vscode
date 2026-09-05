"""Production Runtime slot scope, with the official-cache test infrastructure.

Widget/Yoga services are doubles. Actual component creation, property proxies,
imports, repeated scopes, actions and live binding refresh use production Lua.
"""
import runpy
from pathlib import Path

env = runpy.run_path(str(Path(__file__).with_name("runtime-native-controls.py")))
env["lua"].execute(r'''
local Runtime=require('LUI.Runtime')
local Parser=require('LUI.Parser')
local documents={
 ['Fixture/A/Outer.lui']=[[<控件 名称="Outer" 目录:inner="Fixture/B"><容器 子项排列="垂直"><文本 引用="Caption" 文本="{绑定 props['标题']}"/><inner:Leaf 标题="内层属性"><内容呈现器/></inner:Leaf></容器></控件>]],
 ['Fixture/B/Leaf.lui']=[[<控件 名称="Leaf"><容器 子项排列="垂直"><文本 引用="Caption" 文本="{绑定 props['标题']}"/><内容呈现器/></容器></控件>]],
 ['Fixture/C/Stamp.lui']=[[<控件 名称="Stamp"><文本 引用="Caption" 文本="{绑定 props['标题']}"/></控件>]],
 ['Fixture/Page.lui']=[[<页面 名称="Page" 宽度="390" 高度="867" 目录:a="Fixture/A" 目录:caller="Fixture/C"><a:Outer 标题="外层属性"><文本 引用="SlotText" 文本="{绑定 props['标题']}"/><文本 引用="Once" 文本="{绑定 view.message, 模式=单次}"/><按钮 引用="SlotAction" 文本="单击" 点击="{动作 Click}"/><caller:Stamp 标题="{绑定 view.message}"/><caller:Stamp 标题="{绑定 view.message, 模式=单次}"/></a:Outer></页面>]],
 ['Fixture/Repeated.lui']=[[<页面 名称="Repeated" 宽度="390" 高度="867" 目录:a="Fixture/A"><重复项 项目="row" 集合="{绑定 view.rows}"><a:Outer 标题="{绑定 row.title}"><文本 文本="{绑定 row.slot}"/></a:Outer></重复项></页面>]],
}
local runtime=setmetatable({isV2_=true,documents_={},code_={},config_={sourceRoots={'Fixture'},componentDirectories={
 ['Fixture/A']={Outer='Fixture/A/Outer.lui'},['Fixture/B']={Leaf='Fixture/B/Leaf.lui'},['Fixture/C']={Stamp='Fixture/C/Stamp.lui'}
}}},Runtime)
for path,source in pairs(documents) do runtime.documents_[path]=assert(Parser.Parse(source,path)) end
local instances={}
local callerClicks,componentClicks=0,0
local code={Properties={['标题']={type='string',default='默认标题'}}}
function code.New(parent,activeRuntime,descriptor,props,slots)
 local declaration={view={message='组件自己的view'},props=props,slots=slots,refs={},actions={Click=function() componentClicks=componentClicks+1 end}}
 local root,scope=activeRuntime:RenderMarkup(descriptor.markup,declaration,parent)
 assert(root,scope);instances[#instances+1]={path=descriptor.markup,root=root,scope=scope}
 return {GetRoot=function() return root end,Dispose=function() end}
end
for _,path in ipairs({'Fixture/A/Outer.lui','Fixture/B/Leaf.lui','Fixture/C/Stamp.lui'}) do runtime.code_[path..'.lua']=code end
local caller={view={message='调用方初始'},props={['标题']='调用方属性'},refs={},actions={Click=function() callerClicks=callerClicks+1 end}}
local root,scope=runtime:RenderMarkup('Fixture/Page.lui',caller)
assert(root,scope)
assert(scope.refs.SlotText.props.text=='调用方属性','forwarded slot props must come from the original caller')
assert(scope.refs.Once.props.text=='调用方初始','forwarded slot view must not use either component view')
scope.refs.SlotAction.props.onClick(scope.refs.SlotAction)
assert(callerClicks==1 and componentClicks==0,'slot actions use the caller action table')
local stamps,seen={},{}
for _,instance in ipairs(instances) do
 local caption=instance.scope.refs.Caption
 assert(caption and not seen[caption],'each nested/imported instance owns its own refs')
 seen[caption]=true
 if instance.path=='Fixture/C/Stamp.lui' then stamps[#stamps+1]=caption end
end
assert(#stamps==2 and stamps[1].props.text=='调用方初始' and stamps[2].props.text=='调用方初始','slot import resolves only the caller directory aliases')
local function refresh(widget)
 if widget.luiRefreshLayout_ then widget:luiRefreshLayout_() end
 if widget.luiRefreshCaption_ then widget:luiRefreshCaption_(widget) end
 for _,child in ipairs(widget:GetChildren()) do refresh(child) end
end
caller.view.message='调用方更新';caller.props['标题']='调用方新属性';refresh(root)
assert(scope.refs.SlotText.props.text=='调用方新属性' and scope.refs.Once.props.text=='调用方初始','live and once slot bindings keep their own mode')
assert(stamps[1].props.text=='调用方更新' and stamps[2].props.text=='调用方初始','forwarded component props retain live and once semantics')
caller.view.message=nil;refresh(root)
assert(stamps[1].props.text=='默认标题' and stamps[2].props.text=='调用方初始','nil forwards the component default without changing the single-pass instance')
instances={}
local rows={{title='组件甲',slot='槽甲'},{title='组件乙',slot='槽乙'}}
local repeated=assert(runtime:RenderMarkup('Fixture/Repeated.lui',{view={rows=rows},refs={}}))
local function texts(widget,out)
 out=out or {};if widget.props.text~=nil then out[#out+1]=widget.props.text end
 for _,child in ipairs(widget:GetChildren()) do texts(child,out) end
 return out
end
assert(table.concat(texts(repeated),'|')=='组件甲|内层属性|槽甲|组件乙|内层属性|槽乙','repeated slot arrays retain distinct caller aliases')
rows[1].slot='槽甲更新';refresh(repeated)
assert(table.concat(texts(repeated),'|')=='组件甲|内层属性|槽甲更新|组件乙|内层属性|槽乙','one caller update cannot contaminate another repeated slot')
local firstOuter
for _,instance in ipairs(instances) do if instance.path=='Fixture/A/Outer.lui' then firstOuter=instance;break end end
local list=runtime:BuildNode({kind='Element',tag='lui:Slot',attrs={},children={}},firstOuter.scope)
assert(list.__luiList and list.items[1].props.text=='槽甲更新','direct BuildNode slot path also uses the captured caller')
print('Slot scope: nested forwarding, caller imports/props/view/refs/actions, repeated isolation, live/nil/single-pass and both builders PASS.')
''')
