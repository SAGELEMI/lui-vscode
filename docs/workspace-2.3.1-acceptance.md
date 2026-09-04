> 历史实现/项目验收记录；当前使用规则见 [LUI 文档](README.md)。业务页面与数量不属于通用框架规范。

# Studio 2.3.1 工作区回归

2026-09-04：使用生产 `previewHtml`、`media/preview.css`、`media/designer.js`，在 Edge Chromium 中执行真实点击、拖动、缩放及窗口调整。仅 VS Code 消息传输以夹具替代；这不是运行中 VS Code Webview 的端到端保存测试。

复现：先 `npm run build`，设置 `PLAYWRIGHT_MODULE` 为已安装 playwright 模块路径、`LUI_GAME_PROJECT` 为项目根，再运行 `npm run test:browser`。默认使用系统 msedge，可用 `LUI_BROWSER_CHANNEL` 切换浏览器。

- 1560×900窗口：左280、右288、上下65%/35%；700×650窗口临时限宽，恢复后宽度不丢失。
- 左右各收放10次，折叠轨道28px；点击展开按钮均可恢复，无区域重叠。
- Header自身250×40，InformationPanel自身340×472，无设备选择或手机空白宿主；自动尺寸+百分比子项夹具为250×60。
- Loadout设备画板390×844，6400%放大仅影响中央；可滚至右下，工作区总宽仍等于窗口。
- 源码最大化/折叠恢复、上下分隔拖动保持选择与100%倍率；3000字超长属性仅源码区域横向滚动。
- 截图输出：`artifacts/workspace-2.3.1-component.png`、`artifacts/workspace-2.3.1-page.png`。已检查完整四区，右侧属性栏可见。

本轮不修改或部署 Lua Runtime，不调用 Maker。VSIX安装后不自动重载旧窗口，避免丢失未落盘草稿。

发布核验：42/42 Studio单测、`tsc --noEmit`、浏览器交互回归、项目`PresentationStructure.ps1`及两仓库`git diff --check`通过。`dist/lui-vscode-2.3.1.vsix`已覆盖安装，VS Code CLI确认`sagelemi.lui-vscode@2.3.1`；未自动重载当前窗口。
