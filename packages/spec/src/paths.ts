/** Data-only paths: ASCII dot paths plus quoted UTF-8 string keys. */
export function pathKeys(path: string): string[] | undefined {
  const head = /^[A-Za-z][A-Za-z0-9_-]*/.exec(path);
  if (!head) return;
  const keys = [head[0]]; let i = head[0].length;
  while (i < path.length) {
    if (path[i] === '.') {
      const token = /^[A-Za-z][A-Za-z0-9_-]*/.exec(path.slice(++i));
      if (!token) return; keys.push(token[0]); i += token[0].length;
    } else if (path[i] === '[' && /['"]/.test(path[i + 1] ?? '')) {
      const quote = path[++i]!; let value = ''; i++;
      while (i < path.length && path[i] !== quote) {
        if (path[i] === '\\') { i++; if (path[i] !== quote && path[i] !== '\\') return; }
        value += path[i++];
      }
      if (!value || path[i++] !== quote || path[i++] !== ']') return;
      keys.push(value);
    } else return;
  }
  if (keys.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) return;
  return keys;
}
export function readPath(scope: unknown, path: string): unknown {
  const keys = pathKeys(path); if (!keys) return;
  let result: any = scope;
  for (const key of keys) { if (!result || typeof result !== 'object') return; result = result[key]; }
  return result;
}
