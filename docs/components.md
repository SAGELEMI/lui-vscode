# 组件与公开属性

[返回文档入口](README.md)。适用版本：2.4.6。

组件由根为控件的 .lui 与同名 .lui.lua 类组成。目录是导入命名空间，公开名称由配置登记。[ActionCard 示例](../examples/tutorial/Components/ActionCard.lui.lua) 展示完整生命周期。

## 唯一接口声明

```lua
ActionCard.Properties = {
    ["标题"] = { type = "string", default = "操作", description = "卡片标题" },
    ["确认"] = { type = "event", description = "调用方动作" },
}
```

Properties 必须是可静态读取的字面量表，Studio 不执行 Lua 推导接口。支持 string、number、boolean、table、event。默认值类型必须匹配；表默认值按实例复制；event 不设默认值。不要用运行时计算拼装声明。

中文键在调用处的标题属性、标记的 `props['标题']`、Lua 的 `self.props_["标题"]` 三处完全一致，不隐式翻译为 Title。公共布局属性由框架提供，不能在 Properties 中覆盖。

event 接收 `{动作 Confirm}` 动作字符串，不是 Lua 函数值；组件内部使用 `点击="{绑定 props['确认']}"` 转发调用方动作。table 属性通过集合绑定传入，不把 Lua 表源码放进 XML 属性。

## 登记与调用

在游戏 scripts/LUI/lui.project.json 的已有配置中合并以下内容：

```json
{
  "sourceRoots": ["Presentation"],
  "componentDirectories": {
    "Presentation/Components": {
      "操作卡": { "markup": "Presentation/Components/ActionCard.lui", "code": "Presentation/Components/ActionCard.lui.lua" }
    }
  }
}
```

保留部署写入的版本、契约、哈希及其他登记。Runtime 按同名约定加载 `markup + ".lua"`，不支持以不同名称后端作为新组件模式。

```xml
<页面 目录:积木="Presentation/Components" 名称="CardDemo" 宽度="390" 高度="844">
  <积木:操作卡 标题="{绑定 view.title, 预览内容='准备出发'}" 确认="{动作 Confirm}">
    <文本 文本="这段内容由调用方提供" />
  </积木:操作卡>
</页面>
```

组件根内至多一个内容呈现器，接收调用方子内容。单一默认槽是推荐用法，不推定多命名插槽等完整 WPF 模板能力。

当前 Runtime 在组件上下文中构建插入内容，里面的 view 是组件的 view，不自动恢复调用方 view。插入的动态模板通过显式公开属性传数据；Inventory 将页面 view.rows 传给组件条目属性，内部模板读取 props['条目']。不要直接在槽内容中假定 view.rows 仍指页面数据。

## 类与生命周期

控件构造签名为 `New(parentContext, runtime, descriptor, props, slots)`。初始化字段后调用自己的 InitializeComponent，仅通过 `runtime:RenderMarkup(descriptor.markup, context, parentContext)` 渲染标记。不要调用会重新加载自身后端的入口，避免递归。

上下文传递 view、props、slots、actions、presentation、componentStack 和 owner；每个组件应提供独立 `refs = {}`，避免重复实例共享引用。

Runtime 在 RenderMarkup 返回前调用 `OnLoaded(root, context)`，所以此时应使用参数，不依赖返回后才赋值的 self.context_。宿主管理 Dispose 的调用和嵌套实例清理，解除订阅、异步任务和引用；不要假设 Runtime 自动销毁所有组件。
