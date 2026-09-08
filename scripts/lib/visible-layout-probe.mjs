// Test-only inspection: walk real children, including deferred/native portals.
// Runtime.GetScreenRect supplies the same visibility and clipping rules as input.
export const visibleLayoutProbe = String.raw`
local function verifyVisibleLayout(runtime,root,width,height)
 local seen,issues={},{}
 local result={visibleNodes=0,visibleLists=0,visibleRows=0,issues=issues}
 local function inViewport(rect)
  return rect and rect.x<width and rect.y<height and rect.x+rect.w>0 and rect.y+rect.h>0
 end
 local function identity(widget)
  return tostring(widget.luiSourcePath_ or '<native>')..'#'..tostring(widget.luiNodePath_ or widget.luiName_ or widget)
 end
 local visit
 visit=function(widget)
  if not widget or seen[widget] then return end;seen[widget]=true
  local props=widget.props or {}
  if props.visible==false or props.visibility=='hidden' or (widget.IsVisible and not widget:IsVisible()) then return end
  local rect=runtime:GetScreenRect(widget)
  if inViewport(rect) then
   result.visibleNodes=result.visibleNodes+1
   if widget.luiRenderDeferredFrame_~=nil then issues[#issues+1]=identity(widget)..' has deferred visible geometry' end
   local list=widget.luiVirtualList_
   if list then
    result.visibleLists=result.visibleLists+1
    local visibleRows=0
    for _,row in ipairs(list.renderChildren_ or {})do
     if inViewport(runtime:GetScreenRect(row))then visibleRows=visibleRows+1 end
    end
    result.visibleRows=result.visibleRows+visibleRows
    if #(list.model_.items_ or {})>0 and visibleRows==0 then issues[#issues+1]=identity(widget)..' has data but no visible virtual row' end
   end
  end
  local function children(values)for _,child in ipairs(values or {})do visit(child)end end
  if widget.GetChildren then children(widget:GetChildren())end
  if widget.GetHitTestChildren then children(widget:GetHitTestChildren())end
  children(widget.bodyChildren_);children(widget.luiGlobalOverlays_)
  if widget.luiVirtualList_ then children(widget.luiVirtualList_.renderChildren_)end
  visit(widget.contentContainer_);visit(widget.footerWidget_);visit(widget.luiNativeWidget_)
  if type(widget.content_)=='table' and widget.content_.GetChildren then visit(widget.content_)end
 end
 visit(root)
 assert(result.visibleNodes>0,'no visible layout nodes')
 assert(#issues==0,table.concat(issues,'; '))
 return result
end
`;

export function recordEngineErrors(page, report) {
 page.on('console', message => {
  const text=message.text();
  if (/stack traceback|attempt to (?:index|call|perform|compare|concatenate)|error executing|\[LUI\.[^\]]+\].*(?:failed|error)/i.test(text)) {
   report.errors.push('Lua: '+text);
  }
 });
}
