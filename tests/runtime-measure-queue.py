"""Bounded weak-owner background scheduling; no native rendering or real time.
Usage: python tests/runtime-measure-queue.py <adapter> <lupa-package-directory>
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
local Budget,Queue=require('LUI.MeasureBudget'),require('LUI.MeasureQueue')
local a,b={runtime_={}},{runtime_={}}
local budget=Budget.Get(a.runtime_);budget.clock=function()return 0 end
local log={}
local function row(owner)
 log[#log+1]=owner
 Budget.Run(Budget.Get(owner.runtime_),function()Budget.Native(function()end)end,owner)
 return true
end
Budget.BeginFrame(a.runtime_,1)
assert(Queue.Schedule(a,row) and Queue.Schedule(a,row) and Queue.Schedule(b,row))
assert(#log==0 and budget.calls==0,'scheduling never consumes foreground Update/Render budget')
for i=1,62 do assert(Budget.Guard(budget,function()Budget.Native(function()end)end))end
assert(Queue.Drain()==2 and #log==2 and log[1]~=log[2] and budget.calls==64,
 'both foreground lists run before background uses only remaining starts, once per owner in a round')
Budget.BeginFrame(b.runtime_,2)
budget.limit=1
Queue.Drain();local previous=log[#log]
Budget.BeginFrame(a.runtime_,3);Queue.Drain()
assert(log[#log]~=previous,'round-robin cursor persists across exhausted frames')
Queue.Cancel(a);Queue.Cancel(a);Queue.Cancel(b)
Budget.BeginFrame(a.runtime_,4);assert(Queue.Drain()==0,'cancellation removes pending callbacks')
budget.calls=64
local injectedOwner={runtime_={luiMeasureBudget_={clock=function()return 0 end,limit=1,seconds=.002,
 calls=0,rows=0,frame=1,overrunMilliseconds=0}}}
Queue.Schedule(a,row)
Queue.Schedule(injectedOwner,function(owner)row(owner);return false end)
assert(Queue.Drain()==1 and budget.calls==64 and injectedOwner.runtime_.luiMeasureBudget_.calls==1,
 'a spent production slice does not suppress an explicit independent test budget')
Queue.Cancel(a)
local weak=setmetatable({},{__mode='v'})
do
 local retired={runtime_={},rows={{label='transient'}}}
 weak[1],weak[2]=retired,retired.rows
 Queue.Schedule(retired,function(owner)assert(owner==retired);return true end)
end
collectgarbage('collect');collectgarbage('collect')
assert(next(weak)==nil,'neither owner nor callback-captured row graph is held by the queue')
local full={}
for i=1,Queue.capacity do full[i]={runtime_={}};assert(Queue.Schedule(full[i],function()return false end))end
assert(not Queue.Schedule({runtime_={}},row),'queue capacity is bounded')
Queue.Cancel(full[1]);assert(Queue.Schedule(a,row),'released capacity is reusable')
for _,owner in ipairs(full)do Queue.Cancel(owner)end
Queue.Cancel(a);budget.limit=64
local failed={runtime_={}}
Queue.Schedule(failed,function()error('expected background failure')end)
Budget.BeginFrame(a.runtime_,5);assert(not pcall(Queue.Drain))
assert(Queue.Drain()==0,'failed jobs release the queue entry without swallowing errors')
print('MeasureQueue PASS: foreground first, shared remainder, round-robin fairness, dedup/capacity, cancellation, weak owner/row release and error cleanup.')
''')
