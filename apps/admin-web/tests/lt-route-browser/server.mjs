import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { fixture } from '../helpers/role-fixture.mjs';
import { proxyLtCore } from '../../lib/lt/proxy-core.ts';
const cleanups=[];
const f=await fixture({after:fn=>cleanups.push(fn)});
function load(path,deps){const exports={}; const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','exports',source)(name=>{if(!(name in deps))throw Error(name);return deps[name]},exports);return exports;}
const {ltInternalAdapter}=load('../../lib/lt/internal-adapter.ts',{});
const env={LT_INTERNAL:{async operate(context,request){return fetch('http://127.0.0.1:18919',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context,path:new URL(request.url).pathname,method:request.method,body:request.method==='GET'?null:await request.text()})});}}};
const route=load('../../app/api/lt/v1/operator/[...path]/route.ts',{'cloudflare:workers':{env},'@/lib/lt/proxy':{proxyLt:(request,adapter)=>proxyLtCore(request,r=>f.auth.requireRecentIdentity(r),adapter)},'@/lib/lt/internal-adapter':{ltInternalAdapter}});
const cookie=await f.auth.createSessionCookie(f.actor,new Request('http://127.0.0.1:18920'));
const server=await createServer({configFile:false,root:fileURLToPath(new URL('./',import.meta.url)),plugins:[react(),{name:'local-signed-route',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/api/lt/')){if(req.url==='/')res.setHeader('Set-Cookie',cookie);return next();}try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=new Request('http://127.0.0.1:18920'+req.url,{method:req.method,headers:req.headers,body:req.method==='GET'?undefined:Buffer.concat(chunks)});const response=await route[req.method](request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});}}],server:{host:'127.0.0.1',port:18920,strictPort:true,fs:{allow:[process.cwd()]}}});
await server.listen();server.printUrls();
