import test from 'node:test';
import assert from 'node:assert/strict';
import spec from '../dist/spec.cjs';
const declaration = body => `local Control = {}\nControl.Properties = {${body}}\nreturn Control`;
const schema = spec.readComponentProperties(declaration('["标题"]={type="string",default="默认标题",description="显示标题"}, ["确认"]={type="event"}, ["Title"]={type="number",default=2}, ["启用"]={type="boolean",default=false}, ["条目"]={type="table",default={{name="一"}}}')).properties;
const imports = [{alias:'积木',directory:'Components',components:[{name:'卡片',properties:Object.keys(schema),definitions:schema}]}];
test('literal UTF-8 declarations retain exact keys, types, defaults and declaration positions', () => {
  assert.equal(schema['标题'].default,'默认标题'); assert.equal(schema.Title.default,2);
  assert.equal(schema['启用'].default,false); assert.equal(schema['条目'].default['1'].name,'一');
  assert.ok(schema['标题'].start > 0);
  assert.deepEqual(spec.readComponentProperties('local C={}\nreturn C'),{});
});
test('static reader rejects code, duplicate keys, reserved layout and invalid default types', () => {
  for (const body of ['["标题"]={type="string",default=os.execute("bad")}', '["宽度"]={type="number"}', '["标题"]={type="number",default="2"}', '["确认"]={type="event",default="go"}', '["a"]={type="string"},["a"]={type="string"}', '["__proto__"]={type="table"}']) assert.ok(spec.readComponentProperties(declaration(body)).error,body);
  assert.ok(spec.readComponentProperties('this is not Lua').error);
});
test('UTF-8 bracket paths are data lookups, not evaluation; legacy dot paths still work', () => {
  const binding=spec.parseBinding("{绑定 props['标题'], 模式=双向, 更新源触发=显式, 预览内容='你好'}");
  assert.equal(binding.path,"props['标题']");
  assert.equal(spec.readPath({props:{'标题':'真实'}},binding.path),'真实');
  assert.equal(spec.readPath({view:{name:'旧路径'}},'view.name'),'旧路径');
  assert.equal(spec.pathKeys("props[os.execute('bad')]"),undefined);
  assert.equal(spec.pathKeys("props['__proto__']"),undefined);
});
test('component validation is isolated and never aliases Title to 标题', () => {
  const source='<页面 名称="P" 宽度="390" 高度="844" 目录:积木="Components"><积木:卡片 标题="标题" Title="3" 确认="{动作 Confirm}" /></页面>';
  const parsed=spec.parseLui(source);
  assert.deepEqual(parsed.diagnostics.filter(d=>d.severity==='error'),[]);
  assert.ok(!parsed.diagnostics.some(d=>d.message.includes('Title 已过时')));
  assert.deepEqual(spec.validateComponentProperties(parsed,imports),[]);
  assert.ok(spec.validateComponentProperties(spec.parseLui(source.replace('Title="3"','Title="字"')),imports).length);
  assert.ok(spec.validateComponentProperties(spec.parseLui(source.replace('标题="标题"','未知="标题"')),imports).length);
  assert.ok(spec.validateComponentProperties(spec.parseLui('<控件 名称="C"><文本 文本="{绑定 props.WeaponText}" /></控件>'),[],schema).length);
});
test('public attribute edits preserve spelling, adjacent aliases, CRLF and unrelated source', () => {
  const source='<页面 名称="P" 外边距="8">\r\n<积木:卡片 标题="一" Title="2" />\r\n</页面>';
  const node=spec.parseLui(source).root.children.find(n=>n.tag);
  assert.equal(spec.editPublicAttribute(source,node,'Title','5'),source.replace('Title="2"','Title="5"'));
  const layoutEdit=spec.editAttribute(source,node,'Width','100');
  assert.ok(layoutEdit.includes('标题="一" Title="2"')); assert.ok(layoutEdit.includes('宽度="100"'));
  assert.equal(spec.normalizeLuiAttributes(source),source);
});
test('completion uses declarations, exact names, descriptions, events and bracket paths', () => {
  const complete = source => spec.provideLuiCompletions({source,position:source.length,imports,properties:schema,actions:['Confirm']});
  const head='<页面 名称="P"><积木:卡片 标题="一" ';
  const fields=complete(head); assert.ok(fields.some(c=>c.label==='Title')); assert.ok(!fields.some(c=>c.label==='标题'));
  assert.equal(fields.find(c=>c.label==='确认').detail,'event');
  assert.ok(complete('<页面><积木:卡片 确认="').some(c=>c.insertText==='{动作 Confirm}'));
  assert.deepEqual(complete('<控件><文本 文本="{绑定 props[\'标').map(c=>c.insertText),["props['标题']"]);
});
