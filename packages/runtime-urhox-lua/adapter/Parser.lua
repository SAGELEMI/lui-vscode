-- LUI 解析器：设计层使用 UTF-8 中文语法；只有引用、绑定、动作值会进入 Lua。
local Parser = {}

local tags = {
    ["页面"] = "lui:Page", ["组件"] = "lui:Component", ["条件"] = "lui:If", ["循环"] = "lui:For", ["插槽"] = "lui:Slot", ["预览"] = "lui:Preview", ["设值"] = "lui:Set",
    ["面板"] = "Panel", ["横排"] = "Row", ["文本"] = "Text", ["按钮"] = "Button", ["卡片"] = "Card", ["滚动区"] = "Scroll", ["进度条"] = "Progress", ["开关"] = "Toggle", ["滑块"] = "Slider", ["安全区"] = "SafeArea", ["弹窗"] = "Modal", ["分区"] = "Section", ["提示"] = "Notice", ["屏幕"] = "Screen", ["固定屏幕"] = "FixedScreen",
}
local components = {
    Header = "页眉", EquipmentSlots = "装备槽", PageShell = "页面外壳", ScrollRegion = "滚动区域", InformationPanel = "信息面板", SelectionList = "选择列表", TabView = "页签视图",
}
local attrs = {
    ["名称"] = "x:Name", ["副名称"] = "x:DisplayName", ["引用"] = "x:Ref", ["宽度"] = "Width", ["高度"] = "Height", ["最小宽度"] = "MinWidth", ["最小高度"] = "MinHeight", ["最大宽度"] = "MaxWidth", ["最大高度"] = "MaxHeight", ["外边距"] = "Margin", ["内边距"] = "Padding", ["子项间距"] = "Gap", ["锚点"] = "Anchor", ["左侧"] = "Left", ["顶部"] = "Top", ["右侧"] = "Right", ["底部"] = "Bottom", ["弹性增长"] = "FlexGrow", ["弹性基准"] = "FlexBasis", ["交叉轴对齐"] = "Align", ["主轴对齐"] = "Justify", ["背景"] = "Background", ["颜色"] = "Color", ["不透明度"] = "Opacity", ["圆角"] = "BorderRadius", ["样式"] = "Variant", ["文本"] = "Text", ["标题"] = "Title", ["副标题"] = "Subtitle", ["字号"] = "FontSize", ["点击"] = "Click", ["变更"] = "Change", ["关闭"] = "Close", ["禁用"] = "Disabled", ["值"] = "Value", ["最大值"] = "Max", ["最小值"] = "Min", ["条件"] = "Test", ["集合"] = "In", ["项目"] = "Each", ["路径"] = "Path", ["错误"] = "Error", ["设置"] = "Settings", ["返回"] = "Back", ["武器文本"] = "WeaponText", ["护甲文本"] = "ArmorText", ["选择武器"] = "SelectWeapon", ["选择护甲"] = "SelectArmor", ["点击遮罩关闭"] = "CloseOnOverlay", ["显示关闭按钮"] = "ShowCloseButton",
}

local function canonicalAttr(name)
    local preview = name:match("^预览%.(.+)$")
    if preview then return "Preview." .. canonicalAttr(preview) end
    local directory = name:match("^目录:(.+)$")
    if directory then return "目录:" .. directory end
    local legacy = name:match("^xmlns:(.+)$")
    if legacy then return "目录:" .. legacy end
    return attrs[name] or name
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

local function parseAttributes(text, start, finish)
    local attrs = {}
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
        name = canonicalAttr(name)
        if attrs[name] ~= nil then return nil, "LUI 属性重复：" .. name end
        attrs[name] = text:sub(valueStart, close - 1)
        index = close + 1
    end
    return attrs
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
                local attrs, attrErr = parseAttributes(text, index, attrFinish)
                if not attrs then return nil, string.format("%s:%d %s", path, openStart, attrErr) end
                local valid, message = validateDesignName(attrs, path, openStart)
                if not valid then return nil, message end
                local node = { kind = "Element", tag = tag, tagSymbol = pool:Intern(tag), attrs = attrs, attrSymbols = {}, children = {}, sourcePath = path }
                for name in pairs(attrs) do node.attrSymbols[pool:Intern(name)] = true end
                if not root then root = node elseif #stack == 0 then return nil, string.format("%s:%d LUI 只能有一个根元素。", path, openStart) end
                if #stack > 0 then stack[#stack].children[#stack[#stack].children + 1] = node end
                if not selfClosing then stack[#stack + 1] = node end
            end
            offset = originalClose + 1
        end
    end
    if #stack > 0 then return nil, string.format("%s: <%s> 缺少结束标签。", path, stack[#stack].tag) end
    if not root then return nil, string.format("%s: LUI 文档缺少根元素。", path) end
    root.symbols = pool.names
    return root, nil
end

function Parser.Load(path)
    local text, err = readResource(path)
    if not text then return nil, err end
    return Parser.Parse(text, path)
end

return Parser
