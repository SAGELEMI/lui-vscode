-- Templated, variable-height virtualization. The same authored nodes run in Studio and on device.
local UI = require("urhox-libs/UI")
local Model = require("LUI.WindowedList")
local Measure = require("LUI.Measure")
local Budget = require("LUI.MeasureBudget")
local MeasureQueue = require("LUI.MeasureQueue")
local RenderBudget = require("LUI.RenderBudget")
local Scrollbars = require("LUI.Scrollbars")
local Refresh = require("LUI.Refresh")
local Dirty = require("LUI.Dirty")
local Events = require("LUI.Events")
local Expressions = require("LUI.LayoutExpressions")
local Paths = require("LUI.Paths")
local LiveProps = require("LUI.LiveProps")
local VirtualList = {}
VirtualList.__index = VirtualList
local function finite(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function copy(values)
    local result = {}
    for key, value in pairs(values or {}) do result[key] = value end
    return result
end

function VirtualList.Create(runtime, node, context, helpers)
    if runtime.EnsureFrameScheduler then runtime:EnsureFrameScheduler() end
    local attrs, children = helpers.parts(node)
    local items = helpers.resolve(attrs.Items, context)
    if items == nil and context.luiPreview_ then
        error(tostring(node.sourcePath or "<markup>") .. "#" .. tostring(node.nodePath or "0")
            .. " Items/集合缺失：请提供预览场景数据或绑定预览内容。", 0)
    end
    local scrollAttrs = copy(attrs)
    for _, key in ipairs({"Items", "StableKey", "Each", "SelectedKey", "ScrollState", "Select"}) do scrollAttrs[key] = nil end
    scrollAttrs.HorizontalScrollBarVisibility = scrollAttrs.HorizontalScrollBarVisibility or "禁用"
    scrollAttrs.VerticalScrollBarVisibility = scrollAttrs.VerticalScrollBarVisibility or "自动"
    local scroll = runtime:BuildNodeCore({ kind = "Element", tag = "Scroll", attrs = scrollAttrs, children = {},
        sourcePath = node.sourcePath, nodePath = node.nodePath }, context)
    local self = setmetatable({runtime_ = runtime, node_ = node, attrs_ = attrs, context_ = context, helpers_ = helpers,
        scroll_ = scroll, pool_ = {}, renderChildren_ = {}, state_ = helpers.resolve(attrs.ScrollState, context) or {},
        each_ = helpers.resolve(attrs.Each, context) or "item", keyPath_ = helpers.resolve(attrs.StableKey, context) or "key",
        restoring_ = true, dirty_ = true, template_ = children, templateRevision_ = 1}, VirtualList)
    self.model_ = Model.New({key = function(row) return self:Key(row) end})
    self.model_:SetItems(items or {})
    local selected = helpers.resolve(attrs.SelectedKey, context)
    if selected ~= nil then self.state_.selectedKey = selected end
    -- A newly mounted ScrollView may emit a zero/clamped scroll notification
    -- before its first valid Yoga layout. Preserve the caller-owned anchor in
    -- a private snapshot until the first effective virtual-list update commits.
    self.pendingRestore_ = {
        scrollY = self.state_.scrollY, anchorScrollY = self.state_.anchorScrollY,
        anchorKey = self.state_.anchorKey, anchorIndex = self.state_.anchorIndex,
        anchorOffset = self.state_.anchorOffset,
    }
    self:ReconcileSelection()
    scroll.luiVirtualList_ = self
    scroll.props.bounces = false
    self:Attach()
    self:TrackTemplate()
    for _, name in ipairs({"SetItems", "RefreshRows", "SetState", "SetSelectedKey"}) do
        scroll[name] = function(_, ...) return self[name](self, ...) end
    end
    return scroll
end

function VirtualList:TrackTemplate()
    local dependencies, seen, values, geometry = {}, {}, {}, {}
    local function append(path, source)
        local keys = Paths.Keys(path) or {}
        local first = keys[1]
        if first == self.each_ or first == "item" then
            if not LiveProps.IsPaintSource(source) then
                local suffix = {}
                for index = 2, #keys do suffix[#suffix + 1] = keys[index] end
                geometry[#geometry + 1] = suffix
            end
            return
        end
        if first and first ~= self.each_ and first ~= "item" and first ~= "index" and first ~= "selected" and not seen[path] then
            seen[path], dependencies[#dependencies + 1] = true, path
            values[path] = Paths.Get(self.context_, path)
        end
    end
    local function visit(node, parent)
        local attrs, children = self.helpers_.parts(node)
        local context = Expressions.Scope(attrs, parent)
        for source, value in pairs(attrs) do
          if not source:match("^布局:") then
            local expression = Expressions.Parse(value)
            if expression then
                for _, path in ipairs(Expressions.Dependencies(expression, context)) do append(path, source) end
            elseif self.helpers_.bindingSpec then
                local binding = self.helpers_.bindingSpec(value)
                if binding and binding.mode ~= "单次" then append(binding.path, source) end
            end
          end
        end
        for _, child in ipairs(children) do if child.kind ~= "Text" then visit(child, context) end end
    end
    for _, child in ipairs(self.template_) do if child.kind ~= "Text" then visit(child, self.context_) end end
    self.templateDependencies_, self.templateValues_, self.itemGeometryPaths_ = dependencies, values, geometry
    self.unsubscribe_ = Dirty.Subscribe(self.context_, dependencies, function() self.templateDirty_ = true end, self.scroll_)
end

function VirtualList:Key(row)
    local value = row
    for part in tostring(self.keyPath_):gmatch("[^.]+") do value = type(value) == "table" and value[part] or nil end
    return value
end
function VirtualList:ReconcileSelection()
    if not self.model_.indices_[self.state_.selectedKey] then self.state_.selectedKey = nil end
end
function VirtualList:Remember(y)
    local anchor = self.model_:Capture(y)
    local state = self.state_
    state.scrollY, state.anchorScrollY = y, y
    state.anchorKey, state.anchorIndex, state.anchorOffset = anchor.key, anchor.index, anchor.offset
end
function VirtualList:ScrollTo(y)
    local scroll = self.scroll_
    local x, current = scroll:GetScroll()
    if x ~= 0 or math.abs(current - y) > 0.01 then
        if scroll.luiShiftScrollOrigin_ then scroll:luiShiftScrollOrigin_(-x, y - current) end
        self.programmatic_ = true
        scroll:SetScrollDirect(0, y)
        self.programmatic_ = false
    end
    self:Remember(y)
end

function VirtualList:CreateSlot(probe, index)
    local row = assert(self.model_.items_[index], "virtual template requires an actual item")
    local slot = {row = row, index = index, context = setmetatable({refs = {}, actions = {}, item = row, index = index,
        selected = self.state_.selectedKey == self:Key(row)}, {__index = self.context_}), probe = probe}
    slot.context[self.each_] = row
    -- Runtime applies this after its own Render wrappers, including descendants
    -- constructed later by a conditional or repeated row template.
    slot.context.luiRenderGuard_ = function(widget) self:GuardRendering(widget) end
    setmetatable(slot.context.actions, {__index = self.context_.actions})
    slot.context.actions.LuiSelectVirtualRow = function(_, event)
        if self.disposed_ or not slot.index or slot.row ~= self.model_.items_[slot.index] then return end
        self:Select(slot.index, event)
    end
    local activateSerial = 0
    local function rowNode(source)
        local result = copy(source)
        result.attrs, result.children = copy(source.attrs), {}
        if source.tag == "Button" then
            local authoredClick = result.attrs.Click
            if authoredClick then
                activateSerial = activateSerial + 1
                local actionName = "LuiActivateVirtualRow" .. tostring(activateSerial)
                slot.context.actions[actionName] = function(target, event)
                    if self.disposed_ or not slot.index or slot.row ~= self.model_.items_[slot.index] then return end
                    if target and target.props and target.props.disabled then return end
                    Events.Emit(slot.context, self.helpers_.resolve(authoredClick, slot.context), target, event)
                    self:Select(slot.index, event)
                end
                result.attrs.Click = "{动作 " .. actionName .. "}"
            else
                result.attrs.Click = "{动作 LuiSelectVirtualRow}"
            end
        end
        for _, child in ipairs(source.children or {}) do result.children[#result.children + 1] = rowNode(child) end
        return result
    end
    local template = {}
    for _, child in ipairs(self.template_) do template[#template + 1] = rowNode(child) end
    local node = {kind = "Element", tag = "Container", attrs = {ChildLayout = "垂直"}, children = template,
        sourcePath = self.node_.sourcePath, nodePath = tostring(self.node_.nodePath or "0") .. ".template"}
    slot.widget = self.runtime_:BuildNode(node, slot.context)
    self:GuardRendering(slot.widget)
    if not probe then self.scroll_:AddChild(slot.widget) end
    return slot
end

function VirtualList:GuardRendering(widget)
    if widget.luiVirtualRenderGuard_ == self then return end
    widget.luiVirtualRenderGuard_ = self
    self.onRenderDeferred_ = self.onRenderDeferred_ or function() self.renderPending_ = true end
    RenderBudget.AttachTree(widget, self.runtime_, self.onRenderDeferred_)
end

function VirtualList:Bind(slot, index, force)
    local row = self.model_.items_[index]
    local selected = self.state_.selectedKey == self:Key(row)
    if not force and slot.row == row and slot.index == index and slot.context.selected == selected then return end
    local replaced = slot.row ~= row or slot.index ~= index
    slot.row, slot.index = row, index
    slot.context.item, slot.context[self.each_], slot.context.index, slot.context.selected = row, row, index, selected
    if replaced or force then slot.ready, slot.measuredRevision = false, nil end
    Dirty.Mark(slot.widget, true)
    Refresh.Subtree(slot.widget, true)
    if replaced then
        local function reset(widget)
            if widget.state then widget.state.hovered, widget.state.pressed = false, false end
            for _, child in ipairs(widget:GetChildren()) do reset(child) end
        end
        reset(slot.widget)
    end
end

function VirtualList:MeasureSlot(slot, index)
    self:Bind(slot, index)
    local revision = Measure.Revision(slot.widget)
    if slot.ready and slot.measuredRevision == revision and self.model_.measured_[index] then return true end
    local budget = Budget.Get(self.runtime_)
    local ok, _, height = Budget.Run(budget, function()
        return self.helpers_.desiredSize(slot.widget, self.model_.width_, nil, self.model_.width_, nil)
    end, slot.widget)
    if not ok then return false end
    if not finite(height) then
        self.pendingGeometry_ = "template height is not finite"
        return false
    end
    self.pendingGeometry_ = nil
    slot.ready, slot.measuredRevision = true, Measure.Revision(slot.widget)
    self.model_:SetHeight(index, height)
    return true
end

function VirtualList:Select(index, event)
    local row = self.model_.items_[index]
    if not row or row.disabled == true then return end
    local key = self:Key(row)
    -- Selection and activation are separate semantics.  Re-clicking the
    -- highlighted row must still activate it (for example, reopen a detail
    -- dialog) without rebuilding the row or losing its scroll position.
    if self.state_.selectedKey ~= key then self:SetSelectedKey(key) end
    Events.Emit(self.context_, self.helpers_.resolve(self.attrs_.Select, self.context_), row, index, event)
end
function VirtualList:SetSelectedKey(key)
    if self.disposed_ then return end
    self.state_.selectedKey = self.model_.indices_[key] and key or nil
    for _, slot in ipairs(self.pool_) do if slot.index then self:Bind(slot, slot.index) end end
    self.dirty_ = true
end
function VirtualList:SetState(state)
    if self.disposed_ or state == self.state_ then return end
    if not self.restoring_ then local _, y = self.scroll_:GetScroll(); self:Remember(y) end
    self.state_, self.restoring_, self.switchingState_, self.dirty_ = state or {}, true, true, true
    self.pendingRestore_ = {
        scrollY = self.state_.scrollY, anchorScrollY = self.state_.anchorScrollY,
        anchorKey = self.state_.anchorKey, anchorIndex = self.state_.anchorIndex,
        anchorOffset = self.state_.anchorOffset,
    }
end
function VirtualList:SetItems(items)
    if self.disposed_ then return end
    local y = math.max(0, tonumber(self.state_.scrollY) or 0)
    local anchor = self.switchingState_ and {key = self.state_.anchorKey, index = self.state_.anchorIndex, offset = self.state_.anchorOffset}
        or self.model_:Capture(y)
    self.model_:SetItems(items or {})
    self:ReconcileSelection()
    if not self.switchingState_ or anchor.key then self.state_.scrollY = self.model_:Restore(anchor) end
    self.switchingState_, self.restoring_, self.dirty_ = false, true, true
    for _, slot in ipairs(self.pool_) do slot.row, slot.ready = nil, false end
    if self.probe_ then self.probe_.row, self.probe_.ready = nil, false end
end
function VirtualList:ApplyChanges(items, relativePaths)
    if self.disposed_ then return end
    local model = self.model_
    if items ~= model.items_ or relativePaths == nil or #items ~= #model.heights_ then self:SetItems(items); return end
    local changed, geometryKeys = {}, {}
    for _, path in ipairs(relativePaths) do
        local index = path[1]
        if #path < 2 or type(index) ~= "number" or index % 1 ~= 0 or not items[index]
            or model.indices_[self:Key(items[index])] ~= index then
            self:SetItems(items); return
        end
        local key = self:Key(items[index])
        local entry = changed[index] or {key = key, geometry = false}
        changed[index] = entry
        for _, dependency in ipairs(self.itemGeometryPaths_) do
            local matches = true
            for part = 1, math.min(#dependency, #path - 1) do
                if dependency[part] ~= path[part + 1] then matches = false; break end
            end
            if matches then entry.geometry = true; break end
        end
    end
    for _, entry in pairs(changed) do if entry.geometry then geometryKeys[#geometryKeys + 1] = entry.key end end
    if #geometryKeys > 0 then model:RefreshRows(geometryKeys) end
    local function refresh(slot)
        local entry = slot and changed[slot.index]
        if not entry then return end
        if entry.geometry then self:Bind(slot, slot.index, true)
        else Dirty.Mark(slot.widget, true); Refresh.Subtree(slot.widget, true) end
    end
    for _, slot in ipairs(self.pool_) do refresh(slot) end
    refresh(self.probe_)
    self.dirty_ = self.dirty_ or #geometryKeys > 0
end
function VirtualList:RefreshRows(keys)
    if self.disposed_ then return end
    self.model_:RefreshRows(keys)
    local changed = {}
    for _, key in ipairs(keys or {}) do changed[key] = true end
    for _, slot in ipairs(self.pool_) do
        if slot.index and self.model_.items_[slot.index] then self:Bind(slot, slot.index, changed[self:Key(slot.row)]) end
    end
    if self.probe_ and self.probe_.row and changed[self:Key(self.probe_.row)] then self.probe_.row = nil end
    self.dirty_ = true
end

function VirtualList:MeasureBackground()
    local scroll, model = self.scroll_, self.model_
    if self.disposed_ or self.renderPending_ or self.templateDirty_ or self.updating_
        or scroll.isDraggingScrollbarV_ or scroll.isDraggingScrollbarH_ or (scroll.state and scroll.state.isDragging) then return false end
    local ancestor = scroll
    while ancestor do
        if ancestor.luiOverlayMounted_ == false or ancestor.props.visible == false or ancestor.props.visibility == "hidden"
            or (ancestor.RenderModalContent and ancestor.isOpen_ == false) then return false end
        ancestor = ancestor.parent
    end
    local index = model.cursor_
    if index > #model.items_ then return false end
    if not model.measured_[index] then
        local _, y = scroll:GetScroll()
        local anchor = model:Capture(y)
        self.probe_ = self.probe_ or self:CreateSlot(true, index)
        if not self:MeasureSlot(self.probe_, index) then return true end
        scroll:UpdateContentSize()
        self:ScrollTo(model:Restore(anchor))
        self.dirty_ = true
    end
    model.cursor_ = index + 1
    return model.cursor_ <= #model.items_
end

function VirtualList:Update(rendering)
    if self.disposed_ or self.updating_ then return end
    local ancestor, hidden = self.scroll_, false
    while ancestor do
        if ancestor.luiOverlayMounted_ == false or ancestor.props.visible == false or (ancestor.RenderModalContent and ancestor.isOpen_ == false) then
            MeasureQueue.Cancel(self); return
        end
        hidden = hidden or ancestor.props.visibility == "hidden"
        ancestor = ancestor.parent
    end
    local rect = self.scroll_:GetAbsoluteLayout()
    -- Yoga may not have arranged a freshly mounted/resized host yet. Never
    -- publish those sentinel coordinates as measured rows or key anchors.
    if not finite(rect.x) or not finite(rect.y) or not finite(rect.w) or not finite(rect.h) then
        self.pendingGeometry_ = "viewport is not finite"
        MeasureQueue.Cancel(self)
        return
    end
    if rect.w <= 0 or rect.h <= 0 then MeasureQueue.Cancel(self); return end
    if rendering then self.renderPending_ = false end
    self.updating_ = true
    local ok, err = pcall(function()
        local model, scroll = self.model_, self.scroll_
        -- Legacy direct-table-write contexts have the same invalidation semantics.
        -- This inspects only declared outer dependencies, never the item collection.
        for _, path in ipairs(self.templateDependencies_) do
            local value = Paths.Get(self.context_, path)
            if self.templateValues_[path] ~= value then self.templateValues_[path], self.templateDirty_ = value, true end
        end
        if self.templateDirty_ then
            self.templateRevision_, self.templateDirty_ = self.templateRevision_ + 1, false
            for _, slot in ipairs(self.pool_) do
                Dirty.Mark(slot.widget, true); Refresh.Subtree(slot.widget, true); slot.ready = false
            end
            if self.probe_ then Dirty.Mark(self.probe_.widget, true); Refresh.Subtree(self.probe_.widget, true); self.probe_.ready = false end
        end
        local left, top, right, bottom = Measure.Insets(scroll.props)
        local gutterRight, gutterBottom = Scrollbars.Gutters(scroll)
        local _, y = scroll:GetScroll()
        local restore = self.restoring_ and (self.pendingRestore_ or self.state_) or nil
        if restore then y = math.max(0, tonumber(restore.scrollY) or 0) end
        local anchor = restore and restore.anchorKey and restore.anchorScrollY == restore.scrollY
            and {key = restore.anchorKey, index = restore.anchorIndex, offset = restore.anchorOffset} or model:Capture(y)
        local gap = math.max(0, tonumber(self.helpers_.resolve(self.attrs_.VerticalGap, self.context_)) or 0)
        model:SetMetrics(top, bottom + gutterBottom, gap)
        local theme = type(UI.Theme) == "table" and UI.Theme or {}
        local signature = tostring(type(UI.GetFontVersion) == "function" and UI.GetFontVersion() or 0)
            .. ":" .. tostring(theme.GetScale and theme.GetScale() or 1) .. ":" .. self.templateRevision_
        local resized = model:SetViewport(math.max(1, rect.w - left - right - gutterRight), rect.h, signature)
        if resized then
            for _, slot in ipairs(self.pool_) do slot.ready = false end
            if self.probe_ then self.probe_.ready = false end
        end
        if hidden then
            MeasureQueue.Cancel(self)
            scroll:UpdateContentSize()
            self:ScrollTo(model:Clamp(y))
            return
        end
        if #model.items_ > 0 and not self.seeded_ then
            self.pool_[1] = self.pool_[1] or self:CreateSlot(false, 1)
            if self:MeasureSlot(self.pool_[1], 1) then
                model:SeedEstimate(model.heights_[1]); self.seeded_ = true
                if not self.state_.anchorKey then anchor = model:Capture(y) end
            else return end
        end
        y = self.restoring_ and model:Restore(anchor) or model:Clamp(y)
        -- Repeat only when real measurements change the visible range, never over all source data.
        for _ = 1, 3 do
            local first, last = model:Window(y)
            local changed = model.revision_
            for index = first, last do
                local offset = index - first + 1
                self.pool_[offset] = self.pool_[offset] or self:CreateSlot(false, index)
                self:Bind(self.pool_[offset], index)
                if not self:MeasureSlot(self.pool_[offset], index) then break end
            end
            y = model:Restore(anchor)
            if model.revision_ == changed then break end
        end
        local dragging = scroll.isDraggingScrollbarV_ or scroll.isDraggingScrollbarH_ or (scroll.state and scroll.state.isDragging)
        if not dragging and model.cursor_ <= #model.items_ then MeasureQueue.Schedule(self, VirtualList.MeasureBackground)
        else MeasureQueue.Cancel(self) end
        local first, last = model:Window(y)
        self.first_, self.last_, self.renderChildren_ = first, last, {}
        for offset, slot in ipairs(self.pool_) do
            local index = first + offset - 1
            if index <= last then
                self:Bind(slot, index)
                if slot.ready then
                    Measure.Frame(slot.widget, rect.x + left, rect.y + top + model:Prefix(index - 1), model.width_, model.heights_[index])
                    self.renderChildren_[#self.renderChildren_ + 1] = slot.widget
                end
            else slot.index = nil; Measure.Frame(slot.widget, rect.x, rect.y, 0, 0) end
        end
        scroll:UpdateContentSize()
        self:ScrollTo(y)
        self.restoring_, self.pendingRestore_, self.dirty_ = false, nil, false
    end)
    self.updating_ = false
    if not ok then error(err, 0) end
end

function VirtualList:Attach()
    local scroll, owner = self.scroll_, self
    local oldUpdate, oldRender, oldScroll, oldDestroy = scroll.Update, scroll.Render, scroll.props.onScroll, scroll.Destroy
    self.old_ = {update = oldUpdate, render = oldRender, onScroll = oldScroll, destroy = oldDestroy,
        bounds = scroll.UpdateContentSize, renderChildren = scroll.GetRenderChildren, hitChildren = scroll.GetHitTestChildren,
        unmount = scroll.luiUnmount_}
    function scroll:luiUnmount_()
        MeasureQueue.Cancel(owner)
        if owner.old_.unmount then owner.old_.unmount(self) end
    end
    function scroll:luiMeasure_(availableW, availableH, exactW, exactH)
        return exactW or availableW or self.props.width or 0,
            exactH or availableH or self.props.height or owner.model_:Extent()
    end
    function scroll:UpdateContentSize()
        local rect = self:GetAbsoluteLayout()
        self.contentWidth_ = math.max(0, rect.w - select(1, Scrollbars.Gutters(self)))
        self.contentHeight_ = math.max(rect.h, owner.model_:Extent())
    end
    function scroll:GetRenderChildren() return owner.renderChildren_ end
    function scroll:GetHitTestChildren() return owner.renderChildren_ end
    function scroll:Update(dt)
        if oldUpdate then oldUpdate(self, dt) end
        owner:Update(false)
    end
    function scroll:Render(nvg)
        owner:Update(true)
        if oldRender then return oldRender(self, nvg) end
    end
    scroll.props.onScroll = function(widget, x, y)
        if not owner.programmatic_ and not owner.restoring_ and not owner.disposed_ then owner:Remember(math.max(0, y)); owner.dirty_ = true end
        if oldScroll then oldScroll(widget, x, y) end
    end
    function scroll:Destroy()
        owner:Dispose()
        if oldDestroy then oldDestroy(self) end
    end
end
function VirtualList:Dispose()
    if self.disposed_ then return end
    self.disposed_ = true
    MeasureQueue.Cancel(self)
    if self.unsubscribe_ then self.unsubscribe_(); self.unsubscribe_ = nil end
    if self.probe_ then self.probe_.widget:Destroy(); self.probe_ = nil end
    for _, slot in ipairs(self.pool_) do slot.row, slot.index, slot.ready = nil, nil, false end
    local scroll, old = self.scroll_, self.old_
    scroll.Update, scroll.Render, scroll.props.onScroll = old.update, old.render, old.onScroll
    scroll.UpdateContentSize, scroll.GetRenderChildren = old.bounds, old.renderChildren
    scroll.GetHitTestChildren = old.hitChildren
    scroll.luiUnmount_ = old.unmount
    self.model_:Dispose()
    self.renderChildren_ = {}
end
return VirtualList
