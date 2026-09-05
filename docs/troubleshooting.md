# 排错

2.6.0：教程被 Modal 遮住时核对正式部署的 Overlays 与 Runtime 哈希，使用全屏 MountGlobalOverlay 接口，不仅设置 zIndex。描边报颜色类型错误时检查是否部署了兼容原生 RGBA 表的 Typography；两行通知需要在标记中声明最大高度/裁剪，不能仅在后端 SetStyle 后假定测量契约已同步。主题/字体变更提示未就绪时重开隔离预览，避免沿用原生控件旧配置。

[返回文档入口](README.md)。适用版本：2.6.0。

## 启动黑屏

宿主应把启动拆为字体初始化、应用初始化、Presentation 创建、首次渲染和事件注册，并用 `xpcall(..., debug.traceback)` 包住完整链路。日志中的 `[STARTUP_ERROR] stage=... runtime=...` 是定位入口；若 `UI.Init` 已成功，宿主应换成不依赖 LUI 的最小错误页。若连 `UI.Init` 都失败，至少保留固定错误标记与完整 traceback。

优先核对 `LUI.Project.Validate` 报出的具体路径：`LUI/lui.project.json`、`LUI/runtime-manifest.json`、字体资源，以及 `LUI.Registry` 登记的 markup/code。不要把解析错误吞掉后只留下空根节点。页面重建要先成功得到新根，再释放旧树；教程弹窗失败应保留底页并给出短提示。

## 预览与实机颜色或文字不同

确认两端均为 Runtime 2.5.2 和 `xaml-initialize-v1-unified-layout-hy-vx-v4-fidelity`，并核对布局探针中的 viewport、DPR、页面矩形、scale、borderAlign/borderRect、最终 RGBA、字体文件/解析字重、文字栅格模式和阴影来源。LUI 自有文字必须显示 `nanovg-single-pass` 且补偿为 0；1px 边框必须为 `inside`。页面不会自动套安全区；需要安全边时在源码显式加入 `<安全区>`。

先记录错误文本、涉及文件、Studio/Runtime 版本，以及错误发生在编辑器还是游戏。先检查最小相关文件，不把所有引擎库读入上下文。

| 现象 | 检查与处理 |
| --- | --- |
| 根节点报错 | 只能页面或控件；名称必填，页面设计宽高必须为正数 |
| 未导入/未登记组件 | 根的目录别名、componentDirectories 目录键和公开名称必须对应；确认配对文件位于 sourceRoots |
| 页面未登记 | 检查根名称、配对后端和 sourceRoots；创建/保存后确认 Registry 更新 |
| 属性不存在/类型不符 | 检查同名 Lua 的 Properties 字面量，中文键精确匹配；不要覆盖布局字段 |
| Studio 有字，游戏为空 | 预览内容不会成为运行数据，检查实际 CreateContext 的 view/props |
| 初始隐藏的绑定控件无法再次显示 | 2.5.1 修订前 Runtime 会在构建期删除绑定折叠节点；重新构建并部署当前版本。只有字面量折叠节点可裁剪，绑定节点必须保留实体并以 `visible=false` 等待 Notify 或显式 SetVisible |
| 文本框只剩一条横线 | 检查 Runtime 是否为 2.5.2；原生叶控件首帧必须采用构造器尺寸，且文本框的 `文本` 必须转换为 `value` |
| 实机文字发糊或异常变粗 | 检查探针是否为 `nanovg-single-pass`、`inkCompensation=0`；不要用同色描边或重复偏移绘制模拟浏览器字重 |
| 模型变了但控件没变 | Notify 只通知回调；实现 OnBindingChanged 的引用刷新或明确重建 |
| 失焦提交不符合预期 | 通用桥当前非显式模式在 onChange 写回；改用显式 Commit 控制时机 |
| 重复实例引用冲突 | 每个组件 CreateContext 提供自己的 refs 表，检查同一模板内重复键 |
| 列表为空 | 数据须为连续 Lua 数组；检查路径、别名、JSON 预览和真实值，空集合本就不生成占位卡 |
| 组件外有数据，插槽内列表为空 | 插槽使用组件上下文；将调用方集合经公开属性传入，模板读 props 中该属性 |
| 上下左右对不上 | 水平对齐控制 Y，垂直对齐控制 X；检查父槽位、显式尺寸及边距 |
| 画布布局诊断 | 同一轴不能同时写左右或上下；画布定位仅写在画布直接子项上 |
| 滚动无效 | 检查可用高度、内容溢出和轴是否禁用；隐藏与禁用不同 |
| 模块 Presentation.Components 不存在 | Runtime 的必需宿主依赖，先提供/恢复该模块及使用到的函数 |
| Lua 无限递归或堆栈溢出 | InitializeComponent 只调用 RenderMarkup，不能再次加载自身后端 |
| OnLoaded 读 self.context_ 为 nil | 回调发生在 RenderMarkup 返回前，使用传入的 context |
| 改文件后运行结果没变 | Runtime 缓存标记和代码，重新创建 Runtime/页面后验证 |
| 运行时版本不匹配 | 比较插件携带清单、已部署清单和配置中的 version/contract/hash，再重新部署；不手填哈希伪造匹配 |
| 资料升级未覆盖某文件 | 查看 docs/lui/.delivery.json 的 preserved；先备份自己的修改，再选择恢复受管理副本 |
| 保存冲突 | 保存当前草稿副本，比较宿主文档与外部修改；不要用直接磁盘写覆盖冲突 |

部署检查只验证运行时包一致性，不证明宿主、资源和所有设备效果可用。只做静态检查时明确记录未验证游戏交互。

在 Maker 游戏中，只有用户要求构建、预览或提交游戏时才按项目 Maker 工作流执行；普通语言检查、资料打包和 LUI 仓库推送不代替也不触发游戏构建。
