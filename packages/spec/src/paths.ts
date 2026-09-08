/** Data-only paths: quoted keys remain strings; numeric indices are Lua 1-based. */
export function pathKeys(path: string): Array<string|number> | undefined {
  const head = /^[A-Za-z][A-Za-z0-9_-]*/.exec(path);
  if (!head) return;
  const keys:Array<string|number> = [head[0]]; let i = head[0].length;
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
    } else if(path[i]==='['){
      const token=/^\[([1-9]\d*)\]/.exec(path.slice(i));if(!token)return;
      const value=Number(token[1]);if(!Number.isSafeInteger(value))return;
      keys.push(value);i+=token[0].length;
    } else return;
  }
  if (keys.some(k => typeof k==='string'&&['__proto__', 'prototype', 'constructor'].includes(k))) return;
  return keys;
}
export function readPath(scope: unknown, path: string): unknown {
  const keys = pathKeys(path); if (!keys) return;
  let result: any = scope;
  for (const key of keys) { if (!result || typeof result !== 'object') return; result = result[Array.isArray(result)&&typeof key==='number'?key-1:key]; }
  return result;
}
