-- Keep LUI's authored Button palette live when Variant changes.  The native
-- Button reads explicit background fields before its semantic variant, so the
-- defaults installed by Runtime must be recomputed instead of left at their
-- construction-time values.
local Brush = require("LUI.Brush")

local ButtonVariant = {}

local PALETTES = {
    primary = {
        background = "#7851c9",
        border = "#af8cff",
        gradient = { direction = "to-bottom-right", from = "#7851c9", to = "#4d2a91" },
    },
    secondary = {
        background = "#382452",
        border = "#7855aa",
    },
}

local function palette(variant)
    return PALETTES[variant] or PALETTES.primary
end

local function lighten(value, amount)
    return {
        math.min(255, value[1] + (255 - value[1]) * amount),
        math.min(255, value[2] + (255 - value[2]) * amount),
        math.min(255, value[3] + (255 - value[3]) * amount),
        value[4] or 255,
    }
end

local function darken(value, amount)
    return {
        math.max(0, value[1] * (1 - amount)),
        math.max(0, value[2] * (1 - amount)),
        math.max(0, value[3] * (1 - amount)),
        value[4] or 255,
    }
end

local function gradient(value)
    if not value then return nil end
    return {
        direction = value.direction,
        from = Brush.Color(value.from),
        to = Brush.Color(value.to),
    }
end

local function applyProps(props, variant, state)
    local selected = palette(variant)
    local background = Brush.Color(selected.background)
    props.variant = variant
    if state.background then
        props.backgroundColor = background
        props.backgroundGradient = gradient(selected.gradient)
    end
    if state.border then props.borderColor = Brush.Color(selected.border) end
    if state.hover then props.hoverBackgroundColor = lighten(background, 0.15) end
    if state.pressed then props.pressedBackgroundColor = darken(background, 0.2) end
end

function ButtonVariant.Prepare(props, attrs, diagnostics)
    local defaultBackground = attrs.Background == nil
    diagnostics = diagnostics or {}
    local state = {
        background = defaultBackground,
        border = attrs.BorderColor == nil,
        hover = defaultBackground and attrs.HoverBackground == nil,
        pressed = defaultBackground and attrs.PressedBackground == nil,
        name = tostring(attrs["x:Ref"] or attrs.Text or "Button"),
        component = tostring(diagnostics.component or "<inline>"),
        binding = tostring(diagnostics.binding or "Variant"),
    }
    applyProps(props, props.variant or "primary", state)
    return state
end

function ButtonVariant.Attach(widget, state)
    widget.luiVariantStyle_ = state
    return widget
end

function ButtonVariant.Apply(widget, variant)
    local state = widget and widget.luiVariantStyle_
    if not state then
        if widget and widget.SetStyle then widget:SetStyle({ variant = variant })
        elseif widget and widget.props then widget.props.variant = variant end
        return
    end
    local previous = widget.props and widget.props.variant or nil
    local ok, err = pcall(function()
        local props = assert(widget.props, "按钮缺少 props")
        applyProps(props, variant, state)
        if widget.SetStyle then
            local style = { variant = props.variant }
            if state.background then style.backgroundColor = props.backgroundColor end
            if state.border then style.borderColor = props.borderColor end
            if state.hover then style.hoverBackgroundColor = props.hoverBackgroundColor end
            if state.pressed then style.pressedBackgroundColor = props.pressedBackgroundColor end
            widget:SetStyle(style)
        end
    end)
    if not ok then
        error("LUI 按钮动态外观更新失败：组件=" .. state.component .. "；按钮=" .. state.name
            .. "；旧值=" .. tostring(previous) .. "；新值=" .. tostring(variant)
            .. "；绑定路径=" .. state.binding .. "；" .. tostring(err), 0)
    end
end

return ButtonVariant
