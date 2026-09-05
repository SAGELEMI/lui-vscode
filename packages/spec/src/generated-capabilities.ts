// Generated from packages/spec/ui-capabilities.json. Do not edit by hand.
export interface LuiCapabilityContract { schemaVersion: number; description?: string; groups: Record<string, readonly string[]>; structuralTags: readonly string[]; rootTags: readonly string[]; builtInVisualTags: readonly string[]; textTags: readonly string[]; specific: Record<string, readonly string[]>; generatedControlAttributes: readonly string[]; }
export const UI_CAPABILITIES = {
  "schemaVersion": 1,
  "description": "LUI 可视标签能力契约。Studio、补全和 UrhoX Runtime 均由此表生成。",
  "groups": {
    "identity": [
      "x:Name",
      "x:Ref"
    ],
    "rootIdentity": [
      "x:Name",
      "x:DisplayName"
    ],
    "layout": [
      "Width",
      "Height",
      "MinWidth",
      "MinHeight",
      "MaxWidth",
      "MaxHeight",
      "Margin",
      "Padding",
      "ClipToBounds",
      "HorizontalAlignment",
      "VerticalAlignment",
      "Visibility",
      "ZIndex",
      "ChildLayout",
      "Wrap",
      "ChildWidth",
      "ChildHeight",
      "HorizontalGap",
      "VerticalGap",
      "Fill",
      "RenderTransform",
      "RenderTransformOrigin",
      "LayoutTransform",
      "Canvas.Left",
      "Canvas.Top",
      "Canvas.Right",
      "Canvas.Bottom",
      "Grid.Row",
      "Grid.Column",
      "Grid.RowSpan",
      "Grid.ColumnSpan",
      "Dock"
    ],
    "surface": [
      "Background",
      "BorderWidth",
      "BorderColor",
      "Opacity",
      "BorderRadius"
    ],
    "typography": [
      "FontFamily",
      "FontSize",
      "FontWeight",
      "FontStyle",
      "Color",
      "LineHeight",
      "LetterSpacing",
      "TextWrapping",
      "TextTrimming",
      "TextHorizontalAlignment",
      "TextVerticalAlignment"
    ]
  },
  "structuralTags": [
    "lui:If",
    "lui:For",
    "lui:Slot",
    "lui:Preview",
    "lui:Set",
    "lui:Action",
    "lui:Resource"
  ],
  "rootTags": [
    "lui:Page",
    "lui:Component"
  ],
  "builtInVisualTags": [
    "Container",
    "Grid",
    "Canvas",
    "Viewbox",
    "StackPanel",
    "WrapPanel",
    "DockPanel",
    "UniformGrid",
    "Border",
    "Scroll",
    "ContentControl",
    "Text",
    "Button",
    "Card",
    "Progress",
    "Toggle",
    "Slider",
    "SafeArea",
    "Modal",
    "Section",
    "Notice",
    "Screen",
    "FixedScreen",
    "Panel",
    "Row"
  ],
  "textTags": [
    "Text",
    "Button",
    "TextField",
    "Checkbox",
    "Dropdown",
    "Toast",
    "Tabs",
    "Tooltip",
    "Badge",
    "List",
    "Chip",
    "Accordion",
    "Stepper",
    "Rating",
    "Breadcrumb",
    "Pagination",
    "Alert",
    "Timeline",
    "Menu",
    "Tree",
    "DatePicker",
    "TimePicker",
    "ColorPicker",
    "Table",
    "FileUpload",
    "RichText",
    "VirtualList",
    "ItemSlot",
    "SkillTree",
    "ChatWindow",
    "ItemTooltip"
  ],
  "specific": {
    "Grid": [
      "RowDefinitions",
      "ColumnDefinitions",
      "RowSpacing",
      "ColumnSpacing"
    ],
    "DockPanel": [
      "LastChildFill"
    ],
    "StackPanel": [
      "Orientation",
      "FlowDirection",
      "Gap"
    ],
    "WrapPanel": [
      "Orientation",
      "FlowDirection",
      "Gap"
    ],
    "Text": [
      "Text",
      "TextStrokeColor",
      "TextStrokeWidth"
    ],
    "TextField": [
      "PlaceholderColor",
      "CursorColor"
    ],
    "Button": [
      "Text",
      "Click",
      "Disabled",
      "Variant",
      "HoverBackground",
      "PressedBackground"
    ],
    "Progress": [
      "Value",
      "Max",
      "TrackBrush",
      "FillBrush",
      "ProgressDirection"
    ],
    "Toggle": [
      "Value",
      "Change",
      "Disabled"
    ],
    "Slider": [
      "Value",
      "Min",
      "Max",
      "Change",
      "Disabled"
    ],
    "Scroll": [
      "HorizontalScrollBarVisibility",
      "VerticalScrollBarVisibility",
      "ScrollbarColor"
    ],
    "Modal": [
      "Title",
      "Close",
      "CloseOnOverlay",
      "ShowCloseButton"
    ],
    "Section": [
      "Title",
      "Subtitle"
    ],
    "Notice": [
      "Text",
      "Error"
    ],
    "lui:If": [
      "Test"
    ],
    "lui:For": [
      "Items",
      "In"
    ],
    "lui:Set": [
      "Path",
      "Value"
    ]
  },
  "generatedControlAttributes": [
    "Text",
    "Title",
    "Subtitle",
    "Value",
    "Min",
    "Max",
    "Step",
    "Placeholder",
    "Items",
    "Data",
    "Options",
    "Icon",
    "Image",
    "Source",
    "Orientation",
    "Columns",
    "Rows",
    "Gap",
    "Type",
    "Visible"
  ]
} as const satisfies LuiCapabilityContract;
const generatedTags: Set<string> = new Set(["Widget","Panel","TextField","Checkbox","Dropdown","Toast","Tabs","Tooltip","Badge","Avatar","List","Divider","Skeleton","Chip","Accordion","Stepper","Rating","Breadcrumb","Pagination","Alert","Timeline","Menu","Tree","DatePicker","TimePicker","ColorPicker","Table","Carousel","Drawer","Popover","Calendar","FileUpload","RichText","SimpleGrid","Spine","SpriteSheet","Sprite","VirtualList","DragDropContext","ItemSlot","SkillTree","ChatWindow","ItemTooltip"]);
const visualTags: Set<string> = new Set([...UI_CAPABILITIES.builtInVisualTags, ...generatedTags]);
const textTags: Set<string> = new Set(UI_CAPABILITIES.textTags);
export function capabilityAttributes(tag: string, root = false): string[] {
  const identity: readonly string[] = root ? UI_CAPABILITIES.groups.rootIdentity : UI_CAPABILITIES.groups.identity;
  if ((UI_CAPABILITIES.structuralTags as readonly string[]).includes(tag)) return [...identity, ...((UI_CAPABILITIES.specific as Record<string, readonly string[]>)[tag] ?? [])];
  const attributes: string[] = [...identity, ...UI_CAPABILITIES.groups.layout];
  if (visualTags.has(tag) || (UI_CAPABILITIES.rootTags as readonly string[]).includes(tag)) attributes.push(...UI_CAPABILITIES.groups.surface);
  if (textTags.has(tag)) attributes.push(...UI_CAPABILITIES.groups.typography);
  attributes.push(...((UI_CAPABILITIES.specific as Record<string, readonly string[]>)[tag] ?? []));
  if (generatedTags.has(tag)) attributes.push(...UI_CAPABILITIES.generatedControlAttributes);
  return [...new Set(attributes)];
}
export function isVisualTag(tag: string): boolean { return visualTags.has(tag) || (UI_CAPABILITIES.rootTags as readonly string[]).includes(tag); }
export function isTextTag(tag: string): boolean { return textTags.has(tag); }
