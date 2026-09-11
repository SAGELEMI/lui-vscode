# UrhoX Lua 运行时接入

[返回文档入口](README.md)。适用版本：3.0.1。

## 部署与路径

运行时部署在 scripts/LUI，使用 `require("LUI")` 创建入口。scripts 是资源根，标记路径写 `Presentation/Scenes/Welcome.lui`，不加 scripts/ 前缀。默认配置 `schemaVersion` 为 5；`sourceRoots` 限制允许加载的后端，`componentDirectories` 是纯目录白名单，公开组件名只来自 `<控件>` 根的 `副名称`。注册表分别维护 `scenes`、`pages`、`controls`。

LUI Studio 从配置的 sourceRoots 扫描配对文件维护 Registry.lua；手动接入可用示例 Registry 作为结构参考。页面名和控件名在注册表中不得冲突；不要编辑正在被 Studio 自动维护的注册表来绕过源文件问题。

部署修改 version、layoutContract、runtimeManifestHash，保留作者的白名单和登记。运行时升级备份位于 scripts/LUI/.backup-last；不要将它作为业务源目录。资料保存在 docs/lui 与 skills，不混入游戏 Lua 资源目录，也不产生资源 .meta。

## 宿主前提

### 原生弹窗引用与所有权（2026-09-05）

`<弹窗 引用="Dialog">` 的引用始终是实际 `UI.Modal`，不以普通 Panel 包装代替；页面根仍是布局宿主。需要由宿主显式取出 `context.refs.Dialog`，从未挂载设计根分离，再调用原生 `Open()` 自动挂到当前 UI 根。不要对页面 `GetRoot()` 调用弹窗方法。

LUI 不替业务决定多个同时打开 Modal 的先后关系。原生 `PushOverlay/PopOverlay` 维护输入优先级，而兄弟节点的 `层级/ZIndex` 决定 Modal 延迟绘制回调的收集顺序，两者不会自动同步。允许父弹窗继续显示并在其上打开详情时，宿主必须使用一个集中式弹窗管理器：只在真实的关闭→打开或恢复转换后扫描实际挂载父节点，将新 Modal 的 `zIndex` 设置为当前兄弟最大值加一；重复打开已打开实例保持幂等。不要在各业务页面分散填写固定层级。

`MountGlobalOverlay` 使用独立的覆盖层绘制与输入排序，不与 Modal 的兄弟 `zIndex` 混排。教程、通知、保存阻断等设备级覆盖层继续走该接口，不要通过提高业务 Modal 层级替代它。

复合按钮的显式背景会同步到未声明的悬停/按下状态；`悬停背景`和`按下背景`则直接映射为底层按钮状态色。文字按共享契约的 1.45 逻辑行高测量，先扣除边框和内边距再排列子项；自闭合按钮的缺省高度明确为 36px，不允许 UrhoX 主题重新注入 44px。

Modal 使用响应式 fullscreen 预设（屏幕的90%），保留关闭事件、背景、内容内边距与交互。禁止遮罩关闭时同步禁止 Escape，不能把奖励的关闭当作放弃。UI 根整体销毁前先分离仍存活的弹窗，弹窗释放时解除 overlay、销毁其独立 contentContainer 及设计宿主。弹窗内容高度有界，内部滚动，确认按钮固定。

回归必须运行原生 Modal 的 Open/Close/IsOpen 生命周期；嵌套流程还要同时断言新弹窗的 `zIndex` 更高、`UI.GetTopOverlay()` 指向新弹窗，并在关闭后恢复父弹窗。普通 Panel 不得伪造这些方法。无 Yoga/绘制环境的生命周期测试不能作为视觉验收。

Runtime 顶层依赖 `urhox-libs/UI` 和引擎的 cjson/资源读取。通用控件和纯数据预览不依赖项目 Lua；仅使用下方旧宿主标签时才延迟加载 `Presentation.Components`。

2.5.0 启动前可调用 `LUI.Project.Validate(expectedVersion, expectedContract)`，一次检查项目配置、Runtime 清单、字体资源和 Registry 中所有页面／控件文件。项目字体在 `lui.project.json` 中按 family、weight、resource、sha256 声明；Studio 校验实际文件 SHA-256，Runtime 校验资源存在并把同一 normal/bold 路径交给 `UI.Init`。

当前适配器以下标签使用项目宿主函数：

| 标签 | 调用约定 |
| --- | --- |
| 分区 | Components.Section(title, children, subtitle) |
| 提示 | Components.Notice(text, isError) |
| 屏幕 | Components.Screen(nil, children, props) |
| 固定屏幕 | Components.FixedScreen(nil, contentWidget, props) |

这些函数不是此包自动生成的游戏业务实现。复用项目已有适配；新项目先实现所用标签的宿主约定。只使用通用容器的教学示例无需该模块。不应把无尽塔页签列表、楼层奖励等业务组件当成内置 LUI 功能。

## 公开入口

| 入口 | 返回与用途 |
| --- | --- |
| LUI.New() | Runtime 实例，读取当前项目配置；失败状态保存在 configError_ |
| runtime:CreateScene(name, presentation) | 创建拥有设备设计画布的顶层场景实例 |
| runtime:CreatePage(name, parentContext, parameters) | 创建宿主尺寸的受控页面实例及独立生命周期 |
| runtime:CreateNavigator(options) | 创建 Runtime 调度的导航对象；scene/page 候选完整绘制后原子提交 |
| runtime:StagePageReplacement(presenter, pageName, parameters) | 将候选页面完成关键布局和首帧后提升，下一帧释放旧页 |
| runtime:CreateRegistered(name, presentation, properties, slots) | 兼容创建已登记的场景、页面或控件；新代码优先使用分类入口 |
| runtime:CreateComponent(markupPath, parentContext, props, slots) | 加载同名后端并建立组件实例 |
| runtime:RenderMarkup(markupPath, declaration, inherited) | root, context 或 nil, error；仅渲染标记，不再次加载后端 |
| instance:GetRoot() | 获取可挂载的 UI 根 |
| instance:Dispose() | 作者定义的清理，由宿主在退出/替换时调用 |
| runtime:LayoutProbe(root) | 保留名称、声明/期望/最终尺寸、内容框、内缩、文字行盒、对齐、排列、缩放，并提供 sourcePath、nodePath、instancePath 区分无名称节点与重复实例 |
| runtime:FindByRef(root, ref, instancePath?) | 按稳定 `x:Ref` 查找已挂载控件；找不到返回 nil |
| runtime:GetReferenceRect(root, ref, instancePath?) | 返回目标绝对布局矩形与控件，供教程或诊断定位 |
| runtime:MountGlobalOverlay(host, overlay, layer) | 将通知、教程等覆盖层按数值层级稳定挂载，不依赖页眉或弹窗容器 |
| runtime:RefreshComponent(context.refs.Detail) | 显式刷新组件内部根，返回新根或 nil, error；调用处布局宿主与兄弟控件保留，引用自动更新 |
| runtime:NotifyChanged(context, paths) | 标记依赖；路径可为字符串或数组，同帧渲染合并刷新；省略路径标记当前作用域全部绑定 |
| runtime:UpdateContext(root, declaration) | 将 view/props/actions 的字段合入当前上下文并原位刷新；原地修改嵌套表时传 changedPaths |

旧 Render / RenderRegistered 与 Build 后端仅为兼容入口，新类使用 New → Init → InitializeComponent → RenderMarkup。

页面构造签名 `New(presentation, runtime, descriptor)`；控件签名见 [组件](components.md)。RenderMarkup 在返回前调用 AfterMount 与 owner:OnLoaded；传入的回调不能依赖调用结束后才赋值的字段。

## 宿主管理

`LuiNavigator` 提供 `GetRoot`、`Navigate`、`GetCurrent`、`IsCurrentReady`、`CancelPending` 与 `Dispose`。Runtime 帧调度器自动推进候选页；旧页在候选页完成布局和首个完整绘制前持续显示并接收输入，候选页完成一个可见帧后再释放旧实例。失败、取消和快速连续导航保留已提交页，重复导航到当前目标是幂等操作。`<页面呈现器>` 与兼容的 `StagePageReplacement` 复用同一实现。

宿主负责 UI.Init，并把 Navigator 根挂载一次；页面切换与旧页面 Dispose 由 Navigator 管理。示例 [Start.lua](../examples/tutorial/Start.lua) 给出最小接入结构，避免覆盖既有游戏 UI 初始化逻辑。

运行端尺寸分为声明、内容测量、最终排列：Measure.lua 使用 NanoVG 文本测量和原生叶控件测量；排列只更新引擎的 render offset/size，不向 props 写回宽高。页面内容、控件根及成对视觉控件共用布局宿主。GetLayout 保持父级相对坐标，供 ScrollView 计算内容范围与命中。LUI 字号是逻辑 px，适配器转换到 UI 接收的 pt，不改变全局主题。

布局缺省值以 `packages/spec/layout-contract.json` 为唯一正式源；`stamp-runtime.mjs` 生成 `Contract.lua` 并更新清单哈希，再执行部署命令。文本测量按内容/宽度/字体版本缓存；文字或样式更新使所属祖先布局失效，静止帧不重复测量和分配槽位。

声明文本的原生几何测量使用逻辑坐标，不把弹窗动画或绘制变换写入多行测量缓存；绘制仍保留动画。LUI 的固定字号不会被引擎翻译附加适配再次缩小，内容翻译保留；非 LUI 调用保持原生行为。

项目配置可临时设置 `layoutDiagnostics: true`：页面真实绘制第 3 帧输出当前节点探针；设为 `"summary"` 只输出真实引擎检查和静止帧重测计数，避免大量逐节点日志。不改变导航和数据，不标记远端错误已处理。验收后关闭此开关。探针数据不替代同状态截图/交互验收。

游戏配置 `changeTracking: "notify"` 后，修改数据调用 `runtime:NotifyChanged(context, paths)`，同帧通知合并到相关绑定和祖先。`runtime:UpdateContext(root, {view=nextView, actions=nextActions, changedPaths={"view.state.selectedKey"}})` 差量合入上下文并刷新已有树，包括脱离设计根挂载的原生 Modal。原地改表需显式 paths；没有启用 notify 的旧项目继续兼容扫描。条件和重复项按稳定 key/id 增删对应子树，未变化的控件与滚动区保留。完整语义见 [绑定与事件](bindings.md)。声明和表达式按加载版本缓存，修改文件后重建 Runtime。

局部详情更新使用 `UpdateContext`，或修改数据后调用 `NotifyChanged`，保留组件实例、焦点和滚动。`RefreshComponent` 为旧项目保留，显式替换被引用组件的内部树并清理旧实例；普通选择操作无需调用它。每个组件创建独立 refs。颜色样式只重绘，尺寸或文字变化使测量缓存失效。可见性绑定返回 nil 时折叠，不影响其他普通字段的合法 nil。

转换层严格区分缺省、`nil`、空字符串、`0` 与 `false`。导入组件的动态公开属性不缓存父级旧值；滚动条 gutter、内容框、布局探针和点击坐标使用同一套逻辑尺寸。复合按钮内部文本继承按钮字重，显式 LUI 外观和颜色仍优先。

## 资料更新

2.5.0 的 `Progress.lua` 保留原生进度条的值与 setter，在现有 UI 渲染事件内使用统一画刷解析器绘制轨道和进度。`轨道画刷`、`进度画刷`、`进度方向`、边框和圆角均可由每个 `<进度条>` 自己声明；静态值和绑定值走同一解析路径。共享契约只提供未声明时的默认最大值、高度与画刷，不覆盖显式属性。

显式标签属性优先于控件外观／Variant，后者优先于共享默认值。Runtime 把已解析的颜色、字号、字重、行高和尺寸直接传入控件，宿主主题只能填补 nil，不能再次覆盖。

统一绘制契约规定 sRGB、Straight Alpha、预乘 sRGB 渐变插值和向内边框。普通 LUI 文本保持声明的 MiSans 文件和字重，每段只进行一次 NanoVG 正文绘制；不添加全局同色增粗。2.6.0 的 Text 仅在显式文字描边颜色和正宽度同时有效时，使用原生 Label 八方向异色描边再绘制一次正文。原生组合控件在探针中标记为 `native-raster`，不冒充像素一致。原生叶控件在首帧 Yoga 尚未产出布局时，优先采用构造器声明的尺寸。

## 组件内容作用域（2.6.0）

组件内容呈现器在布局与直接节点构建两条路径中都保留调用方上下文；组件内部公开属性与传入插槽中的调用方属性彼此独立。绑定、默认值与单次转发规则见 [绑定与事件](bindings.md)。

## 全屏覆盖层（2.6.0）

`NativeControls.lua` 集中经官方原生源码核验的字段、回调签名和静默状态同步；`BuiltinValues.lua` 处理 Toggle/Slider/Progress 专用值，`LiveProps.lua` 在绑定变化时更新现有对象，带布局外壳的控件通过内部引用定位实际原生控件。初始化与后续刷新使用同一映射规则，不重建焦点/滚动状态。需要原生 setter 同步内部状态时抑制其外发 change，并在成功或异常后恢复回调，不合成用户输入事件。

`MountGlobalOverlay(host, overlay, layer)` 为独立视口 Yoga 根登记所属 host，覆盖层不受页面设计框缩放/裁剪。原生 Modal 延迟绘制之后，`AfterLayout` 回调先读取最终目标几何，再绘制覆盖层；输入栈按层级同步。`UnmountGlobalOverlay(overlay)` 只卸载，创建者必须在 Dispose 中 Destroy。隐藏、切根、重复挂载和原生 Modal 后开/重开不会遗留输入拦截；box-none 洞口仅在真实交互子节点处报告命中。

两种部署入口共用资料交付逻辑。源码由 docs、skills、examples 维护；VSIX 包内包含同一份内容。部署仅覆盖上次登记且未被用户修改的资料，保留冲突并写入 docs/lui/.delivery.json 的 preserved 列表。不自动删除已移出新版清单的旧文件；处理遗留资料前确认它们是否被用户引用。

要恢复某份资料的受管理版本，先保存自己的修改，再将目标移到自选备份位置并重新部署。不要删除整份交付记录来解决单文件冲突。

## 按钮标题适配（2.4.7）

`ButtonCaption.lua` 在现有 UI 上下文绘制标题，保留原生按钮状态、背景和事件。两项文字对齐由正式 Parser 映射，不依赖原生 Button 硬编码居中；非法静态或动态枚举值报错。默认禁用文字为共享契约的灰色。

按钮文本及两项对齐支持绑定；单次绑定只在构建时取值，其他模式在变化后读取当前上下文。根布局先更新标题，再计算缓存尺寸，避免文字变化后沿用旧宽度。静态文本仍可用 SetText 更新；静态对齐可通过 SetStyle 的 textHorizontalAlignment/textVerticalAlignment 设置中文枚举。2.7.0 的条件和重复项收到通知后更新对应子树；旧项目未启用 notify 时保留兼容扫描。

构建自动运行 stamp-runtime，按正式源生成 Contract 和运行时哈希；部署后应核对版本、revision 与每个 Lua 文件哈希。
## 刷新与滚动性能

绑定语法和数据路径有界缓存，声明文件缓存最多保留最近使用的 256 份；已经挂载的控件保留自己的声明引用，不受淘汰影响。绑定值仍按当前上下文读取，重复渲染的嵌套组件共用一次遍历。折叠节点先刷新自身可见性，再跳过子树；恢复显示时应用隐藏期间的数据变化。`RefreshComponent` 仍可显式替换局部组件。

滚动区支持触摸与鼠标按住正文拖动，使用接收控件的局部坐标，适配 DPR 和祖先缩放。惯性按经过时间积分，滑块拖动范围与实际绘制边界一致；抬起、取消和失焦会清理拖动状态。`tests/runtime-performance-input.py` 使用校验过的官方原生控件代码验证这些边界，数据夹具结果不代表手机帧率。

原生 Gesture 将取消也转为 PanEnd，所以适配器仅在指针捕获期间订阅 `UI.Input.PointerCancel`，先清理取消状态，下一次更新释放订阅，避免修改正在遍历的监听数组。`scripts/test-engine-scroll-performance.mjs` 验证正式引擎的触摸、鼠标、滑块、锚点和取消管线；当前 Web 引擎会把 CDP touchCancel 映射为普通 PointerUp，报告单独保留此宿主限制。

## 显式性能采样（2.7.0）

正式运行默认不开启详细采样和逐帧日志。需要采样时调用 `require("LUI.PerformanceSession").Start(runtime, {scene="仓库滚动", device="测试环境名称", workload="1000条固定数据", run="1"})`，结束时调用返回对象的 `Stop()`。返回报告记录引擎 Update.TimeStep 的 P95/P99、8.33ms 与 16.67ms 帧预算、Lua 内存和 LUI 工作计数；不会自行写文件、读取存档或强制 GC。`StartWork(label)` / `EndWork(token)` 默认使用引擎 `Time.GetSystemTime`（或 `time.GetSystemTime`）记录同步调用的经过时间，展开毫秒计数回绕；它不是 CPU 用时、CPU 百分比或 GPU 用时。报告列明时钟来源与毫秒刻度，实际分辨率可能更粗。测试可通过 `options.clock` 注入返回秒数的函数；原生时钟不可用时回退 `os.clock`，报告明确标为平台相关，不假定它是墙钟时间；没有可用时钟时标记不可用。

桌面正式引擎负载脚本 `scripts/test-engine-runtime-load.mjs` 将浏览器主线程忙碌时间与引擎帧间隔分开记录，并用 CDP SystemInfo 的 cpuTime 差采集专属测试浏览器进程组 CPU；同时保留单核总和与全部逻辑核归一化值，不称为整机 CPU。三轮报告可交给 `scripts/compare-performance-sessions.mjs --baseline b1.json b2.json b3.json --candidate c1.json c2.json c3.json`；条件不一致时拒绝比较，主要指标退化超过 10% 时返回失败。`scripts/compare-engine-runtime-load.mjs` 可从同次采样的引擎身份旁证补充实际 Lua 文件哈希，不改写原始报告。桌面数据不代表手机温度、耗电或最低帧率保证。
