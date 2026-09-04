import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import luaparse from "luaparse";
import spec from "../dist/spec.cjs";
import { guidanceEntries, GUIDE_EXAMPLES } from "./lib/guidance.mjs";

export async function checkDocs(root, deployed = false) {
  const entries = guidanceEntries();
  const paths = entries.map((e) => join(root, deployed ? e.target : e.source));
  if (!deployed) paths.push(join(root, "README.md"), join(root, "AGENTS.md"), join(root, "docs/history.md"));
  else paths.push(join(root, "AGENTS.md"));
  let links = 0, snippets = 0;
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    assert.ok(!source.includes("\ufffd"), `${path}: invalid UTF-8`);
    if (!path.endsWith(".md")) continue;
    for (const [, target] of source.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const file = decodeURIComponent(target.split("#")[0]);
      assert.ok((await stat(resolve(dirname(path), file))).isFile(), `${path}: ${target}`);
      links++;
    }
    for (const [, code] of source.matchAll(/```xml\s*\n([\s\S]*?)```/g)) {
      const document = spec.parseLui(/^\s*<(页面|控件)\b/u.test(code) || /^\s*<(页面|控件)\s/u.test(code) ? code : `<控件 名称="DocSnippet">${code}</控件>`);
      assert.deepEqual(document.diagnostics.filter((d) => d.severity === "error"), [], `${path}: XML example`);
      snippets++;
    }
    for (const [command] of source.matchAll(/\{命令\s+[^}\n]+\}/g)) {
      if (command.includes("...")) continue;
      assert.ok(spec.parseCommand(command), `${path}: invalid command ${command}`);
    }
  }
  const tutorial = join(root, deployed ? "docs/lui/examples/tutorial" : "examples/tutorial");
  const config = JSON.parse(await readFile(join(tutorial, "lui.project.json"), "utf8"));
  const imports = [];
  for (const [directory, registered] of Object.entries(config.componentDirectories)) {
    const components = [];
    for (const [name, descriptor] of Object.entries(registered)) {
      const file = descriptor.markup.replace(/^Presentation\//, "");
      const declaration = spec.readComponentProperties(await readFile(join(tutorial, file + ".lua"), "utf8"));
      assert.equal(declaration.error, undefined);
      assert.ok(declaration.properties);
      components.push({ name, properties: Object.keys(declaration.properties), definitions: declaration.properties });
    }
    imports.push({ directory, components });
  }
  let pairs = 0, lua = 0;
  for (const file of GUIDE_EXAMPLES) {
    const source = await readFile(join(tutorial, file), "utf8");
    if (file.endsWith(".lua")) { luaparse.parse(source, { luaVersion: "5.3" }); lua++; }
    if (!file.endsWith(".lui")) continue;
    const parsed = spec.parseLui(source);
    const own = spec.readComponentProperties(await readFile(join(tutorial, file + ".lua"), "utf8"));
    assert.equal(own.error, undefined, file);
    const aliases = spec.namespaceImports(parsed).map((i) => ({ ...i, components: imports.find((entry) => entry.directory === i.directory)?.components ?? [] }));
    assert.deepEqual([...parsed.diagnostics, ...spec.validateComponentProperties(parsed, aliases, own.properties)], [], file);
    pairs++;
  }
  return { links, snippets, pairs, lua };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await checkDocs(resolve(import.meta.dirname, ".."))));
}
