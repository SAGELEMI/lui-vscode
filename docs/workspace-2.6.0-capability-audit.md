# 2.6.0 原生控件能力审计

记录日期：2026-09-06，对应无尽塔交接 R260-05。当前结论是**已修复一组明确的字段与事件桥接问题，全部标签/全部状态验收仍未完成**。

## 证据范围

- 正式声明：`packages/spec/controls.json` 的 43 项控件、`ui-capabilities.json` 的通用属性组及 `generatedControlAttributes`。
- 正式运行时：`adapter/Runtime.lua` 的属性转换、通用控件构造与事件接线；新增 `adapter/NativeControls.lua` 的 `Prepare/Attach/EventCallback/Apply`；动态源更新由 `LiveProps.Apply` 调用其 `Apply`。
- 原生消费端：从本地已缓存的**官方 UrhoX 1.29.7 / engine-res 3e4d4e1c** 原始资源包按清单解出 Lua 源码；没有使用游戏内参考库替代。包 SHA256：`1a0facb62011287bfa8afaa8071ce91591f549b4d617bed1d53d87ea1b80a39d`。
- 新检查：`tests/runtime-native-controls.py`。执行未修改的官方原生构造器、getter、setter、输入方法；基础 Widget/Yoga、主题、测量及嵌套富文本布局使用测试基础设施。该测试验证实际原生状态消费，**不验证 NanoVG 像素、GPU 命中或全部控件外观**。

## 本次已修复并验证

| 标签/属性 | 原生消费证据 | 修复与验证 |
| --- | --- | --- |
| Checkbox `Value/Text` | 官方 `Checkbox.lua:84` 读 `checked`，231/244 写读选中态，251 使用 `label` | `Value→checked`、`Text→label`；布尔字面量“是”及绑定、`Toggle` 双向写回、动态 false 均通过。 |
| Tabs `Value/Items` | `Tabs.lua:108/114/159` 使用 `tabs/activeTab`，915 切换，944/1028 读取 | `Value→activeTab`、`Items→tabs`；初始第二项、动态切换、用户切换写回、集合更新保留有效内容实例通过。 |
| Chip `Value/Text/Change` | `Chip.lua:92/98/517–520` 使用 `label/selected/selectable/onSelect` | 显式值或 Change 时启用选择；`Change→onSelect`；真实 `OnClick` 回传布尔，动态刷新无事件。 |
| Stepper `Value/Items` | `Stepper.lua:81–89` 缓存 `steps/activeStep/onChange_`，661/677 为原生 setter/getter | `Items→steps`、`Value→activeStep`（0 起）；有 Change 时启用点击；动态变化调用原生 setter 且静默。 |
| Pagination `Value/Max` | `Pagination.lua:65–66` 使用 `currentPage/totalPages`，109–129 执行范围钳制 | `Value→currentPage`、`Max→totalPages`；初值、范围缩小钳制、上一页写回均通过。 |
| Carousel `Value/Items` | `Carousel.lua:60–61` 使用 `items/initialIndex`，116 `GoTo`，108 读取当前项 | `Value→initialIndex`（1 起）；后续静默 `GoTo(..., false)`，不把外部更新当滑动操作。 |
| Calendar `Value/Change/Select` | `Calendar.lua:106/121` 使用 `selectedDate/onDateSelect_`，195–199 用户选择 | `Value→selectedDate`；Change 与 Select 共享原生回调时依次执行，不互相覆盖；双向更新日期通过。 |
| Rating、DatePicker、TimePicker、ColorPicker 动态 `Value` | 原生 Rating 的 `value_`，三个 picker 的日期、时分秒、HSV 状态均不是修改 `props.value` 即可更新 | 复用已核对原生 setter 更新内部状态；不重构控件，不发业务 Change；Rating 明确按数值契约转换 Value/Max，picker 禁用内部字段同步、nil 清空/原生默认颜色通过。 |
| Dropdown `Value`、Tabs 字符串 ID | `Dropdown.lua:805/819` 使用 `props.value`；Tabs 按原始 ID 选择 | 初始化、动态值和真实 setter 双向写回通过；字面量、绑定及用户选择均保留 `0010/0012` 字符串，不经过通用 `tonumber`。 |
| Dropdown `Open/Close` | `Dropdown.lua:714` 的 `SetOpen` 管理状态和全局 overlay，905 的 `SetDisabled` 则直接写关闭状态 | `Attach` 观察已完成的开合变化，一次变化只通知一次；重复 Open/Close、仅注册 Close、禁用关闭和原生选项选择已验证。禁用关闭调用官方 SetOpen 完成 overlay 清理；普通 Value 刷新不触发开合事件并保留滚动。 |
| TextField 动态 `Text` | 官方构造器和 `GetValue/SetValue` 使用 `props.value` 及光标选择状态 | 实际 TextField 构造、中文值刷新、缩短文本后光标/选区边界、原生 SetValue 双向写回通过。 |
| Breadcrumb/Menu `Select` | 两者原生使用 `onItemClick`；Breadcrumb 382、Menu 723 | 改接真实回调；执行原生 `OnClick`，只固定几何命中位置，保留原条目与索引。 |
| Table `Select` | `Table.lua:266–286` 使用 `selectable_/onRowSelect_` | 显式 Select 开启原生选择，`SelectRow` 返回原生索引数组。 |
| ItemSlot `Click` | `ItemSlot.lua:264–266` 使用 `onSlotClick(self,item)` | 改接真实回调；原生 `SetItem/OnClick` 保留物品对象。 |
| VirtualList/SkillTree/ChatWindow `Select` | 原生第一参数就是业务对象：VirtualList 177、SkillTree 374、ChatWindow 173 | 分别接 `onItemClick/onNodeClick/onItemClick` 并保留第一参数；执行原生事件路径。VirtualList 仅验证 `CreatePoolItem` 的实际事件桥，不包含声明式构造成功。 |

源到控件的静默 setter 调用暂时屏蔽当前控件的外发 `DispatchEvent/onChange`，无论成功或失败都恢复；错误恢复、单次绑定不刷新、对象身份和已有焦点/滚动状态已覆盖。额外验证 Pagination 的单次 Value 与动态 Max（仅允许原生范围钳制）、单次 Max 与动态 Value，以及 Tabs/Stepper/Carousel 动态 Items 不会偷读最新的单次 Value。字段映射集中在 NativeControls，不能要求页面复制原生字段知识。

`tests/runtime-native-controls.py`、`scripts/test-properties-lua.py`、`tests/runtime-layout-math.py packages/runtime-urhox-lua/adapter artifacts/python` 通过；`git diff --check` 无空白错误。新增检查的官方缓存缺失或哈希异常时会失败，不用本地参考源码代替。

## 明确仍未闭环

| 范围 | 当前差距/需要补的验收 |
| --- | --- |
| 全部 43 控件 × 通用属性组 | `generatedControlAttributes` 给所有控件同一属性集合；“已声明/传进 props”不等于原生读取。`Text/Items/Data/Source/Columns/Rows/Min/Max` 等必须继续逐控件收窄或补映射，不能用通用 props 桩放行。 |
| VirtualList 声明式创建 | 官方 `VirtualList:Init` 明确要求 `itemHeight/createItem/bindItem`（45–53）；当前词汇与通用构造未暴露工厂及绑定能力。仅修正 Select 不能让该标签完整可用。 |
| SpriteSheet | 官方实现是帧/动画数据资源，其 API 包含 GetFrame/GetAnimation 等；不能直接把通用“视觉控件 + Complete”声明当作 Widget 契约。需要独立设计其与 Sprite 的资源关系。 |
| Tree `Change`、ItemSlot `Change`、SkillTree `Change` | 原生分别存在 check/expand/select、槽位/拖放、解锁/锁定等不同事件；没有对应的通用 `onChange` 消费端。需先确定统一语义后适配。 |
| FileUpload `Change/Submit`、ChatWindow `Submit` | 原生 FileUpload 使用 `onFileSelect/onFileRemove/onUploadComplete` 等细分回调；ChatWindow 负责显示消息，没有当前声明的提交输入回调。不能静默声称可用。 |
| Spine/SpriteSheet `Complete` | Spine 使用 `SetCompleteListener`，SpriteSheet 为资源对象；当前通用 props.onComplete 接线不能证明完成事件有效。 |
| 原生非值属性的动态消费 | 如 DatePicker/TimePicker/ColorPicker 将字号、占位等缓存为内部字段；通用动态写 `props.fontSize/placeholder` 未逐项证明会更新。其他 Data/Options 集合和已存内部列表也需逐项核对。 |
| 全标签交互/外观状态 | normal/hover/pressed/disabled、颜色与字体、全部标签构造仍需真引擎矩阵。本文的原生方法测试不含成对原始 RGBA，不能作为 R260-06 的零差异证据。 |

## VS Code 原生撤销测试审查

已完整阅读 `scripts/test-vscode-document.mjs` 与 `tests/vscode-document-browser.cjs`。测试启动隔离的 VS Code 扩展开发宿主，使用真实 `vscode.workspace.openTextDocument`、`WorkspaceEdit`、生产 `LuiPreviewProvider`；明确调用 `vscode.commands.executeCommand('undo'/'redo')` 并检查 TextDocument 和 CodeMirror 同步，因此它**确实覆盖原生 TextDocument 撤销**，不只是网页编辑器替身。

同时涵盖 CodeMirror 撤销/重做、延迟确认前撤销、CRLF 保存、连续字符版本增长、分组撤销、中文 IME、公开属性编辑、声明跳转与多实例选择。但 Webview 传输由 HTTP 替身承担，CSS `#canvas` 的布局/选框断言不等于官方引擎帧；属性编辑→最新真实引擎帧→原生撤销仍需新综合用例。脚本名称/报告版本含历史 2.4.x 标记，不能单凭旧报告当作本轮执行证据。

本审计未运行安装/重载 VS Code；本轮隔离宿主执行结果由主任务另行记录。
