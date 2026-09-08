-- Optional notified refresh. Existing contexts keep their direct-table-write
-- scan; opted-in contexts subscribe once and visit only marked branches.
local Paths = require("LUI.Paths")
local Dirty = { stats = { notifications = 0, marked = 0, subscriptions = 0 } }
local owners = setmetatable({}, { __mode = "k" })
local aliases = setmetatable({}, { __mode = "k" })
local serial = 0

local function parentContext(context)
    local mt = type(context) == "table" and getmetatable(context)
    return type(mt) == "table" and type(mt.__index) == "table" and mt.__index or nil
end

local function scope(context)
    local seen = {}
    while type(context) == "table" and not seen[context] do
        seen[context] = true
        if rawget(context, "luiDirtyScope_") then return context end
        local parent = parentContext(context)
        if not parent then return context end
        context = parent
    end
    return context
end

function Dirty.Configure(context, enabled)
    if enabled ~= nil then rawset(context, "luiDirtyEnabled_", enabled == true or enabled == "notify") end
    rawset(context, "luiDirtyScope_", true)
    return context
end

function Dirty.Enabled(context)
    local seen = {}
    while type(context) == "table" and not seen[context] do
        seen[context] = true
        local value = rawget(context, "luiDirtyEnabled_")
        if value ~= nil then return value == true end
        context = parentContext(context)
    end
    return false
end

local function ownerFor(context, first)
    local original, seen = context, {}
    while type(context) == "table" and not seen[context] do
        seen[context] = true
        if rawget(context, first) ~= nil then return context end
        context = parentContext(context)
    end
    return scope(original)
end

local function list(paths)
    if type(paths) == "string" then return { paths } end
    return paths or {}
end

-- Register this before building children that bind props[property]. Aliases
-- point at the parent context, so inherited/slot scopes need no copied values.
function Dirty.Alias(container, key, context, paths)
    local entries = aliases[container]
    if not entries then entries = {}; aliases[container] = entries end
    entries[key] = { context = context, paths = list(paths) }
end

local function targets(context, keys, output, depth)
    if not keys or #keys == 0 then return end
    depth = (depth or 0) + 1
    assert(depth <= 32, "LUI dirty dependency alias cycle")
    local owner = ownerFor(context, keys[1])
    local value = context
    for index, key in ipairs(keys) do
        if type(value) ~= "table" then break end
        local alias = aliases[value] and aliases[value][key]
        if alias then
            for _, path in ipairs(alias.paths) do
                local translated = Paths.Keys(path)
                if translated then
                    for rest = index + 1, #keys do translated[#translated + 1] = keys[rest] end
                    targets(alias.context, translated, output, depth)
                end
            end
            return
        end
        value = value[key]
    end
    output[#output + 1] = { owner = owner, keys = keys }
end

local function nodeFor(owner, keys)
    local node = owners[owner]
    if not node then node = {}; owners[owner] = node end
    for _, key in ipairs(keys) do
        node.children = node.children or {}
        if not node.children[key] then node.children[key] = { parent = node, key = key } end
        node = node.children[key]
    end
    node.watchers = node.watchers or setmetatable({}, { __mode = "k" })
    return node
end

local function recordChange(widget, change)
    local changes = widget.luiDirtyChanges_
    if not change then widget.luiDirtyChanges_ = false; return end
    if changes == false then return end
    if not changes then changes = {}; widget.luiDirtyChanges_ = changes end
    if changes[change] then return end
    if #changes >= 128 then widget.luiDirtyChanges_ = false; return end
    changes[change] = true
    changes[#changes + 1] = change
end

function Dirty.Mark(widget, forceSubtree, change)
    if not widget or widget.luiDirtyDisposed_ then return end
    if not widget.luiDirtySelf_ then widget.luiDirtyChanges_ = nil end
    recordChange(widget, change)
    serial = serial + 1
    widget.luiDirtySelf_, widget.luiDirtyCaption_ = serial, serial
    if forceSubtree then widget.luiDirtyAll_ = serial end
    Dirty.stats.marked = Dirty.stats.marked + 1
    local current, seen = widget, {}
    while current and not seen[current] do
        seen[current] = true
        if current ~= widget and current.props and current.props.visible == false then
            current.luiDirtySuspended_ = true
            break
        end
        current.luiDirtyBranch_ = serial
        current = current.parent
    end
end

function Dirty.Untrack(widget)
    for _, node in ipairs(widget.luiDirtySubscriptions_ or {}) do
        if node.watchers and node.watchers[widget] then
            node.watchers[widget] = nil
            Dirty.stats.subscriptions = Dirty.stats.subscriptions - 1
        end
        -- Recycled slots can visit arbitrarily many collection indices while
        -- their document context stays alive. Remove empty dependency branches
        -- instead of retaining every former row path until the page closes.
        local current = node
        while current.parent and not next(current.watchers or {}) and not next(current.children or {}) do
            local parent = current.parent
            parent.children[current.key] = nil
            if not next(parent.children) then parent.children = nil end
            current.parent, current.key = nil, nil
            current = parent
        end
    end
    widget.luiDirtySubscriptions_ = nil
end

function Dirty.Track(widget, context, dependencies)
    Dirty.Untrack(widget)
    widget.luiDirtyDisposed_ = nil
    widget.luiDirtyContext_, widget.luiDirtyEnabled_ = context, Dirty.Enabled(context)
    widget.luiDirtySubscriptions_ = {}
    local added = {}
    for _, path in ipairs(dependencies or {}) do
        local resolved = {}
        targets(context, Paths.Keys(path), resolved)
        for _, target in ipairs(resolved) do
            local node = nodeFor(target.owner, target.keys)
            if not added[node] then
                added[node], node.watchers[widget] = true, true
                widget.luiDirtySubscriptions_[#widget.luiDirtySubscriptions_ + 1] = node
                Dirty.stats.subscriptions = Dirty.stats.subscriptions + 1
            end
        end
    end
    if not widget.luiDirtyDestroyHook_ and type(widget.Destroy) == "function" then
        widget.luiDirtyDestroyHook_ = true
        local destroy = widget.Destroy
        function widget:Destroy(...)
            Dirty.Dispose(self)
            return destroy(self, ...)
        end
    end
    Dirty.Mark(widget)
    return widget
end

local function markWatchers(node, marked, change)
    for widget in pairs(node.watchers or {}) do
        if not marked[widget] and not widget.luiDirtyDisposed_ then
            marked[widget] = true
            Dirty.Mark(widget, nil, change)
            if widget.luiDirtyCallback_ then widget.luiDirtyCallback_() end
        elseif not widget.luiDirtyDisposed_ then
            recordChange(widget, change)
        end
    end
end

local function markBelow(node, marked, change)
    markWatchers(node, marked, change)
    for _, child in pairs(node.children or {}) do markBelow(child, marked, change) end
end

-- Resolve component-property aliases before comparing paths. An empty result
-- means an unrelated binding changed; nil means a full/unknown replacement.
function Dirty.RelativeChanges(widget, context, path)
    local changes = widget.luiDirtyChanges_
    if not changes then return nil end
    local bindings, result = {}, {}
    targets(context, Paths.Keys(path), bindings)
    for _, binding in ipairs(bindings) do
        for _, change in ipairs(changes) do
            if change.owner == binding.owner then
                local related = true
                for index = 1, math.min(#binding.keys, #change.keys) do
                    if binding.keys[index] ~= change.keys[index] then related = false; break end
                end
                if related then
                    if #change.keys <= #binding.keys then return nil end
                    local relative = {}
                    for index = #binding.keys + 1, #change.keys do relative[#relative + 1] = change.keys[index] end
                    result[#result + 1] = relative
                end
            end
        end
    end
    return result
end

function Dirty.Notify(context, paths)
    Dirty.stats.notifications = Dirty.stats.notifications + 1
    local marked = {}
    if paths == nil or paths == "*" then
        local node = owners[scope(context)]
        if node then markBelow(node, marked) end
    else
        for _, path in ipairs(list(paths)) do
            local resolved = {}
            targets(context, Paths.Keys(path), resolved)
            for _, target in ipairs(resolved) do
                local node = owners[target.owner]
                if node then
                    markWatchers(node, marked, target)
                    for _, key in ipairs(target.keys) do
                        node = node.children and node.children[key]
                        if not node then break end
                        markWatchers(node, marked, target)
                    end
                    if node then markBelow(node, marked, target) end
                end
            end
        end
    end
    return marked
end

function Dirty.Legacy(widget)
    if widget.luiDirtyEnabled_ ~= nil then return widget.luiDirtyEnabled_ == false end
    -- Native infrastructure is not an opted-out LUI context. Inspect it once
    -- to discover descendants; scanning it forever would disable notify mode
    -- whenever a ScrollView or native control inserts an internal panel.
    return widget.luiRefreshLayout_ ~= nil or widget.luiRefreshCaption_ ~= nil
end

function Dirty.ShouldVisit(widget)
    return Dirty.Legacy(widget) or widget.luiDirtyVisited_ ~= true or widget.luiDirtyLegacyBelow_ == true
        or widget.luiDirtySelf_ ~= nil or widget.luiDirtyBranch_ ~= nil or widget.luiDirtyAll_ ~= nil
end

function Dirty.CaptionPending(widget)
    return widget.luiDirtyEnabled_ ~= true or widget.luiDirtyCaption_ ~= nil
end

function Dirty.IsPending(widget)
    return widget.luiDirtySelf_ ~= nil
end

-- Independent subscriptions survive a later Track() of the host widget.
-- Consumers should only schedule work here; expensive work stays in the
-- visible frame's shared budget. The optional owner supplies automatic cleanup.
function Dirty.Subscribe(context, dependencies, callback, owner)
    assert(type(callback) == "function", "LUI dirty subscription requires a callback")
    local listener = { luiDirtyCallback_ = callback, luiDirtyOwner_ = owner }
    Dirty.Track(listener, context, dependencies)
    if owner then
        owner.luiDirtyListeners_ = owner.luiDirtyListeners_ or {}
        owner.luiDirtyListeners_[listener] = true
    end
    return function() Dirty.Dispose(listener) end
end

function Dirty.Dispose(widget)
    if not widget or widget.luiDirtyDisposed_ then return end
    widget.luiDirtyDisposed_ = true
    local owner = widget.luiDirtyOwner_
    if owner and owner.luiDirtyListeners_ then owner.luiDirtyListeners_[widget] = nil end
    widget.luiDirtyOwner_, widget.luiDirtyCallback_ = nil, nil
    for listener in pairs(widget.luiDirtyListeners_ or {}) do Dirty.Dispose(listener) end
    widget.luiDirtyListeners_ = nil
    Dirty.Untrack(widget)
    widget.luiDirtyContext_ = nil
    widget.luiDirtyChanges_ = nil
    widget.luiDirtySelf_, widget.luiDirtyCaption_, widget.luiDirtyBranch_, widget.luiDirtyAll_ = nil, nil, nil, nil
    local seen = {}
    local function children(items)
        for _, child in ipairs(items or {}) do
            if child ~= widget and not seen[child] then seen[child] = true; Dirty.Dispose(child) end
        end
    end
    children(widget.GetChildren and widget:GetChildren())
    children(widget.GetHitTestChildren and widget:GetHitTestChildren())
    children(widget.bodyChildren_)
end

return Dirty
