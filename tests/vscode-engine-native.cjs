// No provider double, no acquireVsCodeApi replacement, no HTTP Webview shim.
const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
exports.run=async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
  const output=process.env.LUI_TEST_OUTPUT,reportPath=path.join(output,'report.json');
  const report={passed:false,stage:'activation',checks:[],errors:[],captures:[],scope:'real native VS Code Webview -> production EnginePreviewHost -> isolated official engine; static fixture only'};
  const checkpoint=async stage=>{report.stage=stage;console.log('[native-engine] '+stage);await fs.writeFile(reportPath,JSON.stringify(report,null,2));};
  const wait=async(test,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+label);};
  let debugBrowser,engineBrowser,webview,fixtureDocument;
  try{
    await checkpoint('activation');
    const extension=vscode.extensions.getExtension('SAGELEMI.lui-vscode');assert.ok(extension,'production extension found');await extension.activate();
    report.vscode={version:vscode.version,extensionPath:extension.extensionPath,extensionVersion:extension.packageJSON.version,isTrusted:vscode.workspace.isTrusted};
    const fixture=path.join(process.env.LUI_TEST_PROJECT,'scripts/Presentation/NativeEngine.lui');
    await fs.mkdir(path.dirname(fixture),{recursive:true});
    const initial='<页面 名称="NativeEngine" 宽度="390" 高度="844" 背景="#0B0714">\n  <容器 子项排列="垂直" 内边距="24" 垂直间隔="12">\n    <文本 文本="原生窗口基线" 字号="24" 颜色="#F4ECFF" />\n    <按钮 名称="PickTarget" 文本="真实引擎选择" 高度="48" 背景="#7851C9" />\n  </容器>\n</页面>';
    await fs.writeFile(fixture,initial,'utf8');
    const document=await vscode.workspace.openTextDocument(vscode.Uri.file(fixture));
    fixtureDocument=document;
    await vscode.commands.executeCommand('vscode.openWith',document.uri,'lui.preview');
    debugBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.LUI_TEST_CDP_PORT}`);
    await checkpoint('locating-native-webview');
    await wait(async()=>{
      for(const context of debugBrowser.contexts())for(const page of context.pages())for(const frame of page.frames()){
        try{if(await frame.locator('.cm-content').count()){webview=frame;return true;}}catch{}
      }
      return false;
    },'native CodeMirror Webview',25000);
    report.webview={url:webview.url(),backend:await webview.locator('select[title="预览后端"]').inputValue()};
    assert.match(report.webview.url,/^vscode-webview:\/\//,'CodeMirror must run in a real VS Code Webview');
    assert.equal(report.webview.backend,'engine');
    await webview.evaluate(()=>{window.__nativeEvidence=[];window.addEventListener('message',event=>{if(['enginePick','source','sourceEditResult','model'].includes(event.data?.type))window.__nativeEvidence.push(event.data);});});
    await checkpoint('waiting-production-engine-host');
    await wait(async()=>!!(await webview.locator('#canvas iframe').getAttribute('src').catch(()=>'')),'production engine host URL',30000);
    const engineUrl=await webview.locator('#canvas iframe').getAttribute('src');
    assert.match(engineUrl,/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/$/);
    report.webview.transport='native acquireVsCodeApi/postMessage; unchanged production provider';
    engineBrowser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
    const page=await engineBrowser.newPage({viewport:{width:1000,height:1100},deviceScaleFactor:1});
    await page.addInitScript(()=>{
      window.__events=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.source==='tap-plugin-viewer')window.__events.push(event.data);});
      const raf=window.requestAnimationFrame.bind(window);window.__completedRaf=0;
      window.requestAnimationFrame=callback=>raf(time=>{callback(time);window.__completedRaf++;if(!window.__capture)return;
        // Several vendor callbacks can share one display timestamp. Require
        // two distinct rendering ticks, not two reads from that same tick.
        if(window.__capture.frames.at(-1)?.time===time)return;
        const canvas=document.querySelector('canvas'),gl=canvas&&(canvas.getContext('webgl2')||canvas.getContext('webgl'));if(!gl)return;
        const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        window.__capture.frames.push({pixels,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,error:gl.getError(),raf:window.__completedRaf,time});
        if(window.__capture.frames.length===2){window.__captured=window.__capture.frames;window.__capture=null;}
      });
    });
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(engineUrl);
    await page.waitForFunction(()=>window.__events.some(e=>e.name==='lui-preview-applied'||e.name==='lui-preview-error'),null,{timeout:60000});
    const error=await page.evaluate(()=>window.__events.find(e=>e.name==='lui-preview-error'));assert.ok(!error,JSON.stringify(error));
    const frame=page.frames().find(f=>f.url().includes('engine-frame.html'));assert.ok(frame);
    report.engineIdentity=await(await fetch(engineUrl+'identity.json')).json();
    report.checks.push('production custom editor activation','native Webview transport','production official engine host');
    const snapshot=async()=>await(await fetch(engineUrl+'snapshot.json')).json();
    const waitApplied=async revision=>{await page.waitForFunction(revision=>window.__events.some(e=>e.name==='lui-preview-applied'&&e.payload?.revision>=revision),revision,{timeout:20000});};
    const capture=async label=>{
      await frame.evaluate(()=>{window.__capture={frames:[]};window.__captured=null;});
      await frame.waitForFunction(()=>window.__captured,null,{timeout:10000});
      const captures=await frame.evaluate(()=>window.__captured.map(value=>{let binary='';for(let i=0;i<value.pixels.length;i+=8192)binary+=String.fromCharCode(...value.pixels.subarray(i,i+8192));return {...value,pixels:btoa(binary)};}));
      const frames=captures.map(value=>{const bytes=Buffer.from(value.pixels,'base64');delete value.pixels;return {...value,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};});
      assert.equal(frames[0].sha256,frames[1].sha256,'two distinct completed vendor RAF ticks must be stable');
      assert.ok(frames[1].raf>frames[0].raf&&frames[1].time>frames[0].time,'stability reads must have different increasing RAF timestamps');
      const result=frames[1];assert.equal(result.error,0);assert.equal(result.width,390);assert.equal(result.height,844);assert.equal(result.bytes.length,390*844*4);
      const colors=new Set();let ink=0;
      for(let y=24;y<62;y++)for(let x=24;x<365;x++){const i=((result.height-1-y)*result.width+x)*4,r=result.bytes[i],g=result.bytes[i+1],b=result.bytes[i+2];colors.add((r<<16)|(g<<8)|b);if(Math.max(r,g,b)>100)ink++;}
      assert.ok(colors.size>=16&&ink>=50,`actual rendered title ink (${colors.size} colors, ${ink} pixels)`);
      await fs.writeFile(path.join(output,label+'.rgba'),result.bytes);
      const evidence={label,sha256:result.sha256,width:result.width,height:result.height,firstRaf:frames[0].raf,secondRaf:result.raf,firstTimestamp:frames[0].time,secondTimestamp:result.time,colors:colors.size,inkPixels:ink};
      report.captures.push(evidence);return evidence;
    };
    await checkpoint('baseline-render');
    const baselineSnapshot=await snapshot();await waitApplied(baselineSnapshot.snapshot.revision);
    const baseline=await capture('baseline');
    await checkpoint('native-webview-edit');
    const changed=initial.replace('原生窗口基线','UPDATED NATIVE');
    // Playwright's contenteditable fill performs native selection/insertText;
    // no CodeMirror API, document patch or message is injected by the test.
    await webview.locator('.cm-content').fill(changed);
    await wait(()=>document.getText()===changed,'real TextDocument updated by native CodeMirror');
    await wait(async()=>JSON.stringify((await snapshot()).snapshot.node).includes('UPDATED NATIVE'),'new production engine snapshot');
    const editedSnapshot=await snapshot();assert.ok(editedSnapshot.snapshot.revision>baselineSnapshot.snapshot.revision);await waitApplied(editedSnapshot.snapshot.revision);
    const edited=await capture('edited');assert.notEqual(edited.sha256,baseline.sha256,'source text edit must change actual engine pixels');
    report.checks.push('native Webview source edit -> real TextDocument -> newer engine snapshot -> changed nonblank GPU frame');
    await checkpoint('engine-pick-native-webview');
    const canvas=frame.locator('canvas');await canvas.click({position:{x:100,y:94}});
    await wait(async()=>await webview.evaluate(()=>window.__nativeEvidence.some(e=>e.type==='enginePick'&&e.nodePath==='0.1')),'engine pick reaches native Webview');
    await wait(async()=>(await webview.locator('#outline [data-node-path="0.1"]').getAttribute('class')||'').includes('selected'),'real engine pick selects source node');
    const picks=await webview.evaluate(()=>window.__nativeEvidence.filter(e=>e.type==='enginePick'));report.pick=picks.at(-1);
    assert.equal(report.pick.sourcePath,document.uri.toString());assert.ok(report.pick.probe);assert.equal(document.getText(),changed,'engine pick never edits source');
    report.checks.push('real engine canvas pointer -> validated host POST -> extension -> native Webview selection');
    await checkpoint('native-property-edit-engine-refresh');
    // Source-defined property DOM: propertyInput uses data-property="Height"
    // and .size-editor with px/%/auto select plus a number input.
    const heightRow=webview.locator('#properties [data-property="Height"]');
    const heightCategory=heightRow.locator('xpath=ancestor::details[1]');
    if(!(await heightCategory.evaluate(element=>element.open)))await heightCategory.locator('summary').click();
    assert.equal(await heightRow.locator('select').inputValue(),'像素');
    const heightField=heightRow.locator('.size-editor input[type="number"]');
    assert.equal(await heightField.inputValue(),'48','actual selected button exposes authored height');
    await heightField.fill('72');await heightField.press('Tab');
    const propertyChanged=changed.replace('高度="48"','高度="72"');
    await wait(()=>document.getText()===propertyChanged,'native property field edits the exact explicit TextDocument attribute');
    const buttonNode=data=>data.snapshot.node.children[0].children[1];
    await wait(async()=>Number(buttonNode(await snapshot()).attrs.Height)===72,'native property edit reaches current engine snapshot');
    const propertySnapshot=await snapshot();assert.equal(buttonNode(propertySnapshot).nodePath,'0.1');
    assert.ok(propertySnapshot.snapshot.revision>editedSnapshot.snapshot.revision);await waitApplied(propertySnapshot.snapshot.revision);
    const propertyEdited=await capture('property-height');
    assert.notEqual(propertyEdited.sha256,edited.sha256,'changing button height from its actual property field changes GPU pixels');
    report.checks.push('native Webview Height property 48->72 -> exact explicit TextDocument attribute -> newer engine snapshot -> changed GPU frame');
    await checkpoint('native-property-undo-engine-refresh');
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.Beside});
    await vscode.commands.executeCommand('undo');
    await wait(()=>document.getText()===changed,'one native undo restores only the height property edit');
    await wait(async()=>await webview.evaluate(text=>window.__nativeEvidence.some(e=>e.type==='source'&&e.origin==='native-undo'&&e.source?.text===text),changed),'property undo notification reaches actual Webview');
    await wait(async()=>{const data=await snapshot();return Number(buttonNode(data).attrs.Height)===48&&JSON.stringify(data.snapshot.node).includes('UPDATED NATIVE');},'property undo restores height while retaining the earlier source edit');
    const propertyUndoSnapshot=await snapshot();assert.ok(propertyUndoSnapshot.snapshot.revision>propertySnapshot.snapshot.revision);await waitApplied(propertyUndoSnapshot.snapshot.revision);
    const propertyUndone=await capture('property-undo');assert.equal(propertyUndone.sha256,edited.sha256,'native property undo restores the exact preceding edited frame');
    report.property={nodePath:'0.1',name:'Height',before:48,after:72,documentVersion:document.version};
    report.checks.push('one native property undo preserves prior source edit -> actual Webview -> engine RGBA restored exactly');
    await checkpoint('native-undo-engine-refresh');
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.Beside});
    await vscode.commands.executeCommand('undo');
    await wait(()=>document.getText()===initial,'native VS Code undo restores original document');
    await wait(async()=>await webview.evaluate(text=>window.__nativeEvidence.some(e=>e.type==='source'&&e.origin==='native-undo'&&e.source?.text===text),initial),'native undo notification reaches actual Webview');
    await wait(async()=>JSON.stringify((await snapshot()).snapshot.node).includes('原生窗口基线'),'native undo reaches engine snapshot');
    const undoSnapshot=await snapshot();assert.ok(undoSnapshot.snapshot.revision>editedSnapshot.snapshot.revision);await waitApplied(undoSnapshot.snapshot.revision);
    const undone=await capture('native-undo');assert.equal(undone.sha256,baseline.sha256,'native undo restores exact stable baseline frame');
    report.checks.push('native VS Code undo -> native Webview -> latest engine frame equal to baseline');
    report.revisions={baseline:baselineSnapshot.snapshot.revision,edited:editedSnapshot.snapshot.revision,property:propertySnapshot.snapshot.revision,propertyUndo:propertyUndoSnapshot.snapshot.revision,undo:undoSnapshot.snapshot.revision};
    assert.deepEqual(report.errors,[]);report.passed=true;await checkpoint('complete');
  }catch(error){report.passed=false;report.errors.push(String(error.stack||error));
    if(fixtureDocument)report.failureDocument=fixtureDocument.getText();
    if(webview)report.failureWebview=await webview.locator('.cm-content').innerText().catch(()=>'<unavailable>');
    throw error;
  }
  finally{
    if(debugBrowser)report.debugTargets=debugBrowser.contexts().flatMap(c=>c.pages().map(p=>({url:p.url(),frames:p.frames().map(f=>f.url())})));
    await fs.writeFile(reportPath,JSON.stringify(report,null,2));
    if(engineBrowser)await engineBrowser.close();
  }
};
