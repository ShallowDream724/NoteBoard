import { beforeEach, expect, it, vi } from 'vitest';
import * as ipc from '@/core/ipc/commands';
import { explorerClipboardTarget, forgetExplorerCut, pasteExplorerFiles, setExplorerFileClipboard } from '@/features/explorer/explorerClipboard';
import { latestExplorerUndoOrder, redoExplorerOperation, undoExplorerMove } from '@/features/explorer/explorerMoveHistory';
import { useExplorerStore } from '@/features/explorer/explorerStore';
import { renameOpenPath } from '@/features/explorer/renameOpenPath';
import { normalizePath } from '@/features/explorer/pathUtils';

vi.mock('@/core/ipc/commands', () => ({
  writeFileClipboard: vi.fn(), readFileClipboard: vi.fn(), consumeCutFileClipboard: vi.fn(), pathExists: vi.fn(),
  copyPathIntoDirectoryWithReceipt: vi.fn(), undoCopiedPath: vi.fn(), redoCopiedPath: vi.fn(), releaseCopiedReceipts: vi.fn(),
}));
vi.mock('@/features/explorer/renameOpenPath', () => ({ renameOpenPath: vi.fn() }));
vi.mock('@/features/explorer/explorerActions', () => ({ refreshExplorerDirectory: vi.fn(async () => {}) }));

let root: string;
let sequence = 0;
const destination = () => `${root}\\target`;

beforeEach(() => {
  vi.resetAllMocks();
  forgetExplorerCut();
  root = `C:\\workspace-${++sequence}`;
  useExplorerStore.getState().setRoot(root, []);
  useExplorerStore.getState().setWorkspaceRoot(root);
  vi.mocked(ipc.pathExists).mockResolvedValue({ exists: true, isDir: false });
  vi.mocked(ipc.consumeCutFileClipboard).mockResolvedValue(undefined);
});

it('stages a cut without moving anything, then publishes the successful paste as one undoable move', async () => {
  const source = `${root}\\moved.md`, target = `${destination()}\\moved.md`;
  vi.mocked(ipc.writeFileClipboard).mockResolvedValue(42);
  vi.mocked(ipc.readFileClipboard).mockResolvedValue({ paths: [source], cut: true, sequence: 42 });
  vi.mocked(renameOpenPath).mockResolvedValue('file-id');
  expect(await setExplorerFileClipboard(source, true)).toBe(true);
  expect(ipc.writeFileClipboard).toHaveBeenCalledExactlyOnceWith([source], true);
  expect(renameOpenPath).not.toHaveBeenCalled();
  expect(latestExplorerUndoOrder()).toBeUndefined();

  await pasteExplorerFiles(destination());
  expect(renameOpenPath).toHaveBeenCalledExactlyOnceWith(source, target, false, {});
  expect(ipc.consumeCutFileClipboard).toHaveBeenCalledWith(42);
  expect(await undoExplorerMove()).toBe(true);
  expect(renameOpenPath).toHaveBeenLastCalledWith(target, source, false, { expectedIdentity: 'file-id' });
  expect(await redoExplorerOperation()).toBe(true);
  expect(renameOpenPath).toHaveBeenLastCalledWith(source, target, false, { expectedIdentity: 'file-id' });
});

it('uses the same import receipt for system copies and their undo/redo', async () => {
  const source = 'D:\\Pictures\\测试.png', target = `${destination()}\\测试.png`;
  vi.mocked(ipc.readFileClipboard).mockResolvedValue({ paths: [source], cut: false, sequence: 45 });
  vi.mocked(ipc.copyPathIntoDirectoryWithReceipt).mockResolvedValue({ path: target, receipt: 'receipt' });
  await pasteExplorerFiles(destination());
  expect(ipc.copyPathIntoDirectoryWithReceipt).toHaveBeenCalledExactlyOnceWith(source, destination());
  expect(renameOpenPath).not.toHaveBeenCalled();
  expect(ipc.consumeCutFileClipboard).not.toHaveBeenCalled();
  expect(await undoExplorerMove()).toBe(true);
  expect(ipc.undoCopiedPath).toHaveBeenCalledExactlyOnceWith(target, 'receipt', []);
  expect(await redoExplorerOperation()).toBe(true);
  expect(ipc.redoCopiedPath).toHaveBeenCalledExactlyOnceWith(target, 'receipt');
});

it('leaves an unsuccessful cut on the clipboard and never turns it into a copy', async () => {
  const source = 'D:\\outside.md';
  vi.mocked(ipc.readFileClipboard).mockResolvedValue({ paths: [source], cut: true, sequence: 48 });
  vi.mocked(renameOpenPath).mockRejectedValue('不能跨卷移动');
  await pasteExplorerFiles(destination());
  expect(renameOpenPath).toHaveBeenCalledExactlyOnceWith(source, `${destination()}\\outside.md`, false, {});
  expect(ipc.copyPathIntoDirectoryWithReceipt).not.toHaveBeenCalled();
  expect(ipc.consumeCutFileClipboard).not.toHaveBeenCalled();
  expect(latestExplorerUndoOrder()).toBeUndefined();
});

it('preserves UNC paths through cut destination planning and path normalization', async () => {
  const workspace = String.raw`\\server\share\workspace`;
  const source = String.raw`\\server\share\incoming\note.md`;
  const destination = `${workspace}\\docs`;
  useExplorerStore.getState().setRoot(workspace, []);
  useExplorerStore.getState().setWorkspaceRoot(workspace);
  vi.mocked(ipc.readFileClipboard).mockResolvedValue({ paths: [source], cut: true, sequence: 53 });
  vi.mocked(renameOpenPath).mockResolvedValue('unc-file');
  await pasteExplorerFiles(destination);
  expect(renameOpenPath).toHaveBeenCalledExactlyOnceWith(source, `${destination}\\note.md`, false, {});
  expect(normalizePath(source)).toBe(source);
  expect(normalizePath('//server/share/incoming/note.md')).toBe(source);
});

it('uses only focused tree targets and leaves rename inputs and other controls to native text shortcuts', () => {
  const tree = document.createElement('div');
  const outside = document.createElement('textarea');
  tree.innerHTML = `<button>工具</button><div class="nb-vertical-scroll-viewport"><div class="folder" data-explorer-row="${destination()}" data-explorer-directory="true"><input /></div><div class="file" data-explorer-row="${root}\\file.md"><span>文件</span></div></div>`;
  const target = (selector: string) => explorerClipboardTarget(tree, tree.querySelector(selector), root);
  expect(target('button')).toBeNull();
  expect(target('input')).toBeNull();
  expect(explorerClipboardTarget(tree, outside, root)).toBeNull();
  expect(target('.nb-vertical-scroll-viewport')).toEqual({ path: undefined, directory: root });
  expect(target('.folder')).toEqual({ path: destination(), directory: destination() });
  expect(target('.file span')).toEqual({ path: `${root}\\file.md`, directory: root });
});
