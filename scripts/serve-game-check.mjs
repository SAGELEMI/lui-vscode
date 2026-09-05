// Explicit remote gameplay QA only; never imported by the safe Studio preview.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
const project=process.argv[2];
if(!/^[a-f0-9-]{36}$/.test(project??''))throw new Error('需要已绑定项目 UUID');
const origin=`https://${project}.games.tapapps.cn`;
const token=randomBytes(24).toString('hex');
const html=`<!doctype html><meta charset="utf-8"><title>无尽塔 · 远程验收</title><style>html,body{margin:0;background:#ddd}iframe{display:block;width:390px;height:867px;border:0}</style><iframe allow="cross-origin-isolated; autoplay" src="${origin}/"></iframe>`;
const server=createServer((req,res)=>{
 if(req.url!==`/${token}/`||req.method!=='GET'){res.writeHead(404).end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'unsafe-inline'; frame-src ${origin}`);
 res.end(html);
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/${token}/`));
