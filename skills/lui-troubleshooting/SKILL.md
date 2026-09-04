---
name: lui-troubleshooting
description: 排查 LUI Studio 与 UrhoX LUI Runtime 的语法、组件注册、中文属性、数据刷新、列表、布局、保存冲突或部署不匹配问题。适用于 LUI 问题定位，不替代 Maker MCP 基础设施诊断。
---

# 排查 LUI

从当前项目 AGENTS.md 与 scripts/LUI/lui.project.json 找到本地资料和实际设计目录。读取 [排错表](../../docs/troubleshooting.md)，按症状选择下面的文档；保留原始诊断文本及当前版本，不凭历史验收推断已通过。

## 定位顺序

1. 确认故障发生在 Studio 静态预览、配对 Lua 构造、宿主挂载、事件刷新还是部署。记录最小复现及涉及的页面/组件，不扫描无关引擎目录。
2. 语法/注册错误查 [语言](../../docs/language.md)、[组件](../../docs/components.md)，核对根、名称、目录别名、Properties、配对后端、sourceRoots 与 Registry。
3. 数据/动作错误查 [绑定](../../docs/bindings.md)。区分预览 JSON 与真实模型；检查 Notify 回调、输入 Commit、重复项原始数据及每实例 refs。不要把 Notify 当成自动渲染，也不要承诺通用失焦提交已经实现。
4. 布局查 [布局](../../docs/layout.md)：水平对齐是 Y，垂直对齐是 X；检查父槽位、显式尺寸、边距、滚动高度及禁用轴。需要像素证据时按项目允许方式比较 Studio 与运行时。
5. 构造/部署查 [运行时](../../docs/runtime.md)：核对 Presentation.Components 依赖、InitializeComponent 是否递归、OnLoaded 调用时机以及插件携带清单和目标版本/契约/哈希。重新部署修复包差异，不能手填版本或哈希伪造匹配。
6. 保存冲突查 [Studio](../../docs/studio.md)，先保留草稿并比较外部修改，不强行磁盘覆盖。旧语法迁移查 [迁移](../../docs/migration.md)，不批量格式化无关文件。

## 修复与闭环

在问题真正所属层修改最小范围；框架修复写回正式源码，不只改目标项目 scripts/LUI 副本。资料部署冲突先保留用户文件，查 docs/lui/.delivery.json 的 preserved，不能通过删整个交付记录绕过保护。

复验原复现以及直接相邻的正常场景，给出文件、原因、修复和实际证据。区分静态解析、Lua 桩测试、Studio 预览和游戏真机交互；未执行的验证不能报告通过。远程游戏构建仅在用户请求且符合目标项目流程时进行。
