"""Managed overlay lifecycle/coordinate gates; complements the real engine fixture."""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "artifacts/python"))
from lupa.lua54 import LuaRuntime

lua = LuaRuntime(unpack_returned_tuples=True)
lua.globals().source = (root / "packages/runtime-urhox-lua/adapter/Overlays.lua").read_text(encoding="utf-8-sig")
lua.execute(r'''
local stack, components, queue, draws = {}, {}, {}, {}
local currentRoot
local UI={}
function UI.GetRoot() return currentRoot end
function UI.GetOverlayStack() return stack end
function UI.PushOverlay(widget) for _,entry in ipairs(stack) do if entry==widget then return end end;stack[#stack+1]=widget end
function UI.PopOverlay(widget) for i=#stack,1,-1 do if stack[i]==widget then table.remove(stack,i);return end end end
function UI.RegisterGlobalComponent(name,component) components[name]=component end
function UI.QueueOverlay(fn) queue[#queue+1]=fn end
function UI.GetWidth() return 390 end
function UI.GetHeight() return 867 end
function UI.GetVisualRect(widget) return widget:GetAbsoluteLayoutForHitTest() end
local function make(name,props,rect)
 local w={name=name,props=props or {},children={},renderProps_={},rect=rect or {x=0,y=0,w=390,h=867}}
 function w:GetChildren() return self.children end
 function w:AddChild(child) child.parent=self;self.children[#self.children+1]=child end
 function w:RemoveChild(child) for i=#self.children,1,-1 do if self.children[i]==child then table.remove(self.children,i);child.parent=nil end end end
 function w:GetAbsoluteLayout() return self.rect end
 function w:GetAbsoluteLayoutForHitTest() return self.hitRect or self.rect end
 function w:HitTest(x,y) local r=self:GetAbsoluteLayoutForHitTest();return x>=r.x and y>=r.y and x<=r.x+r.w and y<=r.y+r.h end
 function w:IsVisible() return self.props.visible~=false end
 function w:Render() draws[#draws+1]=self.name end
 function w:Destroy() self.destroyCount=(self.destroyCount or 0)+1 end
 return w
end
function UI.RenderWidgetSubtree(widget,nvg) widget:Render(nvg) end
package.loaded['urhox-libs/UI']=UI
local Overlays=assert(load(source,'@Overlays.lua'))()
local root,host=make('root'),make('host',{scale=.6,overflow='hidden'})
root:AddChild(host);currentRoot=root
local coach=make('coach',{pointerEvents='box-none'})
local block=make('block',{pointerEvents='box-only'},{x=0,y=0,w=390,h=100})
coach:AddChild(block)
local notice=make('notice',{pointerEvents='none'})
local errorLayer=make('error',{pointerEvents='box-only'})
local modal=make('modal')
Overlays.Mount(host,coach,400);Overlays.Mount(host,notice,300)
assert(coach.parent==nil and coach.luiOverlayHost_==host,'viewport portal owns no transformed parent')
assert(#stack==1 and stack[1]==coach,'noninteractive notification excluded from input')
for i=1,20 do Overlays.Mount(host,coach,400) end
assert(#stack==1 and #host.luiGlobalOverlays_==2,'mount idempotency')
UI.PushOverlay(modal);Overlays.SyncInput()
assert(stack[1]==modal and stack[2]==coach,'Modal opened later moves below coach')
assert(coach:HitTest(20,20) and not coach:HitTest(200,200),'mask blocks while transparent hole passes')
local callbacks=0
Overlays.AfterNative(root,function() callbacks=callbacks+1;draws[#draws+1]='layout' end)
Overlays.AfterNative(root,function() callbacks=callbacks+1;draws[#draws+1]='layout' end)
UI.QueueOverlay(function() draws[#draws+1]='modal' end)
for _,fn in ipairs(queue) do fn(0) end
components['LUI.GlobalOverlays']:Render(0)
assert(callbacks==1 and table.concat(draws,',')=='modal,layout,notice,coach','one commit after native queue, ordered global rendering')
Overlays.Mount(host,errorLayer,1000)
assert(stack[#stack]==errorLayer,'blocking error above coach')
draws={};components['LUI.GlobalOverlays']:Render(0)
assert(table.concat(draws,',')=='notice,coach,error','stable layer ordering')
coach.props.visible=false;Overlays.SyncInput()
for _,entry in ipairs(stack) do assert(entry~=coach,'hidden stack entry removed') end
coach.props.visible=true;coach.props.pointerEvents='none';Overlays.SyncInput()
for _,entry in ipairs(stack) do assert(entry~=coach,'none stack entry removed') end
coach.props.pointerEvents='box-none';Overlays.Mount(host,coach,400)
block.props.visibility='hidden';assert(not coach:HitTest(20,20),'hidden child does not seal hole')
block.props.visibility=nil
block.props.scale=2;block.props.transformOrigin='top-left'
assert(coach:HitTest(20,180),'child transform inverse used by input gate')
block.props.scale=nil
local clip=make('clip',{overflow='hidden',pointerEvents='box-none'},{x=0,y=0,w=50,h=50})
local clipped=make('clipped',{}, {x=100,y=100,w=50,h=50});clip:AddChild(clipped);coach:AddChild(clip)
assert(not coach:HitTest(120,120),'clipped descendants cannot seal target hole')
function clip:GetScroll() return 0,50 end
clip.props.overflow=nil
assert(not coach:HitTest(120,120),'scroll viewport clips gate')
local duplicate=make('duplicate')
function duplicate:GetHitTestChildren() return {block,clip} end
duplicate.children={block};duplicate.bodyChildren_={block}
assert(#Overlays.Children(duplicate)==2,'native body/hit/normal traversal deduplicates')
currentRoot=make('replacement')
assert(not coach:HitTest(10,10),'old root cannot consume input before Update')
local inactiveRect,inactiveReason=Overlays.VisualRect(block)
assert(inactiveRect==nil and inactiveReason=='inactive-overlay','old root portal child has no active screen rectangle')
components['LUI.GlobalOverlays']:Update(0)
for _,entry in ipairs(stack) do assert(entry~=coach and entry~=errorLayer,'root switch clears managed stack') end
currentRoot=root;Overlays.SyncInput()
local restoredRect=Overlays.VisualRect(block)
assert(restoredRect and restoredRect.x==block.rect.x and restoredRect.w==block.rect.w,'switching back restores portal child screen rectangle')
Overlays.Unmount(coach);assert(coach.luiOverlayHost_==nil,'unmount clears ownership')
Overlays.Mount(host,coach,400);coach:Destroy();coach:Destroy()
assert(coach.destroyCount==1 and not Overlays.Mount(host,coach,400),'Destroy once and no remount of freed tree')
local late=0
Overlays.AfterNative(host,function() late=late+1 end)
host:Destroy();components['LUI.GlobalOverlays']:Render(0)
assert(late==0 and #host.luiGlobalOverlays_==0,'host destruction removes callbacks and portals')
for _,entry in ipairs(stack) do assert(entry~=coach and entry~=errorLayer,'Destroy clears only owned input entries') end
assert(stack[1]==modal,'foreign native overlay preserved')
-- Native Modal paints in viewport coordinates even if its ordinary owner is transformed.
local native=make('native',{scale=.5});native.contentContainer_=make('body');native.RenderModalContent=function()end
native.animProgress_=1;function native:IsOpen()return true end
local body=native.contentContainer_;body.parent=native
local target=make('target',{}, {x=24,y=300,w=342,h=44});target.parent=body
local r=Overlays.VisualRect(target);assert(r.x==24 and r.y==300 and r.w==342,'native body ignores outer modal/host transforms')
native.animProgress_=.5;local r,reason=Overlays.VisualRect(target);assert(r==nil and reason=='modal-animating','animated native target cannot open a mismatched input hole')
print('PASS overlays: native queue, viewport portals, children traversal, 20x idempotency, masks/transform/clip/scroll gates, ordering, hide/none, remount, root switch, Destroy and stale callbacks. GPU/native engine fixture remains separate.')
''')
