import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindExplorerDrop, explorerMoveDestination } from '@/features/explorer/explorerDrop';
import { useExplorerStore } from '@/features/explorer/explorerStore';
import { routeNativeFileDrop } from '@/core/editor/fileDropTargets';
import { renameOpenPath } from '@/features/explorer/renameOpenPath';
import { copyPathIntoDirectory } from '@/core/ipc/commands';
import { refreshExplorerDirectory } from '@/features/explorer/explorerActions';
import { useToastStore } from '@/stores/toastStore';
vi.mock('@/features/explorer/renameOpenPath',()=>({renameOpenPath:vi.fn(async()=>{})}));
vi.mock('@/features/explorer/explorerActions',()=>({readExplorerDirectory:vi.fn(async()=>[]),refreshExplorerDirectory:vi.fn(async()=>{})}));
vi.mock('@/core/ipc/commands',()=>({copyPathIntoDirectory:vi.fn(async()=> 'C:\\work\\folder\\a.md')}));
const stops:(()=>void)[]=[];
afterEach(()=>{stops.splice(0).forEach(stop=>stop());document.body.replaceChildren();vi.restoreAllMocks();vi.clearAllMocks();});
function create(){
  useExplorerStore.setState({root:'C:\\work'});
  const root=document.createElement('div');root.innerHTML='<div data-explorer-row="C:\\work\\a.md">A</div><div data-explorer-row="C:\\work\\folder" data-explorer-directory="true">Folder</div>';
  document.body.append(root);const [file,folder]=[...root.children] as HTMLElement[];let hit:Element=root;
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:vi.fn(()=>hit)});
  const stop=bindExplorerDrop(root,'C:\\work');stops.push(stop);
  const pointer=(target:EventTarget,type:string,x:number)=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:20,button:0});Object.defineProperty(e,'pointerId',{value:1});target.dispatchEvent(e);};
  return {root,file,folder,pointer,setHit:(value:Element)=>{hit=value;}};
}
describe('workspace drop targeting',()=>{
  it('rejects self/descendant/no-op destinations with a component boundary',()=>{
    expect(explorerMoveDestination({path:'C:\\work\\a',directory:true},'c:\\work\\A\\child').reason).toBeTruthy();
    expect(explorerMoveDestination({path:'C:\\work\\a.md',directory:false},'C:\\work').reason).toBeTruthy();
    expect(explorerMoveDestination({path:'C:\\work\\a',directory:true},'C:\\work\\abc').path).toBe('C:\\work\\abc\\a');
  });
  it('preserves ordinary clicks and moves exactly once after a real drag to the highlighted folder',async()=>{
    const {file,folder,pointer,setHit}=create();const click=vi.fn();file.addEventListener('click',click);
    pointer(file,'pointerdown',10);pointer(window,'pointerup',10);file.click();expect(click).toHaveBeenCalledOnce();expect(renameOpenPath).not.toHaveBeenCalled();
    setHit(folder);pointer(file,'pointerdown',10);pointer(window,'pointermove',50);await new Promise(requestAnimationFrame);
    expect(folder.dataset.dropTarget).toBe('move');expect(document.querySelector('.nb-explorer-drop-feedback')?.textContent).toContain('C:\\work\\folder');
    pointer(window,'pointerup',50);await new Promise(resolve=>setTimeout(resolve,0));
    expect(renameOpenPath).toHaveBeenCalledExactlyOnceWith('C:\\work\\a.md','C:\\work\\folder\\a.md',false);expect(folder.hasAttribute('data-drop-target')).toBe(false);
    file.click();expect(click).toHaveBeenCalledOnce();
  });
  it('cancels an active drag without moving files or leaving page styles behind',async()=>{
    const {file,folder,pointer,setHit}=create();setHit(folder);pointer(file,'pointerdown',1);pointer(window,'pointermove',50);await new Promise(requestAnimationFrame);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));pointer(window,'pointerup',50);
    expect(renameOpenPath).not.toHaveBeenCalled();expect(document.body.style.cursor).toBe('');expect(folder.hasAttribute('data-drop-target')).toBe(false);
  });
  it('reports a completed move accurately if refreshing the directory fails',async()=>{
    const {file,folder,pointer,setHit}=create();setHit(folder);
    vi.mocked(refreshExplorerDirectory).mockRejectedValueOnce(new Error('unavailable'));
    pointer(file,'pointerdown',1);pointer(window,'pointermove',50);pointer(window,'pointerup',50);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(renameOpenPath).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({type:'warning',message:expect.stringContaining('已移动到')});
  });
  it('claims non-image native drops only inside the workspace and copies instead of moving originals',async()=>{
    const {folder,setHit}=create();setHit(folder);
    expect(routeNativeFileDrop({type:'enter',paths:['D:\\a.md'],position:{x:40,y:40}})).toBe(true);
    expect(folder.dataset.dropTarget).toBe('copy');
    expect(routeNativeFileDrop({type:'drop',paths:['D:\\a.md'],position:{x:40,y:40}})).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,0));expect(copyPathIntoDirectory).toHaveBeenCalledExactlyOnceWith('D:\\a.md','C:\\work\\folder');expect(renameOpenPath).not.toHaveBeenCalled();
    setHit(document.body);expect(routeNativeFileDrop({type:'enter',paths:['D:\\a.md'],position:{x:40,y:40}})).toBe(false);
  });
});
