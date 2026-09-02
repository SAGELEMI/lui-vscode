# LUI 0.1 语言约定

LUI 使用安全 XML 子集：元素、属性、嵌套、注释、`lui:If`、`lui:For`、`lui:Preview`、`{Binding path}` 与 `{Action PrimaryName}`。不支持 DTD、外部实体、内嵌脚本或任意表达式。

运行时读取设计文件后会立即丢弃 `x:DisplayName`，并把 `x:Name` 折叠为内部数字符号；副名称不能成为绑定、动作或 UI 文案的隐式来源。

| 类别 | 示例 | 约束 |
| --- | --- | --- |
| 页面 | `<lui:Page x:Name="Cover" x:DisplayName="封面">` | 主名称必填 |
| 绑定 | `Text="{Binding profile.coins}"` | 仅点分路径 |
| 动作 | `Click="{Action OpenTower}"` | 仅 ASCII 主名称 |
| 条件 | `<lui:If Test="{Binding hasRun}">` | 条件在 Lua 中预先计算 |
| 循环 | `<lui:For Each="entry" In="{Binding entries}">` | 使用数组顺序 |
| 预览 | `<lui:Preview x:Name="Battle" x:DisplayName="战斗中"><lui:Set Path="title" Value="第 12 层" /></lui:Preview>` | 仅 VS Code 读取；`lui:Set` 只为 `{Binding title}` 提供模拟值 |

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
