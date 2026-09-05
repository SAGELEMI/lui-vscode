// Explicit isolated engine QA. Compares source Parser/Runtime against Studio's
// data projection on one GL context. Never loads game Lua or player storage.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const {parseLui}=require('../dist/spec.cjs');
const {buildEngineSnapshot,resolvePreviewAttributes,canonicalTag}=require('../dist/previewSnapshot.cjs');
const game=resolve(process.argv[2]);
const output=resolve('artifacts/engine-parity-20260906');await mkdir(output,{recursive:true});
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
const files=[];
for(const family of config.fonts)for(const font of Object.values(family.weights))files.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
const host=new EnginePreviewHost();
await host.start(resolve('artifacts/engine-cache'),resolve('packages/runtime-urhox-lua/adapter'),files);
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const empty={kind:'Element',tag:'lui:Page',attrs:{Width:'390',Height:'867',Background:'#0B0714'},children:[],sourcePath:'Fixture.lui',nodePath:''};
host.update({revision:1,width:390,height:867,theme:config.theme,fonts,node:empty});
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:1100},deviceScaleFactor:1});
await page.addInitScript(()=>{
 const raf=window.requestAnimationFrame.bind(window);
 window.__completedVendorRaf=0;
 window.requestAnimationFrame=callback=>raf(time=>{
  callback(time);
  window.__completedVendorRaf++;
  if(!window.__capture)return;
  const canvas=document.querySelector('canvas');
  const gl=canvas&&(canvas.getContext('webgl2')||canvas.getContext('webgl'));
  if(!gl)return;
  const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
  gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const capture={pixels,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,error:gl.getError(),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),attributes:gl.getContextAttributes(),colorSpace:gl.drawingBufferColorSpace,devicePixelRatio,completedVendorRaf:window.__completedVendorRaf,rafTimestamp:time};
  // Several vendor callbacks can run at one display timestamp. Retain the
  // latest one until the next timestamp, then compare across that boundary.
  const frames=window.__capture.frames;
  if(frames.length===1&&time===frames[0].rafTimestamp)frames[0]=capture;
  else frames.push(capture);
  if(window.__capture.frames.length===2){window.__captured=window.__capture.frames;window.__capture=null;}
 });
});
const report={scope:'isolated static scalar fixtures; not all tags, game state or VS Code interaction',passed:false,cases:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
const long=value=>'[====['+value+']====]';
async function runLua(source){
 await page.evaluate(source=>{const frame=document.querySelector('iframe');frame.contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin);},source);
}
async function render(kind,source,data,node){
 const seq=report.cases.length+'-'+kind;
 await page.evaluate(sequence=>{window.__parity=null;window.__expectedParity=sequence;},seq);
 await runLua(`local ok,err=xpcall(function()
 local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime')
 local runtime=setmetatable({config_={componentDirectories={}},isV2_=true},Runtime)
 local button,title;local build=runtime.BuildNode
 function runtime:BuildNode(n,c) local w=build(self,n,c);if n.tag=='Button' then button=w end;if n.tag=='Text' and not title then title=w end;return w end
 local context=cjson.decode(${long(JSON.stringify(data))});context.refs={};context.actions={}
 local node=${kind==='source'?`assert(require('LUI.Parser').Parse(${long(source)},'Fixture.lui'))`:`cjson.decode(${long(JSON.stringify(node))})`}
 local content=runtime:BuildNode(node,context)
 if button and context.view.state then button:SetState({hovered=context.view.state=='hover',pressed=context.view.state=='pressed'}) end
 local previous=UI.GetRoot();local candidate=UI.Panel{width='100%',height='100%',children={content}}
 UI.SetRoot(candidate);if previous then previous:Destroy() end
 local frames=0;local cancel
 cancel=runtime:AfterLayout(candidate,function()
  frames=frames+1;if frames<12 then return end;cancel()
  local out=VariantMap();out['name']='lui-parity-ready';out['payload']=cjson.encode({sequence='${seq}',minimumCompletedLayouts=frames,text=title and title.props.text,textRect=title and runtime:GetScreenRect(title),uiScale=UI.GetScale()})
  SendEvent('EmitToPlugin',out)
 end)
end,debug.traceback)
if not ok then local out=VariantMap();out['name']='lui-parity-ready';out['payload']=cjson.encode({sequence='${seq}',error=tostring(err)});SendEvent('EmitToPlugin',out) end`);
 await page.waitForFunction(()=>window.__parity,{timeout:20000});
 const result=await page.evaluate(()=>window.__parity);assert.ok(!result.error,result.error);assert.equal(result.sequence,seq);assert.equal(result.text,data.view.title);
 const frame=page.frames().find(f=>f.url().includes('engine-frame.html'));
 await frame.evaluate(()=>{window.__capture={frames:[]};window.__captured=null;});
 await frame.waitForFunction(()=>window.__captured,{timeout:10000});
 const captures=await frame.evaluate(()=>window.__captured.map(c=>{let binary='';for(let i=0;i<c.pixels.length;i+=8192)binary+=String.fromCharCode(...c.pixels.subarray(i,i+8192));return {...c,pixels:btoa(binary)};}));
 const [first,capture]=captures.map(capture=>{
  const bytes=Buffer.from(capture.pixels,'base64');delete capture.pixels;
  assert.equal(capture.error,0);assert.equal(bytes.length,capture.width*capture.height*4);
  assert.equal(capture.width,390*capture.devicePixelRatio);assert.equal(capture.height,867*capture.devicePixelRatio);
  return {...capture,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
 });
 assert.equal(capture.completedVendorRaf,first.completedVendorRaf+1,'stability captures must follow consecutive completed vendor callbacks');
 assert.ok(capture.rafTimestamp>first.rafTimestamp,'stability captures must span two distinct display timestamps');
 assert.equal(first.sha256,capture.sha256,'static UI must be identical across two consecutive completed vendor callbacks');
 const rect=result.textRect;assert.ok(rect&&rect.w>0&&rect.h>0,'title must have a real visible rectangle');
 const colors=new Set();let inkPixels=0;
 for(let y=Math.max(0,Math.floor(rect.y*result.uiScale));y<Math.min(capture.height,Math.ceil((rect.y+rect.h)*result.uiScale));y++){
  for(let x=Math.max(0,Math.floor(rect.x*result.uiScale));x<Math.min(capture.width,Math.ceil((rect.x+rect.w)*result.uiScale));x++){
   const i=((capture.height-1-y)*capture.width+x)*4;
   const r=capture.bytes[i],g=capture.bytes[i+1],b=capture.bytes[i+2];colors.add((r<<16)|(g<<8)|b);
   if(Math.max(r,g,b)>80)inkPixels++;
  }
 }
 assert.ok(colors.size>=16&&inkPixels>=50,`title region must contain antialiased glyph ink, not an empty/color-only frame (${colors.size} colors, ${inkPixels} ink pixels)`);
 return {...capture,sequence:seq,minimumCompletedLayouts:result.minimumCompletedLayouts,textRect:rect,textRegionColors:colors.size,textInkPixels:inkPixels,stability:{firstRaf:first.completedVendorRaf,secondRaf:capture.completedVendorRaf,firstTimestamp:first.rafTimestamp,secondTimestamp:capture.rafTimestamp,distinctDisplayTimestamps:true,sha256:first.sha256}};
}
try{
 await page.goto(host.url);
 await page.evaluate(()=>{window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.name==='lui-parity-ready'&&event.data.payload?.sequence===window.__expectedParity)window.__parity=event.data.payload;});});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已绘制'),{timeout:60000});
 report.identity=await(await fetch(host.url+'identity.json')).json();
 const common={title:'同引擎 · 状态比较',color:'#F4ECFF',disabled:false,fill:'#7851C9',hoverFill:'#946AE8'};
 const mainGradient='linear-gradient(0deg, #D64242 10%, #D6C542 90%)';
 const hoverGradient='linear-gradient(90deg, #4242D6 20%, #42C5D6 80%)';
 const samples=[['normal',{}],['disabled',{disabled:true}],['hover',{state:'hover'}],['pressed',{state:'pressed'}],
  ['alpha',{color:'#F4ECFF99'}],['gradient',{fill:mainGradient,hoverFill:hoverGradient}],
  ['gradient-hover',{fill:mainGradient,hoverFill:hoverGradient,state:'hover'}],
  ['gradient-pressed',{fill:mainGradient,hoverFill:hoverGradient,state:'pressed'}]];
 for(const [name,delta]of samples){
  const view={...common,...delta};
  const source='<页面 名称="Fixture" 宽度="390" 高度="867" 背景="#0B0714"><容器 子项排列="垂直" 内边距="18" 垂直间隔="12"><文本 文本="{绑定 view.title}" 颜色="{绑定 view.color}" 字号="24"/><按钮 文本="{绑定 view.title}" 禁用="{绑定 view.disabled}" 背景="{绑定 view.fill}" 悬停背景="{绑定 view.hoverFill}" 按下背景="#412675" 高度="44"/><文本框 文本="{绑定 view.title}" 颜色="{绑定 view.color}" 高度="40"/><文本 文本="描边通知" 字号="12" 文字描边颜色="#080410" 文字描边宽度="1"/></容器></页面>';
  const parsed=parseLui(source);assert.ok(parsed.root);assert.ok(!parsed.diagnostics.some(d=>d.severity==='error'),JSON.stringify(parsed.diagnostics));
  const serialize=(n,p=[])=>({...n,source:'Fixture.lui',nodePath:p,attrs:Object.fromEntries(n.attrs.map(a=>[a.name,a.value])),children:n.children.map((c,i)=>serialize(c,[...p,i]))});
  const [node]=buildEngineSnapshot(serialize(parsed.root),{view},{tag:n=>canonicalTag(n.tag)??n.tag,attrs:resolvePreviewAttributes,children:n=>n.children,component:()=>undefined});
  const actual=await render('source',source,{view},node);
  const preview=await render('snapshot',source,{view},node);
  let differentBytes=0,maxDifference=0;assert.equal(actual.bytes.length,preview.bytes.length);
  for(const key of ['width','height','devicePixelRatio','renderer','attributes','colorSpace'])assert.deepEqual(actual[key],preview[key],`capture environment mismatch: ${key}`);
  for(let i=0;i<actual.bytes.length;i++)if(actual.bytes[i]!==preview.bytes[i]){differentBytes++;maxDifference=Math.max(maxDifference,Math.abs(actual.bytes[i]-preview.bytes[i]));}
  await writeFile(resolve(output,name+'-source.rgba'),actual.bytes);await writeFile(resolve(output,name+'-snapshot.rgba'),preview.bytes);
  report.cases.push({name,width:actual.width,height:actual.height,dpr:actual.devicePixelRatio,renderer:actual.renderer,attributes:actual.attributes,colorSpace:actual.colorSpace,origin:'bottom-left',settledMinimumLayouts:12,capture:'next completed vendor RAF after readiness; separately sampled stable static states, not a synchronized fixed frame time',sourceSequence:actual.sequence,snapshotSequence:preview.sequence,sourceStability:actual.stability,snapshotStability:preview.stability,textRegion:{rect:actual.textRect,sourceColors:actual.textRegionColors,snapshotColors:preview.textRegionColors,sourceInkPixels:actual.textInkPixels,snapshotInkPixels:preview.textInkPixels},sourceSha256:actual.sha256,snapshotSha256:preview.sha256,differentBytes,maxDifference});
  console.log(JSON.stringify(report.cases.at(-1)));
 }
 const byName=Object.fromEntries(report.cases.map(item=>[item.name,item]));
 for(const [a,b]of [['normal','hover'],['normal','pressed'],['normal','disabled'],['gradient','gradient-hover'],['gradient','gradient-pressed']]){
  assert.notEqual(byName[a].sourceSha256,byName[b].sourceSha256,`${a}/${b} must visibly differ with the same title and data except state`);
 }
 report.stateHashDifferencesVerified=true;
 assert.equal(byName.pressed.sourceSha256,byName['gradient-pressed'].sourceSha256,'explicit solid pressed paint must fully replace either a solid or gradient main background');
 report.explicitPressedPaintReplacesMainVerified=true;
 await page.screenshot({path:resolve(output,'fixture.png')});
 report.passed=report.cases.every(c=>c.differentBytes===0)&&report.errors.length===0;
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 assert.ok(report.passed,'raw frame comparison failed; inspect report.json');
}catch(error){report.passed=false;report.errors.push(String(error?.stack||error));throw error;
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
