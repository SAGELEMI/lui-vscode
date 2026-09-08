// One bounded, explicit engine microbenchmark. It measures warm resource require
// overhead; it does not produce frame-rate or process CPU acceptance claims.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { EnginePreviewHost } = require('../dist/enginePreviewHost.cjs');
assert.ok(process.argv[2], 'Usage: node scripts/test-engine-module-cache.mjs <game> [output-directory]');
const game = resolve(process.argv[2]), output = resolve(process.argv[3] || 'artifacts/engine-module-cache');
const adapter = resolve(process.env.LUI_MICRO_ADAPTER || 'packages/runtime-urhox-lua/adapter');
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile(resolve(game, 'scripts/LUI/lui.project.json'), 'utf8'));
const fonts = config.fonts.map(family => ({ family: family.family, weights: Object.fromEntries(Object.entries(family.weights).map(([weight, font]) => [weight, font.resource])) }));
const files = [];
for (const family of config.fonts) for (const font of Object.values(family.weights)) files.push({ path: font.resource, sha256: font.sha256, bytes: await readFile(resolve(game, 'assets', font.resource)) });
const host = new EnginePreviewHost();
await host.start(resolve('artifacts/engine-cache'), adapter, files);
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || 'msedge', headless: true });
const report = { kind: 'LUI.WarmModuleRequireMicrobenchmark', adapter, samples: [], errors: [],
  scope: 'one real browser engine VM; alternating order of cached-module versus warm resource require access; no forced GC',
  limitations: ['Batch timings use Lua os.clock and native system-time clock; their clock resolution limits small differences.',
    'This synchronous microbenchmark is not a frame-cadence or process-CPU comparison and cannot attribute all hidden-scene overhead.'] };
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(host.url).origin ? route.continue() : route.abort());
  await page.addInitScript(() => { window.__moduleCache = null; window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.name === 'module-cache-result') window.__moduleCache = event.data.payload;
  }); });
  host.update({ revision: Date.now(), width: 390, height: 844, theme: config.theme, fonts,
    node: { kind: 'Element', tag: 'lui:Page', attrs: { Width: '390', Height: '844' }, children: [], sourcePath: 'ModuleCache.lui', nodePath: '0' } });
  await page.goto(host.url);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('已绘制'), { timeout: 60000 });
  const source = `local function emit(value)local event=VariantMap();event['name']='module-cache-result';event['payload']=cjson.encode(value);SendEvent('EmitToPlugin',event)end
local ok,result=xpcall(function()
 local Budget=require('LUI.MeasureBudget');local Refresh=require('LUI.Refresh');local owner={};local clock=Budget.Clock();local samples={}
 local variants={
  {name='budget-get',cached=function()return Budget.Get(owner)end,loaded=function()return require('LUI.MeasureBudget').Get(owner)end},
  {name='refresh-function',cached=function()return Refresh.Subtree end,loaded=function()return require('LUI.Refresh').Subtree end}}
 for _,variant in ipairs(variants)do
  assert(variant.cached()==variant.loaded(),'require must return the cached module identity')
  for i=1,1000 do variant.cached();variant.loaded()end
  for round=1,5 do
   local order=round%2==1 and {'cached','loaded'}or {'loaded','cached'}
   for _,kind in ipairs(order)do
    local callback=variant[kind];local cpuStart,wallStart=os.clock(),clock();local sink
    for i=1,20000 do sink=callback()end
    samples[#samples+1]={name=variant.name,mode=kind,round=round,iterations=20000,osClockMilliseconds=(os.clock()-cpuStart)*1000,systemClockMilliseconds=(clock()-wallStart)*1000,valid=sink~=nil}
   end
  end
 end
 return {luaVersion=_VERSION,samples=samples}
end,debug.traceback)
if ok then emit(result)else emit({error=tostring(result)})end`;
  await writeFile(resolve(output, 'fixture.lua'), source);
  await page.evaluate(source => document.querySelector('iframe').contentWindow.postMessage({ source: 'tap-plugin-host', kind: 'event', name: 'RunLuaSource', payload: { source } }, location.origin), source);
  await page.waitForFunction(() => window.__moduleCache, { timeout: 15000 });
  const result = await page.evaluate(() => window.__moduleCache);
  assert.ok(!result.error, result.error); assert.deepEqual(report.errors, []);
  Object.assign(report, result);
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.summary = {};
  for (const name of ['budget-get', 'refresh-function']) {
    const micros = mode => median(report.samples.filter(sample => sample.name === name && sample.mode === mode).map(sample => sample.systemClockMilliseconds * 1000 / sample.iterations));
    report.summary[name] = { cachedMicroseconds: micros('cached'), loadedMicroseconds: micros('loaded'), differenceMicroseconds: micros('loaded') - micros('cached') };
  }
  report.summaryClock = { source: 'native system time', units: 'microseconds per operation derived from 20000-operation wall-time batches',
    osClockAdvanced: report.samples.some(sample => sample.osClockMilliseconds > 0),
    note: 'A flat os.clock is retained as a raw observation, not interpreted as zero work. This is elapsed wall time, not CPU time.' };
  report.identity = await (await fetch(host.url + 'identity.json')).json();
  console.log(JSON.stringify({ luaVersion: report.luaVersion, summary: report.summary, samples: report.samples }));
  await page.close();
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); host.dispose();
}
