# 2.6.0 显式文字描边与通知验收

日期：2026-09-06。对应交接 R260-02。此记录仅覆盖本项；正式部署、Maker 新会话和整体验收由交付记录补充。

## 实现

- 正式 Text 能力新增 `TextStrokeColor` / `TextStrokeWidth`，中文分别为“文字描边颜色 / 文字描边宽度”。词汇、Lua Parser、Text 能力表、属性栏文字分组、颜色编辑器、0.25px 步进和绑定共用这些键。源标签只允许 Text 使用。
- `Typography.ApplyLabel` 仅在显式颜色合法且宽度为正时创建原生 `textStroke`；缺任一项或宽度为 0 会清掉旧描边。非法运行时值报中文属性诊断。普通文字仍单次填充且 `InkCompensation` 为 0。
- 描边实际使用只读 UrhoX Label 的八方向描边加一次正文填充，记录为 `nanovg-native-outline-eight-offsets-single-fill`。没有把多次描边描述成单次总绘制，没有改只读引擎。
- 游戏四条通知删除矩形背景、边框、圆角和原框内边距，显式采用深色 1px 文字描边。保留全屏左上 8px、最大 260px、4 条、48 UTF-8 字符和 4 秒寿命（后 2 秒渐隐），Dispose 经托管覆盖层卸载入口。
- 原生 Label 的 `maxLines` 只有类型注解，不能单独证明两行限制。通知标记补充行高 1.45、最大高度 34.8、顶部文字对齐与裁剪；最小字号沿用已换算的 `label.props.fontSize`，防止原生字体单位变换把最小字号放大。实际 GPU 夹具已确认 48 字长文本最多显示两行。

## 本轮证据

以下命令于本次修改后通过，不沿用上轮记录：

```powershell
& 'D:/nodejs/node.exe' --test tests/text-stroke.test.mjs
& 'D:/nodejs/node.exe' node_modules/typescript/bin/tsc --noEmit
& 'C:/Users/bayun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' scripts/test-text-stroke-lua.py 'D:/项目/Tap制造/无尽塔'
```

Node 专项 2/2 通过：中英别名、Text 专属能力、合法静态与绑定值、非法颜色／负数／无穷／百分比／自动诊断。TypeScript 无错误。

Lua 5.4 专项通过：真实生产 Parser、Typography 及只读 Label 的 Render Lua 方法，使用 NanoVG 调用记录替身验证八次深色偏移后一次浅色正文；重复 Attach 不叠加绘制，动态修改颜色／宽度、禁用及缺值后恢复单次正文。此检查不产生 GPU 帧，不证明字体栅格或逐像素一致。

游戏独立回归入口为 `scripts/Tests/NotificationOverlay.py <LUI source repository>`，本轮已通过；生产后端运行于标签替身，覆盖无框标记、两行区域、48 字截断、最新四条、多个屏宽 8px 锚点、渐隐及卸载。文档检查为 94 链接、9 示例，两个仓库 `git diff --check` 均通过。

真实引擎首次复核发现 Widget 自动把 `*Color` 字段规范化为 RGBA 表，初版 Typography 仅接受字符串而报错。现已按只读 `Widget.new/Init → Style.NormalizeColorProps` 的实际调用契约接纳并校验 RGB(A) 表；Lua 专项直接加载真实 Style.NormalizeColorProps 后再调用 Label.Render，覆盖这一构造边界及非法通道。

独立 `scripts/test-notification-engine.mjs <game root>` 已在官方引擎上完成 7 个场景：358/360/377/390/640×844、390×867，以及 390×867 第 3 秒渐隐。读取真实控件属性和最终截图确认锚点 `(8,8)`、宽度 260、四条通知、无背景/边框、1px 深色描边、普通文字无描边、长文本高度 34.8 与第 3 秒 Alpha 0.5；最终图已逐项读图。结果保存在 `artifacts/notification-engine-20260906/report.json`，相关页面证据见 [页面验收](workspace-2.6.0-pages-acceptance.md)。

此夹具还纠正了后端临时 SetStyle 的 maxHeight 未进入 Runtime 源码布局、原生中线对齐裁掉长通知首尾、最小字号没有进行原生单位换算三个问题。最终布局属性留在 `.lui`；Dispose 先 Unmount 再 Destroy，释放原生根。

## 未验证边界

本项已有隔离真实引擎通知截图；仍不能替代完整游戏路径、逐像素 RGBA 对照、VS Code 属性编辑与撤销操作，也不证明 Maker 已部署最新代码。真实玩家会话的通知仍随本轮正式交付验收。
