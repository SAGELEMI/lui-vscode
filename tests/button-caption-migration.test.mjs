import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('caption migration preserves authored alignment, composites, comments and CRLF; second run is empty', async () => {
 const dir=await mkdtemp(join(tmpdir(),'lui-caption-'));
 const file=join(dir,'fixture.lui');
 const source='<控件 名称="C">\r\n<!-- <按钮 文本="comment" /> -->\r\n<按钮 文本="A" 文字左右对齐="右" /><按钮><文本 文本="child" /></按钮><按钮 /><按钮><按钮.文本>标题</按钮.文本></按钮>\r\n</控件>';
 try {
  await writeFile(file,source,'utf8');
  const run=(...args)=>execFileSync(process.execPath,['scripts/migrate-button-captions.mjs',dir,...args],{encoding:'utf8'});
  assert.ok(run('--write').includes('"changed":1'));
  const output=await readFile(file,'utf8');
  assert.ok(output.includes('文字左右对齐="右"'));
  assert.ok(output.includes('<按钮><文本 文本="child" /></按钮>'));
  assert.ok(output.includes('<!-- <按钮 文本="comment" /> -->\r\n'));
  assert.equal((output.match(/文字上下对齐="居中"/g)||[]).length,3);
  assert.ok(run().includes('"changed":0'));
  assert.equal(await readFile(file,'utf8'),output);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
