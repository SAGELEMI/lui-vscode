local Inventory = {}
Inventory.__index = Inventory

function Inventory.New(presentation, runtime, descriptor)
    local self = setmetatable({}, Inventory)
    self:Init(presentation, runtime, descriptor)
    self:InitializeComponent()
    return self
end
function Inventory:Init(presentation, runtime, descriptor)
    self.presentation_, self.runtime_, self.descriptor_ = presentation, runtime, descriptor
    self.view_ = {
        rows = { { id = "potion", title = "药水" }, { id = "key", title = "钥匙" } },
        selectedId = "", detail = "请选择物品",
    }
end
function Inventory:SetDetail(text)
    self.view_.detail = text
    self.context_.bindings:Notify("view.detail")
end
function Inventory:CreateContext()
    return {
        view = self.view_, owner = self, refs = {}, presentation = self.presentation_,
        actions = {
            Select = function(row)
                -- Runtime 传入原始项；按稳定 ID 记录选择，不用文案做身份。
                if type(row) ~= "table" then return end
                for _, current in ipairs(self.view_.rows) do
                    if current == row then
                        self.view_.selectedId = row.id
                        self:SetDetail("已选择：" .. row.title)
                        return
                    end
                end
            end,
            Confirm = function()
                for _, row in ipairs(self.view_.rows) do
                    if row.id == self.view_.selectedId then self:SetDetail("已确认：" .. row.title); return end
                end
                self.view_.selectedId = ""
                self:SetDetail("请选择有效物品")
            end,
            Back = function() self.presentation_:Navigate("Welcome") end,
        },
    }
end
function Inventory:InitializeComponent()
    local root, context = self.runtime_:RenderMarkup(self.descriptor_.markup, self:CreateContext())
    if not root then error(context or "物品页初始化失败") end
    self.root_, self.context_ = root, context
end
function Inventory:OnLoaded(root, context)
    context.refs.DetailText:SetText(self.view_.detail)
end
function Inventory:OnBindingChanged(path, context)
    if path == "view.detail" then context.refs.DetailText:SetText(self.view_.detail) end
end
function Inventory:GetRoot() return self.root_ end
function Inventory:Dispose() self.root_, self.context_ = nil, nil end
return Inventory
