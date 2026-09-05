# LUI 2.4.5 交付记录

2.4.5 保持现有 Studio 预览视觉目标不变，把分散的布局缺省值收口为 Studio 与 UrhoX/Lua Runtime 共用的正式契约。

- `packages/spec/layout-contract.json` 定义盒模型、既定对齐轴、自由排列、13px 字号、1.45 行高、36px 按钮和 8px 紫色滚动条。
- Runtime 的文字测量、按钮、卡片、滚动区和布局探针读取生成的 `Contract.lua`，不再接受主题的 44px 按钮高度或灰色滑块缺省值。
- Studio 读取同一契约设置 CSS 变量；预览的尺寸与颜色未被改成迎合旧 Runtime。
- 规范为自由排列中同锚点、无层级或变换的多个直接子项提供叠放警告。
- Runtime 探针增加声明、期望、内容框、内缩、行盒、对齐和排列字段。

打包产物为 `dist/lui-vscode-2.4.5.vsix`。
