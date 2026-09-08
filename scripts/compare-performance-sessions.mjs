// Compare three explicitly acquired baseline runs with three candidate runs.
// This reads exported reports only; it never starts device sampling.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const median = values => [...values].sort((a, b) => a - b)[1];
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const signature = report => JSON.stringify(canonical({
  scene: report.scene, device: report.device, workload: report.workload, source: report.source,
  viewport: report.identity?.viewport, fonts: report.identity?.fonts,
  sampling: report.sampling, sampleCount: report.summary?.sampleCount,
  operations: report.markers?.map(marker => marker.label) ?? [],
  external: report.externalMetrics ? { source: report.externalMetrics.source, scope: report.externalMetrics.scope,
    cpuNormalization: report.externalMetrics.cpuNormalization, logicalCpuCount: report.externalMetrics.logicalCpuCount,
    environment: report.externalMetrics.environment, fields: externalFields.filter(field => report.externalMetrics[field] != null) } : null,
}));

const externalFields = ['rendererMainThreadBusyPercent', 'jsHeapUsedBytes', 'processCpuPercent', 'processResidentBytes'];
const observedIdentity = report => {
  const observed = report.observedRuntimeIdentity;
  if (observed?.source !== 'EnginePreviewHost.identity.json' || !observed.files || Array.isArray(observed.files)) return false;
  if (!/^[a-f0-9]{64}$/i.test(observed.files['LUI/Runtime.lua'] ?? '')) return false;
  return Object.entries(observed.files).every(([path, hash]) => /^LUI\/[\w-]+\.lua$/.test(path) && /^[a-f0-9]{64}$/i.test(hash));
};

export function compareRuns(baselines, candidates, thresholdPercent = 10) {
  const reasons = [];
  if (!Array.isArray(baselines) || baselines.length !== 3 || !Array.isArray(candidates) || candidates.length !== 3) {
    return { status: 'incomparable', reasons: ['Exactly three baseline and three candidate runs are required.'] };
  }
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) return { status: 'incomparable', reasons: ['The threshold must be a finite nonnegative percentage.'] };
  const all = [...baselines, ...candidates];
  all.forEach((report, index) => {
    const label = `${index < 3 ? 'baseline' : 'candidate'} ${index % 3 + 1}`;
    if (!report || report.kind !== 'LUI.PerformanceSession' || report.schemaVersion !== 1) { reasons.push(`${label}: unsupported report.`); return; }
    if (!report.stopped) reasons.push(`${label}: stop the session before comparison.`);
    if (report.identityChanged) reasons.push(`${label}: viewport/font/runtime identity changed while sampling.`);
    if (report.source !== 'Update.TimeStep') reasons.push(`${label}: unsupported frame interval source.`);
    for (const field of ['scene', 'device', 'workload', 'run']) {
      if (typeof report[field] !== 'string' || !report[field] || report[field] === 'unspecified') reasons.push(`${label}: ${field} must be identified.`);
    }
    if (!Number.isInteger(report.summary?.sampleCount) || report.summary.sampleCount < 30) reasons.push(`${label}: at least 30 captured frames are required.`);
    if (report.summary?.invalidFrames) reasons.push(`${label}: invalid frame samples were observed.`);
    if (report.droppedMarkers) reasons.push(`${label}: operation markers were dropped.`);
    if (report.externalMetrics) {
      const external = report.externalMetrics;
      if (typeof external.source !== 'string' || !external.source || !['browser-renderer-main-thread', 'browser-process-group', 'os-process'].includes(external.scope)) reasons.push(`${label}: external CPU/memory source and scope must be identified.`);
      if (!Number.isFinite(external.elapsedMilliseconds) || external.elapsedMilliseconds <= 0) reasons.push(`${label}: external sample duration is unavailable.`);
      if (external.scope !== 'browser-renderer-main-thread' && (!['one-core', 'all-logical-cores'].includes(external.cpuNormalization) || !Number.isInteger(external.logicalCpuCount) || external.logicalCpuCount < 1)) reasons.push(`${label}: process CPU normalization and logical CPU count must be identified.`);
      for (const field of externalFields) if (external[field] != null && (!Number.isFinite(external[field]) || external[field] < 0)) reasons.push(`${label}: external ${field} must be finite and nonnegative.`);
      if (external.scope === 'browser-renderer-main-thread' && (external.processCpuPercent != null || external.processResidentBytes != null)) reasons.push(`${label}: CDP renderer task metrics cannot claim OS process CPU or resident memory.`);
      if (external.processSetChanged) reasons.push(`${label}: sampled process group changed; CPU endpoint totals are incomplete.`);
    }
    for (const field of ['p95Milliseconds', 'p99Milliseconds']) {
      if (!Number.isFinite(report.summary?.[field]) || report.summary[field] <= 0) reasons.push(`${label}: ${field} is unavailable.`);
    }
    for (const field of ['width', 'height', 'dpr', 'scale']) {
      if (!Number.isFinite(report.identity?.viewport?.[field]) || report.identity.viewport[field] <= 0) reasons.push(`${label}: viewport ${field} is unavailable.`);
    }
    if (!report.identity?.runtime?.version || !report.identity.runtime.layoutContract || (!/^[a-f0-9]{64}$/i.test(report.identity.runtime.manifestHash ?? '') && !observedIdentity(report))) reasons.push(`${label}: declared runtime identity is incomplete; an explicit actual-file identity sidecar may supply provenance.`);
    if (report.observedRuntimeIdentity && !observedIdentity(report)) reasons.push(`${label}: invalid actual-file identity sidecar.`);
    if (!Array.isArray(report.identity?.fonts) || report.identity.fonts.some(font => !/^[a-f0-9]{64}$/i.test(font.sha256 ?? ''))) reasons.push(`${label}: declared font hashes are incomplete.`);
  });
  for (const [label, reports] of [['baseline', baselines], ['candidate', candidates]]) {
    if (new Set(reports.map(report => report?.run)).size !== 3) reasons.push(`${label}: use three distinct run identifiers.`);
  }
  if (reasons.length) return { status: 'incomparable', reasons };
  const expected = signature(all[0]);
  if (all.some(report => signature(report) !== expected)) return { status: 'incomparable', reasons: ['Scene, device, workload, viewport/DPR/scale, declared fonts, sampling window and operation markers must match across all six runs.'] };
  const metrics = {};
  const summaryFields = ['p95Milliseconds', 'p99Milliseconds', 'peakLuaKiB', 'over120BudgetRatio', 'over60BudgetRatio'];
  for (const field of [...summaryFields, ...externalFields]) {
    const read = report => summaryFields.includes(field) ? report.summary[field] : report.externalMetrics?.[field];
    const before = baselines.map(read);
    const after = candidates.map(read);
    if (![...before, ...after].every(value => Number.isFinite(value) && value >= 0)) {
      metrics[field] = { available: false };
      continue;
    }
    const baseline = median(before), candidate = median(after);
    const increasePercent = baseline > 0 ? (candidate / baseline - 1) * 100 : candidate > 0 ? null : 0;
    const tolerance = Number.EPSILON * Math.max(1, baseline, candidate) * 8;
    const regression = candidate > baseline * (1 + thresholdPercent / 100) + tolerance;
    metrics[field] = { available: true, baselineMedian: baseline, candidateMedian: candidate, increasePercent, regression };
  }
  const regressions = Object.entries(metrics).filter(([, value]) => value.regression).map(([key]) => key);
  return { status: regressions.length ? 'regression' : 'pass', scene: all[0].scene, device: all[0].device, workload: all[0].workload,
    thresholdPercent, aggregation: 'median of three per-run summaries', metrics, regressions,
    runtimeIdentities: { baseline: baselines.map(report => report.identity.runtime), candidate: candidates.map(report => report.identity.runtime) },
    observedRuntimeIdentities: { baseline: baselines.map(report => report.observedRuntimeIdentity ?? null), candidate: candidates.map(report => report.observedRuntimeIdentity ?? null) },
    limitations: ['Update.TimeStep is an engine-reported frame interval, not a CPU/GPU profiler.',
      'Work spans use the clock identified in each report: native monotonic millisecond wall time by default, or an explicitly labeled platform-dependent fallback; they are not process CPU percentage.',
      'CDP TaskDuration / elapsed time measures browser renderer main-thread busy ratio; JS heap excludes WASM linear memory, GPU and native process memory.',
      'OS process CPU and resident memory are accepted only when supplied by an external harness with an identified source and CPU normalization; this comparator does not measure them.',
      'Runtime/font hashes are declared identities; actual file bytes are verified separately at build/deployment.'] };
}

async function main(args) {
  const baseline = [], candidate = [];
  let target, threshold = 10;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--baseline') target = baseline;
    else if (value === '--candidate') target = candidate;
    else if (value === '--threshold') threshold = Number(args[++index]);
    else if (value.startsWith('--') || !target) throw new Error('Usage: node scripts/compare-performance-sessions.mjs --baseline b1.json b2.json b3.json --candidate c1.json c2.json c3.json [--threshold 10]');
    else target.push(value);
  }
  const read = files => Promise.all(files.map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const result = compareRuns(await read(baseline), await read(candidate), threshold);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'pass' ? 0 : result.status === 'regression' ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
