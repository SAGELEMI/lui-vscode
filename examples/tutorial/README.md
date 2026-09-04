# 教学示例

适用 LUI 2.4.3。这里是完整可接入的工程片段，不包含引擎或游戏业务实现。

| 示例 | 标记 | 后端 |
| --- | --- | --- |
| 页面与计数刷新 | [Welcome](Pages/Welcome.lui) | [Welcome 类](Pages/Welcome.lui.lua) |
| 中文公开属性与动作转发 | [ActionCard](Components/ActionCard.lui) | [ActionCard 类](Components/ActionCard.lui.lua) |
| JSON 预览、重复项原始项、选择详情 | [Inventory](Pages/Inventory.lui) | [Inventory 类](Pages/Inventory.lui.lua) |

## 接入步骤

1. 在 UrhoX 游戏中部署 LUI，确认 urhox-libs/UI、cjson 和 Presentation.Components 模块可用。此示例不用业务卡片函数，但 Runtime 仍会加载 Presentation.Components；不要覆盖已有模块。
2. 将本目录 Pages、Components 中的配对文件复制到游戏 scripts/Presentation 下对应目录，先确认没有同名设计。保留/生成目标项目要求的 .meta。
3. 把 [配置片段](lui.project.json) 的 sourceRoots 和 componentDirectories 合并到 scripts/LUI/lui.project.json，保留部署版本、契约、哈希及所有其他登记。
4. 在 Studio 创建/保存页面以刷新 Registry。[Registry.lua](Registry.lua) 仅说明所需登记结构；纯手动接入时合并相应条目，不覆盖已有注册表。
5. 将 [Start.lua](Start.lua) 放到 scripts/Presentation/Tutorial.lua。在宿主完成 UI.Init 后调用 `require("Presentation.Tutorial").New()`，保留返回实例并在退出时 Dispose。已有复合 UI 根的项目按自身挂载方式替换示例的 UI.SetRoot。

## 预期行为

- Welcome 点击增加一次：真实 count 增加，Notify 触发 OnBindingChanged，通过 CounterText:SetText 更新显示。
- 查看物品：切换到 Inventory；旧页由示例宿主 Dispose。
- 点击药水或钥匙：收到原始项，记录稳定 ID，更新详情；确认按钮由组件 event 属性转发到页面动作。
- 未选择或选择已失效时确认：显示请选择有效物品。空 rows 不生成条目，也不自动生成空状态卡片。

Studio 使用绑定预览内容，不运行上述业务动作。当前 Runtime 的 Notify 不是全树自动刷新；结构变化由宿主重建。本示例的组件没有外部订阅，复杂组件的嵌套销毁由宿主另行管理。
