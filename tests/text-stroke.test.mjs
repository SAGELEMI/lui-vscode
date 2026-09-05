import test from "node:test";
import assert from "node:assert/strict";
import spec from "../dist/spec.cjs";

const errors = (source) => spec.parseLui(source).diagnostics.filter((entry) => entry.severity === "error");
const document = (attrs, tag = "文本") => `<控件 名称="Stroke"><${tag} ${attrs} /></控件>`;

test("Text-only stroke capabilities provide Chinese and English aliases", () => {
  for (const name of ["TextStrokeColor", "TextStrokeWidth"]) {
    assert.ok(spec.capabilityAttributes("Text").includes(name));
    for (const tag of ["Button", "Container", "TextField"]) assert.ok(!spec.capabilityAttributes(tag).includes(name));
  }
  assert.deepEqual(errors(document('文字描边颜色="#10091C" 文字描边宽度="1.25"')), []);
  assert.deepEqual(errors(document('TextStrokeColor="#10091C80" TextStrokeWidth="0"')), []);
  assert.ok(errors(document('文字描边宽度="1"', "按钮")).some((entry) => entry.message.includes("只适用于")));
});

test("outline diagnostics reject invalid colors and nonfinite/negative widths but accept bindings", () => {
  for (const width of ["-1", "Infinity", "NaN", "20%", "自动", ""]) {
    assert.ok(errors(document(`文字描边宽度="${width}"`)).some((entry) => entry.message.includes("文字描边宽度")), width);
  }
  assert.ok(errors(document('文字描边颜色="red"')).some((entry) => entry.message.includes("文字描边颜色")));
  assert.deepEqual(errors(document('文字描边颜色="{绑定 view.color, 预览内容=\'#10091C\'}" 文字描边宽度="{绑定 view.width, 模式=单次, 预览内容=\'1\'}"')), []);
});
