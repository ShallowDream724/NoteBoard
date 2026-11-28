import { create } from 'zustand';
import * as ipc from '../../core/ipc/commands';
import { showToast } from '../../stores/toastStore';
import { refreshExplorerDirectory } from './explorerActions';
import { explorerMoveDestination } from './explorerDrop';
import { importExplorerEntries, moveExplorerEntries } from './explorerMoveHistory';
import { useExplorerStore } from './explorerStore';
import { isSubPath, normalizePath, parentBrowsePath, sameKey } from './pathUtils';

type PendingCut = { path: string; sequence: number };
const usePendingCut = create<{ value: PendingCut | null }>(() => ({ value: null }));
let writing: Promise<boolean> | null = null;
let pasting = false;

export function useExplorerPendingCut(path: string): boolean {
  return usePendingCut(state => sameKey(state.value?.path, path));
}

export function forgetExplorerCut(sequence?: number): void {
  usePendingCut.setState(state => sequence === undefined || state.value?.sequence === sequence ? { value: null } : state);
}

export function setExplorerFileClipboard(path: string, cut: boolean): Promise<boolean> {
  const previous = writing;
  const work = (async () => {
    if (previous) await previous;
    try {
      const sequence = await ipc.writeFileClipboard([path], cut);
      usePendingCut.setState({ value: cut ? { path, sequence } : null });
      return true;
    } catch (error) {
      showToast(`无法${cut ? '剪切' : '复制'}文件：${String(error)}`, 'error');
      return false;
    }
  })().finally(() => { if (writing === work) writing = null; });
  writing = work;
  return work;
}

/** An external clipboard change never leaves the tree cut selection actionable. */
export function watchExplorerCut(window: Window): () => void {
  const recheck = async () => {
    const pending = usePendingCut.getState().value;
    if (!pending) return;
    try {
      const current = await ipc.readFileClipboard();
      if (!current?.cut || current.sequence !== pending.sequence) forgetExplorerCut(pending.sequence);
    } catch {
      // The next clipboard operation rechecks if the system was temporarily busy.
    }
  };
  const clear = () => forgetExplorerCut();
  void recheck();
  window.addEventListener('focus', recheck);
  window.addEventListener('copy', clear);
  window.addEventListener('cut', clear);
  return () => {
    window.removeEventListener('focus', recheck);
    window.removeEventListener('copy', clear);
    window.removeEventListener('cut', clear);
  };
}

export function explorerClipboardTarget(tree: HTMLElement, target: EventTarget | null, root: string) {
  if (!(target instanceof HTMLElement) || !tree.contains(target)
    || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-shortcuts-suspended]')) return null;
  const row = target.closest<HTMLElement>('[data-explorer-row]');
  if (!row && (target !== tree && !target.closest('.nb-vertical-scroll-viewport') || target.closest('button, [role="scrollbar"]'))) return null;
  const path = row?.dataset.explorerRow;
  const directory = !path ? root : row?.dataset.explorerDirectory === 'true' ? path : parentBrowsePath(path);
  return directory ? { path, directory } : null;
}

async function moveClipboardPaths(paths: readonly string[], directory: string, isCurrent: () => boolean) {
  const failures: string[] = [];
  const plans = [];
  for (const from of paths) {
    try {
      const entry = await ipc.pathExists(from);
      if (!entry.exists) throw new Error('源文件或文件夹已不存在');
      const plan = explorerMoveDestination({ path: from, directory: entry.isDir }, directory);
      if (!plan.path) throw new Error(plan.reason);
      plans.push({ from, to: plan.path, directory: entry.isDir });
    } catch (error) {
      failures.push(`${from.split(/[\\/]/).pop()}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isCurrent()) return null;
  const result = plans.length ? await moveExplorerEntries(plans) : { moved: 0, undoable: 0, failures: [] };
  return {
    completed: result.moved, undoable: result.undoable,
    firstPath: result.moved && !result.failures.length ? plans[0]?.to : undefined,
    failures: [...failures, ...result.failures],
  };
}

async function refreshPaste(destination: string, sources: readonly string[], firstPath: string | undefined, isCurrent: () => boolean): Promise<boolean> {
  if (!isCurrent()) return true;
  const directories = new Set([destination, ...sources.map(parentBrowsePath).filter(path => path !== null)]);
  const results = await Promise.allSettled([...directories].map(refreshExplorerDirectory));
  if (results[0].status === 'fulfilled' && firstPath && isCurrent()) {
    const store = useExplorerStore.getState();
    const children = store.getChildren(destination);
    if (children && !sameKey(store.root, destination)) store.expand(destination, children);
    store.setRevealed(firstPath, false);
  }
  return results.every(result => result.status === 'fulfilled');
}

export async function pasteExplorerFiles(directory: string, notifyEmpty = false): Promise<void> {
  if (pasting) return;
  const revision = useExplorerStore.getState().rootRevision;
  const isCurrent = () => {
    const { root, rootRevision } = useExplorerStore.getState();
    return rootRevision === revision && isSubPath(root, directory);
  };
  if (!isCurrent()) return;
  pasting = true;
  try {
    if (writing && !await writing) return;
    const clipboard = await ipc.readFileClipboard();
    const pending = usePendingCut.getState().value;
    if (pending && (!clipboard?.cut || pending.sequence !== clipboard.sequence)) forgetExplorerCut(pending.sequence);
    if (!clipboard?.paths.length) {
      if (notifyEmpty) showToast('剪贴板中没有文件或文件夹', 'info');
      return;
    }
    if (!isCurrent()) return;
    const { cut, sequence } = clipboard;
    const paths = [...new Map(clipboard.paths.map(path => [normalizePath(path).toLowerCase(), path])).values()];
    const result = cut ? await moveClipboardPaths(paths, directory, isCurrent) : await importExplorerEntries(paths, directory).then(result => ({
      completed: result.copied, undoable: result.undoable, firstPath: result.firstCopy, failures: result.failures,
    }));
    if (!result) return;
    const { completed, undoable, firstPath, failures } = result;
    if (cut && completed === paths.length) {
      await ipc.consumeCutFileClipboard(sequence).catch(error => console.warn('无法清除已处理的文件剪贴板:', error));
      forgetExplorerCut(sequence);
    }
    const notes = [...failures];
    if (completed) {
      if (!await refreshPaste(directory, cut ? paths : [], firstPath, isCurrent)) notes.push('目录列表暂未刷新，请手动刷新');
      if (undoable < completed) notes.push(`${completed - undoable} 项无法撤销`);
    }
    const status = completed ? `已${cut ? '移动' : '复制'} ${completed} 项` : `未${cut ? '移动' : '复制'}文件`;
    showToast([status, ...notes.slice(0, 3)].join('；'), completed && !notes.length ? 'success' : 'warning');
  } catch (error) {
    showToast(`无法粘贴文件：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    pasting = false;
  }
}
