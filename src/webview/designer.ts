import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { xml } from "@codemirror/lang-xml";

interface DiagnosticInfo { message: string; severity: "error" | "warning"; range: { start: number; end: number }; }
interface SerializableNode {
  kind: "element" | "text" | "comment";
  tag?: string;
  text?: string;
  start: number;
  end: number;
  source: string;
  displayName: string;
  attrs: Record<string, string>;
  children: SerializableNode[];
}
interface SourcePayload { source: string; version: number; text: string; displayPath: string; diagnostics: DiagnosticInfo[]; }
interface ModelPayload {
  type: "model";
  model: { root?: SerializableNode; diagnostics: DiagnosticInfo[] };
  catalog: Record<string, Record<string, SerializableNode>>;
  sources: Record<string, SourcePayload>;
  rootSource: string;
  device: string;
}
interface SourceReloadPayload { type: "source"; source: SourcePayload; }
interface PickedNode { start: number; end: number; source: string; }

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const ATTRIBUTE_LABELS: Record<string, string> = {
  "x:Name": "设计名称", "x:DisplayName": "副名称", "x:Ref": "Lua 引用", Width: "宽度", Height: "高度", MinWidth: "最小宽度", MinHeight: "最小高度", MaxWidth: "最大宽度", MaxHeight: "最大高度",
  Margin: "外边距", Padding: "内边距", Gap: "子项间距", Anchor: "锚点", Left: "左侧", Top: "顶部", Right: "右侧", Bottom: "底部", FlexGrow: "弹性增长", FlexBasis: "弹性基准", Align: "交叉轴对齐", Justify: "主轴对齐",
  Background: "背景色", Color: "文字颜色", Opacity: "透明度", BorderRadius: "圆角", Variant: "样式变体", Text: "文本", Title: "标题", FontSize: "字号", Click: "点击动作", Change: "变更动作", Disabled: "禁用", Value: "数值", Max: "最大值", Min: "最小值", Test: "条件", In: "数据集合", Each: "循环变量", Path: "绑定路径", Close: "关闭动作"
};
const BUILTIN_TAGS = ["Panel", "Row", "Text", "Button", "Card", "Scroll", "Progress", "Toggle", "Slider", "SafeArea", "Modal", "Section", "Notice", "Screen", "FixedScreen", "lui:If", "lui:For", "lui:Slot", "lui:Preview"];
const ATTRIBUTE_NAMES = Object.keys(ATTRIBUTE_LABELS).concat(["xmlns:积木"]);
const CATEGORIES: Array<[string, string[]]> = [
  ["LUI 名称", ["x:Name", "x:DisplayName"]],
  ["Lua 引用", ["x:Ref"]],
  ["布局", ["Margin", "Padding", "Width", "Height", "MinWidth", "MinHeight", "MaxWidth", "MaxHeight", "Anchor", "Left", "Top", "Right", "Bottom", "Gap", "FlexGrow", "FlexBasis", "Align", "Justify"]],
  ["外观", ["Background", "Color", "Opacity", "BorderRadius", "Variant"]],
  ["文本与交互", ["Text", "Title", "FontSize", "Click", "Change", "Close", "Disabled", "Value", "Min", "Max"]],
  ["数据与条件", ["Test", "In", "Each", "Path"]]
];

let model: ModelPayload["model"] | undefined;
let catalog: ModelPayload["catalog"] = {};
let sources: Record<string, SourcePayload> = {};
let rootSource = "";
let selected: PickedNode | undefined;
let hovered: PickedNode | undefined;
let editor: EditorView | undefined;
let activeSource: SourcePayload | undefined;
let sourceTimer: ReturnType<typeof setTimeout> | undefined;
let writingSource = false;
let inFlight: { source: string; version: number; text: string } | undefined;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const text = (value: unknown): string => String(value ?? "");

function nodeFrom(root: SerializableNode | undefined, start: number, source: string): SerializableNode | undefined {
  if (!root) return undefined;
  if (root.start === start && root.source === source) return root;
  for (const child of root.children ?? []) {
    const hit = nodeFrom(child, start, source);
    if (hit) return hit;
  }
  return undefined;
}

function nodeContaining(root: SerializableNode | undefined, offset: number, source: string): SerializableNode | undefined {
  if (!root || root.source !== source || offset < root.start || offset > root.end) return undefined;
  for (const child of root.children ?? []) {
    const nested = nodeContaining(child, offset, source);
    if (nested) return nested;
  }
  return root.kind === "element" ? root : undefined;
}

function allRoots(): SerializableNode[] {
  const roots: SerializableNode[] = [];
  if (model?.root) roots.push(model.root);
  for (const group of Object.values(catalog)) for (const component of Object.values(group)) roots.push(component);
  return roots;
}

function getNode(start: number, source: string): SerializableNode | undefined {
  for (const root of allRoots()) {
    const hit = nodeFrom(root, start, source);
    if (hit) return hit;
  }
  return undefined;
}

function getNodeContaining(offset: number, source: string): SerializableNode | undefined {
  for (const root of allRoots()) {
    const hit = nodeContaining(root, offset, source);
    if (hit) return hit;
  }
  return undefined;
}

function nodeRef(node: SerializableNode): PickedNode { return { start: node.start, end: node.end, source: node.source }; }
function sameNode(left: PickedNode | undefined, right: PickedNode | undefined): boolean {
  return !!left && !!right && left.start === right.start && left.source === right.source;
}

function previews(node: SerializableNode | undefined, out: SerializableNode[] = []): SerializableNode[] {
  if (!node) return out;
  if (node.kind === "element" && node.tag === "lui:Preview") out.push(node);
  for (const child of node.children ?? []) previews(child, out);
  return out;
}

function previewValues(): Record<string, string> {
  const select = byId<HTMLSelectElement>("preview");
  const state = previews(model?.root).find((item) => item.start === Number(select.value));
  const values: Record<string, string> = {};
  for (const child of state?.children ?? []) if (child.tag === "lui:Set" && child.attrs.Path) values[child.attrs.Path] = child.attrs.Value;
  return values;
}

function getPath(value: unknown, path: string): unknown {
  let result = value as Record<string, unknown> | undefined;
  for (const key of String(path ?? "").split(".")) {
    if (result === undefined || result === null) return undefined;
    result = result[key] as Record<string, unknown> | undefined;
  }
  return result;
}

function resolve(value: string | undefined, scope: Record<string, unknown>): string | undefined {
  const binding = /^\{Binding\s+([A-Za-z][A-Za-z0-9_.-]*)\}$/.exec(value ?? "");
  if (!binding) return value;
  const fromScope = getPath(scope, binding[1]);
  if (fromScope !== undefined) return String(fromScope);
  const fromPreview = getPath(previewValues(), binding[1]);
  if (fromPreview !== undefined) return String(fromPreview);
  const samples: Record<string, string> = {
    title: "无尽塔", enemyText: "塔层守卫 · Lv.1", playerText: "冒险者 · Lv.1", logText: "战斗记录将在这里显示。",
    weaponText: "武器槽（空）", armorText: "护甲槽（空）", detailText: "在这里查看当前选择的说明。", profileSummary: "本地进度已就绪。"
  };
  return samples[binding[1]] ?? `{{${binding[1]}}}`;
}

function effective(node: SerializableNode, scope: Record<string, unknown>): Record<string, string | undefined> {
  const attrs: Record<string, string | undefined> = { ...node.attrs };
  const owner = `${String(node.tag)}.`;
  for (const child of node.children ?? []) {
    if (child.tag?.startsWith(owner)) attrs[child.tag.slice(owner.length)] = (child.children ?? []).filter((item) => item.kind === "text").map((item) => item.text ?? "").join("").trim();
  }
  for (const key of Object.keys(attrs)) attrs[key] = resolve(attrs[key], scope);
  return attrs;
}

function visualChildren(node: SerializableNode): SerializableNode[] {
  return (node.children ?? []).filter((child) => !child.tag?.startsWith(`${String(node.tag)}.`) && child.tag !== "lui:Preview" && child.tag !== "lui:Set");
}

function cssSize(value: unknown): string { return /^\d+(?:\.\d+)?$/.test(text(value)) ? `${text(value)}px` : text(value); }
function bool(value: unknown): boolean { return value !== false && value !== undefined && value !== null && value !== "" && value !== "false" && value !== 0; }

function decorate(element: HTMLElement, node: SerializableNode): void {
  element.dataset.start = String(node.start);
  element.dataset.source = node.source;
  element.classList.add("lui-node");
  element.onmouseenter = () => { hovered = nodeRef(node); applyHighlights(); };
  element.onmouseleave = () => { hovered = undefined; applyHighlights(); };
  element.onclick = (event) => { event.stopPropagation(); pick(node); };
}

function applyLayout(element: HTMLElement, attrs: Record<string, string | undefined>): void {
  const styles: Record<string, string> = { Width: "width", Height: "height", MinWidth: "minWidth", MinHeight: "minHeight", MaxWidth: "maxWidth", MaxHeight: "maxHeight", Margin: "margin", Padding: "padding", Gap: "gap", Background: "background", Color: "color", Opacity: "opacity", Left: "left", Top: "top", Right: "right", Bottom: "bottom", FlexBasis: "flexBasis" };
  for (const [attribute, style] of Object.entries(styles)) if (attrs[attribute] !== undefined) (element.style as unknown as Record<string, string>)[style] = cssSize(attrs[attribute]);
  if (attrs.FlexGrow !== undefined) element.style.flexGrow = text(attrs.FlexGrow);
  if (attrs.Left !== undefined || attrs.Top !== undefined || attrs.Right !== undefined || attrs.Bottom !== undefined) element.style.position = "absolute";
  if (attrs.Align) element.style.alignItems = attrs.Align;
  if (attrs.Justify) element.style.justifyContent = attrs.Justify;
}

function fragmentChildren(nodes: SerializableNode[], scope: Record<string, unknown>, trace: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const child of nodes) fragment.append(renderNode(child, scope, trace));
  return fragment;
}

function componentTemplate(node: SerializableNode): { directory: string; name: string; template: SerializableNode } | undefined {
  const [alias, name] = String(node.tag).split(":");
  const sourceRoot = allRoots().find((root) => root.source === node.source);
  const directory = sourceRoot?.attrs[`xmlns:${alias}`];
  const template = directory ? catalog[directory]?.[name] : undefined;
  return directory && name && template ? { directory, name, template } : undefined;
}

function renderComponent(node: SerializableNode, scope: Record<string, unknown>, trace: string[]): Node {
  const component = componentTemplate(node);
  if (!component) return document.createComment(`组件未登记：${node.tag}`);
  const { directory, name, template } = component;
  const key = `${directory}/${name}`;
  if (trace.includes(key)) return document.createComment(`组件循环：${key}`);
  const wrapper = document.createElement("div");
  wrapper.className = "lui-component-instance";
  decorate(wrapper, node);
  const props = { ...(scope.props as Record<string, unknown> | undefined) };
  for (const [property, value] of Object.entries(effective(node, scope))) props[property] = value;
  wrapper.append(fragmentChildren(visualChildren(template), { ...scope, props, slots: { Content: visualChildren(node) } }, [...trace, key]));
  return wrapper;
}

function renderNode(node: SerializableNode, scope: Record<string, unknown> = {}, trace: string[] = []): Node {
  if (node.kind === "text") { const span = document.createElement("span"); span.textContent = node.text ?? ""; return span; }
  if (node.kind === "comment") return document.createComment(node.text ?? "");
  const tag = node.tag ?? "Panel";
  if (tag === "lui:Preview" || tag === "lui:Set") return document.createDocumentFragment();
  if (tag === "lui:If") return bool(effective(node, scope).Test) ? fragmentChildren(visualChildren(node), scope, trace) : document.createDocumentFragment();
  if (tag === "lui:For") {
    const attrs = effective(node, scope);
    const sample = { label: "示例项目", name: "示例项目", text: "示例内容" };
    return fragmentChildren(visualChildren(node), { ...scope, [attrs.Each ?? "item"]: sample, item: sample, index: 1 }, trace);
  }
  if (tag === "lui:Slot") return fragmentChildren(((scope.slots as Record<string, SerializableNode[]> | undefined)?.[effective(node, scope).Name ?? ""] ?? []), scope, trace);
  if (tag.includes(":") && !tag.startsWith("lui:")) return renderComponent(node, scope, trace);
  const element = document.createElement("div");
  decorate(element, node);
  const attrs = effective(node, scope);
  element.classList.add(`tag-${tag.replace(/[^A-Za-z0-9_-]/g, "-")}`);
  applyLayout(element, attrs);
  if (tag === "Row") element.classList.add("row"); else element.classList.add("panel");
  if (tag === "Button") { element.classList.add("button"); if (attrs.Variant === "secondary") element.classList.add("secondary"); element.textContent = text(attrs.Text); }
  else if (tag === "Text") { element.classList.add("text"); element.style.fontSize = attrs.FontSize ? cssSize(attrs.FontSize) : ""; element.textContent = text(attrs.Text); }
  else if (tag === "Card") element.classList.add("card");
  else if (tag === "Scroll") element.classList.add("scroll");
  else if (tag === "SafeArea") element.classList.add("safe-area");
  else if (tag === "Modal") element.classList.add("modal");
  else if (tag === "Progress") {
    element.classList.add("progress"); const track = document.createElement("span"); track.className = "progress-track"; const fill = document.createElement("span"); fill.className = "progress-fill";
    const maximum = Math.max(1, Number(attrs.Max) || 100); fill.style.width = `${Math.max(0, Math.min(100, (Number(attrs.Value) || 0) / maximum * 100))}%`; track.append(fill); element.append(track);
  } else if (tag === "Toggle") { element.classList.add("toggle"); element.textContent = bool(attrs.Value) ? "开启" : "关闭"; }
  else if (tag === "Slider") { element.classList.add("slider"); const input = document.createElement("input"); input.type = "range"; input.min = attrs.Min ?? "0"; input.max = attrs.Max ?? "100"; input.value = attrs.Value ?? "0"; element.append(input); }
  if (!["Button", "Text", "Progress", "Toggle", "Slider"].includes(tag)) element.append(fragmentChildren(visualChildren(node), scope, trace));
  return element;
}

function outline(node: SerializableNode, host: HTMLElement, depth = 0, trace: string[] = []): void {
  if (node.kind !== "element" || node.tag === "lui:Preview" || node.tag === "lui:Set") return;
  const row = document.createElement("button");
  row.className = "outline-row";
  row.style.marginLeft = `${depth * 12}px`;
  row.textContent = node.displayName || node.tag || "节点";
  row.onclick = () => pick(node);
  row.onmouseenter = () => { hovered = nodeRef(node); applyHighlights(); };
  row.onmouseleave = () => { hovered = undefined; applyHighlights(); };
  row.dataset.start = String(node.start);
  row.dataset.source = node.source;
  host.append(row);
  const component = node.tag?.includes(":") && !node.tag.startsWith("lui:") ? componentTemplate(node) : undefined;
  if (component) {
    const key = `${component.directory}/${component.name}`;
    if (!trace.includes(key)) for (const child of visualChildren(component.template)) outline(child, host, depth + 1, [...trace, key]);
    return;
  }
  for (const child of visualChildren(node)) outline(child, host, depth + 1, trace);
}

function propertyInput(host: HTMLElement, node: SerializableNode, key: string, value: string | undefined): void {
  const label = document.createElement("label");
  label.textContent = ATTRIBUTE_LABELS[key] ?? key;
  const input = document.createElement("input");
  input.value = value ?? "";
  input.placeholder = ATTRIBUTE_LABELS[key] ?? key;
  input.onchange = () => vscode.postMessage({ type: "setAttribute", start: node.start, source: node.source, name: key, value: input.value });
  label.append(input); host.append(label);
}

function properties(node: SerializableNode | undefined): void {
  const host = byId("properties"); host.innerHTML = "<h2>当前节点属性</h2>";
  if (!node) { const paragraph = document.createElement("p"); paragraph.textContent = "在组件树、画布或源码中选择一个节点。"; host.append(paragraph); return; }
  const attrs = node.attrs ?? {}; const used = new Set<string>();
  for (const [title, keys] of CATEGORIES) {
    const section = document.createElement("section"); const heading = document.createElement("h3"); heading.textContent = title; section.append(heading);
    for (const key of keys) if (attrs[key] !== undefined || ["x:Name", "x:Ref", "Width", "Height", "Margin", "Padding", "Anchor", "Left", "Top", "Right", "Bottom"].includes(key)) { propertyInput(section, node, key, attrs[key]); used.add(key); }
    host.append(section);
  }
  const rest = Object.keys(attrs).filter((key) => !used.has(key) && !key.startsWith("xmlns:"));
  if (rest.length) { const section = document.createElement("section"); const heading = document.createElement("h3"); heading.textContent = "其他属性"; section.append(heading); for (const key of rest) propertyInput(section, node, key, attrs[key]); host.append(section); }
}

function applyHighlights(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-start][data-source]")) {
    const candidate: PickedNode = { start: Number(element.dataset.start), end: Number(element.dataset.start), source: element.dataset.source ?? "" };
    element.classList.toggle("is-selected", sameNode(selected, candidate));
    element.classList.toggle("is-hovered", sameNode(hovered, candidate));
  }
}

function sourceDiagnostics(payload: SourcePayload): Diagnostic[] {
  return payload.diagnostics.map((issue) => ({ from: issue.range.start, to: issue.range.end, severity: issue.severity === "error" ? "error" : "warning", message: issue.message }));
}

function chooseSource(source: string): SourcePayload | undefined { return sources[source]; }

function sendSourceEdit(): void {
  if (!editor || !activeSource || inFlight) return;
  const payload = activeSource;
  const nextText = editor.state.doc.toString();
  inFlight = { source: payload.source, version: payload.version, text: nextText };
  vscode.postMessage({ type: "sourceEdit", source: payload.source, version: payload.version, text: nextText });
}

function sourceCompletions(context: CompletionContext) {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 200), context.pos);
  const tag = context.matchBefore(/<[\w:\-\u0080-\uffff]*/);
  if (tag) {
    const imported = Object.keys((model?.root?.attrs ?? {})).filter((key) => key.startsWith("xmlns:")).flatMap((key) => {
      const alias = key.slice("xmlns:".length); const directory = model?.root?.attrs[key]; return Object.keys(catalog[directory ?? ""] ?? {}).map((name) => `${alias}:${name}`);
    });
    const options: Completion[] = [...BUILTIN_TAGS, ...imported].map((label) => ({ label, type: "class", apply: `${label} x:Name=\"${label.includes(":") ? "组件实例" : "设计节点"}\" />` }));
    return { from: tag.from + 1, options };
  }
  const binding = context.matchBefore(/\{(?:Binding|Action)?\s*[A-Za-z0-9_.-]*/);
  if (binding) return { from: binding.from, options: [{ label: "{Binding view.path}", type: "keyword", apply: "{Binding view.path}" }, { label: "{Action ActionKey}", type: "keyword", apply: "{Action ActionKey}" }] };
  if (before.lastIndexOf("<") > before.lastIndexOf(">")) {
    const attribute = context.matchBefore(/[\w:\-\u0080-\uffff]*/);
    if (attribute) return { from: attribute.from, options: ATTRIBUTE_NAMES.map((name) => ({ label: `${name}（${ATTRIBUTE_LABELS[name] ?? "命名空间"}）`, type: "property", apply: name === "xmlns:积木" ? 'xmlns:积木="Presentation/Components"' : `${name}=\"\"` })) };
  }
  return null;
}

function sourceExtensions(): Extension[] {
  return [
    lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), indentUnit.of("  "), xml(), syntaxHighlighting(defaultHighlightStyle), closeBrackets(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    autocompletion({ override: [sourceCompletions], activateOnTyping: true }),
    linter(() => activeSource ? sourceDiagnostics(activeSource) : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !writingSource) {
        if (sourceTimer) clearTimeout(sourceTimer);
        sourceTimer = setTimeout(sendSourceEdit, 140);
      }
      if (update.selectionSet && !writingSource && activeSource) {
        const node = getNodeContaining(update.state.selection.main.head, activeSource.source);
        if (node) { selected = nodeRef(node); properties(node); applyHighlights(); }
      }
    }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "13px", backgroundColor: "#10091c", color: "#f4ecff" },
      ".cm-scroller": { overflow: "auto", fontFamily: "Consolas, 'Cascadia Code', 'Microsoft YaHei Mono', monospace" },
      ".cm-gutters": { backgroundColor: "#170f27", color: "#a895c6", borderRight: "1px solid #4c3568" },
      ".cm-activeLine": { backgroundColor: "#2a194466" }, ".cm-activeLineGutter": { backgroundColor: "#2a1944" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#64449399" }
    })
  ];
}

function setEditorSelection(node: PickedNode): void {
  if (!editor) return;
  writingSource = true;
  editor.dispatch({ selection: EditorSelection.range(node.start, node.end), scrollIntoView: true });
  writingSource = false;
}

function activateSource(source: string, selection?: PickedNode): void {
  const payload = chooseSource(source);
  if (!payload) return;
  activeSource = payload;
  const breadcrumb = byId("source-breadcrumb");
  breadcrumb.innerHTML = "";
  const page = document.createElement("button"); page.className = "breadcrumb-root"; page.textContent = rootSource === source ? "页面" : "页面";
  page.onclick = () => { const root = chooseSource(rootSource); if (root) activateSource(root.source); };
  breadcrumb.append(page, document.createTextNode(" / "));
  const location = document.createElement("span"); location.textContent = payload.displayPath; breadcrumb.append(location);
  byId("source-status").textContent = `版本 ${payload.version}`;
  if (!editor) {
    editor = new EditorView({ state: EditorState.create({ doc: payload.text, extensions: sourceExtensions() }), parent: byId("source-editor") });
  } else if (editor.state.doc.toString() !== payload.text) {
    writingSource = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: payload.text } });
    writingSource = false;
  }
  editor.dispatch(setDiagnostics(editor.state, sourceDiagnostics(payload)));
  if (selection) setEditorSelection(selection);
}

/** Apply a host revision. A matching in-flight revision is an acknowledgement, not an external overwrite. */
function reconcileSource(payload: SourcePayload): void {
  sources[payload.source] = payload;
  if (!activeSource || activeSource.source !== payload.source || !editor) { activateSource(payload.source); return; }
  const currentText = editor.state.doc.toString();
  const acknowledged = !!inFlight && inFlight.source === payload.source && inFlight.text === payload.text;
  if (!acknowledged) { activateSource(payload.source, selected?.source === payload.source ? selected : undefined); return; }
  inFlight = undefined;
  activeSource = { ...payload, text: currentText };
  byId("source-status").textContent = `版本 ${payload.version}`;
  editor.dispatch(setDiagnostics(editor.state, sourceDiagnostics(payload)));
  if (currentText !== payload.text) {
    if (sourceTimer) clearTimeout(sourceTimer);
    sourceTimer = setTimeout(sendSourceEdit, 0);
  }
}

function draw(): void {
  const canvas = byId("canvas"); const tree = byId("outline"); canvas.innerHTML = ""; tree.innerHTML = "";
  if (!model?.root) return;
  const select = byId<HTMLSelectElement>("preview"); const states = previews(model.root); const previous = select.value; select.innerHTML = "";
  for (const state of states) { const option = document.createElement("option"); option.value = String(state.start); option.textContent = state.displayName || "预览状态"; select.append(option); }
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  byId("preview-label").style.display = states.length ? "" : "none";
  outline(model.root, tree); canvas.append(renderNode(model.root));
  properties(selected ? getNode(selected.start, selected.source) : undefined);
  const diagnostics = byId("diagnostics"); diagnostics.innerHTML = "";
  for (const issue of model.diagnostics ?? []) { const item = document.createElement("p"); item.textContent = `⚠ ${issue.message}`; diagnostics.append(item); }
  applyHighlights();
}

function pick(node: SerializableNode): void {
  selected = nodeRef(node); draw(); activateSource(node.source, selected);
}

function applyModel(payload: ModelPayload): void {
  model = payload.model; catalog = payload.catalog ?? {}; sources = payload.sources ?? {}; rootSource = payload.rootSource;
  byId<HTMLSelectElement>("device").value = payload.device;
  if (!activeSource || !sources[activeSource.source]) activateSource(rootSource, selected?.source === rootSource ? selected : undefined);
  else reconcileSource(sources[activeSource.source]);
  draw();
}

function applyReload(payload: SourceReloadPayload): void {
  reconcileSource(payload.source);
}

function setupSplitter(): void {
  const splitter = byId("splitter");
  splitter.addEventListener("pointerdown", (event) => {
    event.preventDefault(); splitter.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const bounds = document.body.getBoundingClientRect(); const percent = Math.max(25, Math.min(75, (moveEvent.clientY - bounds.top) / bounds.height * 100));
      document.documentElement.style.setProperty("--design-height", `${percent}%`);
    };
    const stop = (upEvent: PointerEvent) => { splitter.releasePointerCapture(upEvent.pointerId); splitter.removeEventListener("pointermove", move); splitter.removeEventListener("pointerup", stop); };
    splitter.addEventListener("pointermove", move); splitter.addEventListener("pointerup", stop);
  });
}

window.addEventListener("message", (event: MessageEvent<ModelPayload | SourceReloadPayload>) => {
  if (event.data.type === "model") applyModel(event.data);
  if (event.data.type === "source") applyReload(event.data);
});

byId<HTMLSelectElement>("device").onchange = () => { const [width, height] = byId<HTMLSelectElement>("device").value.split("x"); byId("canvas").style.width = `${width}px`; byId("canvas").style.minHeight = `${height}px`; };
byId<HTMLSelectElement>("preview").onchange = draw;
byId<HTMLButtonElement>("deploy").onclick = () => vscode.postMessage({ type: "deploy" });
byId<HTMLButtonElement>("collapse").onclick = () => { const inspector = byId("inspector"); inspector.classList.toggle("collapsed"); byId("collapse").textContent = inspector.classList.contains("collapsed") ? "展开" : "收起"; };
byId<HTMLSelectElement>("device").dispatchEvent(new Event("change"));
setupSplitter();
vscode.postMessage({ type: "ready" });
