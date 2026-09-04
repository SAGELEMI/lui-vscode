# LUI 2.4.3 交付记录

日期：2026-09-04。当前入口见 [LUI 文档](README.md)。语言与 2.4.2 兼容，布局契约保持 xaml-initialize-v1-unified-layout-hy-vx-v1-properties-v1。

## 交付

- 中文手册按语言、布局、控件、组件、绑定、运行时、Studio 和排错组织；历史版本与无尽塔业务记录另列，不作为通用教程部署。
- lui-authoring 与 lui-troubleshooting 两个技能通过项目 AGENTS.md 导航；不修改用户全局技能配置。
- Welcome、ActionCard、Inventory 提供标记、Lua 类、目录配置、注册表示例与最小宿主。
- 插件和命令行共用资料交付逻辑，支持重复部署、冲突保留和根 AGENTS 区块维护；VSIX 包含完整资料源。
- 部署状态以插件实际携带清单为准，不再将版本硬编码为 2.4.0。

## 验证记录

- npm run check：60 项测试通过，包含 7 项新增部署/版本/资料保护测试。
- npm run check:types：TypeScript 检查通过。
- npm run check:docs：全部交付文档链接、7 段 XML 示例、3 对教学设计及 5 个 Lua 文件通过；部署后引用也由测试重新检查。
- 两个 SKILL.md 通过 skill-creator 的 quick_validate.py。
- scripts/test-tutorial-lua.py：Lua 5.4 正式 Parser/Runtime 验证加载、构造、计数刷新、目录组件、动作转发、原始项身份、空列表、失效选择、独立 refs 和页面 Dispose。
- 插件部署测试调用编译后的生产部署入口，以文件系统替身模拟 workspace.fs；不等同真实 VS Code UI 操作。
- Lua UI 与资源服务使用测试替身，没有进行游戏真机像素或交互验收，也没有触发 Maker 构建。

## 维护命令

控件参考：npm run docs:generate。完整门禁：npm run check、npm run check:types、npm run check:docs。技能格式校验使用 skill-creator 附带脚本。

Lua 教学验证需要 Python 与 lupa 的 Lua 5.4 模块，可安装到忽略目录 artifacts/python 后执行 `python scripts/test-tutorial-lua.py`。打包使用 npm run package:vsix，产物位于 dist/lui-vscode-2.4.3.vsix。
