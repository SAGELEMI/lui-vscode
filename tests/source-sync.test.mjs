import test from "node:test";
import assert from "node:assert/strict";
import sync from "../dist/sourceSync.cjs";

const { decideSourceEdit } = sync;
const current = { source: "file:///Tower.lui", version: 7, text: "<Panel x:Name=\"Root\" />" };

test("embedded source editing applies only against the matching TextDocument version", () => {
  assert.deepEqual(decideSourceEdit(current, 7, "<Panel x:Name=\"Next\" />"), { kind: "apply" });
  assert.deepEqual(decideSourceEdit(current, 7, current.text), { kind: "noop" });
});

test("stale embedded source edits reload the host TextDocument instead of overwriting it", () => {
  assert.deepEqual(decideSourceEdit(current, 6, "<Panel x:Name=\"Stale\" />"), { kind: "reload", source: current });
});
