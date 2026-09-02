import test from "node:test";
import assert from "node:assert/strict";
import spec from "../dist/spec.cjs";
const { parseLui, editAttribute, displayNameOf, formatLui, namespaceImports } = spec;

test("LUI accepts UTF-8 design names and keeps the Lua boundary on ASCII x:Ref", () => {
  const doc = parseLui('<lui:Page xmlns:lui="urn:lui" xmlns:积木="Presentation/Components" x:Name="塔内"><积木:Header x:Name="塔内页眉" /><Progress x:Name="敌人血量" x:Ref="EnemyHp" /></lui:Page>');
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(displayNameOf(doc.root.children[0]), "塔内页眉");
  assert.deepEqual(namespaceImports(doc).map((item) => [item.alias, item.directory]), [["积木", "Presentation/Components"]]);
});

test("LUI rejects duplicate design and secondary names in a document", () => {
  const doc = parseLui('<lui:Page x:Name="Tower" x:DisplayName="无尽塔"><Panel x:Name="Panel" x:DisplayName="无尽塔" /></lui:Page>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("重复")));
});

test("property edits change only the selected attribute value", () => {
  const source = '<Panel x:Name="Root" x:DisplayName="根" Gap="8" />';
  const document = parseLui(source);
  assert.equal(editAttribute(source, document.root, "Gap", "10"), '<Panel x:Name="Root" x:DisplayName="根" Gap="10" />');
});

test("LUI parses comments and property-element syntax without weakening Lua reference validation", () => {
  const doc = parseLui('<!-- 设计备注 --><lui:Page x:Name="Cover" x:DisplayName="封面"><Button x:Name="EnterTower" x:DisplayName="进入塔" ><Button.Text>进入无尽塔</Button.Text></Button><lui:Preview x:Name="Default" x:DisplayName="默认状态" /></lui:Page>');
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(doc.root.children[0].tag, "Button");
});

test("LUI rejects a UTF-8 x:Ref while leaving UTF-8 x:Name valid", () => {
  const doc = parseLui('<lui:Page xmlns:lui="urn:lui" x:Name="塔内"><Progress x:Name="敌人血量" x:Ref="敌人血量" /></lui:Page>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("x:Ref 必须是 ASCII")));
});

test("LUI reports an unimported component alias and formats valid UTF-8 documents", () => {
  const invalid = parseLui('<lui:Page xmlns:lui="urn:lui" x:Name="塔内"><积木:Header x:Name="页眉" /></lui:Page>');
  assert.ok(invalid.diagnostics.some((item) => item.message.includes("未导入目录别名")));
  assert.equal(formatLui('<lui:Page xmlns:lui="urn:lui" x:Name="塔内"><Text x:Name="标题" Text="无尽塔" /></lui:Page>'), '<lui:Page xmlns:lui="urn:lui" x:Name="塔内">\n  <Text x:Name="标题" Text="无尽塔" />\n</lui:Page>\n');
});

test("Preview states provide Binding placeholders without touching the Lua backend", () => {
  const doc = parseLui('<lui:Page x:Name="Tower" x:DisplayName="无尽塔"><Text x:Name="Floor" x:DisplayName="层数" Text="{Binding floor}" /><lui:Preview x:Name="Battle" x:DisplayName="战斗预览"><lui:Set Path="floor" Value="第 12 层" /></lui:Preview></lui:Page>');
  const preview = doc.root.children.find((node) => node.tag === "lui:Preview");
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(preview?.attrs.find((item) => item.name === "x:DisplayName")?.value, "战斗预览");
  assert.equal(preview?.children[0]?.attrs.find((item) => item.name === "Value")?.value, "第 12 层");
});
