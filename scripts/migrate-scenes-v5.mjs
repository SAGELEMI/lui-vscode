import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";

const projectRoot = resolve(process.argv[2] ?? process.cwd());
const scriptsRoot = join(projectRoot, "scripts");
const configPath = join(scriptsRoot, "LUI", "lui.project.json");
const registryPath = join(scriptsRoot, "LUI", "Registry.lua");
const config = JSON.parse(await readFile(configPath, "utf8"));

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.name.endsWith(".lui")) result.push(path);
  }
  return result;
}

function migrateRoot(source) {
  const opening = /<(页面|lui:Page)(?=[\s>])/g;
  const match = opening.exec(source);
  if (!match) return source;
  const before = source.slice(0, match.index);
  if (before.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "").trim()) return source;
  const next = match[1] === "页面" ? "场景" : "lui:Scene";
  let migrated = source.slice(0, match.index + 1) + next + source.slice(match.index + 1 + match[1].length);
  const closing = match[1] === "页面" ? /<\/页面>\s*$/ : /<\/lui:Page>\s*$/;
  migrated = migrated.replace(closing, match[1] === "页面" ? "</场景>" : "</lui:Scene>");
  return migrated;
}

const roots = Array.isArray(config.sourceRoots) ? config.sourceRoots : ["Presentation"];
const all = [];
for (const sourceRoot of roots) {
  const directory = join(scriptsRoot, ...sourceRoot.split("/"));
  try { all.push(...await filesUnder(directory)); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
let changes = 0;
if (Number(config.schemaVersion ?? 1) < 5) {
  for (const path of [...new Set(all)]) {
    const source = await readFile(path, "utf8");
    const migrated = migrateRoot(source);
    if (migrated !== source) { await writeFile(path, migrated, "utf8"); changes += 1; }
  }
  config.schemaVersion = 5;
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

const descriptors = { scenes: [], pages: [], controls: [] };
const componentDirectories = Array.isArray(config.componentDirectories) ? config.componentDirectories : [];
for (const path of [...new Set(all)]) {
  const source = await readFile(path, "utf8");
  const root = /<(场景|页面|控件|组件|lui:Scene|lui:Page|lui:Component)(?=[\s>])([^>]*)>/.exec(source);
  if (!root) continue;
  const attr = (chinese, canonical) => new RegExp(`(?:${chinese}|${canonical})=["']([^"']+)["']`).exec(root[2])?.[1];
  const name = attr("名称", "x:Name");
  if (!name) throw new Error(`LUI 根缺少名称：${path}`);
  const displayName = attr("副名称", "x:DisplayName") ?? name;
  const markup = relative(scriptsRoot, path).replaceAll("\\", "/");
  const code = `${markup}.lua`;
  await stat(join(scriptsRoot, ...code.split("/")));
  const canonical = root[1].includes("Scene") || root[1] === "场景" ? "scenes" : root[1].includes("Page") || root[1] === "页面" ? "pages" : "controls";
  const directory = canonical === "controls" ? componentDirectories.find(value => markup.startsWith(`${value}/`)) : undefined;
  descriptors[canonical].push({ name, displayName, markup, code, directory });
}
for (const values of Object.values(descriptors)) values.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
const q = JSON.stringify;
const rows = values => values.map(item => `        [${q(item.name)}] = { name = ${q(item.name)}, displayName = ${q(item.displayName)},${item.directory ? ` directory = ${q(item.directory)},` : ""} markup = ${q(item.markup)}, code = ${q(item.code)} },`).join("\n");
const directoryRows = componentDirectories.map(directory => `        [${q(directory)}] = {\n${descriptors.controls.filter(item => item.directory === directory).map(item => `            [${q(item.displayName)}] = controls[${q(item.name)}],`).join("\n")}\n        },`).join("\n");
const registry = `-- 此文件由 LUI Studio 自动维护。不要手改；组件公开标签只来自 .lui 根副名称。\nlocal controls = {\n${rows(descriptors.controls)}\n    }\nlocal Registry = {\n    scenes = {\n${rows(descriptors.scenes)}\n    },\n    pages = {\n${rows(descriptors.pages)}\n    },\n    controls = controls,\n    directoryComponents = {\n${directoryRows}\n    },\n}\nfunction Registry:Get(name) return self.scenes[name] or self.pages[name] or self.controls[name] end\nfunction Registry:GetDirectoryComponent(directory, displayName) local entries=self.directoryComponents[directory]; return entries and entries[displayName] or nil end\nreturn Registry\n`;
await writeFile(registryPath, registry, "utf8");
console.log(`LUI schema 5 场景迁移完成：${changes} 个旧页面根已改为场景，注册表已重建。`);
