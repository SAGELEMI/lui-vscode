// Source-only projection shared with Studio. Paired Lua is parsed for literal
// Properties declarations; never evaluated or included in the engine payload.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parseLui,readComponentProperties,isLayoutProperty}=require('../../dist/spec.cjs');
const {buildEngineSnapshot,resolvePreviewAttributes,canonicalTag,canonicalAttribute}=require('../../dist/previewSnapshot.cjs');

export async function projectSnapshot(game,config,path,data={}){
 const documents=new Map();
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
   const registry=config.componentDirectories[directory];if(!registry)throw Error('未登记目录 '+directory);
   for(const target of Object.values(registry))await load(typeof target==='string'?target:target.markup);
  }
  return node;
 }
 const root=await load(path);
 function component(n){const [alias,name]=String(n.tag).split(':');const directory=documents.get(n.source)?.attrs['目录:'+alias];const target=config.componentDirectories[directory]?.[name];return documents.get(typeof target==='string'?target:target?.markup);}
 return buildEngineSnapshot(root,data,{
  tag:n=>canonicalTag(n.tag)??n.tag,
  attrs:(n,s)=>resolvePreviewAttributes(n,s,(_,key)=>component(n)?.properties&&!isLayoutProperty(key)?key:canonicalAttribute(key)),
  children:n=>n.children.filter(c=>!canonicalTag(c.tag)?.startsWith((canonicalTag(n.tag)??n.tag)+'.')),
  component,
 })[0];
}
