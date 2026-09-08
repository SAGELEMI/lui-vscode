-- Local-coordinate dragging and time-based momentum around the native
-- ScrollView. A cancel subscription exists only while its pointer is captured;
-- the engine's UI library and event dispatchers remain unchanged.
local UI = require("urhox-libs/UI")
local ScrollInput = {}
local DECAY = -math.log(0.95) * 60
local STOP_SPEED, MAX_SPEED = 6, 6000

local function finite(value, fallback)
    return type(value) == "number" and value == value and math.abs(value) < math.huge and value or fallback
end

local function timestamp(event)
    return finite(event and event.timestamp, 0) / 1000
end

local function accepts(view, event)
    return view.luiScrollPointerId_ == nil or view.luiScrollPointerId_ == event.pointerId
end

local function visible(view)
    local current = view
    while current do
        local props = current.props or {}
        if props.visible == false or props.visibility == "hidden" then return false end
        current = current.parent
    end
    return true
end

local function releaseCancel(view)
    if view.luiCancelListener_ and UI.Input then
        UI.Input.Off(UI.Input.PointerCancel, view.luiCancelListener_)
        view.luiCancelListener_ = nil
    end
end

local function finish(view, cancel, dispatching)
    view.state.isDragging = false
    view.isDraggingScrollbarV_, view.isDraggingScrollbarH_ = false, false
    view.luiScrollPointerId_, view.luiScrollPointerType_ = nil, nil
    view.luiPanX_, view.luiPanY_, view.luiPanTime_ = nil, nil, nil
    view.luiPanSampleX_, view.luiPanSampleY_ = 0, 0
    if cancel then view.state.velocityX, view.state.velocityY = 0, 0 end
    -- Input iterates its live listener array. Removing this callback from
    -- inside dispatch would skip the following native gesture listener.
    if not dispatching then releaseCancel(view) end
end

local function watchCancel(view)
    releaseCancel(view)
    local events = UI.Input
    if not events or not events.On or not events.Off or not events.PointerCancel then return end
    view.luiCancelListener_ = events.On(events.PointerCancel, function(event)
        if view.luiScrollPointerId_ == event.pointerId then finish(view, true, true) end
    end, 100)
end

local function stopAtEdge(view, beforeX, beforeY, dx, dy)
    local x, y = view:GetScroll()
    if not view.props.bounces then
        if math.abs(x - beforeX - dx) > 0.01 then view.state.velocityX = 0 end
        if math.abs(y - beforeY - dy) > 0.01 then view.state.velocityY = 0 end
    end
end

local function integrate(speed, dt)
    if math.abs(speed) <= STOP_SPEED then return 0, 0 end
    -- Integrate exactly up to the stop threshold, independent of frame count.
    local duration = math.min(dt, math.log(math.abs(speed) / STOP_SPEED) / DECAY)
    local factor = math.exp(-DECAY * duration)
    return speed * (1 - factor) / DECAY, duration < dt and 0 or speed * factor
end

function ScrollInput.Attach(view)
    if view.luiScrollInput_ or type(view.Update) ~= "function" or type(view.state) ~= "table" then return end
    view.luiScrollInput_ = true
    local oldUpdate, oldDown, oldMove, oldUp, oldCancel, oldDestroy = view.Update,
        view.OnPointerDown, view.OnPointerMove, view.OnPointerUp, view.OnPointerCancel, view.Destroy

    -- Public within the adapter: virtual-height changes must move the cached
    -- scrollbar origin as well as scrollY. Content dragging uses increments.
    function view:luiShiftScrollOrigin_(dx, dy)
        self.dragStartScrollX_ = (self.dragStartScrollX_ or 0) + dx
        self.dragStartScrollY_ = (self.dragStartScrollY_ or 0) + dy
        if self.isDraggingScrollbarV_ then
            self.scrollbarDragStartScrollY_ = (self.scrollbarDragStartScrollY_ or 0) + dy
        end
        if self.isDraggingScrollbarH_ then
            self.scrollbarDragStartScrollX_ = (self.scrollbarDragStartScrollX_ or 0) + dx
        end
    end

    function view:OnPanStart(event)
        if not accepts(self, event) or (not self.props.scrollX and not self.props.scrollY) then return false end
        if event.pointerType == "mouse" and input and input.GetMouseButtonDown and MOUSEB_LEFT
            and not input:GetMouseButtonDown(MOUSEB_LEFT) then return false end
        if self.CancelSnap_ then self:CancelSnap_() end
        -- A scrollbar gesture keeps native pointer capture and must never also
        -- drag the content. isDragging lets the gesture dispatcher retain it.
        if self.isDraggingScrollbarV_ or self.isDraggingScrollbarH_ then
            self.state.isDragging = true
            return true
        end
        if UI.CancelPointer then UI.CancelPointer(event.pointerId, event.pointerType) end
        self.luiScrollPointerId_, self.luiScrollPointerType_ = event.pointerId, event.pointerType
        self.luiPanX_, self.luiPanY_, self.luiPanTime_ = event.x, event.y, timestamp(event)
        self.luiPanSampleX_, self.luiPanSampleY_ = 0, 0
        self.dragStartScrollX_, self.dragStartScrollY_ = self:GetScroll()
        self.state.isDragging = true
        self.state.velocityX, self.state.velocityY = 0, 0
        watchCancel(self)
        return true
    end

    function view:OnPanMove(event)
        if not self.state.isDragging or not accepts(self, event) then return end
        if self.isDraggingScrollbarV_ or self.isDraggingScrollbarH_ then return end
        local dx = self.props.scrollX and ((self.luiPanX_ or event.x) - event.x) or 0
        local dy = self.props.scrollY and ((self.luiPanY_ or event.y) - event.y) or 0
        self.luiPanX_, self.luiPanY_ = event.x, event.y
        local x, y = self:GetScroll()
        self:SetScroll(x + dx, y + dy)
        self.luiPanSampleX_ = (self.luiPanSampleX_ or 0) + dx
        self.luiPanSampleY_ = (self.luiPanSampleY_ or 0) + dy
        local now = timestamp(event)
        local elapsed = now - (self.luiPanTime_ or now)
        if elapsed > 0 then
            local alpha = 1 - math.exp(-elapsed / 0.04)
            local function velocity(previous, distance)
                local speed = math.max(-MAX_SPEED, math.min(MAX_SPEED, distance / elapsed))
                return previous + (speed - previous) * alpha
            end
            self.state.velocityX = velocity(self.state.velocityX or 0, self.luiPanSampleX_)
            self.state.velocityY = velocity(self.state.velocityY or 0, self.luiPanSampleY_)
            self.luiPanSampleX_, self.luiPanSampleY_, self.luiPanTime_ = 0, 0, now
        end
        stopAtEdge(self, x, y, dx, dy)
    end

    function view:OnPanEnd(event)
        if not accepts(self, event) then return end
        local bar = self.isDraggingScrollbarV_ or self.isDraggingScrollbarH_
        local stale = timestamp(event) - (self.luiPanTime_ or timestamp(event)) > 0.12
        finish(self, bar or stale)
    end

    function view:OnPointerDown(event)
        if not accepts(self, event) then return end
        self.state.velocityX, self.state.velocityY = 0, 0
        local result = oldDown and oldDown(self, event)
        if not self.props.scrollbarInteractive then return result end
        local vertical = self.isDraggingScrollbarV_
        local horizontal = self.isDraggingScrollbarH_
        if vertical or horizontal then
            self.luiScrollPointerId_, self.luiScrollPointerType_ = event.pointerId, event.pointerType
            watchCancel(self)
            local track = vertical and self.vTrackBounds_ or self.hTrackBounds_
            local thumb = vertical and self.vScrollbarBounds_ or self.hScrollbarBounds_
            if track and thumb then
                local range = vertical and (track.h - thumb.h) or (track.w - thumb.w)
                if vertical then self.scrollbarDragTrackRangeV_ = math.max(0, range)
                else self.scrollbarDragTrackRangeH_ = math.max(0, range) end
            end
        elseif result then
            -- Match the drawn thumb's centre when clicking an empty track.
            local function jump(track, thumb, isVertical)
                if not track or not thumb or not self:PointInBounds(event.x, event.y, track) then return end
                local length, size = isVertical and track.h or track.w, isVertical and thumb.h or thumb.w
                local position = (isVertical and event.y - track.y or event.x - track.x) - size / 2
                local ratio = length > size and math.max(0, math.min(1, position / (length - size))) or 0
                local rect = self:GetLayout()
                if isVertical then self:SetScroll(self.state.scrollX, math.max(0, self.contentHeight_ - rect.h) * ratio)
                else self:SetScroll(math.max(0, self.contentWidth_ - rect.w) * ratio, self.state.scrollY) end
            end
            jump(self.vTrackBounds_, self.vScrollbarBounds_, true)
            jump(self.hTrackBounds_, self.hScrollbarBounds_, false)
        end
        return result
    end

    function view:OnPointerMove(event)
        if not accepts(self, event) then return end
        if oldMove then return oldMove(self, event) end
    end
    function view:OnPointerUp(event)
        if not accepts(self, event) then return end
        local result = oldUp and oldUp(self, event)
        finish(self, true)
        return result
    end
    function view:OnPointerCancel(event)
        if not accepts(self, event) then return end
        finish(self, true, true)
        if oldCancel then return oldCancel(self, event) end
    end

    function view:Update(dt)
        if self.luiScrollPointerId_ == nil then releaseCancel(self) end
        if not visible(self) then finish(self, true); return end
        if input and input.focus == false then finish(self, true); return end
        dt = math.max(0, math.min(0.1, finite(dt, 0)))
        if self.luiScrollPointerId_ ~= nil and input then
            local released = input.focus == false
            if self.luiScrollPointerType_ == "mouse" and input.GetMouseButtonDown and MOUSEB_LEFT then
                released = released or not input:GetMouseButtonDown(MOUSEB_LEFT)
            elseif self.luiScrollPointerType_ == "touch" and input.GetNumTouches then
                released = released or input:GetNumTouches() == 0
            end
            if released then finish(self, true) end
        end
        local state = self.state
        local dragging = state.isDragging or self.isDraggingScrollbarV_ or self.isDraggingScrollbarH_
        local vx, vy = finite(state.velocityX, 0), finite(state.velocityY, 0)
        local momentum = not dragging and (math.abs(vx) > STOP_SPEED or math.abs(vy) > STOP_SPEED)
        -- Suppress native frame-count friction, retaining its bounds, snap,
        -- scrollbar fade and idle bounce handling.
        local actualDragging = state.isDragging
        if momentum then state.isDragging = true end
        state.velocityX, state.velocityY = 0, 0
        oldUpdate(self, dt)
        state.isDragging = actualDragging
        state.velocityX, state.velocityY = vx, vy
        if momentum then
            local dx, nextX = integrate(vx, dt)
            local dy, nextY = integrate(vy, dt)
            local x, y = self:GetScroll()
            state.velocityX, state.velocityY = nextX, nextY
            self:SetScroll(x + dx, y + dy)
            stopAtEdge(self, x, y, dx, dy)
        elseif not dragging then state.velocityX, state.velocityY = 0, 0 end
    end

    if oldDestroy then
        function view:Destroy()
            finish(self, true)
            return oldDestroy(self)
        end
    end
end

return ScrollInput
