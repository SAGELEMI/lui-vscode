-- Keep native ProgressBar value/setter behavior; draw the LUI contract instead
-- of the native hard-coded theme track and square trailing fill corners.
local defaults = require("LUI.Contract").defaults.progress
local Brush = require("LUI.Brush")
local Progress = {}
function Progress.Attach(widget)
    function widget:Render(nvg)
        local rect, props = self:GetAbsoluteLayout(), self.props
        local left, top, right, bottom = require("LUI.Measure").Insets(props)
        local x, y = rect.x + left, rect.y + top
        local width, height = math.max(0, rect.w-left-right), math.max(0, rect.h-top-bottom)
        local value = self.renderProps_ and self.renderProps_.value or props.value
        local ratio = math.max(0, math.min(1, value / math.max(1, props.max)))
        local radius = math.min(props.borderRadius or defaults.borderRadius, width/2, height/2)
        local track = props.luiTrackBrush or { kind = "solid", color = defaults.track }
        nvgBeginPath(nvg)
        nvgRoundedRect(nvg, x, y, width, height, radius)
        Brush.Fill(nvg, track, x, y, width, height)
        nvgFill(nvg)
        if ratio > 0 then
            local direction = props.luiProgressDirection or "从左到右"
            local fillX, fillY, fillWidth, fillHeight = x, y, width * ratio, height
            if direction == "从右到左" then fillX = x + width - fillWidth
            elseif direction == "从上到下" then fillWidth, fillHeight = width, height * ratio
            elseif direction == "从下到上" then fillWidth, fillHeight, fillY = width, height * ratio, y + height - height * ratio end
            nvgBeginPath(nvg)
            nvgRoundedRect(nvg, fillX, fillY, fillWidth, fillHeight, math.min(radius, fillWidth/2, fillHeight/2))
            Brush.Fill(nvg, props.luiFillBrush or { kind = "linear", angle = 90, from = defaults.from, to = defaults.to, fromOffset = 0, toOffset = 1 }, fillX, fillY, fillWidth, fillHeight)
            nvgFill(nvg)
        end
        if (props.borderWidth or 0) > 0 then
            local border = props.borderColor or defaults.track
            local half = props.borderWidth/2
            nvgBeginPath(nvg)
            nvgRoundedRect(nvg, rect.x+half, rect.y+half, math.max(0,rect.w-2*half), math.max(0,rect.h-2*half), radius)
            nvgStrokeColor(nvg, nvgRGBA(border[1],border[2],border[3],border[4] or 255))
            nvgStrokeWidth(nvg,props.borderWidth)
            nvgStroke(nvg)
        end
    end
end
return Progress
