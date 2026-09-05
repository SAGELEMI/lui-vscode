# LUI 使用文档

当前手册适用于 LUI Studio / UrhoX Lua Runtime **2.6.0**；旧的背景、颜色、边框颜色、边框宽度和圆角写法继续兼容。以当前实现为准，不套用标准 WPF 或浏览器 CSS 的全部能力。

2.6.0 将折叠节点移出测量、间隔和填充；画布绑定坐标参与正式排列。Studio 默认提供官方 UrhoX 隔离引擎预览；结构示意必须显式选择，不作为实机一致性证据。未完成同条件原始 RGBA 对照前，不宣称逐像素一致。

| 要做什么 | 阅读 |
| --- | --- |
| 第一次接入，创建第一对文件 | [快速入门](getting-started.md) |
| 标签、属性、目录、命名、语法限制 | [语言规范](language.md) |
| 尺寸、网格、对齐、滚动、变换 | [布局](layout.md) |
| 查询内置标签、绑定属性与事件 | [控件参考](controls.md) |
| 制作可复用组件与公开接口 | [组件](components.md) |
| 数据、动作、重复项、双向写回 | [绑定与事件](bindings.md) |
| 配置、注册、构造、宿主与刷新 | [运行时接入](runtime.md) |
| 操作设计器、保存与撤销 | [Studio 操作](studio.md) |
| 预览或真机出错 | [排错](troubleshooting.md) |
| 同引擎预览、隔离宿主与验收边界 | [真实引擎预览](engine-preview.md) |
| 升级旧语法与运行时 | [迁移](migration.md) |
| 复制完整 Lua 类和配对标记 | [教学示例](../examples/tutorial/README.md) |

推荐先完成 Welcome 示例，再阅读 ActionCard 组件和 Inventory 列表。示例区分 Studio 预览、Lua 数据与宿主挂载，避免只复制标记就期待游戏自动运行。

部署后本目录位于 docs/lui/，示例位于其 examples/tutorial/。项目根 AGENTS.md 指向两个 skills/lui-* 技能。部署的 .delivery.json 记录资料版本、受管理文件哈希及保留项；用户修改的资料不会被静默覆盖。

维护入口：本页登记所有当前手册；控件参考由正式词汇和控件目录生成。新增文件时更新交付清单。历史版本验收保留在源码仓库，不作为新项目教程交付。
