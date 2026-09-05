local Parser = require("LUI.Parser")

local Project = {}

local function decode(path)
    local text, readError = Parser.Read(path)
    if not text then return nil, readError end
    local ok, value = pcall(cjson.decode, text)
    if not ok or type(value) ~= "table" then return nil, "LUI JSON 无效：" .. path end
    return value, nil
end

function Project.Read()
    local config, err = decode("LUI/lui.project.json")
    if not config then return { sourceRoots = {} }, err end
    return config, nil
end

function Project.Fonts(config)
    local fonts, files = {}, {}
    for _, family in ipairs(config.fonts or {}) do
        local item = { family = family.family, weights = {} }
        for weight, descriptor in pairs(family.weights or {}) do
            local resource = type(descriptor) == "table" and descriptor.resource or descriptor
            if type(resource) ~= "string" or resource == "" or not cache:Exists(resource) then return nil, nil, "LUI 字体资源不存在：" .. tostring(resource) end
            item.weights[weight] = resource
            files[#files + 1] = { family = family.family, weight = weight, resource = resource, sha256 = type(descriptor) == "table" and descriptor.sha256 or nil }
        end
        fonts[#fonts + 1] = item
    end
    if #fonts == 0 then return nil, nil, "LUI 项目未声明字体。" end
    return fonts, files, nil
end

function Project.Validate(expectedVersion, expectedContract)
    local config, configError = Project.Read()
    if configError then return nil, configError end
    local manifest, manifestError = decode("LUI/runtime-manifest.json")
    if not manifest then return nil, manifestError end
    if manifest.version ~= expectedVersion or config.version ~= expectedVersion then return nil, "LUI 版本不匹配：需要 " .. expectedVersion .. "。" end
    if manifest.layoutContract ~= expectedContract or config.layoutContract ~= expectedContract then return nil, "LUI 布局契约不匹配：" .. tostring(expectedContract) end
    local fonts, files, fontError = Project.Fonts(config)
    if not fonts then return nil, fontError end
    local registry = require("LUI.Registry")
    for kind, entries in pairs({ pages = registry.pages, controls = registry.controls }) do
        for name, descriptor in pairs(entries or {}) do
            if not cache:Exists(descriptor.markup) then return nil, "LUI 未找到" .. kind .. "标记：" .. name .. " -> " .. tostring(descriptor.markup) .. "（检查资源及 .meta uuid）" end
            if not cache:Exists(descriptor.code) then return nil, "LUI 未找到" .. kind .. "后端：" .. name .. " -> " .. tostring(descriptor.code) .. "（检查资源及 .meta uuid）" end
        end
    end
    return { config = config, manifest = manifest, fonts = fonts, fontFiles = files }, nil
end

return Project
