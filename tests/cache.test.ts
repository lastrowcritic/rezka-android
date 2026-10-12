import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentSource } from '../src/core/source';
import { defaults } from '../src/core/store';
import type { Item } from '../src/core/types';
import { collectionCount, sortCollections } from '../src/core/collections';

const catalogueHTML = '<div class="b-content__inline_item" data-id="42" data-url="/films/42-a-film.html"><div class="b-content__inline_item-link"><a>A film</a><div>2025, США, Драма</div></div></div>';
const film: Item = { id: '42', title: 'A film', kind: 'movie', genre: 'Drama', synopsis: '', page: 'https://rezka.example/films/42-a-film.html' };

function liveSource(html = catalogueHTML) {
  const source = new ContentSource({ ...structuredClone(defaults.settings), mode: 'live', mirror: 'https://rezka.example/' });
  vi.spyOn(source, 'withMirror').mockImplementation(operation => operation('https://rezka.example/'));
  const request = vi.spyOn(source, 'request').mockImplementation(async url => ({ status: 200, url, text: html }));
  return { source, request };
}

afterEach(() => {vi.useRealTimers();localStorage.clear();});

describe('catalogue and title cache behavior', () => {
  it('shares in-flight catalogue requests and reuses the result for one minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { source, request } = liveSource();

    const [first, second] = await Promise.all([
      source.catalogue('/films/', 1),
      source.catalogue('/films/', 1),
    ]);
    vi.setSystemTime(1_059_999);
    const third = await source.catalogue('/films/', 1);

    expect(first.items[0].title).toBe('A film');
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_060_001);
    await source.catalogue('/films/', 1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('normalizes search spacing and letter case before reusing results', async () => {
    const { source, request } = liveSource();
    const first = await source.search('  Dead Zone  ');
    const second = await source.search('dead zone');

    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('q=Dead+Zone');
  });

  it('reuses parsed title details across repeated opens', async () => {
    const detailHTML = '<div class="b-post__title"><span itemprop="name">A film</span></div><script>initCDNMoviesEvents(42,5);</script>';
    const { source, request } = liveSource(detailHTML);
    const first = await source.details(film);
    const second = await source.details(film);

    expect(second).toBe(first);
    expect(second.translators?.[0].id).toBe('5');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('drops failed catalogue entries so a later retry can fetch again', async () => {
    const { source, request } = liveSource('<html>no title cards</html>');
    await expect(source.catalogue('/films/')).rejects.toThrow('catalogue could not be read');
    request.mockImplementationOnce(async url => ({ status: 200, url, text: catalogueHTML }));

    const retried = await source.catalogue('/films/');
    expect(retried.items[0].title).toBe('A film');
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('complete collection ordering',()=>{
  const collectionPage=(id:string,count:string,next=false)=>`<div class="b-content__collections_item" data-url="/collections/${id}.html"><div class="title">Collection ${id}</div><div class="num">${count}</div></div>${next?'<div class="b-navigation"><a href="/collections/page/2/">2</a></div>':''}`;
  it('sorts numeric title counts, including grouped numbers, without changing newest order',()=>{
    expect(collectionCount('1 250 titles')).toBe(1250);
    expect(collectionCount('2\u00a0500')).toBe(2500);
    const items=[{name:'Small',url:'small',count:'5'},{name:'Large',url:'large',count:'1 250'},{name:'Medium',url:'medium',count:'73'}];
    expect(sortCollections(items,'count').map(item=>item.name)).toEqual(['Large','Medium','Small']);
    expect(sortCollections(items,'newest')).toEqual(items);
    expect(items[0].name).toBe('Small');
  });
  it('indexes every collection page before sorting and caches the complete index across opens',async()=>{
    const {source,request}=liveSource();
    request.mockImplementation(async url=>({status:200,url,text:url.includes('/page/2/')?collectionPage('older','1 250'):collectionPage('new','5',true)}));
    const [first,shared]=await Promise.all([source.collectionIndex(),source.collectionIndex()]);
    expect(shared).toBe(first);expect(first).toHaveLength(2);expect(request).toHaveBeenCalledTimes(2);
    expect(sortCollections(first,'count')[0].name).toBe('Collection older');
    const reopened=liveSource();
    expect(await reopened.source.collectionIndex()).toEqual(first);
    expect(reopened.request).not.toHaveBeenCalled();
  });
  it('does not cache a partial index after a page fails',async()=>{
    const {source,request}=liveSource(collectionPage('new','5',true));
    request.mockImplementationOnce(async url=>({status:200,url,text:collectionPage('new','5',true)})).mockRejectedValueOnce(new Error('Page unavailable'));
    await expect(source.collectionIndex()).rejects.toThrow('Page unavailable');
    expect(localStorage.getItem('rezka.collections.index.v1:rezka.example')).toBeNull();
    request.mockImplementation(async url=>({status:200,url,text:collectionPage('older','1250')}));
    expect(await source.collectionIndex()).toHaveLength(1);
  });
});
