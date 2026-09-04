local Welcome = {}
Welcome.__index = Welcome

function Welcome.New(presentation, runtime, descriptor)
    local self = setmetatable({}, Welcome)
    self:Init(presentation, runtime, descriptor)
    self:InitializeComponent()
    return self
end

function Welcome:Init(presentation, runtime, descriptor)
    self.presentation_, self.runtime_, self.descriptor_ = presentation, runtime, descriptor
    self.view_ = { title = "你好，LUI", count = 0, counterText = "点击次数：0" }
end

function Welcome:CreateContext()
    return {
        view = self.view_, owner = self, refs = {}, presentation = self.presentation_,
        actions = {
            Increment = function()
                self.view_.count = self.view_.count + 1
                self.view_.counterText = "点击次数：" .. self.view_.count
                self.context_.bindings:Notify("view.counterText")
            end,
            OpenInventory = function() self.presentation_:Navigate("Inventory") end,
        },
    }
end

function Welcome:InitializeComponent()
    local root, context = self.runtime_:RenderMarkup(self.descriptor_.markup, self:CreateContext())
    if not root then error(context or "欢迎页初始化失败") end
    self.root_, self.context_ = root, context
end

function Welcome:OnLoaded(root, context)
    -- 此时 InitializeComponent 尚未返回，使用传入的 context。
    context.refs.CounterText:SetText(self.view_.counterText)
end

function Welcome:OnBindingChanged(path, context)
    if path == "view.counterText" then context.refs.CounterText:SetText(self.view_.counterText) end
end

function Welcome:GetRoot() return self.root_ end
function Welcome:Dispose()
    self.root_, self.context_ = nil, nil
end
return Welcome
