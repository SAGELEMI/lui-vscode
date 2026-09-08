-- Single-line tail ellipsis for authored LUI Text. The binding remains whole;
-- only Measure's temporary displayText_ changes while the native Label draws.
local UI = require("urhox-libs/UI")
local NativeText = require("LUI.NativeText")
local Trimming = {}
local ellipsis = "…"

local function extends(code)
    return code >= 0x0300 and code <= 0x036F or code >= 0x1AB0 and code <= 0x1AFF
        or code >= 0x1DC0 and code <= 0x1DFF or code >= 0x20D0 and code <= 0x20FF
        or code >= 0xFE20 and code <= 0xFE2F or code >= 0xFE00 and code <= 0xFE0F
        or code >= 0xE0100 and code <= 0xE01EF or code >= 0x1F3FB and code <= 0x1F3FF
        or code >= 0xE0020 and code <= 0xE007F
end

-- Preserve UTF-8 codepoints, combining accents and common emoji sequences
-- (variation selectors, skin tones, ZWJ families, keycaps and paired flags).
-- This is a truncation boundary helper, not a general Unicode text segmenter.
local function boundaries(text)
    local result, previous, regionalRun = {}, nil, 0
    for offset, code in utf8.codes(text) do
        local regional = code >= 0x1F1E6 and code <= 0x1F1FF
        local joined = previous == 0x200D or code == 0x200D or extends(code)
            or regional and regionalRun % 2 == 1
        if previous and not joined then result[#result + 1] = offset - 1 end
        if regional then regionalRun = regionalRun + 1
        elseif not extends(code) then regionalRun = 0 end
        previous = code
    end
    if previous then result[#result + 1] = #text end
    return result
end

function Trimming.Enabled(widget)
    return widget.luiText_ == "Text" and widget.props.maxLines == 1
end

function Trimming.Resolve(widget, text, width, size, face, spacing)
    text, width, spacing = tostring(text or ""), math.max(0, width or 0), spacing or 0
    -- Resolve the public translation key before trimming its visible content.
    -- A language change changes this string and invalidates the result too.
    if type(_tr) == "function" then text = _tr(text) end
    local theme = UI.Theme
    local scale = theme and theme.GetScale and theme.GetScale() or 1
    local version = UI.GetFontVersion and UI.GetFontVersion() or 0
    local context = UI.GetNVGContext and UI.GetNVGContext() or nil
    local job = widget.luiTextTrimming_
    if not job or job.text ~= text or job.width ~= width or job.size ~= size
        or job.face ~= face or job.spacing ~= spacing or job.scale ~= scale
        or job.version ~= version or job.context ~= context then
        job = {text=text, width=width, size=size, face=face, spacing=spacing,
            scale=scale, version=version, context=context}
        widget.luiTextTrimming_ = job
    end
    if job.result ~= nil then return job.result end
    if width <= 0 or text == "" then job.result = ""; return job.result end
    -- Explicit newlines cannot start another row under a single-line contract.
    if not job.singleLine then job.singleLine = text:gsub("[\r\n]+", " ") end
    local value = job.singleLine
    local function measure(candidate)
        return NativeText.WithOwner(widget, UI.MeasureTextWidth, candidate, size, face, spacing)
    end
    if job.fullWidth == nil then job.fullWidth = measure(value) end
    if job.fullWidth <= width then job.result = value; return job.result end
    if job.ellipsisWidth == nil then job.ellipsisWidth = measure(ellipsis) end
    if job.ellipsisWidth > width then job.result = ""; return job.result end
    if not job.ends then
        job.ends = boundaries(value)
        job.low, job.high = 0, math.max(0, #job.ends - 1)
    end
    while job.low < job.high do
        local middle = math.floor((job.low + job.high + 1) / 2)
        local candidate = value:sub(1, job.ends[middle]) .. ellipsis
        -- Bounds and the scalar search progress commit only after this call
        -- completes. NativeText preserves an already completed C phase when
        -- a later phase hits the VM's shared quota or elapsed deadline.
        if measure(candidate) <= width then job.low = middle
        else job.high = middle - 1 end
    end
    job.result = (job.low > 0 and value:sub(1, job.ends[job.low]) or "") .. ellipsis
    job.ends, job.singleLine = nil, nil
    return job.result
end

return Trimming
