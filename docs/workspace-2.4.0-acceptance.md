> 历史实现/项目验收记录；当前使用规则见 [LUI 文档](README.md)。业务页面与数量不属于通用框架规范。

# Studio / Runtime 2.4.0 验收

日期：2026-09-04。范围：UTF-8显式组件接口、100%初始画板、矩形选中/悬停。轴向与既有页面业务不变；不触发Maker，不自动重载编辑器。

## 实现与迁移

- 六控件：Header、EquipmentSlots、InformationPanel、ScrollRegion、SelectionList、TabView；后端新增独立Properties声明，内部组件字段改为UTF-8括号键。
- 检查14份设计及配套后端。调用处本来就是中文属性，无需改名；页面view字段/领域动作/名称/副名称/外边距/布局不属于本次迁移。ScrollRegion只有公共布局属性，显式声明空Properties。
- 模板带中文注释Properties块；完整示例`examples/PublicCard.lui`与同名后端。
- 静态读取声明不执行Lua；更新/删除刷新补全和诊断，错误保留最近有效声明。Title/标题为独立自定义键，修改布局不合并它们。
- Runtime源新增Properties/Paths；默认值校验、表逐实例复制、中文路径Commit/Notify及嵌套双向提交。契约`xaml-initialize-v1-unified-layout-hy-vx-v1-properties-v1`。

## 已验证

- Studio单测50/50，TypeScript通过；check-properties：14设计、6控件、旧组件字段引用0、接口/调用错误0。
- 生产Webview在Edge运行：每次新建100%；Header250×40、InformationPanel340×472；侧栏各收放10轮、窗口调整、源码分隔/折叠/最大化、5%–6400%中央独立缩放/滚动/拖拽通过。矩形高亮与原控件圆角同时验证。
- 真实隔离VS Code的TextDocument、WorkspaceEdit、原生语言服务；生产CodeMirror/画布通过HTTP桥接Edge。光标、内嵌/原生撤销重做、确认前撤销、CRLF保存、声明热更新、错误保留、删除诊断、补全/定义、属性精确写入、重复组件唯一选中通过。24组轴向点击仍通过。报告`artifacts/vscode-document-2.4.0.json`，截图`artifacts/properties-2.4.0.png`。
- Lua5.4执行正式Properties/Paths/Runtime上下文：类型、默认值复制、安全路径、Commit/Notify、构造前初始化、父子双向提交、单次绑定通过。UI接口为桩，不等同引擎Yoga/NanoVG真机验收。
- 部署后43份Lua语法、Presentation结构通过；Runtime/Parser/Paths/Properties及六控件后端LSP错误级0（不声称历史警告清零）。运行时逐文件与源相同，清单哈希/版本一致。

## 发布

已生成并覆盖安装`dist/lui-vscode-2.4.0.vsix`，CLI安装列表确认`sagelemi.lui-vscode@2.4.0`。包SHA256：`CAC7F1327A71BFAC25D02E198C17ACA8947BB4723CD6DB45D8DD9A00239F95AE`。安装前已提醒保护未落盘草稿，没有自动重载。Runtime由源适配器部署，`.backup-last`为本次升级前快照，更早快照被替换。不主动提交/推送或触发Maker。项目索引已手工更新，未发现该索引的自动刷新命令。
