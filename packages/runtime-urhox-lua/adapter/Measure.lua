-- 声明尺寸 / 内容测量与排列结果分离。禁止读取上一帧的 renderWidth_ 作为期望尺寸。
-- 文本使用引擎 NanoVG 测量；非 LUI 叶控件保留原生 Yoga 测量。
local UI = require("urhox-libs/UI")
local Contract = require("LUI.Contract")
---@class LuiMeasureStats
---@field measurements number
---@field arrangements number
---@class LuiMeasure
---@field stats LuiMeasureStats
local Measure = { stats = { measurements = 0, arrangements = 0 } }

function Measure.Insets(props)
    local p = props.padding or 0
    local t, r, b, l
    if type(p) == "table" then
        t, r, b, l = p[1] or 0, p[2] or p[1] or 0, p[3] or p[1] or 0, p[4] or p[2] or p[1] or 0
    else t, r, b, l = p, p, p, p end
    local border = tonumber(props.borderWidth) or 0
    return (props.paddingLeft or l) + border, (props.paddingTop or t) + border,
        (props.paddingRight or r) + border, (props.paddingBottom or b) + border
end

local function measureLeaf(widget, width)
    Measure.stats.measurements = Measure.stats.measurements + 1
    local props = widget.props or {}
    local left, top, right, bottom = Measure.Insets(props)
    if widget.luiText_ then
        local text = tostring(widget.displayText_ or props.text or "")
        local size = tonumber(props.fontSize) or Contract.defaults.fontSize
        local theme = UI.Theme
        local pixels = type(theme) == "table" and theme.FontSize and theme.FontSize(size) or size
        local face = type(theme) == "table" and theme.FontFace and theme.FontFace(props.fontFamily or "sans", props.fontWeight) or "sans"
        if UI.MeasureTextFit then
            -- CSS line-height 是字号的倍数，NVG line-height 却乘字体自身行度量。
            -- 单行必须使用 advance width；glyph bounds 可能比 advance 窄，导致自身宽度标签意外折行。
            local line = UI.MeasureTextFit("Mg", { fontSize = pixels, minFontSize = pixels, fontFace = face, lineHeight = 1 })
            -- Studio 与 Runtime 共享显式 CSS 行盒契约，不能再由引擎字体主题猜测。
            local logicalLineHeight = pixels * (tonumber(props.lineHeight) or Contract.defaults.lineHeight)
            local nativeLineHeight = line.height > 0 and logicalLineHeight / line.height or Contract.defaults.lineHeight
            local natural = UI.MeasureTextWidth and UI.MeasureTextWidth(text, pixels, face) or nil
            local contentWidth = width and math.max(0, width - left - right) or nil
            local singleLine = props.whiteSpace == "nowrap" or (not text:find("\n", 1, true) and natural and (not contentWidth or natural <= contentWidth + 0.01))
            widget.luiTextLayout_ = { singleLine = singleLine, nativeLineHeight = nativeLineHeight, logicalLineHeight = logicalLineHeight }
            if singleLine and natural then
                return math.max(props.minWidth or 0, math.ceil(natural) + left + right),
                    math.max(props.minHeight or 0, (text == "" and 0 or logicalLineHeight) + top + bottom)
            end
            local fit = UI.MeasureTextFit(text, { fontSize = pixels, minFontSize = pixels, fontFace = face,
                width = contentWidth, multiline = widget.luiText_ == "Text", lineHeight = nativeLineHeight })
            return math.max(props.minWidth or 0, math.ceil(fit.width) + left + right),
                math.max(props.minHeight or 0, (text == "" and 0 or math.max(logicalLineHeight, fit.height)) + top + bottom)
        end
    end
    local layout = (widget.luiNativeGetLayout_ or widget.GetLayout)(widget)
    -- Native controls are measured before their first Yoga pass. Constructor
    -- dimensions are authoritative; 0x0 is not an intrinsic measurement.
    local function declaredSize(value, minimum, measured)
        local explicit = type(value) == "number" and value or nil
        return math.max(tonumber(minimum) or 0, explicit or tonumber(measured) or 0)
    end
    return declaredSize(props.width, props.minWidth, layout.w),
        declaredSize(props.height, props.minHeight, layout.h)
end

local function fontVersion()
    return type(UI.GetFontVersion) == "function" and UI.GetFontVersion() or 0
end

function Measure.Revision(widget)
    return tostring(widget.luiRevision_ or 0) .. ":" .. tostring(fontVersion())
end

-- Hidden keeps a slot; collapsed (including SetVisible(false)) has no slot.
function Measure.Participates(widget)
    return widget and (not widget.props or widget.props.visible ~= false)
end

function Measure.Invalidate(widget)
    while widget do
        widget.luiRevision_ = (widget.luiRevision_ or 0) + 1
        widget.luiDesiredCache_, widget.luiLeafCache_ = nil, nil
        widget = widget.parent
    end
end

function Measure.Cached(widget, width, height, calculate)
    local key = tostring(width) .. ":" .. tostring(height) .. ":" .. Measure.Revision(widget)
    local cache = widget.luiDesiredCache_
    if cache and cache[key] then return cache[key][1], cache[key][2] end
    local w, h = calculate()
    cache = cache or {}
    if (cache.count or 0) >= 8 then cache = {} end
    cache.count = (cache.count or 0) + 1
    cache[key] = { w, h }
    widget.luiDesiredCache_ = cache
    return w, h
end

function Measure.Leaf(widget, width)
    if widget.luiRefreshCaption_ then widget.luiRefreshCaption_(widget) end
    local props = widget.props or {}
    local key = table.concat({ tostring(width), tostring(props.fontSize), tostring(widget.displayText_ or props.text),
        tostring(props.fontFamily), tostring(props.fontWeight), Measure.Revision(widget) }, ":")
    local cache = widget.luiLeafCache_
    if cache and cache[key] then
        widget.luiTextLayout_ = cache[key][3]
        return cache[key][1], cache[key][2]
    end
    local w, h = measureLeaf(widget, width)
    cache = cache or {}
    if (cache.count or 0) >= 8 then cache = {} end
    cache.count = (cache.count or 0) + 1
    cache[key] = { w, h, widget.luiTextLayout_ }
    widget.luiLeafCache_ = cache
    return w, h
end

local function ownsTextLayout(widget)
    -- LUI 负责布局；禁止 Label 在 Render/SetText 时向 Yoga 重新请求自动宽高。
    widget.autoHeight_, widget.autoWidth_, widget.autoMinHeight_ = false, false, false
    widget.userSetHeight_, widget.userSetWidth_ = true, true
end

function Measure.Observe(widget)
    if widget.luiObserved_ then return end
    widget.luiObserved_ = true
    local setText, setStyle, setVisible = widget.SetText, widget.SetStyle, widget.SetVisible
    if setVisible then
        function widget:SetVisible(visible)
            local changed = self.props.visible ~= visible
            local result = setVisible(self, visible)
            if changed then Measure.Invalidate(self) end
            return result
        end
    end
    if setText then
        function widget:SetText(text)
            local changed = self.props.text ~= text
            local result = setText(self, text)
            if self.luiText_ == "Text" then ownsTextLayout(self) end
            if changed then Measure.Invalidate(self) end
            return result
        end
    end
    if setStyle then
        function widget:SetStyle(style)
            local paintOnly = { backgroundColor=true, borderColor=true, fontColor=true, opacity=true }
            local geometryChanged = false
            for key, value in pairs(style) do
                if not paintOnly[key] and self.props[key] ~= value then geometryChanged = true end
            end
            local result = setStyle(self, style)
            if geometryChanged then Measure.Invalidate(self) end
            return result
        end
    end
end

function Measure.AttachText(widget)
    ownsTextLayout(widget)
    local baseRender = widget.Render
    function widget:Render(nvg)
        local rect = self:GetAbsoluteLayout()
        Measure.Leaf(self, rect.w)
        local layout = self.luiTextLayout_
        local whiteSpace, lineHeight, verticalAlign = self.props.whiteSpace, self.props.lineHeight, self.props.verticalAlign
        if layout then
            self.props.whiteSpace = layout.singleLine and "nowrap" or "normal"
            self.props.lineHeight = layout.nativeLineHeight
            self.props.verticalAlign = verticalAlign or "top"
        end
        ownsTextLayout(self)
        baseRender(self, nvg)
        -- Native line-height is a drawing detail, not authored state.
        self.props.whiteSpace, self.props.lineHeight, self.props.verticalAlign = whiteSpace, lineHeight, verticalAlign
    end
end

-- GetLayout 必须仍返回相对父级坐标（ScrollView 的范围计算、命中依赖它）。
-- GetAbsoluteLayout 使用引擎公开的 render offset/size；不改写 props 或 Yoga 声明。
function Measure.Frame(widget, x, y, width, height)
    if not widget.luiNativeGetLayout_ then
        widget.luiNativeGetLayout_ = widget.GetLayout
        function widget:GetLayout()
            if not self.luiFrame_ then return self:luiNativeGetLayout_() end
            local frame = self.luiFrame_
            local parent = self.parent and self.parent:GetAbsoluteLayout() or { x = 0, y = 0 }
            return { x = frame.x - parent.x, y = frame.y - parent.y, w = frame.w, h = frame.h }
        end
    end
    widget.luiFrame_ = { x = x, y = y, w = width, h = height }
    widget.renderOffsetX_, widget.renderOffsetY_ = x, y
    widget.renderWidth_, widget.renderHeight_ = width, height
end

return Measure
