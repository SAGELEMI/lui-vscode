// Explicit local desktop harness. No game startup, save data, mobile entry point,
// or automatic production sampling. CDP renderer task time and dedicated
// browser process-group CPU time are sampled and reported as separate metrics.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { EnginePreviewHost } = require('../dist/enginePreviewHost.cjs');
assert.ok(process.argv[2], 'Usage: node scripts/test-engine-runtime-load.mjs <game> [output-directory]');
const game = resolve(process.argv[2]);
const baselineRoot = process.env.LUI_LOAD_BASELINE && resolve(process.env.LUI_LOAD_BASELINE);
const attribution = process.env.LUI_LOAD_ATTRIBUTION === '1';
const nativeProbe = process.env.LUI_LOAD_NATIVE_PROBE === '1';
assert.ok(!attribution || !baselineRoot, 'attribution controls use the current candidate only');
const gameScripts = baselineRoot ? resolve(baselineRoot, 'game-scripts') : resolve(game, 'scripts');
const adapter = baselineRoot ? resolve(baselineRoot, 'packages/runtime-urhox-lua/adapter') : resolve(process.env.LUI_LOAD_ADAPTER || 'packages/runtime-urhox-lua/adapter');
const output = resolve(process.argv[3] || 'artifacts/engine-runtime-load');
const rounds = Number(process.env.LUI_LOAD_RUNS || 3);
const scenes = attribution ? ['empty-ui-300', 'empty-profiler-off-300', 'empty-fixture-only-300', 'empty-no-scheduler-300', 'empty-ui-repeat-300']
  : process.env.LUI_LOAD_MAIN_ONLY === '1' ? ['static-300', 'scripted-scroll-300', 'notified-updates-200']
    : ['empty-ui-300', 'hidden-list-300', 'static-300', 'scripted-scroll-300', 'notified-updates-200'];
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10, 'LUI_LOAD_RUNS must be 1-10');
const width = 390, height = 844, dpr = Number(process.env.LUI_LOAD_DPR || 1);
assert.ok(Number.isFinite(dpr) && dpr > 0 && dpr <= 4);
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile(resolve(gameScripts, 'LUI/lui.project.json'), 'utf8'));
const adapterConfig = JSON.parse(await readFile(resolve(adapter, 'lui.project.json'), 'utf8'));
const adapterManifestBytes = await readFile(resolve(adapter, 'runtime-manifest.json'));
for (const key of ['version', 'layoutContract']) config[key] = adapterConfig[key];
config.runtimeManifestHash = createHash('sha256').update(adapterManifestBytes).digest('hex');
const markup = await readFile(resolve(gameScripts, 'Presentation/Components/SelectionList.lui'), 'utf8');
const code = await readFile(resolve(gameScripts, 'Presentation/Components/SelectionList.lui.lua'), 'utf8');
const extraResources = {};
if (baselineRoot) {
  for (const path of ['Presentation/Support/ListModel.lua', 'Presentation/Support/WindowedList.lua']) extraResources[path] = (await readFile(resolve(gameScripts, path))).toString('base64');
  // The same measurement-only module/hook is injected into both versions. The
  // old implementation, templates and supporting model remain untouched.
  extraResources['LUI/PerformanceSession.lua'] = (await readFile(resolve('packages/runtime-urhox-lua/adapter/PerformanceSession.lua'))).toString('base64');
  // The old runtime never calls this injected module; PerformanceSession uses
  // only Clock. No NativeText, render guard, or scheduling hook is injected.
  extraResources['LUI/MeasureBudget.lua'] = (await readFile(resolve('packages/runtime-urhox-lua/adapter/MeasureBudget.lua'))).toString('base64');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const fonts = config.fonts.map(family => ({ family: family.family, weights: Object.fromEntries(Object.entries(family.weights).map(([weight, font]) => [weight, font.resource])) }));
const files = [];
for (const family of config.fonts) for (const font of Object.values(family.weights)) files.push({ path: font.resource, sha256: font.sha256, bytes: await readFile(resolve(game, 'assets', font.resource)) });
const host = new EnginePreviewHost();
await host.start(resolve('artifacts/engine-cache'), adapter, files);
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || 'msedge', headless: true });
const browserCdp = await browser.newBrowserCDPSession();
const environment = { browser: browser.version(), os: platform(), osRelease: release(), arch: process.arch,
  cpuModel: cpus()[0]?.model || 'unavailable', logicalCpuCount: cpus().length, headless: true };
const report = { kind: 'LUI.DesktopRendererLoad', implementation: baselineRoot ? 'saved-2.6-baseline' : 'candidate', scope: 'local official browser engine, production list declaration/backend, 1000 deterministic rows, isolated from App/saves/network business calls',
  instrumentation: { revision: 'native-wall-clock-end-frame-v4', harnessSha256: hash(await readFile(new URL(import.meta.url))),
    frameCallbackModules: 'MeasureBudget and Refresh references are resolved during fixture setup, outside frame sampling; baseline keeps its original list implementation' },
  limitations: ['These are desktop browser measurements, not phone FPS, device temperature or whole-machine CPU usage.',
    'CDP TaskDuration includes renderer main-thread JS/WASM/native synchronous tasks and host transport; GPU/other threads are excluded.',
    'JSHeapUsedSize excludes WASM linear memory, native process memory and GPU memory.',
    'A desktop display/headless browser may cap rendering at 60 Hz; exceeding the strict 120 Hz interval budget does not establish insufficient CPU throughput.',
    'Run this harness by itself. Concurrent browser tests or system load affect measurements. No forced GC or synthetic frame duration is used.',
    'The saved baseline uses its original runtime/list implementation with the same injected measurement-only module and an Update.TimeStep hook; initial empty preview bootstrap uses its old BuildNode entry point.',
    'Empty UI and hidden-list scenes are attribution controls, not substitutes for the saved 2.6 baseline implementation.'],
  environment, attribution, nativeProbe, fixtureHashes: { markup: hash(markup), code: hash(code) }, sessions: [], errors: [] };
const long = text => '[====[' + text + ']====]';
const nativeObserver = `FixtureNvgCalls,FixtureNvgDirectCalls,FixtureHelperDepth=0,0,0;FixtureNvgTotals={};FixtureNvgDirectSources={}
for _,name in ipairs({'nvgTextBounds','nvgTextBoxBounds','nvgTextMetrics'})do
 local original=assert(_G[name],name);_G[name]=function(...)
  FixtureNvgCalls=FixtureNvgCalls+1;FixtureNvgTotals[name]=(FixtureNvgTotals[name]or 0)+1
  if FixtureHelperDepth==0 then FixtureNvgDirectCalls=FixtureNvgDirectCalls+1;if #FixtureNvgDirectSources<3 then FixtureNvgDirectSources[#FixtureNvgDirectSources+1]={name=name,source=debug.traceback('',2)}end end
  return original(...)
 end
end`;
const metrics = async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
const processes = async () => {
  const before = performance.now();
  const result = await browserCdp.send('SystemInfo.getProcessInfo');
  return { time: (before + performance.now()) / 2, entries: result.processInfo };
};
try {
  for (let round = 1; round <= rounds; round++) {
    const page = await browser.newPage({ viewport: { width: 800, height: 1100 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== new URL(host.url).origin) return route.abort();
      if (baselineRoot && route.request().url().endsWith('/runtime.json')) {
        const response = await route.fetch(); return route.fulfill({ response, json: { ...await response.json(), ...extraResources } });
      }
      if ((baselineRoot || nativeProbe) && route.request().url().endsWith('/bootstrap.lua')) {
        const response = await route.fetch(); let source = await response.text();
        if (baselineRoot) {
          const call = 'local content,context=runtime:BuildPreview(next)';
          assert.ok(source.includes(call), 'baseline bootstrap compatibility seam changed');
          source = source.replace(call, "local context={view={},props={},refs={},actions={}};local content=runtime:BuildNode(next.node,context)");
        }
        if (nativeProbe) {
          const seam = "local Runtime=require('LUI.Runtime')";
          assert.ok(source.includes(seam), 'raw measurement observer must install before NativeText');
          source = source.replace(seam, nativeObserver + '\n' + seam);
        }
        return route.fulfill({ response, body: source });
      }
      return route.continue();
    });
    await page.addInitScript(() => { window.__loadResult = null; window.addEventListener('message', event => {
      if (event.origin === location.origin && event.data?.name === 'runtime-load-result') window.__loadResult = event.data.payload;
    }); });
    host.update({ revision: Date.now(), width, height, theme: config.theme, fonts,
      node: { kind: 'Element', tag: 'lui:Page', attrs: { Width: String(width), Height: String(height) }, children: [], sourcePath: 'LoadFixture.lui', nodePath: '0' } });
    await page.goto(host.url);
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('已绘制'), { timeout: 60000 });
    await page.getByRole('button', { name: '节点选择：开' }).click();
    const run = async (source, frames = 3, perFrame = '') => {
      assert.ok(!/\brequire\s*\(/.test(perFrame), 'per-frame fixture operations must use warmed module references');
      await page.evaluate(() => { window.__loadResult = null; });
      const lua = `local function emit(value)local event=VariantMap();event['name']='runtime-load-result';event['payload']=cjson.encode(value);SendEvent('EmitToPlugin',event)end
local ok,err=xpcall(function()
${source}
FixtureCaptureMaxCalls,FixtureCaptureMaxOverrun=0,0
local frame=0;local cancel;local maxCalls,maxOverrun,maxTextCalls,maxOutsideBudget,maxRawTextCalls=0,0,0,0,0;local lastTextCalls,lastOutsideCalls,lastRawTextCalls=FixtureNativeTextCalls,FixtureNativeOutsideCalls,FixtureRawTextCalls
local firstBudgetFrame,lastBudgetFrame,maxBudgetFrameGap,midFrameResets=nil,nil,0,0
${nativeProbe ? 'local lastNvg,lastNvgDirect,maxNvg,maxNvgDirect=FixtureNvgCalls,FixtureNvgDirectCalls,0,0' : ''}
cancel=FixtureRuntime:AfterLayout(FixtureRoot,function()
 local good,result=xpcall(function()
 frame=frame+1
 local budget=${baselineRoot ? '{calls=0,overrunMilliseconds=0}' : 'FixtureBudget.Get(FixtureRuntime)'};maxCalls=math.max(maxCalls,budget.calls);maxOverrun=math.max(maxOverrun,budget.overrunMilliseconds)
 if budget.frame then
  if lastBudgetFrame then maxBudgetFrameGap=math.max(maxBudgetFrameGap,budget.frame-lastBudgetFrame)end
  firstBudgetFrame,lastBudgetFrame=firstBudgetFrame or budget.frame,budget.frame
  if FixtureUpdateBudgetFrame~=budget.frame then midFrameResets=midFrameResets+1 end
 end
 local textCalls=FixtureNativeTextCalls-lastTextCalls;lastTextCalls=FixtureNativeTextCalls;maxTextCalls=math.max(maxTextCalls,textCalls)
 local outsideCalls=FixtureNativeOutsideCalls-lastOutsideCalls;lastOutsideCalls=FixtureNativeOutsideCalls;maxOutsideBudget=math.max(maxOutsideBudget,outsideCalls)
 local rawTextCalls=FixtureRawTextCalls-lastRawTextCalls;lastRawTextCalls=FixtureRawTextCalls;maxRawTextCalls=math.max(maxRawTextCalls,rawTextCalls)
 ${nativeProbe ? 'maxNvg=math.max(maxNvg,FixtureNvgCalls-lastNvg);maxNvgDirect=math.max(maxNvgDirect,FixtureNvgDirectCalls-lastNvgDirect);lastNvg,lastNvgDirect=FixtureNvgCalls,FixtureNvgDirectCalls' : ''}
 ${perFrame}
 if frame<${frames} then return end
 cancel()
 return {frames=frame,pool=#FixturePool(),cursor=FixtureModel().cursor_,items=#FixtureModel().items_,maxNativeCalls=maxCalls,maxNativeOverrunMilliseconds=maxOverrun,
   renderPending=FixtureList.list_ and FixtureList.list_.renderPending_ or false,budgetRows=budget.rows,
   firstBudgetFrame=firstBudgetFrame,lastBudgetFrame=lastBudgetFrame,maxBudgetFrameGap=maxBudgetFrameGap,budgetMidFrameResets=midFrameResets,
   report=FixturePerformance and FixturePerformance:Stop() or nil,created=FixtureCreated,maxTextMeasureCalls=maxTextCalls,maxRawTextCalls=maxRawTextCalls,maxOutsideBudgetTextCalls=maxOutsideBudget,outsideBudgetSources=FixtureOutsideSources${nativeProbe ? ',maxNativeNvgMeasurementCalls=maxNvg,maxNativeNvgDirectCalls=maxNvgDirect,nativeNvgTotals=FixtureNvgTotals,nativeNvgDirectSources=FixtureNvgDirectSources' : ''}}
 end,debug.traceback)
 if not good then cancel();emit({error=tostring(result)})elseif result then
  FixtureEndCapture=function()
   result.maxNativeCalls=math.max(result.maxNativeCalls,FixtureCaptureMaxCalls)
   result.maxNativeOverrunMilliseconds=math.max(result.maxNativeOverrunMilliseconds,FixtureCaptureMaxOverrun)
   emit(result)
  end
 end
end)
end,debug.traceback)
if not ok then emit({error=tostring(err)})end`;
      await page.evaluate(source => document.querySelector('iframe').contentWindow.postMessage({ source: 'tap-plugin-host', kind: 'event', name: 'RunLuaSource', payload: { source } }, location.origin), lua);
      await page.waitForFunction(() => window.__loadResult, { timeout: 60000 });
      const result = await page.evaluate(() => window.__loadResult);
      assert.ok(!result.error, result.error);
      assert.ok(result.maxNativeCalls <= 64, 'all list native measures share the 64-call frame budget');
      return result;
    };
    let settled = await run(`local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime');local Parser=require('LUI.Parser')
FixtureNativeTextCalls,FixtureNativeOutsideCalls,FixtureRawTextCalls=0,0,0;FixtureOutsideSources={}
${nativeProbe ? 'FixtureNvgCalls,FixtureNvgDirectCalls,FixtureHelperDepth=0,0,0;FixtureNvgTotals={};FixtureNvgDirectSources={}' : ''}
${baselineRoot ? '' : "local Budget=require('LUI.MeasureBudget');FixtureBudget=Budget;FixtureRefresh=require('LUI.Refresh')"}
for _,name in ipairs({'MeasureTextWidth','MeasureTextFit'})do local original=UI[name];UI[name]=function(...)
 FixtureRawTextCalls=FixtureRawTextCalls+1
 local text=select(1,...)
 if text~=nil and text~='' then
  FixtureNativeTextCalls=FixtureNativeTextCalls+1
  ${baselineRoot ? '' : "if not FixtureBudget.Active() then FixtureNativeOutsideCalls=FixtureNativeOutsideCalls+1;if #FixtureOutsideSources<3 then FixtureOutsideSources[#FixtureOutsideSources+1]=debug.traceback('',2)end end"}
 end
 ${nativeProbe ? "FixtureHelperDepth=FixtureHelperDepth+1;local result=table.pack(pcall(original,...));FixtureHelperDepth=FixtureHelperDepth-1;if not result[1]then error(result[2],0)end;return table.unpack(result,2,result.n)" : 'return original(...)'}
end end
local config=cjson.decode(${long(JSON.stringify(config))});config.sourceRoots={'Fixture'};config.componentDirectories={Fixture={List='Fixture/List.lui'}};config.changeTracking='notify'
FixtureRuntime=setmetatable({isV2_=true,documents_={},code_={},config_=config},Runtime)
${baselineRoot ? '' : `local oldUpdate=UI.Update;function UI.Update(...)
FixtureUpdateBudgetFrame=Budget.Get(FixtureRuntime).frame;return oldUpdate(...)
end`}
FixtureCreated=0;local original=FixtureRuntime.BuildNode;function FixtureRuntime:BuildNode(...)FixtureCreated=FixtureCreated+1;return original(self,...)end
FixtureRuntime.documents_['Fixture/List.lui']=assert(Parser.Parse(${long(markup)},'Fixture/List.lui'))
FixtureRuntime.code_['Fixture/List.lui.lua']=assert(load(${long(code)},'@Fixture/List.lui.lua'))()
local rows={};for i=1,1000 do rows[i]={key='row:'..i,label='物品 '..i,description=i%5==0 and string.rep('长说明测试',15) or '物品说明'}end
FixtureView={rows=rows,state={}}
FixtureRuntime.documents_['Fixture/Page.lui']=assert(Parser.Parse([[<页面 名称="LoadFixture" 宽度="390" 高度="844" 内边距="25" 目录:x="Fixture"><x:List 引用="List" 宽度="340" 高度="720" 标题="负载测试" 计数="1000" 项目="{绑定 view.rows}" 状态="{绑定 view.state}"/></页面>]],'Fixture/Page.lui'))
FixtureContentRoot,FixtureContext=FixtureRuntime:RenderMarkup('Fixture/Page.lui',{view=FixtureView,refs={},actions={}});assert(FixtureContentRoot,FixtureContext)
FixtureRoot=UI.Panel{width=390,height=844,children={FixtureContentRoot}};UI.SetRoot(FixtureRoot,true)
FixtureList=FixtureContext.refs.List.luiComponentHost_.luiComponentInstance_;FixturePerformance=nil
function HandleFixtureLoadEndFrame()
 ${baselineRoot ? '' : `local budget=FixtureBudget.Get(FixtureRuntime)
 FixtureCaptureMaxCalls=math.max(FixtureCaptureMaxCalls or 0,budget.calls)
 FixtureCaptureMaxOverrun=math.max(FixtureCaptureMaxOverrun or 0,budget.overrunMilliseconds)`}
 if FixtureEndCapture then local callback=FixtureEndCapture;FixtureEndCapture=nil;callback()end
end
${baselineRoot ? "SubscribeToEvent('EndFrame','HandleFixtureLoadEndFrame')" : `local queue=require('LUI.MeasureQueue');local drain=queue.Drain
function queue.Drain(...)
 local result=table.pack(drain(...));HandleFixtureLoadEndFrame();return table.unpack(result,1,result.n)
end`}
function FixtureModel()return ${baselineRoot ? 'FixtureList.model_' : 'FixtureList.list_.model_'} end
function FixturePool()return ${baselineRoot ? 'FixtureList.rowWidgets_' : 'FixtureList.list_.pool_'} end
function FixtureScroll(y)${baselineRoot ? 'FixtureList:_SetScroll(y)' : 'FixtureList.list_:ScrollTo(y)'} end
${baselineRoot ? "function HandleFixtureLoadFrame(_,eventData)if FixturePerformance then FixturePerformance:Frame(eventData:GetFloat('TimeStep'))end end;SubscribeToEvent('Update','HandleFixtureLoadFrame')" : ''}`, 120);
    for (let attempts = 0; settled.cursor <= 1000 && attempts < 8; attempts++) settled = await run('', 120);
    report.warmupSnapshot = settled;
    assert.ok(settled.cursor > 1000, 'background template measurements must settle before steady-state capture: ' + JSON.stringify(settled));
    if (attribution) await run(`FixtureScheduledRuntimes={}
for i=1,20 do local name,value=debug.getupvalue(HandleLuiRuntimeBeginFrame,i);if name=='scheduledRuntimes'then FixtureSchedulerMap=value;for rt in pairs(value)do FixtureScheduledRuntimes[#FixtureScheduledRuntimes+1]=rt end;break end end
assert(FixtureSchedulerMap,'fixture cannot observe scheduler owner map')`, 3);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    for (const scene of scenes) {
      for (let attempt = 0; attempt < 3; attempt++) {
      await run(`FixturePerformance=nil;FixtureList.scroll_.state.velocityY=0;FixtureScroll(0)
if not FixtureContentRoot.parent then FixtureRoot:AddChild(FixtureContentRoot)end
FixtureContentRoot:SetVisible(${scene !== 'hidden-list-300'})
${scene.startsWith('empty-') ? 'FixtureRoot:RemoveChild(FixtureContentRoot)' : ''}
${attribution ? `for rt in pairs(FixtureSchedulerMap)do FixtureSchedulerMap[rt]=nil end
for _,rt in ipairs(FixtureScheduledRuntimes)do FixtureSchedulerMap[rt]=true end
${scene === 'empty-fixture-only-300' ? 'for rt in pairs(FixtureSchedulerMap)do if rt~=FixtureRuntime then FixtureSchedulerMap[rt]=nil end end' : ''}
${scene === 'empty-no-scheduler-300' ? 'for rt in pairs(FixtureSchedulerMap)do FixtureSchedulerMap[rt]=nil end' : ''}` : ''}`, 6);
      const processesBefore = await processes();
      const before = await metrics(cdp);
      const operation = scene === 'scripted-scroll-300' ? 'FixtureScroll((frame%180)*60)' : scene === 'notified-updates-200' ? `if frame<=200 then
local token=FixturePerformance:StartWork('update-item-refresh')
FixtureView.rows[1].label='更新物品 '..frame;${baselineRoot ? "FixtureList:RefreshRows({'row:1'})" : "FixtureRuntime:NotifyChanged(FixtureContext,'view.rows[1].label');FixtureRefresh.Subtree(FixtureRoot)"}
FixturePerformance:EndWork(token)
end` : '';
      const profiling = scene !== 'empty-profiler-off-300' && scene !== 'empty-no-scheduler-300';
      const result = await run(profiling ? `FixtureOutsideSources={};FixturePerformance=require('LUI.PerformanceSession').Start(FixtureRuntime,{scene=${long(scene)},device=${long('desktop-' + environment.os + '-' + environment.cpuModel)},workload='production-list-1000-seed1',run='${round}',warmupFrames=0,maxSamples=300,memoryEveryFrames=120})
FixturePerformance:Mark(${long(scene)})` : 'FixtureOutsideSources={};FixturePerformance=nil', 300, operation);
      const after = await metrics(cdp);
      const processesAfter = await processes();
      const elapsed = after.Timestamp - before.Timestamp, tasks = after.TaskDuration - before.TaskDuration;
      assert.ok(elapsed > 0 && tasks >= 0 && Number.isFinite(after.JSHeapUsedSize), 'CDP timing and heap metrics must be present');
      const sessionReport = result.report || { kind: 'LUI.CpuAttributionOnly', scene, run: String(round),
        summary: { observedRenderFrames: result.frames }, source: 'CDP CPU endpoints only; frame session intentionally disabled', workCounts: {} };
      if (profiling) assert.ok(sessionReport.summary.sampleCount >= 295, 'capture must contain actual Update.TimeStep frames');
      if (!baselineRoot && !attribution) {
        assert.equal(result.budgetMidFrameResets, 0, 'the shared budget must not reset between UI.Update and native Render');
        assert.equal(result.lastBudgetFrame - result.firstBudgetFrame, 299, '300 rendered frames must advance the shared budget exactly 299 times');
        assert.equal(result.maxBudgetFrameGap, 1, 'the renderer observes one consecutive budget token per engine frame');
      }
      const elapsedProcessMilliseconds = processesAfter.time - processesBefore.time;
      const previous = new Map(processesBefore.entries.map(entry => [entry.id, entry]));
      const next = new Map(processesAfter.entries.map(entry => [entry.id, entry]));
      const processSetChanged = processesBefore.entries.some(entry => !next.has(entry.id)) || processesAfter.entries.some(entry => !previous.has(entry.id));
      const processDeltas = processesAfter.entries.filter(entry => previous.has(entry.id)).map(entry => ({ type: entry.type, id: entry.id, cpuMilliseconds: (entry.cpuTime - previous.get(entry.id).cpuTime) * 1000 }));
      assert.ok(processDeltas.length > 0 && processDeltas.every(entry => Number.isFinite(entry.cpuMilliseconds) && entry.cpuMilliseconds >= 0));
      const processCpuMilliseconds = processDeltas.reduce((sum, entry) => sum + entry.cpuMilliseconds, 0);
      sessionReport.externalMetrics = { source: 'CDP.Performance.getMetrics + SystemInfo.getProcessInfo', scope: 'browser-process-group', environment,
        elapsedMilliseconds: elapsed * 1000, rendererMainThreadBusyPercent: tasks / elapsed * 100,
        rendererTaskMilliseconds: tasks * 1000, jsHeapUsedBytes: after.JSHeapUsedSize, jsHeapDeltaBytes: after.JSHeapUsedSize - before.JSHeapUsedSize,
        elapsedProcessMilliseconds, processCpuMilliseconds, processCpuOneCorePercent: processCpuMilliseconds / elapsedProcessMilliseconds * 100,
        processCpuPercent: processCpuMilliseconds / elapsedProcessMilliseconds / environment.logicalCpuCount * 100,
        cpuNormalization: 'all-logical-cores', logicalCpuCount: environment.logicalCpuCount, processSetChanged, processDeltas,
        processScope: 'dedicated test browser process group CPU time across all its threads; excludes Node harness and other applications; not GPU utilization or temperature' };
      if (processSetChanged) {
        report.discardedCpuCaptures ??= [];
        report.discardedCpuCaptures.push({ scene, run: round, attempt, reason: 'browser process endpoints changed', externalMetrics: sessionReport.externalMetrics });
        assert.ok(attempt < 2, 'browser process group did not stabilize after three captures');
        continue;
      }
      sessionReport.fixture = { ...report.fixtureHashes, maxNativeCalls: result.maxNativeCalls, maxNativeOverrunMilliseconds: result.maxNativeOverrunMilliseconds,
        outsideBudgetObservationAvailable: !baselineRoot,
        ...(nativeProbe ? { maxNativeNvgMeasurementCalls: result.maxNativeNvgMeasurementCalls, maxNativeNvgDirectCalls: result.maxNativeNvgDirectCalls, nativeNvgTotals: result.nativeNvgTotals, nativeNvgDirectSources: result.nativeNvgDirectSources } : {}),
        maxTextMeasureCalls: result.maxTextMeasureCalls, maxRawTextCalls: result.maxRawTextCalls, maxOutsideBudgetTextCalls: result.maxOutsideBudgetTextCalls, outsideBudgetSources: result.outsideBudgetSources,
        firstBudgetFrame: result.firstBudgetFrame, lastBudgetFrame: result.lastBudgetFrame, maxBudgetFrameGap: result.maxBudgetFrameGap, budgetMidFrameResets: result.budgetMidFrameResets,
        textMeasureScope: 'maxNativeCalls is the VM-shared individual NanoVG C measurement budget sampled after EndFrame background work; helper counts are diagnostic AfterLayout-window entries including cache hits and are not capped at 64. Independent raw C verification uses test-engine-native-budget.mjs.', pool: result.pool, created: result.created };
      if (scene === 'static-300' && !baselineRoot) {
        assert.equal(sessionReport.workCounts['Runtime.bindingParses'], 0, 'steady frames must not reparse bindings');
        assert.equal(sessionReport.workCounts['Paths.parses'], 0, 'steady frames must not reparse paths');
        assert.equal(result.maxNativeCalls, 0, 'settled static frames must not measure text natively');
      }
      const filename = `${scene}-run${round}.json`;
      await writeFile(resolve(output, filename), JSON.stringify(sessionReport, null, 2));
      report.sessions.push({ scene, run: round, file: filename, summary: sessionReport.summary, externalMetrics: sessionReport.externalMetrics, workCounts: sessionReport.workCounts, fixture: sessionReport.fixture });
      console.log(JSON.stringify({ scene, run: round, p95: sessionReport.summary.p95Milliseconds, p99: sessionReport.summary.p99Milliseconds,
        processCpuPercent: sessionReport.externalMetrics.processCpuPercent, rendererBusyPercent: sessionReport.externalMetrics.rendererMainThreadBusyPercent,
        nativeCalls: result.maxNativeCalls, textCalls: result.maxTextMeasureCalls, pool: result.pool }));
      break;
      }
    }
    await cdp.detach();
    await page.close();
  }
  report.identity = await (await fetch(host.url + 'identity.json')).json();
  report.injectedMeasurementFiles = Object.fromEntries(Object.entries(extraResources).map(([path, bytes]) => [path, hash(Buffer.from(bytes, 'base64'))]));
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  host.dispose();
}
