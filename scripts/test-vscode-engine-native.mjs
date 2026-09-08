// Actual VS Code Webview transport + its production EnginePreviewHost.
// Uses an isolated profile; never installs extensions or changes security flags.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),game=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Usage: node scripts/test-vscode-engine-native.mjs <game-font-project> [output-directory]');
const executable=process.env.VSCODE_EXECUTABLE;
if(!executable)throw new Error('Set VSCODE_EXECUTABLE to Code.exe');
const profile=await mkdtemp(join(tmpdir(),'lui-native-engine-260-'));
const workspace=join(profile,'project'),output=resolve(process.argv[3]||'artifacts/vscode-engine-native-20260906');
await mkdir(join(workspace,'scripts/LUI'),{recursive:true});await mkdir(output,{recursive:true});
const sourceConfig=JSON.parse(await readFile(join(game,'scripts/LUI/lui.project.json'),'utf8'));
await cp(join(root,'runtime/urhox-lua'),join(workspace,'scripts/LUI'),{recursive:true});
const manifestBytes=await readFile(join(workspace,'scripts/LUI/runtime-manifest.json')),manifest=JSON.parse(manifestBytes);
const config={schemaVersion:4,version:manifest.version,layoutContract:manifest.layoutContract,runtimeManifestHash:createHash('sha256').update(manifestBytes).digest('hex'),sourceRoots:['Presentation'],componentDirectories:['Presentation/Components'],fonts:sourceConfig.fonts,theme:sourceConfig.theme};
for(const family of config.fonts)for(const font of Object.values(family.weights)){
  if(!/^Fonts\/(?:[\w-]+\/)*[\w-]+\.ttf$/.test(font.resource))throw new Error('Invalid fixture font path');
  const dest=join(workspace,'assets',font.resource);await mkdir(dirname(dest),{recursive:true});
  await copyFile(join(game,'assets',font.resource),dest);
}
await writeFile(join(workspace,'scripts/LUI/lui.project.json'),JSON.stringify(config,null,2));
await writeFile(join(workspace,'scripts/LUI/Registry.lua'),`local component={name='TestCard',displayName='测试卡片',directory='Presentation/Components',markup='Presentation/Components/TestCard.lui',code='Presentation/Components/TestCard.lui.lua'}
local page={name='NativeEngine',displayName='NativeEngine',markup='Presentation/NativeEngine.lui',code='Presentation/NativeEngine.lui.lua'}
return {pages={NativeEngine=page},controls={TestCard=component},directoryComponents={['Presentation/Components']={['测试卡片']=component}},Get=function(self,name)return self.pages[name]or self.controls[name]end,GetDirectoryComponent=function(self,directory,name)return self.directoryComponents[directory]and self.directoryComponents[directory][name]end}`,'utf8');
await mkdir(join(profile,'User'),{recursive:true});
await writeFile(join(profile,'User/settings.json'),JSON.stringify({'workbench.startupEditor':'none','window.restoreWindows':'none','window.newWindowDimensions':'maximized','files.autoSave':'off'}));
// Seed the same hash-validated vendor cache. Production acquireEngine still
// verifies each entry and may fetch missing immutable resources normally.
await cp(join(root,'artifacts/engine-cache'),join(profile,'User/globalStorage/sagelemi.lui-vscode/engine-cache'),{recursive:true});
const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port;await new Promise(done=>server.close(done));
const report=join(output,'report.json'),logPath=join(profile,'test-host.log');
await writeFile(report,JSON.stringify({passed:false,stage:'launching',profile,workspace,log:logPath},null,2));
const log=createWriteStream(logPath);
const args=[workspace,'--disable-extensions','--skip-welcome','--skip-release-notes','--user-data-dir',profile,'--extensions-dir',join(profile,'extensions'),'--extensionDevelopmentPath',root,'--extensionTestsPath',join(root,'tests/vscode-engine-native.cjs'),'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`];
const child=spawn(executable,args,{windowsHide:true,env:{...process.env,LUI_TEST_PROJECT:workspace,LUI_TEST_OUTPUT:output,LUI_TEST_CDP_PORT:String(port)},stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log);child.stderr.pipe(log);
const timeout=setTimeout(()=>child.kill(),180000);
let code;
try{code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done);});}finally{clearTimeout(timeout);log.end();}
const result=JSON.parse(await readFile(report,'utf8'));
result.launcher={profile,workspace,log:logPath,executable,args,exitCode:code};
await writeFile(report,JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,stage:result.stage,checks:result.checks,report,log:logPath,exitCode:code},null,2));
if(code!==0||!result.passed)throw new Error(`Native Webview/engine test failed (${code}); report: ${report}; log: ${logPath}`);
