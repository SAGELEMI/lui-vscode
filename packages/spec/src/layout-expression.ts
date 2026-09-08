import {pathKeys} from './paths.js';
/** Parse the data-only layout language. This never evaluates JavaScript or Lua. */
export interface LayoutExpression { expression: string; }
type Token = { kind: 'name' | 'number' | 'string' | 'symbol'; value: string };
const forbidden = new Set(['_G','_ENV','__proto__','prototype','constructor','require','load','loadstring','dofile','os','io','debug','package','function','end','then','else']);
export function parseLayoutExpression(value: string | undefined): LayoutExpression | undefined {
  const match = /^\{布局\s+([\s\S]+)\}$/.exec(value?.trim() ?? '');
  if (!match || match[1]!.length > 4096) return undefined;
  const source = match[1]!, tokens: Token[] = [];
  let pos = 0;
  while (pos < source.length) {
    const rest = source.slice(pos), space = /^\s+/.exec(rest);
    if (space) { pos += space[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    const string = /^(?:"(?:[^"\\\r\n]|\\[\\"'nrt])*"|'(?:[^'\\\r\n]|\\[\\"'nrt])*')/.exec(rest);
    const symbol = /^(?:==|~=|<=|>=|[+*/<>()\[\].,\-])/.exec(rest);
    const token = number ? {kind:'number' as const,value:number[0]} : name ? {kind:'name' as const,value:name[0]} : string ? {kind:'string' as const,value:string[0]} : symbol ? {kind:'symbol' as const,value:symbol[0]} : undefined;
    if (!token || (token.kind === 'number' && !Number.isFinite(Number(token.value)))) return undefined;
    tokens.push(token); pos += token.value.length;
    if (tokens.length > 512) return undefined;
  }
  let index = 0, depth = 0;
  const peek = () => tokens[index]?.value;
  const take = (expected: string) => { if (peek() !== expected) throw Error('token'); index++; };
  function primary(): void {
    if (++depth > 64) throw Error('depth');
    const token = tokens[index++]; if (!token) throw Error('value');
    if (token.value === '(') { expression(); take(')'); }
    else if (token.kind === 'number' || token.kind === 'string' || ['true','false','nil'].includes(token.value)) { /* literal */ }
    else if (token.kind === 'name' && !token.value.startsWith('_') && !forbidden.has(token.value) && !['and','or','not'].includes(token.value)) {
      if (peek() === '(') {
        if (!['min','max','count','choose'].includes(token.value)) throw Error('function');
        take('('); let count = 0;
        if (peek() !== ')') { expression(); count++; while (peek() === ',') { take(','); expression(); count++; } }
        take(')');
        if ((token.value === 'count' && count !== 1) || (token.value === 'choose' && count !== 3) || (['min','max'].includes(token.value) && count < 1)) throw Error('arity');
      } else {
        let path=token.value;
        while (peek() === '.' || peek() === '[') {
          if (peek() === '.') { take('.'); const key=tokens[index++]; if (!key || key.kind!=='name' || key.value.startsWith('_') || forbidden.has(key.value)) throw Error('path'); path+='.'+key.value; }
          else { take('['); const key=tokens[index++]; if (!key || !['string','number'].includes(key.kind) || (key.kind==='number'&&(!/^[1-9]\d*$/.test(key.value)||!Number.isSafeInteger(Number(key.value)))) || forbidden.has(key.value.slice(1,-1))) throw Error('key'); take(']');path+='['+key.value+']'; }
        }
        if(!pathKeys(path))throw Error('path');
      }
    } else throw Error('value');
    depth--;
  }
  function unary(): void { if (peek()==='-' || peek()==='not') { index++; if (++depth>64) throw Error('depth'); unary(); depth--; } else primary(); }
  function product(): void { unary(); while (peek()==='*' || peek()==='/') { index++; unary(); } }
  function sum(): void { product(); while (peek()==='+' || peek()==='-') { index++; product(); } }
  function compare(): void { sum(); while (['==','~=','<','<=','>','>='].includes(peek()??'')) { index++; sum(); } }
  function conjunction(): void { compare(); while (peek()==='and') { index++; compare(); } }
  function expression(): void { conjunction(); while (peek()==='or') { index++; conjunction(); } }
  try { expression(); return index===tokens.length ? {expression:source} : undefined; } catch { return undefined; }
}
