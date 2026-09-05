-- Keep the native button's state/decorations/events, replacing only its caption.
-- Rendering uses the existing UI NanoVG context; no global hooks or engine edits.
local UI = require("urhox-libs/UI")
local Measure = require("LUI.Measure")
local Typography = require("LUI.Typography")
---@type { defaults: { lineHeight: number, button: { textHorizontalAlignment: string, textVerticalAlignment: string, disabledTextColor: number[] } } }
local Contract = require("LUI.Contract")
local Caption = {}
local horizontal = { ["左"] = 0, ["居中"] = 0.5, ["右"] = 1 }
local vertical = { ["上"] = 0, ["居中"] = 0.5, ["下"] = 1 }

function Caption.Validate(value, axis)
    local options = axis == "x" and horizontal or vertical
    local default = axis == "x" and Contract.defaults.button.textHorizontalAlignment or Contract.defaults.button.textVerticalAlignment
    value = value == nil and default or value
    if options[value] == nil then error("LUI 按钮文字" .. (axis == "x" and "左右" or "上下") .. "对齐值无效：" .. tostring(value)) end
    return value
end

function Caption.Attach(widget, refresh)
    widget.luiRefreshCaption_ = refresh
    local baseRender = widget.Render
    function widget:Render(nvg)
        if refresh then refresh(self) end
        local props = self.props
        local text = tostring(props.text or "")
        -- Native Render reads props.text directly. Restore it even if drawing fails;
        -- setters, measurement and callers must always see the real caption.
        props.text = ""
        local ok, err = pcall(baseRender, self, nvg)
        props.text = text
        if not ok then error(err, 0) end
        if text == "" then return end
        local rect = self:GetAbsoluteLayout()
        local left, top, right, bottom = Measure.Insets(props)
        local w, h = math.max(0, rect.w-left-right), math.max(0, rect.h-top-bottom)
        if w == 0 or h == 0 then return end
        local fontSize = UI.Theme.FontSize(props.fontSize)
        local fontFace = UI.Theme.FontFace(props.fontFamily or "sans", props.fontWeight)
        local lineHeight = fontSize * Contract.defaults.lineHeight
        local hx = horizontal[Caption.Validate(props.textHorizontalAlignment, "x")]
        local vy = vertical[Caption.Validate(props.textVerticalAlignment, "y")]
        local x = rect.x + left + w * hx
        local y = rect.y + top + (h-lineHeight) * vy + lineHeight/2
        local ink = props.disabled and (props.disabledTextColor or Contract.defaults.button.disabledTextColor)
            or props.fontColor or props.textColor or {255,255,255,255}
        local inkCompensation = Typography.InkCompensation(props)
        self.luiCaptionProbe_ = { x=x, y=y, width=w, height=h, lineHeight=lineHeight, inkCompensation=inkCompensation }
        self.luiTextRasterMode_ = Typography.TextRasterMode()
        nvgSave(nvg)
        nvgIntersectScissor(nvg, rect.x+left, rect.y+top, w, h)
        nvgFontFace(nvg, fontFace)
        nvgFontSize(nvg, fontSize)
        nvgTextLetterSpacing(nvg, props.letterSpacing or 0)
        local align = hx == 0 and NVG_ALIGN_LEFT or (hx == 1 and NVG_ALIGN_RIGHT or NVG_ALIGN_CENTER_VISUAL)
        nvgTextAlign(nvg, align + NVG_ALIGN_MIDDLE)
        Typography.DrawSingleLine(nvg, x, y, text, ink, props)
        nvgRestore(nvg)
    end
end
return Caption
