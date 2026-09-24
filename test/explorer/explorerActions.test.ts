import { beforeEach, expect, it, vi } from 'vitest';
import { useExplorerStore } from '../../src/features/explorer/explorerStore';
import { refreshExplorer, revealExplorerFile } from '../../src/features/explorer/explorerActions';
import { readDir } from '../../src/core/ipc/commands';
import type { FileTreeNode } from '../../src/core/ipc/types';
vi.mock('../../src/core/ipc/commands', () => ({ readDir: vi.fn() }));
const node = (path: string, isDir = false): FileTreeNode => ({ path, name: path.split('\\').pop()!, isDir, kind: null, size: isDir ? null : 1024 ** 3, mtime: 0, isHidden: false, isSymlink: false });
beforeEach(() => { vi.resetAllMocks(); useExplorerStore.getState().clear(); });

it('refresh preserves expansion and selection, reads only opened directories, regardless of file sizes', async () => {
  const store = useExplorerStore.getState();
  const roots = [node('C:\\notes\\open', true), node('C:\\notes\\closed', true)];
  const files = Array.from({ length: 1000 }, (_, index) => node(`C:\\notes\\open\\checkpoint-${index}.bin`));
  store.setRoot('C:\\notes', roots); store.expand('C:\\notes\\open', files); store.setRevealed(files[0].path);
  vi.mocked(readDir).mockImplementation(async path => path.toLowerCase() === 'c:\\notes' ? roots : [...files, node('C:\\notes\\open\\result.pdf')]);
  await refreshExplorer();
  expect(readDir).toHaveBeenCalledTimes(2);
  expect(useExplorerStore.getState().isExpanded('C:\\notes\\open')).toBe(true);
  expect(useExplorerStore.getState().revealed).toBe(files[0].path);
  expect(useExplorerStore.getState().getChildren('C:\\notes\\open')).toHaveLength(1001);
});

it('reveal reuses cached ancestors and keeps unrelated expanded branches', async () => {
  const store = useExplorerStore.getState();
  store.setRoot('C:\\notes', [node('C:\\notes\\open', true), node('C:\\notes\\other', true)]);
  store.expand('C:\\notes\\other', []); store.updateChildren('C:\\notes\\open', [node('C:\\notes\\open\\result.pdf')]);
  await revealExplorerFile('C:\\notes\\open\\result.pdf', 'C:\\notes\\open');
  expect(readDir).not.toHaveBeenCalled();
  expect([...useExplorerStore.getState().expanded.keys()]).toEqual(['c:\\notes\\other', 'c:\\notes\\open']);
  expect(useExplorerStore.getState().revealed).toBe('C:\\notes\\open\\result.pdf');
});

it('an old reveal cannot replace a root the user opened while IO was pending', async () => {
  let complete!: (nodes: FileTreeNode[]) => void;
  vi.mocked(readDir).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = revealExplorerFile('C:\\notes\\result.pdf', 'C:\\notes');
  useExplorerStore.getState().setRoot('D:\\work', []); complete([]); await pending;
  expect(useExplorerStore.getState().root).toBe('D:\\work');
});

it('leaving and revisiting a root does not revive a stale request', async () => {
  const store = useExplorerStore.getState(); store.setRoot('C:\\notes', []);
  let complete!: (nodes: FileTreeNode[]) => void;
  vi.mocked(readDir).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = refreshExplorer();
  store.setRoot('D:\\work', []); store.setRoot('C:\\notes', [node('C:\\notes\\fresh.pdf')]);
  complete([node('C:\\notes\\stale.pdf')]); await pending;
  expect(store.getChildren('C:\\notes')?.[0].name).toBe('fresh.pdf');
});
