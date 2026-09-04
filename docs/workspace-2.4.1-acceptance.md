> 历史实现/项目验收记录；当前使用规则见 [LUI 文档](README.md)。业务页面与数量不属于通用框架规范。

# LUI 2.4.1 验收记录（2026-09-04）

## 已验证

- 生产 Webview HTML/CSS/bundle + Chromium：SelectionList 340×220、TabView 340×262 的静态参考预览；页签两个等宽按钮且仅一层列表滚动区。截图为 `artifacts/list-2.4.1-SelectionList.png`、`list-2.4.1-TabView.png`；已目视核对，忽略用户截图红/青标记。
- 20 行双行/单行混合预览，滚轮和实际滚动条拖动均可改变偏移。198px 属性栏、大数值、非零边距下所有布局图文字边界不重叠，实际鼠标拖选没有产生选择；源码仍可选择。图见 `artifacts/layout-result-2.4.1.png`。
- 100% 初始倍率、左右侧栏各 10 次收展、6400% 独立缩放、源码折叠/最大化、矩形高亮回归通过。
- 真实 VS Code 文档测试：连续输入光标、内嵌/原生撤销重做、确认前撤销、撤销后保存、属性声明更新、导入属性编辑、重复实例选择通过，24 个轴向案例通过。沿用测试报告路径 `artifacts/vscode-document-2.4.0.json`，内容为本轮运行，不表示当前版本。
- Lua 5.4 执行真实 Parser、Runtime、组件类与 Presentation 状态方法，UI 方法采用测试替身：嵌套实例、原条目事件、禁用、单选、空集合、重复 key 拒绝、分实例/页签恢复、删除清理及滚动钳制通过；同时验证空内容常显条的绘制调用。

## 范围说明

## 发布结果

- Studio 50/50 单测、TypeScript、44 份 Lua 语法、13 设计/5 显式控件接口、Presentation 结构检查通过；对修改 Lua 文件重新提交 LSP，错误级诊断 0（项目仍有已有警告/提示）。
- 正式适配器部署后 `check-release-232.mjs` 报告 2.4.1、runtimeBytesMatch=true、remainingMigrations=0。旧 `.backup-last` 已替换为此次升级前快照，未覆盖设计布局。
- VSIX `dist/lui-vscode-2.4.1.vsix` 已覆盖安装；CLI 确认 `sagelemi.lui-vscode@2.4.1`。SHA256：`B1B8540E4DF90F5AC727ED4E3DED7860F7B1C4C5D72F5D04D7095439A6FEFA93`。
- 两仓 `git diff --check` 通过（仅 Git 行尾转换提示），未提交、未 Maker 构建、未自动重载。安装前已提醒保护未落盘草稿。

浏览器测试仅把 VS Code 消息传输替换为测试通道，不执行页面 Lua。Lua 测试验证实际解析/数据/生命周期，不代表 UrhoX 引擎像素对比或触控真机验收。本轮不触发 Maker，不自动重载 VS Code。

发布检查与部署哈希由 `check-release-232.mjs`（保留原脚本名）核对；安装前提醒保护草稿。项目设计保留 13 份、5 个自定义控件；ScrollRegion 四个文件与登记被移除。
