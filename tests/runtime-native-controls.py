"""Production LUI + unmodified official native widget constructors/setters/events.

Uses the validated local UrhoX 1.29.7 cache. Only Yoga/widget infrastructure and
theme/drawing services are doubles; native control state logic is not replaced.
No browser, remote service, game payload or player save is accessed.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "artifacts/python"))
from lupa.lua54 import LuaRuntime

cache = root / "artifacts/engine-cache"
records = {}
for metadata in cache.glob("*.json"):
    record = json.loads(metadata.read_text(encoding="utf-8"))
    data = metadata.with_suffix("").read_bytes()
    assert hashlib.sha256(data).hexdigest() == record["sha256"]
    records[record["url"]] = data
release = json.loads(records["https://tapcode-sce.spark.xd.com/src/engine-res/1.29.7/version.json"])
manifest = json.loads(records[f"https://tapcode-sce.spark.xd.com/src/engine-res/1.29.7/manifest-{release['client']}.json"])
blob = next(data for url, data in records.items() if url.endswith(".data"))
assert blob[:8] == b"URXRES1\0"
offset = 12 + struct.unpack_from("<I", blob, 8)[0]
header = json.loads(blob[12:offset])
assert header["version"] == "1.29.7" and header["client"] == release["client"]
packed = {entry["path"]: entry for entry in header["files"]}
sources = {}
for entry in manifest["files"]:
    if entry["fs_path"].startswith("urhox-libs/UI/") and entry["fs_path"].endswith(".lua"):
        item = packed[f"assets/{entry['uuid']}-{entry['hash']}{entry['ext']}"]
        assert item["size"] == entry["size"]
        sources[entry["fs_path"][:-4]] = blob[offset + item["offset"]:offset + item["offset"] + item["size"]].decode("utf-8")

lua = LuaRuntime(unpack_returned_tuples=True)
lua.globals().native_read = lambda name: sources[name]
lua.globals().native_path = lambda name: next(path for path in sources if path.endswith("/" + name))
lua.globals().adapter_read = lambda name: (root / "packages/runtime-urhox-lua/adapter" / f"{name}.lua").read_text(encoding="utf-8-sig")
lua.execute(r'''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=="LUI." then return assert(load(adapter_read(name:sub(5)),"@"..name)) end
 local ok,source=pcall(native_read,name)
 if ok then return assert(load(source,"@official-1.29.7/"..name)) end
end)
local Widget={}
function Widget:Extend(name)
 local cls={kind=name}; cls.__index=cls
 return setmetatable(cls,{__index=self,__call=function(class,props)
  local object=setmetatable({props=props or {},state={},children={}},class); object:Init(props); return object end})
end
function Widget:Init(props) self.props=props or {};self.children={};self.state=self.state or {};self.layout={x=0,y=0,w=300,h=60};self.dispatches=0 end
function Widget:DispatchEvent() self.dispatches=self.dispatches+1 end
function Widget:SetStyle(props) for k,v in pairs(props) do self.props[k]=v end end
function Widget:SetState(state) for k,v in pairs(state) do self.state[k]=v end end
function Widget:SetVisible(value) self.props.visible=value end
function Widget:GetChildren() return self.children end
function Widget:GetLayout() return self.layout end
function Widget:GetAbsoluteLayout() return self.layout end
function Widget:GetAbsoluteLayoutForHitTest() return self.layout end
function Widget:AddChild(child) self.children[#self.children+1]=child;child.parent=self end
function Widget:RemoveChild(child) for i,v in ipairs(self.children) do if v==child then table.remove(self.children,i);child.parent=nil;return end end end
function Widget:Render() end
function Widget:MarkLayoutDirty() end
function Widget:OnPointerDown() end
function Widget:SetText(text) self.props.text=text end
function Widget.ExpandPaddingShorthand(props) return props end
local function make(props) local w=setmetatable({}, {__index=Widget});w:Init(props);return w end
local Theme={ComponentStyle=function() return {} end,Color=function() return {100,100,100,255} end,
 FontSize=function(value) return tonumber(value) or 14 end,FontFace=function() return "sans" end,
 BaseFontSize=function(value) return tonumber(value) or 14 end,
 Get=function() return {} end}
local UI={Panel=make,Label=make,Button=make,ScrollView=make,Theme=Theme}
function UI.MeasureTextWidth(text,size) return (utf8.len(text) or #text)*(size or 14)*0.5 end
function UI.MeasureTextFit(text,options) return {width=UI.MeasureTextWidth(text,options.fontSize),height=options.fontSize} end
function UI.GetFontVersion() return 1 end
function UI.SetActiveOverlay(widget) UI.activeOverlay=widget end
function UI.ClearActiveOverlay() UI.activeOverlay=nil end
package.loaded["urhox-libs/UI/Core/Widget"]=Widget
package.loaded["urhox-libs/UI/Core/Theme"]=Theme
package.loaded["urhox-libs/UI/Core/UI"]=UI
package.loaded["urhox-libs/UI"]=UI
package.loaded["Presentation.Components"]={}
package.loaded["urhox-libs/UI/Widgets/Panel"]=make
package.loaded["urhox-libs/UI/Widgets/Label"]=make
package.loaded["urhox-libs/UI/Widgets/ScrollView"]=make
package.loaded["urhox-libs/UI/Core/PointerEvent"]={Button={Left=0,Middle=1}}
package.loaded["urhox-libs/UI/Widgets/RichText"]=function(props)
 local widget=make(props)
 function widget:CalculateHeight() return 20 end
 function widget:MeasureWidth() return 50 end
 return widget
end
package.loaded["urhox-libs/UI/Components/ItemTooltip"]={}
local controls={"Checkbox","Tabs","Chip","Stepper","Pagination","Carousel","Calendar","Rating","DatePicker","TimePicker","ColorPicker","Dropdown","TextField","Breadcrumb","Menu","Table","ItemSlot","SkillTree","ChatWindow"}
for _,name in ipairs(controls) do UI[name]=require(native_path(name)) end
local Runtime=require("LUI.Runtime")
local Parser=require("LUI.Parser")
local Native=require("LUI.NativeControls")
local runtime=setmetatable({isV2_=true,config_={componentDirectories={}}},Runtime)
local calls=0
local function build(tag,view,attrs,actions)
 local markup='<控件 名称="NativeFixture"><'..tag..' '..(attrs or '')..'/></控件>'
 local node=assert(Parser.Parse(markup,"native-fixture.lui")).children[1]
 local context={view=view,actions=actions or {Change=function() calls=calls+1 end}}
 local widget=runtime:BuildNode(node,context)
 widget.state.focused=true;widget.state.scrollY=37
 return widget,context
end
local function change(widget,view,key,value)
 local before,dispatches=calls,widget.dispatches
 view[key]=value;widget:luiRefreshLayout_()
 assert(calls==before and widget.dispatches==dispatches,"model refresh must not emit a business callback/event")
 assert(widget.state.focused and widget.state.scrollY==37,"native identity/focus/scroll survive source refresh")
end
local view={value=true,text="选择我"}
local checkbox=build("复选框",view,'值="{绑定 view.value, 模式=双向}" 文本="{绑定 view.text}" 变更="{动作 Change}"')
assert(checkbox:IsChecked() and checkbox.props.label=="选择我")
change(checkbox,view,"value",false);assert(not checkbox:IsChecked())
change(checkbox,view,"text","新标签");assert(checkbox.props.label=="新标签")
checkbox:Toggle();assert(view.value==true and calls==1)
local literal=build("复选框",{},'值="是"');assert(literal:IsChecked())
view={value="b",items={{id="a",label="A"},{id="b",label="B"}}}
local tabs=build("选项卡",view,'值="{绑定 view.value, 模式=双向}" 项目="{绑定 view.items}" 变更="{动作 Change}"')
assert(tabs:GetActiveTab()=="b" and tabs:GetTabCount()==2)
change(tabs,view,"value","a");assert(tabs:GetActiveTab()=="a")
tabs:SetActiveTab("b");assert(view.value=="b")
local retained={};tabs.tabContents_.b=retained
change(tabs,view,"items",{{id="b",label="保留"}});assert(tabs:GetActiveTab()=="b" and tabs.tabContents_.b==retained)
view={value=false,text="可选"}
local chip=build("标签片",view,'值="{绑定 view.value, 模式=双向}" 文本="{绑定 view.text}" 变更="{动作 Change}"')
assert(not chip:IsSelected() and chip:GetLabel()=="可选" and chip.props.selectable)
change(chip,view,"value",true);assert(chip:IsSelected())
chip:OnClick({x=0,y=0});assert(view.value==false)
view={value=1,items={{label="一"},{label="二"},{label="三"}}}
local stepper=build("步骤条",view,'值="{绑定 view.value, 模式=双向}" 项目="{绑定 view.items}" 变更="{动作 Change}"')
assert(stepper:GetActiveStep()==1 and #stepper.steps_==3)
change(stepper,view,"value",2);assert(stepper:GetActiveStep()==2)
stepper:SetActiveStep(0);assert(view.value==0)
view={value=3,max=8}
local pagination=build("分页",view,'值="{绑定 view.value, 模式=双向}" 最大值="{绑定 view.max}" 变更="{动作 Change}"')
assert(pagination:GetCurrentPage()==3 and pagination:GetTotalPages()==8)
change(pagination,view,"value",6);assert(pagination:GetCurrentPage()==6)
change(pagination,view,"max",4);assert(pagination:GetCurrentPage()==4 and pagination:GetTotalPages()==4)
pagination:GoToPrev();assert(view.value==3)
view={value=2,items={{text="一"},{text="二"},{text="三"}}}
local carousel=build("轮播",view,'值="{绑定 view.value, 模式=双向}" 项目="{绑定 view.items}" 变更="{动作 Change}"')
assert(carousel:GetCurrentIndex()==2 and carousel:GetItemCount()==3)
change(carousel,view,"value",3);assert(carousel:GetCurrentIndex()==3 and not carousel.animating_)
carousel:GoTo(1,false);assert(view.value==1)
view={value={year=2026,month=9,day=6}}
local selected
local calendar=build("日历",view,'值="{绑定 view.value, 模式=双向}" 变更="{动作 Change}" 选择="{动作 Select}"',
 {Change=function() calls=calls+1 end,Select=function(date) selected=date end})
assert(calendar:GetSelectedDate()==view.value)
change(calendar,view,"value",{year=2026,month=9,day=7});assert(calendar:GetSelectedDate().day==7)
calendar:SelectDate(2026,9,8);assert(view.value.day==8 and selected.day==8)
view={value=2,max=5}
local rating=build("评分",view,'值="{绑定 view.value, 模式=双向}" 最大值="{绑定 view.max}" 变更="{动作 Change}"')
assert(rating:GetValue()==2);change(rating,view,"value",4);assert(rating:GetValue()==4)
rating:SetValue(3);assert(view.value==3)
local numericRating=build("评分",{},'值="2" 最大值="5"')
assert(numericRating:GetValue()==2 and numericRating:GetMax()==5)
view={value="2"}
numericRating=build("评分",view,'值="{绑定 view.value}"')
change(numericRating,view,"value","4");assert(numericRating:GetValue()==4)
for _,tag in ipairs({"日期选择器","时间选择器","颜色选择器"}) do
 local initial=tag=="日期选择器" and {year=2026,month=9,day=6} or tag=="时间选择器" and {hour=10,minute=15} or {r=255,g=0,b=0}
 local updated=tag=="日期选择器" and {year=2026,month=10,day=9} or tag=="时间选择器" and {hour=13,minute=20} or {r=0,g=255,b=0}
 view={value=initial,disabled=false}
 local picker=build(tag,view,'值="{绑定 view.value, 模式=双向}" 禁用="{绑定 view.disabled}" 变更="{动作 Change}"')
 change(picker,view,"value",updated)
 local actual=picker:GetValue()
 if tag=="日期选择器" then assert(actual.month==10 and picker.viewMonth_==10)
 elseif tag=="时间选择器" then assert(actual.hour==13 and actual.minute==20)
 else assert(actual.r==0 and actual.g==255 and actual.b==0) end
 change(picker,view,"disabled",true);assert(picker.disabled_)
 change(picker,view,"value",nil)
 if tag~="颜色选择器" then assert(picker:GetValue()==nil) end
end
view={value="b"}
local dropdown=build("下拉框",view,'值="{绑定 view.value, 模式=双向}" 变更="{动作 Change}"')
assert(dropdown:GetValue()=="b");change(dropdown,view,"value","a");assert(dropdown:GetValue()=="a")
dropdown:SetValue("b");assert(view.value=="b")
view={text="完整名字"}
local textField=build("文本框",view,'文本="{绑定 view.text, 模式=双向}" 变更="{动作 Change}"')
assert(textField:GetValue()=="完整名字")
textField.state.cursorPos=4;textField.state.selectionStart=1;textField.state.selectionEnd=4
change(textField,view,"text","短名");assert(textField:GetValue()=="短名" and textField.state.cursorPos==2 and textField.state.selectionEnd==2)
textField:SetValue("再次编辑");assert(view.text=="再次编辑")
-- Native SetOpen owns overlay state. The adapter observes only transitions,
-- including native Open/Close/Toggle/SelectOption paths, never plain Value edits.
local opened,closed=0,0
view={value="a"}
local drop=build("下拉框",view,'值="{绑定 view.value}" 打开="{动作 Open}" 关闭="{动作 Close}"',
 {Open=function() opened=opened+1 end,Close=function() closed=closed+1 end})
drop:Open();drop:Open();assert(drop:IsOpen() and UI.activeOverlay==drop and opened==1 and closed==0)
drop.scrollOffset_=2;change(drop,view,"value","b")
assert(drop:IsOpen() and opened==1 and closed==0 and drop.scrollOffset_==2)
drop:Close();drop:Close();assert(not drop:IsOpen() and UI.activeOverlay==nil and closed==1)
drop:Toggle();assert(opened==2);drop:SelectOption({value="c"});assert(closed==2 and not drop:IsOpen())
Native.Attach(drop,"Dropdown");drop:Open();assert(opened==3,"lifecycle attach is idempotent")
drop:SetDisabled(true);assert(closed==3 and not drop:IsOpen())
assert(UI.activeOverlay==nil,"disabling an open native dropdown clears its overlay")
drop:Open();assert(opened==3,"disabled native open must not notify")
local closeOnly=0
local observer=build("下拉框",{},'关闭="{动作 Close}"',{Close=function() closeOnly=closeOnly+1 end})
observer:Open();assert(closeOnly==0,"an absent Open callback must not fall through to Close")
observer:Close();assert(closeOnly==1)
-- Generic Value remains an opaque ID for native selection controls. Only
-- controls with a verified numeric contract (e.g. Rating) convert numbers.
for _,tag in ipairs({"下拉框","选项卡"}) do
 local idItems={{id="0010",label="甲"},{id="0012",label="乙"}}
 local idOptions={{value="0010",label="甲"},{value="0012",label="乙"}}
 local values={value="0010",items=idItems,options=idOptions}
 local attrs='项目="{绑定 view.items}" 选项="{绑定 view.options}"'
 local static=build(tag,values,'值="0010" '..attrs)
 local function valueOf(widget) if tag=="选项卡" then return widget:GetActiveTab() end;return widget:GetValue() end
 assert(valueOf(static)=="0010","literal numeric string ID must survive construction")
 local dynamic=build(tag,values,'值="{绑定 view.value, 模式=双向}" '..attrs)
 assert(valueOf(dynamic)=="0010")
 change(dynamic,values,"value","0012");assert(valueOf(dynamic)=="0012","bound numeric string ID must survive refresh")
 if tag=="选项卡" then dynamic:SetActiveTab("0010") else dynamic:SetValue("0010") end
 assert(values.value=="0010","native event must retain numeric string IDs")
end
-- Correct event names are consumed by the untouched native handlers, not
-- manually asserted against the construction props. Geometry alone is fixed.
local row={id="sample",text="条目",label="条目",unlocked=true,x=0,y=0,keepOpen=true}
local received,index
local eventActions={Select=function(value,number) received,index=value,number end,Click=function(value) received=value end}
local crumb=build("面包屑",{items={row}},'项目="{绑定 view.items}" 选择="{动作 Select}"',eventActions)
crumb.GetItemAtPosition=function() return {item=row,index=1,isLast=false} end
crumb:OnClick({x=1,y=1});assert(received==row and index==1)
received=nil
local menu=build("菜单",{items={row}},'项目="{绑定 view.items}" 选择="{动作 Select}"',eventActions)
menu.isOpen_=true;menu.GetItemAtPosition=function() return {item=row,index=1} end
menu:OnClick({x=1,y=1});assert(received==row and index==1)
received=nil
local grid=build("表格",{data={row}},'数据="{绑定 view.data}" 选择="{动作 Select}"',eventActions)
grid:SelectRow(1);assert(type(received)=="table" and received[1]==1)
received=nil
local slot=build("物品槽",{},'点击="{动作 Click}"',eventActions)
slot:SetItem(row);slot:OnClick({});assert(received==row)
received=nil
local tree=build("技能树",{},'选择="{动作 Select}"',eventActions)
tree:SetNodes({row});tree:OnPointerDown({x=32,y=32,button=0});assert(received==row,"SkillTree callback has no widget first parameter")
received=nil
local chat=build("聊天窗口",{},'选择="{动作 Select}"',eventActions)
chat.ShowItemTooltip=function() end
chat:AddMessage({sender="测试",content="物品"})
chat.messages_[1].richText.props.onItemClick(row,{x=0,y=0,w=5,h=5});assert(received==row,"ChatWindow callback preserves the first item parameter")
-- VirtualList's declarative item factory remains unsupported. Exercise its
-- real pool-item event method with injected widget construction infrastructure.
local VirtualList=require(native_path("VirtualList"))
local poolProps
UI.VirtualList=function(props) poolProps=props;return make(props) end
build("虚拟列表",{data={row}},'数据="{绑定 view.data}" 选择="{动作 Select}"',eventActions)
poolProps.createItem=function() return make({}) end
local nativeList=setmetatable({props=poolProps},{__index=VirtualList})
local poolItem=nativeList:CreatePoolItem();poolItem._virtualListIndex=1
received=nil;poolItem:OnClick({});assert(received==row and index==1,"VirtualList callback preserves raw row/index")
-- Failed native setter restores callbacks/DispatchEvent, then normal input works.
local nativeSet=rating.SetValue;local dispatch,callback=rating.DispatchEvent,rating.onChange_
rating.SetValue=function() error("isolated setter failure") end
assert(not pcall(Native.Apply,rating,"Rating",{Value={value=1}},{value=1}))
assert(rating.DispatchEvent==dispatch and rating.onChange_==callback)
rating.SetValue=nativeSet
-- Single-pass binding remains a creation-only value, including native state.
view={value=true};local once=build("复选框",view,'值="{绑定 view.value, 模式=单次}"')
change(once,view,"value",false);assert(once:IsChecked())
-- Other changing fields must never re-resolve a one-time binding as a side
-- effect. Only native range clamping may change a now-out-of-range baseline.
view={value=3,max=8}
local oncePage=build("分页",view,'值="{绑定 view.value, 模式=单次}" 最大值="{绑定 view.max}"')
view.value=1;change(oncePage,view,"max",7);assert(oncePage:GetCurrentPage()==3)
change(oncePage,view,"max",2);assert(oncePage:GetCurrentPage()==2)
view={value=3,max=8}
local onceMax=build("分页",view,'值="{绑定 view.value}" 最大值="{绑定 view.max, 模式=单次}"')
view.max=2;change(onceMax,view,"value",6);assert(onceMax:GetCurrentPage()==6 and onceMax:GetTotalPages()==8)
for _,tag in ipairs({"选项卡","步骤条","轮播"}) do
 local original=tag=="选项卡" and "b" or 2
 local replacement=tag=="选项卡" and "a" or 1
 view={value=original,items={{id="a",label="一"},{id="b",label="二"},{id="c",label="三"},{id="d",label="四"}}}
 local widget=build(tag,view,'值="{绑定 view.value, 模式=单次}" 项目="{绑定 view.items}"')
 view.value=replacement
 change(widget,view,"items",{{id="a",label="改一"},{id="b",label="改二"},{id="c",label="改三"}})
 local current=tag=="选项卡" and widget:GetActiveTab() or tag=="步骤条" and widget:GetActiveStep() or widget:GetCurrentIndex()
 assert(current==original,"Items refresh must not leak latest source through a one-time Value binding")
end
print("Native controls: official constructors/getters/setters, two-way callbacks, silent dynamic values, nil/defaults, bound lists, focus/state and error recovery PASS.")
''')

print(f"Official native evidence: UrhoX {header['version']} / {header['client']}; data SHA256 {hashlib.sha256(blob).hexdigest()}")
