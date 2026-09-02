/**
 * LUI's portable syntax model.  The parser deliberately treats UTF-8 text as
 * opaque JavaScript strings: only XML punctuation has syntactic meaning.
 * Runtime identity is always the ASCII x:Name field, never x:DisplayName.
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

const PRIMARY_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const RESERVED = /[\s<>/="']/;

function fail(diagnostics: LuiDiagnostic[], message: string, start: number, end = start + 1) {
  diagnostics.push({ message, range: { start, end }, severity: "error" });
}

function skipSpace(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index]!)) index += 1;
  return index;
}

function readName(source: string, index: number): { value: string; end: number } | undefined {
  const start = index;
  while (index < source.length && !RESERVED.test(source[index]!)) index += 1;
  return index === start ? undefined : { value: source.slice(start, index), end: index };
}

function parseOpenTag(source: string, start: number, diagnostics: LuiDiagnostic[]): { node?: LuiNode; end: number; selfClosing: boolean } {
  let index = skipSpace(source, start + 1);
  const name = readName(source, index);
  if (!name) {
    fail(diagnostics, "LUI 标签缺少名称。", start);
    return { end: source.indexOf(">", start) + 1 || source.length, selfClosing: false };
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
  const node: LuiNode = { kind: "element", tag: name.value, attrs, children: [], range: { start, end: index }, openTagEnd: index };
  return { node, end: index, selfClosing };
}

function parseCloseTag(source: string, start: number, diagnostics: LuiDiagnostic[]): { tag: string; end: number } | undefined {
  const match = /^<\/\s*([^\s>/]+)\s*>/.exec(source.slice(start));
  if (!match) { fail(diagnostics, "LUI 结束标签无效。", start); return undefined; }
  return { tag: match[1]!, end: start + match[0].length };
}

/** Parses the safe XML-shaped LUI subset. DTD, processing instructions and entities are intentionally excluded. */
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
      else if (node.tag !== close.tag) {
        fail(diagnostics, `结束标签 </${close.tag}> 与 <${node.tag}> 不匹配。`, index, close.end);
        node.range.end = close.end;
      } else {
        node.closeTagStart = index;
        node.range.end = close.end;
      }
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

/** Validates LUI's paired-name identity contract without treating display names as runtime keys. */
export function validateLui(document: LuiDocument): LuiDiagnostic[] {
  const diagnostics = document.diagnostics;
  const primaryByNamespace = new Map<string, Map<string, LuiAttribute>>();
  const displayByNamespace = new Map<string, Map<string, LuiAttribute>>();
  const visit = (node: LuiNode, inheritedNamespace: string) => {
    if (node.kind !== "element") return;
    const primary = getAttribute(node, "x:Name");
    const display = getAttribute(node, "x:DisplayName");
    const scope = getAttribute(node, "x:Namespace")?.value || inheritedNamespace;
    const requiresName = ["lui:Page", "lui:Component", "lui:Action", "lui:Resource", "lui:Preview"].includes(node.tag ?? "");
    if (requiresName && !primary) fail(diagnostics, `<${node.tag}> 必须声明 ASCII x:Name。`, node.range.start, node.openTagEnd);
    if (primary) {
      if (!PRIMARY_NAME.test(primary.value)) fail(diagnostics, `x:Name 必须是 ASCII 主名称：${primary.value}`, primary.valueRange.start, primary.valueRange.end);
      const primaryNames = primaryByNamespace.get(scope) ?? new Map<string, LuiAttribute>();
      const displayNames = displayByNamespace.get(scope) ?? new Map<string, LuiAttribute>();
      const duplicate = primaryNames.get(primary.value) ?? displayNames.get(primary.value);
      if (duplicate) fail(diagnostics, `名称 ${primary.value} 在命名空间 ${scope} 中重复。`, primary.valueRange.start, primary.valueRange.end);
      primaryNames.set(primary.value, primary); primaryByNamespace.set(scope, primaryNames);
    }
    if (display) {
      if (!display.value.trim()) fail(diagnostics, "x:DisplayName 不能为空。", display.valueRange.start, display.valueRange.end);
      const primaryNames = primaryByNamespace.get(scope) ?? new Map<string, LuiAttribute>();
      const displayNames = displayByNamespace.get(scope) ?? new Map<string, LuiAttribute>();
      const duplicate = displayNames.get(display.value) ?? primaryNames.get(display.value);
      if (duplicate) fail(diagnostics, `名称 ${display.value} 在命名空间 ${scope} 中重复。`, display.valueRange.start, display.valueRange.end);
      displayNames.set(display.value, display); displayByNamespace.set(scope, displayNames);
    }
    for (const child of node.children) visit(child, scope);
  };
  if (document.root) visit(document.root, "default");
  return diagnostics;
}

export function editAttribute(source: string, node: LuiNode, name: string, value: string): string {
  const existing = getAttribute(node, name);
  if (existing) return source.slice(0, existing.valueRange.start) + value + source.slice(existing.valueRange.end);
  const insertAt = (node.openTagEnd ?? node.range.end) - (source.slice(0, node.openTagEnd).endsWith("/>") ? 2 : 1);
  return source.slice(0, insertAt) + ` ${name}="${value.replaceAll("\"", "&quot;")}"` + source.slice(insertAt);
}

export function displayNameOf(node: LuiNode): string {
  return getAttribute(node, "x:DisplayName")?.value || getAttribute(node, "x:Name")?.value || node.tag || "未命名组件";
}
