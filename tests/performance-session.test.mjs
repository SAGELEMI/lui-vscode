import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns } from '../scripts/compare-performance-sessions.mjs';

function report(run, p95 = 10, p99 = 20, memory = 100) {
  return { schemaVersion: 1, kind: 'LUI.PerformanceSession', scene: 'fixture-scroll', device: 'synthetic-device',
    workload: 'same-seed-and-operations', run, stopped: true, source: 'Update.TimeStep', identityChanged: false,
    identity: { viewport: { width: 390, height: 844, dpr: 3, scale: 1 }, fonts: [{ family: 'sans', weight: 'normal', resource: 'Fonts/a.ttf', sha256: 'b'.repeat(64) }],
      runtime: { version: 'fixture', layoutContract: 'fixture', manifestHash: 'a'.repeat(64) } },
    sampling: { warmupFrames: 120, maxSamples: 3600, memoryEveryFrames: 120, window: 'latest bounded frames' },
    summary: { sampleCount: 300, p95Milliseconds: p95, p99Milliseconds: p99, peakLuaKiB: memory, invalidFrames: 0 },
    markers: [{ label: 'scroll' }], droppedMarkers: 0 };
}
const baseline = () => [report('1'), report('2'), report('3')];

test('performance comparison uses medians of three rounds and allows changed runtime versions', () => {
  const candidate = [report('1', 9, 18), report('2', 10, 20), report('3', 100, 200)];
  candidate.forEach(value => { value.identity.runtime.version = 'candidate'; value.identity.runtime.manifestHash = 'c'.repeat(64); });
  const result = compareRuns(baseline(), candidate);
  assert.equal(result.status, 'pass');
  assert.equal(result.metrics.p95Milliseconds.candidateMedian, 10);
});

test('regression warning is strictly above 10 percent, including Lua memory', () => {
  assert.equal(compareRuns(baseline(), [report('1', 11, 22, 110), report('2', 11, 22, 110), report('3', 11, 22, 110)]).status, 'pass');
  const result = compareRuns(baseline(), [report('1', 11.1, 20, 111), report('2', 11.1, 20, 111), report('3', 11.1, 20, 111)]);
  assert.equal(result.status, 'regression');
  assert.deepEqual(result.regressions, ['p95Milliseconds', 'peakLuaKiB']);
});

test('comparison rejects missing/short/repeated runs and mismatched scenario conditions', () => {
  assert.equal(compareRuns(baseline().slice(0, 2), baseline()).status, 'incomparable');
  const repeated = baseline(); repeated[1].run = '1';
  assert.equal(compareRuns(repeated, baseline()).status, 'incomparable');
  for (const mutate of [
    value => { value.stopped = false; }, value => { value.identityChanged = true; },
    value => { value.device = 'unspecified'; }, value => { value.summary.sampleCount = 29; },
    value => { value.summary.invalidFrames = 1; }, value => { value.identity.viewport.dpr = 2; },
    value => { value.identity.fonts[0].sha256 = 'e'.repeat(64); }, value => { value.sampling.warmupFrames = 30; },
    value => { value.markers = [{ label: 'tap' }]; }, value => { value.droppedMarkers = 1; },
  ]) {
    const candidate = baseline(); mutate(candidate[1]);
    assert.equal(compareRuns(baseline(), candidate).status, 'incomparable');
  }
});

test('external renderer load stays separate from process CPU and compares only matching sources', () => {
  const attach = (reports, busy) => reports.map(report => ({ ...report, externalMetrics: {
    source: 'CDP.Performance.getMetrics', scope: 'browser-renderer-main-thread', elapsedMilliseconds: 5000,
    environment: { browser: 'fixture' }, rendererMainThreadBusyPercent: busy, jsHeapUsedBytes: 1000,
  } }));
  const before = attach(baseline(), 20), after = attach(baseline(), 23);
  assert.deepEqual(compareRuns(before, after).regressions, ['rendererMainThreadBusyPercent']);
  assert.equal(compareRuns(before, baseline()).status, 'incomparable');
  after[0].externalMetrics.processCpuPercent = 10;
  assert.equal(compareRuns(before, after).status, 'incomparable');
});

test('externally acquired OS process CPU requires explicit normalization', () => {
  const reports = baseline().map(report => ({ ...report, externalMetrics: { source: 'test-harness/os-process', scope: 'os-process',
    elapsedMilliseconds: 5000, processCpuPercent: 12, processResidentBytes: 1000, cpuNormalization: 'all-logical-cores', logicalCpuCount: 8 } }));
  assert.equal(compareRuns(reports, reports).status, 'pass');
  delete reports[1].externalMetrics.cpuNormalization;
  assert.equal(compareRuns(reports, reports).status, 'incomparable');
});

test('dedicated browser process CPU accepts stable endpoints and rejects missing processes', () => {
  const reports = baseline().map(report => ({ ...report, externalMetrics: { source: 'CDP.SystemInfo.getProcessInfo', scope: 'browser-process-group',
    elapsedMilliseconds: 5000, processCpuPercent: 3, rendererMainThreadBusyPercent: 40,
    cpuNormalization: 'all-logical-cores', logicalCpuCount: 20, processSetChanged: false } }));
  assert.equal(compareRuns(reports, reports).status, 'pass');
  reports[1].externalMetrics.processSetChanged = true;
  assert.equal(compareRuns(reports, reports).status, 'incomparable');
});

test('actual-file sidecar may supplement a missing manifest without rewriting declared identity', () => {
  const reports = baseline(); reports.forEach(report => { delete report.identity.runtime.manifestHash; });
  assert.equal(compareRuns(reports, reports).status, 'incomparable');
  reports.forEach(report => { report.observedRuntimeIdentity = { source: 'EnginePreviewHost.identity.json', files: { 'LUI/Runtime.lua': 'd'.repeat(64) } }; });
  const result = compareRuns(reports, reports);
  assert.equal(result.status, 'pass');
  assert.equal(result.runtimeIdentities.baseline[0].manifestHash, undefined);
  reports[0].observedRuntimeIdentity.files['LUI/Runtime.lua'] = 'invalid';
  assert.equal(compareRuns(reports, reports).status, 'incomparable');
});
