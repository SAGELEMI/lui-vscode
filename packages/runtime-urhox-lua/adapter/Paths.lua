-- 数据路径只做字符串键查找，不执行 Lua。
local Paths = {}
local cache, count = {}, 0
Paths.stats = { parses = 0 }
local function parse(path)
    if type(path) ~= "string" then return nil end
    local first = path:match("^([A-Za-z][A-Za-z0-9_%-]*)")
    if not first then return nil end
    local keys, index = { first }, #first + 1
    while index <= #path do
        local char = path:sub(index, index)
        if char == "." then
            local key = path:sub(index + 1):match("^([A-Za-z][A-Za-z0-9_%-]*)")
            if not key then return nil end
            keys[#keys + 1], index = key, index + #key + 1
        elseif char == "[" then
            local quote = path:sub(index + 1, index + 1)
            if quote ~= "'" and quote ~= '"' then
                local digits=path:sub(index+1):match('^([1-9]%d*)%]')
                local value=digits and tonumber(digits)
                if not value or value>9007199254740991 then return nil end
                keys[#keys+1],index=value,index+#digits+2
            else
            index = index + 2
            local value = ""
            while index <= #path and path:sub(index, index) ~= quote do
                char = path:sub(index, index)
                if char == "\\" then
                    index = index + 1; char = path:sub(index, index)
                    if char ~= quote and char ~= "\\" then return nil end
                end
                value, index = value .. char, index + 1
            end
            if value == "" or path:sub(index, index) ~= quote or path:sub(index + 1, index + 1) ~= "]" then return nil end
            keys[#keys + 1], index = value, index + 2
            end
        else return nil end
    end
    for _, key in ipairs(keys) do if key == "__proto__" or key == "constructor" or key == "prototype" then return nil end end
    return keys
end
local function keysFor(path)
    if type(path) ~= "string" then return nil end
    local cached = cache[path]
    if cached ~= nil then return cached or nil end
    Paths.stats.parses = Paths.stats.parses + 1
    local keys = parse(path)
    if count >= 4096 then cache, count = {}, 0 end
    cache[path], count = keys or false, count + 1
    return keys
end
function Paths.Keys(path)
    local keys = keysFor(path)
    return keys and { table.unpack(keys) } or nil
end
function Paths.IsValid(path) return keysFor(path) ~= nil end
function Paths.Get(context, path)
    local keys = keysFor(path)
    if not keys then return nil end
    local value = context
    for _, key in ipairs(keys) do if type(value) ~= "table" then return nil end; value = value[key] end
    return value
end
function Paths.Set(context, path, value)
    local keys = keysFor(path)
    if not keys then return false end
    local parent = context
    for index = 1, #keys - 1 do
        parent = parent[keys[index]]
        if type(parent) ~= "table" then return false end
    end
    parent[keys[#keys]] = value
    return true
end
return Paths
