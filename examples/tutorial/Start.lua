-- 在宿主完成 UI.Init 后使用；不替换游戏 main.lua 或重复初始化 UI。
local LUI = require("LUI")
local UI = require("urhox-libs/UI")
local Tutorial = {}
Tutorial.__index = Tutorial

function Tutorial.New()
    local self = setmetatable({}, Tutorial)
    self.runtime_ = LUI.New()
    self:Navigate("Welcome")
    return self
end
function Tutorial:Navigate(name)
    local nextPage, err = self.runtime_:CreateRegistered(name, self)
    if not nextPage then error(err or "页面创建失败") end
    local previous = self.current_
    UI.SetRoot(nextPage:GetRoot())
    self.current_ = nextPage
    if previous then previous:Dispose() end
end
function Tutorial:Dispose()
    if self.current_ then self.current_:Dispose(); self.current_ = nil end
    -- UI 根的卸载由调用方按游戏现有生命周期处理。
end
return Tutorial
