import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";

const targetArgument = process.argv[2];
if (!targetArgument) throw new Error("用法：node scripts/deploy-runtime.mjs <项目根目录>");
const projectRoot = resolve(targetArgument);
const scriptsRoot = join(projectRoot, "scripts");
if (!(await stat(scriptsRoot)).isDirectory()) throw new Error("目标不是包含 scripts 目录的项目：" + projectRoot);
const sourceRoot = resolve("packages/runtime-urhox-lua/adapter");
const targetRoot = join(scriptsRoot, "LUI");
const backupRoot = join(targetRoot, `.backup-${Date.now()}`);
const knownUuids = new Set();

async function scanMeta(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await scanMeta(full);
    else if (entry.name.endsWith(".meta")) {
      const value = /"uuid"\s*:\s*"([^"]+)"/.exec(await readFile(full, "utf8"))?.[1];
      if (value) knownUuids.add(value);
    }
  }
}

async function deployDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) { await deployDirectory(source); continue; }
    const rel = relative(sourceRoot, source);
    const destination = join(targetRoot, rel);
    await mkdir(dirname(destination), { recursive: true });
    const incoming = await readFile(source);
    let current;
    try { current = await readFile(destination); } catch { current = undefined; }
    if (rel === "lui.project.json" && current) continue;
    if (current && !current.equals(incoming)) {
      const backup = join(backupRoot, rel);
      await mkdir(dirname(backup), { recursive: true });
      await writeFile(backup, current);
    }
    if (!current || !current.equals(incoming)) await writeFile(destination, incoming);
    const meta = `${destination}.meta`;
    try { await stat(meta); } catch {
      let uuid = randomBytes(18).toString("base64url"); while (knownUuids.has(uuid)) uuid = randomBytes(18).toString("base64url");
      knownUuids.add(uuid);
      await writeFile(meta, JSON.stringify({ uuid }, null, 2) + "\n", "utf8");
    }
  }
}

async function ensureLuiMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) { await ensureLuiMetadata(full); continue; }
    if (!entry.name.endsWith(".LUI") && !entry.name.endsWith(".lui.lua")) continue;
    try { await stat(`${full}.meta`); continue; } catch {}
    let uuid = randomBytes(18).toString("base64url"); while (knownUuids.has(uuid)) uuid = randomBytes(18).toString("base64url");
    knownUuids.add(uuid);
    await writeFile(`${full}.meta`, JSON.stringify({ uuid }, null, 2) + "\n", "utf8");
  }
}

await scanMeta(scriptsRoot);
await deployDirectory(sourceRoot);
await ensureLuiMetadata(join(scriptsRoot, "Presentation"));
console.log(`已部署 LUI UrhoX/Lua 运行时：${targetRoot}`);
