-- 公开接口以 UTF-8 字符串键为准；表默认值按实例复制。
local Properties = {}
local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}; for key, item in pairs(value) do result[key] = copy(item) end; return result
end
local reserved = {}
for _, name in ipairs({ "名称","副名称","引用","宽度","高度","最小宽度","最小高度","最大宽度","最大高度","外边距","内边距","水平对齐","垂直对齐","可见性","层级","裁剪超出","渲染变换","布局变换","渲染变换原点","子项排列","允许换行","填充","固定子项宽度","固定子项高度","水平间隔","垂直间隔","x:Name","x:DisplayName","x:Ref","Width","Height","MinWidth","MinHeight","MaxWidth","MaxHeight","Margin","Padding","HorizontalAlignment","VerticalAlignment","Visibility","ZIndex","ClipToBounds","RenderTransform","LayoutTransform","RenderTransformOrigin","ChildLayout","Wrap","Fill","ChildWidth","ChildHeight","HorizontalGap","VerticalGap" }) do reserved[name] = true end
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
            local matches = definition.type == "event" and type(value) == "string" or type(value) == definition.type
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
