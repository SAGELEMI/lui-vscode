// Cold native controls and deferred overlay passes in the official engine.
// Uses the same pre-Runtime raw C observer as test-engine-native-budget.mjs.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {nativeBudgetObserver} from './lib/native-budget-observer.mjs';
import {visibleLayoutProbe,recordEngineErrors} from './lib/visible-layout-probe.mjs';
import {verifyEngineRuntime} from './lib/preview-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
assert.ok(process.argv[2],'Usage: node scripts/test-engine-native-overlays.mjs <game> [output-directory]');
const game=resolve(process.argv[2]),output=resolve(process.argv[3]||'artifacts/engine-native-overlays');
const runtimeDirectory=resolve(process.env.LUI_TEST_RUNTIME_DIR||'runtime/urhox-lua');
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const files=[];for(const family of config.fonts)for(const font of Object.values(family.weights))files.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
await mkdir(output,{recursive:true});
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),runtimeDirectory,files);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const report={passed:false,scope:'Actual cold native constructors, committed overlay passes and canvas input; a zero-call background slice verifies that already-visible overlays remain complete and interactive. The 60-frame fixture limit is a regression timeout, not a device FPS claim.',cases:[],errors:[]};
const fixture=visibleLayoutProbe+String.raw`
local UI=require('urhox-libs/UI')
local Runtime=require('LUI.Runtime')
local Parser=require('LUI.Parser')
local Budget=require('LUI.MeasureBudget')
local EditMenu=require('urhox-libs/UI/Widgets/EditMenu')
local runtime=setmetatable({isV2_=true,documents_={},code_={},config_={changeTracking='notify',componentDirectories={}}},Runtime)
runtime:EnsureFrameScheduler()
local budget=Budget.Get(runtime)
NativeProbe.Budget,NativeProbe.budget=Budget,budget
local cases={
 {name='Menu',body='<菜单 引用="Control" 项目="{绑定 view.items}" 选择="{动作 Select}"/>',method='Render',input=true},
 {name='Tooltip',body='<工具提示 引用="Control" 宽度="200" 高度="44"><按钮 引用="Trigger" 文本="提示触发器" 高度="44"/></工具提示>',method='RenderTooltip',pause=true},
 {name='Modal',body='<弹窗 引用="Control" 标题="冷弹窗" 点击遮罩关闭="否" 显示关闭按钮="否"><容器 子项排列="垂直" 高度="160"><文本 文本="独立延迟内容布局"/><按钮 引用="Action" 文本="提交冷弹窗" 高度="48" 点击="{动作 Select}"/></容器></弹窗>',method='RenderModalContent',pause=true,input=true},
 {name='Dropdown',body='<下拉框 引用="Control" 宽度="260" 项目="{绑定 view.options}"/>',method='RenderDropdownPanel'},
 {name='Popover',body='<弹出层 引用="Control" 宽度="200" 高度="44"><按钮 引用="Trigger" 文本="气泡触发器" 高度="44"/></弹出层>',method='RenderPopoverContent'},
 {name='DatePicker',body='<日期选择器 引用="Control" 宽度="240"/>',method='RenderCalendar'},
 {name='TimePicker',body='<时间选择器 引用="Control" 宽度="240"/>',method='RenderPopup'},
 {name='ColorPicker',body='<颜色选择器 引用="Control" 宽度="240"/>',method='RenderPopup'},
 {name='Drawer',body='<抽屉 引用="Control" 标题="延迟抽屉标题"/>',method='RenderDrawerContent'},
 {name='EditMenu',body='<文本框 引用="Control" 文本="冷编辑菜单" 宽度="240" 高度="48"/>',method='Render',edit=true}
}
local current,root,context,control,target,evidence,phase,phaseFrame,caseFrame
local position,index,clicks=0,0,0
local completed={}
local initialCalls=0
local function emit(value)local event=VariantMap();event['name']='native-overlay-probe';event['payload']=cjson.encode(value);SendEvent('EmitToPlugin',event)end
local function callCount()local count=0;for _,row in pairs(NativeProbe.frames)do count=count+row.calls end;return count end
local function rect(widget)
 local value=runtime:GetScreenRect(widget)
 if not value then return nil end
 for _,key in ipairs({'x','y','w','h'})do if type(value[key])~='number' or value[key]~=value[key] or math.abs(value[key])==math.huge then return nil end end
 return value.w>0 and value.h>0 and value or nil
end
local function deferredAncestor(widget)
 while widget do if widget.luiRenderDeferredFrame_~=nil then return widget end;widget=widget.parent end
end
local function committed(widget)
 assert(not deferredAncestor(widget),'visible native geometry must never be marked deferred')
 if current.input then assert(widget:HitTest(position.x,position.y)~=false,'interactive visible native geometry must remain hittable')end
end
local function tracked(widget,method)
 assert(type(widget[method])=='function','missing actual native method '..current.name..'.'..method)
 local original=widget[method]
 widget[method]=function(self,...)
  evidence.attempts=evidence.attempts+1
  local result=table.pack(original(self,...))
  if self.luiRenderDeferredFrame_~=nil then evidence.deferred=evidence.deferred+1 else evidence.completed=evidence.completed+1 end
  return table.unpack(result,1,result.n)
 end
end
local function finishCase()
 budget.limit=64
 evidence.totalFrames=caseFrame;evidence.clicks=clicks;evidence.visibleLayout=verifyVisibleLayout(runtime,root,800,844)
 completed[#completed+1]=evidence;emit({case=evidence})
 if current.edit then EditMenu.Hide()end
 if control.Close then control:Close()end
 UI.SetRoot(nil);root:Destroy();root=nil
 phase='next'
end
local function beginCase()
 index=index+1;current=cases[index]
 if not current then NativeProbe.enabled=false;emit({done=true,cases=completed,frames=NativeProbe.frames,coldConstructorCalls=initialCalls});return end
 clicks=0;phaseFrame,caseFrame=0,0;phase='cold'
 evidence={name=current.name,method=current.method,attempts=0,deferred=0,completed=0}
 local markup='<页面 名称="NativeOverlay" 宽度="800" 高度="844"><容器 子项排列="垂直" 内边距="24" 垂直间隔="16"><文本 文本="冷首屏与原生浮层" 字号="20"/>'..current.body..'</容器></页面>'
 runtime.documents_['Fixture/Overlay.lui']=assert(Parser.Parse(markup,'Fixture/Overlay.lui'))
 local view={items={{label='原生菜单长标签应完整决定自身宽度',shortcut='Ctrl+Shift+Enter',keepOpen=true}},options={{value='a',label='原生下拉第一项'},{value='b',label='第二项长文字'}}}
 local before=callCount()
 root,context=runtime:RenderMarkup('Fixture/Overlay.lui',{view=view,props={},refs={},actions={Select=function()clicks=clicks+1 end}})
 assert(root,context);control=context.refs.Control;target=context.refs.Action or control
 initialCalls=initialCalls+callCount()-before
 assert(callCount()==before,'cold '..current.name..' construction must not enter raw C measurement')
 UI.SetRoot(root,true)
 if current.name=='Tooltip' then control:SetContent(string.rep('冷提示多行文本 ',12));context.refs.Trigger:OnPointerEnter({x=40,y=100});control.delay_=.001
 elseif current.name=='Popover' then control:SetContent('冷气泡需要真实测量其多行内容');control:Open({x=24,y=80,w=200,h=44})
 elseif current.name=='EditMenu' then
  local prior=callCount()
  EditMenu.Show({owner=control,anchorX=160,anchorY=150,anchorH=48,items={{label='全选测试文字',action=function()clicks=clicks+1 end},{label='第二项',action=function()end}}})
  assert(callCount()==prior,'EditMenu.Show must defer native width measurement')
  target=assert(UI.GetTopOverlay());evidence.initiallyDeferred=target.luiRenderDeferredFrame_~=nil
  assert(not evidence.initiallyDeferred,'EditMenu visibility must not be represented by a deferred-frame marker')
 else if control.Open then control:Open()end end
 tracked(current.edit and target or control,current.method)
end
OverlayProbe={inputSent=false,stopped=false}
function HandleOverlayProbeBegin()
 if OverlayProbe.stopped then return end
 local ok,err=xpcall(function()
  if not current or phase=='next' then NativeProbe.enabled=true;beginCase();if not cases[index]then OverlayProbe.stopped=true end end
 end,debug.traceback)
 if not ok then OverlayProbe.stopped=true;NativeProbe.enabled=false;budget.limit=64;emit({error=tostring(err)})end
end
function HandleOverlayProbeEnd()
 if OverlayProbe.stopped or not current then return end
 local ok,err=xpcall(function()
  local row=NativeProbe.FinalizeFrame()
  if row then
   local background=row.calls-(row.committedStarts or 0)
   assert(background<=64 and row.outside==0 and background==row.budgetCalls
    and (row.committedStarts or 0)==(row.budgetCommittedCalls or 0),'raw C quota/guard/accounting violation')
   assert(row.depth==0,'unbalanced native save stack')
  end
  phaseFrame=phaseFrame+1;caseFrame=caseFrame+1
  assert(phaseFrame<=60,current.name..' '..phase..' did not converge within 60 real frames')
  local box=rect(target)
  if phase=='cold' and box and evidence.completed>0 and not deferredAncestor(target) then
   if current.name=='Tooltip' and control.opacity_<1 then return end
   if current.name=='Modal' and control.animProgress_<1 then return end
   if current.name=='Menu' then
    local measured,width=Budget.Guard(budget,function()return UI.MeasureTextWidth(context.view.items[1].label,control.fontSize_,control.props.fontFamily)+UI.MeasureTextWidth(context.view.items[1].shortcut,control.fontSize_*.85,control.props.fontFamily)end,control)
    if not measured then return end
    evidence.textAndShortcutWidth=width;evidence.intrinsicWidth=control.props.width
    assert(control.props.width>=width and box.w>=width,'menu kept constructor placeholder width and clips its long label/shortcut')
   end
   evidence.firstReadyFrame=caseFrame;evidence.rect=box;position={x=box.x+box.w/2,y=box.y+box.h/2}
   if current.pause then
    phase,phaseFrame='forced-committed',0;budget.limit=0
    if current.name=='Tooltip' then control:SetContent(string.rep('未缓存的新提示 ',13))else target:SetText('未缓存的提交按钮')end
   elseif current.input then phase,phaseFrame='ready-input',0;OverlayProbe.inputSent=false;emit({input='ready',name=current.name,point=position})
   else finishCase()end
  elseif phase=='forced-committed' and box then
   committed(target);evidence.committedAfterQuota=true;budget.limit=64
   if current.input then phase,phaseFrame='ready-input',0;OverlayProbe.inputSent=false;position={x=box.x+box.w/2,y=box.y+box.h/2};emit({input='ready',name=current.name,point=position})else finishCase()end
  elseif phase=='ready-input' and OverlayProbe.inputSent then
   assert(clicks==1,'ready native canvas click must dispatch exactly once');finishCase()
  end
  -- Diagnostic width comparisons above are guarded C calls in this same frame.
  NativeProbe.FinalizeFrame()
 end,debug.traceback)
 if not ok then OverlayProbe.stopped=true;NativeProbe.enabled=false;budget.limit=64;emit({error=tostring(err),name=current.name,phase=phase,evidence=evidence,frames=NativeProbe.frames})end
end
-- Preserve Runtime's original event subscriptions.
local previousBegin=runtime.BeginFrame
function runtime:BeginFrame(token)
 return previousBegin(self,token)
end
local Queue=require('LUI.MeasureQueue')
local previousDrain=Queue.Drain
Queue.Drain=function(...)
 local result=table.pack(previousDrain(...))
 if not current or phase=='next' then HandleOverlayProbeBegin()else HandleOverlayProbeEnd()end
 NativeProbe.FinalizeFrame()
 return table.unpack(result,1,result.n)
end
`;
try {
 const page=await browser.newPage({viewport:{width:1100,height:1100},deviceScaleFactor:1});
 page.on('pageerror',error=>report.errors.push(error.message));recordEngineErrors(page,report);
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).origin!==new URL(host.url).origin)return route.abort();
  if(route.request().url().endsWith('/bootstrap.lua')){
   const response=await route.fetch(),source=await response.text(),seam="local Runtime=require('LUI.Runtime')";
   assert.ok(source.includes(seam));return route.fulfill({response,body:source.replace(seam,nativeBudgetObserver+'\n'+seam)});
  }
  return route.continue();
 });
 await page.addInitScript(()=>{window.__overlayProbe=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.name==='native-overlay-probe')window.__overlayProbe.push(event.data.payload);});});
 host.update({revision:Date.now(),width:800,height:844,theme:config.theme,fonts,node:{kind:'Element',tag:'lui:Page',attrs:{Width:'800',Height:'844'},children:[],sourcePath:'OverlayProbe.lui',nodePath:'0'}});
 await page.goto(host.url);await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('已绘制'),{timeout:60000});
 await page.getByRole('button',{name:'节点选择：开'}).click();
 report.identity=await(await fetch(host.url+'identity.json')).json();report.runtime=await verifyEngineRuntime(report.identity,runtimeDirectory);
 await writeFile(resolve(output,'fixture.lua'),fixture);await writeFile(resolve(output,'observer.lua'),nativeBudgetObserver);
 const runLua=source=>page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),source);
 await runLua(fixture);
 let cursor=0;
 for(;;){
  await page.waitForFunction(cursor=>window.__overlayProbe.length>cursor,cursor,{timeout:15000});
  const message=await page.evaluate(cursor=>window.__overlayProbe[cursor],cursor++);
  assert.ok(!message.error,JSON.stringify(message));
  if(message.case){report.cases.push(message.case);console.log(JSON.stringify(message.case));await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
  if(message.input){
   const frame=page.frames().find(frame=>frame.url().includes('engine-frame.html'));assert.ok(frame);
   await frame.locator('canvas').click({position:message.point});
   await runLua('OverlayProbe.inputSent=true');
  }
  if(message.done){
   report.frames=message.frames;report.coldConstructorCalls=message.coldConstructorCalls;
   assert.equal(report.cases.length,10);assert.equal(message.coldConstructorCalls,0);
   const frames=Object.values(message.frames);assert.ok(frames.length>=10);
   assert.ok(frames.every(frame=>frame.calls-(frame.committedStarts||0)<=64&&frame.outside===0
    &&frame.calls-(frame.committedStarts||0)===frame.budgetCalls
    &&(frame.committedStarts||0)===(frame.budgetCommittedCalls||0)&&frame.depth===0&&frame.rejectedStartChecks===0));
   report.maximumCalls=Math.max(...frames.map(frame=>frame.calls));break;
  }
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,cases:report.cases.length,maximumCalls:report.maximumCalls,runtime:report.runtime}));
} catch(error) {
 report.errors.push(error.stack||String(error));throw error;
} finally {
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();
}
