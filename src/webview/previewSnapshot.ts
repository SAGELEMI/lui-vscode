import { parseBinding, canonicalTag, canonicalAttribute } from '../../packages/spec/src/vocabulary.js';
import { readPath } from '../../packages/spec/src/paths.js';
export { canonicalTag, canonicalAttribute };

export interface SnapshotNode {
  kind: string; tag?: string; text?: string; attrs: Record<string,string>;
  source: string; start: number; nodePath: number[];
  children?: SnapshotNode[];
  properties?: Record<string,{default?: unknown}>;
}
export function resolvePreviewAttributes<N extends SnapshotNode>(node:N, scope:Record<string,unknown>, keyOf:(node:N,key:string)=>string=(_,key)=>canonicalAttribute(key)):Record<string,string|undefined> {
  const attrs:Record<string,string|undefined>={},previews:Record<string,string|undefined>={};
  for(const [key,value]of Object.entries(node.attrs)){
    const name=keyOf(node,key);if(name.startsWith('Preview.'))previews[name.slice(8)]=value;else attrs[name]=value;
  }
  const owner=(canonicalTag(node.tag)??node.tag)+'.';
  for(const child of node.children??[]){const tag=canonicalTag(child.tag);if(tag?.startsWith(owner))attrs[tag.slice(owner.length)]=(child.children??[]).filter(c=>c.kind==='text').map(c=>c.text??'').join('').trim();}
  for(const key of Object.keys(attrs)){
    const binding=parseBinding(attrs[key]),value=binding?readPath(scope,binding.path):undefined;
    if(scope.componentInstance&&['Width','Height','MinWidth','MinHeight','MaxWidth','MaxHeight','Visibility'].includes(key)&&binding?.path.startsWith('props')&&value===undefined)attrs[key]=undefined;
    else if(previews[key]!==undefined)attrs[key]=previews[key];
    else if(binding){const result=value!==undefined?String(value):binding.previewContent;attrs[key]=result===undefined?undefined:binding.stringFormat?.replace('{0}',result)??result;}
    if(key==='Visibility'&&binding&&attrs[key]===undefined)attrs[key]='折叠';
  }
  return attrs;
}
export interface EngineNode {
  kind: string; tag?: string; text?: string; attrs?: Record<string,unknown>;
  children?: EngineNode[]; sourcePath?: string; nodePath?: string;
}
interface SnapshotRules<N extends SnapshotNode> {
  tag(node:N):string;
  attrs(node:N,scope:Record<string,unknown>):Record<string,string|undefined>;
  children(node:N):N[];
  component(node:N):N|undefined;
}

/** Pure, data-only projection. Import layout stays outside its component root,
 * just as Runtime:CreateComponent does; authored slots retain the caller scope. */
export function buildEngineSnapshot<N extends SnapshotNode>(root:N, data:Record<string,unknown>, rules:SnapshotRules<N>):EngineNode[] {
  function visit(node:N, scope:Record<string,unknown>, stack:string[], instance:string):EngineNode[] {
    if(node.kind==='comment')return [];
    if(node.kind==='text')return node.text?.trim()?[{kind:'Text',text:node.text}]:[];
    if(node.properties&&!scope.props)scope={...scope,props:Object.fromEntries(Object.entries(node.properties).map(([k,p])=>[k,p.default]))};
    const tag=rules.tag(node),attrs=rules.attrs(node,scope);
    const children=(context=scope)=>rules.children(node).flatMap((child,i)=>visit(child,context,stack,instance+'/'+i));
    if(tag==='lui:If')return ![undefined,null,false,'false','否','',0].includes(attrs.Test as never)?children():[];
    if(tag==='lui:For'){
      const expression=Object.entries(node.attrs).find(([key])=>['In','集合'].includes(key))?.[1];
      const binding=parseBinding(expression);let values=binding&&readPath(scope,binding.path);
      if(values===undefined&&binding?.previewContent)values=JSON.parse(binding.previewContent.replaceAll('&quot;','"'));
      return Array.isArray(values)?values.flatMap((item,index)=>rules.children(node).flatMap((child,i)=>visit(child,{...scope,item,index:index+1,[attrs.Each??attrs.Items??'item']:item},stack,instance+'['+index+']/'+i))):[];
    }
    if(tag==='lui:Slot')return (scope.previewSlot as EngineNode[]|undefined)??[];
    if(['lui:Preview','lui:Set','lui:Action','lui:Resource'].includes(tag))return [];
    const safe:Record<string,unknown>={};
    for(const [key,value]of Object.entries(attrs))if(value!==undefined&&!key.startsWith('目录:')&&!/^\{(?:动作|Action)(?:[\s,}]|$)/.test(value))safe[key]=value;
    // Preview has no business refs. Namespace duplicate component refs without
    // changing the source; sourcePath/nodePath still identify the authored node.
    if(safe['x:Ref'])safe['x:Ref']=instance+':'+safe['x:Ref'];
    const output:EngineNode={kind:'Element',tag,attrs:safe,sourcePath:node.source,nodePath:node.nodePath.join('.')};
    if(tag.includes(':')&&!tag.startsWith('lui:')){
      const component=rules.component(node);if(!component)throw new Error(`未登记组件：${tag}`);
      if(stack.includes(component.source))throw new Error(`组件循环：${tag}`);
      const props:Record<string,unknown>=Object.fromEntries(Object.entries(component.properties??{}).map(([k,p])=>[k,p.default]));
      for(const [key,value]of Object.entries(node.attrs)){
        const binding=parseBinding(value);let resolved=binding?(readPath(scope,binding.path)??binding.previewContent):value;
        if(typeof resolved==='string'&&/^[\[{]/.test(resolved)){try{resolved=JSON.parse(resolved.replaceAll('&quot;','"'));}catch{/* string property */}}
        // Missing bound inputs retain the component's declared default, just
        // as Properties.Apply does. false, 0 and an empty string are values.
        if(resolved!==undefined&&resolved!==null)props[key]=resolved;
      }
      output.tag='Container';
      output.children=visit(component,{...scope,props,previewSlot:children(),componentInstance:true},[...stack,component.source],instance+'/component');
    }else output.children=children();
    return [output];
  }
  return visit(root,data,[],'root');
}
