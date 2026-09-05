-- Viewport-space portals keep drawing and input independent of their owning
-- host's transform, scroll and clip. Native Modal draws before this pass.
local UI = require("urhox-libs/UI")
local Overlays = {}
local pending, sequence = {}, 0
local hosts = setmetatable({}, {__mode="k"})

function Overlays.Children(widget)
    local result, seen = {}, {}
    local function append(children)
        for _, child in ipairs(children or {}) do
            if child ~= widget and not seen[child] then seen[child]=true;result[#result+1]=child end
        end
    end
    if widget.GetChildren then append(widget:GetChildren()) end
    if widget.GetHitTestChildren then append(widget:GetHitTestChildren()) end
    append(widget.bodyChildren_)
    append(widget.luiGlobalOverlays_)
    return result
end

local function visible(widget)
    local props = widget and widget.props or {}
    return widget and not widget.luiOverlayDestroyed_ and props.visible ~= false
        and props.visibility ~= "hidden" and (not widget.IsVisible or widget:IsVisible())
end

local function active(host)
    if not host or host.luiOverlayDestroyed_ then return false end
    local current = host
    while current do
        if not visible(current) then return false end
        if not current.parent then break end
        current = current.parent
    end
    return not UI.GetRoot or current == UI.GetRoot()
end

local function inverse(widget,x,y)
    local props,rp=widget.props or {},widget.renderProps_ or {}
    local scale,rotate=rp.scale or props.scale or 1,rp.rotate or props.rotate or 0
    local tx,ty=rp.translateX or props.translateX or 0,rp.translateY or props.translateY or 0
    if scale==1 and rotate==0 and tx==0 and ty==0 then return x,y end
    local rect=widget:GetAbsoluteLayoutForHitTest()
    local presets={ ["top-left"]={0,0},["top-right"]={1,0},["bottom-left"]={0,1},["bottom-right"]={1,1},top={.5,0},bottom={.5,1},left={0,.5},right={1,.5} }
    local value=props.transformOrigin
    local point=type(value)=="table" and value or presets[value] or {.5,.5}
    local ox,oy=rect.x+(point[1] or .5)*rect.w,rect.y+(point[2] or .5)*rect.h
    local dx,dy=x-ox,y-oy
    local angle=-rotate*math.pi/180
    local rx,ry=dx*math.cos(angle)-dy*math.sin(angle),dx*math.sin(angle)+dy*math.cos(angle)
    if scale~=0 then rx,ry=rx/scale,ry/scale end
    return rx+ox-tx,ry+oy-ty
end

local function containsInteractiveChild(widget,x,y)
    if not visible(widget) or widget.props.pointerEvents=="none" then return false end
    local lx,ly=inverse(widget,x,y)
    local hit=widget.HitTest and widget:HitTest(lx,ly) or false
    if (widget.GetScroll or widget.props.overflow=="hidden" or widget.props.position=="absolute") and not hit then return false end
    if widget.props.pointerEvents~="box-only" then
        for _,child in ipairs(Overlays.Children(widget)) do
            if containsInteractiveChild(child,lx,ly) then return true end
        end
    end
    return widget.props.pointerEvents~="box-none" and hit
end

---@return {x:number,y:number,w:number,h:number}? rect
---@return string? reason
function Overlays.VisualRect(widget)
    local modal,current=nil,widget
    while current do
        if current.luiGlobalOverlay_ and not active(current.luiOverlayHost_) then return nil,"inactive-overlay" end
        if current.contentContainer_ and current.RenderModalContent then modal=current;break end
        current=current.parent
    end
    if not modal then
        return UI.GetVisualRect(widget) --[[@as {x:number,y:number,w:number,h:number}?]]
    end
    -- Native input does not include Modal's animated scale. Keep the tutorial
    -- blocked during its short entrance rather than expose a misaligned hole.
    if not modal:IsOpen() or (modal.animProgress_ or 0)<1 then return nil,"modal-animating" end
    local rect=widget:GetAbsoluteLayout()
    local x,y=rect.x,rect.y
    current=widget.parent
    while current and current~=modal do
        if current.GetScroll then local sx,sy=current:GetScroll();x,y=x-sx,y-sy end
        current=current.parent
    end
    local function forward(px,py)
        current=widget
        while current and current~=modal do
            local props,rp=current.props or {},current.renderProps_ or {}
            local scale,rotate=rp.scale or props.scale or 1,rp.rotate or props.rotate or 0
            local tx,ty=rp.translateX or props.translateX or 0,rp.translateY or props.translateY or 0
            if scale~=1 or rotate~=0 or tx~=0 or ty~=0 then
                local l=current:GetAbsoluteLayoutForHitTest()
                local presets={ ["top-left"]={0,0},["top-right"]={1,0},["bottom-left"]={0,1},["bottom-right"]={1,1},top={.5,0},bottom={.5,1},left={0,.5},right={1,.5} }
                local value=props.transformOrigin
                local point=type(value)=="table" and value or presets[value] or {.5,.5}
                local ox,oy=l.x+(point[1] or .5)*l.w,l.y+(point[2] or .5)*l.h
                local dx,dy=(px+tx-ox)*scale,(py+ty-oy)*scale
                local angle=rotate*math.pi/180
                px,py=dx*math.cos(angle)-dy*math.sin(angle)+ox,dx*math.sin(angle)+dy*math.cos(angle)+oy
            end
            current=current.parent
        end
        return px,py
    end
    local x1,y1=forward(x,y)
    local x2,y2=forward(x+rect.w,y)
    local x3,y3=forward(x,y+rect.h)
    local x4,y4=forward(x+rect.w,y+rect.h)
    local left,top=math.min(x1,x2,x3,x4),math.min(y1,y2,y3,y4)
    return {x=left,y=top,w=math.max(x1,x2,x3,x4)-left,h=math.max(y1,y2,y3,y4)-top}
end

local function ordered()
    local result={}
    for host in pairs(hosts) do
        if active(host) then
            for _,overlay in ipairs(host.luiGlobalOverlays_ or {}) do
                if visible(overlay) then result[#result+1]=overlay end
            end
        end
    end
    table.sort(result,function(a,b)
        if a.luiOverlayLayer_==b.luiOverlayLayer_ then return a.luiOverlaySequence_<b.luiOverlaySequence_ end
        return a.luiOverlayLayer_<b.luiOverlayLayer_
    end)
    return result
end

function Overlays.Release(overlay)
    if UI.PopOverlay then UI.PopOverlay(overlay) end
end

function Overlays.Unmount(overlay)
    if not overlay then return end
    Overlays.Release(overlay)
    local host=overlay.luiOverlayHost_
    if host then
        for i=#(host.luiGlobalOverlays_ or {}),1,-1 do
            if host.luiGlobalOverlays_[i]==overlay then table.remove(host.luiGlobalOverlays_,i) end
        end
        if #host.luiGlobalOverlays_==0 then hosts[host]=nil end
    end
    overlay.luiOverlayHost_,overlay.luiGlobalOverlay_=nil,nil
end

function Overlays.Observe(overlay)
    if overlay.luiOverlayObserved_ then return end
    overlay.luiOverlayObserved_=true
    local hitTest,destroy=overlay.HitTest,overlay.Destroy
    function overlay:HitTest(x,y)
        if not visible(self) or (self.luiGlobalOverlay_ and not active(self.luiOverlayHost_)) then return false end
        if self.props.pointerEvents=="none" then return false end
        if self.luiGlobalOverlay_ and self.props.pointerEvents=="box-none" then
            -- Native input falls back to the stack entry even for box-none.
            -- Reject the hole before that fallback can seal it.
            for _,child in ipairs(Overlays.Children(self)) do
                if containsInteractiveChild(child,x,y) then return true end
            end
            return false
        end
        return hitTest and hitTest(self,x,y) or false
    end
    function overlay:Destroy()
        if self.luiOverlayDestroyed_ then return end
        Overlays.Unmount(self)
        self.luiOverlayDestroyed_=true
        if destroy then destroy(self) end
    end
end

function Overlays.Mount(host,overlay,layer)
    Overlays.Observe(overlay)
    if overlay.luiOverlayDestroyed_ then return false end
    if overlay.luiOverlayHost_~=host then
        Overlays.Unmount(overlay)
        if overlay.parent then overlay.parent:RemoveChild(overlay) end
        host.luiGlobalOverlays_=host.luiGlobalOverlays_ or {}
        host.luiGlobalOverlays_[#host.luiGlobalOverlays_+1]=overlay
        sequence=sequence+1
        overlay.luiOverlaySequence_=sequence
    end
    if not host.luiOverlayHostObserved_ then
        host.luiOverlayHostObserved_=true
        local destroy=host.Destroy
        function host:Destroy()
            self.luiOverlayDestroyed_=true
            for i=#(self.luiGlobalOverlays_ or {}),1,-1 do Overlays.Unmount(self.luiGlobalOverlays_[i]) end
            for i=#pending,1,-1 do if pending[i].host==self then table.remove(pending,i) end end
            if destroy then destroy(self) end
        end
    end
    overlay.luiGlobalOverlay_,overlay.luiOverlayHost_,overlay.luiOverlayLayer_=true,host,tonumber(layer) or 0
    hosts[host]=true
    Overlays.SyncInput()
    return true
end

function Overlays.SyncInput()
    if not UI.PushOverlay or not UI.GetOverlayStack then return end
    local nextStack,wanted={},{}
    for _,overlay in ipairs(ordered()) do
        if overlay.props.pointerEvents~="none" then nextStack[#nextStack+1]=overlay;wanted[overlay]=true end
    end
    ---@type table[]
    local stack=UI.GetOverlayStack()
    for i=#stack,1,-1 do
        local entry=stack[i]
        if entry.luiGlobalOverlay_ and not wanted[entry] then UI.PopOverlay(entry) end
    end
    local matches=true
    for i,overlay in ipairs(nextStack) do if stack[#stack-#nextStack+i]~=overlay then matches=false;break end end
    if matches then return end
    for _,overlay in ipairs(nextStack) do UI.PopOverlay(overlay) end
    for _,overlay in ipairs(nextStack) do UI.PushOverlay(overlay) end
end

local function renderPortals(nvg)
    for _,overlay in ipairs(ordered()) do
        if overlay.node and type(YGNodeCalculateLayout)=="function" then
            YGNodeCalculateLayout(overlay.node,UI.GetWidth(),UI.GetHeight(),YGDirectionLTR)
        end
        if UI.RenderWidgetSubtree then UI.RenderWidgetSubtree(overlay,nvg)
        elseif overlay.Render then overlay:Render(nvg) end
    end
end

local renderer={}
function renderer:Update(dt)
    Overlays.SyncInput()
    local function update(widget)
        if widget.Update then widget:Update(dt) end
        for _,child in ipairs(widget:GetChildren() or {}) do update(child) end
    end
    for _,overlay in ipairs(ordered()) do update(overlay) end
end
function renderer:Render(nvg)
    local jobs=pending
    pending={}
    for _,job in ipairs(jobs) do if active(job.host) then job.callback(nvg) end end
    Overlays.SyncInput()
    renderPortals(nvg)
end

function Overlays.AfterNative(host,callback,nvg)
    if UI.RegisterGlobalComponent then
        UI.RegisterGlobalComponent("LUI.GlobalOverlays",renderer)
        for _,job in ipairs(pending) do if job.host==host then job.callback=callback;return end end
        pending[#pending+1]={host=host,callback=callback}
    elseif UI.QueueOverlay then UI.QueueOverlay(function(vg) callback(vg);renderPortals(vg) end)
    else callback(nvg);renderPortals(nvg) end -- Non-rendering test infrastructure only.
end

return Overlays
