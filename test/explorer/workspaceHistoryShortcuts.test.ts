import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindWorkspaceHistoryShortcuts } from '../../src/features/history/workspaceHistoryShortcuts';
import * as files from '../../src/features/explorer/explorerMoveHistory';
import * as text from '../../src/features/history/documentHistory';
import { useWindowStore } from '../../src/stores/windowStore';

vi.mock('../../src/features/explorer/explorerMoveHistory', () => ({
  latestExplorerUndoOrder: vi.fn(), latestExplorerRedoOrder: vi.fn(),
  undoExplorerOperation: vi.fn(), redoExplorerOperation: vi.fn(),
  guardExplorerOpposite: vi.fn(),
}));
vi.mock('../../src/features/history/documentHistory', () => ({
  getDocumentHistoryOrder: vi.fn(), flushPendingDocumentHistory: vi.fn(), undoDocumentHistory: vi.fn(), redoDocumentHistory: vi.fn(),
}));

let stop: () => void;
const press = (el: Element, key: string, repeat = false) => el.dispatchEvent(new KeyboardEvent('keydown', {
  key, ctrlKey: true, repeat, bubbles: true, cancelable: true,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(files.undoExplorerOperation).mockResolvedValue(true);
  vi.mocked(files.redoExplorerOperation).mockResolvedValue(true);
  useWindowStore.setState({activeKey: 'sample.md'});
  document.body.innerHTML = '<div class="nb-explorer-tree"><input></div><div class="nb-document-editors"><div class="ProseMirror" contenteditable="true"><p>Text</p><div class="cm-editor"><span>Embedded</span></div></div></div>';
  stop = bindWorkspaceHistoryShortcuts();
});
afterEach(() => { stop(); document.body.replaceChildren(); useWindowStore.setState({activeKey: null}); });

it('reverses a later file operation from the document, and keeps later text edits with the editor', async () => {
  const paragraph = document.querySelector('p')!;
  vi.mocked(files.latestExplorerUndoOrder).mockReturnValue(2);
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({undo: 1});
  expect(press(paragraph, 'z')).toBe(false);
  expect(files.undoExplorerOperation).toHaveBeenCalledOnce();
  await Promise.resolve();
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({undo: 3});
  expect(press(paragraph, 'z')).toBe(true);
  expect(files.undoExplorerOperation).toHaveBeenCalledOnce();
});

it('redoes the most recently undone action, even after focus moves between the tree and document', async () => {
  vi.mocked(files.latestExplorerRedoOrder).mockReturnValue(5);
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({redo: 4});
  expect(press(document.querySelector('p')!, 'y')).toBe(false);
  expect(files.redoExplorerOperation).toHaveBeenCalledOnce();
  await Promise.resolve();
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({redo: 6});
  expect(press(document.querySelector('.nb-explorer-tree')!, 'y')).toBe(false);
  expect(text.redoDocumentHistory).toHaveBeenCalledWith('sample.md');
});

it.each([
  ['z', 'undo', files.latestExplorerUndoOrder, files.undoExplorerOperation, text.undoDocumentHistory],
  ['y', 'redo', files.latestExplorerRedoOrder, files.redoExplorerOperation, text.redoDocumentHistory],
] as const)('re-arbitrates a queued Ctrl+%s after the file rekeys its open editor', async (shortcut, direction, latest, replay, documentReplay) => {
  const paragraph = document.querySelector('p')!;
  let complete!: (success: boolean) => void;
  vi.mocked(replay).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  vi.mocked(latest).mockReturnValue(8);
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({ [direction]: 7 });
  expect(press(paragraph, shortcut)).toBe(false);
  expect(press(paragraph, shortcut, true)).toBe(false);
  expect(press(paragraph, shortcut)).toBe(false);
  expect(replay).toHaveBeenCalledExactlyOnceWith(8);
  expect(documentReplay).not.toHaveBeenCalled();

  paragraph.remove();
  useWindowStore.setState({ activeKey: 'renamed.md' });
  vi.mocked(latest).mockReturnValue(6);
  complete(true);
  await Promise.resolve();
  expect(replay).toHaveBeenCalledOnce();
  expect(documentReplay).toHaveBeenCalledExactlyOnceWith('renamed.md');
});

it('executes independent queued file redos in order without replaying held keys', async () => {
  let complete!: (success: boolean) => void;
  vi.mocked(files.redoExplorerOperation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  vi.mocked(files.latestExplorerRedoOrder).mockReturnValue(8);
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({});
  const tree = document.querySelector('.nb-explorer-tree')!;
  press(tree, 'y');
  press(tree, 'y', true);
  press(tree, 'y');
  expect(files.redoExplorerOperation).toHaveBeenCalledExactlyOnceWith(8);

  vi.mocked(files.latestExplorerRedoOrder).mockReturnValue(5);
  complete(true);
  await Promise.resolve();
  expect(vi.mocked(files.redoExplorerOperation).mock.calls).toEqual([[8], [5]]);
});

it('does not fall through to an older redo when the queued opposite file operation fails', async () => {
  let complete!: (success: boolean) => void;
  vi.mocked(files.undoExplorerOperation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  vi.mocked(files.latestExplorerUndoOrder).mockReturnValue(8);
  vi.mocked(files.latestExplorerRedoOrder).mockReturnValue(9);
  vi.mocked(files.guardExplorerOpposite).mockReturnValue(() => false);
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({});
  press(document.body, 'z');
  expect(press(document.body, 'y')).toBe(false);
  expect(files.guardExplorerOpposite).toHaveBeenCalledExactlyOnceWith('redo', 9);

  vi.mocked(files.latestExplorerRedoOrder).mockReturnValue(7);
  complete(false);
  await Promise.resolve();
  expect(files.redoExplorerOperation).not.toHaveBeenCalled();
});

it('uses the active document history after the editor loses focus to the body', () => {
  vi.mocked(text.getDocumentHistoryOrder).mockReturnValue({ undo: 4, redo: 6 });
  expect(document.activeElement).toBe(document.body);
  expect(press(document.body, 'z')).toBe(false);
  expect(press(document.body, 'y')).toBe(false);
  expect(text.undoDocumentHistory).toHaveBeenCalledExactlyOnceWith('sample.md');
  expect(text.redoDocumentHistory).toHaveBeenCalledExactlyOnceWith('sample.md');
});

it('leaves the history of a rename field or embedded editor to that control', () => {
  vi.mocked(files.latestExplorerUndoOrder).mockReturnValue(8);
  expect(press(document.querySelector('input')!, 'z')).toBe(true);
  expect(press(document.querySelector('.cm-editor span')!, 'z')).toBe(true);
  expect(files.undoExplorerOperation).not.toHaveBeenCalled();
});
