// Independent lifecycle evidence in one real engine VM. Production files are
// read only; no mobile entry point or CPU comparison edits. Optional retaining
// diagnostics collect only after the unchanged natural lifecycle window.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { EnginePreviewHost } = require('../dist/enginePreviewHost.cjs');
assert.ok(process.argv[2], 'Usage: node scripts/test-engine-lifecycle.mjs <game> [output-directory]');
const game = resolve(process.argv[2]);
const adapter = resolve(process.env.LUI_LIFECYCLE_ADAPTER || 'runtime/urhox-lua');
const output = resolve(process.argv[3] || 'artifacts/engine-lifecycle-final');
const diagnostic = process.env.LUI_LIFECYCLE_DIAGNOSTIC === '1';
const sourceOnly = process.env.LUI_LIFECYCLE_SOURCE === '1';
await mkdir(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const config = JSON.parse(await readFile(resolve(game, 'scripts/LUI/lui.project.json'), 'utf8'));
const manifestBytes = await readFile(resolve(adapter, 'runtime-manifest.json'));
assert.equal(config.runtimeManifestHash, sha(manifestBytes), 'deployed config must identify the formal adapter');
const markup = await readFile(resolve(game, 'scripts/Presentation/Components/SelectionList.lui'), 'utf8');
const code = await readFile(resolve(game, 'scripts/Presentation/Components/SelectionList.lui.lua'), 'utf8');
const fonts = config.fonts.map(family => ({ family: family.family, weights: Object.fromEntries(Object.entries(family.weights).map(([weight, font]) => [weight, font.resource])) }));
const files = [];
for (const family of config.fonts) for (const font of Object.values(family.weights)) files.push({ path: font.resource, sha256: font.sha256, bytes: await readFile(resolve(game, 'assets', font.resource)) });
const host = new EnginePreviewHost();
await host.start(resolve('artifacts/engine-cache'), adapter, files);
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || 'msedge', headless: true });
const report = { kind: 'LUI.RealEngineLifecycle', runtimeManifestHash: config.runtimeManifestHash,
  diagnostic, sourceOnly,
  fixtureHashes: { markup: sha(markup), code: sha(code) }, cycles: 100, rowsPerCycle: 1000,
  scope: 'one browser page, one engine/Lua VM, one retained Runtime; production SelectionList mounted for six render callbacks with scroll and item notification, then page Destroy. The first cycle additionally mounts a real global overlay, unmounts for 12 callbacks, remounts, and verifies background measurement resumes.',
  limitations: ['Independent lifecycle evidence; does not replace or erase the CPU comparison or its JS heap alert.',
    diagnostic ? 'The first 100 lifecycle cycles and 180 idle frames use natural collection only. Separately labeled post-window diagnostics explicitly collect Lua and remove fixture alias entries; they are not performance samples.' : 'Only collectgarbage(count) reads Lua usage. No forced Lua or browser garbage collection is used.',
    'Weak references remaining at the end may await a natural GC cycle; zero subscription growth does not prove all native or GPU allocations were freed.',
    'CDP JSHeapUsedSize excludes Lua/WASM linear memory, native allocations and GPU resources; checkpoint endpoints are asynchronous observations.'],
  samples: [], errors: [] };
const long = text => '[====[' + text + ']====]';
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(host.url).origin ? route.continue() : route.abort());
  await page.addInitScript(() => { window.__lifecycle = []; window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.name === 'runtime-lifecycle-result') window.__lifecycle.push(event.data.payload);
  }); });
  host.update({ revision: Date.now(), width: 390, height: 844, theme: config.theme, fonts,
    node: { kind: 'Element', tag: 'lui:Page', attrs: { Width: '390', Height: '844' }, children: [], sourcePath: 'Lifecycle.lui', nodePath: '0' } });
  await page.goto(host.url);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('已绘制'), undefined, { timeout: 60000 });
  await page.getByRole('button', { name: '节点选择：开' }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const source = `local function emit(value)local event=VariantMap();event['name']='runtime-lifecycle-result';event['payload']=cjson.encode(value);SendEvent('EmitToPlugin',event)end
local ok,err=xpcall(function()
local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime');local Parser=require('LUI.Parser');local Dirty=require('LUI.Dirty')
local Queue=require('LUI.MeasureQueue');local NativeText=require('LUI.NativeText')
local config=cjson.decode(${long(JSON.stringify(config))});config.sourceRoots={'Fixture'};config.componentDirectories={Fixture={List='Fixture/List.lui'}};config.changeTracking='notify'
local runtime=setmetatable({isV2_=true,documents_={},code_={},config_=config},Runtime)
runtime.documents_['Fixture/List.lui']=assert(Parser.Parse(${long(markup)},'Fixture/List.lui'))
runtime.code_['Fixture/List.lui.lua']=assert(load(${long(code)},'@Fixture/List.lui.lua'))()
runtime.documents_['Fixture/Page.lui']=assert(Parser.Parse([[<页面 名称="Lifecycle" 宽度="390" 高度="844" 内边距="25" 目录:x="Fixture"><x:List 引用="List" 宽度="340" 高度="720" 标题="生命周期" 计数="1000" 项目="{绑定 view.rows}" 状态="{绑定 view.state}"/></页面>]],'Fixture/Page.lui'))
local wrapper=UI.Panel{width=390,height=844,pointerEvents='box-none'};UI.SetRoot(wrapper,true)
local baseline=Dirty.stats.subscriptions;local completed,frame,idle=0,0,0;local current
local unmountProbe={pausedFrames=0}
local function queueContains(owner)
 for index=1,20 do local name,value=debug.getupvalue(Queue.Schedule,index);if not name then break end
  if name=='entries' then return value[owner]~=nil end
 end
 error('cannot observe background queue owner table')
end
local function mountingState()
 local list=current.controller
 return {frame=current.frames,cursor=list.model_.cursor_,width=list.model_.width_,height=list.model_.height_,
  rootRect=current.root:GetAbsoluteLayout(),scrollRect=list.scroll_:GetAbsoluteLayout(),
  mounted=current.root.luiOverlayMounted_,global=current.root.luiGlobalOverlay_,
  queued=queueContains(list),nativeStarts=NativeText.stats.starts,renderPending=list.renderPending_ or false,
  pendingGeometry=list.pendingGeometry_,rootDeferred=current.root.luiRenderDeferredFrame_}
end
local weak={};for _,name in ipairs({'page','context','component','controller','model','rows','firstRow','slotWidget'})do weak[name]=setmetatable({},{__mode='v'})end
local function nativeWarnings()
 local Widget=require('urhox-libs/UI/Core/Widget');local result={available=false,total=0,lui=0,destroyed=0,classes={}}
 for index=1,20 do
  local name,value=debug.getupvalue(Widget.CheckOverflow,index);if not name then break end
  if name=='warnedWidgets_' then
   result.available=true
   for widget in pairs(value)do
    result.total=result.total+1
    if rawget(widget,'luiContext_') then result.lui=result.lui+1 end
    if rawget(widget,'node')==nil then result.destroyed=result.destroyed+1 end
    local class=widget._className or 'Widget';result.classes[class]=(result.classes[class]or 0)+1
   end
   break
  end
 end
 return result
end
local function sample(phase)
 local refs={};for name,items in pairs(weak)do local count,oldest=0,nil;for index in pairs(items)do count=count+1;oldest=oldest and math.min(oldest,index)or index end;refs[name]={alive=count,oldestCycle=oldest}end
 local contexts=0;for _ in pairs(runtime.contexts_ or {})do contexts=contexts+1 end
 return {phase=phase,luaVersion=_VERSION,completed=completed,renderCallbacks=frame,subscriptions=Dirty.stats.subscriptions,baselineSubscriptions=baseline,
   luaKiB=collectgarbage('count'),runtimeContexts=contexts,weakReferences=refs,nativeOverflowWarnings=nativeWarnings(),unmountRemount=unmountProbe}
end
local function create()
 local cycle=completed+1;local rows={};for i=1,1000 do rows[i]={key='row:'..i,label='物品 '..i,description=i%5==0 and string.rep('长说明测试',15)or '说明'}end
 local root,context=runtime:RenderMarkup('Fixture/Page.lui',{view={rows=rows,state={}},refs={},actions={}});assert(root,context)
 wrapper:AddChild(root)
 local owner=context.refs.List.luiComponentHost_.luiComponentInstance_;local controller=owner.list_
 current={root=root,context=context,owner=owner,controller=controller,rows=rows,frames=0}
 weak.page[cycle],weak.context[cycle],weak.component[cycle],weak.controller[cycle]=root,context,owner,controller
 weak.model[cycle],weak.rows[cycle],weak.firstRow[cycle]=controller.model_,rows,rows[1]
end
local function destroy()
 local item=current;local controller=item.controller;local model=controller.model_;local scroll=controller.scroll_
 assert(#controller.pool_>0,'production list must create real row widgets')
 weak.slotWidget[completed+1]=controller.pool_[1].widget
 if item.root.luiGlobalOverlay_ then runtime:UnmountGlobalOverlay(item.root)end
 if item.root.parent then item.root.parent:RemoveChild(item.root)end;item.root:Destroy()
 assert(item.root.node==nil and scroll.node==nil,'page and list Yoga nodes must be freed')
 assert(item.owner.disposed_ and item.owner.list_==nil and item.owner.root_==nil and item.owner.context_==nil,'component Dispose must release active list references')
 assert(controller.disposed_ and controller.unsubscribe_==nil and controller.probe_==nil,'list subscription and probe must dispose')
 assert(#model.items_==0 and next(model.indices_)==nil and next(model.measured_)==nil,'model data must clear')
 for _,slot in ipairs(controller.pool_)do assert(slot.widget.node==nil and slot.row==nil and slot.index==nil,'pooled row must destroy and clear assignment')end
 assert(Dirty.stats.subscriptions==baseline,'subscriptions accumulated after cycle '..(completed+1)..': '..Dirty.stats.subscriptions..' versus '..baseline)
 current=nil;completed=completed+1
end
emit(sample('start'))
local cancel;cancel=runtime:AfterLayout(wrapper,function()
 local success,failure=xpcall(function()
 frame=frame+1
 if current then
  current.frames=current.frames+1
  if current.frames==2 then current.controller:ScrollTo(480)end
  if current.frames==4 then current.rows[1].label='更新 '..completed;runtime:NotifyChanged(current.context,'view.rows[1].label')end
  if completed==0 then
   if current.frames==6 then assert(runtime:MountGlobalOverlay(wrapper,current.root,10),'first real portal mount failed')end
   if current.frames==18 then
    unmountProbe.beforeUnmount=mountingState()
    runtime:UnmountGlobalOverlay(current.root)
    assert(not queueContains(current.controller),'Unmount must cancel pending background work immediately')
    unmountProbe.cursorAtUnmount=current.controller.model_.cursor_
    unmountProbe.nativeStartsAtUnmount=NativeText.stats.starts
    assert(unmountProbe.cursorAtUnmount<=1000,'first-cycle background should still have pending work')
   elseif current.frames>18 and current.frames<=30 then
    assert(not queueContains(current.controller),'unmounted list rejoined the queue')
    assert(current.controller.model_.cursor_==unmountProbe.cursorAtUnmount,'unmounted list continued background cursor advancement')
    assert(NativeText.stats.starts==unmountProbe.nativeStartsAtUnmount,'unmounted page continued native text measurement')
    unmountProbe.pausedFrames=unmountProbe.pausedFrames+1
    if current.frames==30 then assert(runtime:MountGlobalOverlay(wrapper,current.root,10),'remount failed')end
   elseif current.frames>=42 then
    if current.frames==42 then unmountProbe.twelveFramesAfterRemount=mountingState()end
    local resumed=current.controller.model_.cursor_>unmountProbe.cursorAtUnmount
    if not resumed and current.frames<90 then return end
    unmountProbe.afterRemount=mountingState()
    unmountProbe.cursorAfterRemount=current.controller.model_.cursor_
    unmountProbe.nativeStartsAfterRemount=NativeText.stats.starts
    assert(unmountProbe.cursorAfterRemount>unmountProbe.cursorAtUnmount,'remounted list did not resume background measurement')
    assert(unmountProbe.nativeStartsAfterRemount>unmountProbe.nativeStartsAtUnmount,'remounted list did not resume actual native text work')
    unmountProbe.passed=true;destroy()
   end
  elseif current.frames>=6 then destroy();if completed%10==0 then emit(sample('checkpoint'))end end
 elseif completed<100 then create()
 else idle=idle+1;if idle>=180 then cancel();
 ${diagnostic ? `emit(sample('natural-complete'))
 local key={};local ephemeron=setmetatable({},{__mode='k'});ephemeron[key]={back=key};local observed=setmetatable({key},{__mode='v'});key=nil
 collectgarbage('collect');collectgarbage('collect')
 local collected=sample('post-full-collection');collected.ephemeronKeyCollected=observed[1]==nil;emit(collected)
 local aliasMap
 for index=1,20 do local name,value=debug.getupvalue(Dirty.Alias,index);if name=='aliases' then aliasMap=value;break end end
 assert(aliasMap,'cannot observe Dirty alias registry')
 local cleared=0;for container in pairs(aliasMap)do aliasMap[container]=nil;cleared=cleared+1 end
 collectgarbage('collect');collectgarbage('collect')
 local result=sample('complete');result.aliasEntriesCleared=cleared
 local target=weak.controller[1]
 local function retainingPath(target)
  local queue,seen={},{}
  local function enqueue(value,path)
   local kind=type(value);if kind~='table' and kind~='function' and kind~='userdata'then return end
   if value==target then return path end
   if not seen[value] then seen[value]=true;queue[#queue+1]={value=value,path=path}end
  end
  enqueue(_G,'_G');enqueue(debug.getregistry(),'registry')
  local index=1
  while queue[index] and index<=250000 do
   local entry=queue[index];local value,path=entry.value,entry.path;local kind=type(value);local found
   if kind=='table' then
    local mt=debug.getmetatable(value);local mode=mt and rawget(mt,'__mode')or ''
    if mode==''then
     for key,child in next,value do
      found=enqueue(key,path..'.<key>') or enqueue(child,path..'['..(type(key)=='string' and key or tostring(key))..']')
      if found then return found,index end
     end
    end
    found=enqueue(mt,path..'.<metatable>')
   elseif kind=='function' then
    for up=1,200 do local name,child=debug.getupvalue(value,up);if not name then break end
     found=enqueue(child,path..'.<upvalue:'..name..'>');if found then return found,index end
    end
   else found=enqueue(debug.getmetatable(value),path..'.<metatable>')end
   if found then return found,index end
   index=index+1
  end
  return 'not-found',index-1
 end
 result.retainingPath,result.inspectedObjects=retainingPath(target);target=nil
 result.retainingPathScope='Lua globals and registry tables/functions/metatables, excluding weak tables; native references and thread stacks are opaque'
 result.phase='retaining-path';emit(result)
 local Widget=require('urhox-libs/UI/Core/Widget');assert(type(Widget.ResetOverflowWarnings)=='function')
 Widget.ResetOverflowWarnings();collectgarbage('collect');collectgarbage('collect')
 local released=sample('complete');released.resetNativeOverflowWarnings=true;emit(released)` : "emit(sample('complete'))"}
 end end
 end,debug.traceback)
 if not success then cancel();emit({error=tostring(failure),completed=completed,unmountRemount=unmountProbe})end
end)
end,debug.traceback)
if not ok then emit({error=tostring(err)})end`;
  await writeFile(resolve(output, 'fixture.lua'), source);
  await page.evaluate(source => document.querySelector('iframe').contentWindow.postMessage({ source: 'tap-plugin-host', kind: 'event', name: 'RunLuaSource', payload: { source } }, location.origin), source);
  const deadline = Date.now() + 90000;
  for (let index = 0; ; index++) {
    await page.waitForFunction(index => window.__lifecycle.length > index, index, { timeout: Math.max(1, deadline - Date.now()) });
    const sample = await page.evaluate(index => window.__lifecycle[index], index);
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    sample.browserObservation = { timestampSeconds: metrics.Timestamp, jsHeapUsedBytes: metrics.JSHeapUsedSize };
    report.samples.push(sample);
    console.log(JSON.stringify(sample));
    assert.ok(!sample.error, sample.error);
    if (sample.phase === 'complete') break;
    assert.ok(Date.now() < deadline, 'bounded lifecycle run exceeded 90 seconds');
  }
  const last = report.samples.find(sample => sample.phase === 'natural-complete') || report.samples.at(-1);
  assert.equal(last.completed, 100);
  assert.equal(last.subscriptions, last.baselineSubscriptions);
  assert.equal(last.unmountRemount.passed,true,'real Unmount/Remount lifecycle must be observed');
  assert.equal(last.unmountRemount.pausedFrames,12);
  assert.deepEqual(report.errors, []);
  report.deterministicCleanupPassed = true;
  report.weakCollectionComplete = Object.values(last.weakReferences).every(value => value.alive === 0);
  report.oldestCycleNaturallyCollected = Object.values(last.weakReferences).every(value => value.oldestCycle !== 1);
  report.nativeWarningsRetainNoLuiWidgets = last.nativeOverflowWarnings.available && last.nativeOverflowWarnings.lui === 0;
  report.status = report.weakCollectionComplete ? 'passed' : report.oldestCycleNaturallyCollected && report.nativeWarningsRetainNoLuiWidgets ? 'cleanup-and-natural-reclamation-observed' : 'retention-observed';
  if (report.status === 'retention-observed') process.exitCode = 2;
  const natural = report.samples.filter(sample => !['post-full-collection', 'retaining-path'].includes(sample.phase) && !(diagnostic && sample.phase === 'complete'));
  report.naturalMemorySummary = { luaStartKiB: natural[0].luaKiB, luaEndKiB: last.luaKiB,
    luaPeakKiB: Math.max(...natural.map(sample => sample.luaKiB)),
    maximumLiveControllersAtCheckpoints: Math.max(...natural.map(sample => sample.weakReferences.controller.alive)),
    lastWeakReferences: last.weakReferences,
    conclusion: report.status === 'retention-observed' ? 'Old cycles remain retained; investigation required.' : report.weakCollectionComplete ? 'All tracked lifecycle objects were naturally reclaimed.' : 'Old cycles were naturally reclaimed; the remaining recent cycles have not yet all been observed through a natural collection. This is not a bound on all native or GPU memory.' };
  report.identity = await (await fetch(host.url + 'identity.json')).json();
  for (const [path, hash] of Object.entries(report.identity.runtimeFiles).filter(([path]) => /^LUI\/[\w-]+\.lua$/.test(path))) {
    assert.equal(sha(await readFile(resolve(adapter, path.slice(4)))), hash, 'actual engine adapter bytes changed');
    if (!sourceOnly) assert.equal(sha(await readFile(resolve(game, 'scripts', path))), hash, 'actual engine must match deployed adapter');
  }
  await cdp.detach();
  await page.close();
} catch (error) {
  report.status = 'failed'; report.errors.push(error.stack || String(error)); throw error;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); host.dispose();
}
