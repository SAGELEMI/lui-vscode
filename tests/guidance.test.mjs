import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deployGuidance, guidanceEntries, matchesRuntime, digest } from "../scripts/lib/guidance.mjs";
import { guidanceNodeIO as io } from "../scripts/lib/guidance-node.mjs";
import { checkDocs } from "../scripts/check-docs.mjs";

const root = resolve(import.meta.dirname, "..");
const run = promisify(execFile);
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), "lui-guidance-"));
  t.after(async () => {
    assert.equal(dirname(folder), resolve(tmpdir()));
    assert.ok(folder.startsWith(join(tmpdir(), "lui-guidance-")));
    await rm(folder, { recursive: true, force: true });
  });
  return folder;
}

test("portable docs and skills keep all links after deployment and repeat without writes", async (t) => {
  const target = await fixture(t);
  const original = "\ufeff# 作者规则\r\n\r\n<!-- Maker managed policy -->\r\n保持业务配置\r\n";
  await writeFile(join(target, "AGENTS.md"), original, "utf8");
  const first = await deployGuidance(root, target, io);
  assert.equal(first.preserved.length, 0);
  assert.equal(first.updated.length, guidanceEntries().length + 1);
  const agents = await readFile(join(target, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith(original));
  assert.equal(agents.match(/LUI managed guidance >>>/g).length, 1);
  const checked = await checkDocs(target, true);
  assert.equal(checked.pairs, 3);
  assert.ok(checked.links > 60);
  const writes = [];
  await deployGuidance(root, target, { ...io, write: async (p, b) => { writes.push(p); await io.write(p, b); } });
  assert.deepEqual(writes, []);
});

test("upgrades replace only unchanged managed documents and preserve edits including navigation", async (t) => {
  const target = await fixture(t);
  await deployGuidance(root, target, io);
  const doc = join(target, "docs/lui/language.md");
  await writeFile(doc, "作者自己的语言笔记", "utf8");
  const agents = join(target, "AGENTS.md");
  const editedAgents = (await readFile(agents, "utf8")).replace("## LUI 使用入口", "## 作者的 LUI 入口");
  await writeFile(agents, editedAgents, "utf8");
  const changingIO = { ...io, read: async (p) => {
    const bytes = await io.read(p);
    if (p === join(root, "docs/layout.md")) return Buffer.concat([bytes, Buffer.from("\n新版资料\n")]);
    return bytes;
  } };
  const upgraded = await deployGuidance(root, target, changingIO);
  assert.ok(upgraded.preserved.includes("docs/lui/language.md"));
  assert.ok(upgraded.preserved.some((p) => p.startsWith("AGENTS.md")));
  assert.equal(await readFile(doc, "utf8"), "作者自己的语言笔记");
  assert.equal(await readFile(agents, "utf8"), editedAgents);
  assert.match(await readFile(join(target, "docs/lui/layout.md"), "utf8"), /新版资料/);
  const again = await deployGuidance(root, target, changingIO);
  assert.deepEqual(again.updated, []);
  assert.deepEqual(again.preserved, upgraded.preserved);
});

test("first deployment protects collisions and malformed navigation without adopting them", async (t) => {
  const target = await fixture(t);
  const skill = join(target, "skills/lui-authoring/SKILL.md");
  await io.write(skill, Buffer.from("user skill"));
  await io.write(join(target, "AGENTS.md"), Buffer.from("user\n<!-- >>> LUI managed guidance >>> -->\nunfinished"));
  const result = await deployGuidance(root, target, io);
  assert.equal(result.preserved.length, 2);
  assert.equal(await readFile(skill, "utf8"), "user skill");
  const state = JSON.parse(await readFile(join(target, "docs/lui/.delivery.json"), "utf8"));
  assert.equal(state.files["skills/lui-authoring/SKILL.md"], undefined);
});

test("missing packaged content or invalid delivery state fails before writing documents", async (t) => {
  const target = await fixture(t);
  let writes = 0;
  await assert.rejects(deployGuidance(root, target, { read: async (p) => p === join(root, "docs/layout.md") ? undefined : io.read(p), write: async () => writes++ }), /缺少文件/);
  assert.equal(writes, 0);
  await io.write(join(target, "docs/lui/.delivery.json"), Buffer.from('{"schemaVersion":2,"files":{}}'));
  await assert.rejects(deployGuidance(root, target, { ...io, write: async () => writes++ }), /交付记录无效/);
  assert.equal(writes, 0);
});

test("version status uses the shipped manifest and rejects stale or modified manifests", () => {
  const expected = Buffer.from(JSON.stringify({ version: "9.8.7", layoutContract: "contract" }));
  const config = { version: "9.8.7", layoutContract: "contract", runtimeManifestHash: digest(expected) };
  assert.ok(matchesRuntime(config, expected, expected));
  for (const patch of [{ version: "2.4.0" }, { layoutContract: "old" }, { runtimeManifestHash: "stale" }]) assert.equal(matchesRuntime({ ...config, ...patch }, expected, expected), false);
  const modified = Buffer.from(JSON.stringify({ version: "9.8.7", layoutContract: "contract", edited: true }));
  assert.equal(matchesRuntime({ ...config, runtimeManifestHash: digest(modified) }, modified, expected), false);
});

test("CLI deploy works outside repository cwd and preserves project config, source and metadata", async (t) => {
  const target = await fixture(t);
  const runtime = join(target, "scripts/LUI");
  await mkdir(runtime, { recursive: true });
  const config = { schemaVersion: 3, sourceRoots: ["Custom"], componentDirectories: { Custom: { Existing: "Custom/Existing.lui" } }, author: "keep" };
  await io.write(join(runtime, "lui.project.json"), Buffer.from(JSON.stringify(config)));
  await io.write(join(runtime, "Runtime.lua.meta"), Buffer.from('{"uuid":"keep-uuid"}'));
  await io.write(join(target, "scripts/Custom/Existing.lui"), Buffer.from("author markup"));
  const command = [join(root, "scripts/deploy-runtime.mjs"), target];
  await run(process.execPath, command, { cwd: tmpdir() });
  await run(process.execPath, command, { cwd: tmpdir() });
  const actual = JSON.parse(await readFile(join(runtime, "lui.project.json"), "utf8"));
  assert.deepEqual(actual.sourceRoots, config.sourceRoots);
  assert.deepEqual(actual.componentDirectories, config.componentDirectories);
  assert.equal(actual.author, "keep");
  assert.equal(await readFile(join(runtime, "Runtime.lua.meta"), "utf8"), '{"uuid":"keep-uuid"}');
  assert.equal(await readFile(join(target, "scripts/Custom/Existing.lui"), "utf8"), "author markup");
  assert.ok(matchesRuntime(actual, await readFile(join(runtime, "runtime-manifest.json")), await readFile(join(root, "runtime/urhox-lua/runtime-manifest.json"))));
  await checkDocs(target, true);
});

async function extensionHarness(target) {
  const messages = [];
  class FileSystemError extends Error { constructor(code) { super(code); this.code = code; } }
  const Uri = { file: (p) => ({ fsPath: resolve(p) }), joinPath: (p, ...parts) => Uri.file(join(p.fsPath, ...parts)) };
  const vscode = {
    Uri, FileSystemError, FileType: { File: 1, Directory: 2 },
    workspace: {
      workspaceFolders: [{ uri: Uri.file(target) }],
      fs: {
        readFile: async (u) => { try { return await readFile(u.fsPath); } catch (e) { if (e.code === "ENOENT") throw new FileSystemError("FileNotFound"); throw e; } },
        writeFile: (u, b) => writeFile(u.fsPath, b), createDirectory: (u) => mkdir(u.fsPath, { recursive: true }),
        stat: (u) => stat(u.fsPath),
        readDirectory: async (u) => (await readdir(u.fsPath, { withFileTypes: true })).map((e) => [e.name, e.isDirectory() ? 2 : 1]),
        delete: async (u) => { assert.ok(u.fsPath.startsWith(target)); await rm(u.fsPath, { recursive: true, force: true }); },
      },
    },
    window: {
      showInformationMessage: async (message, ...choices) => { messages.push(message); return choices.includes("部署") ? "部署" : undefined; },
      showWarningMessage: async (message) => { messages.push(message); },
    },
  };
  const require = createRequire(join(root, "dist/extension.cjs"));
  const module = { exports: {} };
  runInNewContext(await readFile(join(root, "dist/extension.cjs"), "utf8"), { module, exports: module.exports, require: (id) => id === "vscode" ? vscode : require(id), Buffer, console, setTimeout, clearTimeout });
  return { api: module.exports, context: { extensionUri: Uri.file(root) }, Uri, messages };
}

test("production extension deploy delivers the same bundle via workspace.fs and reports real status", async (t) => {
  const target = await fixture(t);
  await io.write(join(target, "AGENTS.md"), Buffer.from("original policy\n"));
  await io.write(join(target, "scripts/LUI/lui.project.json"), Buffer.from(JSON.stringify({ schemaVersion: 3, sourceRoots: ["Custom"], componentDirectories: {}, author: "keep" })));
  await io.write(join(target, "scripts/LUI/Runtime.lua.meta"), Buffer.from('{"uuid":"keep-extension"}'));
  const h = await extensionHarness(target);
  await h.api.deployUrhoXLuaRuntime(h.context);
  await h.api.deployUrhoXLuaRuntime(h.context);
  await checkDocs(target, true);
  const config = JSON.parse(await readFile(join(target, "scripts/LUI/lui.project.json"), "utf8"));
  assert.equal(config.author, "keep");
  assert.deepEqual(config.sourceRoots, ["Custom"]);
  assert.equal(await readFile(join(target, "scripts/LUI/Runtime.lua.meta"), "utf8"), '{"uuid":"keep-extension"}');
  const expected = h.Uri.file(join(root, "runtime/urhox-lua/runtime-manifest.json"));
  const status = await h.api.runtimeStatus(h.Uri.file(target), expected);
  assert.match(status.message, /已部署且版本匹配/);
  await io.write(join(target, "scripts/LUI/runtime-manifest.json"), Buffer.from("invalid json"));
  assert.match((await h.api.runtimeStatus(h.Uri.file(target), expected)).message, /无法解析/);
});
