#!/usr/bin/env node
/**
 * One-way LUI 0.8 migration for existing design files.
 * It deliberately changes only markup: the paired .lui.lua view-model remains
 * the owner of data and actions.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(["'])(.*?)\2/g;
const BINDING = /^\{绑定\s+([^,}\s]+)\s*\}$/;

async function luiFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? luiFiles(join(directory, entry.name))
    : entry.name.endsWith(".lui") ? [join(directory, entry.name)] : []));
  return nested.flat();
}

function viewPath(path) {
  return /^(view|props|item)\./.test(path) ? path : `view.${path}`;
}

function binding(value, preview) {
  const match = BINDING.exec(value);
  if (!match) return value;
  const previewPart = preview === undefined ? "" : `, 预览内容='${preview.replaceAll("'", "\\'")}'`;
  return `{绑定 ${viewPath(match[1])}, 模式=单向, 更新源触发=默认${previewPart}}`;
}

function migrateTag(full, body) {
  const closing = /\/$/.test(body.trim());
  const name = /^\s*([^\s/>]+)/.exec(body)?.[1];
  if (!name) return full;
  const attrs = [];
  for (const match of body.matchAll(ATTRIBUTE)) attrs.push({ name: match[1], value: match[3], quote: match[2] });
  if (!attrs.length) return full;
  const preview = new Map();
  for (const attr of attrs) if (attr.name.startsWith("预览.")) preview.set(attr.name.slice(3), attr.value);
  const migrated = attrs
    .filter((attr) => !attr.name.startsWith("预览."))
    .map((attr) => {
      const oldName = attr.name;
      const name = oldName === "样式" ? "外观" : oldName;
      let value = attr.value;
      if (name === "外观") value = value === "主要" ? "高亮" : value === "次要" ? "常规" : value;
      const previewValue = preview.get(oldName) ?? preview.get(name);
      if (BINDING.test(value)) value = binding(value, previewValue);
      return `${name}=${attr.quote}${value}${attr.quote}`;
    });
  return `<${name}${migrated.length ? ` ${migrated.join(" ")}` : ""}${closing ? " /" : ""}>`;
}

function attributes(body) {
  return [...body.matchAll(ATTRIBUTE)].map((match) => ({ name: match[1], value: match[3], quote: match[2] }));
}

function opening(tag, attrs, selfClosing = false) {
  return `<${tag}${attrs.length ? ` ${attrs.map((attr) => `${attr.name}=${attr.quote ?? '"'}${attr.value}${attr.quote ?? '"'}`).join(" ")}` : ""}${selfClosing ? " /" : ""}>`;
}

function setAttribute(attrs, name, value) {
  const item = attrs.find((attr) => attr.name === name);
  if (item) item.value = value; else attrs.push({ name, value, quote: '"' });
}

function takeAttribute(attrs, name) {
  const index = attrs.findIndex((attr) => attr.name === name);
  return index < 0 ? undefined : attrs.splice(index, 1)[0];
}

function migrateRoots(source) {
  // Old page roots delegated their design surface to a full-size Grid.  The
  // new root owns that surface, so padding becomes scaled page padding while
  // the direct layout root keeps only its layout-specific declarations.
  let result = source.replace(/<页面([^>]*)>(\s*)<(网格|画布|堆叠面板|换行面板|停靠面板|均分网格|边框|内容控件|滚动查看器)([^>]*)>/g, (_all, pageBody, spacing, tag, layoutBody) => {
    const page = attributes(pageBody); const layout = attributes(layoutBody);
    setAttribute(page, "宽度", page.find((item) => item.name === "宽度")?.value || "390");
    setAttribute(page, "高度", page.find((item) => item.name === "高度")?.value || "844");
    setAttribute(page, "裁剪超出", page.find((item) => item.name === "裁剪超出")?.value || "是");
    const padding = takeAttribute(layout, "内边距"); if (padding && !page.some((item) => item.name === "内边距")) page.push(padding);
    for (const name of ["宽度", "高度"]) {
      const item = layout.find((attr) => attr.name === name);
      if (item?.value === "100%") takeAttribute(layout, name);
    }
    return `${opening("页面", page)}${spacing}${opening(tag, layout)}`;
  });
  // A custom control has no device host.  PageShell was the only legacy
  // component with a SafeArea wrapper; unwrap it and move its surface sizing
  // to the control root.  Other direct grids can likewise declare root size.
  result = result.replace(/<控件([^>]*)>(\s*)<安全区[^>]*>(\s*)<(网格)([^>]*)>([\s\S]*?)<\/网格>\s*<\/安全区>/g, (_all, controlBody, before, between, tag, layoutBody, children) => {
    const control = attributes(controlBody); const layout = attributes(layoutBody);
    for (const name of ["宽度", "高度", "内边距"]) { const item = takeAttribute(layout, name); if (item && !control.some((attr) => attr.name === name)) control.push(item); }
    return `${opening("控件", control)}${before}${between}${opening(tag, layout)}${children}</网格>`;
  });
  result = result.replace(/<控件([^>]*)>(\s*)<网格([^>]*)>/g, (_all, controlBody, spacing, gridBody) => {
    const control = attributes(controlBody); const grid = attributes(gridBody);
    for (const name of ["宽度", "高度", "内边距"]) {
      const item = takeAttribute(grid, name);
      if (item && !control.some((attr) => attr.name === name)) control.push(item);
    }
    return `${opening("控件", control)}${spacing}${opening("网格", grid)}`;
  });
  result = result.replace(/<页面([^>]*)>/g, (_all, pageBody) => {
    const page = attributes(pageBody);
    setAttribute(page, "宽度", page.find((item) => item.name === "宽度")?.value || "390");
    setAttribute(page, "高度", page.find((item) => item.name === "高度")?.value || "844");
    setAttribute(page, "裁剪超出", page.find((item) => item.name === "裁剪超出")?.value || "是");
    return opening("页面", page);
  });
  return result;
}

function migrate(source) {
  // Existing project markup has no raw '<' in an attribute value.  Keeping the
  // surrounding tag intact also preserves comments and literal text nodes.
  let result = source.replace(/<(?![!/])([^<>]*)>/g, (full, body) => migrateTag(full, body));
  // WPF-style pages receive SafeArea from Runtime. Existing Viewbox roots are
  // unwrapped without altering their authored inner Grid/Canvas layout.
  result = result.replace(/<页面([^>]*)>\s*<安全区[^>]*>\s*<视图框[^>]*>([\s\S]*?)<\/视图框>\s*<\/安全区>/g, "<页面$1>$2");
  result = result.replace(/<组件(?=[\s>])/g, "<控件").replace(/<\/组件>/g, "</控件>");
  result = result.replace(/<插槽(?=[\s/>])([^>]*)\/>/g, (_all, attributes) => `<内容呈现器${attributes.replace(/\s+插槽名=(['"])Content\1/, "")} />`);
  // A legacy transparent condition becomes WPF Visibility on its direct
  // visual child. Existing project conditions have one direct child.
  result = result.replace(/<条件\s+条件=(['"])(.*?)\1>\s*(<[^/!][^\s/>]*)([^>]*>)/g, (_all, quote, test, child, rest) => {
    const selfClosing = /\/\s*>$/.test(rest); const open = rest.replace(/\s*\/?>$/, "");
    return `${child}${open} 可见性=${quote}{绑定 ${test.replace(/^\{绑定\s+|\}$/g, "").split(",")[0].trim()}, 模式=单向, 更新源触发=默认}${quote}${selfClosing ? " />" : ">"}`;
  });
  result = result.replace(/<\/条件>/g, "");
  return migrateRoots(result);
}

const target = resolve(process.argv[2] ?? process.cwd());
const write = process.argv.includes("--write");
let changed = 0;
for (const file of await luiFiles(target)) {
  const before = await readFile(file, "utf8"); const after = migrate(before);
  if (before === after) continue;
  changed += 1;
  if (write) await writeFile(file, after, "utf8");
  console.log(`${write ? "已迁移" : "将迁移"} ${file}`);
}
console.log(`LUI 0.8 迁移${write ? "完成" : "预览"}：${changed} 个文件。`);
