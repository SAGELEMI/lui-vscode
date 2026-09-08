-- Values stay live; nested components share their outer render traversal.
local Dirty = require("LUI.Dirty")
local Refresh = { stats = { nodes = 0, captions = 0, skipped = 0 } }
local active

function Refresh.Caption(widget, force)
    if not widget.luiRefreshCaption_ then return end
    if active and active.captions[widget] and not force then return end
    if not force and not Dirty.CaptionPending(widget) then return end
    if active then active.captions[widget] = true end
    local pending = widget.luiDirtyCaption_
    Refresh.stats.captions = Refresh.stats.captions + 1
    widget:luiRefreshCaption_()
    if widget.luiDirtyCaption_ == pending then widget.luiDirtyCaption_ = nil end
end

local visit
local function children(widget, items, force, forced)
    for _, child in ipairs(items or {}) do
        if child ~= widget and not child.luiGlobalOverlay_ then
            visit(child, force, forced)
            if Dirty.Legacy(child) or child.luiDirtyLegacyBelow_ then widget.luiDirtyLegacyBelow_ = true end
        end
    end
end

visit = function(widget, force, forced)
    if force then
        if forced[widget] then return end
        forced[widget] = true
    elseif active.nodes[widget] then return end
    if not force and not Dirty.ShouldVisit(widget) then Refresh.stats.skipped = Refresh.stats.skipped + 1; return end
    active.nodes[widget] = true
    widget.luiDirtyVisited_ = true
    local pending, branch, all = widget.luiDirtySelf_, widget.luiDirtyBranch_, widget.luiDirtyAll_
    local wasCollapsed = widget.props and widget.props.visible == false
    Refresh.stats.nodes = Refresh.stats.nodes + 1
    if widget.luiRefreshLayout_ and (force or widget.luiDirtyEnabled_ ~= true or pending ~= nil) then widget:luiRefreshLayout_() end
    -- Visibility updates before skipping descendants, so reopening a branch
    -- applies every pending value before its first layout.
    local props = widget.props or {}
    if props.visible == false then
        if widget.luiDirtySelf_ == pending then widget.luiDirtySelf_, widget.luiDirtyChanges_ = nil, nil end
        if widget.luiDirtyBranch_ == branch then widget.luiDirtyBranch_ = nil end
        if widget.luiDirtyAll_ == all then widget.luiDirtyAll_ = nil end
        return
    end
    Refresh.Caption(widget, force)
    -- Hidden still occupies layout space: its descendants must keep geometry
    -- current. Only collapsed branches suspend work, and wake as one subtree.
    local descendants = force or all ~= nil or wasCollapsed
    if descendants then forced = forced or {}; forced[widget] = true end
    widget.luiDirtyLegacyBelow_ = false
    children(widget, widget.GetChildren and widget:GetChildren(), descendants, forced)
    if widget.GetHitTestChildren then children(widget, widget:GetHitTestChildren(), descendants, forced) end
    children(widget, widget.bodyChildren_, descendants, forced)
    if widget.luiDirtySelf_ == pending then widget.luiDirtySelf_, widget.luiDirtyChanges_ = nil, nil end
    if widget.luiDirtyBranch_ == branch then widget.luiDirtyBranch_ = nil end
    if widget.luiDirtyAll_ == all then widget.luiDirtyAll_ = nil end
    widget.luiDirtySuspended_ = nil
end

local measureModule
local function batchedVisit(widget, force)
    -- Late require avoids the Measure -> Refresh initialization cycle and uses
    -- the engine resource loader's canonical cache (which normalizes dot paths).
    if not measureModule then measureModule = require('LUI.Measure') end
    local measure = measureModule
    if measure and measure.BeginBatch then measure.BeginBatch() end
    local ok, err = pcall(visit, widget, force, force and {} or nil)
    if measure and measure.EndBatch then measure.EndBatch() end
    if not ok then error(err, 0) end
end

function Refresh.Subtree(widget, force)
    local owner = active == nil
    if owner then active = { nodes = {}, captions = {} } end
    local ok, err = pcall(batchedVisit, widget, force)
    if owner then active = nil end
    if not ok then error(err, 0) end
end

function Refresh.Render(widget, render, nvg)
    if not active and not Dirty.ShouldVisit(widget) then
        Refresh.stats.skipped = Refresh.stats.skipped + 1
        return render(widget, nvg)
    end
    local owner = active == nil
    if owner then active = { nodes = {}, captions = {} } end
    local ok, result = pcall(function()
        batchedVisit(widget)
        return render(widget, nvg)
    end)
    if owner then active = nil end
    if not ok then error(result, 0) end
    return result
end

return Refresh
