"""Built-in controls: production Runtime + official 1.29.7 control state logic.

Reuses the hash-validated official-cache bootstrap and infrastructure doubles
from runtime-native-controls.py, then exercises real Toggle, Slider and
ProgressBar constructors/getters/setters. No engine render or player state.
"""
import runpy
from pathlib import Path

folder = Path(__file__).resolve().parent
env = runpy.run_path(str(folder / "runtime-native-controls.py"))
lua = env["lua"]
lua.execute(r'''
local UI=require('urhox-libs/UI')
UI.Toggle=require('urhox-libs/UI/Widgets/Toggle')
UI.Slider=require('urhox-libs/UI/Widgets/Slider')
UI.ProgressBar=require('urhox-libs/UI/Widgets/ProgressBar')
local Widget=require('urhox-libs/UI/Core/Widget')
Widget.ResolveGradientDirection=function(_,x,y,w,h) return x,y,x+w,y+h end
local Runtime=require('LUI.Runtime')
local Parser=require('LUI.Parser')
local defaults=require('LUI.Contract').defaults.progress
local runtime=setmetatable({isV2_=true,config_={componentDirectories={}}},Runtime)
local calls=0
local function build(tag,view,attrs)
 local doc=assert(Parser.Parse('<控件 名称="Builtin"><'..tag..' 引用="Target" '..attrs..'/></控件>','builtin.lui'))
 local context={view=view,refs={},actions={Change=function() calls=calls+1 end}}
 local widget=runtime:BuildNode(doc.children[1],context)
 local target=widget.luiNativeWidget_ or widget
 target.state.focused=true;target.state.scrollY=37
 assert(context.refs.Target==widget)
 return widget,target,context
end
local function refresh(widget,target,context)
 local before,dispatches=calls,target.dispatches
 widget:luiRefreshLayout_()
 assert(calls==before and target.dispatches==dispatches,'source refresh must not emit user callbacks or change events')
 assert(context.refs.Target==widget and (widget.luiNativeWidget_ or widget)==target,'public ref and inner identity must survive')
 assert(target.state.focused and target.state.scrollY==37,'unrelated native state must survive')
end
local view={value=true,disabled=false,color='#123456'}
local toggle,inner,context=build('开关',view,'值="{绑定 view.value}" 禁用="{绑定 view.disabled}" 内边距="4" 外边距="8" 颜色="{绑定 view.color}" 变更="{动作 Change}"')
assert(toggle~=inner and inner.kind=='Toggle' and inner:GetValue())
assert(toggle.props.padding and toggle.props.margin and inner.props.padding==nil)
view.value=false;refresh(toggle,inner,context);assert(not inner:GetValue())
view.value='是';refresh(toggle,inner,context);assert(inner:GetValue())
inner.state.hovered=true;inner.state.pressed=true
view.disabled=true;view.color='#654321';refresh(toggle,inner,context)
assert(inner.props.disabled and not inner.state.hovered and not inner.state.pressed)
assert(inner.props.fontColor[1]==101 and toggle.props.fontColor==nil,'font properties update the native inner')
local before=calls;inner:OnClick();assert(calls==before,'disabled native click cannot toggle')
view.disabled=false;view.value=nil;refresh(toggle,inner,context);assert(not inner:GetValue())
inner:OnClick();assert(inner:GetValue() and calls==before+1,'actual native user action still fires once')
local literal,literalInner=build('开关',{},'值="是" 内边距="4"')
assert(literalInner:GetValue(),'Chinese true is consistent at construction and refresh')
view={value=false}
local plain,plainInner,plainContext=build('开关',view,'值="{绑定 view.value}"')
view.value='是';refresh(plain,plainInner,plainContext)
assert(plain==plainInner and plainInner:GetValue(),'unwrapped toggle also retains its normalized boolean')
view={value=true,disabled=false}
local once,onceInner,onceContext=build('开关',view,'值="{绑定 view.value, 模式=单次}" 禁用="{绑定 view.disabled}" 内边距="4"')
view.value=false;view.disabled=true;refresh(once,onceInner,onceContext);assert(onceInner:GetValue())

view={value=25,min=0,max=100,disabled=false}
local slider,sliderInner,sliderContext=build('滑块',view,'值="{绑定 view.value}" 最小值="{绑定 view.min}" 最大值="{绑定 view.max}" 禁用="{绑定 view.disabled}" 变更="{动作 Change}"')
assert(sliderInner:GetValue()==25)
view.value=200;view.min=10;view.max=80;refresh(slider,sliderInner,sliderContext)
assert(sliderInner:GetValue()==80 and sliderInner.props.min==10 and sliderInner.props.max==80)
view.max=300;refresh(slider,sliderInner,sliderContext);assert(sliderInner:GetValue()==200,'raising max restores the still-bound source value')
view.min=250;view.max=100;refresh(slider,sliderInner,sliderContext)
assert(sliderInner.props.max==250 and sliderInner:GetValue()==250)
view.min=nil;view.max=nil;view.value=nil;refresh(slider,sliderInner,sliderContext)
assert(sliderInner.props.min==0 and sliderInner.props.max==100 and sliderInner:GetValue()==0)
before=calls;sliderInner:SetValue(50);assert(calls==before+1 and sliderInner:GetValue()==50,'native input setter still dispatches')
view={value=42,min=0,max=100}
local single,singleInner,singleContext=build('滑块',view,'值="{绑定 view.value, 模式=单次}" 最小值="{绑定 view.min}" 最大值="{绑定 view.max}"')
view.value=99;view.max=80;refresh(single,singleInner,singleContext)
assert(singleInner:GetValue()==42,'changing range does not reevaluate a single-pass Value')

view={value=25,max=100,track='#102030',fill='#405060',direction='从左到右'}
local progress,progressInner,progressContext=build('进度条',view,'值="{绑定 view.value}" 最大值="{绑定 view.max}" 轨道画刷="{绑定 view.track}" 进度画刷="{绑定 view.fill}" 进度方向="{绑定 view.direction}" 边框宽度="0"')
assert(progressInner:GetValue()==25 and progressInner:GetPercent()==25)
local callsToSet=0;local setValue=progressInner.SetValue
progressInner.SetValue=function(self,value) callsToSet=callsToSet+1;return setValue(self,value) end
view.value=80;view.max=40;view.track='#213141';view.fill='linear-gradient(90deg, #010203 0%, #040506 100%)';view.direction='从下到上'
refresh(progress,progressInner,progressContext)
assert(callsToSet==1,'batched property refresh applies native value once')
assert(progressInner:GetValue()==40 and progressInner.props.max==40)
assert(progressInner.props.luiTrackBrush.color[1]==33 and progressInner.props.luiFillBrush.kind=='linear')
assert(progressInner.luiTrackBrush_==progressInner.props.luiTrackBrush and progressInner.luiFillBrush_==progressInner.props.luiFillBrush)
view.max=200;refresh(progress,progressInner,progressContext);assert(progressInner:GetValue()==80)
local rectangles,paints={},{}
nvgBeginPath=function() end;nvgFill=function() end
nvgRGBA=function(r,g,b,a) return {r,g,b,a} end
nvgRoundedRect=function(_,x,y,w,h) rectangles[#rectangles+1]={x=x,y=y,w=w,h=h} end
nvgFillColor=function(_,color) paints[#paints+1]={kind='solid',color=color} end
nvgLinearGradient=function(_,sx,sy,ex,ey,first,last) return {kind='linear',first=first,last=last} end
nvgFillPaint=function(_,paint) paints[#paints+1]=paint end
progressInner:Render({})
assert(#rectangles==2 and rectangles[2].w==rectangles[1].w and math.abs(rectangles[2].h/rectangles[1].h-0.4)<0.001)
assert(rectangles[2].y>rectangles[1].y and paints[2].kind=='linear','actual LUI progress renderer consumes the new direction and brush')
view.track=nil;view.fill=nil;view.direction=nil;refresh(progress,progressInner,progressContext)
assert(progressInner.props.luiTrackBrush.color==defaults.track and progressInner.props.luiFillBrush.from==defaults.from)
assert(progressInner.props.luiProgressDirection=='从左到右')
view.max=nil;view.value=nil;refresh(progress,progressInner,progressContext)
assert(progressInner.props.max==defaults.max and progressInner:GetValue()==0)
view={value=30,max=100,track='#102030',fill='#405060'}
local onceProgress,onceProgressInner,onceProgressContext=build('进度条',view,'值="{绑定 view.value, 模式=单次}" 最大值="{绑定 view.max}" 轨道画刷="{绑定 view.track, 模式=单次}" 进度画刷="{绑定 view.fill, 模式=单次}"')
view.value=90;view.track='#FFFFFF';view.fill='#000000';view.max=50
refresh(onceProgress,onceProgressInner,onceProgressContext)
assert(onceProgressInner:GetValue()==30 and onceProgressInner.props.luiTrackBrush.color[1]==16 and onceProgressInner.props.luiFillBrush.color[1]==64)
view={value=30,max=100,track='#102030',background='#405060'}
local explicit,explicitInner,explicitContext=build('进度条',view,'值="{绑定 view.value}" 轨道画刷="{绑定 view.track, 模式=单次}" 背景="{绑定 view.background}"')
view.track='#FFFFFF';view.background='#ABCDEF';refresh(explicit,explicitInner,explicitContext)
assert(explicitInner.props.luiTrackBrush.color[1]==16,'live background cannot reevaluate or replace an explicit single-pass track')
view={value=30,background='#405060'}
local fallback,fallbackInner,fallbackContext=build('进度条',view,'值="{绑定 view.value}" 轨道画刷="{绑定 view.track, 模式=单次}" 背景="{绑定 view.background}"')
view.track='#FFFFFF';view.background='#ABCDEF';refresh(fallback,fallbackInner,fallbackContext)
assert(fallbackInner.props.luiTrackBrush.color[1]==171,'a track captured as nil continues following its live background fallback')
view.background=nil;refresh(fallback,fallbackInner,fallbackContext)
assert(fallbackInner.props.luiTrackBrush.color==defaults.track,'removed background restores the default track')
print('Built-in values: official Toggle/Slider/ProgressBar, padded inner routing, silent batch updates, clamping, brush/direction renderer, nil defaults, single-pass and stable refs PASS.')
''')
