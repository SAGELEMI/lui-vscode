// Bounded repeated-open lifecycle trend. No forced GC, production sampling,
// adaptive pacing changes, or claims about phone/GPU/whole-machine memory.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { EnginePreviewHost } = require('../dist/enginePreviewHost.cjs');
assert.ok(process.argv[2], 'Usage: node scripts/test-engine-lifecycle-trend.mjs <game> [output]');
const game = resolve(process.argv[2]), adapter = resolve('runtime/urhox-lua');
const output = resolve(process.argv[3] || 'artifacts/engine-lifecycle-trend');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const long = text => '[====[' + text + ']====]';
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile(resolve(game, 'scripts/LUI/lui.project.json'), 'utf8'));
assert.equal(config.runtimeManifestHash, sha(await readFile(resolve(adapter, 'runtime-manifest.json'))));
const markup = await readFile(resolve(game, 'scripts/Presentation/Components/SelectionList.lui'), 'utf8');
const code = await readFile(resolve(game, 'scripts/Presentation/Components/SelectionList.lui.lua'), 'utf8');
const fonts = config.fonts.map(f => ({ family: f.family, weights: Object.fromEntries(Object.entries(f.weights).map(([key, value]) => [key, value.resource])) }));
const files = [];
for (const f of config.fonts) for (const v of Object.values(f.weights)) files.push({ path: v.resource, sha256: v.sha256, bytes: await readFile(resolve(game, 'assets', v.resource)) });
const host = new EnginePreviewHost(); await host.start(resolve('artifacts/engine-cache'), adapter, files);
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || 'msedge', headless: true });
const browserCdp = await browser.newBrowserCDPSession();
const logicalCpuCount = cpus().length;
const report = { kind: 'LUI.BoundedLifecycleTrend', runtimeManifestHash: config.runtimeManifestHash,
  batches: 3, cyclesPerBatch: 100, idleSecondsPerBatch: 5, rowsPerCycle: 1000,
  harnessSha256: sha(await readFile(new URL(import.meta.url))),
  scope: 'One official engine VM and retained Runtime, three equal batches of 100 production SelectionList mounts/scrolls/notifies/Destroy operations, followed by five wall-clock seconds of idle per batch.',
  limitations: ['Natural Lua/browser GC only. Endpoint heap values can rise before a collector runs; this bounded window cannot prove the absence of all long-term leaks.',
    'Process CPU covers the dedicated browser process group and all its threads, normalized over logical CPUs; renderer busy time is separately measured. Neither is GPU usage, temperature, or phone performance.',
    'JSHeapUsedSize excludes WASM linear memory, Lua/native allocations and GPU resources. Sampled Lua peaks are checkpoint peaks, not continuous maxima.',
    'Each cycle mounts for six render callbacks. Batch durations are reported from the actual clock; the equal workload does not assume a fixed FPS. Idle lasts at least five wall-clock seconds.',
    'Read-only queue/debug probes and CDP checkpoints add identical diagnostic overhead in each batch. Existing CPU/heap warnings remain unchanged.'],
  environment: { logicalCpuCount, browser: browser.version(), headless: true }, samples: [], segments: [], errors: [] };

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(host.url).origin ? route.continue() : route.abort());
  await page.addInitScript(() => { window.__trend = []; window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data?.name === 'lifecycle-trend') window.__trend.push(e.data.payload);
  }); });
  host.update({ revision: Date.now(), width: 390, height: 844, theme: config.theme, fonts,
    node: { kind: 'Element', tag: 'lui:Page', attrs: { Width: '390', Height: '844' }, children: [], sourcePath: 'Trend.lui', nodePath: '0' } });
  await page.goto(host.url);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('已绘制'), undefined, { timeout: 60000 });
  await page.getByRole('button', { name: '节点选择：开' }).click();
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const source = `local function emit(value)local event=VariantMap();event['name']='lifecycle-trend';event['payload']=cjson.encode(value);SendEvent('EmitToPlugin',event)end
local ok,err=xpcall(function()
local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime');local Parser=require('LUI.Parser');local Dirty=require('LUI.Dirty');local Queue=require('LUI.MeasureQueue')
local clock,clockSource=require('LUI.MeasureBudget').Clock();local started=clock()
local config=cjson.decode(${long(JSON.stringify(config))});config.sourceRoots={'Fixture'};config.componentDirectories={Fixture={List='Fixture/List.lui'}};config.changeTracking='notify'
local runtime=setmetatable({isV2_=true,documents_={},code_={},config_=config},Runtime)
runtime.documents_['Fixture/List.lui']=assert(Parser.Parse(${long(markup)},'Fixture/List.lui'))
runtime.code_['Fixture/List.lui.lua']=assert(load(${long(code)},'@Fixture/List.lui.lua'))()
runtime.documents_['Fixture/Page.lui']=assert(Parser.Parse([[<页面 名称="Lifecycle" 宽度="390" 高度="844" 内边距="25" 目录:x="Fixture"><x:List 引用="List" 宽度="340" 高度="720" 标题="生命周期" 计数="1000" 项目="{绑定 view.rows}" 状态="{绑定 view.state}"/></页面>]],'Fixture/Page.lui'))
local wrapper=UI.Panel{width=390,height=844,pointerEvents='box-none'};UI.SetRoot(wrapper,true)
local baseline=Dirty.stats.subscriptions;local completed,frame,batch=0,0,1;local current,idleSince
local weak={};for _,name in ipairs({'page','context','component','controller','model','rows','firstRow','slotWidget'})do weak[name]=setmetatable({},{__mode='v'})end
local function queueCounts()
 local result={available=false,owners=0,entries=0}
 for index=1,20 do local name,value=debug.getupvalue(Queue.Schedule,index);if not name then break end
  if name=='owners' or name=='entries'then result.available=true;for _ in pairs(value)do result[name]=result[name]+1 end end
 end
 return result
end
local function sample(phase)
 local refs={};for name,items in pairs(weak)do local count,oldest=0,nil;for index in pairs(items)do count=count+1;oldest=oldest and math.min(oldest,index)or index end;refs[name]={alive=count,oldestCycle=oldest}end
 local contexts=0;for _ in pairs(runtime.contexts_ or {})do contexts=contexts+1 end
 local queued=queueCounts();assert(queued.available,'queue observation unavailable');assert(queued.owners==0 and queued.entries==0,'disposed list remained in background queue')
 return {phase=phase,batch=batch,completed=completed,renderCallbacks=frame,elapsedSeconds=clock()-started,clockSource=clockSource,
  subscriptions=Dirty.stats.subscriptions,baselineSubscriptions=baseline,luaKiB=collectgarbage('count'),runtimeContexts=contexts,queue=queued,weakReferences=refs}
end
local function create()
 local cycle=completed+1;local rows={};for i=1,1000 do rows[i]={key='row:'..i,label='物品 '..i,description=i%5==0 and string.rep('长说明测试',15)or '说明'}end
 local root,context=runtime:RenderMarkup('Fixture/Page.lui',{view={rows=rows,state={}},refs={},actions={}});assert(root,context);wrapper:AddChild(root)
 local owner=context.refs.List.luiComponentHost_.luiComponentInstance_;local controller=owner.list_
 current={root=root,context=context,owner=owner,controller=controller,rows=rows,frames=0}
 weak.page[cycle],weak.context[cycle],weak.component[cycle],weak.controller[cycle]=root,context,owner,controller
 weak.model[cycle],weak.rows[cycle],weak.firstRow[cycle]=controller.model_,rows,rows[1]
end
local function destroy()
 local item=current;local controller=item.controller;local model=controller.model_;local scroll=controller.scroll_
 assert(#controller.pool_>0,'production list did not create row widgets');weak.slotWidget[completed+1]=controller.pool_[1].widget
 wrapper:RemoveChild(item.root);item.root:Destroy()
 assert(item.root.node==nil and scroll.node==nil,'Yoga nodes were not freed')
 assert(item.owner.disposed_ and item.owner.list_==nil and item.owner.root_==nil and item.owner.context_==nil,'component did not release references')
 assert(controller.disposed_ and controller.unsubscribe_==nil and controller.probe_==nil,'list subscription/probe remained')
 assert(#model.items_==0 and next(model.indices_)==nil and next(model.measured_)==nil,'model data remained')
 for _,slot in ipairs(controller.pool_)do assert(slot.widget.node==nil and slot.row==nil and slot.index==nil,'slot assignment remained')end
 assert(Dirty.stats.subscriptions==baseline,'subscription growth after cycle '..(completed+1))
 current=nil;completed=completed+1
end
emit(sample('batch-start'))
local cancel;cancel=runtime:AfterLayout(wrapper,function()
 local success,failure=xpcall(function()
  frame=frame+1
  if current then
   current.frames=current.frames+1
   if current.frames==2 then current.controller:ScrollTo(480)end
   if current.frames==4 then current.rows[1].label='更新 '..completed;runtime:NotifyChanged(current.context,'view.rows[1].label')end
   if current.frames>=6 then
    destroy()
    if completed%10==0 then emit(sample('checkpoint'))end
    if completed%100==0 then idleSince=clock();emit(sample('active-complete'))end
   end
  elseif idleSince then
   if clock()-idleSince>=5 then
    emit(sample('batch-complete'))
    if completed>=300 then cancel();emit(sample('complete'))
    else batch=batch+1;idleSince=nil;emit(sample('batch-start'))end
   end
  else create()end
 end,debug.traceback)
 if not success then cancel();emit({error=tostring(failure),completed=completed})end
end)
end,debug.traceback)
if not ok then emit({error=tostring(err)})end`;
  await writeFile(resolve(output, 'fixture.lua'), source);
  await page.evaluate(source => document.querySelector('iframe').contentWindow.postMessage({ source: 'tap-plugin-host', kind: 'event', name: 'RunLuaSource', payload: { source } }, location.origin), source);
  const deadline = Date.now() + 100000;
  for (let index = 0; ; index++) {
    await page.waitForFunction(index => window.__trend.length > index, index, { timeout: Math.max(1, deadline - Date.now()) });
    const sample = await page.evaluate(index => window.__trend[index], index);
    assert.ok(!sample.error, sample.error);
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    sample.browser = { timestampSeconds: metrics.Timestamp, rendererTaskSeconds: metrics.TaskDuration, jsHeapUsedBytes: metrics.JSHeapUsedSize };
    if (['batch-start', 'active-complete', 'batch-complete'].includes(sample.phase)) {
      const before = performance.now(), result = await browserCdp.send('SystemInfo.getProcessInfo');
      sample.process = { wallMilliseconds: (before + performance.now()) / 2, entries: result.processInfo };
    }
    report.samples.push(sample);
    if (sample.phase !== 'checkpoint') console.log(JSON.stringify({ phase: sample.phase, batch: sample.batch, completed: sample.completed, luaKiB: sample.luaKiB, jsHeapUsedBytes: sample.browser.jsHeapUsedBytes, references: sample.weakReferences.controller }));
    if (sample.phase === 'complete') break;
  }
  const segment = (name, a, b) => {
    const elapsed = b.browser.timestampSeconds - a.browser.timestampSeconds;
    const prior = new Map(a.process.entries.map(p => [p.id, p]));
    const sameProcesses = b.process.entries.length === prior.size && b.process.entries.every(p => prior.has(p.id));
    const cpuMilliseconds = b.process.entries.reduce((sum, p) => sum + (prior.has(p.id) ? (p.cpuTime - prior.get(p.id).cpuTime) * 1000 : 0), 0);
    const processElapsed = b.process.wallMilliseconds - a.process.wallMilliseconds;
    return { name, batch: a.batch, actualElapsedSeconds: elapsed, processEndpointsStable: sameProcesses,
      processCpuPercent: sameProcesses ? cpuMilliseconds / processElapsed / logicalCpuCount * 100 : null,
      processCpuOneCorePercent: sameProcesses ? cpuMilliseconds / processElapsed * 100 : null,
      rendererBusyPercent: (b.browser.rendererTaskSeconds - a.browser.rendererTaskSeconds) / elapsed * 100,
      luaStartKiB: a.luaKiB, luaEndKiB: b.luaKiB, jsHeapStartBytes: a.browser.jsHeapUsedBytes, jsHeapEndBytes: b.browser.jsHeapUsedBytes,
      endReferences: b.weakReferences, endQueue: b.queue, endSubscriptions: b.subscriptions };
  };
  for (let batch = 1; batch <= 3; batch++) {
    const samples = report.samples.filter(s => s.batch === batch), start = samples.find(s => s.phase === 'batch-start');
    const active = samples.find(s => s.phase === 'active-complete'), end = samples.find(s => s.phase === 'batch-complete');
    assert.ok(end.elapsedSeconds - active.elapsedSeconds >= 5);
    report.segments.push(segment('active', start, active), segment('idle', active, end), segment('whole-batch', start, end));
  }
  const last = report.samples.at(-1);
  assert.equal(last.completed, 300); assert.deepEqual(report.errors, []);
  report.observations = {
    deterministicCleanupPassed: report.samples.every(s => s.subscriptions === s.baselineSubscriptions && s.queue.owners === 0 && s.queue.entries === 0),
    maximumLiveControllersAtCheckpoints: Math.max(...report.samples.map(s => s.weakReferences.controller.alive)),
    finalWeakReferences: last.weakReferences,
    luaCheckpointPeakKiB: Math.max(...report.samples.map(s => s.luaKiB)),
    luaNaturalDecreaseObserved: report.samples.some((s, i, all) => i && s.luaKiB < all[i-1].luaKiB),
    jsNaturalDecreaseObserved: report.samples.some((s, i, all) => i && s.browser.jsHeapUsedBytes < all[i-1].browser.jsHeapUsedBytes),
    oldCyclesReclaimed: Object.values(last.weakReferences).every(ref => ref.oldestCycle === undefined || ref.oldestCycle > 200),
    summary: 'Read segment CPU rates and actual endpoint heaps together. Natural collection and stable cleanup bound tracked objects in this run; they do not prove all process/native/GPU memory is bounded.' };
  report.identity = await (await fetch(host.url + 'identity.json')).json();
  report.verifiedLuaFiles = 0;
  for (const [path, hash] of Object.entries(report.identity.runtimeFiles).filter(([path]) => /^LUI\/[\w-]+\.lua$/.test(path))) {
    assert.equal(sha(await readFile(resolve(adapter, path.slice(4)))), hash);
    assert.equal(sha(await readFile(resolve(game, 'scripts', path))), hash); report.verifiedLuaFiles++;
  }
  report.status = report.observations.deterministicCleanupPassed && report.observations.oldCyclesReclaimed ? 'bounded-run-cleanup-observed' : 'retention-observed';
  if (report.status === 'retention-observed') process.exitCode = 2;
  await cdp.detach(); await page.close();
} catch (error) { report.status = 'failed'; report.errors.push(error.stack || String(error)); throw error;
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); host.dispose(); }
