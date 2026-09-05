-- Bridges verified UrhoX 1.29.7 native widget contracts. Generic LUI Value is
-- not uniformly props.value, and source updates must not emit input events.
local NativeControls = {}

local EVENTS = {
    Chip = { Change = "onSelect" },
    Breadcrumb = { Select = "onItemClick" },
    Menu = { Select = "onItemClick" },
    Table = { Select = "onRowSelect" },
    Calendar = { Change = "onDateSelect", Select = "onDateSelect" },
    VirtualList = { Select = "onItemClick" },
    ItemSlot = { Click = "onSlotClick" },
    SkillTree = { Select = "onNodeClick" },
    ChatWindow = { Select = "onItemClick" },
}
local FIRST_IS_DATA = { VirtualList = true, SkillTree = true, ChatWindow = true }

function NativeControls.EventCallback(tag, event)
    local name = EVENTS[tag] and EVENTS[tag][event]
    return name, not (name and FIRST_IS_DATA[tag])
end

local function boolean(value) return value == true or value == "true" or value == "是" end
local function integer(value, fallback) return math.floor(tonumber(value) or fallback) end
local function label(value) return value == nil and "" or tostring(value) end

function NativeControls.Prepare(tag, props)
    if tag == "Checkbox" then props.checked, props.label = boolean(props.value), label(props.text)
    elseif tag == "Tabs" then props.activeTab, props.tabs = props.value, props.items or {}
    elseif tag == "Chip" then
        props.selected, props.label = boolean(props.value), label(props.text)
        if props.value ~= nil or props.onSelect then props.selectable = true end
    elseif tag == "Stepper" then
        props.activeStep, props.steps = integer(props.value, 0), props.items or {}
        if props.onChange then props.clickable = true end
    elseif tag == "Pagination" then
        props.totalPages = math.max(1, integer(props.max, 1))
        props.currentPage = math.max(1, math.min(props.totalPages, integer(props.value, 1)))
    elseif tag == "Carousel" then props.initialIndex = math.max(1, integer(props.value, 1))
    elseif tag == "Rating" then props.value, props.max = tonumber(props.value) or 0, tonumber(props.max) or 5
    elseif tag == "Calendar" then props.selectedDate = props.value
    elseif tag == "Table" and props.onRowSelect then props.selectable = true end
    return props
end

-- Official Dropdown has no props.onOpen/onClose consumer. Observe completed
-- transitions while preserving native overlay handling and method results.
function NativeControls.Attach(widget, tag)
    if tag ~= "Dropdown" or widget.luiNativeLifecycle_ or type(widget.SetOpen) ~= "function" then return widget end
    local setOpen = widget.SetOpen
    widget.luiNativeLifecycle_ = true
    local function notify(self, wasOpen)
        local isOpen = self:IsOpen()
        if wasOpen == isOpen then return end
        local callback
        if isOpen then callback = self.props.onOpen else callback = self.props.onClose end
        if callback then callback(self) end
    end
    function widget:SetOpen(open)
        local wasOpen = self:IsOpen()
        local result = table.pack(setOpen(self, open))
        notify(self, wasOpen)
        return table.unpack(result, 1, result.n)
    end
    -- SetDisabled closes via SetState directly in 1.29.7. Complete its native
    -- overlay cleanup through SetOpen before reporting the observed close.
    local setDisabled = widget.SetDisabled
    if type(setDisabled) == "function" then
        function widget:SetDisabled(disabled)
            local wasOpen = self:IsOpen()
            local result = table.pack(setDisabled(self, disabled))
            if wasOpen and not self:IsOpen() then
                setOpen(self, false)
                notify(self, wasOpen)
            end
            return table.unpack(result, 1, result.n)
        end
    end
    return widget
end

-- Native setters own clamping, date/color conversion and state transitions.
-- Suppress only their outward change notification while applying model data;
-- restore every callback even when a setter raises. No replacement widget.
local function silent(widget, method, ...)
    if type(widget[method]) ~= "function" then return false end
    local dispatch, propChange, change = widget.DispatchEvent, widget.props.onChange, widget.onChange_
    widget.DispatchEvent, widget.props.onChange, widget.onChange_ = function() end, nil, nil
    local result = table.pack(pcall(widget[method], widget, ...))
    widget.DispatchEvent, widget.props.onChange, widget.onChange_ = dispatch, propChange, change
    if not result[1] then error(result[2], 0) end
    return true
end

function NativeControls.Apply(widget, tag, changes, resolved)
    local props = widget.props
    if changes.Text and (tag == "Checkbox" or tag == "Chip") then props.label = label(resolved.text) end
    if changes.Items then
        local items = resolved.items or {}
        if tag == "Tabs" then
            props.tabs, widget.autoFitTabCaches_ = items, {}
            local found = false
            for _, item in ipairs(items) do if item.id == props.activeTab then found = true; break end end
            if not found then props.activeTab = items[1] and items[1].id or nil end
        elseif tag == "Stepper" then props.steps = items; silent(widget, "SetSteps", items)
        elseif tag == "Carousel" then
            props.items, widget.items_ = items, items
            widget.currentIndex_ = math.max(1, math.min(#items, widget.currentIndex_ or 1))
        end
    end
    if changes.Max then
        if tag == "Pagination" then
            props.totalPages = math.max(1, integer(resolved.max, 1))
            silent(widget, "SetTotalPages", props.totalPages)
        elseif tag == "Rating" then
            props.max = tonumber(resolved.max) or 5
            silent(widget, "SetMax", props.max)
        end
    end
    if changes.Disabled and (tag == "Rating" or tag == "Pagination" or tag == "DatePicker" or tag == "TimePicker" or tag == "ColorPicker") then
        widget.disabled_ = boolean(resolved.disabled)
    end
    if not changes.Value then return end
    local value = resolved.value
    props.value = value
    if tag == "Checkbox" then props.checked = boolean(value)
    elseif tag == "Tabs" then
        if value == nil then value = props.tabs and props.tabs[1] and props.tabs[1].id or nil end
        if value == nil then props.activeTab = nil else silent(widget, "SetActiveTab", value) end
    elseif tag == "Chip" then props.selected = boolean(value)
    elseif tag == "Stepper" then
        props.activeStep = integer(value, 0)
        silent(widget, "SetActiveStep", props.activeStep)
    elseif tag == "Pagination" then
        props.currentPage = integer(value, 1)
        silent(widget, "SetCurrentPage", props.currentPage)
    elseif tag == "Carousel" then
        widget.animating_ = false
        silent(widget, "GoTo", math.max(1, integer(value, 1)), false)
    elseif tag == "Rating" then silent(widget, "SetValue", tonumber(value) or 0)
    elseif tag == "Calendar" then props.selectedDate = value; silent(widget, "SetSelectedDate", value)
    elseif tag == "DatePicker" or tag == "TimePicker" then silent(widget, "SetValue", value)
    elseif tag == "ColorPicker" then silent(widget, "SetValue", value or { r = 255, g = 0, b = 0, a = 255 }) end
end

return NativeControls
