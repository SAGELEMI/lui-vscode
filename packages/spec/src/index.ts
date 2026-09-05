import { UI_CONTROL_DEFINITIONS, TAG_TO_CANONICAL, attributeDefinition, canonicalAttribute, canonicalTag, DEPRECATED_CANONICAL_ATTRIBUTES, DEPRECATED_CANONICAL_TAGS, directoryAlias, enumOptions, isLegacyToken, legacyEnumValue, normalizedEnumValue, parseBinding, parseCommand, sourceAttribute, sourceTag as chineseTag } from "./vocabulary.js";
import { isLayoutProperty, type ComponentProperties } from './properties.js';
import { pathKeys } from './paths.js';
import type { LuiCompletionImport } from './completion.js';
import { normalizeColor, parseBrush } from './brush.js';

export { UI_CONTROL_DEFINITIONS, parseBinding, parseCommand };
export { pathKeys, readPath } from './paths.js';
export { readComponentProperties, isLayoutProperty, propertyTypeMatches, type ComponentProperties, type ComponentProperty } from './properties.js';
export { availableAttributes, extractLuiActionSymbols, provideLuiCompletions, type LuiCompletionCandidate, type LuiCompletionContext, type LuiCompletionImport, type LuiImportedComponent } from "./completion.js";
export { normalizeColor, parseBrush, formatLinearGradient, type LuiBrush } from "./brush.js";
export { calculatePageFrame, type PageFrame, type PageFrameInput } from "./page-frame.js";
export { UI_CAPABILITIES, capabilityAttributes, isVisualTag, isTextTag } from "./generated-capabilities.js";

const KNOWN_CANONICAL_TAGS = new Set(Object.values(TAG_TO_CANONICAL));

/**
 * LUI's portable syntax model. UTF-8 is valid everywhere in the design
 * document except values that cross the Lua boundary (x:Ref, Binding, Action).
 */
export interface LuiRange { start: number; end: number; }

export function validateComponentProperties(document: LuiDocument, imports: readonly LuiCompletionImport[], own?: ComponentProperties): LuiDiagnostic[] {
  const diagnostics: LuiDiagnostic[] = [];
  const visit = (node: LuiNode): void => {
    const [alias, name] = (node.tag ?? '').split(':');
    const schema = imports.find(i => i.alias === alias)?.components.find(c => c.name === name)?.definitions;
    for (const attr of node.attrs) {
      const binding = parseBinding(attr.value); const keys = binding && pathKeys(binding.path);
      if (own && keys?.[0] === 'props' && keys[1] && !own[keys[1]] && !isLayoutProperty(keys[1])) fail(diagnostics, `组件未声明公开属性：${keys[1]}`, attr.valueRange.start, attr.valueRange.end);
      if (!schema || isLayoutProperty(attr.name)) continue;
      const definition = schema[attr.name];
      if (!definition) { fail(diagnostics, `组件未声明公开属性：${attr.name}`, attr.range.start, attr.range.end); continue; }
      if (binding) continue;
      const valid = definition.type === 'string' || (definition.type === 'number' && attr.value.trim() !== '' && Number.isFinite(Number(attr.value))) || (definition.type === 'boolean' && ['true','false','是','否'].includes(attr.value)) || (definition.type === 'event' && /^\{(?:动作|Action)\s+[A-Za-z][A-Za-z0-9_.-]*\}$/.test(attr.value));
      if (!valid) fail(diagnostics, `公开属性 ${attr.name} 需要 ${definition.type}${definition.type === 'table' ? ' 集合绑定' : ''}`, attr.valueRange.start, attr.valueRange.end);
    }
    node.children.forEach(visit);
  };
  if (document.root) visit(document.root);
  return diagnostics;
}

/** Explicit, idempotent 2.3.2 migration. Never run while opening/saving a document.
 * Changes only static alignment value spans; bindings must be audited at their source. */
export function migrateAlignmentAxes(source: string): { text: string; changes: number; bindings: LuiRange[] } {
  const parsed = parseLui(source);
  const edits: Array<{ range: LuiRange; value: string }> = [];
  const bindings: LuiRange[] = [];
  const visit = (node: LuiNode): void => {
    for (const attribute of node.attrs) {
      const axis = canonicalAttribute(attribute.name);
      if (axis !== "HorizontalAlignment" && axis !== "VerticalAlignment") continue;
      if (parseBinding(attribute.value)) { bindings.push(attribute.valueRange); continue; }
      const values: Record<string, string> = axis === "HorizontalAlignment" ? { "左": "上", "右": "下" } : { "上": "左", "下": "右" };
      if (values[attribute.value]) edits.push({ range: attribute.valueRange, value: values[attribute.value] });
    }
    node.children.forEach(visit);
  };
  if (parsed.root) visit(parsed.root);
  let text = source;
  for (const edit of edits.sort((a, b) => b.range.start - a.range.start)) text = text.slice(0, edit.range.start) + edit.value + text.slice(edit.range.end);
  return { text, changes: edits.length, bindings };
}

export interface LuiAttribute {
  name: string;
  value: string;
  range: LuiRange;
  valueRange: LuiRange;
}

export interface LuiNode {
  kind: "element" | "text" | "comment";
  tag?: string;
  text?: string;
  attrs: LuiAttribute[];
  children: LuiNode[];
  range: LuiRange;
  openTagEnd?: number;
  closeTagStart?: number;
}

export interface LuiDiagnostic {
  message: string;
  range: LuiRange;
  severity: "error" | "warning";
}

export interface LuiDocument {
  root?: LuiNode;
  diagnostics: LuiDiagnostic[];
  source: string;
}

/** Names used by Lua must remain portable identifiers. */
export const ASCII_REFERENCE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const NAME_RESERVED = /[\s<>/="']/;

function fail(diagnostics: LuiDiagnostic[], message: string, start: number, end = start + 1, severity: "error" | "warning" = "error") {
  diagnostics.push({ message, range: { start, end }, severity });
}

function skipSpace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index]!)) index += 1;
  return index;
}

/** XML names intentionally accept UTF-8. XML punctuation is the only syntax. */
function readName(source: string, index: number): { value: string; end: number } | undefined {
  const start = index;
  while (index < source.length && !NAME_RESERVED.test(source[index]!)) index += 1;
  return index === start ? undefined : { value: source.slice(start, index), end: index };
}

function parseOpenTag(source: string, start: number, diagnostics: LuiDiagnostic[]): { node?: LuiNode; end: number; selfClosing: boolean } {
  let index = skipSpace(source, start + 1);
  const name = readName(source, index);
  if (!name) {
    const terminator = source.indexOf(">", start);
    if (terminator === start + 1) {
      const end = terminator + 1;
      return { node: { kind: "element", tag: "__placeholder__", attrs: [], children: [], range: { start, end }, openTagEnd: end }, end, selfClosing: true };
    }
    fail(diagnostics, "LUI 标签缺少名称。", start);
    return { end: terminator < 0 ? source.length : terminator + 1, selfClosing: false };
  }
  index = name.end;
  const attrs: LuiAttribute[] = [];
  let selfClosing = false;
  while (index < source.length) {
    index = skipSpace(source, index);
    if (source.startsWith("/>", index)) { selfClosing = true; index += 2; break; }
    if (source[index] === ">") { index += 1; break; }
    const attrStart = index;
    const attr = readName(source, index);
    if (!attr) { fail(diagnostics, "LUI 属性名无效。", index); index += 1; continue; }
    index = skipSpace(source, attr.end);
    if (source[index] !== "=") { fail(diagnostics, `属性 ${attr.value} 缺少 =。`, attrStart, index); continue; }
    index = skipSpace(source, index + 1);
    const quote = source[index];
    if (quote !== "\"" && quote !== "'") { fail(diagnostics, `属性 ${attr.value} 必须使用引号。`, index); continue; }
    const valueStart = index + 1;
    const close = source.indexOf(quote, valueStart);
    if (close < 0) { fail(diagnostics, `属性 ${attr.value} 没有结束引号。`, valueStart); return { end: source.length, selfClosing }; }
    attrs.push({ name: attr.value, value: source.slice(valueStart, close), range: { start: attrStart, end: close + 1 }, valueRange: { start: valueStart, end: close } });
    index = close + 1;
  }
  return { node: { kind: "element", tag: name.value, attrs, children: [], range: { start, end: index }, openTagEnd: index }, end: index, selfClosing };
}

function parseCloseTag(source: string, start: number, diagnostics: LuiDiagnostic[]): { tag: string; end: number } | undefined {
  let index = skipSpace(source, start + 2);
  const name = readName(source, index);
  index = skipSpace(source, name?.end ?? index);
  if (!name || source[index] !== ">") { fail(diagnostics, "LUI 结束标签无效。", start); return undefined; }
  return { tag: name.value, end: index + 1 };
}

/** Parses the safe XML-shaped LUI subset. DTD, processing instructions and entities are deliberately excluded. */
export function parseLui(source: string): LuiDocument {
  const diagnostics: LuiDiagnostic[] = [];
  const stack: LuiNode[] = [];
  let root: LuiNode | undefined;
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      const close = end < 0 ? source.length : end + 3;
      if (end < 0) fail(diagnostics, "LUI 注释没有结束标记。", index);
      const comment: LuiNode = { kind: "comment", text: source.slice(index + 4, end < 0 ? source.length : end), attrs: [], children: [], range: { start: index, end: close } };
      if (stack.length) stack[stack.length - 1]!.children.push(comment);
      index = close;
      continue;
    }
    if (source.startsWith("</", index)) {
      const close = parseCloseTag(source, index, diagnostics);
      if (!close) { index += 2; continue; }
      const node = stack.pop();
      if (!node) fail(diagnostics, `未匹配的结束标签 </${close.tag}>。`, index, close.end);
      else if (canonicalTag(node.tag) !== canonicalTag(close.tag)) { fail(diagnostics, `结束标签 </${close.tag}> 与 <${node.tag}> 不匹配。`, index, close.end); node.range.end = close.end; }
      else { node.closeTagStart = index; node.range.end = close.end; }
      index = close.end;
      continue;
    }
    if (source[index] === "<") {
      const open = parseOpenTag(source, index, diagnostics);
      if (!open.node) { index = Math.max(open.end, index + 1); continue; }
      if (!root) root = open.node;
      else if (!stack.length) fail(diagnostics, "LUI 文档只能有一个根元素。", index, open.end);
      if (stack.length) stack[stack.length - 1]!.children.push(open.node);
      if (open.selfClosing) open.node.range.end = open.end;
      else stack.push(open.node);
      index = open.end;
      continue;
    }
    const next = source.indexOf("<", index);
    const end = next < 0 ? source.length : next;
    const value = source.slice(index, end);
    if (value.trim() && stack.length) stack[stack.length - 1]!.children.push({ kind: "text", text: value, attrs: [], children: [], range: { start: index, end } });
    index = end;
  }
  for (const node of stack) fail(diagnostics, `<${node.tag}> 没有结束标签。`, node.range.start, source.length);
  if (!root) fail(diagnostics, "LUI 文档缺少根元素。", 0, Math.max(1, source.length));
  const document = { root, diagnostics, source };
  if (root) validateLui(document);
  return document;
}

export function getAttribute(node: LuiNode, name: string): LuiAttribute | undefined {
  const canonical = canonicalAttribute(name);
  for (let index = node.attrs.length - 1; index >= 0; index -= 1) if (canonicalAttribute(node.attrs[index]!.name) === canonical) return node.attrs[index];
  return undefined;
}

export interface LuiImport { alias: string; directory: string; attribute: LuiAttribute; }

/** Returns root-level component-directory imports; the system `lui` import is excluded. */
export function namespaceImports(document: LuiDocument): LuiImport[] {
  const root = document.root;
  if (!root) return [];
  return root.attrs
    .map((attribute) => ({ attribute, parsed: directoryAlias(attribute.name) }))
    .filter((item): item is { attribute: LuiAttribute; parsed: { alias: string; legacy: boolean } } => Boolean(item.parsed))
    .map(({ attribute, parsed }) => ({ alias: parsed.alias, directory: attribute.value, attribute }));
}

function isDesignName(value: string): boolean { return value.trim().length > 0 && !/[<>]/.test(value); }
function isDirectory(value: string): boolean { return value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === ".."); }
function isInteger(value: string): boolean { return /^\d+$/.test(value); }
function isBinding(value: string): boolean { return /^\{(?:绑定|Binding)\s+[A-Za-z][A-Za-z0-9_.-]*\}$/.test(value.trim()); }
function isLength(value: string): boolean { return parseBinding(value) !== undefined || /^-?\d+(?:\.\d+)?%?$/.test(value) || value === "自动"; }
function isThickness(value: string): boolean {
  const parts = value.split(",").map((part) => part.trim());
  return (parts.length === 1 || parts.length === 4) && parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part));
}
function isTrack(value: string): boolean { return value === "自动" || value === "填充" || value === "*" || /^\d+(?:\.\d+)?(?:%|填充|\*)?$/.test(value); }
function isTrackList(value: string): boolean { return value.split(",").map((part) => part.trim()).length > 0 && value.split(",").map((part) => part.trim()).every(isTrack); }
function isTransform(value: string): boolean {
  const source = value.trim();
  if (!source) return true;
  const parts = source.split(";").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^(缩放|旋转|平移|倾斜)\s*\(\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)?\s*\)$/.test(part));
}
function validateValue(diagnostics: LuiDiagnostic[], attribute: LuiAttribute): void {
  const canonical = canonicalAttribute(attribute.name);
  const definition = attributeDefinition(canonical);
  if (canonical === "TextStrokeWidth" && !parseBinding(attribute.value) && (!attribute.value.trim() || !Number.isFinite(Number(attribute.value)) || Number(attribute.value) < 0)) fail(diagnostics, "文字描边宽度必须是非负有限数值（逻辑像素，0 为关闭）。", attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "integer" && !isInteger(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 必须是从 0 开始的整数。`, attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "length" && !isLength(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 必须是像素数、百分比或“自动”。`, attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "thickness" && !isThickness(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 必须是单值，或“左,上,右,下”四个数值。`, attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "tracks" && !isTrackList(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 只能包含像素数、百分比、“自动”或 WPF 星号轨道（*、2*）。`, attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "number" && !parseBinding(attribute.value) && !Number.isFinite(Number(attribute.value))) fail(diagnostics, `${sourceAttribute(canonical)} 必须是数值。`, attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "color" && !parseBinding(attribute.value) && !normalizeColor(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 必须是 #RRGGBB 或 #RRGGBBAA。`, attribute.valueRange.start, attribute.valueRange.end);
  if (definition?.kind === "brush" && !parseBinding(attribute.value) && !parseBrush(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 必须是 #RRGGBB[AA] 或 linear-gradient(角度deg, 颜色 位置%, 颜色 位置%)。`, attribute.valueRange.start, attribute.valueRange.end);
  if ((canonical === "RenderTransform" || canonical === "LayoutTransform") && !isTransform(attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 使用“缩放(1.1);旋转(15);平移(8,0);倾斜(0,0)”格式。`, attribute.valueRange.start, attribute.valueRange.end);
  const options = enumOptions(canonical);
  if (options && !parseBinding(attribute.value) && !options.includes(normalizedEnumValue(canonical, attribute.value))) fail(diagnostics, `${sourceAttribute(canonical)} 只能使用：${options.join("、")}。`, attribute.valueRange.start, attribute.valueRange.end);
  else if (options && legacyEnumValue(canonical, attribute.value)) fail(diagnostics, `${sourceAttribute(canonical)} 的旧值“${attribute.value}”请改为“${normalizedEnumValue(canonical, attribute.value)}”（旧“主要/次要”现称“高亮/常规”）。`, attribute.valueRange.start, attribute.valueRange.end, "warning");
}

const EVENT_ATTRIBUTES = new Set(["Click", "Change", "Submit", "Select", "Open", "Close", "Focus", "Blur", "Complete", "DragStart", "DragEnd", "DragCancel"]);
function validateCommand(diagnostics: LuiDiagnostic[], attribute: LuiAttribute): void {
  const canonical = canonicalAttribute(attribute.name);
  if (!EVENT_ATTRIBUTES.has(canonical) || !attribute.value.trim().startsWith("{命令")) return;
  const command = parseCommand(attribute.value);
  if (!command) { fail(diagnostics, "内置命令格式无效；只能使用受控的 {命令 名称, 键='值'} 语法。", attribute.valueRange.start, attribute.valueRange.end); return; }
  const required: Record<string, string[]> = { "设值": ["路径", "值"], "可见性": ["路径", "值"], "页签": ["键", "值"], "导航": ["目标"], "关闭": ["目标"] };
  for (const key of required[command.name]) if (!command.args[key]) fail(diagnostics, `内置命令“${command.name}”缺少“${key}”。`, attribute.valueRange.start, attribute.valueRange.end);
  if ((command.name === "设值" || command.name === "可见性") && command.args["路径"] && !/^view\.[A-Za-z][A-Za-z0-9_.-]*$/.test(command.args["路径"])) fail(diagnostics, "设值与可见性命令只能修改 view.*，不能执行任意 Lua。", attribute.valueRange.start, attribute.valueRange.end);
}

/** Validates LUI identities and the boundary between design-only and Lua-visible values. */
export function validateLui(document: LuiDocument): LuiDiagnostic[] {
  const diagnostics = document.diagnostics;
  const root = document.root;
  if (!root) return diagnostics;
  const designNames = new Map<string, LuiAttribute>();
  const displayNames = new Map<string, LuiAttribute>();
  const refs = new Map<string, LuiAttribute>();
  const imports = new Map<string, LuiAttribute>();
  for (const attribute of root.attrs) {
    const directory = directoryAlias(attribute.name);
    if (!directory) continue;
    const alias = directory.alias;
    if (directory.legacy) fail(diagnostics, `目录导入请改用 目录:${alias}。`, attribute.range.start, attribute.range.end, "warning");
    if (!alias || /[\s:]/.test(alias)) fail(diagnostics, `目录别名无效：${alias || "（空）"}。`, attribute.range.start, attribute.range.end);
    if (!isDirectory(attribute.value)) fail(diagnostics, `目录导入必须是项目内相对路径：${attribute.value}。`, attribute.valueRange.start, attribute.valueRange.end);
    if (imports.has(alias)) fail(diagnostics, `目录别名重复：${alias}。`, attribute.range.start, attribute.range.end);
    imports.set(alias, attribute);
  }
  const rootTag = canonicalTag(root.tag);
  if (rootTag !== "lui:Page" && rootTag !== "lui:Component") fail(diagnostics, "LUI 根节点只能是 <页面> 或 <控件>。", root.range.start, root.openTagEnd);
  const visit = (node: LuiNode, parentTag?: string, isRoot = false) => {
    if (node.kind !== "element") return;
    if (node.tag === "__placeholder__") {
      fail(diagnostics, "空标签仅用于设计器占位；请选择标签类型后再运行。", node.range.start, node.range.end, "warning");
      return;
    }
    const seenAttributes = new Map<string, LuiAttribute>();
    for (const attribute of node.attrs) {
      if (node.tag?.includes(':') && !node.tag.startsWith('lui:') && !isLayoutProperty(attribute.name)) {
        if (seenAttributes.has(attribute.name)) fail(diagnostics, `属性重复：${attribute.name}`, attribute.range.start, attribute.range.end);
        seenAttributes.set(attribute.name, attribute); continue;
      }
      const canonicalAttributeName = canonicalAttribute(attribute.name);
      if (seenAttributes.has(canonicalAttributeName)) fail(diagnostics, `属性重复：${sourceAttribute(canonicalAttributeName)}；保存会保留最后一个值。`, attribute.range.start, attribute.range.end);
      seenAttributes.set(canonicalAttributeName, attribute);
      validateValue(diagnostics, attribute);
      validateCommand(diagnostics, attribute);
      if (canonicalAttributeName === "LayoutTransform" && /平移\s*\(/.test(attribute.value)) fail(diagnostics, "布局变换中的平移会被忽略；请改用渲染变换。", attribute.valueRange.start, attribute.valueRange.end, "warning");
      if (DEPRECATED_CANONICAL_ATTRIBUTES.has(canonicalAttributeName)) fail(diagnostics, `${sourceAttribute(canonicalAttributeName)} 已移除；请改用 <容器> 的子项排列、对齐与边距。`, attribute.range.start, attribute.range.end, "warning");
      const definition = attributeDefinition(canonicalAttributeName);
      if (definition?.tags && !definition.tags.includes(canonicalTag(node.tag) ?? "") && !canonicalAttributeName.startsWith("Grid.") && !canonicalAttributeName.startsWith("Canvas.")) fail(diagnostics, `${chineseTag(canonicalAttributeName)} 只适用于 <${definition.tags.map(chineseTag).join(">、<")}>。`, attribute.range.start, attribute.range.end);
      if (canonicalAttributeName.startsWith("Grid.") && parentTag !== "Grid") fail(diagnostics, `${sourceAttribute(canonicalAttributeName)} 只可用于 <网格> 的直接子项。`, attribute.range.start, attribute.range.end);
      if (canonicalAttributeName.startsWith("Canvas.") && parentTag !== "Canvas") fail(diagnostics, `${sourceAttribute(canonicalAttributeName)} 只可用于 <画布> 的直接子项。`, attribute.range.start, attribute.range.end);
    }
    const has = (name: string) => seenAttributes.has(name);
    if (parentTag === "Canvas" && ((has("Canvas.Left") && has("Canvas.Right")) || (has("Canvas.Top") && has("Canvas.Bottom")))) fail(diagnostics, "画布同一轴只能指定一侧定位。", node.range.start, node.openTagEnd);
    const primary = getAttribute(node, "x:Name");
    const display = getAttribute(node, "x:DisplayName");
    const ref = getAttribute(node, "x:Ref");
    const legacyNamespace = getAttribute(node, "x:Namespace");
    if (legacyNamespace) fail(diagnostics, "旧命名空间属性已废弃；请在根节点使用 目录:别名=\"目录路径\"。", legacyNamespace.range.start, legacyNamespace.range.end, "warning");
    if (isRoot && !primary) fail(diagnostics, `<${node.tag ?? "根"}> 必须声明名称，用于 LUI 注册表。`, node.range.start, node.openTagEnd);
    if (primary) {
      if (!isDesignName(primary.value)) fail(diagnostics, `名称必须是非空的设计名称：${primary.value}`, primary.valueRange.start, primary.valueRange.end);
      const duplicate = designNames.get(primary.value) ?? displayNames.get(primary.value);
      if (duplicate) fail(diagnostics, `设计名称重复或与副名称冲突：${primary.value}。`, primary.valueRange.start, primary.valueRange.end);
      designNames.set(primary.value, primary);
    }
    if (display) {
      if (!isDesignName(display.value)) fail(diagnostics, "副名称不能为空。", display.valueRange.start, display.valueRange.end);
      const duplicate = displayNames.get(display.value) ?? designNames.get(display.value);
      if (duplicate) fail(diagnostics, `副名称重复或与设计名称冲突：${display.value}。`, display.valueRange.start, display.valueRange.end);
      displayNames.set(display.value, display);
    }
    if (ref) {
      if (!ASCII_REFERENCE.test(ref.value)) fail(diagnostics, `引用必须是 ASCII Lua 引用：${ref.value}`, ref.valueRange.start, ref.valueRange.end);
      else if (refs.has(ref.value)) fail(diagnostics, `引用在渲染树内重复：${ref.value}。`, ref.valueRange.start, ref.valueRange.end);
      refs.set(ref.value, ref);
    }
    const sourceTag = node.tag;
    const canonical = canonicalTag(sourceTag);
    if (sourceTag === "循环") fail(diagnostics, "<循环> 已改名为 <重复项>；按集合重复生成内部模板，旧语法仅兼容读取。", node.range.start, node.openTagEnd, "warning");
    if (sourceTag && canonical && !KNOWN_CANONICAL_TAGS.has(canonical) && !sourceTag.includes(":") && !sourceTag.includes(".")) fail(diagnostics, `未识别控件 <${sourceTag}>；属性窗格仅显示基础布局属性。`, node.range.start, node.openTagEnd, "warning");
    if (!isRoot && (canonical === "lui:Page" || canonical === "lui:Component")) fail(diagnostics, "<页面> 与 <控件> 只能作为 LUI 文档根节点，不能嵌套。", node.range.start, node.openTagEnd);
    if (canonical === "lui:Page") {
      for (const name of ["Width", "Height"]) {
        const attribute = getAttribute(node, name);
        if (!attribute || !/^\d+(?:\.\d+)?$/.test(attribute.value) || Number(attribute.value) <= 0) fail(diagnostics, `<页面> 的${sourceAttribute(name)}必须是正数 px，作为设计坐标而非设备分辨率。`, attribute?.valueRange.start ?? node.range.start, attribute?.valueRange.end ?? node.openTagEnd);
      }
    }
    if (canonical === "Viewbox") {
      for (const name of ["Width", "Height"]) {
        const attribute = getAttribute(node, name);
        if (!attribute || !/^\d+(?:\.\d+)?$/.test(attribute.value) || Number(attribute.value) <= 0) fail(diagnostics, `<视图框> 的${sourceAttribute(name)}必须是正数 px，作为内部设计坐标而非设备分辨率。`, attribute?.valueRange.start ?? node.range.start, attribute?.valueRange.end ?? node.openTagEnd);
      }
    }
    if (canonical === "lui:Preview" || canonical === "lui:Set") fail(diagnostics, `<${sourceTag}> 预览状态已移除；请将单个绑定样例写入“预览内容”并删除该节点。`, node.range.start, node.openTagEnd, "warning");
    else if (canonical && DEPRECATED_CANONICAL_TAGS.has(canonical)) fail(diagnostics, `<${sourceTag}> 已移除；请使用 <容器> 或直接让语义控件承载子项。`, node.range.start, node.openTagEnd, "warning");
    if (sourceTag && canonical && chineseTag(canonical) !== sourceTag && isLegacyToken(sourceTag)) fail(diagnostics, `标签 <${sourceTag}> 已过时；请改为 <${chineseTag(canonical)}>。`, node.range.start, node.openTagEnd, "warning");
    for (const attribute of node.attrs) if (!componentAttribute(node,attribute.name) && isLegacyToken(attribute.name)) fail(diagnostics, `属性 ${attribute.name} 已过时；请改用中文属性。`, attribute.range.start, attribute.range.end, "warning");
    const childLayout = getAttribute(node, "ChildLayout")?.value ?? "自由";
    if (childLayout === "自由") {
      const anchors = new Map<string, LuiNode>();
      const visual = node.children.filter((child) => child.kind === "element" && !["lui:If", "lui:For", "lui:Slot", "lui:Preview", "lui:Set"].includes(canonicalTag(child.tag) ?? ""));
      for (const child of visual) {
        const visibility = getAttribute(child, "Visibility")?.value;
        if (["折叠", "否", "false"].includes(visibility ?? "")) continue;
        if (getAttribute(child, "ZIndex") || getAttribute(child, "RenderTransform") || getAttribute(child, "LayoutTransform")) continue;
        const anchor = `${getAttribute(child, "VerticalAlignment")?.value ?? "拉伸"}|${getAttribute(child, "HorizontalAlignment")?.value ?? "拉伸"}`;
        if (anchors.has(anchor)) {
          fail(diagnostics, "自由排列会把同一对齐位置的多个子项叠放；如需上下排列，请设置 子项排列=\"垂直\"。", child.range.start, child.openTagEnd, "warning");
          break;
        }
        anchors.set(anchor, child);
      }
    }
    const separator = sourceTag?.indexOf(":") ?? -1;
    if (separator > 0) {
      const alias = sourceTag!.slice(0, separator);
      if (!imports.has(alias)) fail(diagnostics, `组件 <${sourceTag}> 未导入目录别名 ${alias}。`, node.range.start, node.openTagEnd);
    }
    // 旧条件、循环和内容呈现器只控制是否/如何产生子项，不是布局容器；其子项
    // 仍视为最近网格或画布的直接可定位子项。
    const childParent = canonical === "lui:If" || canonical === "lui:For" || canonical === "lui:Slot" ? parentTag : canonical;
    for (const child of node.children) visit(child, childParent, false);
  };
  visit(root, undefined, true);
  if (root.tag === "控件" || root.tag === "组件" || canonicalTag(root.tag) === "lui:Component") {
    let presenters = 0;
    const countPresenters = (node: LuiNode) => {
      if (node.tag === "内容呈现器" || node.tag === "插槽" || canonicalTag(node.tag) === "lui:Slot") presenters += 1;
      for (const child of node.children) countPresenters(child);
    };
    countPresenters(root);
    if (presenters > 1) fail(diagnostics, "<控件> 最多只能包含一个 <内容呈现器 />。", root.range.start, root.openTagEnd);
  }
  return diagnostics;
}

function escapeAttribute(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;"); }

function componentAttribute(node: LuiNode, name: string): boolean { return !!node.tag?.includes(':') && !node.tag.startsWith('lui:') && !isLayoutProperty(name); }
function attributeIdentity(node: LuiNode, name: string): string { return componentAttribute(node,name) ? name : canonicalAttribute(name); }
function attributeSpelling(node: LuiNode, name: string): string { return componentAttribute(node,name) ? name : sourceAttribute(name); }

function rewrittenOpenTag(source: string, node: LuiNode, override?: { name: string; value: string }): string {
  const openEnd = node.openTagEnd ?? node.range.end;
  const opening = source.slice(node.range.start, openEnd);
  const prefix = /^(<\s*[^\s/>]+)/.exec(opening)?.[1];
  if (!prefix) return opening;
  const attrs = node.attrs.map((attribute) => ({ ...attribute, canonical: attributeIdentity(node,attribute.name) }));
  const target = override ? attributeIdentity(node,override.name) : undefined;
  const last = new Map<string, number>();
  attrs.forEach((attribute, index) => last.set(attribute.canonical, index));
  const values = attrs.filter((attribute, index) => last.get(attribute.canonical) === index).map((attribute) => ({ name: attributeSpelling(node,attribute.canonical), value: attribute.value }));
  if (target) {
    const existing = values.find((attribute) => attributeIdentity(node,attribute.name) === target);
    if (existing) { existing.name = attributeSpelling(node,target); existing.value = override!.value; }
    else values.push({ name: attributeSpelling(node,target), value: override!.value });
  }
  const tail = /\/\>\s*$/.test(opening) ? " />" : ">";
  return `${prefix}${values.map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join("")}${tail}`;
}

/** Collapses semantic duplicate attributes without changing node order or children. */
export function normalizeLuiAttributes(source: string): string {
  let normalized = source;
  for (;;) {
    const document = parseLui(normalized);
    let duplicateNode: LuiNode | undefined;
    const find = (node: LuiNode | undefined) => {
      if (!node || duplicateNode) return;
      for (const child of node.children) find(child);
      const seen = new Set<string>();
      if (node.attrs.some((attribute) => {
        const canonical = attributeIdentity(node,attribute.name);
        if (seen.has(canonical)) return true;
        seen.add(canonical); return false;
      })) duplicateNode = node;
    };
    find(document.root);
    if (!duplicateNode) return normalized;
    const end = duplicateNode.openTagEnd ?? duplicateNode.range.end;
    normalized = normalized.slice(0, duplicateNode.range.start) + rewrittenOpenTag(normalized, duplicateNode) + normalized.slice(end);
  }
}

/** Canonical two-space formatting. It is only applied to documents without diagnostics. */
export function formatLui(source: string): string | undefined {
  const document = parseLui(normalizeLuiAttributes(source));
  if (!document.root || document.diagnostics.some((item) => item.severity === "error")) return undefined;
  const write = (node: LuiNode, depth: number): string => {
    const indentation = "  ".repeat(depth);
    if (node.kind === "comment") return `${indentation}<!--${node.text ?? ""}-->`;
    if (node.kind === "text") return node.text?.trim() ? `${indentation}${node.text.trim()}` : "";
    const attrs = node.attrs.map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join("");
    const children = node.children.filter((child) => child.kind !== "text" || Boolean(child.text?.trim()));
    if (!children.length) return `${indentation}<${node.tag}${attrs} />`;
    const textOnly = children.length === 1 && children[0]!.kind === "text";
    if (textOnly) return `${indentation}<${node.tag}${attrs}>${children[0]!.text!.trim()}</${node.tag}>`;
    return `${indentation}<${node.tag}${attrs}>\n${children.map((child) => write(child, depth + 1)).filter(Boolean).join("\n")}\n${indentation}</${node.tag}>`;
  };
  return `${write(document.root, 0)}\n`;
}

export function editAttribute(source: string, node: LuiNode, name: string, value: string): string {
  const end = node.openTagEnd ?? node.range.end;
  return source.slice(0, node.range.start) + rewrittenOpenTag(source, node, { name, value }) + source.slice(end);
}

/** Explicit component interfaces keep exact attribute spelling and surrounding source. */
export function editPublicAttribute(source: string, node: LuiNode, name: string, value?: string): string {
  const attribute = node.attrs.find(item => item.name === name);
  if (attribute) {
    if (value === undefined) return source.slice(0, attribute.range.start) + source.slice(attribute.range.end);
    const quote = source[attribute.valueRange.start - 1];
    const escaped = value.replaceAll('&', '&amp;').replaceAll(quote!, quote === '"' ? '&quot;' : '&apos;');
    return source.slice(0, attribute.valueRange.start) + escaped + source.slice(attribute.valueRange.end);
  }
  if (value === undefined) return source;
  let offset = (node.openTagEnd ?? node.range.end) - 1;
  if (source[offset - 1] === '/') offset--;
  return source.slice(0, offset) + ` ${name}="${escapeAttribute(value)}"` + source.slice(offset);
}

/** Restores an effective default by removing only the selected opening-tag attribute. */
export function removeAttribute(source: string, node: LuiNode, name: string): string {
  const target = attributeIdentity(node,name);
  const end = node.openTagEnd ?? node.range.end;
  const opening = source.slice(node.range.start, end);
  const prefix = /^(<\s*[^\s/>]+)/.exec(opening)?.[1];
  if (!prefix) return source;
  const values = node.attrs
    .filter((attribute) => attributeIdentity(node,attribute.name) !== target)
    .map((attribute) => ({ name: attributeSpelling(node,attributeIdentity(node,attribute.name)), value: attribute.value }));
  const tail = /\/\>\s*$/.test(opening) ? " />" : ">";
  return source.slice(0, node.range.start) + `${prefix}${values.map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join("")}${tail}` + source.slice(end);
}

/** Replaces the selected element's paired source tags without touching its attributes or children. */
export function editTag(source: string, node: LuiNode, nextTag: string): string {
  if (node.tag === "__placeholder__") return source.slice(0, node.range.start) + `<${nextTag} />` + source.slice(node.range.end);
  if (node.kind !== "element") return source;
  const openEnd = node.openTagEnd ?? node.range.end;
  const open = source.slice(node.range.start, openEnd);
  const updatedOpen = open.replace(/^(<\s*)[^\s/>]+/, `$1${nextTag}`);
  let result = source.slice(0, node.range.start) + updatedOpen + source.slice(openEnd);
  if (node.closeTagStart === undefined) return result;
  const delta = updatedOpen.length - open.length;
  const closeStart = node.closeTagStart + delta;
  const closeEnd = result.indexOf(">", closeStart) + 1;
  return closeEnd > closeStart ? result.slice(0, closeStart) + result.slice(closeStart, closeEnd).replace(/^(<\s*\/\s*)[^\s>]+/, `$1${nextTag}`) + result.slice(closeEnd) : result;
}

export function displayNameOf(node: LuiNode): string {
  const caption = getAttribute(node, "x:DisplayName")?.value || getAttribute(node, "x:Name")?.value;
  if (caption) return caption;
  const tag = chineseTag(canonicalTag(node.tag) ?? node.tag ?? "控件");
  const text = getAttribute(node, "Text")?.value ?? getAttribute(node, "Title")?.value;
  return text ? `${tag} · ${text}` : tag;
}
