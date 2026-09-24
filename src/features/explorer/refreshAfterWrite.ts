import { useExplorerStore } from './explorerStore';
import { getPathChain, isSubPath } from './pathUtils';
import { refreshExplorerDirectory } from './explorerActions';

/** An acknowledged app write updates visible directory data without waiting for OS notifications. */
export async function refreshExplorerAfterWrite(filePath: string): Promise<void> {
  const root = useExplorerStore.getState().root;
  if (!root || !isSubPath(root, filePath)) return;
  const directories = [root, ...getPathChain(root, filePath)];
  // Ordered ancestor updates also make newly created directories discoverable.
  for (const directory of directories) {
    try { await refreshExplorerDirectory(directory); }
    catch { /* A refresh error must not repeat a successful write. */ }
  }
}
