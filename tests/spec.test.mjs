import test from "node:test";
import assert from "node:assert/strict";
import spec from "../dist/spec.cjs";
const { parseLui, editAttribute, editTag, displayNameOf, formatLui, namespaceImports } = spec;

test("LUI accepts UTF-8 design names and keeps the Lua boundary on ASCII x:Ref", () => {
  const doc = parseLui('<页面 目录:积木="Presentation/Components" 名称="塔内"><积木:页眉 名称="塔内页眉" /><进度条 名称="敌人血量" 引用="EnemyHp" /></页面>');
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(displayNameOf(doc.root.children[0]), "塔内页眉");
  assert.deepEqual(namespaceImports(doc).map((item) => [item.alias, item.directory]), [["积木", "Presentation/Components"]]);
});

test("LUI rejects duplicate design and secondary names in a document", () => {
  const doc = parseLui('<页面 名称="Tower" 副名称="无尽塔"><面板 名称="Panel" 副名称="无尽塔" /></页面>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("重复")));
});

test("property edits change only the selected attribute value", () => {
  const source = '<面板 名称="Root" 副名称="根" 子项间距="8" />';
  const document = parseLui(source);
  assert.equal(editAttribute(source, document.root, "Gap", "10"), '<面板 名称="Root" 副名称="根" 子项间距="10" />');
});

test("LUI parses comments and property-element syntax without weakening Lua reference validation", () => {
  const doc = parseLui('<!-- 设计备注 --><页面 名称="Cover" 副名称="封面"><按钮 名称="EnterTower" 副名称="进入塔" ><按钮.文本>进入无尽塔</按钮.文本></按钮><预览 名称="Default" 副名称="默认状态" /></页面>');
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(doc.root.children[0].tag, "按钮");
});

test("LUI rejects a UTF-8 x:Ref while leaving UTF-8 x:Name valid", () => {
  const doc = parseLui('<页面 名称="塔内"><进度条 名称="敌人血量" 引用="敌人血量" /></页面>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("引用必须是 ASCII")));
});

test("LUI reports an unimported component alias and formats valid UTF-8 documents", () => {
  const invalid = parseLui('<页面 名称="塔内"><积木:页眉 名称="页眉" /></页面>');
  assert.ok(invalid.diagnostics.some((item) => item.message.includes("未导入目录别名")));
  assert.equal(formatLui('<页面 名称="塔内"><文本 名称="标题" 文本="无尽塔" /></页面>'), '<页面 名称="塔内">\n  <文本 名称="标题" 文本="无尽塔" />\n</页面>\n');
});

test("Preview states provide Binding placeholders without touching the Lua backend", () => {
  const doc = parseLui('<页面 名称="Tower" 副名称="无尽塔"><文本 名称="Floor" 副名称="层数" 文本="{绑定 floor}" 预览.文本="第 13 层" /><预览 名称="Battle" 副名称="战斗预览"><设值 路径="floor" 值="第 12 层" /></预览></页面>');
  const preview = doc.root.children.find((node) => node.tag === "预览");
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(preview?.attrs.find((item) => item.name === "副名称")?.value, "战斗预览");
  assert.equal(preview?.children[0]?.attrs.find((item) => item.name === "值")?.value, "第 12 层");
});

test("legacy English markup stays readable with Chinese migration diagnostics", () => {
  const doc = parseLui('<lui:Page xmlns:lui="urn:lui" xmlns:积木="Presentation/Components" x:Name="Tower"><积木:Header x:Name="Header" /></lui:Page>');
  assert.ok(doc.diagnostics.some((item) => item.severity === "warning" && item.message.includes("目录:积木")));
  assert.ok(doc.diagnostics.some((item) => item.message.includes("<页面>")));
  assert.ok(doc.diagnostics.some((item) => item.message.includes("<积木:页眉>")));
});

test("tag edits update both Chinese opening and closing tags", () => {
  const source = '<面板 名称="Root"><文本 名称="Label" 文本="你好" /></面板>';
  const document = parseLui(source);
  assert.equal(editTag(source, document.root, "卡片"), '<卡片 名称="Root"><文本 名称="Label" 文本="你好" /></卡片>');
});
