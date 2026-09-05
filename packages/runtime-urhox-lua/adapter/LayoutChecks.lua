-- 仅由 layoutDiagnostics 显式开启，在真实 NanoVG 帧内运行。不是零尺寸 UI 替身。
-- 使用独立的未挂载树，不读取/写入存档、不执行页面动作、不改变 UI.SetRoot。
local UI = require("urhox-libs/UI")
local Parser = require("LUI.Parser")
local Measure = require("LUI.Measure")
local Contract = require("LUI.Contract")
local Checks = {}
local markup = [[
<页面 名称="LayoutCheck" 宽度="390" 高度="844" 内边距="25">
  <容器 子项排列="垂直" 垂直间隔="10">
    <容器 高度="40" 引用="Header">
      <文本 文本="标题" 字号="20" 水平对齐="居中" 垂直对齐="左" />
      <按钮 引用="Back" 文本="返回" 宽度="52" 高度="36" 水平对齐="居中" 垂直对齐="右" />
    </容器>
    <容器 引用="Main" 填充="是" 最小高度="0" 子项排列="垂直" 垂直间隔="10">
      <卡片 高度="90" />
      <滚动区 引用="Log" 填充="是" 最小高度="0" 垂直滚动条可见性="显示">
        <容器 引用="LogContent" 高度="1200" 子项排列="垂直">
          <按钮 引用="LogRow" 文本="战报条目" 高度="100" />
        </容器>
      </滚动区>
      <卡片 高度="100" />
    </容器>
    <容器 引用="Bottom" 高度="36" 子项排列="水平" 水平间隔="6">
      <按钮 引用="Battle" 文本="战斗" 填充="是" />
      <按钮 引用="Organize" 文本="整备" 填充="是" />
    </容器>
  </容器>
</页面>
]]

local function near(value, expected, message)
    assert(math.abs(value - expected) <= 1, message .. ": " .. tostring(value) .. " != " .. tostring(expected))
end

function Checks.Run(runtime, nvg)
    assert(type(YGNodeCalculateLayout) == "function" and type(UI.MeasureTextFit) == "function", "需要真实 Yoga/NanoVG 引擎")
    assert(Contract.defaults.lineHeight == 1.45 and Contract.defaults.button.minHeight == 36, "共享布局契约未部署")
    for _, width in ipairs({ 358, 360, 377, 390, 640 }) do
        local document, err = Parser.Parse(markup, "LUI/LayoutChecks.lui")
        assert(document, err)
        local refs = {}
        local root = runtime:BuildNode(document, { refs = refs, actions = {}, view = {} })
        assert(root.node, "不能以 UI 替身验收布局")
        local originalWidth = refs.Main.props.width
        local warmMeasurements = 0
        for frame = 1, 8 do
            YGNodeCalculateLayout(root.node, width, 844, YGDirectionLTR)
            nvgSave(nvg)
            nvgIntersectScissor(nvg, 0, 0, 0, 0)
            UI.RenderWidgetSubtree(root, nvg)
            nvgRestore(nvg)
            near(refs.Header:GetLayout().h, 40, "Header height")
            near(refs.Main:GetLayout().h, 698, "remaining height")
            near(refs.Log:GetLayout().h, 488, "scroll height")
            near(refs.Bottom:GetLayout().y, 758, "fixed bottom relative position")
            near(refs.Battle:GetLayout().w, 167, "equal width")
            near(refs.Organize:GetLayout().w, 167, "equal width")
            near(refs.Back:GetLayout().x, 288, "free X alignment")
            near(refs.Back:GetLayout().y, 2, "free Y alignment")
            assert(refs.Main.props.width == originalWidth, "排列不能改写声明尺寸")
            if frame == 2 then warmMeasurements = Measure.stats.measurements end
        end
        assert(Measure.stats.measurements == warmMeasurements, "静止帧仍在重复测量文字")
        refs.Log:UpdateContentSize()
        local _, contentHeight = refs.Log:GetContentSize()
        assert(contentHeight >= 1200, "scroll content collapsed")
        near(refs.LogContent:GetLayout().w, 314, "8px scrollbar gutter plus border/padding")
        refs.Log:SetScroll(0, 50)
        local painted = refs.LogRow:GetAbsoluteLayout()
        local hit = refs.LogRow:GetAbsoluteLayoutForHitTest()
        near(painted.y - hit.y, 50, "scroll hit offset")
        print("[LUI engine check] PASS viewport=" .. width .. " frames=8 fill/free/scroll/hit/declarations")
        if root.Destroy then root:Destroy() end
    end
    -- Reproduce the screenshots through real Yoga + NanoVG traversal. A hidden
    -- editor/between-floor card must never consume the log/list fill allocation.
    local document=assert(Parser.Parse([[<控件 名称="DynamicCheck"><容器 子项排列="垂直" 垂直间隔="10"><容器 引用="Optional" 高度="120" 可见性="{绑定 view.expanded}"/><容器 引用="Fill" 填充="是"/><画布 高度="60"><容器 引用="Hole" 画布.左="{绑定 view.x}" 画布.上="4" 宽度="80" 高度="40" 背景="#0804104D"/></画布></容器></控件>]]))
    for _, size in ipairs({{358,425},{360,800},{377,496},{390,844},{390,867},{640,1024}}) do
        local context={view={expanded=false,x=24},refs={}}
        local root=runtime:BuildNode(document,context)
        local original=context.refs.Optional
        for _, expanded in ipairs({false,true,false}) do
            context.view.expanded=expanded
            YGNodeCalculateLayout(root.node,size[1],size[2],YGDirectionLTR)
            nvgSave(nvg);nvgIntersectScissor(nvg,0,0,0,0);UI.RenderWidgetSubtree(root,nvg);nvgRestore(nvg)
            near(context.refs.Fill:GetLayout().h,size[2]-(expanded and 200 or 70),'collapsed fill')
            near(context.refs.Hole:GetLayout().x,24,'canvas x');near(context.refs.Hole:GetLayout().h,40,'canvas height')
            assert(context.refs.Hole.props.backgroundColor[4]==77,'mask RGBA alpha')
            assert(context.refs.Optional==original,'dynamic identity')
        end
        root:Destroy()
        print('[LUI engine check] PASS dynamic '..size[1]..'x'..size[2]..' collapse/canvas/alpha/identity')
    end
end

-- Explicit, asynchronous integration fixture. It uses UI.Render's actual native
-- queue and input stack over several frames, then restores the isolated preview
-- root. Never call this from a running game or enable it as layoutDiagnostics.
function Checks.StartOverlays(runtime, callback)
    assert(UI.GetRoot and UI.FindWidgetAt and UI.Modal and YGNodeCalculateLayout,
        "覆盖层验收需要真实 Yoga、UI.Modal 和 UI.FindWidgetAt")
    local Overlays=require("LUI.Overlays")
    local savedRoot,savedStack=UI.GetRoot(),{}
    for _,entry in ipairs(UI.GetOverlayStack()) do savedStack[#savedStack+1]=entry end
    for _,entry in ipairs(savedStack) do UI.PopOverlay(entry) end
    local root=UI.Panel{width="100%",height="100%",pointerEvents="box-none"}
    local host=UI.Panel{width=240,height=300,scale=.75,translateX=37,translateY=23,overflow="hidden",pointerEvents="box-none"}
    root:AddChild(host)
    local refs={}
    local content=runtime:BuildNode(assert(Parser.Parse([[<控件 名称="RewardFixture"><容器 高度="100" 子项排列="垂直" 垂直间隔="8"><按钮 引用="RewardRow" 文本="领取奖励" 高度="44"/><按钮 引用="Confirm" 文本="确认奖励" 高度="44"/></容器></控件>]])),{refs=refs,view={},actions={}})
    local modal=UI.Modal{title="奖励覆盖层验收",size="fullscreen",showCloseButton=false,closeOnOverlay=false,children={content}}
    host:AddChild(modal)
    local context={refs={},view={w=390,h=867,rects={}},actions={}}
    local masks={"Top","Left","Right","Bottom"}
    for _,name in ipairs(masks) do context.view.rects[name]={x=0,y=0,w=0,h=0} end
    local markup='<控件 名称="CoachFixture" 宽度="{绑定 view.w}" 高度="{绑定 view.h}"><画布>'
    for _,name in ipairs(masks) do
        local base="{绑定 view.rects."..name
        markup=markup..'<容器 引用="'..name..'" 画布.左="'..base..'.x}" 画布.上="'..base..'.y}" 宽度="'..base..'.w}" 高度="'..base..'.h}" 背景="#0804104D"/>'
    end
    markup=markup..'<按钮 引用="Skip" 画布.左="8" 画布.上="8" 宽度="96" 高度="36" 文本="跳过教程"/></画布></控件>'
    local overlay=runtime:BuildNode(assert(Parser.Parse(markup)),context)
    overlay:SetStyle{pointerEvents="box-none"}
    overlay:GetChildren()[1]:SetStyle{pointerEvents="box-none"}
    for _,name in ipairs(masks) do context.refs[name]:SetStyle{pointerEvents="box-only"} end
    local notice=UI.Panel{width=10,height=10,pointerEvents="none"}
    local blocking=UI.Panel{width="100%",height="100%",pointerEvents="box-only"}
    local drawOrder,frame,settled={},0,false
    local modalRender=modal.RenderModalContent
    function modal:RenderModalContent(vg) modalRender(self,vg);drawOrder[#drawOrder+1]="modal" end
    local overlayRender=overlay.Render
    function overlay:Render(vg) overlayRender(self,vg);drawOrder[#drawOrder+1]="coach" end
    local noticeRender=notice.Render
    function notice:Render(vg) noticeRender(self,vg);drawOrder[#drawOrder+1]="notice" end
    local blockingRender=blocking.Render
    function blocking:Render(vg) blockingRender(self,vg);drawOrder[#drawOrder+1]="blocking" end
    local outcome={}
    local function finish(ok,message)
        if settled then return end
        settled=true
        modal:Close()
        for _,widget in ipairs({overlay,notice,blocking}) do runtime:UnmountGlobalOverlay(widget);widget:Destroy() end
        root:Destroy()
        -- Modal's native content is a separate Yoga tree, not a normal child.
        if modal.contentContainer_ and modal.contentContainer_.node then modal.contentContainer_:Destroy() end
        UI.SetRoot(savedRoot)
        for _,entry in ipairs(savedStack) do UI.PushOverlay(entry) end
        Overlays.SyncInput()
        for _,entry in ipairs(UI.GetOverlayStack()) do
            if entry==modal or entry==overlay or entry==notice or entry==blocking then
                ok,message=false,"fixture input stack leaked after Dispose"
            end
        end
        if callback then callback(ok,message) end
    end
    function root:Update()
        if outcome.ok~=nil then finish(outcome.ok,outcome.message) end
    end
    UI.SetRoot(root)
    runtime:MountGlobalOverlay(host,overlay,400)
    runtime:MountGlobalOverlay(host,notice,300)
    modal:Open();modal:Update(1)
    runtime:AfterLayout(root,function()
        if settled or outcome.ok~=nil then return end
        local ok,err=xpcall(function()
            frame=frame+1
            if frame>1 then
                local positions={}
                for i,name in ipairs(drawOrder) do positions[name]=i end
                -- Current frame's Modal has rendered; previous frame portals
                -- must have followed its Modal and respected all three layers.
                local firstModal,firstNotice,firstCoach,firstBlocking
                for i,name in ipairs(drawOrder) do
                    if name=="modal" and not firstModal then firstModal=i end
                    if name=="notice" and not firstNotice then firstNotice=i end
                    if name=="coach" and not firstCoach then firstCoach=i end
                    if name=="blocking" and not firstBlocking then firstBlocking=i end
                end
                assert(firstModal and firstNotice and firstCoach and firstModal<firstNotice and firstNotice<firstCoach,"native queue -> notice -> tutorial")
                if frame==9 then assert(firstBlocking and firstCoach<firstBlocking,"blocking error must render after tutorial") end
            end
            drawOrder={"modal"}
            local width,height=UI.GetWidth(),UI.GetHeight()
            context.view.w,context.view.h=width,height
            local target=frame>=6 and refs.Confirm or refs.RewardRow
            local rect=assert(runtime:GetScreenRect(target),"native Modal target missing")
            assert(runtime:FindByRef(root,frame>=6 and "Confirm" or "RewardRow")==target,"native body reference traversal")
            local raw=target:GetAbsoluteLayoutForHitTest()
            near(rect.x,raw.x,"native target ignores transformed host X")
            near(rect.y,raw.y,"native target ignores transformed host Y")
            local x,y=math.max(0,rect.x-4),math.max(0,rect.y-4)
            local right,bottom=math.min(width,rect.x+rect.w+4),math.min(height,rect.y+rect.h+4)
            context.view.rects={Top={x=0,y=0,w=width,h=y},Left={x=0,y=y,w=x,h=bottom-y},Right={x=right,y=y,w=width-right,h=bottom-y},Bottom={x=0,y=bottom,w=width,h=height-bottom}}
            if frame==3 or frame==5 or frame==8 then
                local hit=UI.FindWidgetAt(rect.x+rect.w/2,rect.y+rect.h/2)
                assert(hit==target,"tutorial hole must reach native reward/confirm button")
                local outside=UI.FindWidgetAt(width-2,height-2)
                assert(outside==context.refs.Bottom,"outside tutorial hole must be blocked")
                assert(UI.FindWidgetAt(20,20)==context.refs.Skip,"tutorial skip remains clickable")
                local area=0
                for _,name in ipairs(masks) do
                    local box=context.refs[name]:GetAbsoluteLayout()
                    assert(context.refs[name].props.backgroundColor[4]==77,"mask alpha must be 77")
                    area=area+box.w*box.h
                end
                near(area,width*height-(right-x)*(bottom-y),"four masks have no overlap and leave transparent hole")
                assert(overlay.parent==nil,"portal must not inherit host transform/clip")
                local count=0
                for _,entry in ipairs(UI.GetOverlayStack()) do if entry==overlay then count=count+1 end end
                assert(count==1,"input stack registration is idempotent")
            end
            runtime:MountGlobalOverlay(host,overlay,400)
            if frame==3 then modal:Close();modal:Open();modal:Update(1) end
            if frame==8 then runtime:MountGlobalOverlay(host,blocking,1000) end
            if frame==9 then
                assert(UI.FindWidgetAt(rect.x+rect.w/2,rect.y+rect.h/2)==blocking,"blocking error must own input above tutorial")
                runtime:UnmountGlobalOverlay(blocking)
                overlay:SetVisible(false);Overlays.SyncInput()
                for _,entry in ipairs(UI.GetOverlayStack()) do assert(entry~=overlay,"hidden overlay input leak") end
                overlay:SetVisible(true);runtime:MountGlobalOverlay(host,overlay,400)
            end
            if frame==10 then
                runtime:UnmountGlobalOverlay(overlay)
                assert(UI.FindWidgetAt(rect.x+rect.w/2,rect.y+rect.h/2)==target,"unmount releases native input")
                runtime:MountGlobalOverlay(host,overlay,400)
                UI.SetRoot(savedRoot);Overlays.SyncInput()
                for _,entry in ipairs(UI.GetOverlayStack()) do assert(entry~=overlay,"switching roots leaves stale input") end
                UI.SetRoot(root);Overlays.SyncInput()
                outcome.ok=true
                outcome.message="PASS actual UI.Modal queue/body refs/reward+confirm hole/alpha/non-overlap/skip/notice/tutorial/error layers/reopen/hide/unmount/root-switch; viewport="..width.."x"..height.." scale="..UI.GetScale()
                print("[LUI overlays check] "..outcome.message)
            end
        end,debug.traceback)
        if not ok then outcome.ok=false;outcome.message=tostring(err);print("[LUI overlays check] FAIL "..outcome.message) end
    end)
    return {Cancel=function() finish(false,"cancelled") end}
end

return Checks
