# 2.6.0 全局覆盖层验收（2026-09-06）

R260-01 的正式源修复与隔离真引擎验收已完成；本记录不代替游戏远程构建、完整教程路径或原始 RGBA 零差异验收。

## 实现与边界

- `adapter/Overlays.lua` 通过 `UI.RegisterGlobalComponent` 在原生 Modal 的延迟队列之后绘制。全局层为独立的 viewport/Yoga 根，使用 UI 基础像素坐标，不再持有普通树早期的 `renderChild` 闭包，不继承所有者的缩放、滚动或裁剪。
- `Runtime:MountGlobalOverlay(host, overlay, layer)` 保留调用协议。`host` 管理生命周期；覆盖层没有普通树 `parent`，登记在 `host.luiGlobalOverlays_`。同层按首次挂载顺序稳定排序，重复挂载不重建节点；`FindByRef/LayoutProbe` 的统一遍历包含托管覆盖层和原生 Modal 正文。
- 层级统一为通知 300、教程 400、阻断保存错误 1000。输入栈按实际绘制顺序同步，原生 Modal 后开时重排；box-none 在无实际子命中处拒绝栈入口，洞口才能继续命中奖励按钮。
- 命中入口检查隐藏、pointerEvents、子级变换、滚动和裁剪；隐藏/none、切根、卸载和 Destroy 清理托管输入项，不移除其他原生 Modal 的栈项。`UnmountGlobalOverlay` 保留控件供复用，创建它的组件负责最终 `Destroy`；host Destroy 释放挂载及延迟回调。
- `Runtime:GetScreenRect` 识别原生 Modal 的视口绘制边界：保留内容区裁剪，停止应用外部 host 的 transform/scissor。原生 Modal 的入场动画与其输入并不使用同一缩放，动画期间返回 `modal-animating`，教程保持阻断，稳定后才开放洞口。
- 游戏 `TutorialCoachMark` 直接使用 `UI.GetWidth/GetHeight` 与目标屏幕坐标，四块 Alpha 77 遮罩仍由 LUI 绑定坐标排列。Dispose 取消监听、卸载并销毁独立根。游戏保存错误层由 Presentation 接入同一 API（另一并行任务负责该集成）。

这里保证的是 LUI 管理的通知/教程/阻断层与原生延迟 Modal 的顺序；未扩展或修改引擎内其他全局组件的 `pairs` 遍历规则。引擎资源及游戏存档均未修改。

## 已执行验证

1. `python tests/runtime-overlays.py`：通过。覆盖重复挂载 20 次、native queue→commit→通知→教程→阻断错误、洞口、子级缩放、隐藏/none、滚动/裁剪、原生子树去重、重挂载、切根、Destroy 幂等及旧回调清理。此项是 Lua 5.4 替身回归。
2. `python tests/runtime-layout-math.py packages/runtime-urhox-lua/adapter artifacts/python`：通过，保留既有排列、动态绑定和坐标回归。
3. 游戏 `scripts/Tests/PresentationViews.py D:/项目/LUI`：通过。
4. `scripts/test-engine-overlays.mjs`：DPR 1 和 DPR 2 各六尺寸通过，共 12 个场景：358×425、360×800、377×496、390×844、390×867、640×1024。使用锁定的官方 UrhoX 1.29.7 / a3ca9278、正式 Runtime、真实 Yoga/NanoVG、实际 `UI.Modal:RenderModalContent`、`UI.Render` 的延迟队列和 `UI.FindWidgetAt`。

真引擎断言包括：transformed/clipped host 不改变 Modal 的奖励目标坐标、奖励行及确认按钮洞口实际命中、遮罩外部阻断、跳过按钮命中、四块遮罩面积等于屏幕减洞口面积、Alpha 77、通知/教程/阻断层绘制与输入顺序、原生 Modal 关闭重开、隐藏、重复 Mount、Unmount、切根和最终 Dispose 不泄漏输入项。

首轮真实失败为目标 X `57.75 != 33.9`。原因是矩形转换已避开外部变换，但 `GetScreenRect` 仍应用外部 host 的裁剪；修复原生 Modal 边界后保留同一断言并通过。未通过改阈值或删除坐标断言放行。

## 复现入口与证据

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/bayun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
& D:/nodejs/node.exe scripts/test-engine-overlays.mjs 'D:/项目/Tap制造/无尽塔'
$env:LUI_DEVICE_SCALE_FACTOR='2'
& D:/nodejs/node.exe scripts/test-engine-overlays.mjs 'D:/项目/Tap制造/无尽塔'
```

证据由脚本保存到 `artifacts/engine-overlays-20260906/report.json` 与 `artifacts/engine-overlays-20260906-dpr2/report.json`；文件包含引擎/Runtime 身份与每个尺寸的真实回调结果。GPU 检查是几何/绘制次序/输入与生命周期验收，没有截图或成对原始 RGBA 差异断言。

引擎内入口为 `LayoutChecks.StartOverlays(runtime, callback)`，callback 接收 `(ok, message)`，返回的 `Cancel` 可提前清理。仅由隔离预览的显式 `runOverlayChecks` 启用：暂存并恢复预览根与输入栈，在真实逐帧渲染中验收，不同步嵌套调用 `UI.Render`，不挂到游戏正常 `layoutDiagnostics`。

独立可视入口使用 `serve-engine-preview.mjs <游戏根> <标记文件> --overlays`。预览宿主/测试脚本入口由主代理接入；仅修改 Lua 时宿主直接读取正式适配器源，无需重生成部署副本。

## 交付前仍需主任务完成

正式 build/stamp/deploy、最新包哈希及 VSIX、Maker Lua LSP、远程构建/新会话日志、玩家教程完整顺序和业务动作验收。上述 12 个隔离场景证明机制，不宣称已远程验证真实领奖或完成全部游戏教程。
