"""Actual adapter drawing calls for main/state paints and bound replacements."""
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'artifacts/python'))
from lupa.lua54 import LuaRuntime
lua=LuaRuntime(unpack_returned_tuples=True)
lua.globals().read_adapter=lambda name:(root/'packages/runtime-urhox-lua/adapter'/name).read_text(encoding='utf-8-sig')
lua.execute(r'''
local Widget={}
function Widget.ResolveGradientDirection(direction,x,y,w,h) return x,y,x+w,y end
package.loaded['urhox-libs/UI/Core/Widget']=Widget
local Brush=assert(load(read_adapter('Brush.lua')))()
package.loaded['LUI.Brush']=Brush
package.loaded['LUI.NativeControls']={Apply=function()end}
package.loaded['LUI.BuiltinValues']={Apply=function()end}
local LiveProps=assert(load(read_adapter('LiveProps.lua')))()
local draws={}
function nvgRGBA(...) return {...} end
function nvgFillColor(_,color) draws[#draws+1]={solid=color} end
function nvgLinearGradient(_,x,y,ex,ey,from,to) return {from=from,to=to,x=x,ex=ex} end
function nvgFillPaint(_,paint) draws[#draws+1]=paint end
function nvgFill() end
local widget={_className='Button',props={},state={}}
function widget:CreateShapePath() end
function widget:SetStyle(style) for k,v in pairs(style)do self.props[k]=v end end
-- Native fallback semantics, with actual adapter gradient drawing below.
function widget:RenderFullBackground(nvg,overrides)
 if self.fail then error('native paint failure') end
 local solid=overrides.backgroundColor or self.props.backgroundColor
 local gradient=overrides.backgroundGradient or self.props.backgroundGradient
 if solid then nvgFillColor(nvg,solid) end
 if gradient then self:RenderGradientBackground(nvg,{x=0,y=0,w=100,h=40},gradient) end
end
local a=Brush.Require('linear-gradient(0deg, #FF0000 10%, #FFFF00 90%)')
local b=Brush.Require('linear-gradient(90deg, #0000FF 20%, #00FFFF 80%)')
Brush.ApplyBackground(widget.props,a)
widget.props.hoverBackgroundGradient={direction=b.angle,from=b.from,to=b.to,fromOffset=b.fromOffset,toOffset=b.toOffset}
widget.props.pressedBackgroundColor={1,2,3,255}
Brush.AttachBackground(widget,a,{Background='bound',HoverBackground='bound',PressedBackground='bound'})
local function draw() draws={};widget:RenderFullBackground(0,{});return draws[#draws] end
assert(draw().from[1]==255,'normal main gradient reaches NanoVG')
widget.state.hovered=true
local painted=draw()
assert(painted.from[3]==255 and painted.from[1]==0 and painted.x==20 and painted.ex==80,'hover uses its own colors and stops')
widget.state.pressed=true
painted=draw()
assert(painted.solid[1]==1 and #draws==1,'solid pressed paint suppresses main gradient')
assert(widget.props.backgroundGradient.from[1]==255,'scoped paint restores main props')
widget.fail=true;assert(not pcall(draw));widget.fail=false
assert(widget.props.backgroundGradient.from[1]==255,'native failure restores main props')
widget.state.pressed=false
local solid={backgroundColor={17,34,51,255}}
LiveProps.Apply(widget,'Button',{Background={value='#112233'}},solid)
painted=draw()
assert(painted.from[3]==255 and painted.x==20,'gradient->solid refresh preserves explicitly authored hover gradient')
widget.state.hovered=false
assert(draw().solid[1]==17 and #draws==1,'new solid draws no stale main gradient')
LiveProps.Apply(widget,'Button',{Background={}}, {})
widget.state.hovered=true
assert(draw().from[3]==255,'nil main still allows independently authored hover gradient')
local nextProps={};Brush.ApplyBackground(nextProps,b)
LiveProps.Apply(widget,'Button',{Background={value=b.source}},nextProps)
widget.state.hovered=false
assert(draw().from[3]==255 and draw().x==20,'replacement main gradient draws current paint and stops')
print('PASS brush drawing: native fallback, distinct main/hover gradients and stops, solid state suppresses main gradient, live gradient/solid/nil replacements preserve explicit states, exceptions restore draw-scoped props.')
''')
