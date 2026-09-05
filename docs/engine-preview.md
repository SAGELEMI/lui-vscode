# 2.6.0 真实引擎预览与验收边界

## 入口与安全边界

Studio 启动 `src/enginePreviewHost.ts`，仅监听 `127.0.0.1` 随机端口，所有资源限定在随机会话路径。服务器检查 Host、方法和精确资源路由，不提供任意本地文件读取、跨域写入或业务接口。面板关闭时销毁宿主。

引擎来自官方 CDN，锁定 1.29.7 / a3ca9278；按官方清单找到 JS、WASM 和资源包，长度及 SHA256 记录在扩展 globalStorage 的 engine-cache 中。缓存损坏重新下载，版本不匹配拒绝启动。引擎文件不修改、不放入 VSIX。插件模式跳过游戏资源注册，因此依据同版本 engine-res 清单把原包中的库和字体挂载到受控资源目录，不使用游戏的只读参考库替代。

预览仅注入 LUI 正式 Runtime、静态属性声明、标记的解析结果、声明字体、项目 `theme` 数据和场景样例。不会执行游戏入口、同名业务 Lua 或读写玩家存档。组件后端计算的业务值必须作为明确的预览数据提供，不能把占位样例当作玩家实际状态。`identity.json` 记录引擎、Runtime、字体和当前快照指纹。

## 使用方式

- 默认后端为“UrhoX 真实预览”；引擎不可用显示“真实预览未就绪”。
- VS Code Webview 不具备跨源隔离时点击“打开隔离预览窗口”。独立宿主使用 COOP/COEP，不关闭浏览器安全机制。
- “结构示意（非实机验收）”保留源码选取和布局辅助，必须手动切换，不能据此宣称颜色或像素一致。
- 场景预设覆盖名称收起/编辑、记录空列表、战斗/层间；仅改变预览数据。语法错误不发送新快照，保留上一个有效画面。
- 快照和热更新带递增版本号；过期结果不覆盖新画面。字体变更后重新打开预览以重新校验资源。
- `lui.project.json.theme` 是传给 `UI.Theme.ExtendTheme(defaultTheme, theme)` 的声明数据。游戏入口也必须读取同一份声明；主题仍藏在业务 Lua 中时，不得宣称默认原生控件一致。字体或主题修改后重新打开预览。
- 真实预览的“节点选择”开关默认开启；关闭后可操作原生输入框等控件，但不执行业务动作。节点选择通过 Runtime 屏幕矩形/命中子树完成，回传几何、字体和画刷到属性面板，不重建画面。独立窗口也能回传选择。
- 选择回传是唯一 POST 路由：校验会话、Host、同源 Origin、JSON 大小、最新文档版本和已知节点，仅更新选择，不写源码或任意文件。其余资源仍只接受 GET。
- 弹窗快照自动打开原生 Modal；导入组件保留调用处布局外壳、内部布局及调用者内容插槽作用域，重复实例引用相互隔离。

## 布局和属性维护

`Measure.Participates` 是折叠占位的唯一判定：绑定 false / 折叠 / SetVisible(false) 不参与布局；隐藏保留位置但不绘制或命中。动态变化失效祖先测量缓存，不重建实体。画布几何属性绑定必须写在 LUI 中，不依赖随后会被排列覆盖的临时 SetStyle。

`Runtime:GetScreenRect(widget)` 计算含滚动、祖先缩放和裁剪的屏幕矩形；在原生 Modal 边界停止普通祖先变换/裁剪，不可见、无布局、完全裁剪返回 nil。`AfterLayout(root,callback)` 在原生延迟 Modal 完成后、全局覆盖层绘制前回调 `(root,nvg)`，返回取消订阅函数。覆盖层为独立视口 Yoga 树，按 host 登记生命周期；Mount 幂等，Unmount 保留对象，由组件 Dispose 负责销毁。覆盖层透明洞口只在有交互子节点时命中，隐藏、切根和销毁会清理输入栈。

属性支持中文/别名搜索；宽高提供自动、px、% 编辑和键盘步进；绑定优先进入表达式和预览值编辑；复位删除显式属性。属性写入继续使用源码事务和撤销链，不增加拖拽移动或拉伸。

## 验证

`scripts/serve-engine-preview.mjs <游戏根> [Presentation/SettingsModal.lui] [--editing]` 启动独立夹具，使用正式 Runtime、项目字体和主题，不启动业务。指定标记后直接解析项目源码及纯 Properties 声明；`--editing` 切换名称编辑样例。`LayoutChecks.Run` 在真实 Yoga/NanoVG 中验证排列，测试替身不能代替它。

严格逐像素验收还要求同引擎、同字体、同数据、同视口/DPR、同帧时刻及同图形后端，并直接比较原始 RGBA，差异必须为零。LUI 源仓库的 `scripts/test-engine-parity.mjs` 已取得8对静态标量/状态画刷夹具零差异，`scripts/test-engine-component-parity.mjs` 另取得6对导入外壳、插槽作用域、重复实例和默认值夹具零差异（390×867、DPR1、sRGB、相同 ANGLE D3D11 上下文）。这些是稳定静态状态，不是同步固定动画帧；全标签/全状态原始帧对照尚未闭环。`scripts/test-vscode-engine-native.mjs` 使用实际 CustomTextEditor/Webview 消息链验证源码编辑、独立真实引擎点选回传与原生撤销；不把旧HTTP传输/CSS夹具当作该证据。

`scripts/test-engine-overlays.mjs <游戏根>` 明确启用 `LayoutChecks.StartOverlays`，在临时根运行真实 Modal/教程/通知/阻断层与输入栈回归，结束恢复根。`serve-engine-preview.mjs <游戏根> <标记> --overlays` 也可显式启用；正常预览不运行该诊断。主题或字体在活动会话中改变时明确要求重开，不静默保留旧原生配置；identity.json 同时记录主题指纹。
