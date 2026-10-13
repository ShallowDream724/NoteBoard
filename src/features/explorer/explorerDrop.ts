import { copyPathIntoDirectory } from '../../core/ipc/commands';
import { registerNativeFileDropTarget, type FileDropPoint } from '../../core/editor/fileDropTargets';
import { createDragEdgeScroller, type DragEdgeScroller } from '../../core/dom/dragEdgeScroll';
import { useExplorerStore } from './explorerStore';
import { isSubPath, normalizePath, parentDirectory, sameKey } from './pathUtils';
import { refreshExplorerDirectory } from './explorerActions';
import { createSpringFolders } from './springFolders';
import { renameOpenPath } from './renameOpenPath';
import { showToast } from '../../stores/toastStore';

export interface ExplorerDragSource { path: string; directory: boolean }
export function explorerMoveDestination(source: ExplorerDragSource, directory: string): { path?: string; reason?: string } {
  const from = normalizePath(source.path), folder = normalizePath(directory);
  const name = from.split('\\').pop();
  if (!folder || !name || /^[a-z]:$/i.test(name)) return { reason:'不能移动磁盘根目录' };
  if (source.directory && isSubPath(from, folder)) return { reason:'不能移入自身或子文件夹' };
  if (sameKey(parentDirectory(from), folder)) return { reason:'已在这个文件夹中' };
  return { path:folder.replace(/\\$/, '') + '\\' + name };
}

/** Refresh failure cannot turn a completed filesystem operation into a failure. */
async function refreshDropDirectories(...directories: string[]): Promise<boolean> {
  const results = await Promise.allSettled(directories.map(refreshExplorerDirectory));
  return results.every(result => result.status === 'fulfilled');
}

/** One delegated pointer session for the tree; no per-row drag subscriptions. */
export function bindExplorerDrop(root: HTMLElement, workspace: string) {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const feedback = doc.createElement('div'); feedback.className = 'nb-explorer-drop-feedback'; feedback.hidden = true;
  feedback.setAttribute('role','status'); feedback.setAttribute('aria-live','polite'); doc.body.append(feedback);
  let marked: HTMLElement | null = null;
  let session: { id:number; x:number; y:number; source:ExplorerDragSource; started:boolean; cursor:string; select:string } | null = null;
  let point: FileDropPoint = {x:0,y:0}, frame = 0, scroller: DragEdgeScroller | null = null, suppressClick = false, busy = false, disposed = false;
  const validWorkspace = () => !disposed && sameKey(useExplorerStore.getState().root, workspace) && root.isConnected;
  const spring = createSpringFolders(workspace, validWorkspace);
  const clear = () => {
    marked?.removeAttribute('data-drop-target'); marked = null;
    spring.clear(); feedback.hidden = true;
    if (!session?.started) { scroller?.stop(); scroller = null; }
  };
  const destination = (at: FileDropPoint) => {
    const hit = doc.elementFromPoint(at.x,at.y);
    if (!validWorkspace() || !hit || !root.contains(hit) || hit.closest('input,textarea,[role="scrollbar"]')) return null;
    const row = hit.closest<HTMLElement>('[data-explorer-row]');
    if (!row && hit.closest('button')) return null;
    // A file row is a drop into its containing folder, not an invalid target.
    const directory = row?.dataset.explorerDirectory === 'true' ? row.dataset.explorerRow!
      : row?.dataset.explorerRow ? parentDirectory(row.dataset.explorerRow) : workspace;
    const parentRow = row?.closest('[role="treeitem"]')?.parentElement?.closest('[role="treeitem"]')?.querySelector<HTMLElement>('[data-explorer-row]');
    const element = row?.dataset.explorerDirectory === 'true' ? row : sameKey(directory, workspace) ? root
      : parentRow && sameKey(parentRow.dataset.explorerRow ?? '', directory) ? parentRow : row ?? root;
    return { directory, element };
  };
  const show = (at: FileDropPoint, mode:'copy'|'move', source?: ExplorerDragSource) => {
    const target = destination(at), plan = target && source ? explorerMoveDestination(source,target.directory) : undefined;
    const allowed = Boolean(target && !plan?.reason);
    const next = allowed ? target!.element : null;
    if (marked !== next) { marked?.removeAttribute('data-drop-target'); marked=next; marked?.setAttribute('data-drop-target',mode); }
    const text = allowed ? `${mode==='move'?'移动到':'复制到'}：${target!.directory}` : plan?.reason ?? '请放到工作区内的文件或文件夹上';
    if (feedback.textContent !== text) feedback.textContent = text;
    feedback.dataset.allowed = String(allowed); feedback.hidden = false;
    feedback.style.left = `${Math.max(8,Math.min(at.x+16,win.innerWidth-328))}px`;
    feedback.style.top = `${Math.max(8,Math.min(at.y+16,win.innerHeight-70))}px`;
    spring.hover(allowed ? target!.directory : undefined);
    return allowed ? { directory:target!.directory, path:plan?.path } : null;
  };
  const autoScroll = (at: FileDropPoint, repaint:()=>void) => {
    const viewport = root.querySelector<HTMLElement>('.nb-vertical-scroll-viewport');
    if (!viewport) return;
    scroller ??= createDragEdgeScroller([{element:viewport,direction:'y',edge:30,maxSpeed:650,bounds:()=>{const r=viewport.getBoundingClientRect();return {start:r.top,end:r.bottom};}}],repaint);
    const box=root.getBoundingClientRect();
    if(at.x>=box.left&&at.x<=box.right) scroller.update(at.x,at.y); else scroller.stop();
  };
  const perform = async (directory:string, source:ExplorerDragSource | readonly string[], settleExpansion: (success: boolean) => void) => {
    if (busy) { settleExpansion(false); showToast('正在处理上一次拖放，请稍候','warning'); return; }
    busy = true; let completed = false;
    try {
      if (Array.isArray(source)) {
        let copied = 0, firstCopy: string | undefined; const failures:string[]=[];
        for (const path of source) {
          try { const copy = await copyPathIntoDirectory(path,directory); firstCopy ??= copy; copied++; completed = true; }
          catch(error) { failures.push(`${path.split(/[\\/]/).pop()}：${String(error)}`); }
        }
        const refreshed = await refreshDropDirectories(directory);
        if (!refreshed) failures.push('目录列表暂未刷新，请手动刷新');
        if (refreshed && firstCopy) revealDrop(directory, firstCopy);
        showToast(failures.length ? `已复制 ${copied} 项；${failures.slice(0,2).join('；')}` : `已复制 ${copied} 项到 ${directory}`,failures.length?'warning':'success');
      } else {
        const item=source as ExplorerDragSource, plan=explorerMoveDestination(item,directory);
        if (!plan.path) throw new Error(plan.reason);
        await renameOpenPath(item.path,plan.path,item.directory);
        completed = true;
        const refreshed = await refreshDropDirectories(parentDirectory(item.path), directory);
        if (refreshed) revealDrop(directory, plan.path);
        showToast(`已移动到 ${directory}${refreshed ? '' : '；目录列表暂未刷新，请手动刷新'}`,refreshed?'success':'warning');
      }
    } catch(error) { showToast(error instanceof Error?error.message:String(error),'error'); }
    finally { settleExpansion(completed); busy=false; }
  };
  const revealDrop = (directory: string, path: string) => {
    if (!validWorkspace()) return;
    const store = useExplorerStore.getState(), children = store.getChildren(directory);
    if (!sameKey(directory, workspace) && children) store.expand(directory, children);
    store.setRevealed(path, false);
  };
  const paint = () => {frame=0;if(session?.started) show(point,'move',session.source);};
  const move = (event:PointerEvent) => {
    if (!session || event.pointerId!==session.id) return;
    point={x:event.clientX,y:event.clientY};
    if (!validWorkspace()) { finish(); return; }
    if (!session.started && Math.hypot(point.x-session.x,point.y-session.y)<5) return;
    if (!session.started) {session.started=true;root.setPointerCapture?.(session.id);doc.body.style.cursor='grabbing';doc.body.style.userSelect='none';root.dataset.dragging='true';}
    event.preventDefault();if(!frame)frame=win.requestAnimationFrame(paint);autoScroll(point,paint);
  };
  const finish = () => {
    const current=session;session=null;win.cancelAnimationFrame(frame);frame=0;
    win.removeEventListener('pointermove',move);win.removeEventListener('pointerup',up);win.removeEventListener('pointercancel',cancel);win.removeEventListener('blur',cancel);win.removeEventListener('keydown',escape,true);
    scroller?.stop();scroller=null;clear();delete root.dataset.dragging;
    if(current){doc.body.style.cursor=current.cursor;doc.body.style.userSelect=current.select;if(root.hasPointerCapture?.(current.id))root.releasePointerCapture(current.id);}
  };
  const cancel = () => {if(session?.started)suppressClick=true;finish();};
  const escape = (event:KeyboardEvent) => {if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}};
  const up = (event:PointerEvent) => {
    if(!session || session.id!==event.pointerId)return;
    const source=session.source,started=session.started;
    const target=started?show({x:event.clientX,y:event.clientY},'move',source):null;
    const settleExpansion = target ? spring.take(target.directory) : null;
    if(started){event.preventDefault();suppressClick=true;} finish();
    if(target && settleExpansion)void perform(target.directory,source,settleExpansion);
  };
  const start = (event:PointerEvent) => {
    if(event.button||session||busy||!validWorkspace()||!(event.target instanceof Element)||event.target.closest('input,button'))return;
    const row=event.target.closest<HTMLElement>('[data-explorer-row]');if(!row?.dataset.explorerRow)return;
    suppressClick=false;point={x:event.clientX,y:event.clientY};
    session={id:event.pointerId,x:point.x,y:point.y,source:{path:row.dataset.explorerRow,directory:row.dataset.explorerDirectory==='true'},started:false,cursor:doc.body.style.cursor,select:doc.body.style.userSelect};
    win.addEventListener('pointermove',move,{passive:false});win.addEventListener('pointerup',up);win.addEventListener('pointercancel',cancel);win.addEventListener('blur',cancel);win.addEventListener('keydown',escape,true);
  };
  const click = (event:MouseEvent) => {if(suppressClick){suppressClick=false;event.preventDefault();event.stopPropagation();}};
  root.addEventListener('pointerdown',start);root.addEventListener('click',click,true);root.addEventListener('lostpointercapture',cancel);
  const unregister=registerNativeFileDropTarget({
    accepts:paths=>paths.length>0,
    hover(paths,at){
      const hit=doc.elementFromPoint(at.x,at.y);if(busy||!validWorkspace()||!hit||!root.contains(hit))return false;
      point=at;show(at,'copy');autoScroll(at,()=>show(point,'copy'));return true;
    },
    drop(paths,at){
      const hit=doc.elementFromPoint(at.x,at.y);if(!validWorkspace()||!hit||!root.contains(hit))return false;
      if (busy) { clear(); showToast('正在处理上一次拖放，请稍候','warning'); return true; }
      const target=show(at,'copy');
      const settleExpansion = target && paths.length <= 256 ? spring.take(target.directory) : null;
      clear();
      if(paths.length>256)showToast('一次最多复制 256 项，请分批拖入','warning');
      else if(target && settleExpansion)void perform(target.directory,paths,settleExpansion);
      else showToast('请把文件放到工作区内的文件或文件夹上','warning');
      return true;
    }, clear,
  });
  return ()=>{spring.destroy();disposed=true;finish();unregister();feedback.remove();root.removeEventListener('pointerdown',start);root.removeEventListener('click',click,true);root.removeEventListener('lostpointercapture',cancel);};
}
