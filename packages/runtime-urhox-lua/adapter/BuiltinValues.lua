-- Data-to-view updates for the built-in controls outside the native catalog.
local Brush=require('LUI.Brush')
local defaults=require('LUI.Contract').defaults.progress
local BuiltinValues={}
local inputKeys={'Value','Min','Max','TrackBrush','Background','FillBrush','ProgressDirection'}

-- Keep authored inputs before native constructors clamp/normalize them. Only
-- changed bindings may replace these values: resolving siblings again would
-- accidentally turn a single-pass binding into a live binding.
function BuiltinValues.Capture(widget,attrs,resolve)
    local target=widget.luiNativeWidget_ or widget
    local inputs={}
    for _,key in ipairs(inputKeys) do inputs[key]=resolve(attrs[key]) end
    target.luiBuiltinInputs_=inputs
end

function BuiltinValues.Apply(widget,tag,changes)
    if tag~='Toggle' and tag~='Slider' and tag~='Progress' then return end
    local target=widget.luiNativeWidget_ or widget
    local props=target.props
    local inputs=assert(target.luiBuiltinInputs_,'LUI built-in inputs must be captured at construction')
    for _,key in ipairs(inputKeys) do
        if changes[key] then inputs[key]=changes[key].value end
    end
    if tag=='Toggle' and changes.Value then
        local value=inputs.Value
        props.value=value==true or value=='true' or value=='是'
    elseif tag=='Slider' and (changes.Value or changes.Min or changes.Max) then
        props.min=tonumber(inputs.Min) or 0
        props.max=math.max(props.min,tonumber(inputs.Max) or 100)
        local value=tonumber(inputs.Value) or 0
        -- Slider:SetValue dispatches change; assigning the same native storage
        -- fields keeps source refresh separate from user drag events.
        props.value=math.max(props.min,math.min(props.max,value))
    elseif tag=='Progress' then
        if changes.Max or changes.Value then
            props.max=math.max(1,tonumber(inputs.Max) or defaults.max)
            local value=math.max(0,math.min(props.max,tonumber(inputs.Value) or 0))
            if target.SetValue then target:SetValue(value) else props.value=value end
        end
        if changes.TrackBrush or (changes.Background and inputs.TrackBrush==nil) then
            local raw=inputs.TrackBrush or inputs.Background
            props.luiTrackBrush=raw and Brush.Require(raw,'轨道画刷') or {kind='solid',color=defaults.track}
            target.luiTrackBrush_=props.luiTrackBrush
        end
        if changes.FillBrush then
            local raw=inputs.FillBrush
            props.luiFillBrush=raw and Brush.Require(raw,'进度画刷') or {kind='linear',angle=90,from=defaults.from,to=defaults.to,fromOffset=0,toOffset=1}
            target.luiFillBrush_=props.luiFillBrush
        end
        if changes.ProgressDirection then props.luiProgressDirection=inputs.ProgressDirection or '从左到右' end
    end
end
return BuiltinValues
