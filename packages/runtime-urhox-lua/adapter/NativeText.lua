-- Exact Lua-to-NanoVG text-measurement boundaries. Active LUI guards own the
-- cancellation point; helpers use raw save/restore with finally, never UI's
-- private saveDepth counter. Non-LUI calls retain the native helper behavior.
local UI = require('urhox-libs/UI')
local Budget = require('LUI.MeasureBudget')
local Native = { stats = { starts = 0, cacheHits = 0, restoredOnError = 0 } }
local installed, constructing = false, 0
local states = setmetatable({}, {__mode='k'})
local guard
local rawSave, rawRestore

local function copy(source)
    local result={};for key,value in pairs(source)do result[key]=value end;return result
end
local function initial()
    return {fontFace='sans',fontSize=16,letterSpacing=0,lineHeight=1,align=0,blur=0,transform='identity'}
end
local function state(context)
    local entry=states[context]
    if not entry then entry={value=initial(),stack={}};states[context]=entry end
    return entry
end
local function encode(value)
    local text=tostring(value);return type(value)..':'..#text..':'..text
end
local function signature(name,context,...)
    local value=state(context).value
    local parts={name,encode(value.fontFace),encode(value.fontSize),encode(value.letterSpacing),encode(value.lineHeight),
        encode(value.align),encode(value.blur),value.transform,encode(UI.GetFontVersion and UI.GetFontVersion()),
        encode(UI.Theme and UI.Theme.GetScale and UI.Theme.GetScale())}
    for index=1,select('#',...)do parts[#parts+1]=encode(select(index,...))end
    return table.concat(parts,'|')
end
local function measured(name,callback,context,...)
    if not Budget.Active() then return callback(context,...) end
    local owner=Budget.Owner()
    if owner and owner.luiText_=='Text' and state(context).value.transform~='identity' then
        -- Author transforms animate the drawing, not the declared text box.
        -- Native Label also caches its own direct multiline bounds, so all of
        -- this Text's measurement phases use the helper's identity matrix.
        nvgSave(context);nvgResetTransform(context)
        local result=table.pack(pcall(measured,name,callback,context,...))
        nvgRestore(context)
        if not result[1] then error(result[2],0) end
        return table.unpack(result,2,result.n)
    end
    local cache,key
    if owner then
        cache=owner.luiNativeTextPhases_
        if not cache or cache.context~=context then cache={context=context,count=0};owner.luiNativeTextPhases_=cache end
        key=signature(name,context,...)
        local found=cache[key]
        if found then Native.stats.cacheHits=Native.stats.cacheHits+1;return table.unpack(found,1,found.n)end
    end
    local values=table.pack(Budget.Native(function(...)
        Native.stats.starts=Native.stats.starts+1
        return callback(...)
    end,context,...))
    if cache then
        if cache.count>=64 then cache={context=context,count=0};owner.luiNativeTextPhases_=cache end
        cache[key],cache.count=values,cache.count+1
    end
    return table.unpack(values,1,values.n)
end
local function decrement(context)
    local current=guard
    while current do
        if (current.saves[context]or 0)>0 then current.saves[context]=current.saves[context]-1;return end
        current=current.parent
    end
end
local function saved(context,callback)
    nvgSave(context)
    local result=table.pack(pcall(callback))
    nvgRestore(context)
    if not result[1]then error(result[2],0)end
    return table.unpack(result,2,result.n)
end
local function markConstructed(widget,seen)
    if type(widget)~='table' or seen[widget] then return end
    seen[widget]=true
    -- Native labels initially receive a temporary baseline. Their font reload
    -- path recomputes it under the first guarded render, before any text draw.
    if widget.fontVersion_~=nil or widget.luiText_ then widget.fontVersion_=-1 end
    local function visit(children)for _,child in ipairs(children or {})do markConstructed(child,seen)end end
    visit(widget.GetChildren and widget:GetChildren());visit(widget.bodyChildren_)
    visit(widget.GetHitTestChildren and widget:GetHitTestChildren())
end
local function finite(value,fallback)
    value=tonumber(value)
    return value and value==value and math.abs(value)~=math.huge and value or fallback
end
local function setup(context,size,face,spacing,lineHeight)
    nvgResetTransform(context)
    nvgFontFace(context,face or 'sans');nvgFontSize(context,size)
    nvgTextLetterSpacing(context,spacing or 0);nvgTextLineHeight(context,lineHeight or 1)
    nvgTextAlign(context,NVG_ALIGN_LEFT+NVG_ALIGN_TOP)
end

-- Menu's native constructor derives an intrinsic width once. Keep its scalar
-- accumulator across budget pauses; a menu with many items must not restart
-- all completed labels when a later shortcut is deferred.
function Native.AttachMenu(widget,autoWidth,runtime)
    if widget.luiNativeMenu_ then return end
    widget.luiNativeMenu_=true
    local function pending()
        if autoWidth then widget.luiMenuMeasure_={index=1,width=widget.minWidth_ or 0} end
    end
    pending()
    local render=widget.Render
    function widget:Render(...)
        local job=self.luiMenuMeasure_
        if job then
            local icons,submenu=false,false
            for _,item in ipairs(self.items_ or {})do
                if item.icon or item.checked~=nil then icons=true end
                if item.items then submenu=true end
            end
            local left,right=self.paddingLeft_ or 0,self.paddingRight_ or 0
            local icon=icons and ((self.iconSize_ or 0)+left)or 0
            local arrow=submenu and (self.iconSize_ or 0)or 0
            local margin=self.hasItemMargin_ and ((self.itemMarginLeft_ or 0)+(self.itemMarginRight_ or 0))or 0
            local extra=left+right+margin+icon+left+arrow+right+(arrow>0 and right or 0)
            while job.index<=#(self.items_ or {})do
                local item=self.items_[job.index]
                if item.type~='divider' then
                    local width=UI.MeasureTextWidth(item.label or item.text or '',self.fontSize_,self.props.fontFamily)
                    local shortcut=item.shortcut and (UI.MeasureTextWidth(item.shortcut,self.fontSize_*.85,self.props.fontFamily)+right*2)or 0
                    job.width=math.max(job.width,extra+width+shortcut)
                end
                job.index=job.index+1
            end
            self.luiMenuMeasure_=nil;self.minWidth_=job.width
            if self.props.width~=job.width then self:SetStyle({width=job.width}) end
        end
        return render(self,...)
    end
    for _,name in ipairs({'SetItems','AddItem','RemoveItem'})do
        local original=widget[name]
        if original then widget[name]=function(self,...)local result=original(self,...);pending();return result end end
    end
    local open=widget.OpenSubmenu
    local close=widget.CloseSubmenu
    if close then
        function widget:CloseSubmenu(...)
            local child=self.submenuWidget_
            local result=close(self,...)
            if child and child.Destroy then child:Destroy() end
            return result
        end
    end
    local destroy=widget.Destroy
    if destroy then
        function widget:Destroy(...)
            if self.CloseSubmenu then self:CloseSubmenu() end
            return destroy(self,...)
        end
    end
    if open then
        function widget:OpenSubmenu(...)
            local result=Native.Construct(function(...)open(self,...);return self.submenuWidget_ end,...)
            if result then
                Native.AttachMenu(result,true,runtime)
                require('LUI.RenderBudget').AttachTree(result,runtime)
            end
            return result
        end
    end
end

local function installEditMenu()
    if type(UI.GetTopOverlay)~='function' then return end
    local ok,EditMenu=pcall(require,'urhox-libs/UI/Widgets/EditMenu')
    if not ok or type(EditMenu.Show)~='function' then return end
    local show=EditMenu.Show
    EditMenu.Show=function(options)
        local budget=options and options.owner and options.owner.luiNativeMeasureBudget_
        if not budget then return show(options) end
        -- Showing the menu must finish its state mutation even when input
        -- arrives after this frame's budget. Its guarded draw commits layout.
        Native.Construct(function()show(options)end)
        local widget=UI.GetTopOverlay()
        if not widget or widget.owner_~=options.owner then return end
        widget.luiEditMenuLayout_={options.anchorX,options.anchorY,options.anchorH or 0}
        if not widget.luiEditMenuDeferred_ then
            widget.luiEditMenuDeferred_=true
            local render=widget.Render
            function widget:Render(...)
                if self.items_ and self.luiEditMenuLayout_ then
                    self:UpdateLayout(table.unpack(self.luiEditMenuLayout_))
                    self.luiEditMenuLayout_=nil
                end
                return render(self,...)
            end
        end
        require('LUI.RenderBudget').AttachTree(widget,{luiMeasureBudget_=budget})
        widget.luiRenderDeferredFrame_=budget.frame
    end
end

function Native.Construct(callback,...)
    Native.Install();constructing=constructing+1
    local result=table.pack(pcall(callback,...));constructing=constructing-1
    if not result[1]then error(result[2],0)end
    if constructing==0 then markConstructed(result[2],{}) end
    return table.unpack(result,2,result.n)
end
function Native.WithOwner(widget,callback,...)
    Native.Install()
    if not installed then
        -- Hosts exposing only the UI helper API retain the compatibility path;
        -- the native engine path below counts the actual C entries instead.
        return Budget.WithOwner(widget,function(...)return Budget.Native(callback,...)end,...)
    end
    return Budget.WithOwner(widget,callback,...)
end

function Native.Install()
    if installed then return end
    -- Pure-Lua test doubles may not expose any native drawing API.
    if type(nvgTextBounds)~='function' or type(nvgSave)~='function' or type(UI.GetNVGContext)~='function' then return end
    installed=true
    installEditMenu()
    rawSave,rawRestore=nvgSave,nvgRestore
    nvgSave=function(context)
        local result=rawSave(context)
        local entry=state(context);entry.stack[#entry.stack+1]=entry.value;entry.value=copy(entry.value)
        if guard then guard.saves[context]=(guard.saves[context]or 0)+1 end
        return result
    end
    nvgRestore=function(context)
        local result=rawRestore(context)
        local entry=state(context);entry.value=table.remove(entry.stack)or initial();decrement(context)
        return result
    end
    for name,field in pairs({nvgFontFace='fontFace',nvgFontFaceId='fontFace',nvgFontSize='fontSize',nvgTextLetterSpacing='letterSpacing',
        nvgTextLineHeight='lineHeight',nvgTextAlign='align',nvgFontBlur='blur'})do
        local original=_G[name]
        if type(original)=='function' then
            _G[name]=function(context,value,...)
                state(context).value[field]=name=='nvgFontFaceId' and 'id:'..tostring(value)or value
                return original(context,value,...)
            end
        end
    end
    for _,name in ipairs({'nvgResetTransform','nvgTransform','nvgTranslate','nvgRotate','nvgScale','nvgSkewX','nvgSkewY'})do
        local original=_G[name]
        if type(original)=='function' then
            _G[name]=function(context,...)
                local value=state(context).value
                if name=='nvgResetTransform' then value.transform='identity'
                else
                    local parts={value.transform,name};for index=1,select('#',...)do parts[#parts+1]=encode(select(index,...))end
                    value.transform=table.concat(parts,'|')
                end
                return original(context,...)
            end
        end
    end
    if type(nvgBeginFrame)=='function' then
        local original=nvgBeginFrame
        nvgBeginFrame=function(context,...)
            states[context]={value=initial(),stack={}}
            return original(context,...)
        end
    end
    for _,name in ipairs({'nvgTextBounds','nvgTextBoxBounds','nvgTextMetrics'})do
        local original=_G[name]
        if type(original)=='function' then
            _G[name]=function(context,...)
                if Budget.Active() and name=='nvgTextBounds' then
                    local x,y,text,last,bounds=...
                    return measured(name,original,context,x,y,text,last,bounds,false)
                elseif Budget.Active() and name=='nvgTextBoxBounds' then
                    local x,y,width,text,last,bounds=...
                    return measured(name,original,context,x,y,width,text,last,bounds,false)
                end
                return measured(name,original,context,...)
            end
        end
    end
    -- The engine's translation bridge may otherwise measure source/target
    -- widths inside a draw call. LUI keeps translation, while its authored
    -- font sizes and explicit fit own layout; no second i18n shrink pass runs.
    for _,name in ipairs({'nvgText','nvgTextBox'})do
        local original=_G[name]
        if type(original)=='function' then
            _G[name]=function(context,...)
                if not Budget.Active() then return original(context,...) end
                if name=='nvgText' then
                    local x,y,text,last=...;return original(context,x,y,text,last,false)
                end
                local x,y,width,text,last=...;return original(context,x,y,width,text,last,false)
            end
        end
    end
    Budget.SetGuardHooks({Begin=function()
        guard={parent=guard,saves={}};return guard
    end,Finish=function(scope,failed)
        if failed then
            for context,count in pairs(scope.saves)do
                for _=1,count do
                    rawRestore(context);local entry=state(context);entry.value=table.remove(entry.stack)or initial()
                    Native.stats.restoredOnError=Native.stats.restoredOnError+1
                end
            end
        end
        guard=scope.parent
    end})
    local oldWidth,oldFit,oldBaseline=UI.MeasureTextWidth,UI.MeasureTextFit,UI.MeasureTextBaseline
    UI.MeasureTextWidth=function(text,size,face,spacing)
        if constructing>0 then return 0 end
        if not Budget.Active()then return oldWidth(text,size,face,spacing)end
        local context=UI.GetNVGContext();if not context or text==nil or text==''then return 0 end
        return saved(context,function()
            setup(context,size,face,spacing,1)
            return nvgTextBounds(context,0,0,text,nil,nil,false)or 0
        end)
    end
    UI.MeasureTextBaseline=function(size,face)
        if constructing>0 then return 0 end
        if not Budget.Active()then return oldBaseline(size,face)end
        local context=UI.GetNVGContext();if not context then return 0 end
        return saved(context,function()setup(context,size,face,0,1);local ascender=nvgTextMetrics(context);return ascender end)
    end
    UI.MeasureTextFit=function(text,options)
        options=type(options)=='table' and options or {}
        local size=finite(options.fontSize,0)
        if constructing>0 then return {fontSize=size,width=0,height=0}end
        if not Budget.Active()then return oldFit(text,options)end
        local context=UI.GetNVGContext();local width,height=finite(options.width),finite(options.height)
        if width then width=math.max(0,width) end;if height then height=math.max(0,height) end
        local face=options.fontFace or 'sans';local spacing=finite(options.letterSpacing,0);local lineHeight=finite(options.lineHeight,1)
        if lineHeight<=0 then lineHeight=1 end
        local multiline=options.multiline==true
        local version=UI.GetFontVersion and UI.GetFontVersion()
        local scale=UI.Theme and UI.Theme.GetScale and UI.Theme.GetScale()
        local cache=type(options.cache)=='table' and options.cache
        -- Native Label passes the previous result on every render. This path
        -- avoids both native work and per-phase signature allocation at rest.
        if cache and cache.luiFixedFont_ and cache.text==text and cache.baseFontSize==size
            and cache.fontFace==face and cache.letterSpacing==spacing and cache.lineHeight==lineHeight
            and cache.availableWidth==width and cache.availableHeight==height and cache.multiline==multiline
            and cache.fontVersion==version and cache.uiScale==scale and cache.context==context then return cache end
        local function completed(w,h)
            local result=cache or {}
            result.luiFixedFont_,result.text,result.baseFontSize=true,text,size
            result.fontFace,result.letterSpacing,result.lineHeight=face,spacing,lineHeight
            result.availableWidth,result.availableHeight,result.multiline=width,height,multiline
            result.minFontSize,result.fontVersion,result.uiScale,result.context=size,version,scale,context
            result.fontSize,result.width,result.height=size,w,h
            return result
        end
        if not context or text==nil or text==''or size<=0 or (width==nil and height==nil)then return completed(0,0)end
        local measuredWidth,measuredHeight=saved(context,function()
            setup(context,size,face,spacing,lineHeight)
            if multiline then
                local bounds=nvgTextBoxBounds(context,0,0,width and math.max(1,width)or 1000000,text,nil,nil,false)
                return math.max(0,bounds[3]-bounds[1]),math.max(0,bounds[4]-bounds[2])
            end
            local advance,bounds=nvgTextBounds(context,0,0,text,nil,nil,false)
            local _,_,line=nvgTextMetrics(context)
            return math.max(advance or 0,bounds and bounds[3]-bounds[1]or 0),math.max(bounds and bounds[4]-bounds[2]or 0,(line or 0)*lineHeight)
        end)
        -- Only completed results are exposed; the native-call memo above keeps
        -- successful phases when a later phase is postponed to the next frame.
        return completed(measuredWidth,measuredHeight)
    end
end

return Native
