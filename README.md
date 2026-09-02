# LUI Studio

LUI 是面向游戏 UI 的 UTF-8、XAML 风格声明式语言。可见布局写在小写 `.lui`，数据和交互写在同名 `.lui.lua`；VS Code 设计器只解释 LUI 和 `<lui:Preview>`，从不执行游戏代码。

## 目录命名空间与名称

组件目录就是命名空间。页面或组件根节点用 UTF-8 别名导入实际目录，再用限定标签引用已登记组件：

```xml
<lui:Page xmlns:lui="urn:lui"
          xmlns:积木="Presentation/Components"
          x:Name="塔内">
  <积木:Header x:Name="塔内页眉" Title="无尽塔" />
  <Progress x:Name="敌人血量" x:Ref="EnemyHp" Value="{Binding enemyHp}" />
</lui:Page>
```

- `xmlns:别名="目录路径"` 是唯一的目录导入语法；`lui` 保留给系统命名空间。
- `x:Name` 是设计名称，可用 UTF-8；`x:DisplayName` 是可选副名称。两类名称在同一文件中各自唯一且不能互相冲突。
- `x:Ref` 是唯一会作为控件引用进入 Lua 的字段，必须是 ASCII。`Binding`、`Action`、`.lui.lua` 和页面映射同样保持 ASCII；Lua 使用实际目录路径，绝不依赖中文别名。
- `scripts/LUI/lui.project.json` v2 的 `componentDirectories` 按实际目录登记组件。未导入目录、目录越界、未登记组件、裸全局组件调用和循环组件依赖都会报出明确错误；v1 `documents` 仍可兼容读取并给出迁移诊断。

## 设计器

双击 `.lui` 只打开一个 LUI Studio 标签：标签内部上方是设计预览、元素树和中文属性，下方是内嵌 CodeMirror 源码编辑器（默认约 60% / 40%，中间可拖动）。源码、组件树、画布、右侧中文属性检查器会互相定位；属性修改和源码输入都会通过同一份 VS Code `TextDocument` 写回。进入已展开组件的内部节点时，底部源码会在同一个标签中切换到该组件，并显示“页面 / 组件路径”面包屑；不会创建 VS Code 编辑器组或额外标签。需要独立源码视图时仍可选择“重新用文本编辑器打开”。

画布绘制真实的文本、按钮、卡片、进度条、滚动区和已导入组件的实际层级，不把 `x:Name` 或 `x:DisplayName` 当作游戏文案。树与画布悬停、选中时会像浏览器开发者工具一样框选同一控件；源码光标也会反向选中节点。内嵌编辑器提供 XML 着色、两空格缩进、中文目录别名/组件/属性补全、Binding/Action 片段、诊断下划线及撤销重做。属性按“LUI 名称、Lua 引用、布局、外观、文本与交互、数据与条件”分组，包含外边距、内边距、宽高、锚点、四边定位、间距和弹性布局。所有源码写回携带文档版本；版本不一致时会以宿主 `TextDocument` 为准回填，避免覆盖外部更新。

有效且未修改的文件首次打开时自动采用两空格排版；输入、粘贴和“格式化文档”会继续使用该格式。无效文件只显示诊断，不自动重排。

`.lui` 语言贡献自己的深浅色默认文件图标；它会让当前 Material Icon Theme 使用 LUI 文件图标，不添加右侧 `LU` 装饰，也不改动用户全局图标主题。

## 本地开发

```powershell
npm install
npm run check
npm run package:vsix
```

安装 `dist/lui-vscode-0.3.0.vsix` 后重载 VS Code。首次部署运行时时会提示确认；更新只在哈希变化时保留一份 `.backup-last`，绝不覆盖用户的设计文件、`lui.project.json` 或 `.meta`。本仓库不含任何具体游戏的领域数据、资源或玩法逻辑。
