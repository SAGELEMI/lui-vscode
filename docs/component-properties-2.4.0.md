> 历史实现/项目验收记录；当前使用规则见 [LUI 文档](README.md)。业务页面与数量不属于通用框架规范。

# LUI 2.4.0 组件公开属性

组件公开属性由其后端返回的同名类显式声明；Studio静态解析整份Lua后端，从该类的唯一 `Properties` 字面量表读取接口，绝不执行Lua。六个项目控件均已迁移。没有声明的外部旧控件保留推导兼容并提示迁移。

```lua
local EquipmentSlotsControl = {}
EquipmentSlotsControl.Properties = {
    ["武器文本"] = { type = "string", default = "", description = "武器槽副文" },
    ["护甲文本"] = { type = "string", default = "", description = "护甲槽副文" },
    ["选择武器"] = { type = "event", description = "调用方选择武器动作" },
    ["选择护甲"] = { type = "event", description = "调用方选择护甲动作" },
}
-- 保留现有 New / Init / InitializeComponent / CreateContext / Dispose。
-- 实例内：self.props_["武器文本"]。
return EquipmentSlotsControl
```

```xml
<文本 文本="{绑定 props['武器文本'], 模式=单向, 更新源触发=默认, 预览内容='武器'}" />
<按钮 点击="{绑定 props['选择武器']}" />
```

调用处的 `武器文本="{绑定 view.weaponText}"` 与 `选择武器="{动作 SelectWeapon}"` 不变。`view.weaponText`是页面业务字段，不属于组件接口迁移范围。

## 类型与默认值

- 类型为 `string / number / boolean / table / event`。说明使用 `description`；默认值使用同类型 `default`，可以省略。
- 属性名是合法LUI属性标识：UTF-8精确字符串、区分大小写，不含空白、标记分隔符、引号、冒号、括号或反斜杠，不以数字开头。不执行索引表达式。`Title`与`标题`可作为不同接口，不会互相转换。
- 布局与框架身份属性（宽高、内外边距、对齐、名称等）不可重定义；仍由框架提供。内部读取中文布局参数可用 `props['高度']`。
- 数字和布尔静态属性在Runtime转为对应类型；集合使用绑定传入。表默认值按实例深复制；事件无默认值，由调用方提供动作键/动作表达式。
- Runtime在构造前检查接口和参数。未知参数、错误类型、非法默认值都报错。组件通过自身绑定上下文提交中文路径，`Commit/Notify`保留原路径；调用处双向绑定可向父级路径写回。
- 点路径继续读取旧ASCII字段；新接口采用字符串括号路径。只作表索引，不求值Lua。

## 编辑器行为

补全、属性面板、类型诊断和跳转共用同一静态声明。新增或修改后端会刷新；后端语法错误时保留最近有效声明并显示错误。有效删除属性会使原调用处得到未声明诊断。明确点击“转到声明”或原生转到定义才打开后端，选中/刷新不自动换文件。

每次重新创建Webview以100%启动，不恢复上次倍率；存活标签、模型确认和分区调整不会重置倍率。页面只用设备视口，控件用自身尺寸/绑定预览。适应按钮仍为主动操作。独立高亮层用直角矩形、穿透点击，跟随实例/缩放/滚动并受祖先可见区域约束，不改变真实控件圆角。

## 模块与验证入口

- `packages/spec/src/properties.ts`：静态声明、公共布局保留名。
- `packages/spec/src/paths.ts`：安全字符串键路径。
- `packages/spec/src/completion.ts`：两套编辑器的统一候选。
- `adapter/Properties.lua`、`adapter/Paths.lua`：运行时参数与路径；正式源始终位于源仓库，禁止直接修改游戏部署副本。
- `scripts/check-properties.mjs <项目>`：全量14设计/六控件检查。
- `tests/properties.test.mjs`、`scripts/test-properties-lua.py`：声明、默认值、路径、上下文与构造回归。
