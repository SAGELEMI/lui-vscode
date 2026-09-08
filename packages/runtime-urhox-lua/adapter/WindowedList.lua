-- Generic variable-height index. It knows item identity and geometry, not captions or styles.
local Model = {}
Model.__index = Model

function Model.New(options)
    options = options or {}
    return setmetatable({ items_ = {}, indices_ = {}, heights_ = {}, tree_ = {}, measured_ = {},
        key_ = options.key or function(row) return row.key end, width_ = 0, height_ = 0,
        paddingTop_ = 0, paddingBottom_ = 0, gap_ = 0, estimate_ = options.estimate or 1,
        cursor_ = 1, revision_ = 0, disposed_ = false }, Model)
end

function Model:Prefix(index)
    local value = 0
    while index > 0 do value = value + self.tree_[index]; index = index - (index & -index) end
    return value
end
function Model:Total() return self:Prefix(#self.items_) end
function Model:Extent() return self.paddingTop_ + self:Total() + self.paddingBottom_ end
function Model:Rebuild()
    local count = #self.items_
    for index = 1, count do self.tree_[index] = self.heights_[index] + (index < count and self.gap_ or 0) end
    for index = 1, count do
        local parent = index + (index & -index)
        if parent <= count then self.tree_[parent] = self.tree_[parent] + self.tree_[index] end
    end
    self.revision_ = self.revision_ + 1
end
function Model:Find(offset)
    local count, index, total, step = #self.items_, 0, 0, 1
    if count == 0 then return 0 end
    while step * 2 <= count do step = step * 2 end
    while step > 0 do
        local nextIndex = index + step
        if nextIndex <= count and total + self.tree_[nextIndex] <= offset then
            index, total = nextIndex, total + self.tree_[nextIndex]
        end
        step = math.floor(step / 2)
    end
    return math.min(count, index + 1)
end
function Model:Clamp(y)
    return math.max(0, math.min(tonumber(y) or 0, math.max(0, self:Extent() - self.height_)))
end
function Model:Capture(y)
    local index = self:Find(math.max(0, y - self.paddingTop_))
    return { key = self.items_[index] and self.key_(self.items_[index]), index = index,
        offset = y - self.paddingTop_ - self:Prefix(math.max(0, index - 1)) }
end
function Model:Restore(anchor)
    if #self.items_ == 0 then return 0 end
    local index = self.indices_[anchor and anchor.key] or math.min(#self.items_, math.max(1, anchor and anchor.index or 1))
    return self:Clamp(self.paddingTop_ + self:Prefix(index - 1) + (anchor and anchor.offset or 0))
end
function Model:SetItems(items)
    assert(not self.disposed_, "virtual list disposed")
    local oldIndices, oldHeights = self.indices_, self.heights_
    local indices, heights = {}, {}
    for index, row in ipairs(items or {}) do
        local key = self.key_(row)
        assert((type(key) == "string" and key ~= "") or type(key) == "number", "虚拟列表条目需要稳定的非空字符串或数值键")
        assert(not indices[key], "虚拟列表条目键重复：" .. tostring(key))
        indices[key] = index
        heights[index] = oldIndices[key] and oldHeights[oldIndices[key]] or self.estimate_
    end
    self.items_, self.indices_, self.heights_, self.tree_, self.measured_ = items or {}, indices, heights, {}, {}
    self.cursor_ = 1
    self:Rebuild()
end
function Model:SetMetrics(top, bottom, gap)
    if self.paddingTop_ == top and self.paddingBottom_ == bottom and self.gap_ == gap then return false end
    self.paddingTop_, self.paddingBottom_, self.gap_ = top, bottom, gap
    self:Rebuild()
    return true
end
function Model:SetViewport(width, height, signature)
    self.height_ = math.max(0, height)
    width = math.max(1, width)
    if self.width_ == width and self.signature_ == signature then return false end
    self.width_, self.signature_, self.cursor_, self.measured_ = width, signature, 1, {}
    self.revision_ = self.revision_ + 1
    return true
end
function Model:SeedEstimate(height)
    self.estimate_ = math.max(1, height)
    for index = 1, #self.items_ do
        if not self.measured_[index] then self.heights_[index] = self.estimate_ end
    end
    self:Rebuild()
end
function Model:RefreshRows(keys)
    for _, key in ipairs(keys or {}) do
        local index = self.indices_[key]
        if index then self.measured_[index] = nil; self.cursor_ = math.min(self.cursor_, index) end
    end
    self.revision_ = self.revision_ + 1
end
function Model:SetHeight(index, height)
    if type(height) ~= "number" or height ~= height or height == math.huge then return false end
    height = math.max(0, height)
    self.measured_[index] = true
    local difference = height - self.heights_[index]
    if math.abs(difference) < 0.01 then return false end
    self.heights_[index] = height
    while index <= #self.tree_ do self.tree_[index] = self.tree_[index] + difference; index = index + (index & -index) end
    self.revision_ = self.revision_ + 1
    return true
end
function Model:Window(y)
    if #self.items_ == 0 then return 1, 0 end
    local first = self:Find(math.max(0, y - self.paddingTop_))
    local last = self:Find(math.max(0, y + self.height_ - self.paddingTop_ - 0.01))
    return math.max(1, first - 2), math.min(#self.items_, last + 2), first, last
end
function Model:Dispose()
    self.disposed_ = true
    self.items_, self.indices_, self.heights_, self.tree_, self.measured_ = {}, {}, {}, {}, {}
end
return Model
