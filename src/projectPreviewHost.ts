import { createServer, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { acquireEngine, ENGINE_LOCK } from "./enginePreviewHost.js";

type Resource = { bytes: Buffer; type: string };

export interface ProjectPreviewInput {
  entry: string;
  files: ReadonlyMap<string, Uint8Array>;
  sourcePaths: ReadonlySet<string>;
  title?: string;
  device?: string;
}

export interface ProjectPreviewSelection {
  sourcePath: string;
  nodePath: string;
  instancePath?: string;
}

function projectResources(input: ProjectPreviewInput): Resource {
  const files: Record<string, string> = {};
  for (const [path, bytes] of input.files) files[path] = Buffer.from(bytes).toString("base64");
  return { bytes: Buffer.from(JSON.stringify(files)), type: "application/json" };
}

function bootstrap(entry: string): string {
  return String.raw`
package.path='/lui-project/?.lua;/lui-project/?/init.lua;'..package.path
cache:AddResourceDir('/lui-project/')
_tr=_tr or function(value) return value end
local nativeCache=cache
if type(nativeCache.GetResUuid)~='function' or type(nativeCache.GetFile)~='function' then
 local previewCache={}
 local function openResource(path)
  local file=File('/lui-project/'..tostring(path):gsub('^/+',''),FILE_READ)
  if file and file:IsOpen() then return file end
  if file then file:Close() end
 end
 function previewCache:GetFile(path) return openResource(path) end
 function previewCache:GetResUuid(path)
  local file=openResource(tostring(path)..'.meta')
  if not file then return '' end
  local ok,value=pcall(cjson.decode,file:ReadString());file:Close()
  return ok and type(value)=='table' and tostring(value.uuid or '') or ''
 end
 function previewCache:GetResUuidPath(path)
  local uuid=self:GetResUuid(path);return uuid~='' and 'uuid://'..uuid or ''
 end
 setmetatable(previewCache,{__index=function(_,name)
  local value=nativeCache[name]
  if type(value)=='function' then return function(_,... ) return value(nativeCache,...) end end
  return value
 end})
 cache=previewCache
end
local function emit(name,payload)
 local data=VariantMap();data['name']=name;data['payload']=cjson.encode(payload);SendEvent('EmitToPlugin',data)
end
local function pick(_,event)
 local ok,err=xpcall(function()
  local point=cjson.decode(event['json']:GetString())
  local UI=require('urhox-libs/UI')
  local target=UI.FindWidgetAt(point.x,point.y)
  while target and not target.luiSourcePath_ do target=target.parent end
  if target then emit('lui-project-pick',{sourcePath=target.luiSourcePath_,nodePath=target.luiNodePath_,instancePath=target.luiInstancePath_}) end
 end,debug.traceback)
 if not ok then emit('lui-project-error',{message=tostring(err)}) end
end
SubscribeToEvent('LuiProjectPreviewPick',pick)
local ok,err=xpcall(function()
 if engine and type(engine.SetMaxFps)=='function' then engine:SetMaxFps(60) end
 if engine and type(engine.SetMaxInactiveFps)=='function' then engine:SetMaxInactiveFps(30) end
 local chunk,loadError=loadfile('/lui-project/'..${JSON.stringify(entry)})
 assert(chunk,loadError)
 chunk()
 assert(type(Start)=='function','项目入口没有定义 Start()')
 Start()
 local UI=require('urhox-libs/UI')
 emit('lui-project-ready',{entry=${JSON.stringify(entry)},width=UI.GetWidth(),height=UI.GetHeight()})
end,debug.traceback)
if not ok then emit('lui-project-error',{message=tostring(err)}) end
`;
}

export class ProjectPreviewHost {
  public onPick?: (selection: ProjectPreviewSelection) => void;
  public onRefreshRequested?: () => Promise<void>;
  public url = "";
  private server?: Server;
  private resources = new Map<string, Resource>();
  private input?: ProjectPreviewInput;
  private readonly token = randomBytes(24).toString("hex");
  private readonly events = new Set<ServerResponse>();

  public async start(cache: string, input: ProjectPreviewInput): Promise<void> {
    if (this.server) return;
    this.input = input;
    this.resources = await acquireEngine(cache);
    this.installProjectResources(input);
    this.resources.set("index.html", { bytes: Buffer.from(PROJECT_HOST_HTML), type: "text/html" });
    this.resources.set("host.js", { bytes: Buffer.from(PROJECT_HOST_JS), type: "text/javascript" });
    this.resources.set("engine-frame.html", { bytes: Buffer.from(PROJECT_ENGINE_HTML), type: "text/html" });
    this.server = createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => { this.server!.off("error", reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("本机项目预览监听失败");
    this.url = `http://127.0.0.1:${address.port}/${this.token}/`;
    this.resources.set("preview/engine-local.json", { bytes: Buffer.from(JSON.stringify({ version: ENGINE_LOCK.version, base_url: this.url + "engine/" })), type: "application/json" });
  }

  public update(input: ProjectPreviewInput, restart: boolean): void {
    this.input = input;
    this.installProjectResources(input);
    if (restart) this.emit("restart");
  }

  public markDirty(): void { this.emit("dirty"); }
  public reveal(): void { this.emit("focus"); }

  public dispose(): void {
    for (const response of this.events) response.end();
    this.events.clear();
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = undefined;
  }

  private installProjectResources(input: ProjectPreviewInput): void {
    this.resources.set("project-resources.json", projectResources(input));
    this.resources.set("bootstrap.lua", { bytes: Buffer.from(bootstrap(input.entry)), type: "text/plain" });
    this.resources.set("project.json", { bytes: Buffer.from(JSON.stringify({ entry: input.entry, title: input.title ?? "LUI 项目预览", device: input.device ?? "390x844" })), type: "application/json" });
  }

  private headers(response: ServerResponse): void {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'");
  }

  private sameOrigin(request: import("node:http").IncomingMessage): boolean {
    if (!this.url || request.headers.host !== new URL(this.url).host) return false;
    return request.headers.origin === undefined || request.headers.origin === new URL(this.url).origin;
  }

  private async handle(request: import("node:http").IncomingMessage, response: ServerResponse): Promise<void> {
    if (!request.url?.startsWith(`/${this.token}/`) || !this.sameOrigin(request)) { response.writeHead(403).end(); return; }
    this.headers(response);
    const route = request.url.slice(this.token.length + 2).split("?")[0] || "index.html";
    if (request.method === "GET" && route === "events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      response.write("event: connected\ndata: {}\n\n");
      this.events.add(response);
      request.on("close", () => this.events.delete(response));
      return;
    }
    if (request.method === "POST" && route === "refresh") {
      try { await this.onRefreshRequested?.(); response.writeHead(204).end(); }
      catch (error) { response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (request.method === "POST" && route === "pick" && request.headers["content-type"] === "application/json") {
      let body = "";
      request.on("data", chunk => { body += chunk; if (body.length > 16_384) request.destroy(); });
      request.on("end", () => {
        try {
          const pick = JSON.parse(body) as ProjectPreviewSelection;
          if (!this.input || typeof pick.sourcePath !== "string" || typeof pick.nodePath !== "string" || !this.input.sourcePaths.has(pick.sourcePath)) { response.writeHead(409).end(); return; }
          this.onPick?.(pick); response.writeHead(204).end();
        } catch { response.writeHead(400).end(); }
      });
      return;
    }
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    const resource = this.resources.get(route);
    if (!resource) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", resource.type);
    response.end(resource.bytes);
  }

  private emit(event: "dirty" | "restart" | "focus"): void {
    for (const response of this.events) response.write(`event: ${event}\ndata: {}\n\n`);
  }
}

const PROJECT_HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>LUI 项目预览</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#100b18;color:#eee;font:14px sans-serif}.toolbar{height:42px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#191126;border-bottom:1px solid #433256;box-sizing:border-box}.toolbar button,.toolbar select{color:#eee;background:#302140;border:1px solid #5c4374;border-radius:5px;padding:5px 10px}.toolbar button.active{background:#6842a0;border-color:#a478e1}#status{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#stage{height:calc(100% - 42px);overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:12px;box-sizing:border-box}#error{position:absolute;z-index:3;top:50px;left:10px;right:10px;max-height:40%;overflow:auto;white-space:pre-wrap;color:#ffb7b7;background:#291622e8;padding:10px;border-radius:6px;display:none}iframe{display:block;flex:0 0 auto;border:1px solid #433256;background:#000}
</style></head><body><div class="toolbar"><button id="select">选取节点：关</button><button id="refresh">刷新项目</button><label>设备 <select id="device"><option>358x425</option><option>377x496</option><option>360x800</option><option selected>390x844</option><option>640x1024</option><option>768x1024</option></select></label><span id="status">正在加载项目…</span></div><div id="stage"></div><div id="error"></div><script src="host.js"></script></body></html>`;

const PROJECT_HOST_JS = String.raw`
const base=new URL('./',location.href).href,status=document.querySelector('#status'),error=document.querySelector('#error'),stage=document.querySelector('#stage');
const selectButton=document.querySelector('#select'),refreshButton=document.querySelector('#refresh'),device=document.querySelector('#device');
let frame,selecting=false,logical={width:innerWidth,height:innerHeight-42},stale=false,restarting=false;
const showError=value=>{error.textContent=String(value??'');error.style.display=value?'block':'none';};
const send=(name,payload)=>frame?.contentWindow?.postMessage({source:'tap-plugin-host',kind:'event',name,payload},location.origin);
selectButton.onclick=()=>{selecting=!selecting;selectButton.classList.toggle('active',selecting);selectButton.textContent='选取节点：'+(selecting?'开':'关');};
async function stopFrame(){if(!frame)return;send('RunLuaSource',{source:"if type(Stop)=='function' then pcall(Stop) end"});await new Promise(resolve=>setTimeout(resolve,40));frame.remove();frame=undefined;}
async function startFrame(){
 if(restarting)return;restarting=true;showError('');status.textContent='正在启动项目…';
 try{
  await stopFrame();
  const [width,height]=device.value.split('x').map(Number);const next=document.createElement('iframe');next.allow='cross-origin-isolated';next.width=String(width);next.height=String(height);next.style.width=width+'px';next.style.height=height+'px';next.src=base+'engine-frame.html?mode=plugin-viewer&disableOPFS=false&game_url='+encodeURIComponent(base);stage.append(next);frame=next;
 }finally{restarting=false;}
}
refreshButton.onclick=async()=>{refreshButton.disabled=true;try{const response=await fetch('refresh',{method:'POST'});if(!response.ok)throw Error(await response.text());stale=false;await startFrame();}catch(e){showError(e);}finally{refreshButton.disabled=false;}};
device.onchange=()=>{stale=false;void startFrame();};
window.addEventListener('message',async event=>{
 if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
 const message=event.data;if(message?.source!=='tap-plugin-viewer')return;
 if(message.name==='viewer-ready'){
  try{
   const files={...await(await fetch('vendor-resources.json')).json(),...await(await fetch('project-resources.json')).json()};const fs=frame.contentWindow.Module.FS;
   for(const [path,b64] of Object.entries(files)){const full='/lui-project/'+path;fs.mkdirTree(full.slice(0,full.lastIndexOf('/')));fs.writeFile(full,Uint8Array.from(atob(b64),character=>character.charCodeAt(0)));}
   send('RunLuaSource',{source:await(await fetch('bootstrap.lua')).text()});
  }catch(e){showError(e);}
 }
 if(message.name==='lui-project-ready'){
  logical=message.payload||logical;status.textContent='项目运行中'+(stale?' · 源码已有改动':'');
  frame.contentDocument.querySelector('#loading-screen').style.display='none';
  const canvas=frame.contentDocument.querySelector('canvas');
  canvas.addEventListener('pointerdown',event=>{
   if(!selecting&&!event.altKey)return;
   event.preventDefault();event.stopImmediatePropagation();
   const rect=canvas.getBoundingClientRect();send('LuiProjectPreviewPick',{x:(event.clientX-rect.left)*logical.width/rect.width,y:(event.clientY-rect.top)*logical.height/rect.height});
  },true);
 }
 if(message.name==='lui-project-pick'){
  const pick=message.payload;status.textContent='已定位 '+pick.sourcePath+' #'+pick.nodePath+(stale?' · 源码已有改动':'');
  fetch('pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pick)}).catch(showError);
 }
 if(message.name==='lui-project-error')showError(message.payload?.message??message.payload);
});
const events=new EventSource('events');
events.addEventListener('dirty',()=>{stale=true;status.textContent='项目运行中 · 源码已有改动';});
events.addEventListener('restart',()=>{stale=false;void startFrame();});
events.addEventListener('focus',()=>window.focus());
if(!crossOriginIsolated)showError('浏览器未启用跨源隔离，请确认地址由 LUI 项目预览服务打开。');else void (async()=>{try{const project=await(await fetch('project.json')).json();if([...device.options].some(option=>option.value===project.device))device.value=project.device;}catch{}await startFrame();})();
`;

const PROJECT_ENGINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}#loading-screen{position:absolute;top:0;color:white;background:#171024}#dialog-overlay{display:none}</style></head><body><canvas id="canvas"></canvas><div id="loading-screen"><span id="loading-status"></span><span id="loading-percent"></span><div id="loading-progress-bar"></div></div><div id="dialog-overlay"><h3 id="dialog-title"></h3><div id="dialog-message"></div><button id="dialog-confirm"></button><button id="dialog-cancel"></button></div><script src="loader.js"></script></body></html>`;
