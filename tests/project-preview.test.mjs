import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Studio keeps single-file editing schematic and exposes one project run entry", async () => {
  const extension = await readFile("src/extension.ts", "utf8");
  const designer = await readFile("src/webview/designer.ts", "utf8");
  const manifest = JSON.parse(await readFile("package.json", "utf8"));

  assert.match(extension, /id="preview-kind">结构示意</);
  assert.match(extension, /id="run">运行</);
  assert.doesNotMatch(extension, /id="preview-backend"|id="preview-scene"|id="engine-frame"|打开隔离预览窗口/);
  assert.match(designer, /previewScope=\{\}/);
  assert.doesNotMatch(designer, /scenePresets|defaultScene|previewScenes/);
  assert.match(designer, /renderNode\(model\.root,\s*previewScope\)/);
  assert.match(designer, /type:\s*["']runProject["']/);
  assert.doesNotMatch(designer, /setInterval|engineSnapshot|openEngine|engineReady/);
  assert.ok(manifest.contributes.commands.some(command => command.command === "lui.runProjectPreview"));
  assert.ok(manifest.contributes.commands.some(command => command.command === "lui.refreshProjectPreview"));
});

test("project preview owns device sizing, manual refresh and click-only source picking", async () => {
  const host = await readFile("src/projectPreviewHost.ts", "utf8");
  const extension = await readFile("src/extension.ts", "utf8");

  for (const device of ["358x425", "377x496", "360x800", "390x844", "640x1024", "768x1024"]) {
    assert.match(host, new RegExp(device));
  }
  assert.match(host, /device: input\.device \?\? "390x844"/);
  assert.match(host, /device\.onchange=.*startFrame/);
  assert.match(host, /next\.width=String\(width\).*next\.height=String\(height\)/s);
  assert.match(host, /refreshButton\.onclick/);
  assert.match(host, /if\(!selecting&&!event\.altKey\)return/);
  assert.match(host, /new EventSource\('events'\)/);
  assert.doesNotMatch(host, /setInterval/);
  assert.match(extension, /get<string>\("preview\.defaultDevice", "390x844"\)/);
  assert.match(extension, /vscode\.openWith/);
  assert.match(extension, /if \(this\.host && this\.root\?\.toString\(\) === root\.toString\(\)\) \{ this\.host\.reveal\(\); return; \}/);
});
