import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {EnginePreviewHost,ENGINE_LOCK}=require('../dist/enginePreviewHost.cjs');
const {buildEngineSnapshot,resolvePreviewAttributes}=require('../dist/previewSnapshot.cjs');

test('shared preview value resolver preserves false, inherited sizing and formatted text',()=>{
 const node={kind:'element',tag:'Text',attrs:{'可见性':'{绑定 view.show}','文本':"{绑定 view.name, 预览内容='样例'}"}};
 assert.equal(resolvePreviewAttributes(node,{}).Visibility,'折叠');
 assert.equal(resolvePreviewAttributes(node,{view:{show:false}}).Visibility,'false');
 assert.equal(resolvePreviewAttributes(node,{view:{name:''}}).Text,'');
 assert.equal(resolvePreviewAttributes(node,{}).Text,'样例');
 assert.equal(resolvePreviewAttributes({...node,attrs:{'高度':"{绑定 props.height, 预览内容='240'}"}},{componentInstance:true,props:{}}).Height,undefined);
});

test('data snapshot preserves component host layout, scoped slots, stable paths and separate refs',()=>{
 const node=(tag,attrs={},children=[],source='Page.lui',nodePath=[])=>({kind:'element',tag,attrs,children,source,nodePath,start:0});
 const component=node('lui:Component',{Width:'110',Padding:'6'},[
  node('Text',{'x:Ref':'Caption',Text:'$props.title'},[],'Card.lui',[0]),
  node('lui:Slot',{},[],'Card.lui',[1])
 ],'Card.lui');
 const rules={tag:n=>n.tag,children:n=>n.children,component:()=>component,attrs:(n,s)=>Object.fromEntries(Object.entries(n.attrs).map(([k,v])=>[k,v.startsWith('$')?v.slice(1).split('.').reduce((o,p)=>o?.[p],s):v]))};
 const call=i=>node('c:Card',{Width:'240',title:'inner'},[node('Text',{Text:'$props.title'},[],'Page.lui',[i,0])],'Page.lui',[i]);
 const [result]=buildEngineSnapshot(node('lui:Page',{},[call(0),call(1),node('Button',{Click:'{动作 Nope}',Change:'{Action Nope}'})]),{props:{title:'caller'}},rules);
 const [first,second,button]=result.children;
 assert.equal(first.tag,'Container');assert.equal(first.attrs.Width,'240');
 assert.equal(first.children[0].attrs.Width,'110');
 assert.equal(first.children[0].children[0].attrs.Text,'inner');
 assert.equal(first.children[0].children[1].attrs.Text,'caller','slot uses caller props, not component props');
 assert.notEqual(first.children[0].children[0].attrs['x:Ref'],second.children[0].children[0].attrs['x:Ref']);
 assert.equal(first.nodePath,'0');assert.equal(first.children[0].children[0].sourcePath,'Card.lui');
 assert.equal(button.attrs.Click,undefined);assert.equal(button.attrs.Change,undefined);
 assert.throws(()=>buildEngineSnapshot(node('c:Card'),{}, {...rules,component:()=>node('c:Card',{},[],'Card.lui')}),/组件循环/);
});
test('component projection retains defaults for missing inputs and preserves false, zero, empty and single-pass initial values',()=>{
 const node=(tag,attrs={},children=[])=>({kind:'element',tag,attrs,children,source:tag==='lui:Component'?'Card.lui':'Page.lui',nodePath:[],start:0});
 const template=node('lui:Component',{},[
  node('Text',{Text:"{绑定 props['caption']}"}),node('Text',{Text:"{绑定 props['enabled']}"}),node('Text',{Text:"{绑定 props['count']}"})
 ]);
 template.properties={caption:{default:'default'},enabled:{default:true},count:{default:12}};
 const call=node('c:Card',{caption:'{绑定 view.caption, 模式=单次}',enabled:'{绑定 view.enabled}',count:'{绑定 view.count}'});
 const rules={tag:n=>n.tag,children:n=>n.children,component:()=>template,attrs:resolvePreviewAttributes};
 const text=view=>buildEngineSnapshot(call,{view},rules)[0].children[0].children.map(n=>n.attrs.Text);
 assert.deepEqual(text({}),['default','true','12']);
 assert.deepEqual(text({caption:null,enabled:null,count:null}),['default','true','12']);
 assert.deepEqual(text({caption:'',enabled:false,count:0}),['','false','0']);
 assert.deepEqual(text({caption:'initial',enabled:false,count:3}),['initial','false','3']);
 assert.deepEqual(text({}),['default','true','12'],'a separate projection does not inherit the previous instance data');
});
test('isolated engine host uses vendor manifests, session whitelist, hashes and newest snapshot',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lui-engine-test-'));
 const runtime=join(directory,'runtime');await mkdir(runtime);await writeFile(join(runtime,'Runtime.lua'),'return {}');
 const metadata=Buffer.from(JSON.stringify({version:ENGINE_LOCK.version,client:'resource',files:[]}));
 const prefix=Buffer.alloc(12);prefix.write('URXRES1\0');prefix.writeUInt32LE(metadata.length,8);
 const binary=[Buffer.from(JSON.stringify({binary_hash:ENGINE_LOCK.binary})),Buffer.from('// vendor'),Buffer.concat([prefix,metadata]),Buffer.from('wasm')];
 const files=['version.json','UrhoXRuntime.js','UrhoXRuntime.data','UrhoXRuntime.wasm'].map((fs_path,i)=>({fs_path,uuid:'asset'+i,hash:'abcd',ext:'.'+fs_path.split('.').pop(),size:binary[i].length}));
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async url=>{
  if(String(url).startsWith('http://127.0.0.1:'))return original(url);
  requests++;const path=new URL(url).pathname;
  if(path.endsWith('index.min.js'))return new Response('// official loader');
  if(path.endsWith('version.json'))return Response.json({version:ENGINE_LOCK.version,client:path.includes('/engine-res/')?'resource':'engine'});
  if(path.includes('manifest-'))return Response.json({files:path.includes('/engine-res/')?[]:files});
  const index=Number(/asset(\d)/.exec(path)?.[1]);if(Number.isInteger(index))return new Response(binary[index]);
  throw new Error('unexpected fetch '+url);
 };
 const host=new EnginePreviewHost();
 try{
  await host.start(join(directory,'cache'),runtime,[]);
  assert.equal((await original(host.url+'identity.json')).status,200);
  assert.equal((await original(host.url+'runtime.json')).headers.get('Cross-Origin-Embedder-Policy'),'require-corp');
  assert.equal((await original(new URL('/runtime.json',host.url))).status,403);
  assert.equal((await original(host.url+'../../package.json')).status,403);
  assert.equal((await original(host.url+'Runtime.lua')).status,404);
  assert.equal((await original(host.url+'snapshot.json',{method:'POST'})).status,403);
  host.update({revision:2,value:'latest',node:{sourcePath:'Page.lui',nodePath:'0'}});host.update({revision:1,value:'stale'});
  assert.equal((await(await original(host.url+'snapshot.json')).json()).snapshot.value,'latest');
  const identity=await(await original(host.url+'identity.json')).json();
  assert.match(identity.themeSha256,/^[a-f0-9]{64}$/);
  assert.match(await(await original(host.url+'bootstrap.lua')).text(),/字体或主题已改变/);
  let selection;host.onPick=value=>{selection=value;};
  const report={revision:2,sourcePath:'Page.lui',nodePath:'0',probe:{width:240}};
  const pick=(value,origin=new URL(host.url).origin)=>original(host.url+'pick',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(value)});
  assert.equal((await pick(report,'https://unrelated.invalid')).status,403);
  assert.equal((await pick({...report,revision:1})).status,409);
  assert.equal((await pick({...report,sourcePath:'Private.lua'})).status,409);
  assert.equal((await pick(report)).status,204);assert.deepEqual(selection,report);
  const count=requests;const second=new EnginePreviewHost();await second.start(join(directory,'cache'),runtime,[]);second.dispose();assert.equal(requests,count,'verified cache prevents downloads');
 }finally{host.dispose();globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
