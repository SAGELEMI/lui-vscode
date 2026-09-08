-- Background work runs after every foreground Update/Render pass. Entries do
-- not keep their owners alive, and each turn advances at most one row.
local Budget = require("LUI.MeasureBudget")
local Queue = { capacity = 128 }
local capacity = Queue.capacity
local owners = setmetatable({}, { __mode = "v" })
local entries = setmetatable({}, { __mode = "k" })
local cursor = 0

function Queue.Schedule(owner, callback)
    local entry = entries[owner]
    if entry then entry.callback = callback; return true end
    for offset = 1, capacity do
        local index = (cursor + offset - 1) % capacity + 1
        if owners[index] == nil then
            owners[index], entries[owner] = owner, { index = index, callback = callback }
            return true
        end
    end
    return false
end

function Queue.Cancel(owner)
    local entry = entries[owner]
    if not entry then return end
    if owners[entry.index] == owner then owners[entry.index] = nil end
    entries[owner] = nil
end

function Queue.Drain()
    if next(entries) == nil then return 0 end
    local turns, skipped, sharedBlocked = 0, 0, false
    while turns < 64 and skipped < capacity do
        cursor = cursor % capacity + 1
        local owner = owners[cursor]
        local entry = owner and entries[owner]
        local canStart = false
        if entry then
            local injected = owner.runtime_.luiMeasureBudget_ ~= nil
            if injected or not sharedBlocked then
                canStart = Budget.CanStart(Budget.Get(owner.runtime_))
                if not canStart and not injected then sharedBlocked = true end
            end
        end
        if canStart then
            turns, skipped = turns + 1, 0
            local ok, more = pcall(entry.callback, owner)
            if not ok then Queue.Cancel(owner); error(more, 0) end
            if more ~= true and entries[owner] == entry then Queue.Cancel(owner) end
        else
            skipped = skipped + 1
        end
    end
    return turns
end

return Queue
