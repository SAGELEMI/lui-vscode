// Stamp the formal adapter before deployment. Never calculate a checksum from a game-side fork.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../packages/runtime-urhox-lua/adapter/", import.meta.url));
const path = join(root, "runtime-manifest.json");
const contractPath = fileURLToPath(new URL("../packages/spec/layout-contract.json", import.meta.url));
const contract = JSON.parse(await readFile(contractPath, "utf8"));
const luaString = (value) => JSON.stringify(value).replaceAll("\\u2028", "\\u{2028}").replaceAll("\\u2029", "\\u{2029}");
const toLua = (value, depth = 0) => {
  if (value === null) return "nil";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return luaString(value);
  const indentation = "    ".repeat(depth + 1);
  const close = "    ".repeat(depth);
  if (Array.isArray(value)) return `{ ${value.map((item) => toLua(item, depth + 1)).join(", ")} }`;
  return `{\n${Object.entries(value).map(([key, item]) => `${indentation}[${luaString(key)}] = ${toLua(item, depth + 1)},`).join("\n")}\n${close}}`;
};
await writeFile(join(root, "Contract.lua"), `-- 由 packages/spec/layout-contract.json 生成；不要在部署副本中手改。\nreturn ${toLua(contract)}\n`, "utf8");
const manifest = JSON.parse(await readFile(path, "utf8"));
manifest.version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
manifest.layoutContract = contract.version;
manifest.description = "Shared Studio/Runtime layout, rendering fidelity, component root, gradient and event conversion contract.";
manifest.revision = "native-overlay-explicit-text-stroke-live-props-20260906";
manifest.files = {};
for (const file of (await readdir(root)).filter((name) => name.endsWith(".lua")).sort()) {
  manifest.files[file] = createHash("sha256").update(await readFile(join(root, file))).digest("hex");
}
await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Stamped ${Object.keys(manifest.files).length} adapter files.`);
