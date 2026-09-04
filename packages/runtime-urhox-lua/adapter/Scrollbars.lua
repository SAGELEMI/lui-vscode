-- ScrollView 渲染适配：四种可见性按轴独立生效；保留 UI 库原有滚轮、触控和拖拽处理。
-- 空内容的“显示”绘制满轨道指示条，不伪造内容尺寸或可滚动距离。
local Scrollbars = {}

function Scrollbars.Attach(widget, horizontal, vertical, tint)
    local originalRender = widget.Render
    widget.Render = function(view, nvg)
        if horizontal == "显示" or vertical == "显示" then view.scrollbarOpacity_ = 1 end
        return originalRender(view, nvg)
    end
    widget.RenderScrollbars = function(view, nvg)
        local bounds, hit = view:GetAbsoluteLayout(), view:GetAbsoluteLayoutForHitTest()
        local contentW, contentH = view:GetContentSize()
        local x, y = view:GetScroll()
        view.vScrollbarBounds_, view.hScrollbarBounds_ = nil, nil
        view.vTrackBounds_, view.hTrackBounds_ = nil, nil
        local function axis(verticalAxis, mode, extent, viewport, offset)
            if mode == "隐藏" or mode == "禁用" or (mode ~= "显示" and extent <= viewport) then return end
            local thickness, inset = view.props.scrollbarInteractive and 10 or 6, 2
            local length = math.max(0, viewport - inset * 2)
            if length <= 0 then return end
            local maximum = math.max(0, extent - viewport)
            local thumb = math.min(length, math.max(30, extent > 0 and length * viewport / extent or length))
            local position = maximum > 0 and (length - thumb) * math.max(0, math.min(1, offset / maximum)) or 0
            local tx = verticalAxis and bounds.x + bounds.w - thickness - inset or bounds.x + inset
            local ty = verticalAxis and bounds.y + inset or bounds.y + bounds.h - thickness - inset
            local bx, by = tx + (verticalAxis and 0 or position), ty + (verticalAxis and position or 0)
            local tw, th = verticalAxis and thickness or length, verticalAxis and length or thickness
            local bw, bh = verticalAxis and thickness or thumb, verticalAxis and thumb or thickness
            -- 仅有可滚动距离时提供库的命中缓存；原库手势与滚动条事件继续使用这些边界。
            if maximum > 0 then
                local track = { x = tx + hit.x - bounds.x, y = ty + hit.y - bounds.y, w = tw, h = th }
                local bar = { x = bx + hit.x - bounds.x, y = by + hit.y - bounds.y, w = bw, h = bh }
                if verticalAxis then view.vTrackBounds_, view.vScrollbarBounds_ = track, bar
                else view.hTrackBounds_, view.hScrollbarBounds_ = track, bar end
            end
            local alpha = mode == "显示" and 255 or math.floor(255 * (view.scrollbarOpacity_ or 0))
            nvgBeginPath(nvg)
            nvgRoundedRect(nvg, tx, ty, tw, th, thickness / 2)
            nvgFillColor(nvg, nvgRGBA(37, 24, 58, alpha))
            nvgFill(nvg)
            local color = tint or { 128, 128, 128, 255 }
            nvgBeginPath(nvg)
            nvgRoundedRect(nvg, bx, by, bw, bh, thickness / 2)
            nvgFillColor(nvg, nvgRGBA(color[1], color[2], color[3], math.floor(alpha * (color[4] or 255) / 255)))
            nvgFill(nvg)
        end
        axis(true, vertical, contentH, bounds.h, y)
        axis(false, horizontal, contentW, bounds.w, x)
    end
end

return Scrollbars
