-- A caller owns its session table. This adapter owns restore/follow mechanics only.
local ScrollState = {}

function ScrollState.AttachScroll(scroll, state)
    if not scroll then return function() end end
    local saved, restoring = math.max(0, tonumber(state.scrollY) or 0), true
    local oldScroll, oldUpdate = scroll.props.onScroll, scroll.Update
    scroll.props.bounces = false
    local lastWidth, lastHeight, lastContentWidth, lastContentHeight
    local onScroll = function(widget, x, y)
        if not restoring then state.scrollY = math.max(0, y) end
        if oldScroll then oldScroll(widget, x, y) end
    end
    local update = function(widget, dt)
        if oldUpdate then oldUpdate(widget, dt) end
        local layout = widget:GetLayout()
        if widget.luiEntries_ and not widget.luiLayoutProbe_ then return end
        if layout.h <= 0 or layout.w <= 0 then return end
        local width, height = widget:GetContentSize()
        if restoring and height <= 0 and #widget:GetChildren() > 0 then return end
        local changed = layout.w ~= lastWidth or layout.h ~= lastHeight or width ~= lastContentWidth or height ~= lastContentHeight
        if not restoring and not changed then return end
        local x, y = widget:GetScroll()
        local target = math.min(math.max(0, height - layout.h), restoring and saved or math.max(0, y))
        local targetX = math.min(math.max(0, width - layout.w), math.max(0, x))
        if y ~= target or x ~= targetX then widget:SetScroll(targetX, target) end
        restoring, state.scrollY = false, target
        lastWidth, lastHeight, lastContentWidth, lastContentHeight = layout.w, layout.h, width, height
    end
    scroll.props.onScroll, scroll.Update = onScroll, update
    return function()
        if scroll.props.onScroll == onScroll then scroll.props.onScroll = oldScroll end
        if scroll.Update == update then scroll.Update = oldUpdate end
    end
end

function ScrollState.AttachFollowingScroll(scroll, state, options)
    if not scroll then return function() end end
    local threshold = options and options.threshold or 12
    state.follow = state.follow ~= false
    local programmatic = false
    local oldScroll, oldUpdate = scroll.props.onScroll, scroll.Update
    scroll.props.bounces = false
    local onScroll = function(widget, x, y)
        if not programmatic then
            local _, height = widget:GetContentSize()
            state.scrollY = math.max(0, y)
            state.follow = math.max(0, height - widget:GetLayout().h) - y <= threshold
        end
        if oldScroll then oldScroll(widget, x, y) end
    end
    local update = function(widget, dt)
        if oldUpdate then oldUpdate(widget, dt) end
        local layout = widget:GetLayout()
        if layout.w <= 0 or layout.h <= 0 then return end
        local _, height = widget:GetContentSize()
        local maximum = math.max(0, height - layout.h)
        local target = state.follow and maximum or math.min(maximum, math.max(0, state.scrollY or 0))
        programmatic = true
        widget:SetScroll(0, target)
        programmatic = false
        local _, actual = widget:GetScroll()
        state.scrollY = actual
    end
    scroll.props.onScroll, scroll.Update = onScroll, update
    return function()
        if scroll.props.onScroll == onScroll then scroll.props.onScroll = oldScroll end
        if scroll.Update == update then scroll.Update = oldUpdate end
    end
end

return ScrollState
