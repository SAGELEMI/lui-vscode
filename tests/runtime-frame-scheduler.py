"""Production scheduler isolation from per-LuaScript global event replacement.

The event receiver follows the public Node/CreateScriptObject API. These event
and UI doubles exercise subscription/lifetime semantics without an engine run.
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "artifacts/python"))
from lupa.lua54 import LuaRuntime

setup = r'''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=='LUI.' then return assert(load(adapter_read(name:sub(5)),'@'..name)) end
end)
package.loaded['urhox-libs/UI']={GetWidth=function()return 390 end,GetHeight=function()return 844 end}
package.loaded['urhox-libs/UI/Core/Widget']={}
Time={GetSystemTime=function()return 0 end}
globalHandlers,globalSubscriptions={},0
function SubscribeToEvent(event,handler)
 globalSubscriptions=globalSubscriptions+1
 globalHandlers[event]=handler
end
function emitGlobal(event,data)
 local handler=globalHandlers[event]
 if type(handler)=='string' then handler=_G[handler] end
 if handler then handler(event,data) end
end
'''

def fresh():
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.globals().adapter_read = lambda name: (root / "packages/runtime-urhox-lua/adapter" / f"{name}.lua").read_text(encoding="utf-8-sig")
    lua.execute(setup)
    return lua

lua = fresh()
lua.execute(r'''
local receivers={}
local created,removed,subscriptions=0,0,0
function Node()
 created=created+1
 local node={}
 function node:CreateScriptObject(class)
  assert(class=='LuaScriptObject')
  local receiver={handlers={}}
  function receiver:SubscribeToEvent(event,handler)
   assert(type(handler)=='function');subscriptions=subscriptions+1
   self.handlers[event]=handler
  end
  receivers[receiver]=true;self.receiver=receiver;return receiver
 end
 function node:Remove()
  assert(not self.removed,'private node removed only once')
  self.removed=true;removed=removed+1;receivers[self.receiver]=nil
 end
 return node
end
local function emit(event,data)
 emitGlobal(event,data)
 local snapshot={};for receiver in pairs(receivers)do snapshot[#snapshot+1]=receiver end
 for _,receiver in ipairs(snapshot)do
  local callback=receiver.handlers[event]
  if callback then callback(receiver,event,data) end
 end
end
local Runtime=require('LUI.Runtime')
local Budget=require('LUI.MeasureBudget')
local Queue=require('LUI.MeasureQueue')
local drained=0
local drain=Queue.Drain
Queue.Drain=function()drained=drained+1;return drain()end
local frameA,frameB=0,0
local app={business=true}
local first=setmetatable({app_=app,luiPerformanceSession_={Frame=function(_,dt)assert(dt==.02);frameA=frameA+1 end}},Runtime)
local second=setmetatable({luiPerformanceSession_={Frame=function(_,dt)assert(dt==.02);frameB=frameB+1 end}},Runtime)
first:EnsureFrameScheduler();second:EnsureFrameScheduler();first:EnsureFrameScheduler()
assert(created==1 and subscriptions==3 and globalSubscriptions==0,
 'all runtimes share one private receiver and never occupy the business LuaScript event slots')
local b=Budget.Get(first)
assert(b==Budget.Get(second))
-- This is Startup.Run's production order: Runtime was already rendered, then
-- the same LuaScript subscribes its business HandleUpdate and other phases.
local business={BeginFrame=0,Update=0,EndFrame=0}
for _,event in ipairs({'BeginFrame','Update','EndFrame'})do
 local function old()error('replaced global handler must not run')end
 SubscribeToEvent(event,old)
 SubscribeToEvent(event,function()business[event]=business[event]+1 end)
end
local data={GetInt=function(_,name)assert(name=='FrameNumber');return 1001 end,
 GetFloat=function(_,name)assert(name=='TimeStep');return .02 end}
b.calls=20;local previous=b.frame
emit('BeginFrame',data)
assert(b.frame==previous+1 and b.calls==0,'both runtimes reset the shared budget only once per physical frame')
b.calls=64;emit('Update',data)
assert(frameA==1 and frameB==1 and b.calls==64,'private Update samples both sessions after global handler replacement without resetting budget')
emit('BeginFrame',data)
assert(b.frame==previous+1 and b.calls==64,'duplicate BeginFrame token grants no extra budget')
emit('EndFrame',data)
assert(drained==1 and business.BeginFrame==2 and business.Update==1 and business.EndFrame==1,
 'private EndFrame drains once and all independent business subscriptions still run')
-- The receiver callbacks reference only the weak runtime set, so an abandoned
-- runtime and its application can collect while the receiver is still active.
local weak=setmetatable({first,second,app},{__mode='v'})
first,second,app=nil,nil,nil
collectgarbage('collect');collectgarbage('collect')
assert(weak[1]==nil and weak[2]==nil and weak[3]==nil,'private event callbacks do not retain Runtime or app')
emit('BeginFrame',data)
assert(removed==1 and next(receivers)==nil,'the next phase removes the idle private node')
emit('Update',data);emit('EndFrame',data)
assert(frameA==1 and frameB==1 and drained==1,'no LUI background callbacks remain after idle receiver removal')
local third=setmetatable({},Runtime)
third:EnsureFrameScheduler()
assert(created==2 and subscriptions==6,'later Runtime creates a fresh private receiver')
data.GetInt=function()return 1002 end
emit('BeginFrame',data)
assert(b.frame==previous+2 and b.calls==0,'the recreated scheduler resumes frame accounting')
third=nil;collectgarbage('collect');collectgarbage('collect');emit('EndFrame',data)
assert(removed==2 and next(receivers)==nil and drained==1,'EndFrame also releases an idle receiver without draining')
print('Frame scheduler native receiver PASS: global overwrite isolation, one VM receiver, shared token, samples/drain, weak app lifetime, remove and recreate.')
''')

lua = fresh()
lua.execute(r'''
assert(Node==nil)
local Runtime=require('LUI.Runtime')
local Budget=require('LUI.MeasureBudget')
local runtime=setmetatable({},Runtime)
runtime:EnsureFrameScheduler();runtime:EnsureFrameScheduler()
assert(globalSubscriptions==3 and globalHandlers.BeginFrame=='HandleLuiRuntimeBeginFrame',
 'pure-Lua hosts without Node keep the existing global test-double fallback')
local b=Budget.Get(runtime);b.calls=64
emitGlobal('BeginFrame',{GetInt=function()return 1 end})
assert(b.calls==0 and b.frame==1)
print('Frame scheduler pure-Lua fallback PASS.')
''')
