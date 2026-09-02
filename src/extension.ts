import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import {
  ASCII_REFERENCE, displayNameOf, editAttribute, formatLui, namespaceImports, parseLui,
  type LuiDocument, type LuiNode
} from "../packages/spec/src/index.js";

const RUNTIME_DIRECTORY = ["scripts", "LUI"] as const;
const CONFIG_FILE = "lui.project.json";
const MANIFEST_FILE = "runtime-manifest.json";
const LUI_SELECTOR: vscode.DocumentSelector = { language: "lui", scheme: "file" };
const BUILTIN_TAGS = ["Panel", "Row", "Text", "Button", "Card", "Scroll", "Progress", "Toggle", "Slider", "SafeArea", "Modal", "Section", "Notice", "Screen", "FixedScreen", "lui:If", "lui:For", "lui:Slot", "lui:Preview"];
const ATTRIBUTE_LABELS: Record<string, string> = {
  "x:Name": "设计名称", "x:DisplayName": "副名称", "x:Ref": "Lua 引用", Width: "宽度", Height: "高度", MinWidth: "最小宽度", MinHeight: "最小高度", MaxWidth: "最大宽度", MaxHeight: "最大高度",
  Margin: "外边距", Padding: "内边距", Gap: "子项间距", Anchor: "锚点", Left: "左侧", Top: "顶部", Right: "右侧", Bottom: "底部", FlexGrow: "弹性增长", FlexBasis: "弹性基准", Align: "交叉轴对齐", Justify: "主轴对齐",
  Background: "背景色", Color: "文字颜色", Opacity: "透明度", BorderRadius: "圆角", Variant: "样式变体", Text: "文本", Title: "标题", FontSize: "字号", Click: "点击动作", Change: "变更动作", Disabled: "禁用", Value: "数值", Max: "最大值", Min: "最小值", Test: "条件", In: "数据集合", Each: "循环变量", Path: "绑定路径", Close: "关闭动作"
};

interface RuntimeStatus { root: vscode.Uri; installed: boolean; version?: string; message: string; }
interface WebviewMessage { type: "ready" | "setAttribute" | "select" | "reveal" | "deploy"; start?: number; source?: string; name?: string; value?: string; }
interface SerializableNode { kind: LuiNode["kind"]; tag?: string; text?: string; start: number; source: string; displayName: string; attrs: Record<string, string>; children: SerializableNode[]; }
type ComponentCatalog = Record<string, Record<string, SerializableNode>>;

function createUuid(): string { return randomBytes(18).toString("base64url"); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function workspaceRoot(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }
function uriPath(root: vscode.Uri, ...segments: string[]): vscode.Uri { return vscode.Uri.joinPath(root, ...segments); }
function asText(bytes: Uint8Array): string { return Buffer.from(bytes).toString("utf8"); }
async function exists(uri: vscode.Uri): Promise<boolean> { try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; } }
async function readJson(uri: vscode.Uri): Promise<Record<string, unknown> | undefined> { try { return JSON.parse(asText(await vscode.workspace.fs.readFile(uri))) as Record<string, unknown>; } catch { return undefined; } }

function nodeAt(node: LuiNode | undefined, offset: number): LuiNode | undefined {
  if (!node || offset < node.range.start || offset > node.range.end) return undefined;
  for (const child of node.children) { const nested = nodeAt(child, offset); if (nested) return nested; }
  return node;
}

function findNode(node: LuiNode | undefined, start: number): LuiNode | undefined {
  if (!node) return undefined;
  if (node.range.start === start) return node;
  for (const child of node.children) { const found = findNode(child, start); if (found) return found; }
  return undefined;
}

function serializeNode(node: LuiNode, source: vscode.Uri): SerializableNode {
  return {
    kind: node.kind, tag: node.tag, text: node.text, start: node.range.start, source: source.toString(), displayName: displayNameOf(node),
    attrs: Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value])), children: node.children.map((child) => serializeNode(child, source))
  };
}

async function runtimeStatus(root = workspaceRoot()): Promise<RuntimeStatus | undefined> {
  if (!root) return undefined;
  const directory = uriPath(root, ...RUNTIME_DIRECTORY);
  const config = uriPath(directory, CONFIG_FILE);
  const manifest = uriPath(directory, MANIFEST_FILE);
  if (!(await exists(config)) || !(await exists(manifest))) return { root, installed: false, message: "未发现 scripts/LUI 运行时部署。" };
  const parsed = await readJson(manifest);
  return { root, installed: true, version: typeof parsed?.version === "string" ? parsed.version : "未知", message: "UrhoX/Lua 运行时已部署。" };
}

async function collectAdapterFiles(source: vscode.Uri, relative = ""): Promise<Array<[string, vscode.Uri]>> {
  const result: Array<[string, vscode.Uri]> = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(source)) {
    const path = relative ? `${relative}/${name}` : name;
    const child = vscode.Uri.joinPath(source, name);
    if (type === vscode.FileType.Directory) result.push(...await collectAdapterFiles(child, path)); else result.push([path, child]);
  }
  return result;
}

async function writeMetaIfAbsent(destination: vscode.Uri): Promise<void> {
  const meta = vscode.Uri.file(`${destination.fsPath}.meta`);
  if (await exists(meta)) return;
  await vscode.workspace.fs.writeFile(meta, Buffer.from(JSON.stringify({ uuid: createUuid() }, null, 2) + "\n", "utf8"));
}

/** A runtime upgrade has one recoverable snapshot at most; it never owns user LUI documents or configuration. */
async function deployUrhoXLuaRuntime(context: vscode.ExtensionContext): Promise<void> {
  const root = workspaceRoot();
  if (!root) { vscode.window.showErrorMessage("请先打开一个项目工作区。"); return; }
  const source = vscode.Uri.joinPath(context.extensionUri, "runtime", "urhox-lua");
  const destinationRoot = uriPath(root, ...RUNTIME_DIRECTORY);
  const files = await collectAdapterFiles(source);
  const changed: string[] = [];
  for (const [relative, sourceFile] of files) {
    const destination = vscode.Uri.joinPath(destinationRoot, ...relative.split("/"));
    if (relative === CONFIG_FILE || !(await exists(destination))) continue;
    if (sha256(await vscode.workspace.fs.readFile(sourceFile)) !== sha256(await vscode.workspace.fs.readFile(destination))) changed.push(relative);
  }
  const action = await vscode.window.showInformationMessage(
    changed.length ? `LUI 运行时将更新：${changed.join("、")}。旧版本只保留一份 .backup-last。` : "部署或补齐 LUI UrhoX/Lua 运行时（现有运行时没有哈希差异）。",
    "部署", "取消"
  );
  if (action !== "部署") return;
  const backupRoot = vscode.Uri.joinPath(destinationRoot, ".backup-last");
  let backedUp = false;
  for (const [relative, sourceFile] of files) {
    const destination = vscode.Uri.joinPath(destinationRoot, ...relative.split("/"));
    if (relative === CONFIG_FILE && await exists(destination)) continue;
    const incoming = await vscode.workspace.fs.readFile(sourceFile);
    if (await exists(destination)) {
      const previous = await vscode.workspace.fs.readFile(destination);
      if (sha256(previous) === sha256(incoming)) continue;
      if (!backedUp && await exists(backupRoot)) await vscode.workspace.fs.delete(backupRoot, { recursive: true, useTrash: false });
      backedUp = true;
      const backup = vscode.Uri.joinPath(backupRoot, ...relative.split("/"));
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(backupRoot, ...relative.split("/").slice(0, -1)));
      await vscode.workspace.fs.writeFile(backup, previous);
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(destinationRoot, ...relative.split("/").slice(0, -1)));
    await vscode.workspace.fs.writeFile(destination, incoming);
    await writeMetaIfAbsent(destination);
  }
  const config = uriPath(destinationRoot, CONFIG_FILE);
  if (!(await exists(config))) {
    const defaultConfig = { schemaVersion: 2, adapter: "urhox-lua", version: "0.2.0", sourceRoots: ["Presentation/Pages", "Presentation/Components", "Presentation/Modals"], componentDirectories: {} };
    await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify(defaultConfig, null, 2) + "\n", "utf8"));
    await writeMetaIfAbsent(config);
  }
  vscode.window.showInformationMessage(backedUp ? "LUI 运行时已更新，旧运行时保留在 .backup-last。" : "LUI 运行时已部署；没有需要备份的旧运行时。");
}

async function collectComponentCatalog(root: vscode.Uri | undefined): Promise<ComponentCatalog> {
  if (!root) return {};
  const config = await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE));
  const directories = config?.componentDirectories;
  if (!directories || typeof directories !== "object") return {};
  const catalog: ComponentCatalog = {};
  for (const [directory, registered] of Object.entries(directories as Record<string, unknown>)) {
    if (!registered || typeof registered !== "object") continue;
    catalog[directory] = {};
    for (const [name, descriptor] of Object.entries(registered as Record<string, unknown>)) {
      const markup = typeof descriptor === "string" ? descriptor : (descriptor && typeof descriptor === "object" ? (descriptor as { markup?: unknown }).markup : undefined);
      if (typeof markup !== "string") continue;
      const uri = uriPath(root, "scripts", ...markup.split("/"));
      try {
        const model = parseLui(asText(await vscode.workspace.fs.readFile(uri)));
        if (model.root && !model.diagnostics.some((item) => item.severity === "error")) catalog[directory]![name] = serializeNode(model.root, uri);
      } catch { /* A missing optional component is reported by the runtime/static check, not the preview. */ }
    }
  }
  return catalog;
}

const splitDocuments = new Set<string>();
const normalizedDocuments = new Set<string>();

async function normalizeOnce(document: vscode.TextDocument): Promise<void> {
  const key = document.uri.toString();
  if (normalizedDocuments.has(key) || document.isDirty) return;
  normalizedDocuments.add(key);
  const formatted = formatLui(document.getText());
  if (!formatted || formatted === document.getText()) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), formatted);
  if (await vscode.workspace.applyEdit(edit)) await document.save();
}

/** Uses VS Code's own second editor group so the lower half stays a native text editor. */
async function openTextBelow(document: vscode.TextDocument): Promise<void> {
  const key = document.uri.toString();
  if (splitDocuments.has(key)) return;
  splitDocuments.add(key);
  await vscode.commands.executeCommand("workbench.action.splitEditorDown");
  await vscode.commands.executeCommand("workbench.action.focusSecondEditorGroup");
  await vscode.commands.executeCommand("vscode.openWith", document.uri, "default", vscode.ViewColumn.Active);
  await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
  await vscode.commands.executeCommand("workbench.action.increaseEditorHeight");
}

class LuiPreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lui.preview";
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    void normalizeOnce(document);
    panel.webview.options = { enableScripts: true };
    panel.webview.html = previewHtml(panel.webview, this.context.extensionUri);
    const update = async () => {
      const model = parseLui(document.getText());
      panel.webview.postMessage({ type: "model", model: { root: model.root ? serializeNode(model.root, document.uri) : undefined, diagnostics: model.diagnostics }, catalog: await collectComponentCatalog(workspaceRoot()), device: vscode.workspace.getConfiguration("lui").get<string>("preview.defaultDevice", "360x800") });
    };
    const changes = vscode.workspace.onDidChangeTextDocument((event) => { if (event.document.uri.toString() === document.uri.toString()) void update(); });
    const selections = vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document.uri.toString() !== document.uri.toString()) return;
      const selected = nodeAt(parseLui(document.getText()).root, document.offsetAt(event.selections[0]!.active));
      if (selected) panel.webview.postMessage({ type: "externalSelect", start: selected.range.start, source: document.uri.toString() });
    });
    panel.onDidDispose(() => { changes.dispose(); selections.dispose(); });
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") { await update(); void openTextBelow(document); return; }
      if (message.type === "deploy") { await deployUrhoXLuaRuntime(this.context); return; }
      if (typeof message.start !== "number") return;
      const targetUri = message.source ? vscode.Uri.parse(message.source) : document.uri;
      const targetDocument = await vscode.workspace.openTextDocument(targetUri);
      const current = parseLui(targetDocument.getText());
      const node = findNode(current.root, message.start);
      if (!node) return;
      if (message.type === "setAttribute" && message.name) {
        const next = editAttribute(targetDocument.getText(), node, message.name, message.value ?? "");
        const edit = new vscode.WorkspaceEdit();
        edit.replace(targetUri, new vscode.Range(targetDocument.positionAt(0), targetDocument.positionAt(targetDocument.getText().length)), next);
        await vscode.workspace.applyEdit(edit);
      }
      if (message.type === "reveal") {
        const editor = await vscode.window.showTextDocument(targetDocument, { preview: false, preserveFocus: false, viewColumn: vscode.ViewColumn.Active });
        const position = targetDocument.positionAt(node.range.start);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    });
    await update();
  }
}

function diagnosticFor(document: vscode.TextDocument, diagnostic: LuiDocument["diagnostics"][number]): vscode.Diagnostic {
  return new vscode.Diagnostic(new vscode.Range(document.positionAt(diagnostic.range.start), document.positionAt(diagnostic.range.end)), diagnostic.message, diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
}

async function importedTags(document: vscode.TextDocument): Promise<string[]> {
  const root = workspaceRoot();
  const imports = namespaceImports(parseLui(document.getText()));
  const config = root ? await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE)) : undefined;
  const directories = config?.componentDirectories as Record<string, Record<string, unknown>> | undefined;
  return imports.flatMap(({ alias, directory }) => Object.keys(directories?.[directory] ?? {}).map((name) => `${alias}:${name}`));
}

function registerLanguageServices(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("lui");
  const refresh = async (document: vscode.TextDocument) => {
    if (document.languageId !== "lui") return;
    const issues = parseLui(document.getText()).diagnostics.map((item) => diagnosticFor(document, item));
    const root = workspaceRoot();
    const config = root ? await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE)) : undefined;
    if (Number(config?.schemaVersion ?? 1) < 2) issues.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), "LUI 项目仍在 v1 全局组件配置；请迁移到 v2 componentDirectories 与 xmlns:目录别名。", vscode.DiagnosticSeverity.Warning));
    diagnostics.set(document.uri, issues);
  };
  context.subscriptions.push(diagnostics, vscode.workspace.onDidOpenTextDocument(refresh), vscode.workspace.onDidChangeTextDocument((event) => refresh(event.document)), vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
  vscode.workspace.textDocuments.forEach(refresh);

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    async provideCompletionItems(document) {
      const tags = [...BUILTIN_TAGS, ...await importedTags(document)];
      return tags.map((tag) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
        item.insertText = new vscode.SnippetString("<" + tag + ' x:Name="${1:设计名称}"${2: x:Ref="LuaRef"}${3: />}');
        item.detail = tag.includes(":") ? "已导入目录中的组件" : "内置 LUI 积木";
        return item;
      });
    }
  }, "<"));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    provideCompletionItems() {
      const attributes = ["x:Name", "x:DisplayName", "x:Ref", "xmlns:积木", "Width", "Height", "MinWidth", "MinHeight", "Margin", "Padding", "Gap", "Anchor", "Left", "Top", "Right", "Bottom", "FlexGrow", "FlexBasis", "Align", "Justify", "Background", "Color", "Text", "Title", "FontSize", "Click", "Change", "Value", "Min", "Max", "Variant", "Disabled", "Test", "In", "Each", "Path", "Close"];
      return attributes.map((name) => { const item = new vscode.CompletionItem(ATTRIBUTE_LABELS[name] ? `${name}（${ATTRIBUTE_LABELS[name]}）` : name, vscode.CompletionItemKind.Property); item.insertText = name === "xmlns:积木" ? 'xmlns:积木="Presentation/Components"' : name + '="' + (name === "x:Ref" ? "${1:LuaRef}" : "${1}") + '"'; return item; });
    }
  }, " "));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    provideCompletionItems() {
      return [
        new vscode.CompletionItem("Binding（数据绑定）", vscode.CompletionItemKind.Snippet),
        new vscode.CompletionItem("Action（动作）", vscode.CompletionItemKind.Snippet)
      ].map((item, index) => { item.insertText = new vscode.SnippetString(index ? "{Action ${1:ActionKey}}" : "{Binding ${1:view.path}}"); return item; });
    }
  }, "{"));

  context.subscriptions.push(vscode.languages.registerHoverProvider(LUI_SELECTOR, {
    provideHover(document, position) {
      const node = nodeAt(parseLui(document.getText()).root, document.offsetAt(position));
      if (!node) return undefined;
      const name = node.attrs.find((attribute) => attribute.name === "x:Name");
      const ref = node.attrs.find((attribute) => attribute.name === "x:Ref");
      if (name && document.offsetAt(position) >= name.valueRange.start && document.offsetAt(position) <= name.valueRange.end) {
        return new vscode.Hover(new vscode.MarkdownString(`设计名称：${name.value}\n\nLua 引用：${ref?.value ? `\`${ref.value}\`` : "（未暴露给 Lua）"}`));
      }
      return undefined;
    }
  }));

  const fullDocumentFormat = (document: vscode.TextDocument): vscode.TextEdit[] => {
    const formatted = formatLui(document.getText());
    return formatted ? [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), formatted)] : [];
  };
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(LUI_SELECTOR, { provideDocumentFormattingEdits: fullDocumentFormat }));
  context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider(LUI_SELECTOR, { provideOnTypeFormattingEdits: fullDocumentFormat }, "\n", ">"));
}

function previewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "preview.css"));
  const nonce = createUuid();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<aside id="outline-panel"><h1>LUI 设计</h1><section id="outline"></section></aside>
<main><header><label>设备 <select id="device"><option>360x800</option><option>390x844</option><option>768x1024</option></select></label><label id="preview-label">预览状态 <select id="preview"></select></label><button id="deploy">部署 UrhoX/Lua 运行时</button></header><section id="diagnostics"></section><div id="stage"><div id="canvas"></div></div></main>
<aside id="inspector"><button id="collapse" title="收起属性面板">收起</button><section id="properties"><h2>当前节点属性</h2><p>在组件树或画布选择一个节点。</p></section></aside>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let model,catalog={},selected,hovered;
const byId=(id)=>document.getElementById(id);const text=(v)=>String(v??'');
function nodeFrom(root,start,source){if(!root)return; if(root.start===start&&root.source===source)return root;for(const child of root.children||[]){const hit=nodeFrom(child,start,source);if(hit)return hit;}}
function allRoots(){const roots=[];if(model?.root)roots.push(model.root);for(const group of Object.values(catalog||{}))for(const component of Object.values(group||{}))roots.push(component);return roots;}
function getNode(start,source){for(const root of allRoots()){const hit=nodeFrom(root,start,source);if(hit)return hit;}}
function pick(start,source){selected={start,source};draw();vscode.postMessage({type:'reveal',start,source});}
function previews(node,out=[]){if(!node)return out;if(node.kind==='element'&&node.tag==='lui:Preview')out.push(node);for(const child of node.children||[])previews(child,out);return out;}
function previewValues(){const state=previews(model?.root).find(item=>item.start===Number(byId('preview').value));const values={};for(const child of state?.children||[])if(child.tag==='lui:Set')values[child.attrs.Path]=child.attrs.Value;return values;}
function getPath(value,path){for(const key of String(path||'').split('.')){if(value==null)return undefined;value=value[key];}return value;}
function resolve(value,scope){const binding=/^\\{Binding\\s+([A-Za-z][A-Za-z0-9_.-]*)\\}$/.exec(value||'');if(!binding)return value;const state=previewValues();const actual=getPath(scope,binding[1]);if(actual!==undefined)return actual;const preview=getPath(state,binding[1]);if(preview!==undefined)return preview;const samples={title:'无尽塔',enemyText:'塔层守卫 · Lv.1',playerText:'冒险者 · Lv.1',logText:'战斗记录将在这里显示。',weaponText:'武器槽（空）',armorText:'护甲槽（空）',detailText:'在这里查看当前选择的说明。',profileSummary:'本地进度已就绪。'};return samples[binding[1]]??'{{'+binding[1]+'}}';}
function effective(node,scope){const attrs={...(node.attrs||{})};const owner=String(node.tag)+'.';for(const child of node.children||[]){if(child.tag?.startsWith(owner))attrs[child.tag.slice(owner.length)]=(child.children||[]).filter(item=>item.kind==='text').map(item=>item.text).join('').trim();}for(const key of Object.keys(attrs))attrs[key]=resolve(attrs[key],scope);return attrs;}
function visualChildren(node){return(node.children||[]).filter(child=>!child.tag?.startsWith(String(node.tag)+'.')&&child.tag!=='lui:Preview'&&child.tag!=='lui:Set');}
function cssSize(value){return /^\\d+(?:\\.\\d+)?$/.test(text(value))?text(value)+'px':text(value);}
function bool(value){return value!==false&&value!==undefined&&value!==null&&value!==''&&value!=='false'&&value!==0;}
function decorate(el,node){el.dataset.start=node.start;el.dataset.source=node.source;el.classList.add('lui-node');el.onmouseenter=()=>{hovered={start:node.start,source:node.source};applyHighlights();};el.onmouseleave=()=>{hovered=undefined;applyHighlights();};el.onclick=(event)=>{event.stopPropagation();pick(node.start,node.source);};}
function applyLayout(el,a){for(const [attr,style] of Object.entries({Width:'width',Height:'height',MinWidth:'minWidth',MinHeight:'minHeight',MaxWidth:'maxWidth',MaxHeight:'maxHeight',Margin:'margin',Padding:'padding',Gap:'gap',Background:'background',Color:'color',Opacity:'opacity',Left:'left',Top:'top',Right:'right',Bottom:'bottom',FlexBasis:'flexBasis'})){if(a[attr]!==undefined)el.style[style]=cssSize(a[attr]);}if(a.FlexGrow!==undefined)el.style.flexGrow=text(a.FlexGrow);if(a.Left!==undefined||a.Top!==undefined||a.Right!==undefined||a.Bottom!==undefined)el.style.position='absolute';if(a.Align)el.style.alignItems=a.Align;if(a.Justify)el.style.justifyContent=a.Justify;}
function fragmentChildren(nodes,scope,trace){const f=document.createDocumentFragment();for(const child of nodes||[])f.append(renderNode(child,scope,trace));return f;}
function renderComponent(node,scope,trace){const [alias,name]=String(node.tag).split(':');const sourceRoot=allRoots().find(root=>root.source===node.source);const directory=sourceRoot?.attrs?.['xmlns:'+alias];const template=catalog?.[directory]?.[name];if(!template)return document.createComment('组件未登记：'+node.tag);const key=directory+'/'+name;if(trace.includes(key))return document.createComment('组件循环：'+key);const wrapper=document.createElement('div');wrapper.className='lui-component-instance';decorate(wrapper,node);const props={...scope.props};for(const [key,value] of Object.entries(effective(node,scope)))props[key]=value;wrapper.append(fragmentChildren(visualChildren(template),{...scope,props,slots:{Content:visualChildren(node)}},[...trace,key]));return wrapper;}
function renderNode(node,scope={},trace=[]){if(node.kind==='text'){const span=document.createElement('span');span.textContent=node.text;return span;}if(node.kind==='comment')return document.createComment(node.text||'');const tag=node.tag||'Panel';if(tag==='lui:Preview'||tag==='lui:Set')return document.createDocumentFragment();if(tag==='lui:If'){const a=effective(node,scope);return bool(a.Test)?fragmentChildren(visualChildren(node),scope,trace):document.createDocumentFragment();}if(tag==='lui:For'){const sample={label:'示例项目',name:'示例项目',text:'示例内容'};return fragmentChildren(visualChildren(node),{...scope,[effective(node,scope).Each||'item']:sample,item:sample,index:1},trace);}if(tag==='lui:Slot')return fragmentChildren(scope.slots?.[effective(node,scope).Name]||[],scope,trace);if(tag.includes(':')&&!tag.startsWith('lui:'))return renderComponent(node,scope,trace);const el=document.createElement('div');decorate(el,node);const a=effective(node,scope);el.classList.add('tag-'+tag.replace(/[^A-Za-z0-9_-]/g,'-'));applyLayout(el,a);if(tag==='Row')el.classList.add('row');else el.classList.add('panel');if(tag==='Button'){el.classList.add('button');if(a.Variant==='secondary')el.classList.add('secondary');el.textContent=text(a.Text||'');}else if(tag==='Text'){el.classList.add('text');el.style.fontSize=a.FontSize?cssSize(a.FontSize):'';el.textContent=text(a.Text||'');}else if(tag==='Card')el.classList.add('card');else if(tag==='Scroll')el.classList.add('scroll');else if(tag==='SafeArea')el.classList.add('safe-area');else if(tag==='Modal')el.classList.add('modal');else if(tag==='Progress'){el.classList.add('progress');const track=document.createElement('span');track.className='progress-track';const fill=document.createElement('span');fill.className='progress-fill';const max=Math.max(1,Number(a.Max)||100);fill.style.width=Math.max(0,Math.min(100,(Number(a.Value)||0)/max*100))+'%';track.append(fill);el.append(track);}else if(tag==='Toggle'){el.classList.add('toggle');el.textContent=bool(a.Value)?'开启':'关闭';}else if(tag==='Slider'){el.classList.add('slider');const input=document.createElement('input');input.type='range';input.min=a.Min||0;input.max=a.Max||100;input.value=a.Value||0;el.append(input);}if(!['Button','Text','Progress','Toggle','Slider'].includes(tag))el.append(fragmentChildren(visualChildren(node),scope,trace));return el;}
function outline(node,host,depth=0){if(node.kind!=='element'||node.tag==='lui:Preview'||node.tag==='lui:Set')return;const row=document.createElement('button');row.className='outline-row';row.style.marginLeft=(depth*12)+'px';row.textContent=node.displayName||node.tag;row.onclick=()=>pick(node.start,node.source);row.onmouseenter=()=>{hovered={start:node.start,source:node.source};applyHighlights();};row.onmouseleave=()=>{hovered=undefined;applyHighlights();};row.dataset.start=node.start;row.dataset.source=node.source;host.append(row);for(const child of visualChildren(node))outline(child,host,depth+1);}
const categories=[['LUI 名称',['x:Name','x:DisplayName']],['Lua 引用',['x:Ref']],['布局',['Margin','Padding','Width','Height','MinWidth','MinHeight','MaxWidth','MaxHeight','Anchor','Left','Top','Right','Bottom','Gap','FlexGrow','FlexBasis','Align','Justify']],['外观',['Background','Color','Opacity','BorderRadius','Variant']],['文本与交互',['Text','Title','FontSize','Click','Change','Close','Disabled','Value','Min','Max']],['数据与条件',['Test','In','Each','Path']]];
function propertyInput(host,node,key,value){const label=document.createElement('label');label.textContent=ATTRIBUTE_LABELS[key]||key;const input=document.createElement('input');input.value=value??'';input.placeholder=ATTRIBUTE_LABELS[key]||key;input.onchange=()=>vscode.postMessage({type:'setAttribute',start:node.start,source:node.source,name:key,value:input.value});label.append(input);host.append(label);}
function properties(node){const host=byId('properties');host.innerHTML='<h2>当前节点属性</h2>';if(!node){const p=document.createElement('p');p.textContent='在组件树或画布选择一个节点。';host.append(p);return;}const attrs=node.attrs||{};const used=new Set();for(const [title,keys] of categories){const section=document.createElement('section');const heading=document.createElement('h3');heading.textContent=title;section.append(heading);for(const key of keys){if(attrs[key]!==undefined||['x:Name','x:Ref','Width','Height','Margin','Padding','Anchor','Left','Top','Right','Bottom'].includes(key)){propertyInput(section,node,key,attrs[key]);used.add(key);}}host.append(section);}const rest=Object.keys(attrs).filter(key=>!used.has(key)&&!key.startsWith('xmlns:'));if(rest.length){const section=document.createElement('section');const heading=document.createElement('h3');heading.textContent='其他属性';section.append(heading);for(const key of rest)propertyInput(section,node,key,attrs[key]);host.append(section);}}
function applyHighlights(){for(const el of document.querySelectorAll('[data-start][data-source]')){const same=(value,target)=>value&&Number(el.dataset.start)===value.start&&el.dataset.source===value.source;el.classList.toggle('is-selected',same(selected));el.classList.toggle('is-hovered',same(hovered));}}
function draw(){const canvas=byId('canvas'),tree=byId('outline');canvas.innerHTML='';tree.innerHTML='';if(!model?.root)return;const select=byId('preview'),states=previews(model.root),previous=select.value;select.innerHTML='';for(const state of states){const option=document.createElement('option');option.value=state.start;option.textContent=state.displayName||'预览状态';select.append(option);}if([...select.options].some(option=>option.value===previous))select.value=previous;byId('preview-label').style.display=states.length?'':'none';outline(model.root,tree);canvas.append(renderNode(model.root,{}));properties(selected&&getNode(selected.start,selected.source));const diagnostics=byId('diagnostics');diagnostics.innerHTML='';for(const issue of model.diagnostics||[]){const p=document.createElement('p');p.textContent='⚠ '+issue.message;diagnostics.append(p);}applyHighlights();}
window.addEventListener('message',event=>{if(event.data.type==='model'){model=event.data.model;catalog=event.data.catalog||{};byId('device').value=event.data.device;draw();}if(event.data.type==='externalSelect'){selected={start:event.data.start,source:event.data.source};properties(getNode(selected.start,selected.source));applyHighlights();}});byId('device').onchange=()=>{const [width,height]=byId('device').value.split('x');byId('canvas').style.width=width+'px';byId('canvas').style.minHeight=height+'px';};byId('preview').onchange=draw;byId('deploy').onclick=()=>vscode.postMessage({type:'deploy'});byId('collapse').onclick=()=>{byId('inspector').classList.toggle('collapsed');byId('collapse').textContent=byId('inspector').classList.contains('collapsed')?'展开':'收起';};byId('device').onchange();vscode.postMessage({type:'ready'});
</script></body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
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
    const ref = await vscode.window.showInputBox({ prompt: "ASCII 动作 Lua 引用", placeHolder: "OpenSettings", validateInput: (value) => ASCII_REFERENCE.test(value) ? undefined : "必须是 ASCII 引用。" });
    if (!ref) return;
    await vscode.env.clipboard.writeText(`${ref} = function()\n  -- 在这里转发受控动作。\nend, -- LUI：动作`);
    vscode.window.showInformationMessage(`已复制 ${ref} 动作桩。`);
  }));
}

export function deactivate(): void {}
