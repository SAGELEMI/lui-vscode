local Widget = require("urhox-libs/UI/Core/Widget")

local Brush = {}

local function parseColor(value)
    if type(value) ~= "string" then return nil end
    local hex = value:match("^#([0-9a-fA-F]+)$")
    if not hex or (#hex ~= 6 and #hex ~= 8) then return nil end
    if #hex == 6 then hex = hex .. "ff" end
    return { tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16), tonumber(hex:sub(7, 8), 16) }
end

function Brush.Color(value)
    return parseColor(value)
end

function Brush.Parse(value)
    local solid = parseColor(value)
    if solid then return { kind = "solid", color = solid, source = value } end
    if type(value) ~= "string" then return nil end
    local angleText, first, firstOffsetText, second, secondOffsetText = value:match("^linear%-gradient%(%s*(-?[%d%.]+)deg%s*,%s*(#[0-9a-fA-F]+)%s+([%d%.]+)%%%s*,%s*(#[0-9a-fA-F]+)%s+([%d%.]+)%%%s*%)$")
    local from, to = parseColor(first), parseColor(second)
    local angle, firstOffset, secondOffset = tonumber(angleText), tonumber(firstOffsetText), tonumber(secondOffsetText)
    if not angle or not from or not to or not firstOffset or not secondOffset or firstOffset < 0 or secondOffset > 100 or firstOffset >= secondOffset then return nil end
    angle = ((angle % 360) + 360) % 360
    return { kind = "linear", angle = angle, from = from, to = to, fromOffset = firstOffset / 100, toOffset = secondOffset / 100, source = value }
end

function Brush.Require(value, attributeName)
    local parsed = Brush.Parse(value)
    if not parsed then error("LUI " .. tostring(attributeName or "画刷") .. " 无效：" .. tostring(value)) end
    return parsed
end

function Brush.ApplyBackground(props, brush)
    if not brush then return end
    if brush.kind == "solid" then
        props.backgroundColor, props.backgroundGradient = brush.color, nil
    else
        props.backgroundColor = false
        props.backgroundGradient = { type = "linear", direction = brush.angle, from = brush.from, to = brush.to, fromOffset = brush.fromOffset, toOffset = brush.toOffset }
    end
end

local function endpoints(angle, x, y, width, height, fromOffset, toOffset)
    local sx, sy, ex, ey = Widget.ResolveGradientDirection(angle, x, y, width, height)
    local dx, dy = ex - sx, ey - sy
    return sx + dx * fromOffset, sy + dy * fromOffset, sx + dx * toOffset, sy + dy * toOffset
end

function Brush.Fill(nvg, brush, x, y, width, height)
    if brush.kind == "solid" then
        local color = brush.color
        nvgFillColor(nvg, nvgRGBA(color[1], color[2], color[3], color[4] or 255))
        return
    end
    local sx, sy, ex, ey = endpoints(brush.angle, x, y, width, height, brush.fromOffset or 0, brush.toOffset or 1)
    nvgFillPaint(nvg, nvgLinearGradient(nvg, sx, sy, ex, ey,
        nvgRGBA(brush.from[1], brush.from[2], brush.from[3], brush.from[4] or 255),
        nvgRGBA(brush.to[1], brush.to[2], brush.to[3], brush.to[4] or 255)))
end

function Brush.AttachBackground(widget, brush, attrs)
    if not widget then return end
    if attrs then widget.luiBrushAttrs_ = attrs end
    if widget.luiBrushAttached_ then return end
    widget.luiBrushAttached_ = true
    local nativeGradient = widget.RenderGradientBackground
    function widget:RenderGradientBackground(nvg, geom, gradient)
        -- The active state supplies the paint. Capturing the construction-time
        -- main brush here would replace hover/pressed paints and retain stale
        -- colors after a bound gradient changes or is cleared.
        if not gradient or gradient.type == "radial" then
            if nativeGradient then return nativeGradient(self,nvg,geom,gradient) end
            return
        end
        local active = {kind="linear",angle=gradient.direction or "to-bottom",
            from=gradient.from,to=gradient.to,fromOffset=gradient.fromOffset or 0,toOffset=gradient.toOffset or 1}
        if not active.from or not active.to then return end
        self:CreateShapePath(nvg, geom)
        Brush.Fill(nvg, active, geom.x, geom.y, geom.w, geom.h)
        nvgFill(nvg)
    end
    if widget._className ~= "Button" and widget.luiText_ ~= "Button" then return end
    local nativeBackground=widget.RenderFullBackground
    if not nativeBackground then return end
    function widget:RenderFullBackground(nvg, overrides)
        local authored,props,state=self.luiBrushAttrs_ or {},self.props,self.state or {}
        local prefix
        if not props.disabled and state.pressed and authored.PressedBackground~=nil then prefix="pressed"
        elseif not props.disabled and not state.pressed and state.hovered and authored.HoverBackground~=nil then prefix="hover" end
        local solid,gradient
        if prefix then solid,gradient=props[prefix.."BackgroundColor"],props[prefix.."BackgroundGradient"] end
        if solid==nil and gradient==nil and authored.Background~=nil then
            solid,gradient=props.backgroundColor,props.backgroundGradient
        end
        if solid==nil and gradient==nil then return nativeBackground(self,nvg,overrides) end
        local resolved={}
        for key,value in pairs(overrides or {}) do resolved[key]=value end
        resolved.backgroundColor=solid or {0,0,0,0}
        resolved.backgroundGradient=gradient
        -- Native RenderFullBackground uses `override or props`, so neither nil
        -- nor false suppresses a main gradient. Scope that fallback to this
        -- draw and restore it even if the native method raises.
        local previousGradient=props.backgroundGradient
        props.backgroundGradient=gradient
        local result=table.pack(pcall(nativeBackground,self,nvg,resolved))
        props.backgroundGradient=previousGradient
        if not result[1] then error(result[2],0) end
        return table.unpack(result,2,result.n)
    end
end

return Brush
