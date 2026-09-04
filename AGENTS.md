# LUI 仓库导航

所有新增文本默认 UTF-8。先读 [文档入口](docs/README.md)，再按任务读取相关模块；当前版本以 package.json 与运行时清单为准，历史验收记录不是当前使用规范。

- 编写页面、组件与绑定：读 [lui-authoring](skills/lui-authoring/SKILL.md)。
- 排查语法、数据、布局、注册或部署：读 [lui-troubleshooting](skills/lui-troubleshooting/SKILL.md)。
- 语言正式源在 packages/spec；适配器正式源在 packages/runtime-urhox-lua/adapter。不要直接修改生成目录 runtime、dist。
- Studio 入口 src/extension.ts；设计器 src/webview/designer.ts；源码同步 src/webview/sourceSync.ts。
- 资料交付共用实现 scripts/lib/guidance.mjs，扩展与 scripts/deploy-runtime.mjs 都调用它。新增资料时同步 guidanceEntries 与 docs/README.md。
- 语言和公共接口变化必须同步对应手册及示例；不要将某个游戏的业务组件当作 LUI 内置功能。
- 验证：npm run check、npm run check:types、npm run check:docs；打包 npm run package:vsix。游戏运行遵循目标项目流程；本仓库 Git 推送不触发 Maker 构建。

索引维护：没有独立代码图鉴；本文件是代码入口，docs/README.md 是资料入口。2026-09-04：新增 2.4.3 文档、skills、示例与受管理资料交付。
