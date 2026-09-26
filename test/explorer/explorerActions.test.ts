import { beforeEach, expect, it, vi } from 'vitest';
import { useExplorerStore } from '../../src/features/explorer/explorerStore';
import { followExplorerFile, readExplorerDirectory, refreshExplorer, revealExplorerFile, revealWrittenExplorerFile } from '../../src/features/explorer/explorerActions';
import { readDir } from '../../src/core/ipc/commands';
import type { FileTreeNode } from '../../src/core/ipc/types';
import { readNativeHeaders } from '../../src/core/nativeDocumentIO';
import { invalidateMarkdownAssociations } from '../../src/features/document-format/markdownAssociationIndex';
vi.mock('../../src/core/ipc/commands', () => ({ readDir: vi.fn() }));
vi.mock('../../src/core/nativeDocumentIO', () => ({ readNativeHeaders: vi.fn().mockResolvedValue([]) }));
const node = (path: string, isDir = false): FileTreeNode => ({ path, name: path.split('\\').pop()!, isDir, kind: null, size: isDir ? null : 1024 ** 3, mtime: 0, isHidden: false, isSymlink: false });
beforeEach(() => {
  vi.resetAllMocks(); useExplorerStore.getState().clear(); invalidateMarkdownAssociations();
  vi.mocked(readNativeHeaders).mockResolvedValue([]);
});

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

it('reveals a written file from a fresh snapshot even when a pre-write read is pending', async () => {
  const store = useExplorerStore.getState(), dir = 'C:\\notes\\open', file = dir + '\\memo.nb';
  store.setRoot('C:\\notes', [node(dir, true), node('C:\\notes\\other', true)]);
  store.expand('C:\\notes\\other', []); store.expand(dir, [node(dir + '\\memo.md')]);
  let complete!: (nodes: FileTreeNode[]) => void;
  const fresh = [node(file), node(dir + '\\memo.md')];
  vi.mocked(readDir).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue(fresh);
  const beforeWrite = readExplorerDirectory(dir);
  const reveal = revealWrittenExplorerFile(file, dir, () => true, true);
  const passive = followExplorerFile(file, dir, () => true);
  complete([node(dir + '\\memo.md')]);
  await Promise.all([beforeWrite, reveal, passive]);
  expect(readDir).toHaveBeenCalledTimes(2);
  expect(store.getChildren(dir)).toEqual(fresh);
  expect(useExplorerStore.getState().root).toBe('C:\\notes');
  expect(store.isExpanded('C:\\notes\\other')).toBe(true);
  expect(useExplorerStore.getState().revealed).toBe(file);
  expect(useExplorerStore.getState().associationExpanded.has(file.toLowerCase())).toBe(true);
});

it('does not pull the tree back after the user navigates away during a post-write refresh', async () => {
  const store = useExplorerStore.getState(), dir = 'C:\\notes';
  store.setRoot(dir, []);
  let complete!: (nodes: FileTreeNode[]) => void;
  vi.mocked(readDir).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = revealWrittenExplorerFile(dir + '\\memo.nb', dir, () => true, true);
  await vi.waitFor(() => expect(readDir).toHaveBeenCalledOnce());
  store.setRoot('D:\\work', []); complete([node(dir + '\\memo.nb')]);
  await pending;
  expect(useExplorerStore.getState().root).toBe('D:\\work');
  expect(useExplorerStore.getState().revealed).toBeNull();
  expect(useExplorerStore.getState().associationExpanded.size).toBe(0);
});
