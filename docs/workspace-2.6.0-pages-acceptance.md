# 2.6.0 页面与通知本地验收

日期：2026-09-06。对应 R260-07 的测试侧补充及 R260-02 的真实引擎检查。本记录不把 CSS 示意、隔离通知夹具和真实游戏业务链路混为一种证据。

## 页面结构示意：54/54 通过

入口：游戏 `scripts/Tests/PresentationBrowser.mjs <LUI source repository> <game root>`。运行生产 Webview HTML/CSS/JS，显式选择“结构示意（非实机验收）”并检查 `data-preview-backend=schematic`。VS Code 消息传输为替身；绑定预览数据与长列表是隔离样例，不执行页面 Lua，不读取存档。

旧脚本未主动选择结构示意，与 2.6 默认真实预览不匹配；现已修正测试入口。字体改为加载游戏声明的 MiSans Regular/Bold，等待加载完成再测量。长战报压力样例改用隔离源码中的多行字面量，避免把含裸换行的无效绑定表达式绘制出来；新增“不得显示原始绑定”断言。

| 页面/状态 | 视口/测试设计尺寸 | 结果 |
| --- | --- | --- |
| Cover、Warehouse、Talents、Records、Loadout、Tower、塔内 Organize、FloorRewards、Error | 358×844、360×844、377×844、390×844、640×844、390×867 | 54/54 |

每个尺寸仅修改内存中的页面宽高样例，未修改游戏页面设计源码。检查可见滚动区宽高非零且落在页面内、折叠节点不留流式槽位、入塔分类与塔内整备页签各自正确、80 行战报滚动时“继续下一层”位置不变，以及设计器列表选中功能。滚动和选中仅是 Webview 交互，不算游戏点击、奖励领取或存档操作。

报告及完整 PNG 在游戏 `artifacts/presentation-views-20260906/`；报告 `report.json` 明确记录 `scope` 与字体 SHA。已直接查看 358px 记录、奖励、入塔整备、战报，以及 390×867 战报/塔内整备图：未见所测区域越界，奖励详情与选择列表各自保留滚动区，固定按钮没有随战报滚动。没有把浏览器字重视为原生字体栅格证据。

PNG 检查确认这些是 RGB 不透明截图；它们不是要导入游戏的透明图层。设计器 canvas 的边线会使部分截图多出 1px（例如逻辑 390×867 导出 391×867），因此尺寸断言使用 DOM 逻辑矩形，不拿这一图与原生帧作像素相等比较。

## 隔离真实引擎通知：7/7 通过

入口：LUI `scripts/test-notification-engine.mjs <game root>`。使用官方 UrhoX 引擎、生产 LUI 源适配器、游戏同份字体/主题，并且只执行生产 `NotificationOverlay.lui.lua`，传入独立 Runtime 和人工消息队列。它不加载 App、主游戏入口、存档或业务网络。

覆盖 358/360/377/390/640×844、390×867，以及 390×867 的第 3 秒渐隐。读取真实 Label 属性/布局，并采集引擎 canvas：

- 四条通知的背景与边框属性均为空，原生描边宽 1、颜色 `[16,9,28,255]`；普通参考正文 `textStroke=nil`。
- 覆盖层锚点 `(8,8)`、宽 260；48 UTF-8 字长消息实际高度 34.8，截图为最多两行，短消息高度 18。
- 第 3 秒四条通知的 opacity 均为 0.5，截图确认描边与正文一起渐隐，普通参考正文不变化。
- 页面 JavaScript 错误为 0，7 个场景都通过。最终 390×867 初始/渐隐截图已读图核实。

结果及截图在 LUI `artifacts/notification-engine-20260906/`，`report.json` 记录引擎身份、字体指纹及每条通知的实际布局/样式。

初次真实引擎检查测到长文本高度 63.8976，证明后端 SetStyle 最大高度不能替代正式 LUI 布局属性；后续图又暴露原生中线对齐和未换算最小字号导致的裁字。最终将最大高度、行高、换行、顶部对齐、裁剪全部声明在 `.lui`，最小字号从原生已换算值获取。修复后重复运行同一真实引擎夹具才记录通过；未修改只读引擎。

## 命令与剩余边界

使用本机已有 Node、Playwright 和 Edge；没有安装软件、构建或部署。示例运行环境：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/bayun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
# 游戏根目录
& 'D:/nodejs/node.exe' scripts/Tests/PresentationBrowser.mjs 'D:/项目/LUI' 'D:/项目/Tap制造/无尽塔'
# LUI 根目录
& 'D:/nodejs/node.exe' scripts/test-notification-engine.mjs 'D:/项目/Tap制造/无尽塔'
```

R260-07 的完整教程顺序、跳过/恢复、奖励领取/放弃、退出结算和远程游戏新会话仍由总验收闭环；本记录没有操作玩家进行中的爬塔，也不证明上述全部业务路径已通过。54 个 CSS 页面样例不证明全部真实引擎标签或逐像素一致，7 个通知场景不代表完整页面实机验收。共享 README/索引与正式构建由主交付流程更新。
