# 历史版本与项目验收

这里保存旧版本实现记录，供维护者追溯。当前使用规则以 [使用文档](README.md) 为准；历史文件中的固定设计数量、业务页面、游戏规则和旧版行为不属于 LUI 通用契约。

本轮发布：[2.6.0 接续验收](workspace-2.6.0-acceptance.md)。上一轮：[2.5.2 验收记录](workspace-2.5.2-acceptance.md)。

## 2.6.0（2026-09-06 接续）

- 官方引擎隔离预览、共享项目主题与字体指纹；主题/字体改变要求重开，禁止静默沿用旧会话。
- 全屏覆盖层使用独立 Yoga 根及原生 Modal 后的绘制/输入顺序，覆盖目标洞口、重开、切根和销毁。
- Text 显式描边属性贯通语法、编辑器与 Runtime；普通文字仍只绘制正文一次。
- 原位标量绑定、开关/滑块/进度值、已核验原生字段和事件桥，以及状态渐变切换修复；保留控件、单次绑定及用户事件边界。
- 真实引擎覆盖层/通知、8 对静态原始 RGBA、真实 TextDocument 撤销各自记录证据；全标签及完整实机流程保留未完成项，详见本轮验收与能力审计。

## 2.5.2

- 删除同色八方向文字覆盖，LUI 标签和按钮标题均只绘制一次；Regular/Bold 继续使用声明的 MiSans 文件。
- 原生叶控件首次测量优先使用构造器的 width/height/minWidth/minHeight，TextField 不再被 0×0 Yoga 初始布局压扁。
- TextField 的文本绑定映射到 `value`，正文颜色映射到 `textColor`，并新增占位文字颜色、光标颜色及 Studio 输入框预览。

- [2.3.1 验收](workspace-2.3.1-acceptance.md)
- [2.3.2 验收](workspace-2.3.2-acceptance.md)
- [2.4.0 公开属性实现记录](component-properties-2.4.0.md) 与 [验收](workspace-2.4.0-acceptance.md)
- [2.4.1 无尽塔列表组件记录](list-components-2.4.1.md) 与 [验收](workspace-2.4.1-acceptance.md)
- [2.4.2 验收](workspace-2.4.2-acceptance.md)
- [2.4.4 验收](workspace-2.4.4-acceptance.md)
- [2.4.5 验收](workspace-2.4.5-acceptance.md)
- [同日可见性宿主补修记录](visibility-host-fix.md)

上述记录不随运行时教学资料交付，以免新项目把某个游戏的业务实现视为框架要求。

## 2.4.7

按钮文字九种位置贯通 Studio／Lua，组件独立预览与实例可见性分离；全部设计迁移、幂等检查、共享契约自动盖章与本地验收见 workspace-2.4.7-acceptance.md。

## 2.5.0

机器可读标签能力表统一 Studio、补全、诊断和 Runtime；全部可视标签开放表面属性，文字型标签开放统一排版属性，颜色与两色色标线性渐变使用严格解析器。项目字体、页面框架和显式安全区语义已统一，并增加五阶段启动诊断与黑屏回退。详见 [2.5.0 验收](workspace-2.5.0-acceptance.md)。

## 2.5.1

共享渲染契约新增 sRGB、Straight Alpha、预乘 sRGB 渐变、向内边框、契约阴影与文字栅格策略。Runtime 为 LUI 自有文本增加同色八方向光学覆盖补偿，Studio 禁止合成粗体并等待项目字体加载完成；布局探针同时输出边框实际矩形、最终字重、栅格模式与阴影来源。新增 `FindByRef`、`GetReferenceRect` 和有序全局覆盖层挂载接口。

同版本补修绑定可见性生命周期：绑定值初始为 `nil`、假值或折叠时不再删除控件实体，只设置隐藏；后续 `Notify` 或代码引用可以安全显示。字面量折叠节点仍在构建期裁剪。回归覆盖设置编辑器、可选列表副标题/角标和筛选行。
