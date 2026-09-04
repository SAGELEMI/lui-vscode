-- 静态布局在同名 .lui；业务和生命周期在本类，Studio只静态读取公开声明。
local PublicCardControl = {}
PublicCardControl.__index = PublicCardControl
PublicCardControl.Properties = {
    ["标题"] = { type = "string", default = "卡片标题", description = "卡片上方文案" },
    ["确认"] = { type = "event", description = "由调用方提供的动作" },
}

function PublicCardControl.New(parentContext, runtime, descriptor, props, slots)
    local instance = setmetatable({}, PublicCardControl)
    instance:Init(parentContext, runtime, descriptor, props, slots)
    instance:InitializeComponent()
    return instance
end

function PublicCardControl:Init(parentContext, runtime, descriptor, props, slots)
    self.parentContext_, self.runtime_, self.descriptor_ = parentContext, runtime, descriptor
    self.props_, self.slots_, self.view_ = props or {}, slots or {}, {}
    -- 如需业务读取：self.props_["标题"]，无隐式英文转换。
end

function PublicCardControl:CreateContext()
    return {
        props = self.props_, slots = self.slots_, view = self.view_, owner = self,
        actions = self.parentContext_ and self.parentContext_.actions or {},
        presentation = self.parentContext_ and self.parentContext_.presentation,
        componentStack = self.parentContext_ and self.parentContext_.componentStack,
    }
end

function PublicCardControl:InitializeComponent()
    -- 纯标记入口不会再次加载自身后端；Runtime负责挂载时调用OnLoaded。
    local root, context = self.runtime_:RenderMarkup(self.descriptor_.markup, self:CreateContext(), self.parentContext_)
    if not root then error(context or "控件初始化失败") end
    self.root_, self.context_ = root, context
    return root
end
function PublicCardControl:GetRoot() return self.root_ end
function PublicCardControl:OnLoaded(root, context)
    -- 订阅业务通知可放在这里；不要重复构造静态控件树。
end
function PublicCardControl:Dispose()
    -- 如有订阅或异步任务，在此解除。
    self.root_, self.context_ = nil, nil
end
return PublicCardControl
