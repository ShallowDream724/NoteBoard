import * as ipc from '../../core/ipc/commands';
import type { FileTreeNode } from '../../core/ipc/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExplorerStore } from './explorerStore';
import { getPathChain, isSubPath, normalizePath, sameKey } from './pathUtils';
import { refreshMarkdownAssociations } from '../document-format/markdownAssociationIndex';

// Directory entries and bounded NB headers share one navigation/refresh request.
const reads = new Map<string, { force: boolean; work: Promise<FileTreeNode[]> }>();
export function readExplorerDirectory(path: string, forceAssociations = false): Promise<FileTreeNode[]> {
  const hidden = useSettingsStore.getState().settings.file.showHiddenFiles;
  const key = `${hidden}:${normalizePath(path).toLowerCase()}`;
  let request = reads.get(key);
  if (!request) {
    const state = { force: forceAssociations, work: Promise.resolve([] as FileTreeNode[]) };
    state.work = ipc.readDir(path, hidden).then(async nodes => { await refreshMarkdownAssociations(path, nodes, state.force); return nodes; }).finally(() => reads.delete(key));
    request = state;
    reads.set(key, request);
  } else if (forceAssociations) request.force = true;
  return request.work;
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
      const children = await readExplorerDirectory(path, true);
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
export interface ExplorerNavigation {
  revision: number;
  rootRevision: number;
}

/** Reserve before document preparation so an older directory read cannot win. */
export function beginExplorerNavigation(filePath?: string): ExplorerNavigation {
  const request = { revision: ++revealRevision, rootRevision: useExplorerStore.getState().rootRevision };
  parentNavigation = filePath ? { filePath, request, work: null } : null;
  return request;
}

function isCurrentNavigation(request: ExplorerNavigation): boolean {
  return request.revision === revealRevision && request.rootRevision === useExplorerStore.getState().rootRevision;
}

export async function openExplorerDirectory(directory: string, request = beginExplorerNavigation()): Promise<void> {
  if (!directory.trim() || !isCurrentNavigation(request)) return;
  const children = await readExplorerDirectory(directory);
  if (!isCurrentNavigation(request)) return;
  useExplorerStore.getState().setRoot(directory, children);
}

let parentNavigation: { filePath: string; request: ExplorerNavigation; work: Promise<void> | null } | null = null;

/** Failed/remote opens have no local follow-up; successful follow-ups own their cleanup. */
export function releaseExplorerNavigation(request: ExplorerNavigation): void {
  if (parentNavigation?.request === request && !parentNavigation.work) parentNavigation = null;
}

function afterDocumentPaint(): Promise<void> {
  return new Promise(resolve => {
    // The next task after rAF lets the active editor paint before cached trees or directory IO.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

/** External file opening enters its direct parent without changing sidebar visibility. */
export function openExplorerFileParent(filePath: string, directory: string, request: ExplorerNavigation, isCurrent: () => boolean): Promise<void> {
  const current = () => isCurrentNavigation(request) && isCurrent();
  if (!filePath.trim() || !directory.trim() || !current()) return Promise.resolve();
  const navigation = { filePath, request, work: Promise.resolve() };
  parentNavigation = navigation;
  navigation.work = (async () => {
    await afterDocumentPaint();
    if (!current()) return;
    const children = useExplorerStore.getState().getChildren(directory) ?? await readExplorerDirectory(directory);
    if (!current()) return;
    if (!sameKey(useExplorerStore.getState().root, directory)) {
      useExplorerStore.getState().setRoot(directory, children);
      request.rootRevision = useExplorerStore.getState().rootRevision;
    }
    useExplorerStore.getState().setRevealed(filePath, true);
  })().finally(() => { if (parentNavigation === navigation) parentNavigation = null; });
  return navigation.work;
}

/** Passive React effects must not supersede an explicit open still preparing or following. */
export function followExplorerFile(filePath: string, directory: string, isCurrent: () => boolean): Promise<void> {
  if (parentNavigation && isCurrentNavigation(parentNavigation.request)) {
    if (!parentNavigation.work) return Promise.resolve();
    if (sameKey(parentNavigation.filePath, filePath)) return parentNavigation.work;
  }
  return revealExplorerFile(filePath, directory, isCurrent);
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
