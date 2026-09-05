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
const output=resolve(`artifacts/game-flow-engine-20260906/summary-final/${width}x${height}`);await mkdir(output,{recursive:true});
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
for(const name of ['Registry.lua','lui.project.json','runtime-manifest.json']){
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
const page=await browser.newPage({viewport:{width:Math.max(700,width+50),height:Math.max(1050,height+120)},deviceScaleFactor:1});
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
    records=#FixtureApp:GetRecords().entries,coach=p.tutorialCoach_~=nil,modal=p.tutorialModal_~=nil,
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
 assert.deepEqual(result.bounds,{x:0,y:0,width,height});
 for(const check of Object.values(result.hitChecks||{}))assert.ok(check.passed,`${name}: ${JSON.stringify(check)}`);
 if(name==='settlement'){
  assert.equal(Object.values(result.notices||{}).filter(notice=>notice.text==='本轮已结算。').length,1,'one exit action emits exactly one settlement notice');
  const summary=result.summary;assert.ok(summary.inkBounds[3]<=summary.rect.h+0.5,JSON.stringify(summary));
  assert.ok(summary.after.y>=summary.screen.y+summary.screen.h+9.5,JSON.stringify(summary));
  assert.ok(summary.screen.h>=summary.rect.h-0.5,JSON.stringify(summary));
  assert.equal(summary.lineCount,width<=360?2:1,JSON.stringify(summary));
 }
 for(const [key,value] of Object.entries(expected))assert.equal(result[key],value,`${name}.${key}`);
 console.log(JSON.stringify({name,page:result.page,step:result.step,phase:result.phase,renders:result.renderCalls,passed:true}));
 return result;
}
try{
 await page.goto(host.url);
 host.update({revision:1,width,height,theme:config.theme,fonts:fontConfig,node:{kind:'Element',tag:'lui:Page',attrs:{Width:String(width),Height:String(height)},children:[],sourcePath:'GameFlowFixture.lui',nodePath:''}});
 await page.waitForFunction(()=>window.__applied===1,null,{timeout:60000});
 await step('new-name',`package.loaded['Presentation.Components']=nil
  local UI=require('urhox-libs/UI');FixtureRenderCount=0;local render=UI.Render
  UI.Render=function(...) FixtureRenderCount=FixtureRenderCount+1;return render(...) end
  function FixtureFind(root,predicate,last)
   if not root then return end;if predicate(root) then return root end
   local children=root:GetRenderChildren() or {}
   for i=last and #children or 1,last and 1 or #children,last and -1 or 1 do local found=FixtureFind(children[i],predicate,last);if found then return found end end
  end
  function FixtureProbes(name)
   local p=FixturePresentation;local checks={}
   local function text(root,label) return FixtureFind(root,function(w) return w.props.text==label and w.props.onClick~=nil end) end
   local function check(label,target,scrollRow)
    local rect,reason=p.lui_:GetScreenRect(target)
    local full=target and require('LUI.Overlays').VisualRect(target)
    local hit=rect and UI.FindWidgetAt(rect.x+rect.w/2,rect.y+rect.h/2)
    local current=hit;local matched=false
    while current do if current==target then matched=true;break end;current=current.parent end
    local visible=rect and full and rect.w>=full.w-0.5 and (scrollRow and rect.h>=24 or not scrollRow and rect.h>=full.h-0.5) and rect.h>=15 and rect.x>=0 and rect.y>=0 and rect.x+rect.w<=UI.GetWidth()+0.5 and rect.y+rect.h<=UI.GetHeight()+0.5
    checks[#checks+1]={label=label,rect=rect or false,full=full or false,reason=reason or '',hit=matched,hitText=hit and hit.props.text or '',passed=visible and matched and target.props.disabled~=true or false}
   end
   if p.tutorialView_ then check('name-confirm',p.tutorialView_.context_.refs.ConfirmButton);check('name-input',p.tutorialView_.context_.refs.NameInput) end
   if p.tutorialCoach_ then
    local refs=p.tutorialCoach_.context_.refs
    if refs.PrimaryButton.props.visible~=false then check('tutorial-next',refs.PrimaryButton) end
    check('tutorial-skip',text(p.tutorialCoach_:GetRoot(),'跳过教程'))
   end
   if name=='loadout-ready' then check('start-run',p.currentView_.context_.refs.StartRunButton) end
   if name=='reward' or name=='reward-selected' then
    local refs=p.resultView_.context_.refs
    check('reward-abandon',refs.AbandonRewardButton)
    check(name=='reward' and 'reward-first-row' or 'reward-last-row-after-scroll',FixtureFind(refs.RewardList,function(w) return w.props.onClick~=nil end,name=='reward-selected'),true)
    if name=='reward-selected' then check('reward-claim',text(refs.DetailPanel,'领取奖励')) end
   end
   if name=='reward-claimed' then check('exit-tower',p.currentView_.context_.refs.ExitTowerButton) end
   if name=='settlement' then check('settlement-close',text(p.resultModal_.contentContainer_,'返回封面')) end
   return checks
  end
  function FixtureSummary(name,vg)
   if name~='settlement' then return false end
   local p=FixturePresentation;local refs=p.resultView_.context_.refs;local label=refs.SettlementSummary
   local rect=label:GetAbsoluteLayout();local screen=p.lui_:GetScreenRect(label);local after=p.lui_:GetScreenRect(refs.EquipmentHeading)
   local layout=label.luiTextLayout_ or {};local metrics=label.multilineMetrics_ or {}
   local fit=UI.MeasureTextFit(label.props.text,{fontSize=UI.Theme.FontSize(label.props.fontSize),minFontSize=UI.Theme.FontSize(label.props.fontSize),fontFace=UI.Theme.FontFace(label.props.fontFamily,label.props.fontWeight),width=rect.w,multiline=true,lineHeight=layout.nativeLineHeight})
   nvgSave(vg)
   nvgFontFace(vg,label.lastMultilineFontFace_ or UI.Theme.FontFace(label.props.fontFamily,label.props.fontWeight))
   nvgFontSize(vg,label.lastMultilineFontSize_ or UI.Theme.FontSize(label.props.fontSize))
   local lineFactor=label.lastMultilineLineHeight_ or layout.nativeLineHeight
   nvgTextLineHeight(vg,lineFactor);nvgTextLetterSpacing(vg,label.props.letterSpacing or 0);nvgTextAlign(vg,NVG_ALIGN_LEFT+NVG_ALIGN_TOP)
   local _,_,fontLineHeight=nvgTextMetrics(vg)
   local inkBounds=nvgTextBoxBounds(vg,0,0,metrics.breakWidth or rect.w,label.props.text)
   nvgRestore(vg)
   local lineAdvance=fontLineHeight*lineFactor
   local lineCount=math.max(1,math.ceil((inkBounds[4]-inkBounds[2])/lineAdvance-0.01))
   return {rect=rect,screen=screen,after=after,text=label.props.text,fit=fit,nativeMetrics=metrics,textLayout=layout,inkBounds=inkBounds,lineAdvance=lineAdvance,lineCount=lineCount}
  end
  FixtureApp=require('App').New();local ready,reason=FixtureApp:Initialize();assert(ready,reason)
  -- This fresh synthetic payload is the only progress loaded. Audio is outside
  -- the UI acceptance scope and disabled through its ordinary production API.
  assert(FixtureApp:SetMusicSettings(false,0));
  FixturePresentation=require('Presentation').New(FixtureApp);FixtureApp:SetPresentation(FixturePresentation);FixturePresentation:Render()`,{page:'cover',step:'name',modal:true});
 await step('home',`assert(FixturePresentation:ConfirmTutorialModal('隔离验收'));`,{page:'cover',step:'home_intro'});
 await step('talent-route',`assert(FixturePresentation:AdvanceTutorialCoach())`,{page:'cover',step:'talent_intro'});
 await step('talents',`FixturePresentation.currentView_.context_.actions.OpenTalents()`,{page:'talents',step:'talent_intro'});
 await step('warehouse',`assert(FixturePresentation:AdvanceTutorialCoach());FixturePresentation:Navigate('cover');FixturePresentation.currentView_.context_.actions.OpenWarehouse()`,{page:'warehouse',step:'warehouse_intro'});
 await step('loadout',`assert(FixturePresentation:AdvanceTutorialCoach());FixturePresentation:Navigate('cover');FixturePresentation.currentView_.context_.actions.OpenTower()`,{page:'loadout',step:'loadout_intro'});
 await step('loadout-ready',`assert(FixturePresentation:AdvanceTutorialCoach())`,{page:'loadout',step:'loadout_select'});
 await step('battle-paused',`FixturePresentation:StartSelectedRun();assert(FixtureApp:HasRun())`,{page:'tower',step:'battle_intro',phase:'battle'});
 await step('battle-resumed-save',`assert(FixtureApp:SaveNow());FixturePresentation:CloseTutorialCoach();FixturePresentation:CloseTutorial();
  FixtureApp=require('App').New();local ready,reason=FixtureApp:Initialize();assert(ready,reason);FixturePresentation=require('Presentation').New(FixtureApp);FixtureApp:SetPresentation(FixturePresentation);FixturePresentation:Render()`,{page:'tower',step:'battle_intro',phase:'battle'});
 await step('battle-active',`assert(FixturePresentation:AdvanceTutorialCoach());FixtureApp:Update(0.2);FixturePresentation:RefreshTower();FixturePresentation:Update(0.2)`,{page:'tower',step:'reward',phase:'battle'});
 await step('reward',`for i=1,300 do FixtureApp:Update(0.2);FixturePresentation:RefreshTower();FixturePresentation:Update(0.2);if FixturePresentation.resultKind_=='reward' then break end end;assert(FixturePresentation.resultKind_=='reward','tutorial victory/reward required')`,{page:'tower',step:'reward',phase:'reward',result:'reward'});
 await step('reward-selected',`local view=FixturePresentation.resultView_;local scroll=FixtureFind(view.context_.refs.RewardList,function(w) return w.ScrollToBottom~=nil end);assert(scroll,'native reward scroll');scroll:ScrollToBottom();view.context_.actions.SelectReward(view.context_.view.rows[#view.context_.view.rows])`,{page:'tower',step:'reward',phase:'reward',result:'reward'});
 await step('reward-claimed',`FixturePresentation.resultView_.context_.actions.ClaimReward();FixturePresentation:Update(0.6)`,{page:'tower',step:'exit_intro',phase:'between'});
 await step('settlement',`FixturePresentation.currentView_.context_.actions.ExitTower();FixturePresentation:Update(0.6)`,{page:'tower',step:'records_intro'});
 await step('records',`FixturePresentation:FinishSettlement();FixturePresentation.currentView_.context_.actions.OpenRecords()`,{page:'records',step:'records_intro',records:1});
 await step('completed',`assert(FixturePresentation:AdvanceTutorialCoach())`,{page:'records',step:'complete'});
 await step('replay-skipped',`assert(FixtureApp:StartTutorialReplay());FixturePresentation:Navigate('cover');assert(FixturePresentation:SkipTutorial())`,{page:'cover',step:'complete'});
 await step('skip-restored',`FixtureApp=require('App').New();assert(FixtureApp:Initialize());FixturePresentation=require('Presentation').New(FixtureApp);FixtureApp:SetPresentation(FixturePresentation);FixturePresentation:Render()`,{page:'cover',step:'complete',records:1});
 report.identity=await(await fetch(host.url+'identity.json')).json();
 assert.equal(report.blockedRequests.length,0,JSON.stringify(report.blockedRequests));
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);process.exitCode=1;console.error(error);}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
