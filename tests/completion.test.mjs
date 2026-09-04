import test from "node:test";
import assert from "node:assert/strict";
import spec from "../dist/spec.cjs";

const { extractLuiActionSymbols, provideLuiCompletions } = spec;
const complete = (source, position = source.length, extra = {}) => provideLuiCompletions({ source, position, ...extra });

test('repeat items are canonical, keep nested scope and close with the current spelling', () => {
  assert.deepEqual(complete('<控件 名称="P"><重').map(c => c.label), ['重复项']);
  assert.ok(!complete('<控件 名称="P"><').some(c => c.label === '循环'));
  assert.ok(complete('<控件 名称="P"><重复项 ').some(c => c.label === '项目'));
  const prefix = '<控件 名称="P"><重复项 项目="outer" 集合="{绑定 view.rows}"><重复项 项目="inner" 集合="{绑定 outer.rows}">';
  assert.ok(complete(prefix+'<文本 文本="{绑定 inn').some(c => c.label==='inner.'));
  assert.ok(complete(prefix+'</重复项><文本 文本="{绑定 out').some(c => c.label==='outer.'));
  assert.ok(!complete(prefix+'</重复项><文本 文本="{绑定 inn').some(c => c.label==='inner.'));
});

test("completion limits root and child tags to their legal context", () => {
  assert.deepEqual(complete("<页").map((item) => item.label), ["页面"]);
  const children = complete('<页面 名称="塔" 宽度="390" 高度="844">\n  <文');
  assert.ok(children.some((item) => item.label === "文本"));
  assert.ok(!children.some((item) => item.label === "页面" || item.label === "控件"));
});

test("completion offers only legal missing attributes and their values", () => {
  const attributes = complete('<页面 名称="塔" 宽度="390" 高度="844" ');
  assert.ok(attributes.some((item) => item.label === "内边距"));
  assert.ok(!attributes.some((item) => item.label === "点击"));
  assert.ok(!attributes.some((item) => item.label === "名称"));
  const values = complete('<按钮 外观="高');
  assert.deepEqual(values.map((item) => item.label), ["高亮"]);
  const scrollAttributes = complete('<页面 名称="滚动" 宽度="390" 高度="844"><滚动区 ');
  assert.ok(scrollAttributes.some((item) => item.label === "水平滚动条可见性"));
  assert.ok(scrollAttributes.some((item) => item.label === "垂直滚动条可见性"));
  const scrollValues = complete('<页面 名称="滚动" 宽度="390" 高度="844"><滚动区 垂直滚动条可见性="显');
  assert.deepEqual(scrollValues.map((item) => item.label), ["显示"]);
});

test("completion keeps imports, bindings, actions and commands contextual", () => {
  const imported = complete("<积", 2, { imports: [{ alias: "积木", directory: "Presentation/Components", components: [{ name: "页眉", properties: ["Title"] }] }] });
  assert.deepEqual(imported.map((item) => item.label), ["积木:页眉"]);
  const binding = complete('<文本 文本="{绑定 vi');
  assert.ok(binding.some((item) => item.label === "view.path"));
  const options = complete('<文本 文本="{绑定 view.title, 模');
  assert.ok(options.some((item) => item.label === "模式"));
  const modeValues = complete('<文本 文本="{绑定 view.title, 模式=双');
  assert.deepEqual(modeValues.map((item) => item.label), ["双向"]);
  assert.ok(!binding.some((item) => item.label === "props."));
  const action = complete('<按钮 点击="{动作 Sa', undefined, { actions: ["Save", "Cancel"] });
  assert.deepEqual(action.map((item) => item.label), ["Save"]);
  const command = complete('<按钮 点击="{命令 导航, ');
  assert.ok(command.some((item) => item.label === "目标"));
});

test("completion results are dictionary-filtered and action extraction never evaluates Lua", () => {
  const candidates = complete("<文");
  assert.ok(candidates.every((item) => [item.label, ...item.aliases].some((value) => value.toLowerCase().includes("文"))));
  assert.deepEqual(extractLuiActionSymbols("return { actions = { Save = function() end, Cancel = function() end\n} }"), ["Cancel", "Save"]);
});
