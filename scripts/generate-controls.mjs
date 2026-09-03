import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(resolve(root, "packages/spec/controls.json"), "utf8"));
const controls = catalog.controls;
const ts = `// Generated from packages/spec/controls.json. Do not edit by hand.\nexport interface LuiControlDefinition { tag: string; name: string; ui: string; category: string; children?: boolean; bindable?: string; events?: readonly string[]; }\nexport const UI_CONTROL_DEFINITIONS: readonly LuiControlDefinition[] = ${JSON.stringify(controls, null, 2)} as const;\nexport const UI_CONTROL_BY_TAG = Object.fromEntries(UI_CONTROL_DEFINITIONS.map((item) => [item.tag, item]));\nexport const UI_CONTROL_BY_NAME = Object.fromEntries(UI_CONTROL_DEFINITIONS.map((item) => [item.name, item]));\n`;
const luaRows = controls.map((item) => `    ${item.tag} = { name = ${JSON.stringify(item.name)}, ui = ${JSON.stringify(item.ui)}, category = ${JSON.stringify(item.category)}, children = ${item.children === true ? "true" : "false"}, bindable = ${item.bindable ? JSON.stringify(item.bindable) : "nil"}, events = { ${((item.events ?? []).map((event) => JSON.stringify(event))).join(", ")} } },`).join("\n");
const lua = `-- Generated from packages/spec/controls.json. Do not edit by hand.\nreturn {\n${luaRows}\n}\n`;
await writeFile(resolve(root, "packages/spec/src/generated-controls.ts"), ts, "utf8");
await writeFile(resolve(root, "packages/runtime-urhox-lua/adapter/Controls.lua"), lua, "utf8");
