local UI = require("urhox-libs/UI")
local Parser = require("LUI.Parser")
local Components = require("Presentation.Components")

-- LUI.Runtime 将纯声明式节点映射到 UrhoX UI。所有业务代码必须留在同名 .lui.lua。
local Runtime = {}
Runtime.__index = Runtime

local function readProjectConfig()
    local text, err = Parser.Read("LUI/lui.project.json")
    if not text then return { sourceRoots = {} }, err end
    local ok, config = pcall(cjson.decode, text)
    if not ok or type(config) ~= "table" then return { sourceRoots = {} }, "LUI 项目配置无效。" end
    return config, nil
end

local function inAllowedRoot(path, roots)
    if type(path) ~= "string" or path:find("..", 1, true) then return false end
    for _, root in ipairs(roots or {}) do if path:sub(1, #root) == root then return true end end
    return false
end

local function isDirectoryPath(path)
    if type(path) ~= "string" or path == "" or path:sub(1, 1) == "/" or path:find("\\", 1, true) or path:find("..", 1, true) then return false end
    return not path:find("//", 1, true) and not path:find("/./", 1, true)
end

local function loadLuaModule(path, roots)
    if not inAllowedRoot(path, roots) then return nil, "LUI 代码路径不在白名单内：" .. tostring(path) end
    if not path:match("%.lui%.lua$") then return nil, "LUI 仅可加载白名单内的 .lui.lua 后端：" .. tostring(path) end
    local source, readErr = Parser.Read(path)
    if not source then return nil, readErr end
    local environment = setmetatable({}, { __index = _G })
    local chunk, compileErr = load(source, "@" .. path, "t", environment)
    if not chunk then return nil, "LUI 代码编译失败：" .. tostring(compileErr) end
    local ok, exported = pcall(chunk)
    if not ok then return nil, "LUI 代码运行失败：" .. tostring(exported) end
    if type(exported) ~= "table" then return nil, "LUI 代码必须 return table。" end
    return exported, nil
end

local function bindingPath(value)
    return type(value) == "string" and (value:match("^{绑定%s+([A-Za-z][A-Za-z0-9_.%-]*)}$") or value:match("^{Binding%s+([A-Za-z][A-Za-z0-9_.%-]*)}$")) or nil
end

local function actionName(value)
    return type(value) == "string" and (value:match("^{动作%s+([A-Za-z][A-Za-z0-9_.%-]*)}$") or value:match("^{Action%s+([A-Za-z][A-Za-z0-9_.%-]*)}$")) or nil
end

local function resolvePath(context, path)
    local value = context
    for key in tostring(path or ""):gmatch("[^%.]+") do
        if type(value) ~= "table" then return nil end
        value = value[key]
    end
    return value
end

local function resolve(value, context)
    local path = bindingPath(value)
    if path then return resolvePath(context, path) end
    return value
end

local function color(value)
    if type(value) ~= "string" or value:sub(1, 1) ~= "#" then return nil end
    local hex = value:sub(2)
    if #hex == 6 then hex = hex .. "ff" end
    if #hex ~= 8 then return nil end
    return { tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16), tonumber(hex:sub(7, 8), 16) }
end

local function enumValue(name, value)
    local chinese = {
        Variant = { ["主要"] = "primary", ["次要"] = "secondary" },
        Disabled = { ["是"] = "true", ["否"] = "false" },
        CloseOnOverlay = { ["是"] = "true", ["否"] = "false" },
        ShowCloseButton = { ["是"] = "true", ["否"] = "false" },
    }
    return (chinese[name] and chinese[name][value]) or value
end

local function layoutValue(value)
    if value == "自动" then return "auto" end
    return tonumber(value) or value
end

-- LUI Thickness uses XAML order: left,top,right,bottom. UrhoX receives top,right,bottom,left.
local function thickness(value)
    if type(value) == "table" then return value end
    local parts = {}
    for part in tostring(value or "0"):gmatch("[^,]+") do parts[#parts + 1] = tonumber(part:match("^%s*(.-)%s*$")) or 0 end
    if #parts == 0 then parts[1] = 0 end
    if #parts == 1 then parts[2], parts[3], parts[4] = parts[1], parts[1], parts[1] end
    return { parts[2] or 0, parts[3] or 0, parts[4] or 0, parts[1] or 0 }
end

local function thicknessParts(value)
    local values = thickness(value)
    return values[4] or 0, values[1] or 0, values[2] or 0, values[3] or 0
end

local function propsFor(attrs, context)
    local props = {}
    local numeric = { Width = "width", Height = "height", MinWidth = "minWidth", MinHeight = "minHeight", MaxWidth = "maxWidth", MaxHeight = "maxHeight", FontSize = "fontSize", Opacity = "opacity", BorderRadius = "borderRadius", ZIndex = "zIndex" }
    for source, target in pairs(numeric) do
        local value = resolve(attrs[source], context)
        if value ~= nil then props[target] = layoutValue(value) end
    end
    if attrs.Margin ~= nil then props.margin = thickness(resolve(attrs.Margin, context)) end
    if attrs.Padding ~= nil then props.padding = thickness(resolve(attrs.Padding, context)) end
    if attrs.Background then props.backgroundColor = color(resolve(attrs.Background, context)) end
    if attrs.Color then props.fontColor = color(resolve(attrs.Color, context)) end
    if attrs.Variant then props.variant = enumValue("Variant", resolve(attrs.Variant, context)) end
    if attrs.Disabled then local value = enumValue("Disabled", resolve(attrs.Disabled, context)); props.disabled = value == true or value == "true" end
    if attrs.Edges ~= nil then
        local value = resolve(attrs.Edges, context)
        props.edges = ({ ["全部"] = "all", ["无"] = "none", ["水平"] = "horizontal", ["垂直"] = "vertical" })[value] or value
    end
    if attrs.Mode ~= nil then
        local value = resolve(attrs.Mode, context)
        props.mode = ({ ["内边距"] = "padding", ["外边距"] = "margin" })[value] or value
    end
    if attrs.NativeMenuInset ~= nil then
        local value = resolve(attrs.NativeMenuInset, context)
        props.nativeMenuInset = value == true or value == "true" or value == "是"
    end
    return props
end

local function hasAny(t) return t ~= nil and next(t) ~= nil end
local function splitProps(source, moveToWrapper)
    local direct, wrapped = {}, {}
    for key, value in pairs(source or {}) do if moveToWrapper[key] then wrapped[key] = value else direct[key] = value end end
    return direct, wrapped
end
local function applyWrapper(inside, wrapperProps)
    if not hasAny(wrapperProps) then return inside end
    wrapperProps.children = { inside }
    return UI.Panel(wrapperProps)
end
local WRAP_KEYS = { margin = true, padding = true, backgroundColor = true }

local function numberOrPercent(value, total)
    if value == nil or value == "自动" then return nil end
    local text = tostring(value)
    local percent = text:match("^(-?[%d%.]+)%%$")
    if percent then return total * (tonumber(percent) or 0) / 100 end
    return tonumber(text)
end

local function tracks(value)
    local result = {}
    for part in tostring(value or "填充"):gmatch("[^,]+") do
        local text = part:match("^%s*(.-)%s*$")
        if text == "自动" then result[#result + 1] = { kind = "auto", value = 0 }
        elseif text == "填充" then result[#result + 1] = { kind = "fill", value = 1 }
        else
            local fill = text:match("^(%d+%.?%d*)填充$")
            local percent = text:match("^(%d+%.?%d*)%%$")
            if fill then result[#result + 1] = { kind = "fill", value = tonumber(fill) or 1 }
            elseif percent then result[#result + 1] = { kind = "percent", value = (tonumber(percent) or 0) / 100 }
            else result[#result + 1] = { kind = "fixed", value = tonumber(text) or 0 } end
        end
    end
    if #result == 0 then result[1] = { kind = "fill", value = 1 } end
    return result
end

local function trackSizes(definitions, total, gap, entries, axis)
    local size = {}
    local occupied = math.max(0, (#definitions - 1) * gap)
    local weight = 0
    for index, definition in ipairs(definitions) do
        if definition.kind == "fixed" then size[index] = definition.value; occupied = occupied + size[index]
        elseif definition.kind == "percent" then size[index] = total * definition.value; occupied = occupied + size[index]
        elseif definition.kind == "auto" then size[index] = 0
        else size[index] = 0; weight = weight + definition.value end
    end
    -- Auto tracks derive their natural size from unspanned direct children.
    for _, entry in ipairs(entries) do
        local start = axis == "row" and entry.row or entry.column
        local span = axis == "row" and entry.rowSpan or entry.columnSpan
        local layout = entry.widget:GetLayout()
        local desired = axis == "row" and layout.h or layout.w
        if span == 1 and definitions[start] and definitions[start].kind == "auto" then size[start] = math.max(size[start], desired or 0) end
    end
    for index, definition in ipairs(definitions) do if definition.kind == "auto" then occupied = occupied + size[index] end end
    local remaining = math.max(0, total - occupied)
    if weight > 0 then for index, definition in ipairs(definitions) do if definition.kind == "fill" then size[index] = remaining * definition.value / weight end end end
    return size
end

local function positions(sizes, gap)
    local result, cursor = {}, 0
    for index, size in ipairs(sizes) do result[index] = cursor; cursor = cursor + size + gap end
    return result
end

local function spanSize(sizes, start, span, gap)
    local result = 0
    for index = start, math.min(#sizes, start + span - 1) do result = result + (sizes[index] or 0) end
    return result + math.max(0, span - 1) * gap
end

local function applyFrame(widget, x, y, width, height)
    widget.renderOffsetX_, widget.renderOffsetY_ = x, y
    widget.renderWidth_, widget.renderHeight_ = width, height
    if widget._luiFrameWidth_ ~= width or widget._luiFrameHeight_ ~= height then
        widget._luiFrameWidth_, widget._luiFrameHeight_ = width, height
        widget:SetStyle({ width = width, height = height })
    end
end

local function layoutPanel(props, entries, mode, attrs, context)
    props.children = {}
    local panel = UI.Panel(props)
    for _, entry in ipairs(entries) do panel:AddChild(entry.widget) end
    local baseRender = panel.Render
    function panel:Render(nvg)
        local rect = self:GetAbsoluteLayout()
        local left, top, right, bottom = thicknessParts(resolve(attrs.Padding, context))
        local contentX, contentY = rect.x + left, rect.y + top
        local contentW, contentH = math.max(0, rect.w - left - right), math.max(0, rect.h - top - bottom)
        if mode == "Canvas" then
            for _, entry in ipairs(entries) do
                local child = entry.widget; local layout = child:GetLayout()
                local childW, childH = layout.w, layout.h
                local x = numberOrPercent(resolve(entry.attrs["Canvas.Left"], context), contentW)
                local y = numberOrPercent(resolve(entry.attrs["Canvas.Top"], context), contentH)
                local rightOffset = numberOrPercent(resolve(entry.attrs["Canvas.Right"], context), contentW)
                local bottomOffset = numberOrPercent(resolve(entry.attrs["Canvas.Bottom"], context), contentH)
                -- XAML's paired edges stretch a child when no explicit size wins.
                if x ~= nil and rightOffset ~= nil and entry.attrs.Width == nil then childW = math.max(0, contentW - x - rightOffset) end
                if y ~= nil and bottomOffset ~= nil and entry.attrs.Height == nil then childH = math.max(0, contentH - y - bottomOffset) end
                if x == nil then x = rightOffset ~= nil and contentW - rightOffset - childW or 0 end
                if y == nil then y = bottomOffset ~= nil and contentH - bottomOffset - childH or 0 end
                applyFrame(child, contentX + x, contentY + y, childW, childH)
            end
        else
            local rowGap = numberOrPercent(resolve(attrs.RowSpacing, context), contentH) or 0
            local columnGap = numberOrPercent(resolve(attrs.ColumnSpacing, context), contentW) or 0
            local rowSizes = trackSizes(tracks(resolve(attrs.RowDefinitions, context)), contentH, rowGap, entries, "row")
            local columnSizes = trackSizes(tracks(resolve(attrs.ColumnDefinitions, context)), contentW, columnGap, entries, "column")
            local rowPositions, columnPositions = positions(rowSizes, rowGap), positions(columnSizes, columnGap)
            for _, entry in ipairs(entries) do
                local x = contentX + (columnPositions[entry.column] or 0)
                local y = contentY + (rowPositions[entry.row] or 0)
                local width = spanSize(columnSizes, entry.column, entry.columnSpan, columnGap)
                local height = spanSize(rowSizes, entry.row, entry.rowSpan, rowGap)
                applyFrame(entry.widget, x, y, width, height)
            end
        end
        baseRender(self, nvg)
    end
    return panel
end

-- A Viewbox is a design coordinate system, never a device/page resolution.
-- Its descendants keep authored pixels and receive one uniform transform after
-- SafeArea establishes the available logical viewport.
local function viewbox(children, attrs, context)
    local designWidth = tonumber(resolve(attrs.Width, context)) or 0
    local designHeight = tonumber(resolve(attrs.Height, context)) or 0
    if designWidth <= 0 or designHeight <= 0 then error("LUI <视图框> 的宽度和高度必须是正数 px。") end
    local outer = UI.Panel { width = "100%", height = "100%", children = {} }
    local inner = UI.Panel { width = designWidth, height = designHeight, children = children, transformOrigin = "top-left" }
    outer:AddChild(inner)
    local baseRender = outer.Render
    function outer:Render(nvg)
        local rect = self:GetAbsoluteLayout()
        local scale = math.min(rect.w / designWidth, rect.h / designHeight)
        local drawWidth, drawHeight = designWidth * scale, designHeight * scale
        applyFrame(inner, rect.x + (rect.w - drawWidth) * 0.5, rect.y + (rect.h - drawHeight) * 0.5, designWidth, designHeight)
        inner.props.scale, inner.props.transformOrigin = scale, "top-left"
        self.luiLayoutProbe_ = { kind = "Viewbox", scale = scale, x = inner.renderOffsetX_, y = inner.renderOffsetY_, width = designWidth, height = designHeight, contentWidth = rect.w, contentHeight = rect.h }
        baseRender(self, nvg)
    end
    return outer
end

local function propertyText(node)
    local values = {}
    for _, child in ipairs(node.children or {}) do
        if child.kind == "Text" and child.text then values[#values + 1] = child.text end
    end
    return table.concat(values):gsub("^%s+", ""):gsub("%s+$", "")
end

-- <Button.Text>开始</Button.Text> 等属性元素在进入控件映射前折叠成属性，
-- 因此与 Text="开始" 走同一条安全绑定路径。
local function resolvedNodeParts(node)
    local attrs, children = {}, {}
    for name, value in pairs(node.attrs or {}) do attrs[name] = value end
    for _, child in ipairs(node.children or {}) do
        local owner, property = child.tag and child.tag:match("^([%w_:%-]+)%.([%w_%-]+)$") or nil, nil
        if owner and owner == node.tag then
            local _, propertyName = child.tag:match("^([%w_:%-]+)%.([%w_%-]+)$")
            attrs[propertyName] = propertyText(child)
        else
            children[#children + 1] = child
        end
    end
    return attrs, children
end

local function appendChildren(widget, children)
    for _, child in ipairs(children or {}) do if child then widget:AddChild(child) end end
    return widget
end

function Runtime.New()
    local self = setmetatable({}, Runtime)
    self:Init()
    return self
end

function Runtime:Init()
    self.config_, self.configError_ = readProjectConfig()
    self.documents_ = {}
    self.code_ = {}
    self.isV2_ = tonumber(self.config_.schemaVersion or 1) >= 2
end

function Runtime:LoadDocument(path)
    if self.documents_[path] then return self.documents_[path], nil end
    local document, err = Parser.Load(path)
    if not document then return nil, err end
    self.documents_[path] = document
    return document, nil
end

function Runtime:LoadCode(path)
    if self.code_[path] then return self.code_[path], nil end
    local code, err = loadLuaModule(path, self.config_.sourceRoots)
    if not code then return nil, err end
    self.code_[path] = code
    return code, nil
end

function Runtime:LoadLegacyComponent(name)
    local descriptor = (self.config_.documents or {})[name]
    if not descriptor then return nil, nil end
    local path = type(descriptor) == "table" and descriptor.markup or descriptor
    if type(path) ~= "string" then return nil, "LUI 组件路径无效：" .. tostring(name) end
    return self:LoadDocument(path)
end

function Runtime:ImportsFor(document)
    local imports = {}
    for attribute, directory in pairs(document.attrs or {}) do
        local alias = attribute:match("^目录:(.+)$")
        if alias then
            if not isDirectoryPath(directory) then return nil, "LUI 目录导入无效：" .. tostring(directory) end
            if imports[alias] then return nil, "LUI 目录别名重复：" .. tostring(alias) end
            imports[alias] = directory
        end
    end
    return imports, nil
end

function Runtime:LoadDirectoryComponent(directory, name)
    if not isDirectoryPath(directory) then return nil, "LUI 组件目录越界：" .. tostring(directory) end
    local directories = self.config_.componentDirectories
    if type(directories) ~= "table" then return nil, "LUI v3 配置缺少 componentDirectories。" end
    local registered = directories[directory]
    if type(registered) ~= "table" then return nil, "LUI 未登记导入目录：" .. tostring(directory) end
    local descriptor = registered[name]
    if not descriptor then return nil, "LUI 目录 " .. directory .. " 未登记组件：" .. tostring(name) end
    local path = type(descriptor) == "table" and descriptor.markup or descriptor
    if type(path) ~= "string" or not inAllowedRoot(path, self.config_.sourceRoots) then return nil, "LUI 组件路径不在白名单内：" .. tostring(path) end
    return self:LoadDocument(path)
end

function Runtime:HasRegisteredComponentName(name)
    for _, directory in pairs(self.config_.componentDirectories or {}) do
        if type(directory) == "table" and directory[name] then return true end
    end
    return false
end

function Runtime:BuildChildren(nodes, context)
    local built = {}
    for _, child in ipairs(nodes or {}) do
        local widget = self:BuildNode(child, context)
        if widget then
            if type(widget) == "table" and widget.__luiList then
                for _, entry in ipairs(widget.items) do built[#built + 1] = entry end
            else built[#built + 1] = widget end
        end
    end
    return built
end

-- Grid/Canvas own their children's placement. This keeps the layout declaration in
-- .lui while preserving the regular builder for controls and imported components.
function Runtime:BuildLayoutEntries(nodes, context)
    local entries = {}
    local function appendNode(node, activeContext)
        if not node or node.kind == "Text" then return end
        local attrs, visualChildren = resolvedNodeParts(node)
        if node.tag == "lui:If" then
            local test = resolve(attrs.Test, activeContext)
            if test ~= nil and test ~= false then
                for _, child in ipairs(visualChildren) do appendNode(child, activeContext) end
            end
            return
        end
        if node.tag == "lui:For" then
            local path = bindingPath(attrs.In) or ""
            local values = resolvePath(activeContext, path) or {}
            local name = attrs.Each or "item"
            for index, value in ipairs(values) do
                local nextContext = setmetatable({ [name] = value, item = value, index = index }, { __index = activeContext })
                for _, child in ipairs(visualChildren) do appendNode(child, nextContext) end
            end
            return
        end
        if node.tag == "lui:Slot" then
            for _, child in ipairs((activeContext.slots or {})[attrs.Name] or {}) do appendNode(child, activeContext) end
            return
        end
        local built = self:BuildNode(node, activeContext)
        local function add(widget)
            if not widget then return end
            if type(widget) == "table" and widget.__luiList then
                for _, item in ipairs(widget.items or {}) do add(item) end
                return
            end
            entries[#entries + 1] = {
                widget = widget,
                attrs = attrs,
                row = math.max(1, (tonumber(resolve(attrs["Grid.Row"], activeContext)) or 0) + 1),
                column = math.max(1, (tonumber(resolve(attrs["Grid.Column"], activeContext)) or 0) + 1),
                rowSpan = math.max(1, tonumber(resolve(attrs["Grid.RowSpan"], activeContext)) or 1),
                columnSpan = math.max(1, tonumber(resolve(attrs["Grid.ColumnSpan"], activeContext)) or 1),
            }
        end
        add(built)
    end
    for _, child in ipairs(nodes or {}) do appendNode(child, context) end
    return entries
end

function Runtime:BuildNode(node, context)
    if node.kind == "Text" then
        if not node.text or not node.text:match("%S") then return nil end
        return UI.Label { text = node.text, fontSize = 14 }
    end
    local tag, attrs, visualChildren = node.tag, resolvedNodeParts(node)
    if tag == "lui:If" then
        local test = resolve(attrs.Test, context)
        return test ~= nil and test ~= false and { __luiList = true, items = self:BuildChildren(visualChildren, context) } or nil
    end
    if tag == "lui:For" then
        local path = bindingPath(attrs.In) or ""
        local values = resolvePath(context, path) or {}
        local name = attrs.Each or "item"
        local items = {}
        for index, value in ipairs(values) do
            local nextContext = setmetatable({ [name] = value, item = value, index = index }, { __index = context })
            for _, child in ipairs(self:BuildChildren(visualChildren, nextContext)) do items[#items + 1] = child end
        end
        return { __luiList = true, items = items }
    end
    if tag == "lui:Preview" or tag == "lui:Action" or tag == "lui:Resource" then return nil end
    if tag == "lui:Slot" then
        return { __luiList = true, items = self:BuildChildren((context.slots or {})[attrs.Name] or {}, context) }
    end
    if tag == "lui:Page" or tag == "lui:Component" then
        local items = self:BuildChildren(visualChildren, context)
        if #items == 1 then return items[1] end
        return UI.Panel { width = "100%", height = "100%", children = items }
    end
    local component, componentErr, componentKey = nil, nil, nil
    local alias, name = tag:match("^([^:]+):(.+)$")
    if alias and alias ~= "lui" then
        local directory = context.imports and context.imports[alias]
        if not directory then error("LUI 组件 " .. tostring(tag) .. " 未在当前根节点导入目录别名 " .. tostring(alias) .. "。") end
        component, componentErr = self:LoadDirectoryComponent(directory, name)
        componentKey = directory .. ":" .. name
    elseif self.isV2_ and self:HasRegisteredComponentName(tag) then
        error("LUI v3 组件必须使用目录别名：<目录别名:" .. tostring(tag) .. ">。")
    elseif not self.isV2_ then
        component, componentErr = self:LoadLegacyComponent(tag)
        componentKey = tag
    end
    if componentErr then error(componentErr) end
    if component then
        local componentStack = context.componentStack or {}
        if componentStack[componentKey] then error("LUI 组件循环依赖：" .. componentKey) end
        componentStack[componentKey] = true
        local componentImports, importsErr = self:ImportsFor(component)
        if not componentImports then componentStack[componentKey] = nil; error(importsErr) end
        local properties = {}
        for name, value in pairs(attrs) do properties[name] = resolve(value, context) end
        local componentContext = setmetatable({
            props = properties, actions = context.actions, slots = { Content = visualChildren }, refs = context.refs,
            imports = componentImports, componentStack = componentStack,
        }, { __index = context })
        local rendered = self:BuildNode(component, componentContext)
        componentStack[componentKey] = nil
        local ref = attrs["x:Ref"]
        if ref and context.refs then
            if context.refs[ref] then error("LUI x:Ref 重复：" .. ref) end
            context.refs[ref] = rendered
        end
        return rendered
    end
    local props = propsFor(attrs, context)
    local text = resolve(attrs.Text, context)
    local widget = nil
    if tag == "Grid" or tag == "Canvas" then
        widget = layoutPanel(props, self:BuildLayoutEntries(visualChildren, context), tag, attrs, context)
    elseif tag == "Viewbox" then
        widget = viewbox(self:BuildChildren(visualChildren, context), attrs, context)
    else
        local children = self:BuildChildren(visualChildren, context)
        if tag == "Text" then
        local innerProps, wrapperProps = splitProps(props, WRAP_KEYS)
        innerProps.text = tostring(text or "")
        widget = applyWrapper(UI.Label(innerProps), wrapperProps)
    elseif tag == "Button" then
        props.text = tostring(text or "按钮")
        local action = actionName(resolve(attrs.Click, context))
        if action then props.onClick = function(_, event)
            local callback = context.actions and context.actions[action]
            if callback then callback(context.item, event) end
        end end
        widget = UI.Button(props)
    elseif tag == "Progress" then
        props.value = tonumber(resolve(attrs.Value, context)) or 0
        props.max = math.max(1, tonumber(resolve(attrs.Max, context)) or 1)
        widget = UI.ProgressBar(props)
    elseif tag == "Toggle" then
        local innerProps, wrapperProps = splitProps(props, WRAP_KEYS)
        innerProps.value = resolve(attrs.Value, context) == true
        local action = actionName(resolve(attrs.Change, context))
        if action then innerProps.onChange = function(_, value)
            local callback = context.actions and context.actions[action]
            if callback then callback(value) end
        end end
        widget = applyWrapper(UI.Toggle(innerProps), wrapperProps)
    elseif tag == "Slider" then
        props.value = tonumber(resolve(attrs.Value, context)) or 0
        props.min, props.max = tonumber(attrs.Min) or 0, tonumber(attrs.Max) or 100
        local action = actionName(resolve(attrs.Change, context))
        if action then props.onChange = function(_, value)
            local callback = context.actions and context.actions[action]
            if callback then callback(value) end
        end end
        widget = UI.Slider(props)
    elseif tag == "Row" then
        props.flexDirection = "row"; props.children = children; widget = UI.Panel(props)
    elseif tag == "Scroll" then
        props.scrollY, props.showScrollbar = true, false; props.children = children; widget = UI.ScrollView(props)
    elseif tag == "SafeArea" then
        local innerProps, wrapperProps = splitProps(props, WRAP_KEYS)
        innerProps.children = children; widget = applyWrapper(UI.SafeAreaView(innerProps), wrapperProps)
    elseif tag == "Modal" then
        local innerProps, wrapperProps = splitProps(props, WRAP_KEYS)
        innerProps.title = resolve(attrs.Title, context) or "设置"
        innerProps.closeOnOverlay = enumValue("CloseOnOverlay", resolve(attrs.CloseOnOverlay, context)) ~= "false"
        innerProps.showCloseButton = enumValue("ShowCloseButton", resolve(attrs.ShowCloseButton, context)) ~= "false"
        local closeAction = actionName(resolve(attrs.Close, context))
        if closeAction then innerProps.onClose = function()
            local callback = context.actions and context.actions[closeAction]
            if callback then callback() end
        end end
        innerProps.children = children; widget = applyWrapper(UI.Modal(innerProps), wrapperProps)
    elseif tag == "Card" then
        widget = Components.Card(children, props)
    elseif tag == "Section" then
        widget = Components.Section(tostring(text or attrs.Title or ""), children, resolve(attrs.Subtitle, context))
    elseif tag == "Notice" then
        widget = Components.Notice(text, resolve(attrs.Error, context) == true)
    elseif tag == "Screen" then
        widget = Components.Screen(nil, children, props)
    elseif tag == "FixedScreen" then
        widget = Components.FixedScreen(nil, UI.Panel { width = "100%", height = "100%", children = children }, props)
        end
        if not widget then
        props.flexDirection = props.flexDirection or "column"; props.children = children
        widget = UI.Panel(props)
        end
    end
    local ref = attrs["x:Ref"]
    if not ref and not self.isV2_ then ref = attrs["x:Name"] end
    widget.luiName_ = attrs["x:Name"] or attrs["x:DisplayName"] or tag
    if ref and context.refs then
        if context.refs[ref] then error("LUI x:Ref 重复：" .. ref) end
        context.refs[ref] = widget
    end
    return widget
end

-- Stable, data-only layout probe used to compare Studio and device layout by
-- node name. Consumers may serialize this table to their existing diagnostics.
function Runtime:LayoutProbe(root)
    local result = {}
    local function visit(widget)
        if not widget then return end
        local rect = widget:GetAbsoluteLayout()
        local probe = widget.luiLayoutProbe_ or {}
        result[#result + 1] = {
            name = widget.luiName_ or "anonymous", x = rect.x, y = rect.y, width = rect.w, height = rect.h,
            contentWidth = probe.contentWidth or rect.w, contentHeight = probe.contentHeight or rect.h, scale = probe.scale or 1,
        }
        for _, child in ipairs(widget:GetChildren() or {}) do visit(child) end
    end
    visit(root)
    return result
end

function Runtime:Render(markupPath, codePath, presentation)
    local document, documentErr = self:LoadDocument(markupPath)
    if not document then return nil, documentErr end
    local code, codeErr = self:LoadCode(codePath)
    if not code then return nil, codeErr end
    local result = code.Build and code.Build(presentation) or { view = {}, actions = {} }
    if type(result) ~= "table" then return nil, "LUI Build 必须返回 table。" end
    local imports, importsErr = self:ImportsFor(document)
    if not imports then return nil, importsErr end
    local context = result.view or {}; context.actions = result.actions or {}; context.refs = {}; context.imports = imports; context.componentStack = {}
    local root = self:BuildNode(document, context)
    if result.AfterMount then result.AfterMount(root, context) end
    return root, nil
end

return Runtime
