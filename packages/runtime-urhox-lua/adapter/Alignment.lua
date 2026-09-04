-- LUI 2.3.2: 水平对齐 = Y（上下），垂直对齐 = X（左右）。
-- Pure logical-pixel arrangement, shared vectors are checked against Studio.
local Alignment = {}

function Alignment.Axis(start, available, desired, explicit, minimum, maximum, alignment)
    local size = explicit or ((not alignment or alignment == "拉伸") and available or desired)
    size = math.max(minimum or 0, math.min(maximum or math.huge, size))
    if alignment == "居中" then start = start + (available - size) * 0.5
    elseif alignment == "右" or alignment == "下" then start = start + available - size end
    return start, size
end

return Alignment
