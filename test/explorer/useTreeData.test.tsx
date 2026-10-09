import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTreeData } from '@/features/explorer/useTreeData';
import { useExplorerStore } from '@/features/explorer/explorerStore';
import { readDir } from '@/core/ipc/commands';
import type { FileTreeNode } from '@/core/ipc/types';

vi.mock('@/core/ipc/commands', () => ({ readDir: vi.fn() }));
vi.mock('@/core/nativeDocumentIO', () => ({ readNativeHeaders: vi.fn().mockResolvedValue([]) }));
let root: Root;
let tree: ReturnType<typeof useTreeData>;
function Probe() { tree = useTreeData(); return null; }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(readDir).mockReset();
  useExplorerStore.getState().clear();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe/>));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('discards an expansion read even when its old root is revisited before it completes', async () => {
  let complete!: (nodes: FileTreeNode[]) => void;
  vi.mocked(readDir).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  await act(async () => useExplorerStore.getState().setRoot('C:\\a', []));
  let pending!: Promise<void>;
  await act(async () => { pending = tree.toggle('C:\\a\\nested'); });
  await act(async () => {
    useExplorerStore.getState().setRoot('C:\\b', []);
    useExplorerStore.getState().setRoot('C:\\a', []);
    complete([]); await pending;
  });
  expect(useExplorerStore.getState().isExpanded('C:\\a\\nested')).toBe(false);
  expect(useExplorerStore.getState().getChildren('C:\\a\\nested')).toBeUndefined();
  expect(useExplorerStore.getState().loading).toBe(false);
  expect(useExplorerStore.getState().children.size).toBe(1);
});
