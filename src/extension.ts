import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import {
  ASCII_REFERENCE, displayNameOf, editAttribute, editTag, formatLui, namespaceImports, parseLui,
  type LuiDiagnostic, type LuiDocument, type LuiNode
} from "../packages/spec/src/index.js";
import { ATTRIBUTE_LABELS, CANONICAL_TO_ATTRIBUTE, TAG_TO_CANONICAL, canonicalAttribute, canonicalTag, sourceAttribute } from "../packages/spec/src/vocabulary.js";
import { decideSourceEdit, type VersionedSource } from "./webview/sourceSync.js";

const RUNTIME_DIRECTORY = ["scripts", "LUI"] as const;
const CONFIG_FILE = "lui.project.json";
const MANIFEST_FILE = "runtime-manifest.json";
const LUI_SELECTOR: vscode.DocumentSelector = { language: "lui", scheme: "file" };
const BUILTIN_TAGS = Array.from(new Set(Object.entries(TAG_TO_CANONICAL).filter(([name]) => /[^\x00-\x7f]/.test(name)).map(([name]) => name)));

interface RuntimeStatus { root: vscode.Uri; installed: boolean; version?: string; message: string; }
interface WebviewMessage { type: "ready" | "setAttribute" | "setTag" | "sourceEdit" | "deploy"; start?: number; source?: string; name?: string; value?: string; version?: number; text?: string; }
interface SerializableNode { kind: LuiNode["kind"]; tag?: string; text?: string; start: number; end: number; source: string; displayName: string; attrs: Record<string, string>; children: SerializableNode[]; }
interface SourcePayload extends VersionedSource { displayPath: string; diagnostics: LuiDiagnostic[]; }
interface CatalogBundle { catalog: Record<string, Record<string, SerializableNode>>; sources: Record<string, SourcePayload>; }

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
    kind: node.kind, tag: node.tag, text: node.text, start: node.range.start, end: node.range.end, source: source.toString(), displayName: displayNameOf(node),
    attrs: Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value])), children: node.children.map((child) => serializeNode(child, source))
  };
}

function sourcePayload(document: vscode.TextDocument): SourcePayload {
  const text = document.getText();
  return { source: document.uri.toString(), version: document.version, text, displayPath: vscode.workspace.asRelativePath(document.uri, false), diagnostics: parseLui(text).diagnostics };
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

/** A runtime upgrade has one recoverable snapshot and never owns user design files or configuration. */
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
  const action = await vscode.window.showInformationMessage(changed.length ? `LUI 运行时将更新：${changed.join("、")}。旧版本只保留一份 .backup-last。` : "部署或补齐 LUI UrhoX/Lua 运行时（现有运行时没有哈希差异）。", "部署", "取消");
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
    const defaultConfig = { schemaVersion: 3, adapter: "urhox-lua", version: "0.4.0", sourceRoots: ["Presentation/Pages", "Presentation/Components", "Presentation/Modals"], componentDirectories: {} };
    await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify(defaultConfig, null, 2) + "\n", "utf8"));
    await writeMetaIfAbsent(config);
  }
  vscode.window.showInformationMessage(backedUp ? "LUI 运行时已更新，旧运行时保留在 .backup-last。" : "LUI 运行时已部署；没有需要备份的旧运行时。");
}

async function collectComponentCatalog(root: vscode.Uri | undefined): Promise<CatalogBundle> {
  const empty: CatalogBundle = { catalog: {}, sources: {} };
  if (!root) return empty;
  const config = await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE));
  const directories = config?.componentDirectories;
  if (!directories || typeof directories !== "object") return empty;
  const catalog: CatalogBundle["catalog"] = {};
  const sources: CatalogBundle["sources"] = {};
  for (const [directory, registered] of Object.entries(directories as Record<string, unknown>)) {
    if (!registered || typeof registered !== "object") continue;
    catalog[directory] = {};
    for (const [name, descriptor] of Object.entries(registered as Record<string, unknown>)) {
      const markup = typeof descriptor === "string" ? descriptor : (descriptor && typeof descriptor === "object" ? (descriptor as { markup?: unknown }).markup : undefined);
      if (typeof markup !== "string") continue;
      const uri = uriPath(root, "scripts", ...markup.split("/"));
      try {
        const componentDocument = await vscode.workspace.openTextDocument(uri);
        const payload = sourcePayload(componentDocument);
        sources[payload.source] = payload;
        const parsed = parseLui(payload.text);
        if (parsed.root && !parsed.diagnostics.some((item) => item.severity === "error")) catalog[directory]![name] = serializeNode(parsed.root, uri);
      } catch { /* Runtime/static validation reports missing registered components. */ }
    }
  }
  return { catalog, sources };
}

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

class LuiPreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lui.preview";
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    void normalizeOnce(document);
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] };
    panel.webview.html = previewHtml(panel.webview, this.context.extensionUri);
    let allowedSources = new Set<string>([document.uri.toString()]);
    const update = async () => {
      const parsed = parseLui(document.getText());
      const bundle = await collectComponentCatalog(workspaceRoot());
      const rootSource = sourcePayload(document);
      bundle.sources[rootSource.source] = rootSource;
      allowedSources = new Set(Object.keys(bundle.sources));
      panel.webview.postMessage({ type: "model", model: { root: parsed.root ? serializeNode(parsed.root, document.uri) : undefined, diagnostics: parsed.diagnostics }, catalog: bundle.catalog, sources: bundle.sources, rootSource: rootSource.source, device: vscode.workspace.getConfiguration("lui").get<string>("preview.defaultDevice", "360x800") });
    };
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (allowedSources.has(event.document.uri.toString())) void update();
    });
    panel.onDidDispose(() => changes.dispose());
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") { await update(); return; }
      if (message.type === "deploy") { await deployUrhoXLuaRuntime(this.context); return; }
      if (!message.source || !allowedSources.has(message.source)) return;
      const targetUri = vscode.Uri.parse(message.source);
      const targetDocument = await vscode.workspace.openTextDocument(targetUri);
      if (message.type === "sourceEdit" && typeof message.version === "number" && typeof message.text === "string") {
        const current = sourcePayload(targetDocument);
        const decision = decideSourceEdit(current, message.version, message.text);
        if (decision.kind === "reload") { panel.webview.postMessage({ type: "source", source: decision.source }); return; }
        if (decision.kind === "noop") return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(targetUri, new vscode.Range(targetDocument.positionAt(0), targetDocument.positionAt(targetDocument.getText().length)), message.text);
        if (await vscode.workspace.applyEdit(edit)) panel.webview.postMessage({ type: "source", source: sourcePayload(targetDocument) });
        return;
      }
      if ((message.type !== "setAttribute" && message.type !== "setTag") || typeof message.start !== "number" || !message.name) return;
      const parsed = parseLui(targetDocument.getText());
      const node = findNode(parsed.root, message.start);
      if (!node) return;
      const next = message.type === "setTag" ? editTag(targetDocument.getText(), node, message.name) : editAttribute(targetDocument.getText(), node, message.name, message.value ?? "");
      const edit = new vscode.WorkspaceEdit();
      edit.replace(targetUri, new vscode.Range(targetDocument.positionAt(0), targetDocument.positionAt(targetDocument.getText().length)), next);
      await vscode.workspace.applyEdit(edit);
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
    if (Number(config?.schemaVersion ?? 1) < 3) issues.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), "LUI 项目仍在旧组件配置；请迁移到 v3 componentDirectories 与目录:别名。", vscode.DiagnosticSeverity.Warning));
    diagnostics.set(document.uri, issues);
  };
  context.subscriptions.push(diagnostics, vscode.workspace.onDidOpenTextDocument(refresh), vscode.workspace.onDidChangeTextDocument((event) => void refresh(event.document)), vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
  vscode.workspace.textDocuments.forEach((document) => void refresh(document));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    async provideCompletionItems(document) {
      return [...BUILTIN_TAGS, ...await importedTags(document)].map((tag) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
        item.insertText = new vscode.SnippetString("<" + tag + ' 名称="${1:设计名称}"${2: 引用="LuaRef"}${3: />}');
        item.detail = tag.includes(":") ? "已导入目录中的组件" : "内置 LUI 积木";
        return item;
      });
    }
  }, "<"));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    provideCompletionItems() {
      const attributes = [...Object.values(CANONICAL_TO_ATTRIBUTE), "目录:积木"];
      return attributes.map((name) => { const canonical = canonicalAttribute(name); const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property); item.insertText = name === "目录:积木" ? '目录:积木="Presentation/Components"' : name + '="' + (canonical === "x:Ref" ? "${1:LuaRef}" : "${1}") + '"'; return item; });
    }
  }, " "));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    provideCompletionItems() {
      return [["绑定", "{绑定 ${1:view.path}}"], ["动作", "{动作 ${1:ActionKey}}"]].map(([label, snippet]) => { const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet); item.insertText = new vscode.SnippetString(snippet); return item; });
    }
  }, "{"));
  context.subscriptions.push(vscode.languages.registerHoverProvider(LUI_SELECTOR, {
    provideHover(document, position) {
      const node = nodeAt(parseLui(document.getText()).root, document.offsetAt(position));
      if (!node) return undefined;
      const name = node.attrs.find((attribute) => canonicalAttribute(attribute.name) === "x:Name");
      const ref = node.attrs.find((attribute) => canonicalAttribute(attribute.name) === "x:Ref");
      if (name && document.offsetAt(position) >= name.valueRange.start && document.offsetAt(position) <= name.valueRange.end) return new vscode.Hover(new vscode.MarkdownString(`名称：${name.value}\n\nLua 引用：${ref?.value ? `\`${ref.value}\`` : "（未暴露给 Lua）"}`));
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
  const designer = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "designer.js"));
  const nonce = createUuid();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<section id="design-workbench"><aside id="outline-panel"><h1>LUI 设计</h1><section id="outline"></section></aside><div id="outline-divider" role="separator" aria-label="调整结构树宽度"><button id="outline-collapse" title="收起结构树">‹</button></div><main><header><label>设备 <select id="device"><option>360x800</option><option>390x844</option><option>768x1024</option></select></label><label id="preview-label">预览状态 <select id="preview"></select></label><button id="deploy">部署 UrhoX/Lua 运行时</button></header><section id="diagnostics"></section><div id="stage"><div id="canvas"></div></div></main><aside id="inspector"><button id="collapse" title="收起属性面板">收起</button><section id="properties"><h2>当前节点属性</h2><p>在组件树或画布选择一个节点。</p></section></aside></section>
<div id="splitter" role="separator" aria-label="调整设计预览与源码高度"></div>
<section id="source-panel"><div id="source-editor"></div></section>
<script nonce="${nonce}" src="${designer}"></script></body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  registerLanguageServices(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(LuiPreviewProvider.viewType, new LuiPreviewProvider(context), { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
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
