import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ContentSource } from '../src/core/source';
import { HTTPFailure } from '../src/core/mirrors';
import { isChallenge, VerificationRequired } from '../src/core/parser';
import { defaults } from '../src/core/store';

// This opt-in check contacts the real service. A verification page fails the check.
it.skipIf(process.env.REZKA_LIVE!=='1')('reads real films, series, translations, episodes and playable media',async()=>{
  const report:{date:string;mirror:string;status:string;checks:Record<string,unknown>;error?:string}={date:new Date().toISOString(),mirror:process.env.REZKA_MIRROR||defaults.settings.mirror,status:'running',checks:{}};
  const source=new ContentSource({...defaults.settings,mirror:report.mirror},url=>{report.mirror=url;});
  const cookies=new Map<string,string>();
  source.request=async(url,form,referer,timeout=18000)=>{
    const address=new URL(url),response=await fetch(url,{method:form?'POST':'GET',body:form?new URLSearchParams(form):undefined,signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36','Accept':'*/*','Accept-Language':'ru-RU,ru;q=0.9,en;q=0.7',Referer:referer||address.origin+'/',...(cookies.has(address.host)?{Cookie:cookies.get(address.host)!}:{}),...(form?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',Origin:address.origin}:{})}});
    const set=response.headers.getSetCookie().map(c=>c.split(';')[0]);if(set.length)cookies.set(address.host,set.join('; '));
    const bytes=await response.arrayBuffer();let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1251').decode(bytes);}
    if(isChallenge(text))throw new VerificationRequired(response.url);
    if(!response.ok)throw new HTTPFailure(response.status);
    return {text,url:response.url,status:response.status};
  };
  try {
    const home=await source.catalogue();expect(home.items.length).toBeGreaterThan(0);report.checks.catalogue={titles:home.items.length,categories:home.categories.length};
    const films=await source.catalogue('films/'),series=await source.catalogue('series/');
    const film=await source.details(films.items[0]),show=await source.details(series.items[0]);expect(film.translators?.length).toBeGreaterThan(0);expect(show.isSeries).toBe(true);
    report.checks.details={film:film.title,series:show.title,filmTranslators:film.translators?.length,seriesTranslators:show.translators?.length};
    const found=await source.search(film.title);expect(found.items.some(i=>i.id===film.id)).toBe(true);report.checks.search={results:found.items.length};
    const translation=show.translators!.find(t=>!t.premium)!;const seasons=await source.episodes(show,translation.id);expect(seasons.some(s=>s.episodes.length)).toBe(true);report.checks.episodes={seasons:seasons.length,episodes:seasons.reduce((sum,s)=>sum+s.episodes.length,0)};
    const season=seasons.find(s=>s.episodes.length)!,episode=season.episodes[0];
    const movie=await source.playback(film,{}),episodeSource=await source.playback(show,{translator:translation.id,season:season.id,episode:episode.id});
    report.checks.playback={filmQualities:movie.streams.map(s=>s.quality),episodeQualities:episodeSource.streams.map(s=>s.quality),subtitles:movie.subtitles.length+episodeSource.subtitles.length};
    const media=await fetch(movie.streams[0].url,{headers:{...movie.headers,Range:'bytes=0-1023'},signal:AbortSignal.timeout(18000)});expect(media.ok).toBe(true);const reader=media.body!.getReader(),first=await reader.read();await reader.cancel();expect(first.value?.length).toBeGreaterThan(0);report.checks.media={status:media.status,type:media.headers.get('content-type'),bytes:first.value?.length};
    const collections=await source.collections();expect(collections.length).toBeGreaterThan(0);report.checks.collections={count:collections.length};
    const comments=await source.comments(film);report.checks.comments={count:comments.comments.length,hasNext:comments.hasNext};
    if(film.actors?.[0]){const person=await source.person(film.actors[0].url);expect(person.name).toBeTruthy();report.checks.person={name:person.name,titles:person.filmography.length};}
    report.status='passed';
  }catch(error){report.status=error instanceof VerificationRequired?'blocked by website verification':'failed';report.error=error instanceof Error?error.message:String(error);throw error;}
  finally{mkdirSync('docs',{recursive:true});writeFileSync('docs/live-check.json',JSON.stringify(report,null,2)+'\n');}
},180000);
