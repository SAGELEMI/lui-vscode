// Real vendor UI.Render / Yoga / input-stack regression, isolated from game Lua.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const deviceScaleFactor=Number(process.env.LUI_DEVICE_SCALE_FACTOR||1);
assert.ok(Number.isFinite(deviceScaleFactor)&&deviceScaleFactor>0,'valid device scale factor');
const game=resolve(process.argv[2]),output=resolve(`artifacts/engine-overlays-20260906${deviceScaleFactor===1?'':`-dpr${deviceScaleFactor}`}`);
await mkdir(output,{recursive:true});
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
const files=[];for(const f of config.fonts)for(const font of Object.values(f.weights))files.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),resolve('packages/runtime-urhox-lua/adapter'),files);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:1200},deviceScaleFactor});
const results=[];
await page.addInitScript(()=>{window.__results=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&['lui-preview-applied','lui-preview-error'].includes(event.data?.name))window.__results.push({name:event.data.name,...event.data.payload});});});
try{
 await page.goto(host.url);
 let revision=0;
 for(const [width,height]of [[358,425],[360,800],[377,496],[390,844],[390,867],[640,1024]]){
  revision++;
  host.update({revision,width,height,theme:config.theme,fonts,runChecks:true,runOverlayChecks:true,node:{kind:'Element',tag:'lui:Page',attrs:{Width:'390',Height:'867',Background:'#0B0714'},children:[],sourcePath:'Fixture.lui',nodePath:''}});
  await page.waitForFunction(revision=>window.__results.some(r=>r.revision===revision||r.name==='lui-preview-error'),revision,{timeout:60000});
  const result=await page.evaluate(revision=>window.__results.find(r=>r.revision===revision||r.name==='lui-preview-error'),revision);
  results.push({width,height,deviceScaleFactor,...result});console.log(JSON.stringify(results.at(-1)));
  assert.equal(result.name,'lui-preview-applied',result.message);assert.ok(result.overlayChecks,'overlay callback must report');
 }
 await writeFile(resolve(output,'report.json'),JSON.stringify({identity:await(await fetch(host.url+'identity.json')).json(),results},null,2));
}finally{await writeFile(resolve(output,'latest-results.json'),JSON.stringify(results,null,2));await browser.close();host.dispose();}
