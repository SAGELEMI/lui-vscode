# LUI 仓库导航

2026-09-06 远程推送准备：当前2.6.0正式源、契约、回归脚本与验收资料一起提交；`.tmp/` 为本地临时文件，与artifacts/dist/runtime一起保持忽略。适配器默认配置及package-lock两个workspace版本已与2.6.0同步。此轮推送前检查为76项Node、TypeScript、文档96链接/9片段；仍保留总验收中未关闭的全状态与设备输入边界。

2026-09-06：2.6.0 接续入口 `docs/workspace-2.6.0-acceptance.md`。新增正式适配器 `Overlays.lua`（独立视口覆盖树/输入栈）、`LiveProps.lua`（标量刷新）、`BuiltinValues.lua`、`NativeControls.lua`（经官方源核对的专用映射）。原始帧测试 `scripts/test-engine-parity.mjs`、覆盖层 `scripts/test-engine-overlays.mjs`、通知 `scripts/test-notification-engine.mjs` 均为独立数据夹具；不执行游戏业务或用户存档，不能据局部证据宣称全标签像素一致。新文件由正式 build/stamp/deploy 生成交付，勿手改部署副本。

补充：`tests/runtime-slot-scope.py` 与 `scripts/test-engine-component-parity.mjs` 验证调用方插槽作用域、多实例及nil默认值；`scripts/test-vscode-engine-native.mjs` 验证实际Webview与引擎/源码闭环。`scripts/test-game-flow-engine.mjs` 专门执行无尽塔生产App/Presentation，必须保留内存存档替身、禁止OPFS/业务网络的隔离条件；它不是普通设计预览启动入口。专项证据从本轮总验收导航。

2026-09-05：2.4.6 修复自由布局列宽、流式百分比、导入组件根与局部刷新声明、函数事件和滑块边界绑定。`adapter/Progress.lua` 根据共享契约绘制进度条。补充验收入口 `scripts/test-parity-browser.mjs` 与 `tests/runtime-layout-math.py`；部署与迁移说明见 docs/workspace-2.4.6-acceptance.md。

所有新增文本默认 UTF-8。先读 [文档入口](docs/README.md)，再按任务读取相关模块；当前版本以 package.json 与运行时清单为准，历史验收记录不是当前使用规范。

- 编写页面、组件与绑定：读 [lui-authoring](skills/lui-authoring/SKILL.md)。
- 排查语法、数据、布局、注册或部署：读 [lui-troubleshooting](skills/lui-troubleshooting/SKILL.md)。
- 语言正式源在 packages/spec；适配器正式源在 packages/runtime-urhox-lua/adapter。不要直接修改生成目录 runtime、dist。
- Studio 入口 src/extension.ts；设计器 src/webview/designer.ts；源码同步 src/webview/sourceSync.ts。
- 资料交付共用实现 scripts/lib/guidance.mjs，扩展与 scripts/deploy-runtime.mjs 都调用它。新增资料时同步 guidanceEntries 与 docs/README.md。
- 语言和公共接口变化必须同步对应手册及示例；不要将某个游戏的业务组件当作 LUI 内置功能。
- 验证：npm run check、npm run check:types、npm run check:docs；打包 npm run package:vsix。游戏运行遵循目标项目流程；本仓库 Git 推送不触发 Maker 构建。

索引维护：没有独立代码图鉴；本文件是代码入口，docs/README.md 是资料入口。2026-09-04：新增 2.4.3 文档、skills、示例与受管理资料交付。

2026-09-05：Runtime.RefreshComponent 显式替换导入组件内部树并保留布局宿主；Measure 区分纯绘制样式。调用契约见 docs/runtime.md。无尽塔绑定逐项审计位于目标项目 scripts/Tests/BindingAudit.py，不将业务用例并入通用组件。

2026-09-05：Runtime 转换层动态公开属性不再回退创建期旧值，滚动条以 8 逻辑像素参与内容框，复合按钮文本继承字重；revision `runtime-conversion-20260905-live-bindings-scroll-gutter`，Studio 预览不变。

2026-09-05：2.4.5 的正式布局契约集中在 `packages/spec/layout-contract.json`，由 `stamp-runtime.mjs` 生成 `Contract.lua`。Studio 与 Runtime 共用 1.45 行高、36px 按钮、8px 紫色滚动条、盒模型和既定对齐轴；自由排列同锚点叠放由规范诊断提示。

2026-09-05：2.4.7 新增按钮文字左右／上下对齐；正式绘制在 adapter/ButtonCaption.lua。Studio 将标题层与子项布局分开，导入实例可见性不使用独立 props 样例。迁移入口 scripts/migrate-button-captions.mjs；build 自动 stamp 正式运行时，验收 docs/workspace-2.4.7-acceptance.md。
