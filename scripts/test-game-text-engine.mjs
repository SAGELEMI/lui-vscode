// Isolated production App/Presentation flow in official UrhoX. All game save
// reads/writes use the explicit in-memory slot adapter below; OPFS is disabled.
import {createRequire} from 'node:module';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const game=resolve(process.argv[2]);
const width=Number(process.argv[3]||390),height=Number(process.argv[4]||844);
assert.ok(Number.isInteger(width)&&width>=320&&width<=1920&&Number.isInteger(height)&&height>=320&&height<=1920,'fixture viewport requires integer dimensions in 320..1920');
const output=resolve(`artifacts/game-text-engine-20260906/${width}x${height}-dpr${process.env.PROBE_DPR||1}`);await mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
const projection={},identities={};
async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
 const path=resolve(directory,entry.name),key=relative(resolve(game,'scripts'),path).replaceAll('\\','/');
 if(entry.isDirectory()){if(key==='Tests'||key==='LUI')continue;await collect(path);}
 else if(/\.(lua|lui|json)$/.test(entry.name)&&key!=='Save/LocalSlotStorage.lua'){
  const bytes=await readFile(path);projection[key]=bytes.toString('base64');identities[key]=hash(bytes);
 }
}}
await collect(resolve(game,'scripts'));
for(const name of (await readdir(resolve(game,'scripts/LUI'))).filter(n=>n.endsWith('.lua')||n==='lui.project.json'||n==='runtime-manifest.json')){
 const bytes=await readFile(resolve(game,'scripts/LUI',name));projection['LUI/'+name]=bytes.toString('base64');identities['LUI/'+name]=hash(bytes);
}
const storage=`local slots={};FixtureStorage={reads=0,writes=0,paths={}}
local M={}
function M.Exists(path) return slots[path]~=nil end
function M.Read(path) assert(path=='saves/save_a.json' or path=='saves/save_b.json');FixtureStorage.reads=FixtureStorage.reads+1;return slots[path],slots[path] and nil or 'missing' end
function M.Write(path,text) assert(path=='saves/save_a.json' or path=='saves/save_b.json');assert(type(text)=='string');FixtureStorage.writes=FixtureStorage.writes+1;FixtureStorage.paths[path]=true;slots[path]=text;return true,nil end
return M`;
projection['Save/LocalSlotStorage.lua']=Buffer.from(storage).toString('base64');
const fonts=[];for(const family of config.fonts)for(const font of Object.values(family.weights))fonts.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
const fontConfig=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),resolve('packages/runtime-urhox-lua/adapter'),fonts);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:Math.max(700,width+50),height:Math.max(1050,height+120)},deviceScaleFactor:Number(process.env.PROBE_DPR||1)});
const report={width,height,scope:'official UI.Render + production App/Presentation/registries; actions called through production controllers, not pointer hit-test acceptance',isolation:{storage:'in-memory A/B slots only',playerProgressLoaded:false,opfs:false,businessNetwork:false,sourceHashes:identities},cases:[],errors:[],console:[],responseErrors:[],blockedRequests:[]};
await page.route('**/*',async route=>{
 const request=route.request();
 if(new URL(request.url()).origin!==new URL(host.url).origin){report.blockedRequests.push(request.url());await route.abort();return;}
 if(request.url().endsWith('/runtime.json')){
  const response=await route.fetch();const resources=await response.json();
  // The ordinary preview deliberately has an empty Components module. The
  // fixture replaces it with the actual project module, never a UI double.
  delete resources['Presentation/Components.lua'];
  await route.fulfill({response,json:{...resources,...projection}});return;
 }
 await route.continue();
});
page.on('pageerror',error=>report.errors.push(error.message));
page.on('response',response=>{if(response.status()>=400)report.responseErrors.push({url:response.url(),status:response.status()});});
page.on('console',message=>{if(message.type()==='error'||/ERROR|Error|失败/.test(message.text()))report.console.push(message.text().slice(0,2000));});
await page.addInitScript(()=>{window.__flow=null;window.addEventListener('message',event=>{
 if(event.origin!==location.origin)return;
 if(event.data?.name==='lui-preview-applied')window.__applied=event.data.payload.revision;
 if(event.data?.name==='game-flow-ready')window.__flow=event.data.payload;
});});
const long=text=>'[====['+text+']====]';
let sequence=0;
async function step(name,action,expected={}){
 await page.evaluate(()=>{window.__flow=null;});
 const code=`local ok,err=xpcall(function()
  ${action}
  local p=FixturePresentation;assert(p and p.root_,'production root required')
  local count=0;local before=FixtureRenderCount;local cancel
  cancel=p.lui_:AfterLayout(p.root_,function(_,vg)
   count=count+1;if count<30 then return end;cancel()
   local vm=FixtureApp:GetTowerView();local bounds=p.root_:GetAbsoluteLayout()
   local result={name=${long(name)},page=p:GetCurrentPage(),step=FixtureApp:GetOnboarding().step,
    phase=vm and vm.phase or '',result=p.resultKind_ or '',renderCalls=FixtureRenderCount-before,
    bounds={x=bounds.x,y=bounds.y,width=bounds.w,height=bounds.h},storage=FixtureStorage,
    arrangements=require('LUI.Measure').stats.arrangements,records=#FixtureApp:GetRecords().entries,coach=p.tutorialCoach_~=nil,modal=p.tutorialModal_~=nil,
    notices=p.notifications_ and p.notifications_.messages_ or {},
    hitChecks=FixtureProbes(${long(name)}),summary=FixtureSummary(${long(name)},vg)}
   local out=VariantMap();out['name']='game-flow-ready';out['payload']=cjson.encode(result);SendEvent('EmitToPlugin',out)
  end)
 end,debug.traceback)
 if not ok then local out=VariantMap();out['name']='game-flow-ready';out['payload']=cjson.encode({name=${long(name)},error=tostring(err)});SendEvent('EmitToPlugin',out) end`;
 
 await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),code);
 await page.waitForFunction(()=>window.__flow,null,{timeout:20000});
 const result=await page.evaluate(()=>window.__flow);report.cases.push(result);
 const frame=page.frames().find(frame=>frame.url().includes('engine-frame.html'));
 await frame.locator('canvas').screenshot({path:resolve(output,`${String(++sequence).padStart(2,'0')}-${name}.png`)});
 assert.ok(!result.error,result.error);assert.ok(result.renderCalls>=29,JSON.stringify(result));
 assert.ok(Math.abs(result.bounds.width-width)<2 && Math.abs(result.bounds.height-height)<2);
 for(const check of Object.values(result.hitChecks||{}))assert.ok(check.passed,`${name}: ${JSON.stringify(check)}`);
 if(result.summary){
  const s=result.summary;
  assert.ok(s.rect.h+0.2>=s.metrics.textHeight,`native text clipped: ${JSON.stringify(s)}`);
  assert.ok(s.after.y>=s.rect.y+s.rect.h+(name==='battle-review'?5.5:7.5),`next label overlaps: ${JSON.stringify(s)}`);
  assert.equal(s.authoredLineHeight,1.45,'renderer must restore authored style');
 }
 for(const [key,value] of Object.entries(expected))assert.equal(result[key],value,`${name}.${key}`);
 console.log(JSON.stringify({name,page:result.page,step:result.step,phase:result.phase,renders:result.renderCalls,passed:true}));
 return result;
}
try{
 await page.goto(host.url);
 host.update({revision:1,width,height,theme:config.theme,fonts:fontConfig,node:{kind:'Element',tag:'lui:Page',attrs:{Width:String(width),Height:String(height)},children:[],sourcePath:'Fixture.lui',nodePath:''}});
 await page.waitForFunction(()=>window.__applied===1,null,{timeout:60000});
 await step('initial',`package.loaded['Presentation.Components']=nil
  local UI=require('urhox-libs/UI');FixtureRenderCount=0;local render=UI.Render
  UI.Render=function(...) FixtureRenderCount=FixtureRenderCount+1;return render(...) end
  function FixtureFind(root,predicate)
   if predicate(root) then return root end
   for _,child in ipairs(root:GetRenderChildren() or {}) do local found=FixtureFind(child,predicate);if found then return found end end
  end
  function FixtureProbes(name)
   local p=FixturePresentation
   local detail=p.resultModal_ and p.resultModal_.contentContainer_ or p.currentView_.context_.refs.DetailPanel
   local checks={};local last
   local function visit(w)
    if w.props.visible==false then return end
    if w.luiText_=='Text' and w.props.text~='' then
     local rect=w:GetAbsoluteLayout();local layout=w.luiTextLayout_ or {};local metrics=w.multilineMetrics_
     if not layout.singleLine and metrics then checks[#checks+1]={text=w.props.text,height=rect.h,inkHeight=metrics.textHeight,passed=rect.h+0.2>=metrics.textHeight} end
     if w.props.text=='位置：背包' then last=w end
    end
    for _,child in ipairs(w:GetRenderChildren() or {}) do visit(child) end
   end
   if detail then visit(detail) end
   if name=='scroll-bottom' then
    assert(last);local full=last:GetAbsoluteLayout();local visible=p.lui_:GetScreenRect(last)
    checks[#checks+1]={label='last receipt location visible',passed=visible and visible.h+0.5>=full.h or false}
   end
   return checks
  end
  function FixtureSummary(name,vg)
   local p=FixturePresentation;local detail=p.resultModal_ and p.resultModal_.contentContainer_ or p.currentView_.context_.refs.DetailPanel
   if not detail then return false end
   local label=FixtureFind(detail,function(w) return w.luiText_=='Text' and (string.find(w.props.text or '', '生命上限',1,true)~=nil or string.find(w.props.text or '', '品质特点',1,true)~=nil) end)
   if not label then return false end
   local children=label.parent:GetRenderChildren();local after;for i,w in ipairs(children) do if w==label then after=children[i+1] end end;assert(after)
   local rect=label:GetAbsoluteLayout();local layout=label.luiTextLayout_ or {};local metrics=label.multilineMetrics_ or {}
   local scroll=FixtureFind(detail,function(w) return w.ScrollToBottom~=nil end)
   nvgSave(vg);nvgFontFace(vg,label.lastMultilineFontFace_ or UI.Theme.FontFace(label.props.fontFamily,label.props.fontWeight));nvgFontSize(vg,label.lastMultilineFontSize_ or UI.Theme.FontSize(label.props.fontSize))
   nvgTextLineHeight(vg,label.lastMultilineLineHeight_ or layout.nativeLineHeight);nvgTextLetterSpacing(vg,label.props.letterSpacing or 0);nvgTextAlign(vg,NVG_ALIGN_LEFT+NVG_ALIGN_TOP)
   local ink=nvgTextBoxBounds(vg,0,0,metrics.breakWidth or rect.w,label.props.text);nvgRestore(vg)
   return {authoredLineHeight=label.props.lineHeight,after=after:GetAbsoluteLayout(),rect=rect,screen=p.lui_:GetScreenRect(label),metrics=metrics,layout=layout,inkBounds=ink,text=label.props.text,scroll=scroll:GetAbsoluteLayout()}
  end
  FixtureApp=require('App').New();assert(FixtureApp:Initialize());assert(FixtureApp:SetMusicSettings(false,0))
  FixturePresentation=require('Presentation').New(FixtureApp);FixtureApp:SetPresentation(FixturePresentation);FixturePresentation:Render()
  assert(FixturePresentation:ConfirmTutorialModal('隔离验收'));assert(FixturePresentation:SkipTutorial());FixturePresentation:Navigate('talents')`);
 await step('battle-review',`local p=FixturePresentation;local rows=p.currentView_.context_.view.rows
  local row;for _,r in ipairs(rows) do if r.id=='battle_review' then row=r end end;assert(row,'battle_review row');p.currentView_.context_.actions.SelectTalent(row)`);
 const initialReceipt=await step('upgrade',`local p=FixturePresentation
  p.itemUpgradeData_={mode='result',automatic=true,steps={{before={name='安神香',level=1,quality='common',healing=38,healingAmount=38,healingMaxHp=132,experiencePercent=8},after={name='安神香',level=2,quality='common',healing=47,healingAmount=47,healingMaxHp=132,experiencePercent=10},consumed={name='安神香',level=1},finalLocation='bag'}}}
  p:OpenResult('ItemUpgradeModal','upgrade')`);
 const stable=await step('stable',``);assert.equal(stable.arrangements,initialReceipt.arrangements,'steady frames must not relayout');
 await step('long-receipt',`local p=FixturePresentation;local step=p.itemUpgradeData_.steps[1];step.after.name=string.rep('远行者的安神香',5);p.itemUpgradeData_.steps={step,step,step,step};p:OpenResult('ItemUpgradeModal','upgrade')`);
 await step('scroll-bottom',`local scroll=FixtureFind(FixturePresentation.resultModal_.contentContainer_,function(w) return w.ScrollToBottom~=nil end);scroll:ScrollToBottom()`);
 await step('no-changes',`local p=FixturePresentation;local step=p.itemUpgradeData_.steps[1];step.after=step.before;p.itemUpgradeData_.steps={step};p:OpenResult('ItemUpgradeModal','upgrade');assert(p.resultView_.context_.view.entries[1].hasChanges=='折叠')`);
 report.passed=report.errors.length===0;
}catch(error){report.passed=false;report.failure=String(error);process.exitCode=1;console.error(error);}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
