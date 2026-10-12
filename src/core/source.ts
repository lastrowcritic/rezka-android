import type { Catalogue, Collection, Item, Selection, Settings, Source } from './types';
import { VerificationRequired, isChallenge } from './challenge';
import { isNative, TV } from './native';
import { demoCategories, demoItems } from './demo';
import { categoryRoot, categorySlug } from './categories';
import { HTTPFailure, InvalidCatalogue, MirrorManager } from './mirrors';
import { VerificationCoordinator } from './verification';
export { normalizeMirror } from './mirrors';
const verification=new VerificationCoordinator();
export function catalogueURL(base: string, page=1, filter?: string) {
  const url=new URL(base);url.searchParams.delete('page');url.searchParams.delete('filter');
  if(page>1)url.pathname=url.pathname.replace(/\/page\/\d+\/?$/,'/').replace(/\/?$/,'/')+`page/${page}/`;
  if(filter)url.searchParams.set('filter',filter);return url.href;
}
export class ContentSource {
  private mirrors:MirrorManager;
  private catalogueCache=new Map<string,{time:number;value:Promise<Catalogue>}>();
  private searchCache=new Map<string,{time:number;value:Promise<Catalogue>}>();
  private detailCache=new Map<string,Promise<Item>>();
  private collectionIndexPending?:Promise<Collection[]>;
  constructor(public settings:Settings, public onMirror?:(url:string)=>void) {
    this.mirrors=new MirrorManager((...args)=>this.request(...args),()=>this.settings.mirror,url=>{this.settings={...this.settings,mirror:url};this.onMirror?.(url);});
  }
  async request(url: string, form?: Record<string,string>, referer?: string, timeout=18000) {
    const method=form?'POST':'GET',body=form?new URLSearchParams(form).toString():undefined;
    const options={url,method,body,referer,timeout};
    const response=isNative?await verification.request(options,options=>TV.request(options),(url,request)=>TV.verify({url,request}),isChallenge):await fetch(`/api/rezka?url=${encodeURIComponent(url)}`,{method,body,headers:{...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(referer?{'X-Rezka-Referer':referer}:{}),'X-Rezka-Timeout':String(timeout)},signal:AbortSignal.timeout(timeout+1000)}).then(async r=>({text:await r.text(),status:r.status,url:r.headers.get('X-Rezka-URL')||url}));
    if(isChallenge(response.text))throw new VerificationRequired(response.url);
    if(response.status<200||response.status>=300)throw new HTTPFailure(response.status);
    return response;
  }
  rebase(raw: string, base=this.settings.mirror) { const url=new URL(raw,base),origin=new URL(base);url.protocol=origin.protocol;url.host=origin.host;return url.href; }
  async withMirror<T>(operation:(base:string)=>Promise<T>):Promise<T> {
    return this.mirrors.run(operation);
  }
  async catalogue(path?: string,page=1,filter?:string):Promise<Catalogue> {
    if(this.settings.mode==='demo'){const root=path?categoryRoot(path):'',slug=path?categorySlug(path):'',genre=slug&&slug!==root?slug.replaceAll('-',' '):'';return {items:demoItems.filter(i=>(!root||i.kind===({films:'movie',series:'series',cartoons:'animation',animation:'anime'} as Record<string,string>)[root])&&(!genre||i.genre.toLowerCase()===genre)),hasNext:false,categories:demoCategories};}
    const key=`${path||''}:${page}:${filter||''}`,cached=this.catalogueCache.get(key);if(cached&&Date.now()-cached.time<60000){this.catalogueCache.delete(key);this.catalogueCache.set(key,cached);return cached.value;}
    const value=this.withMirror(async base=>{const url=catalogueURL(path?this.rebase(path,base):base,page,filter);const r=await this.request(url);const {parseCatalogue}=await import('./parser');const data=parseCatalogue(r.text,r.url,page);if(!data.items.length&&page===1)throw new InvalidCatalogue('The catalogue could not be read. Choose another mirror.');return data;});this.catalogueCache.set(key,{time:Date.now(),value});while(this.catalogueCache.size>80)this.catalogueCache.delete(this.catalogueCache.keys().next().value!);value.catch(()=>{if(this.catalogueCache.get(key)?.value===value)this.catalogueCache.delete(key);});return value;
  }
  async search(query:string,page=1):Promise<Catalogue> {
    if(this.settings.mode==='demo')return {items:demoItems.filter(i=>(i.title+' '+i.genre).toLowerCase().includes(query.toLowerCase())),hasNext:false,categories:[]};
    const term=query.trim(),key=`${term.toLocaleLowerCase('ru-RU')}:${page}`,cached=this.searchCache.get(key);if(cached&&Date.now()-cached.time<60000){this.searchCache.delete(key);this.searchCache.set(key,cached);return cached.value;}
    const value=this.withMirror(async base=>{const url=new URL('search/',base);url.search=new URLSearchParams({do:'search',subaction:'search',q:term,page:String(page)}).toString();const r=await this.request(url.href);const {parseCatalogue}=await import('./parser');return parseCatalogue(r.text,r.url,page);});this.searchCache.set(key,{time:Date.now(),value});while(this.searchCache.size>40)this.searchCache.delete(this.searchCache.keys().next().value!);value.catch(()=>{if(this.searchCache.get(key)?.value===value)this.searchCache.delete(key);});return value;
  }
  async details(item:Item):Promise<Item> {
    if(!item.page)return item;
    const key=item.page;let cached=this.detailCache.get(key);if(cached){this.detailCache.delete(key);this.detailCache.set(key,cached);return cached;}cached=this.withMirror(async base=>{const r=await this.request(this.rebase(item.page!,base));const {parseDetails}=await import('./parser');const detail=parseDetails(r.text,r.url,item);if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('rezka-rating',{detail:{id:detail.id,rating:detail.rating||null}}));return detail;});this.detailCache.set(key,cached);while(this.detailCache.size>100)this.detailCache.delete(this.detailCache.keys().next().value!);cached.catch(()=>{if(this.detailCache.get(key)===cached)this.detailCache.delete(key);});return cached;
  }
  async rating(item:Item):Promise<string|null>{
    if(item.rating)return item.rating;if(!item.page)return null;
    if(isNative){await verification.idle();const result=await TV.rating({url:this.rebase(item.page!)});return result.rating;}
    const detail=await this.details(item);return detail.ratings?.find(r=>r.name==='IMDb')?.value||detail.rating||null;
  }
  async episodes(item:Item,translator:string) {
    if(!item.page)return item.seasons||[];
    return this.withMirror(async base=>{const r=await this.ajax(base,{id:item.rezkaID||item.id,translator_id:translator,action:'get_episodes'},item.page!);const {parseSeasons}=await import('./parser');return parseSeasons(r.seasons||'',r.episodes||'');});
  }
  async ajax(base:string,form:Record<string,string>,page:string) {
    const r=await this.request(new URL(`ajax/get_cdn_series/?t=${Date.now()}`,base).href,form,this.rebase(page,base));
    const data=JSON.parse(r.text);if(![true,1,'1','true'].includes(data.success))throw new Error(data.message||'This title is unavailable.');return data;
  }
  async playback(item:Item,selection:Selection):Promise<Source> {
    if(item.stream)return {streams:[{quality:'Original',url:item.stream,alternatives:[]}],subtitles:[],headers:{}};
    const translators=item.translators?.filter(t=>!t.premium)||[];
    const translator=selection.translator||translators.find(t=>t.selected)?.id||translators[0]?.id;
    if(!translator||item.translators?.find(t=>t.id===translator)?.premium)throw new Error('Choose an available translation.');
    if(item.isSeries&&(!selection.season||!selection.episode))throw new Error('Choose a season and episode.');
    return this.withMirror(async base=>{
      const data=await this.ajax(base,{id:item.rezkaID||item.id,translator_id:translator,season:selection.season||'1',episode:selection.episode||'1',action:item.isSeries?'get_stream':'get_movie'},item.page!);
      const {parseStreams,parseSubtitles}=await import('./decoder');
      return {streams:parseStreams(data.url||''),subtitles:parseSubtitles(data.subtitle||'',data.subtitle_lns||{}),defaultSubtitle:String(data.subtitle_def||''),headers:{Referer:this.rebase(item.page!,base),'User-Agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'}};
    });
  }
  async collections(page=1) {
    if(this.settings.mode==='demo')return [{name:'An evening elsewhere',url:'preview:collection',image:'/artwork/scifi.jpg',count:'12 stories'}];
    return this.withMirror(async base=>{const r=await this.request(catalogueURL(new URL('collections/',base).href,page));const {parseCollections}=await import('./parser');return parseCollections(r.text,r.url);});
  }
  async collectionIndex():Promise<Collection[]>{
    if(this.settings.mode==='demo')return this.collections();
    if(this.collectionIndexPending)return this.collectionIndexPending;
    const cacheKey=`rezka.collections.index.v1:${new URL(this.settings.mirror).host}`;
    try{const saved=JSON.parse(localStorage.getItem(cacheKey)||'null');if(saved&&Date.now()-saved.time<6*60*60*1000&&Array.isArray(saved.items)&&saved.items.every((item:Collection)=>typeof item.name==='string'&&typeof item.url==='string'&&typeof item.count==='string'))return saved.items;}catch{}
    const pending=this.withMirror(async base=>{
      const {parseCollectionPage}=await import('./parser'),items:Collection[]=[],seen=new Set<string>();
      for(let page=1;page<=100;page++){
        const response=await this.request(catalogueURL(new URL('collections/',base).href,page));
        const data=parseCollectionPage(response.text,response.url,page),fresh=data.items.filter(item=>!seen.has(new URL(item.url).pathname));
        if(!fresh.length&&data.hasNext)throw new Error('Collections could not be loaded completely. Try again.');
        for(const item of fresh){seen.add(new URL(item.url).pathname);items.push(item);}
        if(!data.hasNext){if(!items.length)throw new Error('No collections are available on this mirror.');try{localStorage.setItem(cacheKey,JSON.stringify({time:Date.now(),items}));}catch{}return items;}
      }
      throw new Error('The collection list could not be completed. Try another mirror.');
    });
    this.collectionIndexPending=pending;
    try{return await pending;}finally{if(this.collectionIndexPending===pending)this.collectionIndexPending=undefined;}
  }
  async comments(item:Item,page=1) {
    if(!item.page)return {comments:[],hasNext:false};
    return this.withMirror(async base=>{const r=await this.request(new URL(`ajax/get_comments/?t=${Date.now()}`,base).href,{news_id:item.id,cstart:String(page),type:'0',comment_id:'0',skin:'hdrezka'},this.rebase(item.page!,base));let html=r.text;try{const data=JSON.parse(html);if(data.success===false)throw new Error(data.message||'Comments are unavailable.');html=(data.comments||data.html||'')+(data.navigation||'');}catch(e){if(!html.trim().startsWith('<'))throw e;}const {parseComments}=await import('./parser');return parseComments(html,base);});
  }
  async person(url:string) {return this.withMirror(async base=>{const r=await this.request(this.rebase(url,base));const {parsePerson}=await import('./parser');return parsePerson(r.text,r.url);});}
}
