-- The declaration renderer and native descendants use the same frame budget.
local Budget = require('LUI.MeasureBudget')
local Measure = require('LUI.Measure')
local RenderBudget = {}
local empty = {}

function RenderBudget.Attach(widget, runtime, onDeferred)
    if not widget then return end
    if onDeferred then widget.luiBudgetOnDeferred_ = onDeferred end
    if widget.luiBudgetGuard_ then return end
    widget.luiBudgetGuard_ = true
    local budget = Budget.Get(runtime)
    widget.luiNativeMeasureBudget_ = budget
    local render, children, hit, custom = widget.Render, widget.GetRenderChildren, widget.GetHitTestChildren, widget.CustomRenderChildren
    -- Input may arrive before the next Render. Keep incomplete geometry hidden
    -- until that node actually retries, rather than merely advancing a token.
    local function deferred(self) return self.luiRenderDeferredFrame_ ~= nil end
    local function wrapRender(method)
        return function(self, nvg)
            self.luiRenderDeferredFrame_ = nil
            local fontVersion = self.fontVersion_
            local ok, result = Budget.Guard(budget, function() return method(self, nvg) end, self)
            if not ok then
                -- Retry incomplete arrangement next frame and hide its partial
                -- geometry from drawing and hit testing in this frame.
                self.luiArrangedStamp_ = nil
                self.fontVersion_ = fontVersion
                self.luiRenderDeferredFrame_ = budget.frame
                if self.luiBudgetOnDeferred_ then self.luiBudgetOnDeferred_() end
                return
            end
            return result
        end
    end
    if render then widget.Render = wrapRender(render) end
    -- Native overlays queue these passes after their ordinary Render returns.
    for _, name in ipairs({ "RenderModalContent", "RenderTooltip", "RenderDropdownPanel",
        "RenderPopoverContent", "RenderCalendar", "RenderPopup", "RenderDrawerContent" }) do
        if widget[name] then widget[name] = wrapRender(widget[name]) end
    end
    function widget:GetRenderChildren()
        if deferred(self) then return empty end
        if children then return children(self) end
        return self.GetChildren and self:GetChildren() or empty
    end
    function widget:GetHitTestChildren()
        if deferred(self) then return empty end
        if hit then return hit(self) end
        return self.GetChildren and self:GetChildren() or empty
    end
    if custom then
        function widget:CustomRenderChildren(nvg, renderChild)
            if not deferred(self) then return custom(self, nvg, renderChild) end
        end
    end
    local hitTest = widget.HitTest
    if hitTest then
        function widget:HitTest(...)
            if deferred(self) then return false end
            return hitTest(self, ...)
        end
    end
    local destroy = widget.Destroy
    if destroy then
        function widget:Destroy(...)
            self.luiBudgetOnDeferred_, self.luiRenderDeferredFrame_, self.luiNativeMeasureBudget_ = nil, nil, nil
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
