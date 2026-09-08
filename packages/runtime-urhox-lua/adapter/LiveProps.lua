-- Reapply data-bound scalar properties without replacing widgets, focus or
-- scroll state. Native value setters emit business events, so source-to-view
-- updates intentionally write props and never synthesize an input event.
local Brush = require("LUI.Brush")
local ButtonVariant = require("LUI.ButtonVariant")
local BuiltinValues = require("LUI.BuiltinValues")
local NativeControls = require("LUI.NativeControls")
local Measure = require("LUI.Measure")
local Properties = require("LUI.Properties")
local LiveProps = {}
local targets = {
    Width={"width"}, Height={"height"}, MinWidth={"minWidth"}, MinHeight={"minHeight"},
    MaxWidth={"maxWidth"}, MaxHeight={"maxHeight"}, FontSize={"fontSize"},
    Opacity={"opacity"}, BorderRadius={"borderRadius"}, BorderWidth={"borderWidth"},
    BorderColor={"borderColor"}, ZIndex={"zIndex"}, Color={"fontColor"},
    FontFamily={"fontFamily"}, FontWeight={"fontWeight"}, FontStyle={"fontStyle"},
    LineHeight={"lineHeight"}, LetterSpacing={"letterSpacing"},
    TextWrapping={"whiteSpace"}, TextTrimming={"maxLines"},
    TextHorizontalAlignment={"textAlign"}, TextVerticalAlignment={"verticalAlign"},
    TextStrokeColor={"textStrokeColor"}, TextStrokeWidth={"textStrokeWidth"},
    Placeholder={"placeholder"}, PlaceholderColor={"placeholderColor"}, CursorColor={"cursorColor"},
    Margin={"margin"}, Padding={"padding","paddingLeft","paddingTop","paddingRight","paddingBottom"},
    Disabled={"disabled"}, Visible={"visible"}, ClipToBounds={"overflow"},
    Variant={"variant"},
    Background={"backgroundColor","backgroundGradient"},
    HoverBackground={"hoverBackgroundColor","hoverBackgroundGradient"},
    PressedBackground={"pressedBackgroundColor","pressedBackgroundGradient"},
    RenderTransform={"scale","rotate","translateX","translateY","transformOrigin"},
    LayoutTransform={"scale","rotate","transformOrigin"},
    RenderTransformOrigin={"transformOrigin"},
}

local paintSources = { Click=true, Change=true, Select=true, Open=true, Close=true,
    MouseEnter=true, MouseLeave=true, PointerDown=true, PointerUp=true,
    Opacity=true, BorderRadius=true, BorderColor=true, Color=true, ZIndex=true,
    Disabled=true, Variant=true, Background=true, HoverBackground=true, PressedBackground=true,
    TextHorizontalAlignment=true, TextVerticalAlignment=true, TextStrokeColor=true,
    PlaceholderColor=true, CursorColor=true, RenderTransform=true, RenderTransformOrigin=true,
    TrackBrush=true, FillBrush=true, ProgressDirection=true }

function LiveProps.IsPaintSource(source) return paintSources[source] == true end

-- Inspect old props before setters or nil-clearing writes. SetStyle wrappers
-- cannot discover a change after the new values are already in props.
function LiveProps.Classify(widget, tag, changes, resolved)
    local kind
    for source in pairs(changes) do
        local proxyOnly = widget.luiComponentNode_ and not targets[source] and not Properties.IsLayout(source)
        local itemChanges = widget.luiVirtualList_ and source == 'Items' and changes[source].relativePaths ~= nil
        if source == "Items" and not proxyOnly and not itemChanges then return "structure" end
        local paint = itemChanges or proxyOnly or paintSources[source] or
            (widget.luiVirtualList_ and (source == "SelectedKey" or source == "ScrollState")) or
            ((tag == "Slider" or tag == "Toggle" or tag == "Progress" or tag == "Checkbox" or tag == "Chip")
                and (source == "Value" or source == "Min" or source == "Max"))
        if not paint then
            local keys = targets[source]
            local changed = keys == nil
            if keys then
                local wrapped = source == "Margin" or source == "Padding" or source == "Background" or source == "Visible"
                local control = not wrapped and widget.luiNativeWidget_ or widget
                for _, key in ipairs(keys) do
                    local target = tag == "TextField" and key == "fontColor" and "textColor" or key
                    if control.props[target] ~= resolved[key] then changed = true; break end
                end
            end
            if changed then kind = "geometry" end
        elseif not kind then kind = "paint" end
    end
    return kind
end

local function apply(widget, tag, changes, resolved)
    local props = widget.props
    local virtual = widget.luiVirtualList_
    if virtual then
        assert(not changes.StableKey and not changes.Each, "LUI virtual list StableKey/Each require rebuilding the template")
        if changes.ScrollState then virtual:SetState(changes.ScrollState.value or {}) end
        if changes.Items then
            if changes.Items.relativePaths and virtual.ApplyChanges then
                virtual:ApplyChanges(changes.Items.value or {}, changes.Items.relativePaths)
            else virtual:SetItems(changes.Items.value or {}) end
        end
        if changes.SelectedKey then virtual:SetSelectedKey(changes.SelectedKey.value) end
    end
    for source in pairs(changes) do
        local keys = targets[source]
        if keys then
            local wrapped=source=='Margin' or source=='Padding' or source=='Background' or source=='Visible'
            local control=not wrapped and widget.luiNativeWidget_ or widget
            if source == 'Variant' and tag == 'Button' then
                ButtonVariant.Apply(control, resolved.variant)
            else
                local controlProps=control.props
                local style = {}
                for _, key in ipairs(keys) do
                    local target = tag == "TextField" and key == "fontColor" and "textColor" or key
                    local value = resolved[key]
                    -- SetStyle cannot express nil; clear removed values explicitly.
                    controlProps[target] = value
                    if value ~= nil then style[target] = value end
                end
                if control.SetStyle then control:SetStyle(style) end
            end
            if source=='Disabled' and control.SetDisabled then control:SetDisabled(resolved.disabled==true) end
        end
    end
    BuiltinValues.Apply(widget,tag,changes)
    if changes.Text and (tag == "Text" or tag == "Button" or tag == "TextField") then
        local text = resolved.text == nil and "" or tostring(resolved.text)
        if tag == "TextField" then
            props.value = text
            -- A shorter external value must not leave a caret beyond its end.
            local state = widget.state
            if state then
                local length = utf8.len(text) or #text
                for _, key in ipairs({"cursorPos","selectionStart","selectionEnd"}) do
                    if type(state[key]) == "number" then state[key] = math.min(state[key], length) end
                end
            end
        elseif widget.SetText then widget:SetText(text)
        else props.text = text end
    end
    if changes.Background then
        local raw = changes.Background.value
        -- The renderer reads the active state's current props on every draw.
        -- Attaching remains safe when a bound main background becomes nil.
        Brush.AttachBackground(widget, raw ~= nil and Brush.Require(raw,"背景") or nil)
        widget.luiBackgroundBrush_ = raw == nil and nil or tostring(raw)
        if tag == "Button" then
            local authored=widget.luiBrushAttrs_ or widget.luiAttrs_ or {}
            if authored.HoverBackground == nil then
                props.hoverBackgroundColor,props.hoverBackgroundGradient = props.backgroundColor,props.backgroundGradient
            end
            if authored.PressedBackground == nil then
                props.pressedBackgroundColor,props.pressedBackgroundGradient = props.backgroundColor,props.backgroundGradient
            end
        end
    end
    if tag ~= "Toggle" and tag ~= "Slider" and tag ~= "Progress" then
        NativeControls.Apply(widget, tag, changes, resolved)
    end
end

function LiveProps.Apply(widget, tag, changes, resolved)
    local kind = LiveProps.Classify(widget, tag, changes, resolved)
    Measure.BeginBatch()
    local ok, err = pcall(apply, widget, tag, changes, resolved)
    -- Apply may have written an earlier property before a native setter fails.
    -- Keep its geometry caches valid even while forwarding that error.
    if kind == "geometry" or kind == "structure" then Measure.Invalidate(widget) end
    Measure.EndBatch()
    if not ok then error(err, 0) end
    return kind
end

return LiveProps
