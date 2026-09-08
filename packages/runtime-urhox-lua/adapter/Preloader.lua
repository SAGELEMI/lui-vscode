local Preloader = {}
Preloader.__index = Preloader

local function clockMs() return (os.clock and os.clock() or 0) * 1000 end

function Preloader.New(runtime)
    return setmetatable({ runtime_ = runtime, queues_ = { {}, {}, {} }, queued_ = {}, loaded_ = {} }, Preloader)
end

function Preloader:_Enqueue(key, priority, work)
    priority = math.max(0, math.min(2, math.floor(tonumber(priority) or 2)))
    local queued = self.queued_[key]
    if self.loaded_[key] or (queued ~= nil and queued <= priority) then return end
    self.queued_[key] = priority
    local queue = self.queues_[priority + 1]
    queue[#queue + 1] = { key = key, priority = priority, work = work }
end

function Preloader:_PromoteDescriptor(descriptor, priority)
    if type(descriptor) ~= "table" then return false, "LUI 预加载描述器无效。" end
    local runtime = self.runtime_
    self:_Enqueue("code:" .. tostring(descriptor.code), priority, function()
        local value, err = runtime:LoadCode(descriptor.code)
        if not value then error(err) end
    end)
    self:_Enqueue("markup:" .. tostring(descriptor.markup), priority, function()
        local document, err = runtime:LoadDocument(descriptor.markup)
        if not document then error(err) end
        local imports, importError = runtime:ImportsFor(document)
        if not imports then error(importError) end
        local function walk(node)
            local alias, name
            if type(node.tag) == "string" then alias, name = node.tag:match("^([^:]+):(.+)$") end
            if alias and alias ~= "lui" then
                local directory = imports[alias]
                local component = directory and runtime.registry_:GetDirectoryComponent(directory, name) or nil
                if not component then error("LUI 组件未登记：" .. tostring(node.tag)) end
                self:_PromoteDescriptor(component, priority)
            end
            for _, child in ipairs(node.children or {}) do walk(child) end
        end
        walk(document)
    end)
    return true
end

function Preloader:PromoteRegistered(name, priority)
    local descriptor = self.runtime_.registry_:Get(name)
    if not descriptor then return false, "LUI 未登记场景、页面或控件：" .. tostring(name) end
    return self:_PromoteDescriptor(descriptor, priority)
end

function Preloader:QueueRemaining()
    for _, group in ipairs({ self.runtime_.registry_.scenes or {}, self.runtime_.registry_.pages or {}, self.runtime_.registry_.controls or {} }) do
        for _, descriptor in pairs(group) do self:_PromoteDescriptor(descriptor, 2) end
    end
end

function Preloader:_Take()
    for priority = 1, 3 do
        local queue = self.queues_[priority]
        while #queue > 0 do
            local task = table.remove(queue, 1)
            if self.queued_[task.key] == task.priority then return task end
        end
    end
end

function Preloader:_RunOne()
    local task = self:_Take()
    if not task then return false end
    self.queued_[task.key] = nil
    local ok, err = xpcall(task.work, debug.traceback)
    if not ok then return nil, err end
    self.loaded_[task.key] = true
    return true
end

function Preloader:RequireRegistered(name)
    local ok, err = self:PromoteRegistered(name, 0)
    if not ok then return nil, err end
    while true do
        local hasPriorityZero = false
        for _, task in ipairs(self.queues_[1]) do
            if self.queued_[task.key] == 0 then hasPriorityZero = true; break end
        end
        if not hasPriorityZero then break end
        local ran, runError = self:_RunOne()
        if ran == nil then return nil, runError end
        if ran == false then break end
    end
    return true
end

function Preloader:Update(frameBudgetMs)
    local started = clockMs()
    repeat
        local ran, err = self:_RunOne()
        if ran == nil then print("[LUI.Preloader] " .. tostring(err)); return false end
        if ran == false then return true end
    until clockMs() - started >= (tonumber(frameBudgetMs) or 1.5)
    return true
end

return Preloader
