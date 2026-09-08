// Shared independent Lua-to-C observer, injected before LUI.Runtime/NativeText.
export const nativeBudgetObserver=`
NativeProbe={frames={},enabled=false,depth=0,maximumDepth=0,referenceWidth=UI.MeasureTextWidth,referenceFit=UI.MeasureTextFit,referenceBaseline=UI.MeasureTextBaseline}
local function record()
 if not NativeProbe.enabled then return end
 local budget=NativeProbe.budget;local key=tostring(budget.frame)
 local row=NativeProbe.frames[key];if not row then row={token=budget.frame,calls=0,outside=0,lateStarts=0,rejectedStartChecks=0,maximumObserverLagMilliseconds=0,kind={},depth=0};NativeProbe.frames[key]=row end
 return row
end
for _,name in ipairs({'nvgTextBounds','nvgTextBoxBounds','nvgTextMetrics'})do
 local original=assert(_G[name]);_G[name]=function(...)
  local row=record();if row then
   row.calls=row.calls+1;row.kind[name]=(row.kind[name]or 0)+1
   if not NativeProbe.Budget.Active()then row.outside=row.outside+1 end
   if NativeProbe.budget.deadline and NativeProbe.budget.clock()>=NativeProbe.budget.deadline then row.lateStarts=row.lateStarts+1 end
   if NativeProbe.budget.lastNativeStart then
    row.maximumObserverLagMilliseconds=math.max(row.maximumObserverLagMilliseconds,(NativeProbe.budget.clock()-NativeProbe.budget.lastNativeStart)*1000)
    if NativeProbe.budget.lastNativeStart>=NativeProbe.budget.deadline then row.rejectedStartChecks=row.rejectedStartChecks+1 end
   end
  end
  return original(...)
 end
end
local save,restore,beginFrame,endFrame=nvgSave,nvgRestore,nvgBeginFrame,nvgEndFrame
nvgSave=function(...)NativeProbe.depth=NativeProbe.depth+1;NativeProbe.maximumDepth=math.max(NativeProbe.maximumDepth,NativeProbe.depth);return save(...)end
nvgRestore=function(...)NativeProbe.depth=NativeProbe.depth-1;assert(NativeProbe.depth>=0,'unbalanced raw nvgRestore');return restore(...)end
nvgBeginFrame=function(...)NativeProbe.depth=0;return beginFrame(...)end
function NativeProbe.FinalizeFrame()
 local row=record();if row then row.depth=NativeProbe.depth;row.budgetCalls=NativeProbe.budget.calls;row.overrun=NativeProbe.budget.overrunMilliseconds end
 return row
end
nvgEndFrame=function(...)NativeProbe.FinalizeFrame();return endFrame(...)end
`;
