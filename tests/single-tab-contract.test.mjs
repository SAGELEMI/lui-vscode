import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the LUI custom editor has one tag and does not create a native editor group", async () => {
  const host = await readFile("src/extension.ts", "utf8");
  assert.match(host, /supportsMultipleEditorsPerDocument:\s*false/);
  for (const forbidden of ["splitEditorDown", "focusSecondEditorGroup", "showTextDocument", "type:'reveal'", 'type: "reveal"']) assert.doesNotMatch(host, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(host, /"sourceEdit"/);
  assert.match(host, /WorkspaceEdit/);
});
