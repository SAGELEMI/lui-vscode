// Explicit migration, never invoked on open/save. Preserves source formatting.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import spec from '../dist/spec.cjs';
const roots = process.argv.slice(2).filter(a => a !== '--write');
if (!roots.length) throw new Error('Usage: node scripts/migrate-button-captions.mjs <design-directory> ... [--write]');
let files = 0, changed = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!entry.name.endsWith('.lui')) continue;
    files++;
    const original = await readFile(path, 'utf8'); let text = original;
    for (;;) {
      const doc = spec.parseLui(text);
      if (doc.diagnostics.some(d => d.severity === 'error')) throw new Error(`Fix syntax before migration: ${path}`);
      let missing;
      function visit(node) {
        const hasVisualChildren = node.children.some(c => c.kind === 'element' && !c.tag?.startsWith('按钮.'));
        const hasCaption = node.attrs.some(a => a.name === '文本') || node.children.some(c => c.tag === '按钮.文本');
        if (node.tag === '按钮' && (hasCaption || !hasVisualChildren)) {
          const attribute = ['文字左右对齐','文字上下对齐'].find(key => !node.attrs.some(a => a.name === key));
          if (attribute && !missing) missing = {node, attribute};
        }
        node.children.forEach(visit);
      }
      if (doc.root) visit(doc.root);
      if (!missing) break;
      text = spec.editAttribute(text, missing.node, missing.attribute, '居中');
    }
    if (text !== original) {
      changed++; console.log(path);
      if (process.argv.includes('--write')) await writeFile(path, text, 'utf8');
    }
  }
}
for (const root of roots) await walk(resolve(root));
console.log(JSON.stringify({files, changed, written:process.argv.includes('--write')}));
if (changed && !process.argv.includes('--write')) process.exitCode = 1;
