// All authored scenarios, real shared Runtime and official engine. No game Lua.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {visibleLayoutProbe,recordEngineErrors} from './lib/visible-layout-probe.mjs';
import {projectDeclarationSnapshot,verifyEngineRuntime} from './lib/preview-fixture.mjs';
import {projectSourceResources,compareProjectSource,liveProjectSamples,projectDrawObserver,verifyProjectTrimming} from './lib/project-source-parity.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
if(!process.argv[2])throw Error('Usage: node scripts/test-project-preview-engine.mjs <game> [--size 390x844] [--source Presentation/Scenes/Tower.lui]');
const outputIndex=process.argv.indexOf('--output');
const game=resolve(process.argv[2]),scripts=resolve(game,'scripts'),output=resolve(outputIndex>=0?process.argv[outputIndex+1]:'artifacts/project-declaration-engine');
await mkdir(output,{recursive:true});
const config=JSON.parse(await readFile(resolve(scripts,'LUI/lui.project.json'),'utf8'));
const sourceParity=process.argv.includes('--project-source');
const liveCases=process.argv.includes('--live-project-cases');
assert.ok(!liveCases||sourceParity,'--live-project-cases requires --project-source');
const sourceIndex=process.argv.indexOf('--source'),only=sourceIndex>=0?process.argv[sourceIndex+1]:undefined;
const repeatIndex=process.argv.indexOf('--repeat'),repeats=repeatIndex>=0?Number(process.argv[repeatIndex+1]):1;
const probeIndex=process.argv.indexOf('--probe-frames'),probeFrames=probeIndex>=0?Number(process.argv[probeIndex+1]):20;
assert.ok(Number.isInteger(repeats)&&repeats>=1&&repeats<=10);assert.ok(Number.isInteger(probeFrames)&&probeFrames>=1&&probeFrames<=600);
const sizeIndex=process.argv.indexOf('--size'),sizesIndex=process.argv.indexOf('--sizes'),sizes=sizesIndex>=0?process.argv[sizesIndex+1].split(','):sizeIndex>=0?[process.argv[sizeIndex+1]]:['390x844','358x425','768x1024'];
async function files(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async e=>e.isDirectory()?files(resolve(dir,e.name)):e.name.endsWith('.lui')?[resolve(dir,e.name)]:[]))).flat();}
const fontFiles=[];for(const family of config.fonts)for(const font of Object.values(family.weights))fontFiles.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([weight,font])=>[weight,font.resource]))}));
const runtimeDirectory=resolve(process.env.LUI_TEST_RUNTIME_DIR||'runtime/urhox-lua');
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),runtimeDirectory,fontFiles);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1100,height:1250},deviceScaleFactor:1});
const report={passed:false,scope:'all project declaration scenes at explicit viewports, no business Lua/storage; this checks rendering health and produces visual review evidence, not cross-device pixel equivalence',cases:[],errors:[],console:[]};
if(sourceParity){
 const projected=await projectSourceResources(game);
 report.scope='same project samples: production companion InitializeComponent/OnLoaded and complete imported component New vs Studio BuildPreview; compare authored-node text/visibility/local and clipped screen geometry within 0.01 logical pixels, not historical RGBA';
 report.sourceParityIsolation={pageDataBoundary:'Same sample replaces page CreateContext result; App/domain data generation and actions are not executed. Root components and all imports execute their real New/Init/CreateContext.',businessNetwork:false,playerStorage:false,projectFiles:projected.hashes};
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).origin!==new URL(host.url).origin){await route.abort();return;}
  if(liveCases&&route.request().url().endsWith('/bootstrap.lua')){
   const response=await route.fetch(),text=await response.text();
   const marker="local Runtime=require('LUI.Runtime')";assert.ok(text.includes(marker));
   await route.fulfill({response,body:text.replace(marker,projectDrawObserver+'\n'+marker)});return;
  }
  if(route.request().url().endsWith('/runtime.json')){
   const response=await route.fetch(),resources=await response.json();
   await route.fulfill({response,json:{...resources,...projected.resources}});return;
  }
  await route.continue();
 });
}
page.on('pageerror',error=>report.errors.push(error.message));
recordEngineErrors(page,report);
page.on('console',message=>{const value=message.text();if(message.type()==='error'||/\[LUI\.|stack traceback|attempt to|Error:|error executing/i.test(value))report.console.push({type:message.type(),text:value});});
await page.addInitScript(()=>{
 window.__previewEvents=[];
 window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.source==='tap-plugin-viewer')window.__previewEvents.push(event.data);});
 const raf=window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame=callback=>raf(time=>{
  callback(time);const capture=window.__projectCapture;if(!capture||capture.lastTime===time)return;capture.lastTime=time;
  if(++capture.frames<20)return;
  const canvas=document.querySelector('canvas'),gl=canvas&&(canvas.getContext('webgl2')||canvas.getContext('webgl'));if(!gl)return;
  const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  window.__projectCaptured={width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,error:gl.getError(),bytes:btoa(binary)};window.__projectCapture=null;
 });
});
let revision=0;
try{
 await page.goto(host.url);
 cases: for(let repeat=0;repeat<repeats;repeat++)for(const file of await files(resolve(scripts,'Presentation'))){
  const source=relative(scripts,file).replaceAll('\\','/');if(only&&source!==only)continue;
  const samples=liveCases?liveProjectSamples(source):[{scene:'内联预览',data:undefined}];
  for(const{scene,data,initialData,updateValues,verifyTrimming}of samples)for(const size of sizes){
   const[width,height]=size.split('x').map(Number);assert.ok(width>0&&height>0,'invalid viewport');
   const current=++revision,result={source,scene,width,height,revision:current,passed:false};
   try{
    const declaration=await projectDeclarationSnapshot(game,config,source,data);
    host.update({revision:current,width,height,theme:config.theme,fonts,probeLayout:true,probeLayoutFrames:process.argv.includes('--first-layout')?1:probeFrames,...declaration});
    await page.waitForFunction(revision=>window.__previewEvents.some(e=>(e.name==='lui-preview-applied'&&e.payload?.revision===revision)||(e.name==='lui-preview-error')),current,{timeout:60000});
    const events=await page.evaluate(()=>{const events=window.__previewEvents;window.__previewEvents=[];return events;});
    const error=events.find(e=>e.name==='lui-preview-error');assert.ok(!error,JSON.stringify(error?.payload));
    const applied=events.find(e=>e.name==='lui-preview-applied'&&e.payload?.revision===current);assert.ok(applied,'missing matching render acknowledgment');
    result.layoutNodes=applied.payload.layout?.length??0;assert.ok(result.layoutNodes>0,'missing actual engine layout nodes');
    for(const node of applied.payload.layout)for(const key of ['x','y','width','height'])assert.ok(typeof node[key]==='number'&&Number.isFinite(node[key]),'invalid geometry '+node.sourcePath+' '+node.nodePath+' '+key);
    const frame=page.frames().find(f=>f.url().includes('engine-frame.html'));assert.ok(frame);
    await frame.evaluate(()=>{window.__projectCaptured=null;window.__projectCapture={frames:0,lastTime:-1};});
    await frame.waitForFunction(()=>window.__projectCaptured,null,{timeout:15000});
    const inspectSource=visibleLayoutProbe+`
local ok,value=xpcall(function()local Runtime=require('LUI.Runtime');return verifyVisibleLayout(setmetatable({},Runtime),require('urhox-libs/UI').GetRoot(),${width},${height})end,debug.traceback)
local event=VariantMap();event['name']='lui-visible-layout';event['payload']=cjson.encode({revision=${current},ok=ok,result=ok and value or nil,error=not ok and tostring(value)or nil});SendEvent('EmitToPlugin',event)`;
    await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),inspectSource);
    await page.waitForFunction(revision=>window.__previewEvents.some(e=>e.name==='lui-visible-layout'&&e.payload?.revision===revision),current,{timeout:10000});
    const settled=await page.evaluate(revision=>window.__previewEvents.find(e=>e.name==='lui-visible-layout'&&e.payload?.revision===revision)?.payload,current);
    assert.ok(settled?.ok,settled?.error||'missing visible-layout result');result.visibleLayout=settled.result;
    const capture=await frame.evaluate(()=>window.__projectCaptured),bytes=Buffer.from(capture.bytes,'base64');
    assert.equal(capture.error,0);assert.equal(capture.width,width);assert.equal(capture.height,height);assert.equal(bytes.length,width*height*4);
    result.sha256=createHash('sha256').update(bytes).digest('hex');result.screenshot=`case-${String(current).padStart(3,'0')}.png`;
    await frame.locator('canvas').screenshot({path:resolve(output,result.screenshot)});
    await writeFile(resolve(output,`case-${String(current).padStart(3,'0')}.layout.json`),JSON.stringify(applied.payload.layout,null,2));
    if(sourceParity){
     const comparison=await compareProjectSource({page,source,data,width,height,config,initialData,updateValues});
     const parityFile=`case-${String(current).padStart(3,'0')}.project-parity.json`;
     await writeFile(resolve(output,parityFile),JSON.stringify(comparison,null,2));
     result.projectSourceParity={passed:comparison.passed,entry:comparison.entry,sourceNodes:comparison.sourceNodes,previewNodes:comparison.previewNodes,sourceVisible:comparison.sourceVisible,frames:comparison.frames,stableFrames:comparison.stableFrames,loadedCode:comparison.loadedCode,componentInstances:comparison.componentInstances,liveUpdate:comparison.liveUpdate,differenceCount:comparison.differences.length,report:parityFile};
     assert.ok(comparison.passed,'project/source geometry differs: '+JSON.stringify(comparison.differences.slice(0,2)));
     if(verifyTrimming)result.projectSourceParity.trimming=verifyProjectTrimming(comparison);
    }
    result.passed=true;
   }catch(error){result.error=String(error?.stack||error);result.events=await page.evaluate(()=>window.__previewEvents).catch(()=>[]);result.engineConsole=report.console.slice(-20);}
   report.cases.push(result);const {events:ignoredEvents,engineConsole:ignoredConsole,...progress}=result;console.log(JSON.stringify(progress));await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
   if(sourceParity&&report.cases.filter(c=>!c.passed).length>=2)break cases;
  }
 }
 report.identity=await(await fetch(host.url+'identity.json')).json();
 report.runtime=await verifyEngineRuntime(report.identity,runtimeDirectory);
 report.passed=report.cases.length>0&&report.cases.every(c=>c.passed)&&report.errors.length===0;
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 await writeFile(resolve(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>项目声明预览验收</title><style>body{font:14px sans-serif;background:#161220;color:#eee}main{display:flex;flex-wrap:wrap;gap:16px}article{max-width:390px}img{max-width:100%;height:auto}p{white-space:pre-wrap}</style><h1>项目声明预览 · ${report.cases.filter(c=>c.passed).length}/${report.cases.length}</h1><main>${report.cases.map(c=>`<article><p>${escape(c.source)} · ${escape(c.scene)} · ${c.width}×${c.height}</p>${c.screenshot?`<img loading="lazy" src="${c.screenshot}">`:`<p>${escape(c.error)}</p>`}</article>`).join('')}</main>`,'utf8');
 assert.ok(report.passed,'some project scenarios failed; inspect '+resolve(output,'report.json'));
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
