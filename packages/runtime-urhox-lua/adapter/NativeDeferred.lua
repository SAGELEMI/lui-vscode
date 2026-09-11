-- Native ChatWindow owns RichText outside GetChildren; its ItemTooltip is a
-- global singleton. Bridge only these supported deferred native entry points.
local UI = require('urhox-libs/UI')
local Budget = require('LUI.MeasureBudget')
local NativeText = require('LUI.NativeText')
local RenderBudget = require('LUI.RenderBudget')
local Deferred = {}
local tooltip, scopedTooltipOwner, tooltipBudget, tooltipCache
local tooltipOwner = setmetatable({}, { __mode = 'v' })
local tooltipOwned = false

local function clearTooltipOwner()
    tooltipOwner[1], tooltipBudget, tooltipCache, tooltipOwned = nil, nil, nil, false
end

local function expireTooltip()
    tooltip.Hide()
    -- Native Hide fades while retaining the item. A disposed owner has no
    -- drawable tooltip; finish through its public update to release that item.
    tooltip:Update(1)
    clearTooltipOwner()
end

local function installTooltip()
    if tooltip then return end
    local candidate = require('urhox-libs/UI/Components/ItemTooltip')
    if type(candidate.Show) ~= 'function' or type(candidate.Render) ~= 'function' then return end
    tooltip = candidate
    local show, render, update = tooltip.Show, tooltip.Render, tooltip.Update
    function tooltip.Show(item, bounds)
        local result = show(item, bounds)
        if item then
            clearTooltipOwner()
            if scopedTooltipOwner and not scopedTooltipOwner.luiNativeDeferredDisposed_ then
                tooltipOwner[1], tooltipOwned = scopedTooltipOwner, true
                tooltipBudget = scopedTooltipOwner.luiChatBudget_
                tooltipCache = {}
            end
        end
        return result
    end
    function tooltip:Update(dt)
        local result = update(self, dt)
        if tooltipOwned and not self.IsVisible() then clearTooltipOwner() end
        return result
    end
    function tooltip:Render(nvg)
        if not tooltipOwned then return render(self, nvg) end
        local owner = tooltipOwner[1]
        if not owner or owner.luiNativeDeferredDisposed_ then expireTooltip(); return end
        -- The global tooltip is already visible and therefore committed even
        -- though it is rendered outside its ChatWindow owner's normal tree.
        local ok, result = Budget.GuardCommitted(tooltipBudget, function() return render(self, nvg) end, tooltipCache)
        if not ok then error("committed tooltip render was interrupted", 0) end
        return result
    end
end

function Deferred.Attach(widget, tag, runtime)
    if tag ~= 'ChatWindow' or not widget or widget.luiNativeDeferred_ then return widget end
    widget.luiNativeDeferred_ = true
    widget.luiChatBudget_ = Budget.Get(runtime)
    -- The lightweight bridge retains only the budget, never a Runtime/context.
    local bridge = { luiMeasureBudget_ = widget.luiChatBudget_ }
    local recalculate, render, clear = widget.RecalculateLayout, widget.Render, widget.ClearMessages
    local show, destroy = widget.ShowItemTooltip, widget.Destroy
    installTooltip()
    widget.luiChatNeedsLayout_ = true

    function widget:RecalculateLayout()
        if self.luiNativeDeferredDisposed_ then return end
        -- AddMessage completes its native collection mutation even when input
        -- arrives after the current slice. Geometry commits before its draw.
        self.luiChatNeedsLayout_, self.luiChatLayoutJob_ = true, nil
    end

    local function flush(self)
        local layout = self:GetLayout()
        if not layout or layout.w <= 0 then return end
        local version = UI.GetFontVersion and UI.GetFontVersion()
        local job = self.luiChatLayoutJob_
        if not job or job.width ~= layout.w or job.fontVersion ~= version then
            job = { index = 1, y = #self.messages_ > 0 and self.props.messageGap or 0,
                width = layout.w, fontVersion = version }
            self.luiChatLayoutJob_ = job
        end
        while job.index <= #self.messages_ do
            local message = self.messages_[job.index]
            local messages, height = self.messages_, self.contentHeight_
            -- Reuse native row geometry, with a resumable scalar cursor between
            -- messages. Always restore the full collection on budget pauses.
            self.messages_ = { message }
            local result = table.pack(pcall(NativeText.WithOwner, message, recalculate, self))
            self.messages_, self.contentHeight_ = messages, height
            if message.richText then RenderBudget.AttachTree(message.richText, bridge) end
            if not result[1] then error(result[2], 0) end
            message.y = job.y
            job.y = job.y + message.height + self.props.messageGap
            job.index = job.index + 1
        end
        self.contentHeight_, self.lastLayoutWidth_, self.luiChatFontVersion_ = job.y, layout.w, version
        self.luiChatNeedsLayout_, self.luiChatLayoutJob_ = false, nil
        if self.autoScroll_ then self:ScrollToBottom() end
    end

    function widget:Render(nvg)
        if self.luiNativeDeferredDisposed_ then return end
        local layout = self:GetLayout()
        if layout and (self.lastLayoutWidth_ ~= layout.w
            or self.luiChatFontVersion_ ~= (UI.GetFontVersion and UI.GetFontVersion())) then
            self.luiChatNeedsLayout_ = true
        end
        if self.luiChatNeedsLayout_ then flush(self) end
        return render(self, nvg)
    end

    function widget:ClearMessages(...)
        self.luiChatLayoutJob_, self.luiChatNeedsLayout_ = nil, false
        return clear(self, ...)
    end

    function widget:ShowItemTooltip(...)
        if self.luiNativeDeferredDisposed_ then return end
        local previous = scopedTooltipOwner
        scopedTooltipOwner = self
        local result = table.pack(pcall(show, self, ...))
        scopedTooltipOwner = previous
        if not result[1] then error(result[2], 0) end
        return table.unpack(result, 2, result.n)
    end

    function widget:Destroy(...)
        if self.luiNativeDeferredDisposed_ then return end
        self.luiNativeDeferredDisposed_ = true
        if tooltipOwned and tooltipOwner[1] == self then expireTooltip() end
        self.luiChatLayoutJob_, self.luiChatBudget_ = nil, nil
        return destroy(self, ...)
    end
    return widget
end

return Deferred
