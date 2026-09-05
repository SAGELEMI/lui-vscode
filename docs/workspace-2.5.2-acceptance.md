# LUI 2.5.2 本地验收

- 文字契约：`ownedTextRaster=nanovg-single-pass`、`inkCompensation=0`；Lua 夹具确认 `DrawSingleLine` 每段只调用一次 `nvgText`。
- 原生控件：Lua 夹具确认首帧原生布局为 0×0 时仍保留声明的 40px 高度和最小尺寸；TextField 使用 `value/textColor/placeholderColor/cursorColor`。
- Studio：TextField 使用只读 input 仿真，不再显示为空容器；字体合成保持关闭。
- 自动检查：70 项 Node 单测、TypeScript 类型检查、Lua 5.4 属性/测量夹具及 Runtime 布局代数通过。
- 游戏部署：正式部署后的 18 个 Runtime 文件与源仓库 SHA 一致；游戏原有 `.backup-last` 内容保持不变。
- 本轮未调用 Maker 远程构建；设备字体抗锯齿仅在后续获准构建时闭环。
