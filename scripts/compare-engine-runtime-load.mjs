import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareRuns } from './compare-performance-sessions.mjs';

if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/compare-engine-runtime-load.mjs <baseline-directory> <candidate-directory> [output.json]');
const [baselineDirectory, candidateDirectory] = process.argv.slice(2, 4).map(path => resolve(path));
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const baselineReport = await read(resolve(baselineDirectory, 'report.json'));
const candidateReport = await read(resolve(candidateDirectory, 'report.json'));
const available = new Set(candidateReport.sessions.map(session => session.scene));
const scenes = ['empty-ui-300', 'hidden-list-300', 'static-300', 'scripted-scroll-300', 'notified-updates-200'].filter(scene => available.has(scene));
if (!['static-300', 'scripted-scroll-300', 'notified-updates-200'].every(scene => available.has(scene))) throw new Error('The three main candidate scenes are required.');
const result = { kind: 'LUI.DesktopLoadComparison', baselineDirectory, candidateDirectory,
  baselineIdentity: baselineReport.identity, candidateIdentity: candidateReport.identity,
  baselineFixture: baselineReport.fixtureHashes, candidateFixture: candidateReport.fixtureHashes,
  baselineInstrumentation: baselineReport.instrumentation || null, candidateInstrumentation: candidateReport.instrumentation || null,
  scope: 'Same desktop, browser/engine/fonts/viewport/1000 deterministic rows and operations; saved 2.6 implementation versus current source. Empty/hidden are attribution controls.',
  limitations: ['Browser process-group CPU is normalized over the reported logical CPU count; it is not whole-machine CPU or phone temperature.',
    'Frame cadence is capped by the desktop/headless display; strict 120/60 interval exceedance includes timing jitter.',
    'End-of-window JS heap includes natural GC timing and excludes WASM/native/GPU memory. A heap regression is a signal for investigation, not proof of a leak.',
    'Declared manifest identity is preserved as sampled; identity.runtimeFiles separately records actual Lua resource SHA-256 values.'], results: {} };
for (const scene of scenes) {
  const load = async directory => {
    const evidence = directory === baselineDirectory ? baselineReport : candidateReport;
    const files = Object.fromEntries(Object.entries({ ...evidence.identity?.runtimeFiles, ...evidence.injectedMeasurementFiles }).filter(([path]) => /^LUI\/[\w-]+\.lua$/.test(path)));
    const observedRuntimeIdentity = { source: 'EnginePreviewHost.identity.json', report: resolve(directory, 'report.json'), files,
      scope: 'actual resource bytes recorded by the isolated engine host; supplements missing/stale declared manifest identity without rewriting session history' };
    return Promise.all([1, 2, 3].map(async run => ({ ...await read(resolve(directory, `${scene}-run${run}.json`)), observedRuntimeIdentity })));
  };
  result.results[scene] = compareRuns(await load(baselineDirectory), await load(candidateDirectory));
}
const output = resolve(process.argv[4] || resolve(candidateDirectory, 'comparison.json'));
await writeFile(output, JSON.stringify(result, null, 2));
for (const [scene, comparison] of Object.entries(result.results)) console.log(JSON.stringify({ scene, status: comparison.status,
  reasons: comparison.reasons, regressions: comparison.regressions, metrics: comparison.metrics }));
process.exitCode = Object.values(result.results).some(value => value.status === 'incomparable') ? 1
  : Object.values(result.results).some(value => value.status === 'regression') ? 2 : 0;
