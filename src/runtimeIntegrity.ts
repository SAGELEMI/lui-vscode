import { createHash } from 'node:crypto';

/** Verify actual bytes; matching manifest text alone cannot establish parity. */
export async function verifyRuntimeFiles(manifest:unknown, read:(file:string)=>PromiseLike<Uint8Array>):Promise<string[]> {
  const files=(manifest as {files?:Record<string,unknown>})?.files;
  if(!files||typeof files!=='object'||Array.isArray(files)||!Object.keys(files).length)return ['运行时清单缺少文件哈希'];
  const failures:string[]=[];
  for(const [file,expected]of Object.entries(files)) {
    if(!/^[\w-]+\.lua$/.test(file)||typeof expected!=='string'||!/^[a-f0-9]{64}$/i.test(expected)){failures.push(`清单条目无效：${file}`);continue;}
    try {const actual=createHash('sha256').update(await read(file)).digest('hex');if(actual!==expected)failures.push(`文件内容不匹配：${file}`);}
    catch {failures.push(`文件无法读取：${file}`);}
  }
  return failures;
}
