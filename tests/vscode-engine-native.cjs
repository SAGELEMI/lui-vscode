// No provider double, no acquireVsCodeApi replacement, no HTTP Webview shim.
const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
exports.run=async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
  const {visibleLayoutProbe,recordEngineErrors}=await import('../scripts/lib/visible-layout-probe.mjs');
  const output=process.env.LUI_TEST_OUTPUT,reportPath=path.join(output,'report.json');
  const report={passed:false,stage:'activation',checks:[],errors:[],captures:[],scope:'real native VS Code Webview -> declaration snapshots, scenarios and virtual row templates -> shared Runtime -> isolated official engine; no game code/storage'};
  const checkpoint=async stage=>{report.stage=stage;console.log('[native-engine] '+stage);await fs.writeFile(reportPath,JSON.stringify(report,null,2));};
  const wait=async(test,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+label);};
  let debugBrowser,engineBrowser,webview,fixtureDocument;
  try{
    await checkpoint('activation');
    const extension=vscode.extensions.getExtension('SAGELEMI.lui-vscode');assert.ok(extension,'production extension found');await extension.activate();
    report.vscode={version:vscode.version,extensionPath:extension.extensionPath,extensionVersion:extension.packageJSON.version,isTrusted:vscode.workspace.isTrusted};
    const fixture=path.join(process.env.LUI_TEST_PROJECT,'scripts/Presentation/NativeEngine.lui');
    await fs.mkdir(path.dirname(fixture),{recursive:true});
    const initial=`<页面 目录:test="Presentation/Components" 名称="NativeEngine" 宽度="390" 高度="844" 背景="#0B0714">
  <容器 子项排列="垂直" 内边距="24" 垂直间隔="12">
    <文本 文本="原生窗口基线" 字号="24" 颜色="#F4ECFF" />
    <按钮 名称="PickTarget" 文本="真实引擎选择" 高度="48" 背景="#7851C9" />
    <重复项 集合="{绑定 view.labels, 预览内容='[{&quot;text&quot;:&quot;真实条件与重复项&quot;}]'}" 循环项="label"><文本 文本="{绑定 label.text}" /></重复项>
    <虚拟列表 项目="{绑定 view.rows, 预览内容='[{&quot;key&quot;:&quot;one&quot;,&quot;label&quot;:&quot;默认列表项目&quot;}]'}" 循环项="row" 条目键="key" 高度="150"><文本 文本="{绑定 row.label}" 文字换行="换行" /></虚拟列表>
    <test:测试卡片 标题="{绑定 view.caption, 预览内容='来自独立声明组件'}" />
  </容器>
</页面>`;
    const component=path.join(path.dirname(fixture),'Components/TestCard.lui');await fs.mkdir(path.dirname(component),{recursive:true});
    await fs.writeFile(component,`<控件 名称="TestCard" 副名称="测试卡片" 内边距="{布局 8}"><文本 文本="{绑定 props['标题'], 预览内容='组件标题'}" /></控件>`,'utf8');
    await fs.writeFile(component+'.lua',`local C={}\nC.Properties={['标题']={type='string',default='默认组件标题'}}\nreturn C\n`,'utf8');
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
    await webview.evaluate(()=>{window.__nativeEvidence=[];window.addEventListener('message',event=>{if(['enginePick','source','sourceEditResult','saveSourceResult','model'].includes(event.data?.type))window.__nativeEvidence.push(event.data);});});
    await checkpoint('waiting-production-engine-host');
    await wait(async()=>!!(await webview.locator('#canvas iframe').getAttribute('src').catch(()=>'')),'production engine host URL',30000);
    const engineUrl=await webview.locator('#canvas iframe').getAttribute('src');
    assert.match(engineUrl,/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/$/);
    report.webview.transport='native acquireVsCodeApi/postMessage; unchanged production provider';
    engineBrowser=await chromium.launch({channel:process.env.LUI_BROWSER_CHANNEL||'msedge',headless:true});
    const page=await engineBrowser.newPage({viewport:{width:1000,height:1100},deviceScaleFactor:1});
    await page.addInitScript(()=>{
      window.__events=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.source==='tap-plugin-viewer')window.__events.push(event.data);});
      const raf=window.requestAnimationFrame.bind(window);window.__completedRaf=0;window.__displayFrame=0;window.__displayTime=-1;
      window.requestAnimationFrame=callback=>raf(time=>{callback(time);window.__completedRaf++;if(window.__displayTime!==time){window.__displayTime=time;window.__displayFrame++;}if(!window.__capture)return;
        // Several vendor callbacks can share one display timestamp. Require
        // two distinct rendering ticks, not two reads from that same tick.
        if(window.__capture.frames.at(-1)?.time===time)return;
        const canvas=document.querySelector('canvas'),gl=canvas&&(canvas.getContext('webgl2')||canvas.getContext('webgl'));if(!gl)return;
        const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        window.__capture.frames.push({pixels,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,error:gl.getError(),raf:window.__completedRaf,time});
        if(window.__capture.frames.length===2){window.__captured=window.__capture.frames;window.__capture=null;}
      });
    });
    page.on('pageerror',error=>report.errors.push(error.message));recordEngineErrors(page,report);
    await page.goto(engineUrl);
    await page.waitForFunction(()=>window.__events.some(e=>e.name==='lui-preview-applied'||e.name==='lui-preview-error'),null,{timeout:60000});
    const error=await page.evaluate(()=>window.__events.find(e=>e.name==='lui-preview-error'));assert.ok(!error,JSON.stringify(error));
    const frame=page.frames().find(f=>f.url().includes('engine-frame.html'));assert.ok(frame);
    report.engineIdentity=await(await fetch(engineUrl+'identity.json')).json();
    const manifestBytes=await fs.readFile(path.join(process.env.LUI_TEST_PROJECT,'scripts/LUI/runtime-manifest.json'));
    const runtimeManifest=JSON.parse(manifestBytes),manifestHash=createHash('sha256').update(manifestBytes).digest('hex');
    const fixtureConfig=JSON.parse(await fs.readFile(path.join(process.env.LUI_TEST_PROJECT,'scripts/LUI/lui.project.json'),'utf8'));
    assert.equal(fixtureConfig.runtimeManifestHash,manifestHash);
    for(const[file,hash]of Object.entries(runtimeManifest.files)){
      assert.equal(report.engineIdentity.runtimeFiles['LUI/'+file],hash,'engine loaded actual deployed Runtime bytes: '+file);
      assert.equal(createHash('sha256').update(await fs.readFile(path.join(process.env.LUI_TEST_PROJECT,'scripts/LUI',file))).digest('hex'),hash);
    }
    report.runtime={version:runtimeManifest.version,layoutContract:runtimeManifest.layoutContract,fileCount:Object.keys(runtimeManifest.files).length,manifestHash,verifiedActualFiles:true};
    report.checks.push('production custom editor activation','native Webview transport','production official engine host','project actual Runtime files, manifest and loaded engine bytes match');
    const snapshot=async()=>await(await fetch(engineUrl+'snapshot.json')).json();
    const waitApplied=async revision=>{await page.waitForFunction(revision=>window.__events.some(e=>e.name==='lui-preview-applied'&&e.payload?.revision>=revision),revision,{timeout:20000});};
    const capture=async label=>{
      const startedAt=await frame.evaluate(()=>window.__displayFrame);let frames,settled,settleFrames=0,attempts=0;
      do {
        const sequence=label+'-'+(++attempts);
        const source=visibleLayoutProbe+`
local ok,result=xpcall(function()return verifyVisibleLayout(setmetatable({},require('LUI.Runtime')),require('urhox-libs/UI').GetRoot(),390,844)end,debug.traceback)
local event=VariantMap();event['name']='lui-native-visible-layout';event['payload']=cjson.encode({sequence='${sequence}',ok=ok,result=ok and result or nil,error=not ok and tostring(result)or nil});SendEvent('EmitToPlugin',event)`;
        await page.evaluate(source=>document.querySelector('iframe').contentWindow.postMessage({source:'tap-plugin-host',kind:'event',name:'RunLuaSource',payload:{source}},location.origin),source);
        await page.waitForFunction(sequence=>window.__events.some(e=>e.name==='lui-native-visible-layout'&&e.payload?.sequence===sequence),sequence,{timeout:10000});
        settled=await page.evaluate(sequence=>window.__events.find(e=>e.name==='lui-native-visible-layout'&&e.payload?.sequence===sequence)?.payload,sequence);
        await frame.evaluate(()=>{window.__capture={frames:[]};window.__captured=null;});
        await frame.waitForFunction(()=>window.__captured,null,{timeout:10000});
        const captures=await frame.evaluate(()=>window.__captured.map(value=>{let binary='';for(let i=0;i<value.pixels.length;i+=8192)binary+=String.fromCharCode(...value.pixels.subarray(i,i+8192));return {...value,pixels:btoa(binary)};}));
        frames=captures.map(value=>{const bytes=Buffer.from(value.pixels,'base64');delete value.pixels;return {...value,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};});
        settleFrames=(await frame.evaluate(()=>window.__displayFrame))-startedAt;
        assert.ok(settleFrames<=60,'visible native scene did not settle within 60 display frames: '+JSON.stringify(settled));
      } while(!settled?.ok||frames[0].sha256!==frames[1].sha256);
      assert.ok(frames[1].raf>frames[0].raf&&frames[1].time>frames[0].time,'stability reads must have different increasing RAF timestamps');
      const result=frames[1];assert.equal(result.error,0);assert.equal(result.width,390);assert.equal(result.height,844);assert.equal(result.bytes.length,390*844*4);
      const colors=new Set();let ink=0;
      for(let y=24;y<62;y++)for(let x=24;x<365;x++){const i=((result.height-1-y)*result.width+x)*4,r=result.bytes[i],g=result.bytes[i+1],b=result.bytes[i+2];colors.add((r<<16)|(g<<8)|b);if(Math.max(r,g,b)>100)ink++;}
      assert.ok(colors.size>=16&&ink>=50,`actual rendered title ink (${colors.size} colors, ${ink} pixels)`);
      await fs.writeFile(path.join(output,label+'.rgba'),result.bytes);
      const evidence={label,settleFrames,attempts,visibleLayout:settled.result,sha256:result.sha256,width:result.width,height:result.height,firstRaf:frames[0].raf,secondRaf:result.raf,firstTimestamp:frames[0].time,secondTimestamp:result.time,colors:colors.size,inkPixels:ink};
      report.captures.push(evidence);return evidence;
    };
    await checkpoint('baseline-render');
    const baselineSnapshot=await snapshot();await waitApplied(baselineSnapshot.snapshot.revision);
    assert.equal(baselineSnapshot.snapshot.node.children[0].children[2].tag,'lui:For','Studio must preserve loop declarations');
    assert.equal(baselineSnapshot.snapshot.node.children[0].children[3].tag,'VirtualList','Studio must preserve virtual row templates');
    assert.equal(baselineSnapshot.snapshot.node.children[0].children[3].attrs.Items,'{绑定 view.rows}');
    assert.ok(Object.values(baselineSnapshot.snapshot.documents).some(d=>d.node.sourcePath.endsWith('/TestCard.lui')),'imported declaration directory is sent to the shared Runtime');
    const baseline=await capture('baseline');
    report.checks.push('binding 预览内容 -> preserved loops/components/virtual templates -> rendered real GPU frame');
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
    const selectOutline=async nodePath=>{
      const before=document.getText();
      await webview.locator(`#outline [data-node-path="${nodePath}"]`).click();
      await wait(async()=>(await webview.locator(`#outline [data-node-path="${nodePath}"]`).getAttribute('class')||'').includes('selected'),'outline selects '+nodePath);
      assert.equal(document.getText(),before,'outline selection must not edit source');
    };
    const propertyRow=async name=>{
      const row=webview.locator(`#properties [data-property="${name}"]`);
      const category=row.locator('xpath=ancestor::details[1]');
      if(!(await category.evaluate(element=>element.open)))await category.locator('summary').click();
      return row;
    };
    const editProperty=async(name,before,after,expected,selector='input[type="text"]')=>{
      const field=(await propertyRow(name)).locator(selector);
      assert.equal(await field.inputValue(),String(before),'selected node exposes authored '+name);
      await field.fill(String(after));await field.press('Tab');
      await wait(()=>document.getText()===expected,'native '+name+' edit updates exact source');
    };
    const titleNode=data=>data.snapshot.node.children[0].children[0];
    const containerNode=data=>data.snapshot.node.children[0];
    await checkpoint('native-font-size-property');
    await selectOutline('0.0');
    const fontChanged=changed.replace('字号="24"','字号="28"');
    await editProperty('FontSize',24,28,fontChanged);
    await wait(async()=>Number(titleNode(await snapshot()).attrs.FontSize)===28,'font-size property reaches engine snapshot');
    const fontSnapshot=await snapshot();assert.equal(titleNode(fontSnapshot).nodePath,'0.0');
    assert.ok(fontSnapshot.snapshot.revision>propertyUndoSnapshot.snapshot.revision);await waitApplied(fontSnapshot.snapshot.revision);
    const fontEdited=await capture('property-font-size');
    assert.notEqual(fontEdited.sha256,edited.sha256,'authored font size changes actual title pixels');
    report.checks.push('outline title selection -> native FontSize 24->28 property -> exact source and newer engine frame');
    await checkpoint('native-gap-property');
    await selectOutline('0');
    const gapChanged=fontChanged.replace('垂直间隔="12"','垂直间隔="20"');
    await editProperty('VerticalGap',12,20,gapChanged);
    await wait(async()=>Number(containerNode(await snapshot()).attrs.VerticalGap)===20,'vertical gap property reaches engine snapshot');
    const gapSnapshot=await snapshot();assert.equal(containerNode(gapSnapshot).nodePath,'0');
    assert.ok(gapSnapshot.snapshot.revision>fontSnapshot.snapshot.revision);await waitApplied(gapSnapshot.snapshot.revision);
    const gapEdited=await capture('property-gap');
    assert.notEqual(gapEdited.sha256,fontEdited.sha256,'authored child spacing changes actual engine pixels');
    report.checks.push('outline container selection -> native VerticalGap 12->20 -> exact source and changed GPU frame');
    await checkpoint('native-padding-property');
    const paddingRow=await propertyRow('Padding');
    const paddingFields=paddingRow.locator('.thickness-editor input[type="number"]');
    assert.equal(await paddingFields.count(),4,'padding exposes left/top/right/bottom fields');
    for(let i=0;i<4;i++)assert.equal(await paddingFields.nth(i).inputValue(),'24');
    const paddingChanged=gapChanged.replace('内边距="24"','内边距="40,24,24,24"');
    await paddingFields.nth(0).fill('40');await paddingFields.nth(0).press('Tab');
    await wait(()=>document.getText()===paddingChanged,'left padding edit preserves the other three sides and prior edits');
    await wait(async()=>containerNode(await snapshot()).attrs.Padding==='40,24,24,24','padding property reaches engine snapshot');
    const paddingSnapshot=await snapshot();assert.ok(paddingSnapshot.snapshot.revision>gapSnapshot.snapshot.revision);await waitApplied(paddingSnapshot.snapshot.revision);
    const paddingEdited=await capture('property-padding');
    assert.notEqual(paddingEdited.sha256,gapEdited.sha256,'authored left padding changes actual engine pixels');
    report.checks.push('native four-side Padding editor 24->40,24,24,24 -> exact source and changed GPU frame');
    const saveFromWebview=async(label,expected)=>{
      const previousSaves=await webview.evaluate(()=>window.__nativeEvidence.filter(e=>e.type==='saveSourceResult').length);
      await webview.locator('.cm-content').click();await webview.locator('.cm-content').press('Control+s');
      await wait(async()=>(await webview.evaluate(()=>window.__nativeEvidence.filter(e=>e.type==='saveSourceResult').length))>previousSaves,'native Webview save acknowledgement');
      const result=await webview.evaluate(()=>window.__nativeEvidence.filter(e=>e.type==='saveSourceResult').at(-1));
      assert.equal(result.success,true,'Ctrl+S must use the production save transport');
      await wait(()=>!document.isDirty,'saved TextDocument becomes clean');
      assert.equal(document.getText(),expected);const disk=await fs.readFile(fixture,'utf8');
      assert.equal(disk,expected,'saved UTF-8 file exactly matches the edited document');
      (report.saves??=[]).push({label,status:result.status,documentVersion:document.version,sha256:createHash('sha256').update(disk).digest('hex')});
    };
    await checkpoint('native-save-edited-properties');
    assert.equal(document.isDirty,true);assert.equal(await fs.readFile(fixture,'utf8'),initial,'editing changes the real document without premature disk writes');
    await saveFromWebview('edited-properties',paddingChanged);
    report.checks.push('CodeMirror Ctrl+S -> native saveSource acknowledgement -> clean document and exact UTF-8 disk content');
    const undoProperty=async(label,expected,check,preceding)=>{
      await checkpoint('native-undo-'+label);
      await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.Beside});
      await vscode.commands.executeCommand('undo');
      await wait(()=>document.getText()===expected,'one native undo restores only '+label);
      await wait(async()=>await webview.evaluate(text=>window.__nativeEvidence.some(e=>e.type==='source'&&e.origin==='native-undo'&&e.source?.text===text),expected),label+' undo notification reaches actual Webview');
      await wait(async()=>check(await snapshot()),label+' undo reaches engine snapshot');
      const result=await snapshot();await waitApplied(result.snapshot.revision);
      assert.equal((await capture('undo-'+label)).sha256,preceding.sha256,label+' undo restores exact preceding GPU frame');
      return result.snapshot.revision;
    };
    const paddingUndo=await undoProperty('padding',gapChanged,data=>containerNode(data).attrs.Padding==='24',gapEdited);
    const gapUndo=await undoProperty('gap',fontChanged,data=>Number(containerNode(data).attrs.VerticalGap)===12,fontEdited);
    const fontUndo=await undoProperty('font-size',changed,data=>Number(titleNode(data).attrs.FontSize)===24,edited);
    assert.ok(paddingUndo>paddingSnapshot.snapshot.revision&&gapUndo>paddingUndo&&fontUndo>gapUndo,'each independent undo advances the engine revision');
    report.properties={fontSize:{nodePath:'0.0',before:24,after:28,revision:fontSnapshot.snapshot.revision,undoRevision:fontUndo},
      verticalGap:{nodePath:'0',before:12,after:20,revision:gapSnapshot.snapshot.revision,undoRevision:gapUndo},
      padding:{nodePath:'0',before:'24',after:'40,24,24,24',revision:paddingSnapshot.snapshot.revision,undoRevision:paddingUndo}};
    report.checks.push('one undo per Padding/VerticalGap/FontSize edit preserves earlier edits and restores each exact preceding GPU frame');
    await checkpoint('native-undo-engine-refresh');
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.Beside});
    await vscode.commands.executeCommand('undo');
    await wait(()=>document.getText()===initial,'native VS Code undo restores original document');
    await wait(async()=>await webview.evaluate(text=>window.__nativeEvidence.some(e=>e.type==='source'&&e.origin==='native-undo'&&e.source?.text===text),initial),'native undo notification reaches actual Webview');
    await wait(async()=>JSON.stringify((await snapshot()).snapshot.node).includes('原生窗口基线'),'native undo reaches engine snapshot');
    const undoSnapshot=await snapshot();assert.ok(undoSnapshot.snapshot.revision>editedSnapshot.snapshot.revision);await waitApplied(undoSnapshot.snapshot.revision);
    const undone=await capture('native-undo');assert.equal(undone.sha256,baseline.sha256,'native undo restores exact stable baseline frame');
    report.checks.push('native VS Code undo -> native Webview -> latest engine frame equal to baseline');
    await checkpoint('native-save-after-undo');
    assert.equal(document.isDirty,true);assert.equal(await fs.readFile(fixture,'utf8'),paddingChanged,'undo remains unsaved until the user saves');
    await saveFromWebview('restored-source',initial);
    report.checks.push('Ctrl+S after all native undos writes the restored source to disk without losing the baseline render');
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
