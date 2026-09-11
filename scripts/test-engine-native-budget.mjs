// Independent counters are installed below LUI's wrappers, before Runtime loads.
// Counts actual Lua -> C Bounds/BoxBounds/Metrics starts, including cold creation.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {nativeBudgetObserver as observer} from './lib/native-budget-observer.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const game=resolve(process.argv[2]), output=resolve(process.argv[3]||'artifacts/engine-native-budget');
const adapter=resolve(process.env.LUI_NATIVE_ADAPTER||'packages/runtime-urhox-lua/adapter');
await mkdir(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
assert.equal(config.runtimeManifestHash,sha(await readFile(resolve(adapter,'runtime-manifest.json'))));
const markup=await readFile(resolve(game,'scripts/Presentation/Components/SelectionList.lui'),'utf8');
const backend=await readFile(resolve(game,'scripts/Presentation/Components/SelectionList.lui.lua'),'utf8');
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const files=[];for(const f of config.fonts)for(const v of Object.values(f.weights))files.push({path:v.resource,sha256:v.sha256,bytes:await readFile(resolve(game,'assets',v.resource))});
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),adapter,files);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const report={kind:'LUI.NativeTextBudgetProbe',runtimeManifestHash:config.runtimeManifestHash,errors:[],
 scope:'One real engine VM, two production SelectionList runtimes; cold creation, background measurement, hot scroll, font/text/paint updates.',
 limitations:['Counts the three Lua-to-C NanoVG text measurement APIs, not native internal helper instructions, draw/GPU work, CPU utilization or phone FPS.',
 '2 ms is a soft elapsed wall deadline: an already started individual C call completes; no next C measurement is started after expiry. The native timer has millisecond ticks.',
 'Additional raw boundary observation is diagnostic overhead; these timings are not a CPU performance comparison.']};
const long=t=>'[====['+t+']====]';

try{
 const page=await browser.newPage({viewport:{width:1000,height:1100}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).origin!==new URL(host.url).origin)return route.abort();
  if(route.request().url().endsWith('/bootstrap.lua')){
   const response=await route.fetch();const source=await response.text();const seam="local Runtime=require('LUI.Runtime')";assert.ok(source.includes(seam));
   return route.fulfill({response,body:source.replace(seam,observer+'\n'+seam)});
  }return route.continue();
 });
 await page.addInitScript(()=>{window.__nativeBudget=[];window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.name==='native-budget-probe')window.__nativeBudget.push(e.data.payload)});});
 host.update({revision:Date.now(),width:800,height:844,theme:config.theme,fonts,node:{kind:'Element',tag:'lui:Page',attrs:{Width:'800',Height:'844'},children:[],sourcePath:'NativeBudget.lui',nodePath:'0'}});
 await page.goto(host.url);await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已绘制'),undefined,{timeout:60000}).catch(async error=>{
  report.previewState=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent}));throw error;
 });
 await page.getByRole('button',{name:'节点选择：开'}).click();
 const fixture=`local function emit(data)local e=VariantMap();e['name']='native-budget-probe';e['payload']=cjson.encode(data);SendEvent('EmitToPlugin',e)end
local ok,err=xpcall(function()
local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime');local Parser=require('LUI.Parser');local Budget=require('LUI.MeasureBudget')
NativeProbe.queueDrains,NativeProbe.backgroundCalls,NativeProbe.frameEndEvents=0,0,0
local Queue=require('LUI.MeasureQueue');local drain=Queue.Drain
Queue.Drain=function(...)
 NativeProbe.queueDrains=NativeProbe.queueDrains+1
 local result=table.pack(drain(...));NativeProbe.frameEndEvents=NativeProbe.frameEndEvents+1;NativeProbe.FinalizeFrame()
 return table.unpack(result,1,result.n)
end
local Virtual=require('LUI.VirtualList');local background=Virtual.MeasureBackground
Virtual.MeasureBackground=function(...)NativeProbe.backgroundCalls=NativeProbe.backgroundCalls+1;return background(...)end
local comparisons={};local comparisonBudget={clock=function()return 0 end,seconds=1,limit=10000,calls=0,rows=0,frame=0,overrunMilliseconds=0}
for _,size in ipairs({12,18,24})do for _,text in ipairs({'首屏基线 Mg','Ágj文字 Mixed',string.rep('多行测量 ',12)})do for _,multiline in ipairs({false,true})do
 local options={fontSize=size,minFontSize=size,fontFace=UI.Theme.FontFace('sans',400),letterSpacing=.2,lineHeight=1.3,width=120,height=40,multiline=multiline}
 local expected=NativeProbe.referenceFit(text,options)
 local ok,actual=Budget.Guard(comparisonBudget,function()return UI.MeasureTextFit(text,options)end,{})
 assert(ok and math.abs(expected.width-actual.width)<.001 and math.abs(expected.height-actual.height)<.001 and expected.fontSize==actual.fontSize,'native fixed-font fit parity failed: '..cjson.encode({text=text,expected=expected,actual=actual,options=options}))
 comparisons[#comparisons+1]={fontSize=size,multiline=multiline,width=actual.width,height=actual.height}
end end end
local config=cjson.decode(${long(JSON.stringify(config))});config.sourceRoots={'Fixture'};config.componentDirectories={'Fixture'};config.changeTracking='notify'
local runtimes,lists,contexts,roots={},{},{},{};local changes={}
local wrapper=UI.Panel{width=800,height=844,flexDirection='row'};UI.SetRoot(wrapper,true)
local first=setmetatable({isV2_=true,documents_={},code_={},config_=config},Runtime)
local fixtureRegistry={GetDirectoryComponent=function(_,directory,name)
 if directory=='Fixture' and name=='List' then return {markup='Fixture/List.lui',code='Fixture/List.lui.lua'} end
end}
first.registry_=fixtureRegistry
NativeProbe.Budget,NativeProbe.budget=Budget,Budget.Get(first);NativeProbe.enabled=true
local beforeCalls=0
for n=1,2 do
 local rt=n==1 and first or setmetatable({isV2_=true,documents_={},code_={},config_=config,registry_=fixtureRegistry},Runtime);runtimes[n]=rt
 assert(Budget.Get(rt)==NativeProbe.budget,'both runtimes must share the identical VM budget')
 rt.documents_['Fixture/List.lui']=assert(Parser.Parse(${long(markup)},'Fixture/List.lui'))
 rt.code_['Fixture/List.lui.lua']=assert(load(${long(backend)},'@Fixture/List.lui.lua'))()
 local rows={};for i=1,1000 do rows[i]={key='row:'..i,label='冷测量 '..n..' / '..i,description=i%5==0 and string.rep('原生多行预算',12)or '首屏文本'}end
 rt.documents_['Fixture/Page.lui']=assert(Parser.Parse([[<页面 名称="NativeBudget" 宽度="390" 高度="844" 内边距="25" 目录:x="Fixture"><容器 子项排列="垂直" 宽度="340" 高度="790"><文本 引用="Title" 文本="首屏与原生文字测量" 字号="18"/><x:List 引用="List" 宽度="340" 高度="720" 标题="实际测量预算" 计数="1000" 项目="{绑定 view.rows}" 状态="{绑定 view.state}"/></容器></页面>]],'Fixture/Page.lui'))
 local root,ctx=rt:RenderMarkup('Fixture/Page.lui',{view={rows=rows,state={}},refs={},actions={}});assert(root,ctx);roots[n],contexts[n]=root,ctx;wrapper:AddChild(root)
 lists[n]=ctx.refs.List.luiComponentHost_.luiComponentInstance_.list_
 local model=lists[n].model_;local viewport=model.SetViewport
 function model:SetViewport(w,h,signature)
  local old={width=self.width_,height=self.height_,signature=self.signature_,cursor=self.cursor_}
  local result=viewport(self,w,h,signature)
  if result and #changes<50 then changes[#changes+1]={list=n,token=NativeProbe.budget.frame,old=old,width=w,height=h,signature=signature}end
  return result
 end
end
for _,row in pairs(NativeProbe.frames)do beforeCalls=beforeCalls+row.calls end
assert(beforeCalls==0,'cold constructors must defer all text measurement')
-- Business startup owns global Lua event subscriptions. The framework's
-- dedicated ScriptObject must continue independently when these are replaced.
local business={beginFrame=0,update=0,endFrame=0}
function HandleProbeBusinessBegin()business.beginFrame=business.beginFrame+1 end
function HandleProbeBusinessUpdate()business.update=business.update+1 end
function HandleProbeBusinessEnd()business.endFrame=business.endFrame+1 end
SubscribeToEvent('BeginFrame','HandleProbeBusinessBegin');SubscribeToEvent('Update','HandleProbeBusinessUpdate');SubscribeToEvent('EndFrame','HandleProbeBusinessEnd')
local session=require('LUI.PerformanceSession').Start(first,{scene='native-budget-event-isolation',warmupFrames=0,maxSamples=60})
local frame,phase,phaseFrame=0,'cold',0;local history={};local cancel;local complete=false;local firstReady={};local staticMaximumCalls=0
local function snapshot()
 local data={phase=phase,frame=frame,phaseFrame=phaseFrame,cursors={},pending={},calls=NativeProbe.budget.calls,rows=NativeProbe.budget.rows,committedCalls=NativeProbe.budget.committedCalls or 0,fontVersion=UI.GetFontVersion(),signatures={},widths={},queueDrains=NativeProbe.queueDrains,backgroundCalls=NativeProbe.backgroundCalls,frameEndEvents=NativeProbe.frameEndEvents}
 for i,list in ipairs(lists)do data.cursors[i]=list.model_.cursor_;data.pending[i]=list.renderPending_==true;data.signatures[i]=list.model_.signature_;data.widths[i]=list.model_.width_ end
 history[#history+1]=data;emit({progress=true,snapshot=data});return data
end
cancel=first:AfterLayout(wrapper,function()
 local good,failure=xpcall(function()
 frame=frame+1;phaseFrame=phaseFrame+1
 for i,list in ipairs(lists)do
  local count=math.max(0,(list.last_ or 0)-(list.first_ or 1)+1)
  if not firstReady[i] and count>0
   and #(list.renderChildren_ or {})==count and list.model_.width_>=290 and list.model_.height_>=600
   and not list.renderPending_ then firstReady[i]=frame end
 end
 if frame%60==0 then snapshot()end
 if frame==180 and NativeProbe.backgroundCalls==0 then error('background queue never ran: '..cjson.encode(snapshot()))end
 local settled=true;for _,list in ipairs(lists)do if list.model_.cursor_<=1000 or list.renderPending_ then settled=false end end
 if phase=='static' and not settled then snapshot();phase,phaseFrame='cold',0 end
 if phase=='static' and phaseFrame>10 then staticMaximumCalls=math.max(staticMaximumCalls,NativeProbe.budget.calls)end
 if phase=='cold' and settled then snapshot();phase,phaseFrame='static',0
 elseif phase=='static' and phaseFrame==60 then snapshot();phase,phaseFrame='scroll',0
 elseif phase=='scroll' then
  for i,list in ipairs(lists)do list:ScrollTo((phaseFrame%100)*80+i*11)end
  if phaseFrame==180 then snapshot();phase,phaseFrame='updates',0 end
 elseif phase=='updates' then
  for i,rt in ipairs(runtimes)do
   local ctx=contexts[i];ctx.view.rows[1].label='更新 '..phaseFrame
   rt:NotifyChanged(ctx,'view.rows[1].label')
   if phaseFrame%7==0 then ctx.refs.Title:SetStyle({fontSize=16+phaseFrame%4})end
   if phaseFrame%2==0 then ctx.refs.Title:SetStyle({fontColor={255,255,255,255}})end
  end
  if phaseFrame==120 then snapshot();complete=true end
 end
 if frame>1800 then snapshot();error('cold measurement failed to settle within 1800 real frames')end
 if complete then
  cancel();NativeProbe.enabled=false
  -- Current frame has not reached nvgEndFrame yet; keep only finalized rows.
  NativeProbe.frames[tostring(NativeProbe.budget.frame)]=nil
  emit({done=true,frames=NativeProbe.frames,history=history,staticMaximumCalls=staticMaximumCalls,firstVisibleReadyFrames=firstReady,fitComparisons=comparisons,viewportChanges=changes,totalFrames=frame,coldConstructorCalls=beforeCalls,maximumSaveDepth=NativeProbe.maximumDepth,restoredOnError=require('LUI.NativeText').stats.restoredOnError,businessEvents=business,performanceSession=session:Stop()})
 end
 end,debug.traceback)
 if not good then cancel();NativeProbe.enabled=false;emit({error=tostring(failure),frames=NativeProbe.frames,history=history,firstVisibleReadyFrames=firstReady,viewportChanges=changes,fitComparisons=comparisons})end
end)
end,debug.traceback)
if not ok then emit({error=tostring(err),frames=NativeProbe.frames})end`;
 await writeFile(resolve(output,'fixture.lua'),fixture);await writeFile(resolve(output,'observer.lua'),observer);
 await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),fixture);
 await page.waitForFunction(()=>window.__nativeBudget.some(value=>value.done||value.error),undefined,{timeout:90000});
 const result=await page.evaluate(()=>window.__nativeBudget.findLast(value=>value.done||value.error));Object.assign(report,result);assert.ok(!result.error,result.error);
 const frames=Object.values(result.frames);assert.ok(frames.length>300);
 assert.equal(result.firstVisibleReadyFrames.length,2,'both runtimes must show a visible window');
 assert.ok(result.firstVisibleReadyFrames.every(frame=>frame<=120),'each cold visible window must be ready within 120 actual frames in this diagnostic fixture');
 assert.equal(result.staticMaximumCalls,0,'settled static frames must not repeatedly measure natively');
 assert.ok(Object.values(result.businessEvents).every(count=>count>=result.totalFrames-1),'business frame subscriptions must run');
 assert.ok(result.performanceSession.summary.totalFrames>=result.totalFrames-1,'private Update sampling must survive business global Update subscription');
 report.maximumCalls=Math.max(...frames.map(f=>f.calls));report.maximumOverrunMilliseconds=Math.max(...frames.map(f=>f.overrun||0));
 report.maximumBackgroundCalls=Math.max(...frames.map(f=>f.calls-(f.committedStarts||0)));
 assert.ok(frames.every(f=>f.calls-(f.committedStarts||0)<=64),'background C starts exceeded 64 in a physical frame');
 assert.ok(frames.every(f=>f.outside===0),'actual C measurement started outside the shared guard');
 assert.ok(frames.every(f=>f.budgetCalls===f.calls-(f.committedStarts||0)),'independent C observation must equal background budget accounting');
 assert.ok(frames.every(f=>(f.budgetCommittedCalls||0)===(f.committedStarts||0)),'committed visible C starts must use separate accounting');
 report.clockBoundaryObservations=frames.reduce((sum,f)=>sum+f.lateStarts,0);
 report.maximumObserverLagMilliseconds=Math.max(...frames.map(f=>f.maximumObserverLagMilliseconds));
 assert.ok(frames.every(f=>f.rejectedStartChecks===0),'the last budget check admitted a C call at or beyond the deadline');
 assert.ok(frames.every(f=>f.depth===0),'native save stack is not balanced at end of frame');
 report.identity=await(await fetch(host.url+'identity.json')).json();
 report.verifiedLuaFiles=0;
 for(const [path,expected] of Object.entries(report.identity.runtimeFiles).filter(([path])=>/^LUI\/[\w-]+\.lua$/.test(path))){
  assert.equal(sha(await readFile(resolve(adapter,path.slice(4)))),expected,'loaded Lua must match adapter bytes');
  assert.equal(sha(await readFile(resolve(game,'scripts',path))),expected,'loaded Lua must match deployed bytes');
  report.verifiedLuaFiles++;
 }
 report.status='passed';console.log(JSON.stringify({status:report.status,maximumCalls:report.maximumCalls,maximumOverrunMilliseconds:report.maximumOverrunMilliseconds,totalFrames:result.totalFrames,firstVisibleReadyFrames:result.firstVisibleReadyFrames,staticMaximumCalls:result.staticMaximumCalls,verifiedLuaFiles:report.verifiedLuaFiles}));
 await page.close();
}catch(error){report.status='failed';report.errors.push(error.stack||String(error));throw error}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose()}
