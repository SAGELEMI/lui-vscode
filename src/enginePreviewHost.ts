import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const official = 'https://tapcode-sce.spark.xd.com/src/engine/';
const loader = 'https://tapcode-sce.spark.xd.com/src/web/src/index.min.js';
const engineResources = 'https://tapcode-sce.spark.xd.com/src/engine-res/';
export const ENGINE_LOCK = { version: '1.29.7', binary: 'a3ca9278' };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Entry = { uuid: string; ext: string; hash: string; size: number; fs_path: string };
type Resource = { bytes: Buffer; type: string };
const mime = (path: string) => path.endsWith('.js') ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.html') ? 'text/html' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream';

/** Cache immutable official bytes, never bundle or patch engine binaries. */
export async function acquireEngine(cache: string): Promise<Map<string, Resource>> {
  await mkdir(cache, { recursive: true });
  async function cached(url: string, size?: number): Promise<Buffer> {
    if (!url.startsWith(official) && !url.startsWith(engineResources) && url !== loader) throw new Error('非官方引擎资源');
    const key = hash(Buffer.from(url)); const file = join(cache, key);
    try {
      const bytes = await readFile(file); const record = JSON.parse(await readFile(file + '.json', 'utf8'));
      if (record.url === url && record.sha256 === hash(bytes) && (!size || bytes.length === size)) return bytes;
    } catch { /* Missing or damaged cache is fetched again. */ }
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`引擎资源 HTTP ${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 100 * 1024 * 1024 || (size && bytes.length !== size)) throw new Error('引擎资源长度不匹配');
    // Atomic replacement means interrupted downloads are never considered valid.
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temp, bytes); await rename(temp, file);
    await writeFile(file + '.json', JSON.stringify({ url, sha256: hash(bytes), bytes: bytes.length }));
    return bytes;
  }
  const release = JSON.parse((await cached(official + ENGINE_LOCK.version + '/version.json')).toString());
  if (release.version !== ENGINE_LOCK.version) throw new Error('真实预览引擎版本不匹配');
  const manifestBytes = await cached(`${official}${release.version}/manifest-${release.client}.json`);
  const manifest = JSON.parse(manifestBytes.toString());
  const entries: Entry[] = Array.isArray(manifest.files) ? manifest.files : Object.values(manifest.files ?? {});
  const resources = new Map<string, Resource>();
  const fingerprints: Record<string, string> = {};
  let resourcePackage: Buffer|undefined;
  for (const name of ['version.json', 'UrhoXRuntime.js', 'UrhoXRuntime.data', 'UrhoXRuntime.wasm']) {
    const entry = entries.find(e => e.fs_path === name);
    if (!entry || !/^[\w-]+$/.test(entry.uuid) || !/^[\da-f]+$/i.test(entry.hash)) throw new Error(`引擎清单缺少 ${name}`);
    const path = `assets/${entry.uuid}-${entry.hash}${entry.ext}`;
    const bytes = await cached(official + path, entry.size);
    if(name==='UrhoXRuntime.data')resourcePackage=bytes;
    resources.set('engine/' + path, { bytes, type: mime(name) }); fingerprints[name] = hash(bytes);
    if (name === 'version.json' && JSON.parse(bytes.toString()).binary_hash !== ENGINE_LOCK.binary) throw new Error('真实预览二进制指纹不匹配');
  }
  const json = (path: string, value: unknown) => resources.set(path, { bytes: Buffer.from(JSON.stringify(value)), type: 'application/json' });
  json('latest.json', { version: 'preview', engine: 'local' });
  json('preview/engine-local.json', { version: ENGINE_LOCK.version, base_url: './engine/' });
  json(`engine/${ENGINE_LOCK.version}/version.json`, release);
  resources.set(`engine/${ENGINE_LOCK.version}/manifest-${release.client}.json`, { bytes: manifestBytes, type: 'application/json' });
  const loaderBytes = await cached(loader);
  // Plugin-viewer skips game bootstrap's canonical resource-name registration.
  // Materialize only vendor library/font resources from the untouched bundle,
  // using the same-version vendor manifest (never the project's reference copy).
  const resRelease=JSON.parse((await cached(engineResources+ENGINE_LOCK.version+'/version.json')).toString());
  const resManifest=JSON.parse((await cached(`${engineResources}${resRelease.version}/manifest-${resRelease.client}.json`)).toString());
  const packaged:Record<string,string>={};
  if(!resourcePackage||resourcePackage.subarray(0,8).toString()!=='URXRES1\0')throw new Error('未知引擎资源包格式');
  const headerSize=resourcePackage.readUInt32LE(8),offset=12+headerSize;
  const header=JSON.parse(resourcePackage.subarray(12,offset).toString());
  if(header.version!==ENGINE_LOCK.version||header.client!==resRelease.client)throw new Error('引擎资源清单版本不匹配');
  for(const entry of resManifest.files as Entry[]){
    if(!/^(urhox-libs\/.*\.lua|Fonts\/.*\.(ttf|otf))$/.test(entry.fs_path)||entry.fs_path.includes('..'))continue;
    const packed=header.files.find((file:{path:string})=>file.path===`assets/${entry.uuid}-${entry.hash}${entry.ext}`);
    if(!packed||packed.size!==entry.size||offset+packed.offset+packed.size>resourcePackage.length)throw new Error(`引擎资源缺失：${entry.fs_path}`);
    packaged[entry.fs_path]=resourcePackage.subarray(offset+packed.offset,offset+packed.offset+packed.size).toString('base64');
  }
  json('vendor-resources.json',packaged);
  resources.set('loader.js', { bytes: loaderBytes, type: 'text/javascript' });
  json('identity.json', { ...ENGINE_LOCK, files: fingerprints, loaderSha256: hash(loaderBytes), manifestSha256: hash(manifestBytes) });
  return resources;
}

export class EnginePreviewHost {
  public onPick?: (selection: {revision:number;sourcePath:string;nodePath:string;probe:unknown})=>void;
  private server?: Server;
  private resources = new Map<string, Resource>();
  private snapshot: unknown = null;
  private revision = 0;
  private readonly token = randomBytes(24).toString('hex');
  public url = '';
  public async start(cache: string, runtime: string, fonts: Array<{ path: string; bytes: Uint8Array; sha256: string }>): Promise<void> {
    this.resources = await acquireEngine(cache);
    const files: Record<string, string> = {};
    files['Presentation/Components.lua']=Buffer.from('return {}\n').toString('base64');
    for (const file of await readdir(runtime)) if (/^[\w-]+\.lua$/.test(file)) files[`LUI/${file}`] = (await readFile(join(runtime, file))).toString('base64');
    for (const font of fonts) {
      if (!/^Fonts\/(?:[\w-]+\/)*[\w-]+\.ttf$/.test(font.path) || hash(font.bytes) !== font.sha256) throw new Error(`字体资源校验失败：${font.path}`);
      files[font.path] = Buffer.from(font.bytes).toString('base64');
    }
    this.resources.set('runtime.json', { bytes: Buffer.from(JSON.stringify(files)), type: 'application/json' });
    const identity=JSON.parse(this.resources.get('identity.json')!.bytes.toString());
    identity.runtimeFiles=Object.fromEntries(Object.entries(files).map(([path,bytes])=>[path,hash(Buffer.from(bytes,'base64'))]));
    this.resources.set('identity.json',{bytes:Buffer.from(JSON.stringify(identity)),type:'application/json'});
    this.resources.set('index.html', { bytes: Buffer.from(HOST_HTML), type: 'text/html' });
    this.resources.set('host.js', { bytes: Buffer.from(HOST_JS), type: 'text/javascript' });
    this.resources.set('engine-frame.html', { bytes: Buffer.from(ENGINE_HTML), type: 'text/html' });
    this.resources.set('bootstrap.lua', { bytes: Buffer.from(BOOTSTRAP), type: 'text/plain' });
    this.server = createServer((req, res) => {
      // Picking is an observation channel, never a source edit endpoint. Only
      // the isolated same-origin host may report a node in the latest snapshot.
      if(req.method==='POST'&&req.url===`/${this.token}/pick`&&req.headers.host===new URL(this.url).host&&req.headers.origin===new URL(this.url).origin&&req.headers['content-type']==='application/json'){
        let body='';req.on('data',chunk=>{body+=chunk;if(body.length>16384)req.destroy();});
        req.on('end',()=>{try{
          const pick=JSON.parse(body);
          const find=(node:any):boolean=>!!node&&(node.sourcePath===pick.sourcePath&&node.nodePath===pick.nodePath||(node.children??[]).some(find));
          if(pick.revision!==(this.snapshot as any)?.revision||typeof pick.sourcePath!=='string'||typeof pick.nodePath!=='string'||!find((this.snapshot as any)?.node)){res.writeHead(409).end();return;}
          this.onPick?.({revision:pick.revision,sourcePath:pick.sourcePath,nodePath:pick.nodePath,probe:pick.probe});res.writeHead(204).end();
        }catch{res.writeHead(400).end();}});return;
      }
      // No CORS, no arbitrary filesystem routes, no writes from the browser.
      if (req.method !== 'GET' || req.headers.host !== new URL(this.url).host || !req.url?.startsWith(`/${this.token}/`)) { res.writeHead(403).end(); return; }
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'");
      const path = req.url.slice(this.token.length + 2).split('?')[0] || 'index.html';
      const resource = path === 'snapshot.json' ? { bytes: Buffer.from(JSON.stringify({ revision: this.revision, snapshot: this.snapshot })), type: 'application/json' } : this.resources.get(path);
      if (!resource) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', resource.type); res.end(resource.bytes);
    });
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('本机预览监听失败');
    this.url = `http://127.0.0.1:${address.port}/${this.token}/`;
    // Loader resolves base_url as an absolute URL. Only the session route is exposed.
    this.resources.set('preview/engine-local.json', { bytes: Buffer.from(JSON.stringify({ version: ENGINE_LOCK.version, base_url: this.url + 'engine/' })), type: 'application/json' });
  }
  public update(snapshot: unknown): void {
    const incoming=(snapshot as {revision?:number})?.revision,previous=(this.snapshot as {revision?:number}|null)?.revision;
    if(typeof incoming!=='number'||(typeof previous==='number'&&incoming<=previous))return;
    this.snapshot = snapshot; this.revision++;
    const identity=this.resources.get('identity.json');
    if(identity){const value=JSON.parse(identity.bytes.toString());value.snapshotSha256=hash(Buffer.from(JSON.stringify(snapshot)));value.themeSha256=hash(Buffer.from(JSON.stringify((snapshot as any)?.theme??null)));identity.bytes=Buffer.from(JSON.stringify(value));}
  }
  public dispose(): void { this.server?.close(); this.server?.closeAllConnections(); }
}

const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>LUI · UrhoX 真实预览</title><style>html,body{margin:0;background:#100b18;color:#eee;font:14px sans-serif}#status{padding:8px}iframe{display:block;border:0}#error{white-space:pre-wrap;color:#ffb7b7}</style></head><body><div id="status">真实预览未就绪：加载官方引擎…</div><div id="error"></div><script src="host.js"></script></body></html>`;

// The parent owns the source channel; the engine frame accepts only its parent.
const HOST_JS = String.raw`
const status=document.querySelector('#status'),error=document.querySelector('#error');
const base=new URL('./',location.href).href;
let latest=0,ready=false,pending=null;
if(!crossOriginIsolated){status.textContent='真实预览未就绪：此容器不支持跨源隔离，请在独立浏览器打开此地址。';}
else{
const frame=document.createElement('iframe');frame.allow='cross-origin-isolated';
frame.src=base+'engine-frame.html?mode=plugin-viewer&disableOPFS=true&game_url='+encodeURIComponent(base);
document.body.append(frame);
const send=(name,payload)=>frame.contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name,payload},location.origin);
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
 const d=event.data;if(d?.source!=='tap-plugin-viewer')return;
 if(d.name==='viewer-ready'){
  try{const files={...await(await fetch('vendor-resources.json')).json(),...await(await fetch('runtime.json')).json()};
   const fs=frame.contentWindow.Module.FS;
   for(const [path,b64] of Object.entries(files)){const full='/lui-preview/'+path;fs.mkdirTree(full.slice(0,full.lastIndexOf('/')));fs.writeFile(full,Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));}
   send('RunLuaSource',{source:await(await fetch('bootstrap.lua')).text()});status.textContent='真实预览未就绪：正在初始化 LUI Runtime…';
  }catch(e){error.textContent=String(e);}
 }
 if(d.name==='lui-preview-error')error.textContent=String(d.payload?.message??d.payload);
 if(d.name==='lui-preview-ready'){
  ready=true;
  const toggle=document.createElement('button');let selecting=true;toggle.textContent='节点选择：开';
  toggle.onclick=()=>{selecting=!selecting;toggle.textContent='节点选择：'+(selecting?'开':'关');};document.body.prepend(toggle);
  const canvas=frame.contentDocument.querySelector('canvas');
  canvas.addEventListener('pointerdown',event=>{if(!selecting||!pending)return;event.preventDefault();event.stopImmediatePropagation();const rect=canvas.getBoundingClientRect();send('LuiPreviewPick',{x:(event.clientX-rect.left)*pending.width/rect.width,y:(event.clientY-rect.top)*pending.height/rect.height});},true);
 }
 if(d.name==='lui-preview-pick'){
  const pick=d.payload;status.textContent='已选 '+pick.sourcePath+' #'+pick.nodePath;
  fetch('pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pick)}).catch(e=>{error.textContent=String(e);});
 }
 if(d.name==='lui-preview-applied'){error.textContent='';status.textContent='UrhoX 1.29.7 / a3ca9278 · LUI Runtime 已绘制 · 无业务脚本';frame.contentDocument.querySelector('#loading-screen').style.display='none';}
});
setInterval(async()=>{try{
 const d=await(await fetch('snapshot.json')).json();
 if(!ready||!d.snapshot||d.revision<=latest)return;
 pending=d.snapshot;frame.width=pending.width;frame.height=pending.height;
 send('LuiPreviewUpdate',pending);latest=d.revision;
}catch(e){error.textContent=String(e);}},150);
}
`;

const ENGINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}#loading-screen{position:absolute;top:0;color:white;background:#171024}#dialog-overlay{display:none}</style></head><body><canvas id="canvas"></canvas><div id="loading-screen"><span id="loading-status"></span><span id="loading-percent"></span><div id="loading-progress-bar"></div></div><div id="dialog-overlay"><h3 id="dialog-title"></h3><div id="dialog-message"></div><button id="dialog-confirm"></button><button id="dialog-cancel"></button></div><script src="loader.js"></script></body></html>`;

const BOOTSTRAP = String.raw`
package.path='/lui-preview/?.lua;/lui-preview/?/init.lua;'..package.path
cache:AddResourceDir('/lui-preview/')
-- Plugin-viewer has no game startup or translation requests.
_tr=_tr or function(value) return value end
local UI=require('urhox-libs/UI')
package.loaded['Presentation.Components']={}
local Runtime=require('LUI.Runtime')
local runtime=setmetatable({config_={sourceRoots={},componentDirectories={}},documents_={},code_={},isV2_=true,fontFiles_={}},Runtime)
function runtime:LoadCode() error('真实预览禁止执行业务 Lua') end
function runtime:LoadDocument() error('真实预览只接收当前文档快照') end
local function emit(name,payload)
 local data=VariantMap();data['name']=name;data['payload']=cjson.encode(payload);SendEvent('EmitToPlugin',data)
end
local initialized=false
local visualConfiguration
local revision=-1
local root
local modals={}
local activeModals={}
local buildNode=runtime.BuildNode
function runtime:BuildNode(node,context)
 local widget=buildNode(self,node,context)
 if node.tag=='Modal' and widget then modals[#modals+1]=widget end
 return widget
end
function LuiPreviewUpdate(_,event)
 local ok,err=xpcall(function()
  local next=cjson.decode(event['json']:GetString())
  if next.revision<=revision then return end
  local configuration=cjson.encode({theme=next.theme or false,fonts=next.fonts or {}})
  if initialized and visualConfiguration~=configuration then
   error('字体或主题已改变，请重新打开真实预览以重新初始化原生控件。')
  end
  if not initialized then
   UI.Init({theme=next.theme and UI.Theme.ExtendTheme(UI.Theme.defaultTheme,next.theme) or 'default-dark',scale=UI.Scale.DPR,autoEvents=true,fonts=next.fonts or {}})
   for _,family in ipairs(next.fonts or {}) do for weight,path in pairs(family.weights or {}) do runtime.fontFiles_[family.family..':'..weight]=path end end
   initialized=true
   visualConfiguration=configuration
  end
  modals={}
  local context={view={},props={},refs={},actions={},imports={},componentStack={}}
  local content=assert(runtime:BuildNode(next.node,context),'空预览文档')
  -- Modal:Open auto-mounts when parentless. A neutral host prevents a root
  -- modal from mounting itself, and allows component documents to be viewed.
  local candidate=UI.Panel{width='100%',height='100%',backgroundColor={0,0,0,0},children={content}}
  local reported=false
  runtime:AfterLayout(candidate,function(_,vg)
   if reported then return end
   reported=true
   local passed,checkError=xpcall(function()
    if next.runChecks then require('LUI.LayoutChecks').Run(runtime,vg) end
   end,debug.traceback)
   if not passed then emit('lui-preview-error',{message=checkError});return end
   if not next.runOverlayChecks then emit('lui-preview-applied',{revision=revision,checks=next.runChecks==true}) end
  end)
  local previous=root
  for _,modal in ipairs(activeModals) do modal:Close() end
  UI.SetRoot(candidate);root=candidate;revision=next.revision
  for _,modal in ipairs(modals) do modal:Open() end
  activeModals=modals
  if previous then previous:Destroy() end
  if next.runOverlayChecks then
   require('LUI.LayoutChecks').StartOverlays(runtime,function(passed,message)
    if passed then emit('lui-preview-applied',{revision=revision,overlayChecks=message})
    else emit('lui-preview-error',{message=message}) end
   end)
  end
 end,debug.traceback)
 if not ok then emit('lui-preview-error',{message=tostring(err)}) end
end
function LuiPreviewPick(_,event)
 local ok,err=xpcall(function()
  if not root then return end
  local point=cjson.decode(event['json']:GetString())
  local function find(widget)
   local rect=runtime:GetScreenRect(widget)
   if not rect or point.x<rect.x or point.x>rect.x+rect.w or point.y<rect.y or point.y>rect.y+rect.h then return end
   local children=widget.GetHitTestChildren and widget:GetHitTestChildren() or nil
   children=children or widget:GetRenderChildren()
   for i=#children,1,-1 do local target=find(children[i]);if target then return target end end
   if widget.luiSourcePath_ then return widget end
  end
  local target=find(root)
  if target then emit('lui-preview-pick',{revision=revision,sourcePath=target.luiSourcePath_,nodePath=target.luiNodePath_,probe=runtime:LayoutProbe(target)[1]}) end
 end,debug.traceback)
 if not ok then emit('lui-preview-error',{message=tostring(err)}) end
end
SubscribeToEvent('LuiPreviewUpdate','LuiPreviewUpdate')
SubscribeToEvent('LuiPreviewPick','LuiPreviewPick')
emit('lui-preview-ready',{})
`;
