-- Reconcile declaration branches only when their collection/condition changes.
-- Stable row scopes keep callbacks and component instances live across reorder.
local Dirty = require('LUI.Dirty')
local Measure = require('LUI.Measure')
local Expressions = require('LUI.LayoutExpressions')
local Structure = {}

local function releaseRefs(widget)
    local context = widget.luiContext_
    local refs = context and context.refs
    if refs and refs[widget.luiReference_] == widget then refs[widget.luiReference_] = nil end
    -- An imported root's public reference belongs to its caller, not the
    -- component's private refs table.
    local host = widget.luiComponentHost_
    local callerRefs = host and host.luiComponentContext_ and host.luiComponentContext_.refs
    if callerRefs and callerRefs[widget.luiReference_] == widget then callerRefs[widget.luiReference_] = nil end
    for _, child in ipairs(widget.GetChildren and widget:GetChildren() or {}) do releaseRefs(child) end
end

function Structure.Entries(runtime, nodes, context, helpers)
    local entries, records, scopes, dependencies = {}, {}, {}, {}
    local dependencyGroups = {}
    local dynamic = false
    local function dependency(value, scope)
        local binding = helpers.binding(value)
        local expression = not binding and Expressions.Parse(value)
        local paths = binding and {binding.path} or expression and Expressions.Dependencies(expression, scope) or {}
        local group = dependencyGroups[scope]
        if not group then group = {paths={},seen={}}; dependencyGroups[scope] = group end
        for _, path in ipairs(paths or {}) do
            if not group.seen[path] then
                group.paths[#group.paths+1], group.seen[path] = path, true
                if scope == context then dependencies[#dependencies+1] = path end
            end
        end
    end
    -- Nested repeated conditions are already covered by their outer collection.
    local function inspect(children, scope, repeated)
        for _, node in ipairs(children or {}) do
            local attrs, visual = helpers.parts(node)
            if node.tag == 'lui:If' or node.tag == 'lui:For' or node.tag == 'lui:Slot' then
                dynamic = true
                if node.tag == 'lui:Slot' then
                    local content = (scope.slots or {})[attrs.Name or 'Content'] or {}
                    inspect(content, content.luiCallerContext_ or scope, repeated)
                else
                    if not repeated then dependency(attrs.Test or attrs.In, scope) end
                    inspect(visual, scope, repeated or node.tag == 'lui:For')
                end
            end
        end
    end
    inspect(nodes, context, false)
    local function resolveStructure(node, attrs, attribute, active)
        local value = helpers.resolve(attrs[attribute], active)
        -- Preview needs explicit structural samples; an omitted collection or
        -- condition must not silently hide the page being edited. Resolution
        -- runs first so inline preview content (including an empty array) wins.
        local binding = value == nil and active.luiPreview_ and helpers.binding(attrs[attribute])
        if binding then
            error('LUI 预览结构数据缺失：'..tostring(node.sourcePath or '<inline>')..' #'..
                tostring(node.nodePath or '0')..' attrs.'..attribute..' → '..tostring(binding.path), 0)
        end
        return value
    end
    local function reconcile(owner)
        local descriptors, nextScopes = {}, {}
        local function append(node, active, route, repeated)
            if not node or node.kind == 'Text' then return end
            local attrs, visual = helpers.parts(node)
            if node.tag == 'lui:If' then
                local test = resolveStructure(node, attrs, 'Test', active)
                if test ~= nil and test ~= false then
                    for i, child in ipairs(visual) do append(child, active, route..'/'..i, repeated) end
                end
            elseif node.tag == 'lui:For' then
                local values = resolveStructure(node, attrs, 'In', active) or {}
                assert(type(values)=='table', 'LUI 重复项集合必须是数组：'..tostring(attrs.In))
                local name, keys = attrs.Items or attrs.Each or 'item', {}
                for index, value in ipairs(values) do
                    local key = type(value)=='table' and (value.key or value.id) or nil
                    key = key == nil and ('index:'..index) or (type(key)..':'..tostring(key))
                    assert(not keys[key], 'LUI 重复项键重复：'..key); keys[key] = true
                    local scopeKey = route..'['..key..']'
                    local childContext = scopes[scopeKey] or {}
                    childContext[name], childContext.item, childContext.index = value, value, index
                    childContext.luiRepeatIdentity_ = scopeKey
                    setmetatable(childContext, {__index=active}); nextScopes[scopeKey] = childContext
                    for i, child in ipairs(visual) do append(child, childContext, scopeKey..'/'..i, true) end
                end
            elseif node.tag == 'lui:Slot' then
                local content = (active.slots or {})[attrs.Name or 'Content'] or {}
                for i, child in ipairs(content) do append(child, content.luiCallerContext_ or active, route..'/slot/'..i, repeated) end
            else
                descriptors[#descriptors+1] = {key=route,node=node,attrs=attrs,context=active,repeated=repeated}
            end
        end
        for i, node in ipairs(nodes or {}) do append(node, context, tostring(i)) end
        local wanted = {}; for _, descriptor in ipairs(descriptors) do wanted[descriptor.key] = descriptor end
        for key, record in pairs(records) do
            local nextRecord = wanted[key]
            if not nextRecord or nextRecord.node ~= record.node then
                if record.entry then
                    local widget = record.entry.widget
                    releaseRefs(widget)
                    if owner then owner:RemoveChild(widget) end
                    widget:Destroy()
                end
                records[key] = nil
            end
        end
        local nextEntries, nextRecords = {}, {}
        for _, descriptor in ipairs(descriptors) do
            local record = records[descriptor.key]
            if not record then
                local widget = runtime:BuildNode(descriptor.node, descriptor.context)
                record = {node=descriptor.node}
                if widget then
                    assert(not widget.__luiList, 'LUI 未展开的结构节点')
                    record.entry = {widget=widget,attrs=descriptor.attrs,context=widget.luiContext_ or descriptor.context}
                end
            elseif owner and record.entry and descriptor.repeated then
                -- Repeated values may be replaced/mutated without changing keys.
                -- Descendants read the retained scope, including event callbacks.
                Dirty.Mark(record.entry.widget, true)
            end
            local entry = record.entry
            if entry then
                local attrs, scope = entry.attrs, entry.context
                entry.row = math.max(1, (tonumber(helpers.resolve(attrs['Grid.Row'],scope)) or 0)+1)
                entry.column = math.max(1, (tonumber(helpers.resolve(attrs['Grid.Column'],scope)) or 0)+1)
                entry.rowSpan = math.max(1, tonumber(helpers.resolve(attrs['Grid.RowSpan'],scope)) or 1)
                entry.columnSpan = math.max(1, tonumber(helpers.resolve(attrs['Grid.ColumnSpan'],scope)) or 1)
                nextEntries[#nextEntries+1] = entry
            end
            nextRecords[descriptor.key] = record
        end
        local changed = #entries ~= #nextEntries
        if not changed then for i, entry in ipairs(nextEntries) do if entries[i] ~= entry then changed = true; break end end end
        if changed then
            if owner then
                for _, entry in ipairs(entries) do if entry.widget.parent == owner then owner:RemoveChild(entry.widget) end end
                for _, entry in ipairs(nextEntries) do owner:AddChild(entry.widget) end
                Measure.Invalidate(owner)
            end
            for i = #entries, 1, -1 do entries[i] = nil end
            for i, entry in ipairs(nextEntries) do entries[i] = entry end
        end
        records, scopes = nextRecords, nextScopes
    end
    reconcile()
    if dynamic then
        entries.luiReconcile_, entries.luiDependencies_ = reconcile, dependencies
        entries.luiDependencyGroups_ = dependencyGroups
    end
    return entries
end

function Structure.Attach(widget, entries, context)
    if not entries.luiReconcile_ then return end
    widget.luiStructureDependencies_ = entries.luiDependencies_
    function widget:luiRefreshLayout_() entries.luiReconcile_(self) end
    Dirty.Track(widget, context, entries.luiDependencies_)
    for scope, group in pairs(entries.luiDependencyGroups_ or {}) do
        if scope ~= context and #group.paths > 0 then
            Dirty.Subscribe(scope, group.paths, function() Dirty.Mark(widget) end, widget)
        end
    end
end

return Structure
