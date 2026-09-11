// Real-engine contract for the Runtime-owned LUI Navigator.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { EnginePreviewHost } = require('../dist/enginePreviewHost.cjs');
assert.ok(process.argv[2], 'Usage: node scripts/test-engine-navigator.mjs <game> [output-directory]');
const game = resolve(process.argv[2]);
const output = resolve(process.argv[3] || 'artifacts/engine-navigator');
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile(resolve(game, 'scripts/LUI/lui.project.json'), 'utf8'));
const fonts = config.fonts.map(family => ({ family: family.family, weights: Object.fromEntries(Object.entries(family.weights).map(([weight, font]) => [weight, font.resource])) }));
const files = [];
for (const family of config.fonts) for (const font of Object.values(family.weights)) {
  files.push({ path: font.resource, sha256: font.sha256, bytes: await readFile(resolve(game, 'assets', font.resource)) });
}
const host = new EnginePreviewHost();
await host.start(resolve('artifacts/engine-cache'), resolve('packages/runtime-urhox-lua/adapter'), files);
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || 'msedge', headless: true });
const report = { kind: 'LUI.RealEngineNavigator', cases: [], errors: [] };
const source = `local function emit(value)local event=VariantMap();event['name']='navigator-result';event['payload']=cjson.encode(value);SendEvent('EmitToPlugin',event)end
local ok,err=xpcall(function()
 local UI=require('urhox-libs/UI');local Navigator=require('LUI.Navigator')
 local callbacks,created,disposed={}, {}, {}
 local runtime={}
 function runtime:_RegisterNavigator(value)self.navigator=value end
 function runtime:_UnregisterNavigator(value)if self.navigator==value then self.navigator=nil end end
 function runtime:AfterLayout(root,callback)callbacks[root]=callback;return function()callbacks[root]=nil end end
 function runtime:CreatePage(name)
  if name=='broken' then return nil,'synthetic build failure' end
  if name=='throws' then error('synthetic build exception') end
  local children={}
  if name=='hidden-list' then
   local hidden=UI.Panel{visible=false,width='100%',height='100%'}
   hidden.luiVirtualList_={model_={items_={1}},renderPending_=true,renderChildren_={}}
   children[1]=hidden
  end
  local root=UI.Panel{width='100%',height='100%',children=children}
  local instance={name=name,root_=root}
  function instance:GetRoot()return self.root_ end
  function instance:Dispose()disposed[self.name]=(disposed[self.name]or 0)+1 end
  created[name]=(created[name]or 0)+1
  return instance
 end
 local commits={};local nav=Navigator.New(runtime,{kind='page',background='#010203',onCommitted=function(name)commits[#commits+1]=name end})
 UI.SetRoot(nav:GetRoot(),true)
 local function renderPending()
  local pending=assert(nav.pending_);assert(callbacks[pending.root]);callbacks[pending.root](pending.root,0);nav:Update()
 end
 local first=assert(nav:Navigate('first'));assert(not nav:IsCurrentReady());renderPending()
 assert(nav:IsCurrentReady() and nav:GetCurrent()==first and commits[1]=='first')
 assert(nav:Navigate('first')==first and created.first==1 and nav.pending_==nil)
 local second=assert(nav:Navigate('second'));assert(nav:GetCurrent()==first and first.root_.props.pointerEvents=='box-none')
 assert(second.root_.props.pointerEvents=='none' and not disposed.first)
 renderPending();assert(nav:GetCurrent()==first and first.root_.props.pointerEvents=='none' and second.root_.props.pointerEvents=='box-none')
 renderPending();assert(nav:GetCurrent()==second and nav:IsCurrentReady() and disposed.first==1 and commits[2]=='second')
 local third=assert(nav:Navigate('third'));local fourth=assert(nav:Navigate('fourth'))
 assert(disposed.third==1 and nav:GetCurrent()==second and fourth.root_.props.pointerEvents=='none')
 assert(nav:CancelPending() and disposed.fourth==1 and nav:GetCurrent()==second and second.root_.props.pointerEvents=='box-none')
 assert(nav:CancelPending()==false)
 local failed,reason=nav:Navigate('broken');assert(not failed and reason=='synthetic build failure' and nav:GetCurrent()==second)
 local thrown,throwReason=nav:Navigate('throws');assert(not thrown and tostring(throwReason):find('synthetic build exception',1,true) and nav:GetCurrent()==second)
 local hiddenList=assert(nav:Navigate('hidden-list'));renderPending();renderPending()
 assert(nav:GetCurrent()==hiddenList and nav:IsCurrentReady() and disposed.second==1,
  'a collapsed virtual list must not keep the visible page candidate warming forever')
 nav:Dispose();assert(disposed['hidden-list']==1 and runtime.navigator==nil)
 emit({passed=true,created=created,disposed=disposed,commits=commits,cases={'initial','idempotent','atomic-swap','rapid-navigation','cancel','failure','exception','hidden-virtual-list','dispose'}})
end,debug.traceback)
if not ok then emit({passed=false,error=tostring(err)})end`;

try {
  const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(host.url).origin ? route.continue() : route.abort());
  await page.addInitScript(() => { window.__navigatorResult = null; window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.name === 'navigator-result') window.__navigatorResult = event.data.payload;
  }); });
  host.update({ revision: Date.now(), width: 390, height: 844, theme: config.theme, fonts,
    node: { kind: 'Element', tag: 'lui:Page', attrs: { Width: '390', Height: '844' }, children: [], sourcePath: 'NavigatorFixture.lui', nodePath: '0' } });
  await page.goto(host.url);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('已绘制'), undefined, { timeout: 60000 });
  await page.evaluate(lua => document.querySelector('iframe').contentWindow.postMessage({ source: 'tap-plugin-host', kind: 'event', name: 'RunLuaSource', payload: { source: lua } }, location.origin), source);
  await page.waitForFunction(() => window.__navigatorResult, undefined, { timeout: 20000 });
  const result = await page.evaluate(() => window.__navigatorResult);
  report.cases = result.cases || [];
  if (!result.passed) throw new Error(result.error || 'Navigator contract failed');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(result));
} catch (error) {
  report.passed = false; report.errors.push(error.stack || String(error)); process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); host.dispose();
}
