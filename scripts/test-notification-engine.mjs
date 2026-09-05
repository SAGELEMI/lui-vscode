// Isolated notification presentation fixture: real UrhoX + production LUI and
// NotificationOverlay backend only. No App, player storage or game network code.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {EnginePreviewHost}=require('../dist/enginePreviewHost.cjs');
const game=resolve(process.argv[2]);
const output=resolve('artifacts/notification-engine-20260906');await mkdir(output,{recursive:true});
const config=JSON.parse(await readFile(resolve(game,'scripts/LUI/lui.project.json'),'utf8'));
const markup=await readFile(resolve(game,'scripts/Presentation/NotificationOverlay.lui'),'utf8');
const backend=await readFile(resolve(game,'scripts/Presentation/NotificationOverlay.lui.lua'),'utf8');
const files=[];
for(const family of config.fonts)for(const font of Object.values(family.weights))files.push({path:font.resource,sha256:font.sha256,bytes:await readFile(resolve(game,'assets',font.resource))});
const fonts=config.fonts.map(f=>({family:f.family,weights:Object.fromEntries(Object.entries(f.weights).map(([k,v])=>[k,v.resource]))}));
const host=new EnginePreviewHost();await host.start(resolve('artifacts/engine-cache'),resolve('packages/runtime-urhox-lua/adapter'),files);
const browser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:1200},deviceScaleFactor:1});
await page.addInitScript(()=>{window.__applied=0;window.addEventListener('message',event=>{
 if(event.origin!==location.origin)return;
 if(event.data?.name==='lui-preview-applied')window.__applied=event.data.payload.revision;
 if(event.data?.name==='notification-fixture-ready')window.__notice=event.data.payload;
});});
const long=value=>'[====['+value+']====]';
const report={scope:'isolated real engine notification presentation; production backend with synthetic notifications; no gameplay/save access',cases:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
let revision=0;
try{
 await page.goto(host.url);
 for(const [width,height,age]of [[358,844,0],[360,844,0],[377,844,0],[390,844,0],[640,844,0],[390,867,0],[390,867,3]]){
  host.update({revision:++revision,width,height,theme:config.theme,fonts,node:{kind:'Element',tag:'lui:Page',attrs:{Width:String(width),Height:String(height),Background:'#302842'},children:[],sourcePath:'NotificationFixture.lui',nodePath:''}});
  await page.waitForFunction(revision=>window.__applied===revision,revision,{timeout:60000});
  await page.evaluate(()=>{window.__notice=null;});
  const lua=`local ok,err=xpcall(function()
   local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime');local Typography=require('LUI.Typography')
   local runtime=setmetatable({config_={componentDirectories={}},isV2_=true,code_={}},Runtime)
   function runtime:LoadDocument(path) return require('LUI.Parser').Parse(${long(markup)},path) end
   local Notifications=assert(load(${long(backend)},'@NotificationOverlay.lui.lua'))()
   local previous=UI.GetRoot();local ordinary=UI.Label{text='普通文字保持原有字重',fontSize=12/UI.Theme.FontSize(1),fontColor={242,234,255,255},position='absolute',left=8,top=150}
   Typography.AttachLabel(ordinary)
   local root=UI.Panel{width='100%',height='100%',backgroundColor={48,40,66,255},children={ordinary}}
   local notices=Notifications.New({},runtime,{markup='NotificationOverlay.lui'})
   notices:Mount(root,{x=0,y=0,width=${width},height=${height}})
   notices:Push('普通提示：新奖励已加入背包。',false)
   notices:Push('未解锁天赋暂时不可携带。',true)
   notices:Push('第3条消息',false)
   notices:Push(string.rep('通知汉字',14),false)
   notices:Update(${age})
   UI.SetRoot(root);if previous then previous:Destroy() end
   local frames=0;local cancel
   cancel=runtime:AfterLayout(root,function()
    frames=frames+1;if frames<12 then return end;cancel()
    local labels={};for i=1,4 do local label=notices.context_.refs['Message'..i];local p=label.props;local l=label:GetAbsoluteLayout()
     labels[i]={x=l.x,y=l.y,width=l.w,height=l.h,text=p.text,length=utf8.len(p.text),opacity=p.opacity,
      hasBackground=p.backgroundColor~=nil and p.backgroundColor~=false,hasBorder=p.borderColor~=nil and p.borderColor~=false,
      stroke=p.textStroke,raster=p.luiTextRasterMode}
    end
    local l=notices.root_:GetAbsoluteLayout();local result={width=${width},height=${height},age=${age},anchor={x=l.x,y=l.y,width=l.w},labels=labels,ordinaryStroke=ordinary.props.textStroke~=nil}
    local out=VariantMap();out['name']='notification-fixture-ready';out['payload']=cjson.encode(result);SendEvent('EmitToPlugin',out)
   end)
  end,debug.traceback)
  if not ok then local out=VariantMap();out['name']='notification-fixture-ready';out['payload']=cjson.encode({error=tostring(err)});SendEvent('EmitToPlugin',out) end`;
  await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),lua);
  await page.waitForFunction(()=>window.__notice,{timeout:20000});
  const result=await page.evaluate(()=>window.__notice);assert.ok(!result.error,result.error);
  assert.equal(result.anchor.x,8);assert.equal(result.anchor.y,8);assert.equal(result.anchor.width,260);
  assert.equal(result.labels.length,4);assert.equal(result.ordinaryStroke,false);
  for(const label of result.labels){assert.ok(label.height>0&&label.height<=34.81,JSON.stringify(result));assert.ok(label.length<=48);assert.equal(label.hasBackground,false);assert.equal(label.hasBorder,false);assert.equal(label.stroke.width,1);assert.equal(label.opacity,age===3?0.5:1);}
  const frame=page.frames().find(frame=>frame.url().includes('engine-frame.html'));
  await frame.locator('canvas').screenshot({path:resolve(output,`${width}x${height}-age${age}.png`)});
  report.cases.push(result);console.log(JSON.stringify({width,height,age,passed:true}));
 }
 report.identity=await(await fetch(host.url+'identity.json')).json();
 report.passed=report.errors.length===0;assert.ok(report.passed,JSON.stringify(report.errors));
}catch(error){report.passed=false;report.failure=String(error);throw error;}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();host.dispose();}
