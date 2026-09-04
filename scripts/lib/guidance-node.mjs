import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const guidanceNodeIO = {
  async read(path) {
    try { return await readFile(path); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  },
  async write(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); },
};
