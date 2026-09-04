-- 教学注册表结构；Studio 会根据 sourceRoots 自动重建，不要覆盖已有游戏注册表。
local Registry = {
    pages = {
        Welcome = { markup = "Presentation/Pages/Welcome.lui", code = "Presentation/Pages/Welcome.lui.lua" },
        Inventory = { markup = "Presentation/Pages/Inventory.lui", code = "Presentation/Pages/Inventory.lui.lua" },
    },
    controls = {
        ActionCard = { markup = "Presentation/Components/ActionCard.lui", code = "Presentation/Components/ActionCard.lui.lua" },
    },
}
function Registry:Get(name) return self.pages[name] or self.controls[name] end
return Registry
