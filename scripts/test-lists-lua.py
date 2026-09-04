"""Production LUI parser/runtime/components on Lua 5.4; UI methods are test doubles.
Tests real nested instantiation and event routes, not engine pixels."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path("artifacts/python").resolve()))
from lupa import LuaRuntime
lua = LuaRuntime(unpack_returned_tuples=True)
project = Path(sys.argv[1]) / "scripts"
adapter = Path("packages/runtime-urhox-lua/adapter")
for name in ["Controls", "Alignment", "Paths", "Properties", "Parser", "Scrollbars"]:
    lua.globals().package.loaded["LUI." + name] = lua.execute((adapter / (name + ".lua")).read_text(encoding="utf-8-sig"))
lua.globals().read_source = lambda path: (project / path).read_text(encoding="utf-8-sig")
lua.execute("""
local Widget = {}
function Widget:GetChildren() return self.children end
function Widget:AddChild(child) self.children[#self.children+1]=child end
function Widget:SetStyle(props) for k,v in pairs(props) do self.props[k]=v end end
function Widget:GetLayout() return self.layout end
function Widget:GetAbsoluteLayout() return self.layout end
function Widget:GetAbsoluteLayoutForHitTest() return self.layout end
function Widget:Render() end
function Widget:GetScroll() return 0,self.y end
function Widget:GetContentSize() return self.layout.w,self.extent end
function Widget:SetScrollDirect(_,y) self.y=y; if self.props.onScroll then self.props.onScroll(self,0,y) end end
function Widget:SetScroll(_,y) self:SetScrollDirect(0,math.max(0,math.min(self.extent-self.layout.h,y))) end
function Widget:Update() end
local function constructor(kind, props)
  return setmetatable({kind=kind,props=props or {},children=props and props.children or {},
      layout={x=0,y=0,w=0,h=0},extent=0,y=0}, {__index=Widget})
end
local UI=setmetatable({}, {__index=function(_,kind) return function(props) return constructor(kind,props) end end})
package.loaded["urhox-libs/UI"]=UI
package.loaded["Presentation.Components"]={}
package.loaded["Audio"]={}
""")
runtime = lua.execute((adapter / "Runtime.lua").read_text(encoding="utf-8-sig"))
lua.globals().Runtime = runtime
lua.globals().package.loaded["LUI"] = runtime
lua.globals().package.loaded["Presentation.Components.ListModel"] = lua.execute((project / "Presentation/Components/ListModel.lua").read_text(encoding="utf-8-sig"))
lua.globals().package.loaded["Presentation.PageLists"] = lua.execute((project / "Presentation/PageLists.lua").read_text(encoding="utf-8-sig"))
lua.globals().Presentation = lua.execute((project / "Presentation/Presentation.lui.lua").read_text(encoding="utf-8-sig"))
lua.execute("""
local Parser=require("LUI.Parser")
local runtime=setmetatable({isV2_=true,config_={sourceRoots={"Presentation"},componentDirectories={
 ["Presentation/Components"]={["列表面板"]="Presentation/Components/SelectionList.lui"}
}},code_={}},Runtime)
function runtime:LoadDocument(path) return Parser.Parse(read_source(path),path) end
function runtime:LoadCode(path)
 self.code_[path]=self.code_[path] or assert(load(read_source(path),"@"..path))()
 return self.code_[path]
end
local function descendants(root,kind,out)
 out=out or {}
 if root.kind==kind then out[#out+1]=root end
 for _,child in ipairs(root:GetChildren()) do descendants(child,kind,out) end
 return out
end
for _,tag in ipairs({"重复项","循环"}) do
 local markup='<控件 名称="Repeat"><容器><'..tag..' 项目="row" 集合="{绑定 view.rows}"><文本 文本="{绑定 row.label}" /></'..tag..'></容器></控件>'
 local repeatRoot=runtime:BuildNode(assert(Parser.Parse(markup,"repeat.lui")),{view={rows={{label="别名有效"},{label="第二项"}}}})
 local labels=descendants(repeatRoot,"Label")
 assert(#labels==2 and labels[1].props.text=="别名有效","new and legacy tags use 项目 alias without a wrapper")
end
local original={key="bag:1",id=1,source="bag",label="同名",description="说明",disabled=false}
local disabled={key="bag:2",id=2,source="bag",label="同名",description="",disabled=true}
local chosen,switched
local parent={actions={Choose=function(row) chosen=row end,Switch=function(tab) switched=tab end}}
local state={scrollY=500}
local raw={["标题"]="测试",["计数"]="2/3",["项目"]={original,disabled},["状态"]=state,
 ["选择"]="{动作 Choose}",["页签"]={{id="bag",label="背包"},{id="talent",label="天赋"}},
 ["当前页签"]="bag",["切换"]="{动作 Switch}"}
local instance=runtime:CreateComponent("Presentation/Components/TabView.lui",parent,{}, {},raw)
local buttons=descendants(instance:GetRoot(),"Button")
assert(#buttons==4,"two tabs and two data rows")
assert(#descendants(buttons[3],"Label")==2 and #descendants(buttons[4],"Label")==1,"optional subtitle collapses")
buttons[3].props.onClick(buttons[3],{})
assert(chosen==original and state.selectedKey=="bag:1","selection returns original row, not text")
buttons[4].props.onClick(buttons[4],{})
assert(chosen==original,"disabled callback guard")
assert(buttons[3].props.backgroundColor[1]==68,"selected state updates without page rebuild")
buttons[2].props.onClick(buttons[2],{})
assert(switched==raw["页签"][2],"tab returns original stable-id item")
local scrolls=descendants(instance:GetRoot(),"ScrollView")
assert(#scrolls==1 and scrolls[1].props.scrollX==false and scrolls[1].props.scrollY==true)
local scroll=scrolls[1]; assert(scroll.y==500)
scroll.layout={x=0,y=0,w=340,h=100}; scroll.extent=250; scroll:Update(0)
assert(scroll.y==150 and state.scrollY==150,"restore clamps after layout")
scroll:SetScroll(0,80); assert(state.scrollY==80,"live state capture before dispose")
scroll.extent=120; scroll:Update(0); assert(state.scrollY==20,"content deletion clamps")
local empty=runtime:CreateComponent("Presentation/Components/SelectionList.lui",parent,{}, {},{["项目"]={},["状态"]={selectedKey="deleted"}})
assert(#descendants(empty:GetRoot(),"Button")==0,"empty card is not a button")
assert(empty.state_.selectedKey==nil)
assert(#descendants(empty:GetRoot(),"Label")==2,"empty list retains only header and counter, no placeholder card")
local M=require("Presentation.Components.ListModel")
assert(not pcall(M.Rows,{{label="no key"}}))
assert(not pcall(M.Rows,{{key="a"},{key="a"}}))
-- Presentation owns state by instance + tab, restoring detail without changing domain data.
local presentation=setmetatable({listStates_={},componentTabs_={},renders=0},Presentation)
function presentation:Render() self.renders=self.renders+1 end
presentation:SelectListItem("loadout.carried","bag",original)
presentation:GetListState("loadout.carried","bag").scrollY=80
presentation:SwitchListTab("loadout.carried",{id="talent"})
assert(presentation:GetLoadoutDetail()==nil)
presentation:SwitchListTab("loadout.carried",{id="bag"})
assert(presentation:GetLoadoutDetail().id==1)
assert(presentation:GetListState("loadout.source","bag").selectedKey==nil)
presentation:ReconcileListState("loadout.carried","bag",{})
assert(presentation:GetLoadoutDetail()==nil and presentation:GetListState("loadout.carried","bag").selectedKey==nil)
assert(presentation:GetListState("loadout.carried","bag").scrollY==80)
local retained={id="loadout-kept"}; presentation.loadoutDetail_=retained
presentation:SelectListItem("warehouse.items","all",original)
presentation:SwitchListTab("talents.items",{id="all"})
assert(presentation.loadoutDetail_==retained,"unrelated page selection and tab never route to Loadout")
local PageLists=require("Presentation.PageLists")
local stock={{instanceId="w",name="武器",type="weapon",level=1,sellPrice=8,stats={}},
 {instanceId="a",name="护甲",type="armor",level=2,sellPrice=9,stats={}}}
local talents={{id="locked",name="未解锁",state="locked",level=0,maxLevel=5,cost=10},
 {id="open",name="可升级",state="upgrade",level=1,maxLevel=5,cost=20},
 {id="max",name="满级",state="max",level=5,maxLevel=5}}
assert(#PageLists.Rows(stock,"all",false)==2 and #PageLists.Rows(stock,"weapon",false)==1)
assert(#PageLists.Rows(talents,"unlocked",true)==1 and PageLists.Rows(talents,"unlocked",true)[1].id=="open")
local vm={runId="one",floor=1,phase="reward",rewards={{definitionId="sword",name="剑",level=1,type="weapon",stats={attack=3}}}}
local claims,abandoned=0,0
local app={GetWarehouse=function() return stock end,GetTalents=function() return talents end,
 GetProfile=function() return {coins=100} end,HasRun=function() return true end,
 GetTowerView=function() return vm end,GetSettings=function() return {} end,
 SellWarehouseItem=function(_,id) assert(id=="w"); table.remove(stock,1); return true end,
 UnlockOrUpgradeTalent=function(_,id) assert(id=="open"); talents[2].state="max"; return true end,
 AcceptReward=function() claims=claims+1; return false,"背包已满" end,
 AbandonReward=function() abandoned=abandoned+1; vm.phase="between"; return true end}
presentation.app_=app; presentation.audio_={Sync=function() end}
function presentation:Perform(action) local ok=action(); self:Render(); return ok end
function presentation:ShowToast(message) self.toast=message end
local function pageContext(file)
 local cls=assert(load(read_source("Presentation/Pages/"..file..".lui.lua")))()
 return cls.CreateContext({presentation_=presentation})
end
local ctx=pageContext("Warehouse"); ctx.actions.ChangeTab({id="weapon"}); ctx=pageContext("Warehouse")
ctx.actions.SelectItem(ctx.view.rows[1]); ctx=pageContext("Warehouse")
assert(ctx.view.detail.title=="武器" and not ctx.view.detail.actions[1].disabled)
ctx.actions.Sell(); ctx=pageContext("Warehouse")
assert(#ctx.view.rows==0 and ctx.view.state.selectedKey==nil and ctx.view.detail.actions[1].disabled)
ctx=pageContext("Talents"); ctx.actions.ChangeTab({id="unlocked"}); ctx=pageContext("Talents")
ctx.actions.SelectTalent(ctx.view.rows[1]); ctx=pageContext("Talents"); ctx.actions.Upgrade()
ctx=pageContext("Talents"); assert(#ctx.view.rows==0 and ctx.view.state.selectedKey==nil)
ctx=pageContext("FloorRewards"); assert(ctx.view.detail.actions[1].disabled)
ctx.actions.SelectReward(ctx.view.rows[1]); assert(claims==0,"row click only selects")
ctx=pageContext("FloorRewards"); ctx.actions.ClaimReward()
assert(claims==1 and presentation.toast=="背包已满" and ctx.view.state.selectedKey,"failure retains selection")
vm.floor=2; ctx.actions.ClaimReward(); assert(claims==1,"stale floor cannot claim")
ctx=pageContext("FloorRewards"); assert(ctx.view.state.selectedKey==nil)
ctx.actions.SelectReward(ctx.view.rows[1]); ctx=pageContext("FloorRewards")
app.AcceptReward=function() claims=claims+1; vm.phase="between"; return true,{mergeCount=1,finalLocation="bag",finalLevel=2} end
ctx.actions.ClaimReward(); assert(claims==2 and presentation.toast:find("Lv.2",1,true))
ctx.actions.ClaimReward(); assert(claims==2,"phase guards double claim")
vm.phase="reward"; ctx=pageContext("FloorRewards"); ctx.actions.AbandonReward(); assert(abandoned==1)
-- Production logical routing and refresh guard, using a minimal registered-page factory.
app.ConsumeSettlement=function() end; app.GetSystemState=function() return {} end; app.IsReady=function() return true end
presentation.lui_={CreateRegistered=function(_,name) presentation.created=name; return {GetRoot=function() return {} end,Dispose=function() end} end}
presentation.page_="tower"; vm.phase="reward"; Presentation.Render(presentation)
assert(presentation.created=="FloorRewards")
local renders=presentation.renders; presentation:RefreshTower(); assert(presentation.renders==renders,"reward page is not rebuilt every tick")
local rewardState=presentation:GetListState("tower.rewards",PageLists.Scope(vm)); rewardState.selectedKey="held"
presentation.page_="cover"; Presentation.Render(presentation); assert(presentation.created=="Cover" and vm.phase=="reward")
presentation.page_="tower"; Presentation.Render(presentation); assert(presentation.created=="FloorRewards" and rewardState.selectedKey=="held")
vm.phase="between"; Presentation.Render(presentation); assert(presentation.created=="Tower" and presentation.listStates_["tower.rewards"]==nil)
-- Both scrollbar axes: empty always-show draws, hidden never draws, bounds clamp.
local shapes={}
nvgBeginPath=function() end; nvgFill=function() end; nvgFillColor=function() end
nvgRGBA=function(...) return {...} end
nvgRoundedRect=function(_,x,y,w,h) shapes[#shapes+1]={x=x,y=y,w=w,h=h} end
scroll.extent=0; scroll:RenderScrollbars({})
assert(#shapes==2 and shapes[2].h==96,"always-visible empty thumb")
print("LUI 2.4.2 Lua: nested runtime, blank lists, per-page/tab isolation, category deletion/upgrade, reward selection/confirmation/stale guards/return/routing, scrolling passed (UI methods stubbed).")
""")
