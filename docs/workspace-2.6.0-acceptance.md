# LUI 2.6.0 接续验收（2026-09-06）

本记录覆盖交接后的新补丁，历史 73 项测试与 1593e39 不代替本轮证据。

## 已取得的当前证据

- [覆盖层专项](workspace-2.6.0-overlays-acceptance.md)：官方引擎实际 Modal 延迟绘制、Yoga 与输入栈，独立视口覆盖树；具体尺寸及 DPR 以专项报告为准。
- [文字描边专项](workspace-2.6.0-text-stroke-acceptance.md)：只对 Text 明确属性启用异色描边；兼容原生 Widget 构造时将颜色规范成 RGBA 表，普通文字保持单次正文绘制。
- `tests/runtime-layout-math.py` 新增绑定值变更回归：文本/颜色、nil/false、单次模式、禁用恢复、渐变清除、TextField value/textColor、焦点和光标。该夹具使用 UI 替身，不称为 GPU 验收。
- `tests/runtime-builtin-values.py` 使用官方 1.29.7 原始 Toggle/Slider/ProgressBar 构造与方法，并执行当前 Runtime：内外壳路由、批量值/范围夹取、范围扩大恢复、nil、单次值/画刷、渐变轨道/方向消费、引用/焦点/滚动不变通过。它同时运行 `tests/runtime-native-controls.py` 的原生状态与事件回归；基础 Widget/Yoga 使用测试设施，进度仅记录实际绘制调用，不称为 GPU 像素证据。下拉框开合/禁用关闭、数字字符串 ID 保真见能力审计。
- `scripts/test-engine-parity.mjs <游戏根>` 在同一官方引擎/Runtime/字体/主题、390×867、DPR1、NVIDIA RTX3060 ANGLE D3D11、sRGB 后端比较源标记 Parser/Runtime 与 Studio 数据投影。普通、禁用、悬停、按下、文字 Alpha、主渐变、独立悬停渐变、渐变底的纯色按下共 8 对原始 GL RGBA 的不同字节数和最大通道差均为 0。脚本严格匹配当前请求 sequence，校验实际 GL 尺寸/上下文参数，要求标题区域至少 16 种颜色且含至少 50 个字形亮色像素；本次实际 225–243 色、1209–1459 个字形像素，不能以纯背景空帧通过。每个状态等待至少 12 次布局，再在连续两次完成的 vendor RAF 回调内读回，要求两次哈希相同。记录真实回调编号/时间戳；两端分别采集稳定静态画面，未证明相同固定动画帧时刻。原始文件、完整记录及引擎/字体/Runtime 哈希见 `artifacts/engine-parity-20260906/report.json`，GL 原点为左下。
- `tests/runtime-brush-states.py` 的真实适配器绘制调用通过：主背景/悬停分别使用自己的渐变和色标，纯色按下完全替换主渐变，绑定 gradient→solid→nil 不残留旧画刷且保留显式状态画刷，原生绘制抛错后恢复临时属性。真实 RGBA 夹具额外验证同标题/数据只改变状态时哈希发生变化，以及同一纯色按下在纯色/渐变主背景下最终 RGBA 完全相同。
- `scripts/test-vscode-document.mjs` 使用独立临时 VS Code 测试配置：17 项真实 TextDocument/WorkspaceEdit、内嵌与原生撤销重做、IME、源码光标、属性独立撤销等检查及 24 个对齐操作通过。报告保留历史文件名 `artifacts/vscode-document-2.4.0.json`，本次执行日志 `lui-host-232-CQFgpr/test-host.log`。画布部分显式使用结构示意与测试传输；未安装或重载用户扩展。

稳定性采集最终增加跨显示时间戳门槛：同一时间戳内的多个 vendor RAF 回调只保留最后一次，要求后一次采集的显示时间戳严格大于前一次，且原始 RGBA 哈希完全相同。两个脚本的 8 + 6 共 14 对已按此条件重新通过；报告逐端记录 `firstTimestamp`、`secondTimestamp` 与 `distinctDisplayTimestamps: true`，原有 sequence、非空字形、GL 环境一致性和零差异门槛保持不变。

## 仍须单独验收的范围

额外6对[组件/插槽RGBA](workspace-2.6.0-component-parity-acceptance.md)全部零差异，并据此修复了插槽作者作用域和缺失数据的默认值；原先8对标量报告保持独立。14对只证明这些静态夹具，不代表所有标签、同步动画帧或全部游戏业务数据逐像素一致。原生标签专项差距与修复见 [能力审计](workspace-2.6.0-capability-audit.md)。

[原生Webview整链](workspace-2.6.0-native-webview-acceptance.md)使用实际CustomTextEditor和消息传输，验证源码编辑、引擎点选回传与原生撤销；[真实游戏流程](workspace-2.6.0-game-flow-engine.md)使用内存存档运行生产App/Presentation，明确区别控制器动作和命中检查。各自最新检查数量和未覆盖范围以专项报告为准。

游戏页面结构、教程业务与远程启动分开记录，不用 CSS 通过替代真实渲染或玩家操作。

## 交付检查

- 2026-09-06按用户要求准备GitHub远程推送：重新通过76/76 Node、TypeScript、文档96链接/9片段与差异格式检查。推送前整理同步了适配器默认配置和package-lock两个workspace的2.6.0版本字段；`.tmp/` 加入忽略，源码与专项资料纳入提交，本机缓存/日志/运行产物不纳入。此次Git推送不代表扩展市场发布或补齐下列未覆盖验收。

- 正式 build/stamp/deploy 完成，22个适配器文件的manifest SHA256为 `d059088ab9d03850cc93551afcda9697a01a9729d25105613c440f2b1e659e06`；最终VSIX和游戏清单核验见游戏接续交付记录。
- 当前76/76 Node、TypeScript、文档96链接/9片段、Lua属性/布局/覆盖层/画刷/描边/内置与原生状态/插槽回归通过；游戏71份当前Lua语法、页面/战斗（27组纯逻辑）/启动/天赋/通知/结构检查通过。
- Maker Lua LSP为0 ERROR / 285 WARNING / 104 HINT；不声称全级别零诊断。最终源下重跑12个覆盖层、7个通知和14对RGBA均通过。
- VSIX路径 `dist/lui-vscode-2.6.0.vsix`，打包使用本机已有vsce3.9.2，不安装或重载用户扩展。备份18文件、Header指纹保留；游戏配置的自定义字段保留，部署器只更新三项版本/契约/清单标记。
- 第一次Maker构建 `ac4b84a` 成功，新会话2026-09-06 01:18:52（UTC+8）记录STARTUP_OK；仍存在已知的两个UUID预加载和空批次警告。追加短屏布局检查及后续游戏提交以游戏本轮接续验收记录为准，不把该提交当作后续补丁证据。
