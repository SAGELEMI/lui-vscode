# LUI Studio

LUI 是面向游戏 UI 的 UTF-8、XAML 风格声明式语言。它把可见布局放进小写 `.lui`，把数据和交互放进同名 `.lui.lua`，并提供不执行游戏代码的 VS Code 画布预览。

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

- 双击 `.lui` 默认进入设计器；需要源码时，在 VS Code 中选择“重新用文本编辑器打开”。
- 资源管理器会自动为 `.lui` 显示紫色 `LU` 格式标记；若需要完整矢量文件图标，可运行“LUI: 启用 LUI 文件图标主题”。该命令才会改变 VS Code 的全局文件图标主题。
- 预览只解释 `.lui` 和其中的 `<lui:Preview>` 数据，绝不执行 `.lui.lua`、读取存档或启动引擎。
- UrhoX/Lua 适配器只加载项目配置白名单内的 `.lui.lua`。
- 运行时更新只在内容哈希变化时保留一份 `.backup-last`；用户设计文件、配置和 `.meta` 不会被备份或覆盖。
- 本仓库不含任何具体游戏的领域数据、资源或玩法逻辑。
