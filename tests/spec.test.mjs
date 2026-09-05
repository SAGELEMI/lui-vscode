import test from "node:test";
import assert from "node:assert/strict";
import spec from "../dist/spec.cjs";
const { UI_CONTROL_DEFINITIONS, parseBinding, parseLui, editAttribute, editTag, removeAttribute, displayNameOf, formatLui, namespaceImports, normalizeLuiAttributes } = spec;

test('button caption alignment supports nine positions, completion and source edits', () => {
  for (const x of ['左','居中','右']) for (const y of ['上','居中','下']) {
    const source=`<控件 名称="C"><按钮 文本="标题" 文字左右对齐="${x}" 文字上下对齐="${y}" /></控件>`;
    assert.deepEqual(parseLui(source).diagnostics.filter(d=>d.severity==='error'),[]);
    assert.ok(editAttribute(source,parseLui(source).root.children[0],'TextHorizontalAlignment','右').includes('文字左右对齐="右"'));
  }
  assert.ok(parseLui('<控件 名称="C"><按钮 文字左右对齐="上" /></控件>').diagnostics.some(d=>d.severity==='error'));
  assert.ok(parseLui('<控件 名称="C"><按钮 文字上下对齐="右" /></控件>').diagnostics.some(d=>d.severity==='error'));
  const source='<控件 名称="C"><按钮 文字左右对齐="';
  const choices=spec.provideLuiCompletions({source,position:source.length});
  for(const label of ['左','居中','右']) assert.ok(choices.some(c=>c.label===label));
});

test('legacy loops warn while repeat items remain transparent template nodes', () => {
  const source='<控件 名称="P"><容器><重复项 项目="row" 集合="{绑定 view.rows}"><文本 文本="{绑定 row.label}" /></重复项></容器></控件>';
  assert.equal(parseLui(source).diagnostics.filter(d=>d.severity==='error').length,0);
  const old=source.replaceAll('重复项','循环');
  assert.ok(parseLui(old).diagnostics.some(d=>d.message.includes('已改名')));
  assert.equal(parseLui(old).diagnostics.filter(d=>d.severity==='error').length,0);
});

test("2.3.2 migration preserves spelling, CRLF, comments, unrelated attributes and is idempotent", () => {
  const source = '<控件 名称="P" 外边距="1,2,3,4">\r\n<!-- 水平对齐="右" -->\r\n<容器 水平对齐=\'右\' 垂直对齐="上"><文本 文本=\'水平对齐="左"\' 垂直对齐="{绑定 props.Align}" /></容器></控件>';
  const result = spec.migrateAlignmentAxes(source);
  assert.equal(result.changes, 2); assert.equal(result.bindings.length, 1);
  assert.equal(result.text, source.replace("水平对齐='右'", "水平对齐='下'").replace('垂直对齐="上"', '垂直对齐="左"'));
  assert.deepEqual(spec.migrateAlignmentAxes(result.text), { text: result.text, changes: 0, bindings: result.bindings });
  assert.equal(parseLui('<控件 名称="P"><容器 水平对齐="上" 垂直对齐="右" /></控件>').diagnostics.filter(d => d.severity === 'error').length, 0);
});

test("LUI 2.0 uses one reusable layout host and exposes resettable defaults", () => {
  const source = '<页面 名称="P" 宽度="390" 高度="844"><容器 名称="Root" 子项排列="水平" 允许换行="是" 固定子项宽度="80" 水平间隔="8"><按钮 名称="A" 填充="是" /><文本 名称="B" /></容器></页面>';
  const document = parseLui(source);
  assert.equal(document.diagnostics.filter((item) => item.severity === "error").length, 0);
  const host = document.root.children[0];
  assert.equal(removeAttribute(source, host, "ChildWidth"), '<页面 名称="P" 宽度="390" 高度="844"><容器 名称="Root" 子项排列="水平" 允许换行="是" 水平间隔="8"><按钮 名称="A" 填充="是" /><文本 名称="B" /></容器></页面>');
  assert.equal(parseLui('<页面 名称="P" 宽度="390" 高度="844"><网格 /></页面>').diagnostics.filter((item) => item.message.includes("已移除")).length,0,'2.6 restores dedicated layouts in the authoring surface');
});

test("free layout warns for same-anchor siblings but permits deliberate opposite anchors", () => {
  const overlap = parseLui('<控件 名称="C"><容器><文本 文本="名称" /><文本 文本="等级" /></容器></控件>');
  assert.ok(overlap.diagnostics.some((item) => item.severity === "warning" && item.message.includes("自由排列")));
  const anchored = parseLui('<控件 名称="C"><容器><文本 文本="左" 垂直对齐="左" 水平对齐="上" /><文本 文本="右" 垂直对齐="右" 水平对齐="上" /></容器></控件>');
  assert.equal(anchored.diagnostics.filter((item) => item.message.includes("自由排列")).length, 0);
});

test("a paired button may carry an authored title and bound secondary text", () => {
  const source = '<控件 名称="装备槽"><容器 子项排列="水平"><按钮 名称="WeaponSlot" 子项排列="垂直" 填充="是"><文本 名称="Title" 文本="武器槽" /><文本 名称="Value" 文本="{绑定 props.WeaponText, 模式=单向, 更新源触发=默认, 预览内容=\'武器\'}" /></按钮></容器></控件>';
  const document = parseLui(source);
  assert.equal(document.diagnostics.filter((item) => item.severity === "error").length, 0);
  const button = document.root.children[0].children[0];
  assert.equal(button.children.length, 2);
  assert.equal(button.children[1].tag, "文本");
});

test("button interaction backgrounds use explicit Chinese attributes", () => {
  const source = '<控件 名称="按钮外观"><按钮 背景="#241536" 悬停背景="#302147" 按下背景="#191027" /></控件>';
  const document = parseLui(source);
  assert.equal(document.diagnostics.filter((item) => item.severity === "error").length, 0);
  const button = document.root.children[0];
  assert.equal(button.attrs.find((item) => item.name === "悬停背景")?.value, "#302147");
  assert.equal(button.attrs.find((item) => item.name === "按下背景")?.value, "#191027");
});

test("the generated visual control catalog covers every public UI constructor", () => {
  const expected = ["TextField", "Checkbox", "Dropdown", "Tabs", "Calendar", "Table", "Spine", "Sprite", "VirtualList", "DragDropContext", "SkillTree", "ChatWindow"];
  assert.ok(UI_CONTROL_DEFINITIONS.length >= 40);
  for (const name of expected) assert.ok(UI_CONTROL_DEFINITIONS.some((item) => item.tag === name && item.name));
});

test("WPF-style bindings retain mode, trigger, format and Studio preview content", () => {
  assert.deepEqual(parseBinding("{绑定 view.profile.name, 模式=双向, 更新源触发=失焦, 字符串格式='你好，{0}', 预览内容='冒险者'}"), {
    path: "view.profile.name", mode: "双向", updateSourceTrigger: "失焦", stringFormat: "你好，{0}", previewContent: "冒险者"
  });
});

test("only Page or Control may be a document root, and Page owns positive design coordinates", () => {
  assert.ok(parseLui('<网格 />').diagnostics.some((item) => item.message.includes("根节点只能")));
  assert.ok(parseLui('<页面 名称="P"><网格 /></页面>').diagnostics.some((item) => item.message.includes("宽度")));
  const nested = parseLui('<页面 名称="P" 宽度="390" 高度="844"><网格><控件 名称="C"><网格 /></控件></网格></页面>');
  assert.ok(nested.diagnostics.some((item) => item.message.includes("不能嵌套")));
  assert.equal(parseLui('<控件 名称="C" 内边距="8"><网格 /></控件>').diagnostics.filter((item) => item.severity === "error").length, 0);
});

test("only roots require a registry name while anonymous child nodes remain readable", () => {
  assert.ok(parseLui('<页面 宽度="390" 高度="844"><容器 /></页面>').diagnostics.some((item) => item.message.includes("必须声明名称")));
  const doc = parseLui('<页面 名称="P" 宽度="390" 高度="844"><容器><文本 文本="标题" /></容器></页面>');
  assert.equal(doc.diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(displayNameOf(doc.root.children[0].children[0]), "文本 · 标题");
});

test("LUI accepts UTF-8 design names and keeps the Lua boundary on ASCII x:Ref", () => {
  const doc = parseLui('<页面 目录:积木="Presentation/Components" 名称="塔内" 宽度="390" 高度="844"><网格><积木:页眉 名称="塔内页眉" /><进度条 名称="敌人血量" 引用="EnemyHp" /></网格></页面>');
  assert.equal(doc.diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(displayNameOf(doc.root.children[0].children[0]), "塔内页眉");
  assert.deepEqual(namespaceImports(doc).map((item) => [item.alias, item.directory]), [["积木", "Presentation/Components"]]);
});

test("LUI rejects duplicate design and secondary names in a document", () => {
  const doc = parseLui('<页面 名称="Tower" 副名称="无尽塔" 宽度="390" 高度="844"><面板 名称="Panel" 副名称="无尽塔" /></页面>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("重复")));
});

test("property edits use canonical Chinese attributes and keep the selected value", () => {
  const source = '<网格 名称="Root" 副名称="根" 内边距="8" />';
  const document = parseLui(source);
  assert.equal(editAttribute(source, document.root, "Padding", "10"), '<网格 名称="Root" 副名称="根" 内边距="10" />');
});

test("duplicate semantic attributes collapse to the last Chinese value", () => {
  const source = '<网格 名称="Root" 内边距="8" Padding="10" />';
  const document = parseLui(source);
  assert.ok(document.diagnostics.some((item) => item.message.includes("属性重复")));
  assert.equal(normalizeLuiAttributes(source), '<网格 名称="Root" 内边距="10" />');
});

test("Grid and Canvas validate their dedicated layout attributes", () => {
  const valid = parseLui('<页面 名称="Layout" 宽度="390" 高度="844"><网格 名称="Grid" 行定义="自动,2填充" 列定义="30%,填充"><文本 名称="Title" 网格.行="0" 网格.列="1" /><画布 名称="Canvas" 网格.行="1"><按钮 名称="Close" 画布.左="8" 画布.上="12" /></画布></网格></页面>');
  assert.equal(valid.diagnostics.filter((item) => item.severity === "error").length, 0);
  const invalid = parseLui('<页面 名称="Layout" 宽度="390" 高度="844"><网格 名称="Canvas"><文本 名称="Bad" 画布.左="0" 画布.右="0" 宽度="20" /></网格></页面>');
  assert.ok(invalid.diagnostics.some((item) => item.message.includes("画布")));
});

test("WPF layout roots accept star tracks, alignment, visibility and one ContentPresenter", () => {
  const valid = parseLui('<控件 名称="卡片壳"><边框 内边距="8"><网格 行定义="自动,*" 列定义="2*,*"><内容呈现器 水平对齐="拉伸" 垂直对齐="居中" 可见性="显示" 网格.行="1" /></网格></边框></控件>');
  assert.equal(valid.diagnostics.filter((item) => item.severity === "error").length, 0);
  const invalid = parseLui('<控件 名称="卡片壳"><网格><内容呈现器 /><内容呈现器 /></网格></控件>');
  assert.ok(invalid.diagnostics.some((item) => item.message.includes("最多只能包含一个")));
  const boundLength = parseLui('<页面 名称="滚动页" 宽度="390" 高度="844"><网格><滚动查看器 高度="{绑定 view.contentHeight, 模式=单向, 更新源触发=默认}" /></网格></页面>');
  assert.equal(boundLength.diagnostics.filter((item) => item.severity === "error").length, 0);
});

test("ScrollViewer-style axis visibility stays declarative and locks disabled axes", () => {
  const source = '<页面 名称="滚动" 宽度="390" 高度="844"><容器 子项排列="垂直"><滚动区 填充="是" 水平滚动条可见性="禁用" 垂直滚动条可见性="显示"><文本 文本="内容" /></滚动区></容器></页面>';
  const document = parseLui(source);
  assert.equal(document.diagnostics.filter((item) => item.severity === "error").length, 0);
  const scroll = document.root.children[0].children[0];
  assert.equal(editAttribute(source, scroll, "VerticalScrollBarVisibility", "隐藏").includes('垂直滚动条可见性="隐藏"'), true);
});

test("DockPanel, reverse flow and transform syntax follow the shared WPF contract", () => {
  const header = parseLui('<控件 名称="页眉"><停靠面板 宽度="100%" 高度="52" 最后子项填充="是"><堆叠面板 名称="操作" 停靠="右" 方向="水平" 流向="从右到左" 间距="8"><按钮 名称="设置" /><按钮 名称="返回" /></堆叠面板><文本 名称="标题" 渲染变换="平移(8,0);缩放(1.1);旋转(8)" 渲染变换原点="0.5,0.5" /></停靠面板></控件>');
  assert.equal(header.diagnostics.filter((item) => item.severity === "error").length, 0);
  const layoutTranslation = parseLui('<控件 名称="变换"><网格 布局变换="缩放(1.1);平移(8,0);旋转(5)" /></控件>');
  assert.ok(layoutTranslation.diagnostics.some((item) => item.severity === "warning" && item.message.includes("平移会被忽略")));
  const malformed = parseLui('<控件 名称="变换"><网格 渲染变换="放大(2)" /></控件>');
  assert.ok(malformed.diagnostics.some((item) => item.severity === "error" && item.message.includes("渲染变换")));
});

test("unknown paired tags retain an inspector-safe warning instead of becoming a silent dead zone", () => {
  const unknown = parseLui('<控件 名称="测试"><未知控件 名称="临时"><文本 名称="内容" /></未知控件></控件>');
  assert.ok(unknown.diagnostics.some((item) => item.severity === "warning" && item.message.includes("未识别控件")));
});

test("Chinese enum values are accepted and legacy values receive migration diagnostics", () => {
  const current = parseLui('<页面 名称="Layout" 宽度="390" 高度="844"><网格><按钮 名称="Confirm" 样式="主要" /></网格></页面>');
  assert.equal(current.diagnostics.filter((item) => item.severity === "error").length, 0);
  const legacy = parseLui('<页面 名称="Layout"><按钮 名称="Confirm" 样式="primary" /></页面>');
  assert.ok(legacy.diagnostics.some((item) => item.severity === "warning" && item.message.includes("主要")));
});

test("LUI parses comments and property-element syntax without weakening Lua reference validation", () => {
  const doc = parseLui('<!-- 设计备注 --><页面 名称="Cover" 副名称="封面" 宽度="390" 高度="844"><网格><按钮 名称="EnterTower" 副名称="进入塔" ><按钮.文本>进入无尽塔</按钮.文本></按钮></网格></页面>');
  assert.equal(doc.diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(doc.root.children[0].children[0].tag, "按钮");
});

test("LUI rejects a UTF-8 x:Ref while leaving UTF-8 x:Name valid", () => {
  const doc = parseLui('<页面 名称="塔内"><进度条 名称="敌人血量" 引用="敌人血量" /></页面>');
  assert.ok(doc.diagnostics.some((item) => item.message.includes("引用必须是 ASCII")));
});

test("LUI reports an unimported component alias and formats valid UTF-8 documents", () => {
  const invalid = parseLui('<页面 名称="塔内" 宽度="390" 高度="844"><积木:页眉 名称="页眉" /></页面>');
  assert.ok(invalid.diagnostics.some((item) => item.message.includes("未导入目录别名")));
  assert.equal(formatLui('<控件 名称="塔内"><网格><文本 名称="标题" 文本="无尽塔" /></网格></控件>'), '<控件 名称="塔内">\n  <网格>\n    <文本 名称="标题" 文本="无尽塔" />\n  </网格>\n</控件>\n');
});

test("binding preview content is the only current preview-data syntax and legacy preview states warn", () => {
  const doc = parseLui('<页面 名称="Tower" 宽度="390" 高度="844"><文本 文本="{绑定 view.floor, 模式=单向, 更新源触发=默认, 预览内容=\'第 13 层\'}" /><预览 名称="Battle"><设值 路径="view.floor" 值="第 12 层" /></预览></页面>');
  const binding = parseBinding(doc.root.children[0].attrs.find((item) => item.name === "文本")?.value);
  assert.equal(doc.diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(binding?.previewContent, "第 13 层");
  assert.equal(doc.diagnostics.filter((item) => item.message.includes("预览状态已移除")).length, 2);
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

test("an empty design placeholder can be typed and converted in place", () => {
  const source = '<网格 名称="Root"><></网格>';
  const document = parseLui(source);
  const placeholder = document.root.children[0];
  assert.equal(placeholder.tag, "__placeholder__");
  assert.ok(document.diagnostics.some((item) => item.severity === "warning" && item.message.includes("空标签")));
  assert.equal(editTag(source, placeholder, "按钮"), '<网格 名称="Root"><按钮 /></网格>');
});
