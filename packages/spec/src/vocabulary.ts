/**
 * Canonical LUI vocabulary. Chinese is the authoring language; English forms
 * only remain readable so an old document can receive a precise migration hint.
 */
export const TAG_TO_CANONICAL: Record<string, string> = {
  "页面": "lui:Page", "组件": "lui:Component", "条件": "lui:If", "循环": "lui:For", "插槽": "lui:Slot", "预览": "lui:Preview", "设值": "lui:Set",
  "网格": "Grid", "画布": "Canvas", "文本": "Text", "按钮": "Button", "卡片": "Card", "滚动区": "Scroll", "进度条": "Progress", "开关": "Toggle", "滑块": "Slider", "安全区": "SafeArea", "弹窗": "Modal", "分区": "Section", "提示": "Notice", "屏幕": "Screen", "固定屏幕": "FixedScreen",
  "lui:Page": "lui:Page", "lui:Component": "lui:Component", "lui:If": "lui:If", "lui:For": "lui:For", "lui:Slot": "lui:Slot", "lui:Preview": "lui:Preview", "lui:Set": "lui:Set",
  Grid: "Grid", Canvas: "Canvas", Panel: "Panel", Row: "Row", Text: "Text", Button: "Button", Card: "Card", Scroll: "Scroll", Progress: "Progress", Toggle: "Toggle", Slider: "Slider", SafeArea: "SafeArea", Modal: "Modal", Section: "Section", Notice: "Notice", Screen: "Screen", FixedScreen: "FixedScreen",
  // Kept for parsing old documents only. New design documents must use 网格/画布.
  "面板": "Panel", "横排": "Row"
};

export const CANONICAL_TO_TAG: Record<string, string> = {
  "lui:Page": "页面", "lui:Component": "组件", "lui:If": "条件", "lui:For": "循环", "lui:Slot": "插槽", "lui:Preview": "预览", "lui:Set": "设值",
  Grid: "网格", Canvas: "画布", Text: "文本", Button: "按钮", Card: "卡片", Scroll: "滚动区", Progress: "进度条", Toggle: "开关", Slider: "滑块", SafeArea: "安全区", Modal: "弹窗", Section: "分区", Notice: "提示", Screen: "屏幕", FixedScreen: "固定屏幕"
};

/** Public component names are directory-scoped in source, but share these default Chinese aliases. */
export const COMPONENT_NAME_TO_CANONICAL: Record<string, string> = {
  Header: "页眉", EquipmentSlots: "装备槽", PageShell: "页面外壳", ScrollRegion: "滚动区域", InformationPanel: "信息面板", SelectionList: "选择列表", TabView: "页签视图"
};

export const ATTRIBUTE_TO_CANONICAL: Record<string, string> = {
  "名称": "x:Name", "副名称": "x:DisplayName", "引用": "x:Ref",
  "宽度": "Width", "高度": "Height", "最小宽度": "MinWidth", "最小高度": "MinHeight", "最大宽度": "MaxWidth", "最大高度": "MaxHeight", "外边距": "Margin", "内边距": "Padding",
  "行定义": "RowDefinitions", "列定义": "ColumnDefinitions", "行间距": "RowSpacing", "列间距": "ColumnSpacing", "网格.行": "Grid.Row", "网格.列": "Grid.Column", "网格.跨行": "Grid.RowSpan", "网格.跨列": "Grid.ColumnSpan",
  "画布.左": "Canvas.Left", "画布.上": "Canvas.Top", "画布.右": "Canvas.Right", "画布.下": "Canvas.Bottom",
  "背景": "Background", "颜色": "Color", "不透明度": "Opacity", "圆角": "BorderRadius", "样式": "Variant", "文本": "Text", "标题": "Title", "副标题": "Subtitle", "字号": "FontSize", "点击": "Click", "变更": "Change", "关闭": "Close", "禁用": "Disabled", "值": "Value", "最大值": "Max", "最小值": "Min", "条件": "Test", "集合": "In", "项目": "Each", "路径": "Path", "插槽名": "Name", "错误": "Error", "设置": "Settings", "返回": "Back", "武器文本": "WeaponText", "护甲文本": "ArmorText", "选择武器": "SelectWeapon", "选择护甲": "SelectArmor", "点击遮罩关闭": "CloseOnOverlay", "显示关闭按钮": "ShowCloseButton",
  // Deprecated source is intentionally still canonicalized so it can be diagnosed.
  "锚点": "Anchor", "左侧": "Left", "顶部": "Top", "右侧": "Right", "底部": "Bottom", "子项间距": "Gap", "弹性增长": "FlexGrow", "弹性基准": "FlexBasis", "交叉轴对齐": "Align", "主轴对齐": "Justify",
  "x:Name": "x:Name", "x:DisplayName": "x:DisplayName", "x:Ref": "x:Ref", Width: "Width", Height: "Height", MinWidth: "MinWidth", MinHeight: "MinHeight", MaxWidth: "MaxWidth", MaxHeight: "MaxHeight", Margin: "Margin", Padding: "Padding", RowDefinitions: "RowDefinitions", ColumnDefinitions: "ColumnDefinitions", RowSpacing: "RowSpacing", ColumnSpacing: "ColumnSpacing", "Grid.Row": "Grid.Row", "Grid.Column": "Grid.Column", "Grid.RowSpan": "Grid.RowSpan", "Grid.ColumnSpan": "Grid.ColumnSpan", "Canvas.Left": "Canvas.Left", "Canvas.Top": "Canvas.Top", "Canvas.Right": "Canvas.Right", "Canvas.Bottom": "Canvas.Bottom", Background: "Background", Color: "Color", Opacity: "Opacity", BorderRadius: "BorderRadius", Variant: "Variant", Text: "Text", Title: "Title", Subtitle: "Subtitle", FontSize: "FontSize", Click: "Click", Change: "Change", Close: "Close", Disabled: "Disabled", Value: "Value", Max: "Max", Min: "Min", Test: "Test", In: "In", Each: "Each", Path: "Path", Name: "Name", Error: "Error", Settings: "Settings", Back: "Back", WeaponText: "WeaponText", ArmorText: "ArmorText", SelectWeapon: "SelectWeapon", SelectArmor: "SelectArmor", CloseOnOverlay: "CloseOnOverlay", ShowCloseButton: "ShowCloseButton", Anchor: "Anchor", Left: "Left", Top: "Top", Right: "Right", Bottom: "Bottom", Gap: "Gap", FlexGrow: "FlexGrow", FlexBasis: "FlexBasis", Align: "Align", Justify: "Justify"
};

export const DEPRECATED_CANONICAL_ATTRIBUTES = new Set(["Anchor", "Left", "Top", "Right", "Bottom", "Gap", "FlexGrow", "FlexBasis", "Align", "Justify"]);
export const DEPRECATED_CANONICAL_TAGS = new Set(["Panel", "Row"]);

export const CANONICAL_TO_ATTRIBUTE: Record<string, string> = Object.fromEntries(
  Object.entries(ATTRIBUTE_TO_CANONICAL)
    .filter(([name, canonical]) => /[^\x00-\x7f]/.test(name) && name !== canonical && !DEPRECATED_CANONICAL_ATTRIBUTES.has(canonical))
    .map(([name, canonical]) => [canonical, name])
);

export const ATTRIBUTE_LABELS: Record<string, string> = {
  "x:Name": "名称", "x:DisplayName": "副名称", "x:Ref": "引用", Width: "宽度", Height: "高度", MinWidth: "最小宽度", MinHeight: "最小高度", MaxWidth: "最大宽度", MaxHeight: "最大高度", Margin: "外边距", Padding: "内边距", RowDefinitions: "行定义", ColumnDefinitions: "列定义", RowSpacing: "行间距", ColumnSpacing: "列间距", "Grid.Row": "网格.行", "Grid.Column": "网格.列", "Grid.RowSpan": "网格.跨行", "Grid.ColumnSpan": "网格.跨列", "Canvas.Left": "画布.左", "Canvas.Top": "画布.上", "Canvas.Right": "画布.右", "Canvas.Bottom": "画布.下", Background: "背景", Color: "颜色", Opacity: "不透明度", BorderRadius: "圆角", Variant: "样式", Text: "文本", Title: "标题", Subtitle: "副标题", FontSize: "字号", Click: "点击", Change: "变更", Close: "关闭", Disabled: "禁用", Value: "值", Max: "最大值", Min: "最小值", Test: "条件", In: "集合", Each: "项目", Path: "路径", Name: "插槽名", Error: "错误", Settings: "设置", Back: "返回", WeaponText: "武器文本", ArmorText: "护甲文本", SelectWeapon: "选择武器", SelectArmor: "选择护甲", CloseOnOverlay: "点击遮罩关闭", ShowCloseButton: "显示关闭按钮"
};

export type AttributeKind = "text" | "length" | "thickness" | "integer" | "tracks" | "enum";
export interface AttributeDefinition { kind: AttributeKind; options?: readonly string[]; tags?: readonly string[]; }

/** The one source of truth for inspector controls and both completion providers. */
export const ATTRIBUTE_DEFINITIONS: Record<string, AttributeDefinition> = {
  Width: { kind: "length" }, Height: { kind: "length" }, MinWidth: { kind: "length" }, MinHeight: { kind: "length" }, MaxWidth: { kind: "length" }, MaxHeight: { kind: "length" }, Margin: { kind: "thickness" }, Padding: { kind: "thickness" },
  RowDefinitions: { kind: "tracks", tags: ["Grid"] }, ColumnDefinitions: { kind: "tracks", tags: ["Grid"] }, RowSpacing: { kind: "length", tags: ["Grid"] }, ColumnSpacing: { kind: "length", tags: ["Grid"] }, "Grid.Row": { kind: "integer" }, "Grid.Column": { kind: "integer" }, "Grid.RowSpan": { kind: "integer" }, "Grid.ColumnSpan": { kind: "integer" }, "Canvas.Left": { kind: "length" }, "Canvas.Top": { kind: "length" }, "Canvas.Right": { kind: "length" }, "Canvas.Bottom": { kind: "length" },
  Variant: { kind: "enum", options: ["主要", "次要"] }, Disabled: { kind: "enum", options: ["是", "否"] }, CloseOnOverlay: { kind: "enum", options: ["是", "否"] }, ShowCloseButton: { kind: "enum", options: ["是", "否"] }
};

export function attributeDefinition(name: string): AttributeDefinition | undefined { return ATTRIBUTE_DEFINITIONS[canonicalAttribute(name)]; }
export function enumOptions(name: string): readonly string[] | undefined { return attributeDefinition(name)?.options; }

const ENUM_VALUE_ALIASES: Record<string, Record<string, string>> = {
  Variant: { primary: "主要", secondary: "次要" },
  Disabled: { true: "是", false: "否" },
  CloseOnOverlay: { true: "是", false: "否" },
  ShowCloseButton: { true: "是", false: "否" }
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
export function isBinding(value: string | undefined): boolean { return /^\{(?:绑定|Binding)\s+[A-Za-z][A-Za-z0-9_.-]*\}$/.test(value ?? ""); }
export function bindingPath(value: string | undefined): string | undefined { return /^\{(?:绑定|Binding)\s+([A-Za-z][A-Za-z0-9_.-]*)\}$/.exec(value ?? "")?.[1]; }
export function actionPath(value: string | undefined): string | undefined { return /^\{(?:动作|Action)\s+([A-Za-z][A-Za-z0-9_.-]*)\}$/.exec(value ?? "")?.[1]; }
export function isLegacyToken(name: string): boolean {
  const namespace = name.indexOf(":");
  const component = namespace > 0 && !name.startsWith("lui:") ? name.slice(namespace + 1) : "";
  return Boolean(TAG_TO_CANONICAL[name] && !/[^\x00-\x7f]/.test(name)) || Boolean(COMPONENT_NAME_TO_CANONICAL[component]) || Boolean(ATTRIBUTE_TO_CANONICAL[name] && !/[^\x00-\x7f]/.test(name));
}
