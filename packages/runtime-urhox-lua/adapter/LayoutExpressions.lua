-- Restricted, cached layout expressions. No load/loadstring or global lookup.
local Paths = require('LUI.Paths')
local Expressions = { stats = { parses = 0, evaluations = 0 } }
local cache, cacheCount = {}, 0
local binary = { ['or']=1, ['and']=2, ['==']=3, ['~=']=3, ['<']=3, ['<=']=3, ['>']=3, ['>=']=3, ['+']=4, ['-']=4, ['*']=5, ['/']=5 }
local functions = { min=true, max=true, count=true, choose=true }

local function tokenize(source)
    local tokens, position = {}, 1
    while position <= #source do
        local tail = source:sub(position)
        local whitespace = tail:match('^%s+')
        if whitespace then position = position + #whitespace
        else
            local first, value, kind = tail:sub(1,1)
            if first == "'" or first == '"' then
                local out, cursor, closed = {}, position + 1, false
                while cursor <= #source do
                    local char = source:sub(cursor,cursor)
                    if char == first then cursor=cursor+1; closed=true; break end
                    if char == '\\' then
                        cursor=cursor+1
                        local escaped=source:sub(cursor,cursor)
                        local replacements={n='\n',r='\r',t='\t',['\\']='\\',["'"]="'",['"']='"'}
                        assert(replacements[escaped], '布局表达式包含不支持的转义')
                        char=replacements[escaped]
                    end
                    out[#out+1]=char; cursor=cursor+1
                end
                assert(closed,'布局表达式字符串未闭合')
                value,kind=table.concat(out),'literal'
                tokens[#tokens+1]={kind=kind,value=value,raw=source:sub(position,cursor-1)}
                position=cursor
            else
                local number=tail:match('^%d+%.?%d*') or tail:match('^%.%d+')
                local identifier=tail:match('^[A-Za-z_][A-Za-z0-9_]*')
                if number then value,kind=number,'number'
                elseif identifier then value,kind=identifier,'identifier'
                else value=tail:sub(1,2); if value~='==' and value~='~=' and value~='<=' and value~='>=' then value=first end; kind='operator' end
                assert(number or identifier or value:match('^[+*/%-%(%)%[%]%,%.<>]$') or binary[value], '布局表达式包含非法字符：'..value)
                tokens[#tokens+1]={kind=kind,value=value,raw=value};position=position+#value
            end
            assert(#tokens <= 512,'布局表达式过长')
        end
    end
    tokens[#tokens+1]={kind='end',value='<end>'}
    return tokens
end

function Expressions.Parse(value)
    if type(value)~='string' then return nil end
    local source=value:match('^%{布局%s+(.+)%}$') or value:match('^%{Layout%s+(.+)%}$')
    if not source then return nil end
    if cache[value] then return cache[value] end
    Expressions.stats.parses=Expressions.stats.parses+1
    local tokens,index,depth=tokenize(source),1,0
    local dependencies,seen={},{}
    local function take(expected)
        local token=tokens[index]
        assert(not expected or token.value==expected,'布局表达式需要 '..tostring(expected)..'，实际为 '..token.value)
        index=index+1;return token
    end
    local expression
    local function atom()
        depth=depth+1;assert(depth<=64,'布局表达式嵌套过深')
        local token=take();local node
        if token.value=='(' then node=expression(1);take(')')
        elseif token.value=='-' or token.value=='not' then node={kind='unary',op=token.value,value=expression(6)}
        elseif token.kind=='number' then
            local value=tonumber(token.value)
            assert(value and value==value and value~=math.huge and value~=-math.huge,'布局数值必须有限')
            node={kind='literal',value=value}
        elseif token.kind=='literal' then node={kind='literal',value=token.value}
        elseif token.value=='true' or token.value=='false' or token.value=='nil' then
            node={kind='literal'};if token.value=='true' then node.value=true elseif token.value=='false' then node.value=false end
        elseif token.kind=='identifier' then
            if tokens[index].value=='(' then
                assert(functions[token.value],'布局表达式不允许调用 '..token.value)
                take('(');local args={}
                if tokens[index].value~=')' then repeat args[#args+1]=expression(1);if tokens[index].value~=',' then break end;take(',') until false end
                take(')')
                assert((token.value=='count' and #args==1) or (token.value=='choose' and #args==3) or ((token.value=='min' or token.value=='max') and #args>=1), '布局函数参数数量错误：'..token.value)
                node={kind='call',name=token.value,args=args}
            else
                local path=token.value
                assert(not path:match('^_'),'布局表达式不能访问私有字段')
                while tokens[index].value=='.' or tokens[index].value=='[' do
                    if tokens[index].value=='.' then
                        take('.');local key=take();assert(key.kind=='identifier' and not key.value:match('^_'),'布局字段无效');path=path..'.'..key.value
                    else
                        take('[');local key=take();assert(key.kind=='literal' or (key.kind=='number' and key.value:match('^%d+$')),'布局索引必须是字符串或整数');take(']')
                        path=path..'['..key.raw..']'
                    end
                end
                assert(Paths.IsValid(path),'布局路径无效：'..path)
                if not seen[path] then seen[path]=true;dependencies[#dependencies+1]=path end
                node={kind='path',path=path}
            end
        else error('布局表达式无效：'..token.value) end
        depth=depth-1;return node
    end
    expression=function(minimum)
        local left=atom()
        while binary[tokens[index].value] and binary[tokens[index].value]>=minimum do
            local operator=take().value
            left={kind='binary',op=operator,left=left,right=expression(binary[operator]+1)}
        end
        return left
    end
    local result={tree=expression(1),dependencies=dependencies,source=source}
    assert(tokens[index].kind=='end','布局表达式有多余内容：'..tokens[index].value)
    if cacheCount>=4096 then cache,cacheCount={},0 end
    cache[value]=result;cacheCount=cacheCount+1
    return result
end

local function finite(value)
    assert(type(value)=='number' and value==value and math.abs(value)<math.huge,'布局运算需要有限数值')
    return value
end

function Expressions.Evaluate(spec,context)
    Expressions.stats.evaluations=Expressions.stats.evaluations+1
    local evaluate
    evaluate=function(node)
        if node.kind=='literal' then return node.value end
        if node.kind=='path' then return Paths.Get(context,node.path) end
        if node.kind=='unary' then local v=evaluate(node.value);if node.op=='not' then return not v end;return -finite(v) end
        if node.kind=='call' then
            if node.name=='choose' then if evaluate(node.args[1]) then return evaluate(node.args[2]) else return evaluate(node.args[3]) end end
            if node.name=='count' then local v=evaluate(node.args[1]);assert(v==nil or type(v)=='table','count 只接受集合');return v and #v or 0 end
            local result=finite(evaluate(node.args[1]))
            for i=2,#node.args do local v=finite(evaluate(node.args[i]));result=node.name=='min' and math.min(result,v) or math.max(result,v) end
            return result
        end
        local a=evaluate(node.left)
        if node.op=='and' then if not a then return a end;return evaluate(node.right) end
        if node.op=='or' then if a then return a end;return evaluate(node.right) end
        local b=evaluate(node.right)
        if node.op=='==' then return a==b elseif node.op=='~=' then return a~=b end
        if node.op=='<' then return finite(a)<finite(b) elseif node.op=='<=' then return finite(a)<=finite(b)
        elseif node.op=='>' then return finite(a)>finite(b) elseif node.op=='>=' then return finite(a)>=finite(b) end
        a,b=finite(a),finite(b)
        if node.op=='+' then return finite(a+b) elseif node.op=='-' then return finite(a-b)
        elseif node.op=='*' then return finite(a*b) elseif node.op=='/' then assert(b~=0,'布局表达式除以零');return finite(a/b) end
        error('未知布局运算符')
    end
    return evaluate(spec.tree)
end

-- Node-local named layout values inherit, but never mutate the caller's scope.
function Expressions.Scope(attrs,parent)
    local definitions={}
    for name,value in pairs(attrs or {}) do
        local key=name:match('^布局:([A-Za-z][A-Za-z0-9_]*)$')
        if key then definitions[key]=assert(Expressions.Parse(value),'布局声明必须使用 {布局 ...}') end
    end
    if next(definitions)==nil then return parent end
    local active={}
    local context=setmetatable({}, {__index=parent})
    context.layout=setmetatable({}, {__index=function(_,key)
        local spec=definitions[key]
        if not spec then return parent.layout and parent.layout[key] end
        assert(not active[key],'循环布局声明：'..key);active[key]=true
        local ok,value=pcall(Expressions.Evaluate,spec,context);active[key]=nil
        if not ok then error(value,0) end
        return value
    end,__newindex=function() error('布局声明只读') end})
    context.luiLayoutDefinitions_=definitions
    context.luiLayoutParent_=parent
    return context
end

function Expressions.Dependencies(spec,context)
    local result,seen,active={},{},{}
    if not spec then return result end
    local function append(path,scope)
        local key=path:match('^layout%.([A-Za-z][A-Za-z0-9_]*)$')
        local definitions=scope and scope.luiLayoutDefinitions_
        while key and definitions and not definitions[key] and scope.luiLayoutParent_ do scope=scope.luiLayoutParent_;definitions=scope.luiLayoutDefinitions_ end
        if key and definitions and definitions[key] then
            assert(not active[key],'循环布局声明：'..key);active[key]=true
            for _,dependency in ipairs(definitions[key].dependencies) do append(dependency,scope) end
            active[key]=nil
        elseif not seen[path] then seen[path]=true;result[#result+1]=path end
    end
    for _,path in ipairs(spec.dependencies) do append(path,context) end
    return result
end

return Expressions
