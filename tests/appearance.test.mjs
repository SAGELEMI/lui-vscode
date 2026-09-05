import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import spec from "../dist/spec.cjs";

test("all visual tags receive surface capabilities and structural tags do not", async () => {
  const contract = JSON.parse(await readFile("packages/spec/ui-capabilities.json", "utf8"));
  const generated = JSON.parse(await readFile("packages/spec/controls.json", "utf8")).controls.map((entry) => entry.tag);
  for (const tag of [...contract.builtInVisualTags, ...generated]) {
    const attributes = spec.capabilityAttributes(tag);
    for (const property of contract.groups.surface) assert.ok(attributes.includes(property), `${tag} misses ${property}`);
  }
  for (const tag of contract.structuralTags) for (const property of contract.groups.surface) assert.ok(!spec.capabilityAttributes(tag).includes(property), `${tag} exposes ${property}`);
  for (const tag of contract.textTags) for (const property of contract.groups.typography) assert.ok(spec.capabilityAttributes(tag).includes(property), `${tag} misses ${property}`);
});

test("brush parser and diagnostics share strict solid and two-stop linear syntax", () => {
  assert.deepEqual(spec.parseBrush("#7851c980"), { kind: "solid", color: "#7851C980" });
  assert.deepEqual(spec.parseBrush("linear-gradient(135deg, #7851c9 0%, #4d2a91ff 100%)"), { kind: "linear", angle: 135, stops: [{ color: "#7851C9", offset: 0 }, { color: "#4D2A91FF", offset: 100 }] });
  assert.equal(spec.parseBrush("linear-gradient(red, blue)"), undefined);
  const invalid = spec.parseLui('<控件 名称="C"><进度条 轨道画刷="red" 进度画刷="linear-gradient(red, blue)" /></控件>');
  assert.equal(invalid.diagnostics.filter((entry) => entry.severity === "error").length, 2);
});

test("page frame vectors use the same centered contain calculation", async () => {
  const vectors = JSON.parse(await readFile("packages/spec/page-frame-vectors.json", "utf8"));
  for (const vector of vectors) {
    const frame = spec.calculatePageFrame(vector.input);
    for (const key of ["x", "y", "scale"]) assert.ok(Math.abs(frame[key] - vector.expected[key]) < 1e-9, `${key}: ${frame[key]}`);
  }
  const runtime = await readFile("packages/runtime-urhox-lua/adapter/Runtime.lua", "utf8");
  assert.match(runtime, /PageFrame\.Calculate/);
  assert.doesNotMatch(runtime, /root = UI\.SafeAreaView/);
});

test("Studio and Runtime consume the shared render-fidelity contract", async () => {
  const contract = JSON.parse(await readFile("packages/spec/layout-contract.json", "utf8"));
  assert.equal(contract.renderFidelity.colorSpace, "srgb");
  assert.equal(contract.renderFidelity.alphaMode, "straight");
  assert.equal(contract.renderFidelity.gradientInterpolation, "premultiplied-srgb");
  assert.equal(contract.renderFidelity.borderAlign, "inside");
  assert.equal(contract.renderFidelity.defaultBoxShadow, false);
  assert.equal(contract.renderFidelity.typography.fontSynthesis, "none");

  const runtime = await readFile("packages/runtime-urhox-lua/adapter/Runtime.lua", "utf8");
  const typography = await readFile("packages/runtime-urhox-lua/adapter/Typography.lua", "utf8");
  const designer = await readFile("src/webview/designer.ts", "utf8");
  const css = await readFile("media/preview.css", "utf8");
  assert.match(runtime, /borderAlign = Fidelity\.borderAlign/);
  assert.match(runtime, /boxShadow = Fidelity\.defaultBoxShadow/);
  assert.match(runtime, /function Runtime:FindByRef/);
  assert.match(runtime, /function Runtime:MountGlobalOverlay/);
  assert.equal(contract.renderFidelity.typography.ownedTextRaster, "nanovg-single-pass");
  assert.equal(contract.renderFidelity.typography.inkCompensation, 0);
  assert.match(typography, /nanovg-single-pass/);
  assert.doesNotMatch(typography, /local offsets|for _, offset|x \+ offset/);
  assert.equal((typography.match(/nvgText\(nvg, x, y, text/g) ?? []).length, 1);
  assert.match(designer, /luiFontsReady/);
  assert.match(designer, /fontSynthesis/);
  assert.match(css, /\.lui-node\.card[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.lui-node\.modal[^}]*box-shadow:\s*none/s);
});

test("TextField uses its native value contract and constructor size before first Yoga layout", async () => {
  const runtime = await readFile("packages/runtime-urhox-lua/adapter/Runtime.lua", "utf8");
  const measure = await readFile("packages/runtime-urhox-lua/adapter/Measure.lua", "utf8");
  const designer = await readFile("src/webview/designer.ts", "utf8");
  assert.match(runtime, /if tag == "TextField" then props\.value = bound/);
  assert.match(runtime, /props\.textColor = props\.fontColor/);
  assert.match(runtime, /props\.placeholderColor/);
  assert.match(measure, /declaredSize\(props\.height, props\.minHeight, layout\.h\)/);
  assert.match(designer, /tag === "TextField"/);
  assert.match(designer, /input\.value = text\(attrs\.Text\)/);
});

test("bound Visibility remains live while literal collapsed nodes are pruned", async () => {
  const runtime = await readFile("packages/runtime-urhox-lua/adapter/Runtime.lua", "utf8");
  assert.match(runtime, /local visibilityBinding = bindingSpec\(attrs\.Visibility\)/);
  assert.match(runtime, /if not visibilityBinding and isCollapsed\(visibility\) then return nil end/);
  assert.match(runtime, /props\.visible = value ~= nil and not isCollapsed\(value\)/);
  assert.doesNotMatch(runtime, /bindingSpec\(attrs\.Visibility\) and visibility == nil/);
});
