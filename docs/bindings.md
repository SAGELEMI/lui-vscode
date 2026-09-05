# 绑定、动作与重复项

[返回文档入口](README.md)。适用版本：2.6.0。

## 数据来源

同名 Lua 的 CreateContext 提供 view、actions，组件还提供 props。绑定只读取受限路径；算术、业务判断和复杂格式在 Lua 预先计算。

```xml
<文本 文本="{绑定 view.title, 模式=单向, 更新源触发=默认, 预览内容='欢迎'}" />
```

预览内容只供 Studio 使用，运行时读取真实字段。预览集合必须是纯 JSON，例如单引号包裹 `[&quot;甲&quot;,&quot;乙&quot;]`，不要放 Lua 表或表达式。格式字符串可写 `字符串格式='数量：{0}'`。

## 模式与刷新边界

| 模式 | 作用 |
| --- | --- |
| 单向 | 构建时读取；已支持的标量属性在下一次根绘制前原位刷新 |
| 单次 | 固定读取，不跟踪组件属性转发 |
| 双向 | 支持的输入控件变更可写回绑定路径 |
| 单向到源 | 输入变更写回源；初始显示以当前适配器实现为准 |

`context.bindings:Notify(path)` 调用声明的 OnBindingChanged 或 owner:OnBindingChanged，不自动重建控件树。2.6.0 在根绘制前原位更新绑定的尺寸、通用颜色/画刷、字体、禁用、变换、文字描边，以及文本/按钮标题和文本框文字。原生 Modal 正文也参与遍历；单次模式保留初值。`LiveProps.lua` 是当前标量更新范围的实现入口，未列出的原生集合和专用 value 仍需对应 setter；条件、重复项数量或结构变化仍需要宿主安排重建相关子树，并保留选择状态。

文本框从数据源刷新不会调用会派发 change 的原生 SetValue，因此不合成业务输入事件；保留控件和焦点，缩短文本后将光标/选择位置限制在文本长度内。nil 清空文本及显式颜色，false 可重新启用按钮，画刷从渐变变为纯色时清除旧渐变。

`BuiltinValues.lua` 负责开关、滑块、进度条：值与范围批量更新只执行一次；滑块按最终范围夹取，保留作者原始值以便范围扩大后恢复。绑定的单次值和单次画刷不会随其他属性变化重新取值；进度条显式轨道画刷优先于背景，nil 使用契约默认或背景回退。带布局外壳时仍更新内部原生控件，引用不变。文本和字符串 ID 保留前导零；只有已核验的数值字段进行数字转换。

组件公开属性的单向绑定在每次读取时重新解析父上下文。源值为 `false`、`0` 或空字符串时按真实值传递；源值变为 `nil` 时使用该公开属性声明的默认值，没有默认值则保持 `nil`，不会回退到组件创建时的旧快照。

调用方传入的内容呈现器内容保留作者作用域：props、view、目录别名、重复项别名、引用和动作均来自写下内容的调用方。每次组件调用持有独立的内容数组，多层转发不把它改成组件内部作用域；手工提供的未标记 slots 保持既有上下文处理。Studio 投影同样保留缺失输入的组件默认值，不将 nil/null 转为空字符串覆盖默认。

更新源触发语法接受默认、属性变更、失焦、显式。当前通用事件桥仅将显式模式暂存到 bindings.pending；其余模式在 onChange 写回，没有独立的通用“只在失焦时提交”实现。需要确定时机时使用显式模式，在动作中调用 `context.bindings:Commit("view.name")`；没有待提交值时返回 false。

2.6.0 的 `NativeControls.lua` 将通用 Value 转为经核验的原生存储字段：复选框 checked、选项卡 activeTab、标签片 selected、步骤条 activeStep（从 0 起）、分页 currentPage、轮播 initialIndex（从 1 起）、日历 selectedDate。选项卡 Items→tabs、步骤条 Items→steps、标签片 Text→label、分页 Max→totalPages。静默源刷新同步必要原生状态并保留对象；集合结构变化建议替换表或调用对应 setter，不把表内原地修改假定为深层可观察变化。

原生事件也按实际签名适配：标签片 Change→onSelect、日历 Change/Select→onDateSelect；面包屑/菜单 Select→onItemClick、表格→onRowSelect、虚拟列表→onItemClick、技能树→onNodeClick、聊天窗口→onItemClick。虚拟列表、技能树、聊天窗口原生首参就是数据，桥接保留该参数。专用事件/集合之外的控件能力仍需按当前原生 API 核验。

下拉框 Open/Close 观察原生 SetOpen 的完成状态，只在实际开合转换时通知一次；禁用导致关闭时同时清理原生覆盖层。数据 Value 刷新不合成开合事件。绑定直接返回函数的事件目前在构造时接线，替换函数不会自动重新接线；动作名称仍在调用时查找 actions。

## 动作与受控命令

`点击="{动作 Confirm}"`查 actions.Confirm。输入事件桥去掉底层 widget 参数，将剩余参数传给动作；普通按钮通常没有业务参数。重复项内部按钮传当前原始项，可使用 `Select = function(row) ... end`。不同控件参数以底层 UI 文档和适配器为准。

2.4.6 也支持事件绑定返回 Lua 函数；按钮传原始重复项和事件，输入变更传新值，公开 `event` 属性可传动作字符串或函数。滑块的最小值、最大值都先解析绑定再取数值。缺省的重复项集合产生零条，不生成虚构样例；预览需要样例时显式写 JSON 预览内容。

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

按钮标题与文字对齐在根布局／绘制前读取绑定值。非法对齐值报错，nil 对齐回到居中，nil 标题清空；不将预览内容回填到 Lua 数据。其他属性遵循上面的刷新范围。
