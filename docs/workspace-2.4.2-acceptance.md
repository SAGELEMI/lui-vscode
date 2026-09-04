> 历史实现/项目验收记录；当前使用规则见 [LUI 文档](README.md)。业务页面与数量不属于通用框架规范。

# LUI 2.4.2 契约与验收

日期：2026-09-04。适配器仍采用 `xaml-initialize-v1-unified-layout-hy-vx-v1-properties-v1`。不修改领域规则或存档，不触发 Maker，不自动重载 VS Code。

## 实现位置

- `src/webview/designer.ts`：每次 CodeMirror transaction 立即排队，保留 changes 和操作来源；请求确认后逐项提交。预览重绘独立。撤销按500ms短连续输入分组，移动、换行、粘贴、补全和属性更改隔离。
- `src/webview/sourceSync.ts`、`src/extension.ts`：验证及重基多范围增量，一次 WorkspaceEdit 应用同一基准坐标的多个变更；目标已一致可 noop。无强制自动保存，保持 LF 协议与文件原 CRLF/LF。
- `packages/spec`、正式适配器 Parser/Runtime：重复项为当前标签，循环为遗留兼容；项目别名和嵌套 item 作用域一致，不产生多余布局宿主。Studio 允许绑定预览 JSON 数组经组件属性转发。
- 项目 `Presentation/PageLists.lua`：页面 DTO 分类、稳定 ID 和奖励身份，只有读数据能力。Warehouse/Talents 使用350px信息面板＋填充页签列表；SelectionList/TabView 移除空接口、空卡片，保留用户已修改的边距和行样式。
- `FloorRewards.lui/.lui.lua`：选择只显示详情，按钮确认领取；身份包含 runId/floor/index 并核验定义及等级。Presentation 保持 tower 逻辑路由，reward 阶段只渲染独立页；离开封面后返回保留待领取状态，不进行战斗定时重建。
- 列表状态按组件实例键＋分类/奖励作用域保存。仓库、天赋不写入整备详情；出售/升级离开分类后 Reconcile 清除无效选中。成功领取沿用原合并回执。

## 自动验证

- Studio：53项单元测试通过，覆盖多范围坐标、冲突、LF/CRLF、新旧标签及嵌套补全。
- 真实 VS Code TextDocument + WorkspaceEdit + 生产 CodeMirror（浏览器仅替换消息传输）：连续输入、500ms以上停顿后的分组撤销、原生撤销/重做、确认前撤销、CRLF保存、逐字文档版本递增、属性按钮和光标保持通过。24组对齐点击回归通过。不是仅字符串匹配。
- 生产浏览器：14设计中的仓库、天赋、奖励页布局和分类标签、空列表零按钮/零占位文本、20行滚轮与滚动条、侧栏10轮收放、6400%画板隔离、100%初始倍率、矩形装饰、198px布局图无重叠且不可拖选通过。
- Lua 5.4生产 Parser/Runtime/列表类/页面上下文：新旧重复项别名、原条目事件、禁用、空白列表、会话隔离、分类出售/升级失效、奖励选择不领取、失败保留、跨层失效、双击防重、合并回执、放弃、封面返回、路由和刷新守卫通过。UI方法为测试桩，不作为真机像素一致性证据。
- 语法：46个Lua文件；显式属性检查：14设计、5控件，无旧接口引用。

浏览器截图位于 `artifacts/page-2.4.2-{Warehouse,Talents,FloorRewards}.png`、`list-2.4.2-empty.png`、`layout-result-2.4.2.png`。页面截图采用主动适应以显示完整画板，不改变100%初始行为。真实运行数据与选择/领取行为由生产Lua上下文测试验证，静态Studio截图不执行游戏Lua。

## 发布检查

最终检查通过：TypeScript、Presentation结构、部署字节及清单哈希、两仓库git diff --check。46个Lua文件语法通过，Lua LSP错误0，既有105警告未作无关清理。中文输入法组合输入后一次撤销亦通过真实文档链路。

已从正式适配器部署Runtime 2.4.2；唯一 `.backup-last` 保存本次部署前版本。已打包并覆盖安装 `dist/lui-vscode-2.4.2.vsix`，CLI确认 `sagelemi.lui-vscode@2.4.2`。SHA256：`9F23CF8A69B65A5D324A8F8843C5DB918C35210FCC47B3396BD27CA37DD4EBE2`。安装前已提醒复制保护旧Webview未落盘草稿，未自动重载、未触发Maker。
