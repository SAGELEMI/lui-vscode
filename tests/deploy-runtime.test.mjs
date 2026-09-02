import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const execFile = promisify(execFileCallback);
const deployScript = resolve("scripts/deploy-runtime.mjs");

test("runtime deployment retains exactly one current snapshot and leaves it untouched without a hash change", async () => {
  const project = await mkdtemp(join(tmpdir(), "lui-runtime-"));
  const runtime = join(project, "scripts", "LUI");
  try {
    await mkdir(join(project, "scripts", "Presentation"), { recursive: true });
    await mkdir(join(runtime, ".backup-100"), { recursive: true });
    await mkdir(join(runtime, ".backup-200"), { recursive: true });
    await writeFile(join(runtime, ".backup-100", "legacy.txt"), "older", "utf8");
    await writeFile(join(runtime, ".backup-200", "legacy.txt"), "newer", "utf8");
    await writeFile(join(runtime, "Runtime.lua"), "-- current local runtime\n", "utf8");

    await execFile(process.execPath, [deployScript, project], { cwd: resolve(".") });
    const firstEntries = (await readdir(runtime, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".backup-"))
      .map((entry) => entry.name);
    assert.deepEqual(firstEntries, [".backup-last"]);
    assert.equal(await readFile(join(runtime, ".backup-last", "Runtime.lua"), "utf8"), "-- current local runtime\n");

    await execFile(process.execPath, [deployScript, project], { cwd: resolve(".") });
    const secondEntries = (await readdir(runtime, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".backup-"))
      .map((entry) => entry.name);
    assert.deepEqual(secondEntries, [".backup-last"]);
    assert.equal(await readFile(join(runtime, ".backup-last", "Runtime.lua"), "utf8"), "-- current local runtime\n");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
