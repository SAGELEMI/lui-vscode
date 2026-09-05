import * as vscode from "vscode";
import { dirname } from "node:path";
import { EnginePreviewHost } from './enginePreviewHost.js';
import { deployGuidance, matchesRuntime } from "../scripts/lib/guidance.mjs";
import { readComponentProperties, isLayoutProperty, type ComponentProperties } from '../packages/spec/src/properties.js';
import { createHash, randomBytes } from "node:crypto";
import {
  ASCII_REFERENCE, displayNameOf, editAttribute, editPublicAttribute, editTag, extractLuiActionSymbols, formatLui, namespaceImports, parseLui, validateComponentProperties,
  provideLuiCompletions, removeAttribute, type LuiCompletionImport, type LuiDiagnostic, type LuiDocument, type LuiNode
} from "../packages/spec/src/index.js";
import { canonicalAttribute, canonicalTag } from "../packages/spec/src/vocabulary.js";
import { decideSaveResult, decideSourcePatch, applySourceChanges, rebaseSourceChanges, fromProtocolText, rebaseSourcePatch, sourcePatch, shouldRetrySave, toProtocolText, type SourcePatch, type VersionedSource } from "./webview/sourceSync.js";

const RUNTIME_DIRECTORY = ["scripts", "LUI"] as const;
const CONFIG_FILE = "lui.project.json";
const MANIFEST_FILE = "runtime-manifest.json";
const REGISTRY_FILE = "Registry.lua";
const LUI_SELECTOR: vscode.DocumentSelector = { language: "lui", scheme: "file" };
let bundledManifestUri: vscode.Uri | undefined;

interface RuntimeStatus { root: vscode.Uri; installed: boolean; version?: string; layoutContract?: string; message: string; }
interface WebviewMessage { type: "ready" | "engineSnapshot" | "openEngine" | "setAttribute" | "resetAttribute" | "setTag" | "sourceEdit" | "saveSource" | "copy" | "deploy" | "openComponent" | "openProperty"; snapshot?: Record<string,unknown>; requestId?: number; start?: number; path?: number[]; source?: string; name?: string; value?: string; version?: number; text?: string; baseText?: string; patch?: SourcePatch; changes?: SourcePatch[]; origin?: string; }
interface SerializableNode { kind: LuiNode["kind"]; tag?: string; text?: string; start: number; end: number; openTagEnd?: number; closeTagStart?: number; source: string; nodePath: number[]; displayName: string; attrs: Record<string, string>; children: SerializableNode[]; properties?: ComponentProperties; propertiesError?: string; codeSource?: string; }
interface SourcePayload extends VersionedSource { displayPath: string; diagnostics: LuiDiagnostic[]; }
interface CatalogBundle { catalog: Record<string, Record<string, SerializableNode>>; sources: Record<string, SourcePayload>; completionImports: LuiCompletionImport[]; actionSymbols: Record<string, string[]>; }
interface ProjectFont { family: string; weight: string; uri: string; sha256: string; resource: string; }

function createUuid(): string { return randomBytes(18).toString("base64url"); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function workspaceRoot(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }
function uriPath(root: vscode.Uri, ...segments: string[]): vscode.Uri { return vscode.Uri.joinPath(root, ...segments); }
function asText(bytes: Uint8Array): string { return Buffer.from(bytes).toString("utf8"); }
const propertyCache = new Map<string, ComponentProperties>();
async function attachProperties(node: SerializableNode, uri: vscode.Uri): Promise<void> {
  const code = vscode.Uri.file(`${uri.fsPath}.lua`); node.codeSource = code.toString();
  if (!await exists(code)) return;
  const document = await vscode.workspace.openTextDocument(code);
  const result = readComponentProperties(document.getText());
  if (result.properties) propertyCache.set(code.toString(), result.properties);
  else if (!result.error) propertyCache.delete(code.toString());
  node.properties = result.error ? propertyCache.get(code.toString()) : result.properties;
  node.propertiesError = result.error ?? (canonicalTag(node.tag) === 'lui:Component' && !result.properties ? '旧组件尚未声明 Properties，请迁移公开属性。' : undefined);
}
async function exists(uri: vscode.Uri): Promise<boolean> { try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; } }
async function readJson(uri: vscode.Uri): Promise<Record<string, unknown> | undefined> { try { return JSON.parse(asText(await vscode.workspace.fs.readFile(uri))) as Record<string, unknown>; } catch { return undefined; } }

async function projectFonts(root: vscode.Uri | undefined, webview: vscode.Webview): Promise<{ fonts: ProjectFont[]; errors: string[] }> {
  const result: ProjectFont[] = []; const errors: string[] = [];
  if (!root) return { fonts: result, errors };
  const config = await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE));
  const entries = Array.isArray(config?.fonts) ? config.fonts : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const family = typeof (entry as { family?: unknown }).family === "string" ? (entry as { family: string }).family : "";
    const weights = (entry as { weights?: unknown }).weights;
    if (!family || !weights || typeof weights !== "object") { errors.push("LUI 字体声明缺少 family 或 weights。"); continue; }
    for (const [weight, descriptor] of Object.entries(weights as Record<string, unknown>)) {
      const resource = typeof descriptor === "string" ? descriptor : descriptor && typeof descriptor === "object" && typeof (descriptor as { resource?: unknown }).resource === "string" ? (descriptor as { resource: string }).resource : "";
      const expected = descriptor && typeof descriptor === "object" && typeof (descriptor as { sha256?: unknown }).sha256 === "string" ? (descriptor as { sha256: string }).sha256.toLowerCase() : "";
      if (!resource || resource.includes("..") || resource.includes("\\") || resource.startsWith("/")) { errors.push(`LUI 字体资源路径无效：${resource || "（空）"}`); continue; }
      const file = uriPath(root, "assets", ...resource.split("/"));
      if (!await exists(file)) { errors.push(`LUI 字体资源不存在：assets/${resource}`); continue; }
      const actual = sha256(await vscode.workspace.fs.readFile(file));
      if (expected && expected !== actual) { errors.push(`LUI 字体哈希不匹配：assets/${resource}`); continue; }
      result.push({ family, weight, uri: webview.asWebviewUri(file).toString(), sha256: actual, resource });
    }
  }
  return { fonts: result, errors };
}

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

/** A tree path survives edits that shift source offsets before a queued inspector write. */
function findNodeAtPath(node: LuiNode | undefined, path: readonly number[] | undefined): LuiNode | undefined {
  if (!node || !path) return undefined;
  let current: LuiNode | undefined = node;
  for (const index of path) {
    current = current?.children[index];
    if (!current) return undefined;
  }
  return current;
}

function serializeNode(node: LuiNode, source: vscode.Uri, nodePath: number[] = []): SerializableNode {
  return {
    kind: node.kind, tag: node.tag, text: node.text, start: node.range.start, end: node.range.end, openTagEnd: node.openTagEnd, closeTagStart: node.closeTagStart, source: source.toString(), nodePath, displayName: displayNameOf(node),
    attrs: Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value])), children: node.children.map((child, index) => serializeNode(child, source, [...nodePath, index]))
  };
}

function sourcePayload(document: vscode.TextDocument): SourcePayload {
  const text = toProtocolText(document.getText());
  return { source: document.uri.toString(), version: document.version, text, displayPath: vscode.workspace.asRelativePath(document.uri, false), diagnostics: parseLui(text).diagnostics };
}

/** WorkspaceEdit resolves after the document has changed. Read it directly instead of
 * waiting for a second event that may already have fired. */
type ReplaceDocumentResult =
  | { kind: "applied"; source: SourcePayload }
  | { kind: "rejected" }
  | { kind: "mismatch"; source: SourcePayload };

async function replaceDocumentText(uri: vscode.Uri, document: vscode.TextDocument, text: string): Promise<ReplaceDocumentResult> {
  const requested = toProtocolText(text);
  const diskText = fromProtocolText(requested, document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
  if (document.getText() === diskText) return { kind: "applied", source: sourcePayload(document) };
  const patch = sourcePatch(document.getText(), requested);
  if (!patch) return { kind: "applied", source: sourcePayload(document) };
  const result = await applyDocumentPatch(uri, document, patch);
  if (result.kind === "rejected") return result;
  const committed = await vscode.workspace.openTextDocument(uri);
  const source = sourcePayload(committed);
  return source.text === requested ? { kind: "applied", source } : { kind: "mismatch", source };
}

function positionAtProtocolOffset(document: vscode.TextDocument, offset: number): vscode.Position {
  const logical = toProtocolText(document.getText());
  const bounded = Math.max(0, Math.min(offset, logical.length));
  const native = fromProtocolText(logical.slice(0, bounded), document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
  return document.positionAt(native.length);
}

async function applyDocumentPatch(uri: vscode.Uri, document: vscode.TextDocument, patch: SourcePatch | SourcePatch[]): Promise<ReplaceDocumentResult> {
  const edit = new vscode.WorkspaceEdit();
  const changes = Array.isArray(patch) ? patch : [patch];
  const expected = applySourceChanges(toProtocolText(document.getText()), changes);
  for (const patch of changes) {
  const range = new vscode.Range(positionAtProtocolOffset(document, patch.from), positionAtProtocolOffset(document, patch.to));
  const insert = fromProtocolText(toProtocolText(patch.insert), document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
  edit.replace(uri, range, insert);
  }
  if (!await vscode.workspace.applyEdit(edit)) return { kind: "rejected" };
  const source = sourcePayload(await vscode.workspace.openTextDocument(uri));
  return { kind: source.text === expected ? "applied" : "mismatch", source };
}

export async function runtimeStatus(root = workspaceRoot(), expectedManifest = bundledManifestUri): Promise<RuntimeStatus | undefined> {
  if (!root) return undefined;
  const directory = uriPath(root, ...RUNTIME_DIRECTORY);
  const config = uriPath(directory, CONFIG_FILE);
  const manifest = uriPath(directory, MANIFEST_FILE);
  if (!(await exists(config)) || !(await exists(manifest))) return { root, installed: false, message: "未发现 scripts/LUI 运行时部署。" };
  const manifestBytes = await vscode.workspace.fs.readFile(manifest);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(asText(manifestBytes)) as Record<string, unknown>; }
  catch { return { root, installed: true, message: "运行时清单无法解析；请检查文件或重新部署。" }; }
  const project = await readJson(config);
  const version = typeof parsed?.version === "string" ? parsed.version : "未知";
  const layoutContract = typeof parsed?.layoutContract === "string" ? parsed.layoutContract : undefined;
  let synchronized = false;
  try { synchronized = !!expectedManifest && matchesRuntime(project, manifestBytes, await vscode.workspace.fs.readFile(expectedManifest)); }
  catch { return { root, installed: true, version, layoutContract, message: "插件携带的运行时清单无法读取；请检查插件安装。" }; }
  return { root, installed: true, version, layoutContract, message: synchronized ? `UrhoX/Lua ${version} 运行时已部署且版本匹配。` : "Studio 与 Runtime 版本、布局契约或哈希不匹配；请部署升级。" };
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
  const pages: Array<{ name: string; markup: string; code: string }> = []; const controls: Array<{ name: string; markup: string; code: string }> = [];
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
    if (canonicalTag(parsed?.tag) === "lui:Component") controls.push(item); else if (canonicalTag(parsed?.tag) === "lui:Page") pages.push(item);
  }
  pages.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")); controls.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const row = (item: { name: string; markup: string; code: string }) => `[${luaString(item.name)}] = { markup = ${luaString(item.markup)}, code = ${luaString(item.code)} },`;
  const tableRows = (items: Array<{ name: string; markup: string; code: string }>) => items.length ? `\n        ${items.map(row).join("\n        ")}\n    ` : "";
  const registry = `-- 此文件由 LUI Studio 自动维护。不要手改；新建或保存 .lui 时会更新。\n-- Lua：local Registry = require(\"LUI.Registry\"); local descriptor = Registry:Get(\"页面名\")\nlocal Registry = {\n    pages = {${tableRows(pages)}},\n    controls = {${tableRows(controls)}},\n}\n\n-- components 是 0.7 及更早 Runtime 的兼容别名。\nRegistry.components = Registry.controls\nfunction Registry:Get(name) return self.pages[name] or self.controls[name] end\n\nreturn Registry\n`;
  const destination = uriPath(root, ...RUNTIME_DIRECTORY, REGISTRY_FILE);
  await vscode.workspace.fs.writeFile(destination, Buffer.from(registry, "utf8")); await writeMetaIfAbsent(destination);
}

function luaClassName(name: string, kind: "页面" | "控件"): string {
  const ascii = name.replace(/[^A-Za-z0-9_]/g, "").replace(/^[^A-Za-z_]+/, "");
  return `${ascii || (kind === "页面" ? "Page" : "Control")}View`;
}

function templateFor(kind: "页面" | "控件", name: string, displayName: string): { markup: string; code: string } {
  const markup = kind === "页面"
    ? `<!-- ${displayName}：390×844 是设计坐标；设备预设只影响页面预览。 -->\n<页面 名称="${name}" 副名称="${displayName}" 宽度="390" 高度="844" 裁剪超出="是">\n  <容器 子项排列="垂直">\n    <文本 文本="{绑定 view.title, 模式=单向, 更新源触发=默认, 预览内容='${displayName}'}" 字号="28" />\n  </容器>\n</页面>\n`
    : `<!-- ${displayName}：Components 中的自定义控件；宽高默认自动测量，不获得设备安全区。 -->\n<控件 名称="${name}" 副名称="${displayName}" 内边距="8">\n  <容器>\n    <内容呈现器 />\n  </容器>\n</控件>\n`;
  const objectName = luaClassName(name, kind);
  const constructorArgs = kind === "页面" ? "presentation, runtime, descriptor" : "parentContext, runtime, descriptor, props, slots";
  const init = kind === "页面"
    ? `    self.presentation_, self.runtime_, self.descriptor_ = presentation, runtime, descriptor\n    self.view_ = { title = ${luaString(name)} }`
    : `    self.parentContext_, self.runtime_, self.descriptor_ = parentContext, runtime, descriptor\n    self.props_, self.slots_, self.view_ = props or {}, slots or {}, {}`;
  const context = kind === "页面"
    ? `    return { view = self.view_, presentation = self.presentation_, owner = self, actions = {\n        -- Save = function() end, -- 对应 {动作 Save}；领域动作才写在这里。\n    } }`
    : `    return { view = self.view_, props = self.props_, slots = self.slots_,\n        presentation = self.parentContext_ and self.parentContext_.presentation,\n        componentStack = self.parentContext_ and self.parentContext_.componentStack,\n        actions = self.parentContext_ and self.parentContext_.actions or {}, owner = self }`;
  const code = `-- ${name} 的同名 LUI 类。静态布局、外观、文案、绑定、列表模板和受控内置命令优先写在 ${name}.lui。\n-- 这里只放领域数据、异步、存档及复杂 {动作 ...}；view 是绑定数据，context.refs 是 x:Ref，bindings 可 Notify/Commit。\nlocal ${objectName} = {}\n${objectName}.__index = ${objectName}\n\nfunction ${objectName}.New(${constructorArgs})\n    local self = setmetatable({}, ${objectName})\n    self:Init(${constructorArgs})\n    self:InitializeComponent()\n    return self\nend\n\nfunction ${objectName}:Init(${constructorArgs})\n${init}\nend\n\nfunction ${objectName}:CreateContext()\n${context}\nend\n\n-- 等价 WPF 的 InitializeComponent：只渲染同名 .lui，不会再次加载本文件。\nfunction ${objectName}:InitializeComponent()\n    local root, context = self.runtime_:RenderMarkup(self.descriptor_.markup, self:CreateContext(), self.parentContext_)\n    if not root then error(context or \"LUI 标记渲染失败\") end\n    self.root_, self.context_ = root, context\n    return root\nend\n\nfunction ${objectName}:GetRoot() return self.root_ end\nfunction ${objectName}:OnLoaded(root, context)\n    -- 需要挂载后访问控件时：local control = context.refs.SomeRef\nend\nfunction ${objectName}:Dispose() self.root_, self.context_ = nil, nil end\n\nreturn ${objectName}\n`;
  const declaration = `\n-- 公开属性使用UTF-8字符串键。内部读取 self.props_["标题"]，LUI用 {绑定 props['标题']}。\n-- 类型：string/number/boolean/table/event；可填写default与description。公共布局属性无需重复声明。\n${objectName}.Properties = {\n    -- ["标题"] = { type = "string", default = "", description = "显示标题" },\n    -- ["确认"] = { type = "event", description = "调用方动作" },\n}\n`;
  return { markup, code: kind === '页面' ? code : code.replace(`${objectName}.__index = ${objectName}\n`, `${objectName}.__index = ${objectName}\n${declaration}`) };
}

async function createLuiPair(): Promise<void> {
  const root = workspaceRoot(); if (!root) { vscode.window.showErrorMessage("请先打开 Maker 游戏项目。"); return; }
  const kind = await vscode.window.showQuickPick(["页面", "控件"], { placeHolder: "选择 LUI 文件类型" }) as "页面" | "控件" | undefined; if (!kind) return;
  const name = await vscode.window.showInputBox({ prompt: "中文设计名称", placeHolder: kind === "页面" ? "新页面" : "新控件", validateInput: (value) => value.trim() ? undefined : "名称不能为空。" }); if (!name) return;
  const safeName = name.replace(/[\\/:*?\"<>|]/g, ""); if (!safeName) return;
  const folder = kind === "页面" ? ["scripts", "Presentation", "Pages"] : ["scripts", "Presentation", "Components"];
  const markupUri = uriPath(root, ...folder, `${safeName}.lui`); const codeUri = uriPath(root, ...folder, `${safeName}.lui.lua`);
  if (await exists(markupUri) || await exists(codeUri)) { vscode.window.showErrorMessage(`已存在：${safeName}`); return; }
  const displayName = await vscode.window.showInputBox({ prompt: "副名称（设计器中的可读名称）", placeHolder: kind === "页面" ? "新页面" : "新控件", validateInput: (value) => !value.trim() ? "副名称不能为空。" : value.trim() === name.trim() ? "副名称不能与名称相同。" : undefined });
  if (!displayName) return;
  const template = templateFor(kind, name, displayName); await vscode.workspace.fs.createDirectory(uriPath(root, ...folder));
  await vscode.workspace.fs.writeFile(markupUri, Buffer.from(template.markup, "utf8")); await vscode.workspace.fs.writeFile(codeUri, Buffer.from(template.code, "utf8"));
  await writeMetaIfAbsent(markupUri); await writeMetaIfAbsent(codeUri); await updateProjectRegistry(root);
  await vscode.commands.executeCommand("vscode.openWith", markupUri, LuiPreviewProvider.viewType);
  vscode.window.showInformationMessage(`已新建 ${kind}、MVVM 后端并更新 LUI 注册表。`);
}

/** A runtime upgrade has one recoverable snapshot and never owns user design files or configuration. */
export async function deployUrhoXLuaRuntime(context: vscode.ExtensionContext): Promise<void> {
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
  const guidance = await deployGuidance(context.extensionUri.fsPath, root.fsPath, {
    async read(path) {
      try { return await vscode.workspace.fs.readFile(vscode.Uri.file(path)); }
      catch (error) { if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return undefined; throw error; }
    },
    async write(path, bytes) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(path)));
      await vscode.workspace.fs.writeFile(vscode.Uri.file(path), bytes);
    },
  });
  if (guidance.preserved.length) vscode.window.showWarningMessage(`LUI 已保留用户修改的资料：${guidance.preserved.join("、")}`);
  vscode.window.showInformationMessage(`已交付 LUI ${guidance.version} 文档、示例与 AI skills：docs/lui/README.md。`);
  vscode.window.showInformationMessage(backedUp ? "LUI 运行时已更新，旧运行时保留在 .backup-last。" : "LUI 运行时已部署；没有需要备份的旧运行时。");
}

async function collectComponentCatalog(root: vscode.Uri | undefined): Promise<CatalogBundle> {
  const empty: CatalogBundle = { catalog: {}, sources: {}, completionImports: [], actionSymbols: {} };
  if (!root) return empty;
  const config = await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE));
  const directories = config?.componentDirectories;
  if (!directories || typeof directories !== "object") return empty;
  const catalog: CatalogBundle["catalog"] = {};
  const sources: CatalogBundle["sources"] = {};
  const completionImports: LuiCompletionImport[] = [];
  const actionSymbols: Record<string, string[]> = {};
  for (const [directory, registered] of Object.entries(directories as Record<string, unknown>)) {
    if (!registered || typeof registered !== "object") continue;
    catalog[directory] = {};
    const components: Array<{ name: string; properties: string[] }> = [];
    for (const [name, descriptor] of Object.entries(registered as Record<string, unknown>)) {
      const markup = typeof descriptor === "string" ? descriptor : (descriptor && typeof descriptor === "object" ? (descriptor as { markup?: unknown }).markup : undefined);
      if (typeof markup !== "string") continue;
      const uri = uriPath(root, "scripts", ...markup.split("/"));
      try {
        const componentDocument = await vscode.workspace.openTextDocument(uri);
        const payload = sourcePayload(componentDocument);
        sources[payload.source] = payload;
        const codeUri = vscode.Uri.file(`${uri.fsPath}.lua`);
        if (await exists(codeUri)) actionSymbols[payload.source] = extractLuiActionSymbols(asText(await vscode.workspace.fs.readFile(codeUri)));
        const parsed = parseLui(payload.text);
        if (parsed.root && !parsed.diagnostics.some((item) => item.severity === "error")) {
          const component = serializeNode(parsed.root, uri); await attachProperties(component, uri);
          catalog[directory]![name] = component;
          const properties = component.properties ? Object.keys(component.properties) : [...new Set([...payload.text.matchAll(/\{绑定\s+props\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((match) => match[1]!))];
          components.push({ name, properties, definitions: component.properties } as typeof components[number]);
        }
      } catch { /* Runtime/static validation reports missing registered components. */ }
    }
    completionImports.push({ alias: "", directory, components });
  }
  return { catalog, sources, completionImports, actionSymbols };
}

export class LuiPreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "lui.preview";
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const workspace = workspaceRoot();
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media"), ...(workspace ? [workspace] : [])] };
    panel.webview.html = previewHtml(panel.webview, this.context.extensionUri);
    let allowedSources = new Set<string>([document.uri.toString()]);
    let updateGeneration = 0;
    let cachedComponents: CatalogBundle | undefined;
    const engine=new EnginePreviewHost();let engineStarting=false,disposed=false;
    engine.onPick=selection=>{if(!disposed)panel.webview.postMessage({type:'enginePick',...selection});};
    let previewFonts: Array<{family:string;weights:Record<string,string>}> = [];
    let previewTheme: unknown;
    const startEngine=async()=>{
      if(engineStarting)return;engineStarting=true;
      try {
        const bundle=await projectFonts(workspace,panel.webview);
        if(!workspace||bundle.errors.length||!bundle.fonts.length)throw new Error(bundle.errors.join('\n')||'请在 lui.project.json 声明同源字体');
        const files=await Promise.all(bundle.fonts.map(async font=>({path:font.resource,sha256:font.sha256,bytes:await vscode.workspace.fs.readFile(uriPath(workspace,'assets',...font.resource.split('/')))})));
        const families=new Map<string,Record<string,string>>();for(const font of bundle.fonts){const weights=families.get(font.family)??{};weights[font.weight]=font.resource;families.set(font.family,weights);}
        previewFonts=Array.from(families,([family,weights])=>({family,weights}));
        previewTheme=(await readJson(uriPath(workspace,...RUNTIME_DIRECTORY,CONFIG_FILE)))?.theme;
        await engine.start(uriPath(this.context.globalStorageUri,'engine-cache').fsPath,uriPath(this.context.extensionUri,'runtime','urhox-lua').fsPath,files);
        if(disposed){engine.dispose();return;}
        panel.webview.postMessage({type:'engineReady',url:engine.url});
      }catch(error){panel.webview.postMessage({type:'engineReady',error:String(error)});}
    };
    const update = async (refreshComponents = false) => {
      const generation = ++updateGeneration;
      const rootSource = sourcePayload(document);
      const parsed = parseLui(rootSource.text);
      if (refreshComponents || !cachedComponents) cachedComponents = await collectComponentCatalog(workspaceRoot());
      if (generation !== updateGeneration) return;
      const componentBundle = cachedComponents;
      if (!componentBundle) return;
      const rootImports = namespaceImports(parsed);
      const completionImports = rootImports.map(({ alias, directory }) => ({
        alias,
        directory,
        components: componentBundle.completionImports.find((entry) => entry.directory === directory)?.components ?? []
      }));
      const rootCode = vscode.Uri.file(`${document.uri.fsPath}.lua`);
      const rootActions = await exists(rootCode) ? extractLuiActionSymbols(asText(await vscode.workspace.fs.readFile(rootCode))) : [];
      const bundle: CatalogBundle = { catalog: componentBundle.catalog, sources: { ...componentBundle.sources }, completionImports, actionSymbols: { ...componentBundle.actionSymbols, [rootSource.source]: rootActions } };
      bundle.sources[rootSource.source] = rootSource;
      allowedSources = new Set(Object.keys(bundle.sources));
      const serialized = parsed.root ? serializeNode(parsed.root, document.uri) : undefined;
      if (serialized) await attachProperties(serialized, document.uri);
      parsed.diagnostics.push(...validateComponentProperties(parsed, completionImports, serialized?.properties));
      if (serialized?.propertiesError) parsed.diagnostics.push({ message: serialized.propertiesError, severity: 'warning', range: { start: 0, end: 1 } });
      const fontBundle = await projectFonts(workspaceRoot(), panel.webview);
      for (const message of fontBundle.errors) parsed.diagnostics.push({ message, severity: "error", range: { start: 0, end: 1 } });
      if (generation !== updateGeneration) return;
      panel.webview.postMessage({ type: "model", generation, model: { root: serialized, diagnostics: parsed.diagnostics }, catalog: bundle.catalog, sources: bundle.sources, completionImports: bundle.completionImports, actionSymbols: bundle.actionSymbols, rootSource: rootSource.source, device: vscode.workspace.getConfiguration("lui").get<string>("preview.defaultDevice", "390x844"), fonts: fontBundle.fonts });
    };
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.fsPath.endsWith('.lui.lua')) { void update(true); return; }
      if (allowedSources.has(event.document.uri.toString())) {
        panel.webview.postMessage({ type: "source", source: sourcePayload(event.document), origin: event.reason === vscode.TextDocumentChangeReason.Undo ? "native-undo" : event.reason === vscode.TextDocumentChangeReason.Redo ? "native-redo" : "document" });
        void update(event.document.uri.toString() !== document.uri.toString());
      }
    });
    const backends = vscode.workspace.createFileSystemWatcher('**/*.lui.lua');
    const backendChanges = [backends.onDidCreate(() => void update(true)), backends.onDidChange(() => void update(true)), backends.onDidDelete(() => void update(true))];
    panel.onDidDispose(() => { disposed=true;engine.dispose();changes.dispose(); backends.dispose(); backendChanges.forEach(d => d.dispose()); });
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") { void startEngine();await update(); return; }
      if(message.type==='engineSnapshot'){if(message.snapshot&&JSON.stringify(message.snapshot).length<8_000_000)engine.update({...message.snapshot,fonts:previewFonts,theme:previewTheme});return;}
      if(message.type==='openEngine'){if(engine.url)await vscode.env.openExternal(vscode.Uri.parse(engine.url));return;}
      if (message.type === "deploy") { await deployUrhoXLuaRuntime(this.context); return; }
      if (message.type === "copy") { if (typeof message.text === "string" && message.text.length > 0) await vscode.env.clipboard.writeText(message.text); return; }
      if (message.type === "openComponent" && typeof message.source === "string" && allowedSources.has(message.source)) {
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.parse(message.source), LuiPreviewProvider.viewType);
        return;
      }
      if (!message.source || !allowedSources.has(message.source)) return;
      const targetUri = vscode.Uri.parse(message.source);
      if (message.type === 'openProperty') {
        const codeUri = vscode.Uri.file(`${targetUri.fsPath}.lua`);
        if (!await exists(codeUri)) return;
        const code = await vscode.workspace.openTextDocument(codeUri);
        const property = readComponentProperties(code.getText()).properties?.[message.name ?? ''];
        if (property?.start !== undefined) await vscode.window.showTextDocument(code, { selection: new vscode.Range(code.positionAt(property.start), code.positionAt(property.start)) });
        return;
      }
      const targetDocument = await vscode.workspace.openTextDocument(targetUri);
      if (message.type === "sourceEdit" && typeof message.version === "number" && typeof message.baseText === "string" && (message.changes || message.patch)) {
        const requestId = message.requestId;
        if (typeof requestId !== "number") return;
        const respond = (success: boolean, source: SourcePayload, status: "applied" | "noop" | "conflict" | "failed", messageText?: string) => {
          void panel.webview.postMessage({ type: "sourceEditResult", requestId, success, status, source, message: messageText });
        };
        try {
          const current = sourcePayload(targetDocument);
          const changes = message.changes ?? [message.patch!];
          const expected = applySourceChanges(message.baseText, changes);
          const decision = current.text === expected ? { kind: "noop" as const } : current.text === message.baseText ? { kind: "apply" as const } : { kind: "reload" as const, source: current };
          if (decision.kind === "reload") {
            const rebased = rebaseSourceChanges(message.baseText, current.text, changes);
            if (!rebased) { respond(false, decision.source as SourcePayload, "conflict", "文档已在编辑期间更新；已保留当前草稿，请核对后继续编辑。"); return; }
            const committed = await applyDocumentPatch(targetUri, targetDocument, rebased);
            if (committed.kind === "rejected") { respond(false, sourcePayload(targetDocument), "failed", "VS Code 拒绝了源码写入；当前草稿仍保留在编辑器中。"); return; }
            if (committed.kind === "mismatch") { respond(false, committed.source, "failed", "合并写入后文档再次发生变化；草稿已保留。"); return; }
            respond(true, committed.source, "applied"); return;
          }
          if (decision.kind === "noop") { respond(true, current, "noop"); return; }
          const committed = await applyDocumentPatch(targetUri, targetDocument, changes);
          if (committed.kind === "rejected") { respond(false, sourcePayload(targetDocument), "failed", "VS Code 拒绝了源码写入；当前草稿仍保留在编辑器中。"); return; }
          if (committed.kind === "mismatch") { respond(false, committed.source, "failed", "源码写入后的内容与当前草稿不一致；草稿仍保留，请核对外部修改后重试。"); return; }
          respond(true, committed.source, "applied");
        } catch (error) {
          respond(false, sourcePayload(targetDocument), "failed", error instanceof Error ? error.message : "源码写入失败；当前草稿仍已保留。");
        }
        return;
      }
      if (message.type === "saveSource" && typeof message.version === "number" && typeof message.requestId === "number") {
        const current = sourcePayload(targetDocument);
        if (current.version !== message.version) {
          void panel.webview.postMessage({ type: "saveSourceResult", requestId: message.requestId, success: false, status: "conflict", source: current, message: "保存前文档已发生变化；草稿仍保留，请再次保存。" });
          return;
        }
        try {
          const inspectSave = async (documentToSave: vscode.TextDocument, wasDirty: boolean, saveReturned: boolean) => {
            const latestDocument = await vscode.workspace.openTextDocument(targetUri);
            const latest = sourcePayload(latestDocument);
            let diskMatches = false;
            try { diskMatches = toProtocolText(asText(await vscode.workspace.fs.readFile(targetUri))) === latest.text; } catch { /* A real file read failure remains a save failure if the document is dirty. */ }
            return { latestDocument, latest, status: decideSaveResult({ wasDirty, saveReturned, isDirtyAfter: latestDocument.isDirty, diskMatches }) };
          };
          const firstWasDirty = targetDocument.isDirty;
          const firstReturned = firstWasDirty ? await targetDocument.save() : false;
          let inspected = await inspectSave(targetDocument, firstWasDirty, firstReturned);
          if (inspected.latest.version !== message.version) {
            void panel.webview.postMessage({ type: "saveSourceResult", requestId: message.requestId, success: false, status: "conflict", source: inspected.latest, message: "保存期间文档已被其他编辑更新；当前草稿仍保留，请核对后再次保存。" });
            return;
          }
          // VS Code can briefly return false while a competing native Ctrl+S is
          // finishing.  Retry the same document only after re-checking that its
          // revision has not changed; never bypass the TextDocument model with a
          // raw file write, which would split the editor buffer from disk.
          if (shouldRetrySave(inspected.status, inspected.latest.version, message.version)) {
            await new Promise<void>((resolve) => setTimeout(resolve, 40));
            const retryDocument = await vscode.workspace.openTextDocument(targetUri);
            if (retryDocument.version !== message.version) {
              void panel.webview.postMessage({ type: "saveSourceResult", requestId: message.requestId, success: false, status: "conflict", source: sourcePayload(retryDocument), message: "重试保存前文档已更新；当前草稿仍保留，请核对后再次保存。" });
              return;
            }
            const retryWasDirty = retryDocument.isDirty;
            const retryReturned = retryWasDirty ? await retryDocument.save() : false;
            inspected = await inspectSave(retryDocument, retryWasDirty, retryReturned);
          }
          const { latest, status } = inspected;
          const success = status === "saved" || status === "noop";
          void panel.webview.postMessage({ type: "saveSourceResult", requestId: message.requestId, success, status, source: latest, message: success ? undefined : "VS Code 连续两次未将当前 LUI 文档写入磁盘；草稿已保留，请检查文件是否只读或被其他程序锁定后重试。" });
        } catch (error) {
          void panel.webview.postMessage({ type: "saveSourceResult", requestId: message.requestId, success: false, status: "failed", source: sourcePayload(targetDocument), message: error instanceof Error ? error.message : "保存 LUI 文件失败。" });
        }
        return;
      }
      if ((message.type !== "setAttribute" && message.type !== "resetAttribute" && message.type !== "setTag") || typeof message.start !== "number" || !message.name) return;
      const respondDesignerEdit = (success: boolean, source?: SourcePayload, messageText?: string) => {
        if (typeof message.requestId === "number") void panel.webview.postMessage({ type: "designerEditResult", requestId: message.requestId, success, source, message: messageText });
      };
      const currentSource = sourcePayload(targetDocument);
      if (typeof message.version === "number" && currentSource.version !== message.version) {
        respondDesignerEdit(false, currentSource, "文档已在属性修改期间更新，请确认最新内容后重试。");
        return;
      }
      const currentText = currentSource.text;
      const parsed = parseLui(currentText);
      const node = findNodeAtPath(parsed.root, message.path) ?? findNode(parsed.root, message.start);
      if (!node) { respondDesignerEdit(false, undefined, "当前节点已改变，请刷新后重试。"); return; }
      const imported = !!node.tag?.includes(':') && !node.tag.startsWith('lui:');
      const next = imported && !isLayoutProperty(message.name) && message.type !== 'setTag' ? editPublicAttribute(currentText, node, message.name, message.type === 'resetAttribute' ? undefined : message.value ?? '') : message.type === "setTag" ? editTag(currentText, node, message.name) : message.type === "resetAttribute" ? removeAttribute(currentText, node, message.name) : editAttribute(currentText, node, message.name, message.value ?? "");
      const committed = await replaceDocumentText(targetUri, targetDocument, next);
      if (committed.kind === "rejected") { respondDesignerEdit(false, currentSource, "VS Code 拒绝了文档写入。请保存或刷新后重试。"); return; }
      if (committed.kind === "mismatch") { respondDesignerEdit(false, committed.source, "属性写入后的内容与当前文档不一致，请核对外部修改后重试。"); return; }
      respondDesignerEdit(true, committed.source);
    });
    await update();
  }
}

function diagnosticFor(document: vscode.TextDocument, diagnostic: LuiDocument["diagnostics"][number]): vscode.Diagnostic {
  return new vscode.Diagnostic(new vscode.Range(document.positionAt(diagnostic.range.start), document.positionAt(diagnostic.range.end)), diagnostic.message, diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
}

async function completionImportsFor(document: vscode.TextDocument): Promise<LuiCompletionImport[]> {
  const root = workspaceRoot();
  const imports = namespaceImports(parseLui(document.getText()));
  const config = root ? await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE)) : undefined;
  const directories = config?.componentDirectories as Record<string, Record<string, unknown>> | undefined;
  return await Promise.all(imports.map(async ({ alias, directory }) => {
    const components = await Promise.all(Object.entries(directories?.[directory] ?? {}).map(async ([name, descriptor]) => {
      const markup = typeof descriptor === "string" ? descriptor : (descriptor && typeof descriptor === "object" ? (descriptor as { markup?: unknown }).markup : undefined);
      const uri = root && typeof markup === "string" ? uriPath(root, "scripts", ...markup.split("/")) : undefined;
      let properties: string[] = []; let definitions: ComponentProperties | undefined;
      if (uri && await exists(uri)) {
        const parsed = parseLui((await vscode.workspace.openTextDocument(uri)).getText());
        if (parsed.root) { const node = serializeNode(parsed.root, uri); await attachProperties(node, uri); definitions = node.properties; }
        properties = definitions ? Object.keys(definitions) : [...new Set([...asText(await vscode.workspace.fs.readFile(uri)).matchAll(/\{绑定\s+props\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((match) => match[1]!))].sort();
      }
      return { name, properties, definitions };
    }));
    return { alias, directory, components };
  }));
}

async function actionSymbolsFor(document: vscode.TextDocument): Promise<string[]> {
  const companion = vscode.Uri.file(`${document.uri.fsPath}.lua`);
  if (!(await exists(companion))) return [];
  return extractLuiActionSymbols(asText(await vscode.workspace.fs.readFile(companion)));
}

function positionForProtocolOffset(position: vscode.Position, protocolPosition: number, offset: number): vscode.Position {
  // Candidate spans never cross the active line. LF protocol offsets therefore
  // map directly to VS Code line characters even for CRLF files.
  return position.translate(0, offset - protocolPosition);
}

function registerLanguageServices(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("lui");
  const refresh = async (document: vscode.TextDocument) => {
    if (document.languageId !== "lui") return;
    const parsed = parseLui(document.getText());
    const own = parsed.root ? serializeNode(parsed.root, document.uri) : undefined;
    if (own) await attachProperties(own, document.uri);
    const issues = [...parsed.diagnostics, ...validateComponentProperties(parsed, await completionImportsFor(document), own?.properties)].map((item) => diagnosticFor(document, item));
    const root = workspaceRoot();
    const config = root ? await readJson(uriPath(root, ...RUNTIME_DIRECTORY, CONFIG_FILE)) : undefined;
    if (Number(config?.schemaVersion ?? 1) < 3) issues.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), "LUI 项目仍在旧组件配置；请迁移到 v3 componentDirectories 与目录:别名。", vscode.DiagnosticSeverity.Warning));
    diagnostics.set(document.uri, issues);
  };
  context.subscriptions.push(diagnostics, vscode.workspace.onDidOpenTextDocument(refresh), vscode.workspace.onDidChangeTextDocument((event) => void refresh(event.document)), vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
  // 保存必须逐字保留当前源码。重复属性清理和格式化只能由显式命令触发，
  // 不得在保存期间重建开标签或删除设计者刚输入的值。
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId !== "lui") return;
    const root = workspaceRoot(); if (root) void updateProjectRegistry(root);
  }));
  vscode.workspace.textDocuments.forEach((document) => void refresh(document));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(LUI_SELECTOR, {
    async provideCompletionItems(document, position) {
      const source = toProtocolText(document.getText());
      const protocolPosition = toProtocolText(document.getText(new vscode.Range(new vscode.Position(0, 0), position))).length;
      const parsed = parseLui(source); const own = parsed.root ? serializeNode(parsed.root, document.uri) : undefined;
      if (own) await attachProperties(own, document.uri);
      const candidates = provideLuiCompletions({ source, position: protocolPosition, imports: await completionImportsFor(document), properties: own?.properties, actions: await actionSymbolsFor(document) });
      return candidates.map((candidate, index) => {
        const kind = candidate.kind === "tag" ? vscode.CompletionItemKind.Class : candidate.kind === "attribute" ? vscode.CompletionItemKind.Property : candidate.kind === "value" ? vscode.CompletionItemKind.EnumMember : vscode.CompletionItemKind.Snippet;
        const item = new vscode.CompletionItem(candidate.label, kind);
        item.insertText = candidate.insertText;
        item.range = new vscode.Range(positionForProtocolOffset(position, protocolPosition, candidate.from), positionForProtocolOffset(position, protocolPosition, candidate.to));
        item.detail = candidate.detail;
        item.documentation = new vscode.MarkdownString(candidate.documentation);
        item.filterText = [candidate.label, ...candidate.aliases].join(" ");
        item.sortText = `${String(index).padStart(4, "0")}:${candidate.group}:${candidate.label}`;
        return item;
      });
    }
  }, "<", "/", " ", "=", "\"", "'", "{", ","));
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
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(LUI_SELECTOR, {
    async provideDefinition(document, position) {
      const node = nodeAt(parseLui(document.getText()).root, document.offsetAt(position));
      const attribute = node?.attrs.find(a => document.offsetAt(position) >= a.range.start && document.offsetAt(position) <= a.range.end);
      if (!node || !attribute) return undefined;
      const binding = /^\{绑定\s+props\[['"]([^'"]+)['"]\]/.exec(attribute.value);
      let source = document.uri; let name = binding?.[1];
      if (!name && node.tag?.includes(':')) {
        const parsed = parseLui(document.getText()); const imports = namespaceImports(parsed);
        const [alias, componentName] = node.tag.split(':');
        const directory = imports.find(i => i.alias === alias)?.directory; const bundle = await collectComponentCatalog(workspaceRoot());
        const component = directory && bundle.catalog[directory]?.[componentName!];
        if (!component) return undefined;
        source = vscode.Uri.parse(component.source); name = attribute.name;
      }
      if (!name) return undefined;
      const codeUri = vscode.Uri.file(`${source.fsPath}.lua`);
      if (!await exists(codeUri)) return undefined;
      const code = await vscode.workspace.openTextDocument(codeUri);
      const declaration = readComponentProperties(code.getText()).properties?.[name];
      return declaration?.start === undefined ? undefined : new vscode.Location(codeUri, code.positionAt(declaration.start));
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
return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:*; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<section id="design-workbench"><aside id="outline-panel"><h1>LUI 结构</h1><section id="outline"></section></aside><div id="outline-divider" role="separator" aria-label="调整结构树宽度"><button id="outline-collapse" title="收起结构树">‹</button></div><main><header><label id="device-label">设备 <select id="device"><option>358x425</option><option>377x496</option><option>360x800</option><option>390x844</option><option>640x1024</option><option>768x1024</option></select></label><span id="zoom-tools"><button id="fit" title="按中间画板视口适应">适应</button><button id="actual-size" title="显示 100%">100%</button><button id="zoom-out" title="缩小画板视图">−</button><output id="zoom-value">100%</output><button id="zoom-in" title="放大画板视图">＋</button></span><button id="deploy">部署 UrhoX/Lua 运行时</button></header><section id="diagnostics"></section><div id="stage" aria-label="中间设计画板；可滚动、中键或空格拖拽平移，Ctrl 加滚轮缩放"><div id="stage-content"><div id="artboard"><div id="canvas"></div></div></div></div></main><aside id="inspector"><button id="collapse" title="收起属性面板">收起</button><section id="properties"><h2>当前节点属性</h2><p>在组件树或画布选择一个节点。</p></section></aside></section>
<div id="splitter" role="separator" aria-label="调整设计预览与源码高度"><button id="source-collapse" title="折叠源码">⌄</button><button id="source-maximize" title="源码最大化">⛶</button></div>
<section id="source-panel"><div id="source-editor"></div></section>
<script nonce="${nonce}" src="${designer}"></script></body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  bundledManifestUri = vscode.Uri.joinPath(context.extensionUri, "runtime", "urhox-lua", MANIFEST_FILE);
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
