# 2026-09-04 可见性宿主补修（未安装）

页面双视图浏览器回归发现：applyLayout设置display:none，之后applyChildLayout重设为grid/flex；不可见整备容器因此覆盖战斗区、拦截日志滚轮。用户明确授权仅修复此问题并测试，暂不安装VSIX。

实现：src/webview/designer.ts中applyChildLayout首先保留否/false/折叠，再在父级布局时排除display:none子项，不产生空Fill槽；隐藏仍保留布局。media/designer.js由正常build生成。未改编辑同步、Runtime、版本或部署。

验证：npm test 53/53，npx tsc --noEmit。游戏scripts/Tests/PresentationBrowser.mjs运行实际Webview，覆盖三种排列模式的折叠槽位、12个360/390/640页面实例、战斗/整备互斥、可选筛选栏隐藏与日志真实滚轮；全部通过。Lua侧行为单独使用生产类测试，浏览器截图不冒充引擎实机。

源码修复已就绪；已安装的VSIX不会因本地构建自动更新。
