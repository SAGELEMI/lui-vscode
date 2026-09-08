"""Native ChatWindow/RichText and global ItemTooltip deferred lifecycle.

Uses the same verified official 1.29.7 archive as runtime-native-controls.py;
only Widget/Yoga, theme and NanoVG boundaries are deterministic doubles.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "artifacts/python"))
from lupa.lua54 import LuaRuntime

records = {}
for metadata in (root / "artifacts/engine-cache").glob("*.json"):
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
lua.globals().adapter_read = lambda name: (root / "packages/runtime-urhox-lua/adapter" / f"{name}.lua").read_text(encoding="utf-8-sig")
lua.execute(r'''
table.insert(package.searchers,1,function(name)
 if name:sub(1,4)=='LUI.' then return assert(load(adapter_read(name:sub(5)),'@'..name)) end
 local ok,source=pcall(native_read,name)
 if ok then return assert(load(source,'@official-1.29.7/'..name)) end
end)
local context,depth,starts,draws,fontVersion={},0,0,0,1
NVG_ALIGN_LEFT,NVG_ALIGN_TOP,NVG_ALIGN_MIDDLE,NVG_ALIGN_CENTER=1,2,4,8
function nvgSave()depth=depth+1 end
function nvgRestore()assert(depth>0);depth=depth-1 end
for _,name in ipairs({'nvgResetTransform','nvgFontFace','nvgFontSize','nvgTextLetterSpacing',
 'nvgTextLineHeight','nvgTextAlign','nvgFontBlur','nvgIntersectScissor','nvgBeginPath',
 'nvgRoundedRect','nvgFillColor','nvgFill','nvgStrokeColor','nvgStrokeWidth','nvgStroke'}) do
 _G[name]=function()end
end
function nvgRGBA(...)return{...}end
function nvgText()draws=draws+1 end
function nvgTextBox()draws=draws+1 end
function nvgTextBounds(_,x,y,text)starts=starts+1;return #text*8,{x,y,x+#text*8,y+14}end
function nvgTextBoxBounds(_,x,y,width,text)starts=starts+1;return{x,y,x+math.min(width,#text*8),y+math.ceil(#text*8/width)*20}end
function nvgTextMetrics()starts=starts+1;return 12,-4,16 end
local Widget={}
function Widget:Extend(name)
 local cls={kind=name};cls.__index=cls
 return setmetatable(cls,{__index=self,__call=function(class,props)
  local object=setmetatable({},class);object:Init(props);return object end})
end
function Widget:Init(props)self.props=props;self.children={};self.layout={x=0,y=0,w=400,h=240}end
function Widget:GetChildren()return self.children end
function Widget:GetLayout()return self.layout end
function Widget:GetAbsoluteLayout()return self.layout end
function Widget:SetStyle(props)for key,value in pairs(props)do self.props[key]=value end end
function Widget:SetHeight(height)self.props.height=height;self.layout.h=height end
function Widget:RenderFullBackground()end
function Widget:Destroy()self.destroyed=true;self.destroyCount=(self.destroyCount or 0)+1 end
function Widget:OnPointerMove()end
function Widget:OnPointerLeave()end
function Widget:OnPointerDown()end
function Widget.ExpandPaddingShorthand(props)return props end
local UI={Theme={GetScale=function()return 1 end},GetFontVersion=function()return fontVersion end,
 GetNVGContext=function()return context end,GetWidth=function()return 400 end,GetHeight=function()return 600 end}
function UI.MeasureTextWidth(text)return nvgTextBounds(context,0,0,text)end
function UI.MeasureTextFit()return{width=0,height=0}end
function UI.MeasureTextBaseline()return 12 end
local global
function UI.RegisterGlobalComponent(name,component)assert(name=='ItemTooltip');global=component end
package.loaded['urhox-libs/UI/Core/Widget']=Widget
package.loaded['urhox-libs/UI/Core/Theme']=UI.Theme
package.loaded['urhox-libs/UI/Core/UI']=UI
package.loaded['urhox-libs/UI']=UI
local Chat=require('urhox-libs/UI/Components/ChatWindow')
local Tooltip=require('urhox-libs/UI/Components/ItemTooltip')
local Native=require('LUI.NativeText')
local Budget=require('LUI.MeasureBudget')
local Deferred=require('LUI.NativeDeferred')
local RenderBudget=require('LUI.RenderBudget')
local runtime={luiMeasureBudget_={clock=function()return 0 end,seconds=.002,limit=3,
 calls=0,rows=0,frame=0,overrunMilliseconds=0}}
local budget=Budget.Get(runtime)
local messages={}
for i=1,100 do messages[i]={sender='sender-'..i,content=string.rep('text',10)..i}end
local chat=Native.Construct(function()return Chat{messages=messages}end)
assert(starts==0 and chat:GetMessageCount()==100,'cold constructor completes collection without native text starts')
local coldHeight=chat.contentHeight_
Deferred.Attach(chat,'ChatWindow',runtime);RenderBudget.AttachTree(chat,runtime)
local originalRender=chat.Render;Deferred.Attach(chat,'ChatWindow',runtime)
assert(chat.Render==originalRender,'bridge attaches once')
local originalMessages=chat.messages_
budget.limit=0;Budget.BeginFrame(runtime,1);chat:Render(context)
assert(chat.messages_==originalMessages and chat.luiRenderDeferredFrame_~=nil and draws==0,
 'budget pause restores public message collection and draws no partial chat geometry')
budget.limit=3
for frame=2,250 do
 Budget.BeginFrame(runtime,frame);local before=starts;chat:Render(context)
 assert(starts-before==budget.calls and budget.calls<=3 and depth==0,'exact C calls share the render quota')
 assert(chat.messages_==originalMessages and #chat.messages_==100)
 if not chat.luiChatNeedsLayout_ and not chat.luiRenderDeferredFrame_ then break end
end
assert(not chat.luiChatNeedsLayout_ and chat.contentHeight_>coldHeight and draws>0,
 'constructor-zero geometry is remeasured and a hundred messages converge across short slices')
assert(chat.messages_[1].bubbleWidth>80 and chat.messages_[100].richText.luiBudgetGuard_,
 'native rich-text widths are restored and non-AddChild descendants have their own guard')
assert(chat.scrollOffset_==chat.contentHeight_-chat:GetLayout().h,'auto-scroll follows committed geometry')
local removed=chat.messages_[1].richText
budget.limit=0;Budget.BeginFrame(runtime,300);local before=starts
chat:AddMessage{sender='new',content='added after quota'}
assert(starts==before and chat:GetMessageCount()==100 and removed.destroyCount==1 and removed.luiNativeMeasureBudget_==nil,
 'AddMessage finishes trimming/data mutation after the frame budget, without measurements')
budget.limit=64;Budget.BeginFrame(runtime,301);chat:Render(context)
assert(chat.messages_[100].richText and chat.messages_[100].richText.luiBudgetGuard_)
local clearedFirst,clearedLast=chat.messages_[1].richText,chat.messages_[100].richText
chat:ClearMessages()
assert(chat:GetMessageCount()==0 and chat.contentHeight_==0 and chat.scrollOffset_==0)
assert(clearedFirst.destroyCount==1 and clearedLast.destroyCount==1
 and clearedFirst.luiNativeMeasureBudget_==nil and clearedLast.luiNativeMeasureBudget_==nil,
 'native ClearMessages destroys detached RichText and releases each render-budget hook')
chat:AddMessage{sender='new',content='replacement collection'}
Budget.BeginFrame(runtime,302);chat:Render(context)
assert(chat:GetMessageCount()==1 and chat.messages_[1].richText.luiBudgetGuard_)
-- LUI ownership only spans the native ShowItemTooltip call. The singleton
-- keeps weak ownership, while its public global render uses the shared budget.
local item={name='Sword',description='one two three',stats={power=10}}
chat:ShowItemTooltip(item,chat.messages_[1],{x=8,y=8,w=30,h=20})
assert(global==Tooltip and Tooltip.GetItem()==item);Tooltip:Update(1)
budget.limit=0;Budget.BeginFrame(runtime,303);before=starts;local drawn=draws
global:Render(context)
assert(starts==before and draws==drawn and depth==0,'LUI global tooltip cannot bypass an exhausted quota')
budget.limit=2
for frame=304,320 do
 Budget.BeginFrame(runtime,frame);before=starts;global:Render(context)
 assert(starts-before==budget.calls and budget.calls<=2 and depth==0)
 if draws>drawn then break end
end
assert(draws>drawn,'global tooltip phase cache makes progress across frames')
-- Non-LUI Show replaces the current ownership and preserves native behavior.
local external={name='External'};Tooltip.Show(external,nil);Tooltip:Update(1)
budget.limit=0;Budget.BeginFrame(runtime,321);before=starts;global:Render(context)
assert(starts>before and budget.calls==0,'non-LUI global tooltip is a native passthrough')
local finalRichText=chat.messages_[1].richText
chat:Destroy();chat:Destroy()
assert(finalRichText.destroyCount==1 and finalRichText.luiNativeMeasureBudget_==nil,
 'native ChatWindow Destroy disposes detached RichText exactly once across repeated destruction')
assert(Tooltip.GetItem()==external and Tooltip.IsVisible(),'destroying another owner cannot hide a native tooltip')
local survivor=Native.Construct(function()return Chat{}end)
Deferred.Attach(survivor,'ChatWindow',runtime);RenderBudget.AttachTree(survivor,runtime)
survivor:Render(context)
assert(survivor:GetMessageCount()==0 and survivor.contentHeight_==0,'empty constructor retains native zero content height')
survivor:ShowItemTooltip(item,nil,{x=1,y=1,w=1,h=1});Tooltip:Update(1)
survivor:Destroy()
assert(Tooltip.GetItem()==nil and not Tooltip.IsVisible(),'destroy current LUI owner releases native item state immediately')
local weak=setmetatable({},{__mode='v'})
weak[1],weak[2],weak[3]=chat,survivor,runtime
chat,survivor,runtime,originalRender,originalMessages,removed,item,messages=nil,nil,nil,nil,nil,nil,nil,nil
clearedFirst,clearedLast,finalRichText=nil,nil,nil
collectgarbage('collect');collectgarbage('collect')
assert(weak[1]==nil and weak[2]==nil and weak[3]==nil,'global bridge never retains chat, message contexts or Runtime')
print('Native deferred PASS: cold ChatWindow geometry, resumable message mutation, dynamic RichText guards, scoped global ItemTooltip and owner release.')
''')
