# LUI Studio 3.0.0

3.0.0 将界面分为场景、页面、控件：场景拥有设备级设计画布，页面由页面呈现器受控切换，控件可被多处复用。Studio 只从 `.lui` 根 `副名称`发现控件，并把原始声明交给正式 Lua Runtime，统一执行布局表达式、条件、重复项、模板虚拟列表和渐进式预加载。单文件 Studio 的数据来自绑定内联 `预览内容`；“运行”会校验并按需部署 Runtime，然后在独立浏览器运行整个 Maker 项目。接口见 [运行时](docs/runtime.md) 与 [绑定和列表](docs/bindings.md)。

LUI 是面向 UrhoX 游戏 UI 的中文声明式语言。小写 `.lui` 描述布局、外观和绑定，同名 `.lui.lua` 负责数据、动作与生命周期。Studio 在一个 VS Code 标签中提供结构树、画板、属性栏和源码编辑；设计预览不执行游戏 Lua。

从 [LUI 使用文档](docs/README.md) 开始，或直接阅读 [快速入门](docs/getting-started.md) 和 [完整示例](examples/tutorial/README.md)。

```xml
<场景 名称="Welcome" 副名称="欢迎场景" 宽度="390" 高度="844">
  <容器 子项排列="垂直" 内边距="20" 垂直间隔="12">
    <文本 文本="{绑定 view.title, 预览内容='你好，LUI'}" 字号="28" />
    <按钮 文本="开始" 点击="{动作 Start}" />
  </容器>
</场景>
```

## 安装与使用

安装 `dist/lui-vscode-3.0.0.vsix` 并打开游戏项目。在任意 LUI Studio 中点击 **运行**，或执行 **LUI: 运行项目预览**；Studio 会校验运行时，必要时自动部署并保留项目配置及一份 `.backup-last`，随后在独立浏览器运行 `.project/project.json` 的入口。

运行 **LUI: 新建场景、页面或控件（MVVM）** 创建配对文件，双击 .lui 打开 Studio。运行时需要 UrhoX 的 urhox-libs/UI 与项目宿主适配，见 [运行时接入](docs/runtime.md)。Studio 预览成功不代表游戏已完成接入。

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
