"""Restricted layout-expression semantics and notified production bindings.
Uses the real Parser/Runtime/Measure with the existing native UI doubles.
Usage: python tests/runtime-layout-expressions.py <adapter> <lupa-package-directory>
"""
import runpy
from pathlib import Path

env = runpy.run_path(str(Path(__file__).with_name("runtime-layout-math.py")))
env["lua"].execute(r'''
local Expressions,Paths,Dirty,Refresh,Measure,Runtime,Parser=
 require('LUI.LayoutExpressions'),require('LUI.Paths'),require('LUI.Dirty'),require('LUI.Refresh'),require('LUI.Measure'),require('LUI.Runtime'),require('LUI.Parser')
local function evaluate(source,context)return Expressions.Evaluate(assert(Expressions.Parse('{布局 '..source..'}')),context or {})end
assert(evaluate('2 + 3 * 4')==14 and evaluate('(2 + 3) * 4')==20)
assert(evaluate('18 / 3 / 2')==3 and evaluate('10 - 3 - 2')==5 and evaluate('-2 * 3 + 10')==4)
assert(evaluate('min(300, max(80, viewport.width - 16))',{viewport={width=200}})==184)
assert(evaluate('count(view.rows) * 12',{view={rows={1,2,3}}})==36)
assert(evaluate('count(view.rows)',{view={}})==0)
assert(evaluate('choose(false, 1 / 0, 42)')==42 and evaluate('choose(true, false, 1 / 0)')==false,'choose evaluates only selected branch and preserves false')
assert(evaluate('false and 1 / 0')==false and evaluate('true or 1 / 0')==true,'boolean operators short-circuit')
assert(evaluate('not false and 8 >= 7 and 8 ~= 7')==true)
assert(evaluate('choose(view.compact, 80, 120)',{view={compact=true}})==80)
assert(evaluate("props['高度'] + 2",{props={['高度']=10}})==12)
assert(evaluate("'line\\ntext'")=='line\ntext')
local source='{布局 viewport.width - view.padding * 2}'
local spec=Expressions.Parse(source)
local parsed=Expressions.stats.parses
for i=1,200 do assert(Expressions.Parse(source)==spec)end
assert(Expressions.stats.parses==parsed,'warm expression parsing reuses its AST')
local outer=Expressions.Scope({['布局:cell']='{布局 (viewport.width - view.padding * 2) / 2}'},{viewport={width=390},view={padding=10}})
local inner=Expressions.Scope({['布局:double']='{布局 layout.cell * 2}'},outer)
assert(evaluate('layout.double',inner)==370)
local dependencies=Expressions.Dependencies(Expressions.Parse('{布局 layout.double + layout.cell}'),inner)
local expected={['viewport.width']=true,['view.padding']=true}
assert(#dependencies==2)
for _,path in ipairs(dependencies)do assert(expected[path]);expected[path]=nil end
assert(next(expected)==nil,'named layout dependencies expand to their data/viewport sources and deduplicate')
assert(not pcall(function()inner.layout.double=100 end),'layout locals are read-only')
local cycle=Expressions.Scope({['布局:a']='{布局 layout.b}', ['布局:b']='{布局 layout.a}'},{})
assert(not pcall(evaluate,'layout.a',cycle),'cyclic layout values reject')
assert(not pcall(Expressions.Dependencies,Expressions.Parse('{布局 layout.a}'),cycle),'cyclic dependency expansion rejects')

local function render(widget)
 if widget.props.visible==false or widget.props.visibility=='hidden' then return end
 widget:Render(0)
 if widget.CustomRenderChildren then widget:CustomRenderChildren(0,render)
 else for _,child in ipairs(widget:GetChildren())do render(child)end end
end
local runtime=setmetatable({isV2_=true,config_={componentDirectories={}}},Runtime)
local context=Dirty.Configure({view={width=220,compact=false,padding=10,tint='#112233'},viewport={width=390,height=844},refs={}},true)
local doc=assert(Parser.Parse([[<控件 名称="Expressions" 宽度="{布局 viewport.width}" 高度="200" 布局:cell="{布局 min(view.width, viewport.width - view.padding * 2) / 2}">
 <容器 子项排列="水平">
  <容器 引用="dynamic" 宽度="{布局 choose(view.compact, 80, layout.cell)}" 高度="40" 背景="{绑定 view.tint}"/>
  <容器 引用="independent" 宽度="60" 高度="40"/>
 </容器>
</控件>]],'expressions.lui'))
local root=runtime:BuildNode(doc,context);Measure.Frame(root,0,0,390,200);render(root)
assert(context.refs.dynamic.props.width==110 and context.refs.dynamic:GetLayout().w==110)
local evaluations,nodes,measurements,arrangements=Expressions.stats.evaluations,Refresh.stats.nodes,Measure.stats.measurements,Measure.stats.arrangements
for i=1,120 do render(root)end
assert(Expressions.stats.evaluations==evaluations and Refresh.stats.nodes==nodes,'stable notified render does not evaluate expressions or scan bindings')
assert(Measure.stats.measurements==measurements and Measure.stats.arrangements==arrangements,'stable notified render preserves geometry caches')
local siblingRevision=Measure.Revision(context.refs.independent)
context.view.compact=true;runtime:NotifyChanged(context,'view.compact');render(root)
assert(context.refs.dynamic.props.width==80 and context.refs.dynamic:GetLayout().w==80)
assert(Measure.Revision(context.refs.independent)==siblingRevision,'local geometry changes preserve sibling measurement cache')
context.view.compact=false;context.view.width=260;runtime:NotifyChanged(context,{'view.compact','view.width'});render(root)
assert(context.refs.dynamic.props.width==130,'local declaration dependencies stay live')
local revision=Measure.Revision(context.refs.dynamic)
measurements,arrangements=Measure.stats.measurements,Measure.stats.arrangements
context.view.tint='#334455';runtime:NotifyChanged(context,'view.tint');render(root)
assert(context.refs.dynamic.props.backgroundColor[1]==51)
assert(Measure.Revision(context.refs.dynamic)==revision and Measure.stats.measurements==measurements and Measure.stats.arrangements==arrangements,'bound paint change does not measure or arrange')

-- Dynamic button variants must update the concrete LUI palette, not only the
-- semantic variant token.  Repeated tab buttons are the production case that
-- exposed stale selected colors in the game.
local tabContext=Dirty.Configure({view={active='a',tabs={{id='a',label='A'},{id='b',label='B'}}},refs={}},true)
local tabDoc=assert(Parser.Parse([[<控件 名称="DynamicTabs"><重复项 项目="tab" 集合="{绑定 view.tabs}"><按钮 文本="{绑定 tab.label}" 外观="{布局 choose(tab.id == view.active, '高亮', '常规')}"/></重复项></控件>]],'dynamic-tabs.lui'))
local tabRoot=runtime:BuildNode(tabDoc,tabContext);render(tabRoot)
local firstTab,secondTab=tabRoot.children[1],tabRoot.children[2]
assert(firstTab.props.variant=='primary' and secondTab.props.variant=='secondary')
assert(firstTab.props.backgroundColor[1]==120 and secondTab.props.backgroundColor[1]==56)
tabContext.view.active='b';runtime:NotifyChanged(tabContext,'view.active');render(tabRoot)
assert(tabRoot.children[1]==firstTab and tabRoot.children[2]==secondTab,'variant paint update retains repeated button instances')
assert(firstTab.props.variant=='secondary' and secondTab.props.variant=='primary','repeated tab semantic variants switch')
assert(firstTab.props.backgroundColor[1]==56 and firstTab.props.borderColor[1]==120
 and secondTab.props.backgroundColor[1]==120 and secondTab.props.borderColor[1]==175,'repeated tab concrete palette switches with the variant')
tabContext.view.active='a';runtime:NotifyChanged(tabContext,'view.active');render(tabRoot)
assert(firstTab.props.variant=='primary' and firstTab.props.backgroundColor[1]==120
 and secondTab.props.variant=='secondary' and secondTab.props.backgroundColor[1]==56,'dynamic variants can switch back without reconstruction')

local customContext=Dirty.Configure({view={active=true},refs={}},true)
local customDoc=assert(Parser.Parse([[<控件 名称="CustomVariant"><按钮 引用="custom" 外观="{布局 choose(view.active, '高亮', '常规')}" 背景="#123456" 边框颜色="#654321" 悬停背景="#234567" 按下背景="#345678"/></控件>]],'custom-variant.lui'))
local customRoot=runtime:BuildNode(customDoc,customContext);render(customRoot)
local custom=customContext.refs.custom
customContext.view.active=false;runtime:NotifyChanged(customContext,'view.active');render(customRoot)
assert(custom.props.variant=='secondary' and custom.props.backgroundColor[1]==18 and custom.props.borderColor[1]==101
 and custom.props.hoverBackgroundColor[1]==35 and custom.props.pressedBackgroundColor[1]==52,'explicit button paints override dynamic variant defaults')
local ButtonVariant=require('LUI.ButtonVariant')
local previousSetStyle=firstTab.SetStyle
firstTab.SetStyle=function()error('fixture setter failed')end
local variantOk,variantError=pcall(ButtonVariant.Apply,firstTab,'secondary')
firstTab.SetStyle=previousSetStyle
assert(not variantOk and tostring(variantError):find('组件=dynamic%-tabs%.lui')
 and tostring(variantError):find('旧值=primary') and tostring(variantError):find('新值=secondary')
 and tostring(variantError):find('绑定路径={布局 choose',1,true),
 'dynamic variant errors identify component, values and binding path')
context.viewport.width=200;runtime:NotifyChanged(context,'viewport.width');Measure.Frame(root,0,0,200,200);render(root)
assert(context.refs.dynamic.props.width==90,'viewport changes invalidate expanded layout locals')

for _,source in ipairs({
 'os.execute("ignored")', 'require("ignored")', 'view.callback()', 'load("return 1")',
 '_G', 'view.__index', 'view["__proto__"]', 'view["constructor"]', 'view["prototype"]',
 '{}', 'function() end', '1; 2', '1 .. 2', 'min()', 'count(1, 2)', 'choose(true, 1)',
 'min(1,)', 'view[other]', '"unterminated',
 string.rep('(',65)..'1'..string.rep(')',65), string.rep('1+',260)..'1',
})do
 assert(not pcall(evaluate,source,{}),'must reject unsafe or invalid expression: '..source)
end
for _,source in ipairs({'1 / 0','view.missing + 1','count(42)','min("bad",1)'})do
 assert(not pcall(evaluate,source,{view={}}),'must reject invalid runtime operand: '..source)
end
assert(not pcall(evaluate,'view.value + 1',{view={value=math.huge}}),'nonfinite source operand rejects')
assert(not pcall(evaluate,string.rep('9',400)),'nonfinite numeric literal rejects')
assert(evaluate('view.rows[1].width',{view={rows={{width=30}}}})==30,'numeric row paths use Lua one-based indices')
assert(not pcall(evaluate,'view.rows[0]',{view={rows={}}}),'zero index rejects')
print('Layout expressions PASS: precedence, lazy branches, finite operands, cached AST, scoped locals/dependencies, real notify/layout/paint behavior and zero warm evaluation/measurement/arrangement.')
''')
