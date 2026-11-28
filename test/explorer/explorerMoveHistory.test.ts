import { beforeEach, expect, it, vi } from 'vitest';
import { clearExplorerRedo, importExplorerEntries, latestExplorerRedoOrder, latestExplorerUndoOrder, moveExplorerEntries, hasExplorerMoveUndo, redoExplorerOperation, undoExplorerMove } from '@/features/explorer/explorerMoveHistory';
import { useExplorerStore } from '@/features/explorer/explorerStore';
import { renameOpenPath } from '@/features/explorer/renameOpenPath';
import { copyPathIntoDirectoryWithReceipt, pathExists, redoCopiedPath, releaseCopiedReceipts, undoCopiedPath } from '@/core/ipc/commands';
import { lastHistoryEdit, markHistoryEdit, nextHistoryOrder } from '@/core/historyOrder';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { checkOpenDocumentStillExists } from '@/features/external/missingFileGuard';

vi.mock('@/features/explorer/renameOpenPath', () => ({ renameOpenPath: vi.fn(async () => 'identity') }));
vi.mock('@/features/explorer/explorerActions', () => ({ refreshExplorerDirectory: vi.fn(async () => {}) }));
vi.mock('@/features/session/documentIdentity', () => ({
  protectDocumentIdentity: vi.fn((key: string) => ({ key, generation: 1, release: vi.fn() })),
  prepareDocumentIdentity: vi.fn(async () => {}),
  assertDocumentIdentity: vi.fn(),
}));
vi.mock('@/core/ipc/commands', () => ({
  copyPathIntoDirectoryWithReceipt: vi.fn(),
  pathExists: vi.fn(),
  undoCopiedPath: vi.fn(async () => {}),
  redoCopiedPath: vi.fn(async () => {}),
  releaseCopiedReceipts: vi.fn(async () => {}),
}));

let scope = 0;
let workspace: string;
const plan = (name: string, directory = false) => ({
  from: `${workspace}\\source\\${name}`,
  to: `${workspace}\\destination\\${name}`,
  directory,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearExplorerRedo();
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null });
  workspace = `C:\\workspace-${++scope}`;
  useExplorerStore.getState().clear();
  useExplorerStore.getState().setRoot(workspace, []);
  useExplorerStore.getState().setWorkspaceRoot(workspace);
});

it('undoes only successful entries with verified identities, in reverse order', async () => {
  const file = plan('first.md'), blocked = plan('blocked.md'), folder = plan('folder', true), unsupported = plan('unsupported.md');
  vi.mocked(renameOpenPath).mockResolvedValueOnce('file-id').mockRejectedValueOnce('occupied')
    .mockResolvedValueOnce('folder-id').mockResolvedValueOnce(null);
  expect(await moveExplorerEntries([file, blocked, folder, unsupported])).toEqual({ moved: 3, undoable: 2, failures: ['occupied'] });
  expect(await undoExplorerMove()).toBe(true);
  expect(vi.mocked(renameOpenPath).mock.calls.slice(4)).toEqual([
    [folder.to, folder.from, true, { expectedIdentity: 'folder-id' }],
    [file.to, file.from, false, { expectedIdentity: 'file-id' }],
  ]);
  expect(hasExplorerMoveUndo()).toBe(false);
});

it('does not fall through to an earlier move after an in-flight drop fails', async () => {
  const older = plan('older.md');
  await moveExplorerEntries([older]);
  let fail!: (error: Error) => void;
  vi.mocked(renameOpenPath).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const move = moveExplorerEntries([plan('blocked.md')]);
  const undo = undoExplorerMove();
  await Promise.resolve();
  fail(new Error('occupied'));
  expect(await move).toEqual({ moved: 0, undoable: 0, failures: ['occupied'] });
  expect(await undo).toBe(false);
  expect(renameOpenPath).toHaveBeenCalledTimes(2);
  expect(await undoExplorerMove()).toBe(true);
  expect(renameOpenPath).toHaveBeenLastCalledWith(older.to, older.from, false, { expectedIdentity: 'identity' });
});

it('replays renames in the opposite order from successive undo operations', async () => {
  const first = { ...plan('a.md'), to: `${workspace}\\source\\b.md` };
  const second = { ...plan('b.md'), to: `${workspace}\\source\\c.md` };
  await moveExplorerEntries([first], 'rename');
  const initial = latestExplorerUndoOrder()!;
  const pending = moveExplorerEntries([second], 'rename');
  const ordered = latestExplorerUndoOrder()!;
  expect(ordered).toBeGreaterThan(initial);
  await pending;
  expect(latestExplorerUndoOrder()).toBe(ordered);
  expect(lastHistoryEdit('workspace')).toBe(ordered);

  expect(await undoExplorerMove()).toBe(true);
  const redoSecond = latestExplorerRedoOrder()!;
  expect(await undoExplorerMove()).toBe(true);
  expect(latestExplorerRedoOrder()).toBeGreaterThan(redoSecond);
  expect(await redoExplorerOperation()).toBe(true);
  expect(await redoExplorerOperation()).toBe(true);
  expect(vi.mocked(renameOpenPath).mock.calls.slice(2)).toEqual([
    [second.to, second.from, false, { expectedIdentity: 'identity' }],
    [first.to, first.from, false, { expectedIdentity: 'identity' }],
    [first.from, first.to, false, { expectedIdentity: 'identity' }],
    [second.from, second.to, false, { expectedIdentity: 'identity' }],
  ]);
});

it('invalidates workspace redo on a new document edit, including one made during pending undo', async () => {
  await moveExplorerEntries([plan('one.md')]);
  expect(await undoExplorerMove()).toBe(true);
  expect(latestExplorerRedoOrder()).toBeDefined();
  markHistoryEdit('document', nextHistoryOrder());
  expect(latestExplorerRedoOrder()).toBeUndefined();
  expect(await redoExplorerOperation()).toBe(false);

  await moveExplorerEntries([plan('two.md')]);
  let finish!: (identity: string) => void;
  vi.mocked(renameOpenPath).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const undo = undoExplorerMove();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  markHistoryEdit('document', nextHistoryOrder());
  finish('identity');
  expect(await undo).toBe(true);
  expect(latestExplorerRedoOrder()).toBeUndefined();
});

it('queues a single redo behind the matching undo and does not fall through to an older redo on failure', async () => {
  const older = plan('older.md'), newer = plan('newer.md');
  await moveExplorerEntries([older]);
  await moveExplorerEntries([newer]);
  expect(await undoExplorerMove()).toBe(true);
  const olderRedo = latestExplorerRedoOrder()!;

  let failed!: (error: Error) => void;
  vi.mocked(renameOpenPath).mockImplementationOnce(() => new Promise((_, reject) => { failed = reject; }));
  const undo = undoExplorerMove();
  const queuedOrder = latestExplorerRedoOrder()!;
  expect(queuedOrder).toBeGreaterThan(olderRedo);
  const redo = redoExplorerOperation(queuedOrder);
  expect(redoExplorerOperation(queuedOrder)).toBe(redo);
  await vi.waitFor(() => expect(failed).toBeTypeOf('function'));
  failed(new Error('occupied'));
  expect(await undo).toBe(false);
  expect(await redo).toBe(false);
  expect(latestExplorerRedoOrder()).toBe(olderRedo);
  expect(renameOpenPath).toHaveBeenCalledTimes(4);

  const successfulUndo = undoExplorerMove();
  const successfulRedo = redoExplorerOperation(latestExplorerRedoOrder()!);
  expect(await successfulUndo).toBe(true);
  expect(await successfulRedo).toBe(true);
  expect(renameOpenPath).toHaveBeenLastCalledWith(older.from, older.to, false, { expectedIdentity: 'identity' });
});

it('undoes and redoes only receipted import copies as a single batch without re-reading their originals', async () => {
  const first = plan('first.md').to, third = plan('third.md').to;
  vi.mocked(copyPathIntoDirectoryWithReceipt).mockResolvedValueOnce({ path: first, receipt: 'first' })
    .mockRejectedValueOnce('occupied')
    .mockResolvedValueOnce({ path: third, receipt: 'third' })
    .mockResolvedValueOnce({ path: plan('unsupported.txt').to, receipt: null });
  const summary = await importExplorerEntries(['D:\\first.md', 'D:\\second.md', 'D:\\third.md', 'D:\\unsupported.txt'], `${workspace}\\destination`);
  expect(summary).toEqual({ copied: 3, undoable: 2, firstCopy: first, failures: ['second.md：occupied'] });
  expect(await undoExplorerMove()).toBe(true);
  expect(vi.mocked(undoCopiedPath).mock.calls).toEqual([[third, 'third', []], [first, 'first', []]]);
  expect(await redoExplorerOperation()).toBe(true);
  expect(vi.mocked(redoCopiedPath).mock.calls).toEqual([[first, 'first'], [third, 'third']]);
  expect(copyPathIntoDirectoryWithReceipt).toHaveBeenCalledTimes(4);
});

it('keeps an imported file in place when its open document has an unsaved edit', async () => {
  const copy = plan('edited.md').to;
  vi.mocked(copyPathIntoDirectoryWithReceipt).mockResolvedValueOnce({ path: copy, receipt: 'copy' });
  await importExplorerEntries(['D:\\edited.md'], `${workspace}\\destination`);
  useDocumentStore.getState().upsertFromPayload({
    key: copy, displayName: 'edited.md', dirPath: `${workspace}\\destination`,
    kind: 'markdown', language: 'markdown', content: 'imported', encoding: 'utf8', eol: 'lf',
    size: 8, mtime: 1, readonly: false,
  });
  useDocumentStore.getState().setContent(copy, 'unsaved');
  expect(await undoExplorerMove()).toBe(false);
  expect(undoCopiedPath).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().getDocument(copy)?.content).toBe('unsaved');
  expect(latestExplorerUndoOrder()).toBeDefined();
});

it('keeps an open clean import detached while parked and reattaches it only on redo', async () => {
  const copy = plan('open.md').to;
  vi.mocked(copyPathIntoDirectoryWithReceipt).mockResolvedValueOnce({ path: copy, receipt: 'copy' });
  await importExplorerEntries(['D:\\open.md'], `${workspace}\\destination`);
  useDocumentStore.getState().upsertFromPayload({
    key: copy, displayName: 'open.md', dirPath: `${workspace}\\destination`,
    kind: 'markdown', language: 'markdown', content: 'content', encoding: 'utf8', eol: 'lf',
    size: 7, mtime: 1, readonly: false,
  });
  useWindowStore.setState({
    tabs: [{ key: copy, displayName: 'open.md', path: copy, kind: 'markdown', language: 'markdown',
      isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false }],
    activeKey: copy,
  });
  expect(await undoExplorerMove()).toBe(true);
  expect(undoCopiedPath).toHaveBeenCalledWith(copy, 'copy', [copy]);
  expect(useWindowStore.getState().getTab(copy)).toMatchObject({ isDetached: true, isImportParked: true });
  expect(await checkOpenDocumentStillExists(copy, true)).toBe(false);
  expect(pathExists).not.toHaveBeenCalled();

  expect(await redoExplorerOperation()).toBe(true);
  expect(useWindowStore.getState().getTab(copy)).toMatchObject({ isDetached: false, isImportParked: undefined });
  expect(useDocumentStore.getState().getDocument(copy)).toMatchObject({ content: 'content', externalStatus: 'clean' });
});

it('releases parked import receipts when a fresh edit discards the redo branch', async () => {
  const copy = plan('purge.md').to;
  vi.mocked(copyPathIntoDirectoryWithReceipt).mockResolvedValueOnce({ path: copy, receipt: 'parked-copy' });
  await importExplorerEntries(['D:\\purge.md'], `${workspace}\\destination`);
  expect(await undoExplorerMove()).toBe(true);
  markHistoryEdit('document', nextHistoryOrder());
  expect(latestExplorerRedoOrder()).toBeUndefined();
  expect(releaseCopiedReceipts).toHaveBeenCalledExactlyOnceWith(['parked-copy']);
});

it('retains only the blocked inverse for retry and isolates independent workspaces', async () => {
  const first = plan('locked.md'), second = plan('available.md');
  await moveExplorerEntries([first, second]);
  vi.mocked(renameOpenPath).mockResolvedValueOnce('identity').mockRejectedValueOnce(new Error('occupied'));
  expect(await undoExplorerMove()).toBe(true);
  expect(hasExplorerMoveUndo()).toBe(true);
  useExplorerStore.getState().setRoot('C:\\other', []);
  expect(hasExplorerMoveUndo()).toBe(false);
  expect(await undoExplorerMove()).toBe(false);
  useExplorerStore.getState().setRoot(workspace, []);
  expect(await undoExplorerMove()).toBe(true);
  expect(renameOpenPath).toHaveBeenCalledTimes(5);
  expect(renameOpenPath).toHaveBeenLastCalledWith(first.to, first.from, false, { expectedIdentity: 'identity' });
});
