import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { isIP } from 'node:net';
const sessions = new Map<string,string>();
function localContentProxy():Plugin {
  return {name:'rezka-preview-content',configureServer(server) {
    server.middlewares.use('/api/rezka',async(req,res)=>{
      try {
        const raw=new URL(req.url||'','http://localhost').searchParams.get('url');
        if(!raw)throw new Error('Missing content address');const url=new URL(raw);
        if(url.protocol!=='https:'||url.username||url.password||url.port||isIP(url.hostname)||url.hostname==='localhost'||url.hostname.endsWith('.local'))throw new Error('A public secure content address is required');
        const chunks:Buffer[]=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>65536)throw new Error('Request too large');chunks.push(chunk);}
        const response=await fetch(url,{method:req.method,body:req.method==='POST'?Buffer.concat(chunks):undefined,signal:AbortSignal.timeout(Math.min(18000,Math.max(3000,Number(req.headers['x-rezka-timeout'])||15000))),headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36','Accept':'*/*','Accept-Language':'ru-RU,ru;q=0.9,en;q=0.7',Referer:String(req.headers['x-rezka-referer']||url.origin+'/'),...(req.method==='POST'?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',Origin:url.origin}:{}),...(sessions.get(url.hostname)?{Cookie:sessions.get(url.hostname)!}:{})}});
        const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]);if(cookies.length)sessions.set(url.hostname,cookies.join('; '));
        const bytes=await response.arrayBuffer();let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1251').decode(bytes);}
        res.statusCode=response.status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('X-Rezka-URL',response.url);res.end(text);
      }catch(e){res.statusCode=502;res.end(e instanceof Error?e.message:'Content request failed');}
    });
  }};
}
export default defineConfig({plugins:[react(),localContentProxy()],server:{port:5173,strictPort:true},build:{target:'es2020'},test:{environment:'jsdom',include:['tests/**/*.test.ts']}});
