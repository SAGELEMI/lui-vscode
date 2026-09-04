-- LUI 解析器：设计层使用 UTF-8 中文语法；只有引用、绑定、动作值会进入 Lua。
local Parser = {}
local Controls = require("LUI.Controls")

local tags = {
    ["页面"] = "lui:Page", ["控件"] = "lui:Component", ["组件"] = "lui:Component", ["条件"] = "lui:If", ["重复项"] = "lui:For", ["循环"] = "lui:For", ["内容呈现器"] = "lui:Slot", ["插槽"] = "lui:Slot", ["预览"] = "lui:Preview", ["设值"] = "lui:Set",
    ["容器"] = "Container", ["网格"] = "Grid", ["画布"] = "Canvas", ["视图框"] = "Viewbox", ["堆叠面板"] = "StackPanel", ["换行面板"] = "WrapPanel", ["停靠面板"] = "DockPanel", ["均分网格"] = "UniformGrid", ["边框"] = "Border", ["内容控件"] = "ContentControl", ["面板"] = "Panel", ["横排"] = "Row", ["文本"] = "Text", ["按钮"] = "Button", ["卡片"] = "Card", ["滚动区"] = "Scroll", ["滚动查看器"] = "Scroll", ["进度条"] = "Progress", ["开关"] = "Toggle", ["滑块"] = "Slider", ["安全区"] = "SafeArea", ["弹窗"] = "Modal", ["分区"] = "Section", ["提示"] = "Notice", ["屏幕"] = "Screen", ["固定屏幕"] = "FixedScreen",
}
local components = {
    Header = "页眉", EquipmentSlots = "装备槽", ScrollRegion = "滚动区域", InformationPanel = "信息面板", SelectionList = "选择列表", TabView = "页签视图",
}
local attributeAliases = {
    ["名称"] = "x:Name", ["副名称"] = "x:DisplayName", ["引用"] = "x:Ref", ["宽度"] = "Width", ["高度"] = "Height", ["最小宽度"] = "MinWidth", ["最小高度"] = "MinHeight", ["最大宽度"] = "MaxWidth", ["最大高度"] = "MaxHeight", ["外边距"] = "Margin", ["内边距"] = "Padding", ["裁剪超出"] = "ClipToBounds", ["水平对齐"] = "HorizontalAlignment", ["垂直对齐"] = "VerticalAlignment", ["可见性"] = "Visibility", ["停靠"] = "Dock", ["最后子项填充"] = "LastChildFill", ["流向"] = "FlowDirection", ["层级"] = "ZIndex", ["渲染变换"] = "RenderTransform", ["渲染变换原点"] = "RenderTransformOrigin", ["布局变换"] = "LayoutTransform", ["行定义"] = "RowDefinitions", ["列定义"] = "ColumnDefinitions", ["行间距"] = "RowSpacing", ["列间距"] = "ColumnSpacing", ["网格.行"] = "Grid.Row", ["网格.列"] = "Grid.Column", ["网格.跨行"] = "Grid.RowSpan", ["网格.跨列"] = "Grid.ColumnSpan", ["画布.左"] = "Canvas.Left", ["画布.上"] = "Canvas.Top", ["画布.右"] = "Canvas.Right", ["画布.下"] = "Canvas.Bottom", ["背景"] = "Background", ["颜色"] = "Color", ["不透明度"] = "Opacity", ["圆角"] = "BorderRadius", ["样式"] = "Variant", ["外观"] = "Variant", ["可见"] = "Visible", ["文本"] = "Text", ["标题"] = "Title", ["副标题"] = "Subtitle", ["角标"] = "Corner", ["状态"] = "Status", ["说明"] = "Description", ["提示"] = "Hint", ["操作项"] = "ActionItems", ["字号"] = "FontSize", ["点击"] = "Click", ["变更"] = "Change", ["提交"] = "Submit", ["选择"] = "Select", ["打开"] = "Open", ["获得焦点"] = "Focus", ["失去焦点"] = "Blur", ["完成"] = "Complete", ["拖动开始"] = "DragStart", ["拖动结束"] = "DragEnd", ["拖动取消"] = "DragCancel", ["关闭"] = "Close", ["禁用"] = "Disabled", ["值"] = "Value", ["最大值"] = "Max", ["最小值"] = "Min", ["步长"] = "Step", ["占位文本"] = "Placeholder", ["项目"] = "Items", ["数据"] = "Data", ["选项"] = "Options", ["图标"] = "Icon", ["图片"] = "Image", ["资源"] = "Source", ["方向"] = "Orientation", ["列数"] = "Columns", ["行数"] = "Rows", ["间距"] = "Gap", ["类型"] = "Type", ["条件"] = "Test", ["集合"] = "In", ["循环项"] = "Each", ["路径"] = "Path", ["插槽名"] = "Name", ["错误"] = "Error", ["设置"] = "Settings", ["返回"] = "Back", ["武器文本"] = "WeaponText", ["护甲文本"] = "ArmorText", ["选择武器"] = "SelectWeapon", ["选择护甲"] = "SelectArmor", ["点击遮罩关闭"] = "CloseOnOverlay", ["显示关闭按钮"] = "ShowCloseButton", ["安全边"] = "Edges", ["安全区模式"] = "Mode", ["原生菜单安全区"] = "NativeMenuInset", ["锚点"] = "Anchor", ["左侧"] = "Left", ["顶部"] = "Top", ["右侧"] = "Right", ["底部"] = "Bottom", ["子项间距"] = "Gap", ["弹性增长"] = "FlexGrow", ["弹性基准"] = "FlexBasis", ["交叉轴对齐"] = "Align", ["主轴对齐"] = "Justify",
}

-- LUI 2.0 universal layout-host attributes.  Kept separate from the legacy
-- aliases above so old source remains readable without advertising it.
attributeAliases["子项排列"] = "ChildLayout"
attributeAliases["允许换行"] = "Wrap"
attributeAliases["固定子项宽度"] = "ChildWidth"
attributeAliases["固定子项高度"] = "ChildHeight"
attributeAliases["水平间隔"] = "HorizontalGap"
attributeAliases["垂直间隔"] = "VerticalGap"
attributeAliases["填充"] = "Fill"
attributeAliases["边框宽度"] = "BorderWidth"
attributeAliases["边框颜色"] = "BorderColor"
attributeAliases["滚动条颜色"] = "ScrollbarColor"
attributeAliases["水平滚动条可见性"] = "HorizontalScrollBarVisibility"
attributeAliases["垂直滚动条可见性"] = "VerticalScrollBarVisibility"

for internalName, descriptor in pairs(Controls) do
    -- 根与结构标签优先，不能被同名 UI.Widget（“控件”）覆盖。
    tags[descriptor.name] = tags[descriptor.name] or internalName
    tags[internalName] = internalName
end

local function canonicalAttr(name)
    local preview = name:match("^预览%.(.+)$")
    if preview then return "Preview." .. canonicalAttr(preview) end
    local directory = name:match("^目录:(.+)$")
    if directory then return "目录:" .. directory end
    local legacy = name:match("^xmlns:(.+)$")
    if legacy then return "目录:" .. legacy end
    return attributeAliases[name] or name
end
local function canonicalTag(tag)
    local owner, property = tag:match("^(.+)%.(.+)$")
    if owner and property then return canonicalTag(owner) .. "." .. canonicalAttr(property) end
    local alias, component = tag:match("^([^:]+):(.+)$")
    if alias and alias ~= "lui" then return alias .. ":" .. (components[component] or component) end
    return tags[tag] or tag
end

local function readResource(path)
    if not cache or not cache:Exists(path) then return nil, "LUI 资源不存在：" .. tostring(path) end
    local file = cache:GetFile(path)
    if not file or not file:IsOpen() then return nil, "LUI 资源无法打开：" .. tostring(path) end
    local ok, text = pcall(function() return file:ReadString() end)
    file:Close()
    if not ok then return nil, "LUI 资源读取失败：" .. tostring(path) end
    return text, nil
end

local function isSpace(byte) return byte == 32 or byte == 9 or byte == 10 or byte == 13 end
local function isNameDelimiter(byte)
    return not byte or isSpace(byte) or byte == 60 or byte == 62 or byte == 47 or byte == 61 or byte == 34 or byte == 39
end
local function skipSpace(text, index)
    while isSpace(text:byte(index)) do index = index + 1 end
    return index
end
local function readName(text, index)
    local start = index
    while not isNameDelimiter(text:byte(index)) do index = index + 1 end
    if index == start then return nil, index end
    return text:sub(start, index - 1), index
end

local function parseAttributes(text, start, finish, imported)
    local parsedAttributes = {}
    local rawAttributes = {}
    local index = start
    while index <= finish do
        index = skipSpace(text, index)
        if index > finish then break end
        local name
        name, index = readName(text, index)
        if not name then return nil, "LUI 属性名无效。" end
        index = skipSpace(text, index)
        if text:sub(index, index) ~= "=" then return nil, "LUI 属性缺少 =：" .. name end
        index = skipSpace(text, index + 1)
        local quote = text:sub(index, index)
        if quote ~= "\"" and quote ~= "'" then return nil, "LUI 属性必须使用引号：" .. name end
        local valueStart = index + 1
        local close = text:find(quote, valueStart, true)
        if not close or close > finish + 1 then return nil, "LUI 属性没有结束引号：" .. name end
        if rawAttributes[name] ~= nil then return nil, "LUI 属性重复：" .. name end
        rawAttributes[name] = text:sub(valueStart, close - 1)
        name = canonicalAttr(name)
        if parsedAttributes[name] ~= nil and not imported then return nil, "LUI 属性重复：" .. name end
        parsedAttributes[name] = text:sub(valueStart, close - 1)
        index = close + 1
    end
    return parsedAttributes, nil, rawAttributes
end

local function makeSymbolPool()
    return { byName = {}, names = {}, Intern = function(self, name)
        local symbol = self.byName[name]
        if symbol then return symbol end
        symbol = #self.names + 1; self.names[symbol] = name; self.byName[name] = symbol
        return symbol
    end }
end

local function validateDesignName(attrs, path, offset)
    local name = attrs["x:Name"]
    if name and (name:match("^%s*$") or name:find("[<>]")) then
        return false, string.format("%s:%d 名称必须是非空设计名称。", path, offset)
    end
    local ref = attrs["x:Ref"]
    if ref and not ref:match("^[A-Za-z][A-Za-z0-9_.%-]*$") then
        return false, string.format("%s:%d 引用必须是 ASCII Lua 引用。", path, offset)
    end
    return true
end

function Parser.Read(path) return readResource(path) end

function Parser.Parse(text, path)
    if type(text) ~= "string" then return nil, "LUI 源码必须是文本。" end
    if text:sub(1, 3) == "\239\187\191" then text = text:sub(4) end
    local pool, root, stack = makeSymbolPool(), nil, {}
    local offset = 1
    while offset <= #text do
        local openStart = text:find("<", offset, true)
        if not openStart then
            local trailing = text:sub(offset)
            if trailing:match("%S") and #stack > 0 then stack[#stack].children[#stack[#stack].children + 1] = { kind = "Text", text = trailing } end
            break
        end
        local before = text:sub(offset, openStart - 1)
        if before:match("%S") and #stack > 0 then stack[#stack].children[#stack[#stack].children + 1] = { kind = "Text", text = before } end
        if text:sub(openStart, openStart + 3) == "<!--" then
            local commentEnd = text:find("-->", openStart + 4, true)
            if not commentEnd then return nil, string.format("%s:%d LUI 注释未结束。", path, openStart) end
            offset = commentEnd + 3
        else
            local originalClose = text:find(">", openStart + 1, true)
            if not originalClose then return nil, string.format("%s:%d LUI 标签未结束。", path, openStart) end
            local index = skipSpace(text, openStart + 1)
            local closing = false
            if text:sub(index, index) == "/" then closing = true; index = skipSpace(text, index + 1) end
            local tag
            tag, index = readName(text, index)
            if not tag then return nil, string.format("%s:%d LUI 标签缺少名称。", path, openStart) end
            -- Opening and closing tags must compare in the same internal vocabulary.
            tag = canonicalTag(tag)
            index = skipSpace(text, index)
            local attrFinish = originalClose - 1
            local selfClosing = not closing and text:sub(attrFinish, attrFinish) == "/"
            if selfClosing then attrFinish = attrFinish - 1 end
            if closing then
                if text:sub(index, originalClose - 1):match("%S") then return nil, string.format("%s:%d LUI 结束标签无效。", path, openStart) end
                local node = table.remove(stack)
                if not node or node.tag ~= tag then return nil, string.format("%s:%d LUI 结束标签不匹配：%s", path, openStart, tag) end
            else
                local nodeAttributes, attrErr, rawAttributes = parseAttributes(text, index, attrFinish, tag:find(":", 1, true) and tag:sub(1,4) ~= "lui:")
                if not nodeAttributes then return nil, string.format("%s:%d %s", path, openStart, attrErr) end
                local valid, message = validateDesignName(nodeAttributes, path, openStart)
                if not valid then return nil, message end
                local node = { kind = "Element", tag = tag, tagSymbol = pool:Intern(tag), attrs = nodeAttributes, rawAttrs = rawAttributes, attrSymbols = {}, children = {}, sourcePath = path }
                for name in pairs(nodeAttributes) do node.attrSymbols[pool:Intern(name)] = true end
                if not root then root = node elseif #stack == 0 then return nil, string.format("%s:%d LUI 只能有一个根元素。", path, openStart) end
                if #stack > 0 then stack[#stack].children[#stack[#stack].children + 1] = node end
                if not selfClosing then stack[#stack + 1] = node end
            end
            offset = originalClose + 1
        end
    end
    if #stack > 0 then return nil, string.format("%s: <%s> 缺少结束标签。", path, stack[#stack].tag) end
    if not root then return nil, string.format("%s: LUI 文档缺少根元素。", path) end
    if root.tag ~= "lui:Page" and root.tag ~= "lui:Component" then return nil, string.format("%s: LUI 根节点只能是 <页面> 或 <控件>。", path) end
    if root.tag == "lui:Page" then
        local width, height = tonumber(root.attrs.Width), tonumber(root.attrs.Height)
        if not width or width <= 0 or not height or height <= 0 then return nil, string.format("%s: <页面> 的宽度和高度必须是正数 px。", path) end
    end
    local function validateRootOnly(node)
        for _, child in ipairs(node.children or {}) do
            if child.tag == "lui:Page" or child.tag == "lui:Component" then return false end
            if not validateRootOnly(child) then return false end
        end
        return true
    end
    if not validateRootOnly(root) then return nil, string.format("%s: <页面> 与 <控件> 只能作为 LUI 文档根节点，不能嵌套。", path) end
    root.symbols = pool.names
    return root, nil
end

function Parser.Load(path)
    local text, err = readResource(path)
    if not text then return nil, err end
    return Parser.Parse(text, path)
end

return Parser
