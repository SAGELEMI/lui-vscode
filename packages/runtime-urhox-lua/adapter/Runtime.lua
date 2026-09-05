local UI = require("urhox-libs/UI")
local Parser = require("LUI.Parser")
local Components = require("Presentation.Components")
---@class LuiControlDescriptor
---@field ui string
---@field events string[]
---@field bindable string?
---@type table<string, LuiControlDescriptor>
local Controls = require("LUI.Controls")
local NativeControls = require("LUI.NativeControls")
---@param tag string
---@return LuiControlDescriptor?
local function controlDescriptor(tag)
    return Controls[tag]
end
local Alignment = require("LUI.Alignment")
local Paths = require("LUI.Paths")
local Properties = require("LUI.Properties")
local LiveProps = require("LUI.LiveProps")
---@class LuiScrollbars
---@field Gutters fun(view: any): number, number
---@field Attach fun(widget: any, horizontal: string, vertical: string, tint: number[]?)
---@type LuiScrollbars
local Scrollbars = require("LUI.Scrollbars")
local Measure = require("LUI.Measure")
local Contract = require("LUI.Contract")
local Brush = require("LUI.Brush")
---@type LuiTypography
local Typography = require("LUI.Typography")
local PageFrame = require("LUI.PageFrame")
local Project = require("LUI.Project")

-- LUI.Runtime 将纯声明式节点映射到 UrhoX UI。所有业务代码必须留在同名 .lui.lua。
---@class LuiRuntime
---@field config_ table
---@field configError_ string?
local Runtime = {}
local Overlays = require("LUI.Overlays")
Runtime.__index = Runtime
local Defaults = Contract.defaults
local Fidelity = Contract["renderFidelity"] or {
    colorSpace = "srgb", alphaMode = "straight", gradientInterpolation = "premultiplied-srgb",
    borderAlign = "inside", shadowSource = "contract-only", defaultBoxShadow = false,
    typography = { fontSynthesis = "none", studioTextRaster = "chromium-reference", ownedTextRaster = "nanovg", nativeControlRaster = "native-raster", inkCompensation = {} },
}

local function nativeFontSize(value)
    local theme = UI.Theme
    local ratio = type(theme) == "table" and theme.FontSize and theme.FontSize(1) or 1
    return (tonumber(value) or Defaults.fontSize) / ratio
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

local function bindingSpec(value)
    if type(value) ~= "string" then return nil end
    local body = value:match("^{绑定%s+(.+)}$") or value:match("^{Binding%s+(.+)}$")
    if not body then return nil end
    local parts, current, quote = {}, "", nil
    for index = 1, #body do
        local char = body:sub(index, index)
        if (char == "'" or char == "\"") and (not quote or quote == char) then
            if quote then quote = nil else quote = char end
        end
        if char == "," and not quote then table.insert(parts, current); current = "" else current = current .. char end
    end
    table.insert(parts, current)
    local path = (parts[1] or ""):match("^%s*(.-)%s*$")
    if not Paths.Keys(path) then return nil end
    local spec = { path = path, mode = "单向", updateSourceTrigger = "默认" }
    for index = 2, #parts do
        local key, option = parts[index]:match("^%s*([^=]+)%s*=%s*(.-)%s*$")
        if key and option then
            option = option:gsub("^['\"]", ""):gsub("['\"]$", "")
            if key == "模式" then spec.mode = option elseif key == "更新源触发" then spec.updateSourceTrigger = option elseif key == "字符串格式" then spec.stringFormat = option elseif key == "预览内容" then spec.previewContent = option end
        end
    end
    return spec
end

local function bindingPath(value)
    local spec = bindingSpec(value)
    return spec and spec.path or nil
end

local function actionName(value)
    if type(value) ~= "string" then return nil end
    -- Component loops may bind an action key from a view-model item.  It is
    -- still resolved only against context.actions; no Lua source is evaluated.
    return value:match("^{动作%s+([A-Za-z][A-Za-z0-9_.%-]*)}$")
        or value:match("^{Action%s+([A-Za-z][A-Za-z0-9_.%-]*)}$")
        or value:match("^([A-Za-z][A-Za-z0-9_.%-]*)$")
end

local function commandSpec(value)
    if type(value) ~= "string" then return nil end
    local body = value:match("^{命令%s+(.+)}$")
    if not body then return nil end
    local name = body:match("^([^,%s]+)")
    local allowed = { ["设值"] = true, ["可见性"] = true, ["页签"] = true, ["导航"] = true, ["关闭"] = true }
    if not allowed[name] then return { invalid = true, name = name } end
    local args = {}
    for key, quote, raw in body:gmatch(",%s*([^=,%s]+)%s*=%s*(['\"])(.-)%2") do args[key] = raw end
    return { name = name, args = args }
end

local function resolvePath(context, path)
    return Paths.Get(context, path)
end

local function resolve(value, context)
    local spec = bindingSpec(value)
    if spec then
        local resolved = resolvePath(context, spec.path)
        if spec.stringFormat and resolved ~= nil then return spec.stringFormat:gsub("{0}", tostring(resolved)) end
        return resolved
    end
    return value
end

local function setPath(context, path, value)
    -- Old designs addressed the view-model at the context root.  Keep that
    -- source compatible while canonical LUI 0.7 writes explicit view.* paths.
    local rawPath = tostring(path or "")
    if not rawPath:find("%.") and not rawPath:find("[", 1, true) and type(context.view) == "table" and rawget(context, rawPath) == nil then
        context.view[rawPath] = value
        return true
    end
    return Paths.Set(context, rawPath, value)
end

local function color(value)
    return Brush.Color(value)
end

local function applyBrush(props, target, raw, attributeName)
    if raw == nil then return nil end
    local brush = Brush.Require(raw, attributeName)
    if target == "background" then Brush.ApplyBackground(props, brush)
    elseif target == "hover" then
        props.hoverBackgroundColor,props.hoverBackgroundGradient=nil,nil
        if brush.kind == "solid" then props.hoverBackgroundColor = brush.color else props.hoverBackgroundGradient = { type = "linear", direction = brush.angle, from = brush.from, to = brush.to, fromOffset = brush.fromOffset, toOffset = brush.toOffset } end
    elseif target == "pressed" then
        props.pressedBackgroundColor,props.pressedBackgroundGradient=nil,nil
        if brush.kind == "solid" then props.pressedBackgroundColor = brush.color else props.pressedBackgroundGradient = { type = "linear", direction = brush.angle, from = brush.from, to = brush.to, fromOffset = brush.fromOffset, toOffset = brush.toOffset } end
    end
    return brush
end

local function enumValue(name, value)
    local chinese = {
        Variant = { ["高亮"] = "primary", ["常规"] = "secondary", ["主要"] = "primary", ["次要"] = "secondary" },
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

local function isCollapsed(value)
    return value == false or value == "false" or value == "否" or value == "折叠"
end

-- LUI Thickness uses XAML order: left,top,right,bottom. UrhoX receives top,right,bottom,left.
local function thickness(value)
    if type(value) == "table" then return value end
    ---@type number[]
    local parts = {}
    for part in tostring(value or "0"):gmatch("[^,]+") do
        local numberValue = tonumber(part:match("^%s*(.-)%s*$")) or 0
        table.insert(parts, numberValue)
    end
    if #parts == 0 then parts[1] = 0 end
    if #parts == 1 then parts[2], parts[3], parts[4] = parts[1], parts[1], parts[1] end
    return { parts[2] or 0, parts[3] or 0, parts[4] or 0, parts[1] or 0 }
end

local function thicknessParts(value)
    local values = thickness(value)
    return values[4] or 0, values[1] or 0, values[2] or 0, values[3] or 0
end

-- Compact LUI transform grammar: 缩放(1.1);旋转(15);平移(8,0);倾斜(0,0).
-- UrhoX UI owns rendering and hit testing for scale/rotate/translate.  Skew is
-- retained in the descriptor for Studio parity; current public UI.Widget has no
-- skew primitive, so it intentionally remains a layout-only bounding-box input.
local function transformSpec(value)
    local result = { scale = 1, rotate = 0, translateX = 0, translateY = 0, skewX = 0, skewY = 0 }
    for kind, raw in tostring(value or ""):gmatch("([^%(;]+)%s*%(([^%)]*)%)") do
        local values = {}
        for part in raw:gmatch("[^,]+") do values[#values + 1] = tonumber(part:match("^%s*(.-)%s*$")) or 0 end
        kind = kind:match("^%s*(.-)%s*$")
        if kind == "缩放" then result.scale = values[1] == 0 and 1 or values[1]
        elseif kind == "旋转" then result.rotate = values[1] or 0
        elseif kind == "平移" then result.translateX, result.translateY = values[1] or 0, values[2] or 0
        elseif kind == "倾斜" then result.skewX, result.skewY = values[1] or 0, values[2] or 0 end
    end
    return result
end

local function transformOrigin(value)
    local x, y = tostring(value or "0,0"):match("^%s*(-?[%d%.]+)%s*,%s*(-?[%d%.]+)%s*$")
    if x and y then return { x = tonumber(x) or 0, y = tonumber(y) or 0 } end
    return "top-left"
end

local function transformedBounds(width, height, transform)
    local scale = math.abs(transform.scale or 1)
    local radians = math.rad(transform.rotate or 0)
    local cosine, sine = math.abs(math.cos(radians)), math.abs(math.sin(radians))
    return (width * scale * cosine) + (height * scale * sine), (width * scale * sine) + (height * scale * cosine)
end

local function propsFor(attrs, context)
    -- LUI owns visual defaults. Do not allow the host theme to reintroduce
    -- centered borders or implicit elevation after markup has been resolved.
    local props = { borderAlign = Fidelity.borderAlign, boxShadow = Fidelity.defaultBoxShadow }
    local numeric = { Width = "width", Height = "height", MinWidth = "minWidth", MinHeight = "minHeight", MaxWidth = "maxWidth", MaxHeight = "maxHeight", FontSize = "fontSize", Opacity = "opacity", BorderRadius = "borderRadius", ZIndex = "zIndex" }
    for source, target in pairs(numeric) do
        local value = resolve(attrs[source], context)
        if value ~= nil then props[target] = layoutValue(value) end
    end
    -- LUI 字号是 CSS/逻辑像素；UI.Label/Button 接收 pt。只有显式字号在此转换，
    -- 每种控件的缺省值由共享契约提供，避免主题重新注入另一套数值。
    if props.fontSize ~= nil then props.fontSize = nativeFontSize(props.fontSize) end
    if attrs.Margin ~= nil then props.margin = thickness(resolve(attrs.Margin, context)) end
    if attrs.Padding ~= nil then
        props.padding = thickness(resolve(attrs.Padding, context))
        props.paddingLeft, props.paddingTop, props.paddingRight, props.paddingBottom = thicknessParts(resolve(attrs.Padding, context))
    end
    if attrs.Background then applyBrush(props, "background", resolve(attrs.Background, context), "背景") end
    if attrs.HoverBackground then applyBrush(props, "hover", resolve(attrs.HoverBackground, context), "悬停背景") end
    if attrs.PressedBackground then applyBrush(props, "pressed", resolve(attrs.PressedBackground, context), "按下背景") end
    if attrs.BorderWidth then props.borderWidth = tonumber(resolve(attrs.BorderWidth, context)) or 0 end
    if attrs.BorderColor then props.borderColor = color(resolve(attrs.BorderColor, context)) end
    if attrs.Color then props.fontColor = color(resolve(attrs.Color, context)) end
    if attrs.PlaceholderColor then props.placeholderColor = color(resolve(attrs.PlaceholderColor, context)) end
    if attrs.CursorColor then props.cursorColor = color(resolve(attrs.CursorColor, context)) end
    for source, target in pairs({FontFamily="fontFamily",FontWeight="fontWeight",FontStyle="fontStyle"}) do
        local value = resolve(attrs[source], context)
        if value ~= nil then props[target] = tostring(value) end
    end
    props.textStrokeColor = resolve(attrs.TextStrokeColor, context)
    props.textStrokeWidth = resolve(attrs.TextStrokeWidth, context)
    props.luiTrackBrush = resolve(attrs.TrackBrush, context) or resolve(attrs.Background, context)
    props.luiFillBrush = resolve(attrs.FillBrush, context)
    props.luiProgressDirection = resolve(attrs.ProgressDirection, context)
    if attrs.LineHeight then props.lineHeight = tonumber(resolve(attrs.LineHeight, context)) end
    if attrs.LetterSpacing then props.letterSpacing = tonumber(resolve(attrs.LetterSpacing, context)) end
    if attrs.TextWrapping then props.whiteSpace = resolve(attrs.TextWrapping, context) == "换行" and "normal" or "nowrap" end
    if attrs.TextTrimming then props.maxLines = resolve(attrs.TextTrimming, context) == "尾部省略" and 1 or nil end
    if attrs.TextHorizontalAlignment then props.textAlign = ({ ["左"] = "left", ["居中"] = "center", ["右"] = "right" })[resolve(attrs.TextHorizontalAlignment, context)] end
    if attrs.TextVerticalAlignment then props.verticalAlign = ({ ["上"] = "top", ["居中"] = "middle", ["下"] = "bottom" })[resolve(attrs.TextVerticalAlignment, context)] end
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
    local direct = {
        Text = "text", Title = "title", Subtitle = "subtitle", Value = "value", Min = "min", Max = "max", Step = "step", Placeholder = "placeholder",
        Items = "items", Data = "data", Options = "options", Icon = "icon", Image = "image", Source = "source", Orientation = "orientation", Columns = "columns", Rows = "rows", Gap = "gap", Type = "type",
    }
    local numericValues={Min=true,Max=true,Step=true,Columns=true,Rows=true,Gap=true}
    for source, target in pairs(direct) do
        local value = resolve(attrs[source], context)
        if value ~= nil then props[target] = numericValues[source] and (tonumber(value) or value) or value end
    end
    if attrs.Visible ~= nil then
        local value = resolve(attrs.Visible, context)
        props.visible = value == true or value == "是" or value == "true"
    end
    if attrs.Visibility ~= nil then
        local value = resolve(attrs.Visibility, context)
        -- A bound Visibility with an unresolved/false source must stay in the
        -- widget tree so a later binding notification can reveal it.  Only a
        -- literal collapsed node is eligible for construction-time pruning.
        props.visible = value ~= nil and not isCollapsed(value)
        if value == "隐藏" then props.visibility = "hidden" end
    end
    if attrs.ClipToBounds ~= nil then props.overflow = resolve(attrs.ClipToBounds, context) == "是" and "hidden" or "visible" end
    local render = transformSpec(resolve(attrs.RenderTransform, context))
    if attrs.RenderTransform ~= nil then
        props.scale, props.rotate = render.scale, render.rotate
        props.translateX, props.translateY = render.translateX, render.translateY
        props.transformOrigin = transformOrigin(resolve(attrs.RenderTransformOrigin, context))
    end
    -- LayoutTransform is visually applied too, but arrangement below uses its
    -- transformed bounds. WPF ignores TranslateTransform in LayoutTransform.
    if attrs.LayoutTransform ~= nil then
        local layout = transformSpec(resolve(attrs.LayoutTransform, context))
        props.scale, props.rotate = layout.scale, layout.rotate
        props.transformOrigin = transformOrigin(resolve(attrs.RenderTransformOrigin, context))
    end
    return props
end

local EVENT_CALLBACKS = { Click = "onClick", Change = "onChange", Submit = "onSubmit", Select = "onSelect", Open = "onOpen", Close = "onClose", Focus = "onFocus", Blur = "onBlur", Complete = "onComplete", DragStart = "onDragStart", DragEnd = "onDragEnd", DragCancel = "onDragCancel" }
local function invokeAction(context, key, ...)
    local callback = context.actions and context.actions[key]
    if callback then return callback(...) end
end
local function invokeCommand(context, spec)
    if not spec or spec.invalid then return false end
    local args = spec.args or {}
    if spec.name == "设值" or spec.name == "可见性" then
        local path, value = args["路径"], args["值"]
        if type(path) ~= "string" or not path:match("^view%.[A-Za-z][A-Za-z0-9_.-]*$") then return false end
        if not setPath(context, path, value) then return false end
        if context.bindings then context.bindings:Notify(path) end
        if context.presentation and context.presentation.Render then context.presentation:Render() end
        return true
    elseif spec.name == "页签" then
        if context.presentation and context.presentation.SetComponentTab and args["键"] and args["值"] then
            context.presentation:SetComponentTab(args["键"], args["值"])
            if context.presentation.Render then context.presentation:Render() end
            return true
        end
    elseif spec.name == "导航" then
        if context.presentation and context.presentation.Navigate and args["目标"] then context.presentation:Navigate(args["目标"]); return true end
    elseif spec.name == "关闭" then
        local widget = args["目标"] and context.refs and context.refs[args["目标"]]
        if widget and widget.Close then widget:Close(); return true end
    end
    return false
end
local function wireControlEvents(props, attrs, context, descriptor)
    for _, event in ipairs(descriptor.events or {}) do
        local eventValue = resolve(attrs[event], context)
        local action, command = actionName(eventValue), commandSpec(eventValue)
        local nativeCallback, hasWidget = NativeControls.EventCallback(descriptor.ui, event)
        local callbackName = nativeCallback or EVENT_CALLBACKS[event]
        ---@type function?
        local callback
        if type(eventValue) == "function" then
            callback = function(...)
                if hasWidget then return eventValue(select(2, ...)) end
                return eventValue(...)
            end
        elseif action then
            callback = function(...)
                if hasWidget then return invokeAction(context, action, select(2, ...)) end
                return invokeAction(context, action, ...)
            end
        elseif command then
            callback = function() return invokeCommand(context, command) end
        end
        if callback then
            local previous = props[callbackName]
            props[callbackName] = previous and function(...) previous(...); return callback(...) end or callback
        end
    end
    local binding = descriptor.bindable and bindingSpec(attrs[descriptor.bindable]) or nil
    if binding and binding.mode ~= "单向" and binding.mode ~= "单次" then
        local nativeCallback, hasWidget = NativeControls.EventCallback(descriptor.ui, "Change")
        local callbackName = nativeCallback or "onChange"
        local previous = props[callbackName]
        props[callbackName] = function(...)
            local value = select(hasWidget and 2 or 1, ...)
            if previous then previous(...) end
            if binding.updateSourceTrigger ~= "显式" then
                setPath(context, binding.path, value)
                if context.bindings and context.bindings.Notify then context.bindings:Notify(binding.path) end
            elseif context.bindings then context.bindings.pending[binding.path] = value end
        end
    end
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
    local wrapper=UI.Panel(wrapperProps)
    wrapper.luiNativeWidget_=inside
    return wrapper
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
        elseif text == "填充" or text == "*" then result[#result + 1] = { kind = "fill", value = 1 }
        else
            local fill = text:match("^(%d+%.?%d*)填充$") or text:match("^(%d+%.?%d*)%*$")
            local percent = text:match("^(%d+%.?%d*)%%$")
            if fill then result[#result + 1] = { kind = "fill", value = tonumber(fill) or 1 }
            elseif percent then result[#result + 1] = { kind = "percent", value = (tonumber(percent) or 0) / 100 }
            else result[#result + 1] = { kind = "fixed", value = tonumber(text) or 0 } end
        end
    end
    if #result == 0 then result[1] = { kind = "fill", value = 1 } end
    return result
end

local desiredSize
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
        local width,height=desiredSize(entry.widget,total,total)
        local layout={w=numberOrPercent(resolve(entry.attrs.Width,entry.context),total) or width,
            h=numberOrPercent(resolve(entry.attrs.Height,entry.context),total) or height}
        local transform = transformSpec(entry.attrs.LayoutTransform)
        local transformedW, transformedH = transformedBounds(layout.w or 0, layout.h or 0, transform)
        local desired = axis == "row" and transformedH or transformedW
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
    Measure.Frame(widget, x, y, width, height)
end

desiredSize = function(widget, width, height, exactWidth, exactHeight)
    if not Measure.Participates(widget) then return 0, 0 end
    if widget.luiMeasure_ then
        return Measure.Cached(widget, tostring(width).."/"..tostring(exactWidth), tostring(height).."/"..tostring(exactHeight),
            function() return widget:luiMeasure_(width, height, exactWidth, exactHeight) end)
    end
    return Measure.Leaf(widget, exactWidth or width)
end

local function participatingEntries(entries)
    local active = {}
    for _, entry in ipairs(entries) do
        if Measure.Participates(entry.widget) then active[#active + 1] = entry
        else Measure.Frame(entry.widget, 0, 0, 0, 0) end
    end
    return active
end

local function arrangeFrame(widget, x, y, width, height, attrs, context)
    local left, top, right, bottom = thicknessParts(resolve(attrs.Margin, context))
    x, y = x + left, y + top
    width, height = math.max(0, width - left - right), math.max(0, height - top - bottom)
    local explicitW = numberOrPercent(resolve(attrs.Width, context), width)
    local explicitH = numberOrPercent(resolve(attrs.Height, context), height)
    local desiredW, desiredH = desiredSize(widget, width, height, explicitW, explicitH)
    local minW, minH = tonumber(resolve(attrs.MinWidth, context)) or 0, tonumber(resolve(attrs.MinHeight, context)) or 0
    local maxW, maxH = tonumber(resolve(attrs.MaxWidth, context)), tonumber(resolve(attrs.MaxHeight, context))
    desiredW, desiredH = math.max(minW, desiredW), math.max(minH, desiredH)
    if maxW then desiredW = math.min(desiredW, maxW) end
    if maxH then desiredH = math.min(desiredH, maxH) end
    local layoutTransform = transformSpec(resolve(attrs.LayoutTransform, context))
    local transformedW, transformedH = transformedBounds(desiredW, desiredH, layoutTransform)
    local horizontal, vertical = resolve(attrs.VerticalAlignment, context), resolve(attrs.HorizontalAlignment, context)
    x, width = Alignment.Axis(x, width, transformedW, explicitW, minW, maxW, horizontal)
    y, height = Alignment.Axis(y, height, transformedH, explicitH, minH, maxH, vertical)
    widget.luiResolvedLayout_ = {
        desiredWidth = desiredW, desiredHeight = desiredH,
        declaredWidth = resolve(attrs.Width, context), declaredHeight = resolve(attrs.Height, context),
        horizontalAlignment = vertical, verticalAlignment = horizontal,
        childLayout = resolve(attrs.ChildLayout, context) or Defaults.childLayout,
        margin = resolve(attrs.Margin, context),
    }
    applyFrame(widget, x, y, width, height)
end

local function layoutPanel(props, entries, mode, attrs, context, existing)
    if not existing then props.children = {} end
    local panel = existing or UI.Panel(props)
    if not existing then for _, entry in ipairs(entries) do panel:AddChild(entry.widget) end end
    panel.luiEntries_, panel.luiAttrs_, panel.luiContext_ = entries, attrs, context
    local function panelInsets(target)
        local l, t, r, b = Measure.Insets(target.props)
        local gutterRight, gutterBottom = Scrollbars.Gutters(target)
        return l, t, r + gutterRight, b + gutterBottom
    end
    local function entryAttrs(entry)
        local values = {}
        for key, value in pairs(entry.attrs) do values[key] = resolve(value, entry.context or context) end
        for source, target in pairs({ ChildWidth = "Width", ChildHeight = "Height" }) do
            local value = resolve(attrs[source], context)
            if value and value ~= "自动" then values[target] = value end
        end
        return values
    end
    local function childSize(entry, width, height)
        local values = entryAttrs(entry)
        local explicitW = numberOrPercent(values.Width, width or 0)
        local explicitH = numberOrPercent(values.Height, height or 0)
        local w, h = desiredSize(entry.widget, width, height, explicitW, explicitH)
        w, h = explicitW or w, explicitH or h
        w = math.max(tonumber(values.MinWidth) or 0, math.min(tonumber(values.MaxWidth) or math.huge, w))
        h = math.max(tonumber(values.MinHeight) or 0, math.min(tonumber(values.MaxHeight) or math.huge, h))
        local l, t, r, b = thicknessParts(values.Margin)
        return w + l + r, h + t + b, values
    end
    function panel:luiMeasure_(availableW, availableH, exactWidth, exactHeight)
        local entries = participatingEntries(self.luiEntries_)
        local l, t, r, b = panelInsets(self)
        local explicitW = exactWidth or numberOrPercent(resolve(attrs.Width, context), availableW or 0)
        local explicitH = exactHeight or numberOrPercent(resolve(attrs.Height, context), availableH or 0)
        local innerW = math.max(0, (explicitW or availableW or 0) - l - r)
        local innerH = math.max(0, (explicitH or availableH or 0) - t - b)
        local w, h, count = 0, 0, 0
        local horizontal = mode == "水平"
        local gap = tonumber(resolve(horizontal and attrs.HorizontalGap or attrs.VerticalGap, context)) or 0
        local wrap = resolve(attrs.Wrap, context) == "是" and (horizontal or mode == "垂直")
        local lineMain, lineCross, maxMain, totalCross = 0, 0, 0, 0
        local crossGap = tonumber(resolve(horizontal and attrs.VerticalGap or attrs.HorizontalGap, context)) or 0
        for _, entry in ipairs(entries) do
            local cw, ch = childSize(entry, innerW, innerH)
            if wrap then
                local mainSize, crossSize = horizontal and cw or ch, horizontal and ch or cw
                local limit = horizontal and innerW or innerH
                if lineMain > 0 and lineMain + gap + mainSize > limit then
                    maxMain, totalCross = math.max(maxMain, lineMain), totalCross + lineCross + crossGap
                    lineMain, lineCross = 0, 0
                end
                lineMain = lineMain + (lineMain > 0 and gap or 0) + mainSize
                lineCross = math.max(lineCross, crossSize)
            end
            if mode == "垂直" then h = h + ch; w = math.max(w, cw)
            elseif horizontal then w = w + cw; h = math.max(h, ch)
            else w, h = math.max(w, cw), math.max(h, ch) end
            count = count + 1
        end
        if horizontal then w = w + math.max(0, count - 1) * gap
        elseif mode == "垂直" then h = h + math.max(0, count - 1) * gap end
        if wrap then
            maxMain, totalCross = math.max(maxMain, lineMain), totalCross + lineCross
            w, h = horizontal and maxMain or totalCross, horizontal and totalCross or maxMain
        end
        return math.max(tonumber(resolve(attrs.MinWidth, context)) or tonumber(self.props.minWidth) or 0, explicitW or (w + l + r)),
            math.max(tonumber(resolve(attrs.MinHeight, context)) or tonumber(self.props.minHeight) or 0, explicitH or (h + t + b))
    end
    local baseRender = panel.Render
    function panel:Render(nvg)
        local entries = participatingEntries(self.luiEntries_)
        local rect = self:GetAbsoluteLayout()
        local gutterRight, gutterBottom = Scrollbars.Gutters(self)
        local stamp = table.concat({ rect.x, rect.y, rect.w, rect.h, gutterRight, gutterBottom, Measure.Revision(self) }, ":")
        if self.luiArrangedStamp_ == stamp then baseRender(self, nvg); return end
        self.luiArrangedStamp_ = stamp
        Measure.stats.arrangements = Measure.stats.arrangements + 1
        local left, top, right, bottom = panelInsets(self)
        local contentX, contentY = rect.x + left, rect.y + top
        local contentW, contentH = math.max(0, rect.w - left - right), math.max(0, rect.h - top - bottom)
        if mode == "Free" then
            -- LUI 2.0 free layout: every direct child receives the same content
            -- rectangle.  Later children render above earlier children.
            for index, entry in ipairs(entries) do
                local child = entry.widget
                if entry.attrs.ZIndex == nil then child.props.zIndex = index end
                local cw, ch, values = childSize(entry, contentW, contentH)
                -- 滚动方向不拉伸为视口高度，内容保持自然尺寸，范围由原生 ScrollView 管理。
                local slotW = self.props.scrollX and math.max(contentW, cw) or contentW
                local slotH = self.props.scrollY and math.max(contentH, ch) or contentH
                arrangeFrame(child, contentX, contentY, slotW, slotH, values, context)
            end
        elseif mode == "水平" or mode == "垂直" then
            local horizontal = mode == "水平"
            local gap = tonumber(resolve(horizontal and attrs.HorizontalGap or attrs.VerticalGap, context)) or 0
            local available = horizontal and contentW or contentH
            local sizes, values, crossSizes, fills, used = {}, {}, {}, 0, math.max(0, #entries - 1) * gap
            for index, entry in ipairs(entries) do
                local cw, ch, resolved = childSize(entry, contentW, contentH)
                values[index] = resolved
                local fill = resolved.Fill == "是"
                local l, t, r, b = thicknessParts(resolved.Margin)
                local minimum = tonumber(horizontal and resolved.MinWidth or resolved.MinHeight) or 0
                sizes[index] = fill and (minimum + (horizontal and (l + r) or (t + b))) or (horizontal and cw or ch)
                crossSizes[index] = horizontal and ch or cw
                if fill then fills = fills + 1 end
                used = used + sizes[index]
            end
            local wrapping = resolve(attrs.Wrap, context) == "是"
            local cursor, crossCursor, lineCross = 0, 0, 0
            local crossGap = tonumber(resolve(horizontal and attrs.VerticalGap or attrs.HorizontalGap, context)) or 0
            for index, entry in ipairs(entries) do
                local size = sizes[index] + (values[index].Fill == "是" and math.max(0, available - used) / math.max(1, fills) or 0)
                -- Resolve a percentage against its parent once, not again
                -- against the reduced flow slot (50% must never become 25%).
                local mainKey = horizontal and "Width" or "Height"
                local declared = numberOrPercent(values[index][mainKey], available)
                if declared then values[index][mainKey] = declared end
                if wrapping and cursor > 0 and cursor + size > available then
                    cursor, crossCursor, lineCross = 0, crossCursor + lineCross + crossGap, 0
                end
                lineCross = math.max(lineCross, crossSizes[index])
                arrangeFrame(entry.widget, contentX + (horizontal and cursor or crossCursor), contentY + (horizontal and crossCursor or cursor),
                    horizontal and size or (wrapping and crossSizes[index] or contentW),
                    horizontal and (wrapping and crossSizes[index] or contentH) or size, values[index], context)
                cursor = cursor + size + gap
            end
        elseif mode == "Canvas" then
            for _, entry in ipairs(entries) do
                local child = entry.widget
                local childW, childH, values = childSize(entry, contentW, contentH)
                local x = numberOrPercent(values["Canvas.Left"], contentW)
                local y = numberOrPercent(values["Canvas.Top"], contentH)
                local rightOffset = numberOrPercent(values["Canvas.Right"], contentW)
                local bottomOffset = numberOrPercent(values["Canvas.Bottom"], contentH)
                -- XAML's paired edges stretch a child when no explicit size wins.
                if x ~= nil and rightOffset ~= nil and entry.attrs.Width == nil then childW = math.max(0, contentW - x - rightOffset) end
                if y ~= nil and bottomOffset ~= nil and entry.attrs.Height == nil then childH = math.max(0, contentH - y - bottomOffset) end
                if x == nil then x = rightOffset ~= nil and contentW - rightOffset - childW or 0 end
                if y == nil then y = bottomOffset ~= nil and contentH - bottomOffset - childH or 0 end
                if numberOrPercent(values.Width, contentW) then values.Width = numberOrPercent(values.Width, contentW) end
                if numberOrPercent(values.Height, contentH) then values.Height = numberOrPercent(values.Height, contentH) end
                arrangeFrame(child, contentX + x, contentY + y, childW, childH, values, entry.context or context)
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
                arrangeFrame(entry.widget, x, y, width, height, entry.attrs, context)
            end
        end
        self.luiLayoutProbe_ = { contentWidth = contentW, contentHeight = contentH }
        baseRender(self, nvg)
    end
    return panel
end

-- 根、组件和流式宿主共用同一套槽位分配，不再创建反写尺寸的第二层 Yoga slot。
local function unifiedPanel(props, entries, attrs, context)
    local mode = resolve(attrs.ChildLayout, context) or Defaults.childLayout
    return layoutPanel(props, entries, mode == "自由" and "Free" or mode, attrs, context)
end

-- Every paired visual tag may host authored child controls.  Widgets that are
-- already interactive (notably Button) retain their visual and hit behavior;
-- this only supplies the same direct-child flow contract used by <容器>.
local function configureVisualHost(props, children, attrs, context)
    if #children == 0 then return end
    local mode = resolve(attrs.ChildLayout, context) or Defaults.childLayout
    props.flexDirection = mode == "水平" and "row" or "column"
    props.flexWrap = resolve(attrs.Wrap, context) == "是" and "wrap" or "nowrap"
    props.gap = numberOrPercent(resolve(mode == "水平" and attrs.HorizontalGap or attrs.VerticalGap, context), 0) or 0
    if mode == "垂直" then props.alignItems = "flex-start" end
end

-- DockPanel owns the remaining rectangle, exactly like WPF: each direct child
-- consumes one edge in declaration order; the final child fills by default.
local function dockPanel(props, entries, attrs, context)
    props.children = {}
    local panel = UI.Panel(props)
    for _, entry in ipairs(entries) do panel:AddChild(entry.widget) end
    local baseRender = panel.Render
    function panel:Render(nvg)
        local entries = participatingEntries(entries)
        local rect = self:GetAbsoluteLayout()
        local leftPadding, topPadding, rightPadding, bottomPadding = thicknessParts(resolve(attrs.Padding, context))
        local left, top = rect.x + leftPadding, rect.y + topPadding
        local right, bottom = rect.x + math.max(0, rect.w - rightPadding), rect.y + math.max(0, rect.h - bottomPadding)
        local fillLast = resolve(attrs.LastChildFill, context) ~= "否"
        for index, entry in ipairs(entries) do
            local last = index == #entries
            if last and fillLast then
                arrangeFrame(entry.widget, left, top, math.max(0, right - left), math.max(0, bottom - top), entry.attrs, context)
            else
                local w, h = desiredSize(entry.widget, right-left, bottom-top)
                local marginLeft, marginTop, marginRight, marginBottom = thicknessParts(resolve(entry.attrs.Margin, context))
                local desiredW = math.max(0, (numberOrPercent(resolve(entry.attrs.Width, context), right-left) or w) + marginLeft + marginRight)
                local desiredH = math.max(0, (numberOrPercent(resolve(entry.attrs.Height, context), bottom-top) or h) + marginTop + marginBottom)
                local dock = resolve(entry.attrs.Dock, context) or "左"
                if dock == "右" then
                    local width = math.min(math.max(0, right - left), desiredW)
                    right = right - width; arrangeFrame(entry.widget, right, top, width, math.max(0, bottom - top), entry.attrs, context)
                elseif dock == "上" then
                    local height = math.min(math.max(0, bottom - top), desiredH)
                    arrangeFrame(entry.widget, left, top, math.max(0, right - left), height, entry.attrs, context); top = top + height
                elseif dock == "下" then
                    local height = math.min(math.max(0, bottom - top), desiredH)
                    bottom = bottom - height; arrangeFrame(entry.widget, left, bottom, math.max(0, right - left), height, entry.attrs, context)
                else
                    local width = math.min(math.max(0, right - left), desiredW)
                    arrangeFrame(entry.widget, left, top, width, math.max(0, bottom - top), entry.attrs, context); left = left + width
                end
            end
        end
        self.luiLayoutProbe_ = { kind = "DockPanel", x = rect.x, y = rect.y, width = rect.w, height = rect.h, contentWidth = math.max(0, right - left), contentHeight = math.max(0, bottom - top) }
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

-- A Page is the only document root that owns device semantics.  Its Width and
-- Height are authored design coordinates (not a device mode); SafeArea gives
-- this surface the logical viewport and the page uniformly scales inside it.
local function pageSurface(entries, attrs, context)
    local designWidth = tonumber(resolve(attrs.Width, context)) or 0
    local designHeight = tonumber(resolve(attrs.Height, context)) or 0
    if designWidth <= 0 or designHeight <= 0 then error("LUI <页面> 的宽度和高度必须是正数 px。") end
    local page = UI.Panel { width = "100%", height = "100%", children = {} }
    local contentProps = {
        width = designWidth, height = designHeight, padding = thickness(resolve(attrs.Padding, context)),
        overflow = resolve(attrs.ClipToBounds, context) == "否" and "visible" or "hidden",
        transformOrigin = "top-left",
    }
    local pageBrush = applyBrush(contentProps, "background", resolve(attrs.Background, context) or "#0b0713", "页面背景")
    local content = unifiedPanel(contentProps, entries, attrs, context)
    Brush.AttachBackground(content, pageBrush)
    content.luiBackgroundBrush_ = pageBrush and pageBrush.source
    page:AddChild(content)
    local baseRender = page.Render
    function page:Render(nvg)
        local rect = self:GetAbsoluteLayout()
        local left, top, right, bottom = thicknessParts(resolve(attrs.Margin, context))
        local frame = PageFrame.Calculate(rect.w, rect.h, designWidth, designHeight, left, top, right, bottom)
        applyFrame(content, rect.x + frame.x, rect.y + frame.y, designWidth, designHeight)
        content.props.scale, content.props.transformOrigin = frame.scale, "top-left"
        local paddingLeft, paddingTop, paddingRight, paddingBottom = thicknessParts(resolve(attrs.Padding, context))
        self.luiLayoutProbe_ = {
            kind = "Page", scale = frame.scale, x = content.renderOffsetX_, y = content.renderOffsetY_, width = designWidth, height = designHeight,
            viewportWidth = rect.w, viewportHeight = rect.h, availableWidth = frame.availableWidth, availableHeight = frame.availableHeight,
            safeLeft = left, safeTop = top, safeRight = right, safeBottom = bottom,
            contentWidth = math.max(0, designWidth - paddingLeft - paddingRight), contentHeight = math.max(0, designHeight - paddingTop - paddingBottom),
        }
        baseRender(self, nvg)
    end
    return page
end

-- Controls deliberately have no SafeArea or document scale.  Their own
-- width/height/padding remain ordinary WPF-style measure/arrange properties.
local function controlSurface(entries, attrs, context)
    local props = propsFor(attrs, context)
    return unifiedPanel(props, entries, attrs, context)
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
    self.config_, self.configError_ = Project.Read()
    self.documents_ = {}
    self.code_ = {}
    self.isV2_ = tonumber(self.config_.schemaVersion or 1) >= 2
    self.fontFiles_ = {}
    for _, family in ipairs(self.config_.fonts or {}) do
        for weight, descriptor in pairs(family.weights or {}) do
            local resource = type(descriptor) == "table" and descriptor.resource or descriptor
            if type(resource) == "string" then self.fontFiles_[tostring(family.family) .. ":" .. tostring(weight)] = resource end
        end
    end
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

-- Build a single binding context for both WPF-style instances and the legacy
-- Build adapter.  The markup renderer never loads code; a component instance
-- supplies its already-created declaration here instead.
function Runtime:CreateMarkupContext(document, declaration, inherited)
    local imports, importsErr = self:ImportsFor(document)
    if not imports then return nil, importsErr end
    declaration = declaration or {}
    local view = declaration.view or {}
    local context = setmetatable({ view = view }, { __index = inherited or view })
    context.actions = declaration.actions or (inherited and inherited.actions) or {}
    context.refs = declaration.refs or (inherited and inherited.refs) or {}
    context.props = declaration.props or (inherited and inherited.props) or {}
    context.slots = declaration.slots or (inherited and inherited.slots) or {}
    context.imports = imports
    context.componentStack = declaration.componentStack or (inherited and inherited.componentStack) or {}
    context.presentation = declaration.presentation or (inherited and inherited.presentation)
    context.owner = declaration.owner
    context.bindings = { pending = {} }
    function context.bindings:Notify(path)
        if declaration.OnBindingChanged then declaration.OnBindingChanged(path, context)
        elseif context.owner and context.owner.OnBindingChanged then context.owner:OnBindingChanged(path, context) end
    end
    function context.bindings:Commit(path)
        local value = self.pending[path]
        if value == nil then return false end
        self.pending[path] = nil
        if not setPath(context, path, value) then return false end
        self:Notify(path)
        return true
    end
    return context, nil
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
    local document, err = self:LoadDocument(path)
    return document, err, path
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

local function hasContentPresenter(node)
    if not node then return false end
    if node.tag == "lui:Slot" then return true end
    for _, child in ipairs(node.children or {}) do if hasContentPresenter(child) then return true end end
    return false
end

function Runtime:RenderMarkup(markupPath, declaration, inherited)
    local document, documentErr = self:LoadDocument(markupPath)
    if not document then return nil, documentErr end
    local context, contextErr = self:CreateMarkupContext(document, declaration, inherited)
    if not context then return nil, contextErr end
    local root = self:BuildNode(document, context)
    -- 页面不再隐式包裹 SafeAreaView。只有显式 <安全区> 才改变布局输入，
    -- 因而 Studio 与 Runtime 看到完全相同的页面矩形。
    if self.config_.layoutDiagnostics and root and document.tag == "lui:Page" then
        local previous = root.CustomRenderChildren
        local frames, runtime, warmMeasurements, warmArrangements = 0, self, 0, 0
        function root:CustomRenderChildren(nvg, renderChild)
            if previous then previous(self, nvg, renderChild)
            else for _, child in ipairs(self:GetChildren()) do renderChild(child, nvg) end end
            frames = frames + 1
            if frames == 3 then
                if not runtime.layoutChecksRun_ then
                    runtime.layoutChecksRun_ = true
                    local ok, err = pcall(require("LUI.LayoutChecks").Run, runtime, nvg)
                    if not ok then print("[LUI engine check] FAIL " .. tostring(err)) end
                end
                if runtime.config_.layoutDiagnostics == true then
                    for _, sample in ipairs(runtime:LayoutProbe(self)) do
                        if sample.sourcePath then print("[LUI layout] " .. cjson.encode(sample)) end
                    end
                end
                warmMeasurements, warmArrangements = Measure.stats.measurements, Measure.stats.arrangements
            elseif frames == 60 then
                print("[LUI idle] " .. markupPath .. " frames=57 measurements=" .. (Measure.stats.measurements - warmMeasurements)
                    .. " arrangements=" .. (Measure.stats.arrangements - warmArrangements))
            end
        end
    end
    local afterMount = declaration and declaration.AfterMount
    if afterMount then afterMount(root, context) end
    local owner = declaration and declaration.owner
    if owner and owner.OnLoaded then owner:OnLoaded(root, context) end
    return root, context
end

-- Imported controls are real instances too.  Their class receives the parent
-- binding context, resolved props and authored content, then renders only its
-- own markup through RenderMarkup.
function Runtime:CreateComponent(markupPath, parentContext, properties, slots, rawProperties, propertyExpressions)
    local descriptor = { markup = markupPath, code = markupPath .. ".lua" }
    local code, codeErr = self:LoadCode(descriptor.code)
    if not code then return nil, codeErr end
    properties = Properties.Apply(code.Properties, code.Properties and (rawProperties or properties) or properties)
    if code.Properties and propertyExpressions then
        local values, bindings = properties, {}
        local defaults = Properties.Apply(code.Properties, {})
        for propertyName in pairs(code.Properties) do
            local binding = bindingSpec(propertyExpressions[propertyName])
            if binding and binding.mode ~= "单次" then bindings[propertyName] = binding end
        end
        properties = setmetatable({}, {
            __index = function(_, propertyName)
                local binding = bindings[propertyName]
                if binding and binding.mode ~= "单向到源" then
                    local value = resolvePath(parentContext, binding.path)
                    -- 绑定源从有值变为 nil 时必须回到声明默认值（或 nil），
                    -- 不能重新露出构建时快照。false、0、空字符串仍是有效值。
                    if value == nil then return defaults[propertyName] end
                    return value
                end
                return values[propertyName]
            end,
            __newindex = function(_, propertyName, value)
                values[propertyName] = value
                local binding = bindings[propertyName]
                if binding and (binding.mode == "双向" or binding.mode == "单向到源") then
                    if setPath(parentContext, binding.path, value) and parentContext.bindings then parentContext.bindings:Notify(binding.path) end
                end
            end,
            __pairs = function() return pairs(values) end,
        })
    end
    if type(code.New) == "function" then return code.New(parentContext, self, descriptor, properties, slots) end
    -- Compatibility for an external pre-2.1 component. It is intentionally
    -- not emitted by Studio templates or this project's migrated files.
    local declaration = code.Build and code.Build(parentContext) or { view = {}, actions = {} }
    declaration.props, declaration.slots = properties, slots
    return self:RenderMarkup(markupPath, declaration, parentContext)
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
            local name = attrs.Items or attrs.Each or "item"
            for index, value in ipairs(values) do
                local nextContext = setmetatable({ [name] = value, item = value, index = index }, { __index = activeContext })
                for _, child in ipairs(visualChildren) do appendNode(child, nextContext) end
            end
            return
        end
        if node.tag == "lui:Slot" then
            local content = (activeContext.slots or {})[attrs.Name or "Content"] or {}
            for _, child in ipairs(content) do appendNode(child, content.luiCallerContext_ or activeContext) end
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
                context = activeContext,
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
    local nodePath = node.nodePath or "0"
    local instancePath = (context.instancePath or "") .. "/" .. (node.sourcePath or "") .. "#" .. nodePath
    if context.index then instancePath = instancePath .. "[" .. tostring(context.index) .. "]" end
    local scoped = setmetatable({ instancePath = instancePath }, { __index = context })
    local widget = self:BuildNodeCore(node, scoped)
    if widget and not widget.__luiList then
        widget.luiSourcePath_, widget.luiNodePath_, widget.luiInstancePath_ = node.sourcePath, nodePath, instancePath
        Measure.Observe(widget)
        local attrs = resolvedNodeParts(node)
        local visibilityBinding = bindingSpec(attrs.Visibility)
        local layoutBindings, previous = {}, {}
        for key, value in pairs(attrs) do
            local spec = bindingSpec(value)
            if spec and spec.mode ~= "单次" then layoutBindings[key] = value; previous[key] = resolve(value, scoped) end
        end
        function widget:luiRefreshLayout_()
            local changed, changes = false, {}
            for key, value in pairs(layoutBindings) do
                local nextValue = resolve(value, scoped)
                if previous[key] ~= nextValue then
                    previous[key] = nextValue; changed = true
                    changes[key] = {value=nextValue}
                end
            end
            if changed then LiveProps.Apply(self,node.tag,changes,propsFor(attrs,scoped)) end
            if visibilityBinding and visibilityBinding.mode ~= "单次" then
                local value = resolve(attrs.Visibility, scoped)
                local visible, hidden = value ~= nil and not isCollapsed(value), value == "隐藏"
                if self.props.visible ~= visible then self:SetVisible(visible) end
                local state = hidden and "hidden" or "visible"
                if self.props.visibility ~= state then self:SetStyle({visibility=state}) end
            end
            if changed then Measure.Invalidate(self) end
        end
        if node.tag == "lui:Page" or node.tag == "lui:Component" then
            -- Resolve caption text before the root consults cached desired sizes.
            -- The live tree is used so a RefreshComponent replacement is included.
            local baseRender = widget.Render
            function widget:Render(nvg)
                local function refresh(current)
                    if current.luiRefreshLayout_ then current:luiRefreshLayout_() end
                    if current.luiRefreshCaption_ then current.luiRefreshCaption_(current) end
                    for _, child in ipairs(Overlays.Children(current)) do refresh(child) end
                end
                refresh(self)
                return baseRender(self, nvg)
            end
        end
    end
    return widget
end

-- 显式局部刷新：refs 仍指向组件内部根，外层布局宿主和兄弟滚动控件不变。
function Runtime:RefreshComponent(root)
    local host = root and root.luiComponentHost_
    if not host or not host.luiComponentNode_ then return nil, "引用不是可刷新的组件" end
    local context = host.luiComponentContext_
    local stack = {}
    for key, value in pairs(context.componentStack or {}) do stack[key] = value end
    local isolated = setmetatable({ refs = {}, componentStack = stack }, { __index = context })
    local ok, candidate = pcall(self.BuildNodeCore, self, host.luiComponentNode_, isolated)
    if not ok then return nil, tostring(candidate) end
    if not candidate or not candidate.luiEntries_ or not candidate.luiEntries_[1] then
        return nil, "组件刷新未生成有效根节点"
    end
    local nextRoot = candidate.luiEntries_[1].widget
    local oldOwner = host.luiComponentInstance_
    candidate:RemoveChild(nextRoot)
    host:RemoveChild(root)
    host:AddChild(nextRoot)
    host.luiEntries_[1] = candidate.luiEntries_[1]
    host.luiComponentInstance_ = candidate.luiComponentInstance_
    candidate.luiComponentInstance_ = nil
    nextRoot.luiComponentHost_ = host
    local ref = host.luiComponentNode_.attrs["x:Ref"]
    if ref and context.refs then context.refs[ref] = nextRoot end
    Measure.Invalidate(host)
    if oldOwner and oldOwner.Dispose then oldOwner:Dispose() end
    root:Destroy()
    candidate:Destroy()
    return nextRoot
end

function Runtime:BuildNodeCore(node, context)
    if node.kind == "Text" then
        if not node.text or not node.text:match("%S") then return nil end
        return UI.Label { text = node.text, fontSize = 14 }
    end
    local tag, attrs, visualChildren = node.tag, resolvedNodeParts(node)
    local visibility = resolve(attrs.Visibility, context)
    local visibilityBinding = bindingSpec(attrs.Visibility)
    if not visibilityBinding and isCollapsed(visibility) then return nil end
    if tag == "lui:If" then
        local test = resolve(attrs.Test, context)
        return test ~= nil and test ~= false and { __luiList = true, items = self:BuildChildren(visualChildren, context) } or nil
    end
    if tag == "lui:For" then
        local path = bindingPath(attrs.In) or ""
        local values = resolvePath(context, path) or {}
        local name = attrs.Items or attrs.Each or "item"
        local items = {}
        for index, value in ipairs(values) do
            local nextContext = setmetatable({ [name] = value, item = value, index = index }, { __index = context })
            for _, child in ipairs(self:BuildChildren(visualChildren, nextContext)) do items[#items + 1] = child end
        end
        return { __luiList = true, items = items }
    end
    if tag == "lui:Preview" or tag == "lui:Action" or tag == "lui:Resource" then return nil end
    if tag == "lui:Slot" then
        local content = (context.slots or {})[attrs.Name or "Content"] or {}
        return { __luiList = true, items = self:BuildChildren(content, content.luiCallerContext_ or context) }
    end
    if tag == "lui:Page" then
        return pageSurface(self:BuildLayoutEntries(visualChildren, context), attrs, context)
    end
    if tag == "lui:Component" then
        return controlSurface(self:BuildLayoutEntries(visualChildren, context), attrs, context)
    end
    local component, componentErr, componentKey, componentPath = nil, nil, nil, nil
    local alias, componentName = tag:match("^([^:]+):(.+)$")
    if alias and alias ~= "lui" then
        local importDirectory = context.imports and context.imports[alias] or nil
        if not importDirectory then error("LUI 组件 " .. tostring(tag) .. " 未在当前根节点导入目录别名 " .. tostring(alias) .. "。") end
        component, componentErr, componentPath = self:LoadDirectoryComponent(importDirectory, componentName)
        componentKey = importDirectory .. ":" .. componentName
    elseif self.isV2_ and self:HasRegisteredComponentName(tag) then
        error("LUI v3 组件必须使用目录别名：<目录别名:" .. tostring(tag) .. ">。")
    elseif not self.isV2_ then
        component, componentErr = self:LoadLegacyComponent(tag)
        componentKey = tag
    end
    if componentErr then error(componentErr) end
    if component then
        if not componentKey then error("LUI 组件缺少稳定加载键：" .. tostring(tag)) end
        local componentStack = context.componentStack or {}
        if componentStack[componentKey] then error("LUI 组件循环依赖：" .. componentKey) end
        componentStack[componentKey] = true
        if #visualChildren > 0 and not hasContentPresenter(component) then
            componentStack[componentKey] = nil
            error("LUI 控件 <" .. tostring(tag) .. "> 未声明 <内容呈现器 />，不能传入子内容。")
        end
        local propertyValues = {}
        for attributeName, attributeValue in pairs(attrs) do propertyValues[attributeName] = resolve(attributeValue, context) end
        -- Slot syntax belongs to its author, including props, imports, repeat
        -- aliases, refs and actions. Copy the array per instance; annotating
        -- shared document children would let the last repeated caller win.
        local content = { luiCallerContext_ = context }
        for index, child in ipairs(visualChildren) do content[index] = child end
        local slots = { Content = content }
        local componentContext = setmetatable({ props = propertyValues, slots = slots, componentStack = componentStack }, { __index = context })
        local instance, instanceErr
        if componentPath then
            local rawValues = {}
            for name, value in pairs(node.rawAttrs or attrs) do rawValues[name] = resolve(value, context) end
            instance, instanceErr = self:CreateComponent(componentPath, context, propertyValues, slots, rawValues, node.rawAttrs or attrs)
        else
            -- Legacy document descriptors do not provide a paired class.
            local componentImports, importsErr = self:ImportsFor(component)
            if not componentImports then componentStack[componentKey] = nil; error(importsErr or ("LUI 组件导入失败：" .. tostring(tag))) end
            componentContext.imports = componentImports
            instance = self:BuildNode(component, componentContext)
        end
        componentStack[componentKey] = nil
        if not instance then error(instanceErr or ("LUI 组件实例化失败：" .. tostring(tag))) end
        local rendered = instance
        if type(instance) == "table" and type(instance.GetRoot) == "function" then rendered = instance:GetRoot() end
        if not rendered then error("LUI 组件未返回根节点：" .. tostring(tag)) end
        -- 调用处布局属于实例外壳，不能覆盖组件内部声明及其 props 绑定。
        local inner = rendered
        rendered = unifiedPanel(propsFor(attrs, context), { {
            widget = inner, attrs = inner.luiAttrs_ or component.attrs or {}, context = inner.luiContext_ or componentContext,
        } }, {}, context)
        rendered.luiComponentNode_, rendered.luiComponentContext_ = node, context
        rendered.luiComponentInstance_ = type(instance.GetRoot) == "function" and instance or nil
        inner.luiComponentHost_ = rendered
        local destroy = rendered.Destroy
        function rendered:Destroy()
            local owner = self.luiComponentInstance_
            self.luiComponentInstance_ = nil
            if owner and owner.Dispose then owner:Dispose() end
            if destroy then destroy(self) end
        end
        local ref = attrs["x:Ref"]
        if ref and context.refs then
            if context.refs[ref] then error("LUI x:Ref 重复：" .. ref) end
            context.refs[ref] = inner
            inner.luiReference_ = ref
        end
        return rendered
    end
    local props = propsFor(attrs, context)
    local text = resolve(attrs.Text, context)
    local widget = nil
    if tag == "Container" then
        widget = unifiedPanel(props, self:BuildLayoutEntries(visualChildren, context), attrs, context)
    elseif tag == "Grid" or tag == "Canvas" then
        widget = layoutPanel(props, self:BuildLayoutEntries(visualChildren, context), tag, attrs, context)
    elseif tag == "DockPanel" then
        widget = dockPanel(props, self:BuildLayoutEntries(visualChildren, context), attrs, context)
    elseif tag == "Viewbox" then
        widget = viewbox(self:BuildChildren(visualChildren, context), attrs, context)
    else
        local entries = self:BuildLayoutEntries(visualChildren, context)
        local children = {}
        local childMode = resolve(attrs.ChildLayout, context) or Defaults.childLayout
        for _, entry in ipairs(entries) do
            children[#children + 1] = entry.widget
        end
        configureVisualHost(props, children, attrs, context)
        if tag == "Text" then
        props.text = text == nil and "" or tostring(text)
        props.fontSize, props.lineHeight, props.whiteSpace = props.fontSize or nativeFontSize(Defaults.fontSize), props.lineHeight or Defaults.lineHeight, props.whiteSpace or "normal"
        props.fontColor = props.fontColor or color("#f6f0ff")
        widget = UI.Label(props)
        widget.luiText_ = "Text"
        Typography.AttachLabel(widget)
        Measure.AttachText(widget)
    elseif tag == "Button" then
        configureVisualHost(props, children, attrs, context)
        -- A composite button owns the full interaction surface while its child
        -- labels render the authored title/subtitle. Keep the historical label
        -- fallback only for the self-closing, single-text form.
        if #children > 0 then props.text = text ~= nil and tostring(text) or ""
        else props.text = tostring(text or "按钮") end
        props.minWidth, props.minHeight = props.minWidth or Defaults.button.minWidth, props.minHeight or Defaults.button.minHeight
        props.padding = props.padding or Defaults.button.padding
        -- Button 的主题会注入 paddingHorizontal=16；先展开 LUI 边距，显式值优先。
        local pl, pt, pr, pb = Measure.Insets({ padding = props.padding })
        props.paddingLeft, props.paddingTop = props.paddingLeft or pl, props.paddingTop or pt
        props.paddingRight, props.paddingBottom = props.paddingRight or pr, props.paddingBottom or pb
        props.borderRadius, props.borderWidth = props.borderRadius or Defaults.button.borderRadius, props.borderWidth or Defaults.button.borderWidth
        props.fontSize, props.fontWeight, props.fontColor = props.fontSize or nativeFontSize(Defaults.fontSize), props.fontWeight or "bold", props.fontColor or color("#ffffff")
        -- UI.Button 主题默认高度为 44。LUI 自闭合按钮的契约高度是 36；复合按钮
        -- 仍由其子项内容测量，不强行覆盖作者的自动高度。
        if #children == 0 and attrs.Height == nil then props.height = Defaults.button.minHeight end
        local secondary = props.variant == "secondary"
        props.backgroundColor = props.backgroundColor or color(secondary and "#382452" or "#7851c9")
        props.borderColor = props.borderColor or color(secondary and "#7855aa" or "#af8cff")
        -- 显式 LUI 背景是完整的常态声明。底层 Button 会自动派生状态色，
        -- 但这会使 Runtime 与静态预览不一致；只有作者显式声明状态背景才变化。
        if attrs.Background ~= nil then
            props.hoverBackgroundColor = props.hoverBackgroundColor or props.backgroundColor
            props.pressedBackgroundColor = props.pressedBackgroundColor or props.backgroundColor
        end
        -- 浏览器按钮的字重由父按钮继承；UrhoX 子 Label 不会自动继承。
        local function inheritButtonWeight(child)
            if child.SetStyle then child:SetStyle({ fontWeight = props.fontWeight }) end
            for _, nested in ipairs(child:GetChildren() or {}) do inheritButtonWeight(nested) end
        end
        for _, entry in ipairs(entries) do inheritButtonWeight(entry.widget) end
        if not secondary and not attrs.Background then
            props.backgroundGradient = { direction = "to-bottom-right", from = color("#7851c9"), to = color("#4d2a91") }
        end
        local click = resolve(attrs.Click, context)
        local action = actionName(click)
        if type(click) == "function" then
            props.onClick = function(_, event) return click(context.item, event) end
        elseif action then
            props.onClick = function(_, event)
                local callback = context.actions and context.actions[action]
                if callback then callback(context.item, event) end
            end
        else
            local command = commandSpec(resolve(attrs.Click, context))
            if command then props.onClick = function() return invokeCommand(context, command) end end
        end
        widget = UI.Button(props)
        local Caption = require("LUI.ButtonCaption")
        local captionInitialized = false
        local function refreshCaption(button)
            for source, target in pairs({ TextHorizontalAlignment="textHorizontalAlignment", TextVerticalAlignment="textVerticalAlignment", Text="text" }) do
                local binding = bindingSpec(attrs[source])
                if (source ~= "Text" or binding) and (not captionInitialized or binding) then
                    if not captionInitialized or not binding or binding.mode ~= "单次" then
                        local value = resolve(attrs[source], context)
                        if source == "Text" then
                            value = value == nil and "" or tostring(value)
                            if button.props.text ~= value then button:SetText(value) end
                        else
                            button.props[target] = Caption.Validate(value, source == "TextHorizontalAlignment" and "x" or "y")
                        end
                    end
                end
            end
            captionInitialized = true
        end
        refreshCaption(widget)
        Caption.Attach(widget, refreshCaption)
        if #children == 0 then widget.luiText_ = "Button" end
        appendChildren(widget, children)
    elseif tag == "Progress" then
        props.value = tonumber(resolve(attrs.Value, context)) or 0
        props.max = math.max(1, tonumber(resolve(attrs.Max, context)) or Defaults.progress.max)
        props.height = props.height or Defaults.progress.height
        props.borderRadius, props.borderWidth = props.borderRadius or Defaults.progress.borderRadius, props.borderWidth or 0
        local trackValue = resolve(attrs.TrackBrush, context) or resolve(attrs.Background, context)
        local fillValue = resolve(attrs.FillBrush, context)
        local trackBrush = trackValue and Brush.Require(trackValue, "轨道画刷") or { kind = "solid", color = Defaults.progress.track }
        local fillBrush = fillValue and Brush.Require(fillValue, "进度画刷") or { kind = "linear", angle = 90, from = Defaults.progress.from, to = Defaults.progress.to, fromOffset = 0, toOffset = 1 }
        props.luiTrackBrush, props.luiFillBrush = trackBrush, fillBrush
        props.luiProgressDirection = resolve(attrs.ProgressDirection, context) or "从左到右"
        widget = UI.ProgressBar(props)
        require("LUI.Progress").Attach(widget)
    elseif tag == "Toggle" then
        local innerProps, wrapperProps = splitProps(props, WRAP_KEYS)
        local toggleValue=resolve(attrs.Value,context)
        innerProps.value = toggleValue==true or toggleValue=='true' or toggleValue=='是'
        local change = resolve(attrs.Change, context)
        local action = actionName(change)
        if type(change) == "function" then
            innerProps.onChange = function(_, value) return change(value) end
        elseif action then
            innerProps.onChange = function(_, value)
                local callback = context.actions and context.actions[action]
                if callback then callback(value) end
            end
        else
            local command = commandSpec(resolve(attrs.Change, context))
            if command then innerProps.onChange = function() return invokeCommand(context, command) end end
        end
        widget = applyWrapper(UI.Toggle(innerProps), wrapperProps)
    elseif tag == "Slider" then
        props.value = tonumber(resolve(attrs.Value, context)) or 0
        props.min, props.max = tonumber(resolve(attrs.Min, context)) or 0, tonumber(resolve(attrs.Max, context)) or 100
        local change = resolve(attrs.Change, context)
        local action = actionName(change)
        if type(change) == "function" then
            props.onChange = function(_, value) return change(value) end
        elseif action then
            props.onChange = function(_, value)
                local callback = context.actions and context.actions[action]
                if callback then callback(value) end
            end
        else
            local command = commandSpec(resolve(attrs.Change, context))
            if command then props.onChange = function() return invokeCommand(context, command) end end
        end
        widget = UI.Slider(props)
    elseif tag == "Row" or tag == "StackPanel" or tag == "WrapPanel" then
        props.flexDirection = (tag == "Row" or resolve(attrs.Orientation, context) == "水平") and "row" or "column"
        if resolve(attrs.FlowDirection, context) == "从右到左" and props.flexDirection == "row" then props.flexDirection = "row-reverse" end
        if tag == "WrapPanel" then props.flexWrap = "wrap" end
        props.children = children; widget = UI.Panel(props)
    elseif tag == "UniformGrid" then
        local columns = math.max(1, tonumber(resolve(attrs.Columns, context)) or 1)
        props.children = children; widget = layoutPanel(props, self:BuildLayoutEntries(visualChildren, context), "Grid", { RowDefinitions = "填充", ColumnDefinitions = string.rep("填充,", columns):sub(1, -2) }, context)
    elseif tag == "Border" or tag == "ContentControl" then
        props.children = children; widget = UI.Panel(props)
    elseif tag == "Scroll" then
        props.padding, props.borderWidth, props.borderRadius = props.padding or Defaults.scroll.padding, props.borderWidth or Defaults.scroll.borderWidth, props.borderRadius or Defaults.scroll.borderRadius
        props.backgroundColor, props.borderColor = props.backgroundColor or color("#130b20"), props.borderColor or color("#4f396d")
        local function scrollAxis(axisVisibility, legacy)
            local value = resolve(axisVisibility, context) or legacy
            if value == "禁用" then return false, false, false end
            if value == "隐藏" then return true, false, false end
            if value == "显示" then return true, true, true end
            -- 自动：内容溢出时显示，不强制常驻交互轨道。
            return true, true, false
        end
        props.scrollX, props.showScrollbar, props.scrollbarInteractive = scrollAxis(attrs.HorizontalScrollBarVisibility, "禁用")
        local scrollY, showVertical, interactiveVertical = scrollAxis(attrs.VerticalScrollBarVisibility, "隐藏")
        props.scrollY = scrollY
        props.showScrollbar = props.showScrollbar or showVertical
        props.scrollbarInteractive = props.scrollbarInteractive or interactiveVertical
        props.children = children; widget = UI.ScrollView(props)
        Scrollbars.Attach(widget, resolve(attrs.HorizontalScrollBarVisibility, context) or "禁用",
            resolve(attrs.VerticalScrollBarVisibility, context) or "隐藏", color(resolve(attrs.ScrollbarColor, context)))
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
        -- Modal owns its full-screen overlay and native content layout. A generic
        -- wrapper must not hide Open/Close/IsOpen or steal the explicit reference.
        innerProps.closeOnEscape = innerProps.closeOnOverlay
        innerProps.size = "fullscreen"
        innerProps.backgroundColor = wrapperProps.backgroundColor or innerProps.backgroundColor
        innerProps.contentPadding = wrapperProps.padding or innerProps.contentPadding
        innerProps.children = children; widget = UI.Modal(innerProps)
    elseif tag == "Card" then
        props.padding, props.borderWidth, props.borderRadius = props.padding or Defaults.card.padding, props.borderWidth or Defaults.card.borderWidth, props.borderRadius or Defaults.card.borderRadius
        props.backgroundColor, props.borderColor = props.backgroundColor or color("#211535"), props.borderColor or color("#8064a8")
        props.children = children
        widget = UI.Panel(props)
    elseif tag == "Section" then
        widget = Components.Section(tostring(text or attrs.Title or ""), children, resolve(attrs.Subtitle, context))
    elseif tag == "Notice" then
        widget = Components.Notice(text, resolve(attrs.Error, context) == true)
    elseif tag == "Screen" then
        widget = Components.Screen(nil, children, props)
    elseif tag == "FixedScreen" then
        widget = Components.FixedScreen(nil, UI.Panel { width = "100%", height = "100%", children = children }, props)
    else
        local descriptor = controlDescriptor(tag)
        if descriptor then
            if descriptor.bindable then
                local bound = resolve(attrs[descriptor.bindable], context)
                if tag == "TextField" then props.value = bound == nil and "" or tostring(bound)
                elseif bound ~= nil then props.value = bound end
            end
            if tag == "TextField" then
                props.textColor = props.fontColor
                props.fontColor = nil
            end
            props.children = children
            props.luiTextRasterMode = Fidelity.typography.nativeControlRaster
            wireControlEvents(props, attrs, context, descriptor)
            NativeControls.Prepare(tag, props)
            local constructors = UI --[[@as table<string, any>]]
            local constructor = constructors[descriptor.ui]
            if not constructor then error("LUI 控件 <" .. tostring(tag) .. "> 的 UI." .. tostring(descriptor.ui) .. " 构造器不可用；请升级 urhox-libs/UI。") end
            widget = constructor(props)
            NativeControls.Attach(widget, tag)
            widget.luiTextRasterMode_ = Fidelity.typography.nativeControlRaster
        end
    end
        if not widget then
            props.flexDirection = props.flexDirection or "column"; props.children = children
            widget = UI.Panel(props)
        end
        if #entries > 0 and (tag == "Button" or tag == "Card" or tag == "Scroll" or tag == "Border" or tag == "ContentControl") then
            layoutPanel(widget.props, entries, childMode == "自由" and "Free" or childMode, attrs, context, widget)
        end
    end
    local ref = attrs["x:Ref"]
    if not ref and not self.isV2_ then ref = attrs["x:Name"] end
    if attrs.Background ~= nil then
        local rawBrush = resolve(attrs.Background, context)
        if rawBrush ~= nil then
            Brush.AttachBackground(widget, Brush.Require(rawBrush, "背景"), attrs)
            widget.luiBackgroundBrush_ = tostring(rawBrush)
        end
    end
    if tag == "Button" and (attrs.Background~=nil or attrs.HoverBackground~=nil or attrs.PressedBackground~=nil) then
        -- Native construction derives both color and gradient state defaults.
        -- Reapply explicit state paints so an auto-derived gradient cannot
        -- obscure an authored solid color (or the reverse).
        if attrs.HoverBackground~=nil then applyBrush(widget.props,"hover",resolve(attrs.HoverBackground,context),"悬停背景") end
        if attrs.PressedBackground~=nil then applyBrush(widget.props,"pressed",resolve(attrs.PressedBackground,context),"按下背景") end
        Brush.AttachBackground(widget,nil,attrs)
    end
    if tag == "Progress" then
        widget.luiTrackBrush_, widget.luiFillBrush_ = props.luiTrackBrush, props.luiFillBrush
    end
    if tag == "Toggle" or tag == "Slider" or tag == "Progress" then
        require("LUI.BuiltinValues").Capture(widget, attrs, function(value) return resolve(value, context) end)
    end
    widget.luiName_ = attrs["x:Name"] or attrs["x:DisplayName"] or tag
    if ref and context.refs then
        if context.refs[ref] then error("LUI x:Ref 重复：" .. ref) end
        context.refs[ref] = widget
        widget.luiReference_ = ref
    end
    return widget
end

-- Stable, data-only layout probe used to compare Studio and device layout by
-- node name. Consumers may serialize this table to their existing diagnostics.
function Runtime:LayoutProbe(root)
    local result = {}
    local dpr = graphics and graphics.GetDPR and graphics:GetDPR() or 1
    local fontFiles = self.fontFiles_ or {}
    local function fontFile(props)
        if not props then return nil end
        local family, weight = tostring(props.fontFamily or "sans"), tostring(props.fontWeight or "normal")
        if weight == "bold" or (tonumber(weight) and tonumber(weight) >= 600) then weight = "bold"
        elseif weight == "regular" or weight == "400" then weight = "normal" end
        return fontFiles[family .. ":" .. weight] or fontFiles[family .. ":normal"]
    end
    local function resolvedWeight(props)
        local weight = tostring(props and props.fontWeight or "normal")
        if weight == "bold" or (tonumber(weight) and tonumber(weight) >= 600) then return "bold" end
        return "normal"
    end
    local function visit(widget)
        if not widget then return end
        local rect = widget:GetAbsoluteLayout()
        local probe = widget.luiLayoutProbe_ or {}
        local resolved = widget.luiResolvedLayout_ or {}
        local left, top, right, bottom = Measure.Insets(widget.props or {})
        local textLayout = widget.luiTextLayout_ or {}
        local props = widget.props or {}
        local borderWidth = tonumber(props.borderWidth) or 0
        local borderAlign = props.borderAlign or Fidelity.borderAlign
        local borderInset = borderAlign == "inside" and borderWidth / 2 or (borderAlign == "outside" and -borderWidth / 2 or 0)
        local borderRect = {
            x = rect.x + borderInset, y = rect.y + borderInset,
            width = math.max(0, rect.w - borderInset * 2), height = math.max(0, rect.h - borderInset * 2),
        }
        local captionProbe = widget.luiCaptionProbe_ or {}
        result[#result + 1] = {
            name = widget.luiName_ or "anonymous", x = rect.x, y = rect.y, width = rect.w, height = rect.h,
            contentWidth = probe.contentWidth or rect.w, contentHeight = probe.contentHeight or rect.h, scale = probe.scale or 1,
            viewportWidth = probe.viewportWidth, viewportHeight = probe.viewportHeight, dpr = dpr,
            availableWidth = probe.availableWidth, availableHeight = probe.availableHeight,
            safeLeft = probe.safeLeft, safeTop = probe.safeTop, safeRight = probe.safeRight, safeBottom = probe.safeBottom,
            sourcePath = widget.luiSourcePath_, nodePath = widget.luiNodePath_, instancePath = widget.luiInstancePath_,
            desiredWidth = resolved.desiredWidth, desiredHeight = resolved.desiredHeight,
            declaredWidth = resolved.declaredWidth, declaredHeight = resolved.declaredHeight,
            horizontalAlignment = resolved.horizontalAlignment, verticalAlignment = resolved.verticalAlignment,
            childLayout = resolved.childLayout, margin = resolved.margin,
            insetLeft = left, insetTop = top, insetRight = right, insetBottom = bottom,
            fontSize = props.fontSize, lineHeight = textLayout.logicalLineHeight,
            fontFamily = props.fontFamily, fontWeight = props.fontWeight, resolvedFontWeight = resolvedWeight(props),
            fontFile = fontFile(props), fontSynthesis = Fidelity.typography.fontSynthesis,
            textRasterMode = widget.luiTextRasterMode_ or props.luiTextRasterMode,
            inkCompensation = captionProbe.inkCompensation or (props.textStroke and props.textStroke.luiOptical and props.textStroke.width or 0),
            letterSpacing = props.letterSpacing, whiteSpace = props.whiteSpace,
            textAlign = props.textAlign, verticalAlign = props.verticalAlign,
            colorSpace = Fidelity.colorSpace, alphaMode = Fidelity.alphaMode,
            gradientInterpolation = Fidelity.gradientInterpolation,
            backgroundBrush = widget.luiBackgroundBrush_ or props.backgroundGradient or props.backgroundColor,
            trackBrush = widget.luiTrackBrush_ and widget.luiTrackBrush_.source or widget.luiTrackBrush_,
            fillBrush = widget.luiFillBrush_ and widget.luiFillBrush_.source or widget.luiFillBrush_,
            borderColor = props.borderColor, borderWidth = borderWidth, borderAlign = borderAlign, borderRect = borderRect,
            shadowSource = Fidelity.shadowSource, boxShadow = props.boxShadow,
        }
        for _, child in ipairs(Overlays.Children(widget)) do visit(child) end
    end
    visit(root)
    return result
end

-- Find authored x:Ref values without leaking page/controller reference tables.
-- instancePath is optional and is useful when repeated component instances use
-- the same local reference name.
function Runtime:FindByRef(root, ref, instancePath)
    local function visit(widget)
        if not widget then return nil end
        if widget.luiReference_ == ref and (instancePath == nil or widget.luiInstancePath_ == instancePath) then return widget end
        for _, child in ipairs(Overlays.Children(widget)) do
            local match = visit(child)
            if match then return match end
        end
        return nil
    end
    return visit(root)
end

function Runtime:GetReferenceRect(root, ref, instancePath)
    local widget = self:FindByRef(root, ref, instancePath)
    if not widget then return nil, nil end
    return widget:GetAbsoluteLayout(), widget
end

-- Screen/base-pixel coordinates share the engine's input transform pipeline.
-- Unlike GetReferenceRect, a hidden, unlaid-out or fully clipped node has no rect.
function Runtime:GetScreenRect(widget)
    if not widget then return nil, "missing" end
    local current = widget
    while current do
        local props = current.props or {}
        if props.visible == false or props.visibility == "hidden" or (current.IsVisible and not current:IsVisible()) then return nil, "hidden" end
        current = current.parent
    end
    if type(UI.GetVisualRect) ~= "function" then return nil, "visual-rect-unavailable" end
    local rect, reason = Overlays.VisualRect(widget)
    if not rect then return nil, reason end
    if type(rect) ~= "table" or type(rect.x) ~= "number" or type(rect.y) ~= "number"
        or type(rect.w) ~= "number" or type(rect.h) ~= "number" or rect.w <= 0 or rect.h <= 0 then return nil, "unlaid-out" end
    rect = {x=rect.x,y=rect.y,w=rect.w,h=rect.h}
    current = widget.parent
    while current do
        -- Native Modal already escaped the ordinary tree's transform/scissor;
        -- only clipping inside its content tree applies to its visible target.
        if current.contentContainer_ and current.RenderModalContent then break end
        local modalBody = current.parent and current.parent.contentContainer_ == current
        if current.props.overflow == "hidden" or current.GetScroll or modalBody then
            local clip = Overlays.VisualRect(current)
            if clip and type(clip.x) == "number" and type(clip.y) == "number"
                and type(clip.w) == "number" and type(clip.h) == "number" then
                local right, bottom = math.min(rect.x+rect.w,clip.x+clip.w), math.min(rect.y+rect.h,clip.y+clip.h)
                rect.x, rect.y = math.max(rect.x,clip.x), math.max(rect.y,clip.y)
                rect.w, rect.h = right-rect.x, bottom-rect.y
                if rect.w <= 0 or rect.h <= 0 then return nil, "clipped" end
            end
        end
        current = current.parent
    end
    return rect
end

-- Commit notifications run after native deferred content, before viewport
-- portals. The callback receives a fresh base-pixel NanoVG coordinate space.
function Runtime:AfterLayout(root, callback)
    if not root.luiLayoutListeners_ then
        root.luiLayoutListeners_ = {}
        local previous = root.CustomRenderChildren
        function root:CustomRenderChildren(nvg, renderChild)
            if previous then previous(self,nvg,renderChild)
            else for _, child in ipairs(self:GetRenderChildren()) do renderChild(child,nvg) end end
            Overlays.AfterNative(self,function(vg)
                -- Modal content has now been measured and drawn. Resolve holes
                -- against that final geometry, then draw and hit-test above it.
                for listener in pairs(self.luiLayoutListeners_) do
                    local ok, err = xpcall(listener,debug.traceback,self,vg)
                    if not ok then print("[LUI.AfterLayout] "..tostring(err)) end
                end
                Overlays.SyncInput(self)
            end,nvg)
        end
    end
    root.luiLayoutListeners_[callback] = true
    return function() if root.luiLayoutListeners_ then root.luiLayoutListeners_[callback] = nil end end
end

-- Global overlays use independent viewport-space Yoga trees. The host owns the
-- mounting lifetime, not their layout coordinates. Unmount preserves the widget
-- for reuse; the component that created it remains responsible for Destroy.
function Runtime:MountGlobalOverlay(host, overlay, layer)
    if not host or not overlay then return false end
    if not host.luiLayoutListeners_ then self:AfterLayout(host,function() end)() end
    return Overlays.Mount(host,overlay,layer)
end

function Runtime:UnmountGlobalOverlay(overlay)
    Overlays.Unmount(overlay)
    if overlay and overlay.parent then overlay.parent:RemoveChild(overlay) end
end

function Runtime:Render(markupPath, codePath, presentation)
    local code, codeErr = self:LoadCode(codePath)
    if not code then return nil, codeErr end
    local result = code.Build and code.Build(presentation) or { view = {}, actions = {} }
    if type(result) ~= "table" then return nil, "LUI Build 必须返回 table。" end
    result.presentation = presentation
    return self:RenderMarkup(markupPath, result)
end

-- New WPF-style discovery surface.  A registered module owns its constructor
-- and InitializeComponent call; Runtime only supplies an already validated
-- descriptor and the pure markup renderer.
function Runtime:CreateRegistered(name, presentation, properties, slots)
    local registry = require("LUI.Registry")
    local item = registry:Get(name)
    if not item then return nil, "LUI 未登记页面或控件：" .. tostring(name) end
    if registry.controls and registry.controls[name] then return self:CreateComponent(item.markup, presentation, properties or {}, slots or {}) end
    local code, codeErr = self:LoadCode(item.code)
    if not code then return nil, codeErr end
    if type(code.New) == "function" then return code.New(presentation, self, item) end
    local root, err = self:Render(item.markup, item.code, presentation)
    if not root then return nil, err end
    local fallbackRoot = root
    return { root_ = fallbackRoot, GetRoot = function() return fallbackRoot end, Dispose = function() end }, nil
end

-- Compatibility return shape used by existing callers outside the project.
function Runtime:RenderRegistered(name, presentation)
    local instance, err = self:CreateRegistered(name, presentation)
    if not instance then return nil, err end
    return instance.GetRoot and instance:GetRoot() or instance, nil
end

return Runtime
