import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { copyLineDown, copyLineUp, defaultKeymap, history, historyKeymap, isolateHistory, indentWithTab, moveLineDown, moveLineUp, toggleComment } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentUnit, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { sourcePatch, rebaseSourcePatch, rebaseSourceChanges, applySourceChanges, type SourcePatch } from "./sourceSync.js";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { xml } from "@codemirror/lang-xml";
import { readPath } from '../../packages/spec/src/paths.js';
import { buildEngineSnapshot, resolvePreviewAttributes } from './previewSnapshot.js';
import { isLayoutProperty, type ComponentProperties } from '../../packages/spec/src/properties.js';
import { displayNameOf, parseLui, provideLuiCompletions, type LuiCompletionImport, type LuiNode } from "../../packages/spec/src/index.js";
import { ATTRIBUTE_LABELS, CANONICAL_TO_ATTRIBUTE, DEPRECATED_CANONICAL_TAGS, TAG_TO_CANONICAL, UI_CONTROL_DEFINITIONS, attributeDefinition, bindingPath, canonicalAttribute, canonicalTag, controlDefinition, directoryAlias, enumOptions, isBinding, parseBinding, sourceAttribute } from "../../packages/spec/src/vocabulary.js";
import { capabilityAttributes } from "../../packages/spec/src/generated-capabilities.js";
import { calculatePageFrame } from "../../packages/spec/src/page-frame.js";
import { formatLinearGradient, normalizeColor, parseBrush } from "../../packages/spec/src/brush.js";
import layoutContract from "../../packages/spec/layout-contract.json" with { type: "json" };

interface DiagnosticInfo { message: string; severity: "error" | "warning"; range: { start: number; end: number }; }
interface SerializableNode {
  kind: "element" | "text" | "comment";
  tag?: string;
  text?: string;
  start: number;
  end: number;
  openTagEnd?: number;
  closeTagStart?: number;
  source: string;
  nodePath: number[];
  displayName: string;
  attrs: Record<string, string>;
  children: SerializableNode[];
  properties?: ComponentProperties;
  propertiesError?: string;
  codeSource?: string;
}
interface SourcePayload { source: string; version: number; text: string; displayPath: string; diagnostics: DiagnosticInfo[]; }
interface ModelPayload {
  type: "model";
  generation: number;
  model: { root?: SerializableNode; diagnostics: DiagnosticInfo[] };
  catalog: Record<string, Record<string, SerializableNode>>;
  sources: Record<string, SourcePayload>;
  completionImports: LuiCompletionImport[];
  actionSymbols: Record<string, string[]>;
  rootSource: string;
  device: string;
  fonts: Array<{ family: string; weight: string; uri: string; sha256: string }>;
}
interface SourceReloadPayload { type: "source"; source: SourcePayload; origin?: "native-undo" | "native-redo" | "document"; }
interface SourceEditResultPayload {
  type: "sourceEditResult";
  requestId: number;
  success: boolean;
  status: "applied" | "noop" | "conflict" | "failed";
  source: SourcePayload;
  message?: string;
}
interface DesignerEditResultPayload {
  type: "designerEditResult";
  requestId: number;
  success: boolean;
  source?: SourcePayload;
  message?: string;
}
interface SaveSourceResultPayload {
  type: "saveSourceResult";
  requestId: number;
  success: boolean;
  status: "saved" | "noop" | "conflict" | "failed";
  source: SourcePayload;
  message?: string;
}
interface PickedNode { start: number; end: number; source: string; version: number; nodePath: number[]; instancePath?: string; }

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const rgbaHex = (value: number[]): string => `#${value.slice(0, 3).map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, "0")).join("")}`;
document.documentElement.style.setProperty("--lui-font-size", `${layoutContract.defaults.fontSize}px`);
document.documentElement.style.setProperty("--lui-line-height", String(layoutContract.defaults.lineHeight));
document.documentElement.style.setProperty("--lui-button-min-width", `${layoutContract.defaults.button.minWidth}px`);
document.documentElement.style.setProperty("--lui-button-min-height", `${layoutContract.defaults.button.minHeight}px`);
document.documentElement.style.setProperty("--lui-scrollbar-size", `${layoutContract.defaults.scroll.scrollbarThickness}px`);
document.documentElement.style.setProperty("--lui-scrollbar-thumb", rgbaHex(layoutContract.defaults.scroll.thumbColor));
document.documentElement.style.setProperty("--lui-scrollbar-track", rgbaHex(layoutContract.defaults.scroll.trackColor));
const BUILTIN_TAGS = Array.from(new Set(Object.entries(TAG_TO_CANONICAL).filter(([name, canonical]) => name !== "循环" && /[^\x00-\x7f]/.test(name) && !DEPRECATED_CANONICAL_TAGS.has(canonical)).map(([name]) => name)));
const ATTRIBUTE_NAMES = Object.values(CANONICAL_TO_ATTRIBUTE).concat(["目录:积木"]);
const CATEGORIES: Array<[string, string[]]> = [
  ["标识", ["x:Name", "x:DisplayName", "x:Ref"]],
  ["布局", ["Width", "Height", "MinWidth", "MinHeight", "MaxWidth", "MaxHeight", "Margin", "Padding", "ClipToBounds", "VerticalAlignment", "HorizontalAlignment", "ZIndex", "ChildLayout", "Wrap", "ChildWidth", "ChildHeight", "HorizontalGap", "VerticalGap", "Fill"]],
  ["滚动", ["HorizontalScrollBarVisibility", "VerticalScrollBarVisibility", "ScrollbarColor"]],
  ["画布与网格", ["Canvas.Left", "Canvas.Top", "Canvas.Right", "Canvas.Bottom", "Grid.Row", "Grid.Column", "Grid.RowSpan", "Grid.ColumnSpan", "RowDefinitions", "ColumnDefinitions", "RowSpacing", "ColumnSpacing", "Dock", "LastChildFill", "FlowDirection"]],
  ["变换", ["RenderTransform", "RenderTransformOrigin", "LayoutTransform"]],
  ["外观", ["Background", "HoverBackground", "PressedBackground", "BorderWidth", "BorderColor", "Opacity", "BorderRadius", "Variant", "Icon", "Image", "Type", "Visible", "Visibility"]],
  ["文字", ["FontFamily", "FontSize", "FontWeight", "FontStyle", "Color", "TextStrokeColor", "TextStrokeWidth", "PlaceholderColor", "CursorColor", "LineHeight", "LetterSpacing", "TextWrapping", "TextTrimming", "TextHorizontalAlignment", "TextVerticalAlignment"]],
  ["内容与数据", ["Text", "Title", "Subtitle", "Corner", "Status", "Description", "Hint", "ActionItems", "Placeholder", "Items", "Data", "Options", "Source", "Value", "Min", "Max", "Step", "TrackBrush", "FillBrush", "ProgressDirection", "Columns", "Rows", "Gap", "Orientation"]],
  ["交互", ["Click", "Change", "Submit", "Select", "Open", "Close", "Focus", "Blur", "Complete", "DragStart", "DragEnd", "DragCancel", "Disabled"]],
  ["数据与条件", ["Test", "In", "Each", "Path"]]
];
const PROPERTY_STATE_KEY = "lui.inspector.collapsedCategories";
const collapsedCategories = new Set<string>(JSON.parse(localStorage.getItem(PROPERTY_STATE_KEY) ?? "[]") as string[]);

let model: ModelPayload["model"] | undefined;
let catalog: ModelPayload["catalog"] = {};
let sources: Record<string, SourcePayload> = {};
let completionImports: LuiCompletionImport[] = [];
let actionSymbols: Record<string, string[]> = {};
let rootSource = "";
let selected: PickedNode | undefined;
let enginePickProbe: {sourcePath:string;nodePath:string;probe:unknown}|undefined;
let hovered: PickedNode | undefined;
let editor: EditorView | undefined;
let activeSource: SourcePayload | undefined;
let sourceTimer: ReturnType<typeof setTimeout> | undefined;
interface PendingSourceEdit { baseText: string; text: string; changes: SourcePatch[]; origin: string; }
const pendingSourceEdits: PendingSourceEdit[] = [];
let previewFrame: number | undefined;
let writingSource = false;
let inFlight: { id: number; source: string; version: number; baseText: string; text: string } | undefined;
let inFlightTimer: ReturnType<typeof setTimeout> | undefined;
let nextSourceEditId = 1;
let deferredSource: SourcePayload | undefined;
let sourceDirty = false;
let sourceEditError = "";
let saveRequested = false;
let saveInFlight: { id: number; source: string } | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let nextSaveId = 1;
let lastModelGeneration = 0;
const treeVersions = new Map<string, number>();
const treeTexts = new Map<string, string>();
type DesignerEdit = { id: number; type: "setAttribute" | "resetAttribute" | "setTag"; source: string; start: number; path?: number[]; name: string; value?: string };
const queuedDesignerEdits: DesignerEdit[] = [];
let designerEditInFlight: DesignerEdit | undefined;
let designerEditTimer: ReturnType<typeof setTimeout> | undefined;
let nextDesignerEditId = 1;
let designerEditError = "";
let canvasZoom = 1;
let initialFitSource = "";
interface BoxEdges { left: number; top: number; right: number; bottom: number; }
interface LayoutData {
  x: number; y: number; width: number; height: number; parentX: number; parentY: number;
  contentWidth: number; contentHeight: number; availableWidth: number; availableHeight: number;
  desiredWidth: number; desiredHeight: number; margin: BoxEdges; border: BoxEdges; padding: BoxEdges;
  borderAlign: string; borderRect: { x: number; y: number; width: number; height: number };
  colorSpace: string; alphaMode: string; gradientInterpolation: string;
  fontFamily: string; fontSize: string; fontWeight: string; resolvedFontWeight: string;
  lineHeight: string; fontSynthesis: string; textRasterMode: string; shadowSource: string; boxShadow: string;
}
const layouts = new Map<string, LayoutData>();

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const text = (value: unknown): string => String(value ?? "");

function serializeDraftNode(node: LuiNode, source: string, nodePath: number[] = []): SerializableNode {
  return {
    kind: node.kind, tag: node.tag, text: node.text, start: node.range.start, end: node.range.end,
    openTagEnd: node.openTagEnd, closeTagStart: node.closeTagStart, source, nodePath,
    displayName: displayNameOf(node), attrs: Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value])),
    children: node.children.map((child, index) => serializeDraftNode(child, source, [...nodePath, index]))
  };
}

function nodeFrom(root: SerializableNode | undefined, start: number, source: string): SerializableNode | undefined {
  if (!root) return undefined;
  if (root.start === start && root.source === source) return root;
  for (const child of root.children ?? []) {
    const hit = nodeFrom(child, start, source);
    if (hit) return hit;
  }
  return undefined;
}

function nodeAtPath(root: SerializableNode | undefined, path: readonly number[]): SerializableNode | undefined {
  let current = root;
  for (const index of path) current = current?.children[index];
  return current;
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

function rootForSource(source: string): SerializableNode | undefined {
  return allRoots().find((root) => root.source === source);
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

function nodePath(target: SerializableNode): number[] | undefined {
  return target.nodePath;
}

function nodeRef(node: SerializableNode, instancePath?: string): PickedNode {
  return { start: node.start, end: node.end, source: node.source, version: treeVersions.get(node.source) ?? sources[node.source]?.version ?? 0, nodePath: [...node.nodePath], instancePath };
}
function definitionMatches(left: PickedNode | undefined, right: PickedNode | undefined): boolean {
  return !!left && !!right && left.source === right.source && left.nodePath.join(".") === right.nodePath.join(".");
}
function sameNode(left: PickedNode | undefined, right: PickedNode | undefined): boolean {
  if (!definitionMatches(left, right)) return false;
  // Source/tree selection has definition identity only and may highlight its
  // rendered occurrence. A canvas selection has an instance identity and must
  // never light up sibling occurrences of the same imported definition.
  if (!left?.instancePath) return true;
  return left.instancePath === right?.instancePath;
}
function resolvePicked(picked: PickedNode | undefined): SerializableNode | undefined {
  if (!picked || treeVersions.get(picked.source) !== picked.version) return undefined;
  const node = nodeAtPath(rootForSource(picked.source), picked.nodePath);
  return node?.kind === "element" ? node : undefined;
}

function getPath(value: unknown, path: string): unknown {
  return readPath(value, path);
}

function declaredProperties(node: SerializableNode): ComponentProperties | undefined { return componentTemplate(node)?.template.properties; }
function attributeKey(node: SerializableNode, name: string): string { return declaredProperties(node) && !isLayoutProperty(name) ? name : canonicalAttribute(name); }

function resolve(value: string | undefined, scope: Record<string, unknown>): string | undefined {
  const binding = parseBinding(value);
  const path = binding?.path;
  if (!path) return value;
  const fromScope = getPath(scope, path);
  if (fromScope !== undefined) return binding?.stringFormat?.replace("{0}", String(fromScope)) ?? String(fromScope);
  if (binding?.previewContent !== undefined) return binding.stringFormat?.replace("{0}", binding.previewContent) ?? binding.previewContent;
  return undefined;
}

function effective(node: SerializableNode, scope: Record<string, unknown>): Record<string, string | undefined> {
  return resolvePreviewAttributes(node,scope,attributeKey);
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
    if (part === "*") return "1fr";
    const star = /^(\d+(?:\.\d+)?)\*$/.exec(part);
    if (star) return `${star[1]}fr`;
    const fill = /^(\d+(?:\.\d+)?)填充$/.exec(part);
    return fill ? `${fill[1]}fr` : cssSize(part);
  }).join(" ");
}
function bool(value: unknown): boolean { return value !== false && value !== undefined && value !== null && value !== "" && value !== "false" && value !== "否" && value !== 0; }

/** LUI keeps transforms compact in source but preserves their declared order. */
function cssTransform(value: string | undefined): string {
  if (!value) return "";
  const result: string[] = [];
  const pattern = /(平移|缩放|旋转|倾斜)\s*\(([^)]*)\)/g;
  for (const match of value.matchAll(pattern)) {
    const values = match[2].split(",").map((part) => Number(part.trim()));
    if (match[1] === "平移") result.push(`translate(${values[0] || 0}px, ${values[1] || 0}px)`);
    if (match[1] === "缩放") result.push(values.length > 1 ? `scale(${values[0] || 1}, ${values[1] || 1})` : `scale(${values[0] || 1})`);
    if (match[1] === "旋转") result.push(`rotate(${values[0] || 0}deg)`);
    if (match[1] === "倾斜") result.push(`skew(${values[0] || 0}deg, ${values[1] || 0}deg)`);
  }
  return result.join(" ");
}

/** True DockPanel Arrange pass for the browser preview. */
function arrangeDockPanel(panel: HTMLElement, attrs: Record<string, string | undefined>): void {
  const arrange = () => {
    const children = [...panel.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("lui-node"));
    if (!children.length) return;
    const width = panel.clientWidth; const height = panel.clientHeight;
    if (!width && !height) return;
    let left = 0; let top = 0; let right = width; let bottom = height;
    const fillLast = attrs.LastChildFill !== "否";
    children.forEach((child, index) => {
      const last = index === children.length - 1;
      const style = getComputedStyle(child);
      const marginLeft = Number.parseFloat(style.marginLeft) || 0; const marginTop = Number.parseFloat(style.marginTop) || 0;
      const marginRight = Number.parseFloat(style.marginRight) || 0; const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      child.style.position = "absolute";
      const desiredWidth = child.offsetWidth + marginLeft + marginRight;
      const desiredHeight = child.offsetHeight + marginTop + marginBottom;
      if (last && fillLast) {
        child.style.left = `${left}px`; child.style.top = `${top}px`;
        child.style.width = `${Math.max(0, right - left - marginLeft - marginRight)}px`;
        child.style.height = `${Math.max(0, bottom - top - marginTop - marginBottom)}px`;
        return;
      }
      const dock = child.dataset.luiDock || "左";
      if (dock === "右") { right -= desiredWidth; child.style.left = `${right + marginLeft}px`; child.style.top = `${top + marginTop}px`; child.style.height = `${Math.max(0, bottom - top - marginTop - marginBottom)}px`; }
      else if (dock === "上") { child.style.left = `${left + marginLeft}px`; child.style.top = `${top + marginTop}px`; child.style.width = `${Math.max(0, right - left - marginLeft - marginRight)}px`; top += desiredHeight; }
      else if (dock === "下") { bottom -= desiredHeight; child.style.left = `${left + marginLeft}px`; child.style.top = `${bottom + marginTop}px`; child.style.width = `${Math.max(0, right - left - marginLeft - marginRight)}px`; }
      else { child.style.left = `${left + marginLeft}px`; child.style.top = `${top + marginTop}px`; child.style.height = `${Math.max(0, bottom - top - marginTop - marginBottom)}px`; left += desiredWidth; }
    });
  };
  const observer = new ResizeObserver(arrange); observer.observe(panel); requestAnimationFrame(arrange);
}

function decorate(element: HTMLElement, node: SerializableNode, instancePath: string): void {
  element.dataset.start = String(node.start);
  element.dataset.source = node.source;
  element.dataset.nodePath = node.nodePath.join(".");
  element.dataset.instancePath = instancePath;
  element.classList.add("lui-node");
  element.onmouseenter = () => { hovered = nodeRef(node, instancePath); applyHighlights(); };
  element.onmouseleave = () => { hovered = undefined; applyHighlights(); };
}

/**
 * One canvas-level hit test avoids nested DOM listeners fighting each other.
 * `composedPath` is ordered from the visual leaf upward, so a label inside a
 * button resolves to the label and a bare part of the button resolves to the
 * button.  Imported component wrappers are therefore only selected when their
 * own surface was actually clicked.
 */
function pickVisualTarget(event: MouseEvent): void {
  for (const entry of event.composedPath()) {
    if (!(entry instanceof HTMLElement)) continue;
    const start = Number(entry.dataset.start);
    const source = entry.dataset.source;
    const path = (entry.dataset.nodePath ?? "").split(".").filter(Boolean).map(Number);
    const instancePath = entry.dataset.instancePath;
    if (!Number.isFinite(start) || !source) continue;
    const node = nodeAtPath(rootForSource(source), path) ?? getNode(start, source);
    if (node) { pick(node, instancePath); return; }
  }
}

function applyLayout(element: HTMLElement, tag: string, attrs: Record<string, string | undefined>): void {
  element.style.boxSizing = layoutContract.boxSizing;
  element.style.fontSynthesis = layoutContract.renderFidelity.typography.fontSynthesis;
  element.style.boxShadow = layoutContract.renderFidelity.defaultBoxShadow ? "" : "none";
  element.dataset.luiBorderAlign = layoutContract.renderFidelity.borderAlign;
  element.dataset.luiColorSpace = layoutContract.renderFidelity.colorSpace;
  element.dataset.luiAlphaMode = layoutContract.renderFidelity.alphaMode;
  element.dataset.luiGradientInterpolation = layoutContract.renderFidelity.gradientInterpolation;
  if (capabilityAttributes(tag).includes("FontFamily")) {
    element.dataset.luiTextRaster = ["Text", "Button"].includes(tag)
      ? layoutContract.renderFidelity.typography.studioTextRaster
      : layoutContract.renderFidelity.typography.nativeControlRaster;
  }
  const sizes: Record<string, string> = { Width: "width", Height: "height", MinWidth: "minWidth", MinHeight: "minHeight", MaxWidth: "maxWidth", MaxHeight: "maxHeight" };
  for (const [attribute, style] of Object.entries(sizes)) if (attrs[attribute] !== undefined) (element.style as unknown as Record<string, string>)[style] = cssSize(attrs[attribute]);
  if (attrs.Background !== undefined && parseBrush(attrs.Background)) element.style.background = attrs.Background;
  if (attrs.BorderWidth !== undefined) { element.style.borderWidth = cssSize(attrs.BorderWidth); element.style.borderStyle = "solid"; }
  if (attrs.BorderColor !== undefined && normalizeColor(attrs.BorderColor)) element.style.borderColor = attrs.BorderColor;
  if (attrs.Color !== undefined && normalizeColor(attrs.Color)) element.style.color = attrs.Color;
  // This is only the explicitly selected structural illustration. Real preview
  // uses the engine Label stroke from the same projected source attributes.
  const strokeWidth = Number(attrs.TextStrokeWidth ?? 0);
  if (tag === "Text" && strokeWidth > 0 && Number.isFinite(strokeWidth) && normalizeColor(attrs.TextStrokeColor ?? "")) {
    element.style.textShadow = [[-1,0],[1,0],[0,-1],[0,1],[-0.707,-0.707],[0.707,-0.707],[-0.707,0.707],[0.707,0.707]]
      .map(([x,y]) => `${x * strokeWidth}px ${y * strokeWidth}px 0 ${attrs.TextStrokeColor}`).join(",");
  }
  if (attrs.Opacity !== undefined) element.style.opacity = attrs.Opacity;
  if (attrs.BorderRadius !== undefined) element.style.borderRadius = cssSize(attrs.BorderRadius);
  if (attrs.FontFamily !== undefined) element.style.fontFamily = `"${attrs.FontFamily.replaceAll('"', '')}"`;
  if (attrs.FontSize !== undefined) element.style.fontSize = cssSize(attrs.FontSize);
  if (attrs.FontWeight !== undefined) element.style.fontWeight = attrs.FontWeight;
  if (attrs.FontStyle !== undefined) element.style.fontStyle = attrs.FontStyle;
  if (attrs.LineHeight !== undefined) element.style.lineHeight = attrs.LineHeight;
  if (attrs.LetterSpacing !== undefined) element.style.letterSpacing = cssSize(attrs.LetterSpacing);
  if (attrs.TextWrapping !== undefined) element.style.whiteSpace = attrs.TextWrapping === "换行" ? "normal" : "nowrap";
  if (attrs.TextTrimming === "尾部省略") { element.style.textOverflow = "ellipsis"; element.style.overflow = "hidden"; }
  if (attrs.TextHorizontalAlignment !== undefined) element.style.textAlign = ({ 左: "left", 居中: "center", 右: "right" } as Record<string, string>)[attrs.TextHorizontalAlignment] ?? attrs.TextHorizontalAlignment;
  if (attrs.TextVerticalAlignment !== undefined && tag === "Text") { element.style.display = "flex"; element.style.flexDirection = "column"; element.style.justifyContent = ({ 上: "flex-start", 居中: "center", 下: "flex-end" } as Record<string, string>)[attrs.TextVerticalAlignment] ?? "center"; }
  if (attrs.Margin !== undefined) element.style.margin = cssThickness(attrs.Margin);
  if (attrs.Padding !== undefined) element.style.padding = cssThickness(attrs.Padding);
  if (attrs.ClipToBounds !== undefined) element.style.overflow = bool(attrs.ClipToBounds) ? "hidden" : "visible";
  const visualTransform = cssTransform(attrs.RenderTransform);
  if (visualTransform) element.style.transform = visualTransform;
  if (attrs.RenderTransformOrigin) element.style.transformOrigin = attrs.RenderTransformOrigin.split(",").map((part) => `${Number(part.trim()) * 100}%`).join(" ");
  // Project terminology: VerticalAlignment is the left/right (X) axis;
  // HorizontalAlignment is the up/down (Y) axis. Glyphs remain unchanged.
  const horizontal = attrs.VerticalAlignment;
  const vertical = attrs.HorizontalAlignment;
  if (horizontal) element.style.justifySelf = ({ "左": "start", "居中": "center", "右": "end", "拉伸": "stretch" } as Record<string, string>)[horizontal] ?? "stretch";
  if (vertical) element.style.alignSelf = ({ "上": "start", "居中": "center", "下": "end", "拉伸": "stretch" } as Record<string, string>)[vertical] ?? "stretch";
  const visibility = attrs.Visibility;
  if (visibility === "折叠" || visibility === "否" || visibility === "false") element.style.display = "none";
  else if (visibility === "隐藏") element.style.visibility = "hidden";
  if (tag === "Grid") {
    element.style.display = "grid";
    element.style.gridTemplateRows = cssTracks(attrs.RowDefinitions ?? "填充");
    element.style.gridTemplateColumns = cssTracks(attrs.ColumnDefinitions ?? "填充");
    element.style.rowGap = cssSize(attrs.RowSpacing ?? "0");
    element.style.columnGap = cssSize(attrs.ColumnSpacing ?? "0");
  }
  if (tag === "Canvas") element.style.position = "relative";
  if (tag === "StackPanel") { element.style.display = "flex"; element.style.flexDirection = attrs.Orientation === "水平" ? (attrs.FlowDirection === "从右到左" ? "row-reverse" : "row") : "column"; element.style.gap = attrs.Gap ? cssSize(attrs.Gap) : ""; }
  if (tag === "WrapPanel") { element.style.display = "flex"; element.style.flexDirection = attrs.Orientation === "垂直" ? "column" : (attrs.FlowDirection === "从右到左" ? "row-reverse" : "row"); element.style.flexWrap = "wrap"; element.style.gap = attrs.Gap ? cssSize(attrs.Gap) : ""; }
  if (tag === "UniformGrid") { element.style.display = "grid"; element.style.gridTemplateColumns = `repeat(${Math.max(1, Number(attrs.Columns) || 1)}, minmax(0, 1fr))`; }
  if (tag === "DockPanel") { element.style.display = "block"; element.style.position = "relative"; element.style.minWidth = "0"; element.style.minHeight = "0"; }
  if (tag === "Viewbox") {
    // The design canvas is its own coordinate system.  The parent stage only
    // supplies a viewport; it never changes the page definition.
    element.style.position = "relative";
    element.style.overflow = "hidden";
  }
  if (attrs["Grid.Row"] !== undefined) element.style.gridRow = `${Number(attrs["Grid.Row"]) + 1} / span ${attrs["Grid.RowSpan"] ?? "1"}`;
  if (attrs["Grid.Column"] !== undefined) element.style.gridColumn = `${Number(attrs["Grid.Column"]) + 1} / span ${attrs["Grid.ColumnSpan"] ?? "1"}`;
  if (attrs.ZIndex !== undefined) element.style.zIndex = attrs.ZIndex;
  if (attrs.Fill !== undefined) element.dataset.luiFill = attrs.Fill;
  if (attrs.Dock !== undefined) element.dataset.luiDock = attrs.Dock;
  if (attrs["Canvas.Left"] !== undefined || attrs["Canvas.Top"] !== undefined || attrs["Canvas.Right"] !== undefined || attrs["Canvas.Bottom"] !== undefined) {
    element.style.position = "absolute";
    if (attrs["Canvas.Left"] !== undefined) element.style.left = cssSize(attrs["Canvas.Left"]);
    if (attrs["Canvas.Top"] !== undefined) element.style.top = cssSize(attrs["Canvas.Top"]);
    if (attrs["Canvas.Right"] !== undefined) element.style.right = cssSize(attrs["Canvas.Right"]);
    if (attrs["Canvas.Bottom"] !== undefined) element.style.bottom = cssSize(attrs["Canvas.Bottom"]);
  }
}

function applyScrollPresentation(element: HTMLElement, attrs: Record<string, string | undefined>): void {
  const overflow = (value: string | undefined, legacy: "禁用" | "隐藏"): "auto" | "scroll" | "hidden" => {
    const visibility = value ?? legacy;
    if (visibility === "禁用") return "hidden";
    return visibility === "显示" ? "scroll" : "auto";
  };
  const horizontal = attrs.HorizontalScrollBarVisibility ?? "禁用";
  const vertical = attrs.VerticalScrollBarVisibility ?? "隐藏";
  element.style.overflowX = overflow(horizontal, "禁用");
  element.style.overflowY = overflow(vertical, "隐藏");
  element.classList.toggle("scrollbar-hidden-x", horizontal === "隐藏");
  element.classList.toggle("scrollbar-hidden-y", vertical === "隐藏");
  if (attrs.ScrollbarColor) element.style.setProperty("--lui-scrollbar-color", attrs.ScrollbarColor);
  element.classList.toggle("scrollbar-always-y", vertical === "显示");
}

/** LUI 2.0: every paired visual node is a layout host.  CSS only draws the
 * already uniform contract; free placement deliberately overlays children. */
function applyChildLayout(host: HTMLElement, attrs: Record<string, string | undefined>): void {
  // Visibility wins over the host's grid/flex display. Hidden nodes must not
  // acquire layout slots (especially Fill slots) from their parent either.
  if (["折叠", "否", "false"].includes(attrs.Visibility ?? "")) {
    host.style.display = "none";
    return;
  }
  const mode = attrs.ChildLayout ?? "自由";
  host.style.position ||= "relative";
  host.style.minWidth ||= "0";
  host.style.minHeight ||= "0";
  if (mode === "自由") {
    host.style.display = "grid";
    // A button's justify-content:center must not shrink its sole grid column.
    // Percentage descendants resolve against the complete parent content box.
    host.style.gridTemplateColumns = "minmax(0, 1fr)";
    host.style.gridAutoRows = "minmax(0, 1fr)";
    host.style.justifyContent = "stretch";
    host.style.alignContent = "stretch";
  } else {
    host.style.display = "flex";
    host.style.flexDirection = mode === "水平" ? "row" : "column";
    host.style.flexWrap = attrs.Wrap === "是" ? "wrap" : "nowrap";
    host.style.columnGap = cssSize(attrs.HorizontalGap ?? "0");
    host.style.rowGap = cssSize(attrs.VerticalGap ?? "0");
    // A composite button is a compact content card: its authored text children
    // are left-aligned while the button itself keeps its normal hit surface.
    host.style.alignItems = "stretch";
  }
  const children = [...host.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("lui-node") && child.style.display !== "none");
  children.forEach((child, index) => {
    if (mode === "自由") { child.style.gridArea = "1 / 1"; child.style.zIndex ||= String(index); }
    child.style.minWidth ||= "0";
    child.style.minHeight ||= "0";
    if (attrs.ChildWidth !== undefined) child.style.width = cssSize(attrs.ChildWidth);
    if (attrs.ChildHeight !== undefined) child.style.height = cssSize(attrs.ChildHeight);
    if (mode !== "自由") {
      // Flex only allocates slots. The inner grid aligns the visual on fixed
      // X/Y axes, independent of the parent's flow direction.
      const slot = document.createElement("div"); slot.className = "lui-layout-slot";
      child.replaceWith(slot); slot.append(child); child.style.gridArea = "1 / 1";
      slot.style.zIndex = child.style.zIndex || String(index);
      if (child.dataset.luiFill === "是") {
        slot.style.flexGrow = "1"; slot.style.flexShrink = "1"; slot.style.flexBasis = "0";
      } else slot.style.flexShrink = "0";
      // Percentages need a definite flow slot, but explicit pixels remain on
      // the visual so an aligned fill item need not stretch its own bounds.
      const mainSize = mode === "水平" ? "width" : "height";
      if (child.style[mainSize].endsWith("%")) {
        slot.style[mainSize] = child.style[mainSize];
        child.style[mainSize] = "100%";
      }
    }
  });
}

function fragmentChildren(nodes: SerializableNode[], scope: Record<string, unknown>, trace: string[], parentInstancePath: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  nodes.forEach((child, index) => fragment.append(renderNode(child, scope, trace, `${parentInstancePath}/${index}`)));
  return fragment;
}

function componentTemplate(node: SerializableNode): { directory: string; name: string; template: SerializableNode } | undefined {
  const [alias, name] = String(canonicalTag(node.tag) ?? node.tag).split(":");
  const sourceRoot = allRoots().find((root) => root.source === node.source);
  const directory = sourceRoot ? Object.entries(sourceRoot.attrs).find(([attribute]) => directoryAlias(attribute)?.alias === alias)?.[1] : undefined;
  const template = directory ? catalog[directory]?.[name] : undefined;
  return directory && name && template ? { directory, name, template } : undefined;
}

function renderComponent(node: SerializableNode, scope: Record<string, unknown>, trace: string[], instancePath: string): Node {
  const component = componentTemplate(node);
  if (!component) return document.createComment(`组件未登记：${node.tag}`);
  const { directory, name, template } = component;
  const key = `${directory}/${name}`;
  if (trace.includes(key)) return document.createComment(`组件循环：${key}`);
  const wrapper = document.createElement("div");
  wrapper.className = "lui-component-instance";
  decorate(wrapper, node, instancePath);
  // The component instance is the direct Grid/Canvas child. Its internals stay
  // folded in the page inspector, while its declared layout remains effective.
  applyLayout(wrapper, "Component", effective(node, scope));
  const props: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(template.properties ?? {})) if (definition.default !== undefined) props[key] = structuredClone(definition.default);
  for (const [property, value] of Object.entries(effective(node, scope))) if (value !== undefined) props[template.properties && isLayoutProperty(property) ? sourceAttribute(property) : property] = value;
  if (template.properties) for (const [key, raw] of Object.entries(node.attrs)) {
    const binding = parseBinding(raw); const value = binding ? getPath(scope, binding.path) : undefined;
    if (value !== undefined) props[isLayoutProperty(key) ? sourceAttribute(canonicalAttribute(key)) : key] = value;
  }
  wrapper.append(renderNode(template, { ...scope, props, componentInstance: true, slots: { Content: visualChildren(node) } }, [...trace, key], `${instancePath}/component:${key}`));
  applyChildLayout(wrapper, { ChildLayout: "自由" });
  return wrapper;
}

function renderNode(node: SerializableNode, scope: Record<string, unknown> = {}, trace: string[] = [], instancePath = "root"): Node {
  if (node.properties && !scope.props) scope = { ...scope, props: Object.fromEntries(Object.entries(node.properties).filter(([,p]) => p.default !== undefined).map(([k,p]) => [k, structuredClone(p.default)])) };
  if (node.kind === "text") { const span = document.createElement("span"); span.textContent = node.text ?? ""; return span; }
  if (node.kind === "comment") return document.createComment(node.text ?? "");
  const tag = canonicalTag(node.tag) ?? "Panel";
  if (tag === "__placeholder__") {
    const placeholder = document.createElement("button");
    placeholder.className = "lui-node placeholder";
    placeholder.textContent = "<> 选择标签类型";
    decorate(placeholder, node, instancePath);
    return placeholder;
  }
  if (tag === "lui:Preview" || tag === "lui:Set") return document.createDocumentFragment();
  if (tag === "lui:If") return bool(effective(node, scope).Test) ? fragmentChildren(visualChildren(node), scope, trace, instancePath) : document.createDocumentFragment();
  if (tag === "lui:For") {
    const attrs = effective(node, scope);
    const binding = parseBinding(sourceValue(node, 'In')); let values = binding && getPath(scope, binding.path);
    const previewText = typeof values === 'string' ? values : values === undefined ? binding?.previewContent : undefined;
    if (previewText !== undefined) {
      try {
        const preview = JSON.parse(previewText.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
        if (Array.isArray(preview)) values = preview;
      } catch { /* JSON only; never execute preview code. */ }
    }
    if (values && typeof values === 'object') {
      const fragment = document.createDocumentFragment();
      Object.values(values).forEach((item, index) => fragment.append(fragmentChildren(visualChildren(node), { ...scope, [attrs.Items ?? attrs.Each ?? 'item']: item, item, index: index + 1 }, trace, `${instancePath}/item:${index}`)));
      return fragment;
    }
    return document.createDocumentFragment();
  }
  if (tag === "lui:Slot") {
    const content = (scope.slots as Record<string, SerializableNode[]> | undefined)?.Content ?? [];
    if (content.length) return fragmentChildren(content, scope, trace, `${instancePath}/slot`);
    const placeholder = document.createElement("div"); placeholder.className = "content-presenter-placeholder"; placeholder.textContent = "调用处内容"; return placeholder;
  }
  if (tag.includes(":") && !tag.startsWith("lui:")) return renderComponent(node, scope, trace, instancePath);
  const attrs = effective(node, scope);
  if (tag === "lui:Page") {
    const viewport = document.createElement("div"); decorate(viewport, node, instancePath); viewport.classList.add("lui-node", "page-root");
    const designWidth = Number(attrs.Width); const designHeight = Number(attrs.Height);
    const design = document.createElement("div"); design.className = "lui-page-design";
    design.style.width = `${designWidth}px`; design.style.height = `${designHeight}px`; design.style.transformOrigin = "top left";
    if (attrs.Padding !== undefined) design.style.padding = cssThickness(attrs.Padding);
    design.style.overflow = bool(attrs.ClipToBounds) ? "hidden" : "visible";
    design.append(fragmentChildren(visualChildren(node), scope, trace, instancePath)); applyChildLayout(design, attrs); viewport.append(design);
    const applyScale = () => {
      const rect = { width: viewport.clientWidth, height: viewport.clientHeight }; const margin = thicknessParts(attrs.Margin);
      const left = Number(margin[0]) || 0; const top = Number(margin[1]) || 0; const right = Number(margin[2]) || 0; const bottom = Number(margin[3]) || 0;
      const availableWidth = Math.max(0, rect.width - left - right); const availableHeight = Math.max(0, rect.height - top - bottom);
      const frame = calculatePageFrame({ viewportWidth: rect.width, viewportHeight: rect.height, designWidth, designHeight, marginLeft: left, marginTop: top, marginRight: right, marginBottom: bottom });
      design.style.transform = `scale(${frame.scale})`;
      design.style.left = `${frame.x}px`;
      design.style.top = `${frame.y}px`;
      viewport.dataset.pageScale = String(frame.scale);
    };
    new ResizeObserver(applyScale).observe(viewport); requestAnimationFrame(applyScale);
    return viewport;
  }
  if (tag === "lui:Component") {
    const element = document.createElement("div"); decorate(element, node, instancePath); element.classList.add("lui-node", "control-root");
    applyLayout(element, "Component", attrs);
    element.append(fragmentChildren(visualChildren(node), scope, trace, instancePath)); applyChildLayout(element, attrs); return element;
  }
  if (tag === "Viewbox") {
    const viewport = document.createElement("div"); decorate(viewport, node, instancePath); viewport.classList.add("lui-node", "viewbox");
    const designWidth = Number(attrs.Width); const designHeight = Number(attrs.Height);
    const design = document.createElement("div"); design.className = "lui-viewbox-design";
    design.style.width = `${designWidth}px`; design.style.height = `${designHeight}px`;
    design.style.transformOrigin = "top left";
    design.append(fragmentChildren(visualChildren(node), scope, trace, instancePath)); viewport.append(design);
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
  decorate(element, node, instancePath);
  element.classList.add(`tag-${tag.replace(/[^A-Za-z0-9_-]/g, "-")}`);
  applyLayout(element, tag, attrs);
  if (tag === "Grid" || tag === "UniformGrid") element.classList.add("grid"); else if (tag === "Canvas") element.classList.add("canvas"); else if (tag === "Viewbox") element.classList.add("viewbox"); else if (tag === "Row" || tag === "StackPanel" || tag === "WrapPanel" || tag === "DockPanel") element.classList.add("row"); else element.classList.add("panel");
  if (tag === "Button") {
    element.classList.add("button");
    if (attrs.Variant === "常规" || attrs.Variant === "次要" || attrs.Variant === "secondary") element.classList.add("secondary");
    const caption = document.createElement("span"); caption.className = "lui-button-caption";
    const label = document.createElement("span"); label.textContent = attrs.Text ?? (visualChildren(node).length ? "" : "按钮");
    caption.append(label);
    caption.style.justifyContent = ({ "左": "flex-start", "居中": "center", "右": "flex-end" } as Record<string, string>)[attrs.TextHorizontalAlignment ?? layoutContract.defaults.button.textHorizontalAlignment];
    caption.style.alignItems = ({ "上": "flex-start", "居中": "center", "下": "flex-end" } as Record<string, string>)[attrs.TextVerticalAlignment ?? layoutContract.defaults.button.textVerticalAlignment];
    if (visualChildren(node).length) caption.classList.add("composite-caption");
    if (bool(attrs.Disabled)) caption.style.color = `rgb(${layoutContract.defaults.button.disabledTextColor.slice(0, 3).join(",")})`;
    element.append(caption);
  }
  else if (tag === "Text") { element.classList.add("text"); element.style.fontSize = attrs.FontSize ? cssSize(attrs.FontSize) : ""; element.textContent = text(attrs.Text); }
  else if (tag === "TextField") {
    element.classList.add("text-field");
    const input = document.createElement("input");
    input.type = "text";
    input.value = text(attrs.Text);
    input.placeholder = text(attrs.Placeholder);
    input.readOnly = true;
    input.tabIndex = -1;
    if (attrs.Padding) input.style.padding = "0";
    if (attrs.PlaceholderColor) element.style.setProperty("--lui-placeholder-color", attrs.PlaceholderColor);
    if (attrs.CursorColor) input.style.caretColor = attrs.CursorColor;
    element.append(input);
  }
  else if (tag === "Card") element.classList.add("card");
  else if (tag === "Scroll") { element.classList.add("scroll"); applyScrollPresentation(element, attrs); }
  else if (tag === "SafeArea") element.classList.add("safe-area");
  else if (tag === "Modal") element.classList.add("modal");
  else if (tag === "Progress") {
    element.classList.add("progress"); const track = document.createElement("span"); track.className = "progress-track"; const fill = document.createElement("span"); fill.className = "progress-fill";
    const progress = layoutContract.defaults.progress;
    const rgba = (c: number[]) => `rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`;
    element.style.height ||= `${progress.height}px`;
    element.style.borderRadius ||= `${progress.borderRadius}px`;
    track.style.height = "100%";
    track.style.background = attrs.TrackBrush ?? attrs.Background ?? rgba(progress.track);
    fill.style.background = attrs.FillBrush ?? `linear-gradient(90deg, ${rgba(progress.from)}, ${rgba(progress.to)})`;
    const ratio = Math.max(0, Math.min(100, (Number(attrs.Value) || 0) / Math.max(1, Number(attrs.Max ?? progress.max)) * 100));
    const direction = attrs.ProgressDirection ?? "从左到右";
    track.style.display = "flex";
    if (direction === "从右到左") track.style.justifyContent = "flex-end";
    if (direction === "从上到下" || direction === "从下到上") { track.style.flexDirection = "column"; if (direction === "从下到上") track.style.justifyContent = "flex-end"; fill.style.width = "100%"; fill.style.height = `${ratio}%`; }
    else fill.style.width = `${ratio}%`;
    track.append(fill); element.append(track);
  } else if (tag === "Toggle") { element.classList.add("toggle"); element.textContent = bool(attrs.Value) ? "开启" : "关闭"; }
  else if (tag === "Slider") { element.classList.add("slider"); const input = document.createElement("input"); input.type = "range"; input.min = attrs.Min ?? "0"; input.max = attrs.Max ?? "100"; input.value = attrs.Value ?? "0"; element.append(input); }
  // Text and input controls keep their own visual layer, then host authored
  // child controls in the same content rectangle just like any paired tag.
  element.append(fragmentChildren(visualChildren(node), scope, trace, instancePath));
  applyChildLayout(element, attrs);
  if (tag === "DockPanel") arrangeDockPanel(element, attrs);
  return element;
}

function outline(node: SerializableNode, host: HTMLElement, depth = 0): void {
  if (node.kind !== "element" || canonicalTag(node.tag) === "lui:Preview" || canonicalTag(node.tag) === "lui:Set") return;
  const row = document.createElement("button");
  row.className = "outline-row";
  row.style.marginLeft = `${depth * 12}px`;
  const tag = String(node.tag ?? "节点"); const raw = declaredProperties(node) ? sourceValue(node,'文本') ?? sourceValue(node,'标题') : sourceValue(node, "Text") ?? sourceValue(node, "Title"); const binding = parseBinding(raw);
  const summary = binding?.path ?? (raw && !raw.startsWith("{") ? raw.replace(/\s+/g, " ").slice(0, 22) : "");
  row.textContent = summary ? `${tag} · ${summary}` : tag;
  row.title = node.displayName || tag;
  row.onclick = () => pick(node);
  if (componentTemplate(node)) row.ondblclick = (event) => { event.preventDefault(); vscode.postMessage({ type: "openComponent", source: componentTemplate(node)?.template.source }); };
  row.onmouseenter = () => { hovered = nodeRef(node); applyHighlights(); };
  row.onmouseleave = () => { hovered = undefined; applyHighlights(); };
  row.dataset.start = String(node.start);
  row.dataset.source = node.source;
  row.dataset.nodePath = node.nodePath.join(".");
  host.append(row);
  // A page tree shows only authored structure. Imported implementations are
  // opened explicitly with a double click instead of flooding the parent tree.
  for (const child of node.children ?? []) if (child.kind === "element" && canonicalTag(child.tag) !== "lui:Preview" && canonicalTag(child.tag) !== "lui:Set") outline(child, host, depth + 1);
}

function sourceValue(node: SerializableNode, canonical: string): string | undefined {
  return Object.entries(node.attrs ?? {}).reverse().find(([name]) => attributeKey(node, name) === canonical)?.[1];
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

function sourceHasUncommittedDraft(source: string): boolean {
  return activeSource?.source === source && !!editor && (sourceDirty || !!sourceTimer || !!inFlight || editor.state.doc.toString() !== activeSource.text);
}

function pumpDocumentWork(): void {
  if (inFlight || designerEditInFlight || saveInFlight || sourceTimer) return;
  if (activeSource && editor && (sourceDirty || editor.state.doc.toString() !== activeSource.text)) {
    sendSourceEdit();
    return;
  }
  if (queuedDesignerEdits.length) {
    const next = queuedDesignerEdits.shift()!;
    designerEditInFlight = next;
    designerEditTimer = setTimeout(() => {
      if (designerEditInFlight?.id !== next.id) return;
      designerEditInFlight = undefined;
      queuedDesignerEdits.length = 0;
      designerEditError = "属性写入超时，已解除锁定；请重试本次修改。";
      draw();
    }, 5000);
    vscode.postMessage({ type: next.type, requestId: next.id, version: sources[next.source]?.version, start: next.start, path: next.path, source: next.source, name: next.name, value: next.value });
    return;
  }
  if (saveRequested && activeSource) {
    saveRequested = false;
    const request = { id: nextSaveId++, source: activeSource.source };
    saveInFlight = request;
    saveTimer = setTimeout(() => {
      if (saveInFlight?.id !== request.id) return;
      saveInFlight = undefined;
      sourceEditError = "保存超时，已解除锁定；请再次按 Ctrl+S。";
      draw();
    }, 5000);
    vscode.postMessage({ type: "saveSource", requestId: request.id, source: activeSource.source, version: activeSource.version });
  }
}

function flushDesignerEdits(): void {
  if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = undefined; }
  pumpDocumentWork();
}

function editNode(node: SerializableNode, type: DesignerEdit["type"], name: string, value?: string): void {
  // Capture the structural path when the intent is made.  A pending source edit
  // recreates the parsed nodes and can shift offsets, but this path still points
  // at the element the designer user actually selected.
  designerEditError = "";
  queuedDesignerEdits.push({ id: nextDesignerEditId++, type, source: node.source, start: node.start, path: nodePath(node), name, value });
  flushDesignerEdits();
}

function writeAttribute(node: SerializableNode, key: string, value: string): void {
  editNode(node, "setAttribute", declaredProperties(node)?.[key] ? key : sourceAttribute(key), value);
}

function defaultValue(node: SerializableNode, key: string): string {
  if (declaredProperties(node)?.[key]) return String(declaredProperties(node)![key]!.default ?? '');
  if (key === "Width" || key === "Height") return "自动";
  if (key === "MinWidth" || key === "MinHeight" || key === "Margin" || key === "Padding" || key === "HorizontalGap" || key === "VerticalGap") return "0";
  if (key === "MaxWidth" || key === "MaxHeight") return "无限";
  if (key === "HorizontalAlignment" || key === "VerticalAlignment") return "拉伸";
  if (key === "TextHorizontalAlignment" || key === "TextVerticalAlignment") return "居中";
  if (key === "ClipToBounds") return canonicalTag(node.tag) === "lui:Page" ? "是" : "否";
  if (key === "ChildLayout") return "自由";
  if (key === "TextStrokeWidth") return "0";
  if (key === "Wrap" || key === "Fill") return "否";
  if (key === "ChildWidth" || key === "ChildHeight") return "自动";
  if (key === "ZIndex") return "自动（源码顺序）";
  return "";
}

function resetAttribute(node: SerializableNode, key: string): void {
  editNode(node, "resetAttribute", declaredProperties(node)?.[key] ? key : sourceAttribute(key));
}

function thicknessParts(value: string | undefined): string[] {
  const parts = (value ?? "0").split(",").map((part) => part.trim());
  return parts.length === 4 ? parts : [parts[0] ?? "0", parts[0] ?? "0", parts[0] ?? "0", parts[0] ?? "0"];
}

function propertyInput(host: HTMLElement, node: SerializableNode, key: string): void {
  const label = document.createElement("label");
  const custom = declaredProperties(node)?.[key];
  label.textContent = custom ? key : ATTRIBUTE_LABELS[key] ?? key;
  const definition = custom ? { kind: custom.type === 'number' ? 'number' : custom.type === 'boolean' ? 'enum' : 'text', options: custom.type === 'boolean' ? ['true','false'] : undefined } : attributeDefinition(key);
  const explicit = sourceValue(node, key);
  const value = explicit ?? defaultValue(node, key);
  label.dataset.property=key;
  label.dataset.search=[key,ATTRIBUTE_LABELS[key],sourceAttribute(key)].join(' ').toLowerCase();
  label.title=`${explicit===undefined?'继承：组件声明 / LUI 共享默认值':'显式属性'}\n当前解析值：${effective(node,{})[key]??value}`;
  const reset=document.createElement('button');reset.type='button';reset.textContent='复位';reset.disabled=explicit===undefined;
  reset.title='删除显式属性，恢复继承';reset.onclick=()=>resetAttribute(node,key);label.append(reset);
  const bound=parseBinding(value);
  if(bound){
    const section=document.createElement('fieldset');section.className='binding-options';
    const error=document.createElement('small');error.className='property-error';
    const expression=document.createElement('input');expression.value=value;expression.title='绑定表达式';
    expression.onchange=()=>{if(!parseBinding(expression.value)){error.textContent='绑定表达式无效';return;}error.textContent='';writeAttribute(node,key,expression.value);};
    const sample=document.createElement('input');sample.value=bound.previewContent??'';sample.placeholder='仅预览内容（不更改绑定路径）';
    sample.onchange=()=>{
      if(/["'\r\n]/.test(sample.value)){error.textContent='预览内容不能含引号或换行，请在源码中编辑';return;}
      const body=value.slice(0,-1).replace(/,\s*预览内容\s*=\s*(?:'[^']*'|"[^"]*"|[^,}]*)/,'');
      writeAttribute(node,key,`${body}, 预览内容='${sample.value}'}`);
    };
    section.append(expression,sample,error);label.append(section);host.append(label);return;
  }
  let input: HTMLInputElement | HTMLSelectElement;
  if (key === "HorizontalAlignment" || key === "VerticalAlignment") {
    const buttons = document.createElement("div"); buttons.className = "alignment-buttons"; buttons.setAttribute("role", "radiogroup"); buttons.setAttribute("aria-label", ATTRIBUTE_LABELS[key] ?? key);
    // Keep source values on their semantic axis.  The glyphs intentionally follow the
    // designer's requested visual matrix, including its explicit quarter-turn arrows.
    const values = key === "VerticalAlignment"
      ? [{ option: "左", glyph: "↥", rotation: -90 }, { option: "居中", glyph: "↔", rotation: 0 }, { option: "右", glyph: "↧", rotation: -90 }, { option: "拉伸", glyph: "↹", rotation: 0 }]
      : [{ option: "上", glyph: "↥", rotation: 0 }, { option: "居中", glyph: "↔", rotation: 90 }, { option: "下", glyph: "↧", rotation: 0 }, { option: "拉伸", glyph: "↹", rotation: 90 }];
    for (const { option, glyph, rotation } of values) {
      const active = value === option || (!value && option === "拉伸");
      const button = document.createElement("button"); button.type = "button"; button.classList.add("alignment-icon"); button.setAttribute("role", "radio"); button.setAttribute("aria-label", option); button.setAttribute("aria-checked", String(active)); button.title = `${ATTRIBUTE_LABELS[key] ?? key}：${option}`; button.classList.toggle("is-active", active);
      const arrow = document.createElement("span"); arrow.className = "alignment-arrow"; arrow.textContent = glyph; arrow.setAttribute("aria-hidden", "true"); arrow.style.setProperty("--alignment-arrow-rotation", `${rotation}deg`); button.append(arrow);
      button.onclick = () => writeAttribute(node, key, option); buttons.append(button);
    }
    label.append(buttons); host.append(label); return;
  } else if (key === "Width" || key === "Height") {
    const box = document.createElement("div"); box.className = "size-editor";
    const actual = layouts.get(`${node.source}:${node.start}`); const measured = key === "Width" ? actual?.width : actual?.height;
    const mode = document.createElement("select"); for (const [labelValue, optionText] of [["自动", measured === undefined ? "自动" : `自动（${Math.round(measured)}）`], ["像素", "px"],['百分比','%']]) { const option = document.createElement("option"); option.value = labelValue; option.textContent = optionText; mode.append(option); }
    const isAuto = !value || value === "自动"; mode.value = isAuto ? "自动" : value.endsWith('%')?'百分比':"像素";
    const field = document.createElement("input"); field.type = "number"; field.step = "1";field.min='0'; field.value = isAuto ? "" : String(parseFloat(value)); field.placeholder = "实际尺寸见下方";
    const commit=()=>{if(mode.value==='自动'){writeAttribute(node,key,'自动');return;}if(!field.checkValidity()||!Number.isFinite(field.valueAsNumber)){field.reportValidity();return;}writeAttribute(node,key,field.value+(mode.value==='百分比'?'%':''));};
    mode.onchange=commit;field.onchange=commit;
    box.append(mode, field); label.append(box); host.append(label); return;
  } else if ((definition?.kind === "color" || definition?.kind === "brush") && !parseBinding(value)) {
    const editor = document.createElement("div"); editor.className = definition.kind === "brush" ? "brush-editor" : "color-editor";
    const colorFields = (initial: string, changed: (color: string) => void): HTMLElement => {
      const normalized = normalizeColor(initial) ?? "#000000FF";
      const row = document.createElement("span"); row.className = "color-fields";
      const picker = document.createElement("input"); picker.type = "color"; picker.value = normalized.slice(0, 7);
      const alpha = document.createElement("input"); alpha.type = "range"; alpha.min = "0"; alpha.max = "255"; alpha.value = String(normalized.length === 9 ? Number.parseInt(normalized.slice(7), 16) : 255); alpha.title = "透明度";
      const output = document.createElement("output");
      const commit = () => { const next = `${picker.value.toUpperCase()}${Number(alpha.value).toString(16).padStart(2, "0").toUpperCase()}`; output.value = next; changed(next); };
      output.value = normalized.length === 7 ? `${normalized}FF` : normalized; picker.onchange = commit; alpha.onchange = commit; row.append(picker, alpha, output); return row;
    };
    if (definition.kind === "color") {
      editor.append(colorFields(value, (next) => writeAttribute(node, key, next)));
    } else {
      let brush = parseBrush(value) ?? { kind: "solid" as const, color: "#000000FF" };
      const mode = document.createElement("select");
      for (const [entry, caption] of [["solid", "纯色"], ["linear", "线性渐变"]]) { const option = document.createElement("option"); option.value = entry; option.textContent = caption; mode.append(option); }
      mode.value = brush.kind;
      const fields = document.createElement("div"); fields.className = "brush-fields";
      const renderFields = () => {
        fields.innerHTML = "";
        if (brush.kind === "solid") fields.append(colorFields(brush.color, (color) => { brush = { kind: "solid", color }; writeAttribute(node, key, color); }));
        else {
          const angle = document.createElement("input"); angle.type = "number"; angle.value = String(brush.angle); angle.title = "角度（deg）";
          const offsets = brush.stops.map((stop) => stop.offset) as [number, number]; const colors = brush.stops.map((stop) => stop.color) as [string, string];
          const commit = () => writeAttribute(node, key, formatLinearGradient(Number(angle.value) || 0, colors[0], offsets[0], colors[1], offsets[1]));
          angle.onchange = commit; fields.append(angle);
          for (let index = 0; index < 2; index += 1) {
            const stop = document.createElement("span"); stop.className = "gradient-stop";
            stop.append(colorFields(colors[index], (color) => { colors[index] = color; commit(); }));
            const offset = document.createElement("input"); offset.type = "number"; offset.min = "0"; offset.max = "100"; offset.value = String(offsets[index]); offset.title = "色标位置（%）"; offset.onchange = () => { offsets[index] = Number(offset.value); commit(); }; stop.append(offset); fields.append(stop);
          }
        }
      };
      mode.onchange = () => { brush = mode.value === "linear" ? { kind: "linear", angle: 90, stops: [{ color: "#7851C9FF", offset: 0 }, { color: "#4D2A91FF", offset: 100 }] } : { kind: "solid", color: brush.kind === "solid" ? brush.color : brush.stops[0].color }; renderFields(); if (brush.kind === "solid") writeAttribute(node, key, brush.color); else writeAttribute(node, key, formatLinearGradient(brush.angle, brush.stops[0].color, brush.stops[0].offset, brush.stops[1].color, brush.stops[1].offset)); };
      editor.append(mode, fields); renderFields();
    }
    label.append(editor); host.append(label);
    if (explicit !== undefined) { const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "重置"; reset.onclick = () => resetAttribute(node, key); label.append(reset); }
    return;
  } else if (key === "TextStrokeWidth") {
    const box = document.createElement("span"); box.className = "size-editor";
    const field = document.createElement("input"); field.type = "number"; field.min = "0"; field.step = "0.25"; field.value = value;
    field.onchange = () => { if (!field.checkValidity() || !Number.isFinite(field.valueAsNumber)) { field.reportValidity(); return; } writeAttribute(node, key, field.value); };
    const unit = document.createElement("span"); unit.textContent = "px"; box.append(field, unit); label.append(box); host.append(label); return;
  } else if (definition?.kind === "enum") {
    const select = document.createElement("select");
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "未设置"; select.append(empty);
    for (const optionValue of (custom ? definition.options : enumOptions(key)) ?? []) { const option = document.createElement("option"); option.value = optionValue; option.textContent = optionValue; option.selected = optionValue === value; select.append(option); }
    select.value = value; select.onchange = () => writeAttribute(node, key, select.value); input = select;
  } else if (definition?.kind === "thickness") {
    const grid = document.createElement("div"); grid.className = "thickness-editor";
    const parts = thicknessParts(value); const names = ["左", "上", "右", "下"];
    const uniform = document.createElement("button"); uniform.type = "button"; uniform.textContent = "四边相同"; uniform.title = "将四边距统一为左侧数值"; uniform.onclick = () => writeAttribute(node, key, parts[0]!); grid.append(uniform);
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
  label.append(input);
  if (explicit !== undefined) { const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "重置"; reset.title = `删除源码属性并恢复${value}默认值`; reset.onclick = () => resetAttribute(node, key); label.append(reset); }
  host.append(label);
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

function isDocumentRoot(node: SerializableNode): boolean { return allRoots().some((root) => root.start === node.start && root.source === node.source); }

function tagChoices(node: SerializableNode): string[] {
  if (isDocumentRoot(node)) return ["页面", "控件"];
  const imported = model?.root ? Object.entries(model.root.attrs).filter(([name]) => directoryAlias(name)).flatMap(([name]) => {
    const alias = directoryAlias(name)?.alias ?? ""; const directory = model?.root?.attrs[name] ?? ""; return Object.keys(catalog[directory] ?? {}).map((component) => `${alias}:${component}`);
  }) : [];
  return [...BUILTIN_TAGS.filter((tag) => !["lui:Page", "lui:Component", "页面", "控件", "组件"].includes(tag)), ...imported];
}

/** Imported components publish exactly the props they consume. */
function componentPublicProperties(node: SerializableNode): string[] {
  const component = componentTemplate(node);
  if (!component) return [];
  if (component.template.properties) return Object.keys(component.template.properties);
  const fields = new Set<string>();
  const visit = (current: SerializableNode) => {
    for (const value of Object.values(current.attrs)) {
      const path = parseBinding(value)?.path;
      const match = /^props\.([A-Za-z][A-Za-z0-9_-]*)$/.exec(path ?? "");
      if (match) fields.add(match[1]!);
    }
    for (const child of current.children) visit(child);
  };
  visit(component.template);
  return [...fields];
}

function attributesFor(node: SerializableNode): string[] {
  const tag = canonicalTag(node.tag);
  if (tag === "__placeholder__") return [];
  const identity = isDocumentRoot(node) || sourceValue(node, "x:Name") !== undefined ? ["x:Name"] : [];
  if (sourceValue(node, "x:DisplayName") !== undefined) identity.push("x:DisplayName");
  const control = controlDefinition(tag);
  const attributes = [...capabilityAttributes(tag ?? "", isDocumentRoot(node)), ...(control?.events ?? [])];
  if (control?.bindable) attributes.push(control.bindable);
  return [...new Set([...identity, ...attributes, ...componentPublicProperties(node)])];
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

function layoutKey(source: string, path: readonly number[], instancePath = ""): string { return `${source}|${path.join(".")}|${instancePath}`; }

function layoutResult(host: HTMLElement, node: SerializableNode): void {
  if(previewBackend==='engine'){
    const section=collapsibleSection('真实引擎布局结果');
    const info=document.createElement('pre');info.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px';
    info.textContent=enginePickProbe?.sourcePath===node.source&&enginePickProbe.nodePath===node.nodePath.join('.')
      ?JSON.stringify(enginePickProbe.probe,null,2):'在真实预览中点选节点，读取 Runtime 的几何、字体与画刷结果。';
    section.append(info);host.append(section);return;
  }
  const prefix = `${node.source}|${node.nodePath.join(".")}|`;
  const result = layouts.get(layoutKey(node.source, node.nodePath, selected?.instancePath)) ?? [...layouts].find(([key]) => key.startsWith(prefix))?.[1];
  const section = document.createElement("section"); section.className = "layout-result";
  section.addEventListener("selectstart", event => event.preventDefault());
  const heading = document.createElement("h3"); heading.textContent = "布局结果"; section.append(heading);
  if (!result) { const note = document.createElement("p"); note.className = "property-note"; note.textContent = "等待预览完成布局计算。"; section.append(note); host.append(section); return; }
  const measure = (value: number) => `${Math.round(value * 10) / 10}`;
  const edgeLabel = (name: string, edges: BoxEdges, className: string, inner?: HTMLElement): HTMLElement => {
    const layer = document.createElement("div"); layer.className = `box-model-layer ${className}`;
    const caption = document.createElement("span"); caption.className = "box-model-caption"; caption.textContent = name; layer.append(caption);
    for (const [side, value] of Object.entries(edges)) {
      const sideValue = document.createElement("span"); sideValue.className = `box-model-edge box-model-edge-${side}`; sideValue.textContent = measure(value); layer.append(sideValue);
    }
    if (inner) layer.append(inner);
    return layer;
  };
  const content = document.createElement("div"); content.className = "box-model-content"; content.textContent = `内容区域\n${measure(result.contentWidth)} × ${measure(result.contentHeight)}`;
  const padding = edgeLabel("内边距", result.padding, "box-model-padding", content);
  const boundary = document.createElement("div"); boundary.className = "box-model-layer box-model-boundary";
  const boundaryCaption = document.createElement("span"); boundaryCaption.className = "box-model-caption"; boundaryCaption.textContent = "控件边界";
  boundary.append(boundaryCaption, padding);
  const margin = edgeLabel("外边距", result.margin, "box-model-margin", boundary);
  const position = document.createElement("div"); position.className = "box-model-position";
  const positionLabel = document.createElement("span"); positionLabel.className = "box-model-caption"; positionLabel.textContent = "位置";
  const coordinate = document.createElement("span"); coordinate.className = "box-model-coordinate"; coordinate.textContent = `${measure(result.x)}, ${measure(result.y)}`;
  position.append(positionLabel, coordinate, margin); section.append(position);
  const note = document.createElement("p"); note.className = "layout-self-note";
  const clipped = sourceValue(node, "裁剪超出") || (canonicalTag(node.tag ?? "") === "lui:Page" ? "是" : "否");
  note.textContent = `自身尺寸：${measure(result.width)} × ${measure(result.height)}　裁剪超出：${clipped}`;
  section.append(note);
  host.append(section);
}

let propertyQuery='';
function properties(node: SerializableNode | undefined): void {
  const previousHost=byId('properties'),focused=document.activeElement as HTMLInputElement|null;
  const focusedKey=focused?.closest<HTMLElement>('[data-property]')?.dataset.property;
  const focusedIndex=focusedKey?Array.from(focused!.closest('[data-property]')!.querySelectorAll('input,select')).indexOf(focused!):-1;
  const previousScroll=previousHost.scrollTop;
  const cursor=focused?.type==='text'?[focused.selectionStart,focused.selectionEnd]:null;
  const host = byId("properties"); host.innerHTML = "<h2>当前节点属性</h2>";
  if (!node) { const paragraph = document.createElement("p"); paragraph.textContent = "在组件树、画布或源码中选择一个节点。"; host.append(paragraph); return; }
  const tagLabel = document.createElement("label"); tagLabel.textContent = "标签类型";
  const category = document.createElement("select");
  const filter = document.createElement("input"); filter.type = "search"; filter.placeholder = "搜索中文名称、内部类型或目录组件";
  const select = document.createElement("select"); const rawTag = node.tag ?? "";
  const tagCategory = (tag: string): string => {
    if (tag.includes(":")) return `目录:${tag.split(":", 1)[0]}`;
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
  const choices = tagChoices(node);
  const categoryLabel = (value: string): string => value.startsWith("目录:") ? value.slice(3) : value;
  const refreshCategories = () => {
    const current = category.value;
    const visible = ["全部", ...[...new Set(choices.map(tagCategory))]];
    category.innerHTML = "";
    for (const value of visible) { const option = document.createElement("option"); option.value = value; option.textContent = categoryLabel(value); category.append(option); }
    category.value = visible.includes(current) ? current : "全部";
  };
  const fillTags = () => {
    const query = filter.value.trim().toLowerCase(); select.innerHTML = "";
    if (rawTag === "__placeholder__") { const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "请选择标签类型"; placeholder.selected = true; select.append(placeholder); }
    for (const tag of choices.filter((item) => (category.value === "全部" || tagCategory(item) === category.value) && tagSearchText(item).includes(query))) {
      const option = document.createElement("option"); option.value = tag; option.textContent = `${tag} · ${canonicalTag(tag) ?? tag}`; option.selected = tag === rawTag; select.append(option);
    }
  };
  refreshCategories(); fillTags(); filter.oninput = fillTags; category.onchange = fillTags;
  select.onchange = () => { if (select.value) editNode(node, "setTag", select.value); };
  tagLabel.append(category, filter, select); host.append(tagLabel);
  const search=document.createElement('input');search.type='search';search.placeholder='搜索属性中文名称 / 别名';search.value=propertyQuery;host.append(search);
  const applySearch=()=>{propertyQuery=search.value;for(const row of host.querySelectorAll<HTMLElement>('[data-search]'))row.hidden=!row.dataset.search?.includes(propertyQuery.trim().toLowerCase());};search.oninput=applySearch;
  const available = new Set(attributesFor(node));
  const declared = declaredProperties(node);
  if (declared) {
    const section = collapsibleSection('组件公开属性');
    for (const [key, definition] of Object.entries(declared)) {
      propertyInput(section, node, key);
      const meta = document.createElement('div'); meta.className = 'public-property-meta';
      const note = document.createElement('small'); note.textContent = `${definition.type}${definition.description ? ' · '+definition.description : ''}`; meta.append(note);
      const link = document.createElement('button'); link.textContent = '转到声明'; link.onclick = () => vscode.postMessage({ type: 'openProperty', source: componentTemplate(node)?.template.source, name: key }); meta.append(link); section.append(meta);
    }
    host.append(section);
  }
  const declarationError = node.propertiesError ?? componentTemplate(node)?.template.propertiesError;
  if (declarationError) { const warning = document.createElement('p'); warning.textContent = declarationError; host.append(warning); }
  for (const [title, keys] of CATEGORIES) {
    const valid = keys.filter((key) => available.has(key) && !declared?.[key]); if (!valid.length) continue;
    const section = collapsibleSection(title);
    for (const key of valid) propertyInput(section, node, key);
    host.append(section);
  }
  const illegal = Object.keys(node.attrs ?? {}).map(name => attributeKey(node, name)).filter((key) => !available.has(key) && key !== "x:Ref" && !key.startsWith("Preview.") && !directoryAlias(key));
  if (illegal.length) { const note = document.createElement("p"); note.className = "property-note"; note.textContent = `源代码保留 ${[...new Set(illegal)].map(sourceAttribute).join("、")}；这些属性不适用于当前标签，诊断中可定位并手动删除或迁移。`; host.append(note); }
  layoutResult(host, node);
  applySearch();host.scrollTop=previousScroll;
  if(focusedKey){const row=Array.from(host.querySelectorAll<HTMLElement>('[data-property]')).find(row=>row.dataset.property===focusedKey);const next=row?.querySelectorAll<HTMLInputElement>('input,select')[focusedIndex];if(next){next.focus({preventScroll:true});if(cursor&&next.type==='text')next.setSelectionRange(cursor[0],cursor[1]);}}
}

function applyHighlights(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-node-path][data-source]")) {
    const source = element.dataset.source ?? "";
    const candidate: PickedNode = { start: Number(element.dataset.start), end: Number(element.dataset.start), source, version: treeVersions.get(source) ?? 0, nodePath: (element.dataset.nodePath ?? "").split(".").filter(Boolean).map(Number), instancePath: element.dataset.instancePath };
    const definitionOnly = element.classList.contains("outline-row");
    element.classList.toggle("is-selected", definitionOnly ? definitionMatches(selected, candidate) : sameNode(selected, candidate));
    element.classList.toggle("is-hovered", definitionOnly ? definitionMatches(hovered, candidate) : sameNode(hovered, candidate));
  }
  updateSelectionOverlay();
}

function updateSelectionOverlay(): void {
  let layer = document.getElementById('selection-overlay');
  if (!layer) { layer = document.createElement('div'); layer.id = 'selection-overlay'; document.body.append(layer); }
  const stage = byId('stage').getBoundingClientRect();
  layer.style.cssText = `position:fixed;left:${stage.left}px;top:${stage.top}px;width:${stage.width}px;height:${stage.height}px;overflow:hidden;pointer-events:none;z-index:30`;
  layer.replaceChildren();
  for (const [className, color] of [['is-hovered','#bda7df'],['is-selected','#e7c46d']]) {
    const element = document.querySelector<HTMLElement>(`#canvas .${className}[data-node-path]`);
    if (!element) continue;
    const rect = element.getBoundingClientRect(); const box = document.createElement('div');
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    // Respect clipping ancestors, but never inherit the selected widget's own radius.
    for (let ancestor = element.parentElement; ancestor && ancestor.id !== 'stage'; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor); const bounds = ancestor.getBoundingClientRect();
      if (style.overflowX !== 'visible') { left = Math.max(left,bounds.left); right = Math.min(right,bounds.right); }
      if (style.overflowY !== 'visible') { top = Math.max(top,bounds.top); bottom = Math.min(bottom,bounds.bottom); }
    }
    if (right <= left || bottom <= top) continue;
    box.className = `selection-rectangle ${className}`;
    box.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid ${color};border-radius:0;left:${left-stage.left}px;top:${top-stage.top}px;width:${right-left}px;height:${bottom-top}px;pointer-events:none`;
    layer.append(box);
  }
}

function sourceDiagnostics(payload: SourcePayload): Diagnostic[] {
  return payload.diagnostics.map((issue) => ({ from: issue.range.start, to: issue.range.end, severity: issue.severity === "error" ? "error" : "warning", message: issue.message }));
}

function chooseSource(source: string): SourcePayload | undefined { return sources[source]; }

function sendSourceEdit(): void {
  if (!editor || !activeSource || inFlight) return;
  const payload = activeSource;
  const transaction = pendingSourceEdits[0];
  const nextText = transaction?.text ?? editor.state.doc.toString();
  if (transaction && nextText === payload.text) {
    pendingSourceEdits.shift();
    sourceDirty = pendingSourceEdits.length > 0 || editor.state.doc.toString() !== payload.text;
    pumpDocumentWork(); return;
  }
  if (transaction) {
    // Rebase only actual external changes; acknowledgements never rewrite the editor.
    const changes = rebaseSourceChanges(transaction.baseText, payload.text, transaction.changes);
    if (!changes) { sourceEditError = "外部修改与待提交操作重叠；当前草稿保留，请核对后继续编辑。"; return; }
    transaction.baseText = payload.text;
    transaction.changes = changes;
    transaction.text = applySourceChanges(payload.text, changes);
  }
  const targetText = transaction?.text ?? nextText;
  if (targetText === payload.text) { if (transaction) pendingSourceEdits.shift(); sourceDirty = pendingSourceEdits.length > 0; pumpDocumentWork(); return; }
  const patch = sourcePatch(payload.text, targetText);
  if (!patch) return;
  const id = nextSourceEditId++;
  sourceDirty = false;
  inFlight = { id, source: payload.source, version: payload.version, baseText: payload.text, text: targetText };
  inFlightTimer = setTimeout(() => {
    if (inFlight?.id !== id) return;
    inFlight = undefined;
    sourceDirty = true;
    sourceEditError = "源码写入超时，已解除锁定；继续输入或修改属性即可重试。";
    draw();
  }, 5000);
  vscode.postMessage({ type: "sourceEdit", requestId: id, source: payload.source, version: payload.version, baseText: payload.text, changes: transaction?.changes ?? [patch], origin: transaction?.origin ?? "rebase", patch });
}

function scheduleSourceEdit(): void {
  sourceDirty = true;
  // Microtask allows CodeMirror to finish its transaction, not a stop-typing debounce.
  queueMicrotask(pumpDocumentWork);
}

function requestSave(): boolean {
  if (!activeSource) return true;
  saveRequested = true;
  sourceEditError = "";
  if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = undefined; }
  pumpDocumentWork();
  return true;
}

/** Parse and paint the current draft inside the webview, without waiting for
 * the VS Code WorkspaceEdit round trip or a full component-catalog refresh. */
function scheduleOptimisticPreview(): void {
  if (previewFrame !== undefined) cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(() => {
    previewFrame = undefined;
    if (!editor || !activeSource || activeSource.source !== rootSource) return;
    const draft = editor.state.doc.toString();
    const parsed = parseLui(draft);
    if (!parsed.root) return;
    const root = serializeDraftNode(parsed.root, activeSource.source);
    // Declaration metadata belongs to the companion file, not the markup AST.
    if (model?.root?.source === root.source) {
      root.properties = model.root.properties; root.propertiesError = model.root.propertiesError; root.codeSource = model.root.codeSource;
    }
    model = { root, diagnostics: parsed.diagnostics };
    treeVersions.set(activeSource.source, activeSource.version);
    treeTexts.set(activeSource.source, draft);
    if (selected?.source === activeSource.source) {
      const latest = nodeAtPath(root, selected.nodePath);
      selected = latest?.kind === "element" ? nodeRef(latest, selected.instancePath) : undefined;
    }
    draw(false);
  });
}

function sourceCompletions(context: CompletionContext) {
  const source = context.state.doc.toString();
  const candidates = provideLuiCompletions({ source, position: context.pos, imports: completionImports, properties: model?.root?.properties, actions: actionSymbols[activeSource?.source ?? rootSource] ?? [] });
  if (!candidates.length) return null;
  const type = (kind: string): Completion["type"] => kind === "tag" ? "class" : kind === "attribute" ? "property" : kind === "value" ? "enum" : "keyword";
  const rank = (group: string) => ["根节点", "当前标签", "布局", "内容与数据", "交互", "绑定路径", "内置命令"].indexOf(group) + 1;
  return {
    from: candidates[0]!.from,
    to: candidates[0]!.to,
    filter: false,
    options: candidates.map((candidate) => ({ label: candidate.label, type: type(candidate.kind), apply: candidate.insertText, detail: candidate.detail, info: candidate.documentation, section: { name: candidate.group, rank: rank(candidate.group) < 1 ? 99 : rank(candidate.group) } }))
  };
}

function sourceExtensions(): Extension[] {
  const copySelection = (view: EditorView): boolean => {
    const values = view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to)).filter(Boolean);
    if (values.length) vscode.postMessage({ type: "copy", text: values.join("\n") });
    return true;
  };
  return [
    lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history({ newGroupDelay: 500 }), indentUnit.of("  "), xml(), syntaxHighlighting(defaultHighlightStyle), closeBrackets(), bracketMatching(), search({ top: true }), highlightSelectionMatches(),
    EditorState.transactionExtender.of(tr => {
      const event = tr.annotation(Transaction.userEvent) ?? "";
      let newline = false;
      tr.changes.iterChanges((_a, _b, _c, _d, inserted) => { if (inserted.lines > 1) newline = true; });
      if (!writingSource && ((tr.selection && !tr.docChanged) || newline || /paste|complete|drop/.test(event))) return { annotations: isolateHistory.of("full") };
      return null;
    }),
    keymap.of([{ key: "Mod-s", preventDefault: true, run: requestSave }, { key: "Mod-c", run: copySelection }, { key: "Mod-Alt-ArrowUp", run: copyLineUp }, { key: "Mod-Alt-ArrowDown", run: copyLineDown }, { key: "Alt-ArrowUp", run: moveLineUp }, { key: "Alt-ArrowDown", run: moveLineDown }, { key: "Mod-/", run: toggleComment }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
    // Completion is available while typing, but moving the caret by click must
    // close the previous list.  Otherwise CodeMirror can retain its old anchor
    // and make a suggestion list appear far away from the newly clicked token.
    autocompletion({ override: [sourceCompletions], activateOnTyping: true, closeOnBlur: true }),
    linter(() => activeSource ? sourceDiagnostics(activeSource) : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !writingSource) {
        for (const tr of update.transactions) {
          if (!tr.docChanged) continue;
          const changes: SourcePatch[] = [];
          tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => changes.push({ from, to, insert: inserted.toString() }));
          pendingSourceEdits.push({ baseText: tr.startState.doc.toString(), text: tr.newDoc.toString(), changes, origin: tr.annotation(Transaction.userEvent) ?? "input" });
        }
        scheduleOptimisticPreview();
        scheduleSourceEdit();
      }
      if (update.selectionSet && !update.docChanged && !writingSource) closeCompletion(update.view);
      if (update.selectionSet && !writingSource && activeSource) {
        const node = treeTexts.get(activeSource.source) === editor?.state.doc.toString() ? getNodeContaining(update.state.selection.main.head, activeSource.source) : undefined;
        if (node) { selected = nodeRef(node); properties(node); applyHighlights(); }
      }
    }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "13px", backgroundColor: "#10091c", color: "#f4ecff" },
      ".cm-scroller": { overflow: "auto", fontFamily: "Consolas, 'Cascadia Code', 'Microsoft YaHei Mono', monospace" },
      ".cm-gutters": { backgroundColor: "#170f27", color: "#a895c6", borderRight: "1px solid #4c3568" },
      ".cm-activeLine": { backgroundColor: "#2a194466" }, ".cm-activeLineGutter": { backgroundColor: "#2a1944" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#8b5cf6aa" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffe16b" }, ".cm-content": { caretColor: "#ffe16b" }, ".cm-matchingBracket": { backgroundColor: "#d5b56d44", outline: "1px solid #ffe16b" },
      ".cm-tooltip-autocomplete": { backgroundColor: "#1a102a", color: "#f4ecff", border: "1px solid #7855aa", borderRadius: "6px", boxShadow: "0 10px 28px #000a", maxHeight: "260px" },
      ".cm-tooltip-autocomplete > ul": { fontFamily: "Consolas, 'Microsoft YaHei Mono', monospace" },
      ".cm-tooltip-autocomplete > ul > li": { color: "#f4ecff" }, ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#51367c", color: "#fff" }
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
  if (activeSource?.source === source && editor && sourceHasUncommittedDraft(source)) {
    if (selection) setEditorSelection(selection);
    return;
  }
  activeSource = payload;
  sourceDirty = false;
  if (!editor) {
    editor = new EditorView({ state: EditorState.create({ doc: payload.text, extensions: sourceExtensions() }), parent: byId("source-editor") });
  } else if (editor.state.doc.toString() !== payload.text) {
    writingSource = true;
    const patch = sourcePatch(editor.state.doc.toString(), payload.text);
    if (patch) editor.dispatch({ changes: patch, annotations: Transaction.addToHistory.of(false) });
    writingSource = false;
  }
  editor.dispatch(setDiagnostics(editor.state, sourceDiagnostics(payload)));
  if (selection) setEditorSelection(selection);
}

/** Apply an external host revision without treating model traffic as an edit acknowledgement. */
function reconcileSource(payload: SourcePayload, propertyEdit = !!designerEditInFlight): void {
  const known = sources[payload.source];
  if (known && payload.version < known.version) return;
  sources[payload.source] = payload;
  if (!activeSource || activeSource.source !== payload.source || !editor) return;
  if (payload.version < activeSource.version) return;
  if (inFlight) {
    if (!deferredSource || payload.version >= deferredSource.version) deferredSource = payload;
    return;
  }
  const current = editor.state.doc.toString();
  let merged = payload.text;
  const local = sourcePatch(activeSource.text, current);
  if (local && current !== payload.text) {
    const rebased = rebaseSourcePatch(activeSource.text, payload.text, local);
    if (!rebased) { sourceEditError = "外部修改与当前输入重叠；草稿已保留，请核对后继续编辑。"; return; }
    merged = payload.text.slice(0, rebased.from) + rebased.insert + payload.text.slice(rebased.to);
  }
  activeSource = payload;
  const patch = sourcePatch(current, merged);
  writingSource = true;
  try {
    if (patch) editor.dispatch({ changes: patch, annotations: propertyEdit
      ? [Transaction.addToHistory.of(true), isolateHistory.of("full")]
      : Transaction.addToHistory.of(false) });
    editor.dispatch(setDiagnostics(editor.state, sourceDiagnostics(payload)));
  } finally { writingSource = false; }
  sourceDirty = merged !== payload.text;
  sourceEditError = "";
  scheduleOptimisticPreview();
}

function applySourceEditResult(payload: SourceEditResultPayload): void {
  if (!inFlight || payload.requestId !== inFlight.id) return;
  const completed = inFlight;
  inFlight = undefined;
  if (inFlightTimer) { clearTimeout(inFlightTimer); inFlightTimer = undefined; }
  const known = sources[payload.source.source];
  if (!known || payload.source.version >= known.version) sources[payload.source.source] = payload.source;
  if (activeSource?.source === payload.source.source && editor) {
    if (payload.source.version >= activeSource.version) activeSource = payload.source;
    editor.dispatch(setDiagnostics(editor.state, sourceDiagnostics(payload.source)));
    const currentText = editor.state.doc.toString();
    if (payload.success) {
      pendingSourceEdits.shift();
      sourceEditError = "";
      if (treeTexts.get(payload.source.source) === payload.source.text) {
        treeVersions.set(payload.source.source, payload.source.version);
        if (selected?.source === payload.source.source) selected.version = payload.source.version;
      }
      if (pendingSourceEdits.length || currentText !== payload.source.text || sourceDirty || currentText !== completed.text) sourceDirty = true;
      else sourceDirty = false;
    } else {
      sourceDirty = currentText !== payload.source.text;
      sourceEditError = payload.message || "源码写入失败；当前草稿已保留。";
    }
  }
  const pending = deferredSource; deferredSource = undefined;
  if (pending) reconcileSource(pending);
  draw();
  if (payload.success) pumpDocumentWork();
}

function collectLayoutData(): void {
  layouts.clear();
  const canvas = byId("canvas"); const canvasRect = canvas.getBoundingClientRect();
  for (const element of canvas.querySelectorAll<HTMLElement>("[data-node-path][data-source]")) {
    if (element.classList.contains("scroll")) element.classList.toggle("scrollbar-empty-y", element.scrollHeight <= element.clientHeight);
    const start = Number(element.dataset.start); const source = element.dataset.source ?? "";
    if (!Number.isFinite(start) || !source) continue;
    const rect = element.getBoundingClientRect(); const parent = element.parentElement?.getBoundingClientRect() ?? canvasRect; const style = getComputedStyle(element);
    const page = element.closest<HTMLElement>(".page-root"); const design = page?.querySelector<HTMLElement>(":scope > .lui-page-design");
    const isPageRoot = element === page; const pageScale = page ? Number(page.dataset.pageScale) || 1 : 1;
    const logicalScale = canvasZoom * (isPageRoot ? 1 : pageScale); const logicalOrigin = isPageRoot || !design ? canvasRect : design.getBoundingClientRect();
    const pixel = (value: string) => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0;
    const margin = { left: pixel(style.marginLeft), top: pixel(style.marginTop), right: pixel(style.marginRight), bottom: pixel(style.marginBottom) };
    const border = { left: pixel(style.borderLeftWidth), top: pixel(style.borderTopWidth), right: pixel(style.borderRightWidth), bottom: pixel(style.borderBottomWidth) };
    const padding = { left: pixel(style.paddingLeft), top: pixel(style.paddingTop), right: pixel(style.paddingRight), bottom: pixel(style.paddingBottom) };
    const width = element.offsetWidth; const height = element.offsetHeight;
    const borderWidth = Math.max(border.left, border.top, border.right, border.bottom);
    const borderAlign = element.dataset.luiBorderAlign ?? layoutContract.renderFidelity.borderAlign;
    const borderInset = borderAlign === "inside" ? borderWidth / 2 : borderAlign === "outside" ? -borderWidth / 2 : 0;
    const numericWeight = Number(style.fontWeight);
    const resolvedFontWeight = style.fontWeight === "bold" || (Number.isFinite(numericWeight) && numericWeight >= 600) ? "bold" : "normal";
    const path = (element.dataset.nodePath ?? "").split(".").filter(Boolean).map(Number);
    layouts.set(layoutKey(source, path, element.dataset.instancePath), {
      x: Math.round((rect.left - logicalOrigin.left) / logicalScale * 10) / 10, y: Math.round((rect.top - logicalOrigin.top) / logicalScale * 10) / 10,
      width, height,
      parentX: Math.round((parent.left - canvasRect.left) / canvasZoom * 10) / 10, parentY: Math.round((parent.top - canvasRect.top) / canvasZoom * 10) / 10,
      contentWidth: Math.max(0, Math.round((width - padding.left - padding.right - border.left - border.right) * 10) / 10), contentHeight: Math.max(0, Math.round((height - padding.top - padding.bottom - border.top - border.bottom) * 10) / 10),
      availableWidth: Math.round(parent.width * 10) / 10, availableHeight: Math.round(parent.height * 10) / 10,
      desiredWidth: Math.round(element.scrollWidth * 10) / 10, desiredHeight: Math.round(element.scrollHeight * 10) / 10,
      margin, border, padding,
      borderAlign,
      borderRect: { x: borderInset, y: borderInset, width: Math.max(0, width - borderInset * 2), height: Math.max(0, height - borderInset * 2) },
      colorSpace: element.dataset.luiColorSpace ?? layoutContract.renderFidelity.colorSpace,
      alphaMode: element.dataset.luiAlphaMode ?? layoutContract.renderFidelity.alphaMode,
      gradientInterpolation: element.dataset.luiGradientInterpolation ?? layoutContract.renderFidelity.gradientInterpolation,
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, resolvedFontWeight,
      lineHeight: style.lineHeight, fontSynthesis: style.fontSynthesis,
      textRasterMode: element.dataset.luiTextRaster ?? "none",
      shadowSource: layoutContract.renderFidelity.shadowSource, boxShadow: style.boxShadow
    });
  }
}

function draw(refreshChrome = true): void {
  const canvas = byId("canvas"); const tree = byId("outline");
  if(previewBackend==='schematic'||canvas.dataset.previewBackend!==previewBackend)canvas.innerHTML='';
  if (refreshChrome) tree.innerHTML = "";
  if (!model?.root) return;
  const isPage = canonicalTag(model.root.tag) === "lui:Page";
  canvas.classList.toggle("control-preview", !isPage);
  byId("device-label").hidden = !isPage;
  const [width, height] = byId<HTMLSelectElement>("device").value.split("x");
  canvas.style.width = isPage ? `${width}px` : "max-content";
  canvas.style.height = isPage ? `${height}px` : "auto";
  canvas.style.minHeight = isPage ? `${height}px` : "0";
  if (refreshChrome) outline(model.root, tree);
  canvas.dataset.previewBackend = previewBackend;
  if(previewBackend==='schematic')canvas.append(renderNode(model.root));
  else{
    canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    let status=canvas.querySelector<HTMLDivElement>('.engine-status');
    if(!status){status=document.createElement('div');status.className='engine-status';canvas.append(status);}
    status.textContent=engineError?`真实预览未就绪：${engineError}`:'真实引擎预览；内嵌隔离不可用时请在独立窗口打开。';
    if(engineUrl){
      const open=document.createElement('button');open.textContent='打开隔离预览窗口';open.onclick=()=>vscode.postMessage({type:'openEngine'});status.append(open);
      let frame=canvas.querySelector('iframe');if(!frame){frame=document.createElement('iframe');frame.allow='cross-origin-isolated';frame.style.cssText='width:100%;height:calc(100% - 60px);border:0';canvas.append(frame);}
      if(frame.src!==engineUrl)frame.src=engineUrl;
    }
  }
  if (!(model.diagnostics ?? []).some(issue => issue.severity === 'error')) {
    try { vscode.postMessage({ type:'engineSnapshot', snapshot:{revision:++engineRevision,width:Number(width)||390,height:Number(height)||844,node:engineNodes(model.root,previewScope)[0]} }); }
    catch(error) { designerEditError=String(error); }
  }
  if (!isPage&&previewBackend==='schematic') measureControlPreview(canvas);
  if (refreshChrome) properties(resolvePicked(selected));
  const diagnostics = byId("diagnostics"); diagnostics.innerHTML = "";
  for (const issue of model.diagnostics ?? []) { const item = document.createElement("p"); item.textContent = `⚠ ${issue.message}`; diagnostics.append(item); }
  if (sourceEditError) { const item = document.createElement("p"); item.textContent = `⚠ 源码同步未完成：${sourceEditError}`; diagnostics.append(item); }
  if (designerEditError) { const item = document.createElement("p"); item.textContent = `⚠ 属性修改未完成：${designerEditError}`; diagnostics.append(item); }
  applyHighlights();
  requestAnimationFrame(() => { if(previewBackend==='schematic')collectLayoutData();else layouts.clear(); if (refreshChrome) properties(resolvePicked(selected)); updateArtboard(); });
}

function clampZoom(value: number): number { return Math.max(.05, Math.min(64, value)); }

/** Intrinsic pass: percentages have no parent size yet. Freeze the measured
 * root, then restore percentages against that size (never the device viewport). */
function measureControlPreview(canvas: HTMLElement): void {
  const root = canvas.firstElementChild as HTMLElement | null;
  if (!root) return;
  const restored: Array<() => void> = [];
  for (const node of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const property of ["width", "height"] as const) {
      const value = node.style[property];
      if (value.endsWith("%")) { node.style[property] = "auto"; restored.push(() => { node.style[property] = value; }); }
    }
    if (node.style.flexBasis === "0px" || node.style.flexBasis === "0%" || node.style.flexBasis === "0") {
      const basis = node.style.flexBasis; node.style.flexBasis = "auto";
      restored.push(() => { node.style.flexBasis = basis; });
    }
  }
  const width = root.offsetWidth; const height = root.offsetHeight;
  restored.forEach((restore) => restore());
  root.style.width = `${width}px`; root.style.height = `${height}px`;
  const style = getComputedStyle(root);
  const number = (value: string) => Number.parseFloat(value) || 0;
  canvas.style.width = `${Math.max(1, width + number(style.marginLeft) + number(style.marginRight))}px`;
  canvas.style.height = `${Math.max(1, height + number(style.marginTop) + number(style.marginBottom))}px`;
}

function updateArtboard(): void {
  const canvas = byId("canvas"); const artboard = byId("artboard"); const stage = byId("stage"); const content = byId("stage-content");
  const width = canvas.offsetWidth || 1; const height = canvas.offsetHeight || 1;
  const scaledWidth = Math.max(1, width * canvasZoom); const scaledHeight = Math.max(1, height * canvasZoom);
  const viewportWidth = Math.max(1, stage.clientWidth - 48); const viewportHeight = Math.max(1, stage.clientHeight - 48);
  content.style.width = `${Math.max(viewportWidth, scaledWidth)}px`; content.style.height = `${Math.max(viewportHeight, scaledHeight)}px`;
  artboard.style.width = `${scaledWidth}px`; artboard.style.height = `${scaledHeight}px`;
  artboard.style.marginLeft = `${Math.max(0, (viewportWidth - scaledWidth) / 2)}px`;
  artboard.style.marginTop = `${Math.max(0, (viewportHeight - scaledHeight) / 2)}px`;
  canvas.style.transform = `scale(${canvasZoom})`; byId("zoom-value").textContent = `${Math.round(canvasZoom * 100)}%`;
  requestAnimationFrame(updateSelectionOverlay);
}
function fitArtboardToStage(): void {
  const stage = byId("stage"); const canvas = byId("canvas"); const width = canvas.offsetWidth || 390; const height = canvas.offsetHeight || 844;
  canvasZoom = clampZoom(Math.min((stage.clientWidth - 48) / width, (stage.clientHeight - 48) / height));
  updateArtboard();
}
/** Fit is an explicit viewing command.  Workbench resizes never alter the user's zoom. */
function fitArtboard(): void { fitArtboardToStage(); }

function zoomAt(clientX: number, clientY: number, nextZoom: number): void {
  const stage = byId("stage"); const canvas = byId("canvas"); const before = canvas.getBoundingClientRect();
  const anchorX = (clientX - before.left) / canvasZoom; const anchorY = (clientY - before.top) / canvasZoom;
  canvasZoom = clampZoom(nextZoom); updateArtboard();
  const after = canvas.getBoundingClientRect();
  stage.scrollLeft += after.left + anchorX * canvasZoom - clientX;
  stage.scrollTop += after.top + anchorY * canvasZoom - clientY;
}

function pick(node: SerializableNode, instancePath?: string): void {
  selected = nodeRef(node, instancePath);
  if(previewBackend==='engine'){properties(node);applyHighlights();}else draw();
  // The embedded editor remains bound to its document.  A user may explicitly
  // locate a root-document node, but selecting an imported implementation never
  // switches the source editor or opens a native editor group.
  if (activeSource?.source === selected.source) setEditorSelection(selected);
}

function applyModel(payload: ModelPayload): void {
  if (payload.generation <= lastModelGeneration) return;
  lastModelGeneration = payload.generation;
  const fontGeneration = payload.generation;
  document.body.dataset.luiFontsReady = "false";
  let fontStyles = document.getElementById("lui-project-fonts") as HTMLStyleElement | null;
  if (!fontStyles) { fontStyles = document.createElement("style"); fontStyles.id = "lui-project-fonts"; document.head.append(fontStyles); }
  fontStyles.textContent = (payload.fonts ?? []).map((font) => `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(font.uri)}) format("truetype");font-weight:${font.weight};font-style:normal;font-display:block}`).join("\n");
  const rootIncoming = payload.sources?.[payload.rootSource];
  const preserveDraft = !!editor && activeSource?.source === payload.rootSource && !!rootIncoming && editor.state.doc.toString() !== rootIncoming.text;
  const draftRoot = preserveDraft ? model?.root : undefined;
  const draftDiagnostics = preserveDraft ? model?.diagnostics : undefined;
  model = preserveDraft ? { root: draftRoot, diagnostics: draftDiagnostics ?? [] } : payload.model;
  catalog = payload.catalog ?? {}; completionImports = payload.completionImports ?? []; actionSymbols = payload.actionSymbols ?? {}; rootSource = payload.rootSource;
  if (!preserveDraft) { treeVersions.clear(); treeTexts.clear(); }
  for (const [source, incoming] of Object.entries(payload.sources ?? {})) {
    if (!(preserveDraft && source === payload.rootSource)) {
      treeVersions.set(source, incoming.version);
      treeTexts.set(source, incoming.text);
    }
    const known = sources[source];
    if (!known || incoming.version >= known.version) sources[source] = incoming;
  }
  if (selected) {
    const latestVersion = treeVersions.get(selected.source);
    const latestNode = nodeAtPath(rootForSource(selected.source), selected.nodePath);
    selected = latestVersion !== undefined && latestNode?.kind === "element" ? { ...nodeRef(latestNode, selected.instancePath), version: latestVersion } : undefined;
  }
  byId<HTMLSelectElement>("device").value = payload.device;
  if (!activeSource || !sources[activeSource.source]) activateSource(rootSource);
  else {
    const incoming = payload.sources[activeSource.source];
    if (incoming) reconcileSource(incoming);
  }
  draw();
  // Every new document starts at 100%. Subsequent layout,
  // splitter and preview updates must never override the user's chosen zoom.
  if (initialFitSource !== rootSource) {
    initialFitSource = rootSource;
    canvasZoom = 1; requestAnimationFrame(() => { updateArtboard(); updateSelectionOverlay(); });
  }
  void document.fonts.ready.then(() => {
    if (lastModelGeneration !== fontGeneration) return;
    document.body.dataset.luiFontsReady = "true";
    draw();
  });
  if (!designerEditInFlight) flushDesignerEdits();
}

let engineRevision=0;
let engineUrl='',engineError='正在准备官方引擎与字体';
let previewBackend='engine';
let previewScope:Record<string,unknown>={};
const scenePresets:Record<string,Record<string,unknown>>={
  '标记样例':{},'名称：收起':{view:{nameDisplayVisible:true,nameEditorVisible:false,nameErrorVisible:false}},
  '名称：编辑':{view:{nameDisplayVisible:false,nameEditorVisible:true,nameErrorVisible:false,playerNameDraft:'登塔者'}},
  '记录：空列表':{view:{empty:true,hasBest:false,noBest:true,entries:[]}},
  '塔内：战斗':{view:{battleVisible:true,organizeVisible:false,betweenVisible:false}},
  '塔内：层间':{view:{battleVisible:true,organizeVisible:false,betweenVisible:true}},
};
const sceneSelect=document.createElement('select');sceneSelect.title='场景数据预设（独立样例，不读取存档）';
for(const title of Object.keys(scenePresets)){const option=document.createElement('option');option.textContent=title;sceneSelect.append(option);}
sceneSelect.onchange=()=>{previewScope=scenePresets[sceneSelect.value];draw();};document.querySelector('main>header')?.prepend(sceneSelect);
const backend=document.createElement('select');backend.title='预览后端';
for(const [value,title]of [['engine','UrhoX 真实预览'],['schematic','结构示意（非实机验收）']]){const option=document.createElement('option');option.value=value;option.textContent=title;backend.append(option);}
backend.onchange=()=>{previewBackend=backend.value;draw();};document.querySelector('main>header')?.prepend(backend);
window.addEventListener('message',event=>{const message=event.data;if(message.type==='engineReady'){engineUrl=message.url??'';engineError=message.error??'';draw();}
  if(message.type==='enginePick'&&message.revision===engineRevision){
    const path=String(message.nodePath).split('.').filter(Boolean).map(Number);
    const node=nodeAtPath(rootForSource(message.sourcePath),path);
    if(node){enginePickProbe=message;pick(node);}
  }
});
/** Resolve only declarative sample data. No Lua backend is loaded or evaluated. */
function engineNodes(node: SerializableNode, scope: Record<string,unknown> = {}): unknown[] {
  return buildEngineSnapshot(node,scope,{
    tag:node=>canonicalTag(node.tag)??node.tag!,attrs:effective,
    children:visualChildren,component:node=>componentTemplate(node)?.template,
  });
}

function applyReload(payload: SourceReloadPayload): void {
  reconcileSource(payload.source);
}

function applyDesignerEditResult(payload: DesignerEditResultPayload): void {
  if (!designerEditInFlight || payload.requestId !== designerEditInFlight.id) return;
  designerEditInFlight = undefined;
  if (designerEditTimer) { clearTimeout(designerEditTimer); designerEditTimer = undefined; }
  if (!payload.success) {
    designerEditError = payload.message || "编辑器未能写入当前文档。";
    queuedDesignerEdits.length = 0;
    if (payload.source) reconcileSource(payload.source);
    draw();
    return;
  }
  designerEditError = "";
  if (payload.source) reconcileSource(payload.source, true);
  pumpDocumentWork();
}

function applySaveSourceResult(payload: SaveSourceResultPayload): void {
  if (!saveInFlight || payload.requestId !== saveInFlight.id) return;
  saveInFlight = undefined;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
  reconcileSource(payload.source);
  sourceEditError = payload.success ? "" : (payload.message || "保存失败；当前草稿仍已保留。");
  draw();
  // Saving is not an edit lock.  A genuine disk error leaves the draft and its
  // warning visible, but later property edits and a retry must remain usable.
  pumpDocumentWork();
}

function setupSplitter(): void {
  const splitter = byId("splitter");
  splitter.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
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
  const inspectorWidth = 288;
  const updateTracks = () => {
    const limit = Math.max(28, (workbench.clientWidth - 127) / 2);
    document.documentElement.style.setProperty("--outline-track", `${workbench.classList.contains("outline-collapsed") ? 28 : Math.min(lastWidth, limit)}px`);
    document.documentElement.style.setProperty("--inspector-track", `${byId("inspector").classList.contains("collapsed") ? 28 : Math.min(inspectorWidth, limit)}px`);
  };
  button.onclick = () => {
    const collapsed = workbench.classList.toggle("outline-collapsed");
    button.textContent = collapsed ? "›" : "‹"; button.title = collapsed ? "展开结构树" : "收起结构树";
    button.setAttribute("aria-expanded", String(!collapsed)); updateTracks();
  };
  byId("collapse").onclick = () => {
    const collapsed = byId("inspector").classList.toggle("collapsed");
    const toggle = byId("collapse"); toggle.textContent = collapsed ? "‹" : "收起";
    toggle.title = collapsed ? "展开属性面板" : "收起属性面板";
    toggle.setAttribute("aria-expanded", String(!collapsed)); updateTracks();
  };
  new ResizeObserver(updateTracks).observe(workbench);
  new ResizeObserver(() => { updateArtboard(); editor?.requestMeasure(); }).observe(byId("stage"));
  byId('stage').addEventListener('scroll', updateSelectionOverlay, true);
  updateTracks();
  divider.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault(); workbench.classList.remove("outline-collapsed"); button.textContent = "‹"; divider.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => { const bounds = workbench.getBoundingClientRect(); lastWidth = Math.max(168, Math.min(460, moveEvent.clientX - bounds.left)); updateTracks(); };
    const stop = (upEvent: PointerEvent) => { divider.releasePointerCapture(upEvent.pointerId); divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", stop); };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", stop);
  });
}

/** Panning is a view-only operation: device and control preview dimensions stay immutable. */
function setupArtboardViewport(): void {
  const stage = byId("stage");
  let spacePanHeld = false;
  let pan: { x: number; y: number; left: number; top: number; pointerId: number } | undefined;
  const ignoresKeyboardPan = () => !!document.activeElement?.closest("input, select, textarea, #source-editor");
  window.addEventListener("keydown", (event) => { if (event.code === "Space" && !ignoresKeyboardPan()) spacePanHeld = true; });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") spacePanHeld = false; });
  window.addEventListener("blur", () => { spacePanHeld = false; });
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 1 && !(event.button === 0 && spacePanHeld)) return;
    event.preventDefault();
    pan = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, pointerId: event.pointerId };
    stage.classList.add("is-panning"); stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    stage.scrollLeft = pan.left - (event.clientX - pan.x); stage.scrollTop = pan.top - (event.clientY - pan.y);
  });
  const stopPan = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    pan = undefined; stage.classList.remove("is-panning");
  };
  stage.addEventListener("pointerup", stopPan); stage.addEventListener("pointercancel", stopPan);
  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, canvasZoom * Math.exp(-event.deltaY * .0015));
  }, { passive: false });
}

window.addEventListener("message", (event: MessageEvent<ModelPayload | SourceReloadPayload | SourceEditResultPayload | DesignerEditResultPayload | SaveSourceResultPayload>) => {
  if (event.data.type === "model") applyModel(event.data);
  if (event.data.type === "source") applyReload(event.data);
  if (event.data.type === "sourceEditResult") applySourceEditResult(event.data);
  if (event.data.type === "designerEditResult") applyDesignerEditResult(event.data);
  if (event.data.type === "saveSourceResult") applySaveSourceResult(event.data);
});

byId<HTMLSelectElement>("device").onchange = () => draw();
byId<HTMLButtonElement>("deploy").onclick = () => vscode.postMessage({ type: "deploy" });
byId("canvas").addEventListener("click", pickVisualTarget);
byId<HTMLButtonElement>("fit").onclick = fitArtboard;
byId<HTMLButtonElement>("actual-size").onclick = () => { canvasZoom = 1; updateArtboard(); };
byId<HTMLButtonElement>("zoom-in").onclick = () => { canvasZoom = clampZoom(canvasZoom * 1.25); updateArtboard(); };
byId<HTMLButtonElement>("zoom-out").onclick = () => { canvasZoom = clampZoom(canvasZoom / 1.25); updateArtboard(); };
byId<HTMLButtonElement>("source-collapse").onclick = () => { document.body.classList.remove("source-maximized"); document.body.classList.toggle("source-collapsed"); };
byId<HTMLButtonElement>("source-maximize").onclick = () => { document.body.classList.remove("source-collapsed"); document.body.classList.toggle("source-maximized"); };
byId<HTMLSelectElement>("device").dispatchEvent(new Event("change"));
setupSplitter();
setupOutlineDivider();
setupArtboardViewport();
vscode.postMessage({ type: "ready" });
