# 控件与属性参考

[返回文档入口](README.md)。适用版本：2.6.0。

本页由 scripts/generate-reference.mjs 从正式词汇与控件目录生成，运行 npm run docs:generate 更新。表格列出已登记语法，不代表 Studio 模拟全部复杂控件交互，或 Runtime 实现底层 UI 的全部属性；使用新能力时核对适配器及目标引擎 UI 文档。

## 根与结构

页面、控件是文档根；条件、重复项控制构建；内容呈现器接受组件调用方内容。重复项的项目属性是当前项别名，与数据控件的项目集合属性含义不同。

## 基础与布局标签

| 中文标签 | 内部语义 |
| --- | --- |
| 容器 | Container |
| 网格 | Grid |
| 画布 | Canvas |
| 视图框 | Viewbox |
| 堆叠面板 | StackPanel |
| 换行面板 | WrapPanel |
| 停靠面板 | DockPanel |
| 均分网格 | UniformGrid |
| 边框 | Border |
| 内容控件 | ContentControl |
| 文本 | Text |
| 按钮 | Button |
| 卡片 | Card |
| 滚动查看器 | Scroll |
| 进度条 | Progress |
| 开关 | Toggle |
| 滑块 | Slider |
| 安全区 | SafeArea |
| 弹窗 | Modal |
| 分区 | Section |
| 提示 | Notice |
| 屏幕 | Screen |
| 固定屏幕 | FixedScreen |

基础文本使用文本属性；按钮点击动作收到当前重复项（若无则 nil）和事件；进度条使用值/最大值。开关与滑块当前走专用变更动作桥，不承诺与下表通用输入控件相同的自动双向写回。卡片、分区、提示、屏幕和固定屏幕依赖 Presentation.Components，见 [宿主约定](runtime.md)。

## 目录登记的通用 UI 控件

| 中文标签 | 底层 UI | 类别 | 数据绑定属性 | 事件 | 原生内容容器 |
| --- | --- | --- | --- | --- | --- |
| 容器 | Panel | 基础 | — | — | 是 |
| 文本框 | TextField | 输入 | 文本 | 变更、提交、获得焦点、失去焦点 | 否 |
| 复选框 | Checkbox | 输入 | 值 | 变更 | 否 |
| 下拉框 | Dropdown | 输入 | 值 | 变更、打开、关闭 | 否 |
| 吐司 | Toast | 反馈 | — | 关闭 | 否 |
| 选项卡 | Tabs | 导航 | 值 | 变更 | 否 |
| 工具提示 | Tooltip | 反馈 | — | — | 是 |
| 徽章 | Badge | 展示 | — | — | 否 |
| 头像 | Avatar | 展示 | — | — | 否 |
| 列表 | List | 数据 | — | 选择 | 是 |
| 分隔线 | Divider | 布局 | — | — | 否 |
| 骨架屏 | Skeleton | 反馈 | — | — | 否 |
| 标签片 | Chip | 输入 | 值 | 点击、变更 | 否 |
| 折叠面板 | Accordion | 布局 | — | 变更 | 是 |
| 步骤条 | Stepper | 导航 | 值 | 变更 | 否 |
| 评分 | Rating | 输入 | 值 | 变更 | 否 |
| 面包屑 | Breadcrumb | 导航 | — | 选择 | 否 |
| 分页 | Pagination | 导航 | 值 | 变更 | 否 |
| 警告框 | Alert | 反馈 | — | 关闭 | 否 |
| 时间线 | Timeline | 数据 | — | — | 否 |
| 菜单 | Menu | 导航 | — | 选择 | 否 |
| 树 | Tree | 数据 | — | 选择、变更 | 否 |
| 日期选择器 | DatePicker | 输入 | 值 | 变更 | 否 |
| 时间选择器 | TimePicker | 输入 | 值 | 变更 | 否 |
| 颜色选择器 | ColorPicker | 输入 | 值 | 变更 | 否 |
| 表格 | Table | 数据 | — | 选择 | 否 |
| 轮播 | Carousel | 导航 | 值 | 变更 | 否 |
| 抽屉 | Drawer | 反馈 | — | 打开、关闭 | 是 |
| 弹出层 | Popover | 反馈 | — | 打开、关闭 | 是 |
| 日历 | Calendar | 输入 | 值 | 变更、选择 | 否 |
| 文件上传 | FileUpload | 输入 | — | 变更、提交 | 否 |
| 富文本 | RichText | 展示 | — | — | 否 |
| 简单网格 | SimpleGrid | 布局 | — | — | 是 |
| 骨骼动画 | Spine | 媒体 | — | 完成 | 否 |
| 精灵表 | SpriteSheet | 媒体 | — | 完成 | 否 |
| 精灵 | Sprite | 媒体 | — | — | 否 |
| 虚拟列表 | VirtualList | 数据 | — | 选择 | 否 |
| 拖放上下文 | DragDropContext | 交互 | — | 拖动开始、拖动结束、拖动取消 | 是 |
| 物品槽 | ItemSlot | 交互 | — | 点击、变更 | 否 |
| 技能树 | SkillTree | 交互 | — | 选择、变更 | 否 |
| 聊天窗口 | ChatWindow | 组合 | — | 提交、选择 | 否 |
| 物品提示 | ItemTooltip | 组合 | — | — | 否 |

## 属性词汇

此表只列通用/框架词汇，业务组件接口以其 Properties 为准。可用范围由当前标签、父级和补全规则筛选；不是每个标签都接受每个属性。

| 中文属性 | 语义键 | 类型/枚举 | 限定标签（若有） |
| --- | --- | --- | --- |
| 边框宽度 | BorderWidth | length | 按上下文 |
| 边框颜色 | BorderColor | color | 按上下文 |
| 滚动条颜色 | ScrollbarColor | color | 滚动查看器 |
| 名称 | x:Name | 按控件约定 | 按上下文 |
| 副名称 | x:DisplayName | 按控件约定 | 按上下文 |
| 引用 | x:Ref | 按控件约定 | 按上下文 |
| 水平滚动条可见性 | HorizontalScrollBarVisibility | 自动、显示、隐藏、禁用 | 滚动查看器 |
| 垂直滚动条可见性 | VerticalScrollBarVisibility | 自动、显示、隐藏、禁用 | 滚动查看器 |
| 宽度 | Width | length | 按上下文 |
| 高度 | Height | length | 按上下文 |
| 最小宽度 | MinWidth | length | 按上下文 |
| 最小高度 | MinHeight | length | 按上下文 |
| 最大宽度 | MaxWidth | length | 按上下文 |
| 最大高度 | MaxHeight | length | 按上下文 |
| 外边距 | Margin | thickness | 按上下文 |
| 内边距 | Padding | thickness | 按上下文 |
| 裁剪超出 | ClipToBounds | 是、否 | 按上下文 |
| 子项排列 | ChildLayout | 自由、垂直、水平 | 按上下文 |
| 允许换行 | Wrap | 是、否 | 按上下文 |
| 固定子项宽度 | ChildWidth | length | 按上下文 |
| 固定子项高度 | ChildHeight | length | 按上下文 |
| 水平间隔 | HorizontalGap | length | 按上下文 |
| 垂直间隔 | VerticalGap | length | 按上下文 |
| 填充 | Fill | 是、否 | 按上下文 |
| 行定义 | RowDefinitions | tracks | 网格 |
| 列定义 | ColumnDefinitions | tracks | 网格 |
| 行间距 | RowSpacing | length | 网格 |
| 列间距 | ColumnSpacing | length | 网格 |
| 网格.行 | Grid.Row | integer | 按上下文 |
| 网格.列 | Grid.Column | integer | 按上下文 |
| 网格.跨行 | Grid.RowSpan | integer | 按上下文 |
| 网格.跨列 | Grid.ColumnSpan | integer | 按上下文 |
| 画布.左 | Canvas.Left | length | 按上下文 |
| 画布.上 | Canvas.Top | length | 按上下文 |
| 画布.右 | Canvas.Right | length | 按上下文 |
| 画布.下 | Canvas.Bottom | length | 按上下文 |
| 背景 | Background | brush | 按上下文 |
| 颜色 | Color | color | 按上下文 |
| 不透明度 | Opacity | 按控件约定 | 按上下文 |
| 圆角 | BorderRadius | 按控件约定 | 按上下文 |
| 外观 | Variant | 高亮、常规 | 按上下文 |
| 文本 | Text | 按控件约定 | 按上下文 |
| 标题 | Title | 按控件约定 | 按上下文 |
| 副标题 | Subtitle | 按控件约定 | 按上下文 |
| 角标 | Corner | 按控件约定 | 按上下文 |
| 状态 | Status | 按控件约定 | 按上下文 |
| 说明 | Description | 按控件约定 | 按上下文 |
| 提示 | Hint | 按控件约定 | 按上下文 |
| 操作项 | ActionItems | 按控件约定 | 按上下文 |
| 字号 | FontSize | length | 按上下文 |
| 点击 | Click | 按控件约定 | 按上下文 |
| 变更 | Change | 按控件约定 | 按上下文 |
| 提交 | Submit | 按控件约定 | 按上下文 |
| 选择 | Select | 按控件约定 | 按上下文 |
| 打开 | Open | 按控件约定 | 按上下文 |
| 获得焦点 | Focus | 按控件约定 | 按上下文 |
| 失去焦点 | Blur | 按控件约定 | 按上下文 |
| 完成 | Complete | 按控件约定 | 按上下文 |
| 拖动开始 | DragStart | 按控件约定 | 按上下文 |
| 拖动结束 | DragEnd | 按控件约定 | 按上下文 |
| 拖动取消 | DragCancel | 按控件约定 | 按上下文 |
| 关闭 | Close | 按控件约定 | 按上下文 |
| 禁用 | Disabled | 是、否 | 按上下文 |
| 可见 | Visible | 是、否 | 按上下文 |
| 可见性 | Visibility | 显示、隐藏、折叠 | 按上下文 |
| 水平对齐 | HorizontalAlignment | 上、居中、下、拉伸 | 按上下文 |
| 垂直对齐 | VerticalAlignment | 左、居中、右、拉伸 | 按上下文 |
| 停靠 | Dock | 左、上、右、下 | 按上下文 |
| 最后子项填充 | LastChildFill | 是、否 | 停靠面板 |
| 流向 | FlowDirection | 从左到右、从右到左 | 堆叠面板、换行面板 |
| 层级 | ZIndex | 按控件约定 | 按上下文 |
| 渲染变换 | RenderTransform | text | 按上下文 |
| 渲染变换原点 | RenderTransformOrigin | text | 按上下文 |
| 布局变换 | LayoutTransform | text | 按上下文 |
| 值 | Value | 按控件约定 | 按上下文 |
| 最大值 | Max | 按控件约定 | 按上下文 |
| 最小值 | Min | 按控件约定 | 按上下文 |
| 步长 | Step | 按控件约定 | 按上下文 |
| 占位文本 | Placeholder | 按控件约定 | 按上下文 |
| 项目 | Items | 按控件约定 | 按上下文 |
| 数据 | Data | 按控件约定 | 按上下文 |
| 选项 | Options | 按控件约定 | 按上下文 |
| 图标 | Icon | 按控件约定 | 按上下文 |
| 图片 | Image | 按控件约定 | 按上下文 |
| 资源 | Source | 按控件约定 | 按上下文 |
| 方向 | Orientation | 按控件约定 | 按上下文 |
| 列数 | Columns | 按控件约定 | 按上下文 |
| 行数 | Rows | 按控件约定 | 按上下文 |
| 子项间距 | Gap | 按控件约定 | 按上下文 |
| 类型 | Type | 按控件约定 | 按上下文 |
| 条件 | Test | 按控件约定 | 按上下文 |
| 集合 | In | 按控件约定 | 按上下文 |
| 循环项 | Each | 按控件约定 | 按上下文 |
| 路径 | Path | 按控件约定 | 按上下文 |
| 插槽名 | Name | 按控件约定 | 按上下文 |
| 错误 | Error | 按控件约定 | 按上下文 |
| 点击遮罩关闭 | CloseOnOverlay | 是、否 | 按上下文 |
| 显示关闭按钮 | ShowCloseButton | 是、否 | 按上下文 |
| 安全边 | Edges | 全部、无、水平、垂直 | 按上下文 |
| 安全区模式 | Mode | 内边距、外边距 | 按上下文 |
| 原生菜单安全区 | NativeMenuInset | 是、否 | 按上下文 |
| 文字描边颜色 | TextStrokeColor | color | 文本 |
| 文字描边宽度 | TextStrokeWidth | number | 文本 |
| 占位文字颜色 | PlaceholderColor | color | 文本框 |
| 光标颜色 | CursorColor | color | 文本框 |
| 文字左右对齐 | TextHorizontalAlignment | 左、居中、右 | 按上下文 |
| 文字上下对齐 | TextVerticalAlignment | 上、居中、下 | 按上下文 |
| 悬停背景 | HoverBackground | brush | 按钮 |
| 按下背景 | PressedBackground | brush | 按钮 |
| 字体家族 | FontFamily | text | 按上下文 |
| 字重 | FontWeight | normal、bold、100、200、300、400、500、600、700、800、900 | 按上下文 |
| 字体样式 | FontStyle | normal、italic | 按上下文 |
| 行高 | LineHeight | number | 按上下文 |
| 字距 | LetterSpacing | number | 按上下文 |
| 文字换行 | TextWrapping | 不换行、换行 | 按上下文 |
| 文字裁剪 | TextTrimming | 无、尾部省略 | 按上下文 |
| 轨道画刷 | TrackBrush | brush | 进度条 |
| 进度画刷 | FillBrush | brush | 进度条 |
| 进度方向 | ProgressDirection | 从左到右、从右到左、从上到下、从下到上 | 按上下文 |

绑定模式、刷新限制和事件桥见 [绑定与事件](bindings.md)；尺寸和特殊轴向见 [布局](layout.md)。
