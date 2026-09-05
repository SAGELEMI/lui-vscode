# 无尽塔隔离真实引擎流程验收

2026-09-06。结论：六尺寸 × 18 状态通过，共 108 张原始 PNG、3,240 次实际 `UI.Render` 和 174 项关键控件矩形/命中断言。此证据补充控制器流程与实际绘制、关键输入目标可达性，**不是完整原生指针/键盘端到端验收，也不是全标签全状态视觉零差异证明**。

## 最终证据入口

最终证据只使用 `artifacts/game-flow-engine-20260906/summary-final/`。旧 `responsive/` 记录了操作按钮修复但仍有汇总裁剪的中间结果；无这两层的旧目录保留最初裁剪截图，均不可当作最终结果。

[汇总及指纹校验](../artifacts/game-flow-engine-20260906/summary-final/summary.json) 已逐文件核对六次运行与当前生产源、当前适配器一致；最终 `Runtime.lua` SHA256 为 `a9f85ea9ffd32ebe9ce804ae3ac81905e0d7d11ab8cf1eefc2482c81b489c103`。

| 尺寸 | 最终报告 | 状态 / 绘制 / 命中断言 |
| --- | --- | --- |
| 358×425 | [report.json](../artifacts/game-flow-engine-20260906/summary-final/358x425/report.json) | 18 / 540 / 29 |
| 360×800 | [report.json](../artifacts/game-flow-engine-20260906/summary-final/360x800/report.json) | 18 / 540 / 29 |
| 377×496 | [report.json](../artifacts/game-flow-engine-20260906/summary-final/377x496/report.json) | 18 / 540 / 29 |
| 390×844 | [report.json](../artifacts/game-flow-engine-20260906/summary-final/390x844/report.json) | 18 / 540 / 29 |
| 390×867 | [report.json](../artifacts/game-flow-engine-20260906/summary-final/390x867/report.json) | 18 / 540 / 29 |
| 640×1024 | [report.json](../artifacts/game-flow-engine-20260906/summary-final/640x1024/report.json) | 18 / 540 / 29 |

关键短屏截图：[命名确认](../artifacts/game-flow-engine-20260906/summary-final/358x425/01-new-name.png)、[入塔确认](../artifacts/game-flow-engine-20260906/summary-final/358x425/07-loadout-ready.png)、[奖励未选](../artifacts/game-flow-engine-20260906/summary-final/358x425/11-reward.png)、[滚动末项并选择](../artifacts/game-flow-engine-20260906/summary-final/358x425/12-reward-selected.png)、[结算返回](../artifacts/game-flow-engine-20260906/summary-final/358x425/14-settlement.png)。全部 PNG 已校验格式与对应尺寸；代表状态原始画布已人工查看。

## 执行路径与隔离

入口为 [scripts/test-game-flow-engine.mjs](../scripts/test-game-flow-engine.mjs)。它使用 `EnginePreviewHost` 的官方 UrhoX 1.29.7 缓存及生产 LUI，向临时浏览器内存文件系统投影游戏源代码和实际 Content JSON。正式 App、Save/Migrations、Registries、Tower/Combat、Presentation、页面后端和标记均原样执行，UI/Yoga/NanoVG 不使用桩。

唯一保存边界替身是明确的内存 `Save.LocalSlotStorage`：只允许 `saves/save_a.json` 与 `saves/save_b.json` 两个内存键，记录每次读写。真实 Storage 源没有装载，真实用户存档没有读取；新档只由生产默认数据生成。每尺寸最终读 22 次、写 16 次，重新创建 App 时通过正式信封校验与迁移入口恢复这些合成槽。OPFS 关闭；浏览器非 localhost 请求被阻断。音乐通过正常 App 设置关闭，不替换音频业务模块，不以本轮测试声称音频通过。

每个状态等待 30 次实际 `UI.Render`，让原生 Modal 动画完成后再读矩形并截图。流程为命名→首页→天赋路由→天赋→仓库→整备→确认入塔→暂停首战→从内存保存恢复首战→解除暂停→实际战斗胜利与奖励→滚动末项并选择→领取→退出结算→记录→完成→回放跳过→再次恢复，共 18 个固定检查点。

输入证据使用生产 `Runtime:GetScreenRect`（含祖先裁剪）、实际视觉矩形及官方 `UI.FindWidgetAt`。命名输入/确认、教程下一步/开始战斗/跳过、确认入塔、奖励领取/放弃、退出结算和结算返回必须完整在屏幕内，中心点命中自身或其子树。奖励列表按可滚动内容检查：首项与 `ScrollToBottom` 后末项至少保留 24 像素高的可见点击区且真实命中；不要求所有列表项同时完整显示。动作仍通过生产页面/控制器调用，未模拟全部硬件指针事件、IME 或键盘导航。

## 实际发现与最小修复

初轮 358×425 真实截图发现命名确认与奖励操作被原生 Modal 的 90% 屏高裁剪。游戏侧只修改了 `TutorialModal.lui/.lui.lua` 与 `Pages/FloorRewards.lui/.lui.lua`：

- 命名正文高度取原 360/300 与实际可用正文高度的较小者；说明进入受约束滚动区，姓名区与 44 高确认按钮保持在外。
- 奖励详情高度从固定 350 改为 `min(350,max(140,bodyHeight-150))`，短屏为列表、40 高页尾按钮和间距留出空间；常规屏仍是 350。复用信息面板原有说明滚动和领取动作。
- 新增 `ConfirmButton/RewardList/AbandonRewardButton` 引用用于稳定观测。没有修改领域规则、玩家物资、保存逻辑或引擎。

同轮截图还发现一次退出产生两条相同成功通知。主任务已收口 `Perform→Render` 同次成功消息的重复发射，最终六份报告均断言“本轮已结算。”恰好一条；单局记录仍为一条。

结算汇总的末行裁剪也已修复：仅在 `SettlementModal.lui` 增加 `SettlementSummary/EquipmentHeading` 稳定引用，并为汇总声明 100% 宽度、换行、文字顶部对齐；后端文案和数值原样保留。最终 360×800 的汇总框宽 266、高 56.35，NanoVG 行框完整占两行，后续标题保留 10 间距。六尺寸均检查原生 `nvgTextBoxBounds/nvgTextMetrics` 行数与几何，358/360 宽为两行，其余为一行；没有使用固定高度遮掩。

`BattleLifecycle.py`（含 PresentationViews 和 27 组纯逻辑）通过。浏览器 pageerror 为零，但控制台并非零日志：官方加载器的外部 mp4 模块、遥测尝试被现有 CSP 阻断；隔离宿主的 `env.json/project.json` 探测返回本地 404。报告保留原始分类，未将这些隔离现象写成业务网络成功。

## 复现

在 LUI 根目录，使用已安装的 Playwright 与系统 Edge；无需安装或重载扩展：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/bayun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node scripts/test-game-flow-engine.mjs 'D:/项目/Tap制造/无尽塔' 390 867
```

宽高为可选参数，默认 390×844。报告记录投影生产文件 SHA256 及官方引擎/运行时身份。远程 Maker、部署和 VSIX 打包结果由主任务单独记录。
