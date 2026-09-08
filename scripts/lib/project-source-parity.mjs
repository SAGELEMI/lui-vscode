// Real project companion initialization vs Studio declarations, with identical
// view/props data injected at the page's CreateContext result boundary.
import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {visibleLayoutProbe} from './visible-layout-probe.mjs';

// Inserted before Runtime/NativeText installation. These wrappers only observe
// the text passed to the original native draw call, never measure or alter it.
export const projectDrawObserver=String.raw`
local projectDrawBudget=require('LUI.MeasureBudget')
for _,name in ipairs({'nvgText','nvgTextBox'})do
 local original=_G[name]
 if type(original)=='function' then
  _G[name]=function(...)
   local owner=projectDrawBudget.Owner()
   if owner then
    owner.luiProbeDrawText_=select(name=='nvgText' and 4 or 5,...)
    owner.luiProbeDrawKind_=name
   end
   return original(...)
  end
 end
end
`;

export async function projectSourceResources(game){
 const root=resolve(game,'scripts'),resources={},hashes={};
 async function visit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const file=resolve(directory,entry.name);
   if(entry.isDirectory()){await visit(file);continue;}
   if(!/\.(lua|lui)$/.test(entry.name))continue;
   const key=relative(root,file).replaceAll('\\','/'),bytes=await readFile(file);
   resources[key]=bytes.toString('base64');hashes[key]=createHash('sha256').update(bytes).digest('hex');
  }
 }
 await visit(resolve(root,'Presentation'));
 return {resources,hashes};
}

const long=value=>'[====['+value+']====]';
const probe=String.raw`
${visibleLayoutProbe}
local function projectGeometry(runtime,root)
 local result,seen={},{}
 local function color(value)
  if type(value)=='table' then local channels={};for i=1,4 do channels[i]=tonumber(value[i])or 0 end;return table.concat(channels,',')end
  if type(value)=='string' or type(value)=='number' then return tostring(value)end
 end
 local function visit(widget)
  if not widget or seen[widget] then return end;seen[widget]=true
  if widget.luiSourcePath_ then
   local rect=widget:GetAbsoluteLayout();local screen=runtime:GetScreenRect(widget)
   local props=widget.props or {}
   result[#result+1]={source=widget.luiSourcePath_,name=widget.luiName_ or '',ref=widget.luiReference_,text=props.text,
    rect={rect.x,rect.y,rect.w,rect.h},screen=screen and {screen.x,screen.y,screen.w,screen.h} or false,
    visible=props.visible~=false and props.visibility~='hidden',borderColor=color(props.borderColor),
    drawText=screen and widget.luiProbeDrawText_ or nil,drawKind=screen and widget.luiProbeDrawKind_ or nil,displayText=screen and widget.displayText_ or nil,
    trimming=widget.luiTextTrimming_ and {width=widget.luiTextTrimming_.width,fullWidth=widget.luiTextTrimming_.fullWidth,result=widget.luiTextTrimming_.result},
    selectedKey=widget.luiVirtualList_ and widget.luiVirtualList_.state_ and widget.luiVirtualList_.state_.selectedKey}
  end
  local function children(values)for _,child in ipairs(values or {})do visit(child)end end
  if widget.GetChildren then children(widget:GetChildren())end
  if widget.GetHitTestChildren then children(widget:GetHitTestChildren())end
  children(widget.bodyChildren_);children(widget.luiGlobalOverlays_)
  if widget.luiVirtualList_ then children(widget.luiVirtualList_.renderChildren_)end
  visit(widget.contentContainer_);visit(widget.footerWidget_);visit(widget.luiNativeWidget_)
  if type(widget.content_)=='table' and widget.content_.GetChildren then visit(widget.content_)end
 end
 visit(root);return result
end
local function emitProject(name,payload)
 local data=VariantMap();data['name']=name;data['payload']=cjson.encode(payload);SendEvent('EmitToPlugin',data)
end
`;

let nextSequence=0;
export async function compareProjectSource({page,source,data,width,height,config,initialData,updateValues}){
 const sequence=++nextSequence;
 await page.evaluate(()=>{
  window.__projectSourceEvents=[];
  if(!window.__projectSourceListener){
   window.__projectSourceListener=true;
   window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.name?.startsWith('lui-project-source-'))window.__projectSourceEvents.push(event.data);});
  }
 });
 const lua=probe+`
local ok,err=xpcall(function()
 local UI=require('urhox-libs/UI');local Runtime=require('LUI.Runtime')
 local previous=assert(UI.GetRoot(),'Studio root missing')
 local previewRuntime=setmetatable({},Runtime)
 local preview=projectGeometry(previewRuntime,previous)
 local previewVisible=verifyVisibleLayout(previewRuntime,previous,${width},${height})
 local runtime=setmetatable({config_=cjson.decode(${long(JSON.stringify(config))}),documents_={},code_={},isV2_=true},Runtime)
 runtime:BeginFrame()
 local loaded,componentInstances,modals={},{},{}
 local loadCode=runtime.LoadCode
 function runtime:LoadCode(path)
  assert(path:match('^Presentation/'),'source fixture code outside Presentation: '..tostring(path))
  loaded[path]=true
  return loadCode(self,path)
 end
 local createComponent=runtime.CreateComponent
 function runtime:CreateComponent(path,...)
  local instance,reason=createComponent(self,path,...)
  assert(instance,reason);componentInstances[#componentInstances+1]=path
  return instance,reason
 end
 local buildNode=runtime.BuildNode
 function runtime:BuildNode(node,context)
  local widget=buildNode(self,node,context)
  if widget and node.tag=='Modal' then modals[#modals+1]=widget end
  return widget
 end
 local sample=cjson.decode(${long(JSON.stringify(initialData??data))})
 local updateValues=${updateValues?'cjson.decode('+long(JSON.stringify(updateValues))+')':'nil'}
 local path=${long(source)}
 local owner,content,entry
 if path:match('^Presentation/Components/') then
  local parent={view=sample.view or {},props={},refs={},actions={},componentStack={}}
  owner=assert(runtime:CreateComponent(path,parent,sample.props or {},{}))
  content=assert(owner:GetRoot());entry='component.New/Init/CreateContext/InitializeComponent'
 else
  local class=assert(runtime:LoadCode(path..'.lua'))
  assert(type(class.InitializeComponent)=='function','project InitializeComponent missing')
  owner=setmetatable({runtime_=runtime,descriptor_={markup=path,code=path..'.lua'}},class)
  -- The same authored sample enters at the view-model boundary. The real
  -- InitializeComponent and OnLoaded execute unchanged, including post-build
  -- style calls. App/domain CreateContext generation and actions are outside
  -- this geometry comparison; imported components execute their full New.
  function owner:CreateContext()
   return {view=sample.view or {},props=sample.props or {},refs={},actions={},owner=self,changeTracking='notify'}
  end
  owner:InitializeComponent();content=assert(owner:GetRoot());entry='page.InitializeComponent/OnLoaded; injected CreateContext data'
 end
 local candidate=UI.Panel{width='100%',height='100%',backgroundColor={0,0,0,0},children={content}}
 UI.SetRoot(candidate);for _,modal in ipairs(modals)do modal:Open()end
 local frames,stable,last=0,0,nil
 local updatedAt,liveUpdate=nil,nil
 local cancel
 cancel=runtime:AfterLayout(candidate,function()
  frames=frames+1
  if frames<40 then return end
  if updateValues and not updatedAt then
   assert(type(owner.SyncValues)=='function','production SyncValues is missing')
   local beforeRoot=owner:GetRoot();local beforeRefs={}
   for name,widget in pairs(owner.context_.refs)do beforeRefs[name]=widget end
   owner:SyncValues(updateValues)
   assert(owner:GetRoot()==beforeRoot,'live source update replaced the root')
   local fields,refs=0,0
   for name,value in pairs(updateValues)do assert(owner.context_.view[name]==value,'live source data did not update: '..name);fields=fields+1 end
   for name,widget in pairs(beforeRefs)do assert(owner.context_.refs[name]==widget,'live source update replaced ref: '..name);refs=refs+1 end
   liveUpdate={method='production Tower.SyncValues',fields=fields,preservedRefs=refs,rootPreserved=true,refsPreserved=true}
   updatedAt=frames;stable,last=0,nil
   return
  end
  if updatedAt and frames-updatedAt<40 then return end
  local ready,visible=pcall(verifyVisibleLayout,runtime,content,${width},${height})
  local geometry=projectGeometry(runtime,content)
  local signature=cjson.encode(geometry)
  stable=signature==last and stable+1 or 0;last=signature
  if frames<120 and (not ready or stable<3)then return end
  cancel()
  local result={sequence=${sequence},frames=frames,stableFrames=stable+1,entry=entry,
   loadedCode=loaded,componentInstances=componentInstances,previewVisible=previewVisible,sourceVisible=ready and visible or nil,liveUpdate=liveUpdate,
   error=not ready and tostring(visible) or stable<3 and 'source geometry did not converge' or nil}
  -- Keep each engine bridge message below its bounded payload buffer.
  for kind,rows in pairs({preview=preview,source=geometry})do
   local parts=math.ceil(#rows/30);result[kind..'Parts']=parts;result[kind..'Nodes']=#rows
   for part=1,parts do local values={};for index=(part-1)*30+1,math.min(part*30,#rows)do values[#values+1]=rows[index]end
    emitProject('lui-project-source-part',{sequence=${sequence},kind=kind,part=part,rows=values})
   end
  end
  for _,modal in ipairs(modals)do modal:Close()end
  UI.SetRoot(previous);candidate:Destroy()
  if owner and owner.Dispose then owner:Dispose()end
  emitProject('lui-project-source-ready',result)
 end)
end,debug.traceback)
if not ok then emitProject('lui-project-source-ready',{sequence=${sequence},error=tostring(err)})end`;
 await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),lua);
 await page.waitForFunction(sequence=>window.__projectSourceEvents.some(e=>e.name==='lui-project-source-ready'&&e.payload?.sequence===sequence),sequence,{timeout:20000});
 const events=await page.evaluate(sequence=>window.__projectSourceEvents.filter(e=>e.payload?.sequence===sequence),sequence);
 const result=events.find(e=>e.name==='lui-project-source-ready').payload;
 assert.ok(!result.error,result.error);
 const read=kind=>{
  const parts=events.filter(e=>e.name==='lui-project-source-part'&&e.payload.kind===kind).map(e=>e.payload).sort((a,b)=>a.part-b.part);
  assert.equal(parts.length,result[kind+'Parts']);
  const rows=parts.flatMap(p=>p.rows);assert.equal(rows.length,result[kind+'Nodes']);return rows;
 };
 const sourceGeometry=read('source'),previewGeometry=read('preview'),differences=[];
 if(sourceGeometry.length!==previewGeometry.length)differences.push({type:'node-count',source:sourceGeometry.length,preview:previewGeometry.length});
 for(let i=0;i<Math.max(sourceGeometry.length,previewGeometry.length);i++){
  const a=sourceGeometry[i],b=previewGeometry[i];
  if(!a||!b){differences.push({index:i,source:a,preview:b});continue;}
  const fields=[];
  for(const key of ['source','name','text','visible','selectedKey','borderColor','drawText','drawKind','displayText'])if(a[key]!==b[key])fields.push(key);
  for(const key of ['rect','screen']){
   // A live hidden/offscreen node may retain its previous arrangement. It has
   // no current screen rectangle; fresh-preview zeroes are not a visual delta.
   if(key==='rect'&&updateValues&&a.screen===false&&b.screen===false)continue;
   if(Array.isArray(a[key])&&Array.isArray(b[key])){
    if(a[key].some((value,j)=>!Number.isFinite(value)||!Number.isFinite(b[key][j])||Math.abs(value-b[key][j])>0.01))fields.push(key);
   }else if(a[key]!==b[key])fields.push(key);
  }
  if(fields.length)differences.push({index:i,fields,source:a,preview:b});
 }
 return {...result,passed:differences.length===0,differences,sourceGeometry,previewGeometry};
}

export function liveProjectSamples(source){
 const clone=value=>JSON.parse(JSON.stringify(value));
 if(source==='Presentation/Components/Header.lui'){
  return [
   ['中文长标题','无尽塔 · 一二三四五六七八九十甲乙丙丁戊己庚辛'],
   ['英文长标题','Endless Tower - Adventurer With A Very Long Display Name'],
   ['Emoji长标题','登塔者 · 😀🚀🗡️🛡️👩‍🚀🇨🇳🏰🐲🔥✨🌙⭐'],
  ].map(([scene,text])=>({scene,data:{view:{},props:{'标题':text,'返回':'noopBack','设置':'noopSettings'}},verifyTrimming:true}));
 }
 if(source==='Presentation/Components/SelectionList.lui'){
  const data={props:{'项目':[{key:'a',label:'项目一',description:'说明'}],'页签':[],'选中键':'a','标题':'项目','计数':'1','紧凑':false}};
  return [{scene:'公开选中键且省略状态',data}];
 }
 if(source==='Presentation/Scenes/Cover.lui'){
  const data={view:{headerTitle:'无尽塔',currency:'金币 0',continueVisible:false,startText:'开始登塔',saveBusy:false}};
  data.view.headerTitle='无尽塔 - 一二三四五六七八九十甲乙';
  return [{scene:'长玩家名',data,verifyTrimming:true}];
 }
 if(source!=='Presentation/Scenes/Tower.lui')return [];
 const short={view:{title:'无尽塔 · 第 1 层',phase:'battle',tab:'battle',activeTowerTab:'battle',battleVisible:true,organizeVisible:false,battleSections:[true],organizeSections:[],mainTabs:[{id:'battle',label:'战斗',appearance:'高亮'},{id:'organize',label:'整备',appearance:'常规'}],enemyText:'塔层守卫 · 等级 1',enemyHp:72,enemyMaxHp:100,enemyHealth:'血 72/100',enemyFactionText:'',enemyFactionVisible:false,enemyAffixText:'',enemyAffixVisible:false,primaryVisible:false,continueVisible:true,exitVisible:false,primaryDisabled:false,primaryTitle:'',primaryDescription:'',primaryText:'继续',exitText:'退出',logTitle:'战斗记录',logText:'等待本轮交锋。',effectsLastText:'',effectsLastVisible:false,fateRevealVisible:false,fateRevealActive:false,fateRangeText:'',fateResultText:'',fateResultColor:'#AEA3C2',playerText:'登塔者 · 等级 1',playerHp:100,playerMaxHp:100,playerHealth:'血 100/100',playerExperience:0,playerExperienceRequired:100,playerExperienceText:'经验 0/100',slotGroups:{equipment:[],accessories:[],talents1:[],talents2:[]}}};
 Object.assign(short.view,{logText:'等待本轮交锋。',logTitle:'战斗记录 · 第 1 回合',enemyFactionText:'',enemyFactionVisible:false,effectsSummary:'',effectsSummaryVisible:false,effectsLastText:'',effectsLastVisible:false});
 const grow={logText:Array.from({length:80},(_,i)=>`第 ${i+1} 次交锋：登塔者施展连续攻势，守卫反击并触发阵营效果。`).join('\n'),logTitle:'战斗记录 · 第 80 回合',enemyFactionText:'幽魂议会 · 首领',enemyFactionVisible:true,effectsSummary:'本局累计 · 攻击强化与生命加成',effectsSummaryVisible:true,effectsLastText:'本层效果 · 敌人速度提高，玩家获得护盾。',effectsLastVisible:true};
 const longData=clone(short);Object.assign(longData.view,grow);
 const shrink=Object.fromEntries(Object.keys(grow).map(key=>[key,short.view[key]]));
 return [
  {scene:'动态长战报与效果显示',data:longData,initialData:short,updateValues:grow},
  {scene:'动态短战报与效果隐藏',data:short,initialData:longData,updateValues:shrink},
 ];
}

export function verifyProjectTrimming(comparison){
 const results=[];
 for(const kind of ['sourceGeometry','previewGeometry']){
  const titles=comparison[kind].filter(node=>node.source==='Presentation/Components/Header.lui'&&node.ref==='Title');
  assert.equal(titles.length,1,'one actual Header.Title is required');
  const node=titles[0],job=node.trimming;
  const buttons=comparison[kind].filter(node=>node.source==='Presentation/Components/Header.lui'&&['HeaderBackButton','HeaderSettingsButton'].includes(node.ref)&&node.screen);
  for(const button of buttons)assert.ok(node.rect[0]+node.rect[2]<=button.rect[0]+0.01,'title must not overlap header action buttons');
  assert.ok(job&&Number.isFinite(job.width)&&Number.isFinite(job.fullWidth),'actual trimming measurement was not completed');
  assert.equal(node.drawKind,'nvgText','Header must reach the actual single-line native draw call');
  assert.equal(node.displayText,node.text,'temporary display string must be restored after drawing');
  assert.equal(typeof node.drawText,'string');assert.ok(!node.drawText.includes('\ufffd'),'draw text must be valid UTF-8');
  const shortened=job.fullWidth>job.width;
  if(shortened){
   assert.notEqual(node.drawText,node.text);assert.ok(node.drawText.endsWith('…'),'clipped text must draw an ellipsis');
   const prefix=node.drawText.slice(0,-1),prefixes=new Set(['']);let whole='';
   for(const part of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(node.text)){whole+=part.segment;prefixes.add(whole);}
   assert.ok(prefixes.has(prefix),'ellipsis must follow a complete Unicode grapheme prefix');
  }else assert.equal(node.drawText,node.text,'wide title must draw its complete original text');
  results.push({kind,fullText:node.text,drawText:node.drawText,width:job.width,fullWidth:job.fullWidth,shortened,originalDisplayRestored:true});
 }
 return results;
}
