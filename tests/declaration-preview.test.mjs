import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

// Compile in memory so this focused suite cannot stamp/deploy a shared Runtime.
async function source(path){const result=await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const [spec,snapshot,integrity]=await Promise.all([
  source('packages/spec/src/index.ts'),source('src/webview/previewSnapshot.ts'),source('src/runtimeIntegrity.ts')
]);

test('scalar attribute kinds accept real bindings and constrained layout expressions',()=>{
  const valid=spec.parseLui(`<控件 名称="Test" 布局:padding="{布局 choose(props['紧凑'], 4, 8)}"><容器 内边距="{绑定 view.padding, 模式=单向, 预览内容='10'}" 外边距="{布局 layout.padding}" 宽度="{布局 max(1, viewport.width - 12)}" /></控件>`);
  assert.deepEqual(valid.diagnostics.filter(d=>d.severity==='error'),[]);
  assert.ok(spec.parseLui('<控件 名称="Test" 内边距="1,2" />').diagnostics.some(d=>d.severity==='error'));
  assert.ok(spec.parseLui('<控件 名称="Test" 布局:bad="1" />').diagnostics.some(d=>d.severity==='error'));
  assert.equal(spec.parseBinding('{布局 viewport.width}'),undefined,'bindings keep their existing path grammar');
});

test('layout expression syntax permits data calculations and rejects executable language',()=>{
  for(const expression of ["choose(props['紧凑'], 6, 10)",'min(viewport.height * 0.9 - 88, 400)','max(1, count(view.items))','not item.disabled and item.key ~= nil','tab.visible or false','view.rows[1].height + -2','"hello"','100 / 2'])assert.ok(spec.parseLayoutExpression(`{布局 ${expression}}`),expression);
  for(const expression of ['os.execute("x")','require("x")','view:Update()','(function() return 1 end)()','view.fn()','load("x")()','a = 1','{1,2}','choose(true,1)','count()','1; 2','view["constructor"]','_G.x','1e2','view._internal','view.rows[1.5]'])assert.equal(spec.parseLayoutExpression(`{布局 ${expression}}`),undefined,expression);
});

test('numeric paths share Lua 1-based array indices while quoted keys stay strings',()=>{
  assert.deepEqual(spec.pathKeys("view.rows[1]['名称']"),['view','rows',1,'名称']);
  assert.equal(spec.readPath({view:{rows:[{'名称':'第一项'},{'名称':'第二项'}]}},"view.rows[1]['名称']"),'第一项');
  assert.equal(spec.readPath({view:{rows:{'1':'字符串键'}}},"view.rows['1']"),'字符串键');
  for(const path of ['view.rows[0]','view.rows[-1]','view.rows[1.5]','view.rows[01]','view.rows['+'9'.repeat(400)+']'])assert.equal(spec.pathKeys(path),undefined,path);
  assert.equal(spec.parseLayoutExpression('{布局 '+'9'.repeat(400)+'}'),undefined);
});

test('declaration snapshots preserve bindings, loops, virtual row templates and source scopes',()=>{
  const node=(tag,attrs={},children=[],source='Page.lui',path=[])=>({kind:'element',tag,attrs,children,source,nodePath:path,start:0});
  const template=node('lui:Component',{},[
    node('VirtualList',{Items:"{绑定 props['项目']}",Each:'row',StableKey:'key'},[
      node('Button',{Text:'{绑定 row.label}',Height:'{布局 row.height}'},[],'Card.lui',[0,0])
    ],'Card.lui',[0]),node('lui:Slot',{},[],'Card.lui',[1])
  ],'Card.lui');template.properties={'项目':{type:'table'}};
  const root=node('lui:Page',{'布局:body':'{布局 viewport.height - 80}'},[
    node('lui:For',{In:'{绑定 view.sections}',Each:'section'},[
      node('c:Card',{'项目':'{绑定 section.rows}'},[node('Text',{Text:'{绑定 view.title}'},[],'Page.lui',[0,0,0])],'Page.lui',[0,0])
    ],'Page.lui',[0])
  ]);
  const data={view:{sections:[]}};
  const result=snapshot.buildDeclarationSnapshot(root,data,{tag:n=>n.tag,component:n=>n.tag==='c:Card'?template:undefined});
  assert.equal(result.node.children[0].tag,'lui:For','an empty current scenario does not erase declarations');
  assert.equal(result.node.children[0].children[0].tag,'c:Card');
  assert.equal(result.documents['Page.lui'].imports.c.Card,'Card.lui');
  assert.equal(result.documents['Card.lui'].node.children[0].children[0].attrs.Height,'{布局 row.height}');
  assert.equal(result.documents['Card.lui'].node.children[0].children[0].sourcePath,'Card.lui');
  assert.equal(result.node.children[0].children[0].children[0].sourcePath,'Page.lui','caller slot keeps its authored scope');
  assert.equal(result.data,data);
  assert.ok(spec.capabilityAttributes('VirtualList').includes('StableKey'));
  assert.equal(spec.UI_CONTROL_DEFINITIONS.find(x=>x.tag==='VirtualList').children,true);
});

test('actual Runtime hash verification detects edited, missing and unsafe manifest entries',async()=>{
  const bytes=Buffer.from('return {}'),hash=createHash('sha256').update(bytes).digest('hex'),manifest={files:{'Runtime.lua':hash}};
  assert.deepEqual(await integrity.verifyRuntimeFiles(manifest,async()=>bytes),[]);
  assert.match((await integrity.verifyRuntimeFiles(manifest,async()=>Buffer.from('changed')))[0],/内容不匹配/);
  assert.match((await integrity.verifyRuntimeFiles(manifest,async()=>{throw Error('missing');}))[0],/无法读取/);
  assert.match((await integrity.verifyRuntimeFiles({files:{'../private.lua':hash}},async()=>{assert.fail('must not read escaped paths');}))[0],/条目无效/);
});

test('binding preview content is the only product preview-data source',()=>{
  const binding=spec.parseBinding("{绑定 props['项目'], 预览内容='[{&quot;key&quot;:&quot;a&quot;,&quot;label&quot;:&quot;一&quot;}]'}");
  assert.equal(binding.previewContent,'[{&quot;key&quot;:&quot;a&quot;,&quot;label&quot;:&quot;一&quot;}]');
  assert.ok(spec.parseLui('<控件 名称="Test"><预览 /></控件>').diagnostics.some(d=>/预览状态已移除/.test(d.message)));
});
