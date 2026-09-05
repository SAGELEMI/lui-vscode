// Runs the production Webview HTML/CSS/bundle in Chromium, with only the
// VS Code message transport stubbed. Set PLAYWRIGHT_MODULE if not installed locally.
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import spec from '../dist/spec.cjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = process.env.LUI_GAME_PROJECT;
assert.ok(project, 'Set LUI_GAME_PROJECT to the project containing Presentation fixtures');
const extension = await readFile('src/extension.ts', 'utf8');
let html = extension.slice(extension.indexOf('return `<!doctype html>') + 8);
html = html.slice(0, html.indexOf('`;'));
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replaceAll('${css}', '/media/preview.css').replaceAll('${designer}', '/media/designer.js')
  .replaceAll('${nonce}', 'fixture')
  .replace('<head>', '<head><script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m)});</script>');
const server = createServer(async (req, res) => {
  const path = req.url === '/media/designer.js' ? 'media/designer.js' : req.url === '/media/preview.css' ? 'media/preview.css' : undefined;
  res.setHeader('Content-Type', path?.endsWith('.js') ? 'text/javascript' : path ? 'text/css' : 'text/html');
  res.end(path ? await readFile(path) : html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: process.env.LUI_BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1560, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const serialize = (node, source, nodePath = []) => ({ ...node, start: node.range.start, end: node.range.end, source, nodePath,
  displayName: spec.displayNameOf(node), attrs: Object.fromEntries(node.attrs.map(a => [a.name, a.value])),
  children: node.children.map((child, index) => serialize(child, source, [...nodePath, index])) });
const sources = {}, catalog = { 'Presentation/Components': {} };
async function load(relative) {
  const source = relative;
  const text = (await readFile(resolve(project, 'scripts', relative), 'utf8')).replace(/\r\n/g, '\n');
  const parsed = spec.parseLui(text);
  sources[source] = { source, version: 1, text, displayPath: source, diagnostics: parsed.diagnostics };
  const root = serialize(parsed.root, source);
  try { Object.assign(root, spec.readComponentProperties(await readFile(resolve(project, 'scripts', relative + '.lua'), 'utf8'))); } catch {}
  return root;
}
for (const file of await readdir(resolve(project, 'scripts/Presentation/Components'))) {
  if (!file.endsWith('.lui')) continue;
  const root = await load(`Presentation/Components/${file}`);
  catalog['Presentation/Components'][root.attrs['名称']] = root;
  if (root.attrs['副名称']) catalog['Presentation/Components'][root.attrs['副名称']] = root;
}
async function open(relative, custom) {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
  const root = custom ? serialize(spec.parseLui(custom).root, relative) : await load(relative);
  if (custom) sources[relative] = { source: relative, version: 1, text: custom, displayPath: relative, diagnostics: [] };
  await page.evaluate(payload => window.postMessage(payload, '*'), { type: 'model', generation: 1,
    model: { root, diagnostics: [] }, catalog, sources, rootSource: relative, device: '390x844', completionImports: [], actionSymbols: {} });
  await page.waitForSelector('#canvas > .lui-node');
  await settle();
  assert.equal((await sizes()).zoom, '100%', 'Every new Webview starts at 100%');
}
async function settle() { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function sizes() { return page.evaluate(() => {
  const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  return { body: rect('design-workbench'), left: rect('outline-panel'), stage: rect('stage'), right: rect('inspector'), source: rect('source-panel'),
    canvas: [document.getElementById('canvas').offsetWidth, document.getElementById('canvas').offsetHeight], zoom: document.getElementById('zoom-value').textContent,
    window: innerWidth, overflow: document.documentElement.scrollWidth };
}); }
async function bounds() {
  const s = await sizes();
  assert.equal(s.overflow, s.window); assert.equal(s.body.width, s.window);
  assert.ok(s.left.right <= s.stage.x + 1); assert.ok(s.stage.right <= s.right.x + 1); assert.ok(s.right.right <= s.window + 1);
  assert.equal(s.source.width, s.window); return s;
}
const results = [];
try {
  await open('Presentation/Components/Header.lui');
  assert.equal(await page.locator('#device-label').isVisible(), false);
  let initial = await bounds(); assert.ok(initial.canvas[0] >= 250); assert.equal(initial.canvas[1], 40);
  for (let i = 0; i < 10; i++) {
    await page.click('#outline-collapse'); await page.click('#collapse'); await settle();
    let s = await bounds(); assert.equal(s.left.width, 28); assert.equal(s.right.width, 28);
    await page.click('#outline-collapse'); await page.click('#collapse'); await settle();
    s = await bounds(); assert.equal(s.left.width, 280); assert.equal(s.right.width, 288); assert.equal(s.zoom, initial.zoom);
  }
  results.push({ test: 'Header and 10 sidebar round trips', ...await sizes() });
  await page.setViewportSize({ width: 700, height: 650 }); await settle(); await bounds();
  await page.click('#collapse'); await page.click('#outline-collapse'); await page.setViewportSize({ width: 1560, height: 900 }); await settle();
  await page.click('#collapse'); await page.click('#outline-collapse'); await settle(); assert.equal((await bounds()).left.width, 280);
  await open('Presentation/Components/InformationPanel.lui');
  assert.deepEqual((await bounds()).canvas, [340, 472]); assert.equal(await page.locator('#device-label').isVisible(), false);
  await page.click('#actual-size');
  await page.locator('#outline > .outline-row').first().click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const state = await page.evaluate(() => ({ selected: document.querySelector('#canvas .is-selected')?.dataset.nodePath,
    anchor: window.getSelection()?.anchorOffset, focus: window.getSelection()?.focusOffset }));
  for (const id of ['source-maximize', 'source-collapse']) { await page.click(`#${id}`); await page.click(`#${id}`); await settle(); }
  const divider = await page.locator('#splitter').boundingBox();
  await page.mouse.move(500, divider.y + 3); await page.mouse.down(); await page.mouse.move(500, 420); await page.mouse.up(); await settle();
  assert.equal((await bounds()).zoom, '100%');
  assert.deepEqual(await page.evaluate(() => ({ selected: document.querySelector('#canvas .is-selected')?.dataset.nodePath,
    anchor: window.getSelection()?.anchorOffset, focus: window.getSelection()?.focusOffset })), state);
  results.push({ test: 'InformationPanel, source toggles and divider preserve selection', ...await sizes() });
  await mkdir('artifacts', { recursive: true });
  await page.click('#fit'); await settle();
  await page.screenshot({ path: 'artifacts/workspace-2.3.1-component.png' });
  await open('Presentation/Pages/Loadout.lui');
  assert.deepEqual((await bounds()).canvas, [390, 844]); assert.equal(await page.locator('#device-label').isVisible(), true);
  await page.click('#actual-size');
  const pageScale = await page.locator('.page-root').getAttribute('data-page-scale');
  for (let i = 0; i < 20; i++) await page.click('#zoom-in');
  await settle(); assert.equal((await bounds()).zoom, '6400%');
  assert.equal(await page.locator('.page-root').getAttribute('data-page-scale'), pageScale);
  await page.locator('#stage').evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
  assert.ok(await page.locator('#stage').evaluate(el => el.scrollLeft > 1000 && el.scrollTop > 1000));
  const beforePan = await page.locator('#stage').evaluate(el => el.scrollLeft);
  const stageBox = await page.locator('#stage').boundingBox();
  await page.mouse.move(stageBox.x + 100, stageBox.y + 100);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(stageBox.x + 200, stageBox.y + 200); await page.mouse.up({ button: 'middle' });
  assert.ok(await page.locator('#stage').evaluate((el, before) => el.scrollLeft < before, beforePan));
  results.push({ test: 'Loadout 6400% isolated zoom and bottom-right scrolling', ...await sizes() });
  await page.click('#fit'); await settle(); await bounds();
  await page.screenshot({ path: 'artifacts/workspace-2.3.1-page.png' });
  await open('rounded.lui', '<控件 名称="Rounded" 宽度="250" 高度="120"><按钮 文本="按钮" 圆角="16" 内边距="8" 裁剪超出="是" /></控件>');
  await page.locator('#canvas [data-node-path="0"]').click(); await settle();
  assert.equal(await page.locator('.selection-rectangle').last().evaluate(el => getComputedStyle(el).borderRadius), '0px');
  assert.equal(await page.locator('#selection-overlay').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  assert.notEqual(await page.locator('#canvas [data-node-path="0"]').evaluate(el => getComputedStyle(el).borderRadius), '0px');
  await page.click('#zoom-in'); await settle();
  assert.equal((await sizes()).zoom, '125%');
  await page.setViewportSize({width:1300,height:800}); await settle();
  assert.equal((await sizes()).zoom, '125%');
  await open('long.lui', `<控件 名称="Long" 宽度="250" 高度="40"><文本 文本="${'长'.repeat(3000)}" /></控件>`);
  await bounds(); assert.ok(await page.locator('.cm-scroller').evaluate(el => el.scrollWidth > el.clientWidth));
  await open('auto.lui', '<控件 名称="Auto" 最小宽度="250" 最大宽度="400"><容器 宽度="100%" 高度="100%"><文本 文本="内容测量" 高度="60" /></容器></控件>');
  assert.deepEqual((await bounds()).canvas, [250, 60]);
  await open('max.lui', '<控件 名称="Max" 宽度="600" 最大宽度="400" 高度="20" 最小高度="40"><容器 宽度="100%" 高度="100%" /></控件>');
  assert.deepEqual((await bounds()).canvas, [400, 40]);
  for (let i = 0; i < 40; i++) await page.click('#zoom-out');
  assert.equal((await bounds()).zoom, '5%');
  await page.setViewportSize({width:1560,height:900});
  for (const [name, labels] of [['Warehouse',['全部','武器','护甲','被动','消耗']], ['Talents',['全部','未解锁','已解锁','已满级']], ['FloorRewards',[]]]) {
    await open('Presentation/Pages/'+name+'.lui');
    assert.deepEqual((await bounds()).canvas,[390,844]);
    for (const label of labels) assert.ok((await page.locator('#canvas').innerText()).includes(label),name+': '+label);
    assert.equal(await page.locator('#canvas .scroll:visible').count(),2,'Information text and list scroll independently');
    const frame=await page.locator('#canvas').evaluate(el=>{
      const root=el.getBoundingClientRect();
      return [...el.querySelectorAll('.scroll')].filter(n=>n.getClientRects().length && getComputedStyle(n).display!=='none').map(n=>{const r=n.getBoundingClientRect(); return {w:r.width,h:r.height,right:r.right-root.left,bottom:r.bottom-root.top};});
    });
    assert.ok(frame.every(r=>r.w>0 && r.h>0 && r.right<=391 && r.bottom<=845),JSON.stringify({name,frame}));
    await page.click('#fit'); await settle();
    await page.locator('#canvas').screenshot({path:'artifacts/page-2.4.2-'+name+'.png'});
    results.push({test:name+' category preview and fill bounds',frame});
  }
  for (const [name, expected] of [['SelectionList', [340,220]], ['TabView',[340,262]]]) {
    await open('Presentation/Components/' + name + '.lui');
    assert.deepEqual((await bounds()).canvas, expected);
    assert.equal(await page.locator('#canvas .scroll:visible').count(), 1, 'Exactly one list scroll region');
    assert.ok(await page.locator('#canvas').innerText().then(t => t.includes('列表标题') && t.includes('物品名称') && !t.includes('背包为空')));
    if (name === 'TabView') {
      assert.equal(await page.locator('#canvas .button').count(), 3, 'Two preview tabs and one sample data row');
      const tabs = await page.locator('#canvas .button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
      assert.ok(Math.abs(tabs[0]-tabs[1]) < 1);
    }
    await page.mouse.move(0,0);
    await page.locator('#canvas').screenshot({path:'artifacts/list-2.4.2-' + name + '.png'});
    results.push({test: name + ' reference structure', ...await sizes()});
  }
  const listFixture = (await readFile(resolve(project,'scripts/Presentation/Components/SelectionList.lui'),'utf8'))
    .replace("view.empty, 模式=单向, 更新源触发=默认, 预览内容='是'", "view.empty, 模式=单向, 更新源触发=默认, 预览内容='否'")
    .replace(/预览内容='\[[^']*\]'/, `预览内容='${JSON.stringify(Array.from({length:20},(_,i)=>({key:String(i),label:'条目'+i,description:i?'':'双行说明',hasDescription:i===0,disabled:i===1,background:'#25183a',border:'#352446'}))).replaceAll('"','&quot;')}'`);
  await open('empty.lui',listFixture.replace(/预览内容='\[[^']*\]'/,"预览内容='[]'"));
  assert.equal(await page.locator('#canvas .scroll').innerText(),'');
  assert.equal(await page.locator('#canvas .button').count(),0);
  await page.locator('#canvas').screenshot({path:'artifacts/list-2.4.2-empty.png'});
  await open('rows.lui',listFixture);
  assert.equal(await page.locator('#canvas .button').count(),20);
  assert.ok((await page.locator('#canvas .button').first().innerText()).includes('双行说明'));
  const scroll = page.locator('#canvas .scroll');
  assert.ok(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight));
  await scroll.hover(); await page.mouse.wheel(0,200);
  await page.waitForFunction(()=>document.querySelector('#canvas .scroll').scrollTop>0);
  await scroll.evaluate(el=>el.scrollTop=0);
  const sb=await scroll.boundingBox();
  await page.mouse.move(sb.x+sb.width-4,sb.y+8); await page.mouse.down();
  await page.mouse.move(sb.x+sb.width-4,sb.y+sb.height-15,{steps:10}); await page.mouse.up();
  assert.ok(await scroll.evaluate(el=>el.scrollTop>0),'Scrollbar drag remains available');
  results.push({test:'20 rows, optional second line, wheel and scrollbar drag',passed:true});
  await open('box.lui','<控件 名称="Box" 宽度="340" 高度="220" 外边距="12345,12,9876,24" 内边距="8,16,24,32"><容器 /></控件>');
  await page.locator('#outline > .outline-row').first().click(); await settle();
  await page.locator('.layout-result').scrollIntoViewIfNeeded();
  await page.locator('.layout-result').evaluate(el => el.style.width='198px');
  const diagram = await page.locator('.layout-result').evaluate(el => {
    const leaves = [...el.querySelectorAll('.box-model-caption,.box-model-edge,.box-model-content,.box-model-coordinate')].map(n=>({text:n.textContent,r:n.getBoundingClientRect()}));
    const overlaps=[];
    for(let i=0;i<leaves.length;i++) for(let j=i+1;j<leaves.length;j++){
      const a=leaves[i].r,b=leaves[j].r;
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5) overlaps.push([leaves[i].text,leaves[j].text]);
    }
    return {overlaps,select:getComputedStyle(el).userSelect,width:el.clientWidth,scroll:el.scrollWidth};
  });
  assert.deepEqual(diagram.overlaps,[]); assert.equal(diagram.select,'none'); assert.equal(diagram.width,diagram.scroll);
  await page.evaluate(()=>window.getSelection().removeAllRanges());
  const diagramBox=await page.locator('.layout-result').boundingBox();
  await page.mouse.move(diagramBox.x+10,diagramBox.y+10); await page.mouse.down();
  await page.mouse.move(diagramBox.x+diagramBox.width-10,diagramBox.y+diagramBox.height-10,{steps:8}); await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),'');
  await page.locator('.layout-result').screenshot({path:'artifacts/layout-result-2.4.2.png'});
  assert.notEqual(await page.locator('.cm-content').evaluate(el=>getComputedStyle(el).userSelect),'none');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); server.close(); }
