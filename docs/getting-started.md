# 快速入门

[返回文档入口](README.md)。适用版本：2.4.6。

## 准备项目

准备支持 urhox-libs/UI 的 UrhoX 游戏项目，项目根应有 scripts 目录。安装 LUI Studio VSIX 后打开该项目，执行 **LUI: 部署 UrhoX/Lua 运行时**。命令行用户在 LUI 源码仓库运行 `node scripts/deploy-runtime.mjs <项目根目录>`。

部署写入 scripts/LUI；源文件白名单和组件目录登记由作者维护，升级保留这些字段。文档、示例和 skills 随部署落地，并通过项目 AGENTS.md 提供 AI 导航；遇到同名用户资料会保留并提示。

运行 **LUI: 检查运行时部署**，确认插件携带版本、布局契约与部署清单哈希匹配。随后确认 [宿主依赖](runtime.md)；该状态检查不验证游戏业务宿主是否实现完整。

## 创建页面

执行 **LUI: 新建页面或组件（MVVM）**，选页面并输入互不相同的名称、副名称。生成位置为 scripts/Presentation/Pages，下方同名 Lua 类会调用 InitializeComponent。创建/保存 LUI 时，Studio 根据 sourceRoots 更新 scripts/LUI/Registry.lua。

打开 [Welcome.lui](../examples/tutorial/Pages/Welcome.lui) 与 [Welcome.lui.lua](../examples/tutorial/Pages/Welcome.lui.lua)，学习静态布局、预览文本、运行时 view 与动作表的分工。用完整配对文件替换示例目标文件前确认目标不存在；不要仅复制标记。

修改 view 后由 OnBindingChanged 更新引用的文本控件，详见 [绑定与事件](bindings.md)。Studio 只显示绑定里的预览内容，不显示动作执行后的真实模型。

## 使用完整教学工程片段

按 [示例说明](../examples/tutorial/README.md) 复制两个页面和 ActionCard 组件，将配置合并到现有 lui.project.json；页面注册与目录组件登记都要具备。在已有游戏生命周期中调用示例 Start 模块进行挂载与切换。

示例不是独立引擎，也不替换游戏 main.lua。UI.Init 和 UI.SetRoot 的最终所有权由项目现有宿主决定，接入到已有 UI 根时使用项目挂载方式。

## 验收

Studio：两页无语法或属性错误，组件能展开，预览列表显示两个条目。游戏运行时：Welcome 点击增加计数；Inventory 点击条目更新详情；页面切换释放旧实例。若只有 Studio 可用，仅记录静态预览通过，不报告游戏动作已验证。
