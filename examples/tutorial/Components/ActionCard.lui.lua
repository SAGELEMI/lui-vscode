local ActionCard = {}
ActionCard.__index = ActionCard
ActionCard.Properties = {
    ["标题"] = { type = "string", default = "操作", description = "卡片标题" },
    ["条目"] = { type = "table", default = {}, description = "传给内容模板的条目集合" },
    ["确认"] = { type = "event", description = "调用方确认动作" },
}

function ActionCard.New(parentContext, runtime, descriptor, props, slots)
    local self = setmetatable({}, ActionCard)
    self:Init(parentContext, runtime, descriptor, props, slots)
    self:InitializeComponent()
    return self
end

function ActionCard:Init(parentContext, runtime, descriptor, props, slots)
    self.parentContext_, self.runtime_, self.descriptor_ = parentContext, runtime, descriptor
    self.props_, self.slots_, self.view_ = props or {}, slots or {}, {}
end

function ActionCard:CreateContext()
    return {
        view = self.view_, props = self.props_, slots = self.slots_, owner = self, refs = {},
        actions = self.parentContext_ and self.parentContext_.actions or {},
        presentation = self.parentContext_ and self.parentContext_.presentation,
        componentStack = self.parentContext_ and self.parentContext_.componentStack,
    }
end

function ActionCard:InitializeComponent()
    local root, context = self.runtime_:RenderMarkup(self.descriptor_.markup, self:CreateContext(), self.parentContext_)
    if not root then error(context or "操作卡初始化失败") end
    self.root_, self.context_ = root, context
end
function ActionCard:OnLoaded(root, context)
    -- 当前组件没有业务订阅；需要订阅时在 Dispose 对称解除。
end
function ActionCard:GetRoot() return self.root_ end
function ActionCard:Dispose() self.root_, self.context_ = nil, nil end
return ActionCard
