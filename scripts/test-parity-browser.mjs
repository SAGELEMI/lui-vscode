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
const fonts = [
  { family: 'sans', weight: '400', uri: '/fonts/MiSans-Regular.ttf', sha256: '9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6' },
  { family: 'sans', weight: '700', uri: '/fonts/MiSans-Bold.ttf', sha256: 'd0c1d327952ed935e86fb78a97a6c182b44f2c2b08777326786b1f8b26d1fe1e' },
];
const extension = await readFile('src/extension.ts', 'utf8');
let html = extension.slice(extension.indexOf('return `<!doctype html>') + 8);
html = html.slice(0, html.indexOf('`;'));
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replaceAll('${css}', '/media/preview.css').replaceAll('${designer}', '/media/designer.js')
  .replaceAll('${nonce}', 'fixture')
  .replace('<head>', '<head><script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m)});</script>');
const server = createServer(async (req, res) => {
  const path = req.url === '/media/designer.js' ? 'media/designer.js'
    : req.url === '/media/preview.css' ? 'media/preview.css'
    : req.url === '/fonts/MiSans-Regular.ttf' ? resolve(project, 'assets/Fonts/LUI/MiSans-Regular.ttf')
    : req.url === '/fonts/MiSans-Bold.ttf' ? resolve(project, 'assets/Fonts/LUI/MiSans-Bold.ttf') : undefined;
  res.setHeader('Content-Type', path?.endsWith('.js') ? 'text/javascript' : path?.endsWith('.css') ? 'text/css' : path?.endsWith('.ttf') ? 'font/ttf' : 'text/html');
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
async function open(relative, custom, device = '390x844') {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
  const root = custom ? serialize(spec.parseLui(custom).root, relative) : await load(relative);
  if (custom) sources[relative] = { source: relative, version: 1, text: custom, displayPath: relative, diagnostics: [] };
  await page.evaluate(payload => window.postMessage(payload, '*'), { type: 'model', generation: 1,
    model: { root, diagnostics: [] }, catalog, sources, rootSource: relative, device, fonts, completionImports: [], actionSymbols: {} });
  await page.waitForSelector('#canvas > .lui-node', {state:'attached'});
  await settle();
  assert.equal((await sizes()).zoom, '100%', 'Every new Webview starts at 100%');
}
async function settle() { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
// Only VS Code transport is simulated; edits use the same production spec API.
async function acknowledgeDesignerEdit() {
 const message=await page.evaluate(()=>window.messages.filter(m=>['setAttribute','resetAttribute'].includes(m.type)).at(-1));
 assert.ok(message,'designer emits an edit request');
 const source=sources[message.source];let node=spec.parseLui(source.text).root;
 for(const index of message.path) node=node.children[index];
 source.text=message.type==='resetAttribute'?spec.removeAttribute(source.text,node,message.name):spec.editAttribute(source.text,node,message.name,message.value);
 source.version++;
 await page.evaluate(payload=>window.postMessage(payload,'*'),{type:'designerEditResult',requestId:message.requestId,success:true,source});
 await settle();
}
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
const results=[];
try {
 // Caption rectangles and NVG anchors share the same content-box contract.
 for (const width of [200,300]) for (const [xi,x] of ['左','居中','右'].entries()) for(const [yi,y] of ['上','居中','下'].entries()) {
  await open('caption.lui',`<控件 名称="Caption" 宽度="${width}" 高度="80"><按钮 文本="对齐" 字号="20" 内边距="10,7,20,11" 边框宽度="2" 文字左右对齐="${x}" 文字上下对齐="${y}" /></控件>`);
  const boxes=await page.locator('#canvas .button').evaluate(n=>{
   const b=n.getBoundingClientRect(),c=n.querySelector('.lui-button-caption').getBoundingClientRect(),t=n.querySelector('.lui-button-caption > span').getBoundingClientRect();
   return {w:b.width,h:b.height,cx:c.x-b.x,cy:c.y-b.y,cw:c.width,ch:c.height,tx:t.x-b.x,ty:t.y-b.y,tw:t.width,th:t.height};
  });
  assert.ok(Math.abs(boxes.cx-12)<1 && Math.abs(boxes.cy-9)<1,JSON.stringify(boxes));
  assert.ok(Math.abs(boxes.tx-(12+(width-34-boxes.tw)*xi/2))<1,JSON.stringify({x,boxes}));
  assert.ok(Math.abs(boxes.ty-(9+(58-boxes.th)*yi/2))<1,JSON.stringify({y,boxes}));
  results.push({test:'caption anchor',width,x,y,...boxes});
 }
 await page.locator('#canvas').screenshot({path:'artifacts/parity-caption-bottom-right.png'});
 await page.locator('#canvas .button').click();
 const horizontalField=page.locator('#properties label').filter({hasText:'文字左右对齐'}).filter({has:page.locator('select')});
 await horizontalField.locator('select').selectOption('左');await acknowledgeDesignerEdit();
 assert.ok((await page.locator('.cm-content').innerText()).includes('文字左右对齐="左"'),'inspector writes source');
 assert.equal(await page.locator('.lui-button-caption').evaluate(n=>getComputedStyle(n).justifyContent),'flex-start');
 await horizontalField.getByRole('button',{name:'重置',exact:true}).click();await acknowledgeDesignerEdit();
 assert.ok(!(await page.locator('.cm-content').innerText()).includes('文字左右对齐='),'reset removes explicit source');
 assert.equal(await page.locator('.lui-button-caption').evaluate(n=>getComputedStyle(n).justifyContent),'center');
 await open('caption-long.lui','<控件 名称="Long" 宽度="100" 高度="40"><按钮 文本="这是超出按钮的长文字" 文字左右对齐="右" /></控件>');
 assert.equal(await page.locator('.lui-button-caption').evaluate(n=>getComputedStyle(n).overflow),'hidden');
 await open('Presentation/Components/Header.lui');
 assert.equal(await page.locator('#canvas .button:visible').count(),2,'standalone Header previews both optional actions');
 await page.locator('#canvas').screenshot({path:'artifacts/parity-header.png'});
 for (const [name,count] of [['Cover',1],['Error',0],['Records',2]]) {
  await open(`Presentation/Pages/${name}.lui`);
  assert.equal(await page.locator('#canvas .lui-component-instance').first().locator('.button:visible').count(),count,name+' Header');
 }
 for (const [value,count] of [['否',0],['false',0],['显示',1],['是',1]]) {
  await open('header-condition.lui',`<控件 名称="Condition" 目录:积木="Presentation/Components" 宽度="300" 高度="40"><积木:页眉 返回="{绑定 view.back, 预览内容='${value}'}" /></控件>`);
  assert.equal(await page.locator('#canvas .button:visible').count(),count,value+' cannot be replaced by standalone sample');
 }
 const markup=w=>`<控件 名称="Resize" 宽度="${w}" 高度="80"><按钮 子项排列="自由" 内边距="8" ><容器 引用="info" 宽度="75%" 垂直对齐="左"><文本 文本="宽度跟随" /></容器></按钮></控件>`;
 for (const width of [200,300,420]) {
  await open('resize.lui',markup(width));
  const sizes=await page.locator('#canvas [data-node-path="0.0"]').evaluate(n=>({w:n.getBoundingClientRect().width,parent:n.parentElement.clientWidth-16}));
  assert.ok(Math.abs(sizes.w-sizes.parent*.75)<1,JSON.stringify(sizes));
  results.push({test:'percentage content follows parent',width,...sizes});
 }
 // A real source edit, without re-opening or rebuilding the webview.
 await page.locator('.cm-content').click();await page.keyboard.press('Control+KeyA');await page.keyboard.insertText(markup(360));await settle();
 await page.waitForFunction(()=>document.querySelector('#canvas').offsetWidth===360);
 assert.ok((await page.locator('#canvas [data-node-path="0.0"]').boundingBox()).width>250);
 for(const width of [300,340,420,640]){
  const source=(await readFile(resolve(project,'scripts/Presentation/Components/EquipmentSlots.lui'),'utf8')).replace('最小宽度="300"',`最小宽度="300" 宽度="${width}"`);
  await open('equipment.lui',source);
  const boxes=await page.locator('#canvas .text').evaluateAll(ns=>ns.map(n=>({text:n.textContent,...(()=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}})()})));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j];assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<1,JSON.stringify([a,b]));
  }
  await page.locator('#canvas').screenshot({path:`artifacts/parity-equipment-${width}.png`});
  results.push({test:'equipment no overlap',width});
 }
 await open('import.lui','<控件 名称="Parent" 目录:积木="Presentation/Components" 宽度="400" 高度="80"><积木:装备槽 /></控件>');
 const imported=page.locator('#canvas .lui-component-instance > .control-root');
 assert.equal(await imported.evaluate(n=>n.offsetHeight),56,'component root height is retained');
 assert.equal(await imported.evaluate(n=>n.offsetWidth),400,'auto root width fills import host');
 await open('percent.lui','<控件 名称="Percent" 宽度="400" 高度="200"><容器 子项排列="水平"><容器 引用="half" 宽度="50%"><文本 文本="half" /></容器></容器></控件>');
 assert.equal(await page.locator('#canvas [data-node-path="0.0"]').evaluate(n=>n.offsetWidth),200,'flow percentage applies once');
 await open('progress.lui','<控件 名称="Progress" 宽度="200" 高度="10"><进度条 值="50" /></控件>');
 assert.equal(await page.locator('.progress-fill').evaluate(n=>n.offsetWidth),100);
 const gradient=await page.locator('.progress-fill').evaluate(n=>getComputedStyle(n).backgroundImage);
 assert.ok(gradient.includes('139, 92, 246')&&gradient.includes('213, 181, 109'),gradient);
 await page.locator('#canvas').screenshot({path:'artifacts/parity-progress.png'});
 // Appearance editors write strict colors/alpha and gradient stops back through
 // the same production source-edit protocol used by ordinary properties.
 await open('appearance.lui','<控件 名称="Appearance" 宽度="240" 高度="100"><容器 背景="#112233CC" 边框颜色="#445566" 边框宽度="2" 圆角="8"><文本 文本="统一外观" 字体="sans" 字重="bold" 颜色="#F4ECFFFF" /></容器></控件>');
 await page.locator('#canvas [data-node-path="0"]').click();
 const backgroundField=page.locator('#properties label').filter({hasText:'背景'}).filter({has:page.locator('.brush-editor')}).first();
 assert.equal(await backgroundField.locator('input[type=color]').inputValue(),'#112233');
 assert.equal(await backgroundField.locator('input[type=range]').inputValue(),'204');
 await backgroundField.locator('.brush-editor > select').selectOption('linear'); await acknowledgeDesignerEdit();
 assert.ok((await page.locator('.cm-content').innerText()).includes('linear-gradient(90deg'));
 const textNode=page.locator('#canvas [data-node-path="0.0"]');
 assert.equal(await textNode.evaluate(n=>getComputedStyle(n).fontFamily.split(',')[0].replaceAll('"','').trim()),'sans');
 assert.ok(Number(await textNode.evaluate(n=>getComputedStyle(n).fontWeight))>=700);
 // The same explicit page-frame formula keeps header, settings and footer
 // inside every approved narrow/short viewport without an implicit safe area.
 for (const device of ['358x425','377x496','360x800','390x844','640x1024']) {
  await open('Presentation/Pages/Cover.lui',undefined,device);
  const canvas=await page.locator('#canvas').boundingBox();
  const nodes=await page.locator('#canvas .page-root .lui-page-design').evaluate(n=>{
   const all=[n.querySelector('.lui-component-instance'),...n.querySelectorAll('.button'),...n.querySelectorAll('.text')];
   return all.filter(Boolean).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,text:e.textContent}}).filter(r=>r.width>0&&r.height>0);
  });
  assert.ok(nodes.length>5 && nodes.every(n=>n.x>=canvas.x-1&&n.right<=canvas.x+canvas.width+1&&n.y>=canvas.y-1&&n.bottom<=canvas.y+canvas.height+1),JSON.stringify({device,canvas,nodes}));
  results.push({test:'cover frame visible',device});
 }
 await open('Presentation/Pages/Cover.lui');
 const coverCanvas=await page.locator('#canvas').boundingBox();
 await page.screenshot({path:'artifacts/parity-cover-377x496.png',clip:{x:coverCanvas.x+(coverCanvas.width-377)/2,y:coverCanvas.y,width:377,height:496}});
 // Audit all active paired designs: not just the reported page.
 const files=[];
 async function walk(dir){for(const file of await readdir(resolve(project,'scripts',dir),{withFileTypes:true})){
  if(file.isDirectory())await walk(dir+'/'+file.name);else if(file.name.endsWith('.lui'))files.push(dir+'/'+file.name);
 }}
 await walk('Presentation');
 const tags=new Set(),attributes=new Set();
 for(const file of files){
  const source=await readFile(resolve(project,'scripts',file),'utf8');const parsed=spec.parseLui(source);
  assert.deepEqual(parsed.diagnostics.filter(d=>d.severity==='error'),[],file);
  function collect(n){if(n.tag)tags.add(n.tag);for(const a of n.attrs??[])attributes.add(a.name);for(const c of n.children??[])collect(c)}collect(parsed.root);
  await open(file); await page.click('#fit');await settle();
  assert.ok((await page.locator('#canvas').boundingBox()).width>0,file);
 }
 for (const name of ['Records','Tower']) {await open(`Presentation/Pages/${name}.lui`);await page.click('#fit');await settle();await page.locator('#canvas').screenshot({path:`artifacts/parity-${name}.png`})}
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,designs:files.length,tags:[...tags].sort(),attributes:[...attributes].sort(),results},null,2));
}finally{await browser.close();server.close()}
