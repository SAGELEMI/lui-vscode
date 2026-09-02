import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import { parseLui, editAttribute, displayNameOf, type LuiDocument, type LuiNode } from "../packages/spec/src/index.js";

const RUNTIME_DIRECTORY = ["scripts", "LUI"] as const;
const CONFIG_FILE = "lui.project.json";
const MANIFEST_FILE = "runtime-manifest.json";

interface RuntimeStatus {
  root: vscode.Uri;
  installed: boolean;
  version?: string;
  message: string;
}

interface WebviewMessage {
  type: "ready" | "setAttribute" | "select" | "addChild" | "deploy";
  start?: number;
  name?: string;
  value?: string;
  tag?: string;
}

const LUI_SELECTOR: vscode.DocumentSelector = { language: "lui", scheme: "file" };
const PRIMARY_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const TAGS = ["Panel", "Row", "Text", "Button", "Card", "Scroll", "Progress", "Toggle", "Slider", "SafeArea", "Modal", "Header", "EquipmentSlots", "lui:If", "lui:For", "lui:Slot", "lui:Preview"];

/** Explorer decorations never replace the user's selected icon theme; they mark LUI files immediately. */
function registerExplorerDecorations(context: vscode.ExtensionContext): void {
  const luiDecoration = new vscode.FileDecoration("LU", "LUI 设计文件", new vscode.ThemeColor("terminal.ansiMagenta"));
  context.subscriptions.push(vscode.window.registerFileDecorationProvider({
    provideFileDecoration(uri) {
      return uri.scheme === "file" && uri.path.toLowerCase().endsWith(".lui") ? luiDecoration : undefined;
    }
  }));
}

function nodeAt(node: LuiNode | undefined, offset: number): LuiNode | undefined {
  if (!node || offset < node.range.start || offset > node.range.end) return undefined;
  for (const child of node.children) {
    const nested = nodeAt(child, offset);
    if (nested) return nested;
  }
  return node;
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function uriPath(root: vscode.Uri, ...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(root, ...segments);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

async function readJson(uri: vscode.Uri): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8")) as Record<string, unknown>; } catch { return undefined; }
}

async function runtimeStatus(root = workspaceRoot()): Promise<RuntimeStatus | undefined> {
  if (!root) return undefined;
  const directory = uriPath(root, ...RUNTIME_DIRECTORY);
  const config = uriPath(directory, CONFIG_FILE);
  const manifest = uriPath(directory, MANIFEST_FILE);
  if (!(await exists(config)) || !(await exists(manifest))) {
    return { root, installed: false, message: "未发现 scripts/LUI 运行时部署。" };
  }
  const parsed = await readJson(manifest);
  return { root, installed: true, version: typeof parsed?.version === "string" ? parsed.version : "未知", message: "UrhoX/Lua 运行时已部署。" };
}

function findNode(node: LuiNode | undefined, start: number): LuiNode | undefined {
  if (!node || node.range.start !== start) {
    if (!node) return undefined;
    for (const child of node.children) {
      const found = findNode(child, start);
      if (found) return found;
    }
    return undefined;
  }
  return node;
}

function createUuid(): string { return randomBytes(18).toString("base64url"); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

async function collectAdapterFiles(source: vscode.Uri, relative = ""): Promise<Array<[string, vscode.Uri]>> {
  const result: Array<[string, vscode.Uri]> = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(source)) {
    const path = relative ? `${relative}/${name}` : name;
    const child = vscode.Uri.joinPath(source, name);
    if (type === vscode.FileType.Directory) result.push(...await collectAdapterFiles(child, path));
    else result.push([path, child]);
  }
  return result;
}

async function writeMetaIfAbsent(root: vscode.Uri, destination: vscode.Uri): Promise<void> {
  const meta = vscode.Uri.file(`${destination.fsPath}.meta`);
  if (await exists(meta)) return;
  const rel = vscode.workspace.asRelativePath(meta, false);
  const current = await vscode.workspace.findFiles("**/*.meta", "**/{.git,node_modules}/**", 4096);
  const known = new Set<string>();
  for (const item of current) {
    const text = Buffer.from(await vscode.workspace.fs.readFile(item)).toString("utf8");
    const id = /"uuid"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    if (id) known.add(id);
  }
  let uuid = createUuid(); while (known.has(uuid)) uuid = createUuid();
  await vscode.workspace.fs.writeFile(meta, Buffer.from(JSON.stringify({ uuid }, null, 2) + "\n", "utf8"));
  void root; void rel;
}

/** 将早期按时间戳累积的运行时快照收敛为唯一可恢复的最新快照。 */
async function consolidateLegacyBackups(destinationRoot: vscode.Uri): Promise<void> {
  if (!(await exists(destinationRoot))) return;
  const backupRoot = vscode.Uri.joinPath(destinationRoot, ".backup-last");
  const legacy = (await vscode.workspace.fs.readDirectory(destinationRoot))
    .filter(([name, type]) => type === vscode.FileType.Directory && /^\.backup-\d+$/.test(name))
    .map(([name]) => name)
    .sort();
  if (legacy.length === 0) return;
  const latest = legacy[legacy.length - 1]!;
  if (!(await exists(backupRoot))) await vscode.workspace.fs.rename(vscode.Uri.joinPath(destinationRoot, latest), backupRoot, { overwrite: false });
  for (const name of legacy) {
    const folder = vscode.Uri.joinPath(destinationRoot, name);
    if (await exists(folder)) await vscode.workspace.fs.delete(folder, { recursive: true, useTrash: false });
  }
}

/** Installs only runtime-owned files. User LUI files and an existing project config are never overwritten. */
async function deployUrhoXLuaRuntime(context: vscode.ExtensionContext): Promise<void> {
  const root = workspaceRoot();
  if (!root) { vscode.window.showErrorMessage("请先打开一个项目工作区。 "); return; }
  const current = await runtimeStatus(root);
  const source = vscode.Uri.joinPath(context.extensionUri, "runtime", "urhox-lua");
  const destinationRoot = uriPath(root, ...RUNTIME_DIRECTORY);
  const files = await collectAdapterFiles(source);
  const differences: string[] = [];
  for (const [relative, sourceFile] of files) {
    const destination = vscode.Uri.joinPath(destinationRoot, ...relative.split("/"));
    if (relative === CONFIG_FILE || !(await exists(destination))) continue;
    const incoming = await vscode.workspace.fs.readFile(sourceFile);
    const previous = await vscode.workspace.fs.readFile(destination);
    if (sha256(incoming) !== sha256(previous)) differences.push(relative);
  }
  const differenceNote = differences.length ? `\n将保留一份旧运行时并更新：${differences.join("、")}` : "\n运行时文件哈希一致；仅会补齐缺失文件或元数据。";
  const action = await vscode.window.showInformationMessage(
    (current?.installed ? `已检测到 LUI ${current.version ?? ""}。是否备份并更新运行时？` : "未检测到 LUI 运行时。是否部署 UrhoX/Lua 适配包？") + differenceNote,
    current?.installed ? "更新" : "部署",
    "取消"
  );
  if (action === "取消" || !action) return;

  await consolidateLegacyBackups(destinationRoot);
  const backupRoot = vscode.Uri.joinPath(destinationRoot, ".backup-last");
  let backupPrepared = false;
  for (const [relative, sourceFile] of files) {
    const destination = vscode.Uri.joinPath(destinationRoot, ...relative.split("/"));
    if (relative === CONFIG_FILE && await exists(destination)) continue;
    const bytes = await vscode.workspace.fs.readFile(sourceFile);
    if (await exists(destination)) {
      const previous = await vscode.workspace.fs.readFile(destination);
      if (Buffer.compare(Buffer.from(previous), Buffer.from(bytes)) === 0) continue;
      if (!backupPrepared) {
        if (await exists(backupRoot)) await vscode.workspace.fs.delete(backupRoot, { recursive: true, useTrash: false });
        backupPrepared = true;
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(backupRoot, ...relative.split("/").slice(0, -1)));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(backupRoot, ...relative.split("/")), previous);
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(destinationRoot, ...relative.split("/").slice(0, -1)));
    await vscode.workspace.fs.writeFile(destination, bytes);
    await writeMetaIfAbsent(root, destination);
  }
  const config = uriPath(destinationRoot, CONFIG_FILE);
  if (!(await exists(config))) {
    const defaultConfig = {
      schemaVersion: 1,
      adapter: "urhox-lua",
      version: "0.1.0",
      sourceRoots: ["Presentation/Pages", "Presentation/Components", "Presentation/Modals"],
      documents: {}
    };
    await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify(defaultConfig, null, 2) + "\n", "utf8"));
    await writeMetaIfAbsent(root, config);
  }
  vscode.window.showInformationMessage(backupPrepared ? "LUI UrhoX/Lua 运行时已部署；上一版本保留在 .backup-last。" : "LUI UrhoX/Lua 运行时已部署；运行时内容未变化。");
}

class LuiPreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lui.preview";
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = previewHtml(webviewPanel.webview, this.context.extensionUri);
    const update = () => {
      const model = parseLui(document.getText());
      webviewPanel.webview.postMessage({ type: "model", model: serializableModel(model), device: vscode.workspace.getConfiguration("lui").get<string>("preview.defaultDevice", "360x800") });
    };
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => { if (event.document.uri.toString() === document.uri.toString()) update(); });
    webviewPanel.onDidDispose(() => subscription.dispose());
    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") { update(); return; }
      if (message.type === "deploy") { await deployUrhoXLuaRuntime(this.context); return; }
      if (typeof message.start !== "number") return;
      const current = parseLui(document.getText());
      const node = findNode(current.root, message.start);
      if (!node) return;
      if (message.type === "setAttribute" && message.name) {
        const next = editAttribute(document.getText(), node, message.name, message.value ?? "");
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), next);
        await vscode.workspace.applyEdit(edit);
      }
      if (message.type === "addChild" && message.tag) {
        const indent = "  ";
        const insert = node.closeTagStart ?? (node.openTagEnd ?? node.range.end) - 2;
        const child = `\n${indent}<${message.tag} x:Name="New${message.tag}" x:DisplayName="新建${message.tag}" />`;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, document.positionAt(insert), child);
        await vscode.workspace.applyEdit(edit);
      }
    });
    update();
  }
}

function serializableModel(document: LuiDocument): unknown {
  const map = (node: LuiNode): unknown => ({ kind: node.kind, tag: node.tag, text: node.text, start: node.range.start, displayName: displayNameOf(node), attrs: Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value])), children: node.children.map(map) });
  return { root: document.root ? map(document.root) : undefined, diagnostics: document.diagnostics };
}

function diagnosticFor(document: vscode.TextDocument, diagnostic: LuiDocument["diagnostics"][number]): vscode.Diagnostic {
  const range = new vscode.Range(document.positionAt(diagnostic.range.start), document.positionAt(diagnostic.range.end));
  return new vscode.Diagnostic(range, diagnostic.message, diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
}

function registerLanguageServices(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("lui");
  const refreshDiagnostics = (document: vscode.TextDocument) => {
    if (document.languageId !== "lui") return;
    diagnostics.set(document.uri, parseLui(document.getText()).diagnostics.map((item) => diagnosticFor(document, item)));
  };
  context.subscriptions.push(diagnostics, vscode.workspace.onDidOpenTextDocument(refreshDiagnostics), vscode.workspace.onDidChangeTextDocument((event) => refreshDiagnostics(event.document)), vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
  vscode.workspace.textDocuments.forEach(refreshDiagnostics);

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    provideCompletionItems() {
      return TAGS.map((tag) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
        item.insertText = new vscode.SnippetString("<" + tag + ' x:Name="${1:PrimaryName}" x:DisplayName="${2:副名称}"${3: />}');
        item.detail = "LUI 组件；x:Name 为 ASCII 运行时主名称";
        return item;
      });
    }
  }, "<"));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    provideCompletionItems() {
      return ["x:Name", "x:DisplayName", "x:Namespace", "Text", "Width", "Height", "Padding", "Gap", "Click", "Value", "Max", "Variant", "Disabled", "Test", "In", "Each", "Path", "Value"].map((name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Property));
    }
  }, " "));

  context.subscriptions.push(vscode.languages.registerHoverProvider(LUI_SELECTOR, {
    provideHover(document, position) {
      const offset = document.offsetAt(position);
      const node = nodeAt(parseLui(document.getText()).root, offset);
      if (!node) return undefined;
      const primary = node.attrs.find((item) => item.name === "x:Name");
      const display = node.attrs.find((item) => item.name === "x:DisplayName");
      if (primary && offset >= primary.valueRange.start && offset <= primary.valueRange.end) {
        return new vscode.Hover(new vscode.MarkdownString(`运行时主名称：\`${primary.value}\`\n\n副名称：${display?.value ?? "（未设置）"}`));
      }
      return undefined;
    }
  }));

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(LUI_SELECTOR, {
    async provideDefinition(document, position) {
      const word = document.getText(document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9_.-]*/));
      if (!PRIMARY_NAME.test(word)) return undefined;
      const files = await vscode.workspace.findFiles("**/*.lui", "**/{.git,node_modules}/**", 512);
      for (const uri of files) {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        const targetDocument = await vscode.workspace.openTextDocument(uri);
        const target = parseLui(text).root;
        const stack = target ? [target] : [];
        while (stack.length) {
          const node = stack.pop()!;
          const name = node.attrs.find((item) => item.name === "x:Name" && item.value === word);
          if (name) return new vscode.Location(uri, new vscode.Range(targetDocument.positionAt(name.valueRange.start), targetDocument.positionAt(name.valueRange.end)));
          stack.push(...node.children);
        }
      }
      return undefined;
    }
  }));
}

function previewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "preview.css"));
  const nonce = createUuid();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body><aside><h1>LUI 设计</h1><section id="outline"></section><section id="properties"><h2>属性</h2><p>在画布或组件树选择节点。</p></section></aside><main><header><label>设备 <select id="device"><option>360x800</option><option>390x844</option><option>768x1024</option></select></label><label id="preview-label">预览状态 <select id="preview"></select></label><button id="deploy">部署 UrhoX/Lua 运行时</button></header><section id="diagnostics"></section><div id="stage"><div id="canvas"></div></div></main><script nonce="${nonce}">
const vscode=acquireVsCodeApi();let model;let selected;
const byId=(id)=>document.getElementById(id);const escape=(v)=>String(v??'');
function currentNode(node,start){if(!node)return; if(node.start===start)return node;for(const child of node.children||[]){const got=currentNode(child,start);if(got)return got;}}
function pick(start){selected=start;draw();}
function previews(node,out=[]){if(!node)return out;if(node.kind==='element'&&node.tag==='lui:Preview')out.push(node);for(const child of node.children||[])previews(child,out);return out;}
function stateValue(value){const hit=/^\\{Binding\\s+([\\w.-]+)\\}$/.exec(value||'');if(!hit)return value;const state=previews(model?.root).find(p=>p.start===Number(byId('preview').value));const set=(state?.children||[]).find(child=>child.tag==='lui:Set'&&child.attrs?.Path===hit[1]);return set?.attrs?.Value??('{{'+hit[1]+'}}');}
function effectiveAttrs(node){const a={...(node.attrs||{})};for(const child of node.children||[]){const hit=new RegExp('^'+String(node.tag).split('.').join('\\\\.')+'\\.([\\w-]+)$').exec(child.tag||'');if(hit)a[hit[1]]=(child.children||[]).filter(c=>c.kind==='text').map(c=>c.text).join('').trim();}return a;}
function visualChildren(node){return(node.children||[]).filter(child=>!child.tag?.startsWith(String(node.tag)+'.')&&child.tag!=='lui:Preview'&&child.tag!=='lui:Set');}
function cssSize(value){return /^\\d+(?:\\.\\d+)?$/.test(String(value))?String(value)+'px':String(value);}
function number(value,fallback){const result=Number(value);return Number.isFinite(result)?result:fallback;}
function renderNode(node){if(node.kind==='text'){const span=document.createElement('span');span.textContent=node.text;return span;}if(node.kind==='comment')return document.createComment(node.text||'');const tag=node.tag||'Panel';if(tag.startsWith('lui:Preview')||tag==='lui:Set')return document.createDocumentFragment();const el=document.createElement('div');el.className='lui-node tag-'+tag.replace(/[^A-Za-z0-9_-]/g,'-');el.dataset.start=node.start;el.title=node.displayName||tag;const a=effectiveAttrs(node);if(a.Width)el.style.width=cssSize(a.Width);if(a.Height)el.style.height=cssSize(a.Height);if(a.Background)el.style.background=a.Background;if(tag==='Button')el.classList.add('button');if(tag==='Row')el.classList.add('row');if(tag==='Scroll')el.classList.add('scroll');if(tag==='Card')el.classList.add('card');if(tag==='Modal')el.classList.add('modal');if(tag==='SafeArea')el.classList.add('safe-area');if(tag==='Text'||tag==='Button'){el.textContent=stateValue(a.Text||a['x:DisplayName']||a['x:Name']||'');}else if(tag==='Progress'){const value=number(stateValue(a.Value),0),max=Math.max(1,number(stateValue(a.Max),1));const track=document.createElement('div'),fill=document.createElement('i'),label=document.createElement('small');track.className='progress-track';fill.className='progress-fill';fill.style.width=Math.max(0,Math.min(100,value/max*100))+'%';label.textContent=Math.round(value)+' / '+Math.round(max);track.append(fill);el.append(track,label);}else if(tag==='Toggle'){const indicator=document.createElement('span');indicator.className='toggle '+(String(stateValue(a.Value))==='true'?'on':'');indicator.textContent=indicator.classList.contains('on')?'开启':'关闭';el.append(indicator);}else if(tag==='Slider'){const input=document.createElement('input');input.type='range';input.disabled=true;input.min=String(a.Min||0);input.max=String(a.Max||100);input.value=String(number(stateValue(a.Value),0));el.append(input);}else if(a['x:DisplayName']||a['x:Name']){const label=document.createElement('small');label.className='design-name';label.textContent=a['x:DisplayName']||a['x:Name'];el.append(label);}for(const child of visualChildren(node))el.append(renderNode(child));el.onclick=(e)=>{e.stopPropagation();pick(node.start)};return el;}
function outline(node,host){if(!node||node.kind!=='element'||node.tag==='lui:Preview'||node.tag==='lui:Set')return;const row=document.createElement('button');row.className='outline-row'+(selected===node.start?' selected':'');row.textContent=node.displayName||node.tag;row.onclick=()=>pick(node.start);host.append(row);const kids=document.createElement('div');kids.className='outline-children';for(const child of visualChildren(node))outline(child,kids);host.append(kids);}
function properties(node){const host=byId('properties');host.innerHTML='<h2>属性</h2>';if(!node){host.insertAdjacentHTML('beforeend','<p>在画布或组件树选择节点。</p>');return;}host.insertAdjacentHTML('beforeend','<p><strong>'+escape(node.displayName||node.tag)+'</strong></p>');for(const [name,value] of Object.entries(node.attrs||{})){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.value=value;input.onchange=()=>vscode.postMessage({type:'setAttribute',start:node.start,name,value:input.value});label.append(input);host.append(label);}const add=document.createElement('button');add.textContent='添加 Panel 子节点';add.onclick=()=>vscode.postMessage({type:'addChild',start:node.start,tag:'Panel'});host.append(add);}
function draw(){const outlineHost=byId('outline');outlineHost.innerHTML='';const canvas=byId('canvas');canvas.innerHTML='';if(!model?.root)return;const select=byId('preview');const states=previews(model.root);const retained=select.value;select.innerHTML=states.map(s=>'<option value="'+s.start+'">'+escape(s.displayName||s.attrs?.['x:Name']||'预览')+'</option>').join('');if([...select.options].some(o=>o.value===retained))select.value=retained;byId('preview-label').style.display=states.length?'':'none';outline(model.root,outlineHost);canvas.append(renderNode(model.root));properties(currentNode(model.root,selected));const diagnostics=byId('diagnostics');diagnostics.innerHTML=(model.diagnostics||[]).map(d=>'<p>⚠ '+escape(d.message)+'</p>').join('');}
window.addEventListener('message',e=>{if(e.data.type==='model'){model=e.data.model;byId('device').value=e.data.device;draw();}});byId('device').onchange=()=>{const [w,h]=byId('device').value.split('x');byId('canvas').style.width=w+'px';byId('canvas').style.minHeight=h+'px';};byId('preview').onchange=()=>draw();byId('device').onchange();byId('deploy').onclick=()=>vscode.postMessage({type:'deploy'});vscode.postMessage({type:'ready'});
</script></body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  registerExplorerDecorations(context);
  registerLanguageServices(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(LuiPreviewProvider.viewType, new LuiPreviewProvider(context), { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  context.subscriptions.push(vscode.commands.registerCommand("lui.openPreview", async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId === "lui") await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, LuiPreviewProvider.viewType);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("lui.deployUrhoXLuaRuntime", () => deployUrhoXLuaRuntime(context)));
  context.subscriptions.push(vscode.commands.registerCommand("lui.checkWorkspace", async () => {
    const status = await runtimeStatus();
    if (!status) return;
    const action = await vscode.window.showInformationMessage(`${status.message}${status.version ? ` 版本 ${status.version}` : ""}`, status.installed ? "关闭" : "部署运行时");
    if (action === "部署运行时") await deployUrhoXLuaRuntime(context);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("lui.generateActionStub", async () => {
    const primary = await vscode.window.showInputBox({ prompt: "ASCII 动作主名称", placeHolder: "OpenSettings", validateInput: (value) => PRIMARY_NAME.test(value) ? undefined : "必须是 ASCII 主名称。" });
    if (!primary) return;
    const display = await vscode.window.showInputBox({ prompt: "UTF-8 动作副名称（用于注释）", placeHolder: "打开设置", validateInput: (value) => value.trim() ? undefined : "副名称不能为空。" });
    if (!display) return;
    const stub = `${primary} = function()\n    -- 在此转发受控动作。\nend, -- LUI：${display}`;
    await vscode.env.clipboard.writeText(stub);
    vscode.window.showInformationMessage(`已复制 ${primary} 动作桩；将其粘贴到同名 .lui.lua 的 actions 表。`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("lui.selectFileIconTheme", async () => {
    await vscode.workspace.getConfiguration("workbench").update("iconTheme", "lui-studio-file-icons", vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage("已启用 LUI Studio 文件图标主题。可随时在“文件图标主题”中切回原主题。");
  }));
  void runtimeStatus().then(async (status) => {
    if (!status || status.installed) return;
    const action = await vscode.window.showInformationMessage("此工作区尚未部署 LUI UrhoX/Lua 运行时。", "部署运行时", "稍后");
    if (action === "部署运行时") await deployUrhoXLuaRuntime(context);
  });
}

export function deactivate(): void {}
