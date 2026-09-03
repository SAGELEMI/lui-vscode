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
  return result;
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
