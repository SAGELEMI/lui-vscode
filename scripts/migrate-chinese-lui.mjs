#!/usr/bin/env node
/**
 * One-way source migration used by LUI Studio 0.4 projects.
 * It changes only design vocabulary; ASCII values crossing into Lua remain intact.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const tagMap = {
  "lui:Page": "页面", "lui:Component": "组件", "lui:If": "条件", "lui:For": "重复项", "lui:Slot": "插槽", "lui:Preview": "预览", "lui:Set": "设值",
  Panel: "面板", Row: "横排", Text: "文本", Button: "按钮", Card: "卡片", Scroll: "滚动区", Progress: "进度条", Toggle: "开关", Slider: "滑块", SafeArea: "安全区", Modal: "弹窗", Section: "分区", Notice: "提示", Screen: "屏幕", FixedScreen: "固定屏幕"
};
const attributeMap = {
  "x:Name": "名称", "x:DisplayName": "副名称", "x:Ref": "引用",
  Width: "宽度", Height: "高度", MinWidth: "最小宽度", MinHeight: "最小高度", MaxWidth: "最大宽度", MaxHeight: "最大高度", Margin: "外边距", Padding: "内边距", Gap: "子项间距", Anchor: "锚点", Left: "左侧", Top: "顶部", Right: "右侧", Bottom: "底部", FlexGrow: "弹性增长", FlexBasis: "弹性基准", Align: "交叉轴对齐", Justify: "主轴对齐", Background: "背景", Color: "颜色", Opacity: "不透明度", BorderRadius: "圆角", Variant: "样式", Text: "文本", Title: "标题", Subtitle: "副标题", FontSize: "字号", Click: "点击", Change: "变更", Close: "关闭", Disabled: "禁用", Value: "值", Max: "最大值", Min: "最小值", Test: "条件", In: "集合", Each: "项目", Path: "路径", Error: "错误", Settings: "设置", Back: "返回", WeaponText: "武器文本", ArmorText: "护甲文本", SelectWeapon: "选择武器", SelectArmor: "选择护甲", CloseOnOverlay: "点击遮罩关闭", ShowCloseButton: "显示关闭按钮"
};
const componentMap = { Header: "页眉", EquipmentSlots: "装备槽", PageShell: "页面外壳", ScrollRegion: "滚动区域", InformationPanel: "信息面板", SelectionList: "选择列表", TabView: "页签视图" };

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function replaceTags(source, map) {
  for (const [from, to] of Object.entries(map).sort(([a], [b]) => b.length - a.length)) {
    source = source.replace(new RegExp(`(<\\s*/?\\s*)${escape(from)}(?=[\\s/>])`, "g"), `$1${to}`);
  }
  return source;
}
function replaceAttributes(source) {
  for (const [from, to] of Object.entries(attributeMap).sort(([a], [b]) => b.length - a.length)) {
    source = source.replace(new RegExp(`(^|\\s)${escape(from)}(?=\\s*=)`, "gm"), `$1${to}`);
  }
  return source;
}
function replaceComponentTags(source) {
  for (const [from, to] of Object.entries(componentMap).sort(([a], [b]) => b.length - a.length)) {
    source = source.replace(new RegExp(`(<\\s*/?\\s*[^\\s/>:]+:)${escape(from)}(?=[\\s/>])`, "g"), `$1${to}`);
  }
  return source;
}
function migrate(source) {
  let result = source.replace(/\s+xmlns:lui=("urn:lui"|'urn:lui')/g, "");
  result = result.replace(/\bxmlns:([^\s=]+)/g, "目录:$1");
  result = replaceTags(result, tagMap);
  result = replaceComponentTags(result);
  result = replaceAttributes(result);
  result = result.replaceAll("{Binding ", "{绑定 ").replaceAll("{Action ", "{动作 ");
  return result;
}
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(join(path, entry.name)) : entry.name.endsWith(".lui") ? [join(path, entry.name)] : []));
  return nested.flat();
}
const target = resolve(process.argv[2] ?? process.cwd());
const write = process.argv.includes("--write");
for (const file of await files(target)) {
  const before = await readFile(file, "utf8");
  const after = migrate(before);
  if (before === after) continue;
  if (write) await writeFile(file, after, "utf8");
  console.log(`${write ? "迁移" : "将迁移"} ${file}`);
}
