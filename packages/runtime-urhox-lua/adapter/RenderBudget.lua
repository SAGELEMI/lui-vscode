-- The declaration renderer and native descendants use the same frame budget.
local Budget = require('LUI.MeasureBudget')
local Measure = require('LUI.Measure')
local RenderBudget = {}
local empty = {}

function RenderBudget.Attach(widget, runtime, onDeferred)
    if not widget then return end
    if widget.luiBudgetGuard_ then return end
    widget.luiBudgetGuard_ = true
    local budget = Budget.Get(runtime)
    widget.luiNativeMeasureBudget_ = budget
    local render, children, hit = widget.Render, widget.GetRenderChildren, widget.GetHitTestChildren
    -- Visible rendering is never cancelled by the progressive measurement
    -- quota. Cold pages, dynamic rows and first-open overlays all finish their
    -- current draw; background/preload measurement remains budgeted.
    local function wrapRender(method, phase)
        return function(self, nvg)
            self.luiRenderDeferredFrame_, self.luiDeferredRenderPhases_ = nil, nil
            local ok, result = Budget.GuardCommitted(budget, function() return method(self, nvg) end, self)
            if not ok then error("uninterruptible render unexpectedly exhausted its measurement budget", 0) end
            self.luiCommittedRenderPhases_ = self.luiCommittedRenderPhases_ or {}
            self.luiCommittedRenderPhases_[phase] = true
            return result
        end
    end
    if render then widget.Render = wrapRender(render, "Render") end
    -- Native overlays queue these passes after their ordinary Render returns.
    for _, name in ipairs({ "RenderModalContent", "RenderTooltip", "RenderDropdownPanel",
        "RenderPopoverContent", "RenderCalendar", "RenderPopup", "RenderDrawerContent" }) do
        if widget[name] then widget[name] = wrapRender(widget[name], name) end
    end
    function widget:GetRenderChildren()
        if children then return children(self) end
        return self.GetChildren and self:GetChildren() or empty
    end
    function widget:GetHitTestChildren()
        if hit then return hit(self) end
        return self.GetChildren and self:GetChildren() or empty
    end
    local destroy = widget.Destroy
    if destroy then
        function widget:Destroy(...)
            self.luiBudgetOnDeferred_, self.luiRenderDeferredFrame_, self.luiNativeMeasureBudget_ = nil, nil, nil
            self.luiDeferredRenderPhases_, self.luiCommittedRenderPhases_ = nil, nil
            return destroy(self, ...)
        end
    end
end

function RenderBudget.AttachTree(root, runtime, onDeferred)
    local seen = {}
    local function visit(widget)
        if not widget or seen[widget] then return end
        seen[widget] = true
        -- Read native descendants before installing deferred accessors.
        local children = widget.GetChildren and widget:GetChildren() or empty
        local hit = widget.GetHitTestChildren and widget:GetHitTestChildren() or empty
        if widget.props then Measure.Observe(widget) end
        RenderBudget.Attach(widget, runtime, onDeferred)
        for _, child in ipairs(children) do visit(child) end
        for _, child in ipairs(hit) do visit(child) end
        for _, child in ipairs(widget.bodyChildren_ or empty) do visit(child) end
        visit(widget.contentContainer_)
        visit(widget.luiNativeWidget_)
    end
    visit(root)
end

return RenderBudget
