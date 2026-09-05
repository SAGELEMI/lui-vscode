// Strict structural parity fixtures on the same official GL context.
// Keeps the scalar eight-pair harness unchanged; never loads game code/storage.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const {parseLui}=require('../dist/spec.cjs');
const {buildEngineSnapshot,resolvePreviewAttributes,canonicalTag}=require('../dist/previewSnapshot.cjs');
const game=resolve(process.argv[2]);
const output=resolve('artifacts/engine-parity-components-20260906');await mkdir(output,{recursive:true});
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
const report={scope:'isolated static imported components, caller wrapper, caller slot scope, repeated instance refs, false/nil/single-pass initial data; no game state, animation timing or VS Code interaction',passed:false,cases:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
const long=value=>'[====['+value+']====]';
async function runLua(source){
 await page.evaluate(source=>{const frame=document.querySelector('iframe');frame.contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin);},source);
}
async function render(kind,sample,node){
 const {source,data}=sample;
 const seq=report.cases.length+'-'+kind;
 await page.evaluate(sequence=>{window.__parity=null;window.__expectedParity=sequence;},seq);
 await runLua(`local ok,err=xpcall(function()
 local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime')
 local Parser=require('LUI.Parser')
 local runtime=setmetatable({config_={sourceRoots={'Fixture'},componentDirectories={['Fixture/Components']={['卡片']='Fixture/Components/Card.lui',['插槽卡']='Fixture/Components/SlotCard.lui'}}},documents_={},code_={},isV2_=true},Runtime)
 local documents=cjson.decode(${long(JSON.stringify({['Fixture/Page.lui']:source,...componentSources}))})
 for path,markup in pairs(documents) do runtime.documents_[path]=assert(Parser.Parse(markup,path)) end
 local schema=cjson.decode(${long(JSON.stringify(properties))})
 local instanceContexts={}
 local componentCode={Properties=schema}
 function componentCode.New(parent,activeRuntime,descriptor,props,slots)
  local declaration={view=parent.view,props=props,slots=slots,refs={},actions={}}
  local root,scope=activeRuntime:RenderMarkup(descriptor.markup,declaration,parent)
  assert(root,scope);instanceContexts[#instanceContexts+1]=scope
  return {GetRoot=function() return root end,Dispose=function() end}
 end
 runtime.code_['Fixture/Components/Card.lui.lua']=componentCode
 runtime.code_['Fixture/Components/SlotCard.lui.lua']=componentCode
 local title;local textWidgets,componentRoots={},{};local build=runtime.BuildNode
 function runtime:BuildNode(n,c)
  local w=build(self,n,c)
  if w and not w.__luiList and n.tag=='Text' then textWidgets[#textWidgets+1]=w;if not title then title=w end end
  if w and n.tag=='lui:Component' then componentRoots[#componentRoots+1]=w end
  return w
 end
 local context=cjson.decode(${long(JSON.stringify(data))});context.refs={};context.actions={}
 local content
 if '${kind}'=='source' then content=assert(runtime:RenderMarkup('Fixture/Page.lui',context))
 else content=runtime:BuildNode(cjson.decode(${long(JSON.stringify(node))}),context) end
 local previous=UI.GetRoot();local candidate=UI.Panel{width='100%',height='100%',children={content}}
 UI.SetRoot(candidate);if previous then previous:Destroy() end
 local frames=0;local cancel
 cancel=runtime:AfterLayout(candidate,function()
  frames=frames+1;if frames<12 then return end;cancel()
  local texts,components={},{}
  for _,w in ipairs(textWidgets) do
   local visible=true;local parent=w
   while parent do if parent.props.visible==false or parent.props.visibility=='hidden' then visible=false end;parent=parent.parent end
   if visible then texts[#texts+1]=tostring(w.props.text or '') end
  end
  for _,w in ipairs(componentRoots) do components[#components+1]={inner=runtime:GetScreenRect(w),wrapper=runtime:GetScreenRect(w.luiComponentHost_ or w.parent)} end
  local refsIsolated=true;local seen={}
  for _,scope in ipairs(instanceContexts) do for name,w in pairs(scope.refs) do if seen[w] then refsIsolated=false end;seen[w]=true end end
  local out=VariantMap();out['name']='lui-parity-ready';out['payload']=cjson.encode({sequence='${seq}',minimumCompletedLayouts=frames,text=title and title.props.text,textRect=title and runtime:GetScreenRect(title),uiScale=UI.GetScale(),texts=texts,components=components,instanceCount=#instanceContexts,refsIsolated=refsIsolated})
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
 return {...capture,texts:result.texts,components:result.components,instanceCount:result.instanceCount,refsIsolated:result.refsIsolated,sequence:seq,minimumCompletedLayouts:result.minimumCompletedLayouts,textRect:rect,textRegionColors:colors.size,textInkPixels:inkPixels,stability:{firstRaf:first.completedVendorRaf,secondRaf:capture.completedVendorRaf,firstTimestamp:first.rafTimestamp,secondTimestamp:capture.rafTimestamp,distinctDisplayTimestamps:true,sha256:first.sha256}};
}

const properties={
 '标题':{type:'string',default:'组件默认标题'},
 '底色':{type:'string',default:'#302144'},
 '启用':{type:'boolean',default:true}
};
const componentSources={
 'Fixture/Components/Card.lui':'<控件 名称="Card" 宽度="132" 高度="92" 背景="{绑定 props[\'底色\']}"><容器 子项排列="垂直" 内边距="6" 垂直间隔="6"><文本 引用="Caption" 文本="{绑定 props[\'标题\']}" 字号="16"/><文本 引用="State" 文本="{绑定 props[\'启用\']}" 字号="14"/></容器></控件>',
 'Fixture/Components/SlotCard.lui':'<控件 名称="SlotCard" 宽度="240" 高度="110" 背景="{绑定 props[\'底色\']}"><容器 子项排列="垂直" 内边距="6" 垂直间隔="6"><文本 引用="Caption" 文本="{绑定 props[\'标题\']}" 字号="16"/><内容呈现器/></容器></控件>'
};
const title='同引擎 · 组件与作用域';
const document=body=>'<页面 名称="Fixture" 宽度="390" 高度="867" 背景="#0B0714" 目录:积木="Fixture/Components"><容器 子项排列="垂直" 内边距="18" 垂直间隔="12"><文本 引用="PageTitle" 文本="{绑定 view.title}" 颜色="#F4ECFF" 字号="24"/>'+body+'</容器></页面>';
const samples=[
 {name:'component-wrapper',body:'<积木:卡片 标题="{绑定 view.caption}" 底色="#37547C" 宽度="300" 高度="140" 内边距="12" 外边距="4"/>',data:{view:{title,caption:'组件内部'}},expectedTexts:[title,'组件内部','true']},
 {name:'caller-slot-scope',body:'<积木:插槽卡 标题="组件内部标题" 宽度="300" 高度="140" 内边距="8"><文本 引用="SlotCaption" 文本="{绑定 props[\'标题\']}" 字号="16" 颜色="#FFC66E"/></积木:插槽卡>',data:{view:{title},props:{'标题':'调用方插槽标题'}},expectedTexts:[title,'组件内部标题','调用方插槽标题']},
 {name:'repeated-instance-isolation',body:'<重复项 项目="row" 集合="{绑定 view.rows}"><积木:卡片 标题="{绑定 row.caption}" 底色="{绑定 row.color}" 宽度="280" 高度="110"/></重复项>',data:{view:{title,rows:[{caption:'独立实例甲',color:'#37547C'},{caption:'独立实例乙',color:'#743F57'}]}},expectedTexts:[title,'独立实例甲','true','独立实例乙','true']},
 {name:'false-data',body:'<积木:卡片 标题="布尔 false" 启用="{绑定 view.enabled}" 宽度="280" 高度="110"/>',data:{view:{title,enabled:false}},expectedTexts:[title,'布尔 false','false']},
 {name:'nil-default-data',body:'<积木:卡片 标题="{绑定 view.missing}" 启用="{绑定 view.missingEnabled}" 宽度="280" 高度="110"/>',data:{view:{title}},expectedTexts:[title,'组件默认标题','true']},
 {name:'single-pass-initial-data',body:'<积木:卡片 标题="{绑定 view.once, 模式=单次}" 启用="{绑定 view.enabled, 模式=单次}" 宽度="280" 高度="110"/>',data:{view:{title,once:'单次绑定初始值',enabled:false}},expectedTexts:[title,'单次绑定初始值','false']}
].map(sample=>({...sample,source:document(sample.body)}));
function serialized(source,path){
 const parsed=parseLui(source);assert.ok(parsed.root);assert.ok(!parsed.diagnostics.some(d=>d.severity==='error'),JSON.stringify(parsed.diagnostics));
 const visit=(n,p=[])=>({...n,source:path,nodePath:p,attrs:Object.fromEntries(n.attrs.map(a=>[a.name,a.value])),children:n.children.map((c,i)=>visit(c,[...p,i]))});
 return visit(parsed.root);
}
const templates=Object.fromEntries(Object.entries(componentSources).map(([path,source])=>[path,{...serialized(source,path),properties}]));
try{
 await page.goto(host.url);
 await page.evaluate(()=>{window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.name==='lui-parity-ready'&&event.data.payload?.sequence===window.__expectedParity)window.__parity=event.data.payload;});});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已绘制'),{timeout:60000});
 report.identity=await(await fetch(host.url+'identity.json')).json();
 for(const sample of samples){
  const {name,source,data}=sample;
  await writeFile(resolve(output,name+'.lui'),source);
  await writeFile(resolve(output,name+'-data.json'),JSON.stringify(data,null,2));
  const [node]=buildEngineSnapshot(serialized(source,'Fixture/Page.lui'),data,{tag:n=>canonicalTag(n.tag)??n.tag,attrs:resolvePreviewAttributes,children:n=>n.children,component:n=>templates[n.tag==='积木:卡片'?'Fixture/Components/Card.lui':'Fixture/Components/SlotCard.lui']});
  await writeFile(resolve(output,name+'-snapshot.json'),JSON.stringify(node,null,2));
  try{
   const actual=await render('source',sample,node);
   const frame=page.frames().find(f=>f.url().includes('engine-frame.html'));
   await frame.locator('canvas').screenshot({path:resolve(output,name+'-source.png')});
   const preview=await render('snapshot',sample,node);
   await frame.locator('canvas').screenshot({path:resolve(output,name+'-snapshot.png')});
   let differentBytes=0,maxDifference=0;assert.equal(actual.bytes.length,preview.bytes.length);
   for(const key of ['width','height','devicePixelRatio','renderer','attributes','colorSpace'])assert.deepEqual(actual[key],preview[key],`capture environment mismatch: ${key}`);
   for(let i=0;i<actual.bytes.length;i++)if(actual.bytes[i]!==preview.bytes[i]){differentBytes++;maxDifference=Math.max(maxDifference,Math.abs(actual.bytes[i]-preview.bytes[i]));}
   await writeFile(resolve(output,name+'-source.rgba'),actual.bytes);await writeFile(resolve(output,name+'-snapshot.rgba'),preview.bytes);
   const sourceSemantics=JSON.stringify(actual.texts)===JSON.stringify(sample.expectedTexts);
   const snapshotSemantics=JSON.stringify(preview.texts)===JSON.stringify(sample.expectedTexts);
   const expectedInstances=name==='repeated-instance-isolation'?2:1;
   const isolation=actual.instanceCount===expectedInstances&&actual.refsIsolated;
   const geometry=isDeepStrictEqual(actual.components,preview.components);
   report.cases.push({name,width:actual.width,height:actual.height,dpr:actual.devicePixelRatio,renderer:actual.renderer,attributes:actual.attributes,colorSpace:actual.colorSpace,origin:'bottom-left',settledMinimumLayouts:12,capture:'next completed vendor RAF after readiness; separately sampled stable static states, not synchronized animation time',sourceSequence:actual.sequence,snapshotSequence:preview.sequence,sourceStability:actual.stability,snapshotStability:preview.stability,textRegion:{rect:actual.textRect,sourceColors:actual.textRegionColors,snapshotColors:preview.textRegionColors,sourceInkPixels:actual.textInkPixels,snapshotInkPixels:preview.textInkPixels},expectedTexts:sample.expectedTexts,sourceTexts:actual.texts,snapshotTexts:preview.texts,sourceSemantics,snapshotSemantics,sourceComponents:actual.components,snapshotComponents:preview.components,componentGeometryEqual:geometry,sourceInstanceCount:actual.instanceCount,instanceRefsIsolated:isolation,sourceSha256:actual.sha256,snapshotSha256:preview.sha256,differentBytes,maxDifference,passed:differentBytes===0&&maxDifference===0&&sourceSemantics&&snapshotSemantics&&isolation&&geometry});
  }catch(error){report.cases.push({name,passed:false,error:String(error?.stack||error)});}
  console.log(JSON.stringify(report.cases.at(-1)));
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 }
 await page.screenshot({path:resolve(output,'fixture.png')});
 report.passed=report.cases.length===samples.length&&report.cases.every(c=>c.passed)&&report.errors.length===0;
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 assert.ok(report.passed,'raw frame comparison failed; inspect report.json');
}catch(error){report.passed=false;report.errors.push(String(error?.stack||error));throw error;
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
