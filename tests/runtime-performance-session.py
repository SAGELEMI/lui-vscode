"""Bounded, explicitly started frame-session recorder (synthetic data only).
Usage: python tests/runtime-performance-session.py <adapter> <lupa-package-directory>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[2])
from lupa.lua54 import LuaRuntime, lua_type

lua = LuaRuntime(unpack_returned_tuples=True)
adapter = Path(sys.argv[1])
lua.globals().adapter_read = lambda name: (adapter / name).read_text(encoding="utf-8-sig")

def plain(value):
    if lua_type(value) != "table":
        return value
    entries = dict(value.items())
    if entries and set(entries) == set(range(1, len(entries) + 1)):
        return [plain(entries[index]) for index in range(1, len(entries) + 1)]
    return {key: plain(item) for key, item in entries.items()}

lua.globals().encode_json = lambda value: json.dumps(plain(value), ensure_ascii=False)
lua.execute(r'''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=='LUI.' then return assert(load(adapter_read(name:sub(5)..'.lua'),'@'..name))end
end)
local calls=0
SubscribeToEvent=function()error('profiler must reuse runtime hook')end
UnsubscribeFromEvent=function()error('profiler must not remove game subscriptions')end
collectgarbage=function(mode)assert(mode=='count','must never force collection');calls=calls+1;return 100+calls end
package.loaded['urhox-libs/UI']={Theme={GetScale=function()return 1 end},GetFontVersion=function()return 2 end}
graphics={GetDPR=function()return 3 end}
cjson={encode=function(value)return encode_json(value)end}
local Performance=require('LUI.PerformanceSession')
assert(calls==0,'loading the profiler is inert until explicit Start')
local originalRequire=require;local dirtyCounters={notifications=10}
require=function(name)if name=='LUI.Dirty' then return {stats=dirtyCounters}end;return originalRequire(name)end
local runtime={config_={version='2.6.0',layoutContract='fixture',runtimeManifestHash=string.rep('a',64),fonts={{family='sans',weights={normal={resource='Fonts/fixture.ttf',sha256=string.rep('b',64)}}}}},viewport_={width=390,height=844}}
local session=Performance.Start(runtime,{scene='fixture-scroll',device='synthetic',workload='one-row',run='1',warmupFrames=2,maxSamples=5,memoryEveryFrames=2})
assert(runtime.luiPerformanceSession_==session and calls==1)
assert(not pcall(Performance.Start,runtime,{scene='duplicate'}),'second Start cannot silently replace active samples')
session:Frame(.5);session:Frame(.5)
dirtyCounters.notifications=210
session:Mark('scroll')
for i=1,7 do session:Frame(i/1000)end
session:Frame(0);session:Frame(0/0);session:Frame(math.huge)
local report=session:Stop()
assert(runtime.luiPerformanceSession_==nil and report.stopped)
assert(report.summary.totalFrames==9 and report.summary.sampledFrames==7 and report.summary.sampleCount==5 and report.summary.invalidFrames==3)
assert(report.samplesMilliseconds[1]==3 and report.samplesMilliseconds[5]==7,'ring preserves latest samples in chronological order')
assert(report.summary.meanMilliseconds==5 and report.summary.p50Milliseconds==5 and report.summary.p95Milliseconds==7 and report.summary.p99Milliseconds==7)
assert(report.identity.viewport.dpr==3 and report.identity.fonts[1].sha256==string.rep('b',64))
assert(not report.identityChanged and report.markers[1].label=='scroll' and report.markers[1].frame==2)
assert(report.workCounts['Dirty.notifications']==200,'custom resource-loader modules need not appear under dot names in package.loaded')
local stoppedCalls=calls;session:Frame(.3);session:Stop();assert(calls==stoppedCalls,'stopped profiler has no further sampling/GC-count work')
assert(not pcall(session.Mark,session,'after-stop'))
Exported=session:ExportJSON()
local workTime=0
local workSession=Performance.Start(runtime,{scene='frame-budgets',warmupFrames=0,maxSamples=5,clock=function()return workTime end})
local token=workSession:StartWork('refresh');workTime=.002;assert(workSession:EndWork(token)==2)
workSession:StartWork('refresh');workTime=.005;assert(workSession:EndWork('refresh')==3)
for _,milliseconds in ipairs({8,1000/120,8.5,17,16.8})do workSession:Frame(milliseconds/1000)end
local workReport=workSession:Stop()
assert(workReport.summary.over120BudgetFrames==3 and workReport.summary.over60BudgetFrames==2)
assert(workReport.summary.over120BudgetRatio==.6 and workReport.summary.over60BudgetRatio==.4)
assert(workReport.summary.jitterAdjustedOver120BudgetFrames==2 and workReport.summary.jitterAdjustedOver60BudgetFrames==0)
assert(workReport.synchronousWork.totals.refresh.count==2 and workReport.synchronousWork.totals.refresh.meanMilliseconds==2.5)
assert(workReport.synchronousWork.samples[1].milliseconds==2 and workReport.synchronousWork.sampledSpans==2)
assert(workReport.synchronousWork.source=='options.clock' and not workReport.synchronousWork.nativeClock
 and workReport.synchronousWork.resolutionMilliseconds==nil,'injected clock is explicit and has no invented native resolution')
local savedClock=os.clock
local ticks=4294967294
Time={GetSystemTime=function()return ticks end}
os.clock=function()error('native work timing must not read os.clock')end
local nativeSession=Performance.Start(runtime,{scene='native-clock',warmupFrames=0})
local nativeToken=nativeSession:StartWork('submit')
ticks=1
assert(math.abs(nativeSession:EndWork(nativeToken)-3)<.000001,'native millisecond wrap remains monotonic elapsed seconds')
local nativeReport=nativeSession:Stop()
assert(nativeReport.synchronousWork.source=='Time.GetSystemTime' and nativeReport.synchronousWork.nativeClock
 and nativeReport.synchronousWork.resolutionMilliseconds==1 and nativeReport.synchronousWork.scope:find('wall%-time'),
 'default work spans identify native source, tick granularity and elapsed wall-time semantics')
Time=nil;time={GetSystemTime=function()return ticks end}
local instanceSession=Performance.Start(runtime,{scene='native-instance',warmupFrames=0})
assert(instanceSession:Stop().synchronousWork.source=='time.GetSystemTime','native instance is supported when static Time is absent')
time=nil;os.clock=function()return workTime end
local fallback=Performance.Start(runtime,{scene='fallback-clock',warmupFrames=0})
fallback:StartWork('work');workTime=workTime+.004
assert(math.abs(fallback:EndWork('work')-4)<.000001)
local fallbackReport=fallback:Stop()
assert(fallbackReport.synchronousWork.source=='os.clock' and not fallbackReport.synchronousWork.nativeClock
 and fallbackReport.synchronousWork.resolution=='platform-dependent'
 and fallbackReport.synchronousWork.clockSemantics:find('not assumed'), 'fallback never claims native or wall-clock accuracy')
os.clock=nil
local unavailable=Performance.Start(runtime,{scene='unavailable-clock',warmupFrames=0})
unavailable:StartWork('work');assert(unavailable:EndWork('work')==nil)
local unavailableReport=unavailable:Stop()
assert(unavailableReport.synchronousWork.source=='unavailable' and unavailableReport.synchronousWork.unavailableClockSpans==1,
 'missing clock is unavailable rather than a zero-duration measurement')
os.clock=savedClock
local changed=Performance.Start(runtime,{scene='fixture-rotate',device='synthetic',workload='rotate',warmupFrames=0,maxSamples=3,memoryEveryFrames=1})
for i=1,150 do changed:Frame(.01);changed:Mark('operation')end
runtime.viewport_.width=844
local changedReport=changed:Stop()
assert(changedReport.identityChanged and changedReport.droppedMarkers==22)
assert(#changedReport.memorySnapshots==128 and #changedReport.markers==128 and #changedReport.samplesMilliseconds==3,'all retained samples and markers are bounded')
print('Performance session PASS: native monotonic work clock with wrap/source/resolution, explicit injected/fallback/unavailable clocks, opt-in/inert import, no extra listeners, warmup, bounded samples, p95/p99, identity changes, idempotent Stop and JSON export; synthetic data only.')
''')
report = json.loads(lua.globals().Exported)
assert report["summary"]["sampleCount"] == 5
assert report["identity"]["runtime"]["verification"].startswith("declared-only")
