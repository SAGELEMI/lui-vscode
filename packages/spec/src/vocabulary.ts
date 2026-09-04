import { UI_CONTROL_BY_NAME, UI_CONTROL_BY_TAG, UI_CONTROL_DEFINITIONS } from "./generated-controls.js";
import { pathKeys } from './paths.js';

/**
 * Canonical LUI vocabulary. Chinese is the authoring language; English forms
 * only remain readable so an old document can receive a precise migration hint.
 */
export const TAG_TO_CANONICAL: Record<string, string> = {
  "页面": "lui:Page", "控件": "lui:Component", "组件": "lui:Component", "条件": "lui:If", "重复项": "lui:For", "循环": "lui:For", "内容呈现器": "lui:Slot", "插槽": "lui:Slot", "预览": "lui:Preview", "设值": "lui:Set",
  "容器": "Container", "网格": "Grid", "画布": "Canvas", "视图框": "Viewbox", "堆叠面板": "StackPanel", "换行面板": "WrapPanel", "停靠面板": "DockPanel", "均分网格": "UniformGrid", "边框": "Border", "滚动查看器": "Scroll", "内容控件": "ContentControl", "文本": "Text", "按钮": "Button", "卡片": "Card", "滚动区": "Scroll", "进度条": "Progress", "开关": "Toggle", "滑块": "Slider", "安全区": "SafeArea", "弹窗": "Modal", "分区": "Section", "提示": "Notice", "屏幕": "Screen", "固定屏幕": "FixedScreen",
  "lui:Page": "lui:Page", "lui:Component": "lui:Component", "lui:If": "lui:If", "lui:For": "lui:For", "lui:Slot": "lui:Slot", "lui:Preview": "lui:Preview", "lui:Set": "lui:Set",
  Grid: "Grid", Canvas: "Canvas", Viewbox: "Viewbox", Panel: "Panel", Row: "Row", Text: "Text", Button: "Button", Card: "Card", Scroll: "Scroll", Progress: "Progress", Toggle: "Toggle", Slider: "Slider", SafeArea: "SafeArea", Modal: "Modal", Section: "Section", Notice: "Notice", Screen: "Screen", FixedScreen: "FixedScreen",
  // Kept for parsing old documents only. New design documents must use 网格/画布.
  "面板": "Panel", "横排": "Row"
};

export const CANONICAL_TO_TAG: Record<string, string> = {
  "lui:Page": "页面", "lui:Component": "控件", "lui:If": "条件", "lui:For": "重复项", "lui:Slot": "内容呈现器", "lui:Preview": "预览", "lui:Set": "设值",
  Container: "容器", Grid: "网格", Canvas: "画布", Viewbox: "视图框", StackPanel: "堆叠面板", WrapPanel: "换行面板", DockPanel: "停靠面板", UniformGrid: "均分网格", Border: "边框", ContentControl: "内容控件", Text: "文本", Button: "按钮", Card: "卡片", Scroll: "滚动查看器", Progress: "进度条", Toggle: "开关", Slider: "滑块", SafeArea: "安全区", Modal: "弹窗", Section: "分区", Notice: "提示", Screen: "屏幕", FixedScreen: "固定屏幕"
};

// The generated catalog is the extension point for every public visual UI
// constructor. Existing LUI aliases above keep their stable document spelling.
for (const control of UI_CONTROL_DEFINITIONS) {
  // Root <控件> is reserved for a document root; the visual UI.Widget remains
  // selectable by its internal type rather than stealing that authoring token.
  TAG_TO_CANONICAL[control.name] ??= control.tag;
  TAG_TO_CANONICAL[control.tag] = control.tag;
  CANONICAL_TO_TAG[control.tag] ??= control.name;
}

/** Public component names are directory-scoped in source, but share these default Chinese aliases. */
export const COMPONENT_NAME_TO_CANONICAL: Record<string, string> = {
  Header: "页眉", EquipmentSlots: "装备槽", ScrollRegion: "滚动区域", InformationPanel: "信息面板", SelectionList: "选择列表", TabView: "页签视图"
};

export const ATTRIBUTE_TO_CANONICAL: Record<string, string> = {
  "边框宽度": "BorderWidth", "边框颜色": "BorderColor", "滚动条颜色": "ScrollbarColor",
  "名称": "x:Name", "副名称": "x:DisplayName", "引用": "x:Ref", "水平滚动条可见性": "HorizontalScrollBarVisibility", "垂直滚动条可见性": "VerticalScrollBarVisibility",
  "宽度": "Width", "高度": "Height", "最小宽度": "MinWidth", "最小高度": "MinHeight", "最大宽度": "MaxWidth", "最大高度": "MaxHeight", "外边距": "Margin", "内边距": "Padding", "裁剪超出": "ClipToBounds", "子项排列": "ChildLayout", "允许换行": "Wrap", "固定子项宽度": "ChildWidth", "固定子项高度": "ChildHeight", "水平间隔": "HorizontalGap", "垂直间隔": "VerticalGap", "填充": "Fill",
  "行定义": "RowDefinitions", "列定义": "ColumnDefinitions", "行间距": "RowSpacing", "列间距": "ColumnSpacing", "网格.行": "Grid.Row", "网格.列": "Grid.Column", "网格.跨行": "Grid.RowSpan", "网格.跨列": "Grid.ColumnSpan",
  "画布.左": "Canvas.Left", "画布.上": "Canvas.Top", "画布.右": "Canvas.Right", "画布.下": "Canvas.Bottom",
  "背景": "Background", "颜色": "Color", "不透明度": "Opacity", "圆角": "BorderRadius", "样式": "Variant", "外观": "Variant", "文本": "Text", "标题": "Title", "副标题": "Subtitle", "角标": "Corner", "状态": "Status", "说明": "Description", "提示": "Hint", "操作项": "ActionItems", "字号": "FontSize", "点击": "Click", "变更": "Change", "提交": "Submit", "选择": "Select", "打开": "Open", "获得焦点": "Focus", "失去焦点": "Blur", "完成": "Complete", "拖动开始": "DragStart", "拖动结束": "DragEnd", "拖动取消": "DragCancel", "关闭": "Close", "禁用": "Disabled", "可见": "Visible", "可见性": "Visibility", "水平对齐": "HorizontalAlignment", "垂直对齐": "VerticalAlignment", "停靠": "Dock", "最后子项填充": "LastChildFill", "流向": "FlowDirection", "层级": "ZIndex", "渲染变换": "RenderTransform", "渲染变换原点": "RenderTransformOrigin", "布局变换": "LayoutTransform", "值": "Value", "最大值": "Max", "最小值": "Min", "步长": "Step", "占位文本": "Placeholder", "项目": "Items", "数据": "Data", "选项": "Options", "图标": "Icon", "图片": "Image", "资源": "Source", "方向": "Orientation", "列数": "Columns", "行数": "Rows", "间距": "Gap", "类型": "Type", "条件": "Test", "集合": "In", "循环项": "Each", "路径": "Path", "插槽名": "Name", "错误": "Error", "设置": "Settings", "返回": "Back", "武器文本": "WeaponText", "护甲文本": "ArmorText", "选择武器": "SelectWeapon", "选择护甲": "SelectArmor", "点击遮罩关闭": "CloseOnOverlay", "显示关闭按钮": "ShowCloseButton", "安全边": "Edges", "安全区模式": "Mode", "原生菜单安全区": "NativeMenuInset",
  // Deprecated source is intentionally still canonicalized so it can be diagnosed.
  "锚点": "Anchor", "左侧": "Left", "顶部": "Top", "右侧": "Right", "底部": "Bottom", "子项间距": "Gap", "弹性增长": "FlexGrow", "弹性基准": "FlexBasis", "交叉轴对齐": "Align", "主轴对齐": "Justify",
  "x:Name": "x:Name", "x:DisplayName": "x:DisplayName", "x:Ref": "x:Ref", Width: "Width", Height: "Height", MinWidth: "MinWidth", MinHeight: "MinHeight", MaxWidth: "MaxWidth", MaxHeight: "MaxHeight", Margin: "Margin", Padding: "Padding", ClipToBounds: "ClipToBounds", HorizontalScrollBarVisibility: "HorizontalScrollBarVisibility", VerticalScrollBarVisibility: "VerticalScrollBarVisibility", RowDefinitions: "RowDefinitions", ColumnDefinitions: "ColumnDefinitions", RowSpacing: "RowSpacing", ColumnSpacing: "ColumnSpacing", "Grid.Row": "Grid.Row", "Grid.Column": "Grid.Column", "Grid.RowSpan": "Grid.RowSpan", "Grid.ColumnSpan": "Grid.ColumnSpan", "Canvas.Left": "Canvas.Left", "Canvas.Top": "Canvas.Top", "Canvas.Right": "Canvas.Right", "Canvas.Bottom": "Canvas.Bottom", Background: "Background", Color: "Color", Opacity: "Opacity", BorderRadius: "BorderRadius", Variant: "Variant", HorizontalAlignment: "HorizontalAlignment", VerticalAlignment: "VerticalAlignment", Visibility: "Visibility", Dock: "Dock", LastChildFill: "LastChildFill", FlowDirection: "FlowDirection", ZIndex: "ZIndex", RenderTransform: "RenderTransform", RenderTransformOrigin: "RenderTransformOrigin", LayoutTransform: "LayoutTransform", Text: "Text", Title: "Title", Subtitle: "Subtitle", FontSize: "FontSize", Click: "Click", Change: "Change", Submit: "Submit", Select: "Select", Open: "Open", Focus: "Focus", Blur: "Blur", Complete: "Complete", DragStart: "DragStart", DragEnd: "DragEnd", DragCancel: "DragCancel", Close: "Close", Disabled: "Disabled", Value: "Value", Max: "Max", Min: "Min", Step: "Step", Placeholder: "Placeholder", Items: "Items", Data: "Data", Options: "Options", Icon: "Icon", Image: "Image", Source: "Source", Orientation: "Orientation", Columns: "Columns", Rows: "Rows", Gap: "Gap", Type: "Type", Visible: "Visible", Test: "Test", In: "In", Each: "Each", Path: "Path", Name: "Name", Error: "Error", Settings: "Settings", Back: "Back", WeaponText: "WeaponText", ArmorText: "ArmorText", SelectWeapon: "SelectWeapon", SelectArmor: "SelectArmor", CloseOnOverlay: "CloseOnOverlay", ShowCloseButton: "ShowCloseButton", Edges: "Edges", Mode: "Mode", NativeMenuInset: "NativeMenuInset", Anchor: "Anchor", Left: "Left", Top: "Top", Right: "Right", Bottom: "Bottom", Justify: "Justify"
};

export const DEPRECATED_CANONICAL_ATTRIBUTES = new Set(["Anchor", "Left", "Top", "Right", "Bottom", "FlexGrow", "FlexBasis", "Align", "Justify", "RowDefinitions", "ColumnDefinitions", "RowSpacing", "ColumnSpacing", "Grid.Row", "Grid.Column", "Grid.RowSpan", "Grid.ColumnSpan", "Canvas.Left", "Canvas.Top", "Canvas.Right", "Canvas.Bottom", "Dock", "LastChildFill", "FlowDirection"]);
export const DEPRECATED_CANONICAL_TAGS = new Set(["Panel", "Row", "Grid", "Canvas", "Viewbox", "StackPanel", "WrapPanel", "DockPanel", "UniformGrid", "lui:Preview", "lui:Set"]);

export const CANONICAL_TO_ATTRIBUTE: Record<string, string> = Object.fromEntries(
  Object.entries(ATTRIBUTE_TO_CANONICAL)
    .filter(([name, canonical]) => /[^\x00-\x7f]/.test(name) && name !== canonical && !DEPRECATED_CANONICAL_ATTRIBUTES.has(canonical))
    .map(([name, canonical]) => [canonical, name])
);

export const ATTRIBUTE_LABELS: Record<string, string> = {
  BorderWidth: "边框宽度", BorderColor: "边框颜色", ScrollbarColor: "滚动条颜色",
  "x:Name": "名称", "x:DisplayName": "副名称", "x:Ref": "引用", Width: "宽度", Height: "高度", MinWidth: "最小宽度", MinHeight: "最小高度", MaxWidth: "最大宽度", MaxHeight: "最大高度", Margin: "外边距", Padding: "内边距", ClipToBounds: "裁剪超出", HorizontalScrollBarVisibility: "水平滚动条可见性", VerticalScrollBarVisibility: "垂直滚动条可见性", RowDefinitions: "行定义", ColumnDefinitions: "列定义", RowSpacing: "行间距", ColumnSpacing: "列间距", "Grid.Row": "网格.行", "Grid.Column": "网格.列", "Grid.RowSpan": "网格.跨行", "Grid.ColumnSpan": "网格.跨列", "Canvas.Left": "画布.左", "Canvas.Top": "画布.上", "Canvas.Right": "画布.右", "Canvas.Bottom": "画布.下", Background: "背景", Color: "颜色", Opacity: "不透明度", BorderRadius: "圆角", Variant: "外观", HorizontalAlignment: "水平对齐", VerticalAlignment: "垂直对齐", Visibility: "可见性", Dock: "停靠", LastChildFill: "最后子项填充", FlowDirection: "流向", ZIndex: "层级", RenderTransform: "渲染变换", RenderTransformOrigin: "渲染变换原点", LayoutTransform: "布局变换", Text: "文本", Title: "标题", Subtitle: "副标题", Corner: "角标", Status: "状态", Description: "说明", Hint: "提示", ActionItems: "操作项", FontSize: "字号", Click: "点击", Change: "变更", Submit: "提交", Select: "选择", Open: "打开", Focus: "获得焦点", Blur: "失去焦点", Complete: "完成", DragStart: "拖动开始", DragEnd: "拖动结束", DragCancel: "拖动取消", Close: "关闭", Disabled: "禁用", Value: "值", Max: "最大值", Min: "最小值", Step: "步长", Placeholder: "占位文本", Items: "项目", Data: "数据", Options: "选项", Icon: "图标", Image: "图片", Source: "资源", Orientation: "方向", Columns: "列数", Rows: "行数", Gap: "间距", Type: "类型", Visible: "可见", Test: "条件", In: "集合", Each: "循环项", Path: "路径", Name: "插槽名", Error: "错误", Settings: "设置", Back: "返回", WeaponText: "武器文本", ArmorText: "护甲文本", SelectWeapon: "选择武器", SelectArmor: "选择护甲", CloseOnOverlay: "点击遮罩关闭", ShowCloseButton: "显示关闭按钮", Edges: "安全边", Mode: "安全区模式", NativeMenuInset: "原生菜单安全区"
};

Object.assign(ATTRIBUTE_LABELS, {
  ChildLayout: "子项排列", Wrap: "允许换行", ChildWidth: "固定子项宽度", ChildHeight: "固定子项高度",
  HorizontalGap: "水平间隔", VerticalGap: "垂直间隔", Fill: "填充"
});

export type AttributeKind = "text" | "length" | "thickness" | "integer" | "tracks" | "enum";
export interface AttributeDefinition { kind: AttributeKind; options?: readonly string[]; tags?: readonly string[]; }

/** The one source of truth for inspector controls and both completion providers. */
export const ATTRIBUTE_DEFINITIONS: Record<string, AttributeDefinition> = {
  BorderWidth: { kind: "length" }, BorderColor: { kind: "text" }, ScrollbarColor: { kind: "text", tags: ["Scroll"] },
  Width: { kind: "length" }, Height: { kind: "length" }, MinWidth: { kind: "length" }, MinHeight: { kind: "length" }, MaxWidth: { kind: "length" }, MaxHeight: { kind: "length" }, Margin: { kind: "thickness" }, Padding: { kind: "thickness" }, HorizontalScrollBarVisibility: { kind: "enum", options: ["自动", "显示", "隐藏", "禁用"], tags: ["Scroll"] }, VerticalScrollBarVisibility: { kind: "enum", options: ["自动", "显示", "隐藏", "禁用"], tags: ["Scroll"] },
  ChildLayout: { kind: "enum", options: ["自由", "垂直", "水平"] }, Wrap: { kind: "enum", options: ["是", "否"] }, ChildWidth: { kind: "length" }, ChildHeight: { kind: "length" }, HorizontalGap: { kind: "length" }, VerticalGap: { kind: "length" }, Fill: { kind: "enum", options: ["是", "否"] },
  RowDefinitions: { kind: "tracks", tags: ["Grid"] }, ColumnDefinitions: { kind: "tracks", tags: ["Grid"] }, RowSpacing: { kind: "length", tags: ["Grid"] }, ColumnSpacing: { kind: "length", tags: ["Grid"] }, "Grid.Row": { kind: "integer" }, "Grid.Column": { kind: "integer" }, "Grid.RowSpan": { kind: "integer" }, "Grid.ColumnSpan": { kind: "integer" }, "Canvas.Left": { kind: "length" }, "Canvas.Top": { kind: "length" }, "Canvas.Right": { kind: "length" }, "Canvas.Bottom": { kind: "length" },
Variant: { kind: "enum", options: ["高亮", "常规"] }, Disabled: { kind: "enum", options: ["是", "否"] }, ClipToBounds: { kind: "enum", options: ["是", "否"] }, CloseOnOverlay: { kind: "enum", options: ["是", "否"] }, ShowCloseButton: { kind: "enum", options: ["是", "否"] }, Visible: { kind: "enum", options: ["是", "否"] }, Visibility: { kind: "enum", options: ["显示", "隐藏", "折叠"] }, HorizontalAlignment: { kind: "enum", options: ["上", "居中", "下", "拉伸"] }, VerticalAlignment: { kind: "enum", options: ["左", "居中", "右", "拉伸"] }, Dock: { kind: "enum", options: ["左", "上", "右", "下"] }, LastChildFill: { kind: "enum", options: ["是", "否"], tags: ["DockPanel"] }, FlowDirection: { kind: "enum", options: ["从左到右", "从右到左"], tags: ["StackPanel", "WrapPanel"] }, Edges: { kind: "enum", options: ["全部", "无", "水平", "垂直"] }, Mode: { kind: "enum", options: ["内边距", "外边距"] }, NativeMenuInset: { kind: "enum", options: ["是", "否"] }, RenderTransform: { kind: "text" }, RenderTransformOrigin: { kind: "text" }, LayoutTransform: { kind: "text" }
};

export function attributeDefinition(name: string): AttributeDefinition | undefined { return ATTRIBUTE_DEFINITIONS[canonicalAttribute(name)]; }
export function enumOptions(name: string): readonly string[] | undefined { return attributeDefinition(name)?.options; }

const ENUM_VALUE_ALIASES: Record<string, Record<string, string>> = {
  Variant: { primary: "高亮", secondary: "常规", "主要": "高亮", "次要": "常规" },
  Disabled: { true: "是", false: "否" },
  CloseOnOverlay: { true: "是", false: "否" },
  ShowCloseButton: { true: "是", false: "否" }, NativeMenuInset: { true: "是", false: "否" }
};
export function normalizedEnumValue(name: string, value: string): string { return ENUM_VALUE_ALIASES[canonicalAttribute(name)]?.[value] ?? value; }
export function legacyEnumValue(name: string, value: string): boolean { return normalizedEnumValue(name, value) !== value; }

export function canonicalTag(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const separator = name.indexOf(".");
  if (separator > 0) return `${canonicalTag(name.slice(0, separator)) ?? name.slice(0, separator)}.${canonicalAttribute(name.slice(separator + 1))}`;
  const namespace = name.indexOf(":");
  if (namespace > 0 && !name.startsWith("lui:")) return `${name.slice(0, namespace)}:${COMPONENT_NAME_TO_CANONICAL[name.slice(namespace + 1)] ?? name.slice(namespace + 1)}`;
  return TAG_TO_CANONICAL[name] ?? name;
}
export function sourceTag(name: string): string {
  const separator = name.indexOf(".");
  if (separator > 0) return `${sourceTag(name.slice(0, separator))}.${sourceAttribute(name.slice(separator + 1))}`;
  return CANONICAL_TO_TAG[name] ?? name;
}
export function canonicalAttribute(name: string): string {
  if (name.startsWith("预览.")) return `Preview.${canonicalAttribute(name.slice(3))}`;
  return ATTRIBUTE_TO_CANONICAL[name] ?? name;
}
export function sourceAttribute(name: string): string {
  if (name.startsWith("Preview.")) return `预览.${sourceAttribute(name.slice(8))}`;
  return CANONICAL_TO_ATTRIBUTE[name] ?? name;
}
export function directoryAlias(name: string): { alias: string; legacy: boolean } | undefined {
  const chinese = /^目录:(.+)$/.exec(name);
  if (chinese) return { alias: chinese[1]!, legacy: false };
  const legacy = /^xmlns:(.+)$/.exec(name);
  return legacy ? { alias: legacy[1]!, legacy: true } : undefined;
}
export interface LuiBinding { path: string; mode: "单向" | "双向" | "单次" | "单向到源"; updateSourceTrigger: "默认" | "属性变更" | "失焦" | "显式"; stringFormat?: string; previewContent?: string; }
function bindingParts(value: string | undefined): string[] | undefined {
  const match = /^\{(?:绑定|Binding)\s+(.+)\}$/.exec(value?.trim() ?? "");
  if (!match) return undefined;
  const parts: string[] = []; let current = ""; let quote = "";
  for (const char of match[1]!) { if ((char === "'" || char === "\"") && (!quote || quote === char)) quote = quote ? "" : char; if (char === "," && !quote) { parts.push(current.trim()); current = ""; } else current += char; }
  parts.push(current.trim()); return parts;
}
export function parseBinding(value: string | undefined): LuiBinding | undefined {
  const parts = bindingParts(value); const path = parts?.shift();
  if (!path || !pathKeys(path)) return undefined;
  const result: LuiBinding = { path, mode: "单向", updateSourceTrigger: "默认" };
  for (const part of parts ?? []) { const [rawKey, ...rest] = part.split("="); const key = rawKey?.trim(); const rawValue = rest.join("=").trim().replace(/^(['\"])(.*)\1$/, "$2"); if (key === "模式") result.mode = rawValue as LuiBinding["mode"]; else if (key === "更新源触发") result.updateSourceTrigger = rawValue as LuiBinding["updateSourceTrigger"]; else if (key === "字符串格式") result.stringFormat = rawValue; else if (key === "预览内容") result.previewContent = rawValue; }
  return result;
}
export function isBinding(value: string | undefined): boolean { return parseBinding(value) !== undefined; }
export function bindingPath(value: string | undefined): string | undefined { return parseBinding(value)?.path; }
export function controlDefinition(tag: string | undefined) { const canonical = canonicalTag(tag); return canonical ? UI_CONTROL_BY_TAG[canonical] ?? UI_CONTROL_BY_NAME[tag ?? ""] : undefined; }
export { UI_CONTROL_DEFINITIONS };
export function actionPath(value: string | undefined): string | undefined { return /^\{(?:动作|Action)\s+([A-Za-z][A-Za-z0-9_.-]*)\}$/.exec(value ?? "")?.[1]; }

/** Whitelisted declarative commands. They deliberately carry data only, never Lua source. */
export interface LuiCommand { name: "设值" | "可见性" | "页签" | "导航" | "关闭"; args: Record<string, string>; }
export function parseCommand(value: string | undefined): LuiCommand | undefined {
  const match = /^\{命令\s+(.+)\}$/.exec(value?.trim() ?? "");
  if (!match) return undefined;
  const body = match[1]!;
  const firstComma = body.indexOf(",");
  const name = (firstComma < 0 ? body : body.slice(0, firstComma)).trim();
  if (name !== "设值" && name !== "可见性" && name !== "页签" && name !== "导航" && name !== "关闭") return undefined;
  const args: Record<string, string> = {};
  const tail = firstComma < 0 ? "" : body.slice(firstComma + 1);
  const matcher = /(?:^|,)\s*([^=,\s]+)\s*=\s*(['"])(.*?)\2\s*/g;
  let consumed = ""; let part: RegExpExecArray | null;
  while ((part = matcher.exec(tail))) { args[part[1]!] = part[3]!; consumed += part[0]!; }
  if (tail && consumed.length !== tail.length) return undefined;
  return { name, args };
}
export function isLegacyToken(name: string): boolean {
  const namespace = name.indexOf(":");
  const component = namespace > 0 && !name.startsWith("lui:") ? name.slice(namespace + 1) : "";
  return Boolean(TAG_TO_CANONICAL[name] && !/[^\x00-\x7f]/.test(name)) || Boolean(COMPONENT_NAME_TO_CANONICAL[component]) || Boolean(ATTRIBUTE_TO_CANONICAL[name] && !/[^\x00-\x7f]/.test(name));
}
