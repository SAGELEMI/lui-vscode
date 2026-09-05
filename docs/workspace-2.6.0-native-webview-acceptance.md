# 2.6.0 原生 Webview 到真实引擎验收

2026-09-06，最终正式构建的独立静态页面夹具共 8 项通过，覆盖原生源码输入、属性面板写入、引擎拾取及两次分别生效的原生撤销。该记录补充原先 `test-vscode-document.mjs` 的 TextDocument/HTTP 传输检查，不代表全部控件和导入组件完成验收。

## 入口与实际调用链

```powershell
$env:VSCODE_EXECUTABLE='D:/Microsoft VS Code/Code.exe'
$env:PLAYWRIGHT_MODULE='C:/Users/bayun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
& D:/nodejs/node.exe scripts/test-vscode-engine-native.mjs 'D:/项目/Tap制造/无尽塔'
```

CLI 为每次运行创建独立临时 workspace、user-data-dir、extensions-dir，使用源仓库的正式 `extensionDevelopmentPath` 和已构建的 `dist/extension.cjs`、`runtime/urhox-lua`。`tests/vscode-engine-native.cjs` 调用真实 `vscode.openWith(..., 'lui.preview')`；生产扩展注册并创建 CustomTextEditor，原生 `vscode-webview://` 中执行正式 CodeMirror/设计器与 `acquireVsCodeApi`。未替换 provider、Webview 或消息传输。

Playwright 通过只监听本机的 VS Code CDP 端口操作实际 Webview。测试从该 Webview 读取生产 EnginePreviewHost 创建的会话 URL，在独立 Edge 窗口载入同一宿主；此为项目既有的隔离浏览器路径。引擎是官方 UrhoX 1.29.7 / a3ca9278，字体和主题是复制到临时项目的声明数据，读取引擎缓存时仍由生产 `acquireEngine` 校验字节与哈希。

未安装、重载或关闭用户扩展；未修改用户配置、工作区信任或玩家存档；未添加关闭 Electron sandbox、GPU、安全策略的参数。实际测试宿主 VS Code 1.136.1、LUI 2.6.0，`workspace.isTrusted` 保持 `false`。第一次默认命令隔离环境导致 GPU 进程 `0xC0000135`、renderer `launch-failed code 49`，尚未执行测试入口；使用已获自动审批的系统命令执行环境后，完全相同的 VS Code 安全参数成功启动。

## 已证明的行为

1. 原生 Webview 的源码编辑通过真实输入操作提交给实际 TextDocument；生产设计器发送更高版本的快照，真实引擎绘制修改后的文字。
2. 在真实引擎 canvas 点按按钮，通过引擎拾取、宿主同源 POST 校验、扩展回传，原生 Webview 选中 `0.1` 节点并取得 Runtime 几何、字体、画刷探针；源码未被点选改写。
3. 使用已选按钮的真实属性面板，将“高度”像素输入从 48 改为 72；TextDocument 只改变该显式属性，新版快照的 `0.1` 节点 Height 为 72，实际 RGBA 改变。
4. 一次 VS Code 原生 `undo` 只恢复高度，保留先前文字编辑；原生 Webview 收到 `native-undo`，最新版引擎 RGBA 精确恢复文字已修改的上一状态。
5. 再次执行 VS Code 原生 `undo` 恢复初始 TextDocument，原生 Webview 收到对应 `native-undo`，最新引擎快照绘制后，原始 RGBA 精确恢复最初基线。

每个状态在引擎报告应用相应版本后，读取两个不同、严格递增时间戳的已完成 vendor RAF 回调中的原始 GL RGBA，要求哈希相同；同一 display tick 内的多个回调只采集一次。390×844、DPR1、实际长度和 GL error 均校验。标题区域必须至少有 16 种颜色和 50 个亮字形像素，不能以纯色空帧通过。基线/源码撤销实际为 230 色、1248 个字形像素，修改后为 190 色、1126 个。基线与源码撤销 SHA256 均为 `3f1b27ec1f8d704b1fc6678aa356e542843e17e7d6eaf7e915dc76cb69f07489`；文字修改与属性撤销均为 `78ab98f4c443a0fadb07571717827747157891fd042399cb852f0874260e9368`；高度 72 的帧为 `88ee894e7c90939fdecc89cc4e4e189c9a653255d798ebd25e20f7b0f11a9209`。

完整结果和最新运行日志路径见 `artifacts/vscode-engine-native-20260906/report.json`，同目录保存 `baseline.rgba`、`edited.rgba`、`property-height.rgba`、`property-undo.rgba`、`native-undo.rgba`。报告记录引擎/字体/Runtime 哈希、快照版本、实际 RAF 编号/时间戳、真实点选返回，以及启动参数；失败时 `passed=false`，不沿用旧成功结果。

## 最终构建复验身份

最终成功日志：`C:/Users/bayun/AppData/Local/Temp/lui-native-engine-260-alrHvr/test-host.log`，退出码 0。五个状态的快照 revision 依次为 6、12、13、20、22。引擎实际加载 `LUI/Runtime.lua` 的 SHA256 为 `a9f85ea9ffd32ebe9ce804ae3ac81905e0d7d11ab8cf1eefc2482c81b489c103`；已冻结正式 `dist/extension.cjs` 为 `980f0f60a52cc24d6f166adc17ea053d64300ae590d98a43248a50aa186d61a8`。八项成功包括生产扩展启动、原生传输、生产引擎宿主和上述五段编辑/拾取/撤销链。

## 仍不属于本次证据

本次是“页面 + 容器 + 文字 + 按钮”的静态夹具；源码通过一次原生 contenteditable 替换输入，属性表单验证按钮高度 48→72。没有覆盖逐字符输入分组、IME、其他属性/控件表单、导入组件/插槽、多实例拾取、所有标签/状态或完整游戏业务。此前真实 TextDocument 专项的 17 项与 24 个对齐操作仍是这些编辑细节的独立证据，不能相互扩大范围。

这是实际 Webview 消息到独立真实引擎的闭环，不是 VS Code 内嵌 iframe 的跨源隔离兼容性证明。帧验证比较分别采样的稳定静态画面，没有同步固定动画帧时刻，也不是 Webview CSS 与 GPU 的全标签逐像素一致性验证。生产源在本专项中保持冻结。
