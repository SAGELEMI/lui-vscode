-- LUI 的 UrhoX/Lua 公开入口。显式转发 New 让调用方和 Lua LSP 都能发现运行时工厂。
local Runtime = require("LUI.Runtime")
local Project = require("LUI.Project")

return {
    New = Runtime.New,
    Project = Project,
}
