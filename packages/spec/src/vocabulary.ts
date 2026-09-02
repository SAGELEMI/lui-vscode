/**
 * Canonical LUI vocabulary. Source authors use the Chinese forms; the English
 * forms remain read-compatible so existing projects can migrate safely.
 */
export const TAG_TO_CANONICAL: Record<string, string> = {
  "页面": "lui:Page", "组件": "lui:Component", "条件": "lui:If", "循环": "lui:For", "插槽": "lui:Slot", "预览": "lui:Preview", "设值": "lui:Set",
  "面板": "Panel", "横排": "Row", "文本": "Text", "按钮": "Button", "卡片": "Card", "滚动区": "Scroll", "进度条": "Progress", "开关": "Toggle", "滑块": "Slider", "安全区": "SafeArea", "弹窗": "Modal", "分区": "Section", "提示": "Notice", "屏幕": "Screen", "固定屏幕": "FixedScreen",
  "lui:Page": "lui:Page", "lui:Component": "lui:Component", "lui:If": "lui:If", "lui:For": "lui:For", "lui:Slot": "lui:Slot", "lui:Preview": "lui:Preview", "lui:Set": "lui:Set",
  "Panel": "Panel", "Row": "Row", "Text": "Text", "Button": "Button", "Card": "Card", "Scroll": "Scroll", "Progress": "Progress", "Toggle": "Toggle", "Slider": "Slider", "SafeArea": "SafeArea", "Modal": "Modal", "Section": "Section", "Notice": "Notice", "Screen": "Screen", "FixedScreen": "FixedScreen"
};

export const CANONICAL_TO_TAG: Record<string, string> = Object.fromEntries(Object.entries(TAG_TO_CANONICAL).filter(([name, canonical]) => /[^\x00-\x7f]/.test(name) && name !== canonical).map(([name, canonical]) => [canonical, name]));

/** Public component names are directory-scoped in source, but share these default Chinese aliases. */
export const COMPONENT_NAME_TO_CANONICAL: Record<string, string> = {
  Header: "页眉", EquipmentSlots: "装备槽", PageShell: "页面外壳", ScrollRegion: "滚动区域", InformationPanel: "信息面板", SelectionList: "选择列表", TabView: "页签视图"
};

export const ATTRIBUTE_TO_CANONICAL: Record<string, string> = {
  "名称": "x:Name", "副名称": "x:DisplayName", "引用": "x:Ref",
  "宽度": "Width", "高度": "Height", "最小宽度": "MinWidth", "最小高度": "MinHeight", "最大宽度": "MaxWidth", "最大高度": "MaxHeight", "外边距": "Margin", "内边距": "Padding", "子项间距": "Gap", "锚点": "Anchor", "左侧": "Left", "顶部": "Top", "右侧": "Right", "底部": "Bottom", "弹性增长": "FlexGrow", "弹性基准": "FlexBasis", "交叉轴对齐": "Align", "主轴对齐": "Justify",
  "背景": "Background", "颜色": "Color", "不透明度": "Opacity", "圆角": "BorderRadius", "样式": "Variant", "文本": "Text", "标题": "Title", "副标题": "Subtitle", "字号": "FontSize", "点击": "Click", "变更": "Change", "关闭": "Close", "禁用": "Disabled", "值": "Value", "最大值": "Max", "最小值": "Min", "条件": "Test", "集合": "In", "项目": "Each", "路径": "Path", "错误": "Error", "设置": "Settings", "返回": "Back", "武器文本": "WeaponText", "护甲文本": "ArmorText", "选择武器": "SelectWeapon", "选择护甲": "SelectArmor", "点击遮罩关闭": "CloseOnOverlay", "显示关闭按钮": "ShowCloseButton",
  "x:Name": "x:Name", "x:DisplayName": "x:DisplayName", "x:Ref": "x:Ref", "Width": "Width", "Height": "Height", "MinWidth": "MinWidth", "MinHeight": "MinHeight", "MaxWidth": "MaxWidth", "MaxHeight": "MaxHeight", "Margin": "Margin", "Padding": "Padding", "Gap": "Gap", "Anchor": "Anchor", "Left": "Left", "Top": "Top", "Right": "Right", "Bottom": "Bottom", "FlexGrow": "FlexGrow", "FlexBasis": "FlexBasis", "Align": "Align", "Justify": "Justify", "Background": "Background", "Color": "Color", "Opacity": "Opacity", "BorderRadius": "BorderRadius", "Variant": "Variant", "Text": "Text", "Title": "Title", "Subtitle": "Subtitle", "FontSize": "FontSize", "Click": "Click", "Change": "Change", "Close": "Close", "Disabled": "Disabled", "Value": "Value", "Max": "Max", "Min": "Min", "Test": "Test", "In": "In", "Each": "Each", "Path": "Path", "Error": "Error", "Settings": "Settings", "Back": "Back", "WeaponText": "WeaponText", "ArmorText": "ArmorText", "SelectWeapon": "SelectWeapon", "SelectArmor": "SelectArmor", "CloseOnOverlay": "CloseOnOverlay", "ShowCloseButton": "ShowCloseButton"
};

export const CANONICAL_TO_ATTRIBUTE: Record<string, string> = Object.fromEntries(Object.entries(ATTRIBUTE_TO_CANONICAL).filter(([name, canonical]) => /[^\x00-\x7f]/.test(name) && name !== canonical).map(([name, canonical]) => [canonical, name]));

export const ATTRIBUTE_LABELS: Record<string, string> = {
  "x:Name": "名称", "x:DisplayName": "副名称", "x:Ref": "引用", Width: "宽度", Height: "高度", MinWidth: "最小宽度", MinHeight: "最小高度", MaxWidth: "最大宽度", MaxHeight: "最大高度", Margin: "外边距", Padding: "内边距", Gap: "子项间距", Anchor: "锚点", Left: "左侧", Top: "顶部", Right: "右侧", Bottom: "底部", FlexGrow: "弹性增长", FlexBasis: "弹性基准", Align: "交叉轴对齐", Justify: "主轴对齐", Background: "背景", Color: "颜色", Opacity: "不透明度", BorderRadius: "圆角", Variant: "样式", Text: "文本", Title: "标题", Subtitle: "副标题", FontSize: "字号", Click: "点击", Change: "变更", Close: "关闭", Disabled: "禁用", Value: "值", Max: "最大值", Min: "最小值", Test: "条件", In: "集合", Each: "项目", Path: "路径", Error: "错误", Settings: "设置", Back: "返回", WeaponText: "武器文本", ArmorText: "护甲文本", SelectWeapon: "选择武器", SelectArmor: "选择护甲", CloseOnOverlay: "点击遮罩关闭", ShowCloseButton: "显示关闭按钮"
};

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
