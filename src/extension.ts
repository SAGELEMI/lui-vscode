import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import {
  ASCII_REFERENCE, displayNameOf, editAttribute, editTag, formatLui, namespaceImports, normalizeLuiAttributes, parseLui,
  type LuiDiagnostic, type LuiDocument, type LuiNode
} from "../packages/spec/src/index.js";
import { ATTRIBUTE_LABELS, CANONICAL_TO_ATTRIBUTE, DEPRECATED_CANONICAL_TAGS, TAG_TO_CANONICAL, attributeDefinition, canonicalAttribute, canonicalTag, enumOptions, sourceAttribute } from "../packages/spec/src/vocabulary.js";
import { decideSourceEdit, type VersionedSource } from "./webview/sourceSync.js";

const RUNTIME_DIRECTORY = ["scripts", "LUI"] as const;
const CONFIG_FILE = "lui.project.json";
const MANIFEST_FILE = "runtime-manifest.json";
const REGISTRY_FILE = "Registry.lua";
const LUI_SELECTOR: vscode.DocumentSelector = { language: "lui", scheme: "file" };
const BUILTIN_TAGS = Array.from(new Set(Object.entries(TAG_TO_CANONICAL).filter(([name, canonical]) => /[^\x00-\x7f]/.test(name) && !DEPRECATED_CANONICAL_TAGS.has(canonical)).map(([name]) => name)));

interface RuntimeStatus { root: vscode.Uri; installed: boolean; version?: string; layoutContract?: string; message: string; }
interface WebviewMessage { type: "ready" | "setAttribute" | "setTag" | "sourceEdit" | "copy" | "deploy"; start?: number; source?: string; name?: string; value?: string; version?: number; text?: string; }
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
  const manifestBytes = await vscode.workspace.fs.readFile(manifest);
  const parsed = JSON.parse(asText(manifestBytes)) as Record<string, unknown>;
  const project = await readJson(config);
  const version = typeof parsed?.version === "string" ? parsed.version : "未知";
  const layoutContract = typeof parsed?.layoutContract === "string" ? parsed.layoutContract : undefined;
  const synchronized = project?.version === version && project?.layoutContract === layoutContract && project?.runtimeManifestHash === sha256(manifestBytes);
  return { root, installed: true, version, layoutContract, message: layoutContract === "viewbox-grid-v1" && synchronized ? "UrhoX/Lua Viewbox/Grid 运行时已部署且版本匹配。" : "Studio 与 Runtime 布局契约或哈希不匹配；请部署升级。" };
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

async function collectLuiFiles(directory: vscode.Uri, relative = ""): Promise<Array<[string, vscode.Uri]>> {
  const found: Array<[string, vscode.Uri]> = [];
  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
      const child = vscode.Uri.joinPath(directory, name); const path = relative ? `${relative}/${name}` : name;
      if (type === vscode.FileType.Directory && name !== ".backup-last") found.push(...await collectLuiFiles(child, path));
      else if (type === vscode.FileType.File && name.endsWith(".lui")) found.push([path, child]);
    }
  } catch { /* A project can omit a configured source root. */ }
  return found;
}

function luaString(value: string): string { return JSON.stringify(value); }
async function updateProjectRegistry(root: vscode.Uri): Promise<void> {
  const scripts = uriPath(root, "scripts"); const configUri = uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE);
  const config = (await readJson(configUri)) ?? { schemaVersion: 3, adapter: "urhox-lua", sourceRoots: ["Presentation/Pages", "Presentation/Components"] };
  const roots = Array.isArray(config.sourceRoots) ? config.sourceRoots.filter((value): value is string => typeof value === "string") : [];
  const pages: Array<{ name: string; markup: string; code: string }> = []; const components: Array<{ name: string; markup: string; code: string }> = [];
  const seenMarkup = new Set<string>(); const registeredNames = new Map<string, string>();
  for (const sourceRoot of roots) for (const [relative, uri] of await collectLuiFiles(uriPath(scripts, ...sourceRoot.split("/")))) {
    const markup = `${sourceRoot}/${relative}`; const parsed = parseLui(asText(await vscode.workspace.fs.readFile(uri))).root;
    const name = parsed?.attrs.find((attribute) => canonicalAttribute(attribute.name) === "x:Name")?.value ?? relative.replace(/\.lui$/, "");
    if (seenMarkup.has(markup)) continue;
    seenMarkup.add(markup);
    const codeUri = uriPath(scripts, ...`${markup}.lua`.split("/"));
    if (!(await exists(codeUri))) throw new Error(`LUI 注册失败：缺少配对 MVVM 后端 ${markup}.lua。`);
    const existingMarkup = registeredNames.get(name);
    if (existingMarkup && existingMarkup !== markup) throw new Error(`LUI 注册失败：名称“${name}”同时用于 ${existingMarkup} 与 ${markup}。`);
    registeredNames.set(name, markup);
    const item = { name, markup, code: `${markup}.lua` };
    if (canonicalTag(parsed?.tag) === "lui:Component") components.push(item); else if (canonicalTag(parsed?.tag) === "lui:Page") pages.push(item);
  }
  pages.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")); components.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const row = (item: { name: string; markup: string; code: string }) => `[${luaString(item.name)}] = { markup = ${luaString(item.markup)}, code = ${luaString(item.code)} },`;
  const registry = `-- 此文件由 LUI Studio 自动维护。不要手改；新建或保存 .lui 时会更新。\n-- Lua：local Registry = require(\"LUI.Registry\"); local page = Registry:Get(\"页面名\")\nlocal Registry = {\n    pages = {\n        ${pages.map(row).join("\n        ")}\n    },\n    components = {\n        ${components.map(row).join("\n        ")}\n    },\n}\n\nfunction Registry:Get(name) return self.pages[name] or self.components[name] end\nfunction Registry:Render(runtime, name, presentation)\n    local item = self:Get(name)\n    if not item then return nil, \"LUI 未登记页面或组件：\" .. tostring(name) end\n    return runtime:Render(item.markup, item.code, presentation)\nend\n\nreturn Registry\n`;
  const destination = uriPath(root, ...RUNTIME_DIRECTORY, REGISTRY_FILE);
  await vscode.workspace.fs.writeFile(destination, Buffer.from(registry, "utf8")); await writeMetaIfAbsent(destination);
}

function templateFor(kind: "页面" | "组件", name: string): { markup: string; code: string } {
  const markup = kind === "页面"
    ? `<!-- ${name}：设备预设只影响预览；视图框定义内部设计坐标。 -->\n<页面 名称="${name}">\n  <安全区>\n    <视图框 宽度="390" 高度="844">\n      <网格 行定义="自动,填充" 列定义="填充">\n        <文本 名称="标题" 文本="{绑定 view.title, 模式=单向, 更新源触发=默认, 预览内容='${name}'}" 字号="28" />\n      </网格>\n    </视图框>\n  </安全区>\n</页面>\n`
    : `<!-- ${name}：在页面根节点以 目录:别名 导入后使用。 -->\n<组件 名称="${name}">\n  <网格 行定义="自动" 列定义="填充">\n    <文本 名称="标题" 文本="{绑定 props.title, 预览内容='${name}'}" />\n  </网格>\n</组件>\n`;
  const objectName = kind === "页面" ? "Page" : "Component";
  const code = `-- ${name} 的 MVVM 后端。布局、样式和静态属性留在同名 .lui。\n-- view：绑定数据；actions：{动作 ...}；refs：所有 x:Ref 控件；bindings：Notify/Commit。\nlocal ${objectName} = {}\n\nfunction ${objectName}.Build(presentation)\n    return {\n        view = { title = \"${name}\" },\n        actions = {\n            -- Save = function() end, -- 对应 {动作 Save}\n        },\n        AfterMount = function(root, context)\n            -- local title = context.refs.TitleRef -- 对应 x:Ref=\"TitleRef\"\n        end,\n        OnBindingChanged = function(path, context)\n            -- 修改 view 后调用 context.bindings:Notify(\"view.字段\")。\n        end,\n    }\nend\n\nreturn ${objectName}\n`;
  return { markup, code };
}

async function createLuiPair(): Promise<void> {
  const root = workspaceRoot(); if (!root) { vscode.window.showErrorMessage("请先打开 Maker 游戏项目。"); return; }
  const kind = await vscode.window.showQuickPick(["页面", "组件"], { placeHolder: "选择 LUI 文件类型" }) as "页面" | "组件" | undefined; if (!kind) return;
  const name = await vscode.window.showInputBox({ prompt: "中文设计名称", placeHolder: kind === "页面" ? "新页面" : "新组件", validateInput: (value) => value.trim() ? undefined : "名称不能为空。" }); if (!name) return;
  const safeName = name.replace(/[\\/:*?\"<>|]/g, ""); if (!safeName) return;
  const folder = kind === "页面" ? ["scripts", "Presentation", "Pages"] : ["scripts", "Presentation", "Components"];
  const markupUri = uriPath(root, ...folder, `${safeName}.lui`); const codeUri = uriPath(root, ...folder, `${safeName}.lui.lua`);
  if (await exists(markupUri) || await exists(codeUri)) { vscode.window.showErrorMessage(`已存在：${safeName}`); return; }
  const template = templateFor(kind, name); await vscode.workspace.fs.createDirectory(uriPath(root, ...folder));
  await vscode.workspace.fs.writeFile(markupUri, Buffer.from(template.markup, "utf8")); await vscode.workspace.fs.writeFile(codeUri, Buffer.from(template.code, "utf8"));
  await writeMetaIfAbsent(markupUri); await writeMetaIfAbsent(codeUri); await updateProjectRegistry(root);
  await vscode.commands.executeCommand("vscode.openWith", markupUri, LuiPreviewProvider.viewType);
  vscode.window.showInformationMessage(`已新建 ${kind}、MVVM 后端并更新 LUI 注册表。`);
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
  const destinationManifest = uriPath(destinationRoot, MANIFEST_FILE);
  const manifestBytes = await vscode.workspace.fs.readFile(destinationManifest);
  const manifest = JSON.parse(asText(manifestBytes)) as Record<string, unknown>;
  const projectConfig = (await readJson(config)) ?? {};
  projectConfig.version = manifest.version;
  projectConfig.layoutContract = manifest.layoutContract;
  projectConfig.runtimeManifestHash = sha256(manifestBytes);
  await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify(projectConfig, null, 2) + "\n", "utf8"));
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
      panel.webview.postMessage({ type: "model", model: { root: parsed.root ? serializeNode(parsed.root, document.uri) : undefined, diagnostics: parsed.diagnostics }, catalog: bundle.catalog, sources: bundle.sources, rootSource: rootSource.source, device: vscode.workspace.getConfiguration("lui").get<string>("preview.defaultDevice", "390x844") });
    };
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (allowedSources.has(event.document.uri.toString())) void update();
    });
    panel.onDidDispose(() => changes.dispose());
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") { await update(); return; }
      if (message.type === "deploy") { await deployUrhoXLuaRuntime(this.context); return; }
      if (message.type === "copy") { if (typeof message.text === "string" && message.text.length > 0) await vscode.env.clipboard.writeText(message.text); return; }
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
  context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
    if (event.document.languageId !== "lui") return;
    const normalized = normalizeLuiAttributes(event.document.getText());
    if (normalized !== event.document.getText()) event.waitUntil(Promise.resolve([vscode.TextEdit.replace(new vscode.Range(event.document.positionAt(0), event.document.positionAt(event.document.getText().length)), normalized)]));
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId !== "lui") return;
    const root = workspaceRoot(); if (root) void updateProjectRegistry(root);
  }));
  vscode.workspace.textDocuments.forEach((document) => void refresh(document));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    async provideCompletionItems(document) {
      return [...BUILTIN_TAGS, ...await importedTags(document)].map((tag) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
        item.insertText = new vscode.SnippetString("<" + tag + ' 名称="${1:设计名称}"${2: />}');
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
    provideCompletionItems(document, position) {
      const before = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));
      const match = /([^\s=]+)\s*=\s*["']([^"']*)$/.exec(before);
      if (!match) return undefined;
      const canonical = canonicalAttribute(match[1]!);
      const options = enumOptions(canonical) ?? (attributeDefinition(canonical)?.kind === "tracks" ? ["自动", "填充", "2填充"] : undefined);
      if (!options) return undefined;
      const start = position.translate(0, -match[2]!.length);
      return options.map((value) => {
        const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
        item.range = new vscode.Range(start, position);
        item.insertText = value;
        item.detail = `${sourceAttribute(canonical)} 可选值`;
        return item;
      });
    }
  }, "\"", "'"));
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
<section id="design-workbench"><aside id="outline-panel"><h1>LUI 设计</h1><section id="outline"></section></aside><div id="outline-divider" role="separator" aria-label="调整结构树宽度"><button id="outline-collapse" title="收起结构树">‹</button></div><main><header><label>设备 <select id="device"><option>390x844</option><option>360x800</option><option>768x1024</option></select></label><label id="preview-label">预览状态 <select id="preview"></select></label><button id="deploy">部署 UrhoX/Lua 运行时</button></header><section id="diagnostics"></section><div id="stage"><div id="canvas"></div></div></main><aside id="inspector"><button id="collapse" title="收起属性面板">收起</button><section id="properties"><h2>当前节点属性</h2><p>在组件树或画布选择一个节点。</p></section></aside></section>
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
  context.subscriptions.push(vscode.commands.registerCommand("lui.createPair", createLuiPair));
}

export function deactivate(): void {}
