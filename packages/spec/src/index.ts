/**
 * LUI's portable syntax model. UTF-8 is valid everywhere in the design
 * document except values that cross the Lua boundary (x:Ref, Binding, Action).
 */
export interface LuiRange { start: number; end: number; }

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
    fail(diagnostics, "LUI 标签缺少名称。", start);
    const terminator = source.indexOf(">", start);
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
      else if (node.tag !== close.tag) { fail(diagnostics, `结束标签 </${close.tag}> 与 <${node.tag}> 不匹配。`, index, close.end); node.range.end = close.end; }
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
  return node.attrs.find((attribute) => attribute.name === name);
}

export interface LuiImport { alias: string; directory: string; attribute: LuiAttribute; }

/** Returns root-level component-directory imports; the system `lui` import is excluded. */
export function namespaceImports(document: LuiDocument): LuiImport[] {
  const root = document.root;
  if (!root) return [];
  return root.attrs
    .filter((attribute) => attribute.name.startsWith("xmlns:") && attribute.name !== "xmlns:lui")
    .map((attribute) => ({ alias: attribute.name.slice("xmlns:".length), directory: attribute.value, attribute }));
}

function isDesignName(value: string): boolean { return value.trim().length > 0 && !/[<>]/.test(value); }
function isDirectory(value: string): boolean { return value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === ".."); }

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
    if (!attribute.name.startsWith("xmlns:")) continue;
    const alias = attribute.name.slice("xmlns:".length);
    if (alias === "lui") {
      if (attribute.value !== "urn:lui") fail(diagnostics, "xmlns:lui 必须是 urn:lui。", attribute.valueRange.start, attribute.valueRange.end);
      continue;
    }
    if (!alias || /[\s:]/.test(alias)) fail(diagnostics, `目录别名无效：${alias || "（空）"}。`, attribute.range.start, attribute.range.end);
    if (!isDirectory(attribute.value)) fail(diagnostics, `目录导入必须是项目内相对路径：${attribute.value}。`, attribute.valueRange.start, attribute.valueRange.end);
    if (imports.has(alias)) fail(diagnostics, `目录别名重复：${alias}。`, attribute.range.start, attribute.range.end);
    imports.set(alias, attribute);
  }
  const visit = (node: LuiNode) => {
    if (node.kind !== "element") return;
    const primary = getAttribute(node, "x:Name");
    const display = getAttribute(node, "x:DisplayName");
    const ref = getAttribute(node, "x:Ref");
    const legacyNamespace = getAttribute(node, "x:Namespace");
    if (legacyNamespace) fail(diagnostics, "x:Namespace 已废弃；请在根节点使用 xmlns:目录别名=\"目录路径\"。", legacyNamespace.range.start, legacyNamespace.range.end, "warning");
    if (primary) {
      if (!isDesignName(primary.value)) fail(diagnostics, `x:Name 必须是非空的设计名称：${primary.value}`, primary.valueRange.start, primary.valueRange.end);
      const duplicate = designNames.get(primary.value) ?? displayNames.get(primary.value);
      if (duplicate) fail(diagnostics, `设计名称重复或与副名称冲突：${primary.value}。`, primary.valueRange.start, primary.valueRange.end);
      designNames.set(primary.value, primary);
    }
    if (display) {
      if (!isDesignName(display.value)) fail(diagnostics, "x:DisplayName 不能为空。", display.valueRange.start, display.valueRange.end);
      const duplicate = displayNames.get(display.value) ?? designNames.get(display.value);
      if (duplicate) fail(diagnostics, `副名称重复或与设计名称冲突：${display.value}。`, display.valueRange.start, display.valueRange.end);
      displayNames.set(display.value, display);
    }
    if (ref) {
      if (!ASCII_REFERENCE.test(ref.value)) fail(diagnostics, `x:Ref 必须是 ASCII Lua 引用：${ref.value}`, ref.valueRange.start, ref.valueRange.end);
      else if (refs.has(ref.value)) fail(diagnostics, `x:Ref 在渲染树内重复：${ref.value}。`, ref.valueRange.start, ref.valueRange.end);
      refs.set(ref.value, ref);
    }
    const separator = node.tag?.indexOf(":") ?? -1;
    if (separator > 0) {
      const alias = node.tag!.slice(0, separator);
      if (alias !== "lui" && !imports.has(alias)) fail(diagnostics, `组件 <${node.tag}> 未导入目录别名 ${alias}。`, node.range.start, node.openTagEnd);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return diagnostics;
}

function escapeAttribute(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;"); }

/** Canonical two-space formatting. It is only applied to documents without diagnostics. */
export function formatLui(source: string): string | undefined {
  const document = parseLui(source);
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
  const existing = getAttribute(node, name);
  if (existing) return source.slice(0, existing.valueRange.start) + value + source.slice(existing.valueRange.end);
  const insertAt = (node.openTagEnd ?? node.range.end) - (source.slice(0, node.openTagEnd).endsWith("/>") ? 2 : 1);
  return source.slice(0, insertAt) + ` ${name}="${escapeAttribute(value)}"` + source.slice(insertAt);
}

export function displayNameOf(node: LuiNode): string {
  return getAttribute(node, "x:DisplayName")?.value || getAttribute(node, "x:Name")?.value || node.tag || "未命名组件";
}
