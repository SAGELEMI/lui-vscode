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
    return type(value) == "string" and value:match("^{Binding%s+([%w_%.%-]+)}$") or nil
end

local function actionName(value)
    return type(value) == "string" and value:match("^{Action%s+([A-Za-z][A-Za-z0-9_.%-]*)}$") or nil
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

local function propsFor(attrs, context)
    local props = {}
    local numeric = { Width = "width", Height = "height", MinHeight = "minHeight", MaxWidth = "maxWidth", Gap = "gap", Padding = "padding", FontSize = "fontSize", FlexGrow = "flexGrow", FlexBasis = "flexBasis", ZIndex = "zIndex" }
    for source, target in pairs(numeric) do
        local value = resolve(attrs[source], context)
        if value ~= nil then props[target] = tonumber(value) or value end
    end
    if attrs.Background then props.backgroundColor = color(resolve(attrs.Background, context)) end
    if attrs.Color then props.fontColor = color(resolve(attrs.Color, context)) end
    if attrs.Variant then props.variant = resolve(attrs.Variant, context) end
    if attrs.Disabled then props.disabled = resolve(attrs.Disabled, context) == true or attrs.Disabled == "true" end
    if attrs.Align then props.alignItems = resolve(attrs.Align, context) end
    if attrs.Justify then props.justifyContent = resolve(attrs.Justify, context) end
    return props
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
        local alias = attribute:match("^xmlns:(.+)$")
        if alias == "lui" then
            if directory ~= "urn:lui" then return nil, "LUI 系统命名空间必须为 xmlns:lui=\"urn:lui\"。" end
        elseif alias then
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
    if type(directories) ~= "table" then return nil, "LUI v2 配置缺少 componentDirectories。" end
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
        error("LUI v2 组件必须使用目录别名：<目录别名:" .. tostring(tag) .. ">。")
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
    local children = self:BuildChildren(visualChildren, context)
    local text = resolve(attrs.Text, context)
    local widget = nil
    if tag == "Text" then
        props.text = tostring(text or "")
        widget = UI.Label(props)
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
        props.value = resolve(attrs.Value, context) == true
        local action = actionName(resolve(attrs.Change, context))
        if action then props.onChange = function(_, value)
            local callback = context.actions and context.actions[action]
            if callback then callback(value) end
        end end
        widget = UI.Toggle(props)
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
        props.children = children; widget = UI.SafeAreaView(props)
    elseif tag == "Modal" then
        props.title = resolve(attrs.Title, context) or "设置"
        props.closeOnOverlay = attrs.CloseOnOverlay ~= "false"
        props.showCloseButton = attrs.ShowCloseButton ~= "false"
        local closeAction = actionName(resolve(attrs.Close, context))
        if closeAction then props.onClose = function()
            local callback = context.actions and context.actions[closeAction]
            if callback then callback() end
        end end
        props.children = children; widget = UI.Modal(props)
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
    local ref = attrs["x:Ref"]
    if not ref and not self.isV2_ then ref = attrs["x:Name"] end
    if ref and context.refs then
        if context.refs[ref] then error("LUI x:Ref 重复：" .. ref) end
        context.refs[ref] = widget
    end
    return widget
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
