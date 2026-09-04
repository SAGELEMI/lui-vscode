---
name: lui-authoring
description: 使用 LUI 中文声明式语言创建或修改 UrhoX 游戏页面、复用组件、配对 Lua、绑定和列表交互。适用于 .lui/.lui.lua 与 LUI 目录注册，不用于普通网页、WPF 或无关 Lua 玩法。
---

# 编写 LUI

先从当前项目 AGENTS.md 与 scripts/LUI/lui.project.json 确定资料、sourceRoots 和组件登记。文档入口：[LUI 手册](../../docs/README.md)。本 skill 可由项目导航或显式路径读取，不要求全局安装。

## 按任务取上下文

- 首次接入或新页面：[快速入门](../../docs/getting-started.md)、[运行时](../../docs/runtime.md)，复用 [Welcome 配对示例](../../examples/tutorial/README.md)。
- 布局：[语言](../../docs/language.md)、[布局](../../docs/layout.md)，按需查 [控件参考](../../docs/controls.md)。
- 可复用控件：[组件](../../docs/components.md)，从 ActionCard 配对示例开始。
- 列表、输入或动作：[绑定与事件](../../docs/bindings.md)，从 Inventory 示例学习原始项事件及原位刷新。

只阅读相关章节、目标配对文件及其实际调用方。优先复用项目已经登记的组件；不要假设教学组件或某个游戏的页签列表是内置能力。

## 写入规则

1. 静态布局、外观、文本、绑定、条件和重复模板放小写 .lui；数据、动作、订阅与生命周期放同名 .lui.lua。业务后端不重新用 UI.Panel 构造静态布局。
2. 新类使用 New、Init、InitializeComponent、GetRoot、Dispose；InitializeComponent 只经 RenderMarkup 渲染自身标记。OnLoaded 在 RenderMarkup 返回前发生，使用传入 context。
3. 中文公开键在 Properties、调用处、props 索引三处同名，Properties 使用可静态解析的字面量。动作和引用键为 ASCII；组件 refs 独立。event 属性传动作字符串。插槽内容使用组件上下文，调用方数据经公开属性传入。
4. 水平对齐控制 Y，垂直对齐控制 X；网格索引从 0 开始，Lua 数组从 1 开始。四边厚度为左上右下。
5. 用重复项及真实数组；预览内容只供 Studio，JSON 不能替代游戏数据。先明确刷新方式：Notify 仅调回调，简单字段用引用 setter，结构变更由宿主重建。
6. 合并作者现有 sourceRoots 和 componentDirectories，不覆盖配置。Registry 是 Studio 管理的扫描结果；核对配对文件与登记路径，不硬编码机器目录。

## 完成检查

验证语法、配对后端、公开属性、目录登记和示例使用到的宿主能力。交互至少覆盖真实数据、事件回调与可见刷新；列表覆盖空集合和原始项身份。只有静态预览证据时明确保留运行时验证项。

修改框架公开行为时同步手册和示例；正式适配器在 LUI 源仓库修改，部署副本不作为修复源。游戏构建遵循目标项目规则，普通代码修改不自行触发远程构建。
