-- LUI 解析器：只识别 XML 形状的安全子集，UTF-8 文案按 Lua 字节串原样保留。
local Parser = {}

local function readResource(path)
    if not cache or not cache:Exists(path) then return nil, "LUI 资源不存在：" .. tostring(path) end
    local file = cache:GetFile(path)
    if not file or not file:IsOpen() then return nil, "LUI 资源无法打开：" .. tostring(path) end
    local ok, text = pcall(function() return file:ReadString() end)
    file:Close()
    if not ok then return nil, "LUI 资源读取失败：" .. tostring(path) end
    return text, nil
end

local function parseAttributes(text)
    local attrs = {}
    for name, quote, value in text:gmatch("([%w_%.:%-]+)%s*=%s*([\"'])(.-)%2") do attrs[name] = value end
    return attrs
end

local function makeSymbolPool()
    return { byName = {}, names = {}, Intern = function(self, name)
        local symbol = self.byName[name]
        if symbol then return symbol end
        symbol = #self.names + 1; self.names[symbol] = name; self.byName[name] = symbol
        return symbol
    end }
end

-- 主名称必须是 ASCII；副名称仅保存在编辑器可见元数据中，运行时永不用于查找。
local function validatePrimary(attrs, path, offset)
    local name = attrs["x:Name"]
    if not name then return true end
    if not name:match("^[A-Za-z][A-Za-z0-9_.%-]*$") then
        return false, string.format("%s:%d x:Name 必须是 ASCII 主名称。", path, offset)
    end
    return true
end

function Parser.Read(path) return readResource(path) end

function Parser.Parse(text, path)
    if type(text) ~= "string" then return nil, "LUI 源码必须是文本。" end
    if text:sub(1, 3) == "\239\187\191" then text = text:sub(4) end
    -- 注释属于设计源信息，不进入运行控件树；先剥离以避免把 <!----> 误判成节点。
    text = text:gsub("<!%-%-.-%-%->", "")
    local pool = makeSymbolPool()
    local root = nil
    local stack = {}
    local offset = 1
    while offset <= #text do
        local openStart, openEnd, closing, tag, rawAttrs, selfClosing = text:find("<%s*(/?)%s*([%w_%.:%-]+)(.-)(/?)%s*>", offset)
        if not openStart then break end
        local before = text:sub(offset, openStart - 1)
        if before:match("%S") and #stack > 0 then
            local parent = stack[#stack]
            parent.children[#parent.children + 1] = { kind = "Text", text = before }
        end
        offset = openEnd + 1
        if closing == "/" then
            local node = table.remove(stack)
            if not node or node.tag ~= tag then return nil, string.format("%s:%d LUI 结束标签不匹配：%s", path, openStart, tag) end
        else
            local attrs = parseAttributes(rawAttrs or "")
            local valid, message = validatePrimary(attrs, path, openStart)
            if not valid then return nil, message end
            local node = { kind = "Element", tag = tag, tagSymbol = pool:Intern(tag), attrs = attrs, attrSymbols = {}, children = {}, sourcePath = path }
            for name in pairs(attrs) do node.attrSymbols[pool:Intern(name)] = true end
            if not root then root = node elseif #stack == 0 then return nil, string.format("%s:%d LUI 只能有一个根元素。", path, openStart) end
            if #stack > 0 then
                local parent = stack[#stack]; parent.children[#parent.children + 1] = node
            end
            if selfClosing ~= "/" then stack[#stack + 1] = node end
        end
    end
    if #stack > 0 then return nil, string.format("%s: <%s> 缺少结束标签。", path, stack[#stack].tag) end
    if not root then return nil, string.format("%s: LUI 文档缺少根元素。", path) end
    root.symbols = pool.names
    return root, nil
end

function Parser.Load(path)
    local text, err = readResource(path)
    if not text then return nil, err end
    return Parser.Parse(text, path)
end

return Parser
