import test from "node:test";
import assert from "node:assert/strict";
import sync from "../dist/sourceSync.cjs";

const { decideSaveResult, decideSourceEdit, decideSourcePatch, fromProtocolText, rebaseSourcePatch, shouldRetrySave, sourcePatch, toProtocolText } = sync;
const current = { source: "file:///Tower.lui", version: 7, text: "<Panel x:Name=\"Root\" />" };

test('multi-range CodeMirror transaction uses one base coordinate space', () => {
  const changes = [{ from: 0, to: 1, insert: '甲' }, { from: 4, to: 5, insert: '乙\r\n' }];
  assert.equal(sync.applySourceChanges('abcde', changes), '甲bcd乙\n');
  assert.throws(() => sync.applySourceChanges('abcde', [changes[1], changes[0]]));
  const mapped = sync.rebaseSourceChanges('abcde', 'prefixabcde', changes);
  assert.equal(sync.applySourceChanges('prefixabcde', mapped), 'prefix甲bcd乙\n');
  assert.equal(sync.rebaseSourceChanges('abcde', 'xbcde', changes), undefined);
});

test("native undo already reaching the pending target acknowledges noop despite a newer version", () => {
  const before = '<控件>\r\n<按钮 外边距="3" />\r\n</控件>';
  const after = '<控件>\n<按钮 />\n</控件>';
  const newer = { ...current, version: 12, text: after };
  assert.deepEqual(decideSourcePatch(newer, 7, before, sourcePatch(before, after)), { kind: 'noop' });
  assert.equal(decideSourcePatch(newer, 7, before, { from: -1, to: 0, insert: '' }).kind, 'reload');
  assert.equal(decideSourcePatch({ ...newer, version: 7, text: '<外部 />' }, 7, before, sourcePatch(before, after)).kind, 'reload');
});

test("embedded source editing applies only against the matching TextDocument version", () => {
  assert.deepEqual(decideSourceEdit(current, 7, "<Panel x:Name=\"Next\" />"), { kind: "apply" });
  assert.deepEqual(decideSourceEdit(current, 7, current.text), { kind: "noop" });
});

test("stale embedded source edits reload the host TextDocument instead of overwriting it", () => {
  assert.deepEqual(decideSourceEdit(current, 6, "<Panel x:Name=\"Stale\" />"), { kind: "reload", source: current });
});

test("incremental source patches accept the Studio's own version update but reject changed base text", () => {
  const patch = sourcePatch(current.text, "<Panel x:Name=\"Next\" />");
  assert.deepEqual(patch, { from: 15, to: 18, insert: "Nex" });
  assert.deepEqual(decideSourcePatch({ ...current, version: 8 }, 7, current.text, patch), { kind: "apply" });
  assert.deepEqual(decideSourcePatch({ ...current, version: 8, text: "<Panel x:Name=\"Else\" />" }, 7, current.text, patch), { kind: "reload", source: { ...current, version: 8, text: "<Panel x:Name=\"Else\" />" } });
});

test("non-overlapping external text is rebased while overlapping text remains a user conflict", () => {
  const base = "<页面>标题</页面>";
  const local = sourcePatch(base, "<页面>副标题</页面>");
  const externalPrefix = "<!-- 注释 -->\n";
  assert.deepEqual(rebaseSourcePatch(base, `${externalPrefix}${base}`, local), { from: local.from + externalPrefix.length, to: local.to + externalPrefix.length, insert: local.insert });
  assert.equal(rebaseSourcePatch(base, "<页面>外部标题</页面>", local), undefined);
});

test("the editor protocol canonicalizes CRLF and lone CR without changing trailing-newline intent", () => {
  assert.equal(toProtocolText("a\r\nb\rc"), "a\nb\nc");
  assert.equal(toProtocolText("a\r\n"), "a\n");
  assert.equal(toProtocolText("a"), "a");
});

test("protocol text round-trips through the document's existing EOL style", () => {
  assert.equal(fromProtocolText("a\nb\n", "\r\n"), "a\r\nb\r\n");
  assert.equal(fromProtocolText("a\r\nb", "\n"), "a\nb");
  assert.equal(fromProtocolText("a", "\r\n"), "a");
});

test("source decisions treat LF and CRLF as the same logical document", () => {
  const crlf = { ...current, text: "<页面>\r\n  <文本 />\r\n</页面>\r\n" };
  const lf = "<页面>\n  <文本 />\n</页面>\n";
  assert.deepEqual(decideSourceEdit(crlf, 7, lf), { kind: "noop" });
});

test("save classification accepts a native VS Code save that won the race", () => {
  assert.equal(decideSaveResult({ wasDirty: false, saveReturned: false, isDirtyAfter: false, diskMatches: true }), "noop");
  assert.equal(decideSaveResult({ wasDirty: true, saveReturned: true, isDirtyAfter: false, diskMatches: true }), "saved");
  assert.equal(decideSaveResult({ wasDirty: true, saveReturned: false, isDirtyAfter: false, diskMatches: true }), "noop");
  assert.equal(decideSaveResult({ wasDirty: true, saveReturned: false, isDirtyAfter: true, diskMatches: true }), "noop");
  assert.equal(decideSaveResult({ wasDirty: true, saveReturned: false, isDirtyAfter: true, diskMatches: false }), "failed");
  assert.equal(shouldRetrySave("failed", 7, 7), true);
  assert.equal(shouldRetrySave("failed", 8, 7), false);
  assert.equal(shouldRetrySave("noop", 7, 7), false);
});
