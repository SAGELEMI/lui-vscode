# 绑定、动作与重复项

[返回文档入口](README.md)。适用版本：2.4.3。

## 数据来源

同名 Lua 的 CreateContext 提供 view、actions，组件还提供 props。绑定只读取受限路径；算术、业务判断和复杂格式在 Lua 预先计算。

```xml
<文本 文本="{绑定 view.title, 模式=单向, 更新源触发=默认, 预览内容='欢迎'}" />
```

预览内容只供 Studio 使用，运行时读取真实字段。预览集合必须是纯 JSON，例如单引号包裹 `[&quot;甲&quot;,&quot;乙&quot;]`，不要放 Lua 表或表达式。格式字符串可写 `字符串格式='数量：{0}'`。

## 模式与刷新边界

| 模式 | 作用 |
| --- | --- |
| 单向 | 从数据源提供构建时的属性值 |
| 单次 | 固定读取，不跟踪组件属性转发 |
| 双向 | 支持的输入控件变更可写回绑定路径 |
| 单向到源 | 输入变更写回源；初始显示以当前适配器实现为准 |

当前 Runtime **不是自动响应式渲染器**。`context.bindings:Notify(path)` 调用声明的 OnBindingChanged 或 owner:OnBindingChanged，不自动刷新所有控件。简单字段变化可用引用和控件 setter 原位刷新；条件、重复项数量或结构变化需要宿主安排重建相关页面/子树，并保留必要选择状态。

更新源触发语法接受默认、属性变更、失焦、显式。当前通用事件桥仅将显式模式暂存到 bindings.pending；其余模式在 onChange 写回，没有独立的通用“只在失焦时提交”实现。需要确定时机时使用显式模式，在动作中调用 `context.bindings:Commit("view.name")`；没有待提交值时返回 false。

## 动作与受控命令

`点击="{动作 Confirm}"`查 actions.Confirm。输入事件桥去掉底层 widget 参数，将剩余参数传给动作；普通按钮通常没有业务参数。重复项内部按钮传当前原始项，可使用 `Select = function(row) ... end`。不同控件参数以底层 UI 文档和适配器为准。

| 命令 | 示例 | 宿主要求 |
| --- | --- | --- |
| 设值 | `{命令 设值, 路径='view.status', 值='准备'}` | 修改后 Notify，可调用 presentation:Render() |
| 可见性 | `{命令 可见性, 路径='view.visibility', 值='显示'}` | 绑定到可见性属性，修改后 Notify |
| 页签 | `{命令 页签, 键='main', 值='items'}` | presentation:SetComponentTab(key, value)，可调用 Render |
| 导航 | `{命令 导航, 目标='Inventory'}` | presentation:Navigate(target) |
| 关闭 | `{命令 关闭, 目标='Dialog'}` | context.refs.Dialog:Close() |

命令参数必须加引号，运行时保留字符串值，不自动把 'true' 转成 Lua 布尔值。设值路径当前仅接受 view 下 ASCII 点路径；布尔条件和中文数据键的复杂更新用动作处理。命令不执行 Lua。

## 列表

```xml
<重复项 项目="row" 集合="{绑定 view.rows, 预览内容='[{&quot;id&quot;:&quot;a&quot;,&quot;title&quot;:&quot;示例&quot;}]'}">
  <按钮 文本="{绑定 row.title}" 点击="{动作 Select}" />
</重复项>
```

使用连续 Lua 数组，按 ipairs 顺序展开；空集合生成零个条目，不增加布局容器。声明别名和 item 指向当前项，嵌套保留外层别名。用稳定业务 ID 记录选择，不用文案作为身份。[Inventory 示例](../examples/tutorial/Pages/Inventory.lui.lua) 展示点击原始项、更新模型并通过引用刷新详情，不假设 Notify 自动重建 UI。
