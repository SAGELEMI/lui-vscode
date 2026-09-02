import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the LUI custom editor has one tag and does not create a native editor group", async () => {
  const host = await readFile("src/extension.ts", "utf8");
  const designer = await readFile("src/webview/designer.ts", "utf8");
  const html = await readFile("src/extension.ts", "utf8");
  assert.match(host, /supportsMultipleEditorsPerDocument:\s*false/);
  for (const forbidden of ["splitEditorDown", "focusSecondEditorGroup", "showTextDocument", "type:'reveal'", 'type: "reveal"']) assert.doesNotMatch(host, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(host, /"sourceEdit"/);
  assert.match(host, /WorkspaceEdit/);
  assert.doesNotMatch(html, /source-breadcrumb|source-status/);
  assert.match(designer, /function setupOutlineDivider/);
  assert.match(designer, /for \(const child of visualChildren\(node\)\) outline\(child, host, depth \+ 1\);/);
  assert.doesNotMatch(designer, /outline\(child, host, depth \+ 1, \[\.\.\.trace/);
});

test("the inspector exposes only applicable Chinese controls and preserves the Lua boundary", async () => {
  const designer = await readFile("src/webview/designer.ts", "utf8");
  const vocabulary = await readFile("packages/spec/src/vocabulary.ts", "utf8");
  assert.match(designer, /key !== "x:Ref"/);
  assert.match(designer, /definition\?\.kind === "enum"/);
  assert.match(designer, /function layoutResult/);
  assert.match(designer, /parentTag === "Grid"/);
  assert.match(designer, /parentTag === "Canvas"/);
  assert.match(vocabulary, /"网格": "Grid"/);
  assert.match(vocabulary, /"画布": "Canvas"/);
  assert.match(vocabulary, /"插槽名": "Name"/);
});
