import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundled = await build({ entryPoints: [resolve(root, "packages/spec/src/vocabulary.ts")], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
const vocab = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const cell = (v) => String(v ?? "—").replaceAll("|", " / ");
const lines = ["# 控件与属性参考", "", "[返回文档入口](README.md)。适用版本：" + pkg.version + "。", "", "本页由 scripts/generate-reference.mjs 从正式词汇与控件目录生成，运行 npm run docs:generate 更新。表格列出已登记语法，不代表 Studio 模拟全部复杂控件交互，或 Runtime 实现底层 UI 的全部属性；使用新能力时核对适配器及目标引擎 UI 文档。", "", "## 根与结构", "", "页面、控件是文档根；条件、重复项控制构建；内容呈现器接受组件调用方内容。重复项的项目属性是当前项别名，与数据控件的项目集合属性含义不同。", "", "## 基础与布局标签", "", "| 中文标签 | 内部语义 |", "| --- | --- |"];
const special = new Set(["lui:Page", "lui:Component", "lui:If", "lui:For", "lui:Slot", "lui:Preview", "lui:Set"]);
const generated = new Set(vocab.UI_CONTROL_DEFINITIONS.map((c) => c.tag));
for (const [tag, name] of Object.entries(vocab.CANONICAL_TO_TAG)) {
  if (!special.has(tag) && !generated.has(tag)) lines.push(`| ${cell(name)} | ${cell(tag)} |`);
}
lines.push("", "基础文本使用文本属性；按钮点击动作收到当前重复项（若无则 nil）和事件；进度条使用值/最大值。开关与滑块当前走专用变更动作桥，不承诺与下表通用输入控件相同的自动双向写回。卡片、分区、提示、屏幕和固定屏幕依赖 Presentation.Components，见 [宿主约定](runtime.md)。", "", "## 目录登记的通用 UI 控件", "", "| 中文标签 | 底层 UI | 类别 | 数据绑定属性 | 事件 | 原生内容容器 |", "| --- | --- | --- | --- | --- | --- |");
for (const c of vocab.UI_CONTROL_DEFINITIONS) {
  if (c.tag === "Widget") continue; // 控件 is reserved for the document root.
  lines.push(`| ${cell(vocab.sourceTag(c.tag))} | ${c.ui} | ${c.category} | ${c.bindable ? vocab.sourceAttribute(c.bindable) : "—"} | ${(c.events ?? []).map(vocab.sourceAttribute).join("、") || "—"} | ${c.children ? "是" : "否"} |`);
}
lines.push("", "## 属性词汇", "", "此表只列通用/框架词汇，业务组件接口以其 Properties 为准。可用范围由当前标签、父级和补全规则筛选；不是每个标签都接受每个属性。", "", "| 中文属性 | 语义键 | 类型/枚举 | 限定标签（若有） |", "| --- | --- | --- | --- |");
const business = new Set(["WeaponText", "ArmorText", "SelectWeapon", "SelectArmor", "Settings", "Back"]);
for (const [canonical, name] of Object.entries(vocab.CANONICAL_TO_ATTRIBUTE)) {
  if (business.has(canonical) || new Set(["Anchor", "Left", "Top", "Right", "Bottom", "FlexGrow", "FlexBasis", "Align", "Justify"]).has(canonical)) continue;
  const def = vocab.ATTRIBUTE_DEFINITIONS[canonical];
  lines.push(`| ${cell(name)} | ${canonical} | ${cell(def?.options?.join("、") ?? def?.kind ?? "按控件约定")} | ${def?.tags?.map(vocab.sourceTag).join("、") || "按上下文"} |`);
}
lines.push("", "绑定模式、刷新限制和事件桥见 [绑定与事件](bindings.md)；尺寸和特殊轴向见 [布局](layout.md)。", "");
const output = lines.join("\n");
const destination = resolve(root, "docs/controls.md");
if (process.argv.includes("--check")) {
  if (await readFile(destination, "utf8") !== output) throw new Error("控件参考与源码不一致，请运行 npm run docs:generate。");
} else await writeFile(destination, output, "utf8");
