# UrhoX Lua 运行时接入

[返回文档入口](README.md)。适用版本：2.4.3。

## 部署与路径

运行时部署在 scripts/LUI，使用 `require("LUI")` 创建入口。scripts 是资源根，标记路径写 Presentation/Pages/Welcome.lui，不加 scripts/ 前缀。默认配置 schemaVersion 为 3；sourceRoots 限制允许加载的后端，componentDirectories 登记按目录调用的公开组件。

LUI Studio 从配置的 sourceRoots 扫描配对文件维护 Registry.lua；手动接入可用示例 Registry 作为结构参考。页面名和控件名在注册表中不得冲突；不要编辑正在被 Studio 自动维护的注册表来绕过源文件问题。

部署修改 version、layoutContract、runtimeManifestHash，保留作者的白名单和登记。运行时升级备份位于 scripts/LUI/.backup-last；不要将它作为业务源目录。资料保存在 docs/lui 与 skills，不混入游戏 Lua 资源目录，也不产生资源 .meta。

## 宿主前提

Runtime 顶层依赖 `urhox-libs/UI`、`Presentation.Components` 和引擎的 cjson/资源读取。即使只用基础文本，也需要能加载 Presentation.Components 模块。

当前适配器以下标签使用项目宿主函数：

| 标签 | 调用约定 |
| --- | --- |
| 卡片 | Components.Card(children, props) |
| 分区 | Components.Section(title, children, subtitle) |
| 提示 | Components.Notice(text, isError) |
| 屏幕 | Components.Screen(nil, children, props) |
| 固定屏幕 | Components.FixedScreen(nil, contentWidget, props) |

这些函数不是此包自动生成的游戏业务实现。复用项目已有适配；新项目先实现所用标签的宿主约定。教学示例只用通用容器，仍需要该模块可以加载。不应把无尽塔页签列表、楼层奖励等业务组件当成内置 LUI 功能。

## 公开入口

| 入口 | 返回与用途 |
| --- | --- |
| LUI.New() | Runtime 实例，读取当前项目配置；失败状态保存在 configError_ |
| runtime:CreateRegistered(name, presentation, properties, slots) | 页面/控件类实例；未找到等情况返回 nil, error；构造期也可能抛 Lua 错误 |
| runtime:CreateComponent(markupPath, parentContext, props, slots) | 加载同名后端并建立组件实例 |
| runtime:RenderMarkup(markupPath, declaration, inherited) | root, context 或 nil, error；仅渲染标记，不再次加载后端 |
| instance:GetRoot() | 获取可挂载的 UI 根 |
| instance:Dispose() | 作者定义的清理，由宿主在退出/替换时调用 |
| runtime:LayoutProbe(root) | 按名称输出位置、尺寸、内容尺寸、缩放，用于布局诊断 |

旧 Render / RenderRegistered 与 Build 后端仅为兼容入口，新类使用 New → Init → InitializeComponent → RenderMarkup。

页面构造签名 `New(presentation, runtime, descriptor)`；控件签名见 [组件](components.md)。RenderMarkup 在返回前调用 AfterMount 与 owner:OnLoaded；传入的回调不能依赖调用结束后才赋值的字段。

## 宿主管理

宿主负责 UI.Init、挂载根、导航、旧页面 Dispose 及必要的子实例清理。示例 [Start.lua](../examples/tutorial/Start.lua) 给出最小 Navigate/Dispose 实现，避免覆盖既有游戏 UI 初始化逻辑。

数据改变需要明确刷新路径：Notify 只通知回调；原位修改使用引用，结构变化由宿主重建。Notify/Commit 语义见 [绑定与事件](bindings.md)。缓存中的标记与后端不会因磁盘变化自动失效；开发时重新建立 Runtime/页面再验证新文件。

## 资料更新

两种部署入口共用资料交付逻辑。源码由 docs、skills、examples 维护；VSIX 包内包含同一份内容。部署仅覆盖上次登记且未被用户修改的资料，保留冲突并写入 docs/lui/.delivery.json 的 preserved 列表。不自动删除已移出新版清单的旧文件；处理遗留资料前确认它们是否被用户引用。

要恢复某份资料的受管理版本，先保存自己的修改，再将目标移到自选备份位置并重新部署。不要删除整份交付记录来解决单文件冲突。
