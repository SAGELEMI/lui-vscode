// Source-only projection shared with Studio. Paired Lua is parsed for literal
// Properties declarations; never evaluated or included in the engine payload.
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {parseLui,readComponentProperties,isLayoutProperty}=require('../../dist/spec.cjs');
const {buildEngineSnapshot,buildDeclarationSnapshot,resolvePreviewAttributes,canonicalTag,canonicalAttribute}=require('../../dist/previewSnapshot.cjs');

export async function verifyEngineRuntime(identity,runtimeDirectory){
 const bytes=await readFile(resolve(runtimeDirectory,'runtime-manifest.json')),manifest=JSON.parse(bytes);
 for(const[file,hash]of Object.entries(manifest.files)){
  assert.match(file,/^[\w-]+\.lua$/,'invalid Runtime manifest file');
  assert.equal(identity.runtimeFiles['LUI/'+file],hash,'engine Runtime bytes differ from manifest: '+file);
  assert.equal(createHash('sha256').update(await readFile(resolve(runtimeDirectory,file))).digest('hex'),hash,'actual Runtime file differs from manifest: '+file);
 }
 return {directory:runtimeDirectory,version:manifest.version,layoutContract:manifest.layoutContract,fileCount:Object.keys(manifest.files).length,manifestHash:createHash('sha256').update(bytes).digest('hex'),verifiedActualFiles:true};
}

async function projectDocuments(game,config,path){
 const documents=new Map();
 const catalog=new Map();
 for(const directory of config.componentDirectories??[]){
  const base=resolve(game,'scripts',directory);
  for(const entry of await readdir(base,{withFileTypes:true})){
   if(!entry.isFile()||!entry.name.endsWith('.lui'))continue;
   const componentPath=(directory+'/'+entry.name).replaceAll('\\','/');
   const parsed=parseLui(await readFile(resolve(game,'scripts',componentPath),'utf8'));
   if(!parsed.root)throw Error('组件没有根节点 '+componentPath);
   const attrs=Object.fromEntries(parsed.root.attrs.map(attribute=>[attribute.name,attribute.value]));
   if(!attrs['副名称'])throw Error('组件缺少副名称 '+componentPath);
   if(catalog.has(directory+'\0'+attrs['副名称']))throw Error('组件副名称重复 '+attrs['副名称']);
   catalog.set(directory+'\0'+attrs['副名称'],componentPath);
  }
 }
 async function load(path){
  if(documents.has(path))return documents.get(path);
  if(!/^Presentation\/[\w\-/]+\.lui$/.test(path))throw Error('夹具标记路径不在 Presentation 内');
  const parsed=parseLui(await readFile(resolve(game,'scripts',path),'utf8'));
  if(!parsed.root||parsed.diagnostics.some(d=>d.severity==='error'))throw Error('无效 LUI '+path+': '+JSON.stringify(parsed.diagnostics));
  const serialize=(n,p=[])=>({...n,attrs:Object.fromEntries(n.attrs.map(a=>[a.name,a.value])),source:path,nodePath:p,children:n.children.map((c,i)=>serialize(c,[...p,i]))});
  const node=serialize(parsed.root);documents.set(path,node);
  const declarations=readComponentProperties(await readFile(resolve(game,'scripts',path+'.lua'),'utf8'));
  if(declarations.error)throw Error(declarations.error);node.properties=declarations.properties;
  for(const [alias,directory]of Object.entries(node.attrs).filter(([key])=>key.startsWith('目录:'))){
   if(!(config.componentDirectories??[]).includes(directory))throw Error('未登记目录 '+directory);
   for(const [key,target]of catalog)if(key.startsWith(directory+'\0'))await load(target);
  }
  return node;
 }
 const root=await load(path);
 function component(n){const [alias,name]=String(n.tag).split(':');const directory=documents.get(n.source)?.attrs['目录:'+alias];return documents.get(catalog.get(directory+'\0'+name));}
 return {root,component};
}
export async function projectDeclarationSnapshot(game,config,path,data){
 const {root,component}=await projectDocuments(game,config,path);
 if(data===undefined)data={};
 return buildDeclarationSnapshot(root,data,{tag:n=>canonicalTag(n.tag)??n.tag,attributeKey:(n,key)=>component(n)?.properties&&!isLayoutProperty(key)?key:canonicalAttribute(key),component});
}
export async function projectSnapshot(game,config,path,data={}){
 const {root,component}=await projectDocuments(game,config,path);
 return buildEngineSnapshot(root,data,{
  tag:n=>canonicalTag(n.tag)??n.tag,
  attrs:(n,s)=>resolvePreviewAttributes(n,s,(_,key)=>component(n)?.properties&&!isLayoutProperty(key)?key:canonicalAttribute(key)),
  children:n=>n.children.filter(c=>!canonicalTag(c.tag)?.startsWith((canonicalTag(n.tag)??n.tag)+'.')),
  component,
 })[0];
}
