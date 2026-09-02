import test from "node:test";
import assert from "node:assert/strict";
import spec from "../dist/spec.cjs";
const { parseLui, editAttribute, displayNameOf } = spec;

test("LUI accepts UTF-8 display names while primary runtime names stay ASCII", () => {
  const doc = parseLui('<lui:Page x:Name="Tower" x:DisplayName="无尽塔"><Button x:Name="OpenSettings" x:DisplayName="打开设置" Text="设置" /></lui:Page>');
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(displayNameOf(doc.root.children[0]), "打开设置");
});

test("LUI rejects duplicate secondary names in one namespace", () => {
  const doc = parseLui('<lui:Page x:Name="Tower" x:DisplayName="无尽塔"><Panel x:Name="Panel" x:DisplayName="无尽塔" /></lui:Page>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("重复")));
});

test("property edits change only the selected attribute value", () => {
  const source = '<Panel x:Name="Root" x:DisplayName="根" Gap="8" />';
  const document = parseLui(source);
  assert.equal(editAttribute(source, document.root, "Gap", "10"), '<Panel x:Name="Root" x:DisplayName="根" Gap="10" />');
});

test("LUI parses comments and property-element syntax without weakening name validation", () => {
  const doc = parseLui('<!-- 设计备注 --><lui:Page x:Name="Cover" x:DisplayName="封面"><Button x:Name="EnterTower" x:DisplayName="进入塔" ><Button.Text>进入无尽塔</Button.Text></Button><lui:Preview x:Name="Default" x:DisplayName="默认状态" /></lui:Page>');
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(doc.root.children[0].tag, "Button");
});

test("Preview states provide Binding placeholders without touching the Lua backend", () => {
  const doc = parseLui('<lui:Page x:Name="Tower" x:DisplayName="无尽塔"><Text x:Name="Floor" x:DisplayName="层数" Text="{Binding floor}" /><lui:Preview x:Name="Battle" x:DisplayName="战斗预览"><lui:Set Path="floor" Value="第 12 层" /></lui:Preview></lui:Page>');
  const preview = doc.root.children.find((node) => node.tag === "lui:Preview");
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(preview?.attrs.find((item) => item.name === "x:DisplayName")?.value, "战斗预览");
  assert.equal(preview?.children[0]?.attrs.find((item) => item.name === "Value")?.value, "第 12 层");
});
