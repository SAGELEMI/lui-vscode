// Generated from packages/spec/controls.json. Do not edit by hand.
export interface LuiControlDefinition { tag: string; name: string; ui: string; category: string; children?: boolean; bindable?: string; events?: readonly string[]; }
export const UI_CONTROL_DEFINITIONS: readonly LuiControlDefinition[] = [
  {
    "tag": "Widget",
    "name": "控件",
    "ui": "Widget",
    "category": "基础"
  },
  {
    "tag": "Panel",
    "name": "容器",
    "ui": "Panel",
    "category": "基础",
    "children": true
  },
  {
    "tag": "TextField",
    "name": "文本框",
    "ui": "TextField",
    "category": "输入",
    "bindable": "Text",
    "events": [
      "Change",
      "Submit",
      "Focus",
      "Blur"
    ]
  },
  {
    "tag": "Checkbox",
    "name": "复选框",
    "ui": "Checkbox",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Dropdown",
    "name": "下拉框",
    "ui": "Dropdown",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change",
      "Open",
      "Close"
    ]
  },
  {
    "tag": "Toast",
    "name": "吐司",
    "ui": "Toast",
    "category": "反馈",
    "events": [
      "Close"
    ]
  },
  {
    "tag": "Tabs",
    "name": "选项卡",
    "ui": "Tabs",
    "category": "导航",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Tooltip",
    "name": "工具提示",
    "ui": "Tooltip",
    "category": "反馈",
    "children": true
  },
  {
    "tag": "Badge",
    "name": "徽章",
    "ui": "Badge",
    "category": "展示"
  },
  {
    "tag": "Avatar",
    "name": "头像",
    "ui": "Avatar",
    "category": "展示"
  },
  {
    "tag": "List",
    "name": "列表",
    "ui": "List",
    "category": "数据",
    "children": true,
    "events": [
      "Select"
    ]
  },
  {
    "tag": "Divider",
    "name": "分隔线",
    "ui": "Divider",
    "category": "布局"
  },
  {
    "tag": "Skeleton",
    "name": "骨架屏",
    "ui": "Skeleton",
    "category": "反馈"
  },
  {
    "tag": "Chip",
    "name": "标签片",
    "ui": "Chip",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Click",
      "Change"
    ]
  },
  {
    "tag": "Accordion",
    "name": "折叠面板",
    "ui": "Accordion",
    "category": "布局",
    "children": true,
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Stepper",
    "name": "步骤条",
    "ui": "Stepper",
    "category": "导航",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Rating",
    "name": "评分",
    "ui": "Rating",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Breadcrumb",
    "name": "面包屑",
    "ui": "Breadcrumb",
    "category": "导航",
    "events": [
      "Select"
    ]
  },
  {
    "tag": "Pagination",
    "name": "分页",
    "ui": "Pagination",
    "category": "导航",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Alert",
    "name": "警告框",
    "ui": "Alert",
    "category": "反馈",
    "events": [
      "Close"
    ]
  },
  {
    "tag": "Timeline",
    "name": "时间线",
    "ui": "Timeline",
    "category": "数据"
  },
  {
    "tag": "Menu",
    "name": "菜单",
    "ui": "Menu",
    "category": "导航",
    "events": [
      "Select"
    ]
  },
  {
    "tag": "Tree",
    "name": "树",
    "ui": "Tree",
    "category": "数据",
    "events": [
      "Select",
      "Change"
    ]
  },
  {
    "tag": "DatePicker",
    "name": "日期选择器",
    "ui": "DatePicker",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "TimePicker",
    "name": "时间选择器",
    "ui": "TimePicker",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "ColorPicker",
    "name": "颜色选择器",
    "ui": "ColorPicker",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Table",
    "name": "表格",
    "ui": "Table",
    "category": "数据",
    "events": [
      "Select"
    ]
  },
  {
    "tag": "Carousel",
    "name": "轮播",
    "ui": "Carousel",
    "category": "导航",
    "bindable": "Value",
    "events": [
      "Change"
    ]
  },
  {
    "tag": "Drawer",
    "name": "抽屉",
    "ui": "Drawer",
    "category": "反馈",
    "children": true,
    "events": [
      "Open",
      "Close"
    ]
  },
  {
    "tag": "Popover",
    "name": "弹出层",
    "ui": "Popover",
    "category": "反馈",
    "children": true,
    "events": [
      "Open",
      "Close"
    ]
  },
  {
    "tag": "Calendar",
    "name": "日历",
    "ui": "Calendar",
    "category": "输入",
    "bindable": "Value",
    "events": [
      "Change",
      "Select"
    ]
  },
  {
    "tag": "FileUpload",
    "name": "文件上传",
    "ui": "FileUpload",
    "category": "输入",
    "events": [
      "Change",
      "Submit"
    ]
  },
  {
    "tag": "RichText",
    "name": "富文本",
    "ui": "RichText",
    "category": "展示"
  },
  {
    "tag": "SimpleGrid",
    "name": "简单网格",
    "ui": "SimpleGrid",
    "category": "布局",
    "children": true
  },
  {
    "tag": "Spine",
    "name": "骨骼动画",
    "ui": "Spine",
    "category": "媒体",
    "events": [
      "Complete"
    ]
  },
  {
    "tag": "SpriteSheet",
    "name": "精灵表",
    "ui": "SpriteSheet",
    "category": "媒体",
    "events": [
      "Complete"
    ]
  },
  {
    "tag": "Sprite",
    "name": "精灵",
    "ui": "Sprite",
    "category": "媒体"
  },
  {
    "tag": "VirtualList",
    "name": "虚拟列表",
    "ui": "VirtualList",
    "category": "数据",
    "events": [
      "Select"
    ]
  },
  {
    "tag": "DragDropContext",
    "name": "拖放上下文",
    "ui": "DragDropContext",
    "category": "交互",
    "children": true,
    "events": [
      "DragStart",
      "DragEnd",
      "DragCancel"
    ]
  },
  {
    "tag": "ItemSlot",
    "name": "物品槽",
    "ui": "ItemSlot",
    "category": "交互",
    "events": [
      "Click",
      "Change"
    ]
  },
  {
    "tag": "SkillTree",
    "name": "技能树",
    "ui": "SkillTree",
    "category": "交互",
    "events": [
      "Select",
      "Change"
    ]
  },
  {
    "tag": "ChatWindow",
    "name": "聊天窗口",
    "ui": "ChatWindow",
    "category": "组合",
    "events": [
      "Submit",
      "Select"
    ]
  },
  {
    "tag": "ItemTooltip",
    "name": "物品提示",
    "ui": "ItemTooltip",
    "category": "组合"
  }
] as const;
export const UI_CONTROL_BY_TAG = Object.fromEntries(UI_CONTROL_DEFINITIONS.map((item) => [item.tag, item]));
export const UI_CONTROL_BY_NAME = Object.fromEntries(UI_CONTROL_DEFINITIONS.map((item) => [item.name, item]));
