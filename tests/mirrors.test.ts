import { beforeEach, describe, expect, it } from 'vitest';
import { canFailOver, HTTPFailure, mirrorConfiguration, MirrorManager } from '../src/core/mirrors';
import { isChallenge, VerificationRequired } from '../src/core/parser';
const catalogue='<main class="b-content__main"><div class="b-content__inline_item"></div></main>';
const response=(url:string,text=catalogue)=>({url,text,status:200});
describe('maintained mirror selection',()=>{
  beforeEach(()=>localStorage.clear());
  it('rebases a failed request onto a validated mirror, ignores parked redirects and remembers the result',async()=>{
    let active='https://offline.example/';const probes:string[]=[];
    const manager=new MirrorManager(async url=>{
      probes.push(url);
      if(url===mirrorConfiguration)return response(url,JSON.stringify({mirrors:{main:['parked.example','working.example'],cloudflare:[]}}));
      if(url.includes('hdrezka-home'))throw new HTTPFailure(403);
      if(url.includes('parked'))return response('https://advertising.example/','Buy this domain');
      return response('https://working.example/');
    },()=>active,url=>{active=url;});
    const paths:string[]=[];const result=await manager.run(async base=>{paths.push(new URL('series/page/2/',base).href);if(base.includes('offline'))throw new Error('Network connection failed');return 'real result';});
    expect(result).toBe('real result');expect(active).toBe('https://working.example/');expect(paths).toEqual(['https://offline.example/series/page/2/','https://working.example/series/page/2/']);expect(probes).toContain('https://parked.example/');
  });
  it('keeps a protected mirror and lets the user verify it without rotating through more sites',async()=>{
    let active='https://offline.example/';const probes:string[]=[];
    const manager=new MirrorManager(async url=>{probes.push(url);if(url===mirrorConfiguration)return response(url,JSON.stringify({mirrors:{main:['other.example'],cloudflare:[]}}));throw new VerificationRequired(url);},()=>active,url=>{active=url;});
    await expect(manager.run(async()=>{throw new HTTPFailure(503);})).rejects.toBeInstanceOf(VerificationRequired);
    expect(active).toBe('https://hdrezka-home.tv/');expect(probes).not.toContain('https://other.example/');
  });
  it('uses the persisted maintained list when configuration is offline',async()=>{
    localStorage.setItem('rezka-tv-mirrors',JSON.stringify(['cached.example']));let active='https://offline.example/';
    const manager=new MirrorManager(async url=>{if(url===mirrorConfiguration||url.includes('hdrezka-home'))throw new Error('Network connection failed');return response(url);},()=>active,url=>{active=url;});
    await manager.run(async base=>{if(base.includes('offline'))throw new Error('Network connection failed');return true;});expect(active).toBe('https://cached.example/');
  });
  it('does not interpret missing content, rate limits, malformed responses or site messages as transport failures',()=>{
    for(const error of [new HTTPFailure(404),new HTTPFailure(429),new SyntaxError('Invalid JSON'),new Error('This title is unavailable.'),new VerificationRequired('https://protected.example')])expect(canFailOver(error)).toBe(false);
    expect(canFailOver(new HTTPFailure(403))).toBe(true);expect(canFailOver(new HTTPFailure(503))).toBe(true);
  });
  it('recognizes the real Anubis page received from the live mirrors',()=>{expect(isChallenge('<html><title>Проверяем, что вы не бот!</title><script src="/.within.website/x/cmd/anubis/main.mjs"></script></html>')).toBe(true);});
  it('shares concurrent probing without fetching the maintained list twice',async()=>{
    let active='https://offline.example/',configurations=0;
    const manager=new MirrorManager(async url=>{if(url===mirrorConfiguration){configurations++;return response(url,JSON.stringify({mirrors:{main:[],cloudflare:[]}}));}return response(url);},()=>active,url=>{active=url;});
    const operation=async(base:string)=>{if(base.includes('offline'))throw new Error('Network connection failed');return base;};
    const results=await Promise.all([manager.run(operation),manager.run(operation)]);expect(results[0]).toBe(results[1]);expect(configurations).toBe(1);
  });
});
