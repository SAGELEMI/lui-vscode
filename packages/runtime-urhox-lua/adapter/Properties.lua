-- 公开接口以 UTF-8 字符串键为准；表默认值按实例复制。
local Properties = {}
local Capabilities = require("LUI.Capabilities")
local Parser = require("LUI.Parser")
local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}; for key, item in pairs(value) do result[key] = copy(item) end; return result
end
local reserved = setmetatable({}, { __index = function(self, name) return rawget(self, Parser.CanonicalAttribute(name)) end })
for _, group in ipairs({ "identity", "rootIdentity", "layout" }) do
    for _, name in ipairs(Capabilities.groups[group]) do reserved[name] = true end
end
Properties.IsLayout = function(name) return reserved[name] == true end
function Properties.Apply(schema, incoming)
    incoming = incoming or {}
    if schema == nil then return incoming end -- 外部旧组件兼容入口
    if type(schema) ~= "table" then error("Properties 必须是声明表") end
    local result = {}
    for name, definition in pairs(schema) do
        if type(name) ~= "string" or not utf8.len(name) or name == "" or name:find("[%s<>/=\"':%[%]\\]") or name:match("^%d") or reserved[name] or name == "__proto__" or name == "constructor" or name == "prototype" then error("公开属性名非法或覆盖布局属性：" .. tostring(name)) end
        if type(definition) ~= "table" or not ({ string=true, number=true, boolean=true, table=true, event=true })[definition.type] then error("公开属性类型无效：" .. name) end
        if definition.description ~= nil and type(definition.description) ~= "string" then error("属性说明必须是字符串：" .. name) end
        if definition.default ~= nil and (definition.type == "event" or type(definition.default) ~= definition.type) then error("默认值类型不符：" .. name) end
        local value = incoming[name]
        if type(value) == 'string' and definition.type == 'number' then value = tonumber(value) or value end
        if definition.type == 'boolean' then
            if value == 'true' or value == '是' then value = true elseif value == 'false' or value == '否' then value = false end
        end
        if value == nil then value = copy(definition.default) end
        if value ~= nil then
            local matches = definition.type == "event" and (type(value) == "string" or type(value) == "function") or type(value) == definition.type
            if not matches then error("公开属性类型不符：" .. name .. "，需要 " .. definition.type) end
        end
        result[name] = value
    end
    for name, value in pairs(incoming) do
        if reserved[name] then result[name] = value
        elseif schema[name] == nil then error("组件未声明公开属性：" .. name) end
    end
    return result
end
return Properties
