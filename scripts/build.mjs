import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const watch = process.argv.includes("--watch");
const outdir = resolve("dist");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await rm(resolve("runtime"), { recursive: true, force: true });
await cp(resolve("packages/runtime-urhox-lua/adapter"), resolve("runtime/urhox-lua"), { recursive: true });

const options = {
  entryPoints: { extension: "src/extension.ts", spec: "packages/spec/src/index.ts" },
  outdir,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info"
};
if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("LUI Studio 正在监听源码变更。");
} else {
  await build(options);
}
