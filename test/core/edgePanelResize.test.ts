import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindEdgePanelResize } from '@/core/dom/edgePanelResize';
const cleanup: (()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).forEach(stop=>stop());document.body.replaceChildren();vi.restoreAllMocks();});
function create(){
  const parent=document.createElement('div'),panel=parent.appendChild(document.createElement('nav')),handle=panel.appendChild(document.createElement('div'));
  document.body.append(parent);let preferred=220,maximum=480;
  const commit=vi.fn((width:number)=>{preferred=width;});
  const control=bindEdgePanelResize(panel,handle,{preferredWidth:()=>preferred,limits:()=>({min:200,max:maximum}),commit});cleanup.push(control.destroy);
  const pointer=(target:EventTarget,type:string,x:number)=>target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,button:0}));
  return {panel,handle,commit,control,pointer,setMax:(value:number)=>{maximum=value;}};
}
describe('navigation width gesture',()=>{
  it('previews locally and writes its preference once on release',async()=>{
    const {panel,handle,commit,pointer}=create();pointer(handle,'pointerdown',500);pointer(window,'pointermove',420);
    await new Promise(requestAnimationFrame);expect(panel.style.getPropertyValue('--edge-panel-width')).toBe('300px');expect(commit).not.toHaveBeenCalled();
    pointer(window,'pointerup',420);expect(commit).toHaveBeenCalledExactlyOnceWith(300);expect(document.body.style.cursor).toBe('');
  });
  it('cancels with Escape and preserves the preference through temporary viewport clamps',async()=>{
    const {panel,handle,commit,pointer,setMax,control}=create();pointer(handle,'pointerdown',500);pointer(window,'pointermove',400);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));expect(commit).not.toHaveBeenCalled();expect(panel.style.getPropertyValue('--edge-panel-width')).toBe('220px');
    setMax(160);control.refresh();await new Promise(requestAnimationFrame);expect(panel.style.getPropertyValue('--edge-panel-width')).toBe('160px');
    setMax(480);control.refresh();await new Promise(requestAnimationFrame);expect(panel.style.getPropertyValue('--edge-panel-width')).toBe('220px');
  });
  it('supports keyboard resizing and releases document styles on disposal',()=>{
    const {panel,handle,commit,pointer,control}=create();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));expect(commit).toHaveBeenLastCalledWith(230);
    pointer(handle,'pointerdown',400);control.destroy();expect(document.body.style.cursor).toBe('');expect(panel.style.getPropertyValue('--edge-panel-width')).toBe('');
  });
});
