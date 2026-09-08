import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { ProjectPreviewHost } = require("../dist/projectPreviewHost.cjs");
const game = resolve(process.argv[2] || "../Tap制造/无尽塔");
const project = JSON.parse(await readFile(resolve(game, ".project/project.json"), "utf8"));
const config = JSON.parse(await readFile(resolve(game, "scripts/LUI/lui.project.json"), "utf8"));
const files = new Map();
async function collect(directory, root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".backup-last") continue;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(file, root);
    else files.set(relative(root, file).replaceAll("\\", "/"), await readFile(file));
  }
}
await collect(resolve(game, "scripts"), resolve(game, "scripts"));
await collect(resolve(game, "assets"), resolve(game, "assets"));
const sourcePaths = new Set([...files.keys()].filter(path => path.endsWith(".lui") && config.sourceRoots.some(root => path === root || path.startsWith(root + "/"))));
const input = { entry: project.entry, files, sourcePaths, title: project.taptap_publish?.title };
const host = new ProjectPreviewHost();
let selection;
host.onPick = value => { selection = value; };
await host.start(resolve("artifacts/engine-cache"), input);
host.onRefreshRequested = async () => host.update(input, false);
if (process.argv.includes("--serve")) {
  console.log(host.url);
  const finish = () => { host.dispose(); process.exit(0); };
  process.once("SIGINT", finish); process.once("SIGTERM", finish);
  await new Promise(() => {});
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 920 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  window.__projectEvents = [];
  window.addEventListener("message", event => {
    if (event.origin === location.origin && event.data?.name?.startsWith("lui-project-")) window.__projectEvents.push(event.data);
  });
});
try {
  await page.goto(host.url);
  await page.waitForFunction(() => window.__projectEvents.some(event => event.name === "lui-project-ready" || event.name === "lui-project-error"), null, { timeout: 60_000 });
  const first = await page.evaluate(() => window.__projectEvents.find(event => event.name === "lui-project-error") || window.__projectEvents.find(event => event.name === "lui-project-ready"));
  assert.equal(first.name, "lui-project-ready", first.payload?.message);
  const point = { x: first.payload.width / 2, y: first.payload.height / 2 };
  await page.evaluate(point => document.querySelector("iframe").contentWindow.postMessage({ source: "tap-plugin-host", kind: "event", name: "LuiProjectPreviewPick", payload: point }, location.origin), point);
  for (let index = 0; index < 50 && !selection; index++) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  assert.ok(selection && sourcePaths.has(selection.sourcePath), JSON.stringify(selection));
  host.update(input, true);
  await page.waitForFunction(() => window.__projectEvents.filter(event => event.name === "lui-project-ready").length >= 2, null, { timeout: 60_000 });
  assert.equal(await page.locator("iframe").count(), 1);
  console.log(JSON.stringify({ passed: true, entry: project.entry, selection, files: files.size, sources: sourcePaths.size }));
} finally {
  await browser.close(); host.dispose();
}
