local UI = require("urhox-libs/UI")
local Measure = require("LUI.Measure")

---@class LuiNavigator
local Navigator = {}
Navigator.__index = Navigator

local function instanceRoot(instance)
    if not instance then return nil end
    return instance.GetRoot and instance:GetRoot() or instance.root_
end

local function disposeInstance(instance, root)
    if instance and instance.Dispose then instance:Dispose() end
    if root and root.parent then root.parent:RemoveChild(root) end
    if root and root.Destroy then root:Destroy() end
end

local function subtreeReady(root)
    local visited = {}
    local function visit(widget)
        if not widget or visited[widget] then return true end
        visited[widget] = true
        -- Collapsed/hidden branches cannot paint and their virtual lists
        -- intentionally cancel background layout. They therefore must not
        -- keep an otherwise visible navigation candidate warming forever.
        local props = widget.props or {}
        if props.visible == false or props.visibility == "hidden"
            or (widget.RenderModalContent and widget.isOpen_ == false) then return true end
        local list = widget.luiVirtualList_
        if list and list.model_ and #(list.model_.items_ or {}) > 0
            and (list.renderPending_ == true or #(list.renderChildren_ or {}) == 0) then return false end
        for _, child in ipairs(widget.GetChildren and widget:GetChildren() or {}) do
            if not visit(child) then return false end
        end
        for _, child in ipairs(widget.bodyChildren_ or {}) do
            if not visit(child) then return false end
        end
        if not visit(widget.contentContainer_) then return false end
        if not visit(widget.luiNativeWidget_) then return false end
        return true
    end
    return visit(root)
end

local function removeEntry(host, root)
    local entries = host and host.luiEntries_
    if not entries or not root then return end
    for index = #entries, 1, -1 do
        if entries[index].widget == root then table.remove(entries, index) end
    end
end

local function addEntry(host, root, context)
    if not host.luiEntries_ then return end
    for _, entry in ipairs(host.luiEntries_) do if entry.widget == root then return end end
    host.luiEntries_[#host.luiEntries_ + 1] = {
        widget = root,
        attrs = { Width = "100%", Height = "100%", MinWidth = "0", MinHeight = "0" },
        context = root.luiContext_ or context,
    }
end

local function setLayer(root, zIndex, pointerEvents, background)
    if not root then return end
    root:SetStyle({ position = "absolute", left = 0, top = 0, width = "100%", height = "100%",
        zIndex = zIndex, pointerEvents = pointerEvents, backgroundColor = background })
end

function Navigator.New(runtime, options)
    local self = setmetatable({}, Navigator)
    self:Init(runtime, options or {})
    return self
end

function Navigator:Init(runtime, options)
    self.runtime_ = assert(runtime, "Navigator requires a Runtime")
    self.kind_ = options.kind == "scene" and "scene" or "page"
    self.parentContext_ = options.parentContext
    self.background_ = options.background or "#0B0712"
    self.onCommitted_ = options.onCommitted
    self.host_ = options.host or UI.Panel {
        width = "100%", height = "100%", position = "relative",
        pointerEvents = "box-none", overflow = "hidden",
    }
    self.ownsHost_ = options.host == nil
    self.serial_ = 0
    self.ready_ = false
    if runtime._RegisterNavigator then runtime:_RegisterNavigator(self) end
end

function Navigator:GetRoot() return self.host_ end

function Navigator:GetCurrent()
    return self.currentInstance_, self.currentName_
end

function Navigator:IsCurrentReady()
    return self.disposed_ ~= true and self.pending_ == nil
        and self.currentInstance_ ~= nil and self.ready_ == true
end

function Navigator:CancelPending()
    local pending = self.pending_
    if not pending then return false end
    self.pending_ = nil
    if pending.unsubscribe then pending.unsubscribe() end
    removeEntry(self.host_, pending.root)
    disposeInstance(pending.instance, pending.root)
    if self.currentRoot_ then setLayer(self.currentRoot_, 1, "box-none", self.background_) end
    Measure.Invalidate(self.host_)
    return true
end

local function createCandidate(self, name, parameters)
    if self.kind_ == "scene" then
        return self.runtime_:CreateScene(name, self.parentContext_)
    end
    return self.runtime_:CreatePage(name, self.parentContext_, parameters or {})
end

function Navigator:Navigate(name, parameters)
    if self.disposed_ then return nil, "Navigator 已释放。" end
    if type(name) ~= "string" or name == "" then return nil, "导航目标不能为空。" end
    if self.pending_ and self.pending_.name == name then return self.pending_.instance, nil end
    if not self.pending_ and self.currentName_ == name then return self.currentInstance_, nil end
    self:CancelPending()

    local ok, instance, err = pcall(createCandidate, self, name, parameters)
    if not ok then return nil, tostring(instance) end
    if not instance then return nil, err end
    local root = instanceRoot(instance)
    if not root then disposeInstance(instance); return nil, "页面未生成有效根节点：" .. tostring(name) end

    self.serial_ = self.serial_ + 1
    local pending = {
        serial = self.serial_, name = name, parameters = parameters,
        instance = instance, root = root,
        phase = self.currentRoot_ and "warming" or "visible",
        warmReady = false, visibleRendered = false,
    }
    self.pending_ = pending
    setLayer(root, self.currentRoot_ and 0 or 2, self.currentRoot_ and "none" or "box-none", self.background_)
    if self.currentRoot_ then setLayer(self.currentRoot_, 1, "box-none", self.background_) end
    if root.parent and root.parent ~= self.host_ then root.parent:RemoveChild(root) end
    if root.parent ~= self.host_ then self.host_:AddChild(root) end
    addEntry(self.host_, root, self.parentContext_)
    pending.unsubscribe = self.runtime_:AfterLayout(root, function()
        if self.pending_ ~= pending then return end
        if pending.phase == "warming" then
            pending.warmReady = subtreeReady(root)
        elseif pending.phase == "visible" and subtreeReady(root) then
            pending.visibleRendered = true
        end
    end)
    Measure.Invalidate(self.host_)
    return instance, nil
end

function Navigator:Update()
    local pending = self.pending_
    if self.disposed_ or not pending then return end
    if pending.phase == "warming" then
        if not pending.warmReady then return end
        pending.phase = "visible"
        if self.currentRoot_ then self.currentRoot_:SetStyle({ pointerEvents = "none" }) end
        pending.root:SetStyle({ zIndex = 2, pointerEvents = "box-none" })
        Measure.Invalidate(self.host_)
        return
    end
    if not pending.visibleRendered then return end

    self.pending_ = nil
    if pending.unsubscribe then pending.unsubscribe() end
    local oldInstance, oldRoot = self.currentInstance_, self.currentRoot_
    removeEntry(self.host_, oldRoot)
    disposeInstance(oldInstance, oldRoot)
    self.currentInstance_, self.currentRoot_, self.currentName_ = pending.instance, pending.root, pending.name
    self.ready_ = true
    setLayer(self.currentRoot_, 1, "box-none", self.background_)
    if self.host_.luiPagePresenter_ then
        self.host_.luiPageRoot_, self.host_.luiPageInstance_ = self.currentRoot_, self.currentInstance_
    end
    Measure.Invalidate(self.host_)
    if self.onCommitted_ then
        local ok, err = xpcall(self.onCommitted_, debug.traceback, pending.name,
            pending.instance, pending.root, oldInstance, oldRoot)
        if not ok then print("[LUI.Navigator] " .. tostring(err)) end
    end
end

function Navigator:Dispose()
    if self.disposed_ then return end
    self.disposed_ = true
    self:CancelPending()
    removeEntry(self.host_, self.currentRoot_)
    disposeInstance(self.currentInstance_, self.currentRoot_)
    self.currentInstance_, self.currentRoot_, self.currentName_, self.ready_ = nil, nil, nil, false
    if self.runtime_ and self.runtime_._UnregisterNavigator then self.runtime_:_UnregisterNavigator(self) end
    local host = self.host_
    self.runtime_, self.parentContext_, self.onCommitted_, self.host_ = nil, nil, nil, nil
    if self.ownsHost_ and host and host.Destroy then host:Destroy() end
end

return Navigator
