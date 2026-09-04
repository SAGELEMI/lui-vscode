import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import spec from '../dist/spec.cjs';
const project = resolve(process.argv[2]);
const adapter = resolve('packages/runtime-urhox-lua/adapter');
const runtime = join(project, 'scripts/LUI');
const manifestBytes = await readFile(join(adapter, 'runtime-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const config = JSON.parse(await readFile(join(runtime, 'lui.project.json'), 'utf8'));
assert.equal(config.version, manifest.version);
assert.equal(config.layoutContract, manifest.layoutContract);
assert.equal(config.runtimeManifestHash, createHash('sha256').update(manifestBytes).digest('hex'));
for (const file of await readdir(adapter)) {
  if (file === 'lui.project.json') continue;
  assert.deepEqual(await readFile(join(runtime, file)), await readFile(join(adapter, file)), file);
}
let designs = 0, bindings = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.name.endsWith('.lui')) {
      const text = await readFile(file, 'utf8');
      const migration = spec.migrateAlignmentAxes(text);
      assert.equal(migration.changes, 0, file + ': unmigrated alignment');
      bindings += migration.bindings.length;
      assert.deepEqual(spec.parseLui(text).diagnostics.filter(d => d.severity === 'error'), [], file);
      designs++;
    }
  }
}
await visit(join(project, 'scripts/Presentation'));
console.log(JSON.stringify({ version: manifest.version, contract: manifest.layoutContract, runtimeBytesMatch: true, designs, remainingMigrations: 0, alignmentBindingsToAudit: bindings }, null, 2));
