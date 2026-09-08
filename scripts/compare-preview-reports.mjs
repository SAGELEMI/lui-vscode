// Same-device visual regression evidence; differing hashes require inspection.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const baseline=resolve(process.argv[2]||'artifacts/validation-a9a4a7c17687');
const output=resolve(process.argv[3]||'artifacts/preview-visual-regression.json');
const groups=[
 ['matrix','project-declaration-engine.json','artifacts/project-declaration-engine/report.json'],
 ['scalar','engine-parity.json','artifacts/engine-parity-20260906/report.json'],
 ['components','engine-component-parity.json','artifacts/engine-parity-components-20260906/report.json'],
];
const result={scope:'Compare raw rendered SHA256 by source/scene/viewport or fixture name against the archived a9a4 release. A difference is evidence to inspect, not automatically an accepted timing change.',identical:true,groups:[]};
for(const[name,oldPath,currentPath]of groups){
 const previous=JSON.parse(await readFile(resolve(baseline,oldPath),'utf8')),current=JSON.parse(await readFile(resolve(currentPath),'utf8'));
 assert.equal(previous.passed,true,oldPath);assert.equal(current.passed,true,currentPath);
 const key=row=>name==='matrix'?JSON.stringify([row.source,row.scene,row.width,row.height]):row.name;
 const oldCases=new Map(previous.cases.map(row=>[key(row),row])),newCases=new Map(current.cases.map(row=>[key(row),row]));
 assert.equal(oldCases.size,newCases.size,'case coverage changed: '+name);
 const changes=[];
 for(const[k,row]of newCases){
  const old=oldCases.get(k);assert.ok(old,'new case has no baseline: '+k);
  const fields=name==='matrix'?['sha256']:['sourceSha256','snapshotSha256'];
  const differences=fields.filter(field=>old[field]!==row[field]).map(field=>({field,previous:old[field],current:row[field]}));
  if(differences.length)changes.push({key:k,differences});
 }
 const group={name,cases:newCases.size,unchanged:newCases.size-changes.length,changed:changes.length,previousRuntime:previous.runtime,currentRuntime:current.runtime,changes};
 result.groups.push(group);if(changes.length)result.identical=false;
 console.log(JSON.stringify({name,cases:group.cases,unchanged:group.unchanged,changed:group.changed,previousHash:previous.runtime.manifestHash,currentHash:current.runtime.manifestHash}));
}
await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({identical:result.identical,report:output}));
if(process.argv.includes('--require-identical'))assert.equal(result.identical,true,'visual hashes changed; inspect '+output);
