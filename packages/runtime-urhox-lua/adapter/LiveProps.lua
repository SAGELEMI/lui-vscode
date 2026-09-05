-- Reapply data-bound scalar properties without replacing widgets, focus or
-- scroll state. Native value setters emit business events, so source-to-view
-- updates intentionally write props and never synthesize an input event.
local Brush = require("LUI.Brush")
local BuiltinValues = require("LUI.BuiltinValues")
local NativeControls = require("LUI.NativeControls")
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
    Background={"backgroundColor","backgroundGradient"},
    HoverBackground={"hoverBackgroundColor","hoverBackgroundGradient"},
    PressedBackground={"pressedBackgroundColor","pressedBackgroundGradient"},
    RenderTransform={"scale","rotate","translateX","translateY","transformOrigin"},
    LayoutTransform={"scale","rotate","transformOrigin"},
    RenderTransformOrigin={"transformOrigin"},
}

function LiveProps.Apply(widget, tag, changes, resolved)
    local props = widget.props
    for source in pairs(changes) do
        local keys = targets[source]
        if keys then
            local wrapped=source=='Margin' or source=='Padding' or source=='Background' or source=='Visible'
            local control=not wrapped and widget.luiNativeWidget_ or widget
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
            if source=='Disabled' and control.SetDisabled then control:SetDisabled(resolved.disabled==true) end
        end
    end
    BuiltinValues.Apply(widget,tag,changes,resolved)
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

return LiveProps
