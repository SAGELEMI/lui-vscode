# LUI Studio 2.6.0

2.6.0 提供隔离的官方 UrhoX 真实预览，修复折叠测量和 Modal 上方的全屏覆盖层，增加显式文字描边与标量绑定原位刷新。普通文字保持单次正文绘制。验收范围与剩余项见 [2.6.0 验收](docs/workspace-2.6.0-acceptance.md)。

LUI 是面向 UrhoX 游戏 UI 的中文声明式语言。小写 `.lui` 描述布局、外观和绑定，同名 `.lui.lua` 负责数据、动作与生命周期。Studio 在一个 VS Code 标签中提供结构树、画板、属性栏和源码编辑；设计预览不执行游戏 Lua。

从 [LUI 使用文档](docs/README.md) 开始，或直接阅读 [快速入门](docs/getting-started.md) 和 [完整示例](examples/tutorial/README.md)。

```xml
<页面 名称="Welcome" 副名称="欢迎页" 宽度="390" 高度="844">
  <容器 子项排列="垂直" 内边距="20" 垂直间隔="12">
    <文本 文本="{绑定 view.title, 预览内容='你好，LUI'}" 字号="28" />
    <按钮 文本="开始" 点击="{动作 Start}" />
  </容器>
</页面>
```

## 安装与使用

安装 `dist/lui-vscode-2.6.0.vsix`，打开游戏项目，运行 **LUI: 部署 UrhoX/Lua 运行时**。部署同时交付 docs/lui 文档和示例、项目 skills 下两个技能，并向根 AGENTS.md 添加 LUI 导航。升级保留用户修改的资料并提示。

运行 **LUI: 新建页面或组件（MVVM）** 创建配对文件，双击 .lui 打开 Studio。运行时需要 UrhoX 的 urhox-libs/UI 与项目宿主适配，见 [运行时接入](docs/runtime.md)。Studio 预览成功不代表游戏已完成接入。

## 给 AI 使用

- [lui-authoring](skills/lui-authoring/SKILL.md)：创建和修改页面、组件、列表、绑定与事件。
- [lui-troubleshooting](skills/lui-troubleshooting/SKILL.md)：定位语法、数据刷新、布局、注册和部署问题。

让 AI 读取项目 AGENTS.md，或直接提供 SKILL.md 路径。技能随项目交付，不安装到用户全局目录；不同客户端的自动发现方式由其配置决定。

## 本地开发

```powershell
npm install
npm run check
npm run check:types
npm run check:docs
npm run package:vsix
```

命令行部署：`node scripts/deploy-runtime.mjs <游戏项目根目录>`。正式适配器源在 packages/runtime-urhox-lua/adapter；runtime 与 dist 为构建产物。资料分别维护在 docs、skills、examples。

2.4.5 将 Studio 与 Runtime 的盒模型、1.45 行高、36px 按钮、8px 紫色滚动条和既定对齐轴集中为同一契约，并为自由排列同锚点叠放增加诊断；Studio 预览视觉目标保持不变。旧版本行为及游戏验收见 [历史记录](docs/history.md)。
