// Integration: production provider and real VS Code TextDocument/WorkspaceEdit,
// production CodeMirror in Chromium. Only Webview transport is replaced by HTTP.
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');
exports.run = async () => {
  const root = path.resolve(__dirname, '..');
  const { LuiPreviewProvider } = require('../dist/extension.cjs');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const temp = path.join(process.env.LUI_TEST_PROJECT,'scripts');
  await fs.mkdir(path.join(temp,'LUI'),{recursive:true}); await fs.mkdir(path.join(temp,'Components'));
  await fs.writeFile(path.join(temp,'LUI/lui.project.json'),JSON.stringify({schemaVersion:3,sourceRoots:['Components'],componentDirectories:{Components:{'测试':'Components/Child.lui'}}}));
  await fs.writeFile(path.join(temp,'Components/Child.lui'),'<控件 名称="Child" 副名称="测试"><按钮 文本="{绑定 props[\'标题\']}" 宽度="90" 高度="40" 圆角="12" /></控件>');
  await fs.writeFile(path.join(temp,'Components/Child.lui.lua'),'local C={}\nC.Properties={ ["标题"]={type="string",default="默认子控件",description="实例标题"}, ["Title"]={type="number",default=7} }\nreturn C');
  const initial = '<控件 名称="Fixture" 宽度="300" 高度="180">\n  <容器>\n    <按钮 文本="A" 宽度="40" 高度="20" />\n  </容器>\n</控件>';
  const uri = vscode.Uri.file(path.join(temp, 'Fixture.lui'));
  await fs.writeFile(uri.fsPath, initial.replaceAll('\n', '\r\n'));
  const document = await vscode.workspace.openTextDocument(uri);
  let receive, html, delay = 0;
  const events = [], disposals = [], failures = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/events') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(events.splice(0))); return; }
    if (req.url === '/message') {
      let raw = ''; for await (const part of req) raw += part;
      await receive(JSON.parse(raw)); res.end('ok'); return;
    }
    if (req.url.startsWith('/media/')) { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await fs.readFile(path.join(root, req.url))); return; }
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const webview = {
    options: {}, cspSource: base,
    asWebviewUri: uri => vscode.Uri.parse(base + '/media/' + path.basename(uri.fsPath)),
    onDidReceiveMessage: callback => { receive = callback; return { dispose() {} }; },
    postMessage: async message => {
      if (delay && message.type === 'sourceEditResult') setTimeout(() => events.push(message), delay);
      else events.push(message);
      return true;
    },
    set html(value) { html = value.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace('<head>', `<head><script>
      window.acquireVsCodeApi=()=>({postMessage:m=>fetch('/message',{method:'POST',body:JSON.stringify(m)})});
      setInterval(async()=>{for(const m of await (await fetch('/events')).json()) window.postMessage(m,'*')},20);
      </script>`); },
  };
  await new LuiPreviewProvider({ extensionUri: vscode.Uri.file(root) }).resolveCustomTextEditor(document, { webview, onDidDispose: callback => disposals.push(callback) });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => failures.push(e.message));
  const text = () => document.getText().replaceAll('\r\n', '\n');
  const waitText = async expected => { for (let i = 0; i < 100; i++) { if (text() === expected) return; await new Promise(r => setTimeout(r, 30)); } assert.equal(text(), expected); };
  const noWarning = async () => assert.doesNotMatch(await page.locator('#diagnostics').innerText(), /源码同步未完成/);
  const edit = async () => {
    await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' 外边距="3"');
  };
  try {
    await page.goto(base); await page.waitForSelector('.cm-content');
    const changed = initial.replace(' />', '  外边距="3"/>');
    await edit(); await waitText(changed); await new Promise(r => setTimeout(r, 300));
    assert.equal(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent.includes('按钮')), true);
    await page.keyboard.press('Control+z'); await waitText(initial); await noWarning();
    await page.keyboard.press('Control+y'); await waitText(changed); await noWarning();
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('undo'); await waitText(initial);
    await page.waitForFunction(() => !document.querySelector('.cm-content').textContent.includes('外边距'));
    await noWarning();
    await vscode.commands.executeCommand('redo'); await waitText(changed);
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('外边距'));
    await vscode.commands.executeCommand('undo'); await waitText(initial);
    await page.waitForFunction(() => !document.querySelector('.cm-content').textContent.includes('外边距'));
    delay = 350;
    await edit(); await new Promise(r => setTimeout(r, 120)); await page.keyboard.press('Control+z');
    await waitText(initial); await new Promise(r => setTimeout(r, 700)); await noWarning();
    await page.keyboard.press('Control+s'); await new Promise(r => setTimeout(r, 300)); await noWarning();
    assert.equal(document.isDirty, false);
    assert.equal(await fs.readFile(uri.fsPath, 'utf8'), initial.replaceAll('\n', '\r\n'));
    delay = 0;
    // Pauses and line breaks must be separate embedded undo groups, not a session-sized edit.
    await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
    await page.keyboard.type('<!--one-->');
    const firstGroup = initial + '<!--one-->';
    await waitText(firstGroup); await new Promise(r => setTimeout(r, 650));
    await page.keyboard.type('<!--two-->');
    const secondGroup = firstGroup + '<!--two-->';
    await waitText(secondGroup);
    await page.keyboard.press('Control+z'); await waitText(firstGroup); await noWarning();
    await page.keyboard.press('Control+z'); await waitText(initial); await noWarning();
    await page.keyboard.press('Control+y'); await waitText(firstGroup);
    await page.keyboard.press('Control+y'); await waitText(secondGroup);
    // Every input is sent before the next pause; document version is not held for preview debounce.
    const beforeVersion = document.version;
    await page.keyboard.type('<!--live-->', { delay: 100 });
    await waitText(secondGroup + '<!--live-->');
    assert.ok(document.version - beforeVersion >= 8, 'one document transaction per input');
    await page.keyboard.press('Control+z'); await waitText(secondGroup);
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('undo');
    assert.notEqual(text(), initial, 'native undo must not erase the entire editing session');
    await noWarning();
    const compositionBase=text();
    await page.waitForFunction(expected => document.querySelector('.cm-content').innerText.replaceAll('\n\n','\n') === expected, compositionBase);
    await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
    const ime=await page.context().newCDPSession(page);
    await ime.send('Input.imeSetComposition',{text:'中',selectionStart:1,selectionEnd:1});
    await ime.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});
    await ime.send('Input.insertText',{text:'中文'});
    await waitText(compositionBase+'中文');
    await page.keyboard.press('Control+z'); await waitText(compositionBase); await noWarning();
    await ime.detach();
    const alignment = [];
    for (const mode of ['自由', '水平', '垂直']) {
      const fixture = `<控件 名称="Fixture" 宽度="300" 高度="180"><容器 子项排列="${mode}"><按钮 文本="A" 宽度="40" 高度="20" 填充="是" 外边距="5,7,9,11" 水平对齐="上" 垂直对齐="左" /></容器></控件>`;
      const change = new vscode.WorkspaceEdit(); change.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), fixture);
      assert.equal(await vscode.workspace.applyEdit(change), true);
      await page.waitForFunction(mode => document.querySelector('.cm-content').textContent.includes(`子项排列="${mode}"`), mode);
      await page.click('#actual-size');
      const button = page.locator('#canvas [data-node-path="0.0"]');
      await button.click();
      // Exercise actual property buttons and production WorkspaceEdit acknowledgements.
      for (const [axis, values] of [['水平对齐', ['上', '居中', '下', '拉伸']], ['垂直对齐', ['左', '居中', '右', '拉伸']]]) {
        for (let i = 0; i < values.length; i++) {
          const group = page.getByRole('radiogroup', { name: axis, exact: true });
          await group.evaluate(el => { const detail = el.closest('details'); if (detail) detail.open = true; });
          await group.getByRole('radio', { name: values[i], exact: true }).click();
          for (let attempt = 0; attempt < 100 && !text().includes(`${axis}="${values[i]}"`); attempt++) await new Promise(r => setTimeout(r, 20));
          assert.ok(text().includes(`${axis}="${values[i]}"`));
          await new Promise(r => setTimeout(r, 180));
          const frame = await button.evaluate(el => {
            const root = document.querySelector('#canvas > .lui-node').getBoundingClientRect();
            const r = el.getBoundingClientRect(); return { x: r.x - root.x, y: r.y - root.y, width: r.width, height: r.height };
          });
          const fraction = i === 1 ? 0.5 : i === 2 ? 1 : 0;
          const expected = axis === '水平对齐' ? { x: 5, y: 7 + 142 * fraction } : { x: 5 + 246 * fraction, y: 7 };
          for (const key of ['x', 'y']) assert.ok(Math.abs(frame[key] - expected[key]) <= 1, `${mode}/${axis}/${values[i]} ${key}: ${JSON.stringify(frame)} expected ${JSON.stringify(expected)}`);
          assert.equal(frame.width, 40); assert.equal(frame.height, 20);
          alignment.push({ mode, axis, value: values[i], ...frame });
          await noWarning();
        }
      }
    }
    const codeUri = vscode.Uri.file(uri.fsPath + '.lua');
    const codeText = 'local C={}\nC.Properties={ ["标题"]={type="string",default="中文默认值",description="测试标题"} }\nreturn C';
    await fs.writeFile(codeUri.fsPath, codeText);
    const codeDoc = await vscode.workspace.openTextDocument(codeUri);
    const propMarkup = '<控件 名称="Fixture" 宽度="300" 高度="180"><文本 文本="{绑定 props[\'标题\']}" /></控件>';
    const replace = async (doc, value) => {
      const change=new vscode.WorkspaceEdit(); change.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),value);
      assert.equal(await vscode.workspace.applyEdit(change),true);
    };
    await replace(document, propMarkup);
    await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('中文默认值'));
    assert.equal(await page.locator('#zoom-value').innerText(),'100%');
    await page.click('#zoom-in');
    await replace(codeDoc, codeText.replace('中文默认值','已更新默认值'));
    await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('已更新默认值'));
    assert.equal(await page.locator('#zoom-value').innerText(),'125%');
    await replace(codeDoc,'local broken = {');
    await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('公开属性声明错误'));
    assert.ok((await page.locator('#canvas').innerText()).includes('已更新默认值'));
    await replace(codeDoc,codeText);
    await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('中文默认值'));
    // Real language service completion and definition location on UTF-8 keys.
    const inside=document.getText().indexOf("props['标题']")+"props['标".length;
    const completions=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,document.positionAt(inside));
    assert.ok(completions.items.some(c => c.label === "props['标题']"));
    const locations=await vscode.commands.executeCommand('vscode.executeDefinitionProvider',uri,document.positionAt(inside));
    assert.ok(locations.some(l => (l.uri || l.targetUri).toString() === codeUri.toString()));
    await replace(codeDoc,'local C={}\nC.Properties={}\nreturn C');
    await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('组件未声明公开属性'));
    await noWarning();
    const instanceMarkup='<控件 名称="Fixture" 目录:积木="Components" 宽度="300" 高度="180"><容器 子项排列="水平"><积木:测试 标题="实例一" Title="7" /><积木:测试 标题="实例二" Title="8" /></容器></控件>';
    await replace(document,instanceMarkup);
    await page.waitForFunction(() => document.querySelector('#canvas').textContent.includes('实例二'));
    await page.locator('#outline [data-node-path="0.0"]').click();
    const publicSection=page.locator('#properties details').filter({has:page.locator('summary',{hasText:'组件公开属性'})});
    await publicSection.evaluate(el=>el.open=true);
    await publicSection.locator('label').filter({hasText:/^Title/}).locator('input').fill('12');
    await publicSection.locator('label').filter({hasText:/^Title/}).locator('input').press('Tab');
    await waitText(instanceMarkup.replace('Title="7"','Title="12"'));
    assert.ok(text().includes('标题="实例一"'));
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+z'); await waitText(instanceMarkup); await noWarning();
    await page.keyboard.press('Control+y'); await waitText(instanceMarkup.replace('Title="7"','Title="12"')); await noWarning();
    const internalButtons=page.locator('#canvas [data-source$="Child.lui"][data-node-path="0"]');
    assert.equal(await internalButtons.count(),2);
    await internalButtons.nth(1).click();
    assert.equal(await page.locator('#canvas .is-selected').count(),1);
    assert.equal(await page.locator('.selection-rectangle.is-selected').count(),1);
    assert.equal(await page.locator('.selection-rectangle.is-selected').evaluate(el=>getComputedStyle(el).borderRadius),'0px');
    assert.ok((await page.locator('.cm-content').innerText()).includes('名称="Fixture"'));
    await page.locator('#outline [data-node-path="0.0"]').click();
    await publicSection.evaluate(el=>el.open=true);
    await publicSection.getByRole('button',{name:'转到声明'}).first().click();
    for(let i=0;i<50 && !vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('Child.lui.lua');i++) await new Promise(r=>setTimeout(r,20));
    assert.ok(vscode.window.activeTextEditor.document.uri.fsPath.endsWith('Child.lui.lua'));
    assert.deepEqual(failures, []);
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/properties-2.4.0.png') });
    await fs.writeFile(path.join(root, 'artifacts/vscode-document-2.4.0.json'), JSON.stringify({ passed: true, release:'2.4.2', eol: 'CRLF', checks: ['typing caret', 'embedded undo redo', 'native undo redo', 'undo before acknowledgement', 'save after undo', 'pause separates undo groups', 'per-character live TextDocument version', 'property isolated undo redo', 'IME composition one-step undo', 'UTF-8 declarations live refresh', 'last-good metadata on syntax error', 'completion and definition provider', 'deletion diagnostics', 'model refresh preserves zoom','imported public attribute exact edits','repeated instance rectangular selection','explicit declaration navigation'], alignment, version: document.version }, null, 2));
  } finally { for (const dispose of disposals) dispose(); await browser.close(); server.close(); }
};
