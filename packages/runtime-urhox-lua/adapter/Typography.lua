local Contract = require("LUI.Contract")
local Brush = require("LUI.Brush")

-- Ordinary LUI text keeps one fill pass. An explicitly requested outline uses
-- Label's native eight-direction stroke, then one fill; it is not fake bold.
---@class LuiTypography
---@field InkCompensation fun(props: table?): number
---@field TextRasterMode fun(): string
---@field ApplyLabel fun(props: table?)
---@field AttachLabel fun(widget: any)
---@field DrawSingleLine fun(nvg: any, x: number, y: number, text: string, color: number[], props: table?): number
---@type LuiTypography
local Typography = {}
local Fidelity = Contract["renderFidelity"] or {}
local TypographyFidelity = Fidelity["typography"] or {}
local function strokeColor(value)
    if type(value) ~= "table" then return Brush.Color(value) end
    -- Widget.new/Init normalizes every *Color field before Label rendering.
    -- Accept that canonical RGB(A) representation, without accepting bad data.
    if value[5] ~= nil then return nil end
    local color = {}
    for i = 1, 4 do
        local channel = value[i]
        if i == 4 and channel == nil then channel = 255 end
        if type(channel) ~= "number" or channel ~= channel or channel < 0 or channel > 255 then return nil end
        color[i] = channel
    end
    return color
end
function Typography.InkCompensation(props)
    return 0
end

function Typography.TextRasterMode()
    return TypographyFidelity.ownedTextRaster or "nanovg-single-pass"
end

function Typography.ApplyLabel(props)
    if not props then return end
    props.textStroke = nil
    props.luiTextRasterMode = Typography.TextRasterMode()
    local width = tonumber(props.textStrokeWidth)
    if props.textStrokeWidth ~= nil and (not width or width ~= width or width < 0 or width == math.huge) then
        error("LUI 文字描边宽度必须是非负有限数值。")
    end
    local color = strokeColor(props.textStrokeColor)
    if props.textStrokeColor ~= nil and not color then
        error("LUI 文字描边颜色必须是 #RRGGBB 或 #RRGGBBAA。")
    end
    if width and width > 0 and color then
        props.textStroke = { width = width, color = color }
        props.luiTextRasterMode = "nanovg-native-outline-eight-offsets-single-fill"
    end
end

function Typography.AttachLabel(widget)
    Typography.ApplyLabel(widget and widget.props)
    if not widget or widget.luiTypographyAttached_ then return end
    widget.luiTypographyAttached_ = true
    local baseRender = widget.Render
    function widget:Render(nvg)
        Typography.ApplyLabel(self.props)
        return baseRender(self, nvg)
    end
end

function Typography.DrawSingleLine(nvg, x, y, text, color, props)
    nvgFillColor(nvg, nvgRGBA(color[1], color[2], color[3], color[4] or 255))
    nvgText(nvg, x, y, text, nil, false)
    return 0
end

return Typography
