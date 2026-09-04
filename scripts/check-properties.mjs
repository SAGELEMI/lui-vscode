// Audit current project interfaces without formatting or executing game backends.
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import spec from '../dist/spec.cjs';
const project=resolve(process.argv[2]);
const directory='Presentation/Components', components=[];
for(const entry of await readdir(join(project,'scripts',directory))) {
  if(!entry.endsWith('.lui')) continue;
  const text=await readFile(join(project,'scripts',directory,entry),'utf8');
  const parsed=spec.parseLui(text);
  const code=await readFile(join(project,'scripts',directory,entry+'.lua'),'utf8');
  const declaration=spec.readComponentProperties(code);
  assert.equal(declaration.error,undefined,entry); assert.ok(declaration.properties,entry);
  assert.doesNotMatch(text,/\bprops\./,entry+': obsolete interface binding');
  assert.doesNotMatch(code,/\bprops_?\.[A-Za-z]/,entry+': obsolete Lua interface');
  for(const a of parsed.root.attrs.filter(a=>['名称','副名称'].includes(a.name))) components.push({name:a.value,properties:Object.keys(declaration.properties),definitions:declaration.properties});
}
let designs=0;
async function visit(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const file=join(dir,entry.name);
    if(entry.isDirectory()) await visit(file);
    else if(entry.name.endsWith('.lui')) {
      const parsed=spec.parseLui(await readFile(file,'utf8'));
      const own=spec.readComponentProperties(await readFile(file+'.lua','utf8'));
      assert.equal(own.error,undefined,file);
      const imports=spec.namespaceImports(parsed).map(i=>({...i,components}));
      assert.deepEqual([...parsed.diagnostics.filter(d=>d.severity==='error'),...spec.validateComponentProperties(parsed,imports,own.properties)],[],file);
      designs++;
    }
  }
}
await visit(join(project,'scripts/Presentation'));
assert.equal(designs,14); assert.equal(components.filter(c=>/^[A-Z]/.test(c.name)).length,5);
console.log(JSON.stringify({designs,controls:5,explicitInterfaces:true,oldInterfaceReferences:0}));
