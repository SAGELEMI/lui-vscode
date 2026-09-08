-- All runtimes in this Lua VM share one scheduler budget across both passes.
local Budget = {}
local exhausted = {}
local active
local activeOwner
local guardHooks
local sharedBudget

function Budget.Clock()
    local fallback = function() return (os and os.clock and os.clock() or 0) end
    local reader = fallback
    local metadata = { source = os and type(os.clock) == "function" and "os.clock" or "unavailable",
        native = false, available = os and type(os.clock) == "function" or false,
        resolution = "platform-dependent", semantics = "platform-dependent; not assumed to be wall time" }
    for index, owner in ipairs({ Time or false, time or false }) do
        if owner and type(owner.GetSystemTime) == "function" then
            local ok, value = pcall(owner.GetSystemTime, owner)
            if ok and type(value) == "number" and value == value and math.abs(value) ~= math.huge then
                local previous, elapsed = value, 0
                reader = function()
                    local nextValue = owner:GetSystemTime()
                    elapsed = elapsed + (nextValue - previous) % 4294967296
                    previous = nextValue
                    return elapsed / 1000
                end
                metadata = { source = index == 1 and "Time.GetSystemTime" or "time.GetSystemTime",
                    native = true, available = true, resolutionMilliseconds = 1,
                    resolution = "integer millisecond ticks; effective resolution may be coarser",
                    semantics = "monotonic elapsed wall time; unsigned 32-bit millisecond wrap is unrolled" }
                break
            end
        end
    end
    return reader, metadata
end

function Budget.Get(runtime)
    -- Explicit budgets support deterministic tests without retaining runtimes.
    if runtime.luiMeasureBudget_ then return runtime.luiMeasureBudget_ end
    if not sharedBudget then
        sharedBudget = { clock = Budget.Clock(), seconds = 0.002, limit = 64,
            calls = 0, rows = 0, frame = 0, overrunMilliseconds = 0, deadline = nil }
    end
    return sharedBudget
end

function Budget.BeginFrame(runtime, token)
    local budget = Budget.Get(runtime)
    if token ~= nil and budget.token == token then return budget end
    budget.token, budget.frame = token, budget.frame + 1
    budget.calls, budget.rows, budget.overrunMilliseconds = 0, 0, 0
    -- Idle Update time does not consume the slice before a list asks for work.
    budget.deadline = nil
    return budget
end

function Budget.CanStart(budget)
    return budget.calls < budget.limit and budget.rows < 64
        and (not budget.deadline or budget.clock() < budget.deadline)
end

-- Rendering may be entirely cached after the slice is spent. Enter the scope
-- without rejecting it up front; only a new native measurement defers work.
function Budget.Active() return active end
function Budget.Owner() return activeOwner end
function Budget.SetGuardHooks(hooks) guardHooks = hooks end
function Budget.WithOwner(owner, callback, ...)
    local previous = activeOwner
    activeOwner = owner
    local result = table.pack(pcall(callback, ...))
    activeOwner = previous
    if not result[1] then error(result[2], 0) end
    return table.unpack(result, 2, result.n)
end

function Budget.Guard(budget, callback, owner)
    local previous, previousOwner = active, activeOwner
    active, activeOwner = budget, owner or activeOwner
    local guard = guardHooks and guardHooks.Begin()
    local result = table.pack(pcall(callback))
    if guardHooks then guardHooks.Finish(guard, not result[1]) end
    active, activeOwner = previous, previousOwner
    if not result[1] then
        if result[2] == exhausted then return false end
        error(result[2], 0)
    end
    return true, table.unpack(result, 2, result.n)
end

function Budget.Run(budget, callback, owner)
    if not Budget.CanStart(budget) then return false end
    budget.deadline = budget.deadline or (budget.clock() + budget.seconds)
    budget.rows = budget.rows + 1
    return Budget.Guard(budget, callback, owner)
end

function Budget.Native(callback, ...)
    local budget = active
    if not budget then return callback(...) end
    budget.deadline = budget.deadline or (budget.clock() + budget.seconds)
    local started = budget.clock()
    if budget.calls >= budget.limit or started >= budget.deadline then error(exhausted, 0) end
    budget.lastNativeStart = started
    budget.calls = budget.calls + 1
    local values = table.pack(callback(...))
    budget.overrunMilliseconds = math.max(budget.overrunMilliseconds,
        math.max(0, budget.clock() - budget.deadline) * 1000)
    return table.unpack(values, 1, values.n)
end

return Budget
