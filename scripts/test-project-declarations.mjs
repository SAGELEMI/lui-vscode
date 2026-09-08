// Validate every authored declaration using only inline 预览内容. Product preview sidecars are forbidden.
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {build} from 'esbuild';
async function source(path){const output=await build({entryPoints:[resolve(import.meta.dirname,'..',path)],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));}
const [spec,snapshot]=await Promise.all([source('packages/spec/src/index.ts'),source('src/webview/previewSnapshot.ts')]);
const game=resolve(process.argv[2]??'.'),scripts=resolve(game,'scripts'),presentation=resolve(scripts,'Presentation');
const config=JSON.parse(await readFile(resolve(scripts,'LUI/lui.project.json'),'utf8'));
assert.equal(config.schemaVersion,5,'lui.project.json must use schema 5');
assert.ok(Array.isArray(config.componentDirectories),'componentDirectories must be a directory array');
async function files(directory){return(await Promise.all((await readdir(directory,{withFileTypes:true})).map(async entry=>entry.isDirectory()?files(resolve(directory,entry.name)):entry.name.endsWith('.lui')?[resolve(directory,entry.name)]:[]))).flat();}
const documents=new Map(),declarations=new Map(),catalog=new Map();
for(const file of await files(presentation)){
 const path=relative(scripts,file).replaceAll('\\','/'),parsed=spec.parseLui(await readFile(file,'utf8'),config.schemaVersion);
 assert.ok(parsed.root,path+' has no document root');assert.deepEqual(parsed.diagnostics.filter(d=>d.severity==='error'),[],path+' syntax');
 const serialize=(n,p=[])=>({...n,source:path,start:n.range.start,nodePath:p,attrs:Object.fromEntries(n.attrs.map(a=>[a.name,a.value])),children:n.children.map((c,i)=>serialize(c,[...p,i]))});
 const node=serialize(parsed.root),properties=spec.readComponentProperties(await readFile(file+'.lua','utf8'));
 assert.equal(properties.error,undefined,path+' Properties');node.properties=properties.properties;documents.set(path,node);declarations.set(path,parsed);
 if(parsed.root.tag==='控件'){
  const directory=config.componentDirectories.find(value=>path.startsWith(value+'/'));
  if(directory){
   const displayName=node.attrs['副名称'];assert.ok(displayName,path+' component root requires 副名称');
   assert.ok(!catalog.has(directory+'\0'+displayName),'duplicate component display name '+displayName);
   catalog.set(directory+'\0'+displayName,path);
  }
 }
 await assert.rejects(stat(file+'.preview.json'),error=>error?.code==='ENOENT',path+' must not have .lui.preview.json');
}
const component=n=>{const[alias,name]=String(n.tag).split(':'),directory=documents.get(n.source)?.attrs['目录:'+alias],target=catalog.get(directory+'\0'+name);return documents.get(target);};
let scenarioCount=0;const missing=[];
for(const[path,node]of documents){
 const parsed=declarations.get(path);
 const result=snapshot.buildDeclarationSnapshot(node,{}, {tag:n=>snapshot.canonicalTag(n.tag)??n.tag,attributeKey:(n,key)=>component(n)?.properties&&!spec.isLayoutProperty(key)?key:snapshot.canonicalAttribute(key),component});
 assert.equal(result.node.sourcePath,path);assert.ok(result.documents[path]);
 function check(n){
  const tag=snapshot.canonicalTag(n.tag);
  for(const attr of n.attrs){
   const binding=spec.parseBinding(attr.value);if(!binding)continue;
   const key=snapshot.canonicalAttribute(attr.name),structural=(tag==='lui:For'&&key==='In')||(tag==='VirtualList'&&key==='Items')||(tag==='lui:If'&&key==='Test');
   if(structural&&binding.previewContent===undefined)missing.push(path+' / '+binding.path);
  }
  n.children.forEach(check);
 }
 check(parsed.root);scenarioCount++;
}
assert.deepEqual(missing,[],'structural bindings require inline 预览内容');
console.log(JSON.stringify({documents:documents.size,scenarios:scenarioCount,components:catalog.size,missingStructuralBindings:missing.length,game},null,2));
