import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";

const targetArgument = process.argv[2];
if (!targetArgument) throw new Error("用法：node scripts/deploy-runtime.mjs <项目根目录>");
const projectRoot = resolve(targetArgument);
const scriptsRoot = join(projectRoot, "scripts");
if (!(await stat(scriptsRoot)).isDirectory()) throw new Error("目标不是包含 scripts 目录的项目：" + projectRoot);
const sourceRoot = resolve("packages/runtime-urhox-lua/adapter");
const targetRoot = join(scriptsRoot, "LUI");
const backupRoot = join(targetRoot, ".backup-last");
const knownUuids = new Set();
let backupPrepared = false;

async function pathExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function consolidateLegacyBackups() {
  if (!(await pathExists(targetRoot))) return;
  const entries = await readdir(targetRoot, { withFileTypes: true });
  const legacy = entries.filter((entry) => entry.isDirectory() && /^\.backup-\d+$/.test(entry.name)).map((entry) => entry.name).sort();
  if (legacy.length === 0) return;
  const latest = legacy[legacy.length - 1];
  if (!(await pathExists(backupRoot))) await rename(join(targetRoot, latest), backupRoot);
  for (const name of legacy) {
    const folder = join(targetRoot, name);
    if (await pathExists(folder)) await rm(folder, { recursive: true, force: true });
  }
}

async function snapshotCurrentRuntime(directory = sourceRoot) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) { await snapshotCurrentRuntime(source); continue; }
    const rel = relative(sourceRoot, source);
    // Project configuration belongs to the game author and is never deployed or backed up.
    if (rel === "lui.project.json") continue;
    const current = join(targetRoot, rel);
    if (!(await pathExists(current))) continue;
    const backup = join(backupRoot, rel);
    await mkdir(dirname(backup), { recursive: true });
    await copyFile(current, backup);
  }
}

async function prepareBackup() {
  if (backupPrepared) return;
  await rm(backupRoot, { recursive: true, force: true });
  await snapshotCurrentRuntime();
  backupPrepared = true;
}

// Older releases recorded only the files changed by one deploy. A missing file
// in that snapshot is unchanged from the immediately preceding runtime, so the
// current copy is the correct value to complete the one recoverable snapshot.
async function completeBackup(directory = sourceRoot) {
  if (!(await pathExists(backupRoot))) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) { await completeBackup(source); continue; }
    const rel = relative(sourceRoot, source);
    if (rel === "lui.project.json") continue;
    const current = join(targetRoot, rel);
    const backup = join(backupRoot, rel);
    if ((await pathExists(current)) && !(await pathExists(backup))) {
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(current, backup);
    }
  }
}

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
    if (!current || !current.equals(incoming)) {
      await prepareBackup();
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
    if (!entry.name.endsWith(".lui") && !entry.name.endsWith(".lui.lua")) continue;
    try { await stat(`${full}.meta`); continue; } catch {}
    let uuid = randomBytes(18).toString("base64url"); while (knownUuids.has(uuid)) uuid = randomBytes(18).toString("base64url");
    knownUuids.add(uuid);
    await writeFile(`${full}.meta`, JSON.stringify({ uuid }, null, 2) + "\n", "utf8");
  }
}

await scanMeta(scriptsRoot);
await consolidateLegacyBackups();
await deployDirectory(sourceRoot);
if (!backupPrepared) await completeBackup();
await ensureLuiMetadata(join(scriptsRoot, "Presentation"));
console.log(`已部署 LUI UrhoX/Lua 运行时：${targetRoot}`);
