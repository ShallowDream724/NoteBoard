import * as ipc from '../../core/ipc/commands';
import type { ExplorerContext, FileTreeNode } from '../../core/ipc/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWindowStore } from '../../stores/windowStore';
import { useExplorerStore } from './explorerStore';
import { getPathChain, isSubPath, normalizePath, parentDirectory, sameKey } from './pathUtils';
import { refreshMarkdownAssociations } from '../document-format/markdownAssociationIndex';

// Directory entries and bounded NB headers share one navigation/refresh request.
const reads = new Map<string, { force: boolean; work: Promise<FileTreeNode[]> }>();
const directoryReadKey = (path: string) => `${useExplorerStore.getState().rootRevision}:${useSettingsStore.getState().settings.file.showHiddenFiles}:${normalizePath(path).toLowerCase()}`;
export function readExplorerDirectory(path: string, forceAssociations = false): Promise<FileTreeNode[]> {
  const hidden = useSettingsStore.getState().settings.file.showHiddenFiles;
  const key = directoryReadKey(path);
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

export function currentExplorerNavigation(): ExplorerNavigation {
  return { revision: revealRevision, rootRevision: useExplorerStore.getState().rootRevision };
}

/** Reserve before document preparation so an older directory read cannot win. */
export function beginExplorerNavigation(filePath?: string): ExplorerNavigation {
  revealRevision += 1;
  const request = currentExplorerNavigation();
  parentNavigation = filePath ? { filePath, request, work: null } : null;
  return request;
}

export function isCurrentNavigation(request: ExplorerNavigation): boolean {
  return request.revision === revealRevision && request.rootRevision === useExplorerStore.getState().rootRevision;
}

export async function openExplorerDirectory(directory: string, request = beginExplorerNavigation()): Promise<void> {
  if (!directory.trim() || !isCurrentNavigation(request)) return;
  const children = await readExplorerDirectory(directory);
  if (!isCurrentNavigation(request)) return;
  useExplorerStore.getState().setWorkspaceRoot(directory);
  useExplorerStore.getState().setRoot(directory, children);
}

/** Breadcrumb navigation belongs to the active tab; opening a folder pins a workspace. */
export async function navigateExplorerDirectory(directory: string): Promise<void> {
  const request = beginExplorerNavigation();
  const activeKey = useWindowStore.getState().activeKey;
  const children = await readExplorerDirectory(directory);
  if (!isCurrentNavigation(request) || useWindowStore.getState().activeKey !== activeKey) return;
  useExplorerStore.getState().setRoot(directory, children);
  if (activeKey) useWindowStore.getState().setTabExplorerContext(activeKey, { root: directory, source: 'locate' });
}

/** Capture at the request/click boundary, before asynchronous document preparation. */
export function captureExplorerContext(filePath: string, treeRoot?: string, directParent = false): ExplorerContext {
  const { root, workspaceRoot } = useExplorerStore.getState();
  if (workspaceRoot && isSubPath(workspaceRoot, filePath)) return { root: workspaceRoot, source: 'workspace' };
  if (treeRoot && isSubPath(treeRoot, filePath)) return { root: treeRoot, source: 'tree' };
  if (workspaceRoot) return { root: workspaceRoot, source: 'workspace' };
  if (!directParent && root && isSubPath(root, filePath)) return { root, source: 'tree' };
  return { root: parentDirectory(filePath), source: 'parent' };
}

function targetRoot(filePath: string, directory: string, explicit: boolean): string {
  const { root, workspaceRoot } = useExplorerStore.getState();
  const context = useWindowStore.getState().getTab(filePath)?.explorerContext;
  if (workspaceRoot && isSubPath(workspaceRoot, filePath)) return workspaceRoot;
  if (explicit) {
    if (context?.root && isSubPath(context.root, filePath)) return context.root;
    if (root && isSubPath(root, filePath)) return root;
    return directory;
  }
  if (workspaceRoot) {
    if (context && (context.source === 'tree' || context.source === 'locate') && isSubPath(context.root, filePath)) return context.root;
    return workspaceRoot;
  }
  if (context?.root && isSubPath(context.root, filePath)) return context.root;
  return root && isSubPath(root, filePath) ? root : directory;
}

let parentNavigation: { filePath: string; request: ExplorerNavigation; work: Promise<void> | null } | null = null;
let preservedActivation: { filePath: string; unsubscribe: () => void } | null = null;

function clearPreservedActivation(): void {
  preservedActivation?.unsubscribe();
  preservedActivation = null;
}

/** The activation owns this policy until the user leaves the tab, including delayed React effects. */
export function activateWithExplorerPolicy(filePath: string, policy: 'follow' | 'preserve', activate: () => void): void {
  clearPreservedActivation();
  if (policy === 'preserve') {
    beginExplorerNavigation(); // Invalidate an older pending reveal before activating the new tab.
    preservedActivation = {
      filePath,
      unsubscribe: useWindowStore.subscribe(state => {
        if (!sameKey(state.activeKey, filePath)) clearPreservedActivation();
      }),
    };
  }
  try { activate(); }
  finally {
    if (!sameKey(useWindowStore.getState().activeKey, filePath)) clearPreservedActivation();
  }
}

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

/** Deferred open following respects the workspace and the tab's captured origin. */
export function openExplorerFileParent(filePath: string, directory: string, request: ExplorerNavigation, isCurrent: () => boolean): Promise<void> {
  const current = () => isCurrentNavigation(request) && isCurrent();
  if (!filePath.trim() || !directory.trim() || !current()) return Promise.resolve();
  const navigation = { filePath, request, work: Promise.resolve() };
  parentNavigation = navigation;
  navigation.work = (async () => {
    await afterDocumentPaint();
    if (!current()) return;
    await revealFile(filePath, directory, request, isCurrent, false);
  })().finally(() => { if (parentNavigation === navigation) parentNavigation = null; });
  return navigation.work;
}

/** Passive React effects must not supersede an explicit open still preparing or following. */
export function followExplorerFile(filePath: string, directory: string, isCurrent: () => boolean): Promise<void> {
  if (preservedActivation && sameKey(preservedActivation.filePath, filePath)) return Promise.resolve();
  if (parentNavigation && isCurrentNavigation(parentNavigation.request)) {
    if (!parentNavigation.work) return Promise.resolve();
    if (sameKey(parentNavigation.filePath, filePath)) return parentNavigation.work;
  }
  return revealFile(filePath, directory, beginExplorerNavigation(), isCurrent, false);
}

/** Explicit Locate may leave the workspace, and saves only this tab's navigation. */
export async function revealExplorerFile(filePath: string, directory: string, isCurrent: () => boolean = () => true): Promise<void> {
  return revealFile(filePath, directory, beginExplorerNavigation(), isCurrent, true);
}

/** A completed write must not rely on a watcher or reuse a pre-write directory snapshot. */
export function revealWrittenExplorerFile(filePath: string, directory: string, isCurrent: () => boolean, expandAssociation = false): Promise<void> {
  const request = beginExplorerNavigation(filePath);
  const current = () => isCurrentNavigation(request) && isCurrent();
  const navigation = { filePath, request, work: Promise.resolve() };
  parentNavigation = navigation;
  navigation.work = (async () => {
    await afterDocumentPaint();
    if (!current()) return;
    if (!isSubPath(targetRoot(filePath, directory, false), filePath)) {
      await revealFile(filePath, directory, request, isCurrent, false);
      return;
    }
    // Let a read started before the write settle, then request a fresh snapshot.
    await reads.get(directoryReadKey(directory))?.work.catch(() => undefined);
    if (!current()) return;
    const children = await readExplorerDirectory(directory, true);
    if (!current()) return;
    await revealFile(filePath, directory, request, isCurrent, false, children, expandAssociation);
  })().finally(() => { if (parentNavigation === navigation) parentNavigation = null; });
  return navigation.work;
}

async function revealFile(filePath: string, directory: string, request: ExplorerNavigation, isCurrent: () => boolean,
  explicit: boolean, freshChildren?: FileTreeNode[], expandAssociation = false): Promise<void> {
  const root = targetRoot(filePath, directory, explicit);
  const current = () => isCurrentNavigation(request) && isCurrent();
  if (!root || !filePath.trim() || !current()) return;
  if (!sameKey(useExplorerStore.getState().root, root)) {
    const children = sameKey(root, directory) && freshChildren ? freshChildren
      : useExplorerStore.getState().getChildren(root) ?? await readExplorerDirectory(root);
    if (!current()) return;
    useExplorerStore.getState().setRoot(root, children);
    request.rootRevision = useExplorerStore.getState().rootRevision;
  }
  if (!isSubPath(root, filePath)) {
    useExplorerStore.getState().setRevealed(null, false);
    return;
  }
  if (freshChildren) useExplorerStore.getState().updateChildren(directory, freshChildren);
  for (const dir of getPathChain(root, filePath)) {
    if (!current()) return;
    if (!useExplorerStore.getState().isExpanded(dir)) {
      const children = useExplorerStore.getState().getChildren(dir) ?? await readExplorerDirectory(dir);
      if (!current()) return;
      useExplorerStore.getState().expand(dir, children);
    }
  }
  if (current()) {
    if (expandAssociation) useExplorerStore.getState().expandAssociation(filePath);
    useExplorerStore.getState().setRevealed(filePath, true);
    if (explicit) useWindowStore.getState().setTabExplorerContext(filePath, { root, source: 'locate' });
  }
}
