# LUI 0.3 语言约定

LUI 使用安全 XML 子集：元素、属性、嵌套、注释、`lui:If`、`lui:For`、`lui:Preview`、`{Binding path}` 与 `{Action ActionKey}`。不支持 DTD、外部实体、内嵌脚本或任意表达式。

设计文件后缀固定为小写 `.lui`；同名 `.lui.lua` 是数据、动作和局部刷新的后端。

`x:Name` 与 `x:DisplayName` 属于 UTF-8 设计层，不能成为绑定、动作或 UI 文案的隐式来源。只有 ASCII `x:Ref` 会登记到 Lua 的 `context.refs`；`Binding`、`Action` 和 `.lui.lua` 也必须使用 ASCII。运行时按 `componentDirectories` 中的实际目录路径加载组件，不解析中文目录别名。

根节点以 `xmlns:别名="目录路径"` 导入组件目录，例如 `xmlns:积木="Presentation/Components"` 后使用 `<积木:Header />`。同一文件中 `x:Name`、`x:DisplayName` 各自唯一且不能冲突；同一渲染树中的 `x:Ref` 唯一。v2 禁止未导入或未登记的组件，也会拒绝循环组件依赖；v1 的全局 `documents` 仅保留兼容读取。

| 类别 | 示例 | 约束 |
| --- | --- | --- |
| 页面 | `<lui:Page x:Name="塔内" x:DisplayName="无尽塔">` | 设计名称可使用 UTF-8 |
| Lua 控件引用 | `x:Ref="EnemyHp"` | 仅 ASCII；写入 `context.refs.EnemyHp` |
| 绑定 | `Text="{Binding profile.coins}"` | 仅点分路径 |
| 动作 | `Click="{Action OpenTower}"` | 仅 ASCII 动作键 |
| 条件 | `<lui:If Test="{Binding hasRun}">` | 条件在 Lua 中预先计算 |
| 循环 | `<lui:For Each="entry" In="{Binding entries}">` | 使用数组顺序 |
| 预览 | `<lui:Preview x:Name="Battle" x:DisplayName="战斗中"><lui:Set Path="title" Value="第 12 层" /></lui:Preview>` | 仅 VS Code 读取；`lui:Set` 只为 `{Binding title}` 提供模拟值 |

## 单标签设计器

`.lui` 的默认编辑器是单一 LUI Studio 标签：上半区为元素树、预览画布和中文属性，下半区为内嵌 CodeMirror 源码。树、画布、属性和源码光标按节点范围双向定位，且中间分隔条可调整比例。进入已展开的目录组件内部节点时，底部在同一标签中切换到组件设计文件，并显示“页面 / 组件路径”；不会创建 VS Code 编辑器组。源码、属性都通过带版本号的 `WorkspaceEdit` 写回宿主 `TextDocument`，旧版本写入会被宿主内容替换。

`.lui.lua` 应返回：

```lua
return {
    Build = function(presentation)
        return {
            view = { title = "无尽塔" },
            actions = {
                OpenSettings = function() presentation:OpenSettings() end, -- LUI：打开设置
            },
        }
    end,
}
```

代码后端只能生成展示数据、转发动作、保存控件引用并做原位刷新；不得调用 `UI.Panel`、`C.Row` 或构建布局。
