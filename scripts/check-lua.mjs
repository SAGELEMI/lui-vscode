import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import luaparse from "luaparse";

const root = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!root) throw new Error("用法：node scripts/check-lua.mjs <项目根目录>");
const source = join(root, "scripts");

async function findLua(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== ".backup-last") out.push(...await findLua(full));
    else if (entry.name.endsWith(".lua")) out.push(full);
  }
  return out;
}

const failures = [];
for (const path of await findLua(source)) {
  try { luaparse.parse(await readFile(path, "utf8"), { luaVersion: "5.3", comments: false }); }
  catch (error) { failures.push(`${path}: ${error.message}`); }
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Lua syntax parsed: ${(await findLua(source)).length} files.`);
