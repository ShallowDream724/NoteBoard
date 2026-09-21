import { readDir } from '../../core/ipc/commands';
import { useExplorerStore } from './explorerStore';
import { getPathChain, isSubPath, normalizePath, sameKey } from './pathUtils';
import { useSettingsStore } from '../../stores/settingsStore';

const pending = new Map<string, { dirty: boolean; work: Promise<void> }>();

/** An acknowledged app write updates visible directory data without waiting for OS notifications. */
export async function refreshExplorerAfterWrite(filePath: string): Promise<void> {
  const root = useExplorerStore.getState().root;
  if (!root || !isSubPath(root, filePath)) return;
  const directories = [root, ...getPathChain(root, filePath)];
  await Promise.all(directories.map((directory) => {
    const key = normalizePath(directory).toLowerCase();
    const existing = pending.get(key);
    if (existing) { existing.dirty = true; return existing.work; }
    const state = { dirty: false, work: Promise.resolve() };
    state.work = (async () => {
      do {
        state.dirty = false;
        try {
          const children = await readDir(directory, useSettingsStore.getState().settings.file.showHiddenFiles);
          if (sameKey(useExplorerStore.getState().root, root)) {
            useExplorerStore.getState().updateChildren(directory, children);
          }
        } catch {
          // A refresh error must not repeat a successful image insertion.
        }
      } while (state.dirty && sameKey(useExplorerStore.getState().root, root));
    })().finally(() => pending.delete(key));
    pending.set(key, state);
    return state.work;
  }));
}
