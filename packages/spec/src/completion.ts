import {
  DEPRECATED_CANONICAL_TAGS,
  TAG_TO_CANONICAL,
  attributeDefinition,
  canonicalAttribute,
  canonicalTag,
  controlDefinition,
  enumOptions,
  sourceAttribute
} from "./vocabulary.js";
import { isLayoutProperty, type ComponentProperties } from './properties.js';

export type LuiCompletionKind = "tag" | "attribute" | "value" | "binding" | "action" | "command";

export interface LuiImportedComponent {
  name: string;
  properties?: readonly string[];
  definitions?: ComponentProperties;
}

export interface LuiCompletionImport {
  alias: string;
  directory: string;
  components: readonly LuiImportedComponent[];
}

export interface LuiCompletionContext {
  /** LUI source always uses LF offsets, even when the file is CRLF on disk. */
  source: string;
  position: number;
  imports?: readonly LuiCompletionImport[];
  /** Static symbols discovered from the paired .lui.lua file; never evaluated. */
  actions?: readonly string[];
  properties?: ComponentProperties;
}

export interface LuiCompletionCandidate {
  label: string;
  insertText: string;
  kind: LuiCompletionKind;
  group: string;
  detail: string;
  documentation: string;
  aliases: readonly string[];
  /** LF source range that the editor should replace. */
  from: number;
  to: number;
}

const GROUP_RANK = ["根节点", "当前标签", "布局", "内容与数据", "交互", "绑定路径", "内置命令"];
const collator = new Intl.Collator("zh-CN", { sensitivity: "base", numeric: true });
const BINDING_OPTIONS = ["模式", "更新源触发", "字符串格式", "预览内容"] as const;
const CONTROLLED_COMMANDS: Record<string, readonly string[]> = {
  "设值": ["路径", "值"], "可见性": ["路径", "值"], "页签": ["键", "值"], "导航": ["目标"], "关闭": ["目标"]
};

function builtinTags(): string[] {
  return [...new Set(Object.entries(TAG_TO_CANONICAL)
    .filter(([name, canonical]) => name !== "循环" && /[^\x00-\x7f]/.test(name) && !DEPRECATED_CANONICAL_TAGS.has(canonical))
    .map(([name]) => name))];
}

function tagGroup(tag: string): string {
  if (tag.includes(":")) return tag.slice(0, tag.indexOf(":"));
  const canonical = canonicalTag(tag) ?? tag;
  const definition = controlDefinition(canonical);
  if (definition?.category) return definition.category;
  if (["Grid", "Canvas", "Viewbox", "SafeArea", "Scroll"].includes(canonical)) return "布局";
  if (["Text", "Card", "Section", "Progress"].includes(canonical)) return "展示";
  if (["Button", "Toggle", "Slider"].includes(canonical)) return "输入";
  return "当前标签";
}

function tagDescription(tag: string): { detail: string; documentation: string; aliases: string[] } {
  if (tag.includes(":")) return { detail: "项目组件", documentation: `导入目录中的 <${tag}> 组件。`, aliases: [tag] };
  const canonical = canonicalTag(tag) ?? tag;
  const definition = controlDefinition(canonical);
  return {
    detail: definition?.ui ?? canonical,
    documentation: definition ? `${definition.name} · ${definition.ui}` : `内置 LUI 标签 <${tag}>。`,
    aliases: [tag, canonical, definition?.name ?? "", definition?.ui ?? ""].filter(Boolean)
  };
}

function indexOfCurrentTag(source: string, position: number): number {
  return source.lastIndexOf("<", Math.max(0, position - 1));
}

/** A tolerant stack for unfinished markup while the author is typing. */
function openTagsBefore(source: string, end: number): string[] {
  const stack: string[] = [];
  const tokens = /<!--[\s\S]*?-->|<\s*(\/?)\s*([^\s/>]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source.slice(0, end)))) {
    const raw = match[0]!;
    if (raw.startsWith("<!--")) continue;
    const tag = match[2]!;
    if (match[1]) { if (stack.length) stack.pop(); continue; }
    const terminator = source.indexOf(">", match.index + raw.length);
    const complete = terminator >= 0 && terminator < end;
    if (complete && source.slice(match.index, terminator + 1).endsWith("/>")) continue;
    stack.push(tag);
  }
  return stack;
}

function hasUnclosedComment(source: string, position: number): boolean {
  return source.lastIndexOf("<!--", position) > source.lastIndexOf("-->", position);
}

function sourceAttributes(fragment: string): Set<string> {
  const result = new Set<string>();
  const expression = /([^\s=/>]+)\s*=\s*(["'])[^]*?\2/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(fragment))) result.add(canonicalAttribute(match[1]!));
  return result;
}

export function availableAttributes(tagName: string | undefined, root: boolean, componentProperties: readonly string[] = []): string[] {
  const tag = canonicalTag(tagName);
  if (!tag || tag === "__placeholder__") return [];
  const identity = root ? ["x:Name", "Margin", "Padding", "Width", "Height", "ClipToBounds"] : ["x:Name", "x:Ref"];
  if (root) return [...new Set([...identity, "MinWidth", "MinHeight", "MaxWidth", "MaxHeight", "HorizontalAlignment", "VerticalAlignment", "ZIndex", "ChildLayout", "Wrap", "ChildWidth", "ChildHeight", "HorizontalGap", "VerticalGap", "Fill", "RenderTransform", "RenderTransformOrigin", "LayoutTransform"])];
  const structural = ["lui:If", "lui:For", "lui:Slot", "lui:Preview", "lui:Set"];
  const layout = structural.includes(tag) ? [] : ["Width", "Height", "MinWidth", "MinHeight", "MaxWidth", "MaxHeight", "Margin", "Padding", "ClipToBounds", "HorizontalAlignment", "VerticalAlignment", "Visibility", "ZIndex", "ChildLayout", "Wrap", "ChildWidth", "ChildHeight", "HorizontalGap", "VerticalGap", "Fill", "RenderTransform", "RenderTransformOrigin", "LayoutTransform"];
  const surface = ["Container", "Panel", "Button", "Text", "Grid", "Canvas", "Card", "Scroll", "SafeArea", "Modal", "Section", "Notice", "Screen", "FixedScreen"].includes(tag) ? ["Background", "BorderWidth", "BorderColor", "Opacity", "BorderRadius"] : [];
  const specific: Record<string, string[]> = {
    Text: ["Text", "FontSize", "Color"], Button: ["Text", "Click", "Disabled", "Variant", "Color"], Progress: ["Value", "Max"], Toggle: ["Value", "Change", "Disabled"], Slider: ["Value", "Min", "Max", "Change", "Disabled"], Scroll: ["HorizontalScrollBarVisibility", "VerticalScrollBarVisibility"], Modal: ["Title", "Close", "CloseOnOverlay", "ShowCloseButton"], Section: ["Title", "Subtitle"], Notice: ["Text", "Error"], "lui:If": ["Test"], "lui:For": ["Items", "In"], "lui:Set": ["Path", "Value"]
  };
  const control = controlDefinition(tag);
  if (tag === "Scroll") specific.Scroll!.push("ScrollbarColor");
  if (control) {
    const declarative = ["Text", "Title", "Subtitle", "Value", "Min", "Max", "Step", "Placeholder", "Items", "Data", "Options", "Icon", "Image", "Source", "Orientation", "Columns", "Rows", "Gap", "Type", "Visible", ...(control.events ?? [])];
    if (control.bindable && !declarative.includes(control.bindable)) declarative.push(control.bindable);
    specific[tag] = [...(specific[tag] ?? []), ...declarative];
  }
  return [...new Set([...identity, ...layout, ...surface, ...componentProperties, ...(specific[tag] ?? [])])];
}

function componentPropertiesFor(tag: string | undefined, imports: readonly LuiCompletionImport[]): string[] {
  if (!tag?.includes(":")) return [];
  const [alias, name] = tag.split(":", 2);
  return imports.find((entry) => entry.alias === alias)?.components.find((component) => component.name === name)?.properties?.slice() ?? [];
}

function bindingPaths(source: string, position: number): string[] {
  const paths = new Set<string>(["view.path"]);
  for (const match of source.matchAll(/\{绑定\s+((?:view|props)\.[A-Za-z0-9_.-]*)/g)) paths.add(match[1]!);
  const before = source.slice(0, position);
  const loops: string[] = [];
  for (const match of before.matchAll(/<!--[\s\S]*?-->|<(\/)?(?:重复项|循环)(?=\s|>)(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    if (match[0].startsWith('<!--')) continue;
    if (match[1]) loops.pop();
    else if (!match[0].endsWith('/>')) loops.push(/(?:循环项|项目)\s*=\s*["']([A-Za-z][A-Za-z0-9_]*)["']/.exec(match[0])?.[1] ?? 'item');
  }
  for (const loop of loops) paths.add(`${loop}.`);
  if (loops.length) paths.add('item.');
  const rootTag = canonicalTag(/^\s*<\s*([^\s/>]+)/.exec(source)?.[1]);
  if (rootTag === "lui:Component") paths.add("props.");
  return [...paths];
}

function existingActions(source: string): string[] {
  return [...new Set([...source.matchAll(/\{动作\s+([A-Za-z][A-Za-z0-9_.-]*)\}/g)].map((match) => match[1]!))];
}

function add(candidates: LuiCompletionCandidate[], candidate: Omit<LuiCompletionCandidate, "from" | "to">, from: number, to: number): void {
  candidates.push({ ...candidate, from, to });
}

function sortCandidates(candidates: LuiCompletionCandidate[], query: string): LuiCompletionCandidate[] {
  const normalized = query.toLocaleLowerCase();
  const rank = (candidate: LuiCompletionCandidate): number => {
    const keys = [candidate.label, ...candidate.aliases].map((item) => item.toLocaleLowerCase());
    return keys.some((item) => item.startsWith(normalized)) ? 0 : keys.some((item) => item.includes(normalized)) ? 1 : 2;
  };
  return candidates
    .filter((candidate) => !normalized || [candidate.label, ...candidate.aliases].some((item) => item.toLocaleLowerCase().includes(normalized)))
    .sort((left, right) => rank(left) - rank(right) || (GROUP_RANK.indexOf(left.group) < 0 ? 99 : GROUP_RANK.indexOf(left.group)) - (GROUP_RANK.indexOf(right.group) < 0 ? 99 : GROUP_RANK.indexOf(right.group)) || collator.compare(left.group, right.group) || collator.compare(left.label, right.label));
}

/** Context-sensitive LUI completions for both VS Code and the embedded editor. */
export function provideLuiCompletions(context: LuiCompletionContext): LuiCompletionCandidate[] {
  const source = context.source;
  const position = Math.max(0, Math.min(context.position, source.length));
  if (hasUnclosedComment(source, position)) return [];
  const tagStart = indexOfCurrentTag(source, position);
  if (tagStart < 0 || source.lastIndexOf(">", position - 1) > tagStart) return [];
  const fragment = source.slice(tagStart, position);
  const candidates: LuiCompletionCandidate[] = [];
  const close = /^<\s*\/\s*([^\s/>]*)$/.exec(fragment);
  if (close) {
    const open = openTagsBefore(source, tagStart).at(-1);
    if (open) add(candidates, { label: open, insertText: `${open}>`, kind: "tag", group: "当前标签", detail: "匹配结束标签", documentation: `闭合 <${open}>。`, aliases: [open, canonicalTag(open) ?? ""] }, position - close[1]!.length, position);
    return sortCandidates(candidates, close[1]!);
  }
  const opening = /^<\s*([^\s/>]*)$/.exec(fragment);
  if (opening) {
    const query = opening[1]!;
    const parent = openTagsBefore(source, tagStart).at(-1);
    const root = !parent;
    const tags = root ? ["页面", "控件"] : builtinTags().filter((tag) => !["页面", "控件", "组件"].includes(tag));
    for (const tag of tags) {
      const description = tagDescription(tag);
      add(candidates, { label: tag, insertText: `${tag} />`, kind: "tag", group: root ? "根节点" : tagGroup(tag), detail: description.detail, documentation: description.documentation, aliases: description.aliases }, position - query.length, position);
    }
    for (const imported of context.imports ?? []) for (const component of imported.components) {
      const tag = `${imported.alias}:${component.name}`; const description = tagDescription(tag);
      add(candidates, { label: tag, insertText: `${tag} />`, kind: "tag", group: imported.alias, detail: description.detail, documentation: description.documentation, aliases: [...description.aliases, imported.directory] }, position - query.length, position);
    }
    return sortCandidates(candidates, query);
  }
  const currentTag = /^<\s*([^\s/>]+)/.exec(fragment)?.[1];
  if (!currentTag) return [];
  const [componentAlias, componentName] = currentTag.split(':');
  const declarations = context.imports?.find(i => i.alias === componentAlias)?.components.find(c => c.name === componentName)?.definitions;
  const root = openTagsBefore(source, tagStart).length === 0;
  const value = /([^\s=/>]+)\s*=\s*(["'])([^"']*)$/.exec(fragment);
  if (value && !value[3]!.trimStart().startsWith("{")) {
    const publicDefinition = declarations?.[value[1]!];
    const name = publicDefinition ? value[1]! : canonicalAttribute(value[1]!); const query = value[3]!; const replaceFrom = position - query.length;
    const bindingStart = fragment.lastIndexOf("{");
    if (bindingStart >= 0 && bindingStart > fragment.lastIndexOf(value[2]!)) return [];
    const definition = publicDefinition ? undefined : attributeDefinition(name);
    const options = publicDefinition ? (publicDefinition.type === 'boolean' ? ['true','false'] : undefined) : enumOptions(name) ?? (definition?.kind === "tracks" ? ["自动", "填充", "*", "2*"] : definition?.kind === "length" ? ["自动", "0", "100%"] : definition?.kind === "thickness" ? ["0", "0,0,0,0"] : undefined);
    if (options) for (const option of options) add(candidates, { label: option, insertText: option, kind: "value", group: "当前标签", detail: `${sourceAttribute(name)} 可选值`, documentation: `${sourceAttribute(name)} 的合法值。`, aliases: [option] }, replaceFrom, position);
    const canBind = !["x:Name", "x:Ref"].includes(name) && name !== "Variant" && name !== "ClipToBounds";
    if (canBind) add(candidates, { label: "绑定", insertText: "{绑定 view.path, 模式=单向, 更新源触发=默认}", kind: "binding", group: "绑定路径", detail: "声明数据绑定", documentation: "绑定到 view.*、props.* 或重复项 item.*。", aliases: ["{绑定", "Binding"] }, replaceFrom, position);
    if (publicDefinition?.type === 'event' || ["Click", "Change", "Submit", "Select", "Open", "Close", "Focus", "Blur", "Complete", "DragStart", "DragEnd", "DragCancel"].includes(name)) {
      for (const action of [...new Set([...(context.actions ?? []), ...existingActions(source)])]) add(candidates, { label: action, insertText: `{动作 ${action}}`, kind: "action", group: "交互", detail: "后端动作", documentation: `调用配套 .lui.lua 中的动作 ${action}。`, aliases: [action, "动作"] }, replaceFrom, position);
      add(candidates, { label: "受控命令", insertText: "{命令 导航, 目标='页面名'}", kind: "command", group: "内置命令", detail: "受限声明式命令", documentation: "只允许内置命令，不执行任意 Lua。", aliases: ["命令", "导航", "关闭", "页签"] }, replaceFrom, position);
    }
    return sortCandidates(candidates, query);
  }
  const binding = /\{\s*(绑定|动作|命令)?\s*([^}]*)$/.exec(fragment);
  if (binding) {
    const body = binding[2] ?? ""; const query = body.split(",").at(-1)?.trim() ?? ""; const replaceFrom = position - query.length;
    if (binding[1] === "绑定") {
      if (!body.includes(",")) for (const path of [...bindingPaths(source, position), ...Object.keys(context.properties ?? {}).map(key => `props['${key}']`)]) add(candidates, { label: path, insertText: path, kind: "binding", group: "绑定路径", detail: "绑定路径", documentation: "仅提供当前作用域可用的绑定路径。", aliases: [path] }, replaceFrom, position);
      else {
        const valueMatch = /^(模式|更新源触发)\s*=\s*(.*)$/.exec(query);
        if (valueMatch) {
          const values = valueMatch[1] === "模式" ? ["单向", "双向", "单次", "单向到源"] : ["默认", "属性变更", "失焦", "显式"];
          const valueFrom = position - valueMatch[2]!.length;
          for (const option of values) add(candidates, { label: option, insertText: option, kind: "value", group: "绑定路径", detail: `${valueMatch[1]} 可选值`, documentation: "绑定配置的合法值。", aliases: [option, `${valueMatch[1]}=${option}`] }, valueFrom, position);
        } else {
          const used = new Set([...body.matchAll(/(?:^|,)\s*([^=,\s]+)\s*=/g)].map((match) => match[1]!));
          for (const option of BINDING_OPTIONS.filter((item) => !used.has(item))) add(candidates, { label: option, insertText: `${option}=`, kind: "binding", group: "绑定路径", detail: "绑定选项", documentation: "绑定的可选配置。", aliases: [option] }, replaceFrom, position);
        }
      }
    } else if (binding[1] === "动作") {
      for (const action of [...new Set([...(context.actions ?? []), ...existingActions(source)])]) add(candidates, { label: action, insertText: action, kind: "action", group: "交互", detail: "后端动作", documentation: "配套 .lui.lua 中可静态识别的动作。", aliases: [action] }, replaceFrom, position);
    } else if (binding[1] === "命令") {
      const command = body.split(",", 1)[0]!.trim();
      if (!command) for (const name of Object.keys(CONTROLLED_COMMANDS)) add(candidates, { label: name, insertText: name, kind: "command", group: "内置命令", detail: "内置命令", documentation: "受限声明式交互。", aliases: [name] }, replaceFrom, position);
      else {
        const used = new Set([...body.matchAll(/(?:^|,)\s*([^=,\s]+)\s*=/g)].map((match) => match[1]!));
        for (const key of (CONTROLLED_COMMANDS[command] ?? []).filter((item) => !used.has(item))) add(candidates, { label: key, insertText: `${key}=`, kind: "command", group: "内置命令", detail: `${command} 参数`, documentation: `${command} 命令允许的参数。`, aliases: [key] }, replaceFrom, position);
      }
    } else {
      add(candidates, { label: "绑定", insertText: "绑定 view.path", kind: "binding", group: "绑定路径", detail: "声明数据绑定", documentation: "使用 {绑定 view.path}。", aliases: ["绑定"] }, replaceFrom, position);
      add(candidates, { label: "动作", insertText: "动作 ActionKey", kind: "action", group: "交互", detail: "调用后端动作", documentation: "使用 {动作 ActionKey}。", aliases: ["动作"] }, replaceFrom, position);
      add(candidates, { label: "命令", insertText: "命令 导航, 目标='页面名'", kind: "command", group: "内置命令", detail: "受限内置命令", documentation: "使用 {命令 ...}。", aliases: ["命令"] }, replaceFrom, position);
    }
    return sortCandidates(candidates, query);
  }
  const attribute = /(?:\s|^)([^\s=/>]*)$/.exec(fragment);
  if (!attribute) return [];
  const query = attribute[1]!;
  const properties = componentPropertiesFor(currentTag, context.imports ?? []);
  const present = declarations ? new Set([...fragment.matchAll(/([^\s=/>]+)\s*=/g)].map(m => isLayoutProperty(m[1]!) ? canonicalAttribute(m[1]!) : m[1]!)) : sourceAttributes(fragment);
  for (const match of fragment.matchAll(/([^\s=/>]+)\s*=/g)) if (properties.includes(match[1]!)) present.add(match[1]!);
  for (const canonical of availableAttributes(currentTag, root, properties).filter((name) => !present.has(name))) {
    const sourceName = properties.includes(canonical) ? canonical : sourceAttribute(canonical);
    const declared = declarations?.[sourceName];
    if (declared) {
      add(candidates, { label: sourceName, insertText: `${sourceName}=""`, kind: 'attribute', group: declared.type === 'event' ? '交互' : '内容与数据', detail: declared.type, documentation: declared.description ?? '组件公开属性', aliases: [sourceName] }, position - query.length, position);
      continue;
    }
    add(candidates, { label: sourceName, insertText: `${sourceName}=""`, kind: "attribute", group: canonical.startsWith("x:") ? "当前标签" : canonical === "Click" || canonical === "Change" || canonical === "Submit" || canonical === "Select" ? "交互" : ["Width", "Height", "Margin", "Padding", "HorizontalAlignment", "VerticalAlignment", "ChildLayout"].includes(canonical) ? "布局" : "内容与数据", detail: canonical, documentation: `${sourceName}（${canonical}）`, aliases: [sourceName, canonical] }, position - query.length, position);
  }
  if (root) add(candidates, { label: "目录:别名", insertText: "目录:别名=\"Presentation/Components\"", kind: "attribute", group: "根节点", detail: "组件目录导入", documentation: "在根节点导入项目自定义组件目录。", aliases: ["目录", "import", "namespace"] }, position - query.length, position);
  return sortCandidates(candidates, query);
}

/** Extracts names from a conventional `actions = { Key = function ... }` table without evaluating Lua. */
export function extractLuiActionSymbols(lua: string): string[] {
  const table = /\bactions\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(lua)?.[1] ?? "";
  return [...new Set([...table.matchAll(/(?:^|[,{\n])\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*function\b/g)].map((match) => match[1]!))].sort((left, right) => collator.compare(left, right));
}
