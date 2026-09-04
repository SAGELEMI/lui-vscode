> 历史实现/项目验收记录；当前使用规则见 [LUI 文档](README.md)。业务页面与数量不属于通用框架规范。

# Studio 2.3.2 验收（2026-09-04）

## 契约与范围

水平对齐=Y上下，垂直对齐=X左右；不改箭头字形、旋转和行顺序。源码镜像确认不导航光标，撤销复用串行事务。保留2.3.1页面/控件分流和四分区。无Maker构建、无自动重载。

## 可复现证据

- `npm test`：44项通过；`npx tsc --noEmit`通过。
- `npm run test:vscode`：真实隔离VS Code Extension Host、生产`LuiPreviewProvider`和`TextDocument/WorkspaceEdit`，仅Webview消息运输通过本地HTTP桥接。生产CodeMirror在Edge运行；不是对写入返回值的模拟。CRLF子标签输入、内嵌撤销/重做、原生撤销/重做、确认前撤销、保存后继续改属性通过，子标签光标不跳根，无冲突警告。
- 同测试实际点击两组属性按钮，共24组（自由/水平流/垂直流各8组）。300×180父框、40×20按钮、四向外边距5/7/9/11：水平居中只将Y从7移到78，垂直居中只将X从5移到128；静态显式尺寸不被拉伸覆盖。输出`artifacts/vscode-document-2.3.2.json`。
- `scripts/test-alignment-lua.py`使用Lua5.4运行正式适配器的`Alignment.Axis`，与上述24组浏览器坐标比对误差≤1；另覆盖自动拉伸、最小/最大约束。此为排列算法验证，不冒充完整UrhoX Yoga/NanoVG真机验证。
- `npm run test:browser`保留2.3.1实际工作区回归：侧栏各收放10次、窄窗口、Header250×40、InformationPanel340×472、6400%独立画板、源码选区。
- `migrateAlignmentAxes`覆盖CRLF、注释、绑定、静态值、其他属性保留和重复执行零变化。

## 迁移

游戏14份`.lui`仅3个方向值需要转换：Header标题水平左→上；InformationPanel标题垂直上→左、角标水平右→下。未发现方向绑定数据源；根名称/副名称、外边距、业务绑定和全文换行保留。迁移版本由运行时契约hy-vx-v1及项目验收记录共同标识，重复扫描为0。

## 发布注意

发布核验：`lui-vscode-2.3.2.vsix`已打包并覆盖安装，VS Code CLI确认`sagelemi.lui-vscode@2.3.2`。游戏41份Lua语法解析、Presentation结构检查通过；本次Runtime/Alignment的LSP错误级诊断均为0（不等同于历史警告清零）。14份设计解析无错误，重复迁移0处，未发现待审核方向绑定；部署文件字节与源适配器一致，清单哈希匹配。两仓库`git diff --check`通过。旧`.backup-last`已替换为部署前Runtime快照。

匹配Studio/Runtime2.3.2。适配器只修改源仓库，通过`deploy-runtime.mjs`同步游戏，并验证逐文件字节一致与清单哈希。安装前保护旧Webview草稿，安装不自动重载。完整游戏渲染仍须之后按用户要求进行Maker/真机验收。
