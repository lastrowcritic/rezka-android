import { afterEach,describe,expect,it,vi } from 'vitest';
import { focus,installRemote } from '../src/core/focus';
let cleanup:(()=>void)|undefined;
afterEach(()=>{cleanup?.();cleanup=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
const press=(key:string)=>window.dispatchEvent(new KeyboardEvent('keydown',{key,cancelable:true}));
const active=()=>document.activeElement as HTMLElement;
function audioRow(ids:string[]){
  vi.stubGlobal('CSS',{escape:(value:string)=>value});
  document.body.innerHTML=`<div class="app-shell"><button class="nav-item" aria-current="page" data-focus-id="nav-home">Home</button><main class="main-scroll"><section class="detail-section audio-section" data-focus-context="true"><div class="chip-row wrap" data-focus-group="detail-audio-1" data-focus-axis="row">${ids.map((id,i)=>`<button data-focus-id="${id}" data-index="${i}">Audio ${i}</button>`).join('')}</div></section></main></div>`;
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  cleanup=installRemote(()=>{});
}
describe('audio choices on the remote',()=>{
  it('reaches every audio choice even when the source repeats a translator id',()=>{
    audioRow(['translator-1','translator-56','translator-56','translator-7']);
    focus('translator-1');
    const seen=[active().dataset.index];
    for(let i=0;i<3;i++){press('ArrowRight');seen.push(active().dataset.index);}
    expect(seen).toEqual(['0','1','2','3']);
    press('ArrowLeft');press('ArrowLeft');
    expect(active().dataset.index).toBe('1');
  });
  it('leaves the default dub when its director cut shares the id (Harry Potter 1: 56, 56, 88)',()=>{
    audioRow(['translator-56','translator-56','translator-88']);
    focus('translator-56');
    press('ArrowRight');press('ArrowRight');
    expect(active().dataset.index).toBe('2');
  });
});
