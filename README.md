# LUI Studio

LUI 是面向游戏 UI 的 UTF-8、XAML 风格声明式语言。它把可见布局放进 `.LUI`，把数据和交互放进同名 `.lui.lua`，并提供不执行游戏代码的 VS Code 画布预览。

## 双名称规则

每个页面、组件、动作、资源和预览场景均使用 ASCII 主名称；副名称可使用 UTF-8，供设计师阅读：

```xml
<lui:Page xmlns:lui="urn:lui" x:Name="Tower" x:DisplayName="无尽塔">
  <Button x:Name="OpenSettings" x:DisplayName="打开设置" Text="设置"
          Click="{Action OpenSettings}" />
</lui:Page>
```

- `x:Name` 是唯一运行时键，也是 Lua 中唯一允许引用的名称。
- `x:DisplayName` 是唯一的人类辅助名称；画布、树和调色板优先显示它，但不会覆盖 `Text` 等实际游戏文案。
- 两种名称在各自 XML 命名空间内都必须唯一，且不能互相冲突。

## 本地开发

```powershell
npm install
npm run check
npm run package:vsix
```

使用 VS Code 的“从 VSIX 安装…”安装 `dist/lui-vscode-0.1.0.vsix`。首次打开 LUI 文件时，扩展会检查 `scripts/LUI/lui.project.json`，并在用户确认后部署 UrhoX/Lua 适配包；部署不依赖 TapTap Maker。

## 边界

- 预览只解释 `.LUI` 和其中的 `<lui:Preview>` 数据，绝不执行 `.lui.lua`、读取存档或启动引擎。
- UrhoX/Lua 适配器只加载项目配置白名单内的 `.lui.lua`。
- 本仓库不含任何具体游戏的领域数据、资源或玩法逻辑。
