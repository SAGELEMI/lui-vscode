# LUI Studio / Runtime 2.5.0 验收

日期：2026-09-05。图二为本轮视觉基准；本轮只做本地实现、部署和验证，不调用 Maker 远程构建，也不安装或强制重载 VS Code。

## 实现范围

- `ui-capabilities.json` 与 `controls.json` 生成 Studio/补全和 Lua 能力数据，结构标签不暴露绘制属性。
- 可视标签支持背景画刷、边框、圆角和不透明度；文字型标签支持字体、字号、字重、字体样式、颜色、行高、字距、换行、省略与双轴对齐。
- 颜色与两色色标线性渐变严格解析；Inspector 使用颜色、Alpha、角度和色标控件。进度条拥有独立轨道／进度画刷和四向进度。
- Studio 与 Runtime 共用页面框架向量、外观优先级和显式安全区语义；`<页面>` 不再自动套安全区。
- 项目配置登记 MiSans Regular/Bold 及 SHA-256；Studio 校验文件哈希，Runtime 校验资源并注册同一路径。
- 游戏启动由五阶段 `Startup.lua` 保护，错误日志含阶段、版本与 traceback；可用 UI 下显示独立错误页。

## 本地证据

- `npm test`：67/67；`npm run check:types`：通过。
- 生产 Webview/Chromium：18 个设计、外观编辑器源码写回、MiSans Regular/Bold、进度画刷，以及 358×425、377×496、360×800、390×844、640×1024 页面框架可见性通过；日志为 `.tmp/parity-2.5.0.log`，基准裁剪图为 `artifacts/parity-cover-377x496.png`。
- Lua 运行时绘制代数、游戏 Presentation/绑定/战斗生命周期、五阶段启动夹具、全部 Lua 语法、文档链接、部署清单和差异空白检查列入最终门禁。
- VSIX 产物为 `dist/lui-vscode-2.5.0.vsix`；仅打包，不安装。

## 验收边界

浏览器测试运行生产 Webview，Lua 测试运行生产转换与启动模块但以引擎对象替身记录调用；它们不冒充 GPU 或真机截图。由于本轮没有故障设备会话日志且明确不执行 Maker 远程构建，设备端黑屏和逐像素终验留待后续获准构建并提供日志后闭环。
