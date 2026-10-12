import { describe, expect, it } from 'vitest';
import { clearSession, mergeHistory, normalizeSyncServer, saveSession, storedSession } from '../src/core/sync';
import { continueWatching, loadState, resumePosition, STORE_KEY } from '../src/core/store';
// Shape of a movie and an episode saved by the iPhone, as returned by the previous sync API.
const iosMovie={item:{id:'777',title:'iOS Film',kind:'movie',genre:'Drama',synopsis:'',symbol:'I',paletteIndex:0,poster:'https://example.com/p.jpg',posterURL:'https://example.com/p.jpg',
  rezka:{movieID:'777',pageURL:'https://hdrezka.me/films/drama/777-ios-film.html',isSeries:false,translators:[{id:'56',name:'Dub',isPremium:false,isSelected:true,flags:{}}],seasons:[],playerFlags:{}}},
  position:600,duration:6000,updatedAt:5000,completed:false,translator:'56',translatorID:'56'};
const iosEpisode={item:{id:'9',title:'iOS Series',kind:'series',genre:'',synopsis:'',symbol:'S',paletteIndex:0,
  rezka:{movieID:'9',pageURL:'https://hdrezka.me/series/9-s.html',isSeries:true,translators:[],seasons:[{id:'2',title:'Season 2',episodes:[{id:'4',title:'Four',seasonID:'2'}]}],playerFlags:{}}},
  position:300,duration:2400,updatedAt:6000,completed:false,seasonID:'2',episodeID:'4'};
describe('records synced from iOS',()=>{
  it('can be opened and resumed from Continue watching',()=>{
    const history=mergeHistory([],[iosMovie,iosEpisode] as never,0),movie=history.find(r=>r.item.id==='777')!,episode=history.find(r=>r.item.id==='9')!;
    expect(movie.item.page).toBe('https://hdrezka.me/films/drama/777-ios-film.html');
    expect(movie.item.rezkaID).toBe('777');expect(movie.item.isSeries).toBe(false);
    expect(movie.item.translators).toEqual([{id:'56',name:'Dub',selected:true,premium:false}]);
    expect(resumePosition(history,movie.item,{translator:'56'})).toBe(600);
    expect(episode.item.isSeries).toBe(true);expect(episode.season).toBe('2');expect(episode.episode).toBe('4');
    expect(episode.item.seasons?.[0].episodes[0]).toEqual({id:'4',title:'Four',season:'2'});
    expect(resumePosition(history,episode.item,{season:'2',episode:'4'})).toBe(300);
    expect(continueWatching(history).map(r=>r.item.id)).toEqual(['9','777']);
  });
  it('are repaired when already saved on the device',()=>{
    const saved=JSON.stringify({history:[iosMovie]}),state=loadState({getItem:key=>key===STORE_KEY?saved:null});
    expect(state.history[0].item.page).toBe('https://hdrezka.me/films/drama/777-ios-film.html');
  });
});
describe('sync server address',()=>{
  it('is off when empty and keeps any path on the server',()=>{
    expect(normalizeSyncServer('  ')).toBe('');
    expect(normalizeSyncServer('sync.example.com')).toBe('https://sync.example.com');
    expect(normalizeSyncServer('https://Example.com/rezka-sync/ ')).toBe('https://example.com/rezka-sync');
  });
  it('only accepts https addresses without extras',()=>{
    expect(()=>normalizeSyncServer('http://sync.example.com')).toThrow(/https/);
    expect(()=>normalizeSyncServer('https://user:pass@sync.example.com')).toThrow();
    expect(()=>normalizeSyncServer('https://sync.example.com/?a=1')).toThrow();
  });
  it('never hands a session to a different server',async()=>{
    await saveSession({token:'t',email:'a@b.c',expiresAt:1,server:'https://one.example.com'});
    expect((await storedSession('https://one.example.com'))?.token).toBe('t');
    expect(await storedSession('https://two.example.com')).toBeNull();
    await clearSession();
    expect(await storedSession('https://one.example.com')).toBeNull();
  });
});
