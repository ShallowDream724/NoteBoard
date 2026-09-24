import * as ipc from '../../core/ipc/commands';
import type { FileTreeNode } from '../../core/ipc/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExplorerStore } from './explorerStore';
import { getPathChain, isSubPath, normalizePath, sameKey } from './pathUtils';

// Only directory entries are read. Concurrent reveal/watch/refresh requests share IO.
const reads = new Map<string, Promise<FileTreeNode[]>>();
export function readExplorerDirectory(path: string): Promise<FileTreeNode[]> {
  const hidden = useSettingsStore.getState().settings.file.showHiddenFiles;
  const key = `${hidden}:${normalizePath(path).toLowerCase()}`;
  let request = reads.get(key);
  if (!request) {
    request = ipc.readDir(path, hidden).finally(() => reads.delete(key));
    reads.set(key, request);
  }
  return request;
}

const refreshes = new Map<string, { dirty: boolean; work: Promise<void> }>();
export async function refreshExplorerDirectory(path: string): Promise<void> {
  const { root, rootRevision } = useExplorerStore.getState();
  if (!root || !isSubPath(root, path)) return;
  const key = `${rootRevision}:${normalizePath(path).toLowerCase()}`;
  const wasCached = !!useExplorerStore.getState().getChildren(path);
  const existing = refreshes.get(key);
  if (existing) { existing.dirty = true; return existing.work; }
  const state = { dirty: false, work: Promise.resolve() };
  state.work = (async () => {
    do {
      state.dirty = false;
      const children = await readExplorerDirectory(path);
      if (useExplorerStore.getState().rootRevision !== rootRevision) return;
      if (wasCached && !sameKey(path, root) && !useExplorerStore.getState().getChildren(path)) return;
      useExplorerStore.getState().updateChildren(path, children);
    } while (state.dirty);
  })().finally(() => refreshes.delete(key));
  refreshes.set(key, state);
  return state.work;
}

/** Refresh only directories the user has opened; no recursive discovery or state replay. */
export async function refreshExplorer(): Promise<void> {
  const { root, expanded, rootRevision } = useExplorerStore.getState();
  if (!root) return;
  const dirs = [root, ...expanded.keys()];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, dirs.length) }, async () => {
    while (cursor < dirs.length && useExplorerStore.getState().rootRevision === rootRevision) {
      const dir = dirs[cursor++];
      if (sameKey(dir, root) || useExplorerStore.getState().isExpanded(dir)) await refreshExplorerDirectory(dir);
    }
  }));
}

let revealRevision = 0;
export async function openExplorerDirectory(directory: string): Promise<void> {
  const revision = ++revealRevision;
  const { rootRevision } = useExplorerStore.getState();
  const children = await readExplorerDirectory(directory);
  if (revision !== revealRevision || useExplorerStore.getState().rootRevision !== rootRevision) return;
  useExplorerStore.getState().setRoot(directory, children);
}
/** Shared by tab following, the locate button and export completion. */
export async function revealExplorerFile(filePath: string, directory: string, isCurrent: () => boolean = () => true): Promise<void> {
  const revision = ++revealRevision;
  let root = useExplorerStore.getState().root;
  let rootRevision = useExplorerStore.getState().rootRevision;
  const current = () => revision === revealRevision && isCurrent() && useExplorerStore.getState().rootRevision === rootRevision;
  if (!root || !isSubPath(root, filePath)) {
    const children = await readExplorerDirectory(directory);
    if (!current()) return;
    useExplorerStore.getState().setRoot(directory, children);
    rootRevision = useExplorerStore.getState().rootRevision;
    root = directory;
  }
  for (const dir of getPathChain(root, filePath)) {
    if (!current()) return;
    if (!useExplorerStore.getState().isExpanded(dir)) {
      const children = useExplorerStore.getState().getChildren(dir) ?? await readExplorerDirectory(dir);
      if (!current()) return;
      useExplorerStore.getState().expand(dir, children);
    }
  }
  if (current()) useExplorerStore.getState().setRevealed(filePath, true);
}
