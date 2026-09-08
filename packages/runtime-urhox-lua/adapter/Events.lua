-- Public event values are action references or functions, never executable Lua.
local Events = {}
function Events.Emit(context, event, ...)
    if type(event) == "function" then return event(...) end
    local key = type(event) == "string" and
        (event:match("^%{动作%s+([^}]+)%}$") or event:match("^%{Action%s+([^}]+)%}$"))
    local callback = key and context and context.actions and context.actions[key]
    if callback then return callback(...) end
end
return Events
