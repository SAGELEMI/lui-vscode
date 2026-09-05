local PageFrame = {}

function PageFrame.Calculate(viewportWidth, viewportHeight, designWidth, designHeight, left, top, right, bottom)
    if not designWidth or designWidth <= 0 or not designHeight or designHeight <= 0 then error("LUI 页面设计尺寸必须为正数。") end
    left, top, right, bottom = left or 0, top or 0, right or 0, bottom or 0
    local availableWidth = math.max(0, viewportWidth - left - right)
    local availableHeight = math.max(0, viewportHeight - top - bottom)
    local scale = math.min(availableWidth / designWidth, availableHeight / designHeight)
    if scale ~= scale or scale == math.huge then scale = 1 end
    scale = math.max(0, scale)
    local width, height = designWidth * scale, designHeight * scale
    return { x = left + (availableWidth - width) * 0.5, y = top + (availableHeight - height) * 0.5, width = width, height = height, scale = scale, availableWidth = availableWidth, availableHeight = availableHeight }
end

return PageFrame
