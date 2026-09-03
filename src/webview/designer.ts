import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { copyLineDown, copyLineUp, defaultKeymap, history, historyKeymap, indentWithTab, moveLineDown, moveLineUp, toggleComment } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentUnit, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { xml } from "@codemirror/lang-xml";
import { ATTRIBUTE_LABELS, CANONICAL_TO_ATTRIBUTE, DEPRECATED_CANONICAL_TAGS, TAG_TO_CANONICAL, UI_CONTROL_DEFINITIONS, attributeDefinition, bindingPath, canonicalAttribute, canonicalTag, controlDefinition, directoryAlias, enumOptions, isBinding, parseBinding, sourceAttribute } from "../../packages/spec/src/vocabulary.js";

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
const BUILTIN_TAGS = Array.from(new Set(Object.entries(TAG_TO_CANONICAL).filter(([name, canonical]) => /[^\x00-\x7f]/.test(name) && !DEPRECATED_CANONICAL_TAGS.has(canonical)).map(([name]) => name)));
const ATTRIBUTE_NAMES = Object.values(CANONICAL_TO_ATTRIBUTE).concat(["目录:积木"]);
const CATEGORIES: Array<[string, string[]]> = [
  ["LUI 名称", ["x:Name", "x:DisplayName"]],
  ["布局", ["Width", "Height", "MinWidth", "MinHeight", "MaxWidth", "MaxHeight", "Margin", "Padding", "RowDefinitions", "ColumnDefinitions", "RowSpacing", "ColumnSpacing", "Grid.Row", "Grid.Column", "Grid.RowSpan", "Grid.ColumnSpan", "Canvas.Left", "Canvas.Top", "Canvas.Right", "Canvas.Bottom"]],
  ["外观", ["Background", "Color", "Opacity", "BorderRadius", "Variant", "Icon", "Image", "Type", "Visible"]],
  ["内容与数据", ["Text", "Title", "Subtitle", "FontSize", "Placeholder", "Items", "Data", "Options", "Source", "Value", "Min", "Max", "Step", "Columns", "Rows", "Gap", "Orientation"]],
  ["交互", ["Click", "Change", "Submit", "Select", "Open", "Close", "Focus", "Blur", "Complete", "DragStart", "DragEnd", "DragCancel", "Disabled"]],
  ["数据与条件", ["Test", "In", "Each", "Path"]]
];
const PROPERTY_STATE_KEY = "lui.inspector.collapsedCategories";
const collapsedCategories = new Set<string>(JSON.parse(localStorage.getItem(PROPERTY_STATE_KEY) ?? "[]") as string[]);

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
interface LayoutData { x: number; y: number; width: number; height: number; parentX: number; parentY: number; contentWidth: number; contentHeight: number; margin: string; padding: string; }
const layouts = new Map<string, LayoutData>();

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
  if (node.kind === "element" && canonicalTag(node.tag) === "lui:Preview") out.push(node);
  for (const child of node.children ?? []) previews(child, out);
  return out;
}

function previewValues(): Record<string, string> {
  const select = byId<HTMLSelectElement>("preview");
  const state = previews(model?.root).find((item) => item.start === Number(select.value));
  const values: Record<string, string> = {};
  for (const child of state?.children ?? []) {
    if (canonicalTag(child.tag) !== "lui:Set") continue;
    const path = sourceValue(child, "Path");
    if (path) values[path] = sourceValue(child, "Value") ?? "";
  }
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
  const binding = parseBinding(value);
  const path = binding?.path;
  if (!path) return value;
  const fromScope = getPath(scope, path);
  if (fromScope !== undefined) return binding?.stringFormat?.replace("{0}", String(fromScope)) ?? String(fromScope);
  const fromPreview = getPath(previewValues(), path);
  if (fromPreview !== undefined) return binding?.stringFormat?.replace("{0}", String(fromPreview)) ?? String(fromPreview);
  if (binding?.previewContent !== undefined) return binding.stringFormat?.replace("{0}", binding.previewContent) ?? binding.previewContent;
  const samples: Record<string, string> = {
    title: "无尽塔", enemyText: "塔层守卫 · Lv.1", playerText: "冒险者 · Lv.1", logText: "战斗记录将在这里显示。",
    weaponText: "武器槽（空）", armorText: "护甲槽（空）", detailText: "在这里查看当前选择的说明。", profileSummary: "本地进度已就绪。",
    towerText: "继续爬塔"
  };
  return samples[path];
}

function effective(node: SerializableNode, scope: Record<string, unknown>): Record<string, string | undefined> {
  const attrs: Record<string, string | undefined> = {};
  const previews: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    const canonical = canonicalAttribute(name);
    if (canonical.startsWith("Preview.")) previews[canonical.slice(8)] = value; else attrs[canonical] = value;
  }
  const owner = `${canonicalTag(node.tag) ?? String(node.tag)}.`;
  for (const child of node.children ?? []) {
    const propertyTag = canonicalTag(child.tag);
    if (propertyTag?.startsWith(owner)) attrs[propertyTag.slice(owner.length)] = (child.children ?? []).filter((item) => item.kind === "text").map((item) => item.text ?? "").join("").trim();
  }
  for (const key of Object.keys(attrs)) attrs[key] = previews[key] ?? resolve(attrs[key], scope);
  return attrs;
}

function visualChildren(node: SerializableNode): SerializableNode[] {
  const owner = `${canonicalTag(node.tag) ?? String(node.tag)}.`;
  return (node.children ?? []).filter((child) => !canonicalTag(child.tag)?.startsWith(owner) && canonicalTag(child.tag) !== "lui:Preview" && canonicalTag(child.tag) !== "lui:Set");
}

function cssSize(value: unknown): string {
  const source = text(value);
  if (source === "自动") return "auto";
  return /^-?\d+(?:\.\d+)?$/.test(source) ? `${source}px` : source;
}
function cssThickness(value: unknown): string {
  const parts = text(value).split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 4) return `${cssSize(parts[1])} ${cssSize(parts[2])} ${cssSize(parts[3])} ${cssSize(parts[0])}`;
  return cssSize(parts[0] ?? "0");
}
function cssTracks(value: unknown): string {
  return text(value).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    if (part === "自动") return "auto";
    if (part === "填充") return "1fr";
    const fill = /^(\d+(?:\.\d+)?)填充$/.exec(part);
    return fill ? `${fill[1]}fr` : cssSize(part);
  }).join(" ");
}
function bool(value: unknown): boolean { return value !== false && value !== undefined && value !== null && value !== "" && value !== "false" && value !== "否" && value !== 0; }

function decorate(element: HTMLElement, node: SerializableNode): void {
  element.dataset.start = String(node.start);
  element.dataset.source = node.source;
  element.classList.add("lui-node");
  element.onmouseenter = () => { hovered = nodeRef(node); applyHighlights(); };
  element.onmouseleave = () => { hovered = undefined; applyHighlights(); };
  element.onclick = (event) => { event.stopPropagation(); pick(node); };
}

function applyLayout(element: HTMLElement, tag: string, attrs: Record<string, string | undefined>): void {
  const sizes: Record<string, string> = { Width: "width", Height: "height", MinWidth: "minWidth", MinHeight: "minHeight", MaxWidth: "maxWidth", MaxHeight: "maxHeight" };
  for (const [attribute, style] of Object.entries(sizes)) if (attrs[attribute] !== undefined) (element.style as unknown as Record<string, string>)[style] = cssSize(attrs[attribute]);
  if (attrs.Background !== undefined) element.style.background = attrs.Background;
  if (attrs.Color !== undefined) element.style.color = attrs.Color;
  if (attrs.Opacity !== undefined) element.style.opacity = attrs.Opacity;
  if (attrs.BorderRadius !== undefined) element.style.borderRadius = cssSize(attrs.BorderRadius);
  if (attrs.Margin !== undefined) element.style.margin = cssThickness(attrs.Margin);
  if (attrs.Padding !== undefined) element.style.padding = cssThickness(attrs.Padding);
  if (tag === "Grid") {
    element.style.display = "grid";
    element.style.gridTemplateRows = cssTracks(attrs.RowDefinitions ?? "填充");
    element.style.gridTemplateColumns = cssTracks(attrs.ColumnDefinitions ?? "填充");
    element.style.rowGap = cssSize(attrs.RowSpacing ?? "0");
    element.style.columnGap = cssSize(attrs.ColumnSpacing ?? "0");
  }
  if (tag === "Canvas") element.style.position = "relative";
  if (tag === "Viewbox") {
    // The design canvas is its own coordinate system.  The parent stage only
    // supplies a viewport; it never changes the page definition.
    element.style.position = "relative";
    element.style.overflow = "hidden";
  }
  if (attrs["Grid.Row"] !== undefined) element.style.gridRow = `${Number(attrs["Grid.Row"]) + 1} / span ${attrs["Grid.RowSpan"] ?? "1"}`;
  if (attrs["Grid.Column"] !== undefined) element.style.gridColumn = `${Number(attrs["Grid.Column"]) + 1} / span ${attrs["Grid.ColumnSpan"] ?? "1"}`;
  if (attrs["Canvas.Left"] !== undefined || attrs["Canvas.Top"] !== undefined || attrs["Canvas.Right"] !== undefined || attrs["Canvas.Bottom"] !== undefined) {
    element.style.position = "absolute";
    if (attrs["Canvas.Left"] !== undefined) element.style.left = cssSize(attrs["Canvas.Left"]);
    if (attrs["Canvas.Top"] !== undefined) element.style.top = cssSize(attrs["Canvas.Top"]);
    if (attrs["Canvas.Right"] !== undefined) element.style.right = cssSize(attrs["Canvas.Right"]);
    if (attrs["Canvas.Bottom"] !== undefined) element.style.bottom = cssSize(attrs["Canvas.Bottom"]);
  }
}

function fragmentChildren(nodes: SerializableNode[], scope: Record<string, unknown>, trace: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const child of nodes) fragment.append(renderNode(child, scope, trace));
  return fragment;
}

function componentTemplate(node: SerializableNode): { directory: string; name: string; template: SerializableNode } | undefined {
  const [alias, name] = String(canonicalTag(node.tag) ?? node.tag).split(":");
  const sourceRoot = allRoots().find((root) => root.source === node.source);
  const directory = sourceRoot ? Object.entries(sourceRoot.attrs).find(([attribute]) => directoryAlias(attribute)?.alias === alias)?.[1] : undefined;
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
  // The component instance is the direct Grid/Canvas child. Its internals stay
  // folded in the page inspector, while its declared layout remains effective.
  applyLayout(wrapper, "Component", effective(node, scope));
  const props = { ...(scope.props as Record<string, unknown> | undefined) };
  for (const [property, value] of Object.entries(effective(node, scope))) props[property] = value;
  wrapper.append(fragmentChildren(visualChildren(template), { ...scope, props, slots: { Content: visualChildren(node) } }, [...trace, key]));
  // Imported markup is visual only in a page inspector: any click belongs to its page-side component instance.
  wrapper.addEventListener("click", (event) => { event.stopImmediatePropagation(); pick(node); }, true);
  return wrapper;
}

function renderNode(node: SerializableNode, scope: Record<string, unknown> = {}, trace: string[] = []): Node {
  if (node.kind === "text") { const span = document.createElement("span"); span.textContent = node.text ?? ""; return span; }
  if (node.kind === "comment") return document.createComment(node.text ?? "");
  const tag = canonicalTag(node.tag) ?? "Panel";
  if (tag === "__placeholder__") {
    const placeholder = document.createElement("button");
    placeholder.className = "lui-node placeholder";
    placeholder.textContent = "<> 选择标签类型";
    decorate(placeholder, node);
    return placeholder;
  }
  if (tag === "lui:Preview" || tag === "lui:Set") return document.createDocumentFragment();
  if (tag === "lui:If") return bool(effective(node, scope).Test) ? fragmentChildren(visualChildren(node), scope, trace) : document.createDocumentFragment();
  if (tag === "lui:For") {
    const attrs = effective(node, scope);
    const sample = { label: "示例项目", name: "示例项目", text: "示例内容" };
    return fragmentChildren(visualChildren(node), { ...scope, [attrs.Each ?? "item"]: sample, item: sample, index: 1 }, trace);
  }
  if (tag === "lui:Slot") return fragmentChildren(((scope.slots as Record<string, SerializableNode[]> | undefined)?.[effective(node, scope).Name ?? ""] ?? []), scope, trace);
  if (tag.includes(":") && !tag.startsWith("lui:")) return renderComponent(node, scope, trace);
  const attrs = effective(node, scope);
  if (tag === "Viewbox") {
    const viewport = document.createElement("div"); decorate(viewport, node); viewport.classList.add("lui-node", "viewbox");
    const designWidth = Number(attrs.Width); const designHeight = Number(attrs.Height);
    const design = document.createElement("div"); design.className = "lui-viewbox-design";
    design.style.width = `${designWidth}px`; design.style.height = `${designHeight}px`;
    design.style.transformOrigin = "top left";
    design.append(fragmentChildren(visualChildren(node), scope, trace)); viewport.append(design);
    const applyScale = () => {
      const rect = viewport.getBoundingClientRect(); const scale = Math.min(rect.width / designWidth, rect.height / designHeight);
      design.style.transform = `scale(${Number.isFinite(scale) ? scale : 1})`;
      design.style.left = `${Math.max(0, (rect.width - designWidth * scale) * 0.5)}px`;
      design.style.top = `${Math.max(0, (rect.height - designHeight * scale) * 0.5)}px`;
      viewport.dataset.viewboxScale = String(scale);
    };
    new ResizeObserver(applyScale).observe(viewport); requestAnimationFrame(applyScale);
    return viewport;
  }
  const element = document.createElement("div");
  decorate(element, node);
  element.classList.add(`tag-${tag.replace(/[^A-Za-z0-9_-]/g, "-")}`);
  applyLayout(element, tag, attrs);
  if (tag === "Grid") element.classList.add("grid"); else if (tag === "Canvas") element.classList.add("canvas"); else if (tag === "Viewbox") element.classList.add("viewbox"); else if (tag === "Row") element.classList.add("row"); else element.classList.add("panel");
  if (tag === "Button") { element.classList.add("button"); if (attrs.Variant === "次要" || attrs.Variant === "secondary") element.classList.add("secondary"); element.textContent = text(attrs.Text); }
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

function outline(node: SerializableNode, host: HTMLElement, depth = 0): void {
  if (node.kind !== "element" || canonicalTag(node.tag) === "lui:Preview" || canonicalTag(node.tag) === "lui:Set") return;
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
  for (const child of visualChildren(node)) outline(child, host, depth + 1);
}

function sourceValue(node: SerializableNode, canonical: string): string | undefined {
  return Object.entries(node.attrs ?? {}).reverse().find(([name]) => canonicalAttribute(name) === canonical)?.[1];
}

function parentOf(target: SerializableNode): SerializableNode | undefined {
  const find = (node: SerializableNode): SerializableNode | undefined => {
    for (const child of node.children ?? []) {
      if (child.start === target.start && child.source === target.source) return node;
      const nested = find(child); if (nested) return nested;
    }
    return undefined;
  };
  for (const root of allRoots()) { const parent = find(root); if (parent) return parent; }
  return undefined;
}

function writeAttribute(node: SerializableNode, key: string, value: string): void {
  vscode.postMessage({ type: "setAttribute", start: node.start, source: node.source, name: sourceAttribute(key), value });
}

function thicknessParts(value: string | undefined): string[] {
  const parts = (value ?? "0").split(",").map((part) => part.trim());
  return parts.length === 4 ? parts : [parts[0] ?? "0", parts[0] ?? "0", parts[0] ?? "0", parts[0] ?? "0"];
}

function propertyInput(host: HTMLElement, node: SerializableNode, key: string): void {
  const label = document.createElement("label");
  label.textContent = ATTRIBUTE_LABELS[key] ?? key;
  const definition = attributeDefinition(key);
  const value = sourceValue(node, key) ?? "";
  let input: HTMLInputElement | HTMLSelectElement;
  if (definition?.kind === "enum") {
    const select = document.createElement("select");
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "未设置"; select.append(empty);
    for (const optionValue of enumOptions(key) ?? []) { const option = document.createElement("option"); option.value = optionValue; option.textContent = optionValue; option.selected = optionValue === value; select.append(option); }
    select.value = value; select.onchange = () => writeAttribute(node, key, select.value); input = select;
  } else if (definition?.kind === "thickness") {
    const grid = document.createElement("div"); grid.className = "property-grid";
    const parts = thicknessParts(value); const names = ["左", "上", "右", "下"];
    for (let index = 0; index < 4; index += 1) {
      const side = document.createElement("label"); side.textContent = names[index]!;
      const field = document.createElement("input"); field.type = "number"; field.step = "any"; field.value = parts[index]!;
      field.onchange = () => { parts[index] = field.value || "0"; writeAttribute(node, key, parts.join(",")); };
      side.append(field); grid.append(side);
    }
    label.append(grid); host.append(label); return;
  } else {
    const field = document.createElement("input");
    field.type = definition?.kind === "integer" || definition?.kind === "length" ? "text" : "text";
    field.value = value; field.placeholder = ATTRIBUTE_LABELS[key] ?? key;
    field.onchange = () => writeAttribute(node, key, field.value); input = field;
  }
  label.append(input); host.append(label);
  const binding = parseBinding(value);
  if (binding) {
    const bindingSection = document.createElement("fieldset"); bindingSection.className = "binding-options";
    const legend = document.createElement("legend"); legend.textContent = "绑定"; bindingSection.append(legend);
    const build = (patch: Partial<typeof binding>) => {
      const next = { ...binding, ...patch };
      const option = (name: string, entry: string | undefined) => entry === undefined || entry === "" ? "" : `, ${name}=${/[,'\"]/.test(entry) ? `'${entry}'` : entry}`;
      writeAttribute(node, key, `{绑定 ${next.path}, 模式=${next.mode}, 更新源触发=${next.updateSourceTrigger}${option("字符串格式", next.stringFormat)}${option("预览内容", next.previewContent)}}`);
    };
    const add = (title: string, current: string, options?: readonly string[]) => {
      const item = document.createElement("label"); item.textContent = title;
      const field = options ? document.createElement("select") : document.createElement("input");
      if (options) for (const optionValue of options) { const option = document.createElement("option"); option.value = optionValue; option.textContent = optionValue; field.append(option); }
      field.value = current; field.onchange = () => build(title === "模式" ? { mode: field.value as typeof binding.mode } : title === "更新源触发" ? { updateSourceTrigger: field.value as typeof binding.updateSourceTrigger } : title === "字符串格式" ? { stringFormat: field.value } : { previewContent: field.value }); item.append(field); bindingSection.append(item);
    };
    add("模式", binding.mode, ["单向", "双向", "单次", "单向到源"]);
    add("更新源触发", binding.updateSourceTrigger, ["默认", "属性变更", "失焦", "显式"]);
    add("字符串格式", binding.stringFormat ?? ""); add("预览内容", binding.previewContent ?? sourceValue(node, `Preview.${key}`) ?? "");
    host.append(bindingSection);
  }
}

function tagChoices(): string[] {
  const imported = model?.root ? Object.entries(model.root.attrs).filter(([name]) => directoryAlias(name)).flatMap(([name]) => {
    const alias = directoryAlias(name)?.alias ?? ""; const directory = model?.root?.attrs[name] ?? ""; return Object.keys(catalog[directory] ?? {}).map((component) => `${alias}:${component}`);
  }) : [];
  return [...BUILTIN_TAGS, ...imported];
}

function attributesFor(node: SerializableNode): string[] {
  const tag = canonicalTag(node.tag);
  if (tag === "__placeholder__") return [];
  let parent = parentOf(node);
  while (parent && ["lui:If", "lui:For", "lui:Slot"].includes(canonicalTag(parent.tag) ?? "")) parent = parentOf(parent);
  const parentTag = canonicalTag(parent?.tag);
  const structural = ["lui:If", "lui:For", "lui:Slot", "lui:Preview", "lui:Set"];
  const layout = structural.includes(tag ?? "") ? [] : ["Width", "Height", "MinWidth", "MinHeight", "MaxWidth", "MaxHeight", "Margin", "Padding"];
  const surface = ["Grid", "Canvas", "Card", "Scroll", "SafeArea", "Modal", "Section", "Notice", "Screen", "FixedScreen"].includes(tag ?? "") ? ["Background", "Opacity", "BorderRadius"] : [];
  const specific: Record<string, string[]> = {
    Grid: ["RowDefinitions", "ColumnDefinitions", "RowSpacing", "ColumnSpacing"], Text: ["Text", "FontSize", "Color"], Button: ["Text", "Click", "Disabled", "Variant", "Color"], Progress: ["Value", "Max"], Toggle: ["Value", "Change", "Disabled"], Slider: ["Value", "Min", "Max", "Change", "Disabled"], Modal: ["Title", "Close", "CloseOnOverlay", "ShowCloseButton"], Section: ["Title", "Subtitle"], Notice: ["Text", "Error"], "lui:If": ["Test"], "lui:For": ["Each", "In"], "lui:Slot": ["Name"], "lui:Set": ["Path", "Value"]
  };
  const control = controlDefinition(tag);
  if (control) {
    const declarative = ["Text", "Title", "Subtitle", "Value", "Min", "Max", "Step", "Placeholder", "Items", "Data", "Options", "Icon", "Image", "Source", "Orientation", "Columns", "Rows", "Gap", "Type", "Visible", ...(control.events ?? [])];
    if (control.bindable && !declarative.includes(control.bindable)) declarative.push(control.bindable);
    specific[tag ?? ""] = [...(specific[tag ?? ""] ?? []), ...declarative];
  }
  const attached = parentTag === "Grid" ? ["Grid.Row", "Grid.Column", "Grid.RowSpan", "Grid.ColumnSpan"] : parentTag === "Canvas" ? ["Canvas.Left", "Canvas.Top", "Canvas.Right", "Canvas.Bottom"] : [];
  return [...new Set(["x:Name", "x:DisplayName", ...layout, ...surface, ...(specific[tag ?? ""] ?? []), ...attached])];
}

function collapsibleSection(title: string): HTMLElement {
  const section = document.createElement("details");
  section.className = "property-category";
  section.open = !collapsedCategories.has(title);
  const heading = document.createElement("summary"); heading.textContent = title; section.append(heading);
  section.ontoggle = () => {
    if (section.open) collapsedCategories.delete(title); else collapsedCategories.add(title);
    localStorage.setItem(PROPERTY_STATE_KEY, JSON.stringify([...collapsedCategories]));
  };
  return section;
}

function layoutResult(host: HTMLElement, node: SerializableNode): void {
  const result = layouts.get(`${node.source}:${node.start}`);
  const section = document.createElement("section"); const heading = document.createElement("h3"); heading.textContent = "布局结果"; section.append(heading);
  if (!result) { const note = document.createElement("p"); note.className = "property-note"; note.textContent = "等待预览完成布局计算。"; section.append(note); host.append(section); return; }
  const note = document.createElement("p"); note.className = "property-note"; note.textContent = `父级 ${result.parentX}, ${result.parentY} · 坐标 ${result.x}, ${result.y} · 尺寸 ${result.width} × ${result.height} · 内容 ${result.contentWidth} × ${result.contentHeight}`; section.append(note);
  const box = document.createElement("p"); box.className = "property-note"; box.textContent = `外边距 ${result.margin} · 内边距 ${result.padding}`; section.append(box);
  if (node.source === rootSource && model?.root?.start === node.start) {
    const table = document.createElement("div"); table.className = "layout-table";
    for (const [key, data] of [...layouts].filter(([entry]) => entry.startsWith(`${rootSource}:`)).sort(([left], [right]) => left.localeCompare(right))) {
      const target = getNode(Number(key.slice(key.lastIndexOf(":") + 1)), rootSource); if (!target) continue;
      const row = document.createElement("button"); row.textContent = `${target.displayName || target.tag} · ${data.x},${data.y} · ${data.width}×${data.height}`; row.onclick = () => pick(target); table.append(row);
    }
    section.append(table);
  }
  host.append(section);
}

function properties(node: SerializableNode | undefined): void {
  const host = byId("properties"); host.innerHTML = "<h2>当前节点属性</h2>";
  if (!node) { const paragraph = document.createElement("p"); paragraph.textContent = "在组件树、画布或源码中选择一个节点。"; host.append(paragraph); return; }
  const tagLabel = document.createElement("label"); tagLabel.textContent = "标签类型";
  const category = document.createElement("select");
  const categories = ["全部", "基础", "布局", "输入", "导航", "数据", "展示", "反馈", "媒体", "交互", "组合", "已导入组件", "结构"];
  for (const value of categories) { const option = document.createElement("option"); option.value = value; option.textContent = value; category.append(option); }
  const filter = document.createElement("input"); filter.type = "search"; filter.placeholder = "搜索中文名称、内部类型或已导入组件";
  const select = document.createElement("select"); const rawTag = node.tag ?? "";
  const tagCategory = (tag: string): string => {
    if (tag.includes(":")) return "已导入组件";
    const canonical = canonicalTag(tag) ?? tag;
    const definition = controlDefinition(canonical);
    if (definition?.category) return definition.category;
    if (["lui:Page", "lui:Component", "lui:If", "lui:For", "lui:Slot", "lui:Preview", "lui:Set"].includes(canonical)) return "结构";
    if (["Viewbox", "Grid", "Canvas", "SafeArea", "Scroll"].includes(canonical)) return "布局";
    if (["Text", "Card", "Section", "Progress"].includes(canonical)) return "展示";
    if (["Button", "Toggle", "Slider"].includes(canonical)) return "输入";
    if (["Modal", "Screen", "FixedScreen", "Notice"].includes(canonical)) return "反馈";
    return "基础";
  };
  const tagSearchText = (tag: string): string => {
    const canonical = canonicalTag(tag) ?? tag; const definition = controlDefinition(canonical);
    return [tag, canonical, definition?.name, definition?.ui, definition?.category].filter(Boolean).join(" ").toLowerCase();
  };
  const fillTags = () => {
    const query = filter.value.trim().toLowerCase(); select.innerHTML = "";
    if (rawTag === "__placeholder__") { const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "请选择标签类型"; placeholder.selected = true; select.append(placeholder); }
    for (const tag of tagChoices().filter((item) => (category.value === "全部" || tagCategory(item) === category.value) && tagSearchText(item).includes(query))) {
      const option = document.createElement("option"); option.value = tag; option.textContent = `${tag} · ${canonicalTag(tag) ?? tag}`; option.selected = tag === rawTag; select.append(option);
    }
  };
  fillTags(); filter.oninput = fillTags; category.onchange = fillTags;
  select.onchange = () => { if (select.value) vscode.postMessage({ type: "setTag", start: node.start, source: node.source, name: select.value }); };
  tagLabel.append(category, filter, select); host.append(tagLabel);
  const available = new Set(attributesFor(node));
  for (const [title, keys] of CATEGORIES) {
    const valid = keys.filter((key) => available.has(key)); if (!valid.length) continue;
    const section = collapsibleSection(title);
    for (const key of valid) propertyInput(section, node, key);
    host.append(section);
  }
  const illegal = Object.keys(node.attrs ?? {}).map(canonicalAttribute).filter((key) => !available.has(key) && key !== "x:Ref" && !key.startsWith("Preview.") && !directoryAlias(key));
  if (illegal.length) { const note = document.createElement("p"); note.className = "property-note"; note.textContent = `源代码保留 ${[...new Set(illegal)].map(sourceAttribute).join("、")}；这些属性不适用于当前标签，诊断中可定位并手动删除或迁移。`; host.append(note); }
  layoutResult(host, node);
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
  const value = /([^\s=]+)\s*=\s*["']([^"']*)$/.exec(before);
  if (value) {
    const canonical = canonicalAttribute(value[1]!);
    const options = enumOptions(canonical) ?? (attributeDefinition(canonical)?.kind === "tracks" ? ["自动", "填充", "2填充"] : undefined);
    if (options) return { from: context.pos - value[2]!.length, options: options.map((label) => ({ label, type: "enum", apply: label, detail: `${sourceAttribute(canonical)} 可选值` })) };
  }
  const tag = context.matchBefore(/<[\w:\-\u0080-\uffff]*/);
  if (tag) {
    const imported = Object.keys((model?.root?.attrs ?? {})).filter((key) => directoryAlias(key)).flatMap((key) => {
      const alias = directoryAlias(key)?.alias ?? ""; const directory = model?.root?.attrs[key]; return Object.keys(catalog[directory ?? ""] ?? {}).map((name) => `${alias}:${name}`);
    });
    const options: Completion[] = [...BUILTIN_TAGS, ...imported].map((label) => ({ label, type: "class", apply: `${label} 名称=\"${label.includes(":") ? "组件实例" : "设计节点"}\" />` }));
    return { from: tag.from + 1, options };
  }
  const binding = context.matchBefore(/\{(?:绑定|动作)?\s*[A-Za-z0-9_.-]*/);
  if (binding) return { from: binding.from, options: [{ label: "{绑定 view.path}", type: "keyword", apply: "{绑定 view.path}" }, { label: "{动作 ActionKey}", type: "keyword", apply: "{动作 ActionKey}" }] };
  if (before.lastIndexOf("<") > before.lastIndexOf(">")) {
    const attribute = context.matchBefore(/[\w:\-\u0080-\uffff]*/);
    if (attribute) return { from: attribute.from, options: ATTRIBUTE_NAMES.map((name) => ({ label: name, type: "property", apply: name === "目录:积木" ? '目录:积木="Presentation/Components"' : `${name}=\"\"` })) };
  }
  return null;
}

function sourceExtensions(): Extension[] {
  const copySelection = (view: EditorView): boolean => {
    const values = view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to)).filter(Boolean);
    if (values.length) vscode.postMessage({ type: "copy", text: values.join("\n") });
    return true;
  };
  return [
    lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), indentUnit.of("  "), xml(), syntaxHighlighting(defaultHighlightStyle), closeBrackets(), bracketMatching(), search({ top: true }), highlightSelectionMatches(),
    keymap.of([{ key: "Mod-c", run: copySelection }, { key: "Mod-Alt-ArrowUp", run: copyLineUp }, { key: "Mod-Alt-ArrowDown", run: copyLineDown }, { key: "Alt-ArrowUp", run: moveLineUp }, { key: "Alt-ArrowDown", run: moveLineDown }, { key: "Mod-/", run: toggleComment }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
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
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#8b5cf6aa" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffe16b" }, ".cm-content": { caretColor: "#ffe16b" }, ".cm-matchingBracket": { backgroundColor: "#d5b56d44", outline: "1px solid #ffe16b" }
    })
  ];
}

function setEditorSelection(node: PickedNode): void {
  if (!editor) return;
  writingSource = true;
  // Designer selections must never overwrite the user's source selection.
  editor.dispatch({ selection: EditorSelection.cursor(node.start), scrollIntoView: true });
  writingSource = false;
}

function activateSource(source: string, selection?: PickedNode): void {
  const payload = chooseSource(source);
  if (!payload) return;
  activeSource = payload;
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
  editor.dispatch(setDiagnostics(editor.state, sourceDiagnostics(payload)));
  if (currentText !== payload.text) {
    if (sourceTimer) clearTimeout(sourceTimer);
    sourceTimer = setTimeout(sendSourceEdit, 0);
  }
}

function collectLayoutData(): void {
  layouts.clear();
  const canvas = byId("canvas"); const canvasRect = canvas.getBoundingClientRect();
  for (const element of canvas.querySelectorAll<HTMLElement>("[data-start][data-source]")) {
    const start = Number(element.dataset.start); const source = element.dataset.source ?? "";
    if (!Number.isFinite(start) || !source) continue;
    const rect = element.getBoundingClientRect(); const parent = element.parentElement?.getBoundingClientRect() ?? canvasRect; const style = getComputedStyle(element);
    const pixel = (value: string) => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0;
    const paddingX = pixel(style.paddingLeft) + pixel(style.paddingRight);
    const paddingY = pixel(style.paddingTop) + pixel(style.paddingBottom);
    layouts.set(`${source}:${start}`, {
      x: Math.round((rect.left - canvasRect.left) * 10) / 10, y: Math.round((rect.top - canvasRect.top) * 10) / 10,
      width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10,
      parentX: Math.round((parent.left - canvasRect.left) * 10) / 10, parentY: Math.round((parent.top - canvasRect.top) * 10) / 10,
      contentWidth: Math.max(0, Math.round((rect.width - paddingX) * 10) / 10), contentHeight: Math.max(0, Math.round((rect.height - paddingY) * 10) / 10),
      margin: `${style.marginLeft},${style.marginTop},${style.marginRight},${style.marginBottom}`,
      padding: `${style.paddingLeft},${style.paddingTop},${style.paddingRight},${style.paddingBottom}`
    });
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
  requestAnimationFrame(() => { collectLayoutData(); properties(selected ? getNode(selected.start, selected.source) : undefined); });
}

function pick(node: SerializableNode): void {
  selected = nodeRef(node); draw(); activateSource(rootSource, selected.source === rootSource ? selected : undefined);
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

function setupOutlineDivider(): void {
  const divider = byId("outline-divider"); const workbench = byId("design-workbench"); const button = byId<HTMLButtonElement>("outline-collapse");
  let lastWidth = 280;
  button.onclick = () => {
    const collapsed = workbench.classList.toggle("outline-collapsed");
    if (collapsed) { lastWidth = byId("outline-panel").getBoundingClientRect().width; document.documentElement.style.setProperty("--outline-width", "0px"); button.textContent = "›"; button.title = "展开结构树"; }
    else { document.documentElement.style.setProperty("--outline-width", `${lastWidth}px`); button.textContent = "‹"; button.title = "收起结构树"; }
  };
  divider.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault(); workbench.classList.remove("outline-collapsed"); button.textContent = "‹"; divider.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => { const bounds = workbench.getBoundingClientRect(); lastWidth = Math.max(168, Math.min(460, moveEvent.clientX - bounds.left)); document.documentElement.style.setProperty("--outline-width", `${lastWidth}px`); };
    const stop = (upEvent: PointerEvent) => { divider.releasePointerCapture(upEvent.pointerId); divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", stop); };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", stop);
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
setupOutlineDivider();
vscode.postMessage({ type: "ready" });
