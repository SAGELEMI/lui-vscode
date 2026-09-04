import { createHash } from "node:crypto";
import { join } from "node:path";

export const GUIDE_DOCS = ["README.md", "getting-started.md", "language.md", "layout.md", "controls.md", "components.md", "bindings.md", "runtime.md", "studio.md", "troubleshooting.md", "migration.md"];
export const GUIDE_EXAMPLES = ["README.md", "lui.project.json", "Registry.lua", "Start.lua", "Pages/Welcome.lui", "Pages/Welcome.lui.lua", "Pages/Inventory.lui", "Pages/Inventory.lui.lua", "Components/ActionCard.lui", "Components/ActionCard.lui.lua"];
export const GUIDE_SKILLS = ["lui-authoring", "lui-troubleshooting"];
const BEGIN = "<!-- >>> LUI managed guidance >>> -->";
const END = "<!-- <<< LUI managed guidance <<< -->";
const STATE = "docs/lui/.delivery.json";
export const digest = (value) => createHash("sha256").update(value).digest("hex");
const text = (bytes) => Buffer.from(bytes).toString("utf8");

export function guidanceEntries() {
  return [
    ...GUIDE_DOCS.map((name) => ({ source: `docs/${name}`, target: `docs/lui/${name}`, rewrite: (s) => s.replaceAll("../examples/", "./examples/") })),
    ...GUIDE_EXAMPLES.map((name) => ({ source: `examples/tutorial/${name}`, target: `docs/lui/examples/tutorial/${name}` })),
    ...GUIDE_SKILLS.map((name) => ({ source: `skills/${name}/SKILL.md`, target: `skills/${name}/SKILL.md`, rewrite: (s) => s.replaceAll("../../docs/", "../../docs/lui/").replaceAll("../../examples/", "../../docs/lui/examples/") })),
  ];
}

/** Shared by the extension (workspace.fs) and CLI (node:fs); never executes example Lua. */
export async function deployGuidance(sourceRoot, targetRoot, io) {
  // Read the complete payload and state before changing the target.
  const pkg = JSON.parse(text(await required(io, join(sourceRoot, "package.json"))));
  const payload = await Promise.all(guidanceEntries().map(async (entry) => {
    const bytes = await required(io, join(sourceRoot, entry.source));
    return { ...entry, bytes: entry.rewrite ? Buffer.from(entry.rewrite(text(bytes)), "utf8") : bytes };
  }));
  const statePath = join(targetRoot, STATE);
  const previousBytes = await io.read(statePath);
  const previous = previousBytes ? JSON.parse(text(previousBytes)) : { schemaVersion: 1, files: {} };
  if (previous.schemaVersion !== 1 || !previous.files || typeof previous.files !== "object" || Array.isArray(previous.files)) throw new Error("LUI 资料交付记录无效，请保留现场并修复 docs/lui/.delivery.json。");
  const files = { ...previous.files };
  const updated = [], preserved = [];
  for (const entry of payload) {
    const destination = join(targetRoot, entry.target);
    const incomingHash = digest(entry.bytes);
    const current = await io.read(destination);
    if (current && digest(current) !== incomingHash && digest(current) !== previous.files[entry.target]) {
      preserved.push(entry.target);
      continue;
    }
    if (!current || digest(current) !== incomingHash) {
      await io.write(destination, entry.bytes);
      updated.push(entry.target);
    }
    files[entry.target] = incomingHash;
  }
  const agentsPath = join(targetRoot, "AGENTS.md");
  const agentsBytes = await io.read(agentsPath);
  const agents = agentsBytes ? text(agentsBytes) : "";
  const eol = agents.includes("\r\n") ? "\r\n" : "\n";
  const block = [BEGIN, "## LUI 使用入口", "", "仅在创建、修改或排查 LUI 页面、组件、绑定与部署时读取：", "- 文档：[LUI 使用文档](docs/lui/README.md)。", "- 编写：[lui-authoring](skills/lui-authoring/SKILL.md)。", "- 排错：[lui-troubleshooting](skills/lui-troubleshooting/SKILL.md)。", "", "先读对应 skill，再按任务阅读手册；遵循当前项目其他规则。资料由 LUI 部署维护，版本与保护状态见 docs/lui/.delivery.json。", END].join(eol);
  const start = agents.indexOf(BEGIN), end = agents.indexOf(END);
  let next = agents;
  let agentsBlockHash = previous.agentsBlockHash;
  if (start === -1 && end === -1) {
    next = agents + (agents && !agents.endsWith("\n") ? eol : "") + (agents ? eol : "") + block + eol;
    agentsBlockHash = digest(block);
  } else if (start < 0 || end < start || agents.indexOf(BEGIN, start + BEGIN.length) !== -1 || agents.indexOf(END, end + END.length) !== -1) {
    preserved.push("AGENTS.md（LUI 标记不完整或重复）");
  } else {
    const oldBlock = agents.slice(start, end + END.length);
    // EOL changes are harmless; edits inside the managed block remain user-owned.
    const normalize = (s) => s.replaceAll("\r\n", "\n");
    if (normalize(oldBlock) === normalize(block) || digest(oldBlock) === previous.agentsBlockHash) {
      next = agents.slice(0, start) + block + agents.slice(end + END.length);
      agentsBlockHash = digest(block);
    } else preserved.push("AGENTS.md（LUI 导航已被修改）");
  }
  if (next !== agents) { await io.write(agentsPath, Buffer.from(next, "utf8")); updated.push("AGENTS.md"); }
  const state = Buffer.from(JSON.stringify({ schemaVersion: 1, version: pkg.version, files, agentsBlockHash, preserved }, null, 2) + "\n", "utf8");
  if (!previousBytes || !Buffer.from(previousBytes).equals(state)) await io.write(statePath, state);
  return { version: pkg.version, updated, preserved };
}

async function required(io, path) {
  const bytes = await io.read(path);
  if (!bytes) throw new Error(`LUI 交付包缺少文件：${path}`);
  return bytes;
}

/** Compare against the manifest actually shipped with this extension, not a hardcoded release. */
export function matchesRuntime(project, installedBytes, expectedBytes) {
  const installed = JSON.parse(text(installedBytes));
  const expected = JSON.parse(text(expectedBytes));
  return typeof expected.version === "string" && typeof expected.layoutContract === "string"
    && installed.version === expected.version && installed.layoutContract === expected.layoutContract
    && project?.version === installed.version && project?.layoutContract === installed.layoutContract
    && project?.runtimeManifestHash === digest(installedBytes) && digest(installedBytes) === digest(expectedBytes);
}
