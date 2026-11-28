import type { SessionTabSnapshot, SessionWindowSnapshot } from '../../core/ipc/types';
import { useLayoutStore } from '../../stores/layoutStore';
import { useWindowStore } from '../../stores/windowStore';
import { isSubPath, normalizePath, sameKey } from '../explorer/pathUtils';
import { captureReadingState } from './readingState';

const prefix = 'noteboard:workspace-reading:v1:';
const changed = 'nb-workspace-reading-changed';
interface WorkspaceEntry { root: string; savedAt: number; window: SessionWindowSnapshot }
const storageKey = (root: string) => prefix + normalizePath(root).toLowerCase();

export function workspaceHistory(): WorkspaceEntry[] {
  const entries: WorkspaceEntry[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (entry && typeof entry.root === 'string' && key === storageKey(entry.root)
          && Number.isFinite(entry.savedAt) && sameKey(entry.window?.explorerWorkspaceRoot, entry.root)
          && entry.window.layout && Array.isArray(entry.window.tabs)
          && entry.window.tabs.every((t: SessionTabSnapshot) => t && typeof t.sourcePath === 'string' && isSubPath(entry.root, t.sourcePath))) entries.push(entry);
      } catch { /* Another saved workspace can still be resumed. */ }
    }
  } catch { /* Storage may be unavailable in a temporary profile. */ }
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export function clearWorkspaceHistory() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    window.dispatchEvent(new Event(changed));
  } catch { /* Optional reading history. */ }
}

export function subscribeWorkspaceHistory(refresh: () => void) {
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith(prefix)) refresh(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changed, refresh);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(changed, refresh); };
}

/** Explicit folder switches and window close are checkpoints. Never copy drafts or file bodies into recents. */
export function rememberWorkspace(root: string | null, excluded: readonly string[] = []) {
  if (!root) return;
  const { activeKey, tabs } = useWindowStore.getState();
  const layout = useLayoutStore.getState();
  const files = tabs.filter(tab => !tab.toolKind && tab.path && isSubPath(root, tab.path) && !excluded.includes(tab.key));
  const descriptors = files.map((tab): SessionTabSnapshot => ({
    key: tab.key, sourcePath: tab.path, viewMode: tab.viewMode, readingState: captureReadingState(tab.key),
    displayName: tab.displayName, isPinned: false, stagedPath: null, explorerContext: { root, source: 'workspace' },
  }));
  try {
    if (!descriptors.length) localStorage.removeItem(storageKey(root));
    else {
      const previous = !files.some(tab => sameKey(tab.key, activeKey))
        ? workspaceHistory().find(item => sameKey(item.root, root))?.window.activeKey : undefined;
      const last = descriptors.find(tab => sameKey(tab.key, activeKey) || sameKey(tab.key, previous)) ?? descriptors[0];
      const entry: WorkspaceEntry = { root, savedAt: Date.now(), window: {
        seq: 0, explorerRoot: root, explorerWorkspaceRoot: root, tabs: descriptors, activeKey: last.key,
        layout: { explorerVisible: true, explorerWidth: layout.explorerWidth, outlineVisible: layout.outlineVisible, outlineWidth: layout.outlineWidth },
      } };
      localStorage.setItem(storageKey(root), JSON.stringify(entry));
      for (const old of workspaceHistory().slice(24)) localStorage.removeItem(storageKey(old.root));
    }
    window.dispatchEvent(new Event(changed));
  } catch { /* A full profile must never interrupt closing or switching folders. */ }
}
