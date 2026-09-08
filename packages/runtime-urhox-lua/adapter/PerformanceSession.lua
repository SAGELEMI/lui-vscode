-- Explicit opt-in only. Runtime's existing Update hook checks one optional
-- field; no new listener, I/O, forced GC or automatic sampling is installed.
local UI = require("urhox-libs/UI")
local Budget = require("LUI.MeasureBudget")
local Performance = {}
local Session = {}
Session.__index = Session

local function integer(value, fallback, maximum)
    return math.max(0, math.min(maximum, math.floor(tonumber(value) or fallback)))
end

local function readNumber(owner, method, fallback)
    if owner and type(owner[method]) == "function" then
        local ok, value = pcall(owner[method], owner)
        if ok and type(value) == "number" then return value end
    end
    return fallback
end

local function memory()
    if type(collectgarbage) ~= "function" then return nil end
    local ok, value = pcall(collectgarbage, "count")
    return ok and type(value) == "number" and value or nil
end

local function identity(runtime)
    local config, viewport = runtime.config_ or {}, runtime.viewport_ or {}
    local fonts = {}
    for _, family in ipairs(config.fonts or {}) do
        for weight, descriptor in pairs(family.weights or {}) do
            fonts[#fonts + 1] = { family=family.family, weight=weight,
                resource=type(descriptor)=="table" and descriptor.resource or descriptor,
                sha256=type(descriptor)=="table" and descriptor.sha256 or nil }
        end
    end
    table.sort(fonts, function(a,b) return tostring(a.family)..":"..tostring(a.weight) < tostring(b.family)..":"..tostring(b.weight) end)
    return { viewport={width=viewport.width or readNumber(UI,"GetWidth",0),height=viewport.height or readNumber(UI,"GetHeight",0),
            dpr=readNumber(graphics,"GetDPR",nil),scale=readNumber(UI.Theme,"GetScale",nil)},
        fonts=fonts,fontVersion=readNumber(UI,"GetFontVersion",0),
        runtime={version=config.version,layoutContract=config.layoutContract,manifestHash=config.runtimeManifestHash,
            verification="declared-only; actual SHA verification belongs to build/deployment"} }
end

local counterModules = {}
local function counters()
    local result = {}
    for module, fields in pairs({Runtime={"bindingParses"},Paths={"parses"},LayoutExpressions={"parses","evaluations"},
        Refresh={"nodes","captions"},Measure={"measurements","arrangements","invalidations"},Dirty={"notifications"}}) do
        local loaded = counterModules[module]
        if loaded == nil then
            -- UrhoX's resource loader may cache under normalized slash paths,
            -- so package.loaded['LUI.X'] is not proof that X is unavailable.
            local ok, value = pcall(require, 'LUI.'..module)
            loaded = ok and type(value)=='table' and value or false
            counterModules[module] = loaded
        end
        for _, field in ipairs(fields) do
            local value = loaded and loaded.stats and loaded.stats[field]
            if type(value)=='number' then result[module.."."..field] = value end
        end
    end
    return result
end

local function same(a,b)
    if type(a) ~= type(b) then return false end
    if type(a) ~= "table" then return a == b end
    for key,value in pairs(a) do if not same(value,b[key]) then return false end end
    for key in pairs(b) do if a[key] == nil then return false end end
    return true
end

function Performance.Start(runtime, options)
    assert(type(runtime)=="table", "LUI performance session requires a Runtime")
    assert(not runtime.luiPerformanceSession_, "Stop the active LUI performance session first")
    options = options or {}
    assert(type(options.scene)=="string" and options.scene~="", "LUI performance scene is required")
    local self = setmetatable({}, Session)
    self:Init(runtime, options)
    runtime.luiPerformanceSession_ = self
    return self
end

function Session:Init(runtime, options)
    self.runtime_,self.scene_,self.run_ = runtime,options.scene,tostring(options.run or "1")
    self.device_,self.workload_ = tostring(options.device or "unspecified"),tostring(options.workload or "unspecified")
    self.identity_ = identity(runtime)
    self.maxSamples_ = math.max(1,integer(options.maxSamples,3600,10000))
    self.warmupFrames_ = integer(options.warmupFrames,120,10000)
    self.memoryEveryFrames_ = math.max(1,integer(options.memoryEveryFrames,120,10000))
    self.frames_,self.sampledFrames_,self.invalidFrames_,self.elapsedMilliseconds_ = 0,0,0,0
    self.samples_,self.markers_,self.memory_ = {},{},{}
    self.workSamples_,self.workTotals_,self.activeWork_ = {},{},{}
    self.workCount_,self.workLabels_,self.unavailableWorkClock_ = 0,0,0
    if options.clock ~= nil then
        assert(type(options.clock)=='function', 'LUI performance clock must return elapsed seconds')
        self.workClock_,self.workClockInfo_ = options.clock, {source='options.clock',native=false,available=true,
            resolution='caller-defined; unknown',semantics='caller-provided elapsed seconds'}
    else
        self.workClock_,self.workClockInfo_ = Budget.Clock()
    end
    self.baselineCounters_ = counters()
    self.stopped_ = false
    self:MemorySnapshot("start")
end

local function workClock(session)
    if not session.workClockInfo_.available then return nil end
    local ok, value = pcall(session.workClock_)
    return ok and type(value)=='number' and value==value and value~=math.huge and value~=-math.huge and value or nil
end

function Session:StartWork(label)
    assert(not self.stopped_, 'LUI performance session is stopped')
    assert(type(label)=='string' and label~='' and #label<=160, 'LUI work label must contain 1-160 bytes')
    assert(not self.activeWork_[label], 'LUI work label is already active')
    if not self.workTotals_[label] then
        assert(self.workLabels_<64, 'LUI performance supports at most 64 work labels')
        self.workLabels_=self.workLabels_+1
        self.workTotals_[label]={count=0,totalMilliseconds=0,maxMilliseconds=0}
    end
    local token={label=label,start=workClock(self),frame=self.frames_}
    self.activeWork_[label]=token
    return token
end

function Session:EndWork(labelOrToken)
    assert(not self.stopped_, 'LUI performance session is stopped')
    local label=type(labelOrToken)=='table' and labelOrToken.label or labelOrToken
    local token=self.activeWork_[label]
    assert(token and (type(labelOrToken)~='table' or token==labelOrToken), 'LUI work span is not active')
    self.activeWork_[label]=nil
    local finish=workClock(self)
    if not token.start or not finish or finish<token.start then self.unavailableWorkClock_=self.unavailableWorkClock_+1;return nil end
    local elapsed=(finish-token.start)*1000
    if token.frame<self.warmupFrames_ then return elapsed end
    local total=self.workTotals_[label]
    total.count,total.totalMilliseconds,total.maxMilliseconds=total.count+1,total.totalMilliseconds+elapsed,math.max(total.maxMilliseconds,elapsed)
    self.workCount_=self.workCount_+1
    self.workSamples_[(self.workCount_-1)%self.maxSamples_+1]={label=label,milliseconds=elapsed,frame=self.frames_}
    return elapsed
end

function Session:MemorySnapshot(label)
    local value = memory()
    if value == nil then return end
    self.peakLuaKiB_ = math.max(self.peakLuaKiB_ or value,value)
    -- Keep the starting snapshot and latest 127 snapshots.
    if #self.memory_ >= 128 then table.remove(self.memory_,2) end
    self.memory_[#self.memory_+1] = {label=label,frame=self.frames_,elapsedMilliseconds=self.elapsedMilliseconds_,luaKiB=value}
end

function Session:Mark(label)
    assert(not self.stopped_, "LUI performance session is stopped")
    assert(type(label)=="string" and label~="" and #label<=160,"LUI performance marker must contain 1-160 bytes")
    if #self.markers_ >= 128 then self.droppedMarkers_=(self.droppedMarkers_ or 0)+1;return false end
    self.markers_[#self.markers_+1] = {label=label,frame=self.frames_,sampledFrame=self.sampledFrames_,elapsedMilliseconds=self.elapsedMilliseconds_}
    self:MemorySnapshot("mark:"..label)
    return true
end

function Session:Frame(timeStep)
    if self.stopped_ then return end
    if type(timeStep)~="number" or timeStep~=timeStep or timeStep<=0 or timeStep==math.huge then
        self.invalidFrames_=self.invalidFrames_+1;return
    end
    self.frames_=self.frames_+1
    self.elapsedMilliseconds_=self.elapsedMilliseconds_+timeStep*1000
    if self.frames_<=self.warmupFrames_ then
        if self.frames_==self.warmupFrames_ then self.baselineCounters_=counters();self:MemorySnapshot("warmup-complete") end
        return
    end
    self.sampledFrames_=self.sampledFrames_+1
    local index=(self.sampledFrames_-1)%self.maxSamples_+1
    self.samples_[index]=timeStep*1000
    if self.sampledFrames_%self.memoryEveryFrames_==0 then self:MemorySnapshot("periodic") end
end

local function quantile(sorted, fraction)
    if #sorted==0 then return nil end
    return sorted[math.max(1,math.ceil(#sorted*fraction))]
end

function Session:Report()
    local samples,sorted,total = {},{},0
    local count=math.min(self.sampledFrames_,self.maxSamples_)
    local start=self.sampledFrames_>self.maxSamples_ and self.sampledFrames_%self.maxSamples_+1 or 1
    for offset=0,count-1 do
        local value=self.samples_[(start+offset-1)%self.maxSamples_+1]
        samples[#samples+1],sorted[#sorted+1],total=value,value,total+value
    end
    table.sort(sorted)
    local over120,over60,jitter120,jitter60=0,0,0,0
    for _,value in ipairs(samples) do
        if value>1000/120 then over120=over120+1 end
        if value>1000/60 then over60=over60+1 end
        if value>1000/120+.5 then jitter120=jitter120+1 end
        if value>1000/60+.5 then jitter60=jitter60+1 end
    end
    local workSamples,workTotals,unfinished={},{},0
    local workCount=math.min(self.workCount_,self.maxSamples_)
    local workStart=self.workCount_>self.maxSamples_ and self.workCount_%self.maxSamples_+1 or 1
    for offset=0,workCount-1 do workSamples[#workSamples+1]=self.workSamples_[(workStart+offset-1)%self.maxSamples_+1] end
    for label,totalWork in pairs(self.workTotals_) do
        workTotals[label]={count=totalWork.count,totalMilliseconds=totalWork.totalMilliseconds,maxMilliseconds=totalWork.maxMilliseconds,
            meanMilliseconds=totalWork.count>0 and totalWork.totalMilliseconds/totalWork.count or nil}
    end
    for _ in pairs(self.activeWork_) do unfinished=unfinished+1 end
    local lastCounters=self.lastCounters_ or counters()
    local work={};for key,value in pairs(lastCounters) do if self.baselineCounters_[key]~=nil then work[key]=value-self.baselineCounters_[key] end end
    local currentIdentity=self.finalIdentity_ or identity(self.runtime_)
    return {schemaVersion=1,kind="LUI.PerformanceSession",scene=self.scene_,run=self.run_,device=self.device_,workload=self.workload_,
        stopped=self.stopped_,source="Update.TimeStep",identity=self.identity_,identityChanged=not same(self.identity_,currentIdentity),
        sampling={warmupFrames=self.warmupFrames_,maxSamples=self.maxSamples_,memoryEveryFrames=self.memoryEveryFrames_,window="latest bounded frames"},
        summary={sampleCount=count,sampledFrames=self.sampledFrames_,totalFrames=self.frames_,invalidFrames=self.invalidFrames_,
            elapsedMilliseconds=self.elapsedMilliseconds_,meanMilliseconds=count>0 and total/count or nil,
            p50Milliseconds=quantile(sorted,.50),p95Milliseconds=quantile(sorted,.95),p99Milliseconds=quantile(sorted,.99),
            maxMilliseconds=sorted[#sorted],peakLuaKiB=self.peakLuaKiB_,
            over120BudgetFrames=over120,over60BudgetFrames=over60,
            over120BudgetRatio=count>0 and over120/count or nil,over60BudgetRatio=count>0 and over60/count or nil,
            jitterAdjustedOver120BudgetFrames=jitter120,jitterAdjustedOver60BudgetFrames=jitter60,
            jitterAdjustedOver120BudgetRatio=count>0 and jitter120/count or nil,jitterAdjustedOver60BudgetRatio=count>0 and jitter60/count or nil},
        frameBudgets={target120Milliseconds=1000/120,minimum60Milliseconds=1000/60,jitterAllowanceMilliseconds=.5,
            scope='retained frame intervals; raw strict thresholds and separate 0.5 ms jitter allowance; not a sustained FPS guarantee'},
        synchronousWork={source=self.workClockInfo_.source,nativeClock=self.workClockInfo_.native,
            resolution=self.workClockInfo_.resolution,resolutionMilliseconds=self.workClockInfo_.resolutionMilliseconds,
            clockSemantics=self.workClockInfo_.semantics,
            scope=self.workClockInfo_.native
                and 'explicit Lua/native synchronous elapsed wall-time spans; not CPU duration, CPU percentage or GPU timing; nested labels may overlap'
                or 'explicit Lua/native synchronous spans using the declared fallback/injected clock; wall-time semantics are not assumed; not CPU percentage or GPU timing; nested labels may overlap',
            totals=workTotals,samples=workSamples,sampledSpans=self.workCount_,unfinishedSpans=unfinished,unavailableClockSpans=self.unavailableWorkClock_},
        workCounts=work,workCountsScope="all post-warmup frames; module counters may include another Runtime in this Lua VM; missing fields are unavailable, never assumed zero",
        memorySnapshots=self.memory_,memoryScope="Lua collector-reported KiB, including profiler buffers; not process/GPU memory; no forced collection",
        markers=self.markers_,droppedMarkers=self.droppedMarkers_ or 0,samplesMilliseconds=samples}
end

function Session:Stop()
    if not self.stopped_ then
        self:MemorySnapshot("stop")
        self.lastCounters_,self.finalIdentity_=counters(),identity(self.runtime_)
        if self.runtime_.luiPerformanceSession_==self then self.runtime_.luiPerformanceSession_=nil end
        self.stopped_=true
        self.runtime_=nil
    end
    return self:Report()
end

function Session:ExportJSON()
    assert(cjson and type(cjson.encode)=="function","LUI performance JSON export requires cjson")
    return cjson.encode(self:Report())
end

return Performance
