// Official renderer/input path + the game's virtual list, isolated from saves.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const game=resolve(process.argv[2]);
const output=resolve(process.argv[3]||'artifacts/engine-scroll-performance');await mkdir(output,{recursive:true});
const adapter=resolve('runtime/urhox-lua'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
assert.equal(config.runtimeManifestHash,sha(await readFile(resolve(adapter,'runtime-manifest.json'))));
const resources={},files=[];
const markup=await readFile(resolve(game,'scripts/Presentation/Components/SelectionList.lui'),'utf8');
const code=await readFile(resolve(game,'scripts/Presentation/Components/SelectionList.lui.lua'),'utf8');
for(const f of config.fonts)for(const font of Object.values(f.weights))files.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),adapter,files);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const report={scope:'current sealed official renderer and production SelectionList; 100/1000/10000 rows, real canvas touch/mouse input; no App, saves, OPFS or business requests',runtimeManifestHash:config.runtimeManifestHash,harnessSha256:sha(await readFile(new URL(import.meta.url))),
 limitations:['DPR and screen-to-layout scale are actual engine observations. Display refresh is the available browser cadence; 30/120 Hz input integration is separately covered by the deterministic source test, not claimed as physical display testing.',
 '10000-row acceptance covers bounded visible widgets and navigating to the last row and back. Full background measurement of all 10000 rows is not awaited.',
 'The 1000-row case waits for complete background measurement, then runs 200 production Button callbacks one per actual frame and 300 steady frames. These are work-count/correctness checks, not CPU or phone FPS estimates.'],results:[],errors:[]};
const long=text=>'[====['+text+']====]';
try{
 for(const [width,height,dpr,rowCount]of [[390,844,1,100],[358,425,2,1000],[390,844,3,10000]]){
  const page=await browser.newPage({viewport:{width:800,height:1100},deviceScaleFactor:dpr,hasTouch:true});
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).origin!==new URL(host.url).origin)return route.abort();
   if(route.request().url().endsWith('/runtime.json')){const response=await route.fetch();return route.fulfill({response,json:{...await response.json(),...resources}});}
   if(route.request().url().endsWith('/bootstrap.lua')){const response=await route.fetch();const source=await response.text(),seam="local Runtime=require('LUI.Runtime')";assert.ok(source.includes(seam));return route.fulfill({response,body:source.replace(seam,`FixtureRawC=0;for _,name in ipairs({'nvgTextBounds','nvgTextBoxBounds','nvgTextMetrics'})do local original=assert(_G[name]);_G[name]=function(...)FixtureRawC=FixtureRawC+1;return original(...)end end\n`+seam)});}
   return route.continue();
  });
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__scrollResult=null;window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.name==='scroll-test-ready')window.__scrollResult=e.data.payload;});});
  host.update({revision:Date.now(),width,height,theme:config.theme,fonts,node:{kind:'Element',tag:'lui:Page',attrs:{Width:'390',Height:'844'},children:[],sourcePath:'Fixture.lui',nodePath:''}});
  await page.goto(host.url);await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已绘制'),undefined,{timeout:60000});
  await page.getByRole('button',{name:'节点选择：开'}).click();
  const run=async(source,frames=8,perFrame='')=>{
   await page.evaluate(()=>{window.__scrollResult=null;});
   const lua=`local ok,err=xpcall(function()
${source}
local frames=0;local cancel
cancel=FixtureRuntime:AfterLayout(FixtureRoot,function()
 frames=frames+1
 local ok,result=xpcall(function()
  ${perFrame}
  if frames<${frames} then return nil end;cancel()
  local s=FixtureList.scroll_;local rect=FixtureRuntime:GetScreenRect(s)
  local first,last=FixtureList.model_:Window(select(2,s:GetScroll()),s:GetLayout().h)
  local maxIndex=0;for _,slot in ipairs(FixtureList.pool_)do maxIndex=math.max(maxIndex,slot.index or 0)end
  return {y=select(2,s:GetScroll()),rect=rect,layout=s:GetLayout(),hit=s:GetAbsoluteLayoutForHitTest(),thumb=s.vScrollbarBounds_,track=s.vTrackBounds_,velocity=s.state.velocityY,dragging=s.state.isDragging,barDragging=s.isDraggingScrollbarV_,slots=#FixtureList.pool_,selected=FixtureState.selectedKey or '',clicks=FixtureClicks,parses=require('LUI.Runtime').stats.bindingParses,paths=require('LUI.Paths').stats.parses,background=require('LUI.MeasureBudget').Get(FixtureRuntime).calls,cursor=FixtureList.model_.cursor_,inputLog=FixtureInputLog,created=FixtureCreated,rawC=FixtureRawC,renderPending=FixtureList.renderPending_ or false,first=first,last=last,maximumAssignedIndex=maxIndex}
 end,debug.traceback)
 if ok and result==nil then return end
 if not ok then cancel()end
 local out=VariantMap();out['name']='scroll-test-ready';out['payload']=cjson.encode(ok and result or {error=tostring(result)});SendEvent('EmitToPlugin',out)
end)
end,debug.traceback)
if not ok then local out=VariantMap();out['name']='scroll-test-ready';out['payload']=cjson.encode({error=tostring(err)});SendEvent('EmitToPlugin',out)end`;
   await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),lua);
   await page.waitForFunction(()=>window.__scrollResult,undefined,{timeout:30000});
   const result=await page.evaluate(()=>window.__scrollResult);report.current={width,height,dpr,rowCount,result};assert.ok(!result.error,result.error);return result;
  };
  const start=await run(`local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime');local Parser=require('LUI.Parser')
FixtureRuntime=setmetatable({isV2_=true,documents_={},code_={},config_={changeTracking='notify',sourceRoots={'Fixture'},componentDirectories={['Fixture']={List='Fixture/List.lui'}}}},Runtime)
FixtureCreated=0;local build=FixtureRuntime.BuildNode;function FixtureRuntime:BuildNode(...)FixtureCreated=FixtureCreated+1;return build(self,...)end
FixtureRuntime.documents_['Fixture/List.lui']=assert(Parser.Parse(${long(markup)},'Fixture/List.lui'))
FixtureRuntime.code_['Fixture/List.lui.lua']=assert(load(${long(code)},'@Fixture/List.lui.lua'))()
FixtureState={};FixtureClicks=0;FixtureInputLog={};local I=require('urhox-libs/UI/Core/Input')
for _,kind in ipairs({'PointerUp','PointerCancel'})do I.On(kind,function(e)FixtureInputLog[#FixtureInputLog+1]={type=e.type,pointer=e.pointerId}end,100)end
local rows={}
for i=1,${rowCount} do rows[i]={key='row:'..i,label='物品 '..i,description=i%5==0 and string.rep('长说明测试',15) or '物品说明'}end
local node=assert(Parser.Parse([[<页面 名称="ScrollFixture" 宽度="390" 高度="844" 内边距="25" 目录:x="Fixture"><容器 子项排列="垂直"><x:List 引用="List" 宽度="340" 高度="720" 标题="滑动测试" 项目="{绑定 view.rows}" 状态="{绑定 view.state}" 选择="{动作 Choose}"/></容器></页面>]],'Fixture/Page.lui'))
local ctx={view={rows=rows,state=FixtureState},refs={},actions={Choose=function()FixtureClicks=FixtureClicks+1 end}}
FixtureRuntime.documents_['Fixture/Page.lui']=node
local context;FixtureRoot,context=FixtureRuntime:RenderMarkup('Fixture/Page.lui',ctx);assert(FixtureRoot,context);UI.SetRoot(FixtureRoot,true)
FixtureOwner=context.refs.List.luiComponentHost_.luiComponentInstance_;FixtureList=FixtureOwner.list_`,60);
  assert.ok(start.slots>0 && start.slots<=Math.ceil(start.layout.h/36)+7,'pool follows viewport and authored row minimum');
  const frame=page.frames().find(f=>f.url().includes('engine-frame.html'));
  const canvas=await frame.locator('canvas').boundingBox();
  const point=(x,y)=>({x:canvas.x+x*canvas.width/width,y:canvas.y+y*canvas.height/height});
  const p=point(start.rect.x+start.rect.w/2,start.rect.y+start.rect.h*.7);
  const q=point(start.rect.x+start.rect.w/2,start.rect.y+start.rect.h*.35);
  await page.mouse.move(p.x,p.y);await page.mouse.down();await run('',2);
  await page.mouse.move(q.x,q.y,{steps:12});await run('',2);await page.mouse.up();
  const mouseBefore=await run('',5);assert.ok(mouseBefore.y>30,'mouse before touch: '+JSON.stringify(mouseBefore));assert.equal(mouseBefore.clicks,0);
  await run('FixtureList.scroll_.state.velocityY=0;FixtureList.scroll_:SetScrollDirect(0,0)',3);
  const session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
  for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+(q.y-p.y)*i/12,id:1}]});
  const touching=await run('',2);
  assert.ok(touching.y>30,`touch must scroll real content: ${JSON.stringify(touching)}`);
  assert.equal(touching.clicks,0,'drag cancels the pressed row');
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after=await run('',12);assert.equal(after.dragging,false);assert.equal(after.barDragging,false);
  assert.ok(after.y>touching.y+1,'release keeps time-based momentum in the real input pipeline');
  await run('FixtureList.scroll_.state.velocityY=0;FixtureList.scroll_:SetScrollDirect(0,500)',3);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
  for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+(q.y-p.y)*i/12,id:1}]});
  const anchored=await run('FixtureList:ScrollTo(select(2,FixtureList.scroll_:GetScroll())+212.25)',2);
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...q,id:1}]});
  const moved=await run('',2);assert.ok(moved.y>anchored.y,'height anchor correction must not reverse the next real drag');
  await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const hostCanceled=await run('',4);
  assert.equal(hostCanceled.dragging,false);assert.equal(hostCanceled.barDragging,false);
  // This engine's browser bridge maps CDP touchCancel to ordinary PointerUp.
  // Record that limitation, and separately exercise its public cancel pipeline.
  assert.equal(hostCanceled.inputLog.at(-1).type,'PointerUp');
  await run('FixtureList.scroll_.state.velocityY=0;FixtureList.scroll_:SetScrollDirect(0,500)',3);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
  for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+(q.y-p.y)*i/12,id:1}]});
  const cancelMoving=await run('',2);
  const canceled=await run("require('urhox-libs/UI').HandleTouchCancel(input:GetTouch(0).touchID)",4);
  assert.equal(canceled.dragging,false);assert.equal(canceled.barDragging,false);assert.equal(canceled.velocity,0);
  assert.ok(Math.abs(canceled.y-cancelMoving.y)<.1,'native cancel ends motion without phantom momentum');
  assert.equal(canceled.inputLog.at(-1).type,'PointerCancel');
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const barStart=await run('FixtureList.scroll_.state.velocityY=0;FixtureList.scroll_:SetScrollDirect(0,0)',3);
  const barPoint=point(barStart.rect.x+(barStart.thumb.x-barStart.hit.x+barStart.thumb.w/2)*barStart.rect.w/barStart.layout.w,
    barStart.rect.y+(barStart.thumb.y-barStart.hit.y+barStart.thumb.h/2)*barStart.rect.h/barStart.layout.h);
  const travel=(barStart.track.h-barStart.thumb.h)*barStart.rect.h/barStart.layout.h;
  const barEnd=point(barStart.rect.x+(barStart.thumb.x-barStart.hit.x+barStart.thumb.w/2)*barStart.rect.w/barStart.layout.w,
    barStart.rect.y+(barStart.thumb.y-barStart.hit.y+barStart.thumb.h/2)*barStart.rect.h/barStart.layout.h+travel*.4);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...barPoint,id:1}]});
  for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:barPoint.x,y:barPoint.y+(barEnd.y-barPoint.y)*i/12,id:1}]});
  const barMoving=await run('',2);assert.ok(barMoving.barDragging&&barMoving.y>1000,'touch thumb is captured independently from content pan');
  await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const barCanceled=await run('',4);assert.equal(barCanceled.barDragging,false);assert.equal(barCanceled.dragging,false);assert.equal(barCanceled.velocity,0);
  const mouse=mouseBefore;
  await run('FixtureList.scroll_.state.velocityY=0',3);
  const warm=await run('',10);const still=await run('',15);
  assert.equal(still.parses,warm.parses,'stable frames do not parse bindings');assert.equal(still.paths,warm.paths);
  const tail=await run('FixtureList.scroll_.state.velocityY=0;FixtureList:ScrollTo(FixtureList.model_:Clamp(math.huge))',90);
  assert.equal(tail.maximumAssignedIndex,rowCount,'jump to tail must bind the actual final item');
  assert.ok(tail.slots<=Math.ceil(tail.layout.h/36)+7,'tail pool remains bounded by viewport');
  const returned=await run('FixtureList:ScrollTo(0)',90);
  assert.ok(returned.y<1&&returned.first===1,'jump back restores the first visible window');
  let selection,steady;
  if(rowCount===1000){
   let settled=returned;for(let i=0;i<12&&settled.cursor<=rowCount;i++)settled=await run('',60);
   assert.ok(settled.cursor>rowCount&&!settled.renderPending,'1000-row background measurement must settle before identity/idle checks');
   await run('FixtureList:SetSelectedKey(nil);FixtureList.scroll_.state.velocityY=0;FixtureList:ScrollTo(500)',12);
   const beforeSelection=await run(`FixtureIdentity={root=FixtureRoot,owner=FixtureOwner,scroll=FixtureList.scroll_,model=FixtureList.model_,pool=FixtureList.pool_,widgets={},y=select(2,FixtureList.scroll_:GetScroll())}
for i,slot in ipairs(FixtureList.pool_)do FixtureIdentity.widgets[i]=slot.widget end
local function button(widget)if widget.props and widget.props.onClick then return widget end;for _,child in ipairs(widget:GetChildren())do local found=button(child);if found then return found end end end
FixtureSelectButtons={};for _,slot in ipairs(FixtureList.pool_)do if slot.index then FixtureSelectButtons[#FixtureSelectButtons+1]=assert(button(slot.widget));if #FixtureSelectButtons==2 then break end end end
assert(#FixtureSelectButtons==2);FixtureSelectionStart=FixtureClicks`,2);
   const afterSelection=await run('',200,`local button=FixtureSelectButtons[(frames-1)%2+1];button.props.onClick(button,{})
assert(FixtureClicks==FixtureSelectionStart+frames,'production row callback must select the current item exactly once')
assert(FixtureRoot==FixtureIdentity.root and FixtureOwner==FixtureIdentity.owner and FixtureList.scroll_==FixtureIdentity.scroll and FixtureList.model_==FixtureIdentity.model and FixtureList.pool_==FixtureIdentity.pool,'selection changed root/component/list identity')
assert(math.abs(select(2,FixtureList.scroll_:GetScroll())-FixtureIdentity.y)<.01,'selection moved scroll position')
for i,widget in ipairs(FixtureIdentity.widgets)do assert(FixtureList.pool_[i].widget==widget,'selection recreated a pooled row widget')end`);
   assert.equal(afterSelection.created,beforeSelection.created,'200 selections must not build widgets');
   assert.equal(afterSelection.rawC,beforeSelection.rawC,'selection colors must not remeasure native text');
   selection={count:200,dispatch:'production row Button.onClick callback, one per actual rendered frame; native pointer correctness is exercised separately above',before:beforeSelection,after:afterSelection};
   const beforeIdle=await run('',5),afterIdle=await run('',300);
   for(const field of ['created','rawC','parses','paths'])assert.equal(afterIdle[field],beforeIdle[field],'300 settled visible frames must not change '+field);
   steady={frames:300,before:beforeIdle,after:afterIdle};
  }
  report.results.push({width,height,dpr,rowCount,observedScreenToLayoutScale:start.rect.w/start.layout.w,start,touching,after,anchored,moved,hostCanceled,canceled,barMoving,barCanceled,mouse,stable:still,tail,returned,selection,steady});
  console.log(JSON.stringify({width,height,dpr,rowCount,touchY:touching.y,mouseY:mouse.y,slots:still.slots,tailIndex:tail.maximumAssignedIndex,selectionCount:selection?.count,steadyFrames:steady?.frames}));
  await session.detach();
  await page.close();
 }
 report.identity=await(await fetch(host.url+'identity.json')).json();report.verifiedLuaFiles=0;
 for(const [path,hash]of Object.entries(report.identity.runtimeFiles).filter(([path])=>/^LUI\/[\w-]+\.lua$/.test(path))){assert.equal(sha(await readFile(resolve(game,'scripts',path))),hash);assert.equal(sha(await readFile(resolve(adapter,path.slice(4)))),hash);report.verifiedLuaFiles++;}
 assert.deepEqual(report.errors,[]);report.status='passed';
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
